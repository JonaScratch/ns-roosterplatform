import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";
import {
  type CandidateRoster,
  publicationEligible,
  simulationEligible,
} from "@/domain/candidate";
import { toCalendarDate } from "@/domain/time";
import { activeRuleset } from "@/server/rules-engine";
import { validateCandidate } from "@/server/rules-engine/final-validator";
import { prismaCandidateData } from "@/server/rules-engine/final-validator-data";
import { buildOptimizerInput } from "@/server/services/simulation-service";

/**
 * Scenario's: genereren, beoordelen, vergelijken en niet publiceren.
 *
 * ## Wat dit script wil bewijzen
 *
 * De kern is één onderscheid dat eerder ontbrak. Een scenario kan technisch
 * compleet en correct doorgerekend zijn terwijl de formele bronvalidatie van
 * het regelbestand nog niet rond is. Dat waren ooit dezelfde uitkomst
 * (`REJECTED`), en daardoor was een bruikbaar scenario onbruikbaar.
 *
 * Wat hier wordt nagerekend:
 *
 * 1. De opgeslagen kandidaat wordt echt beoordeeld — er komt een tally uit met
 *    een aantal beoordeelde toewijzingen boven nul.
 * 2. Ontbrekende formele bronnen leveren géén `CONFIRMED_HARD_VIOLATION` op.
 * 3. Een scenario zonder bevestigde overtreding is bruikbaar voor simulatie.
 * 4. Publicatie blijft geblokkeerd, in élke status, zolang het regelbestand
 *    niet formeel is bevestigd.
 * 5. Onzekerheid wordt per regel gegroepeerd in plaats van per toewijzing
 *    geteld — anders leest één ontbrekende parameter als duizenden fouten.
 * 6. De kandidaat overleeft een herstart: hij staat in de database, niet in
 *    het geheugen van een pagina.
 *
 * Draaien met een gevulde ontwikkeldatabase: npm run verify:scenarios
 */

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

let geslaagd = 0;
let mislukt = 0;
let geblokkeerd = 0;

function toets(naam: string, goed: boolean, toelichting = ""): void {
  if (goed) {
    geslaagd += 1;
    console.log(`  ✓ ${naam}`);
  } else {
    mislukt += 1;
    console.log(`  ✗ ${naam}${toelichting ? ` — ${toelichting}` : ""}`);
  }
}

function blokkade(naam: string, toelichting: string): void {
  geblokkeerd += 1;
  console.log(`  ⊘ ${naam} — ${toelichting}`);
}

function nextMonday(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const delta = (8 - day) % 7 || 7;
  return toCalendarDate(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + delta)),
  );
}

function toCandidate(row: {
  id: string;
  scenarioLabel: string;
  optimizerName: string;
  optimizerVersion: string;
  mode: string;
  legalStatus: string;
  sourceScheduleVersion: string;
  rulesetVersion: string;
  inputDataVersion: string;
  hash: string;
  generatedAt: Date;
  assignments: unknown;
  scoreBreakdown: unknown;
}): CandidateRoster {
  return {
    id: row.id,
    scenarioLabel: row.scenarioLabel,
    optimizerName: row.optimizerName,
    optimizerVersion: row.optimizerVersion,
    mode: row.mode,
    legalStatus: row.legalStatus,
    sourceScheduleVersion: row.sourceScheduleVersion,
    rulesetVersion: row.rulesetVersion,
    inputDataVersion: row.inputDataVersion,
    hash: row.hash,
    generatedAt: row.generatedAt.toISOString(),
    assignments: row.assignments as CandidateRoster["assignments"],
    scoreBreakdown: row.scoreBreakdown as CandidateRoster["scoreBreakdown"],
  } as CandidateRoster;
}

async function main(): Promise<void> {
  console.log("SCENARIO'S");
  console.log("═".repeat(66));

  const regelbestand = activeRuleset();
  console.log(
    `\nRegelbestand ${regelbestand.version}: ${regelbestand.legalStatus}, ` +
      `${regelbestand.missingPackages.length} ontbrekende pakketten.\n`,
  );

  const rijen = await prisma.candidateRoster.findMany({
    orderBy: { generatedAt: "desc" },
    take: 5,
  });

  if (rijen.length === 0) {
    blokkade(
      "een opgeslagen scenario om te beoordelen",
      "BLOCKED_BY_MISSING_DATA. Genereer eerst een scenario via Rooster Commissie → " +
        "Scenario's vergelijken.",
    );
    afsluiten();
    return;
  }

  // ── 1. De kandidaat is echt opgeslagen ──────────────────────────────────
  console.log("1. Het scenario is vastgelegd");
  const rij = rijen[0];
  console.log(`      Nieuwste scenario: "${rij.scenarioLabel}" (${rij.id.slice(0, 8)}).`);
  toets("het scenario staat in de database", rij.assignments !== null);
  const toewijzingen = (rij.assignments ?? []) as unknown as CandidateRoster["assignments"];
  toets(
    "het bevat toewijzingen",
    toewijzingen.length > 0,
    `${toewijzingen.length} toewijzingen`,
  );
  const dienstdagen = toewijzingen.filter(
    (entry) => entry.positionType === "DUTY" && entry.dutyCode !== null,
  ).length;
  toets("er staan dienstdagen in", dienstdagen > 0, `${dienstdagen} dienstdagen`);

  // Lezen over een tweede verbinding: wat daar niet staat, stond nergens.
  const tweede = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
  });
  const opnieuw = await tweede.candidateRoster.findUnique({ where: { id: rij.id } });
  await tweede.$disconnect();
  toets("het scenario is leesbaar over een tweede verbinding (overleeft een herstart)", opnieuw !== null);

  // ── 2. De validator kijkt echt ──────────────────────────────────────────
  console.log("\n2. De onafhankelijke validatie");
  const begin = Date.now();
  const review = await validateCandidate(
    toCandidate(rij),
    {
      sourceScheduleVersion: rij.sourceScheduleVersion,
      rulesetVersion: regelbestand.version,
      inputDataVersion: rij.inputDataVersion,
      anchorMonday: nextMonday(),
    },
    prismaCandidateData,
  );
  const duur = ((Date.now() - begin) / 1000).toFixed(1);
  console.log(`      Validatie duurde ${duur}s; status ${review.status}.`);

  toets(
    "de validator heeft daadwerkelijk toewijzingen beoordeeld",
    review.tally.checkedAssignments > 0,
    `${review.tally.checkedAssignments} beoordeeld`,
  );

  // ── 3. Onzekerheid is geen overtreding ──────────────────────────────────
  console.log("\n3. Onzekerheid wordt niet als overtreding geteld");
  const onbevestigd = regelbestand.legalStatus !== "LEGAL_RULESET_VERIFIED";
  if (onbevestigd && review.tally.confirmedHardViolations === 0) {
    toets(
      "een ontbrekende formele bron levert geen bevestigde overtreding op",
      review.status !== "CONFIRMED_HARD_VIOLATION",
      `status ${review.status}`,
    );
    toets(
      "en geen verzamelstatus die niet zegt wat er aan de hand is",
      review.status !== "REJECTED",
      `status ${review.status}`,
    );
  } else if (review.tally.confirmedHardViolations > 0) {
    toets(
      "een bevestigde overtreding wordt wél als zodanig gemeld",
      review.status === "CONFIRMED_HARD_VIOLATION",
      `status ${review.status}`,
    );
  }

  toets(
    "de status komt overeen met de tellers",
    (review.tally.confirmedHardViolations > 0) === (review.status === "CONFIRMED_HARD_VIOLATION"),
    `${review.tally.confirmedHardViolations} bevestigd bij status ${review.status}`,
  );

  // ── 4. Simulatie versus publicatie ──────────────────────────────────────
  console.log("\n4. Simulatie en publicatie staan los van elkaar");
  toets(
    "simulatiegeschiktheid volgt de status",
    review.simulationEligible === simulationEligible(review.status),
  );
  if (review.tally.confirmedHardViolations === 0 && review.tally.unvalidatableAssignments === 0) {
    toets(
      "een scenario zonder bevestigde overtreding is bruikbaar voor simulatie",
      review.simulationEligible,
      `status ${review.status}`,
    );
  }

  toets(
    "publicatie is geblokkeerd zolang het regelbestand niet formeel is bevestigd",
    review.publishable === false,
  );
  toets(
    "en dat oordeel volgt de expliciete regel, niet een aanname",
    publicationEligible({
      status: review.status,
      rulesetLegallyVerified: regelbestand.legalStatus === "LEGAL_RULESET_VERIFIED",
      missingRulePackages: regelbestand.missingPackages.length,
    }) === false,
  );
  toets(
    "de juridische status blijft simulatie",
    review.legalStatus === "SIMULATION_ONLY",
    review.legalStatus,
  );

  // ── 5. Bevindingen zijn gegroepeerd ─────────────────────────────────────
  console.log("\n5. Bevindingen zijn per regel gegroepeerd");
  const geraakt = review.uncertainties.reduce(
    (som, entry) => som + entry.affectedAssignments,
    0,
  );
  toets(
    "onzekerheid wordt per regel samengevat, niet per toewijzing opgesomd",
    review.uncertainties.length < 100,
    `${review.uncertainties.length} regelgroepen`,
  );
  if (review.uncertainties.length > 0) {
    toets(
      "elke groep noemt hoeveel toewijzingen hij raakt",
      review.uncertainties.every((entry) => entry.affectedAssignments > 0),
      `${geraakt} toewijzingen in totaal`,
    );
    toets(
      "elke groep noemt de regel waar het om gaat",
      review.uncertainties.every((entry) => entry.ruleId.length > 0),
    );
    console.log(`      Grootste groepen:`);
    for (const entry of review.uncertainties.slice(0, 3)) {
      console.log(`        ${entry.ruleId} (${entry.kind}): ${entry.affectedAssignments}`);
    }
  }

  toets(
    "de blokkades zijn gescheiden naar soort",
    Array.isArray(review.reasons.structural) &&
      Array.isArray(review.reasons.violations) &&
      Array.isArray(review.reasons.uncertainty) &&
      Array.isArray(review.reasons.formal),
  );
  toets(
    "de formele blokkade staat apart van de roosterbeoordeling",
    review.reasons.formal.length > 0,
    "verwacht: het regelbestand is niet bevestigd",
  );
  toets(
    "een onbevestigde bron staat niet bij de bevestigde overtredingen",
    review.reasons.violations.every((reden) => !reden.includes("niet formeel is bevestigd")),
  );

  // ── 6. Meerdere scenario's naast elkaar ─────────────────────────────────
  console.log("\n6. Meerdere scenario's");
  const bruikbaar = rijen.filter(
    (entry) =>
      simulationEligible(entry.validationState as Parameters<typeof simulationEligible>[0]) ||
      entry.validationState === "NOT_VALIDATED",
  );
  if (bruikbaar.length < 2) {
    blokkade(
      "twee vergelijkbare scenario's",
      `BLOCKED_BY_MISSING_DATA. ${bruikbaar.length} van de ${rijen.length} scenario's is ` +
        "bruikbaar; genereer er nog een om de vergelijking te meten.",
    );
  } else {
    const codes = bruikbaar.map((entry) => entry.sourceScheduleVersion);
    toets(
      "de vergelijkbare scenario's rusten op dezelfde bronroosterversie",
      new Set(codes).size === 1,
      `${new Set(codes).size} verschillende versies`,
    );
    toets(
      "elk vergelijkbaar scenario heeft een eigen kwaliteitsscore",
      bruikbaar.every(
        (entry) =>
          typeof (entry.scoreBreakdown as { overallQualityScore?: number } | null)
            ?.overallQualityScore === "number",
      ),
    );
  }

  await dienstidentiteitInDeOptimizer();

  afsluiten();
}

/**
 * Draagt de optimizer elke dienst apart, of alleen elk dienstnummer?
 *
 * Deze controle bestaat omdat het mis was en niemand het zag. De invoer voor de
 * optimizer leidde de weekdagen van een dienst af uit de roosterlijnen, op
 * dienstnummer. Dienst 101 van maandag en dienst 101 van donderdag hebben
 * andere tijden en zijn twee diensten, maar kregen zo allebei alle zeven
 * weekdagen. Uit 223 diensten kwamen 1251 "instanties" waarvan er 1028 een
 * sleutel deelden met een andere, en de boekhouding van de solver kon niet meer
 * sluiten: 1251 erin, 768 verantwoord. Elk CP-SAT-scenario werd daarom
 * geweigerd — terecht, want er raakte werk zoek, maar de oorzaak lag drie lagen
 * eerder.
 *
 * De twee eisen hieronder zijn precies wat er toen niet gold: één instantie per
 * dienst, en geen twee diensten met dezelfde sleutel.
 */
async function dienstidentiteitInDeOptimizer(): Promise<void> {
  console.log("\n7. De optimizer krijgt elke dienst apart aangeboden");

  // Via de diensten zelf, niet via de standplaats: een pakket kan aan een
  // standplaats hangen via `locationId` of alleen via de depotcode, en wie
  // maar één van die twee bevraagt, meldt "geen gegevens" terwijl ze er staan.
  const eersteDienst = await prisma.duty.findFirst({
    where: { package: { status: "ACTIVE" } },
    select: { depot: true },
  });
  const standplaats = eersteDienst ? { code: eersteDienst.depot } : null;
  if (!standplaats) {
    blokkade(
      "de dienstidentiteit in de optimizerinvoer",
      "BLOCKED_BY_MISSING_DATA. Er is geen standplaats met een actief dienstenpakket.",
    );
    return;
  }

  const input = await buildOptimizerInput(standplaats.code);
  const diensten = await prisma.duty.count({
    where: { package: { status: "ACTIVE" }, depot: standplaats.code },
  });

  const sleutels = new Map<string, number>();
  let instanties = 0;
  for (const duty of input.duties) {
    for (const weekday of new Set(duty.weekdays)) {
      instanties += 1;
      const sleutel = `${duty.code}|${weekday}`;
      sleutels.set(sleutel, (sleutels.get(sleutel) ?? 0) + 1);
    }
  }

  toets(
    "elke dienst uit het pakket levert precies één dienstinstantie op",
    instanties === diensten,
    `${diensten} diensten in het pakket, ${instanties} instanties`,
  );
  toets(
    "geen twee diensten delen dezelfde sleutel standplaats+weekdag+nummer",
    sleutels.size === instanties,
    `${sleutels.size} verschillende sleutels op ${instanties} instanties`,
  );
}

function afsluiten(): void {
  console.log(`\n${"═".repeat(66)}`);
  console.log(
    `${geslaagd} controles geslaagd, ${mislukt} mislukt, ${geblokkeerd} geblokkeerd door ` +
      "ontbrekende gegevens.",
  );
  if (mislukt > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
