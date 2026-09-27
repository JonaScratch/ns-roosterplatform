// Dashboard (§ UI/UX REBUILD, foto 1 — leidend, niet afwijken).
//
// Moet in enkele seconden antwoord geven op: welke Lyra draait nu, wat is de
// beste kandidaat, wordt Lyra beter, wat zijn de grootste zwakke punten, wat
// was de laatste ontwikkelrun, kan ik nu een nieuwe run starten.

import { j, post, iconChip, nl1, lineChart, renderStepper, veilig } from "../lib/shared.js";
import { confirmAction } from "../app.js";

const DUUR_OPTIES = [
  { minutes: 60, label: "1 uur", sub: "Snelle ontwikkelrun, klein aantal experimenten." },
  { minutes: 360, label: "6 uur", sub: "Standaard run." },
  { minutes: 1440, label: "24 uur", sub: "Uitgebreide autonome ontwikkelrun." },
  { minutes: null, label: "Aangepast", sub: "Eigen maximale tijd." },
];

let gekozenDuurMinuten = 360;

function html() {
  return `
    <div class="row" style="align-items:stretch;">
      <div class="col" style="max-width:420px;">
        <div class="card" style="height:100%; display:flex; gap:14px;">
          <div id="dash-active-icon"></div>
          <div>
            <div style="color:var(--muted); text-transform:uppercase; font-size:11px; letter-spacing:.05em; font-weight:600;">Actieve Lyra</div>
            <div style="display:flex; align-items:baseline; gap:10px; margin:4px 0;">
              <span id="dash-active-version" style="font-size:26px; font-weight:700; color:var(--bg);">—</span>
              <span class="tag good" id="dash-active-tag">ACTIEF</span>
            </div>
            <table style="font-size:12px; margin-top:6px;"><tbody id="dash-active-fields"></tbody></table>
            <p id="dash-active-sub" style="margin:8px 0 0; color:#556; font-size:12px;">Dit is de huidige productieve baseline. Gebruik de Test Room en ontwikkelruns om verbeterde kandidaten te maken en te testen tegen deze versie.</p>
          </div>
        </div>
      </div>
      <div class="col">
        <div class="card" id="dash-best-candidate" style="height:100%;">
          <h3>Beste kandidaat</h3>
          <div id="dash-best-candidate-body"></div>
        </div>
      </div>
      <div class="col">
        <div class="card" style="height:100%;">
          <h3>Nieuwe ontwikkelrun starten</h3>
          <div class="row" id="dash-duur-tiles" style="gap:8px; flex-wrap:wrap;"></div>
          <div id="dash-duur-custom" style="display:none; margin-top:8px;">
            <label>Aantal minuten</label>
            <input type="number" id="dash-duur-custom-input" min="5" value="120" style="max-width:140px;" />
          </div>
          <button class="primary" id="dash-start-run-btn" style="width:100%; margin-top:12px;">Start ontwikkelrun van 6 uur</button>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>Belangrijkste cijfers</h3>
      <div class="grid" id="dash-kpis"></div>
    </div>

    <div class="row">
      <div class="col">
        <div class="card">
          <h3>Benchmarkontwikkeling</h3>
          <p class="sub" style="margin:0 0 8px; color:#556; font-size:13px;">Alleen werkelijk gemeten momenten — geen lijn over niet-gemeten punten.</p>
          <div id="dash-chart-benchmark"></div>
        </div>
      </div>
      <div class="col">
        <div class="card">
          <h3>Belangrijkste zwakke punten <button class="ghost" id="dash-zwaktes-alle" style="float:right;">Bekijk alle</button></h3>
          <table><thead><tr><th>Categorie</th><th>Ernst</th><th>Beschrijving</th><th>Status</th></tr></thead><tbody id="dash-zwaktes"></tbody></table>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>Laatste ontwikkelrun <button class="ghost" id="dash-runs-alle" style="float:right;">Bekijk alle runs</button></h3>
      <div id="dash-laatste-run"></div>
    </div>

    <div class="card">
      <h3>Kandidaatvergelijking <button class="ghost" id="dash-vergelijk-details" style="float:right;">Bekijk details</button></h3>
      <table><thead><tr><th>Versie / kandidaat</th><th>Benchmark dev</th><th>Holdout</th><th>Regels</th><th>Status</th></tr></thead><tbody id="dash-kandidaatvergelijking"></tbody></table>
    </div>

    <div class="row">
      <div class="col">
        <div class="card">
          <h3>Recente bevindingen &amp; aanbevelingen</h3>
          <div id="dash-bevindingen"></div>
        </div>
      </div>
      <div class="col" style="max-width:320px;">
        <div class="card">
          <h3>Snelle acties</h3>
          <div style="display:flex; flex-direction:column; gap:8px;">
            <button class="primary" id="dash-quick-testroom">Open Test Room</button>
            <button class="ghost" id="dash-quick-startrun">Start ontwikkelrun</button>
            <button class="ghost" id="dash-quick-bestcandidate" style="display:none;">Bekijk beste kandidaat</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderDuurTiles(container) {
  container.innerHTML = DUUR_OPTIES.map((o, i) => `
    <button type="button" class="option-tile${o.minutes === gekozenDuurMinuten ? " selected" : ""}" data-duur-index="${i}" style="flex:1; min-width:100px;">
      <div class="option-title">${o.label}</div>
      <div class="option-sub">${o.sub}</div>
    </button>
  `).join("");
  container.querySelectorAll("[data-duur-index]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const optie = DUUR_OPTIES[Number(btn.dataset.duurIndex)];
      gekozenDuurMinuten = optie.minutes ?? Number(document.getElementById("dash-duur-custom-input")?.value || 120);
      document.getElementById("dash-duur-custom").style.display = optie.minutes === null ? "block" : "none";
      renderDuurTiles(container);
      bijwerkenStartKnop();
    });
  });
}

function bijwerkenStartKnop() {
  const uren = gekozenDuurMinuten / 60;
  const label = Number.isInteger(uren) ? `${uren} uur` : `${gekozenDuurMinuten} min`;
  document.getElementById("dash-start-run-btn").textContent = `Start ontwikkelrun van ${label}`;
}

async function startOntwikkelrun() {
  const bevestigd = await confirmAction({
    title: "Development run starten?",
    bodyHtml: `<p>Start een autonome ontwikkelrun van maximaal <b>${gekozenDuurMinuten} minuten</b>. De actieve productie-Lyra wordt hierdoor <b>niet</b> gewijzigd — kandidaten worden alleen in de sandbox getest en, bij een aantoonbare verbetering, als niet-actieve versie opgeslagen.</p>`,
    confirmLabel: "Start run",
  });
  if (!bevestigd) return;
  const result = await post("/api/runs/start", { type: "development-run", minutes: gekozenDuurMinuten });
  if (result.error) { alert(`Kon niet starten: ${result.error}`); return; }
  location.hash = "#/development-runs";
}

function statusTagClass(decision) {
  return decision === "PROMOTION_CANDIDATE" ? "good" : decision === "REJECTED" ? "bad" : "warn";
}

async function laadBesteKandidaat() {
  const kandidaten = await j("/api/candidates");
  const gepromoveerd = kandidaten.filter((c) => c.decision === "PROMOTION_CANDIDATE");
  const beste = gepromoveerd.length > 0
    ? gepromoveerd.reduce((b, c) => ((c.benchmarkDelta ?? -Infinity) > (b.benchmarkDelta ?? -Infinity) ? c : b))
    : null;
  const body = document.getElementById("dash-best-candidate-body");
  if (!beste) {
    body.innerHTML = `<div class="empty">Nog geen kandidaat beschikbaar.</div>`;
    document.getElementById("dash-quick-bestcandidate").style.display = "none";
    return { beste: null, kandidaten };
  }
  body.innerHTML = `
    <div style="display:flex; align-items:baseline; gap:10px;">
      <span class="tag good">PROMOTION_CANDIDATE</span>
      <span style="font-size:20px; font-weight:700; color:var(--good);">${beste.benchmarkDelta !== null ? `+${beste.benchmarkDelta.toFixed(1)}pp` : "—"}</span>
    </div>
    <p style="margin:8px 0 4px; font-size:13px;">${beste.candidateId} · benchmark ${beste.benchmarkDev !== null ? beste.benchmarkDev.toFixed(1) + "%" : "—"} · veiligheid ${beste.validator === "PASS" ? "geen regressies" : "ONBEKEND"}</p>
    <div style="display:flex; gap:8px; margin-top:10px;">
      <button class="primary" id="dash-open-candidate">Open kandidaat</button>
      <button class="ghost" id="dash-compare-candidate">Vergelijk met actief</button>
    </div>
  `;
  document.getElementById("dash-open-candidate").addEventListener("click", () => { location.hash = `#/candidates?id=${encodeURIComponent(beste.candidateId)}`; });
  document.getElementById("dash-compare-candidate").addEventListener("click", () => { location.hash = `#/vergelijken?target=${encodeURIComponent(beste.candidateId)}`; });
  document.getElementById("dash-quick-bestcandidate").style.display = "block";
  document.getElementById("dash-quick-bestcandidate").onclick = () => { location.hash = `#/candidates?id=${encodeURIComponent(beste.candidateId)}`; };
  return { beste, kandidaten };
}

const STATUS_LABEL_NL = { ACTIVE: "ACTIEF", SUPERSEDED: "VERVANGEN", ROLLED_BACK: "TERUGGEDRAAID", FAILED: "MISLUKT" };

async function laadActieveVersie() {
  const actief = await j("/api/versions/active");
  document.getElementById("dash-active-icon").innerHTML = iconChip("layers", "blue", "lg");
  document.getElementById("dash-active-version").textContent = actief.displayName;
  document.getElementById("dash-active-tag").textContent = STATUS_LABEL_NL[actief.status] || actief.status;
  document.getElementById("dash-active-tag").className = `tag ${actief.status === "ACTIVE" ? "good" : actief.status === "FAILED" ? "bad" : "warn"}`;
  document.getElementById("dash-active-fields").innerHTML = [
    ["Variant", actief.variantId || "(baseline)"],
    ["Standplaats", "DDR — Dordrecht"],
    ["Benchmark (dev)", actief.benchmarkReference ? "aanwezig" : "nog geen meting"],
    ["Betrouwbaarheid", actief.isBaseline ? "kale productie-instructie" : "sandbox-gevalideerd"],
  ].map(([k, v]) => `<tr><td style="color:var(--muted); padding:2px 8px 2px 0;">${k}</td><td>${v}</td></tr>`).join("");
  return actief;
}

async function laadKpis(actief) {
  const overview = await j("/api/overview");
  const runs = await j("/api/development-runs");
  const laatsteRun = runs[0] ?? null;
  const kandidaten = await j("/api/candidates");
  const gepromoveerd = kandidaten.filter((c) => c.decision === "PROMOTION_CANDIDATE");
  const besteDelta = gepromoveerd.length > 0 ? Math.max(...gepromoveerd.map((c) => c.benchmarkDelta ?? -Infinity)) : null;
  const eenWeekGeleden = Date.now() - 7 * 24 * 3600 * 1000;
  const kandidatenDezeWeek = kandidaten.filter((c) => new Date(c.createdAt).getTime() >= eenWeekGeleden).length;

  const cards = [
    { icon: "gear", color: "blue", label: "Actuele benchmarkscore", value: overview.latestBenchmark ? nl1(overview.latestBenchmark.passRate / 100) : "Nog geen meting", sub: overview.latestBenchmark ? overview.latestBenchmark.label : "" },
    { icon: "bolt", color: "amber", label: "Laatste verbetering", value: besteDelta !== null && besteDelta > -Infinity ? `+${besteDelta.toFixed(1)}pp` : "Nog geen meting", sub: "beste kandidaat t.o.v. actief" },
    { icon: "target", color: "purple", label: "Open zwakke punten", value: laatsteRun ? new Set(laatsteRun.cycles.filter((c) => c.decision !== "PROMOTION_CANDIDATE" && c.weakness.weakestDimension).map((c) => c.weakness.weakestDimension)).size : 0, sub: "actuele diagnosepunten" },
    { icon: "users", color: "green", label: "Kandidaten deze week", value: kandidatenDezeWeek, sub: `${kandidaten.length} totaal` },
    { icon: "chart", color: "navy", label: "Laatste run duur", value: laatsteRun ? `${Math.round((new Date(laatsteRun.finishedAt) - new Date(laatsteRun.startedAt)) / 60000)} min` : "—", sub: laatsteRun ? new Date(laatsteRun.finishedAt).toLocaleDateString("nl-NL") : "nog geen run" },
  ];
  document.getElementById("dash-kpis").innerHTML = cards.map((c) => `
    <div class="stat with-icon">${iconChip(c.icon, c.color)}<div><div class="label">${c.label}</div><div class="value">${c.value}</div><div class="sub">${c.sub}</div></div></div>
  `).join("");
  return { runs, laatsteRun, kandidaten };
}

const STOPREDEN_LABEL = {
  MAX_MINUTES_REACHED: "Wandklokbudget bereikt",
  MAX_MINUTES_REACHED_BEFORE_FIRST_CYCLE: "Budget al op vóór start",
  NO_PROGRESS_ON_SAME_WEAKNESS: "Geen voortgang op dezelfde zwakte",
  NOT_EXECUTED: "Geen lokale diagnose mogelijk",
};

function renderLaatsteRun(run) {
  const el = document.getElementById("dash-laatste-run");
  if (!run) {
    el.innerHTML = `<div class="empty">Nog geen ontwikkelrun uitgevoerd. Start er hierboven één.</div>`;
    return;
  }
  const laatsteCyclus = run.cycles[run.cycles.length - 1] ?? null;
  const stages = [
    { key: "diagnose", label: "Diagnose", status: laatsteCyclus?.weakness.executed ? "done" : run.stopReason === "NOT_EXECUTED" ? "failed" : "pending" },
    { key: "experiment", label: "Experiment", status: laatsteCyclus?.candidate ? "done" : "pending" },
    { key: "kandidaten", label: "Kandidaten", status: laatsteCyclus?.candidate ? "done" : "pending" },
    { key: "benchmark", label: "Benchmark", status: laatsteCyclus?.proof?.executed ? "done" : "pending" },
    { key: "validatie", label: "Validatie", status: laatsteCyclus?.proof ? "done" : "pending" },
    { key: "beslissing", label: "Beslissing", status: laatsteCyclus && laatsteCyclus.decision !== "NOT_EXECUTED" ? "done" : "pending" },
  ];
  const conclusieTekst = run.acceptedCount > 0
    ? `Verbeterde kandidaat gevonden — ${run.acceptedCount} van ${run.cycles.length} kandida(a)t(en) gepromoveerd deze run.`
    : run.cycles.length === 0
      ? `Geen enkele cyclus kon starten (${STOPREDEN_LABEL[run.stopReason] || run.stopReason}).`
      : `Geen aantoonbare verbetering gevonden binnen deze run — een geldig resultaat, geen mislukking (${STOPREDEN_LABEL[run.stopReason] || run.stopReason}).`;
  el.innerHTML = `
    <p style="margin:0 0 8px; font-size:13px; color:#556;">${run.runId} · ${new Date(run.startedAt).toLocaleString("nl-NL")}</p>
    <div class="stepper" id="dash-laatste-run-stepper"></div>
    <p style="margin-top:10px; font-weight:600; color:${run.acceptedCount > 0 ? "var(--good)" : "#334"};">${run.acceptedCount > 0 ? "Verbeterde kandidaat gevonden" : "Geen aantoonbare verbetering"}</p>
    <p class="sub" style="margin:2px 0 0; font-size:13px; color:#556;">${conclusieTekst}</p>
  `;
  renderStepper(document.getElementById("dash-laatste-run-stepper"), stages);
}

function renderZwaktes(runs) {
  const tel = new Map();
  for (const run of runs) {
    for (const cycle of run.cycles) {
      const dim = cycle.weakness?.weakestDimension;
      if (!dim) continue;
      const bestaand = tel.get(dim) ?? { count: 0, opgelost: false };
      bestaand.count += 1;
      if (cycle.decision === "PROMOTION_CANDIDATE") bestaand.opgelost = true;
      tel.set(dim, bestaand);
    }
  }
  const tbody = document.getElementById("dash-zwaktes");
  if (tel.size === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty">Nog geen diagnosepunten vastgelegd (pas zichtbaar na een development run).</td></tr>`;
    return;
  }
  const rijen = [...tel.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 6);
  tbody.innerHTML = rijen.map(([dim, info]) => `
    <tr>
      <td>${dim}</td>
      <td><span class="tag ${info.count >= 3 ? "bad" : info.count === 2 ? "warn" : ""}">${info.count >= 3 ? "Hoog" : info.count === 2 ? "Middel" : "Laag"}</span></td>
      <td>Zwakste gemeten dimensie in ${info.count} cyclus/cycli.</td>
      <td><span class="tag ${info.opgelost ? "good" : "warn"}">${info.opgelost ? "Opgelost" : "In onderzoek"}</span></td>
    </tr>
  `).join("");
}

function renderKandidaatvergelijking(actief, kandidaten) {
  const tbody = document.getElementById("dash-kandidaatvergelijking");
  const top5 = [...kandidaten].sort((a, b) => (b.benchmarkDelta ?? -Infinity) - (a.benchmarkDelta ?? -Infinity)).slice(0, 5);
  const rijen = [
    `<tr><td><b>${actief.displayName}</b> <span class="tag info">actief</span></td><td>${actief.benchmarkReference ? "aanwezig" : "—"}</td><td>—</td><td>—</td><td><span class="tag good">ACTIEF</span></td></tr>`,
    ...top5.map((c) => `
      <tr class="clickable" data-candidate="${c.candidateId}">
        <td>${c.candidateId}</td>
        <td>${c.benchmarkDev !== null ? c.benchmarkDev.toFixed(1) + "%" : "—"}</td>
        <td>${c.holdout !== null ? c.holdout.toFixed(1) + "%" : "—"}</td>
        <td>${c.validator === "PASS" ? "OK" : c.validator === "FAIL" ? "Overtreding" : "—"}</td>
        <td><span class="tag ${statusTagClass(c.decision)}">${c.decision}</span></td>
      </tr>`),
  ];
  tbody.innerHTML = rijen.join("") || `<tr><td colspan="5" class="empty">Nog geen kandidaten</td></tr>`;
  tbody.querySelectorAll("[data-candidate]").forEach((tr) => tr.addEventListener("click", () => { location.hash = `#/candidates?id=${encodeURIComponent(tr.dataset.candidate)}`; }));
}

function renderBevindingen(kandidaten, zwaktesRuns) {
  const el = document.getElementById("dash-bevindingen");
  const regels = [];
  const gepromoveerd = kandidaten.filter((c) => c.decision === "PROMOTION_CANDIDATE").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (gepromoveerd[0]) regels.push(`Kandidaat ${gepromoveerd[0].candidateId} verbeterde de benchmark met ${gepromoveerd[0].benchmarkDelta !== null ? "+" + gepromoveerd[0].benchmarkDelta.toFixed(1) + "pp" : "een aantoonbaar verschil"}.`);
  if (gepromoveerd[0]?.validator === "PASS") regels.push("Geen veiligheidsregressie bij de laatste promotie.");
  const openZwaktes = [...new Set(zwaktesRuns.flatMap((r) => r.cycles.filter((c) => c.decision !== "PROMOTION_CANDIDATE").map((c) => c.weakness?.weakestDimension).filter(Boolean)))];
  if (openZwaktes.length > 0) regels.push(`Blijft zwak: ${openZwaktes.slice(0, 2).join(", ")}.`);
  if (regels.length === 0) regels.push("Nog geen development run uitgevoerd — start hierboven de eerste run om bevindingen te verzamelen.");
  el.innerHTML = `<ul style="margin:0; padding-left:18px; font-size:13px; color:#334;">${regels.slice(0, 5).map((r) => `<li style="margin-bottom:6px;">${r}</li>`).join("")}</ul>`;
}

export async function mount(container) {
  container.innerHTML = html();
  renderDuurTiles(document.getElementById("dash-duur-tiles"));
  bijwerkenStartKnop();
  document.getElementById("dash-start-run-btn").addEventListener("click", startOntwikkelrun);
  document.getElementById("dash-quick-startrun").addEventListener("click", startOntwikkelrun);
  document.getElementById("dash-quick-testroom").addEventListener("click", () => { location.hash = "#/test-room"; });
  document.getElementById("dash-runs-alle").addEventListener("click", () => { location.hash = "#/development-runs"; });
  document.getElementById("dash-zwaktes-alle").addEventListener("click", () => { location.hash = "#/development-runs"; });
  document.getElementById("dash-vergelijk-details").addEventListener("click", () => { location.hash = "#/vergelijken"; });

  async function ververs() {
    const actief = await laadActieveVersie();
    await veilig("beste-kandidaat", laadBesteKandidaat);
    const { runs, laatsteRun, kandidaten } = await laadKpis(actief);
    await veilig("timeline", async () => {
      const timeline = await j("/api/progress/benchmark-timeline");
      lineChart(document.getElementById("dash-chart-benchmark"), [
        { name: "dev", color: "#1f5fd0", points: timeline.map((t) => ({ x: t.timestamp, y: t.dev })) },
        { name: "holdout", color: "#c9622a", points: timeline.map((t) => ({ x: t.timestamp, y: t.holdout })) },
      ]);
    });
    renderZwaktes(runs);
    renderLaatsteRun(laatsteRun);
    renderKandidaatvergelijking(actief, kandidaten);
    renderBevindingen(kandidaten, runs);
  }

  await veilig("dashboard", ververs);
  const interval = setInterval(() => veilig("dashboard", ververs), 8000);
  return () => clearInterval(interval);
}
