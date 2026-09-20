import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CandidateAssignment } from "@/domain/candidate";
import { DUTY_CLASS_LABELS } from "@/domain/duty-class";
import { affinityMetrics, dutyAffinity } from "@/domain/profile-affinity";
import { flowDays, workBlocks } from "@/domain/roster-flow";
import { allowedKindsForProfile, rosterProfileLabel } from "@/domain/roster-profiles";
import { dutyKey } from "@/domain/roster-quality";
import type { RosterProfile } from "@/lib/generated/prisma/enums";
import { prisma } from "@/server/data/prisma";
import { type EvaluationContext, loadEvaluationContextCore } from "@/server/services/quality-evaluation-service";
import { candidateRosterInputs } from "@/server/services/roster-quality-service";

/**
 * Waarom ligt deze dienst hier? (werkopdracht "machinist preference" §41–42)
 *
 * Per toewijzing de zachte redenen, uit de kandidaat zelf te herleiden: de
 * klasse van de dienst op de klok, hoe goed hij bij dit profiel past en bij de
 * andere profielen die hem mogen rijden, het werkblok waar hij in ligt, en wat
 * de andere roosters al aan extreem vroege diensten, aflopers en blootstelling
 * hebben. Geen beslislog van de zoekmachine — die bestaat per dienst niet —
 * maar een verklaring achteraf die elke keer hetzelfde uitkomt.
 *
 *   npm run final-brain:allocation-reasons -- --candidate <id> [--out map]
 */

const DAG = ["", "ma", "di", "wo", "do", "vr", "za", "zo"];
const NIVEAU: Readonly<Record<string, string>> = { PREFERRED: "voorkeur", NEUTRAL: "neutraal", LESS: "minder passend" };
const hm = (m: number) => `${String(Math.floor((m % 1440) / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function allocationReasons(assignments: readonly CandidateAssignment[], context: EvaluationContext) {
  const rosters = candidateRosterInputs(assignments, context.quality);
  const affiniteit = affinityMetrics(rosters, context.quality.duties);
  const uit: {
    roster: string;
    line: number;
    weekday: number;
    duty: string;
    time: string;
    dutyClass: string;
    level: string;
    alternatives: { roster: string; level: string }[];
    block: string;
    reason: string;
  }[] = [];
  for (const r of rosters) {
    const dagen = flowDays(r, context.quality.duties);
    const blokVan = new Map<number, string>();
    for (const b of workBlocks(dagen)) {
      const toestanden = Array.from({ length: b.length }, (_, k) => dagen[(b.startIndex + k) % dagen.length].state).join("");
      for (let k = 0; k < b.length; k += 1) blokVan.set((b.startIndex + k) % dagen.length, toestanden);
    }
    dagen.forEach((dag, index) => {
      if (!dag.dutyCode) return;
      const dienst = context.quality.duties.get(dutyKey(dag.dutyCode, dag.weekday));
      if (!dienst) return;
      const eigen = dutyAffinity(r.profile, dienst);
      const soort = dienst.kinds.includes("NACHT") ? "NACHT" : dienst.kinds.includes("LAAT") ? "LAAT" : "VROEG";
      const alternatieven = rosters
        .filter((x) => x.code !== r.code && allowedKindsForProfile(x.profile as RosterProfile).includes(soort as never))
        .map((x) => ({ roster: x.code, level: dutyAffinity(x.profile, dienst).level }));
      const blok = blokVan.get(index) ?? "";
      const samenhangend = blok.length >= 2 && new Set(blok).size === 1;
      const klasseTelling = (code: string) => affiniteit.perRoster[code]?.classes[eigen.dutyClass] ?? 0;
      const beter = alternatieven.filter((a) => a.level === "PREFERRED" && eigen.level !== "PREFERRED");
      const reden = [
        `${DUTY_CLASS_LABELS[eigen.dutyClass]} (${DAG[dag.weekday]} ${hm(dienst.startMinute)}–${hm(dienst.endMinute)})`,
        `voor ${rosterProfileLabel(r.profile as RosterProfile)} ${eigen.level === "PREFERRED" ? "een voorkeur" : eigen.level === "LESS" ? "minder passend" : "neutraal"}`,
        blok.length >= 2 ? (samenhangend ? `in een samenhangend blok van ${blok.length}` : `in een blok ${blok}`) : "als losse dienst",
        beter.length
          ? `past beter bij ${beter.map((a) => a.roster).join(", ")}, dat al ${beter.map((a) => klasseTelling(a.roster)).join("/")} van deze klasse heeft`
          : alternatieven.length
            ? `andere roosters: ${alternatieven.map((a) => `${a.roster} ${NIVEAU[a.level]} (${klasseTelling(a.roster)} van deze klasse, ${Math.round(affiniteit.perRoster[a.roster]?.nightWindowMinutesPerWeek ?? 0)} min/w nachtvenster)`).join("; ")}`
            : "geen ander rooster mag hem rijden",
      ].join("; ");
      uit.push({
        roster: r.code,
        line: dag.lineNumber,
        weekday: dag.weekday,
        duty: dag.dutyCode,
        time: `${hm(dienst.startMinute)}–${hm(dienst.endMinute)}`,
        dutyClass: eigen.dutyClass,
        level: eigen.level,
        alternatives: alternatieven,
        block: blok,
        reason: reden,
      });
    });
  }
  return { reasons: uit, affinity: affiniteit };
}

async function main() {
  const index = process.argv.indexOf("--candidate");
  const id = index >= 0 ? process.argv[index + 1] : null;
  if (!id) throw new Error("Gebruik: --candidate <id> [--out map]");
  const outIndex = process.argv.indexOf("--out");
  const map = outIndex >= 0 ? path.resolve(process.argv[outIndex + 1]) : path.resolve(__dirname, "..", "..", "docs", "v1.0.4-final-brain", "allocation-reasons");
  const context = await loadEvaluationContextCore("DDR");
  const rij = await prisma.candidateRoster.findUniqueOrThrow({ where: { id }, select: { assignments: true } });
  const { reasons, affinity } = allocationReasons(rij.assignments as unknown as CandidateAssignment[], context);
  mkdirSync(map, { recursive: true });
  writeFileSync(path.join(map, "allocation-reasons.json"), `${JSON.stringify({ candidateId: id, affinity, reasons }, null, 2)}\n`);
  // De leesbare versie: de diensten waar de keuze het meest toe doet.
  const belangrijk = reasons.filter((r) => ["EXTREME_EARLY", "PREMIUM_LATE", "EARLY_LATE", "NIGHT"].includes(r.dutyClass));
  writeFileSync(
    path.join(map, "allocation-reasons.md"),
    [`# Waarom ligt deze dienst hier?`, "", `*Kandidaat ${id}. Extreem vroege diensten, aflopers, vroege late diensten en nachten; de volledige lijst staat in allocation-reasons.json.*`, "", ...belangrijk.map((r) => `- **Dienst ${r.duty}** in ${r.roster} regel ${r.line}: ${r.reason}.`), ""].join("\n"),
  );
  console.log(`${reasons.length} toewijzingen verklaard → ${map}`);
  await prisma.$disconnect();
}

if (require.main === module) {
  main().catch(async (fout) => {
    console.error(fout);
    await prisma.$disconnect();
    process.exit(1);
  });
}
