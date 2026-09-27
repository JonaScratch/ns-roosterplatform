// Vergelijken (§ UI/UX REBUILD): compacte vergelijkingswerkruimte — vervangt
// de oude, uitgebreide vergelijkingspagina. Basisversie/vergelijk-met/
// benchmarkset-selectors, per-metric diff, en de relevante wijzigingen
// tussen de twee versies. Accepteert een voorselectie vanuit Candidates.

import { j, fmtPp, veilig } from "../lib/shared.js";

const DIMENSIE_LABEL = {
  contextResolution: "Contextresolutie", multiTurnContext: "Multi-turn context", machinistTaal: "Machinisttaal",
  toolChoice: "Toolgebruik", falsePremiseCorrection: "Foutieve aannames", grounding: "Grounding",
  causalClaims: "Oorzakelijke claims", unnecessaryClarifications: "Te snel oordelen",
};

let alleVersies = [];

function html() {
  return `
    <div class="card">
      <h3>Vergelijken</h3>
      <div class="row" style="align-items:flex-end;">
        <div class="col" style="max-width:280px;">
          <label>Basisversie</label>
          <select id="vg-base"></select>
        </div>
        <div class="col" style="max-width:280px;">
          <label>Vergelijk met</label>
          <select id="vg-target"></select>
        </div>
        <div class="col" style="max-width:200px;">
          <label>Benchmarkset</label>
          <select id="vg-set">
            <option value="both">Beide (dev + holdout)</option>
            <option value="dev">Alleen dev</option>
            <option value="holdout">Alleen holdout (locked)</option>
          </select>
        </div>
      </div>
    </div>

    <div id="vg-body"></div>
  `;
}

function versieOpties(selectId, geselecteerdId) {
  const el = document.getElementById(selectId);
  el.innerHTML = `<option value="">— kies een versie —</option>` + alleVersies.map((v) => `<option value="${v.id}" ${v.id === geselecteerdId ? "selected" : ""}>${v.displayName} (${v.status})</option>`).join("");
}

function statusVoorRij(row) {
  if (!row) return null;
  return row.isActive ? "ACTIEF" : row.status;
}

async function renderVergelijking() {
  const baseId = document.getElementById("vg-base").value;
  const targetId = document.getElementById("vg-target").value;
  const set = document.getElementById("vg-set").value;
  const bodyEl = document.getElementById("vg-body");

  if (!baseId || !targetId) {
    bodyEl.innerHTML = `<div class="card"><div class="empty">Selecteer een basisversie en een vergelijkingsversie om te beginnen.</div></div>`;
    return;
  }
  if (baseId === targetId) {
    bodyEl.innerHTML = `<div class="card"><div class="empty">Kies twee verschillende versies om te vergelijken.</div></div>`;
    return;
  }

  const compare = await j(`/api/versions/compare?base=${encodeURIComponent(baseId)}&target=${encodeURIComponent(targetId)}&set=${set}`);
  const [baseDetail, targetDetail] = await Promise.all([
    j(`/api/versions/detail?id=${encodeURIComponent(baseId)}`),
    j(`/api/versions/detail?id=${encodeURIComponent(targetId)}`),
  ]);

  const target = compare.targets[0] ?? null;
  const dims = compare.comparableDimensions;

  const metricRows = dims.length > 0
    ? dims.map((d) => {
        const b = compare.base?.metrics[d] ?? null;
        const t = target?.metrics[d] ?? null;
        const delta = b !== null && t !== null ? t - b : null;
        return `<tr><td>${DIMENSIE_LABEL[d] ?? d}</td><td>${b !== null ? b.toFixed(1) + "%" : "—"}</td><td>${t !== null ? t.toFixed(1) + "%" : "—"}</td><td style="color:${(delta ?? 0) >= 0 ? "var(--good)" : "var(--bad)"};">${fmtPp(delta)}</td></tr>`;
      }).join("")
    : `<tr><td colspan="4" class="empty">Geen vergelijkbare metingen tussen deze twee versies.</td></tr>`;

  const wijzigingen = [];
  if (targetDetail?.reasonForPromotion) wijzigingen.push(`<b>Reden van promotie:</b> ${targetDetail.reasonForPromotion}`);
  if (targetDetail?.sourceExperimentId) wijzigingen.push(`<b>Bronexperiment:</b> ${targetDetail.sourceExperimentId}`);
  if (targetDetail?.knownIssues?.length > 0) wijzigingen.push(`<b>Bekende beperkingen:</b> ${targetDetail.knownIssues.join("; ")}`);
  if (wijzigingen.length === 0) wijzigingen.push("Geen aanvullende wijzigingsinformatie vastgelegd voor deze versie.");

  bodyEl.innerHTML = `
    ${compare.warning ? `<div class="card"><span class="tag warn">Let op</span> <span style="font-size:13px;">${compare.warning}</span></div>` : ""}
    <div class="row">
      <div class="col">
        <div class="card">
          <h3>Per-dimensie verschil</h3>
          <table><thead><tr><th>Dimensie</th><th>${compare.base?.displayName ?? "Basis"}</th><th>${target?.displayName ?? "Vergeleken"}</th><th>Δ</th></tr></thead><tbody>${metricRows}</tbody></table>
          <p class="sub" style="margin-top:10px; font-size:12px;">Roosterkwaliteit/regelovertredingen: n.v.t. — dit systeem test tot dusver alleen agentgedrag (promptniveau), nog geen roosteroptimalisatie.</p>
        </div>
      </div>
      <div class="col" style="max-width:340px;">
        <div class="card">
          <h3>Statusoverzicht</h3>
          <table style="font-size:13px;">
            <tbody>
              <tr><td style="color:var(--muted);">Basisversie</td><td>${compare.base?.displayName ?? "—"} <span class="tag ${statusVoorRij(compare.base) === "ACTIEF" ? "good" : ""}">${statusVoorRij(compare.base) ?? "—"}</span></td></tr>
              <tr><td style="color:var(--muted);">Vergeleken versie</td><td>${target?.displayName ?? "—"} <span class="tag ${statusVoorRij(target) === "ACTIEF" ? "good" : ""}">${statusVoorRij(target) ?? "—"}</span></td></tr>
              <tr><td style="color:var(--muted);">Benchmarkset</td><td>${set === "both" ? "Beide" : set === "dev" ? "Alleen dev" : "Alleen holdout"}</td></tr>
            </tbody>
          </table>
        </div>
        <div class="card">
          <h3>Relevante wijzigingen</h3>
          <p style="font-size:13px; margin:0;">${wijzigingen.join("<br/><br/>")}</p>
        </div>
      </div>
    </div>
  `;
}

export async function mount(container, params) {
  container.innerHTML = html();

  const versiesResp = await j("/api/versions");
  alleVersies = versiesResp.versions ?? [];
  // `listVersions()` laat de synthetische baseline-rij weg zodra er ooit een
  // echte versie is aangemaakt (zie publish/versions.ts) — zonder deze patch
  // zou de actieve versie (vaak nog de baseline) niet in de selector staan
  // terwijl hij wél de standaardkeuze voor "Basisversie" moet zijn.
  if (versiesResp.activeVersionId && !alleVersies.some((v) => v.id === versiesResp.activeVersionId)) {
    const actief = await j("/api/versions/active");
    if (actief && !actief.error) {
      alleVersies = [{ id: actief.versionId, displayName: actief.displayName, status: actief.status, isActive: true }, ...alleVersies];
    }
  }

  const baseParam = params?.get?.("base") ?? versiesResp.activeVersionId ?? "";
  const targetParam = params?.get?.("target") ?? params?.get?.("id") ?? "";

  versieOpties("vg-base", baseParam);
  versieOpties("vg-target", targetParam);
  document.getElementById("vg-base").addEventListener("change", () => veilig("vergelijken", renderVergelijking));
  document.getElementById("vg-target").addEventListener("change", () => veilig("vergelijken", renderVergelijking));
  document.getElementById("vg-set").addEventListener("change", () => veilig("vergelijken", renderVergelijking));

  await veilig("vergelijken", renderVergelijking);
}
