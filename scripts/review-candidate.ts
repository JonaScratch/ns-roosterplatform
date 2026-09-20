import "dotenv/config";
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { CandidateAssignment } from "@/domain/candidate";
import { prisma } from "@/server/data/prisma";
import {
  evaluateAssignmentsCore,
  loadEvaluationContextCore,
} from "@/server/services/quality-evaluation-service";
import { BENCHMARK_ROOT, decodeAssignments, readRuns } from "./benchmark/io";

/**
 * De beste kandidaat uitprinten zoals een roostermaker hem leest.
 *
 * ## Waarom een mens er nog naar kijkt
 *
 * Alle cijfers in het ontwikkelrapport komen uit hetzelfde model. Als dat model
 * ergens naast zit, wijst geen enkele meting dat aan — de machine optimaliseert
 * dan netjes de verkeerde dingen. Daarom gaat er aan het eind een mens langs de
 * regels van Laat/Nacht, Mix en Vroeg met een lijstje: staan de nachten in
 * blokken, klopt de rust erna, zijn er geen vreemde sprongen, en ziet het
 * geheel eruit als een rooster dat je iemand kunt geven.
 *
 * Dit script levert het materiaal voor die controle: de regels als leesbaar
 * raster, met de feiten per regel eronder. Het oordeel zelf staat in
 * `docs/optimizer-benchmark/manual-review.json` en komt in het rapport.
 *
 *   npm run review:candidate -- --phase after --rosters DDR-LN,DDR-MIX,DDR-V
 */

const argument = (naam: string): string | null => {
  const index = process.argv.indexOf(`--${naam}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
};

const DAGEN = ["ma", "di", "wo", "do", "vr", "za", "zo"];

function kleurloosRaster(
  assignments: readonly CandidateAssignment[],
  rooster: string,
  diensten: ReadonlyMap<string, { startMinute: number; endMinute: number; kinds: readonly string[] }>,
): string[] {
  const regels = [...new Set(assignments.filter((a) => a.baseRosterCode === rooster).map((a) => a.lineNumber))].sort(
    (a, b) => a - b,
  );
  const uit: string[] = [];
  uit.push(`     ${DAGEN.map((dag) => dag.padStart(7)).join("")}`);
  for (const regel of regels) {
    const cellen = DAGEN.map((_, index) => {
      const dag = assignments.find(
        (a) => a.baseRosterCode === rooster && a.lineNumber === regel && a.weekday === index + 1,
      );
      if (!dag) return "".padStart(7);
      if (dag.positionType !== "DUTY") return dag.positionType.slice(0, 4).padStart(7);
      const dienst = diensten.get(`${dag.dutyCode}|${dag.weekday}`);
      const soort = dienst?.kinds.includes("NACHT")
        ? "N"
        : dienst?.kinds.includes("LAAT")
          ? "L"
          : dienst?.kinds.includes("VROEG")
            ? "V"
            : "·";
      return `${soort}${dag.dutyCode}`.padStart(7);
    });
    uit.push(`r${String(regel).padStart(2)}: ${cellen.join("")}`);
  }
  return uit;
}

async function main() {
  const phase = (argument("phase") ?? "after") as "before" | "after";
  const roosters = (argument("rosters") ?? "DDR-LN,DDR-MIX,DDR-V").split(",");
  const context = await loadEvaluationContextCore(argument("location") ?? "DDR");

  // De beste kandidaat van de fase: hoogste robuuste kwaliteit.
  const runs = readRuns(phase).filter((run) => run.strategy !== "REPRODUCE");
  let beste: { runNumber: number; strategy: string; candidate: number; assignments: readonly CandidateAssignment[]; robust: number } | null =
    null;
  for (const run of runs) {
    for (const [index, kandidaat] of run.candidates.entries()) {
      const assignments = decodeAssignments(kandidaat.roster);
      const rapport = evaluateAssignmentsCore(assignments, context);
      if (rapport.robust !== null && (beste === null || rapport.robust > beste.robust)) {
        beste = {
          runNumber: run.runNumber,
          strategy: run.strategy,
          candidate: index + 1,
          assignments,
          robust: rapport.robust,
        };
      }
    }
  }
  if (!beste) {
    throw new Error(`Geen kandidaten gevonden in fase ${phase}.`);
  }

  const rapport = evaluateAssignmentsCore(beste.assignments, context);
  console.log(
    `Beste ${phase}-kandidaat: run ${beste.runNumber} (${beste.strategy}), kandidaat ${beste.candidate}, ` +
      `robuuste kwaliteit ${beste.robust.toFixed(1)}\n`,
  );

  const feiten: Record<string, unknown>[] = [];
  for (const rooster of roosters) {
    console.log(`── ${rooster} ${"─".repeat(Math.max(0, 60 - rooster.length))}`);
    for (const regel of kleurloosRaster(beste.assignments, rooster, context.quality.duties)) {
      console.log(`  ${regel}`);
    }
    const perRooster = rapport.metrics.nights.perRoster.find((entry) => entry.code === rooster);
    const regels = rapport.lines.all.filter((regel) => regel.roster === rooster);
    const herstel = rapport.metrics.rest.recovery.filter((entry) => entry.roster === rooster);
    const feit = {
      roster: rooster,
      nights: perRooster?.nights ?? 0,
      nightBlocks: perRooster?.blocks ?? [],
      worstLine: Math.min(...regels.map((regel) => regel.score ?? 100)),
      bestLine: Math.max(...regels.map((regel) => regel.score ?? 0)),
      minRecoveryHours:
        herstel.length === 0 ? null : Math.round((Math.min(...herstel.map((entry) => entry.minutes)) / 60) * 10) / 10,
      earlyDuties: beste.assignments.filter((toewijzing) => {
        if (toewijzing.baseRosterCode !== rooster || !toewijzing.dutyCode) return false;
        return context.quality.duties.get(`${toewijzing.dutyCode}|${toewijzing.weekday}`)?.kinds.includes("VROEG") ?? false;
      }).length,
    };
    feiten.push(feit);
    console.log(
      `  nachten ${feit.nights} in blokken [${feit.nightBlocks.join(", ")}] · vroege diensten ${feit.earlyDuties} · ` +
        `slechtste regel ${feit.worstLine.toFixed(1)} · beste regel ${feit.bestLine.toFixed(1)}` +
        (feit.minRecoveryHours === null ? "" : ` · kortste herstel na nachten ${feit.minRecoveryHours} u`),
    );
    console.log("");
  }

  const doel = path.join(BENCHMARK_ROOT, "manual-review.json");
  writeFileSync(
    doel,
    `${JSON.stringify(
      {
        schema: "ns-manual-review/1",
        reviewedAt: new Date().toISOString(),
        phase,
        candidate: {
          run: beste.runNumber,
          strategy: beste.strategy,
          candidate: beste.candidate,
          robust: Math.round(beste.robust * 10) / 10,
        },
        rosters: feiten,
        // Het oordeel wordt met de hand ingevuld; het script vult het niet in,
        // want dan zou de machine haar eigen werk goedkeuren.
        checklist: [],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`Feiten geschreven: ${doel}`);
  console.log("Het oordeel per punt hoort met de hand in dat bestand, onder checklist.");
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
