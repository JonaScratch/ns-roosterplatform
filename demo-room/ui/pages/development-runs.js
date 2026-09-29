// Development Runs (§ UI/UX REBUILD, foto 3): commandocentrum voor autonome
// Lyra-development runs. Configureren + live meekijken wat de Sandbox doet.

import { j, post, veilig, titleIcon, iconChip, ICONS, renderStepper, lineChart, esc } from "../lib/shared.js";
import { mountLongRunsPanel, metPaneel } from "../lib/panels.js";
import { confirmAction } from "../app.js";

const DUUR_OPTIES = [
  { minutes: 60, label: "1 uur" },
  { minutes: 360, label: "6 uur" },
  { minutes: 1440, label: "24 uur" },
  { minutes: null, label: "Aangepast" },
];

const DOEL_OPTIES = [
  { value: "", label: "Automatisch (Lyra diagnosticeert zelf de zwakste dimensie)" },
  { value: "contextResolution", label: "Contextresolutie" },
  { value: "multiTurnContext", label: "Multi-turn context" },
  { value: "machinistTaal", label: "Machinisttaal/vakjargon" },
  { value: "toolChoice", label: "Toolgebruik" },
  { value: "falsePremiseCorrection", label: "Foutieve aannames corrigeren" },
  { value: "grounding", label: "Grounding" },
  { value: "causalClaims", label: "Oorzakelijke claims" },
  { value: "unnecessaryClarifications", label: "Te snel oordelen zonder onderzoek" },
];

let gekozenDuurMinuten = 360;
let gekozenDoel = "";

function html() {
  return `
    <div class="card">
      <h3>${titleIcon("target", "#1f5fd0")}Development Run</h3>
      <p class="sub" style="margin:-8px 0 10px; color:#7a8aa3; font-size:12.5px;">Start en bewaak een autonome ontwikkelrun voor Lyra. De run maakt geïsoleerde kandidaten, test verbeteringen en bewaart alleen aantoonbare vooruitgang.</p>
      <div class="row" style="align-items:flex-end;">
        <div class="col" style="max-width:240px;">
          <label>Basisversie</label>
          <div id="dr-basisversie" style="padding:7px 0; font-size:13px; font-weight:700;">—</div>
        </div>
        <div class="col" style="max-width:300px;">
          <label>Doel</label>
          <select id="dr-doel">${DOEL_OPTIES.map((o) => `<option value="${o.value}">${o.label}</option>`).join("")}</select>
        </div>
        <div class="col" style="max-width:140px;">
          <label>Duur</label>
          <select id="dr-duur">${DUUR_OPTIES.map((o) => `<option value="${o.minutes ?? "custom"}">${o.label}</option>`).join("")}</select>
        </div>
        <div class="col" id="dr-duur-custom-wrap" style="max-width:120px; display:none;">
          <label>Minuten</label>
          <input type="number" id="dr-duur-custom" min="5" value="120" />
        </div>
        <div class="col" style="flex:0 0 auto; min-width:0;">
          <label style="display:flex; align-items:center; gap:5px; margin:0; text-transform:none; font-weight:600; color:#556;"><span style="display:inline-flex; width:32px; height:18px; border-radius:9px; background:var(--good); position:relative;"><span style="position:absolute; right:2px; top:2px; width:14px; height:14px; border-radius:50%; background:#fff;"></span></span>Benchmarkset</label>
        </div>
        <div class="col" style="flex:0 0 auto; min-width:0;">
          <label style="display:flex; align-items:center; gap:5px; margin:0; text-transform:none; font-weight:600; color:#556;"><span style="display:inline-flex; width:32px; height:18px; border-radius:9px; background:var(--good); position:relative;"><span style="position:absolute; right:2px; top:2px; width:14px; height:14px; border-radius:50%; background:#fff;"></span></span>Holdout</label>
        </div>
        <div class="col" style="flex:0 0 auto; min-width:0;">
          <label style="display:flex; align-items:center; gap:5px; margin:0; text-transform:none; font-weight:600; color:#556;"><span style="display:inline-flex; width:32px; height:18px; border-radius:9px; background:var(--good); position:relative;"><span style="position:absolute; right:2px; top:2px; width:14px; height:14px; border-radius:50%; background:#fff;"></span></span>Validator</label>
        </div>
      </div>
      <p class="sub" style="margin:6px 0 0; font-size:11px; color:#9fb0c9;">Benchmarkset, holdout en validator staan altijd aan — nooit uit te schakelen — en zijn hier alleen ter bevestiging zichtbaar.</p>
      <div style="display:flex; gap:10px; margin-top:14px;">
        <button class="primary" id="dr-start-btn">${ICONS.play}Start development run</button>
        <button class="ghost" id="dr-proefrun-btn" style="padding:9px 14px;">${ICONS.flask}Korte proefrun (5 min)</button>
      </div>
    </div>

    <div class="grid" id="dr-kpis" style="margin-bottom:14px;"></div>

    <div class="row">
      <div class="col" style="max-width:320px;">
        <div class="card">
          <h3>${titleIcon("gear", "#1f5fd0")}Runconfiguratie</h3>
          <div class="field-list" id="dr-config-table"></div>
        </div>
        <div class="card">
          <h3>${titleIcon("target", "#c8791a")}Actieve doelen</h3>
          <ol id="dr-doelen" style="margin:0; padding-left:18px; font-size:12.5px; color:#334;"></ol>
        </div>
      </div>
      <div class="col" style="min-width:380px;">
        <div class="card">
          <h3>${titleIcon("refresh", "#1f5fd0")}Live ontwikkellus<span id="dr-progress-wrap" style="margin-left:auto; display:flex; align-items:center; gap:8px; font-size:11px; color:#7a8aa3; font-weight:600;"><span>Runvoortgang</span><span style="width:90px; height:6px; background:#eef1f6; border-radius:3px; overflow:hidden; display:inline-block;"><span id="dr-progress-bar" style="display:block; height:100%; background:var(--accent); width:0%;"></span></span><span id="dr-progress-pct">0%</span></span></h3>
          <div class="stepper" id="dr-live-stepper" style="margin-bottom:14px;"></div>
          <div id="dr-live-log" class="dr-events">Nog geen actieve run.</div>
          <details style="margin-top:8px;"><summary>Ruwe logregels</summary><div id="dr-live-raw" class="dr-raw"></div></details>
          <div id="dr-progress-chart" style="margin-top:14px;"></div>
        </div>
      </div>
      <div class="col" style="max-width:320px;">
        <div class="card">
          <h3>${titleIcon("trophy", "#b9862c")}Beste kandidaat nu</h3>
          <div id="dr-best-candidate"></div>
        </div>
        <div class="card">
          <h3>${titleIcon("shield", "#2e9e5b")}Gate status</h3>
          <div class="gate-list" id="dr-gates"></div>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>${titleIcon("users", "#1f5fd0")}Kandidaten in deze run</h3>
      <table><thead><tr><th>Kandidaat</th><th>Aangemaakt</th><th>Verbetering</th><th>Benchmark</th><th>Holdout</th><th>Overtredingen</th><th>Beslissing</th><th>Reden</th></tr></thead><tbody id="dr-candidates"></tbody></table>
    </div>
    <div class="dr-infobalk">${ICONS.alert}<span>Productieversie blijft onaangeraakt. Alleen na menselijke goedkeuring kan een kandidaat promoveren naar actief.</span></div>
  `;
}

function selectedMinutes() {
  const sel = document.getElementById("dr-duur").value;
  return sel === "custom" ? Number(document.getElementById("dr-duur-custom").value || 120) : Number(sel);
}

async function startenRun(minutes) {
  const doelTekst = gekozenDoel ? DOEL_OPTIES.find((o) => o.value === gekozenDoel)?.label : "automatisch gediagnosticeerd";
  const bevestigd = await confirmAction({
    title: "Development run starten?",
    bodyHtml: `<p>Start een autonome ontwikkelrun van maximaal <b>${minutes} minuten</b> (focus: ${doelTekst}). De actieve productie-Lyra wordt hierdoor <b>niet</b> gewijzigd.</p>`,
    confirmLabel: "Start run",
  });
  if (!bevestigd) return;
  const body = { type: "development-run", minutes };
  if (gekozenDoel) body.focusDimension = gekozenDoel;
  const result = await post("/api/runs/start", body);
  if (result.error) { alert(`Kon niet starten: ${result.error}`); return; }
}

function uurMinSec(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const twee = (n) => String(n).padStart(2, "0");
  return `${twee(Math.floor(t / 3600))}:${twee(Math.floor((t % 3600) / 60))}:${twee(t % 60)}`;
}

/** Leesbare weergave per logsoort — de ruwe regels blijven beschikbaar onder "Ruwe logregels". */
const EVENT_WEERGAVE = {
  RUN_START: ["play", "Run gestart", "blue"], RUN_END: ["check", "Run beëindigd", "green"],
  CHALLENGE_OR_GOAL: ["target", "Doel", "blue"], HYPOTHESIS: ["search", "Diagnose", "amber"],
  CANDIDATE_GENERATED: ["book", "Candidate", "blue"], VARIANT_CREATED: ["book", "Candidate", "blue"],
  BENCHMARK_START: ["chart", "Benchmark", "purple"], BENCHMARK_RESULT: ["chart", "Benchmark", "purple"],
  VALIDATOR_RESULT: ["shield", "Validator", "purple"], VALIDATOR_ACTION: ["shield", "Validator", "purple"],
  COMPARISON: ["compare", "Vergelijking", "blue"], REGRESSION_FOUND: ["alert", "Regressie", "red"],
  PROMOTION_DECISION: ["check", "Beslissing", "green"], CHANGE_APPLIED: ["check", "Beslissing: KEEP", "green"],
  VARIANT_REJECTED: ["x", "Beslissing: REJECT", "red"], ERROR: ["alert", "Fout", "red"],
  BUDGET_REACHED: ["clock", "Budget bereikt", "amber"], KNOWN_WEAKNESSES: ["target", "Blijft zwak", "amber"],
  INFO: ["message", "Info", "navy"],
};

const STATUS_LABELS_NL = { STARTING: "wordt gestart…", RUNNING: "loopt", DONE: "afgerond", FAILED: "mislukt", STOPPED: "gestopt" };
const STOPREDEN_LABEL = {
  MAX_MINUTES_REACHED: "Wandklokbudget bereikt",
  MAX_MINUTES_REACHED_BEFORE_FIRST_CYCLE: "Budget al op vóór start",
  NO_PROGRESS_ON_SAME_WEAKNESS: "Geen voortgang op dezelfde zwakte",
  ALL_HYPOTHESES_EXHAUSTED: "Alle hypothesen geprobeerd",
  NOT_EXECUTED: "Geen lokale diagnose mogelijk",
};

function renderKpis(run, detail) {
  const cyclesCount = detail?.cycles?.length ?? 0;
  const kandidatenBewaard = detail?.cycles?.filter((c) => c.decision === "PROMOTION_CANDIDATE").length ?? 0;
  const besteVerbetering = (detail?.cycles ?? [])
    .filter((c) => c.decision === "PROMOTION_CANDIDATE" && c.proof)
    .map((c) => {
      const pre = Object.entries(c.proof.pre.agent).filter(([k]) => k !== "latencyMs" && typeof c.proof.pre.agent[k] === "number");
      const post = Object.entries(c.proof.post.agent).filter(([k]) => k !== "latencyMs" && typeof c.proof.post.agent[k] === "number");
      const preAvg = pre.reduce((s, [, v]) => s + v, 0) / (pre.length || 1);
      const postAvg = post.reduce((s, [, v]) => s + v, 0) / (post.length || 1);
      return postAvg - preAvg;
    })
    .reduce((best, v) => (v > best ? v : best), -Infinity);

  const cards = [
    { icon: "play", color: run?.status === "RUNNING" ? "green" : run?.status === "FAILED" ? "red" : "blue", label: "Runstatus", value: run ? STATUS_LABELS_NL[run.status] || run.status : "Geen actieve run", sub: run?.status === "FAILED" && run.errorMessage ? run.errorMessage : "" },
    { icon: "clock", color: "blue", label: "Verstreken tijd", value: run ? uurMinSec(run.elapsedMs ?? 0) : "—" },
    { icon: "flask", color: "purple", label: "Experimenten", value: cyclesCount },
    { icon: "book", color: "blue", label: "Kandidaten bewaard", value: kandidatenBewaard },
    { icon: "up", color: "green", label: "Beste verbetering", value: besteVerbetering > -Infinity ? `+${besteVerbetering.toFixed(1)}pp` : "—" },
  ];
  document.getElementById("dr-kpis").innerHTML = cards.map((c) => `<div class="stat with-icon">${iconChip(c.icon, c.color)}<div style="min-width:0;"><div class="label">${c.label}</div><div class="value">${c.value}</div>${c.sub ? `<div class="sub bad" style="font-weight:500;">${esc(c.sub)}</div>` : ""}</div></div>`).join("");
}

function renderConfig(actief, run, detail) {
  const rows = [
    ["Basisversie", actief.displayName],
    ["Sandbox mode", "Geïsoleerd"],
    ["Approval mode", "Menselijk"],
    ["Standplaats", "DDR — Dordrecht"],
    ["Focus", detail?.cycles?.[0]?.weakness.weakestDimension ?? (run ? "wordt bepaald bij eerste cyclus" : "—")],
  ];
  document.getElementById("dr-config-table").innerHTML = rows.map(([k, v]) => `<div class="field-row" style="padding:6px 0;"><div style="flex:1;"><span class="field-label" style="text-transform:none; font-size:12.5px; letter-spacing:0;">${k}</span></div><div class="field-value">${esc(v)}</div></div>`).join("");

  const doelen = [
    "Verbeter de gemeten zwakste dimensie zonder een veiligheids-/groundingdimensie te laten verslechteren.",
    "Behoud holdout-prestaties (geen betekenisvolle holdoutverslechtering toegestaan).",
    "Sla een aantoonbaar betere kandidaat op als nieuwe, niet-actieve versie — nooit automatisch activeren.",
    "Stop bij geen voortgang op dezelfde zwakte, in plaats van eindeloos dezelfde aanpak te herhalen.",
  ];
  document.getElementById("dr-doelen").innerHTML = doelen.map((d) => `<li style="margin-bottom:6px;">${d}</li>`).join("");
}

const STAGE_LABELS = ["Diagnose", "Experiment", "Candidate", "Benchmark", "Validator", "Keep/Reject"];
function renderLiveStepper(detail) {
  const cycles = detail?.cycles ?? [];
  const laatste = cycles[cycles.length - 1] ?? null;
  const stages = STAGE_LABELS.map((label, i) => {
    if (!laatste) return { label, status: "pending" };
    const bereikt = [
      laatste.weakness?.executed,
      Boolean(laatste.candidate),
      Boolean(laatste.candidate),
      Boolean(laatste.proof?.executed),
      Boolean(laatste.proof),
      laatste.decision && laatste.decision !== "NOT_EXECUTED",
    ];
    if (!bereikt[i]) return { label, status: "pending" };
    const isLaatsteBereikte = bereikt.slice(i + 1).every((b) => !b);
    if (isLaatsteBereikte && laatste.decision === "NOT_EXECUTED") return { label, status: "failed" };
    // De laatste stap (Keep/Reject) is af zodra er beslist is — dan is er niets meer "bezig".
    return { label, status: isLaatsteBereikte && i < STAGE_LABELS.length - 1 ? "active" : "done" };
  });
  renderStepper(document.getElementById("dr-live-stepper"), stages);
}

function renderProgress(run) {
  const bar = document.getElementById("dr-progress-bar");
  const pct = document.getElementById("dr-progress-pct");
  if (!run) { bar.style.width = "0%"; pct.textContent = "0%"; return; }
  const budgetMatch = /--minutes (\d+)/.exec(run.command ?? "");
  const budgetMin = budgetMatch ? Number(budgetMatch[1]) : null;
  const verstreken = (run.elapsedMs ?? 0) / 60000;
  const percentage = budgetMin ? Math.min(100, Math.round((verstreken / budgetMin) * 100)) : 0;
  bar.style.width = `${percentage}%`;
  pct.textContent = `${percentage}%`;
}

function renderProgressChart(detail) {
  const el = document.getElementById("dr-progress-chart");
  el.innerHTML = "";
  const cycles = (detail?.cycles ?? []).filter((c) => c.proof?.executed);
  if (cycles.length === 0) { el.innerHTML = `<p class="sub" style="font-size:11px; color:#9fb0c9; margin:0;">Nog geen gemeten cycli in deze run.</p>`; return; }
  el.innerHTML = `<p class="sub" style="margin:0 0 6px; font-size:11.5px; color:#7a8aa3; font-weight:700; text-transform:uppercase; letter-spacing:.02em;">Ontwikkeling van de benchmarkscore</p>`;
  const punten = cycles.map((c) => {
    const post = c.proof.post.agent;
    const keys = Object.keys(post).filter((k) => k !== "latencyMs" && typeof post[k] === "number");
    return keys.reduce((s, k) => s + post[k], 0) / (keys.length || 1);
  });
  const chartDiv = document.createElement("div");
  el.appendChild(chartDiv);
  lineChart(chartDiv, [{ name: "Benchmark per experiment", color: "#1f5fd0", points: punten.map((y) => ({ y })) }], { area: true, peakLabel: `${(punten[punten.length - 1]).toFixed(1)}%` });
}

function renderLiveLog(events) {
  const el = document.getElementById("dr-live-log");
  const raw = document.getElementById("dr-live-raw");
  if (!events || events.length === 0) { el.innerHTML = `<div class="empty">Nog geen actieve run.</div>`; raw.textContent = ""; return; }
  const zichtbaar = events.filter((e) => EVENT_WEERGAVE[e.kind]).slice(-12).reverse();
  el.innerHTML = zichtbaar.length === 0
    ? `<div class="empty">Nog geen ontwikkelstappen gelogd.</div>`
    : zichtbaar.map((e) => {
        const [icoon, label, kleur] = EVENT_WEERGAVE[e.kind];
        return `<div class="dr-event"><span class="dr-event-tijd">${new Date(e.timestamp).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}</span>${iconChip(icoon, kleur, "sm")}<span><b>${label}:</b> ${esc(e.message)}</span></div>`;
      }).join("");
  raw.textContent = events.slice(-60).map((e) => `${new Date(e.timestamp).toLocaleTimeString("nl-NL")} | ${e.kind} | ${e.message}`).join("\n");
}

function renderBestCandidate(detail) {
  const el = document.getElementById("dr-best-candidate");
  const beste = detail?.bestCandidateVersionId
    ? (detail.cycles ?? []).find((c) => c.version?.id === detail.bestCandidateVersionId)
    : null;
  if (!beste) { el.innerHTML = `<div class="empty">Nog geen kandidaat.</div>`; return; }
  const gemiddelde = (agent) => {
    const keys = Object.keys(agent ?? {}).filter((k) => k !== "latencyMs" && typeof agent[k] === "number");
    return keys.length ? keys.reduce((som, k) => som + agent[k], 0) / keys.length : null;
  };
  const pre = gemiddelde(beste.proof?.pre?.agent);
  const post = gemiddelde(beste.proof?.post?.agent);
  const hold = gemiddelde(beste.proof?.holdout?.agent);
  const delta = pre !== null && post !== null ? post - pre : null;
  const metriek = (icoon, label, waarde) => `<div class="field-row" style="padding:6px 0;"><div style="flex:1; display:flex; align-items:center; gap:8px;"><span style="width:15px; height:15px; color:var(--accent); display:inline-flex;">${ICONS[icoon]}</span><span style="font-size:12.5px;">${label}</span></div><div class="field-value">${waarde}</div></div>`;
  el.innerHTML = `
    <div class="dr-beste-kop">
      <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;"><b style="font-size:15px;">${esc(beste.candidate.id)}</b><span class="tag good">Voorlopig beste</span></div>
      <div class="sub" style="font-size:11.5px; margin-top:4px;">Verbetering t.o.v. basis</div>
      <div style="font-size:24px; font-weight:800; color:var(--good);">${delta !== null ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} pp` : "—"}</div>
    </div>
    <div class="field-list" style="margin:8px 0 12px;">
      ${metriek("chart", "Benchmark (dev-set)", post !== null ? post.toFixed(1) : "—")}
      ${metriek("layers", `Holdout${hold === null ? " (nog niet voltooid)" : ""}`, hold !== null ? hold.toFixed(1) : "—")}
      ${metriek("shield", "Harde overtredingen / regressies", beste.proof?.regressions?.length ?? 0)}
    </div>
    <p class="sub" style="margin:0 0 10px; font-size:12px; color:#7a8aa3;">${esc(beste.proof.reasoning)}</p>
    <div style="display:flex; gap:8px;">
      <button class="primary" data-goto-candidate="${beste.candidate.id}" style="flex:1;">${ICONS.external}Bekijk kandidaat</button>
      <button class="ghost" data-compare-candidate="${beste.candidate.id}" style="flex:1; justify-content:center; padding:9px 12px;">${ICONS.compare}Vergelijk</button>
    </div>
  `;
  el.querySelector("[data-goto-candidate]").addEventListener("click", () => { location.hash = `#/candidates?id=${encodeURIComponent(beste.candidate.id)}`; });
  el.querySelector("[data-compare-candidate]").addEventListener("click", () => { location.hash = `#/vergelijken?target=${encodeURIComponent(beste.version?.id ?? "")}`; });
}

function renderGates(detail) {
  const cycles = detail?.cycles ?? [];
  // De gates horen bij de kandidaat die rechts als "beste" staat; zonder beste
  // kandidaat bij de laatste cyclus. Anders toonde de kaart de FAIL van een
  // verworpen kandidaat naast een beste kandidaat zonder één regressie.
  const beste = detail?.bestCandidateVersionId ? cycles.find((c) => c.version?.id === detail.bestCandidateVersionId) : null;
  const laatste = beste ?? cycles[cycles.length - 1] ?? null;
  const gates = [
    { icon: "chart", label: "Benchmark", status: laatste?.proof?.executed ? "PASS" : "NIET VOLTOOID" },
    { icon: "shield", label: "Validator", status: laatste?.proof ? (laatste.proof.regressions.length === 0 ? "PASS" : "FAIL") : "NIET VOLTOOID" },
    { icon: "book", label: "Holdout", status: laatste?.proof?.holdout ? "PASS" : "NIET VOLTOOID" },
    { icon: "trophy", label: "Promotie", status: "NIET AUTOMATISCH TOEGESTAAN" },
  ];
  document.getElementById("dr-gates").innerHTML = gates.map((g) => `
    <div class="gate-row"><span class="gate-label">${g.icon ? `<span style="width:15px; height:15px; color:#9fb0c9; display:inline-flex;">${ICONS[g.icon]}</span>` : ""}${g.label}</span><span class="tag ${g.status === "PASS" ? "good" : g.status === "FAIL" ? "bad" : ""}">${g.status}</span></div>
  `).join("");
}

function renderCandidatesTable(detail) {
  const tbody = document.getElementById("dr-candidates");
  const cycles = (detail?.cycles ?? []).filter((c) => c.candidate);
  if (cycles.length === 0) { tbody.innerHTML = `<tr><td colspan="8" class="empty">Nog geen kandidaten in deze run.</td></tr>`; return; }
  tbody.innerHTML = cycles.map((c) => {
    const preAgent = c.proof?.pre.agent ?? {};
    const postAgent = c.proof?.post.agent ?? {};
    const keys = Object.keys(postAgent).filter((k) => k !== "latencyMs" && typeof postAgent[k] === "number");
    const preAvg = keys.reduce((s, k) => s + (preAgent[k] ?? 0), 0) / (keys.length || 1);
    const postAvg = keys.reduce((s, k) => s + (postAgent[k] ?? 0), 0) / (keys.length || 1);
    const delta = postAvg - preAvg;
    const decisionTag = c.decision === "PROMOTION_CANDIDATE" ? "good" : c.decision === "REJECTED" ? "bad" : "warn";
    const isBeste = detail?.bestCandidateVersionId && c.version?.id === detail.bestCandidateVersionId;
    return `<tr${isBeste ? ' class="dash-beste-rij"' : ""}>
      <td><a href="#/experiment-detail?id=${encodeURIComponent(c.candidate.id)}" style="color:var(--accent);">${c.candidate.id}</a></td>
      <td>${c.proof ? new Date(c.proof.startedAt).toLocaleString("nl-NL") : "—"}</td>
      <td style="color:${delta >= 0 ? "var(--good)" : "var(--bad)"};">${delta >= 0 ? "+" : ""}${delta.toFixed(1)}pp</td>
      <td>${postAvg.toFixed(1)}%</td>
      <td>${c.proof?.holdout ? (keys.reduce((s, k) => s + (c.proof.holdout.agent[k] ?? 0), 0) / (keys.length || 1)).toFixed(1) + "%" : "—"}</td>
      <td>${c.proof?.regressions.length ?? 0}</td>
      <td><span class="tag ${decisionTag}">${c.decision}</span></td>
      <td style="max-width:260px;">${c.proof?.reasoning ?? "—"}</td>
    </tr>`;
  }).join("");
}

export async function mount(container) {
  container.innerHTML = html();

  document.getElementById("dr-duur").addEventListener("change", (e) => {
    document.getElementById("dr-duur-custom-wrap").style.display = e.target.value === "custom" ? "block" : "none";
  });
  document.getElementById("dr-doel").addEventListener("change", (e) => { gekozenDoel = e.target.value; });
  document.getElementById("dr-start-btn").addEventListener("click", () => startenRun(selectedMinutes()));
  document.getElementById("dr-proefrun-btn").addEventListener("click", () => startenRun(5));

  async function ververs() {
    const actief = await j("/api/versions/active");
    document.getElementById("dr-basisversie").textContent = actief.displayName;

    const run = await j("/api/current-run");
    let detail = null;
    let events = [];
    if (run && run.kind === "development-run") {
      detail = await j(`/api/development-runs/detail?id=${encodeURIComponent(run.runId)}`);
      const logboek = await j(`/api/logbook/events?runId=${encodeURIComponent(run.runId)}`);
      events = logboek.events ?? [];
    } else {
      const runs = await j("/api/development-runs");
      detail = runs[0] ?? null;
      if (detail) events = (await j(`/api/logbook/events?runId=${encodeURIComponent(detail.runId)}`)).events ?? [];
    }
    // De detail-route geeft `{error:"niet gevonden"}` terug zolang het gespawnde
    // CLI-proces nog geen eerste momentopname geschreven heeft (net gestart) —
    // dat is geen `AutonomousDevelopmentRunResult` en mag de rest van deze
    // functie niet laten crashen op een ontbrekende `.cycles`.
    if (detail && !Array.isArray(detail.cycles)) detail = null;

    const actieveRun = run && run.kind === "development-run" ? run : null;
    renderKpis(actieveRun, detail);
    renderConfig(actief, actieveRun, detail);
    renderLiveStepper(detail);
    renderProgress(actieveRun);
    renderLiveLog(events);
    renderProgressChart(detail);
    renderBestCandidate(detail);
    renderGates(detail);
    renderCandidatesTable(detail);
  }

  await veilig("development-runs", ververs);
  const interval = setInterval(() => veilig("development-runs", ververs), 4000);
  // Phase P: onderaan deze pagina, geen apart tabblad.
  const stopPaneel = await metPaneel(container, mountLongRunsPanel, "long-runs");
  return () => {
    clearInterval(interval);
    stopPaneel();
  };
}
