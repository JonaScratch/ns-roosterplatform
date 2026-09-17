import "dotenv/config";
import { type CandidateAssignment, sealCandidate } from "@/domain/candidate";
import { candidateRejection } from "@/domain/candidate-acceptance";
import { classifyDuty, resolveDayparts } from "@/domain/duty-classification";
import { allowedKindsForProfile, profileAllowsDuty, rosterProfileLabel } from "@/domain/roster-profiles";
import type { DutyKind, RosterProfile } from "@/lib/generated/prisma/enums";
import { prisma } from "@/server/data/prisma";
import { BaselineOptimizer } from "@/server/optimizer/baseline-optimizer";
import { activeRuleset } from "@/server/rules-engine/ruleset/index";
import { nextMonday, validateCandidate } from "@/server/rules-engine/final-validator";
import { prismaCandidateData } from "@/server/rules-engine/final-validator-data";
import { buildOptimizerInput, inputDataVersion, scheduleVersion } from "@/server/services/simulation-service";

/**
 * Roosterprofielen: welke diensten waar mogen, en of dat overal hetzelfde is.
 *
 * ## Waarom dit een eigen meting is
 *
 * In v1.0.2 stond dienst 701 (05:01–13:00) in het Laat/Nacht-rooster van een
 * scenario. De oorzaak zat niet in de solver maar een laag dieper: rangeer- en
 * reservediensten hadden geen dagdeel, en een dienst zonder dagdeel mocht
 * overal. Dit script meet de hele keten opnieuw na, op de echte gegevens:
 *
 * 1. Het dagdeel in de database is hetzelfde als wat de code nu afleidt.
 * 2. Het huidige rooster respecteert elk profiel.
 * 3. Elke gegenereerde kandidaat respecteert elk profiel; Laat/Nacht heeft
 *    geen enkele vroege dienst.
 * 4. Zet iemand toch een vroege dienst in Laat/Nacht, dan ziet de eindvalidatie
 *    dat zelf, zonder de optimizer, en weigert de generatie de kandidaat. De
 *    eindvalidatie noemt het een *mogelijke* overtreding zolang de regel
 *    formeel niet is bevestigd; de generatiepoort weigert hem toch.
 *
 * Draaien met: npm run verify:profielen
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

const LOCATIE = "DDR";

async function main(): Promise<void> {
  console.log("ROOSTERPROFIELEN");
  console.log("═".repeat(72));

  console.log("\n0. De profielen zoals ze zijn ingesteld");
  const roosters = await prisma.baseRoster.findMany({
    where: { depot: LOCATIE },
    orderBy: { code: "asc" },
    select: { code: true, profile: true },
  });
  for (const rooster of roosters) {
    console.log(
      `  ${rooster.code.padEnd(10)} ${rosterProfileLabel(rooster.profile).padEnd(24)} ${allowedKindsForProfile(rooster.profile).join(", ")}`,
    );
  }
  const profielVan = new Map(roosters.map((rooster) => [rooster.code, rooster.profile]));

  console.log("\n1. Dagdeel in de database gelijk aan de afleiding in de code");
  const diensten = await prisma.duty.findMany({
    where: { depot: LOCATIE, package: { status: "ACTIVE" } },
    select: { code: true, weekday: true, startMinute: true, period: true, workType: true, kinds: true },
  });
  const afgeleid = resolveDayparts(
    diensten.map((dienst) => {
      const nummer = classifyDuty(dienst.code);
      return { ...dienst, period: nummer.period, workType: nummer.workType, kinds: nummer.kinds };
    }),
  );
  const verwacht = new Map(afgeleid.duties.map((dienst) => [`${dienst.code}|${dienst.weekday}`, dienst]));
  const afwijkend = diensten.filter((dienst) => {
    const code = verwacht.get(`${dienst.code}|${dienst.weekday}`);
    return (
      !code ||
      code.period !== dienst.period ||
      [...code.kinds].sort().join(",") !== [...dienst.kinds].sort().join(",")
    );
  });
  toets("elke dienst heeft in de database het afgeleide dagdeel", afwijkend.length === 0, `${diensten.length} diensten, ${afwijkend.length} afwijkend`);
  toets("geen dienst zonder eenduidig dagdeel", afgeleid.unresolved.length === 0, `${afgeleid.unresolved.length}`);
  const zonderDagdeel = diensten.filter((dienst) => !dienst.kinds.some((kind) => ["VROEG", "LAAT", "NACHT"].includes(kind)));
  toets("elke dienst heeft een dagdeel (geen dienst mag 'overal')", zonderDagdeel.length === 0, `${zonderDagdeel.length}`);
  for (const code of ["701", "702", "703", "601", "730", "731", "732"]) {
    const dagdelen = [...new Set(diensten.filter((dienst) => dienst.code === code).map((dienst) => dienst.period))];
    if (dagdelen.length > 0) {
      console.log(`    ${code}: ${dagdelen.join("/")}`);
    }
  }
  const kindsVan = new Map(diensten.map((dienst) => [`${dienst.code}|${dienst.weekday}`, dienst.kinds as DutyKind[]]));

  const buitenProfiel = (toewijzingen: readonly CandidateAssignment[]) =>
    toewijzingen.filter((entry) => {
      if (entry.positionType !== "DUTY" || !entry.dutyCode) return false;
      const profiel = profielVan.get(entry.baseRosterCode);
      const kinds = kindsVan.get(`${entry.dutyCode}|${entry.weekday}`);
      return !profiel || !kinds || !profileAllowsDuty(profiel, kinds);
    });
  const vroegInLn = (toewijzingen: readonly CandidateAssignment[]) =>
    toewijzingen.filter(
      (entry) =>
        profielVan.get(entry.baseRosterCode) === "LAAT_NACHT" &&
        entry.dutyCode !== null &&
        (kindsVan.get(`${entry.dutyCode}|${entry.weekday}`) ?? []).includes("VROEG"),
    );

  console.log("\n2. Het huidige rooster");
  const dagen = await prisma.rosterLineDay.findMany({
    where: { rosterLine: { baseRoster: { depot: LOCATIE, status: { in: ["ACTIVE", "DRAFT"] } } } },
    select: {
      weekIndex: true,
      weekday: true,
      positionType: true,
      dutyCode: true,
      rosterLine: { select: { lineNumber: true, baseRoster: { select: { code: true } } } },
    },
  });
  const officieel: CandidateAssignment[] = dagen.map((dag) => ({
    baseRosterCode: dag.rosterLine.baseRoster.code,
    lineNumber: dag.rosterLine.lineNumber,
    weekIndex: dag.weekIndex,
    weekday: dag.weekday,
    positionType: dag.positionType,
    dutyCode: dag.dutyCode,
  }));
  toets("elke plaatsing in het huidige rooster past bij het profiel", buitenProfiel(officieel).length === 0, `${officieel.filter((entry) => entry.dutyCode).length} plaatsingen, ${buitenProfiel(officieel).length} buiten profiel`);

  console.log("\n3. Gegenereerde kandidaten");
  const kandidaten = await prisma.candidateRoster.findMany({
    where: { locationCode: LOCATIE, generationRunId: { not: null } },
    select: { scenarioLabel: true, assignments: true },
  });
  if (kandidaten.length === 0) {
    console.log("  … geen kandidaten uit een generatieopdracht; niets te meten");
  }
  let totaalBuiten = 0;
  let totaalVroegLn = 0;
  for (const kandidaat of kandidaten) {
    const toewijzingen = kandidaat.assignments as unknown as CandidateAssignment[];
    totaalBuiten += buitenProfiel(toewijzingen).length;
    totaalVroegLn += vroegInLn(toewijzingen).length;
  }
  if (kandidaten.length > 0) {
    toets(`geen dienst buiten het profiel in ${kandidaten.length} kandidaten`, totaalBuiten === 0, `${totaalBuiten}`);
    toets("geen vroege dienst in Laat/Nacht", totaalVroegLn === 0, `${totaalVroegLn}`);
  }

  console.log("\n4. Een vroege dienst in Laat/Nacht: de eindvalidatie ziet hem, de generatie weigert hem");
  const input = await buildOptimizerInput(LOCATIE);
  const nulmeting = await new BaselineOptimizer("REPRODUCE").generate(input, "Meting profielgrens");
  if (nulmeting.status !== "CANDIDATE_GENERATED") {
    toets("nulmeting als uitgangspunt", false, nulmeting.reason);
  } else {
    const toewijzingen = [...nulmeting.candidate.assignments];
    // Ruil op dezelfde weekdag een dienst uit Laat/Nacht met een vroege dienst
    // uit Vroeg. De dekking blijft kloppen; alleen de profielen niet meer.
    const ln = toewijzingen.findIndex((entry) => profielVan.get(entry.baseRosterCode) === "LAAT_NACHT" && entry.dutyCode);
    const v = toewijzingen.findIndex(
      (entry) =>
        profielVan.get(entry.baseRosterCode) === ("VROEG" as RosterProfile) &&
        entry.dutyCode &&
        entry.weekday === toewijzingen[ln].weekday,
    );
    const lnDienst = toewijzingen[ln].dutyCode;
    toewijzingen[ln] = { ...toewijzingen[ln], dutyCode: toewijzingen[v].dutyCode };
    toewijzingen[v] = { ...toewijzingen[v], dutyCode: lnDienst };
    const { hash: _oud, ...rest } = nulmeting.candidate;
    void _oud;
    const mutant = sealCandidate({ ...rest, assignments: toewijzingen });
    console.log(
      `    ${toewijzingen[ln].baseRosterCode} regel ${toewijzingen[ln].lineNumber} dag ${toewijzingen[ln].weekday}: ${lnDienst} → ${toewijzingen[ln].dutyCode}`,
    );
    const review = await validateCandidate(
      mutant,
      {
        sourceScheduleVersion: await scheduleVersion(LOCATIE),
        rulesetVersion: activeRuleset().version,
        inputDataVersion: await inputDataVersion(LOCATIE),
        anchorMonday: nextMonday(),
      },
      prismaCandidateData,
    );
    const profielRegel = review.perRule.find((entry) => entry.ruleId === "ROSTER_PROFILE_BOUNDS");
    toets("de profielgrens slaat aan", profielRegel !== undefined, profielRegel ? `${profielRegel.uniqueViolations} bevindingen, ${profielRegel.confidence}` : "geen bevinding");
    // Zolang de regel formeel niet is bevestigd, meldt de eindvalidatie dit als
    // mogelijke overtreding. De generatie bewaart zo'n kandidaat toch nooit;
    // dat is wat hier wordt nagerekend, met dezelfde poort die de generatie
    // gebruikt.
    console.log(`    eindvalidatie: ${review.status}, ${review.tally.confirmedHardViolations} bevestigd`);
    const afwijzing = candidateRejection(review);
    toets("de generatie weigert deze kandidaat", afwijzing !== null, afwijzing ?? "zou worden bewaard");
    toets("de weigering noemt het roosterprofiel", afwijzing?.includes("roosterprofiel") ?? false);
  }

  console.log("\n" + "═".repeat(72));
  console.log(`${geslaagd} geslaagd, ${mislukt} mislukt`);
  await prisma.$disconnect();
  process.exit(mislukt === 0 ? 0 : 1);
}

main().catch(async (fout) => {
  console.error(fout);
  await prisma.$disconnect();
  process.exit(1);
});
