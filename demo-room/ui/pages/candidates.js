// Candidates (§ UI/UX REBUILD, foto 4): alle kandidaten uit alle development
// runs, met echte benchmark/holdout/validator-deltas — nooit alleen de
// gepromoveerde, en nooit een verzonnen roosterkwaliteitscijfer.

import { j, groupedBarChart, fmtPp, veilig, titleIcon, iconChip, ICONS, renderStepper } from "../lib/shared.js";

const STATUS_FILTERS = ["Alle", "BESTE", "PROMOTIEKLAAR", "IN TEST", "VERWORPEN"];
const AGENT_DIMENSIES = ["contextResolution", "multiTurnContext", "machinistTaal", "toolChoice", "falsePremiseCorrection", "grounding", "causalClaims", "unnecessaryClarifications"];
const DIMENSIE_LABEL = {
  contextResolution: "Contextresolutie", multiTurnContext: "Multi-turn context", machinistTaal: "Machinisttaal",
  toolChoice: "Toolgebruik", falsePremiseCorrection: "Foutieve aannames", grounding: "Grounding",
  causalClaims: "Oorzakelijke claims", unnecessaryClarifications: "Te snel oordelen",
};

let alleKandidaten = [];
let zoekterm = "";
let statusFilter = "Alle";
let dimensieFilter = "Alle";
let geselecteerdeKandidaatId = null;

const QUICK_FILTER_ICON = { BESTE: "trophy", "IN TEST": "flask", PROMOTIEKLAAR: "check", VERWORPEN: "x" };

function html() {
  return `
    <div class="card">
      <h3>${titleIcon("users", "#1f5fd0")}Kandidatenoverzicht<span class="card-sub" style="margin-left:8px; font-weight:400; font-size:12px;">Sandboxkandidaten zijn geïsoleerde Lyra-varianten die automatisch zijn getest op benchmark, holdout, validator en roosterkwaliteit.</span></h3>
      <div class="row" style="align-items:flex-end;">
        <div class="col" style="max-width:260px;">
          <label>Zoeken</label>
          <input type="text" id="cd-search" placeholder="Kandidaat-id of omschrijving…" />
        </div>
        <div class="col" style="max-width:200px;">
          <label>Status</label>
          <select id="cd-status">${STATUS_FILTERS.map((s) => `<option value="${s}">${s}</option>`).join("")}</select>
        </div>
        <div class="col" style="max-width:240px;">
          <label>Dimensie</label>
          <select id="cd-dimensie"><option value="Alle">Alle</option>${AGENT_DIMENSIES.map((d) => `<option value="${d}">${DIMENSIE_LABEL[d]}</option>`).join("")}</select>
        </div>
        <div class="col" style="flex:0 0 auto; display:flex; gap:6px;">
          ${["BESTE", "IN TEST", "PROMOTIEKLAAR", "VERWORPEN"].map((s) => `<button class="ghost" data-quickfilter="${s}" style="padding:6px 10px;">${ICONS[QUICK_FILTER_ICON[s]]}${s}</button>`).join("")}
        </div>
      </div>
    </div>

    <div class="grid" id="cd-kpis" style="margin-bottom:14px;"></div>

    <div class="row">
      <div class="col">
        <div class="card">
          <h3>${titleIcon("chart", "#1f5fd0")}Kandidatenlijst</h3>
          <table>
            <thead><tr><th>Kandidaat</th><th>Run</th><th>Aangemaakt</th><th>Dimensie</th><th>Benchmark Δ</th><th>Holdout Δ</th><th>Validator</th><th>Status</th><th>Acties</th></tr></thead>
            <tbody id="cd-rows"></tbody>
          </table>
        </div>
      </div>
      <div class="col" style="max-width:300px;">
        <div class="card">
          <h3>${titleIcon("trophy", "#b9862c")}Beste kandidaat nu</h3>
          <div id="cd-best"></div>
        </div>
        <div class="card" id="cd-gates-card" style="display:none;">
          <h3>${titleIcon("shield", "#2f8f5b")}Gate status</h3>
          <div id="cd-gates"></div>
        </div>
      </div>
    </div>

    <div class="card" id="cd-detail" style="display:none;">
      <h3>${titleIcon("compare", "#1f5fd0")}Kandidaatdetail — <span id="cd-detail-title"></span>
        <span style="margin-left:auto; display:flex; gap:8px;">
          <button class="ghost" id="cd-detail-goto-experiment">${ICONS.flask}Bekijk experiment →</button>
          <button class="ghost" id="cd-detail-goto-vergelijken" style="display:none;">${ICONS.compare}Vergelijk →</button>
        </span>
      </h3>
      <div class="cd-detail-grid">
        <div>
          <p class="sub" style="margin:0 0 6px; font-size:12px;">Basis vs kandidaat per gemeten dimensie.</p>
          <div id="cd-detail-chart"></div>
        </div>
        <div class="cd-detail-wijzigingen">
          <h4 style="margin:0 0 8px; font-size:12.5px; color:#16233d; display:flex; align-items:center; gap:7px;">${titleIcon("lightbulb", "#c8791a", "sm")}Belangrijkste wijzigingen</h4>
          <ul id="cd-detail-changes" style="margin:0; padding-left:18px; font-size:13px; line-height:1.6;"></ul>
        </div>
      </div>
      <div class="cd-levenscyclus">
        <h4 style="margin:0 0 10px; font-size:12.5px; color:#16233d; display:flex; align-items:center; gap:7px;">${titleIcon("clock", "#1f5fd0", "sm")}Kandidaatgeschiedenis</h4>
        <div class="stepper" id="cd-detail-stepper"></div>
      </div>
    </div>
  `;
}

function statusVoorRij(row, besteId) {
  if (row.decision === "REJECTED") return "VERWORPEN";
  if (row.decision === "KEEP_TESTING") return "IN TEST";
  if (row.decision === "PROMOTION_CANDIDATE") return row.candidateId === besteId ? "BESTE" : "PROMOTIEKLAAR";
  return "IN TEST";
}
function statusTagClass(status) {
  if (status === "BESTE" || status === "PROMOTIEKLAAR") return "good";
  if (status === "VERWORPEN") return "bad";
  return "warn";
}
const STATUS_ICON = { BESTE: "trophy", PROMOTIEKLAAR: "check", "IN TEST": "flask", VERWORPEN: "x" };

function besteKandidaatId(rows) {
  const promoted = rows.filter((r) => r.decision === "PROMOTION_CANDIDATE" && r.benchmarkDelta !== null);
  if (promoted.length === 0) return null;
  return promoted.reduce((best, r) => (r.benchmarkDelta > best.benchmarkDelta ? r : best)).candidateId;
}

function renderKpis(rows) {
  const gepromoveerd = rows.filter((r) => r.decision === "PROMOTION_CANDIDATE");
  const verworpen = rows.filter((r) => r.decision === "REJECTED");
  const inTest = rows.filter((r) => r.decision === "KEEP_TESTING" || (r.decision !== "PROMOTION_CANDIDATE" && r.decision !== "REJECTED"));
  const gemVerbetering = gepromoveerd.length > 0
    ? gepromoveerd.reduce((s, r) => s + (r.benchmarkDelta ?? 0), 0) / gepromoveerd.length
    : null;

  const cards = [
    { icon: "users", color: "blue", label: "Totaal kandidaten", value: rows.length },
    { icon: "up", color: "green", label: "Beste verbetering", value: fmtPp(gemVerbetering), subClass: (gemVerbetering ?? 0) >= 0 ? "good" : "bad" },
    { icon: "check", color: "green", label: "Promotieklaar", value: gepromoveerd.length },
    { icon: "flask", color: "purple", label: "In test", value: inTest.length },
    { icon: "x", color: "red", label: "Verworpen", value: verworpen.length },
  ];
  document.getElementById("cd-kpis").innerHTML = cards.map((c) => `
    <div class="stat with-icon">
      ${iconChip(c.icon, c.color)}
      <div>
        <div class="label">${c.label}</div>
        <div class="value">${c.value}</div>
      </div>
    </div>`).join("");
}

function renderBest(rows, besteId) {
  const el = document.getElementById("cd-best");
  const beste = rows.find((r) => r.candidateId === besteId);
  if (!beste) { el.innerHTML = `<div class="empty">Nog geen kandidaat.</div>`; return; }
  el.innerHTML = `
    <span class="tag good">${ICONS.trophy}BESTE</span>
    <p style="margin:10px 0 2px; font-size:14px;"><b>${beste.candidateId}</b></p>
    <p class="sub" style="margin:0 0 10px; font-size:12px;">Doel: ${DIMENSIE_LABEL[beste.targetedWeakness] ?? beste.targetedWeakness ?? "onbekend"}</p>
    <div class="field-list">
      <div class="field-row" style="padding:6px 0;"><div style="flex:1;"><span class="field-label">Benchmark</span></div><div class="field-value" style="color:${(beste.benchmarkDelta ?? 0) >= 0 ? "var(--good)" : "var(--bad)"};">${fmtPp(beste.benchmarkDelta)}</div></div>
      <div class="field-row" style="padding:6px 0;"><div style="flex:1;"><span class="field-label">Holdout</span></div><div class="field-value" style="color:${(beste.holdoutDelta ?? 0) >= 0 ? "var(--good)" : "var(--bad)"};">${fmtPp(beste.holdoutDelta)}</div></div>
      <div class="field-row" style="padding:6px 0;"><div style="flex:1;"><span class="field-label">Validator</span></div><div class="field-value">${beste.validator ?? "—"}</div></div>
    </div>
    <p class="sub" style="margin:10px 0 0; font-size:12px;">${beste.reasoning}</p>
    <div style="display:flex; gap:8px; margin-top:12px;">
      <button class="primary" style="flex:1;" data-detail="${beste.candidateId}">${ICONS.eye}Bekijk</button>
      ${beste.versionId ? `<button class="ghost" style="flex:1;" data-goto-version="${beste.versionId}">${ICONS.compare}Vergelijk</button>` : ""}
    </div>
  `;
  const detailBtn = el.querySelector("[data-detail]");
  if (detailBtn) detailBtn.addEventListener("click", () => {
    geselecteerdeKandidaatId = beste.candidateId;
    toonDetail(beste);
  });
  const versionBtn = el.querySelector("[data-goto-version]");
  if (versionBtn) versionBtn.addEventListener("click", () => { location.hash = `#/vergelijken?target=${encodeURIComponent(beste.versionId)}`; });
}

function renderRows(rows, besteId) {
  const tbody = document.getElementById("cd-rows");
  if (rows.length === 0) { tbody.innerHTML = `<tr><td colspan="9" class="empty">Geen kandidaten gevonden voor deze filters.</td></tr>`; return; }
  tbody.innerHTML = rows.map((r) => {
    const status = statusVoorRij(r, besteId);
    return `<tr data-row-id="${r.candidateId}" class="${r.candidateId === geselecteerdeKandidaatId ? "selected-row" : ""}">
      <td>${r.candidateId === besteId ? `<span style="color:#e0a52c; margin-right:4px;">★</span>` : ""}${r.candidateId}</td>
      <td>${r.runId}</td>
      <td>${new Date(r.createdAt).toLocaleString("nl-NL")}</td>
      <td>${DIMENSIE_LABEL[r.targetedWeakness] ?? r.targetedWeakness ?? "—"}</td>
      <td style="color:${(r.benchmarkDelta ?? 0) >= 0 ? "var(--good)" : "var(--bad)"};">${fmtPp(r.benchmarkDelta)}</td>
      <td style="color:${(r.holdoutDelta ?? 0) >= 0 ? "var(--good)" : "var(--bad)"};">${fmtPp(r.holdoutDelta)}</td>
      <td><span class="tag ${r.validator === "PASS" ? "good" : r.validator === "FAIL" ? "bad" : ""}">${r.validator ?? "—"}</span></td>
      <td><span class="tag ${statusTagClass(status)}">${ICONS[STATUS_ICON[status]] ?? ""}${status}</span></td>
      <td>
        <button class="ghost icon-btn" data-detail="${r.candidateId}" title="Bekijk detail">${ICONS.eye}</button>
        ${r.versionId ? `<button class="ghost icon-btn" data-goto-version="${r.versionId}" title="Naar versie">${ICONS.external}</button>` : ""}
      </td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll("[data-detail]").forEach((btn) => btn.addEventListener("click", () => {
    geselecteerdeKandidaatId = btn.dataset.detail;
    toonDetail(rows.find((r) => r.candidateId === geselecteerdeKandidaatId));
  }));
  tbody.querySelectorAll("[data-goto-version]").forEach((btn) => btn.addEventListener("click", () => {
    location.hash = `#/versies?id=${encodeURIComponent(btn.dataset.gotoVersion)}`;
  }));
}

async function toonDetail(row) {
  if (!row) return;
  geselecteerdeKandidaatId = row.candidateId;
  document.querySelectorAll("#cd-rows tr[data-row-id]").forEach((tr) => {
    tr.classList.toggle("selected-row", tr.dataset.rowId === row.candidateId);
  });
  const detailCard = document.getElementById("cd-detail");
  detailCard.style.display = "block";
  document.getElementById("cd-detail-title").textContent = row.candidateId;
  document.getElementById("cd-detail-goto-experiment").onclick = () => { location.hash = `#/experiment-detail?id=${encodeURIComponent(row.candidateId)}`; };
  const vergelijkBtn = document.getElementById("cd-detail-goto-vergelijken");
  vergelijkBtn.style.display = row.versionId ? "inline-block" : "none";
  vergelijkBtn.onclick = () => { location.hash = `#/vergelijken?target=${encodeURIComponent(row.versionId)}`; };

  const run = await j(`/api/development-runs/detail?id=${encodeURIComponent(row.runId)}`);
  const cycle = Array.isArray(run?.cycles) ? run.cycles.find((c) => c.candidate?.id === row.candidateId) : null;
  const chartEl = document.getElementById("cd-detail-chart");
  const changesEl = document.getElementById("cd-detail-changes");
  const stepperEl = document.getElementById("cd-detail-stepper");
  const gatesCard = document.getElementById("cd-gates-card");
  const gatesEl = document.getElementById("cd-gates");

  if (!cycle || !cycle.proof) {
    chartEl.innerHTML = `<div class="empty">Geen gedetailleerde meting meer beschikbaar voor deze kandidaat.</div>`;
    changesEl.innerHTML = "";
    stepperEl.innerHTML = "";
    gatesCard.style.display = "none";
    return;
  }

  gatesCard.style.display = "block";
  const gates = [
    { icon: "chart", label: "Benchmark", status: cycle.proof.executed ? "PASS" : "NIET VOLTOOID" },
    { icon: "shield", label: "Validator", status: cycle.proof.regressions.length === 0 ? "PASS" : "FAIL" },
    { icon: "book", label: "Holdout", status: cycle.proof.holdout ? "PASS" : "NOG NIET VOLTOOID" },
    // Nooit "TOEGESTAAN": ook een promotiekandidaat wordt pas actief na een
    // menselijke goedkeuring (zelfde regel als op Development Runs).
    { icon: "trophy", label: "Promotie", status: cycle.decision === "PROMOTION_CANDIDATE" ? "WACHT OP MENS" : cycle.decision === "REJECTED" ? "AFGEWEZEN" : "NOG NIET TOEGESTAAN" },
  ];
  gatesEl.innerHTML = gates.map((g) => `
    <div class="gate-row"><span class="gate-label"><span style="width:15px; height:15px; color:#9fb0c9; display:inline-flex;">${ICONS[g.icon]}</span>${g.label}</span><span class="tag ${g.status === "PASS" ? "good" : g.status === "FAIL" || g.status === "AFGEWEZEN" ? "bad" : g.status === "WACHT OP MENS" ? "warn" : ""}">${g.status}</span></div>
  `).join("");

  const categories = AGENT_DIMENSIES.filter((d) => typeof cycle.proof.pre.agent[d] === "number" || typeof cycle.proof.post.agent[d] === "number");
  groupedBarChart(chartEl, categories.map((d) => DIMENSIE_LABEL[d]), [
    { name: "Basis", color: "#9fb0c9", values: categories.map((d) => cycle.proof.pre.agent[d] ?? null) },
    { name: "Kandidaat", color: "#1f5fd0", values: categories.map((d) => cycle.proof.post.agent[d] ?? null) },
  ]);

  const wijzigingen = [...(cycle.proof.improvements ?? []), ...(cycle.proof.regressions ?? [])];
  changesEl.innerHTML = wijzigingen.length > 0
    ? wijzigingen.map((w) => `<li>${w}</li>`).join("")
    : `<li class="empty" style="list-style:none; margin-left:-18px;">Geen betekenisvol verschil met de basisversie gemeten.</li>`;

  const stages = [
    { label: "Gegenereerd", sub: cycle.proof?.startedAt ? new Date(cycle.proof.startedAt).toLocaleString("nl-NL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }) : "", status: "done" },
    { label: "Benchmark", sub: cycle.proof.executed ? "gemeten" : "niet uitgevoerd", status: cycle.proof.executed ? "done" : "failed" },
    { label: "Holdout", sub: cycle.proof.holdout ? "gemeten" : "niet voltooid", status: cycle.proof.holdout ? "done" : "failed" },
    { label: "Validator", sub: cycle.proof.regressions.length === 0 ? "geen regressie" : `${cycle.proof.regressions.length} regressie(s)`, status: cycle.proof.regressions.length === 0 ? "done" : "failed" },
    { label: "Beslissing", sub: cycle.decision === "PROMOTION_CANDIDATE" ? "promotiekandidaat" : cycle.decision === "REJECTED" ? "verworpen" : "in afwachting", status: cycle.decision === "PROMOTION_CANDIDATE" ? "done" : cycle.decision === "REJECTED" ? "failed" : "active" },
  ];
  renderStepper(stepperEl, stages);
}

function toegepasteFilters() {
  return alleKandidaten.filter((r) => {
    if (zoekterm && !`${r.candidateId} ${r.label} ${r.reasoning}`.toLowerCase().includes(zoekterm.toLowerCase())) return false;
    if (dimensieFilter !== "Alle" && r.targetedWeakness !== dimensieFilter) return false;
    if (statusFilter !== "Alle") {
      const besteId = besteKandidaatId(alleKandidaten);
      if (statusVoorRij(r, besteId) !== statusFilter) return false;
    }
    return true;
  });
}

function ververRender() {
  const gefilterd = toegepasteFilters();
  const besteId = besteKandidaatId(alleKandidaten);
  renderKpis(gefilterd);
  renderBest(alleKandidaten, besteId);
  renderRows(gefilterd, besteId);
}

export async function mount(container, params) {
  container.innerHTML = html();

  document.getElementById("cd-search").addEventListener("input", (e) => { zoekterm = e.target.value; ververRender(); });
  document.getElementById("cd-status").addEventListener("change", (e) => { statusFilter = e.target.value; ververRender(); });
  document.getElementById("cd-dimensie").addEventListener("change", (e) => { dimensieFilter = e.target.value; ververRender(); });
  container.querySelectorAll("[data-quickfilter]").forEach((btn) => btn.addEventListener("click", () => {
    statusFilter = btn.dataset.quickfilter;
    document.getElementById("cd-status").value = statusFilter;
    ververRender();
  }));

  async function laad() {
    alleKandidaten = await j("/api/candidates");
    ververRender();
  }

  await veilig("candidates", laad);
  const preselect = params?.get?.("id") ?? besteKandidaatId(alleKandidaten) ?? alleKandidaten[0]?.candidateId;
  if (preselect) {
    const row = alleKandidaten.find((r) => r.candidateId === preselect);
    if (row) await veilig("candidates-detail", () => toonDetail(row));
  }
  const interval = setInterval(() => veilig("candidates", laad), 8000);
  return () => clearInterval(interval);
}
