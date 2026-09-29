// Test Room (§ UI/UX REBUILD, foto 2): een echte interactieve chatwerkruimte
// — geen benchmarkscherm. Elk bericht gaat via /api/chat naar dezelfde
// askAgent()-motor als productie (demo-room/src/cli.ts's "chat"-commando),
// nooit een nagemaakt antwoord.
//
// Drie kolommen zoals de referentie: links wát er getest wordt (versie of
// kandidaat, en de roostercontext), midden het gesprek, rechts de context en
// de controle per antwoord. Rechts staat ook wat alleen een ontwikkelaar
// hoort te zien: wat een grendel tegenhield en wat de plancontrole aan het
// modelplan veranderde (AFTER-analyse 20260929-151948). Alleen echte
// gegevens: tools die daadwerkelijk zijn aangeroepen, kandidaten die echt
// bestaan — een kandidaat zonder opgeslagen versie is zichtbaar maar niet
// kiesbaar, met de reden erbij.

import { j, post, veilig, titleIcon, ICONS, esc, fmtPp } from "../lib/shared.js";
import { mountLearningPanel, metPaneel } from "../lib/panels.js";

const QUICK_ACTIONS = [
  { icon: "search", label: "Analyseer rooster", text: "Analyseer dit rooster op knelpunten: welke diensten of reeksen vallen op?" },
  { icon: "edit", label: "Tweak rooster", text: "Stel een kleine, gerichte aanpassing voor die één concreet knelpunt oplost, zonder de rest van het rooster te verstoren." },
  { icon: "shield", label: "Check CAO-regels", text: "Controleer of dit rooster voldoet aan de bekende CAO-/rusttijdregels en noem elke regel die je daadwerkelijk hebt gecontroleerd." },
  { icon: "compare", label: "Vergelijk versies", text: "Vergelijk deze kandidaat met de vorige versie: wat is er merkbaar veranderd in gedrag of uitkomst?" },
];

const STATUS_LABEL = {
  BEANTWOORD: "Beantwoord", VERDUIDELIJKING: "Verduidelijking gevraagd", NIET_VAST_TE_STELLEN: "Niet vast te stellen",
  GEWEIGERD: "Geweigerd", FOUT: "Fout", VOORSTEL: "Voorstel",
};
const STATUS_TAG = { BEANTWOORD: "good", VERDUIDELIJKING: "warn", NIET_VAST_TE_STELLEN: "warn", GEWEIGERD: "bad", FOUT: "bad", VOORSTEL: "" };
const GRENDEL_LABEL = { CLAIMVERIFICATIE: "Claimverificatie", GRONDING: "Grounding", ZONDER_BRON: "Zonder bron" };
const CORRECTIE_LABEL = {
  VOORSTEL_ZONDER_REKENVERZOEK: "Rekenvoorstel vervallen",
  ONLEESBAAR_PLAN: "Onleesbaar plan",
  ONDERZOEK_VOOR_OORDEEL: "Eerst context opgezocht",
};
const DAGEN = ["", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"];

let alleVersies = [];
let kandidaten = [];
let actiefId = null;
let sessionId = null;
let bezig = false;
let laatsteResultaat = null;
const berichten = [];

const tijd = () => new Date().toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });

function html() {
  return `
    <div class="tr-grid">
      <div class="tr-col">
        <div class="card">
          <h3>${titleIcon("chat", "#1f5fd0")}Test Room</h3>
          <p class="sub" style="margin:0; font-size:12.5px;">Test en vergelijk Lyra-versies in een interactieve chat, via dezelfde motor als productie. De actieve productieversie wordt hierdoor nooit gewijzigd.</p>
        </div>
        <div class="card">
          <label style="margin-top:0;">Lyra-versie</label>
          <select id="tr-versie" style="width:100%;"></select>
          <label style="margin-top:14px;">Of kies een kandidaat</label>
          <input type="text" id="tr-kandidaat-zoek" placeholder="Zoek kandidaat…" style="width:100%;" />
          <div id="tr-kandidaten" class="tr-kandidaten"></div>
        </div>
        <div class="card">
          <h3 style="font-size:13px;">${titleIcon("db", "#1f5fd0", "sm")}Rooster / data</h3>
          <div class="tr-velden">
            <div><label>Standplaats</label><input type="text" id="tr-locatie" value="DDR" /></div>
            <div><label>Basisrooster</label><input type="text" id="tr-rooster" placeholder="bijv. DDR-VL" /></div>
            <div><label>Regel</label><input type="number" id="tr-regel" min="1" placeholder="—" /></div>
            <div><label>Weekdag</label><select id="tr-dag"><option value="">—</option>${DAGEN.slice(1).map((d, i) => `<option value="${i + 1}">${d}</option>`).join("")}</select></div>
          </div>
          <label style="margin-top:10px;">Bron</label>
          <input type="text" id="tr-kandidaatlabel" placeholder="officieel rooster (of bijv. kandidaat 2)" style="width:100%;" />
          <p class="sub" style="margin:8px 0 0; font-size:11.5px;">Dezelfde schermcontext als het echte platform meegeeft. Leeg = Lyra vraagt zelf om het rooster.</p>
        </div>
        <div class="card">
          <h3 style="font-size:13px;">${titleIcon("lightbulb", "#c8791a", "sm")}Snelle acties</h3>
          <div class="tr-acties">
            ${QUICK_ACTIONS.map((a, i) => `<button class="ghost tr-actie" data-quick="${i}">${ICONS[a.icon]}<span>${a.label}</span></button>`).join("")}
          </div>
        </div>
      </div>

      <div class="card tr-chat">
        <div class="tr-chat-kop">
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; min-width:0;">
            <span style="font-weight:700; font-size:17px;">Chat met Lyra</span>
            <span class="tr-versie-pil"><span class="tag-dot" style="background:#2e9e5b;"></span><span id="tr-versie-label"></span></span>
            <span class="tr-context-chip" id="tr-context-chip"></span>
          </div>
          <button class="ghost" id="tr-nieuw-gesprek">${ICONS.refresh}Nieuwe chat</button>
        </div>
        <div id="tr-messages" class="tr-messages"></div>
        <div class="tr-invoer">
          <input type="text" id="tr-input" placeholder="Stel een vraag aan Lyra… (bijv. analyseer dit rooster, leg CAO-regels uit)" />
          <button class="primary icon-btn" id="tr-send" title="Versturen">${ICONS.send}</button>
        </div>
        <p class="sub" id="tr-status" style="margin:6px 0 0; font-size:11.5px; text-align:center;">Lyra gebruikt de geselecteerde versie en de roostercontext uit de linker kolom.</p>
      </div>

      <div class="tr-col">
        <div class="card">
          <h3>${titleIcon("book", "#1f5fd0", "sm")}Huidige context</h3>
          <div id="tr-context" class="field-list"></div>
        </div>
        <div class="card">
          <h3>${titleIcon("check", "#2f8f5b", "sm")}Tools in dit antwoord</h3>
          <div id="tr-tools"></div>
        </div>
        <div class="card">
          <h3>${titleIcon("shield", "#c9622a", "sm")}Grendels &amp; plancontrole</h3>
          <div id="tr-grendels"></div>
        </div>
      </div>
    </div>
  `;
}

function versieLabel() {
  const v = document.getElementById("tr-versie");
  return v?.selectedOptions?.[0]?.textContent ?? "—";
}

function contextWaarden() {
  const rooster = document.getElementById("tr-rooster").value.trim().toUpperCase();
  const regel = document.getElementById("tr-regel").value.trim();
  const dag = document.getElementById("tr-dag").value;
  const kandidaatLabel = document.getElementById("tr-kandidaatlabel").value.trim();
  return {
    locationCode: document.getElementById("tr-locatie").value.trim() || "DDR",
    rosterCode: rooster || null,
    lineNumber: regel ? Number(regel) : null,
    weekday: dag ? Number(dag) : null,
    candidateLabel: kandidaatLabel || null,
  };
}

function contextChipTekst(c) {
  if (!c.rosterCode) return `${c.locationCode} · geen rooster gekozen`;
  return `${c.candidateLabel ? `${c.candidateLabel}: ` : "Officieel: "}${c.rosterCode}${c.lineNumber ? ` – regel ${c.lineNumber}` : ""}${c.weekday ? ` · ${DAGEN[c.weekday]}` : ""}`;
}

function gebruikersBubbel(b) {
  return `<div class="tr-bericht tr-bericht-gebruiker">
    <div class="tr-bubbel tr-bubbel-gebruiker"><div class="tr-tijd">${b.tijd}</div>${esc(b.text)}</div>
    <div class="tr-avatar tr-avatar-gebruiker">D</div>
  </div>`;
}

function grendelBlok(r) {
  if (!r.tegengehouden && !(r.planCorrecties ?? []).length) return "";
  const delen = [];
  if (r.tegengehouden) {
    delen.push(`<div class="tr-grendel"><b>${ICONS.shield} Tegengehouden door ${esc(GRENDEL_LABEL[r.tegengehouden.grendel] ?? r.tegengehouden.grendel)}.</b>
      <details><summary>Wat het model had willen zeggen</summary><div class="tr-origineel">${esc(r.tegengehouden.tekst)}</div></details></div>`);
  }
  for (const c of r.planCorrecties ?? []) {
    delen.push(`<div class="tr-correctie"><b>${esc(CORRECTIE_LABEL[c.regel] ?? c.regel)}:</b> ${esc(c.uitleg)}</div>`);
  }
  return delen.join("");
}

function lyraBericht(b) {
  const r = b.resultaat;
  const tools = r.toolCalls ?? [];
  return `<div class="tr-bericht">
    <div class="tr-avatar tr-avatar-lyra"><img src="/brand/ns-logo.svg" alt="" width="22" height="22" /></div>
    <div class="tr-bubbel tr-bubbel-lyra">
      <div class="tr-naam"><b>Lyra</b> <span class="tr-tijd">${b.tijd}</span></div>
      <div class="tr-tekst">${esc(r.text)}</div>
      <div class="tr-structuur">
        <span class="tag ${STATUS_TAG[r.status] ?? ""}">${STATUS_LABEL[r.status] ?? esc(r.status)}</span>
        <span class="sub">intentie ${esc(r.intent)} · ${tools.length} tool${tools.length === 1 ? "" : "s"} · ${esc(r.model)}${r.isLanguageModel ? "" : " (geen taalmodel)"}</span>
      </div>
      ${(r.sources ?? []).length > 0 ? `<div class="sub" style="font-size:11.5px; margin-top:4px;"><b>Bronnen:</b> ${r.sources.map(esc).join("; ")}</div>` : ""}
      ${grendelBlok(r)}
    </div>
  </div>`;
}

function foutBericht(b) {
  return `<div class="tr-bericht">
    <div class="tr-avatar tr-avatar-lyra"><img src="/brand/ns-logo.svg" alt="" width="22" height="22" /></div>
    <div class="tr-bubbel tr-bubbel-fout"><div class="tr-naam"><b>Lyra</b> <span class="tr-tijd">${b.tijd}</span></div>${esc(b.text)}</div>
  </div>`;
}

function renderMessages() {
  const el = document.getElementById("tr-messages");
  if (berichten.length === 0) {
    el.innerHTML = `<div class="empty">Nog geen gesprek. Kies links een versie en roostercontext, stel een vraag of gebruik een snelle actie.</div>`;
    return;
  }
  el.innerHTML = berichten.map((b) => (b.role === "user" ? gebruikersBubbel(b) : b.resultaat ? lyraBericht(b) : foutBericht(b))).join("");
  el.scrollTop = el.scrollHeight;
}

function renderKandidaten() {
  const zoek = (document.getElementById("tr-kandidaat-zoek")?.value ?? "").trim().toLowerCase();
  const gekozen = document.getElementById("tr-versie").value;
  const lijst = kandidaten.filter((k) => !zoek || `${k.label} ${k.candidateId} ${k.category ?? ""}`.toLowerCase().includes(zoek));
  const el = document.getElementById("tr-kandidaten");
  if (kandidaten.length === 0) {
    el.innerHTML = `<div class="sub" style="font-size:12px; padding:8px 2px;">Nog geen kandidaten. Start een ontwikkelrun op het Dashboard.</div>`;
    return;
  }
  if (lijst.length === 0) {
    el.innerHTML = `<div class="sub" style="font-size:12px; padding:8px 2px;">Geen kandidaat die past bij "${esc(zoek)}".</div>`;
    return;
  }
  el.innerHTML = lijst.slice(0, 8).map((k) => {
    const kiesbaar = Boolean(k.versionId) && alleVersies.some((v) => v.id === k.versionId);
    const pijl = k.benchmarkDelta === null || k.benchmarkDelta === undefined ? "" : k.benchmarkDelta >= 0 ? `<span style="color:var(--good, #2e9e5b);">↑ ${fmtPp(k.benchmarkDelta, 1)}</span>` : `<span style="color:#c0392b;">↓ ${fmtPp(k.benchmarkDelta, 1)}</span>`;
    return `<button class="tr-kandidaat${kiesbaar && gekozen === k.versionId ? " gekozen" : ""}" ${kiesbaar ? `data-versie="${esc(k.versionId)}"` : "disabled"} title="${kiesbaar ? "Chat met deze kandidaat" : "Geen opgeslagen versie — deze kandidaat kan niet meepraten"}">
      <span class="tr-radio"></span>
      <span style="flex:1; min-width:0; text-align:left;">
        <span style="display:block; font-weight:600; font-size:12.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(k.label)}</span>
        <span class="sub" style="font-size:11px;">${esc(k.decision ?? "")}${kiesbaar ? "" : " · geen versie"}</span>
      </span>
      <span style="font-size:11.5px; font-weight:600;">${pijl}</span>
    </button>`;
  }).join("");
  el.querySelectorAll("[data-versie]").forEach((knop) => knop.addEventListener("click", () => {
    document.getElementById("tr-versie").value = knop.dataset.versie;
    renderAlles();
  }));
}

function renderContext() {
  const c = contextWaarden();
  document.getElementById("tr-versie-label").textContent = versieLabel();
  document.getElementById("tr-context-chip").textContent = contextChipTekst(c);
  const gebruikt = laatsteResultaat?.contextUsed ?? null;
  const rij = (k, v) => `<div class="field-row" style="padding:6px 0;"><div style="flex:1;"><span class="field-label">${k}</span></div><div class="field-value">${esc(v)}</div></div>`;
  document.getElementById("tr-context").innerHTML = [
    rij("Versie/kandidaat", versieLabel()),
    rij("Standplaats", c.locationCode),
    rij("Basisrooster", c.rosterCode ?? "—"),
    rij("Regel", c.lineNumber ?? "—"),
    rij("Weekdag", c.weekday ? DAGEN[c.weekday] : "—"),
    rij("Bron", c.candidateLabel ?? "officieel rooster"),
    rij("Sessie", sessionId ? `${sessionId.slice(0, 12)}…` : "nog geen sessie"),
    gebruikt ? `<p class="sub" style="margin:8px 0 0; font-size:11.5px;">Laatste antwoord gebruikte: ${esc(gebruikt.source ?? "?")}${gebruikt.rosterCode ? ` · ${esc(gebruikt.rosterCode)}` : ""}${gebruikt.lineNumber ? ` regel ${esc(gebruikt.lineNumber)}` : ""}.</p>` : "",
  ].join("");
}

function renderControle() {
  const r = laatsteResultaat;
  const tools = r?.toolCalls ?? [];
  document.getElementById("tr-tools").innerHTML = !r
    ? `<div class="sub" style="font-size:12px;">Nog geen antwoord.</div>`
    : tools.length === 0
      ? `<div class="sub" style="font-size:12px;">Geen tools aangeroepen voor dit antwoord.</div>`
      : `<ul class="tr-checklist">${tools.map((t) => `<li><span class="${t.ok ? "ok" : "nok"}">${t.ok ? ICONS.check : ICONS.x}</span><b>${esc(t.tool)}</b><span class="sub">${t.ms} ms</span>${t.note ? `<div class="sub" style="font-size:11px;">${esc(t.note)}</div>` : ""}</li>`).join("")}</ul>`;
  const blok = r ? grendelBlok(r) : "";
  document.getElementById("tr-grendels").innerHTML = !r
    ? `<div class="sub" style="font-size:12px;">Nog geen antwoord.</div>`
    : blok || `<div class="sub" style="font-size:12px;">Geen grendel en geen plancorrectie in het laatste antwoord.</div>`;
}

function renderAlles() {
  renderMessages();
  renderKandidaten();
  renderContext();
  renderControle();
}

async function verstuurBericht(tekst) {
  if (!tekst.trim() || bezig) return;
  bezig = true;
  const status = document.getElementById("tr-status");
  status.textContent = "Lyra denkt na…";
  berichten.push({ role: "user", text: tekst, tijd: tijd() });
  renderAlles();

  const versionId = document.getElementById("tr-versie").value || null;
  const result = await post("/api/chat", { text: tekst, sessionId, versionId, ...contextWaarden() });

  if (result.error) {
    berichten.push({ role: "agent", text: `${result.error}${result.detail ? `\n\n${result.detail}` : ""}`, tijd: tijd() });
    status.textContent = "Mislukt — zie het bericht in het gesprek.";
  } else {
    sessionId = result.sessionId ?? sessionId;
    laatsteResultaat = result;
    berichten.push({ role: "agent", resultaat: result, tijd: tijd() });
    status.textContent = "Lyra gebruikt de geselecteerde versie en de roostercontext uit de linker kolom.";
  }
  bezig = false;
  renderAlles();
}

export async function mount(container, params) {
  container.innerHTML = html();

  const [versiesResp, kandidatenResp] = await Promise.all([j("/api/versions"), j("/api/candidates").catch(() => [])]);
  alleVersies = versiesResp.versions ?? [];
  actiefId = versiesResp.activeVersionId;
  kandidaten = Array.isArray(kandidatenResp) ? kandidatenResp : [];
  const versieSelect = document.getElementById("tr-versie");
  const opties = [{ id: "", displayName: `${actiefId ? "Actieve versie" : "Actief"} (geen override)` }, ...alleVersies.filter((v) => v.id !== actiefId)];
  versieSelect.innerHTML = opties.map((v) => `<option value="${esc(v.id)}">${esc(v.displayName)}${v.id === "" ? "" : ` (${esc(v.status)})`}</option>`).join("");

  const preselect = params?.get?.("versionId");
  if (preselect && alleVersies.some((v) => v.id === preselect)) versieSelect.value = preselect;
  for (const [veld, param] of [["tr-rooster", "rosterCode"], ["tr-regel", "lineNumber"], ["tr-locatie", "locationCode"]]) {
    const waarde = params?.get?.(param);
    if (waarde) document.getElementById(veld).value = waarde;
  }

  versieSelect.addEventListener("change", renderAlles);
  for (const id of ["tr-locatie", "tr-rooster", "tr-regel", "tr-dag", "tr-kandidaatlabel"]) {
    document.getElementById(id).addEventListener("input", renderContext);
    document.getElementById(id).addEventListener("change", renderContext);
  }
  document.getElementById("tr-kandidaat-zoek").addEventListener("input", renderKandidaten);

  document.getElementById("tr-send").addEventListener("click", () => {
    const input = document.getElementById("tr-input");
    const tekst = input.value;
    input.value = "";
    veilig("test-room-send", () => verstuurBericht(tekst));
  });
  document.getElementById("tr-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      document.getElementById("tr-send").click();
    }
  });
  document.querySelectorAll("[data-quick]").forEach((btn) => btn.addEventListener("click", () => {
    veilig("test-room-quick", () => verstuurBericht(QUICK_ACTIONS[Number(btn.dataset.quick)].text));
  }));
  document.getElementById("tr-nieuw-gesprek").addEventListener("click", () => {
    sessionId = null;
    laatsteResultaat = null;
    berichten.length = 0;
    renderAlles();
    document.getElementById("tr-status").textContent = "Nieuw gesprek gestart.";
  });

  renderAlles();
  // Phase P: feedback en concepten, onder het gesprek — geen apart tabblad.
  return await metPaneel(container, mountLearningPanel, "learning");
}
