import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type DutyClass, dutyClass, nightWindowExposure } from "@/domain/duty-class";
import { flowDays, nightBlocksFlow } from "@/domain/roster-flow";
import { rosterHours } from "@/domain/roster-hours";
import { allowedKindsForProfile } from "@/domain/roster-profiles";
import { type QualityRosterInput, dutyKey } from "@/domain/roster-quality";
import { affinityMetrics } from "@/domain/profile-affinity";
import { checkOperationalRequirements } from "@/domain/operational-requirements";
import type { RosterPositionType, RosterProfile } from "@/lib/generated/prisma/enums";
import { prisma } from "@/server/data/prisma";
import { type EvaluationContext, loadEvaluationContextCore } from "@/server/services/quality-evaluation-service";
import { candidateRosterInputs } from "@/server/services/roster-quality-service";
import { decodeAssignments, readRuns } from "../benchmark/io";

/**
 * Machinistenvoorkeur, eerst alleen meten (vervolgopdracht, stap 1–4).
 *
 * ## Wat hier wordt gemeten, per basisrooster
 *
 * - Dienstklassen op de klok: extreem vroeg, gematigd vroeg, daglijk vroeg,
 *   vroege late, late, echte afloper, nacht (`duty-class.ts`), en "dagdiensten"
 *   (daglijk vroeg plus vroege late: overdag begonnen en overdag klaar).
 * - Rangeerdiensten, per rooster en per regel.
 * - Blootstelling als proxy voor toeslagen: minuten in het CAO-nachtvenster
 *   00:00–06:00 en minuten op zaterdag en zondag. GEEN toeslag: er staan geen
 *   ORT-regels in het platform, en voor een vroege of late band is geen bron.
 * - Vrije weekenden: zaterdag én zondag zonder dienst en zonder reserve. Per
 *   weekend de status van beide dagen, het einde van de laatste dienst ervoor,
 *   het begin van de eerste erna en de aaneengesloten rust. Getoetst aan de
 *   door de gebruiker aangeleverde eis (USER_PROVIDED_OPERATIONAL_DESIGN_REQUIREMENT):
 *   RUST + RUST, en de vrijdagdienst vóór 24:00 klaar.
 * - Werk- en rustreeksen: aaneengesloten dagen met dienst of reserve, en
 *   aaneengesloten vrije dagen (RUST, WR, CO).
 * - Roosteruren: de gemiddelde weekomvang volgens de bestaande platformsemantiek
 *   (`rosterHours`: dienstlengte plus 8:00 per RES, WR en CO; naar beneden
 *   afgerond zoals de roosterbladen), getoetst aan ≤ 40:00 (idem gebruikerseis),
 *   met het exacte totaal ernaast.
 *
 * ## Welke roosters
 *
 * De zeven menselijke roosters, v1.0.4 en de Final-Brain-AFTER (de baseline van
 * deze ronde). Niets wordt veranderd; dit is meten.
 *
 *   npm run machinist:measure
 */

const WORTEL = path.resolve(__dirname, "..", "..");
const MAP = path.join(WORTEL, "docs", "v1.0.4-final-brain", "machinist-preferences");
const KLASSEN: readonly DutyClass[] = ["EXTREME_EARLY", "EARLY", "DAYLIKE_EARLY", "EARLY_LATE", "LATE", "PREMIUM_LATE", "NIGHT"];
const VRIJ = new Set(["RUST", "WR", "CO"]);
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

interface RoosterMeting {
  readonly code: string;
  readonly profile: string;
  readonly lines: number;
  readonly classes: Record<string, number>;
  readonly dayDuties: number;
  readonly rangeer: number;
  readonly rangeerPerLine: number[];
  readonly nightWindowMinutesPerWeek: number;
  readonly weekendMinutesPerWeek: number;
  readonly averageWeeklyMinutes: number;
  readonly exactTotalMinusTarget: number;
  readonly hoursGate: boolean;
  readonly weekends: { line: number; saturday: string; sunday: string; fridayEnd: string | null; fridayEndMinute: number | null; mondayStart: string | null; restHours: number | null; rr: boolean; fridayBeforeMidnight: boolean }[];
  readonly workStreaks: Record<string, number>;
  readonly restStreaks: Record<string, number>;
  readonly affinityMean: number | null;
  readonly nightBlocks: Record<string, number>;
}

function meetRooster(r: QualityRosterInput, context: EvaluationContext): RoosterMeting {
  const dagen = [...r.days].sort((a, b) => a.lineNumber - b.lineNumber || a.weekIndex - b.weekIndex || a.weekday - b.weekday);
  const regels = new Set(dagen.map((d) => d.lineNumber)).size;
  const weken = new Set(dagen.map((d) => `${d.lineNumber}|${d.weekIndex}`)).size;
  const dienst = (d: (typeof dagen)[number]) => (d.positionType === "DUTY" && d.dutyCode ? (context.quality.duties.get(dutyKey(d.dutyCode, d.weekday)) ?? null) : null);
  const klassen: Record<string, number> = {};
  const rangeerPerRegel = new Map<number, number>();
  let dag = 0;
  let nacht = 0;
  let weekend = 0;
  for (const d of dagen) {
    const x = dienst(d);
    if (!x) continue;
    const k = dutyClass(x);
    klassen[k] = (klassen[k] ?? 0) + 1;
    if (k === "DAYLIKE_EARLY" || k === "EARLY_LATE") dag += 1;
    if (x.kinds.includes("RANGEER")) rangeerPerRegel.set(d.lineNumber, (rangeerPerRegel.get(d.lineNumber) ?? 0) + 1);
    nacht += nightWindowExposure(x);
    if (d.weekday >= 6) weekend += x.endMinute - x.startMinute;
  }
  // Uren volgens de platformsemantiek.
  const uren = rosterHours({
    days: dagen.map((d) => {
      const x = dienst(d);
      return { positionType: d.positionType as RosterPositionType, startMinute: x?.startMinute ?? null, endMinute: x?.endMinute ?? null };
    }),
    lineCount: regels,
    weeksPerLine: r.weeksPerLine,
  });
  // Vrije weekenden: zaterdag en zondag zonder dienst en zonder reserve.
  const n = dagen.length;
  const weekenden: RoosterMeting["weekends"] = [];
  for (let i = 0; i < n; i += 1) {
    const za = dagen[i];
    const zo = dagen[(i + 1) % n];
    if (za.weekday !== 6 || zo.weekday !== 7) continue;
    if (!VRIJ.has(za.positionType) || !VRIJ.has(zo.positionType)) continue;
    const vr = dagen[(i - 1 + n) % n];
    const vrDienst = dienst(vr);
    let j = (i + 2) % n;
    let tussen = 2;
    while (tussen < n && !dienst(dagen[j]) && dagen[j].positionType !== "RES") {
      j = (j + 1) % n;
      tussen += 1;
    }
    const volgende = dienst(dagen[j]);
    const rustUren = vrDienst && volgende ? (tussen * 1440 + volgende.startMinute - vrDienst.endMinute) / 60 : null;
    weekenden.push({
      line: za.lineNumber,
      saturday: za.positionType,
      sunday: zo.positionType,
      fridayEnd: vrDienst ? hm(vrDienst.endMinute % 1440) + (vrDienst.endMinute > 1440 ? " (za)" : "") : null,
      fridayEndMinute: vrDienst?.endMinute ?? null,
      mondayStart: volgende ? hm(volgende.startMinute) : null,
      restHours: rustUren === null ? null : Math.round(rustUren * 10) / 10,
      rr: za.positionType === "RUST" && zo.positionType === "RUST",
      fridayBeforeMidnight: !vrDienst || vrDienst.endMinute <= 1440,
    });
  }
  // Werk- en rustreeksen, rond de cyclus.
  const werk = (d: (typeof dagen)[number]) => d.positionType === "DUTY" || d.positionType === "RES";
  const reeksen = (test: (d: (typeof dagen)[number]) => boolean) => {
    const t: Record<string, number> = {};
    const begin = dagen.findIndex((d) => !test(d));
    if (begin < 0) return { [String(n)]: 1 };
    let lengte = 0;
    for (let k = 1; k <= n; k += 1) {
      const d = dagen[(begin + k) % n];
      if (test(d)) lengte += 1;
      else if (lengte > 0) {
        t[String(lengte)] = (t[String(lengte)] ?? 0) + 1;
        lengte = 0;
      }
    }
    if (lengte > 0) t[String(lengte)] = (t[String(lengte)] ?? 0) + 1;
    return t;
  };
  const nachtreeksen: Record<string, number> = {};
  for (const b of nightBlocksFlow(flowDays(r, context.quality.duties))) nachtreeksen[String(b.length)] = (nachtreeksen[String(b.length)] ?? 0) + 1;
  return {
    code: r.code,
    profile: r.profile,
    lines: regels,
    classes: klassen,
    dayDuties: dag,
    rangeer: [...rangeerPerRegel.values()].reduce((a, b) => a + b, 0),
    rangeerPerLine: Array.from({ length: regels }, (_, k) => rangeerPerRegel.get(k + 1) ?? 0),
    nightWindowMinutesPerWeek: Math.round(nacht / weken),
    weekendMinutesPerWeek: Math.round(weekend / weken),
    averageWeeklyMinutes: uren.averageWeeklyCreditMinutes,
    exactTotalMinusTarget: uren.totalCreditMinutes - 2400 * uren.cycleWeeks,
    hoursGate: uren.averageWeeklyCreditMinutes <= 2400,
    weekends: weekenden,
    workStreaks: reeksen(werk),
    restStreaks: reeksen((d) => VRIJ.has(d.positionType)),
    affinityMean: affinityMetrics([r], context.quality.duties).mean,
    nightBlocks: nachtreeksen,
  };
}

function meetPakket(rosters: readonly QualityRosterInput[], context: EvaluationContext) {
  const perRooster = rosters.map((r) => meetRooster(r, context));
  const a = affinityMetrics(rosters, context.quality.duties);
  // Verdeling van populaire diensten over de roosters die ze mogen rijden, per regel.
  const verdeling = (klasse: DutyClass | "RANGEER", soort: "VROEG" | "LAAT") => {
    const mogen = perRooster.filter((x) => allowedKindsForProfile(x.profile as RosterProfile).includes(soort as never));
    const perRegel = mogen.map((x) => ({ code: x.code, perLine: (klasse === "RANGEER" ? x.rangeer : (x.classes[klasse] ?? 0)) / x.lines, total: klasse === "RANGEER" ? x.rangeer : (x.classes[klasse] ?? 0) }));
    const waarden = perRegel.map((x) => x.perLine);
    const gem = waarden.reduce((s, v) => s + v, 0) / (waarden.length || 1);
    const sd = Math.sqrt(waarden.reduce((s, v) => s + (v - gem) ** 2, 0) / (waarden.length || 1));
    const totaal = perRegel.reduce((s, x) => s + x.total, 0);
    return { perRoster: perRegel, cv: gem > 0 ? sd / gem : null, maxShare: totaal ? Math.max(...perRegel.map((x) => x.total)) / totaal : null, zeroRosters: perRegel.filter((x) => x.total === 0).map((x) => x.code) };
  };
  return {
    perRoster: perRooster,
    affinity: { mean: a.mean, worstLine: a.worstLine, rosterSpread: a.rosterSpread, exposureSpread: a.exposureSpread },
    popular: {
      premiumLate: verdeling("PREMIUM_LATE", "LAAT"),
      extremeEarly: verdeling("EXTREME_EARLY", "VROEG"),
      rangeer: { ...verdeling("RANGEER", "VROEG"), note: "rangeerdiensten kunnen vroeg of laat zijn; verdeling over alle roosters met vroeg" },
    },
    weekendsFree: perRooster.reduce((s, r) => s + r.weekends.length, 0),
    weekendsRR: perRooster.reduce((s, r) => s + r.weekends.filter((w) => w.rr).length, 0),
    weekendsFridayBeforeMidnight: perRooster.reduce((s, r) => s + r.weekends.filter((w) => w.fridayBeforeMidnight).length, 0),
    hoursGateRosters: perRooster.filter((r) => r.hoursGate).length,
    // De eisen zoals de zoekmachine ze afdwingt (operational-requirements.ts):
    // vrijdag uiterlijk 23:59, nachtdiensten uitgezonderd (besluit 19-09-2026).
    // "weekendsFridayBeforeMidnight" hierboven is de letterlijke meting van
    // vóór dat besluit (≤ 24:00, ook nachten) en blijft ter vergelijking staan.
    operational: (() => {
      const o = checkOperationalRequirements(rosters, context.quality.duties);
      return {
        violations: o.violations,
        fridayCompliant: o.weekends.filter((w) => w.fridayCompliant).length,
        weekends: o.weekends.length,
        hoursCompliant: o.hours.filter((h) => h.ok).length,
        structuralFindings: o.structuralFindings,
      };
    })(),
  };
}

async function main() {
  mkdirSync(MAP, { recursive: true });
  const context = await loadEvaluationContextCore("DDR");
  const officieel = meetPakket(context.quality.official, context);
  const sets: Record<string, ReturnType<typeof meetPakket>[]> = {};
  // Met `--after <fase>` komt de AFTER van deze ronde als vierde bron in elke CSV.
  const naIndex = process.argv.indexOf("--after");
  const naFase = naIndex >= 0 ? process.argv[naIndex + 1] : null;
  const fasen = ["after", "brain-after", ...(naFase ? [naFase] : [])];
  for (const fase of fasen) {
    sets[fase] = readRuns(fase).filter((r) => r.strategy !== "REPRODUCE").flatMap((r) => r.candidates.map((k) => meetPakket(candidateRosterInputs(decodeAssignments(k.roster), context.quality), context)));
  }
  const gemRooster = (lijst: ReturnType<typeof meetPakket>[], code: string, f: (r: RoosterMeting) => number) => lijst.reduce((s, p) => s + f(p.perRoster.find((r) => r.code === code)!), 0) / lijst.length;
  const codes = officieel.perRoster.map((r) => r.code);

  // CSV's per onderwerp: officieel, v1.0.4, baseline (Final Brain).
  const csv = (bestand: string, kop: string[], rijen: (string | number | null)[][]) =>
    writeFileSync(path.join(MAP, bestand), `${[kop, ...rijen].map((r) => r.map((c) => (c === null ? "" : String(c))).join(",")).join("\n")}\n`);
  const bron = [["officieel", [officieel]], ["v1.0.4", sets.after], ["baseline", sets["brain-after"]], ...(naFase ? [["AFTER", sets[naFase]] as const] : [])] as const;
  csv("early-distribution.csv", ["bron", "rooster", "profiel", "extreem_vroeg", "gematigd_vroeg", "daglijk_vroeg"], bron.flatMap(([naam, lijst]) => codes.map((c) => [naam, c, officieel.perRoster.find((r) => r.code === c)!.profile, ...["EXTREME_EARLY", "EARLY", "DAYLIKE_EARLY"].map((k) => Number(gemRooster(lijst as ReturnType<typeof meetPakket>[], c, (r) => r.classes[k] ?? 0).toFixed(2)))])));
  csv("late-distribution.csv", ["bron", "rooster", "profiel", "vroege_late", "late", "echte_afloper", "nacht"], bron.flatMap(([naam, lijst]) => codes.map((c) => [naam, c, officieel.perRoster.find((r) => r.code === c)!.profile, ...["EARLY_LATE", "LATE", "PREMIUM_LATE", "NIGHT"].map((k) => Number(gemRooster(lijst as ReturnType<typeof meetPakket>[], c, (r) => r.classes[k] ?? 0).toFixed(2)))])));
  csv("rangeer-distribution.csv", ["bron", "rooster", "profiel", "rangeer", "rangeer_per_regel"], bron.flatMap(([naam, lijst]) => codes.map((c) => [naam, c, officieel.perRoster.find((r) => r.code === c)!.profile, Number(gemRooster(lijst as ReturnType<typeof meetPakket>[], c, (r) => r.rangeer).toFixed(2)), Number(gemRooster(lijst as ReturnType<typeof meetPakket>[], c, (r) => r.rangeer / r.lines).toFixed(3))])));
  csv("roster-average-hours.csv", ["bron", "rooster", "gemiddelde_week_min", "gemiddelde_week", "exact_totaal_min_boven_40", "voldoet_aan_max_40"], [
    ...officieel.perRoster.map((r) => ["officieel", r.code, r.averageWeeklyMinutes, hm(r.averageWeeklyMinutes), r.exactTotalMinusTarget, r.hoursGate ? "ja" : "nee"]),
    ...fasen.flatMap((fase) => codes.map((c) => {
      const lijst = sets[fase];
      const boven = lijst.filter((p) => !p.perRoster.find((r) => r.code === c)!.hoursGate).length;
      return [fase === "after" ? "v1.0.4" : fase === "brain-after" ? "baseline" : "AFTER", c, Number(gemRooster(lijst, c, (r) => r.averageWeeklyMinutes).toFixed(1)), "", Number(gemRooster(lijst, c, (r) => r.exactTotalMinusTarget).toFixed(0)), `${lijst.length - boven}/${lijst.length}`];
    })),
  ]);
  csv("weekend-quality.csv", ["rooster", "regel", "zaterdag", "zondag", "vrijdag_eind", "maandag_begin", "aaneengesloten_rust_u", "rust_rust", "vrijdag_voor_24u"], officieel.perRoster.flatMap((r) => r.weekends.map((w) => [r.code, w.line, w.saturday, w.sunday, w.fridayEnd, w.mondayStart, w.restHours, w.rr ? "ja" : "nee", w.fridayBeforeMidnight ? "ja" : "nee"])));
  csv("workblock-distribution.csv", ["bron", "rooster", "soort", "lengte", "aantal"], [
    ...officieel.perRoster.flatMap((r) => [...Object.entries(r.workStreaks).map(([l, a]) => ["officieel", r.code, "werk", l, a]), ...Object.entries(r.restStreaks).map(([l, a]) => ["officieel", r.code, "rust", l, a])]),
  ]);

  const samenvatting = (lijst: ReturnType<typeof meetPakket>[]) => ({
    candidates: lijst.length,
    affinityMean: lijst.reduce((s, p) => s + (p.affinity.mean ?? 0), 0) / lijst.length,
    affinityWorstLine: lijst.reduce((s, p) => s + (p.affinity.worstLine?.mean ?? 0), 0) / lijst.length,
    preferenceSpread: lijst.reduce((s, p) => s + (p.affinity.rosterSpread ?? 0), 0) / lijst.length,
    exposureSpread: lijst.reduce((s, p) => s + (p.affinity.exposureSpread ?? 0), 0) / lijst.length,
    premiumLateMaxShare: lijst.reduce((s, p) => s + (p.popular.premiumLate.maxShare ?? 0), 0) / lijst.length,
    premiumLateCv: lijst.reduce((s, p) => s + (p.popular.premiumLate.cv ?? 0), 0) / lijst.length,
    extremeEarlyMaxShare: lijst.reduce((s, p) => s + (p.popular.extremeEarly.maxShare ?? 0), 0) / lijst.length,
    rangeerCv: lijst.reduce((s, p) => s + (p.popular.rangeer.cv ?? 0), 0) / lijst.length,
    rangeerMaxShare: lijst.reduce((s, p) => s + (p.popular.rangeer.maxShare ?? 0), 0) / lijst.length,
    weekendFridayCompliance: lijst.reduce((s, p) => s + p.weekendsFridayBeforeMidnight / (p.weekendsFree || 1), 0) / lijst.length,
    hoursGateAllRosters: lijst.filter((p) => p.hoursGateRosters === p.perRoster.length).length,
    operationalCompliantPackages: lijst.filter((p) => p.operational.violations.length === 0).length,
    fridayRuleCompliance: lijst.reduce((s, p) => s + p.operational.fridayCompliant / (p.operational.weekends || 1), 0) / lijst.length,
  });
  const uit = {
    schema: "ns-machinist-preferences-measure/1",
    measuredAt: new Date().toISOString(),
    sourceStatus: {
      affinityDirection: "MACHINIST_PREFERENCE (werkopdracht), voor 50+ Mix het menselijke rooster",
      weekendRR: "USER_PROVIDED_OPERATIONAL_DESIGN_REQUIREMENT",
      fridayBeforeMidnight: "USER_PROVIDED_OPERATIONAL_DESIGN_REQUIREMENT",
      hoursMax40: "USER_PROVIDED_OPERATIONAL_DESIGN_REQUIREMENT",
      exposure: "PROXY: CAO-nachtvenster 00:00–06:00 en weekendminuten; geen ORT",
    },
    official: officieel,
    summary: { official: samenvatting([officieel]), v104: samenvatting(sets.after), baseline: samenvatting(sets["brain-after"]), ...(naFase ? { after: samenvatting(sets[naFase]) } : {}) },
  };
  writeFileSync(path.join(MAP, naFase ? "measure-after.json" : "measure-before.json"), `${JSON.stringify(uit, null, 2)}\n`);
  for (const [naam, s] of Object.entries(uit.summary)) console.log(naam.padEnd(9), JSON.stringify(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, typeof v === "number" ? Number(v.toFixed(3)) : v]))));
  const oo = officieel.operational;
  console.log(`
Officieel volgens de eisen: ${oo.violations.length} overtreding(en), vrijdag ${oo.fridayCompliant}/${oo.weekends}, uren ${oo.hoursCompliant}/7${oo.violations.length ? " — " + oo.violations.join("; ") : ""}`);
  console.log(`\nOfficieel: vrije weekenden ${officieel.weekendsFree}, daarvan RUST+RUST ${officieel.weekendsRR}, vrijdag vóór 24:00 ${officieel.weekendsFridayBeforeMidnight}; roosters ≤ 40:00: ${officieel.hoursGateRosters}/7`);
  for (const r of officieel.perRoster) {
    console.log(`  ${r.code.padEnd(10)} ${hm(r.averageWeeklyMinutes)} · werkreeksen ${JSON.stringify(r.workStreaks)} · rustreeksen ${JSON.stringify(r.restStreaks)} · rangeer ${r.rangeer} (${r.rangeerPerLine.join("/")}) · weekenden ${r.weekends.length} (RR ${r.weekends.filter((w) => w.rr).length}, vr<24 ${r.weekends.filter((w) => w.fridayBeforeMidnight).length})`);
  }
  await prisma.$disconnect();
}

main().catch(async (fout) => {
  console.error(fout);
  await prisma.$disconnect();
  process.exit(1);
});
