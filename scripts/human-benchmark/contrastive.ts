import "dotenv/config";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/server/data/prisma";
import { type HumanQualityReport, evaluateQuality } from "@/domain/quality-evaluator";
import { QUALITY_MODEL_V1, QUALITY_MODEL_V2, type QualityModel } from "@/domain/quality-model";
import { polishBySwaps } from "@/domain/roster-polish";
import type { QualityRosterInput } from "@/domain/roster-quality";
import { type EvaluationContext, loadEvaluationContextCore } from "@/server/services/quality-evaluation-service";
import { candidateRosterInputs } from "@/server/services/roster-quality-service";
import { decodeAssignments, readRuns } from "../benchmark/io";

/**
 * Positieve tegenover negatieve voorbeelden, zonder machine learning.
 *
 * ## Hoe de negatieve voorbeelden ontstaan
 *
 * Een negatief voorbeeld moet hard geldig zijn, anders test je niet de
 * kwaliteitsmaat maar de validatie. Daarom worden ze gemaakt met dezelfde
 * ruilzoektocht die de zoekmachine gebruikt, maar achterstevoren: vanuit het
 * officiële rooster zoekt hij ruilen die één menselijk principe zo slecht
 * mogelijk maken — nachten versnipperen, heen-en-weer maken, begintijden laten
 * springen — met dezelfde harde toets per ruil (profiel, weekdag, rust).
 *
 * Daarna twee vragen per voorbeeld:
 *   1. Ziet het model het verschil op het onderdeel dat werd aangetast?
 *   2. Zet het model het menselijke rooster als geheel hoger?
 *
 * Beide vragen worden aan model v1 én v2 gesteld. Waar v1 het verschil niet
 * zag en v2 wel, heeft de ijking iets opgeleverd.
 *
 * Daarnaast historische negatieven: v1.0.3-kandidaten met bekende problemen
 * (losse nachten, zware overgangen) uit de BEFORE-meting.
 *
 *   npm run human-benchmark:contrastive
 */

interface Toets {
  readonly naam: string;
  readonly principe: string;
  /** Wat de omgekeerde zoektocht zo slecht mogelijk maakt. */
  readonly bederf: (r: HumanQualityReport) => number;
  /** Het onderdeel waarop het verschil te zien moet zijn. */
  readonly onderdeel: (r: HumanQualityReport) => number | null;
  readonly onderdeelNaam: string;
}

const TOETSEN: readonly Toets[] = [
  {
    naam: "versnipperde-nachten",
    principe: "Nachten in reeksen van drie tot zes",
    bederf: (r) => r.metrics.nights.singletons * 10 + r.metrics.nights.blocks2 * 5,
    onderdeel: (r) => r.components.nights.score,
    onderdeelNaam: "nachten",
  },
  {
    naam: "vroeg-na-nachten",
    principe: "Na nachten eerst rust, dan laat",
    bederf: (r) => -(r.components.nights.parts.exit ?? 100),
    onderdeel: (r) => r.components.nights.score,
    onderdeelNaam: "nachten",
  },
  {
    naam: "heen-en-weer",
    principe: "Geen heen-en-weer van de lichaamsklok",
    bederf: (r) => -(r.components.flow.parts.oscillation ?? 100) - (r.components.flow.parts.coherence ?? 100),
    onderdeel: (r) => r.components.flow.score,
    onderdeelNaam: "regelmaat",
  },
  {
    naam: "springende-begintijden",
    principe: "Begintijden binnen een blok redelijk bij elkaar",
    bederf: (r) => -(r.components.flow.parts.startJitter ?? 100),
    onderdeel: (r) => r.components.flow.score,
    onderdeelNaam: "regelmaat",
  },
  {
    naam: "wissels-zonder-rust",
    principe: "Dagdeelwissels over rust heen",
    bederf: (r) => -(r.components.flow.parts.throughRest ?? 100) - (r.components.flow.parts.penalty ?? 100),
    onderdeel: (r) => r.components.flow.score,
    onderdeelNaam: "regelmaat",
  },
];

function meet(rosters: readonly QualityRosterInput[], context: EvaluationContext, model: QualityModel): HumanQualityReport {
  return evaluateQuality({
    model,
    rosters,
    reference: context.quality.official,
    duties: context.quality.duties,
    requiredDutyKeys: context.requiredDutyKeys,
    nightRosterCodes: context.quality.nightRosterCodes,
    rules: context.rules,
  });
}

async function main() {
  const context = await loadEvaluationContextCore("DDR");
  const officieel = context.quality.official;
  const uitslagen: Record<string, unknown>[] = [];

  for (const toets of TOETSEN) {
    // De omgekeerde zoektocht rekent met v2 om het principe te vinden; de
    // beoordeling daarna gebeurt met beide modellen.
    const slecht = polishBySwaps({
      rosters: officieel,
      duties: context.quality.duties,
      minRestMinutes: context.rules.minDailyRestMinutes,
      score: (rosters) => toets.bederf(meet(rosters, context, QUALITY_MODEL_V2)),
      deadline: Date.now() + 8000,
      seed: 17,
      maxKicks: 0,
    });
    const rij: Record<string, unknown> = { toets: toets.naam, principe: toets.principe, ruilen: slecht.moves.length };
    for (const model of [QUALITY_MODEL_V1, QUALITY_MODEL_V2]) {
      const goed = meet(officieel, context, model);
      const fout = meet(slecht.rosters, context, model);
      rij[model.version] = {
        hardValid: fout.hardValidity.hardValid,
        onderdeel: toets.onderdeelNaam,
        onderdeelMens: toets.onderdeel(goed),
        onderdeelNegatief: toets.onderdeel(fout),
        ziet: (toets.onderdeel(goed) ?? 0) > (toets.onderdeel(fout) ?? 0),
        robuustMens: goed.robust,
        robuustNegatief: fout.robust,
        menselijkHoger: (goed.robust ?? 0) > (fout.robust ?? 0),
      };
    }
    uitslagen.push(rij);
  }

  // Historische negatieven: v1.0.3-kandidaten met een bekend probleem.
  const historisch: Record<string, unknown>[] = [];
  for (const run of readRuns("before").filter((r) => r.strategy !== "REPRODUCE")) {
    for (const kandidaat of run.candidates) {
      const rosters = candidateRosterInputs(decodeAssignments(kandidaat.roster), context.quality);
      const v2 = meet(rosters, context, QUALITY_MODEL_V2);
      const problemen = [
        v2.metrics.nights.singletons > 0 ? `${v2.metrics.nights.singletons} losse nacht(en)` : null,
        v2.metrics.nights.blocks2 > 0 ? `${v2.metrics.nights.blocks2} reeks(en) van twee` : null,
        v2.metrics.transitions.heavy > 0 ? `${v2.metrics.transitions.heavy} zware overgang(en)` : null,
      ].filter((x): x is string => x !== null);
      if (problemen.length === 0) continue;
      const mens = meet(officieel, context, QUALITY_MODEL_V2);
      const v1 = meet(rosters, context, QUALITY_MODEL_V1);
      historisch.push({
        run: run.runNumber,
        strategy: run.strategy,
        candidate: kandidaat.number,
        problemen,
        nachtenV1: v1.components.nights.score,
        nachtenV2: v2.components.nights.score,
        nachtenMensV2: mens.components.nights.score,
        regelmaatV2: v2.components.flow.score,
        regelmaatMensV2: mens.components.flow.score,
      });
    }
  }

  const doel = path.resolve(__dirname, "..", "..", "docs", "human-roster-benchmark", "contrastive-check.json");
  writeFileSync(
    doel,
    `${JSON.stringify({ schema: "ns-contrastive-check/1", measuredAt: new Date().toISOString(), adversarial: uitslagen, historical: historisch }, null, 2)}\n`,
  );

  console.log("Negatief voorbeeld              ruilen  geldig  | v1 ziet  v1 mens hoger | v2 ziet  v2 mens hoger");
  for (const rij of uitslagen) {
    const a = rij[QUALITY_MODEL_V1.version] as Record<string, unknown>;
    const b = rij[QUALITY_MODEL_V2.version] as Record<string, unknown>;
    const j = (x: unknown) => (x ? "ja " : "NEE");
    console.log(
      `${String(rij.toets).padEnd(30)} ${String(rij.ruilen).padStart(6)}  ${j(b.hardValid)}     | ${j(a.ziet)}      ${j(a.menselijkHoger)}           | ${j(b.ziet)}      ${j(b.menselijkHoger)}` +
        `   (${b.onderdeel} ${Number(b.onderdeelMens).toFixed(1)} → ${Number(b.onderdeelNegatief).toFixed(1)}; robuust ${b.robuustMens} → ${b.robuustNegatief})`,
    );
  }
  console.log(`\nHistorische negatieven (v1.0.3 met bekend probleem): ${historisch.length}`);
  const lager = historisch.filter((h) => Number(h.nachtenV2) < Number(h.nachtenMensV2) || Number(h.regelmaatV2) < Number(h.regelmaatMensV2));
  console.log(`  waarvan v2 op nachten of regelmaat lager zet dan het menselijke rooster: ${lager.length}`);
  console.log(`Geschreven: ${doel}`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
