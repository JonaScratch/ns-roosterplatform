import "dotenv/config";
import type { CandidateAssignment } from "@/domain/candidate";
import { formatHoursMinutes } from "@/domain/roster-hours";
import { profileAllowsDuty } from "@/domain/roster-profiles";
import type { PackageQuality } from "@/domain/roster-quality";
import type { RunProgress } from "@/domain/generation-progress";
import type { Actor } from "@/server/auth/session";
import { prisma } from "@/server/data/prisma";
import {
  MIN_DIFFERENT_SHARE,
  REPAIR_SECONDS,
  SOLVE_SECONDS,
  runGenerationJob,
  solverWorkers,
  verschil,
} from "@/server/generation/generation-job";
import {
  ActiveGenerationError,
  createRunCore,
  interruptStaleRunsCore,
} from "@/server/services/generation-service";
import {
  loadQualityContextCore,
  measureAssignmentsCore,
  measureOfficialCore,
} from "@/server/services/roster-quality-service";

/**
 * De generatiepijplijn, echt gedraaid op de Dordrechtse gegevens.
 *
 * ## Wat dit meet
 *
 * 1. Een tweede opdracht naast een lopende wordt geweigerd (dubbelklik).
 * 2. Een opdracht zonder hartslag wordt als onderbroken gemarkeerd.
 * 3. Een volledige generatie: hoeveel kandidaten, hoe lang elke stap duurde,
 *    en per kandidaat of hij compleet is, binnen de profielen blijft, nul
 *    bevestigde harde overtredingen heeft en werkelijk verschilt van de rest.
 * 4. Met `--stop`: een opdracht die halverwege wordt gestopt, stopt ook echt.
 * 5. Met `--herbouw`: de nieuwste kandidaat gericht herbouwen; de herbouw is
 *    een kind van de ouder, verschilt ervan en is net zo volledig en geldig.
 *
 * Losse onderdelen: `--alleen-stop`, `--alleen-herbouw`.
 *
 * De kandidaten uit stap 3 blijven bewaard; ze zijn daarna in het scherm te
 * openen. Er wordt niets gepubliceerd en niets vastgelegd als roosterversie.
 *
 * Draaien met: npm run verify:generatie [-- --strategie=BALANCED] [-- --stop]
 */

let geslaagd = 0;
let mislukt = 0;

function toets(naam: string, goed: boolean, toelichting = ""): void {
  if (goed) {
    geslaagd += 1;
    console.log(`  ✓ ${naam}${toelichting ? ` — ${toelichting}` : ""}`);
  } else {
    mislukt += 1;
    console.log(`  ✗ ${naam}${toelichting ? ` — ${toelichting}` : ""}`);
  }
}

const argumenten = process.argv.slice(2);
const strategie = argumenten.find((arg) => arg.startsWith("--strategie="))?.split("=")[1] ?? "BALANCED";
const metStop = argumenten.includes("--stop");
const alleenStop = argumenten.includes("--alleen-stop");
const alleenHerbouw = argumenten.includes("--alleen-herbouw");
const metHerbouw = argumenten.includes("--herbouw") || alleenHerbouw;
const LOCATIE = "DDR";

async function actor(): Promise<Actor> {
  const account = await prisma.userAccount.findFirst({
    where: { roles: { has: "ROSTER_COMMITTEE" }, status: "ACTIVE", employee: { depot: LOCATIE } },
    select: { id: true, roles: true, employee: { select: { id: true, employeeNumber: true, depot: true } } },
  });
  if (!account) {
    throw new Error("Geen actief account met de rol Roostercommissie in DDR.");
  }
  return {
    sessionId: "verify-generatie",
    userId: account.id,
    employeeId: account.employee.id,
    employeeNumber: account.employee.employeeNumber,
    roles: account.roles,
    authLevel: "PASSWORD" as Actor["authLevel"],
    depot: account.employee.depot,
  };
}

async function main(): Promise<void> {
  console.log("GENERATIEPIJPLIJN");
  console.log("═".repeat(72));
  console.log(
    `Strategie ${strategie} · opbouwen ${SOLVE_SECONDS}s · verbeteren ${REPAIR_SECONDS}s · zoekdraden ${solverWorkers()}`,
  );
  const wie = await actor();

  // Een opdracht van een eerdere, afgebroken meting mag deze niet blokkeren.
  await interruptStaleRunsCore(LOCATIE);

  if (!alleenStop && !alleenHerbouw) {
    console.log("\n1. Eén opdracht tegelijk");
    const eerste = await createRunCore({
      actor: wie,
      locationCode: LOCATIE,
      strategy: strategie,
      strategyLabel: "Meting dubbelklik",
      rosterYear: 2027,
      requestedCandidates: 3,
    });
    let tweedeGeweigerd = false;
    let verwijzing: string | null = null;
    try {
      await createRunCore({
        actor: wie,
        locationCode: LOCATIE,
        strategy: strategie,
        strategyLabel: "Meting dubbelklik 2",
        rosterYear: 2027,
        requestedCandidates: 3,
      });
    } catch (fout) {
      tweedeGeweigerd = fout instanceof ActiveGenerationError;
      verwijzing = fout instanceof ActiveGenerationError ? fout.runId : null;
    }
    toets("tweede opdracht naast een lopende wordt geweigerd", tweedeGeweigerd);
    toets("de weigering wijst naar de lopende opdracht", verwijzing === eerste);
    await prisma.generationRun.delete({ where: { id: eerste } });

    console.log("\n2. Een opdracht zonder hartslag");
    const wees = await createRunCore({
      actor: wie,
      locationCode: LOCATIE,
      strategy: strategie,
      strategyLabel: "Meting onderbreking",
      rosterYear: 2027,
      requestedCandidates: 3,
    });
    await prisma.generationRun.update({
      where: { id: wees },
      data: { status: "RUNNING", heartbeatAt: new Date(Date.now() - 120_000), startedAt: new Date(Date.now() - 180_000) },
    });
    const nogVers = await createRunCore({
      actor: wie,
      locationCode: LOCATIE,
      strategy: strategie,
      strategyLabel: "Meting na onderbreking",
      rosterYear: 2027,
      requestedCandidates: 3,
    }).catch(() => null);
    const na = await prisma.generationRun.findUniqueOrThrow({ where: { id: wees } });
    toets("verweesde opdracht wordt ONDERBROKEN", na.status === "INTERRUPTED", na.status);
    toets("een nieuwe opdracht kan daarna starten", nogVers !== null);
    await prisma.generationRun.deleteMany({ where: { id: { in: [wees, ...(nogVers ? [nogVers] : [])] } } });

    console.log("\n3. Volledige generatie");
    const context = await loadQualityContextCore(LOCATIE);
    const officieel = measureOfficialCore(context);
    const runId = await createRunCore({
      actor: wie,
      locationCode: LOCATIE,
      strategy: strategie,
      strategyLabel: `Meting ${strategie}`,
      rosterYear: 2027,
      requestedCandidates: strategie === "REPRODUCE" || strategie === "BALANCE_SHUNTING" ? 1 : 3,
    });
    const begin = Date.now();
    let vorige = "";
    const volger = setInterval(() => {
      void prisma.generationRun
        .findUnique({ where: { id: runId }, select: { stageMessage: true, progress: true } })
        .then((rij) => {
          if (rij?.stageMessage && rij.stageMessage !== vorige) {
            vorige = rij.stageMessage;
            const p = rij.progress as unknown as RunProgress | null;
            const klaar = p ? p.steps.filter((s) => s.state === "done" || s.state === "skipped").length : 0;
            console.log(
              `  [${String(Math.round((Date.now() - begin) / 1000)).padStart(4)}s] ${klaar}/${p?.steps.length ?? "?"} ${rij.stageMessage}`,
            );
          }
        })
        .catch(() => undefined);
    }, 1000);
    await runGenerationJob(runId, wie);
    clearInterval(volger);
    const totaal = Math.round((Date.now() - begin) / 1000);

    const run = await prisma.generationRun.findUniqueOrThrow({
      where: { id: runId },
      include: { candidates: { orderBy: { candidateNumber: "asc" } } },
    });
    const logboek = run.log as unknown as {
      entries: { attempt: number; candidate: number | null; outcome: string; reason: string }[];
      timings: { step: string; seconds: number }[];
    };
    console.log(`\n  Status ${run.status} · ${run.foundCandidates}/${run.requestedCandidates} kandidaten · ${totaal}s totaal`);
    if (run.failureReason) {
      console.log(`  Reden: ${run.failureReason}`);
    }
    console.log("  Tijden:");
    for (const meting of logboek.timings) {
      console.log(`    ${meting.step.padEnd(18)} ${meting.seconds}s`);
    }
    console.log("  Logboek:");
    for (const entry of logboek.entries) {
      console.log(`    poging ${entry.attempt} kandidaat ${entry.candidate ?? "-"}: ${entry.outcome} — ${entry.reason}`);
    }

    toets("de opdracht is afgerond", ["COMPLETED", "PARTIAL"].includes(run.status), run.status);
    toets(
      "voortgang staat op 100% bij afronden",
      (run.progress as unknown as RunProgress).steps.every((s) => s.state !== "pending" && s.state !== "active"),
    );

    const dienstPerSleutel = new Map(
      [...context.duties.entries()].map(([sleutel, dienst]) => [sleutel, dienst]),
    );
    const profielPerRooster = new Map(
      (await prisma.baseRoster.findMany({ where: { depot: LOCATIE }, select: { code: true, profile: true } })).map(
        (rooster) => [rooster.code, rooster.profile],
      ),
    );
    const minVerschil = Math.ceil(context.requiredDuties * MIN_DIFFERENT_SHARE);

    toon("Officieel rooster", officieel);
    for (const kandidaat of run.candidates) {
      const toewijzingen = kandidaat.assignments as unknown as CandidateAssignment[];
      const diensten = toewijzingen.filter((entry) => entry.positionType === "DUTY");
      const gevuld = diensten.filter((entry) => entry.dutyCode !== null);
      const uniek = new Set(gevuld.map((entry) => `${entry.dutyCode}|${entry.weekday}`));
      const profielfouten = gevuld.filter((entry) => {
        const dienst = dienstPerSleutel.get(`${entry.dutyCode}|${entry.weekday}`);
        const profiel = profielPerRooster.get(entry.baseRosterCode);
        return !dienst || !profiel || !profileAllowsDuty(profiel, dienst.kinds as never);
      });
      const vroegInLn = gevuld.filter(
        (entry) =>
          profielPerRooster.get(entry.baseRosterCode) === "LAAT_NACHT" &&
          (dienstPerSleutel.get(`${entry.dutyCode}|${entry.weekday}`)?.kinds ?? []).includes("VROEG"),
      );
      const samenvatting = kandidaat.validationSummary as { tally?: { confirmedHardViolations: number } } | null;
      console.log(`\n  ${kandidaat.scenarioLabel}`);
      toets(
        `alle dienstdagen gevuld`,
        gevuld.length === diensten.length && uniek.size === context.requiredDuties,
        `${uniek.size}/${context.requiredDuties}`,
      );
      toets("geen dienst buiten het roosterprofiel", profielfouten.length === 0, `${profielfouten.length}`);
      toets("geen vroege dienst in Laat/Nacht", vroegInLn.length === 0, `${vroegInLn.length}`);
      toets(
        "nul bevestigde harde overtredingen",
        samenvatting?.tally?.confirmedHardViolations === 0,
        `${samenvatting?.tally?.confirmedHardViolations ?? "?"} · ${kandidaat.validationState}`,
      );
      toon("Kwaliteit", kandidaat.qualityMetrics as unknown as PackageQuality);
    }
    for (let a = 0; a < run.candidates.length; a += 1) {
      for (let b = a + 1; b < run.candidates.length; b += 1) {
        const d = verschil(
          run.candidates[a].assignments as unknown as CandidateAssignment[],
          run.candidates[b].assignments as unknown as CandidateAssignment[],
        );
        toets(`kandidaat ${a + 1} en ${b + 1} verschillen genoeg`, d >= minVerschil, `${d} dienstdagen (min ${minVerschil})`);
      }
    }
  }

  if (metStop || alleenStop) {
    console.log("\n4. Stoppen tijdens het rekenen");
    const runId = await createRunCore({
      actor: wie,
      locationCode: LOCATIE,
      strategy: "BALANCED",
      strategyLabel: "Meting stoppen",
      rosterYear: 2027,
      requestedCandidates: 3,
    });
    const taak = runGenerationJob(runId, wie);
    await new Promise((klaar) => setTimeout(klaar, 12_000));
    const gevraagd = Date.now();
    await prisma.generationRun.update({ where: { id: runId }, data: { cancelRequested: true } });
    await taak;
    const seconden = Math.round((Date.now() - gevraagd) / 1000);
    const run = await prisma.generationRun.findUniqueOrThrow({ where: { id: runId } });
    toets("opdracht staat op GESTOPT", run.status === "CANCELLED", `${run.status}: ${run.stageMessage}`);
    toets("stopt binnen 15 seconden na het verzoek", seconden <= 15, `${seconden}s`);
  }

  if (metHerbouw) {
    console.log("\n5. Gericht herbouwen");
    const ouder = await prisma.candidateRoster.findFirst({
      where: {
        generationRunId: { not: null },
        archivedAt: null,
        locationCode: LOCATIE,
        parentCandidateId: null,
        validationState: { in: ["TECHNICALLY_VALIDATED", "TECHNICALLY_VALID_UNVERIFIED_RULES"] },
      },
      orderBy: { generatedAt: "desc" },
      include: { generationRun: true },
    });
    if (!ouder?.generationRun) {
      toets("er is een kandidaat om te herbouwen", false, "genereer eerst");
    } else {
      const context = await loadQualityContextCore(LOCATIE);
      const runId = await createRunCore({
        actor: wie,
        locationCode: LOCATIE,
        strategy: ouder.generationRun.strategy,
        strategyLabel: ouder.generationRun.strategyLabel,
        rosterYear: ouder.generationRun.rosterYear,
        requestedCandidates: 1,
        kind: "REBUILD",
        parentCandidateId: ouder.id,
        adjustment: { goals: ["SHUNTING_FAIRNESS", "HOURS"], preserveGoodParts: true, note: "Meting herbouw" },
      });
      const begin = Date.now();
      await runGenerationJob(runId, wie);
      const run = await prisma.generationRun.findUniqueOrThrow({
        where: { id: runId },
        include: { candidates: true, adjustment: true },
      });
      console.log(
        `  ${run.status} · ${run.foundCandidates}/1 · ${Math.round((Date.now() - begin) / 1000)}s · ${run.stageMessage}`,
      );
      toets("herbouw is afgerond met één kandidaat", run.status === "COMPLETED" && run.candidates.length === 1, run.status);
      toets("de opmerking is bewaard bij de opdracht, niet als regel", run.adjustment?.note === "Meting herbouw");
      const kind = run.candidates[0];
      if (kind) {
        const toewijzingen = kind.assignments as unknown as CandidateAssignment[];
        const ouderToewijzingen = ouder.assignments as unknown as CandidateAssignment[];
        const samenvatting = kind.validationSummary as { tally?: { confirmedHardViolations: number } } | null;
        const gevuld = new Set(
          toewijzingen
            .filter((entry) => entry.positionType === "DUTY" && entry.dutyCode)
            .map((entry) => `${entry.dutyCode}|${entry.weekday}`),
        );
        const anders = verschil(ouderToewijzingen, toewijzingen);
        toets("herbouw is een kind van de ouder", kind.parentCandidateId === ouder.id);
        toets("herbouw verschilt van de ouder", anders >= 1, `${anders} dienstdagen`);
        toets("alle dienstdagen gevuld", gevuld.size === context.requiredDuties, `${gevuld.size}/${context.requiredDuties}`);
        toets("nul bevestigde harde overtredingen", samenvatting?.tally?.confirmedHardViolations === 0);
        const voor = measureAssignmentsCore(ouderToewijzingen, context);
        const na = measureAssignmentsCore(toewijzingen, context);
        for (const sub of na.subscores) {
          const oud = voor.subscores.find((entry) => entry.key === sub.key)?.score;
          console.log(`    ${sub.label.padEnd(28)} ${String(oud ?? "—").padStart(6)} → ${String(sub.score ?? "—").padStart(6)}`);
        }
      }
    }
  }

  console.log("\n" + "═".repeat(72));
  console.log(`${geslaagd} geslaagd, ${mislukt} mislukt`);
  await prisma.$disconnect();
  process.exit(mislukt === 0 ? 0 : 1);
}

function toon(naam: string, kwaliteit: PackageQuality): void {
  console.log(`  ${naam}: ${kwaliteit.subscores.map((s) => `${s.label} ${s.score ?? "—"}`).join(" · ")}`);
  console.log(
    `    nachten ${kwaliteit.nights.total}: ${kwaliteit.nights.threeOrMore} reeksen ≥3, ${kwaliteit.nights.pairs} paren, ${kwaliteit.nights.singletons} los · zware overgangen ${kwaliteit.transitions.heavy} · gewijzigd ${kwaliteit.changedDutyDays}`,
  );
  for (const rooster of kwaliteit.rosters) {
    console.log(
      `    ${rooster.code.padEnd(10)} ${formatHoursMinutes(rooster.hours.averageWeeklyCreditMinutes)} V${rooster.totals.early} L${rooster.totals.late} N${rooster.totals.night} R${rooster.totals.shunting} nachtreeksen [${rooster.nights.blocks.map((blok) => blok.length).join(",")}] zwaar ${rooster.transitions.heavy.length}`,
    );
  }
}

main().catch(async (fout) => {
  console.error(fout);
  await prisma.$disconnect();
  process.exit(1);
});
