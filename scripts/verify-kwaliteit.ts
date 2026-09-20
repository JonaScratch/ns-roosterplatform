import "dotenv/config";
import type { CandidateAssignment } from "@/domain/candidate";
import { formatHoursMinutes } from "@/domain/roster-hours";
import {
  type PackageQuality,
  type QualityRosterInput,
  type RosterQuality,
  rotationCycle,
} from "@/domain/roster-quality";
import { prisma } from "@/server/data/prisma";
import { evaluateAssignmentsCore, evaluateOfficialCore, loadEvaluationContextCore } from "@/server/services/quality-evaluation-service";
import {
  type QualityContext,
  candidateRosterInputs,
  loadQualityContextCore,
  measureAssignmentsCore,
  measureOfficialCore,
} from "@/server/services/roster-quality-service";

/**
 * Roosterkwaliteit: het officiële rooster naast de gegenereerde kandidaten.
 *
 * ## Wat dit meet
 *
 * 1. Per basisrooster van het officiële rooster: uren, dagdelen, nachtreeksen,
 *    overgangen. Dat is het ijkpunt; de officiële bladen zijn door mensen
 *    gemaakt en laten zien hoe een goed rooster er in de praktijk uitziet.
 * 2. Hoe vaak elk dagdeel op elk ander volgt, officieel en gegenereerd. Zo is
 *    te zien of de generator dezelfde soort regelmaat oplevert als de
 *    roostermakers — geen model dat iets leert, maar een telling naast elkaar.
 * 3. Per strategie de nieuwste afgeronde opdracht, met harde toetsen: alles
 *    geplaatst, geen vroege dienst in Laat/Nacht, geen losse nachten, niet
 *    meer zware overgangen dan het officiële rooster.
 * 4. Laat/Nacht in detail: het officiële rooster en elke kandidaat.
 *
 * Draaien met: npm run verify:kwaliteit
 */

let geslaagd = 0;
let mislukt = 0;
let geblokkeerd = 0;

function toets(naam: string, goed: boolean, toelichting = ""): void {
  if (goed) {
    geslaagd += 1;
    console.log(`  ✓ ${naam}${toelichting ? ` — ${toelichting}` : ""}`);
  } else {
    mislukt += 1;
    console.log(`  ✗ ${naam}${toelichting ? ` — ${toelichting}` : ""}`);
  }
}

const LOCATIE = "DDR";
const SOORTEN = ["EARLY", "LATE", "NIGHT", "OFF"] as const;
type Soort = (typeof SOORTEN)[number];
const LABEL: Record<Soort, string> = { EARLY: "vroeg", LATE: "laat", NIGHT: "nacht", OFF: "vrij" };

function rij(rooster: RosterQuality): string {
  return (
    `${rooster.code.padEnd(10)} ${formatHoursMinutes(rooster.hours.averageWeeklyCreditMinutes).padStart(5)} ` +
    `V${String(rooster.totals.early).padStart(2)} L${String(rooster.totals.late).padStart(2)} ` +
    `N${String(rooster.totals.night).padStart(2)} R${String(rooster.totals.shunting).padStart(2)} ` +
    `nachtreeksen [${rooster.nights.blocks.map((blok) => blok.length).join(",")}] ` +
    `stabiel ${rooster.transitions.stablePairs}/${rooster.transitions.adjacentPairs} zwaar ${rooster.transitions.heavy.length}`
  );
}

/** Hoe vaak het ene dagdeel op het andere volgt, over de hele cyclus rond. */
function overgangen(roosters: readonly QualityRosterInput[], context: QualityContext): Map<string, number> {
  const telling = new Map<string, number>();
  for (const rooster of roosters) {
    const cyclus = rotationCycle(rooster, context.duties);
    for (let i = 0; i < cyclus.length; i += 1) {
      const van: Soort = cyclus[i].category ?? "OFF";
      const naar: Soort = cyclus[(i + 1) % cyclus.length].category ?? "OFF";
      const sleutel = `${van}>${naar}`;
      telling.set(sleutel, (telling.get(sleutel) ?? 0) + 1);
    }
  }
  return telling;
}

function toonOvergangen(naam: string, telling: Map<string, number>, schaal = 1): void {
  console.log(`  ${naam}${schaal !== 1 ? ` (gemiddeld per kandidaat)` : ""}`);
  console.log(`    ${"van \\ naar".padEnd(11)}${SOORTEN.map((soort) => LABEL[soort].padStart(7)).join("")}`);
  for (const van of SOORTEN) {
    console.log(
      `    ${LABEL[van].padEnd(11)}${SOORTEN.map((naar) =>
        String(Math.round(((telling.get(`${van}>${naar}`) ?? 0) / schaal) * 10) / 10).padStart(7),
      ).join("")}`,
    );
  }
}

function score(kwaliteit: PackageQuality, sleutel: string): number | null {
  return kwaliteit.subscores.find((entry) => entry.key === sleutel)?.score ?? null;
}

async function main(): Promise<void> {
  console.log("ROOSTERKWALITEIT");
  console.log("═".repeat(78));
  const context = await loadQualityContextCore(LOCATIE);
  const officieel = measureOfficialCore(context);

  console.log("\n1. Het officiële rooster");
  console.log(`  ${officieel.subscores.map((entry) => `${entry.label} ${entry.score ?? "—"}`).join(" · ")}`);
  for (const rooster of officieel.rosters) {
    console.log(`  ${rij(rooster)}`);
  }

  const opdrachten = await prisma.generationRun.findMany({
    where: { locationCode: LOCATIE, kind: "GENERATE", status: { in: ["COMPLETED", "PARTIAL"] } },
    orderBy: { createdAt: "desc" },
    include: { candidates: { where: { archivedAt: null }, orderBy: { candidateNumber: "asc" } } },
  });
  const nieuwstePerStrategie = new Map<string, (typeof opdrachten)[number]>();
  for (const opdracht of opdrachten) {
    if (!nieuwstePerStrategie.has(opdracht.strategy) && opdracht.candidates.length > 0) {
      nieuwstePerStrategie.set(opdracht.strategy, opdracht);
    }
  }

  console.log("\n2. Hoe dagdelen op elkaar volgen");
  toonOvergangen("Officieel", overgangen(context.official, context));
  const alleKandidaten = [...nieuwstePerStrategie.values()].flatMap((opdracht) => opdracht.candidates);
  if (alleKandidaten.length > 0) {
    const samen = new Map<string, number>();
    for (const kandidaat of alleKandidaten) {
      const invoer = candidateRosterInputs(kandidaat.assignments as unknown as CandidateAssignment[], context);
      for (const [sleutel, aantal] of overgangen(invoer, context)) {
        samen.set(sleutel, (samen.get(sleutel) ?? 0) + aantal);
      }
    }
    toonOvergangen(`Gegenereerd (${alleKandidaten.length} kandidaten)`, samen, alleKandidaten.length);
    const zwaar = (telling: Map<string, number>, schaal = 1) =>
      ((telling.get("NIGHT>EARLY") ?? 0) + (telling.get("LATE>EARLY") ?? 0)) / schaal;
    console.log(
      `    terug tegen de klok in (nacht→vroeg, laat→vroeg): officieel ${zwaar(overgangen(context.official, context))}, ` +
        `gegenereerd gemiddeld ${Math.round(zwaar(samen, alleKandidaten.length) * 10) / 10}`,
    );
  }

  console.log("\n3. Per strategie de nieuwste afgeronde opdracht");
  if (nieuwstePerStrategie.size === 0) {
    geblokkeerd += 1;
    console.log("  ⊘ geen afgeronde generatieopdracht — genereer eerst (npm run verify:generatie)");
  }
  const lnKandidaten: { naam: string; rooster: RosterQuality }[] = [];
  for (const [strategie, opdracht] of nieuwstePerStrategie) {
    const duur =
      opdracht.startedAt && opdracht.finishedAt
        ? Math.round((opdracht.finishedAt.getTime() - opdracht.startedAt.getTime()) / 1000)
        : null;
    console.log(
      `\n  ${opdracht.strategyLabel} (${strategie}) — ${opdracht.foundCandidates}/${opdracht.requestedCandidates} kandidaten` +
        `${duur !== null ? `, ${duur} s` : ""}`,
    );
    for (const kandidaat of opdracht.candidates) {
      const kwaliteit = measureAssignmentsCore(kandidaat.assignments as unknown as CandidateAssignment[], context);
      const naam = `${opdracht.strategyLabel} · kandidaat ${kandidaat.candidateNumber ?? "?"}`;
      console.log(`  ${naam}`);
      console.log(`    ${kwaliteit.subscores.map((entry) => `${entry.label} ${entry.score ?? "—"}`).join(" · ")}`);
      for (const rooster of kwaliteit.rosters) {
        console.log(`    ${rij(rooster)}`);
      }
      const ln = kwaliteit.rosters.find((rooster) => rooster.profile === "LAAT_NACHT");
      if (ln) {
        lnKandidaten.push({ naam, rooster: ln });
      }
      toets(`${naam}: alle diensten geplaatst`, kwaliteit.coverage.placed === kwaliteit.coverage.required, `${kwaliteit.coverage.placed}/${kwaliteit.coverage.required}`);
      toets(`${naam}: geen vroege dienst in Laat/Nacht`, (ln?.totals.early ?? 0) === 0, `${ln?.totals.early ?? 0}`);
      toets(`${naam}: geen losse nachten`, kwaliteit.nights.singletons === 0, `${kwaliteit.nights.singletons}`);
      toets(
        `${naam}: niet meer zware overgangen dan het officiële rooster`,
        kwaliteit.transitions.heavy <= officieel.transitions.heavy,
        `${kwaliteit.transitions.heavy} tegen ${officieel.transitions.heavy}`,
      );
      toets(
        `${naam}: de meting onderscheidt de kandidaat van het officiële rooster`,
        kwaliteit.subscores.some((entry) => entry.score !== score(officieel, entry.key)),
      );
    }
  }

  console.log("\n4. Laat/Nacht in detail");
  const lnOfficieel = officieel.rosters.find((rooster) => rooster.profile === "LAAT_NACHT");
  if (lnOfficieel) {
    const toon = (naam: string, rooster: RosterQuality) =>
      console.log(
        `  ${naam.padEnd(44)} ${formatHoursMinutes(rooster.hours.averageWeeklyCreditMinutes)} ` +
          `vroeg ${rooster.totals.early} · laat ${rooster.totals.late} · nacht ${rooster.totals.night} · ` +
          `reeksen [${rooster.nights.blocks.map((blok) => blok.length).join(",")}] · ` +
          `gem. reeks ${rooster.nights.averageLength === null ? "—" : Math.round(rooster.nights.averageLength * 10) / 10} · ` +
          `overgangen stabiel ${Math.round((rooster.transitions.stableShare ?? 0) * 1000) / 10}% · zwaar ${rooster.transitions.heavy.length}`,
      );
    toon("Officieel (Laat Nacht 1 C)", lnOfficieel);
    for (const kandidaat of lnKandidaten) {
      toon(kandidaat.naam, kandidaat.rooster);
    }
  }

  console.log("\n5. Het menselijke kwaliteitsmodel op het officiële rooster");
  const evaluatie = await loadEvaluationContextCore(LOCATIE);
  const menselijk = evaluateOfficialCore(evaluatie);
  console.log(`  model ${menselijk.modelVersion} · totaal ${menselijk.overall} · zonder continuïteit ${menselijk.overallWithoutContinuity} · robuust ${menselijk.robust}`);
  console.log(
    `  ${Object.entries(menselijk.components)
      .map(([sleutel, waarde]) => `${sleutel} ${waarde.score ?? "—"}`)
      .join(" · ")}`,
  );
  console.log(`  slechtste regel ${menselijk.lines.worst?.roster} ${menselijk.lines.worst?.lineNumber} (${menselijk.lines.worst?.score}) · mediaan ${menselijk.lines.median}`);
  // Het officiële rooster is door roostermakers gemaakt. Scoort het model dat
  // ineens zeer laag, dan is het model verdacht — niet het rooster.
  toets("het officiële rooster is hard geldig volgens de evaluator", menselijk.hardValidity.hardValid, menselijk.hardValidity.reasons.join("; "));
  toets("geen enkele component van het officiële rooster onder de 40", Object.values(menselijk.components).every((c) => (c.score ?? 100) >= 40));
  toets("het officiële rooster heeft patroonafstand 0 tot zichzelf", menselijk.patternDistance?.total === 0, String(menselijk.patternDistance?.total));
  toets("continuïteit van het officiële rooster is 100", menselijk.components.stability.score === 100);
  for (const kandidaat of alleKandidaten.slice(0, 3)) {
    const rapport = evaluateAssignmentsCore(kandidaat.assignments as unknown as CandidateAssignment[], evaluatie);
    console.log(
      `  ${kandidaat.scenarioLabel}: totaal ${rapport.overall} robuust ${rapport.robust} patroonafstand ${rapport.patternDistance?.total} · ${rapport.diagnosis.slice(0, 3).join(" | ")}`,
    );
    toets(`${kandidaat.scenarioLabel}: hard geldig volgens de evaluator`, rapport.hardValidity.hardValid, rapport.hardValidity.reasons.join("; "));
  }

  console.log("\n" + "═".repeat(78));
  console.log(`${geslaagd} geslaagd, ${mislukt} mislukt, ${geblokkeerd} geblokkeerd`);
  await prisma.$disconnect();
  process.exit(mislukt === 0 ? 0 : 1);
}

main().catch(async (fout) => {
  console.error(fout);
  await prisma.$disconnect();
  process.exit(1);
});
