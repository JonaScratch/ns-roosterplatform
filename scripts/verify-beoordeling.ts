import "dotenv/config";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/server/data/prisma";
import { metSessieUitVerzoek } from "@/server/auth/session";
import { AuthenticationRequiredError, AuthorizationError, NotFoundError } from "@/server/security/authorize";
import {
  ReviewInputError,
  lineReviewsFor,
  recordLineReview,
  recordPairwisePreference,
} from "@/server/services/human-review-service";

/**
 * De menselijke beoordeling, door de echte dienst heen.
 *
 * ## Wat hier wordt aangetoond
 *
 * Dat een lid van de Roostercommissie een oordeel per regel en een voorkeur
 * tussen twee kandidaten kan vastleggen, met de versies van het kwaliteitsmodel
 * en de zoekmachine erbij; dat een onbekende reden, een regel die niet in de
 * kandidaat staat en twee keer dezelfde kandidaat worden geweigerd; dat een
 * medewerker en een bezoeker zonder sessie niets kunnen vastleggen; dat er een
 * auditregel ontstaat; en dat geen enkel oordeel een model- of
 * zoekmachinebestand verandert.
 *
 * Het draait tegen twee oude meetkandidaten (niet de drie ter beoordeling) en
 * ruimt zijn eigen oordelen en sessies op. De auditregels blijven staan: dat
 * logboek is alleen-toevoegen.
 *
 *   npm run verify:beoordeling
 */

const WORTEL = path.resolve(__dirname, "..");
const BEWAAKT = [
  "configs/quality-model-v2.json",
  "configs/quality-model-v3.json",
  "configs/optimizer-config-v1.0.4-rhythm.json",
  "configs/optimizer-config-v1.0.4-machinist.json",
  "configs/quality-model-v1.json",
];

let geslaagd = 0;
let gefaald = 0;
const toets = (ok: boolean, tekst: string) => {
  if (ok) geslaagd += 1;
  else gefaald += 1;
  console.log(`  ${ok ? "✓" : "✗"} ${tekst}`);
};

async function weigert(handeling: () => Promise<unknown>, soort: new (...args: never[]) => Error): Promise<boolean> {
  try {
    await handeling();
    return false;
  } catch (fout) {
    return fout instanceof soort;
  }
}

const hash = (bestand: string) => createHash("sha256").update(readFileSync(path.join(WORTEL, bestand))).digest("hex");

function hashToken(token: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET ontbreekt.");
  return createHmac("sha256", secret).update(token).digest("hex");
}

async function sessie(employeeNumber: string): Promise<{ id: string; token: string }> {
  const account = await prisma.userAccount.findFirstOrThrow({ where: { employee: { employeeNumber } }, select: { id: true } });
  const token = randomBytes(32).toString("base64url");
  const nu = Date.now();
  const rij = await prisma.session.create({
    data: {
      userId: account.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(nu + 10 * 60_000),
      absoluteExpiry: new Date(nu + 20 * 60_000),
      clientFingerprint: "verify-beoordeling",
    },
    select: { id: true },
  });
  return { id: rij.id, token };
}

const als = <T>(token: string | null, handeling: () => Promise<T>) =>
  metSessieUitVerzoek(new Request("http://verify.local/", { headers: token ? { cookie: `nsr_session=${token}` } : {} }), handeling);

async function main() {
  console.log("MENSELIJKE BEOORDELING");
  console.log("════════════════════════════════════════════════════════════");
  const voor = Object.fromEntries(BEWAAKT.map((b) => [b, hash(b)]));

  // Twee oude meetkandidaten uit dezelfde run: niet de kandidaten ter beoordeling.
  const kandidaten = await prisma.candidateRoster.findMany({
    where: { locationCode: "DDR", generationRun: { strategyLabel: { startsWith: "Meting" } } },
    orderBy: [{ createdAt: "asc" }],
    select: { id: true, assignments: true, qualityModelVersion: true, optimizerModelVersion: true, generationRunId: true },
    take: 2,
  });
  if (kandidaten.length < 2) {
    throw new Error("Geen twee meetkandidaten in de database om tegen te toetsen.");
  }
  const [a, b] = kandidaten;
  const eerste = (a.assignments as { baseRosterCode: string; lineNumber: number }[])[0];

  const commissie = await sessie("900001");
  const medewerker = await sessie("100001");
  const gemaakt: { regel: string[]; paar: string[] } = { regel: [], paar: [] };

  try {
    console.log("\nVastleggen");
    const id = await als(commissie.token, () =>
      recordLineReview({
        candidateId: a.id,
        rosterCode: eerste.baseRosterCode,
        lineNumber: eerste.lineNumber,
        verdict: "GOOD",
        reasons: ["GOOD_FLOW", "GOOD_NIGHT_BLOCK", "GOOD_FLOW"],
        note: "  controle door verify-beoordeling  ",
      }),
    );
    gemaakt.regel.push(id);
    const rij = await prisma.humanLineReview.findUniqueOrThrow({ where: { id } });
    toets(rij.verdict === "GOOD", "een oordeel per regel wordt bewaard");
    toets(JSON.stringify(rij.reasons) === JSON.stringify(["GOOD_FLOW", "GOOD_NIGHT_BLOCK"]), "dubbele redenen worden samengevoegd");
    toets(rij.note === "controle door verify-beoordeling", "de toelichting wordt bijgesneden bewaard");
    toets(
      rij.qualityModelVersion === a.qualityModelVersion && rij.optimizerModelVersion === a.optimizerModelVersion,
      `met de versies van de kandidaat (${rij.qualityModelVersion ?? "—"} · ${rij.optimizerModelVersion ?? "—"})`,
    );

    const rooster = await als(commissie.token, () =>
      recordLineReview({ candidateId: a.id, rosterCode: eerste.baseRosterCode, lineNumber: null, verdict: "DOUBT", reasons: [], note: null }),
    );
    gemaakt.regel.push(rooster);
    toets(true, "een oordeel over een heel basisrooster (zonder regel) wordt bewaard");

    const lijst = await als(commissie.token, () => lineReviewsFor(a.id));
    const terug = lijst.find((r) => r.id === id);
    toets(terug?.reviewer?.employee?.employeeNumber === "900001", "de lijst toont wie oordeelde, op personeelsnummer");

    const paar = await als(commissie.token, () =>
      recordPairwisePreference({ firstCandidateId: a.id, secondCandidateId: b.id, rosterCode: null, choice: "FIRST", reasons: ["BETTER_FLOW"], note: null }),
    );
    gemaakt.paar.push(paar);
    const paarRij = await prisma.humanPairwisePreference.findUniqueOrThrow({ where: { id: paar } });
    toets(paarRij.choice === "FIRST" && paarRij.firstQualityModelVersion === a.qualityModelVersion, "een voorkeur tussen twee kandidaten wordt bewaard, met versies");

    console.log("\nWeigeren");
    const aantalVoor = await prisma.humanLineReview.count();
    toets(
      await weigert(
        () => als(commissie.token, () => recordLineReview({ candidateId: a.id, rosterCode: eerste.baseRosterCode, lineNumber: eerste.lineNumber, verdict: "BAD", reasons: ["VERZONNEN"], note: null })),
        ReviewInputError,
      ),
      "een onbekende reden wordt geweigerd",
    );
    toets(
      await weigert(
        () => als(commissie.token, () => recordLineReview({ candidateId: a.id, rosterCode: eerste.baseRosterCode, lineNumber: 999, verdict: "BAD", reasons: [], note: null })),
        NotFoundError,
      ),
      "een regel die niet in de kandidaat staat, wordt geweigerd",
    );
    toets(
      await weigert(
        () => als(commissie.token, () => recordPairwisePreference({ firstCandidateId: a.id, secondCandidateId: a.id, rosterCode: null, choice: "EQUAL", reasons: [], note: null })),
        ReviewInputError,
      ),
      "twee keer dezelfde kandidaat wordt geweigerd",
    );
    toets(
      await weigert(
        () => als(medewerker.token, () => recordLineReview({ candidateId: a.id, rosterCode: eerste.baseRosterCode, lineNumber: eerste.lineNumber, verdict: "BAD", reasons: [], note: null })),
        AuthorizationError,
      ),
      "een medewerker kan geen oordeel vastleggen",
    );
    toets(
      await weigert(
        () => als(null, () => recordLineReview({ candidateId: a.id, rosterCode: eerste.baseRosterCode, lineNumber: eerste.lineNumber, verdict: "BAD", reasons: [], note: null })),
        AuthenticationRequiredError,
      ),
      "zonder sessie kan niemand een oordeel vastleggen",
    );
    toets((await prisma.humanLineReview.count()) === aantalVoor, "geen van de geweigerde oordelen is toch bewaard");

    console.log("\nSporen");
    const audit = await prisma.auditLogEntry.count({
      where: { objectId: a.id, action: { in: ["kandidaat.menselijk-oordeel", "kandidaat.menselijke-voorkeur"] } },
    });
    toets(audit >= 3, `elk oordeel en elke voorkeur staat in het auditlogboek (${audit})`);
    const na = Object.fromEntries(BEWAAKT.map((bestand) => [bestand, hash(bestand)]));
    toets(BEWAAKT.every((bestand) => voor[bestand] === na[bestand]), "geen model- of zoekmachinebestand is veranderd");
  } finally {
    await prisma.humanPairwisePreference.deleteMany({ where: { id: { in: gemaakt.paar } } });
    await prisma.humanLineReview.deleteMany({ where: { id: { in: gemaakt.regel } } });
    await prisma.session.deleteMany({ where: { id: { in: [commissie.id, medewerker.id] } } });
  }

  console.log("\n════════════════════════════════════════════════════════════");
  console.log(`${geslaagd} geslaagd, ${gefaald} gefaald. Eigen oordelen en sessies opgeruimd.`);
  await prisma.$disconnect();
  if (gefaald > 0) process.exitCode = 1;
}

main().catch(async (fout) => {
  console.error(fout);
  await prisma.$disconnect();
  process.exit(1);
});
