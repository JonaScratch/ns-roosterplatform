"""De constraint solver voor roosters.

Leest één JSON-opdracht van stdin en schrijft één JSON-antwoord naar stdout.

## Waarom dit een apart proces is

Dit script kent de database niet. Het heeft geen verbinding, geen
inloggegevens, geen bestandstoegang die het nodig heeft. Het krijgt een
beschrijving van het vraagstuk en geeft een voorstel terug. Daardoor is de eis
"de optimizer mag niets schrijven" geen afspraak maar een eigenschap van de
omgeving waarin hij draait.

## Wat dit script niet doet

Het beslist niet of een rooster mag. De constraints die het toepast, komen
binnen als getallen uit de centrale regelcatalogus; het script formuleert zelf
geen enkele regel en kent geen CAO. Wat eruit komt, wordt daarna onafhankelijk
opnieuw doorgerekend door de validator in de applicatie. Zegt deze solver
`OPTIMAL` en de validator `overtreding`, dan heeft de validator gelijk.

## Alles tegelijk, in rotatievolgorde

Alle roosterlijnen van alle profielen zitten in één model. En binnen een
basisrooster liggen de regels achter elkaar zoals een medewerker ze rijdt:
zondag van regel k grenst aan maandag van regel k+1, en de laatste regel aan de
eerste. Rust, aaneengesloten diensten, nachtreeksen en overgangen worden langs
die volgorde gemeten. Eerder was elke regel zijn eigen cyclus, waardoor de
overgang van zondag naar de maandag van de volgende week nooit werd gezien.

## Hard en zacht

Hard, en dus onmogelijk: profielgrenzen, weekdagen, een dienst hooguit één
keer, precies één dienst per te vullen dienstdag, de minimale rust tussen
opeenvolgende dagen en het maximum aantal aaneengesloten diensten.

Zacht, en dus afweegbaar: urenbalans, rust boven het minimum, overgangen,
nachtreeksen, eerlijke verdeling tussen roosters, behoud van het huidige rooster
of van een eerdere kandidaat. Geen enkele zachte term kan een harde grens
afkopen; dekking is geen kostenpost maar een eis.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any

from ortools.sat.python import cp_model

MINUTES_PER_DAY = 1440
CATEGORIES = ("EARLY", "LATE", "NIGHT")


def read_request() -> dict[str, Any]:
    return json.loads(sys.stdin.read())


def duty_key(duty: dict[str, Any]) -> str:
    """De sleutel van een dienstinstantie: nummer én weekdag."""
    return f"{duty['code']}|{duty['weekday']}"


def slot_key(line: dict[str, Any], day: dict[str, Any]) -> str:
    return f"{line['baseRosterCode']}|{line['lineNumber']}|{day['weekIndex']}|{day['weekday']}"


def solve(request: dict[str, Any]) -> dict[str, Any]:
    """Los het vraagstuk op, en leg uit waarom het niet kan als het niet kan.

    Eerst met volledige dekking als harde eis. Levert dat niets op, dan wordt
    hetzelfde vraagstuk nog één keer opgelost met dekking als kostenpost — niet
    om dat als rooster aan te bieden (de aanroeper weigert het alsnog), maar om
    te laten zien wélke dienstdagen leeg blijven.

    Het antwoord zegt altijd hoe de poging mét volledige dekking afliep
    (`fullCoverageStatus`). De toelichtende tweede poging meldt zelf OPTIMAL,
    en daaruit viel eerder niet op te maken dat er geen volledig rooster
    bestond — een generatie zocht dan door naar een kandidaat die er niet was.

    Met `explainShortfall: false` blijft de tweede poging achterwege. Een
    generatie die een afwijkende kandidaat zoekt, heeft niets aan de uitleg en
    wel aan de rekentijd.
    """
    options: dict[str, Any] = request.get("options", {})
    antwoord = solve_once(request, require_full_coverage=True)
    antwoord["fullCoverageStatus"] = antwoord["status"]
    if antwoord["status"] in ("OPTIMAL", "FEASIBLE"):
        return antwoord
    if options.get("explainShortfall", True) is False:
        return antwoord

    toelichting = solve_once(request, require_full_coverage=False)
    toelichting["fullCoverageStatus"] = antwoord["status"]
    if toelichting["status"] in ("OPTIMAL", "FEASIBLE"):
        return toelichting
    return antwoord


def solve_once(request: dict[str, Any], require_full_coverage: bool) -> dict[str, Any]:
    lines: list[dict[str, Any]] = request["lines"]
    duties: list[dict[str, Any]] = request["duties"]
    options: dict[str, Any] = request.get("options", {})

    min_rest = int(options.get("minRestMinutes", 0))
    max_consecutive = int(options.get("maxConsecutiveDuties", 0))
    time_limit = float(options.get("timeLimitSeconds", 20))
    seed = int(options.get("seed", 0))
    workers = max(1, int(options.get("workers", 1)))
    objective: dict[str, float] = options.get("objective", {}) or {}

    model = cp_model.CpModel()

    # ── De cyclus per basisrooster ───────────────────────────────────────────
    # Per rooster de dagen in rotatievolgorde. Een positie is óf een te vullen
    # dienstdag (een slot), óf een vaste dag (rust, reserve, WTV, compensatie).
    per_rooster: dict[str, list[int]] = {}
    for line_index, line in enumerate(lines):
        per_rooster.setdefault(line["baseRosterCode"], []).append(line_index)

    slots: list[dict[str, Any]] = []
    cycles: dict[str, list[dict[str, Any]]] = {}
    for code, line_indexes in per_rooster.items():
        line_indexes.sort(key=lambda index: lines[index]["lineNumber"])
        cycle: list[dict[str, Any]] = []
        for line_index in line_indexes:
            line = lines[line_index]
            for day in sorted(line["days"], key=lambda d: (d["weekIndex"], d["weekday"])):
                positie = {
                    "lineIndex": line_index,
                    "day": day,
                    "positionType": day.get("positionType", "DUTY" if day["assignable"] else "RUST"),
                    "slot": None,
                }
                if day["assignable"]:
                    positie["slot"] = len(slots)
                    slots.append(
                        {
                            "lineIndex": line_index,
                            "roster": code,
                            "weekIndex": day["weekIndex"],
                            "weekday": day["weekday"],
                            "current": day.get("dutyCode"),
                            "allowedKinds": line["allowedKinds"],
                            "key": slot_key(line, day),
                        }
                    )
                cycle.append(positie)
        cycles[code] = cycle

    # ── Variabelen ───────────────────────────────────────────────────────────
    x: dict[tuple[int, int], cp_model.IntVar] = {}
    allowed_for_slot: dict[int, list[int]] = {s: [] for s in range(len(slots))}
    slots_for_duty: dict[int, list[int]] = {d: [] for d in range(len(duties))}
    for s, slot in enumerate(slots):
        for d, duty in enumerate(duties):
            if duty["weekday"] != slot["weekday"]:
                continue
            # Profielgrens: harde eis, geen kostenpost.
            if not set(duty["timeOfDayKinds"]).issubset(set(slot["allowedKinds"])):
                continue
            x[(s, d)] = model.NewBoolVar(f"x_{s}_{d}")
            allowed_for_slot[s].append(d)
            slots_for_duty[d].append(s)

    # ── Harde constraints ────────────────────────────────────────────────────
    # 1. Precies één dienst per te vullen dienstdag. Dekking is geen voorkeur
    #    die je kunt afkopen: eerder liet de oplosser dagen leeg omdat eerlijke
    #    verdeling meer opleverde, en dat werd pas achteraf geweigerd.
    for s in range(len(slots)):
        if allowed_for_slot[s]:
            bezetting = sum(x[(s, d)] for d in allowed_for_slot[s])
            if require_full_coverage:
                model.Add(bezetting == 1)
            else:
                model.Add(bezetting <= 1)

    # 2. Een dienstinstantie wordt hooguit één keer gebruikt.
    for d in range(len(duties)):
        if slots_for_duty[d]:
            model.Add(sum(x[(s, d)] for s in slots_for_duty[d]) <= 1)

    def som(s: int, waarde) -> Any:
        return sum(x[(s, d)] * waarde(duties[d]) for d in allowed_for_slot[s])

    start = {s: som(s, lambda duty: int(duty["startMinute"])) for s in range(len(slots))}
    einde = {s: som(s, lambda duty: int(duty["endMinute"])) for s in range(len(slots))}

    def opeenvolgend(code: str):
        """Paren (positie, volgende positie) langs de cyclus, rond."""
        cycle = cycles[code]
        lengte = len(cycle)
        for t in range(lengte):
            yield cycle[t], cycle[(t + 1) % lengte]

    # 3. Rust tussen twee opeenvolgende dienstdagen, ook over de regelgrens.
    if min_rest > 0:
        for code in cycles:
            if len(cycles[code]) < 2:
                continue
            for huidig, volgend in opeenvolgend(code):
                s, t = huidig["slot"], volgend["slot"]
                if s is None or t is None or not allowed_for_slot[s] or not allowed_for_slot[t]:
                    continue
                if require_full_coverage:
                    # Met precies één dienst per dag zijn begin en eind lineair.
                    model.Add(MINUTES_PER_DAY + start[t] - einde[s] >= min_rest)
                else:
                    for d1 in allowed_for_slot[s]:
                        for d2 in allowed_for_slot[t]:
                            rust = int(duties[d2]["startMinute"]) + MINUTES_PER_DAY - int(duties[d1]["endMinute"])
                            if rust < min_rest:
                                model.Add(x[(s, d1)] + x[(t, d2)] <= 1)

    # 4. Maximum aantal aaneengesloten dienstdagen, langs de hele cyclus.
    if max_consecutive > 0:
        for code, cycle in cycles.items():
            lengte = len(cycle)
            venster = max_consecutive + 1
            if venster > lengte:
                continue
            bezet = []
            for positie in cycle:
                s = positie["slot"]
                bezet.append(sum(x[(s, d)] for d in allowed_for_slot[s]) if s is not None and allowed_for_slot[s] else 0)
            for begin in range(lengte):
                model.Add(sum(bezet[(begin + k) % lengte] for k in range(venster)) <= max_consecutive)

    # 5. Verschillend van eerdere kandidaten: een nieuwe kandidaat moet op ten
    #    minste zoveel dienstdagen een ander dienstnummer hebben. Zonder deze
    #    eis levert een tweede run met iets andere gewichten vaak exact hetzelfde
    #    rooster op, en dan zijn "drie kandidaten" één kandidaat drie keer.
    min_different = int(options.get("minDifferentSlots", 0))
    key_to_slot = {slot["key"]: s for s, slot in enumerate(slots)}
    duty_index = {duty_key(duty): d for d, duty in enumerate(duties)}
    for vorige in options.get("excludeSolutions", []) or []:
        gelijk = []
        for toewijzing in vorige:
            s = key_to_slot.get(toewijzing["slotKey"])
            d = duty_index.get(toewijzing["dutyKey"])
            if s is not None and d is not None and (s, d) in x:
                gelijk.append(x[(s, d)])
        if gelijk and min_different > 0:
            model.Add(sum(gelijk) <= max(0, len(gelijk) - min_different))

    # ── Zachte doelen ────────────────────────────────────────────────────────
    # Alles hieronder is een kostenpost. Alleen bij volledige dekking: met lege
    # dagen zijn begin en eind geen dienst maar nul, en dan meten deze termen
    # iets wat niet bestaat.
    straffen: list[Any] = []
    if require_full_coverage:
        straffen = zachte_doelen(model, options, objective, lines, duties, slots, cycles, x, allowed_for_slot, start, einde)
    else:
        # Zonder dekkingseis is lege dagen vermijden het enige doel.
        straffen = [-1000 * sum(x.values())]

    if straffen:
        model.Minimize(sum(straffen))

    # Warme start: een eerdere oplossing als vertrekpunt. Bij een herbouw of
    # reparatie is dat de kandidaat die verbeterd wordt.
    for toewijzing in options.get("hintAssignments", []) or []:
        s = key_to_slot.get(toewijzing["slotKey"])
        d = duty_index.get(toewijzing["dutyKey"])
        if s is None or d is None:
            continue
        for d2 in allowed_for_slot[s]:
            model.AddHint(x[(s, d2)], 1 if d2 == d else 0)

    # ── Oplossen ─────────────────────────────────────────────────────────────
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit
    solver.parameters.random_seed = seed
    # Eén zoekdraad levert herhaalbare uitkomsten (voor de tests); meer draden
    # vinden binnen dezelfde rekentijd betere roosters. De aanroeper kiest.
    solver.parameters.num_search_workers = workers
    status = solver.Solve(model)

    status_name = solver.StatusName(status)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {
            "status": status_name,
            "assignments": [],
            "unplacedDuties": [duty_key(duty) for duty in duties],
            "diagnostics": diagnose(lines, duties, slots, allowed_for_slot),
            "statistics": statistics(solver, model, status_name),
        }

    assignments = []
    geplaatst: set[int] = set()
    for (s, d), var in x.items():
        if solver.Value(var) == 1:
            slot = slots[s]
            line = lines[slot["lineIndex"]]
            assignments.append(
                {
                    "baseRosterCode": line["baseRosterCode"],
                    "lineNumber": line["lineNumber"],
                    "weekIndex": slot["weekIndex"],
                    "weekday": slot["weekday"],
                    "dutyCode": duties[d]["code"],
                    "dutyKey": duty_key(duties[d]),
                }
            )
            geplaatst.add(d)

    return {
        "status": status_name,
        "assignments": assignments,
        "unplacedDuties": [duty_key(duty) for d, duty in enumerate(duties) if d not in geplaatst],
        "diagnostics": [],
        "statistics": statistics(solver, model, status_name),
    }


def zachte_doelen(model, options, objective, lines, duties, slots, cycles, x, allowed_for_slot, start, einde) -> list[Any]:
    """De kostenposten. Alle gewichten komen van buiten; hier staan geen getallen."""
    straffen: list[Any] = []

    def gewicht(naam: str) -> int:
        return int(round(float(objective.get(naam, 0))))

    def som(s: int, waarde) -> Any:
        return sum(x[(s, d)] * waarde(duties[d]) for d in allowed_for_slot[s])

    def kan(s: int, voorwaarde) -> bool:
        return any(voorwaarde(duties[d]) for d in allowed_for_slot[s])

    is_nacht = lambda duty: duty.get("category") == "NIGHT"  # noqa: E731
    rooster_regels: dict[str, set[int]] = {}
    rooster_weken: dict[str, int] = {}
    for line in lines:
        rooster_regels.setdefault(line["baseRosterCode"], set()).add(line["lineNumber"])
        rooster_weken[line["baseRosterCode"]] = rooster_weken.get(line["baseRosterCode"], 0) + int(line["cycleWeeks"])

    # a. Urenbalans: per basisrooster de roostercredit tegen 40 uur per week.
    #    Werkuren van de diensten plus de vaste creditdagen (RES, WR, CO).
    urenafwijkingen: list[Any] = []
    w_uren = gewicht("hoursBalance")
    target_week = int(options.get("targetWeeklyMinutes", 2400))
    credit = options.get("anchorCreditMinutes", {}) or {}
    if w_uren > 0:
        for code, cycle in cycles.items():
            weken = max(1, rooster_weken.get(code, 1))
            vast = sum(int(credit.get(p["positionType"], 0)) for p in cycle if p["slot"] is None)
            totaal = vast + sum(
                som(p["slot"], lambda duty: int(duty["endMinute"]) - int(duty["startMinute"]))
                for p in cycle
                if p["slot"] is not None and allowed_for_slot[p["slot"]]
            )
            doel = target_week * weken
            afwijking = model.NewIntVar(0, doel + 100000, f"uren_{code}")
            model.Add(afwijking >= totaal - doel)
            model.Add(afwijking >= doel - totaal)
            # Per week: een rooster van zes weken en een van twaalf wegen per
            # minuut weekafwijking even zwaar.
            straffen.append(afwijking * max(1, round(w_uren * 60 / weken)))
            urenafwijkingen.append((afwijking, weken))

    # a2. Het slechtste rooster apart: een gemiddelde van 40:00 over zeven
    #     roosters kan één rooster van 39:10 verbergen, en dat ene rooster is
    #     wat een medewerker merkt.
    w_slechtst = gewicht("hoursWorst")
    if w_slechtst > 0 and urenafwijkingen:
        slechtst = model.NewIntVar(0, 100000, "uren_slechtst")
        for afwijking, weken in urenafwijkingen:
            model.Add(slechtst * weken >= afwijking)
        straffen.append(slechtst * w_slechtst)

    # b. Rust boven het minimum: elke minuut onder de comfortabele rust kost.
    w_rust = gewicht("restComfort")
    comfortabel = int(options.get("comfortableRestMinutes", 0))
    if w_rust > 0 and comfortabel > 0:
        for code in cycles:
            cycle = cycles[code]
            for t in range(len(cycle)):
                s, u = cycle[t]["slot"], cycle[(t + 1) % len(cycle)]["slot"]
                if s is None or u is None or not allowed_for_slot[s] or not allowed_for_slot[u]:
                    continue
                tekort = model.NewIntVar(0, comfortabel, f"rust_{s}_{u}")
                model.Add(tekort >= comfortabel - (MINUTES_PER_DAY + start[u] - einde[s]))
                straffen.append(tekort * w_rust)

    # c. Overgangen tussen dagdelen, direct na elkaar en over één vrije dag.
    w_overgang = gewicht("transitions")
    matrix = options.get("transitionPenalties", {}) or {}
    direct = matrix.get("adjacent", {})
    over_vrij = matrix.get("overOffDay", {})
    vrije_dagen = set(options.get("offPositionTypes", ["RUST", "WR", "CO"]))
    if w_overgang > 0:
        categorie = {}
        for s in range(len(slots)):
            categorie[s] = {
                k: som(s, lambda duty, k=k: 1 if duty.get("category") == k else 0) for k in CATEGORIES
            }

        def strafpaar(s: int, u: int, tabel: dict[str, dict[str, float]], label: str) -> None:
            for k1 in CATEGORIES:
                if not kan(s, lambda duty, k1=k1: duty.get("category") == k1):
                    continue
                for k2 in CATEGORIES:
                    punten = int(round(float(tabel.get(k1, {}).get(k2, 0))))
                    if punten <= 0 or not kan(u, lambda duty, k2=k2: duty.get("category") == k2):
                        continue
                    z = model.NewBoolVar(f"{label}_{s}_{u}_{k1}_{k2}")
                    model.Add(z >= categorie[s][k1] + categorie[u][k2] - 1)
                    straffen.append(z * punten * w_overgang)

        for code, cycle in cycles.items():
            lengte = len(cycle)
            if lengte < 2:
                continue
            for t in range(lengte):
                s = cycle[t]["slot"]
                if s is None or not allowed_for_slot[s]:
                    continue
                volgend = cycle[(t + 1) % lengte]
                u = volgend["slot"]
                if u is not None and allowed_for_slot[u]:
                    strafpaar(s, u, direct, "ov")
                elif lengte > 2 and volgend["positionType"] in vrije_dagen:
                    daarna = cycle[(t + 2) % lengte]["slot"]
                    if daarna is not None and allowed_for_slot[daarna]:
                        strafpaar(s, daarna, over_vrij, "ovv")

    # d. Nachtreeksen: losse nachten en reeksen van twee kosten; drie of meer
    #    niet. Langs de rotatievolgorde, rond.
    w_los = gewicht("nightSingleton")
    w_paar = gewicht("nightPair")
    w_buiten = gewicht("nightOutsideReference")
    nachtroosters = set(options.get("nightRosterCodes", []) or [])
    nacht_per_rooster: dict[str, Any] = {}
    for code, cycle in cycles.items():
        lengte = len(cycle)
        n = []
        for positie in cycle:
            s = positie["slot"]
            if s is not None and allowed_for_slot[s] and kan(s, is_nacht):
                n.append(som(s, lambda duty: 1 if is_nacht(duty) else 0))
            else:
                n.append(0)
        mogelijk = [not isinstance(waarde, int) for waarde in n]
        nacht_per_rooster[code] = sum(waarde for waarde in n if not isinstance(waarde, int))
        if not any(mogelijk) or lengte < 3:
            continue
        for t in range(lengte):
            if not mogelijk[t]:
                continue
            vorig, volgend = n[(t - 1) % lengte], n[(t + 1) % lengte]
            if w_los > 0:
                los = model.NewBoolVar(f"los_{code}_{t}")
                model.Add(los >= n[t] - vorig - volgend)
                straffen.append(los * w_los)
            if w_paar > 0 and mogelijk[(t + 1) % lengte] and lengte >= 4:
                paar = model.NewBoolVar(f"paar_{code}_{t}")
                model.Add(paar >= n[t] + volgend - vorig - n[(t + 2) % lengte] - 1)
                straffen.append(paar * w_paar)
        if w_buiten > 0 and code not in nachtroosters and nachtroosters:
            straffen.append(nacht_per_rooster[code] * w_buiten)

    # e. Eerlijke verdeling tussen basisroosters, per regel genormaliseerd.
    def eerlijk(naam: str, codes: list[str], belasting: dict[str, Any]) -> None:
        w = gewicht(naam)
        if w <= 0 or len(codes) < 2:
            return
        totaal_regels = sum(len(rooster_regels[code]) for code in codes)
        totaal = sum(belasting[code] for code in codes)
        for code in codes:
            regels = len(rooster_regels[code])
            afwijking = model.NewIntVar(0, 10**9, f"{naam}_{code}")
            verschil = belasting[code] * totaal_regels - totaal * regels
            model.Add(afwijking >= verschil)
            model.Add(afwijking >= -verschil)
            straffen.append(afwijking * w)

    alle = sorted(cycles.keys())
    eerlijk("nightFairness", sorted(code for code in alle if code in nachtroosters), nacht_per_rooster)

    rangeer = {}
    weekend = {}
    for code, cycle in cycles.items():
        rangeer[code] = sum(
            som(p["slot"], lambda duty: 1 if duty.get("isShunting") else 0)
            for p in cycle
            if p["slot"] is not None and allowed_for_slot[p["slot"]]
        )
        # Weekenduren in kwartieren, om de coëfficiënten klein te houden.
        weekend[code] = sum(
            som(p["slot"], lambda duty: (int(duty["endMinute"]) - int(duty["startMinute"])) // 15)
            for p in cycle
            if p["slot"] is not None and allowed_for_slot[p["slot"]] and p["day"]["weekday"] >= 6
        )
    eerlijk("shuntingFairness", alle, rangeer)
    eerlijk("weekendFairness", alle, weekend)

    # f. Behoud: van het huidige rooster (minste wijziging) en van een eerdere
    #    kandidaat (herbouw die goede delen laat staan).
    key_to_slot = {slot["key"]: s for s, slot in enumerate(slots)}
    duty_index = {duty_key(duty): d for d, duty in enumerate(duties)}

    def behoud(naam: str, lijst: list[dict[str, Any]]) -> None:
        w = gewicht(naam)
        if w <= 0:
            return
        for toewijzing in lijst:
            s = key_to_slot.get(toewijzing["slotKey"])
            d = duty_index.get(toewijzing["dutyKey"])
            if s is not None and d is not None and (s, d) in x:
                # Een kostenpost voor elke dienstdag die afwijkt.
                straffen.append((1 - x[(s, d)]) * w)

    behoud("preserveReference", options.get("referenceAssignments", []) or [])
    behoud("preserveHint", options.get("hintAssignments", []) or [])

    # g. Geaggregeerde feedback: per rooster een extra kostenpost op een soort
    #    belasting. Geen individuele antwoorden; alleen gewicht per rooster.
    for signaal in options.get("feedbackPenalties", []) or []:
        code = signaal.get("rosterCode")
        w = int(round(float(signaal.get("weight", 0))))
        if code not in cycles or w <= 0:
            continue
        soort = signaal.get("burden")
        telling = []
        for p in cycles[code]:
            s = p["slot"]
            if s is None or not allowed_for_slot[s]:
                continue
            if soort == "NIGHT":
                telling.append(som(s, lambda duty: 1 if is_nacht(duty) else 0))
            elif soort == "EARLY":
                telling.append(som(s, lambda duty: 1 if duty.get("category") == "EARLY" else 0))
            elif soort == "SHUNTING":
                telling.append(som(s, lambda duty: 1 if duty.get("isShunting") else 0))
            elif soort == "WEEKEND" and p["day"]["weekday"] >= 6:
                telling.append(sum(x[(s, d)] for d in allowed_for_slot[s]))
        if telling:
            straffen.append(sum(telling) * w)

    return straffen


def diagnose(
    lines: list[dict[str, Any]],
    duties: list[dict[str, Any]],
    slots: list[dict[str, Any]],
    allowed_for_slot: dict[int, list[int]],
) -> list[str]:
    """Waar het waarschijnlijk op vastloopt. Een richting, geen juridische uitspraak."""
    bevindingen: list[str] = []

    per_weekday_slots: dict[int, int] = {}
    for slot in slots:
        per_weekday_slots[slot["weekday"]] = per_weekday_slots.get(slot["weekday"], 0) + 1
    per_weekday_duties: dict[int, int] = {}
    for duty in duties:
        per_weekday_duties[duty["weekday"]] = per_weekday_duties.get(duty["weekday"], 0) + 1

    for weekday, aantal in sorted(per_weekday_duties.items()):
        beschikbaar = per_weekday_slots.get(weekday, 0)
        if aantal > beschikbaar:
            bevindingen.append(f"weekdag {weekday}: {aantal} diensten en {beschikbaar} dienstslots")

    zonder_slot = [
        duty_key(duty)
        for d, duty in enumerate(duties)
        if not any(d in allowed_for_slot[s] for s in range(len(slots)))
    ]
    if zonder_slot:
        bevindingen.append(
            f"{len(zonder_slot)} diensten passen in geen enkel roosterprofiel of weekdag: "
            + ", ".join(zonder_slot[:8])
        )
    return bevindingen


def statistics(solver: cp_model.CpSolver, model: cp_model.CpModel, status_name: str) -> dict[str, Any]:
    proto = model.Proto()
    return {
        "status": status_name,
        "optimal": status_name == "OPTIMAL",
        "wallTimeSeconds": round(solver.WallTime(), 3),
        "objectiveValue": solver.ObjectiveValue() if solver.ObjectiveValue() is not None else 0,
        "bestObjectiveBound": solver.BestObjectiveBound(),
        "variables": len(proto.variables),
        "constraints": len(proto.constraints),
        "branches": solver.NumBranches(),
        "workers": solver.parameters.num_search_workers,
    }


def main() -> None:
    try:
        request = read_request()
        antwoord = solve(request)
    except Exception as fout:  # noqa: BLE001 — de aanroeper moet dit als tekst zien
        antwoord = {
            "status": "ERROR",
            "assignments": [],
            "unplacedDuties": [],
            "diagnostics": [],
            "statistics": {},
            "error": f"{type(fout).__name__}: {fout}",
        }
    json.dump(antwoord, sys.stdout)


if __name__ == "__main__":
    main()
