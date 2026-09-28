// Test Room (§ UI/UX REBUILD, foto 2): een echte interactieve chatwerkruimte
// — geen benchmarkscherm. Elk bericht gaat via /api/chat naar dezelfde
// askAgent()-motor als productie (demo-room/src/cli.ts's "chat"-commando),
// nooit een nagemaakt antwoord. Toont per antwoord een structuurkaart met
// een echte regel-/toolchecklist (alleen daadwerkelijk aangeroepen tools —
// nooit een vaste, hypothetische lijst).

import { j, post, veilig, titleIcon, ICONS } from "../lib/shared.js";

const QUICK_ACTIONS = [
  { icon: "search", label: "Analyseer", text: "Analyseer het huidige rooster op knelpunten: welke diensten of reeksen vallen op?" },
  { icon: "edit", label: "Tweak", text: "Stel een kleine, gerichte aanpassing voor die één concreet knelpunt oplost, zonder de rest van het rooster te verstoren." },
  { icon: "shield", label: "Check CAO-regels", text: "Controleer of dit rooster voldoet aan de bekende CAO-/rusttijdregels en noem elke regel die je daadwerkelijk hebt gecontroleerd." },
  { icon: "compare", label: "Vergelijk", text: "Vergelijk deze kandidaat met de vorige versie: wat is er merkbaar veranderd in gedrag of uitkomst?" },
];

const STATUS_LABEL = {
  BEANTWOORD: "Beantwoord", VERDUIDELIJKING: "Verduidelijking gevraagd", NIET_VAST_TE_STELLEN: "Niet vast te stellen",
  GEWEIGERD: "Geweigerd", FOUT: "Fout", VOORSTEL: "Voorstel",
};
const STATUS_TAG = { BEANTWOORD: "good", VERDUIDELIJKING: "warn", NIET_VAST_TE_STELLEN: "warn", GEWEIGERD: "bad", FOUT: "bad", VOORSTEL: "" };

let alleVersies = [];
let sessionId = null;
let bezig = false;
let laatsteResultaat = null;
const berichten = [];

function html() {
  return `
    <div class="row" style="align-items:flex-start; gap:14px;">
      <div class="col" style="max-width:270px; flex:0 0 270px;">
        <div class="card">
          <h3>${titleIcon("chat", "#1f5fd0")}Test Room</h3>
          <p class="sub" style="margin:0 0 12px; font-size:12.5px;">Test en vergelijk Lyra-versies in een interactieve chat, via dezelfde motor als productie. De actieve productieversie wordt hierdoor nooit gewijzigd.</p>
          <label>Lyra-versie</label>
          <select id="tr-versie" style="width:100%;"></select>
          <label style="margin-top:10px;">Standplaats (databron)</label>
          <input type="text" id="tr-locatie" value="DDR" style="width:100%;" />
          <button class="ghost" id="tr-nieuw-gesprek" style="width:100%; margin-top:12px;">${ICONS.refresh}Nieuw gesprek</button>
        </div>
        <div class="card">
          <h3 style="font-size:13px;">${titleIcon("lightbulb", "#c8791a", "sm")}Snelle acties</h3>
          <div style="display:flex; flex-direction:column; gap:8px;">
            ${QUICK_ACTIONS.map((a, i) => `<button class="ghost" data-quick="${i}" style="width:100%; justify-content:flex-start;">${ICONS[a.icon]}${a.label}</button>`).join("")}
          </div>
        </div>
      </div>

      <div class="col" style="flex:1.6; min-width:0;">
        <div class="card" style="display:flex; flex-direction:column; padding:16px 18px;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; padding-bottom:10px; border-bottom:1px solid #f1f3f8;">
            <div style="display:flex; align-items:center; gap:10px;">
              ${titleIcon("chat", "#1f5fd0")}
              <div>
                <div style="font-weight:700; font-size:14px;">Chat met Lyra</div>
                <div class="sub" id="tr-active-version-label" style="font-size:11.5px;"></div>
              </div>
            </div>
          </div>
          <div id="tr-messages" style="display:flex; flex-direction:column; gap:14px; height:480px; overflow-y:auto; padding:4px;"></div>
          <div style="display:flex; gap:10px; margin-top:14px;">
            <input type="text" id="tr-input" placeholder="Stel een vraag aan Lyra… (bijv. analyseer dit rooster, leg CAO-regels uit)" style="flex:1; max-width:none;" />
            <button class="primary icon-btn" id="tr-send" title="Versturen">${ICONS.send}</button>
          </div>
          <p class="sub" id="tr-status" style="margin:8px 0 0; font-size:12px; color:var(--muted);"></p>
        </div>
      </div>

      <div class="col" style="max-width:280px; flex:0 0 280px;">
        <div class="card">
          <h3>${titleIcon("book", "#1f5fd0", "sm")}Sessiecontext</h3>
          <div id="tr-context" class="field-list"></div>
        </div>
        <div class="card" id="tr-last-card" style="display:none;">
          <h3>${titleIcon("check", "#2f8f5b", "sm")}Laatste antwoord</h3>
          <div id="tr-last"></div>
        </div>
      </div>
    </div>
  `;
}

function bubbel(rol, tekst) {
  const isUser = rol === "user";
  return `<div style="align-self:${isUser ? "flex-end" : "flex-start"}; max-width:75%;">
    <div style="background:${isUser ? "var(--accent)" : "#eef1f6"}; color:${isUser ? "#fff" : "#12223c"}; padding:9px 13px; border-radius:12px; font-size:13px; white-space:pre-wrap;">${tekst}</div>
  </div>`;
}

function toolChecklist(resultaat) {
  const echteTools = (resultaat.toolCalls ?? []);
  return echteTools.length > 0
    ? echteTools.map((t) => `<li>${t.ok ? "✅" : "❌"} <b>${t.tool}</b>${t.note ? ` — ${t.note}` : ""} <span class="sub">(${t.ms}ms)</span></li>`).join("")
    : `<li class="sub" style="list-style:none; margin-left:-18px;">Geen tools aangeroepen voor dit antwoord.</li>`;
}

function resultaatkaart(resultaat) {
  const echteTools = (resultaat.toolCalls ?? []);
  const bronnen = (resultaat.sources ?? []).length > 0
    ? `<p style="margin:6px 0 0; font-size:12px;"><b>Bronnen:</b> ${resultaat.sources.join("; ")}</p>`
    : "";
  return `<div style="align-self:flex-start; max-width:85%; border:1px solid #eaeef5; border-radius:10px; padding:10px 13px; background:#fff;">
    <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
      <span class="tag ${STATUS_TAG[resultaat.status] ?? ""}">${STATUS_LABEL[resultaat.status] ?? resultaat.status}</span>
      <span class="sub" style="font-size:11px;">model: ${resultaat.model}${resultaat.isLanguageModel ? "" : " (geen taalmodel)"} · intentie: ${resultaat.intent}</span>
    </div>
    <details>
      <summary>Regel-/toolchecklist (${echteTools.length})</summary>
      <ul style="margin:6px 0 0; padding-left:18px; font-size:12px;">${toolChecklist(resultaat)}</ul>
    </details>
    ${bronnen}
  </div>`;
}

function renderMessages() {
  const el = document.getElementById("tr-messages");
  if (berichten.length === 0) {
    el.innerHTML = `<div class="empty">Nog geen gesprek. Stel een vraag of gebruik een snelle actie hiernaast.</div>`;
    return;
  }
  el.innerHTML = berichten.map((b) => (b.role === "user" ? bubbel("user", b.text) : b.resultaat ? resultaatkaart(b.resultaat) : bubbel("agent", b.text))).join("");
  el.scrollTop = el.scrollHeight;
}

function renderContext() {
  const versieSelect = document.getElementById("tr-versie");
  const gekozenLabel = versieSelect?.selectedOptions?.[0]?.textContent ?? "—";
  document.getElementById("tr-active-version-label").textContent = gekozenLabel;
  const el = document.getElementById("tr-context");
  const rows = [
    ["Versie/kandidaat", gekozenLabel],
    ["Standplaats", document.getElementById("tr-locatie")?.value || "DDR"],
    ["Sessie", sessionId ? sessionId.slice(0, 12) + "…" : "nog geen sessie"],
    ["Berichten", String(berichten.filter((b) => b.role === "user").length)],
  ];
  el.innerHTML = rows.map(([k, v]) => `<div class="field-row" style="padding:6px 0;"><div style="flex:1;"><span class="field-label">${k}</span></div><div class="field-value">${v}</div></div>`).join("");
}

function renderLast() {
  const card = document.getElementById("tr-last-card");
  if (!laatsteResultaat) { card.style.display = "none"; return; }
  card.style.display = "block";
  const r = laatsteResultaat;
  const ctx = r.contextUsed ?? {};
  document.getElementById("tr-last").innerHTML = `
    <span class="tag ${STATUS_TAG[r.status] ?? ""}">${STATUS_LABEL[r.status] ?? r.status}</span>
    <div class="field-list" style="margin-top:10px;">
      <div class="field-row" style="padding:5px 0;"><div style="flex:1;"><span class="field-label">Intentie</span></div><div class="field-value">${r.intent}</div></div>
      <div class="field-row" style="padding:5px 0;"><div style="flex:1;"><span class="field-label">Model</span></div><div class="field-value" style="font-size:11.5px;">${r.model}</div></div>
      <div class="field-row" style="padding:5px 0;"><div style="flex:1;"><span class="field-label">Contextbron</span></div><div class="field-value">${ctx.source ?? "onbekend"}</div></div>
      ${ctx.rosterCode ? `<div class="field-row" style="padding:5px 0;"><div style="flex:1;"><span class="field-label">Rooster</span></div><div class="field-value">${ctx.rosterCode}</div></div>` : ""}
      ${ctx.candidateId ? `<div class="field-row" style="padding:5px 0;"><div style="flex:1;"><span class="field-label">Kandidaat</span></div><div class="field-value">${ctx.candidateId}</div></div>` : ""}
    </div>
    <p class="sub" style="margin:10px 0 4px; font-size:11px; font-weight:700; text-transform:uppercase;">Tools (${(r.toolCalls ?? []).length})</p>
    <ul style="margin:0; padding-left:18px; font-size:12px;">${toolChecklist(r)}</ul>
  `;
}

async function verstuurBericht(tekst) {
  if (!tekst.trim() || bezig) return;
  bezig = true;
  document.getElementById("tr-status").textContent = "Lyra denkt na…";
  berichten.push({ role: "user", text: tekst });
  renderMessages();
  renderContext();

  const versionId = document.getElementById("tr-versie").value || null;
  const locationCode = document.getElementById("tr-locatie").value || "DDR";
  const result = await post("/api/chat", { text: tekst, sessionId, versionId, locationCode });

  if (result.error) {
    berichten.push({ role: "agent", text: `⚠️ ${result.error}${result.detail ? `\n\n${result.detail}` : ""}` });
    document.getElementById("tr-status").textContent = "Mislukt — zie bericht hierboven.";
  } else {
    sessionId = result.sessionId ?? sessionId;
    laatsteResultaat = result;
    berichten.push({ role: "agent", resultaat: result });
    document.getElementById("tr-status").textContent = "";
  }
  bezig = false;
  renderMessages();
  renderContext();
  renderLast();
}

export async function mount(container, params) {
  container.innerHTML = html();

  const versiesResp = await j("/api/versions");
  alleVersies = versiesResp.versions ?? [];
  const actiefId = versiesResp.activeVersionId;
  const versieSelect = document.getElementById("tr-versie");
  const opties = [{ id: "", displayName: `${actiefId ? "Actieve versie" : "Actief"} (geen override)` }, ...alleVersies.filter((v) => v.id !== actiefId)];
  versieSelect.innerHTML = opties.map((v) => `<option value="${v.id}">${v.displayName}${v.id === "" ? "" : ` (${v.status})`}</option>`).join("");

  const preselect = params?.get?.("versionId");
  if (preselect && alleVersies.some((v) => v.id === preselect)) versieSelect.value = preselect;

  versieSelect.addEventListener("change", renderContext);
  document.getElementById("tr-locatie").addEventListener("input", renderContext);

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
    renderMessages();
    renderContext();
    renderLast();
    document.getElementById("tr-status").textContent = "Nieuw gesprek gestart.";
  });

  renderMessages();
  renderContext();
  renderLast();
}
