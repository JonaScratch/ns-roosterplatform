// Applicatieschil van de Lyra Demo Room (§ UI/UX REBUILD): navigatie, routing,
// gedeelde header-status en het bevestigingsmodal voor onomkeerbare acties.
// Elke pagina is een eigen ES-module onder ./pages/ met een `mount(container)`
// die optioneel een cleanup-functie teruggeeft (voor `setInterval`s e.d.).

import { j } from "./lib/shared.js";

// Gelezen door de zelfdiagnose in index.html (asset-laadfout-banner).
window.__demoRoomAppGeladen = true;

const ROUTES = ["dashboard", "test-room", "development-runs", "candidates", "vergelijken", "versies", "logboek"];
// Subpagina's die ALLEEN via drilldown bereikbaar zijn (§ UI/UX REBUILD:
// "geen nieuw hoofdtabblad") — geen navigatieknop, maar wel een geldige
// route zodra er via een hash-link naartoe genavigeerd wordt.
const EXTRA_ROUTES = ["experiment-detail"];
const DEFAULT_ROUTE = "dashboard";

const content = document.getElementById("app-content");
const navButtons = document.querySelectorAll("#app-nav button");

let huidigeCleanup = null;

function huidigeRoute() {
  const raw = (location.hash || "").replace(/^#\/?/, "");
  const [route] = raw.split("?");
  return [...ROUTES, ...EXTRA_ROUTES].includes(route) ? route : DEFAULT_ROUTE;
}

function routeParams() {
  const raw = (location.hash || "").replace(/^#\/?/, "");
  const [, query] = raw.split("?");
  return new URLSearchParams(query || "");
}

function setActiveNav(route) {
  navButtons.forEach((b) => b.classList.toggle("active", b.dataset.route === route));
}

async function laadPagina(route) {
  if (typeof huidigeCleanup === "function") {
    try { huidigeCleanup(); } catch (fout) { console.error("opruimen vorige pagina mislukt:", fout); }
  }
  huidigeCleanup = null;
  setActiveNav(route);
  content.innerHTML = `<div class="empty">Laden…</div>`;
  try {
    const mod = await import(`./pages/${route}.js`);
    const result = await mod.mount(content, routeParams());
    if (typeof result === "function") huidigeCleanup = result;
  } catch (fout) {
    console.error(`Pagina "${route}" kon niet geladen worden:`, fout);
    content.innerHTML = `
      <div class="card">
        <h3>Deze pagina is nog in aanbouw</h3>
        <p class="sub">"${route}" is onderdeel van de UI/UX REBUILD en wordt in een volgende stap opgeleverd — nog geen fictieve inhoud hier zolang de echte pagina niet klaar is.</p>
      </div>`;
  }
}

navButtons.forEach((b) => b.addEventListener("click", () => { location.hash = `#/${b.dataset.route}`; }));
window.addEventListener("hashchange", () => laadPagina(huidigeRoute()));

// ---- Gedeeld bevestigingsmodal: nooit een onomkeerbare actie zonder expliciete klik hierop. ----
export function confirmAction({ title, bodyHtml, confirmLabel }) {
  return new Promise((resolve) => {
    const modal = document.getElementById("confirm-modal");
    document.getElementById("confirm-modal-title").textContent = title;
    document.getElementById("confirm-modal-body").innerHTML = bodyHtml;
    const okBtn = document.getElementById("confirm-modal-ok");
    okBtn.textContent = confirmLabel || "Bevestigen";
    const cancelBtn = document.getElementById("confirm-modal-cancel");
    const close = (result) => {
      modal.classList.remove("open");
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      resolve(result);
    };
    const onOk = () => close(true);
    const onCancel = () => close(false);
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    modal.classList.add("open");
  });
}

// ---- Header: actieve versie + actieve-run-status, overal zichtbaar ongeacht tabblad. ----
async function ververHeader() {
  try {
    const actief = await j("/api/versions/active");
    const el = document.getElementById("header-active-version");
    el.textContent = `${actief.displayName} actief`;
    el.className = `tag ${actief.status === "ACTIVE" ? "good" : actief.status === "FAILED" ? "bad" : "warn"}`;
  } catch (fout) {
    console.error("header-versie laden mislukt:", fout);
  }
  try {
    const run = await j("/api/current-run");
    document.getElementById("banner").textContent = run && (run.status === "RUNNING" || run.status === "STARTING") ? `● loopt: ${run.kind} (${run.runId})` : "geen actieve run";
  } catch (fout) {
    console.error("banner laden mislukt:", fout);
  }
}

setInterval(ververHeader, 5000);
ververHeader();
laadPagina(huidigeRoute());
