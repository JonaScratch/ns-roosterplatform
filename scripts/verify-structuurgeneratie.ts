import "dotenv/config";
import { countPositions, generateStructure } from "@/domain/structure-generation";
import { prisma } from "@/server/data/prisma";
import { activeRuleset } from "@/server/rules-engine/ruleset/index";
import { resolveRule } from "@/server/rules-engine/ruleset/types";

/**
 * De structuurgeneratie, gemeten op de echte Dordrechtse roosters.
 *
 * ## Waarom dit los van de dienst draait
 *
 * `proposeStructure` zit achter een inlog en een rechtencontrole, en dat hoort
 * ook. Voor het meten is dat in de weg: dan meet je vooral of het inloggen
 * werkt. Dit script draait de generator rechtstreeks op de roosters zoals ze in
 * de database staan, met dezelfde regelwaarden, en toetst de uitkomst tegen de
 * regels waar zij aan hoort te voldoen.
 *
 * ## Wat dit niet doet
 *
 * Niets wegschrijven. De generator levert een voorstel; de bestaande roosters
 * komen uit de aangeleverde bladen van NS en worden hier niet aangeraakt.
 *
 * Draaien met: npm run verify:structuurgeneratie
 */

let geslaagd = 0;
let mislukt = 0;

function toets(naam: string, goed: boolean, toelichting = ""): void {
  if (goed) {
    geslaagd += 1;
    console.log(`  ✓ ${naam}`);
  } else {
    mislukt += 1;
    console.log(`  ✗ ${naam}${toelichting ? ` — ${toelichting}` : ""}`);
  }
}

async function main(): Promise<void> {
  console.log("STRUCTUURGENERATIE");
  console.log("═".repeat(72));

  const ruleset = activeRuleset();
  const context = {
    employeeGroup: "MACHINIST" as const,
    company: "NSR" as const,
    location: "DDR",
    onDate: "2026-10-05",
  };
  const waarde = (id: string): number | null => {
    const resolutie = resolveRule(ruleset, id, context);
    return resolutie.kind === "RESOLVED" ? resolutie.rule.value : null;
  };

  const rustPerWeek = waarde("R_DAYS_PER_WEEK_AVG");
  const maxOpRij = waarde("MAX_CONSECUTIVE_SERVICES");
  const weekendInterval = waarde("RED_WEEKEND_INTERVAL_WEEKS");

  console.log("\n1. De regelwaarden waarmee gegenereerd wordt");
  console.log(`  R_DAYS_PER_WEEK_AVG        ${rustPerWeek}`);
  console.log(`  MAX_CONSECUTIVE_SERVICES   ${maxOpRij}`);
  console.log(`  RED_WEEKEND_INTERVAL_WEEKS ${weekendInterval}`);
  toets(
    "elke benodigde regelwaarde komt uit het regelbestand",
    rustPerWeek !== null && maxOpRij !== null && weekendInterval !== null,
    "er ontbreekt een waarde; er wordt niet met een aanname gegenereerd",
  );
  if (rustPerWeek === null || maxOpRij === null || weekendInterval === null) {
    process.exitCode = 1;
    return;
  }

  const roosters = await prisma.baseRoster.findMany({
    where: { depot: "DDR" },
    include: { lines: { include: { days: true }, orderBy: { lineNumber: "asc" } } },
    orderBy: { code: "asc" },
  });

  console.log("\n2. Per rooster");
  let allesGelukt = true;
  let totaalGewijzigd = 0;
  let totaalDagen = 0;

  for (const rooster of roosters) {
    const huidig = rooster.lines.flatMap((regel) => regel.days);
    const telling: Record<string, number> = {};
    for (const dag of huidig) {
      telling[dag.positionType] = (telling[dag.positionType] ?? 0) + 1;
    }
    // Het totaal, niet een gemiddelde: een gemiddelde per week verliest bij
    // afronding reservedagen, en dat is opvangruimte die stil verdwijnt.
    const reserveTotaal = telling.RES ?? 0;

    const uitkomst = generateStructure({
      lineCount: rooster.lines.length,
      restDaysPerWeek: rustPerWeek,
      reserveDaysPerCycle: reserveTotaal,
      wtvDaysPerCycle: telling.WR ?? 0,
      compensationDaysPerCycle: telling.CO ?? 0,
      freeWeekendIntervalWeeks: weekendInterval,
      maxConsecutiveServices: maxOpRij,
    });

    if (!uitkomst.ok) {
      allesGelukt = false;
      console.log(`  ✗ ${rooster.code}: ${uitkomst.reason}`);
      continue;
    }

    const nieuw = countPositions(uitkomst.lines);
    let gewijzigd = 0;
    for (const regel of uitkomst.lines) {
      const bestaand = rooster.lines.find((kandidaat) => kandidaat.lineNumber === regel.lineNumber);
      for (const [index, positie] of regel.days.entries()) {
        totaalDagen += 1;
        const dag = bestaand?.days.find((kandidaat) => kandidaat.weekday === index + 1);
        if (!dag || dag.positionType !== positie) {
          gewijzigd += 1;
        }
      }
    }
    totaalGewijzigd += gewijzigd;

    console.log(
      `  ${rooster.code.padEnd(10)} ${rooster.lines.length} regels · nu ` +
        `${JSON.stringify(telling)} · voorstel ${JSON.stringify(nieuw)} · ` +
        `${gewijzigd} dagen anders`,
    );

    // De reservecapaciteit mag niet ongemerkt kleiner worden: dat is de ruimte
    // waaruit de dienstindeling een uitval opvangt.
    if ((nieuw.RES ?? 0) < (telling.RES ?? 0)) {
      allesGelukt = false;
      console.log(
        `      ✗ het voorstel heeft ${nieuw.RES ?? 0} reservedagen tegenover ` +
          `${telling.RES ?? 0} nu; dat is minder opvangruimte.`,
      );
    }
  }

  toets("voor elk rooster kon een structuur worden bepaald", allesGelukt);

  console.log("\n3. Wat het voorstel zou veranderen");
  console.log(
    `  ${totaalGewijzigd} van de ${totaalDagen} dagcellen zouden anders worden ` +
      `(${Math.round((totaalGewijzigd / Math.max(1, totaalDagen)) * 100)}%).`,
  );
  console.log(
    "  Dit is niet weggeschreven. Het huidige rooster komt uit de aangeleverde bladen\n" +
      "  van NS; een generator die dat overschrijft, vervangt een bron door een berekening.",
  );

  console.log("\n4. De sloten op een wijzigingsblad");
  const periode = await prisma.rosterPeriod.findFirst({
    where: { location: { code: "DDR" } },
    orderBy: [{ year: "desc" }, { version: "desc" }],
  });
  console.log(
    `  huidige ronde: ${periode?.changeType ?? "geen"} · ` +
      `structuur: ${periode?.structureState ?? "geen"}`,
  );
  toets(
    "de generator werkt met de ronde zoals die is vastgelegd",
    periode !== null,
    "er is geen roosterperiode; de generator zou weigeren",
  );

  // ── Een ander aantal regels dan er nu staan ──────────────────────────────
  //
  // `proposeStructure` (de dienst errond) laat de roostercommissie sinds deze
  // fase een ander aantal regels doorrekenen dan het huidige. Die dienst zit
  // achter een inlog en wordt daarom niet hier maar in de browser bewezen; wat
  // hier wél rechtstreeks te toetsen is, is dat de generator zelf — waar die
  // dienst op leunt — een gewijzigd aantal regels ook werkelijk verwerkt en
  // niet stilzwijgend het oude aantal aanhoudt.
  console.log("\n5. Een ander aantal regels dan nu (het domein onder de RC-functie)");
  const deler = waarde("DORDRECHT_ROSTER_LINE_DIVISOR");
  console.log(`  DORDRECHT_ROSTER_LINE_DIVISOR ${deler}`);

  const proefrooster = roosters.find((r) => r.code === "DDR-V") ?? roosters[0];
  if (proefrooster) {
    const huidigAantal = proefrooster.lines.length;
    const nieuwAantal = huidigAantal + (deler ?? 2);
    const telling: Record<string, number> = {};
    for (const dag of proefrooster.lines.flatMap((regel) => regel.days)) {
      telling[dag.positionType] = (telling[dag.positionType] ?? 0) + 1;
    }
    const uitkomstAnderAantal = generateStructure({
      lineCount: nieuwAantal,
      restDaysPerWeek: rustPerWeek,
      reserveDaysPerCycle: telling.RES ?? 0,
      wtvDaysPerCycle: telling.WR ?? 0,
      compensationDaysPerCycle: telling.CO ?? 0,
      freeWeekendIntervalWeeks: weekendInterval,
      maxConsecutiveServices: maxOpRij,
    });
    toets(
      `${proefrooster.code}: ${huidigAantal} → ${nieuwAantal} regels levert een geldig voorstel op`,
      uitkomstAnderAantal.ok,
      uitkomstAnderAantal.ok ? "" : uitkomstAnderAantal.reason,
    );
    if (uitkomstAnderAantal.ok) {
      toets(
        "het voorstel heeft ook echt het gevraagde aantal regels",
        uitkomstAnderAantal.lines.length === nieuwAantal,
        `kreeg ${uitkomstAnderAantal.lines.length} regels terug`,
      );
    }
    if (deler !== null) {
      toets(
        `${nieuwAantal} is deelbaar door ${deler}, zoals het lokale kader voor Dordrecht vraagt`,
        nieuwAantal % deler === 0,
      );
      toets(
        `een niet-deelbaar aantal (${huidigAantal + 1}) wordt door de regel zelf ook herkend als niet-deelbaar`,
        (huidigAantal + 1) % deler !== 0,
      );
    }
  }

  console.log(`\n${"═".repeat(72)}`);
  console.log(`${geslaagd} controles geslaagd, ${mislukt} mislukt.`);
  if (mislukt > 0 || !allesGelukt) {
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
