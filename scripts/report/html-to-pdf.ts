import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Van HTML naar PDF, met de browser die er al staat.
 *
 * ## Waarom niet de eigen PDF-schrijver
 *
 * `src/server/export/pdf-writer.ts` schrijft roosterbladen: vaste tabellen,
 * vaste kolommen, geen regelafbreking. Dat is precies goed voor een blad dat
 * het huis uit gaat en dat overal hetzelfde moet zijn. Dit rapport is iets
 * anders: doorlopende tekst met tabellen die per meting van lengte verschillen
 * en met SVG-figuren. Die opmaak is de browser beter toevertrouwd, en de
 * handleiding en de brochure zijn op dezelfde manier gemaakt.
 *
 * ## Waarom geen bibliotheek
 *
 * Chrome of Edge staat op de machine waar dit draait. Een extra afhankelijkheid
 * van honderden megabytes voor één opdracht per release is die last niet waard.
 *
 *   npm run report:optimizer-pdf
 *   npm run report:human-pdf
 */

const WORTEL = path.resolve(__dirname, "..", "..");

const BROWSERS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

function browser(): string {
  const gevonden = BROWSERS.find((pad) => existsSync(pad));
  if (!gevonden) {
    throw new Error(
      "Geen Chrome of Edge gevonden. De PDF wordt met de browser gemaakt; " +
        `geprobeerd: ${BROWSERS.join(", ")}.`,
    );
  }
  return gevonden;
}

export function htmlNaarPdf(htmlPad: string, pdfPad: string): void {
  if (!existsSync(htmlPad)) {
    throw new Error(`Er is geen ${path.relative(WORTEL, htmlPad)}. Draai eerst npm run report:optimizer of report:human.`);
  }
  const uitvoerbaar = browser();
  // Een eigen profielmap: anders weigert een al draaiende browser de opdracht.
  const profiel = path.join(WORTEL, ".next", "cache", "pdf-profiel");
  execFileSync(
    uitvoerbaar,
    [
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
      "--no-pdf-header-footer",
      `--user-data-dir=${profiel}`,
      // Zonder wachttijd mist de PDF de lettertypen van Google Fonts.
      "--virtual-time-budget=20000",
      `--print-to-pdf=${pdfPad}`,
      `file:///${htmlPad.replace(/\\/g, "/")}`,
    ],
    { stdio: "pipe", timeout: 180_000 },
  );
  if (!existsSync(pdfPad)) {
    throw new Error("De browser heeft geen PDF geschreven.");
  }
}

function main() {
  // `human`: het leerrapport over de menselijke roosters; anders het v1.0.4-rapport.
  const naam =
    ({ human: "NS-Roosterplatform-Human-Roster-Learning-Report", "final-brain": "NS-Roosterplatform-v1.0.4-Final-Brain-Report" } as Record<string, string>)[process.argv[2] ?? ""] ?? "NS-Roosterplatform-v1.0.4-Optimizer-Development-Report";
  const html = path.join(WORTEL, "docs", `${naam}.html`);
  const pdf = path.join(WORTEL, "docs", `${naam}.pdf`);
  htmlNaarPdf(html, pdf);
  const grootte = statSync(pdf).size;
  console.log(`Geschreven: ${pdf}`);
  console.log(`  ${(grootte / 1024).toFixed(0)} kB`);
}

if (require.main === module) {
  main();
}
