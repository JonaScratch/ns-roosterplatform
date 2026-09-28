// Logboek (§ UI/UX REBUILD, foto 6): tijdlijn & runhistorie, promotiegeschiedenis
// en benchmarkontwikkeling-over-tijd — het volledige ruwe logboek blijft
// achter een "Bekijk volledig logboek"-drilldown, nooit de primaire weergave.

import { j, fmtPp, lineChart, veilig, titleIcon, iconChip, ICONS } from "../lib/shared.js";

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
      <h3>${titleIcon("clock", "#1f5fd0")}Historie<span class="card-sub">Volledig overzicht van ontwikkelruns, kandidaten, promoties en activaties over tijd.</span></h3>
      <div class="row" style="align-items:flex-end;">
        <div class="col" style="max-width:200px;">
          <label>Periode</label>
          <select id="lb-periode">${PERIODE_OPTIES.map((o) => `<option value="${o.value}">${o.label}</option>`).join("")}</select>
        </div>
        <div class="col" style="max-width:200px;">
          <label>Type</label>
          <select id="lb-type"><option value="Alle">Alle</option></select>
        </div>
        <div class="col" style="max-width:200px;">
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
          <h3>${titleIcon("chart", "#1f5fd0")}Tijdlijn &amp; runhistorie</h3>
          <table><thead><tr><th></th><th>Run</th><th>Type</th><th>Gestart</th><th>Status</th><th>Productieversie</th><th></th></tr></thead><tbody id="lb-rows"></tbody></table>
        </div>
      </div>
      <div class="col" style="max-width:340px;">
        <div class="card" id="lb-detail" style="display:none;">
          <h3>${titleIcon("clock", "#1f5fd0")}Geselecteerde gebeurtenis</h3>
          <div id="lb-detail-body" class="field-list"></div>
          <button class="primary" id="lb-detail-full" style="width:100%; margin-top:12px;">${ICONS.book}Bekijk volledig logboek</button>
        </div>
      </div>
    </div>

    <div class="row">
      <div class="col">
        <div class="card">
          <h3>${titleIcon("chart", "#1f5fd0")}Benchmarkontwikkeling over tijd <span class="info-icon" title="Toont uitsluitend echte promotie/activatiemomenten, geen niet-geactiveerde kandidaten">i</span></h3>
          <div id="lb-chart"></div>
        </div>
      </div>
      <div class="col">
        <div class="card">
          <h3>${titleIcon("trophy", "#b9862c")}Promotiegeschiedenis</h3>
          <table><thead><tr><th>Wanneer</th><th>Type</th><th>Van</th><th>Naar</th><th>Toelichting</th></tr></thead><tbody id="lb-promoties"></tbody></table>
        </div>
      </div>
      <div class="col" style="max-width:300px;">
        <div class="card">
          <h3>${titleIcon("lightbulb", "#c8791a")}Belangrijkste patronen</h3>
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
  const promotiesInPeriode = allePromoties.filter((p) => binnenPeriode(p.at));
  const metScore = promotiesInPeriode.filter((p) => typeof p.score === "number");
  let gemVerbetering = null;
  if (metScore.length >= 2) {
    const deltas = [];
    for (let i = 1; i < metScore.length; i++) deltas.push(metScore[i].score - metScore[i - 1].score);
    gemVerbetering = deltas.reduce((s, v) => s + v, 0) / deltas.length;
  }
  const cards = [
    { icon: "flask", color: "blue", label: "Totaal runs", value: runs.length },
    { icon: "trophy", color: "amber", label: "Promoties/rollbacks", value: promotiesInPeriode.length },
    { icon: "check", color: "green", label: "Geslaagd", value: geslaagd },
    { icon: "up", color: "green", label: "Gem. verbetering per promotie", value: fmtPp(gemVerbetering), subClass: (gemVerbetering ?? 0) >= 0 ? "good" : "bad" },
  ];
  document.getElementById("lb-kpis").innerHTML = cards.map((c) => `
    <div class="stat with-icon">
      ${iconChip(c.icon, c.color)}
      <div>
        <div class="label">${c.label}</div>
        <div class="value">${c.value}</div>
      </div>
    </div>`).join("");
}

function renderRows(runs) {
  const tbody = document.getElementById("lb-rows");
  if (runs.length === 0) { tbody.innerHTML = `<tr><td colspan="7" class="empty">Geen runs gevonden voor deze filters.</td></tr>`; return; }
  tbody.innerHTML = runs.map((r) => `
    <tr class="clickable ${r.runId === geselecteerdeRunId ? "selected-row" : ""}" data-select="${r.runId}">
      <td><span style="display:inline-block; width:9px; height:9px; border-radius:50%; background:${OUTCOME_TAG[r.outcome] === "good" ? "var(--good)" : OUTCOME_TAG[r.outcome] === "bad" ? "var(--bad)" : "#9fb0c9"};"></span></td>
      <td>${r.runId}</td>
      <td>${r.kind ?? "—"}</td>
      <td>${r.startedAt ? new Date(r.startedAt).toLocaleString("nl-NL") : "—"}</td>
      <td><span class="tag ${OUTCOME_TAG[r.outcome] ?? ""}">${OUTCOME_LABEL[r.outcome] ?? r.outcome}</span></td>
      <td>${r.productionVersionDisplayName ?? "—"}</td>
      <td><button class="ghost icon-btn" data-select-btn="${r.runId}" title="Bekijk details">${ICONS.eye}</button></td>
    </tr>`).join("");
  tbody.querySelectorAll("[data-select], [data-select-btn]").forEach((el) => el.addEventListener("click", () => toonRunDetail(runs.find((r) => r.runId === (el.dataset.select ?? el.dataset.selectBtn)))));
}

function veldRij(label, value) {
  return `<div class="field-row" style="padding:6px 0;"><div style="flex:1;"><span class="field-label">${label}</span></div><div class="field-value">${value}</div></div>`;
}

function toonRunDetail(run) {
  if (!run) return;
  geselecteerdeRunId = run.runId;
  document.querySelectorAll("#lb-rows tr[data-select]").forEach((tr) => tr.classList.toggle("selected-row", tr.dataset.select === run.runId));
  document.getElementById("lb-detail").style.display = "block";
  const body = document.getElementById("lb-detail-body");
  body.innerHTML = [
    veldRij("Run", run.runId),
    veldRij("Type", run.kind ?? "—"),
    veldRij("Status", `<span class="tag ${OUTCOME_TAG[run.outcome] ?? ""}">${OUTCOME_LABEL[run.outcome] ?? run.outcome}</span>`),
    veldRij("Gestart", run.startedAt ? new Date(run.startedAt).toLocaleString("nl-NL") : "—"),
    veldRij("Afgerond", run.finishedAt ? new Date(run.finishedAt).toLocaleString("nl-NL") : "—"),
    veldRij("Productieversie bij start", run.productionVersionDisplayName ?? "—"),
    ...(run.experiment ? [
      veldRij("Hypothese", run.experiment.hypothesis),
      veldRij("Besluit", `<span class="tag ${run.experiment.decision === "PROMOTION_CANDIDATE" ? "good" : run.experiment.decision === "REJECTED" ? "bad" : "warn"}">${run.experiment.decision}</span>`),
    ] : []),
  ].join("");
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
  const run = (preselect && alleRuns.find((r) => r.runId === preselect)) || alleRuns[0];
  if (run) toonRunDetail(run);

  const interval = setInterval(() => veilig("logboek", laad), 10000);
  return () => clearInterval(interval);
}
