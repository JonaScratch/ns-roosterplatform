// Logboek (§ UI/UX REBUILD, foto 6): tijdlijn & runhistorie, promotiegeschiedenis
// en benchmarkontwikkeling-over-tijd — het volledige ruwe logboek blijft
// achter een "Bekijk volledig logboek"-drilldown, nooit de primaire weergave.

import { j, fmtPp, lineChart, veilig } from "../lib/shared.js";

const PERIODE_OPTIES = [
  { value: "alles", label: "Alles" },
  { value: "1", label: "Vandaag" },
  { value: "7", label: "Laatste 7 dagen" },
  { value: "30", label: "Laatste 30 dagen" },
];
const OUTCOME_LABEL = { RUN_COMPLETED: "VOLTOOID", RUN_FAILED: "MISLUKT", RUN_INTERRUPTED: "ONDERBROKEN", RUNNING_OF_ONBEKEND: "LOOPT/ONBEKEND" };
const OUTCOME_TAG = { RUN_COMPLETED: "good", RUN_FAILED: "bad", RUN_INTERRUPTED: "warn", RUNNING_OF_ONBEKEND: "" };

let alleRuns = [];
let allePromoties = [];
let zoekterm = "";
let periodeFilter = "alles";
let typeFilter = "Alle";
let statusFilter = "Alle";
let geselecteerdeRunId = null;

function html() {
  return `
    <div class="card">
      <h3>Filters</h3>
      <div class="row">
        <div class="col" style="max-width:220px;">
          <label>Periode</label>
          <select id="lb-periode">${PERIODE_OPTIES.map((o) => `<option value="${o.value}">${o.label}</option>`).join("")}</select>
        </div>
        <div class="col" style="max-width:220px;">
          <label>Type</label>
          <select id="lb-type"><option value="Alle">Alle</option></select>
        </div>
        <div class="col" style="max-width:220px;">
          <label>Status</label>
          <select id="lb-status"><option value="Alle">Alle</option>${Object.entries(OUTCOME_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
        </div>
        <div class="col" style="max-width:260px;">
          <label>Zoeken</label>
          <input type="text" id="lb-search" placeholder="Run-id, type, hypothese…" />
        </div>
      </div>
    </div>

    <div class="grid" id="lb-kpis" style="margin-bottom:14px;"></div>

    <div class="row">
      <div class="col">
        <div class="card">
          <h3>Tijdlijn &amp; runhistorie</h3>
          <table><thead><tr><th>Run</th><th>Type</th><th>Gestart</th><th>Status</th><th>Productieversie</th><th></th></tr></thead><tbody id="lb-rows"></tbody></table>
        </div>
      </div>
      <div class="col" style="max-width:340px;">
        <div class="card" id="lb-detail" style="display:none;">
          <h3>Geselecteerde gebeurtenis</h3>
          <div id="lb-detail-body" style="font-size:13px;"></div>
          <button class="ghost" id="lb-detail-full" style="margin-top:10px;">Bekijk volledig logboek →</button>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>Benchmarkontwikkeling over tijd <span class="info-icon" title="Toont uitsluitend echte promotie/activatiemomenten, geen niet-geactiveerde kandidaten">i</span></h3>
      <div id="lb-chart"></div>
    </div>

    <div class="row">
      <div class="col">
        <div class="card">
          <h3>Promotiegeschiedenis</h3>
          <table><thead><tr><th>Wanneer</th><th>Type</th><th>Van</th><th>Naar</th><th>Toelichting</th></tr></thead><tbody id="lb-promoties"></tbody></table>
        </div>
      </div>
      <div class="col" style="max-width:340px;">
        <div class="card">
          <h3>Belangrijkste patronen</h3>
          <ul id="lb-patronen" style="margin:0; padding-left:18px; font-size:13px;"></ul>
        </div>
      </div>
    </div>
  `;
}

function binnenPeriode(iso) {
  if (periodeFilter === "alles" || !iso) return true;
  const dagen = Number(periodeFilter);
  return Date.now() - new Date(iso).getTime() <= dagen * 24 * 60 * 60 * 1000;
}

function gefilterdeRuns() {
  return alleRuns.filter((r) => {
    if (!binnenPeriode(r.startedAt)) return false;
    if (typeFilter !== "Alle" && r.kind !== typeFilter) return false;
    if (statusFilter !== "Alle" && r.outcome !== statusFilter) return false;
    if (zoekterm && !`${r.runId} ${r.kind ?? ""} ${r.experiment?.hypothesis ?? ""}`.toLowerCase().includes(zoekterm.toLowerCase())) return false;
    return true;
  });
}

function renderKpis(runs) {
  const geslaagd = runs.filter((r) => r.outcome === "RUN_COMPLETED").length;
  const mislukt = runs.filter((r) => r.outcome === "RUN_FAILED").length;
  const promotiesInPeriode = allePromoties.filter((p) => binnenPeriode(p.at)).length;
  const cards = [
    { label: "Totaal runs", value: runs.length },
    { label: "Geslaagd", value: geslaagd },
    { label: "Mislukt", value: mislukt },
    { label: "Promoties/rollbacks", value: promotiesInPeriode },
  ];
  document.getElementById("lb-kpis").innerHTML = cards.map((c) => `<div class="stat"><div class="label">${c.label}</div><div class="value">${c.value}</div></div>`).join("");
}

function renderRows(runs) {
  const tbody = document.getElementById("lb-rows");
  if (runs.length === 0) { tbody.innerHTML = `<tr><td colspan="6" class="empty">Geen runs gevonden voor deze filters.</td></tr>`; return; }
  tbody.innerHTML = runs.map((r) => `
    <tr class="clickable" data-select="${r.runId}">
      <td>${r.runId}</td>
      <td>${r.kind ?? "—"}</td>
      <td>${r.startedAt ? new Date(r.startedAt).toLocaleString("nl-NL") : "—"}</td>
      <td><span class="tag ${OUTCOME_TAG[r.outcome] ?? ""}">${OUTCOME_LABEL[r.outcome] ?? r.outcome}</span></td>
      <td>${r.productionVersionDisplayName ?? "—"}</td>
      <td><button class="ghost" data-select-btn="${r.runId}">Details</button></td>
    </tr>`).join("");
  tbody.querySelectorAll("[data-select], [data-select-btn]").forEach((el) => el.addEventListener("click", () => toonRunDetail(runs.find((r) => r.runId === (el.dataset.select ?? el.dataset.selectBtn)))));
}

function toonRunDetail(run) {
  if (!run) return;
  geselecteerdeRunId = run.runId;
  document.getElementById("lb-detail").style.display = "block";
  const body = document.getElementById("lb-detail-body");
  body.innerHTML = `
    <p><b>Run</b><br/>${run.runId}</p>
    <p><b>Type</b><br/>${run.kind ?? "—"}</p>
    <p><b>Status</b><br/><span class="tag ${OUTCOME_TAG[run.outcome] ?? ""}">${OUTCOME_LABEL[run.outcome] ?? run.outcome}</span></p>
    <p><b>Gestart</b><br/>${run.startedAt ? new Date(run.startedAt).toLocaleString("nl-NL") : "—"}</p>
    <p><b>Afgerond</b><br/>${run.finishedAt ? new Date(run.finishedAt).toLocaleString("nl-NL") : "—"}</p>
    <p><b>Productieversie bij start</b><br/>${run.productionVersionDisplayName ?? "—"}</p>
    ${run.experiment ? `<p><b>Hypothese</b><br/>${run.experiment.hypothesis}</p><p><b>Besluit</b><br/><span class="tag ${run.experiment.decision === "PROMOTION_CANDIDATE" ? "good" : run.experiment.decision === "REJECTED" ? "bad" : "warn"}">${run.experiment.decision}</span></p>` : ""}
  `;
  document.getElementById("lb-detail-full").onclick = () => { window.open(`/api/logbook/download?runId=${encodeURIComponent(run.runId)}&format=txt`, "_blank"); };
}

function renderChart() {
  const chartEl = document.getElementById("lb-chart");
  const punten = allePromoties.filter((p) => binnenPeriode(p.at) && typeof p.score === "number");
  if (punten.length === 0) { chartEl.innerHTML = `<div class="empty">Nog geen benchmarkscore bij een echt promotie/activatiemoment.</div>`; return; }
  lineChart(chartEl, [{ name: "Benchmarkscore bij activatie", color: "#1f5fd0", points: punten.map((p) => ({ y: p.score })) }]);
}

function renderPromotieTabel() {
  const tbody = document.getElementById("lb-promoties");
  const rijen = allePromoties.filter((p) => binnenPeriode(p.at)).slice().reverse();
  if (rijen.length === 0) { tbody.innerHTML = `<tr><td colspan="5" class="empty">Nog geen promoties of rollbacks in deze periode.</td></tr>`; return; }
  tbody.innerHTML = rijen.map((p) => `
    <tr>
      <td>${new Date(p.at).toLocaleString("nl-NL")}</td>
      <td><span class="tag ${p.kind === "PUBLISH" ? "good" : "warn"}">${p.kind === "PUBLISH" ? "PROMOTIE" : "ROLLBACK"}</span></td>
      <td>${p.fromDisplayName ?? "—"}</td>
      <td>${p.toDisplayName}</td>
      <td>${p.message}</td>
    </tr>`).join("");
}

function renderPatronen() {
  const el = document.getElementById("lb-patronen");
  const promoties = allePromoties.filter((p) => binnenPeriode(p.at));
  if (promoties.length === 0) { el.innerHTML = `<li class="empty" style="list-style:none; margin-left:-18px;">Nog geen patronen — te weinig promoties/rollbacks in deze periode.</li>`; return; }

  const insights = [];
  const publishCount = promoties.filter((p) => p.kind === "PUBLISH").length;
  const rollbackCount = promoties.filter((p) => p.kind === "ROLLBACK").length;
  insights.push(`${publishCount} promotie(s) en ${rollbackCount} rollback(s) in deze periode.`);
  const metScore = promoties.filter((p) => typeof p.score === "number");
  if (metScore.length >= 2) {
    const eerste = metScore[0];
    const laatste = metScore[metScore.length - 1];
    insights.push(`Benchmarkscore ging van ${eerste.score.toFixed(1)}% (${eerste.toDisplayName}) naar ${laatste.score.toFixed(1)}% (${laatste.toDisplayName}) — ${fmtPp(laatste.score - eerste.score)}.`);
  }
  if (promoties.length >= 2) {
    const eersteAt = new Date(promoties[0].at).getTime();
    const laatsteAt = new Date(promoties[promoties.length - 1].at).getTime();
    const gemDagen = (laatsteAt - eersteAt) / (promoties.length - 1) / (24 * 60 * 60 * 1000);
    insights.push(`Gemiddeld ${gemDagen < 1 ? "minder dan 1 dag" : gemDagen.toFixed(1) + " dagen"} tussen opeenvolgende promotie/activatiemomenten.`);
  }
  el.innerHTML = insights.map((i) => `<li style="margin-bottom:6px;">${i}</li>`).join("");
}

function vulTypeOpties(runs) {
  const el = document.getElementById("lb-type");
  const types = [...new Set(runs.map((r) => r.kind).filter(Boolean))].sort();
  el.innerHTML = `<option value="Alle">Alle</option>` + types.map((t) => `<option value="${t}">${t}</option>`).join("");
}

function ververRender() {
  const runs = gefilterdeRuns();
  renderKpis(runs);
  renderRows(runs);
  renderChart();
  renderPromotieTabel();
  renderPatronen();
}

export async function mount(container, params) {
  container.innerHTML = html();

  document.getElementById("lb-periode").addEventListener("change", (e) => { periodeFilter = e.target.value; ververRender(); });
  document.getElementById("lb-type").addEventListener("change", (e) => { typeFilter = e.target.value; ververRender(); });
  document.getElementById("lb-status").addEventListener("change", (e) => { statusFilter = e.target.value; ververRender(); });
  document.getElementById("lb-search").addEventListener("input", (e) => { zoekterm = e.target.value; ververRender(); });

  async function laad() {
    const [runs, promoties, prestaties] = await Promise.all([j("/api/runs/history"), j("/api/logbook/promotions"), j("/api/versions/performance")]);
    const scorePerVersie = new Map(prestaties.map((p) => [p.versionId, p.score]));
    alleRuns = runs;
    allePromoties = promoties.map((p) => ({ ...p, score: scorePerVersie.get(p.toVersionId) ?? null }));
    vulTypeOpties(alleRuns);
    ververRender();
  }

  await veilig("logboek", laad);

  const preselect = params?.get?.("runId");
  if (preselect) {
    const run = alleRuns.find((r) => r.runId === preselect);
    if (run) toonRunDetail(run);
  }

  const interval = setInterval(() => veilig("logboek", laad), 10000);
  return () => clearInterval(interval);
}
