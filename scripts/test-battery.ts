import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * De volledige testbatterij, met de uitslag vastgelegd.
 *
 * ## Waarom dit geen samenvatting achteraf is
 *
 * "Alle tests draaien groen" is een zin die niemand kan natrekken. Dit script
 * draait de suites één voor één, bewaart per suite de opdracht, de uitkomst,
 * de laatste regels van de uitvoer en de duur, en schrijft dat naar
 * `docs/optimizer-benchmark/test-results.json`. Het ontwikkelrapport neemt die
 * tabel over. Faalt er iets, dan staat het er met de foutregel bij — ook in de
 * PDF.
 *
 * ## Waarom per suite te draaien
 *
 * De langlopende suites starten hun eigen processen. Wordt zo'n suite van
 * buitenaf onderbroken — een afgebroken sessie, een uitgeschakelde machine —
 * dan blijft de batterij wachten op iets wat niet meer draait. Daarom kan elke
 * suite apart worden gedraaid en wordt de uitslag samengevoegd met wat er al
 * staat, in plaats van dat alles opnieuw moet.
 *
 *   npm run test:battery                      alles
 *   npm run test:battery -- --snel            zonder de langlopende suites
 *   npm run test:battery -- --only Productie  één suite, uitslag samengevoegd
 */

const WORTEL = path.resolve(__dirname, "..");
const SNEL = process.argv.includes("--snel");
const ALLEEN = (() => {
  const index = process.argv.indexOf("--only");
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
})();

interface Suite {
  readonly name: string;
  readonly command: string;
  /** Langlopend: alleen in de volledige batterij. */
  readonly traag?: boolean;
  /** Heeft een draaiende ontwikkelserver nodig. */
  readonly server?: boolean;
}

const SUITES: readonly Suite[] = [
  { name: "Typecontrole", command: "npm run typecheck" },
  { name: "Codestijl", command: "npm run lint" },
  { name: "Eenheidstests", command: "npm test" },
  { name: "Mutatietests", command: "npm run verify:mutanten" },
  { name: "Regels", command: "npm run verify:rules" },
  { name: "Regeldekking", command: "npm run verify:rule-coverage" },
  { name: "Roosteruren", command: "npm run verify:roster-hours" },
  { name: "Kwaliteitsmodel", command: "npm run verify:quality" },
  { name: "Roosterkwaliteit", command: "npm run verify:kwaliteit" },
  { name: "Profielen", command: "npm run verify:profielen" },
  { name: "Menselijke beoordeling", command: "npm run verify:beoordeling" },
  { name: "Scenario's", command: "npm run verify:scenarios" },
  { name: "Structuurgeneratie", command: "npm run verify:structuurgeneratie" },
  { name: "Toegang per rol", command: "npm run verify:toegang", server: true },
  { name: "Schermen", command: "npm run verify:schermen", server: true },
  { name: "Doorloop (e2e)", command: "npm run verify:e2e", server: true, traag: true },
  { name: "Crashherstel", command: "npm run verify:crash-recovery", traag: true },
  { name: "Productiebouw", command: "npm run build", traag: true },
  { name: "Draagbare bundel", command: "npm run verify:portable", traag: true },
];

/** De laatste betekenisvolle regels: dat is wat een mens van een suite leest. */
function samenvatting(uitvoer: string): string {
  const regels = uitvoer
    .split(/\r?\n/)
    .map((regel) => regel.trim())
    .filter((regel) => regel.length > 0 && !regel.startsWith(">") && !/^npm (warn|notice)/i.test(regel));
  const laatste = regels.slice(-4).join(" · ");
  return laatste.length > 220 ? `${laatste.slice(0, 217)}…` : laatste;
}

interface Uitslag {
  name: string;
  command: string;
  ok: boolean;
  summary: string;
  seconds: number;
}

function main() {
  // --out: een eigen uitslagbestand per fase, zodat een eerdere uitslag bewaard blijft.
  const uit = process.argv.indexOf("--out");
  const doel = uit >= 0 && process.argv[uit + 1]
    ? path.resolve(WORTEL, process.argv[uit + 1])
    : path.join(WORTEL, "docs", "optimizer-benchmark", "test-results.json");
  // Wat er al staat blijft staan, tenzij dezelfde suite opnieuw draait.
  const eerder: Uitslag[] =
    existsSync(doel) && (ALLEEN !== null || SNEL)
      ? ((JSON.parse(readFileSync(doel, "utf8")) as { suites?: Uitslag[] }).suites ?? [])
      : [];
  const uitslagen: Uitslag[] = [];
  for (const suite of SUITES) {
    if (SNEL && suite.traag) {
      continue;
    }
    if (ALLEEN !== null && !suite.name.toLowerCase().includes(ALLEEN.toLowerCase())) {
      continue;
    }
    const begin = Date.now();
    process.stdout.write(`${suite.name.padEnd(24)} … `);
    const uitkomst = spawnSync(suite.command, {
      cwd: WORTEL,
      shell: true,
      encoding: "utf8",
      // De volledige uitvoer van elke e2e-meting naast de uitslag: een meting die
      // alleen in de volledige doorloop faalt, is anders niet te herleiden.
      env: { ...process.env, E2E_LOG_DIR: process.env.E2E_LOG_DIR ?? path.join(path.dirname(doel), "e2e-logs") },
      timeout: 30 * 60 * 1000,
      maxBuffer: 64 * 1024 * 1024,
    });
    const seconden = (Date.now() - begin) / 1000;
    const uitvoer = `${uitkomst.stdout ?? ""}\n${uitkomst.stderr ?? ""}`;
    const ok = uitkomst.status === 0;
    uitslagen.push({
      name: suite.name,
      command: suite.command.replace(/^npm run /, "npm run "),
      ok,
      summary: samenvatting(uitvoer),
      seconds: Math.round(seconden * 10) / 10,
    });
    console.log(`${ok ? "geslaagd" : "GEFAALD "} ${seconden.toFixed(1)} s`);
    if (!ok) {
      console.log(
        uitvoer
          .split(/\r?\n/)
          .filter((regel) => regel.trim().length > 0)
          .slice(-12)
          .map((regel) => `    ${regel}`)
          .join("\n"),
      );
    }
  }

  // Samenvoegen in de volgorde van SUITES, zodat de tabel leesbaar blijft.
  const samen = new Map<string, Uitslag>();
  for (const uitslag of [...eerder, ...uitslagen]) {
    samen.set(uitslag.name, uitslag);
  }
  const gesorteerd = SUITES.map((suite) => samen.get(suite.name)).filter((x): x is Uitslag => x !== undefined);
  writeFileSync(
    doel,
    `${JSON.stringify(
      {
        schema: "ns-test-battery/1",
        ranAt: new Date().toISOString(),
        full: gesorteerd.length === SUITES.length,
        suites: gesorteerd,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const gefaald = uitslagen.filter((uitslag) => !uitslag.ok);
  console.log(
    `\n${uitslagen.length - gefaald.length} van de ${uitslagen.length} suites geslaagd in ` +
      `${Math.round(uitslagen.reduce((som, uitslag) => som + uitslag.seconds, 0))} s.`,
  );
  console.log(`Geschreven: ${doel}`);
  if (gefaald.length > 0) {
    console.log(`Gefaald: ${gefaald.map((uitslag) => uitslag.name).join(", ")}`);
    process.exitCode = 1;
  }
}

main();
