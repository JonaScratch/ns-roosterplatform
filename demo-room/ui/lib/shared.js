// Gedeelde helpers voor alle Demo Room-paginamodules (§ UI/UX REBUILD).
// Hergebruikt vrijwel woordelijk uit de vroegere monolithische index.html —
// zelfde gedrag, alleen nu als losse, herbruikbare module.

export async function j(url, opts) {
  const r = await fetch(url, opts);
  return r.json();
}
export async function post(url, body) {
  return j(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
}

export const COLORS = { dev: "#1f5fd0", holdout: "#c9622a", pre: "#9fb0c9", post: "#1f5fd0", good: "#2e9e5b", bad: "#c0392b", warn: "#b9862c" };
const VERSION_SHADES = ["#a9c6f5", "#7ba9ee", "#4a86e0", "#2468d6", "#1150ad", "#0a3a82"];
export function shadeFor(i, n) {
  return VERSION_SHADES[Math.min(VERSION_SHADES.length - 1, Math.round((i / Math.max(1, n - 1)) * (VERSION_SHADES.length - 1)))];
}

export const ICONS = {
  layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 8 12 14 22 8 12 2"/><polyline points="2 14 12 20 22 14"/><polyline points="2 11 12 17 22 11"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9c.2.5.7.9 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M17 5h3a2 2 0 0 1-2 4M7 5H4a2 2 0 0 0 2 4"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6"/><rect x="12" y="8" width="3" height="10"/><rect x="17" y="5" width="3" height="13"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 4.5-3.2 7.7-8 9-4.8-1.3-8-4.5-8-9V6l8-3Z"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 11 14 10 22 21 10 13 10 13 2"/></svg>',
  db: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
};
export function iconChip(name, color, size) {
  return `<div class="icon-chip ${color}${size ? " " + size : ""}">${ICONS[name] || ""}</div>`;
}

export function nl1(v) {
  return v === null || v === undefined ? "—" : v.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function nlPct(v, digits) {
  return v === null || v === undefined ? "—" : `${v.toLocaleString("nl-NL", { minimumFractionDigits: digits ?? 0, maximumFractionDigits: digits ?? 0 })}%`;
}
export function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
}
export function fmtPp(delta, digits) {
  if (delta === null || delta === undefined) return "—";
  const d = digits ?? 1;
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(d)}pp`;
}

export function emptyChart(el, message) {
  el.innerHTML = `<div class="empty">${message}</div>`;
}

export function lineChart(el, series) {
  const w = 760, h = 210, padL = 34, padB = 24, padT = 10, padR = 16;
  const alle = series.flatMap((s) => s.points.map((p) => p.y)).filter((v) => v !== null && v !== undefined);
  if (alle.length === 0) return emptyChart(el, "Nog geen meetgegevens");
  const maxY = Math.max(100, ...alle);
  const minY = Math.min(0, ...alle);
  const n = Math.max(...series.map((s) => s.points.length));
  const xAt = (i) => padL + (i / Math.max(1, n - 1)) * (w - padL - padR);
  const yAt = (v) => h - padB - ((v - minY) / (maxY - minY || 1)) * (h - padT - padB);
  let svg = `<svg class="chart" viewBox="0 0 ${w} ${h}">`;
  for (const t of [0, 25, 50, 75, 100]) {
    if (t < minY || t > maxY) continue;
    svg += `<line x1="${padL}" y1="${yAt(t)}" x2="${w - padR}" y2="${yAt(t)}" stroke="#eef1f6"/>`;
    svg += `<text x="${padL - 6}" y="${yAt(t) + 3}" font-size="10" fill="#9fb0c9" text-anchor="end">${t}</text>`;
  }
  for (const s of series) {
    const pts = s.points.map((p, i) => (p.y === null || p.y === undefined ? null : `${xAt(i)},${yAt(p.y)}`)).filter(Boolean);
    if (pts.length > 0) svg += `<polyline points="${pts.join(" ")}" fill="none" stroke="${s.color}" stroke-width="2.5"/>`;
    s.points.forEach((p, i) => {
      if (p.y !== null && p.y !== undefined) svg += `<circle cx="${xAt(i)}" cy="${yAt(p.y)}" r="3.5" fill="${s.color}"/>`;
    });
  }
  svg += `</svg>`;
  el.innerHTML = svg + `<div class="chart-legend">${series.map((s) => `<span><span class="dot" style="background:${s.color}"></span>${s.name}</span>`).join("")}</div>`;
}

export function groupedBarChart(el, categories, series) {
  const withData = series.some((s) => s.values.some((v) => v !== null && v !== undefined));
  if (categories.length === 0 || !withData) return emptyChart(el, "Nog geen meetgegevens");
  const w = 760, h = 220, padL = 30, padB = 60, padT = 10;
  const maxY = 100;
  const groupW = (w - padL - 10) / categories.length;
  const barW = groupW / (series.length + 1);
  let svg = `<svg class="chart" viewBox="0 0 ${w} ${h}">`;
  svg += `<line x1="${padL}" y1="${h - padB}" x2="${w}" y2="${h - padB}" stroke="#ccd4e0"/>`;
  categories.forEach((cat, ci) => {
    series.forEach((s, si) => {
      const v = s.values[ci];
      if (v === null || v === undefined) return;
      const barH = (v / maxY) * (h - padT - padB);
      const x = padL + ci * groupW + si * barW + 4;
      svg += `<rect x="${x}" y="${h - padB - barH}" width="${barW - 3}" height="${barH}" fill="${s.color}"/>`;
    });
    const labelX = padL + ci * groupW + groupW / 2;
    svg += `<text x="${labelX}" y="${h - padB + 14}" font-size="10" fill="#556" text-anchor="middle" transform="rotate(20 ${labelX} ${h - padB + 14})">${cat}</text>`;
  });
  svg += `</svg>`;
  el.innerHTML = svg + `<div class="chart-legend">${series.map((s) => `<span><span class="dot" style="background:${s.color}"></span>${s.name}</span>`).join("")}</div>`;
}

export function simpleBarChart(el, items, decimalMode) {
  if (items.every((i) => !i.value)) return emptyChart(el, "Nog geen meetgegevens");
  const w = 760, h = 220, padL = 34, padB = 30, padT = 16, padR = 10;
  const max = decimalMode ? 1 : Math.max(100, ...items.map((i) => i.value));
  const barW = (w - padL - padR) / items.length;
  let svg = `<svg class="chart" viewBox="0 0 ${w} ${h}">`;
  const ticks = decimalMode ? [0, 0.2, 0.4, 0.6, 0.8, 1] : [0, 25, 50, 75, 100];
  for (const t of ticks) {
    const ty = h - padB - (t / max) * (h - padT - padB);
    svg += `<line x1="${padL}" y1="${ty}" x2="${w - padR}" y2="${ty}" stroke="#eef1f6"/>`;
    svg += `<text x="${padL - 6}" y="${ty + 3}" font-size="10" fill="#9fb0c9" text-anchor="end">${decimalMode ? nl1(t) : t}</text>`;
  }
  items.forEach((it, i) => {
    const barH = (it.value / max) * (h - padT - padB);
    const x = padL + i * barW + 8;
    svg += `<rect x="${x}" y="${h - padB - barH}" width="${barW - 16}" height="${barH}" rx="3" fill="${it.color}"/>`;
    svg += `<text x="${x + (barW - 16) / 2}" y="${h - padB + 16}" font-size="12" fill="#556" text-anchor="middle">${it.label}</text>`;
    svg += `<text x="${x + (barW - 16) / 2}" y="${h - padB - barH - 6}" font-size="12" font-weight="600" fill="#223" text-anchor="middle">${decimalMode ? nl1(it.value) : it.value}</text>`;
  });
  svg += `</svg>`;
  el.innerHTML = svg;
}

export function renderFindings(el, findings) {
  if (!findings || findings.length === 0) {
    el.innerHTML = `<div class="empty">Nog geen betekenisvolle bevindingen (nog geen experiment met een aantoonbaar verschil t.o.v. de controle).</div>`;
    return;
  }
  el.innerHTML = findings.slice(0, 5).map((f) => `
    <div class="finding-item">
      <div class="finding-badge ${f.direction}">${ICONS[f.direction]}</div>
      <div style="flex:1;">
        <div class="finding-title" style="${f.direction === "up" ? "" : "color:var(--bad)"}">${f.title}</div>
        <div class="finding-detail">${f.detail}</div>
        <div class="finding-basis">${f.basis}</div>
      </div>
    </div>
  `).join("");
}

/** Gedeelde stepper voor Dashboard/Development Runs: nooit een latere stap groen tonen als een eerdere niet gehaald is. */
export function renderStepper(el, stages) {
  el.innerHTML = (stages || []).map((s, i) => `${i > 0 ? '<span class="arrow">→</span>' : ""}<div class="step ${s.status}">${s.label}</div>`).join("");
}

/** Eén trage/mislukte deelvernieuwing mag de rest van de pagina nooit permanent op "wordt geladen…" laten hangen. */
export async function veilig(naam, fn) {
  try {
    await fn();
  } catch (fout) {
    console.error(`laden(${naam}) mislukt:`, fout);
  }
}
