// Development Runs (§ UI/UX REBUILD, foto 3): commandocentrum voor autonome
// Lyra-development runs. Configureren + live meekijken wat de Sandbox doet.

import { j, post, veilig } from "../lib/shared.js";
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
      <h3>Development Run</h3>
      <p class="sub" style="margin:0 0 10px; color:#556; font-size:13px;">Start en bewaak een autonome ontwikkelrun voor Lyra. De run maakt geïsoleerde kandidaten, test verbeteringen en bewaart alleen aantoonbare vooruitgang.</p>
      <div class="row" style="align-items:flex-end;">
        <div class="col" style="max-width:280px;">
          <label>Basisversie</label>
          <div id="dr-basisversie" style="padding:7px 0; font-size:13px; font-weight:600;">—</div>
        </div>
        <div class="col" style="max-width:320px;">
          <label>Doel</label>
          <select id="dr-doel">${DOEL_OPTIES.map((o) => `<option value="${o.value}">${o.label}</option>`).join("")}</select>
        </div>
        <div class="col" style="max-width:160px;">
          <label>Duur</label>
          <select id="dr-duur">${DUUR_OPTIES.map((o) => `<option value="${o.minutes ?? "custom"}">${o.label}</option>`).join("")}</select>
        </div>
        <div class="col" id="dr-duur-custom-wrap" style="max-width:140px; display:none;">
          <label>Minuten</label>
          <input type="number" id="dr-duur-custom" min="5" value="120" />
        </div>
      </div>
      <div class="row" style="margin-top:6px;">
        <div class="col">
          <label style="display:flex; align-items:center; gap:6px; margin-top:14px;"><input type="checkbox" checked disabled /> Benchmarkset (altijd actief — kernonderdeel van de meetpijplijn)</label>
          <label style="display:flex; align-items:center; gap:6px;"><input type="checkbox" checked disabled /> Holdout (altijd actief, volgens de locked-holdout-discipline — nooit gebruikt om te tunen)</label>
          <label style="display:flex; align-items:center; gap:6px;"><input type="checkbox" checked disabled /> Validator (regressiecontrole, altijd actief)</label>
        </div>
      </div>
      <div style="display:flex; gap:10px; margin-top:14px;">
        <button class="primary" id="dr-start-btn">Start development run</button>
        <button class="ghost" id="dr-proefrun-btn">Korte proefrun (5 min)</button>
      </div>
    </div>

    <div class="grid" id="dr-kpis" style="margin-bottom:14px;"></div>

    <div class="row">
      <div class="col" style="max-width:340px;">
        <div class="card">
          <h3>Runconfiguratie</h3>
          <table id="dr-config-table" style="font-size:13px;"><tbody></tbody></table>
        </div>
        <div class="card">
          <h3>Actieve doelen</h3>
          <ol id="dr-doelen" style="margin:0; padding-left:18px; font-size:13px;"></ol>
        </div>
      </div>
      <div class="col">
        <div class="card">
          <h3>Live ontwikkellus</h3>
          <div id="dr-live-log" style="font-family: ui-monospace, monospace; font-size:12px; background:#0f172a; color:#d6e2f0; padding:12px; border-radius:8px; max-height:280px; overflow:auto; white-space:pre-wrap;">Nog geen actieve run.</div>
        </div>
      </div>
      <div class="col" style="max-width:320px;">
        <div class="card">
          <h3>Beste kandidaat nu</h3>
          <div id="dr-best-candidate"></div>
        </div>
        <div class="card">
          <h3>Gate status</h3>
          <div class="gate-list" id="dr-gates"></div>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>Kandidaten in deze run</h3>
      <table><thead><tr><th>Kandidaat</th><th>Aangemaakt</th><th>Verbetering</th><th>Benchmark</th><th>Holdout</th><th>Overtredingen</th><th>Beslissing</th><th>Reden</th></tr></thead><tbody id="dr-candidates"></tbody></table>
    </div>
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

const STATUS_LABELS_NL = { STARTING: "wordt gestart…", RUNNING: "loopt", DONE: "afgerond", FAILED: "mislukt", STOPPED: "gestopt" };
const STOPREDEN_LABEL = {
  MAX_MINUTES_REACHED: "Wandklokbudget bereikt",
  MAX_MINUTES_REACHED_BEFORE_FIRST_CYCLE: "Budget al op vóór start",
  NO_PROGRESS_ON_SAME_WEAKNESS: "Geen voortgang op dezelfde zwakte",
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
    { label: "Runstatus", value: run ? STATUS_LABELS_NL[run.status] || run.status : "Geen actieve run" },
    { label: "Verstreken tijd", value: run ? `${Math.round((run.elapsedMs ?? 0) / 60000)} min` : "—" },
    { label: "Experimenten", value: cyclesCount },
    { label: "Kandidaten bewaard", value: kandidatenBewaard },
    { label: "Beste verbetering", value: besteVerbetering > -Infinity ? `+${besteVerbetering.toFixed(1)}pp` : "—" },
  ];
  document.getElementById("dr-kpis").innerHTML = cards.map((c) => `<div class="stat"><div class="label">${c.label}</div><div class="value">${c.value}</div></div>`).join("");
}

function renderConfig(actief, run, detail) {
  const rows = [
    ["Basisversie", actief.displayName],
    ["Sandbox mode", "Geïsoleerd (nooit direct op actieve productie)"],
    ["Approval mode", "Menselijk (promotie activeert nooit vanzelf)"],
    ["Standplaats", "DDR — Dordrecht"],
    ["Focus", detail?.cycles?.[0]?.weakness.weakestDimension ?? (run ? "wordt bepaald bij eerste cyclus" : "—")],
  ];
  document.getElementById("dr-config-table").querySelector("tbody").innerHTML = rows.map(([k, v]) => `<tr><td style="color:var(--muted); padding:2px 8px 2px 0;">${k}</td><td>${v}</td></tr>`).join("");

  const doelen = [
    "Verbeter de gemeten zwakste dimensie zonder een veiligheids-/groundingdimensie te laten verslechteren.",
    "Behoud holdout-prestaties (geen betekenisvolle holdoutverslechtering toegestaan).",
    "Sla een aantoonbaar betere kandidaat op als nieuwe, niet-actieve versie — nooit automatisch activeren.",
    "Stop bij geen voortgang op dezelfde zwakte, in plaats van eindeloos dezelfde aanpak te herhalen.",
  ];
  document.getElementById("dr-doelen").innerHTML = doelen.map((d) => `<li style="margin-bottom:6px;">${d}</li>`).join("");
}

function renderLiveLog(events) {
  const el = document.getElementById("dr-live-log");
  if (!events || events.length === 0) { el.textContent = "Nog geen actieve run."; return; }
  el.textContent = events
    .slice(-40)
    .map((e) => `${new Date(e.timestamp).toLocaleTimeString("nl-NL")} | ${e.kind} | ${e.message}`)
    .join("\n");
  el.scrollTop = el.scrollHeight;
}

function renderBestCandidate(detail) {
  const el = document.getElementById("dr-best-candidate");
  const beste = detail?.bestCandidateVersionId
    ? (detail.cycles ?? []).find((c) => c.version?.id === detail.bestCandidateVersionId)
    : null;
  if (!beste) { el.innerHTML = `<div class="empty">Nog geen kandidaat.</div>`; return; }
  el.innerHTML = `
    <span class="tag good">Voorlopig beste</span>
    <p style="margin:8px 0 4px; font-size:13px;"><b>${beste.candidate.id}</b></p>
    <p class="sub" style="margin:0; font-size:12px;">${beste.proof.reasoning}</p>
    <div style="margin-top:8px;">
      <button class="ghost" data-goto-candidate="${beste.candidate.id}">Bekijk kandidaat</button>
    </div>
  `;
  el.querySelector("[data-goto-candidate]").addEventListener("click", () => { location.hash = `#/candidates?id=${encodeURIComponent(beste.candidate.id)}`; });
}

function renderGates(detail) {
  const cycles = detail?.cycles ?? [];
  const laatste = cycles[cycles.length - 1] ?? null;
  const gates = [
    { label: "Benchmark", status: laatste?.proof?.executed ? "PASS" : "NIET VOLTOOID" },
    { label: "Validator", status: laatste?.proof ? (laatste.proof.regressions.length === 0 ? "PASS" : "FAIL") : "NIET VOLTOOID" },
    { label: "Holdout", status: laatste?.proof?.holdout ? "PASS" : "NIET VOLTOOID" },
    { label: "Promotie", status: "NIET AUTOMATISCH TOEGESTAAN" },
  ];
  document.getElementById("dr-gates").innerHTML = gates.map((g) => `
    <div class="gate-row"><span>${g.label}</span><span class="tag ${g.status === "PASS" ? "good" : g.status === "FAIL" ? "bad" : ""}">${g.status}</span></div>
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
    return `<tr>
      <td>${c.candidate.id}</td>
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

    renderKpis(run && run.kind === "development-run" ? run : null, detail);
    renderConfig(actief, run && run.kind === "development-run" ? run : null, detail);
    renderLiveLog(events);
    renderBestCandidate(detail);
    renderGates(detail);
    renderCandidatesTable(detail);
  }

  await veilig("development-runs", ververs);
  const interval = setInterval(() => veilig("development-runs", ververs), 4000);
  return () => clearInterval(interval);
}
