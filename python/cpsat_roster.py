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

## Alles tegelijk

Alle roosterlijnen van alle profielen zitten in één model. Een verbetering in
het ene rooster gaat daardoor niet stilzwijgend ten koste van het andere: de
solver ziet de gevolgen en weegt ze mee.
"""

from __future__ import annotations

import json
import sys
from typing import Any

from ortools.sat.python import cp_model

MINUTES_PER_DAY = 1440


def read_request() -> dict[str, Any]:
    return json.loads(sys.stdin.read())


def duty_key(duty: dict[str, Any]) -> str:
    """De sleutel van een dienstinstantie.

    Een dienstnummer alleen is niet uniek: 101 op maandag en 101 op dinsdag zijn
    twee instanties die allebei gereden moeten worden. De weekdag hoort er dus
    bij, en de standplaats en dienstregeling zitten al in de opdracht zelf.
    """
    return f"{duty['code']}|{duty['weekday']}"


def solve(request: dict[str, Any]) -> dict[str, Any]:
    """Los het vraagstuk op, en leg uit waarom het niet kan als het niet kan.

    Eerst met volledige dekking als harde eis: elke dienstdag die te vullen is,
    krijgt een dienstnummer. Levert dat niets op, dan bestaat er geen compleet
    rooster en wordt hetzelfde vraagstuk nog één keer opgelost met de dekking
    als kostenpost. Die tweede uitkomst wordt niet aangeboden als rooster — de
    aanroeper weigert hem verderop alsnog — maar hij laat wél zien wélke
    dienstdagen leeg blijven, en dat is het verschil tussen "er bestaat geen
    rooster" en "deze vijf dagen krijgen geen dienstnummer".
    """
    antwoord = solve_once(request, require_full_coverage=True)
    if antwoord["status"] in ("OPTIMAL", "FEASIBLE"):
        return antwoord

    toelichting = solve_once(request, require_full_coverage=False)
    if toelichting["status"] in ("OPTIMAL", "FEASIBLE"):
        return toelichting
    return antwoord


def solve_once(request: dict[str, Any], require_full_coverage: bool) -> dict[str, Any]:
    lines: list[dict[str, Any]] = request["lines"]
    duties: list[dict[str, Any]] = request["duties"]
    options: dict[str, Any] = request.get("options", {})

    min_rest = int(options.get("minRestMinutes", 0))
    max_consecutive = int(options.get("maxConsecutiveDuties", 0))
    weights: dict[str, float] = options.get("weights", {})
    time_limit = float(options.get("timeLimitSeconds", 20))
    seed = int(options.get("seed", 0))
    keep_existing = bool(options.get("keepExisting", False))

    model = cp_model.CpModel()

    # ── Variabelen ───────────────────────────────────────────────────────────
    # x[(slot_index, duty_index)] = 1 wanneer deze dienstinstantie op dit slot
    # komt. Slots zijn de dienstdagen van de roosterlijnen; ankerdagen (rust,
    # reserve, WTV, compensatie) zitten er niet in en kunnen dus per constructie
    # niet worden overschreven.
    slots: list[dict[str, Any]] = []
    for line_index, line in enumerate(lines):
        for day in line["days"]:
            if day["assignable"]:
                slots.append(
                    {
                        "lineIndex": line_index,
                        "weekIndex": day["weekIndex"],
                        "weekday": day["weekday"],
                        "current": day.get("dutyCode"),
                        "profile": line["profile"],
                        "allowedKinds": line["allowedKinds"],
                        "cycleDay": (day["weekIndex"] - 1) * 7 + (day["weekday"] - 1),
                    }
                )

    x: dict[tuple[int, int], cp_model.IntVar] = {}
    allowed_for_slot: dict[int, list[int]] = {s: [] for s in range(len(slots))}
    slots_for_duty: dict[int, list[int]] = {d: [] for d in range(len(duties))}

    for s, slot in enumerate(slots):
        for d, duty in enumerate(duties):
            # Weekdag moet kloppen: een maandagdienst hoort niet op dinsdag,
            # ook niet wanneer het dienstnummer toevallig past.
            if duty["weekday"] != slot["weekday"]:
                continue
            # Profielgrens: harde eis, geen kostenpost.
            if not set(duty["timeOfDayKinds"]).issubset(set(slot["allowedKinds"])):
                continue
            var = model.NewBoolVar(f"x_{s}_{d}")
            x[(s, d)] = var
            allowed_for_slot[s].append(d)
            slots_for_duty[d].append(s)

    # ── Harde constraints ────────────────────────────────────────────────────
    # 1. Precies één dienst per slot dat te vullen is.
    #
    #    Dit was "hooguit één", met dekking als kostenpost in de doelfunctie.
    #    Daardoor kon de oplosser een dienstdag leeg laten omdat dat elders meer
    #    punten opleverde: bij scenario C weegt eerlijke verdeling 70 per
    #    lastensoort en dekking 90 per dienst, dus vier lastensoorten tegelijk
    #    gladstrijken was 280 waard tegen 90 kosten. De uitkomst werd daarna
    #    alsnog geweigerd, want een dienstdag zonder dienstnummer is geen
    #    rooster. Die weigering staat er nog steeds en is niet verzacht; wat
    #    verandert is dat de oplosser de eis nu kent in plaats van hem achteraf
    #    te ontdekken. Dekking is geen voorkeur die je kunt afkopen.
    #
    #    Een slot waar geen enkele dienst in past, blijft ongemoeid: dat is een
    #    structureel gat dat de weigering hierna bij naam noemt. Het hard
    #    afdwingen zou het model onoplosbaar maken en juist die uitleg wissen.
    for s in range(len(slots)):
        if allowed_for_slot[s]:
            bezetting = sum(x[(s, d)] for d in allowed_for_slot[s])
            if require_full_coverage:
                model.Add(bezetting == 1)
            else:
                model.Add(bezetting <= 1)

    # 2. Een dienstinstantie wordt hooguit één keer gebruikt. Wat overblijft,
    #    gaat naar de operationele voorraad; dat is geen fout maar een uitkomst.
    for d in range(len(duties)):
        if slots_for_duty[d]:
            model.Add(sum(x[(s, d)] for s in slots_for_duty[d]) <= 1)

    # 3. Rust tussen twee opeenvolgende dienstdagen binnen dezelfde lijn.
    #    De cyclus is rond: de laatste dag grenst aan de eerste.
    if min_rest > 0:
        for line_index, line in enumerate(lines):
            cycle_days = line["cycleWeeks"] * 7
            line_slots = {
                slot["cycleDay"]: s
                for s, slot in enumerate(slots)
                if slot["lineIndex"] == line_index
            }
            for cycle_day, s in line_slots.items():
                next_day = (cycle_day + 1) % cycle_days
                t = line_slots.get(next_day)
                if t is None:
                    continue
                for d1 in allowed_for_slot[s]:
                    end = duties[d1]["endMinute"]
                    for d2 in allowed_for_slot[t]:
                        start = duties[d2]["startMinute"] + MINUTES_PER_DAY
                        if start - end < min_rest:
                            # Deze twee kunnen niet allebei; dat is een harde
                            # uitsluiting en geen strafpunt.
                            model.Add(x[(s, d1)] + x[(t, d2)] <= 1)

    # 4. Maximum aantal aaneengesloten dienstdagen.
    if max_consecutive > 0:
        for line_index, line in enumerate(lines):
            cycle_days = line["cycleWeeks"] * 7
            per_day: dict[int, cp_model.IntVar | int] = {}
            for cycle_day in range(cycle_days):
                s = next(
                    (
                        i
                        for i, slot in enumerate(slots)
                        if slot["lineIndex"] == line_index and slot["cycleDay"] == cycle_day
                    ),
                    None,
                )
                if s is None:
                    per_day[cycle_day] = 0
                elif allowed_for_slot[s]:
                    per_day[cycle_day] = sum(x[(s, d)] for d in allowed_for_slot[s])
                else:
                    per_day[cycle_day] = 0
            window = max_consecutive + 1
            if window <= cycle_days:
                for start_day in range(cycle_days):
                    reeks = [per_day[(start_day + k) % cycle_days] for k in range(window)]
                    model.Add(sum(reeks) <= max_consecutive)

    # ── Zachte doelen ────────────────────────────────────────────────────────
    # Alles hieronder is kostenpost, nooit toestemming. Een harde constraint
    # staat hierboven en kan niet met kosten worden afgekocht.
    objective_terms: list[Any] = []

    # a. Zoveel mogelijk diensten plaatsen. Ongeplaatst is toegestaan, maar niet
    #    gratis: wat niet in een vast rooster past, belast de dienstindeling.
    plaatsing_gewicht = int(round(weights.get("coverage", 100)))
    for d in range(len(duties)):
        if slots_for_duty[d]:
            objective_terms.append(
                plaatsing_gewicht * sum(x[(s, d)] for s in slots_for_duty[d])
            )

    # b. Minimale verandering: het huidige dienstnummer op zijn plek houden.
    if keep_existing:
        behoud_gewicht = int(round(weights.get("keepExisting", 40)))
        for s, slot in enumerate(slots):
            if not slot["current"]:
                continue
            for d in allowed_for_slot[s]:
                if duties[d]["code"] == slot["current"]:
                    objective_terms.append(behoud_gewicht * x[(s, d)])

    # c. Eerlijke verdeling van zware diensten binnen hetzelfde profiel.
    #    Vergelijken tussen profielen zou een Vroeg-rooster straffen omdat het
    #    geen nachten heeft; dat is geen oneerlijkheid maar een profiel.
    spreiding_gewicht = int(round(weights.get("fairness", 30)))
    for burden_key, burden_field in (
        ("night", "isNight"),
        ("shunting", "isShunting"),
        ("weekend", "isWeekend"),
        ("long", "isLong"),
    ):
        per_profile: dict[str, list[int]] = {}
        for line_index, line in enumerate(lines):
            per_profile.setdefault(line["profile"], []).append(line_index)

        for profile, line_indexes in per_profile.items():
            if len(line_indexes) < 2:
                continue
            tellers = []
            for line_index in line_indexes:
                termen = [
                    x[(s, d)]
                    for s, slot in enumerate(slots)
                    if slot["lineIndex"] == line_index
                    for d in allowed_for_slot[s]
                    if duties[d][burden_field]
                ]
                teller = model.NewIntVar(0, len(slots), f"{burden_key}_{profile}_{line_index}")
                model.Add(teller == (sum(termen) if termen else 0))
                tellers.append(teller)

            hoogste = model.NewIntVar(0, len(slots), f"max_{burden_key}_{profile}")
            laagste = model.NewIntVar(0, len(slots), f"min_{burden_key}_{profile}")
            model.AddMaxEquality(hoogste, tellers)
            model.AddMinEquality(laagste, tellers)
            verschil = model.NewIntVar(0, len(slots), f"spread_{burden_key}_{profile}")
            model.Add(verschil == hoogste - laagste)
            objective_terms.append(-spreiding_gewicht * verschil)

    # d. Draairichting: liever een latere start dan de vorige dienstdag.
    rotatie_gewicht = int(round(weights.get("rotation", 10)))
    if rotatie_gewicht > 0:
        for line_index, line in enumerate(lines):
            cycle_days = line["cycleWeeks"] * 7
            line_slots = {
                slot["cycleDay"]: s
                for s, slot in enumerate(slots)
                if slot["lineIndex"] == line_index
            }
            for cycle_day, s in line_slots.items():
                t = line_slots.get((cycle_day + 1) % cycle_days)
                if t is None:
                    continue
                for d1 in allowed_for_slot[s]:
                    for d2 in allowed_for_slot[t]:
                        terug = duties[d1]["startMinute"] - duties[d2]["startMinute"]
                        if terug > 240:
                            paar = model.NewBoolVar(f"rot_{s}_{d1}_{t}_{d2}")
                            model.AddBoolAnd([x[(s, d1)], x[(t, d2)]]).OnlyEnforceIf(paar)
                            model.AddBoolOr([x[(s, d1)].Not(), x[(t, d2)].Not()]).OnlyEnforceIf(
                                paar.Not()
                            )
                            objective_terms.append(-rotatie_gewicht * paar)

    if objective_terms:
        model.Maximize(sum(objective_terms))

    # ── Oplossen ─────────────────────────────────────────────────────────────
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit
    solver.parameters.random_seed = seed
    # Vaste zaadwaarde én één worker: twee runs met dezelfde invoer horen
    # hetzelfde op te leveren, anders is een scenario niet reproduceerbaar.
    solver.parameters.num_search_workers = 1
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
        "unplacedDuties": [
            duty_key(duty) for d, duty in enumerate(duties) if d not in geplaatst
        ],
        "diagnostics": [],
        "statistics": statistics(solver, model, status_name),
    }


def diagnose(
    lines: list[dict[str, Any]],
    duties: list[dict[str, Any]],
    slots: list[dict[str, Any]],
    allowed_for_slot: dict[int, list[int]],
) -> list[str]:
    """Waar het waarschijnlijk op vastloopt.

    Geen juridische uitspraak en geen zekerheid: een telling die de planner een
    richting geeft. "Geen oplossing" zonder aanknopingspunt is onbruikbaar.
    """
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
            bevindingen.append(
                f"weekdag {weekday}: {aantal} diensten en {beschikbaar} dienstslots"
            )

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


def statistics(
    solver: cp_model.CpSolver, model: cp_model.CpModel, status_name: str
) -> dict[str, Any]:
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
