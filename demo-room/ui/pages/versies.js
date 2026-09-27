// Versies (§ UI/UX REBUILD): levenscyclusbeheer van Lyra-versies. Alleen de
// canonieke versieservice mag activeren/herstellen — deze pagina roept
// uitsluitend /api/rollback/execute (activeert een bestaande versie-id) en
// /api/publish/execute (publiceert een experiment als nieuwe versie) aan;
// er is geen Demo-Room-only "actieve status".

import { j, post, veilig } from "../lib/shared.js";
import { confirmAction } from "../app.js";

const STATUS_LABEL = { ACTIVE: "ACTIEF", SUPERSEDED: "GEARCHIVEERD", ROLLED_BACK: "TERUGGEDRAAID", FAILED: "MISLUKT" };
const STATUS_TAG = { ACTIVE: "good", SUPERSEDED: "", ROLLED_BACK: "warn", FAILED: "bad" };
const LATENCY_KEYS = new Set(["latencyP50", "latencyP95"]);

let alleVersies = [];
let activeVersionId = null;

function gemMetric(metrics) {
  if (!metrics) return null;
  const waarden = Object.entries(metrics).filter(([k]) => !LATENCY_KEYS.has(k)).map(([, v]) => v).filter((v) => typeof v === "number");
  return waarden.length > 0 ? waarden.reduce((a, b) => a + b, 0) / waarden.length : null;
}

function html() {
  return `
    <div class="grid" id="vs-kpis" style="margin-bottom:14px;"></div>

    <div class="row">
      <div class="col">
        <div class="card">
          <h3>Versiegeschiedenis</h3>
          <table>
            <thead><tr><th>Versie</th><th>Status</th><th>Aangemaakt</th><th>Bron</th><th>Gem. dev-score</th><th>Acties</th></tr></thead>
            <tbody id="vs-rows"></tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="card" id="vs-detail" style="display:none;">
      <h3>Versiedetail — <span id="vs-detail-title"></span></h3>
      <div class="row">
        <div class="col">
          <p><b>Reden</b><br/><span id="vs-detail-reden"></span></p>
          <p><b>Bronexperiment</b><br/><span id="vs-detail-bron"></span></p>
          <p><b>Bekende beperkingen</b><br/><span id="vs-detail-issues"></span></p>
        </div>
        <div class="col">
          <table style="font-size:13px;">
            <thead><tr><th>Meting</th><th>Gem. score</th></tr></thead>
            <tbody id="vs-detail-metrics"></tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function renderKpis() {
  const actief = alleVersies.find((v) => v.id === activeVersionId);
  const gepromoveerd = alleVersies.filter((v) => v.status !== "FAILED").length;
  const mislukt = alleVersies.filter((v) => v.status === "FAILED").length;
  const cards = [
    { label: "Actieve versie", value: actief?.displayName ?? "—" },
    { label: "Totaal versies", value: alleVersies.length },
    { label: "Beschikbaar", value: gepromoveerd },
    { label: "Mislukt", value: mislukt },
    { label: "Aangemaakt op", value: actief ? new Date(actief.createdAt).toLocaleDateString("nl-NL") : "—" },
  ];
  document.getElementById("vs-kpis").innerHTML = cards.map((c) => `<div class="stat"><div class="label">${c.label}</div><div class="value">${c.value}</div></div>`).join("");
}

function renderRows() {
  const tbody = document.getElementById("vs-rows");
  if (alleVersies.length === 0) { tbody.innerHTML = `<tr><td colspan="6" class="empty">Nog geen versies.</td></tr>`; return; }
  tbody.innerHTML = alleVersies.map((v) => {
    const isActief = v.id === activeVersionId;
    const gemDev = gemMetric(v.benchmarkReference?.post);
    return `<tr>
      <td>${v.displayName}${isActief ? ' <span class="tag good">ACTIEF</span>' : ""}</td>
      <td><span class="tag ${STATUS_TAG[v.status] ?? ""}">${STATUS_LABEL[v.status] ?? v.status}</span></td>
      <td>${new Date(v.createdAt).toLocaleString("nl-NL")}</td>
      <td>${v.variantId ?? "—"}</td>
      <td>${gemDev !== null ? gemDev.toFixed(1) + "%" : "—"}</td>
      <td>
        <button class="ghost" data-detail="${v.id}">Details</button>
        ${!isActief && v.canActivate ? `<button class="ghost" data-activate="${v.id}">Activeren</button>` : ""}
        ${!isActief && !v.canActivate && v.reason ? `<span class="tag bad" title="${v.reason}">geblokkeerd</span>` : ""}
      </td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll("[data-detail]").forEach((btn) => btn.addEventListener("click", () => toonDetail(alleVersies.find((v) => v.id === btn.dataset.detail))));
  tbody.querySelectorAll("[data-activate]").forEach((btn) => btn.addEventListener("click", () => activeerVersie(alleVersies.find((v) => v.id === btn.dataset.activate))));
}

function toonDetail(versie) {
  if (!versie) return;
  document.getElementById("vs-detail").style.display = "block";
  document.getElementById("vs-detail-title").textContent = versie.displayName;
  document.getElementById("vs-detail-reden").textContent = versie.reasonForPromotion || "—";
  document.getElementById("vs-detail-bron").textContent = versie.sourceExperimentId ?? "—";
  document.getElementById("vs-detail-issues").textContent = versie.knownIssues?.length > 0 ? versie.knownIssues.join("; ") : "Geen bekende beperkingen vastgelegd.";

  const metricsBody = document.getElementById("vs-detail-metrics");
  if (!versie.benchmarkReference) {
    metricsBody.innerHTML = `<tr><td colspan="2" class="empty">Geen benchmarkreferentie vastgelegd voor deze versie.</td></tr>`;
  } else {
    const rows = [
      ["Dev (pre)", gemMetric(versie.benchmarkReference.pre)],
      ["Dev (post)", gemMetric(versie.benchmarkReference.post)],
      ["Holdout", gemMetric(versie.benchmarkReference.holdout)],
    ];
    metricsBody.innerHTML = rows.map(([label, v]) => `<tr><td>${label}</td><td>${v !== null ? v.toFixed(1) + "%" : "—"}</td></tr>`).join("");
  }
}

async function activeerVersie(versie) {
  if (!versie) return;
  const bevestigd = await confirmAction({
    title: `${versie.displayName} activeren?`,
    bodyHtml: `<p>Dit maakt <b>${versie.displayName}</b> de nieuwe actieve productie-Lyra (via de canonieke versieservice — dezelfde weg als een echte publicatie/rollback). De huidige actieve versie wordt gearchiveerd, niet verwijderd.</p>${versie.reasonForPromotion ? `<p class="sub">${versie.reasonForPromotion}</p>` : ""}`,
    confirmLabel: "Activeren",
  });
  if (!bevestigd) return;
  const result = await post("/api/rollback/execute", { versionId: versie.id });
  if (result.error) { alert(`Kon niet activeren: ${result.error}`); return; }
}

export async function mount(container, params) {
  container.innerHTML = html();

  async function laad() {
    const resp = await j("/api/versions");
    activeVersionId = resp.activeVersionId;
    let versies = resp.versions ?? [];
    // `listVersions()` laat de synthetische baseline-rij weg zodra er ooit
    // een echte versie is aangemaakt — zonder deze patch zou de actieve
    // versie (vaak nog de baseline) hier onterecht "onbekend" lijken.
    if (activeVersionId && !versies.some((v) => v.id === activeVersionId)) {
      const actief = await j("/api/versions/active");
      if (actief && !actief.error) {
        versies = [{ id: actief.versionId, displayName: actief.displayName, status: actief.status, createdAt: actief.activatedAt ?? new Date(0).toISOString(), sourceExperimentId: actief.sourceExperimentId, variantId: actief.variantId, benchmarkReference: actief.benchmarkReference, knownIssues: [], reasonForPromotion: "", canActivate: false, reason: null }, ...versies];
      }
    }
    alleVersies = versies.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    renderKpis();
    renderRows();
  }

  await veilig("versies", laad);

  const preselect = params?.get?.("id");
  if (preselect) {
    const versie = alleVersies.find((v) => v.id === preselect);
    if (versie) toonDetail(versie);
  }

  const interval = setInterval(() => veilig("versies", laad), 8000);
  return () => clearInterval(interval);
}
