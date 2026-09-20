import "dotenv/config";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CandidateAssignment } from "@/domain/candidate";
import { QUALITY_MODEL_V2 } from "@/domain/quality-model";
import { rhythmMetrics } from "@/domain/rhythm-metrics";
import type { Actor } from "@/server/auth/session";
import { prisma } from "@/server/data/prisma";
import { defaultOptimizerEngine, defaultSearchMode } from "@/server/generation/engine-flag";
import { runGenerationJob } from "@/server/generation/generation-job";
import { createRunCore } from "@/server/services/generation-service";
import {
  evaluateAssignmentsCore,
  evaluateOfficialCore,
  loadEvaluationContextCore,
} from "@/server/services/quality-evaluation-service";
import { candidateRosterInputs } from "@/server/services/roster-quality-service";
import { SCENARIOS } from "@/server/services/simulation-service";

/**
 * De drie kandidaatpakketten die de Roostercommissie gaat beoordelen.
 *
 * ## Waarom geen benchmarkrun
 *
 * De benchmark ruimt zijn kandidaten na elke run op; deze drie moeten blijven,
 * zodat ze in de simulatie te bekijken, te exporteren en te beoordelen zijn.
 * Het starten gaat daarom precies zoals de knop "Genereren" het doet
 * (`startGeneration` in de generatiedienst): dezelfde standaardmotor en
 * rekentijdmodus, drie kandidaten, strategie Evenwichtig. Alleen wacht dit script
 * op het einde in plaats van de opdracht op de achtergrond te laten lopen.
 *
 * ## Waarom de PDF via de website
 *
 * `export` haalt het pakket op via dezelfde route als de knop "Alle
 * basisroosters exporteren", met een kortlevende sessie van een lid van de
 * Roostercommissie die na afloop wordt ingetrokken. Zo is ook getoetst dat de
 * roosterweergave met het beoordelingsformulier voor elk basisrooster opent.
 * Er wordt geen wachtwoord gebruikt.
 *
 *   npm run human-benchmark:final -- generate
 *   npm run human-benchmark:final -- export      (ontwikkelserver moet draaien)
 */

const LOCATIE = "DDR";
const ROOSTERJAAR = 2027;
const COMMISSIELID = "900001";
const BASE_URL = process.env.VERIFY_BASE_URL ?? "http://localhost:3300";
const MAP = path.resolve(__dirname, "..", "..", "docs", "human-roster-benchmark", "final-candidates");
const RUNBESTAND = path.join(MAP, "run.json");

interface RunVerslag {
  readonly runId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly engine: string;
  readonly searchMode: string | null;
  readonly strategy: string;
  readonly candidates: readonly { id: string; number: number; label: string }[];
}

async function commissielid(): Promise<Actor> {
  const account = await prisma.userAccount.findFirstOrThrow({
    where: { employee: { employeeNumber: COMMISSIELID }, status: "ACTIVE" },
    select: { id: true, roles: true, employee: { select: { id: true, employeeNumber: true, depot: true } } },
  });
  if (!account.roles.includes("ROSTER_COMMITTEE")) {
    throw new Error(`${COMMISSIELID} is geen lid van de Roostercommissie.`);
  }
  return {
    sessionId: "human-calibration-final",
    userId: account.id,
    employeeId: account.employee.id,
    employeeNumber: account.employee.employeeNumber,
    roles: account.roles,
    authLevel: "PASSWORD" as Actor["authLevel"],
    depot: account.employee.depot,
  };
}

async function genereer(): Promise<void> {
  const actor = await commissielid();
  const scenario = SCENARIOS.find((entry) => entry.key === "BALANCED");
  if (!scenario) throw new Error("Strategie BALANCED ontbreekt.");
  const engine = defaultOptimizerEngine();
  const searchMode = engine === "adaptive" ? defaultSearchMode() : null;
  const runId = await createRunCore({
    actor,
    locationCode: LOCATIE,
    strategy: scenario.key,
    strategyLabel: `${scenario.label} — ter menselijke beoordeling (v1.0.4)`,
    rosterYear: ROOSTERJAAR,
    requestedCandidates: 3,
    engine,
    searchMode,
  });
  console.log(`Run ${runId} gestart (${engine}, ${searchMode ?? "—"}).`);
  const begin = new Date();
  await runGenerationJob(runId, actor);
  const einde = new Date();

  const run = await prisma.generationRun.findUniqueOrThrow({
    where: { id: runId },
    select: { status: true, failureReason: true, candidates: { orderBy: { candidateNumber: "asc" }, select: { id: true, candidateNumber: true, scenarioLabel: true } } },
  });
  if (run.status !== "COMPLETED" || run.candidates.length !== 3) {
    throw new Error(`Run ${runId}: ${run.status}, ${run.candidates.length} kandidaten. ${run.failureReason ?? ""}`);
  }
  mkdirSync(MAP, { recursive: true });
  const verslag: RunVerslag = {
    runId,
    startedAt: begin.toISOString(),
    finishedAt: einde.toISOString(),
    engine,
    searchMode,
    strategy: scenario.key,
    candidates: run.candidates.map((k) => ({ id: k.id, number: k.candidateNumber ?? 0, label: k.scenarioLabel })),
  };
  writeFileSync(RUNBESTAND, `${JSON.stringify(verslag, null, 2)}\n`);
  console.log(`Klaar in ${((einde.getTime() - begin.getTime()) / 1000).toFixed(0)} s: ${verslag.candidates.map((k) => k.id).join(", ")}`);
  await samenvatting(verslag);
}

/** Kwaliteit en ritme per kandidaat, met dezelfde meetlat als de benchmark. */
async function samenvatting(verslag: RunVerslag): Promise<void> {
  const context = await loadEvaluationContextCore(LOCATIE);
  const officieel = evaluateOfficialCore(context, QUALITY_MODEL_V2);
  const kandidaten = [];
  for (const k of verslag.candidates) {
    const rij = await prisma.candidateRoster.findUniqueOrThrow({
      where: { id: k.id },
      select: { assignments: true, validationState: true, validationSummary: true, provenance: true, qualityModelVersion: true, optimizerModelVersion: true },
    });
    const toewijzingen = rij.assignments as unknown as CandidateAssignment[];
    const rapport = evaluateAssignmentsCore(toewijzingen, context, QUALITY_MODEL_V2);
    const rosters = candidateRosterInputs(toewijzingen, context.quality);
    const ritme = rhythmMetrics(rosters, context.quality.duties, context.rules);
    const herkomst = (rij.provenance ?? {}) as Record<string, unknown>;
    const tally = (rij.validationSummary as { tally?: Record<string, unknown> } | null)?.tally ?? null;
    kandidaten.push({
      ...k,
      validationState: rij.validationState,
      validationTally: tally,
      qualityModelVersion: rij.qualityModelVersion,
      optimizerModelVersion: rij.optimizerModelVersion,
      provenance: { seed: herkomst.seed ?? null, attempt: herkomst.attempt ?? null, strategy: herkomst.strategy ?? null, whySurvived: herkomst.whySurvived ?? null },
      quality: {
        robust: rapport.robust,
        overall: rapport.overall,
        overallWithoutContinuity: rapport.overallWithoutContinuity,
        worstLine: rapport.lines.worst ? { roster: rapport.lines.worst.roster, lineNumber: rapport.lines.worst.lineNumber, score: rapport.lines.worst.score, facts: rapport.lines.worst.facts } : null,
        components: Object.fromEntries(Object.entries(rapport.components).map(([naam, c]) => [naam, c.score])),
        hardValid: rapport.hardValidity.hardValid,
        unassigned: rapport.hardValidity.coverage.unassigned,
        profileBreaches: rapport.hardValidity.profileBreaches.length,
        singletonNights: rapport.metrics.nights.singletons,
        twoNightBlocks: rapport.metrics.nights.blocks2,
        patternDistance: rapport.patternDistance?.total ?? null,
      },
      rhythm: {
        oscillations: ritme.oscillations,
        coherencePct: ritme.coherence === null ? null : ritme.coherence * 100,
        changesThroughRestPct: ritme.changesThroughRest === null ? null : ritme.changesThroughRest * 100,
        startJitterMean: ritme.startJitter.mean,
        startJitterP90: ritme.startJitter.p90,
        nightExitsToEarly: ritme.nights.exitsToEarly,
        nightMinRecoveryHours: ritme.nights.minRecoveryHours,
        nightExitValuePct: ritme.nights.exitValue === null ? null : ritme.nights.exitValue * 100,
        worstTransition: ritme.worstTransition,
        heavyTransitionLines: ritme.worstTransitionPerLine.filter((r) => r.penalty >= 3),
      },
      perRoster: rosters.map((rooster) => {
        const r = rhythmMetrics([rooster], context.quality.duties, context.rules);
        const regels = rapport.lines.all.filter((l) => l.roster === rooster.code && l.score !== null);
        return {
          roster: rooster.code,
          profile: rooster.profile,
          worstLineScore: regels.length ? Math.min(...regels.map((l) => l.score as number)) : null,
          nightBlocks: r.nights.lengths,
          nightMinRecoveryHours: r.nights.minRecoveryHours,
          oscillations: r.oscillations,
          startJitterMean: r.startJitter.mean,
          worstTransition: r.worstTransition,
        };
      }),
    });
  }
  writeFileSync(
    path.join(MAP, "summary.json"),
    `${JSON.stringify(
      {
        schema: "ns-human-calibration-final/1",
        measuredAt: new Date().toISOString(),
        qualityModel: QUALITY_MODEL_V2.version,
        run: verslag,
        official: { robust: officieel.robust, worstLine: officieel.lines.worst?.score ?? null, components: Object.fromEntries(Object.entries(officieel.components).map(([n, c]) => [n, c.score])) },
        candidates: kandidaten,
        note: "Nog door niemand beoordeeld. Dit zijn metingen, geen oordeel over hoe het rooster voor mensen voelt.",
      },
      null,
      2,
    )}\n`,
  );
  for (const k of kandidaten) {
    console.log(
      `Kandidaat ${k.number}: robuust ${k.quality.robust?.toFixed(1)} · slechtste regel ${k.quality.worstLine?.score?.toFixed(1)} · ` +
        `hard ${k.quality.hardValid ? "geldig" : "ONGELDIG"} · losse nachten ${k.quality.singletonNights} · kortste herstel ${k.rhythm.nightMinRecoveryHours?.toFixed(0)} u`,
    );
  }
}

function hashToken(token: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET ontbreekt.");
  return createHmac("sha256", secret).update(token).digest("hex");
}

async function exporteer(): Promise<void> {
  if (!existsSync(RUNBESTAND)) throw new Error("Nog geen run.json; draai eerst `generate`.");
  const verslag = JSON.parse(readFileSync(RUNBESTAND, "utf8")) as RunVerslag;
  const actor = await commissielid();
  const token = randomBytes(32).toString("base64url");
  const nu = Date.now();
  const sessie = await prisma.session.create({
    data: {
      userId: actor.userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(nu + 15 * 60_000),
      absoluteExpiry: new Date(nu + 30 * 60_000),
      clientFingerprint: "human-calibration-final",
    },
    select: { id: true },
  });
  const kop = { cookie: `nsr_session=${token}` };
  const context = await loadEvaluationContextCore(LOCATIE);
  const codes = context.quality.official.map((r) => r.code).sort();
  const fouten: string[] = [];
  try {
    for (const k of verslag.candidates) {
      // Elk basisrooster moet in de weergave openen, met het beoordelingsformulier.
      for (const code of codes) {
        const antwoord = await fetch(`${BASE_URL}/roostercommissie/simulatie/${k.id}/${code}`, { headers: kop, redirect: "manual" });
        const html = antwoord.status === 200 ? await antwoord.text() : "";
        if (antwoord.status !== 200) fouten.push(`${k.number} ${code}: HTTP ${antwoord.status}`);
        else if (!html.includes("beoordelen")) fouten.push(`${k.number} ${code}: geen beoordelingsformulier`);
      }
      const pdf = await fetch(`${BASE_URL}/roostercommissie/simulatie/${k.id}/pdf`, { headers: kop, redirect: "manual" });
      if (pdf.status !== 200 || pdf.headers.get("content-type") !== "application/pdf") {
        fouten.push(`${k.number} PDF: HTTP ${pdf.status} ${await pdf.text()}`);
        continue;
      }
      const bytes = Buffer.from(await pdf.arrayBuffer());
      if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") fouten.push(`${k.number} PDF: geen PDF-kop`);
      const bestand = path.join(MAP, `Kandidaat-${k.number}-alle-basisroosters.pdf`);
      writeFileSync(bestand, bytes);
      const bladen = (bytes.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
      console.log(`Kandidaat ${k.number}: ${codes.length} roosterweergaven geopend, PDF ${(bytes.length / 1024).toFixed(0)} kB, ${bladen} bladzijden → ${path.relative(process.cwd(), bestand)}`);
    }
  } finally {
    await prisma.session.update({ where: { id: sessie.id }, data: { revokedAt: new Date(), revokedReason: "exportscript klaar" } }).catch(async () => {
      await prisma.session.delete({ where: { id: sessie.id } });
    });
  }
  if (fouten.length > 0) {
    throw new Error(`Export niet schoon:\n  ${fouten.join("\n  ")}`);
  }
}

async function main() {
  const opdracht = process.argv[2];
  if (opdracht === "generate") await genereer();
  else if (opdracht === "export") await exporteer();
  else if (opdracht === "summary") await samenvatting(JSON.parse(readFileSync(RUNBESTAND, "utf8")) as RunVerslag);
  else throw new Error("Gebruik: generate | export | summary");
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
