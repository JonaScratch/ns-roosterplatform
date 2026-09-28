// Test Room (§ UI/UX REBUILD, foto 2): een echte interactieve chatwerkruimte
// — geen benchmarkscherm. Elk bericht gaat via /api/chat naar dezelfde
// askAgent()-motor als productie (demo-room/src/cli.ts's "chat"-commando),
// nooit een nagemaakt antwoord. Toont per antwoord een structuurkaart met
// een echte regel-/toolchecklist (alleen daadwerkelijk aangeroepen tools —
// nooit een vaste, hypothetische lijst).

import { j, post, veilig } from "../lib/shared.js";

const QUICK_ACTIONS = [
  { label: "Analyseer", text: "Analyseer het huidige rooster op knelpunten: welke diensten of reeksen vallen op?" },
  { label: "Tweak", text: "Stel een kleine, gerichte aanpassing voor die één concreet knelpunt oplost, zonder de rest van het rooster te verstoren." },
  { label: "Check CAO-regels", text: "Controleer of dit rooster voldoet aan de bekende CAO-/rusttijdregels en noem elke regel die je daadwerkelijk hebt gecontroleerd." },
  { label: "Vergelijk", text: "Vergelijk deze kandidaat met de vorige versie: wat is er merkbaar veranderd in gedrag of uitkomst?" },
];

const STATUS_LABEL = {
  BEANTWOORD: "Beantwoord", VERDUIDELIJKING: "Verduidelijking gevraagd", NIET_VAST_TE_STELLEN: "Niet vast te stellen",
  GEWEIGERD: "Geweigerd", FOUT: "Fout", VOORSTEL: "Voorstel",
};
const STATUS_TAG = { BEANTWOORD: "good", VERDUIDELIJKING: "warn", NIET_VAST_TE_STELLEN: "warn", GEWEIGERD: "bad", FOUT: "bad", VOORSTEL: "" };

let alleVersies = [];
let sessionId = null;
let bezig = false;
const berichten = [];

function html() {
  return `
    <div class="card">
      <h3>Test Room</h3>
      <p class="sub" style="margin:0 0 10px; color:#556; font-size:13px;">Een echt gesprek met Lyra, via dezelfde motor als productie. Kies welke versie/kandidaat meepraat — de actieve productieversie wordt hierdoor nooit gewijzigd.</p>
      <div class="row" style="align-items:flex-end;">
        <div class="col" style="max-width:300px;">
          <label>Versie/kandidaat</label>
          <select id="tr-versie"></select>
        </div>
        <div class="col" style="max-width:200px;">
          <label>Standplaats (data source)</label>
          <input type="text" id="tr-locatie" value="DDR" />
        </div>
        <div class="col" style="max-width:160px;">
          <button class="ghost" id="tr-nieuw-gesprek">Nieuw gesprek</button>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>Snelle acties</h3>
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        ${QUICK_ACTIONS.map((a, i) => `<button class="ghost" data-quick="${i}">${a.label}</button>`).join("")}
      </div>
    </div>

    <div class="card">
      <div id="tr-messages" style="display:flex; flex-direction:column; gap:14px; max-height:480px; overflow-y:auto; padding:4px;"></div>
      <div style="display:flex; gap:10px; margin-top:14px;">
        <input type="text" id="tr-input" placeholder="Typ een bericht…" style="flex:1; max-width:none;" />
        <button class="primary" id="tr-send">Versturen</button>
      </div>
      <p class="sub" id="tr-status" style="margin:8px 0 0; font-size:12px; color:var(--muted);"></p>
    </div>
  `;
}

function bubbel(rol, tekst) {
  const isUser = rol === "user";
  return `<div style="align-self:${isUser ? "flex-end" : "flex-start"}; max-width:75%;">
    <div style="background:${isUser ? "var(--accent)" : "#eef1f6"}; color:${isUser ? "#fff" : "#12223c"}; padding:9px 13px; border-radius:12px; font-size:13px; white-space:pre-wrap;">${tekst}</div>
  </div>`;
}

function resultaatkaart(resultaat) {
  const echteTools = (resultaat.toolCalls ?? []);
  const checklist = echteTools.length > 0
    ? echteTools.map((t) => `<li>${t.ok ? "✅" : "❌"} <b>${t.tool}</b>${t.note ? ` — ${t.note}` : ""} <span class="sub">(${t.ms}ms)</span></li>`).join("")
    : `<li class="sub" style="list-style:none; margin-left:-18px;">Geen tools aangeroepen voor dit antwoord.</li>`;
  const bronnen = (resultaat.sources ?? []).length > 0
    ? `<p style="margin:6px 0 0; font-size:12px;"><b>Bronnen:</b> ${resultaat.sources.join("; ")}</p>`
    : "";
  const ctx = resultaat.contextUsed ?? {};
  return `<div style="align-self:flex-start; max-width:85%; border:1px solid #eaeef5; border-radius:10px; padding:10px 13px; background:#fff;">
    <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
      <span class="tag ${STATUS_TAG[resultaat.status] ?? ""}">${STATUS_LABEL[resultaat.status] ?? resultaat.status}</span>
      <span class="sub" style="font-size:11px;">model: ${resultaat.model}${resultaat.isLanguageModel ? "" : " (geen taalmodel)"} · intentie: ${resultaat.intent}</span>
    </div>
    <p style="margin:0 0 6px; font-size:11px; color:var(--muted);">Context: bron=${ctx.source ?? "onbekend"}${ctx.rosterCode ? `, rooster=${ctx.rosterCode}` : ""}${ctx.candidateId ? `, kandidaat=${ctx.candidateId}` : ""}</p>
    <details>
      <summary>Regel-/toolchecklist (${echteTools.length})</summary>
      <ul style="margin:6px 0 0; padding-left:18px; font-size:12px;">${checklist}</ul>
    </details>
    ${bronnen}
  </div>`;
}

function renderMessages() {
  const el = document.getElementById("tr-messages");
  if (berichten.length === 0) {
    el.innerHTML = `<div class="empty">Nog geen gesprek. Stel een vraag of gebruik een snelle actie hierboven.</div>`;
    return;
  }
  el.innerHTML = berichten.map((b) => (b.role === "user" ? bubbel("user", b.text) : b.resultaat ? resultaatkaart(b.resultaat) : bubbel("agent", b.text))).join("");
  el.scrollTop = el.scrollHeight;
}

async function verstuurBericht(tekst) {
  if (!tekst.trim() || bezig) return;
  bezig = true;
  document.getElementById("tr-status").textContent = "Lyra denkt na…";
  berichten.push({ role: "user", text: tekst });
  renderMessages();

  const versionId = document.getElementById("tr-versie").value || null;
  const locationCode = document.getElementById("tr-locatie").value || "DDR";
  const result = await post("/api/chat", { text: tekst, sessionId, versionId, locationCode });

  if (result.error) {
    berichten.push({ role: "agent", text: `⚠️ ${result.error}${result.detail ? `\n\n${result.detail}` : ""}` });
    document.getElementById("tr-status").textContent = "Mislukt — zie bericht hierboven.";
  } else {
    sessionId = result.sessionId ?? sessionId;
    berichten.push({ role: "agent", resultaat: result });
    document.getElementById("tr-status").textContent = "";
  }
  bezig = false;
  renderMessages();
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
    berichten.length = 0;
    renderMessages();
    document.getElementById("tr-status").textContent = "Nieuw gesprek gestart.";
  });

  renderMessages();
}
