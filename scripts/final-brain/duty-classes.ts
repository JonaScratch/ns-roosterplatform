import "dotenv/config";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { type DutyClass, DUTY_CLASS_BOUNDS, DUTY_CLASS_LABELS, dutyClass, nightWindowExposure } from "@/domain/duty-class";
import { allowedKindsForProfile } from "@/domain/roster-profiles";
import { type QualityRosterInput, dutyKey } from "@/domain/roster-quality";
import type { RosterProfile } from "@/lib/generated/prisma/enums";
import { prisma } from "@/server/data/prisma";
import { type EvaluationContext, loadEvaluationContextCore } from "@/server/services/quality-evaluation-service";
import { candidateRosterInputs } from "@/server/services/roster-quality-service";
import { decodeAssignments, readRuns } from "../benchmark/io";

/**
 * Welke dienstklassen bij welk profiel terechtkomen — bij mensen en bij de
 * zoekmachine (werkopdracht "machinist preference" §17, §34, §35).
 *
 * ## Wat hier wordt gemeten
 *
 * Per basisrooster: hoeveel diensten van elke klasse (extreem vroeg, gematigd
 * vroeg, daglijk vroeg, vroege late, late, echte afloper, nacht), per week. En
 * de "lift": het aandeel dat het rooster van een klasse kreeg, gedeeld door zijn
 * aandeel in de dienstdagen van alle roosters die die klasse mógen rijden. Een
 * lift boven 1 betekent: dit rooster kreeg van deze klasse meer dan zijn
 * evenredige deel. Dat is de gemeten voorkeur van de mensen die de roosters
 * maakten, en het vertrekpunt voor de affiniteit — geen verzonnen getallen.
 *
 * ## Toeslagblootstelling
 *
 * Er staan geen ORT- of toeslagregels in het platform. Er worden dus geen
 * bedragen berekend. Als maat voor de blootstelling (een proxy, uitdrukkelijk
 * geen toeslag) telt alleen wat een bron heeft: minuten in het nachtvenster
 * 00:00–06:00 (CAO-definitie van een nachtdienst) en minuten op zaterdag en
 * zondag. Voor een avondband is geen bron; die ontbreekt dus.
 *
 *   npm run final-brain:duty-classes
 */

const KLASSEN: readonly DutyClass[] = ["EXTREME_EARLY", "EARLY", "DAYLIKE_EARLY", "EARLY_LATE", "LATE", "PREMIUM_LATE", "NIGHT"];
const SOORT: Readonly<Record<DutyClass, string>> = {
  EXTREME_EARLY: "VROEG",
  EARLY: "VROEG",
  DAYLIKE_EARLY: "VROEG",
  EARLY_LATE: "LAAT",
  LATE: "LAAT",
  PREMIUM_LATE: "LAAT",
  NIGHT: "NACHT",
  OTHER: "",
};

function verdeling(rosters: readonly QualityRosterInput[], context: EvaluationContext) {
  const perRooster: Record<string, { profile: string; weeks: number; dutyDays: number; classes: Record<string, number>; nightWindowMinutes: number; weekendMinutes: number }> = {};
  for (const r of rosters) {
    const weken = new Set(r.days.map((d) => `${d.lineNumber}|${d.weekIndex}`)).size;
    const rij = (perRooster[r.code] = { profile: r.profile, weeks: weken, dutyDays: 0, classes: {} as Record<string, number>, nightWindowMinutes: 0, weekendMinutes: 0 });
    for (const d of r.days) {
      if (d.positionType !== "DUTY" || !d.dutyCode) continue;
      const dienst = context.quality.duties.get(dutyKey(d.dutyCode, d.weekday));
      if (!dienst) continue;
      rij.dutyDays += 1;
      const k = dutyClass(dienst);
      rij.classes[k] = (rij.classes[k] ?? 0) + 1;
      rij.nightWindowMinutes += nightWindowExposure(dienst);
      if (d.weekday >= 6) rij.weekendMinutes += dienst.endMinute - dienst.startMinute;
    }
  }
  // Lift: aandeel van de klasse / aandeel in de dienstdagen van de roosters die de klasse mogen.
  const lift: Record<string, Record<string, number | null>> = {};
  for (const k of KLASSEN) {
    const mogen = Object.entries(perRooster).filter(([, r]) => allowedKindsForProfile(r.profile as RosterProfile).includes(SOORT[k] as never));
    const totaalK = mogen.reduce((s, [, r]) => s + (r.classes[k] ?? 0), 0);
    const totaalDagen = mogen.reduce((s, [, r]) => s + r.dutyDays, 0);
    lift[k] = Object.fromEntries(
      Object.entries(perRooster).map(([code, r]) => {
        const mag = mogen.some(([c]) => c === code);
        if (!mag || totaalK === 0 || totaalDagen === 0) return [code, null];
        return [code, ((r.classes[k] ?? 0) / totaalK) / (r.dutyDays / totaalDagen)];
      }),
    );
  }
  return { perRooster, lift };
}

async function main() {
  const context = await loadEvaluationContextCore("DDR");
  const officieel = verdeling(context.quality.official, context);

  // De v1.0.4-kandidaten: dezelfde telling, gemiddeld.
  const kandidaten = readRuns("after").filter((r) => r.strategy !== "REPRODUCE").flatMap((r) => r.candidates.map((k) => verdeling(candidateRosterInputs(decodeAssignments(k.roster), context.quality), context)));
  const gemiddeld: Record<string, Record<string, number>> = {};
  for (const v of kandidaten) {
    for (const [code, r] of Object.entries(v.perRooster)) {
      const g = (gemiddeld[code] ??= {});
      for (const k of KLASSEN) g[k] = (g[k] ?? 0) + (r.classes[k] ?? 0) / kandidaten.length;
      g.nightWindowMinutesPerWeek = (g.nightWindowMinutesPerWeek ?? 0) + r.nightWindowMinutes / r.weeks / kandidaten.length;
      g.weekendMinutesPerWeek = (g.weekendMinutesPerWeek ?? 0) + r.weekendMinutes / r.weeks / kandidaten.length;
    }
  }

  const klassenPakket: Record<string, number> = {};
  for (const d of context.quality.duties.values()) {
    const k = dutyClass(d);
    klassenPakket[k] = (klassenPakket[k] ?? 0) + 1;
  }
  const uit = {
    schema: "ns-final-brain-duty-classes/1",
    measuredAt: new Date().toISOString(),
    bounds: DUTY_CLASS_BOUNDS,
    labels: DUTY_CLASS_LABELS,
    packageClassCounts: klassenPakket,
    exposureProxy: "minuten in het CAO-nachtvenster 00:00–06:00 en minuten op zaterdag/zondag; GEEN toeslag of ORT (daar zijn geen regels voor in het platform)",
    official: {
      perRoster: Object.fromEntries(
        Object.entries(officieel.perRooster).map(([code, r]) => [
          code,
          { ...r, nightWindowMinutesPerWeek: r.nightWindowMinutes / r.weeks, weekendMinutesPerWeek: r.weekendMinutes / r.weeks },
        ]),
      ),
      lift: officieel.lift,
    },
    v104Mean: gemiddeld,
    v104Candidates: kandidaten.length,
  };
  writeFileSync(path.resolve(__dirname, "..", "..", "docs", "v1.0.4-final-brain", "duty-classes.json"), `${JSON.stringify(uit, null, 2)}\n`);

  const t = (x: number | null | undefined, d = 1) => (x === null || x === undefined ? "  —" : x.toFixed(d).padStart(5));
  console.log(`Pakket: ${JSON.stringify(klassenPakket)}`);
  console.log(`\n${"rooster".padEnd(10)} ${KLASSEN.map((k) => k.slice(0, 9).padStart(10)).join("")}   nachtvenster/w  weekend/w`);
  for (const [code, r] of Object.entries(officieel.perRooster)) {
    console.log(
      `${code.padEnd(10)} ${KLASSEN.map((k) => `${String(r.classes[k] ?? 0).padStart(4)} (${t(officieel.lift[k][code], 2)})`.padStart(10)).join("")}   ${t(r.nightWindowMinutes / r.weeks, 0)}  ${t(r.weekendMinutes / r.weeks, 0)}`,
    );
    const g = gemiddeld[code];
    console.log(`${"  v1.0.4".padEnd(10)} ${KLASSEN.map((k) => t(g[k], 1).padStart(10)).join("")}   ${t(g.nightWindowMinutesPerWeek, 0)}  ${t(g.weekendMinutesPerWeek, 0)}`);
  }
  await prisma.$disconnect();
}

main().catch(async (fout) => {
  console.error(fout);
  await prisma.$disconnect();
  process.exit(1);
});
