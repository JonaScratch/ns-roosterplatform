/* eslint-disable */
// Browser-rooktest voor de ECHTE, draaiende Demo Room (geen fixture-renderer).
//
//   node demo-room/scripts/ui-smoke.cjs [basisUrl] [uitvoermap]
//   standaard: http://localhost:4173  en  demo-room/data/ui-smoke/
//
// Faalt (exitcode 1) zodra een pagina catastrofaal kaal rendert: stylesheet
// niet toegepast, reuzenlogo, ongestylede navigatie, geen kaarten, of een
// mislukt asset-verzoek. Dit is precies de storing die eerder alleen met het
// oog op te merken was. Maakt per route een screenshot voor visuele controle.
//
// Playwright is geen dependency van dit project; het script zoekt het in
// node_modules, in PLAYWRIGHT_MODULE, of in een globale installatie.

const path = require("node:path");
const fs = require("node:fs");

function laadPlaywright(stil) {
  const kandidaten = [process.env.PLAYWRIGHT_MODULE, "playwright", "/opt/node22/lib/node_modules/playwright"].filter(Boolean);
  for (const k of kandidaten) {
    try {
      return require(k);
    } catch {}
  }
  if (stil) return null;
  console.error("Playwright niet gevonden. Installeer met: npx playwright install chromium  (of zet PLAYWRIGHT_MODULE).");
  process.exit(3);
}

const ROUTES = ["dashboard", "test-room", "development-runs", "candidates", "vergelijken", "versies", "logboek", "experiment-detail"];

/** Meet één route in een open browser; geeft de problemen terug (leeg = in orde). Ook gebruikt door tests/demo-room/uiStates.browser.test.ts. */
async function meetRoute(browser, basis, route, uitDir) {
  const page = await browser.newPage({ viewport: { width: 1672, height: 1100 } });
  const mislukt = [];
  const consoleFouten = [];
  page.on("response", (r) => {
    if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) mislukt.push(`${r.status()} ${r.url()}`);
  });
  page.on("pageerror", (e) => consoleFouten.push(String(e)));
  await page.goto(`${basis}/#/${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);

  const m = await page.evaluate(() => {
    const cs = (el) => (el ? getComputedStyle(el) : null);
    const header = document.querySelector("header.app-header");
    const logo = document.querySelector(".brand-icon img");
    const nav = document.querySelector("#app-nav");
    const navKnop = document.querySelector("#app-nav button");
    const banner = document.getElementById("asset-fout");
    return {
      cssMarker: getComputedStyle(document.documentElement).getPropertyValue("--demo-room-css").trim(),
      headerBg: cs(header)?.backgroundColor ?? null,
      logoH: logo ? logo.getBoundingClientRect().height : null,
      navH: nav ? nav.getBoundingClientRect().height : null,
      navKnopBorder: cs(navKnop)?.borderTopStyle ?? null,
      bodyFont: cs(document.body).fontFamily,
      bannerZichtbaar: banner ? getComputedStyle(banner).display !== "none" : false,
      kaarten: document.querySelectorAll("#app-content .card, #app-content .stat").length,
      appGeladen: Boolean(window.__demoRoomAppGeladen),
      tekst: document.getElementById("app-content")?.innerText ?? "",
      headerTekst: header?.innerText ?? "",
      horizontaalScrollen: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });

  const problemen = [];
  if (m.cssMarker !== "1") problemen.push("styles.css niet toegepast (--demo-room-css ontbreekt)");
  if (!m.headerBg || m.headerBg === "rgba(0, 0, 0, 0)" || m.headerBg === "rgb(255, 255, 255)") problemen.push(`header heeft geen donkere achtergrond (${m.headerBg})`);
  if (m.logoH === null || m.logoH > 48) problemen.push(`logo te groot of afwezig (${m.logoH}px)`);
  if (m.navH === null || m.navH > 64) problemen.push(`navigatie ingeklapt/gestapeld (${m.navH}px hoog)`);
  if (m.navKnopBorder && m.navKnopBorder === "outset") problemen.push("navigatieknoppen hebben standaard-browseropmaak");
  if (/^\s*"?(Times|serif)/i.test(m.bodyFont)) problemen.push(`schreefletter als lichaamsfont (${m.bodyFont})`);
  if (m.bannerZichtbaar) problemen.push("asset-laadfout-banner is zichtbaar");
  if (!m.appGeladen) problemen.push("app.js niet uitgevoerd");
  if (m.kaarten === 0) problemen.push("geen enkele kaart/KPI gerenderd");
  if (m.horizontaalScrollen) problemen.push("pagina scrolt horizontaal");
  if (/in aanbouw/i.test(m.tekst)) problemen.push("pagina toont de 'in aanbouw'-plaatsvervanger (laden mislukt)");
  if (mislukt.length > 0) problemen.push(`mislukte verzoeken: ${mislukt.join(", ")}`);
  if (consoleFouten.length > 0) problemen.push(`paginafouten: ${consoleFouten.join(" | ")}`);

  if (uitDir) await page.screenshot({ path: path.join(uitDir, `${route.replace(/[^a-z0-9-]/gi, "_")}.png`), fullPage: true });
  await page.close();
  return { route, problemen, meting: m };
}

async function main() {
  const basis = process.argv[2] || "http://localhost:4173";
  const uitDir = process.argv[3] || path.join(__dirname, "..", "data", "ui-smoke");
  fs.mkdirSync(uitDir, { recursive: true });
  const { chromium } = laadPlaywright();
  const launchOpts = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
  const browser = await chromium.launch(launchOpts);
  const fouten = [];
  for (const route of ROUTES) {
    const { problemen, meting: m } = await meetRoute(browser, basis, route, uitDir);
    console.log(`${problemen.length === 0 ? "OK  " : "FOUT"} ${route.padEnd(18)} kaarten=${m.kaarten} logo=${m.logoH}px nav=${m.navH}px header=${m.headerBg}`);
    for (const p of problemen) console.log(`       - ${p}`);
    if (problemen.length > 0) fouten.push(route);
  }
  await browser.close();
  console.log(fouten.length === 0 ? `\nAlle ${ROUTES.length} routes renderen gestyled. Screenshots: ${uitDir}` : `\n${fouten.length} route(s) FOUT: ${fouten.join(", ")}`);
  process.exit(fouten.length === 0 ? 0 : 1);
}

module.exports = { meetRoute, laadPlaywright, ROUTES };

if (require.main === module) main().catch((e) => {
  console.error(e);
  process.exit(1);
});
