// Experiment-detail (§ UI/UX REBUILD, foto 5): GEEN eigen tabblad — alleen
// bereikbaar via drilldown vanuit Development Runs/Candidates. Toont de
// volledige hypothese/wijziging/meting/uitkomst per experiment, plus een
// effect-per-type-overzicht over alle experimenten heen.

import { j, fmtPp, esc, veilig } from "../lib/shared.js";

const SOORT_LABEL = {
  PROMPT_VARIANT: "Promptvariant", TOOL_HINT_VARIANT: "Tool-hint", CONTEXT_POLICY_VARIANT: "Contextbeleid",
  ENGINE_VARIANT: "Engine-variant", CHALLENGE: "Uitdaging",
};
const OUTCOME_TAG = { SUCCESS: "good", FAILURE: "bad", INCONCLUSIVE: "warn" };
const DECISION_TAG = { PROMOTION_CANDIDATE: "good", REJECTED: "bad", KEEP_TESTING: "warn" };
const LATENCY_KEYS = new Set(["latencyP50", "latencyP95"]);
const DIMENSIE_LABEL = {
  contextResolution: "Contextresolutie", multiTurnContext: "Multi-turn context", machinistTaal: "Machinisttaal",
  toolChoice: "Toolgebruik", falsePremiseCorrection: "Foutieve aannames", grounding: "Grounding",
  causalClaims: "Oorzakelijke claims", unnecessaryClarifications: "Te snel oordelen",
};

let alle = [];
let zoekterm = "";
let soortFilter = "Alle";
let decisionFilter = "Alle";
let geselecteerd = null;

function gemEffect(exp) {
  if (!exp.comparisonWithBaseline) return null;
  const waarden = Object.entries(exp.comparisonWithBaseline).filter(([k]) => !LATENCY_KEYS.has(k)).map(([, v]) => v).filter((v) => typeof v === "number");
  return waarden.length > 0 ? waarden.reduce((a, b) => a + b, 0) / waarden.length : null;
}

function html() {
  return `
    <div class="card">
      <h3>Experimenten <span class="info-icon" title="Alleen bereikbaar via drilldown — geen apart tabblad">i</span></h3>
      <div class="row">
        <div class="col" style="max-width:260px;">
          <label>Zoeken</label>
          <input type="text" id="ed-search" placeholder="Experiment-id, hypothese…" />
        </div>
        <div class="col" style="max-width:220px;">
          <label>Type</label>
          <select id="ed-soort"><option value="Alle">Alle</option>${Object.entries(SOORT_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
        </div>
        <div class="col" style="max-width:220px;">
          <label>Beslissing</label>
          <select id="ed-decision"><option value="Alle">Alle</option><option value="PROMOTION_CANDIDATE">PROMOTION_CANDIDATE</option><option value="REJECTED">REJECTED</option><option value="KEEP_TESTING">KEEP_TESTING</option></select>
        </div>
      </div>
    </div>

    <div class="grid" id="ed-kpis" style="margin-bottom:14px;"></div>

    <div class="row">
      <div class="col">
        <div class="card">
          <h3>Experimentenlijst</h3>
          <table><thead><tr><th>Experiment</th><th>Run</th><th>Tijdstip</th><th>Type</th><th>Uitkomst</th><th>Beslissing</th></tr></thead><tbody id="ed-rows"></tbody></table>
        </div>
      </div>
      <div class="col" style="max-width:340px;">
        <div class="card">
          <h3>Effect per type</h3>
          <div id="ed-effect-chart"></div>
        </div>
        <div class="card">
          <h3>Inzichten</h3>
          <ul id="ed-insights" style="margin:0; padding-left:18px; font-size:13px;"></ul>
        </div>
      </div>
    </div>

    <div class="card" id="ed-selected" style="display:none;">
      <h3>Geselecteerd experiment — <span id="ed-selected-title"></span></h3>
      <div class="stepper" id="ed-stepper" style="margin-bottom:14px;"></div>
      <div class="row">
        <div class="col">
          <p><b>Hypothese</b><br/><span id="ed-hypothese"></span></p>
          <p><b>Wijziging</b><br/><span id="ed-wijziging"></span></p>
          <p><b>Verwachte winst</b><br/><span id="ed-verwachting" style="color:#667; font-size:13px;"></span></p>
          <p><b>Uitkomst</b><br/><span id="ed-uitkomst"></span></p>
        </div>
        <div class="col">
          <table style="font-size:13px;">
            <thead><tr><th>Dimensie</th><th>Basis</th><th>Kandidaat</th><th>Δ</th></tr></thead>
            <tbody id="ed-metrics"></tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function renderKpis(rows) {
  const succesvol = rows.filter((e) => e.outcome === "SUCCESS").length;
  const mislukt = rows.filter((e) => e.outcome === "FAILURE").length;
  const onduidelijk = rows.filter((e) => e.outcome === "INCONCLUSIVE").length;
  const effecten = rows.map(gemEffect).filter((v) => v !== null);
  const gemEffectAlles = effecten.length > 0 ? effecten.reduce((a, b) => a + b, 0) / effecten.length : null;

  const cards = [
    { label: "Totaal experimenten", value: rows.length },
    { label: "Succesvol", value: succesvol },
    { label: "Mislukt", value: mislukt },
    { label: "Onduidelijk", value: onduidelijk },
    { label: "Gem. effect", value: fmtPp(gemEffectAlles) },
  ];
  document.getElementById("ed-kpis").innerHTML = cards.map((c) => `<div class="stat"><div class="label">${c.label}</div><div class="value">${c.value}</div></div>`).join("");
}

function renderRows(rows) {
  const tbody = document.getElementById("ed-rows");
  if (rows.length === 0) { tbody.innerHTML = `<tr><td colspan="6" class="empty">Geen experimenten gevonden voor deze filters.</td></tr>`; return; }
  tbody.innerHTML = rows.map((e) => `
    <tr class="clickable" data-select="${e.id}">
      <td>${e.id}</td>
      <td>${e.runId}</td>
      <td>${new Date(e.timestamp).toLocaleString("nl-NL")}</td>
      <td>${SOORT_LABEL[e.soort] ?? e.soort}</td>
      <td><span class="tag ${OUTCOME_TAG[e.outcome] ?? ""}">${e.outcome}</span></td>
      <td><span class="tag ${DECISION_TAG[e.decision] ?? ""}">${e.decision}</span></td>
    </tr>
  `).join("");
  tbody.querySelectorAll("[data-select]").forEach((tr) => tr.addEventListener("click", () => toonExperiment(rows.find((e) => e.id === tr.dataset.select))));
}

// Eigen eenvoudige, rond-nul-divergerende balkweergave (geen SVG-lib nodig):
// het gemiddelde effect per experimenttype kan zowel positief als negatief
// zijn, en `groupedBarChart`'s gedeelde 0-100-as zou een regressie niet
// correct/eerlijk kunnen tonen.
function renderEffectPerType(rows) {
  const perSoort = {};
  for (const e of rows) {
    const effect = gemEffect(e);
    if (effect === null) continue;
    (perSoort[e.soort] ??= []).push(effect);
  }
  const soorten = Object.keys(perSoort);
  const el = document.getElementById("ed-effect-chart");
  if (soorten.length === 0) { el.innerHTML = `<div class="empty">Nog geen meetgegevens.</div>`; return; }
  const gemiddelden = soorten.map((s) => ({ soort: s, gem: perSoort[s].reduce((a, b) => a + b, 0) / perSoort[s].length, n: perSoort[s].length }));
  const maxAbs = Math.max(1, ...gemiddelden.map((g) => Math.abs(g.gem)));
  el.innerHTML = gemiddelden.map((g) => {
    const pct = (Math.abs(g.gem) / maxAbs) * 50;
    const kleur = g.gem >= 0 ? "var(--good)" : "var(--bad)";
    return `
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px; font-size:12px;">
        <div style="width:110px; color:#556;">${SOORT_LABEL[g.soort] ?? g.soort}</div>
        <div style="flex:1; position:relative; height:16px; background:#f1f3f8; border-radius:3px;">
          <div style="position:absolute; left:50%; top:0; bottom:0; width:1px; background:#ccd4e0;"></div>
          <div style="position:absolute; top:0; bottom:0; ${g.gem >= 0 ? "left:50%" : "right:50%"}; width:${pct}%; background:${kleur}; border-radius:3px;"></div>
        </div>
        <div style="width:64px; text-align:right; color:${kleur}; font-weight:600;">${fmtPp(g.gem)}</div>
      </div>`;
  }).join("") + `<div class="chart-legend">${gemiddelden.map((g) => `<span>${g.n} experiment(en)</span>`).join(" · ")}</div>`;
}

function renderInsights(rows) {
  const el = document.getElementById("ed-insights");
  const metEffect = rows.map((e) => ({ e, effect: gemEffect(e) })).filter((x) => x.effect !== null);
  if (metEffect.length === 0) { el.innerHTML = `<li class="empty" style="list-style:none; margin-left:-18px;">Nog geen meetgegevens voor inzichten.</li>`; return; }

  const insights = [];
  const perSoort = {};
  for (const { e, effect } of metEffect) (perSoort[e.soort] ??= []).push(effect);
  const soortGemiddelden = Object.entries(perSoort).map(([s, vals]) => ({ soort: s, gem: vals.reduce((a, b) => a + b, 0) / vals.length, n: vals.length }));
  if (soortGemiddelden.length > 0) {
    const beste = soortGemiddelden.reduce((b, x) => (x.gem > b.gem ? x : b));
    insights.push(`${SOORT_LABEL[beste.soort] ?? beste.soort}-experimenten leverden gemiddeld het grootste effect op (${fmtPp(beste.gem)} over ${beste.n} experiment(en)).`);
  }
  const gepromoveerd = rows.filter((e) => e.decision === "PROMOTION_CANDIDATE").length;
  const verworpen = rows.filter((e) => e.decision === "REJECTED").length;
  if (gepromoveerd + verworpen > 0) insights.push(`${gepromoveerd} van de ${gepromoveerd + verworpen} beoordeelde experimenten werden gepromoveerd (${Math.round((100 * gepromoveerd) / (gepromoveerd + verworpen))}%).`);
  const grootsteRegressie = metEffect.filter((x) => x.effect < 0).sort((a, b) => a.effect - b.effect)[0];
  if (grootsteRegressie) insights.push(`Grootste gemeten regressie: ${grootsteRegressie.e.id} (${fmtPp(grootsteRegressie.effect)}) — ${esc(grootsteRegressie.e.reason)}`);

  el.innerHTML = insights.map((i) => `<li style="margin-bottom:6px;">${i}</li>`).join("");
}

function toonExperiment(exp) {
  if (!exp) return;
  geselecteerd = exp.id;
  document.getElementById("ed-selected").style.display = "block";
  document.getElementById("ed-selected-title").textContent = exp.id;
  document.getElementById("ed-hypothese").textContent = exp.hypothesis;
  document.getElementById("ed-wijziging").textContent = exp.reason;
  const doel = (exp.configuration && exp.configuration.variantId) ? `Doel: gemeten zwakte aanpakken via kandidaat ${exp.configuration.variantId}.` : "Geen vooraf apart vastgelegde streefwaarde — dit systeem genereert kandidaten op basis van de gemeten zwakte, niet op basis van een vooraf ingeschatte winst.";
  document.getElementById("ed-verwachting").textContent = doel;
  document.getElementById("ed-uitkomst").textContent = `${exp.outcome}${exp.failureReason ? " — " + exp.failureReason : ""}${exp.nextRecommendation ? " · " + exp.nextRecommendation : ""}`;

  const metricsBody = document.getElementById("ed-metrics");
  if (!exp.qualityMetrics || !exp.baselineMetrics) {
    metricsBody.innerHTML = `<tr><td colspan="4" class="empty">Geen metingen beschikbaar (${exp.reason}).</td></tr>`;
  } else {
    const keys = Object.keys(exp.qualityMetrics).filter((k) => !LATENCY_KEYS.has(k));
    metricsBody.innerHTML = keys.map((k) => {
      const basis = exp.baselineMetrics[k] ?? null;
      const kandidaat = exp.qualityMetrics[k] ?? null;
      const delta = basis !== null && kandidaat !== null ? kandidaat - basis : null;
      return `<tr><td>${DIMENSIE_LABEL[k] ?? k}</td><td>${basis !== null ? basis.toFixed(1) + "%" : "—"}</td><td>${kandidaat !== null ? kandidaat.toFixed(1) + "%" : "—"}</td><td style="color:${(delta ?? 0) >= 0 ? "var(--good)" : "var(--bad)"};">${fmtPp(delta)}</td></tr>`;
    }).join("");
  }

  const stages = [
    { label: "Hypothese", status: "done" },
    { label: "Wijziging", status: exp.configuration?.variantId ? "done" : "active" },
    { label: "Meting", status: exp.qualityMetrics ? "done" : "failed" },
    { label: "Validator", status: exp.validatorResult === "NIET_VAN_TOEPASSING" ? "done" : exp.validatorResult === "VALID" ? "done" : exp.validatorResult === "INVALID" ? "failed" : "active" },
    { label: "Beslissing: " + exp.decision, status: exp.decision === "PROMOTION_CANDIDATE" ? "done" : exp.decision === "REJECTED" ? "failed" : "active" },
  ];
  document.getElementById("ed-stepper").innerHTML = stages.map((s, i) => `${i > 0 ? '<span class="arrow">→</span>' : ""}<div class="step ${s.status}">${s.label}</div>`).join("");
}

function gefilterd() {
  return alle.filter((e) => {
    if (zoekterm && !`${e.id} ${e.hypothesis} ${e.reason}`.toLowerCase().includes(zoekterm.toLowerCase())) return false;
    if (soortFilter !== "Alle" && e.soort !== soortFilter) return false;
    if (decisionFilter !== "Alle" && e.decision !== decisionFilter) return false;
    return true;
  });
}

function ververRender() {
  const rows = gefilterd();
  renderKpis(rows);
  renderRows(rows);
  renderEffectPerType(rows);
  renderInsights(rows);
}

export async function mount(container, params) {
  container.innerHTML = html();
  document.getElementById("ed-search").addEventListener("input", (e) => { zoekterm = e.target.value; ververRender(); });
  document.getElementById("ed-soort").addEventListener("change", (e) => { soortFilter = e.target.value; ververRender(); });
  document.getElementById("ed-decision").addEventListener("change", (e) => { decisionFilter = e.target.value; ververRender(); });

  async function laad() {
    alle = await j("/api/experiments");
    ververRender();
  }
  await veilig("experiment-detail", laad);

  const preselect = params?.get?.("id");
  if (preselect) {
    const exp = alle.find((e) => e.id === preselect || e.configuration?.variantId === preselect);
    if (exp) toonExperiment(exp);
  }

  const interval = setInterval(() => veilig("experiment-detail", laad), 10000);
  return () => clearInterval(interval);
}
