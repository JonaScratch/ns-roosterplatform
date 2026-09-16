import {
  FIRST_ROSTER_YEAR,
  currentRosterYear,
  describeRosterYear,
  rosterYear,
  rosterYearOf,
  secondSundayOfDecember,
  selectableRosterYears,
} from "@/domain/roster-year";
import { addDays, daysBetween, isoWeekday } from "@/domain/time";

/**
 * Het roosterjaar: december tot december, zonder gaten en zonder overlap.
 *
 * ## Wat hier wordt nagerekend en waarom zo grof
 *
 * De grens van een roosterjaar wordt één keer per jaar overschreden. Een fout
 * die alleen in 2031 optreedt — het jaar met drieënvijftig weken — merkt niemand
 * in een test die één jaar controleert.
 *
 * Daarom loopt dit script vijfentwintig opeenvolgende roosterjaren af en
 * controleert het élke dag daarin: valt hij in precies één roosterjaar? Dat zijn
 * ruim negenduizend dagen, en dat is de enige manier om "geen overlap en geen
 * ontbrekende dagen" niet te beweren maar te meten.
 *
 * Draaien met: npm run verify:rooster-year
 */

const EERSTE = FIRST_ROSTER_YEAR;
const AANTAL_JAREN = 25;

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

function main(): void {
  console.log("ROOSTERJAAR");
  console.log("═".repeat(72));

  const jaren = Array.from({ length: AANTAL_JAREN }, (_, index) => rosterYear(EERSTE + index));

  // ── 1. De grens zelf ──────────────────────────────────────────────────────
  console.log(`\n1. De tweede zondag van december (${AANTAL_JAREN + 1} jaren)`);

  const nietZondag: string[] = [];
  const verkeerdeRang: string[] = [];
  for (let jaar = EERSTE - 1; jaar <= EERSTE + AANTAL_JAREN; jaar += 1) {
    const grens = secondSundayOfDecember(jaar);
    if (isoWeekday(grens) !== 7) {
      nietZondag.push(`${jaar}: ${grens}`);
    }
    // De tweede zondag valt per definitie op 8 tot en met 14 december.
    const dag = Number(grens.slice(8, 10));
    if (grens.slice(0, 7) !== `${jaar}-12` || dag < 8 || dag > 14) {
      verkeerdeRang.push(`${jaar}: ${grens}`);
    }
  }
  toets("elke grens valt op een zondag", nietZondag.length === 0, nietZondag.join(", "));
  toets(
    "en op 8 tot en met 14 december, want dat is per definitie de tweede zondag",
    verkeerdeRang.length === 0,
    verkeerdeRang.join(", "),
  );

  // ── 2. Aansluiting ────────────────────────────────────────────────────────
  console.log("\n2. Aansluiting tussen opeenvolgende roosterjaren");

  const gaten: string[] = [];
  for (let index = 0; index < jaren.length - 1; index += 1) {
    if (jaren[index].endExclusive !== jaren[index + 1].start) {
      gaten.push(
        `${jaren[index].year} eindigt op ${jaren[index].endExclusive}, ` +
          `${jaren[index + 1].year} begint op ${jaren[index + 1].start}`,
      );
    }
  }
  toets(
    "het einde van elk jaar is exact het begin van het volgende",
    gaten.length === 0,
    gaten.slice(0, 3).join(" | "),
  );

  const verkeerdeLengte = jaren.filter((jaar) => jaar.days !== 364 && jaar.days !== 371);
  toets(
    "elk roosterjaar telt 52 of 53 hele weken",
    verkeerdeLengte.length === 0,
    verkeerdeLengte.map((jaar) => `${jaar.year}: ${jaar.days} dagen`).join(", "),
  );
  toets(
    "geen enkel roosterjaar heeft een halve week",
    jaren.every((jaar) => jaar.days % 7 === 0),
    jaren
      .filter((jaar) => jaar.days % 7 !== 0)
      .map((jaar) => `${jaar.year}`)
      .join(", "),
  );

  const lange = jaren.filter((jaar) => jaar.days === 371);
  console.log(
    `      ${lange.length} van de ${jaren.length} jaren tellen 53 weken: ` +
      `${lange.map((jaar) => jaar.year).join(", ")}`,
  );

  // ── 3. Elke dag in precies één roosterjaar ────────────────────────────────
  console.log("\n3. Elke dag in precies één roosterjaar");

  const eerste = jaren[0];
  const laatste = jaren[jaren.length - 1];
  const totaalDagen = daysBetween(eerste.start, laatste.endExclusive);

  const dubbel: string[] = [];
  const nergens: string[] = [];
  const verkeerdToegewezen: string[] = [];

  for (let offset = 0; offset < totaalDagen; offset += 1) {
    const dag = addDays(eerste.start, offset);
    const passend = jaren.filter((jaar) => dag >= jaar.start && dag < jaar.endExclusive);
    if (passend.length > 1) {
      dubbel.push(`${dag} in ${passend.map((jaar) => jaar.year).join(" en ")}`);
    } else if (passend.length === 0) {
      nergens.push(dag);
    } else if (rosterYearOf(dag).year !== passend[0].year) {
      // De opzoekfunctie moet hetzelfde antwoord geven als het aflopen van de
      // lijst. Zou dat verschillen, dan wijst het scherm een andere periode aan
      // dan de generator gebruikt.
      verkeerdToegewezen.push(`${dag}: lijst ${passend[0].year}, opzoeken ${rosterYearOf(dag).year}`);
    }
  }

  console.log(`      ${totaalDagen} dagen nagerekend, van ${eerste.start} tot ${laatste.lastDay}.`);
  toets("geen enkele dag zit in twee roosterjaren", dubbel.length === 0, dubbel.slice(0, 3).join(" | "));
  toets("geen enkele dag zit in geen roosterjaar", nergens.length === 0, nergens.slice(0, 3).join(", "));
  toets(
    "opzoeken geeft hetzelfde antwoord als aflopen",
    verkeerdToegewezen.length === 0,
    verkeerdToegewezen.slice(0, 3).join(" | "),
  );

  // ── 4. Schrikkeljaren ─────────────────────────────────────────────────────
  console.log("\n4. Schrikkeljaren");

  const schrikkeljaren: number[] = [];
  for (let jaar = EERSTE; jaar <= EERSTE + AANTAL_JAREN; jaar += 1) {
    if ((jaar % 4 === 0 && jaar % 100 !== 0) || jaar % 400 === 0) {
      schrikkeljaren.push(jaar);
    }
  }
  console.log(`      schrikkeljaren in bereik: ${schrikkeljaren.join(", ")}`);

  const febFouten: string[] = [];
  for (const jaar of schrikkeljaren) {
    // 29 februari bestaat en hoort in het roosterjaar met datzelfde jaartal:
    // februari ligt ruim vóór de decembergrens.
    const schrikkeldag = `${jaar}-02-29`;
    const gevonden = rosterYearOf(schrikkeldag);
    if (gevonden.year !== jaar) {
      febFouten.push(`${schrikkeldag} → roosterjaar ${gevonden.year}`);
    }
    if (daysBetween(`${jaar}-02-28`, `${jaar}-03-01`) !== 2) {
      febFouten.push(`${jaar}: 29 februari ontbreekt in de dagtelling`);
    }
  }
  toets("29 februari valt in het roosterjaar met hetzelfde jaartal", febFouten.length === 0, febFouten.join(" | "));

  const gewoneJaren = [EERSTE + 1, EERSTE + 2, EERSTE + 3].filter(
    (jaar) => !schrikkeljaren.includes(jaar),
  );
  toets(
    "in een gewoon jaar volgt 1 maart direct op 28 februari",
    gewoneJaren.every((jaar) => daysBetween(`${jaar}-02-28`, `${jaar}-03-01`) === 1),
  );

  // ── 5. De jaargrens in december ───────────────────────────────────────────
  console.log("\n5. De dagen rond de grens");

  const grensFouten: string[] = [];
  for (const jaar of jaren) {
    const dagVoorGrens = addDays(jaar.endExclusive, -1);
    if (rosterYearOf(dagVoorGrens).year !== jaar.year) {
      grensFouten.push(`${dagVoorGrens} hoort bij ${jaar.year} maar geeft ${rosterYearOf(dagVoorGrens).year}`);
    }
    if (rosterYearOf(jaar.endExclusive).year !== jaar.year + 1) {
      grensFouten.push(
        `${jaar.endExclusive} hoort bij ${jaar.year + 1} maar geeft ${rosterYearOf(jaar.endExclusive).year}`,
      );
    }
    if (rosterYearOf(jaar.start).year !== jaar.year) {
      grensFouten.push(`${jaar.start} hoort bij ${jaar.year} maar geeft ${rosterYearOf(jaar.start).year}`);
    }
  }
  toets(
    "de laatste dag hoort er nog bij en de eerstvolgende niet meer",
    grensFouten.length === 0,
    grensFouten.slice(0, 3).join(" | "),
  );

  // Oud en nieuw: 31 december en 1 januari liggen altijd ná de decembergrens en
  // horen dus bij hetzelfde roosterjaar.
  const oudEnNieuw: string[] = [];
  for (let jaar = EERSTE; jaar < EERSTE + AANTAL_JAREN - 1; jaar += 1) {
    const oud = rosterYearOf(`${jaar}-12-31`);
    const nieuw = rosterYearOf(`${jaar + 1}-01-01`);
    if (oud.year !== nieuw.year) {
      oudEnNieuw.push(`${jaar}-12-31 in ${oud.year}, ${jaar + 1}-01-01 in ${nieuw.year}`);
    }
    if (oud.year !== jaar + 1) {
      oudEnNieuw.push(`${jaar}-12-31 hoort bij roosterjaar ${jaar + 1}, niet ${oud.year}`);
    }
  }
  toets(
    "31 december en 1 januari vallen in hetzelfde roosterjaar",
    oudEnNieuw.length === 0,
    oudEnNieuw.slice(0, 3).join(" | "),
  );

  // ── 6. Nederlandse tijd ───────────────────────────────────────────────────
  console.log("\n6. Europe/Amsterdam");

  // 22:30 UTC op 12 december 2026 is 23:30 Nederlandse tijd op dezelfde dag —
  // nog nét roosterjaar 2026. Een uur later is het in Nederland 13 december en
  // dus roosterjaar 2027, terwijl het in UTC nog 12 december is.
  const voorMiddernacht = currentRosterYear(new Date("2026-12-12T22:30:00Z"));
  const naMiddernacht = currentRosterYear(new Date("2026-12-12T23:30:00Z"));
  toets(
    "vlak vóór middernacht in Nederland is het nog roosterjaar 2026",
    voorMiddernacht.year === 2026,
    `${voorMiddernacht.year}`,
  );
  toets(
    "en vlak erna roosterjaar 2027, terwijl het in UTC nog 12 december is",
    naMiddernacht.year === 2027,
    `${naMiddernacht.year}`,
  );

  const zomer = currentRosterYear(new Date("2027-07-01T12:00:00Z"));
  toets("midden in de zomer klopt het jaartal ook", zomer.year === 2027, `${zomer.year}`);

  // ── 7. Wat de planner kiest ───────────────────────────────────────────────
  console.log("\n7. De keuzelijst");

  const keuzes = selectableRosterYears(new Date("2026-09-06T12:00:00Z"));
  toets("er staan meerdere jaren in de lijst", keuzes.length >= 5, `${keuzes.length}`);
  toets(
    "de lijst begint niet vóór het eerste roosterjaar waarvoor een bron bestaat",
    keuzes.every((jaar) => jaar.year >= FIRST_ROSTER_YEAR),
  );
  toets(
    "de jaren staan op volgorde en sluiten op elkaar aan",
    keuzes.every(
      (jaar, index) => index === 0 || keuzes[index - 1].endExclusive === jaar.start,
    ),
  );
  toets(
    "het lopende roosterjaar staat erbij",
    keuzes.some((jaar) => jaar.year === currentRosterYear(new Date("2026-09-06T12:00:00Z")).year),
  );

  // ── 8. Wat een planner leest ──────────────────────────────────────────────
  console.log("\n8. De weergave");

  const voorbeeld = rosterYear(2027);
  const tekst = describeRosterYear(voorbeeld);
  console.log(`      roosterjaar 2027: ${tekst}`);
  toets(
    "de periode wordt met 'tot en met' en de laatste dag zelf getoond",
    tekst.includes("tot en met") && tekst.includes("11 december 2027"),
    tekst,
  );
  toets(
    "en niet met de dag die er net niet meer bij hoort",
    !tekst.includes("12 december 2027"),
    tekst,
  );
  toets(
    "de startdatum staat er in gewone taal bij",
    tekst.startsWith("zondag 13 december 2026"),
    tekst,
  );

  console.log(`\n${"═".repeat(72)}`);
  console.log(`${geslaagd} controles geslaagd, ${mislukt} mislukt.`);
  if (mislukt > 0) {
    process.exitCode = 1;
  }
}

main();
