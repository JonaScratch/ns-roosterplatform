// Candidates (§ UI/UX REBUILD, foto 4): alle kandidaten uit alle development
// runs, met echte benchmark/holdout/validator-deltas — nooit alleen de
// gepromoveerde, en nooit een verzonnen roosterkwaliteitscijfer.

import { j, groupedBarChart, fmtPp, veilig } from "../lib/shared.js";

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

function html() {
  return `
    <div class="card">
      <h3>Filters</h3>
      <div class="row">
        <div class="col" style="max-width:280px;">
          <label>Zoeken</label>
          <input type="text" id="cd-search" placeholder="Kandidaat-id of omschrijving…" />
        </div>
        <div class="col" style="max-width:220px;">
          <label>Status</label>
          <select id="cd-status">${STATUS_FILTERS.map((s) => `<option value="${s}">${s}</option>`).join("")}</select>
        </div>
        <div class="col" style="max-width:260px;">
          <label>Dimensie</label>
          <select id="cd-dimensie"><option value="Alle">Alle</option>${AGENT_DIMENSIES.map((d) => `<option value="${d}">${DIMENSIE_LABEL[d]}</option>`).join("")}</select>
        </div>
      </div>
    </div>

    <div class="grid" id="cd-kpis" style="margin-bottom:14px;"></div>

    <div class="row">
      <div class="col">
        <div class="card">
          <h3>Kandidaten</h3>
          <table>
            <thead><tr><th>Kandidaat</th><th>Run</th><th>Aangemaakt</th><th>Dimensie</th><th>Benchmark Δ</th><th>Holdout Δ</th><th>Validator</th><th>Status</th><th>Acties</th></tr></thead>
            <tbody id="cd-rows"></tbody>
          </table>
        </div>
      </div>
      <div class="col" style="max-width:300px;">
        <div class="card">
          <h3>Beste kandidaat nu</h3>
          <div id="cd-best"></div>
        </div>
      </div>
    </div>

    <div class="card" id="cd-detail" style="display:none;">
      <h3>Kandidaatdetail — <span id="cd-detail-title"></span>
        <button class="ghost" id="cd-detail-goto-experiment" style="margin-left:10px;">Bekijk volledig experiment →</button>
        <button class="ghost" id="cd-detail-goto-vergelijken" style="display:none;">Vergelijk met basisversie →</button>
      </h3>
      <div id="cd-detail-chart"></div>
      <div class="row" style="margin-top:10px;">
        <div class="col">
          <h4 style="margin-bottom:6px; font-size:13px;">Belangrijkste wijzigingen</h4>
          <ul id="cd-detail-changes" style="margin:0; padding-left:18px; font-size:13px;"></ul>
        </div>
        <div class="col">
          <h4 style="margin-bottom:6px; font-size:13px;">Levenscyclus</h4>
          <div class="stepper" id="cd-detail-stepper"></div>
        </div>
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

function besteKandidaatId(rows) {
  const promoted = rows.filter((r) => r.decision === "PROMOTION_CANDIDATE" && r.benchmarkDelta !== null);
  if (promoted.length === 0) return null;
  return promoted.reduce((best, r) => (r.benchmarkDelta > best.benchmarkDelta ? r : best)).candidateId;
}

function renderKpis(rows) {
  const gepromoveerd = rows.filter((r) => r.decision === "PROMOTION_CANDIDATE");
  const verworpen = rows.filter((r) => r.decision === "REJECTED");
  const gemVerbetering = gepromoveerd.length > 0
    ? gepromoveerd.reduce((s, r) => s + (r.benchmarkDelta ?? 0), 0) / gepromoveerd.length
    : null;
  const besteScore = rows.length > 0 ? Math.max(...rows.map((r) => r.benchmarkDev ?? -Infinity).filter((v) => v > -Infinity), -Infinity) : -Infinity;

  const cards = [
    { label: "Totaal kandidaten", value: rows.length },
    { label: "Gepromoveerd", value: gepromoveerd.length },
    { label: "Verworpen", value: verworpen.length },
    { label: "Gem. verbetering (gepromoveerd)", value: fmtPp(gemVerbetering) },
    { label: "Beste score", value: besteScore > -Infinity ? `${besteScore.toFixed(1)}%` : "—" },
  ];
  document.getElementById("cd-kpis").innerHTML = cards.map((c) => `<div class="stat"><div class="label">${c.label}</div><div class="value">${c.value}</div></div>`).join("");
}

function renderBest(rows, besteId) {
  const el = document.getElementById("cd-best");
  const beste = rows.find((r) => r.candidateId === besteId);
  if (!beste) { el.innerHTML = `<div class="empty">Nog geen kandidaat.</div>`; return; }
  el.innerHTML = `
    <span class="tag good">BESTE</span>
    <p style="margin:8px 0 4px; font-size:13px;"><b>${beste.candidateId}</b></p>
    <p class="sub" style="margin:0 0 6px; font-size:12px;">Doel: ${DIMENSIE_LABEL[beste.targetedWeakness] ?? beste.targetedWeakness ?? "onbekend"}</p>
    <p style="margin:0; font-size:12px; color:var(--good);">Benchmark ${fmtPp(beste.benchmarkDelta)} · Holdout ${fmtPp(beste.holdoutDelta)}</p>
    <p class="sub" style="margin:6px 0 0; font-size:12px;">${beste.reasoning}</p>
  `;
}

function renderRows(rows, besteId) {
  const tbody = document.getElementById("cd-rows");
  if (rows.length === 0) { tbody.innerHTML = `<tr><td colspan="9" class="empty">Geen kandidaten gevonden voor deze filters.</td></tr>`; return; }
  tbody.innerHTML = rows.map((r) => {
    const status = statusVoorRij(r, besteId);
    return `<tr>
      <td>${r.candidateId}</td>
      <td>${r.runId}</td>
      <td>${new Date(r.createdAt).toLocaleString("nl-NL")}</td>
      <td>${DIMENSIE_LABEL[r.targetedWeakness] ?? r.targetedWeakness ?? "—"}</td>
      <td style="color:${(r.benchmarkDelta ?? 0) >= 0 ? "var(--good)" : "var(--bad)"};">${fmtPp(r.benchmarkDelta)}</td>
      <td style="color:${(r.holdoutDelta ?? 0) >= 0 ? "var(--good)" : "var(--bad)"};">${fmtPp(r.holdoutDelta)}</td>
      <td><span class="tag ${r.validator === "PASS" ? "good" : r.validator === "FAIL" ? "bad" : ""}">${r.validator ?? "—"}</span></td>
      <td><span class="tag ${statusTagClass(status)}">${status}</span></td>
      <td>
        <button class="ghost" data-detail="${r.candidateId}">Bekijk detail</button>
        ${r.versionId ? `<button class="ghost" data-goto-version="${r.versionId}">Naar versie</button>` : ""}
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

  if (!cycle || !cycle.proof) {
    chartEl.innerHTML = `<div class="empty">Geen gedetailleerde meting meer beschikbaar voor deze kandidaat.</div>`;
    changesEl.innerHTML = "";
    stepperEl.innerHTML = "";
    return;
  }

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
    { label: "Gegenereerd", status: "done" },
    { label: "Benchmark gemeten", status: cycle.proof.executed ? "done" : "failed" },
    { label: "Holdout gemeten", status: cycle.proof.holdout ? "done" : "failed" },
    { label: "Validator", status: cycle.proof.regressions.length === 0 ? "done" : "failed" },
    { label: "Beslissing: " + cycle.decision, status: cycle.decision === "PROMOTION_CANDIDATE" ? "done" : cycle.decision === "REJECTED" ? "failed" : "active" },
  ];
  stepperEl.innerHTML = stages.map((s, i) => `${i > 0 ? '<span class="arrow">→</span>' : ""}<div class="step ${s.status}">${s.label}</div>`).join("");
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

  async function laad() {
    alleKandidaten = await j("/api/candidates");
    ververRender();
  }

  await veilig("candidates", laad);
  const preselect = params?.get?.("id");
  if (preselect) {
    geselecteerdeKandidaatId = preselect;
    const row = alleKandidaten.find((r) => r.candidateId === preselect);
    if (row) await veilig("candidates-detail", () => toonDetail(row));
  }
  const interval = setInterval(() => veilig("candidates", laad), 8000);
  return () => clearInterval(interval);
}
