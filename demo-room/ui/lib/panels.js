import { faseTag, LONGRUN_STOP_LABEL } from "./fase.js";
// Phase P — de nieuwe onderdelen (feedback/concepten, Candidate Factory met
// rechter, Pareto-archief en arena, hervatbare lange runs, releasegeschiedenis)
// als panelen BINNEN de bestaande pagina's. Geen nieuwe hoofdtabbladen: de
// navigatie blijft Dashboard / Test Room / Development Runs / Candidates /
// Vergelijken / Versies / Logboek.
//
// Elk paneel leest uitsluitend bestaande API-routes en toont wat daar staat;
// ontbreekt iets, dan zegt het paneel dat — het verzint geen cijfers.

import { j, post, esc, titleIcon, veilig, ICONS } from "./shared.js";

const VERDICT_TAG = { KEEP: "good", REJECT: "bad", NEEDS_MORE_EVIDENCE: "warn" };
const VERDICT_NL = { KEEP: "behouden", REJECT: "verworpen", NEEDS_MORE_EVIDENCE: "meer bewijs nodig" };
const tijd = (iso) => (iso ? new Date(iso).toLocaleString("nl-NL", { dateStyle: "short", timeStyle: "short" }) : "—");

// ── Candidates: rechter, Pareto-front, arena ─────────────────────────────
export function mountFactoryPanel(el) {
  el.innerHTML = `
    <div class="card" id="pf-factory">
      <h3>${titleIcon("shield", "#2f8f5b")}Onafhankelijke rechter<span class="card-sub" style="margin-left:8px; font-weight:400; font-size:12px;">Bevroren criteria; een gewijzigde meetlat, gewijzigde holdout of een holdoutlek is altijd verworpen.</span></h3>
      <table>
        <thead><tr><th>Kandidaat</th><th>Ontstaan</th><th>Doeldimensie</th><th>Oordeel</th><th>Waarom</th></tr></thead>
        <tbody id="pf-judge-rows"></tbody>
      </table>
    </div>
    <div class="row">
      <div class="col"><div class="card"><h3>${titleIcon("trophy", "#b9862c")}Pareto-front (behouden kandidaten)</h3><div id="pf-front"></div></div></div>
      <div class="col"><div class="card"><h3>${titleIcon("chart", "#1f5fd0")}Arena-rangschikking</h3><div id="pf-arena"></div></div></div>
    </div>`;
  async function laad() {
    const [kandidaten, archief, rang] = await Promise.all([j("/api/factory/candidates"), j("/api/factory/archive"), j("/api/factory/arena")]);
    const rows = document.getElementById("pf-judge-rows");
    if (!rows) return;
    rows.innerHTML = kandidaten.length === 0
      ? `<tr><td colspan="5" class="empty">Nog geen kandidaat met manifest. Een development run legt per kandidaat een manifest vast vóór de meting.</td></tr>`
      : kandidaten.map((k) => `<tr>
          <td><code>${esc(k.manifest.candidateId)}</code></td>
          <td>${tijd(k.manifest.createdAt)}</td>
          <td>${esc(k.manifest.inputs.weaknessDimension ?? "—")}</td>
          <td>${k.oordeel ? `<span class="tag ${VERDICT_TAG[k.oordeel.verdict]}">${VERDICT_NL[k.oordeel.verdict]}</span>` : `<span class="tag">nog niet beoordeeld</span>`}</td>
          <td class="sub">${esc(k.oordeel?.redenen?.join("; ") ?? "")}</td></tr>`).join("");
    const front = (archief.items ?? []).filter((i) => i.gedomineerdDoor.length === 0);
    document.getElementById("pf-front").innerHTML = front.length === 0
      ? `<p class="empty">Nog geen behouden kandidaat. Alleen een KEEP van de rechter komt in het archief.</p>`
      : `<ul>${front.map((i) => `<li><code>${esc(i.punt.id)}</code> <span class="sub">${esc(Object.entries(i.punt.metrics).map(([k, v]) => `${k} ${v >= 0 ? "+" : ""}${Number(v).toFixed(1)}`).join(", "))}</span></li>`).join("")}</ul>
         <p class="sub">${(archief.items ?? []).length - front.length} gedomineerd (bewaard, met door wie).</p>`;
    document.getElementById("pf-arena").innerHTML = rang.length < 2
      ? `<p class="empty">Een arena heeft minstens twee beoordeelde kandidaten nodig.</p>`
      : `<table><thead><tr><th>#</th><th>Kandidaat</th><th>Sterkte</th><th>W/V/G</th><th>Beslissend</th></tr></thead><tbody>${rang
          .map((r, i) => `<tr><td>${i + 1}</td><td><code>${esc(r.kandidaat)}</code></td><td>${r.sterkte.toFixed(2)}</td><td>${r.gewonnen}/${r.verloren}/${r.gelijk}</td><td>${r.beslissend}${r.beslissend < 5 ? ' <span class="tag warn">weinig</span>' : ""}</td></tr>`)
          .join("")}</tbody></table>`;
  }
  return laad;
}

// ── Development Runs: hervatbare lange runs ─────────────────────────────
export function mountLongRunsPanel(el) {
  el.innerHTML = `
    <div class="card" id="pl-long">
      <h3>${titleIcon("clock", "#1f5fd0")}Lange runs (hervatbaar)<span class="card-sub" style="margin-left:8px; font-weight:400; font-size:12px;">Checkpoint na elke cyclus; pauzeren en stoppen gebeurt op een cyclusgrens; alleen actieve tijd telt.</span></h3>
      <div class="row" style="align-items:flex-end;">
        <div class="col" style="max-width:200px;"><label>Profiel</label>
          <select id="pl-profiel"><option value="1h">1 uur</option><option value="6h">6 uur</option><option value="24h">24 uur</option><option value="handmatig">Handmatig (tot stop)</option></select></div>
        <div class="col" style="flex:0 0 auto;"><button class="primary" id="pl-start">${ICONS.play}Start lange run</button></div>
      </div>
      <table style="margin-top:10px;">
        <thead><tr><th>Run</th><th>Profiel</th><th>Status</th><th>Actief</th><th>Cycli</th><th>Laatste cyclus</th><th>Laatste gebeurtenis</th><th></th></tr></thead>
        <tbody id="pl-rows"></tbody>
      </table>
    </div>`;
  async function actie(route, runId) {
    const r = await post(route, { runId });
    if (r.error) alert(r.error);
    await laad();
  }
  document.getElementById("pl-start").addEventListener("click", async () => {
    const r = await post("/api/long-runs/start", { profiel: document.getElementById("pl-profiel").value });
    if (r.error) alert(`Kon niet starten: ${r.error}`);
    await laad();
  });
  async function laad() {
    const runs = await j("/api/long-runs");
    const rows = document.getElementById("pl-rows");
    if (!rows) return;
    rows.innerHTML = runs.length === 0
      ? `<tr><td colspan="8" class="empty">Nog geen lange run.</td></tr>`
      : runs.map((r) => {
          const minuten = (r.actieveMs / 60000).toFixed(1);
          const budget = r.budgetMinuten === null ? "∞" : r.budgetMinuten;
          const tag = { RUNNING: "good", PAUSED: "warn", STOPPED: "bad", DONE: "" }[r.status] ?? "";
          const knoppen = r.status === "RUNNING"
            ? `<button class="ghost" data-pl="pause" data-run="${esc(r.runId)}">Pauzeer</button> <button class="ghost" data-pl="stop" data-run="${esc(r.runId)}">Stop</button> <button class="ghost" data-pl="resume" data-run="${esc(r.runId)}" title="Alleen als het proces is weggevallen (crash); de server weigert als de run nog draait">Hervat na crash</button>`
            : r.status === "PAUSED"
              ? `<button class="ghost" data-pl="resume" data-run="${esc(r.runId)}">Hervat</button> <button class="ghost" data-pl="stop" data-run="${esc(r.runId)}">Stop</button>`
              : "";
          const laatste = r.gebeurtenissen.at(-1);
          // De leercyclus zichtbaar: welke zwakte, welke strategie, welk oordeel, en hoeveel van de elf stappen.
          const cyc = [...r.cycli].reverse().find((c) => c.stadia && c.stadia.length > 0);
          const stappen = cyc ? `${cyc.stadia.filter((st) => st.status === "OK").length}/${cyc.stadia.length} stappen` : "";
          const pad = cyc ? `${esc(cyc.dimensie ?? "?")}/${esc(cyc.strategie ?? "-")} → ${esc(cyc.verdict ?? cyc.beslissing)} <span class="sub">${stappen}</span>` : "—";
          const uitgeput = (r.uitgeslotenDimensies ?? []).length > 0 ? `<div class="sub">lokaal uitgeput: ${esc(r.uitgeslotenDimensies.join(", "))}</div>` : "";
          return `<tr><td><code>${esc(r.runId)}</code><div class="sub">docs/lyra-knowledge/long-runs/${esc(r.runId)}/</div></td><td>${esc(r.profiel)}</td><td><span class="tag ${tag}">${esc(r.status)}${r.stopReden ? ` · ${esc(LONGRUN_STOP_LABEL[r.stopReden] ?? r.stopReden)}` : ""}</span><div>${faseTag(r.fase, esc)}</div>${uitgeput}</td>
            <td>${minuten} / ${budget} min</td><td>${r.cycli.length}${r.segmenten > 1 ? ` <span class="sub">(${r.segmenten} segm.)</span>` : ""}</td><td>${pad}</td><td class="sub">${esc(laatste?.tekst ?? "")}</td><td>${knoppen}</td></tr>`;
        }).join("");
    rows.querySelectorAll("[data-pl]").forEach((b) => b.addEventListener("click", () => actie(`/api/long-runs/${b.dataset.pl}`, b.dataset.run)));
  }
  return laad;
}

// ── Test Room: feedback en concepten ─────────────────────────────────────
export function mountLearningPanel(el) {
  el.innerHTML = `
    <div class="card" id="pln-learning">
      <h3>${titleIcon("users", "#1f5fd0")}Feedback en concepten<span class="card-sub" style="margin-left:8px; font-weight:400; font-size:12px;">Feedback wordt geclassificeerd, nooit direct regel: een voorkeur blijft een voorkeur, alleen een formele NS-bron maakt een CAO-regel.</span></h3>
      <div class="row" style="align-items:flex-end;">
        <div class="col"><label>Feedback</label><input type="text" id="pln-tekst" placeholder="Bijv. Wij willen liever geen vroege dienst direct na een nachtreeks." /></div>
        <div class="col" style="max-width:190px;"><label>Rol</label>
          <select id="pln-rol"><option value="MACHINIST">Machinist</option><option value="PLANNER">Planner</option><option value="ROOSTERCOMMISSIE">Roostercommissie</option><option value="NS_FORMEEL">NS (formeel)</option></select></div>
        <div class="col" style="flex:0 0 auto;"><button class="primary" id="pln-stuur">${ICONS.send}Registreer</button></div>
      </div>
      <p class="sub" id="pln-uitkomst"></p>
      <table><thead><tr><th>Concept</th><th>Scope</th><th>Status</th><th>Meting (holdout)</th><th></th></tr></thead><tbody id="pln-rows"></tbody></table>
    </div>`;
  document.getElementById("pln-stuur").addEventListener("click", async () => {
    const text = document.getElementById("pln-tekst").value.trim();
    const r = await post("/api/learning/feedback", { text, role: document.getElementById("pln-rol").value, authorId: "test-room" });
    const out = document.getElementById("pln-uitkomst");
    if (r.error) { out.textContent = `Niet geregistreerd: ${r.error}`; return; }
    const c = r.classification;
    out.textContent = `Geclassificeerd als ${c.nature} · scope ${c.scope}${c.claimsAuthority ? " · beroept zich op gezag (niet overgenomen zonder formele bron)" : ""}${r.concept ? ` · concept ${r.concept.id} voorgesteld` : ""}.`;
    await laad();
  });
  async function laad() {
    const concepten = await j("/api/learning/concepts");
    const rows = document.getElementById("pln-rows");
    if (!rows) return;
    rows.innerHTML = concepten.length === 0
      ? `<tr><td colspan="5" class="empty">Nog geen concepten.</td></tr>`
      : concepten.map((c) => {
          const m = c.evidence;
          const meting = m && typeof m.holdoutRecall === "number" ? `recall ${(m.holdoutRecall * 100).toFixed(0)}% · fout-positief ${(m.falsePositiveRate * 100).toFixed(0)}%` : "—";
          const knop = c.status === "PROPOSED" || c.status === "TESTING" ? `<button class="ghost" data-meet="${esc(c.id)}">Meet</button>` : "";
          return `<tr><td>${esc(c.statement ?? c.id)}</td><td>${esc(c.scope)}</td><td><span class="tag">${esc(c.status)}</span></td><td class="sub">${meting}</td><td>${knop}</td></tr>`;
        }).join("");
    rows.querySelectorAll("[data-meet]").forEach((b) => b.addEventListener("click", async () => {
      const r = await post("/api/learning/concepts/measure", { id: b.dataset.meet });
      if (r.error) alert(r.error);
      await laad();
    }));
  }
  return laad;
}

// ── Versies: releasegeschiedenis zoals het platform die ziet ─────────────
export function mountReleasePanel(el) {
  el.innerHTML = `
    <div class="card" id="pr-release">
      <h3>${titleIcon("shield", "#2f8f5b")}Releasegeschiedenis (wat het NS Roosterplatform leest)<span class="card-sub" style="margin-left:8px; font-weight:400; font-size:12px;">Elke activatie op naam, met reden en generatie; de prompttekst is geverifieerd met een hash.</span></h3>
      <p id="pr-integriteit" class="sub"></p>
      <table><thead><tr><th>Generatie</th><th>Soort</th><th>Versie</th><th>Vorige</th><th>Door</th><th>Reden</th><th>Wanneer</th></tr></thead><tbody id="pr-rows"></tbody></table>
    </div>`;
  async function laad() {
    const [actief, geschiedenis] = await Promise.all([j("/api/versions/active"), j("/api/versions/releases")]);
    const r = actief.release ?? {};
    const intEl = document.getElementById("pr-integriteit");
    if (!intEl) return;
    const uitleg = { OK: "geverifieerd (hash klopt)", LEGACY: "oude opstelling zonder hash", NO_RELEASE: "nog geen release — het platform draait de standaardinstructie", MISMATCH: "HASH KLOPT NIET — het platform gebruikt de standaardinstructie" }[r.integrity] ?? r.integrity;
    intEl.innerHTML = `Integriteit: <span class="tag ${r.integrity === "OK" ? "good" : r.integrity === "MISMATCH" ? "bad" : "warn"}">${esc(uitleg)}</span> · generatie ${r.generation ?? 0}${r.detail ? ` · ${esc(r.detail)}` : ""}`;
    document.getElementById("pr-rows").innerHTML = geschiedenis.length === 0
      ? `<tr><td colspan="7" class="empty">Nog geen activatie via de releasedienst.</td></tr>`
      : [...geschiedenis].reverse().map((g) => `<tr><td>${g.generation}</td><td>${esc(g.kind)}</td><td><code>${esc(g.activeVersionId)}</code></td><td><code>${esc(g.previousVersionId ?? "—")}</code></td><td>${esc(g.approvedBy?.id ?? "—")} <span class="sub">${esc(g.approvedBy?.role ?? "")}</span></td><td class="sub">${esc(g.reason ?? "")}</td><td>${tijd(g.activatedAt)}</td></tr>`).join("");
  }
  return laad;
}

/** Monteert een paneel onderaan een pagina en ververst het mee; geeft een opruimfunctie terug. */
export async function metPaneel(container, maak, naam, intervalMs = 8000) {
  const el = document.createElement("div");
  el.dataset.paneel = naam;
  container.appendChild(el);
  const laad = maak(el);
  await veilig(naam, laad);
  const id = setInterval(() => veilig(naam, laad), intervalMs);
  return () => clearInterval(id);
}
