// Versies (§ UI/UX REBUILD): levenscyclusbeheer van Lyra-versies. Alleen de
// canonieke versieservice mag activeren/herstellen — deze pagina roept
// uitsluitend /api/rollback/execute (activeert een bestaande versie-id) en
// /api/publish/execute (publiceert een experiment als nieuwe versie) aan;
// er is geen Demo-Room-only "actieve status".

import { j, post, veilig, titleIcon, iconChip, ICONS } from "../lib/shared.js";
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
    <div class="card">
      <h3>${titleIcon("book", "#1f5fd0")}Lyra-versies<span class="card-sub">Levenscyclusbeheer van productieversies — activeren loopt altijd via de canonieke versieservice.</span></h3>
    </div>

    <div class="grid" id="vs-kpis" style="margin-bottom:14px;"></div>

    <div class="row">
      <div class="col">
        <div class="card">
          <h3>${titleIcon("chart", "#1f5fd0")}Versiegeschiedenis</h3>
          <table>
            <thead><tr><th>Versie</th><th>Status</th><th>Aangemaakt</th><th>Bron</th><th>Gem. dev-score</th><th>Acties</th></tr></thead>
            <tbody id="vs-rows"></tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="card" id="vs-detail" style="display:none;">
      <h3>${titleIcon("compare", "#1f5fd0")}Versiedetail — <span id="vs-detail-title"></span></h3>
      <div class="row">
        <div class="col">
          <div class="field-list">
            <div class="field-row" style="padding:6px 0; flex-direction:column;"><span class="field-label">Reden</span><span class="field-value" id="vs-detail-reden" style="font-weight:500; margin-top:2px;"></span></div>
            <div class="field-row" style="padding:6px 0; flex-direction:column;"><span class="field-label">Bronexperiment</span><span class="field-value" id="vs-detail-bron" style="font-weight:500; margin-top:2px;"></span></div>
            <div class="field-row" style="padding:6px 0; flex-direction:column;"><span class="field-label">Bekende beperkingen</span><span class="field-value" id="vs-detail-issues" style="font-weight:500; margin-top:2px;"></span></div>
          </div>
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
    { icon: "trophy", color: "amber", label: "Actieve versie", value: actief?.displayName ?? "—" },
    { icon: "book", color: "blue", label: "Totaal versies", value: alleVersies.length },
    { icon: "check", color: "green", label: "Beschikbaar", value: gepromoveerd },
    { icon: "x", color: "red", label: "Mislukt", value: mislukt },
    { icon: "clock", color: "navy", label: "Aangemaakt op", value: actief ? new Date(actief.createdAt).toLocaleDateString("nl-NL") : "—" },
  ];
  document.getElementById("vs-kpis").innerHTML = cards.map((c) => `
    <div class="stat with-icon">
      ${iconChip(c.icon, c.color)}
      <div>
        <div class="label">${c.label}</div>
        <div class="value">${c.value}</div>
      </div>
    </div>`).join("");
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
        <button class="ghost icon-btn" data-detail="${v.id}" title="Details">${ICONS.eye}</button>
        ${!isActief && v.canActivate ? `<button class="primary" data-activate="${v.id}">${ICONS.check}Activeren</button>` : ""}
        ${!isActief && !v.canActivate && v.reason ? `<span class="tag bad" title="${v.reason}">${ICONS.x}geblokkeerd</span>` : ""}
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
