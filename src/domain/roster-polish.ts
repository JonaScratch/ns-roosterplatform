import type { SwapGuard } from "./operational-requirements";
import type { QualityDuty, QualityRosterInput } from "./roster-quality";
import { profileAllowsDuty } from "./roster-profiles";
import type { DutyKind, RosterProfile } from "@/lib/generated/prisma/enums";

/**
 * Bijschaven met ruildiensten: duizenden alternatieven, één dienst tegelijk.
 *
 * ## Waarom naast CP-SAT
 *
 * De oplosser optimaliseert zijn eigen kostenfunctie, niet de menselijke
 * kwaliteitsmaat. Tussen twee roosters die voor CP-SAT even duur zijn, zit voor
 * een machinist soms een wereld van verschil: een losse nacht die naast een
 * reeks ligt, een zware overgang die met één ruil verdwijnt. Dat verschil is
 * ook precies waarom de gerichte CP-SAT-reparatie in de eerste metingen niets
 * opleverde: die vond zijn eigen optimum al, en daar was niets meer te halen.
 * Deze zoektocht ruilt twee diensten van dezelfde weekdag om en vraagt de
 * evaluator wat hij ervan vindt. Eén beoordeling kost ongeveer twee
 * milliseconden, dus in een halve minuut komen duizenden varianten langs.
 *
 * ## Wat hard blijft
 *
 * De toets hieronder is precies de harde verzameling van het CP-SAT-model:
 * dezelfde weekdag, de dagdelen binnen het profiel van het nieuwe rooster, en
 * de geplande dagelijkse rust bij alle vier de buren. Met een `guard` ook de
 * operationele eisen (vrijdag vóór een vrij weekend, hoogstens 40:00 per
 * rooster), net als in het CP-SAT-model. De rest blijft onder een
 * ruil per definitie gelijk: dekking en dienstgebruik omdat twee diensten van
 * plaats wisselen, het aantal aaneengesloten diensten omdat dienstdagen
 * dienstdagen blijven. Wat hier uit komt gaat daarna alsnog door de
 * onafhankelijke eindvalidatie — deze zoektocht mag niets goedkeuren.
 *
 * ## Waarom het niet bij één beklimming blijft
 *
 * Een steilste beklimming loopt vast in het eerste lokale optimum. Daarna
 * schopt deze zoektocht het rooster bewust een paar ruilen uit dat optimum en
 * klimt opnieuw; blijkt de nieuwe top lager, dan wordt de beste stand
 * teruggezet. Dat is herhaald lokaal zoeken, met een gezaaide toevalsgenerator
 * zodat dezelfde start dezelfde weg aflegt.
 */

export interface PolishSlot {
  readonly roster: string;
  readonly lineNumber: number;
  readonly weekIndex: number;
  readonly weekday: number;
  readonly profile: string;
  /** Positie in de cyclus van dit rooster, in rotatievolgorde. */
  readonly position: number;
}

export interface PolishMove {
  readonly a: string;
  readonly b: string;
  readonly dutyA: string;
  readonly dutyB: string;
  readonly gain: number;
  readonly score: number;
}

export interface PolishResult {
  /** De beste stand die is gevonden, in dezelfde vorm als de invoer. */
  readonly rosters: readonly QualityRosterInput[];
  readonly score: number;
  readonly startScore: number;
  readonly moves: readonly PolishMove[];
  /** Hoeveel volledige alternatieven zijn beoordeeld. */
  readonly evaluated: number;
  readonly climbs: number;
  readonly kicks: number;
  readonly stopReason: string;
}

const sleutelVan = (slot: { roster: string; lineNumber: number; weekIndex: number; weekday: number }) =>
  `${slot.roster}|${slot.lineNumber}|${slot.weekIndex}|${slot.weekday}`;

/** Kleine gezaaide generator: dezelfde zaadwaarde geeft dezelfde reeks. */
function toevalsGenerator(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Ruil diensten van dezelfde weekdag zolang de kwaliteit stijgt.
 *
 * `score` krijgt de roosters in dezelfde vorm terug als ze binnenkwamen; de
 * aanroeper bepaalt daarmee wat "beter" is — de rangschikking van het
 * zoekproces, of een op het zwakke punt gekantelde variant daarvan.
 */
export function polishBySwaps(input: {
  readonly rosters: readonly QualityRosterInput[];
  readonly duties: ReadonlyMap<string, QualityDuty>;
  readonly minRestMinutes: number;
  readonly score: (rosters: readonly QualityRosterInput[]) => number;
  readonly deadline: number;
  readonly seed?: number;
  /** Hoeveel ruilen een schop uit het lokale optimum groot is. */
  readonly kickSize?: number;
  /**
   * Hoogstens zoveel keer schoppen. Standaard onbeperkt: dan bepaalt de tijd
   * hoe vaak er wordt geschopt. Een test die op een vast aantal moet kunnen
   * rekenen, zet dit; anders hangt de uitkomst af van hoe druk de machine is.
   */
  readonly maxKicks?: number;
  readonly maxClimbSteps?: number;
  readonly minGain?: number;
  readonly signal?: { readonly aborted: boolean };
  /** Operationele eisen die een ruil niet mag breken (vrijdag, 40:00). */
  readonly guard?: SwapGuard;
}): PolishResult {
  const minGain = input.minGain ?? 0.01;
  const maxClimbSteps = input.maxClimbSteps ?? 40;
  const kickSize = input.kickSize ?? 4;
  const random = toevalsGenerator(input.seed ?? 1);

  // Werkkopie: per dienstdag het dienstnummer, plus de cyclusvolgorde per rooster.
  const dienstVan = new Map<string, string>();
  const slots: PolishSlot[] = [];
  const cycli = new Map<string, (PolishSlot | null)[]>();
  for (const rooster of input.rosters) {
    const gesorteerd = [...rooster.days].sort(
      (a, b) => a.lineNumber - b.lineNumber || a.weekIndex - b.weekIndex || a.weekday - b.weekday,
    );
    const cyclus: (PolishSlot | null)[] = [];
    for (const dag of gesorteerd) {
      if (dag.positionType === "DUTY" && dag.dutyCode) {
        const slot: PolishSlot = {
          roster: rooster.code,
          lineNumber: dag.lineNumber,
          weekIndex: dag.weekIndex,
          weekday: dag.weekday,
          profile: rooster.profile,
          position: cyclus.length,
        };
        slots.push(slot);
        cyclus.push(slot);
        dienstVan.set(sleutelVan(slot), dag.dutyCode);
      } else {
        cyclus.push(null);
      }
    }
    cycli.set(rooster.code, cyclus);
  }

  const dienst = (code: string, weekday: number) => input.duties.get(`${code}|${weekday}`);
  const bouw = (): QualityRosterInput[] =>
    input.rosters.map((rooster) => ({
      ...rooster,
      days: rooster.days.map((dag) =>
        dag.positionType === "DUTY" && dag.dutyCode
          ? { ...dag, dutyCode: dienstVan.get(sleutelVan({ ...dag, roster: rooster.code })) ?? dag.dutyCode }
          : dag,
      ),
    }));

  const buren = (slot: PolishSlot) => {
    const cyclus = cycli.get(slot.roster)!;
    const n = cyclus.length;
    return {
      vorige: cyclus[(slot.position - 1 + n) % n],
      volgende: cyclus[(slot.position + 1) % n],
    };
  };

  /** De geplande dagelijkse rust tussen twee naast elkaar liggende dienstdagen. */
  const rustOk = (links: PolishSlot | null, rechts: PolishSlot | null): boolean => {
    if (!links || !rechts) return true;
    const a = dienst(dienstVan.get(sleutelVan(links))!, links.weekday);
    const b = dienst(dienstVan.get(sleutelVan(rechts))!, rechts.weekday);
    if (!a || !b) return true;
    return 1440 + b.startMinute - a.endMinute >= input.minRestMinutes;
  };

  const past = (slot: PolishSlot, code: string): boolean => {
    const d = dienst(code, slot.weekday);
    return d !== undefined && profileAllowsDuty(slot.profile as RosterProfile, d.kinds as DutyKind[]);
  };

  const duur = (code: string, weekday: number) => {
    const d = dienst(code, weekday);
    return d ? d.endMinute - d.startMinute : 0;
  };
  /** Roostercredit per rooster, bijgehouden bij elke ruil (alleen met een bewaker). */
  const credit = new Map<string, number>();
  const herbereken = () => {
    if (!input.guard) return;
    credit.clear();
    for (const rooster of input.rosters) credit.set(rooster.code, input.guard.fixedCreditMinutes(rooster.code));
    for (const slot of slots) {
      credit.set(slot.roster, (credit.get(slot.roster) ?? 0) + duur(dienstVan.get(sleutelVan(slot))!, slot.weekday));
    }
  };
  herbereken();

  const wissel = (a: PolishSlot, b: PolishSlot) => {
    const codeA = dienstVan.get(sleutelVan(a))!;
    const codeB = dienstVan.get(sleutelVan(b))!;
    dienstVan.set(sleutelVan(a), codeB);
    dienstVan.set(sleutelVan(b), codeA);
    if (input.guard && a.roster !== b.roster) {
      const verschil = duur(codeB, a.weekday) - duur(codeA, b.weekday);
      credit.set(a.roster, (credit.get(a.roster) ?? 0) + verschil);
      credit.set(b.roster, (credit.get(b.roster) ?? 0) - verschil);
    }
  };

  /** Houdt de ruil de operationele eisen heel? Vóór het omwisselen gevraagd. */
  const operationeelOk = (a: PolishSlot, codeA: string, b: PolishSlot, codeB: string): boolean => {
    const guard = input.guard;
    if (!guard) return true;
    const nieuwA = dienst(codeB, a.weekday);
    const nieuwB = dienst(codeA, b.weekday);
    if (!nieuwA || !nieuwB) return false;
    if (!guard.slotAllows(a, nieuwA) || !guard.slotAllows(b, nieuwB)) return false;
    if (a.roster === b.roster) return true;
    const verschil = duur(codeB, a.weekday) - duur(codeA, b.weekday);
    const maxA = guard.maxTotalMinutes(a.roster);
    const maxB = guard.maxTotalMinutes(b.roster);
    if (maxA !== null && verschil > 0 && (credit.get(a.roster) ?? 0) + verschil > maxA) return false;
    if (maxB !== null && verschil < 0 && (credit.get(b.roster) ?? 0) - verschil > maxB) return false;
    return true;
  };

  /** Mag deze ruil van het model? Profiel vooraf, rust na het omwisselen. */
  const toegestaan = (a: PolishSlot, b: PolishSlot): boolean => {
    const codeA = dienstVan.get(sleutelVan(a))!;
    const codeB = dienstVan.get(sleutelVan(b))!;
    if (codeA === codeB) return false;
    if (!past(a, codeB) || !past(b, codeA)) return false;
    if (!operationeelOk(a, codeA, b, codeB)) return false;
    wissel(a, b);
    const buurA = buren(a);
    const buurB = buren(b);
    const ok =
      rustOk(buurA.vorige, a) &&
      rustOk(a, buurA.volgende) &&
      rustOk(buurB.vorige, b) &&
      rustOk(b, buurB.volgende);
    wissel(a, b);
    return ok;
  };

  const perWeekdag = new Map<number, PolishSlot[]>();
  for (const slot of slots) {
    perWeekdag.set(slot.weekday, [...(perWeekdag.get(slot.weekday) ?? []), slot]);
  }
  const groepen = [...perWeekdag.values()];

  let huidig = input.score(bouw());
  const startScore = huidig;
  let besteScore = huidig;
  let besteStand = new Map(dienstVan);
  let besteMoves: PolishMove[] = [];
  const moves: PolishMove[] = [];
  let beoordeeld = 0;
  let beklimmingen = 0;
  let schoppen = 0;
  let reden = "geen ruil verbetert het rooster nog";
  let gestopt = false;

  const tijdOp = (): boolean => {
    if (input.signal?.aborted) {
      reden = "op verzoek gestopt";
      gestopt = true;
      return true;
    }
    if (Date.now() > input.deadline) {
      reden = "tijd op";
      gestopt = true;
      return true;
    }
    return false;
  };

  /** Eén steilste beklimming tot geen enkele ruil meer wint. */
  const beklim = () => {
    for (let stap = 0; stap < maxClimbSteps; stap += 1) {
      let beste: { a: PolishSlot; b: PolishSlot; score: number } | null = null;
      for (const groep of groepen) {
        for (let i = 0; i < groep.length; i += 1) {
          for (let j = i + 1; j < groep.length; j += 1) {
            if (tijdOp()) return;
            const a = groep[i];
            const b = groep[j];
            if (!toegestaan(a, b)) continue;
            wissel(a, b);
            const score = input.score(bouw());
            beoordeeld += 1;
            wissel(a, b);
            if (score > huidig + minGain && (!beste || score > beste.score)) {
              beste = { a, b, score };
            }
          }
        }
      }
      if (!beste) return;
      const codeA = dienstVan.get(sleutelVan(beste.a))!;
      const codeB = dienstVan.get(sleutelVan(beste.b))!;
      wissel(beste.a, beste.b);
      moves.push({
        a: sleutelVan(beste.a),
        b: sleutelVan(beste.b),
        dutyA: codeA,
        dutyB: codeB,
        gain: Math.round((beste.score - huidig) * 1000) / 1000,
        score: Math.round(beste.score * 1000) / 1000,
      });
      huidig = beste.score;
    }
    reden = `maximum van ${maxClimbSteps} stappen bereikt`;
  };

  /** Een paar willekeurige toegestane ruilen: uit het lokale optimum stappen. */
  const schop = () => {
    let gedaan = 0;
    for (let poging = 0; poging < kickSize * 40 && gedaan < kickSize; poging += 1) {
      const groep = groepen[Math.floor(random() * groepen.length)];
      if (groep.length < 2) continue;
      const a = groep[Math.floor(random() * groep.length)];
      const b = groep[Math.floor(random() * groep.length)];
      if (a === b || !toegestaan(a, b)) continue;
      wissel(a, b);
      gedaan += 1;
    }
    return gedaan;
  };

  while (!gestopt) {
    beklimmingen += 1;
    beklim();
    if (huidig > besteScore) {
      besteScore = huidig;
      besteStand = new Map(dienstVan);
      besteMoves = [...moves];
    }
    if (input.maxKicks !== undefined && schoppen >= input.maxKicks) {
      reden = `maximum van ${input.maxKicks} schoppen bereikt`;
      break;
    }
    if (gestopt || tijdOp()) break;
    // Terug naar de beste stand en dan schoppen: zwerven vanaf een slechtere
    // top levert zelden iets op.
    dienstVan.clear();
    for (const [sleutel, code] of besteStand) dienstVan.set(sleutel, code);
    herbereken();
    if (schop() === 0) {
      reden = "geen toegestane ruil meer om mee te schoppen";
      break;
    }
    schoppen += 1;
    huidig = input.score(bouw());
    beoordeeld += 1;
  }

  dienstVan.clear();
  for (const [sleutel, code] of besteStand) dienstVan.set(sleutel, code);
  return {
    rosters: bouw(),
    score: besteScore,
    startScore,
    moves: besteMoves,
    evaluated: beoordeeld,
    climbs: beklimmingen,
    kicks: schoppen,
    stopReason: reden,
  };
}
