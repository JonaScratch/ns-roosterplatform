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
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/><path d="M9.5 20v-6h5v6"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z"/></svg>',
  flask: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2v6L3.5 18a2 2 0 0 0 1.7 3h13.6a2 2 0 0 0 1.7-3L15 8V2"/><path d="M9 2h6"/><path d="M6.5 15h11"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
  compare: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3 4 7l4 4"/><path d="M4 7h11a5 5 0 0 1 5 5v0"/><path d="M16 21l4-4-4-4"/><path d="M20 17H9a5 5 0 0 1-5-5v0"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><polyline points="7 10 12 15 17 10"/><path d="M5 19h14"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17H7a5 5 0 0 1 0-10h2"/><path d="M15 7h2a5 5 0 0 1 0 10h-2"/><line x1="8" y1="12" x2="16" y2="12"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  lightbulb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2Z"/></svg>',
  filter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="4 3 20 3 14 11 14 19 10 21 10 11 4 3"/></svg>',
  message: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v12H7l-3 3V4Z"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 11.5 21 3l-6 18-4.5-7.5L3 11.5Z"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V9"/><polyline points="7 14 12 9 17 14"/><path d="M5 5h14"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.5 9a9 9 0 0 1 14.7-3.4L23 10M1 14l4.8 4.4A9 9 0 0 0 20.5 15"/></svg>',
  paperclip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.4 11.5-9 9a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2Z"/><path d="M6 17h13"/></svg>',
};
export function iconChip(name, color, size) {
  return `<div class="icon-chip ${color}${size ? " " + size : ""}">${ICONS[name] || ""}</div>`;
}

/** Klein icon-vak vóór een kaarttitel (`<h3>`), zoals elke referentiepagina gebruikt. */
export function titleIcon(name, color, size) {
  const cls = size === "sm" ? "card-title-icon sm" : "card-title-icon";
  return `<span class="${cls}" style="${color ? `background:${color}22; color:${color};` : ""}">${ICONS[name] || ""}</span>`;
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

/** `opts.area`: vul het gebied onder de eerste serie licht in (zoals de referentiegrafieken). `opts.peakLabel`: toon een klein badge-label bij het laatste punt van de eerste serie. */
export function lineChart(el, series, opts = {}) {
  const w = 760, h = 240, padL = 36, padB = 26, padT = 14, padR = 20;
  const alle = series.flatMap((s) => s.points.map((p) => p.y)).filter((v) => v !== null && v !== undefined);
  if (alle.length === 0) return emptyChart(el, "Nog geen meetgegevens");
  const maxY = Math.max(100, ...alle);
  const minY = Math.min(0, ...alle);
  const n = Math.max(...series.map((s) => s.points.length));
  const xAt = (i) => padL + (n <= 1 ? (w - padL - padR) / 2 : (i / (n - 1)) * (w - padL - padR));
  const yAt = (v) => h - padB - ((v - minY) / (maxY - minY || 1)) * (h - padT - padB);
  let svg = `<svg class="chart" viewBox="0 0 ${w} ${h}">`;
  const gridSteps = [0, 25, 50, 75, 100].filter((t) => t >= minY && t <= maxY);
  for (const t of gridSteps) {
    svg += `<line x1="${padL}" y1="${yAt(t)}" x2="${w - padR}" y2="${yAt(t)}" stroke="#f0f2f7"/>`;
    svg += `<text x="${padL - 8}" y="${yAt(t) + 3}" font-size="10" fill="#9fb0c9" text-anchor="end">${t}</text>`;
  }
  series.forEach((s, si) => {
    const puntjes = s.points.map((p, i) => (p.y === null || p.y === undefined ? null : { x: xAt(i), y: yAt(p.y) })).filter(Boolean);
    if (puntjes.length === 0) return;
    if (opts.area && si === 0) {
      const vlak = `${xAt(0)},${yAt(minY)} ` + puntjes.map((p) => `${p.x},${p.y}`).join(" ") + ` ${puntjes[puntjes.length - 1].x},${yAt(minY)}`;
      svg += `<polygon points="${vlak}" fill="${s.color}" opacity="0.10"/>`;
    }
    const pts = puntjes.map((p) => `${p.x},${p.y}`).join(" ");
    svg += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2.75" stroke-linejoin="round" stroke-linecap="round"/>`;
    puntjes.forEach((p) => { svg += `<circle cx="${p.x}" cy="${p.y}" r="4" fill="#fff" stroke="${s.color}" stroke-width="2.5"/>`; });
    if (opts.peakLabel && si === 0) {
      const laatste = puntjes[puntjes.length - 1];
      const label = opts.peakLabel;
      const bw = 8 * label.length + 16;
      svg += `<g transform="translate(${Math.min(laatste.x - bw / 2, w - padR - bw)}, ${Math.max(laatste.y - 34, 4)})">`;
      svg += `<rect width="${bw}" height="22" rx="11" fill="${s.color}"/>`;
      svg += `<text x="${bw / 2}" y="15" font-size="11" font-weight="700" fill="#fff" text-anchor="middle">${label}</text>`;
      svg += `</g>`;
    }
  });
  svg += `</svg>`;
  el.innerHTML = svg + `<div class="chart-legend">${series.map((s) => `<span><span class="dot" style="background:${s.color}"></span>${s.name}</span>`).join("")}</div>`;
}

export function groupedBarChart(el, categories, series) {
  const withData = series.some((s) => s.values.some((v) => v !== null && v !== undefined));
  if (categories.length === 0 || !withData) return emptyChart(el, "Nog geen meetgegevens");
  const w = 760, h = 250, padL = 32, padB = 46, padT = 22;
  const maxY = 100;
  const groupW = (w - padL - 10) / categories.length;
  const barW = groupW / (series.length + 1);
  let svg = `<svg class="chart" viewBox="0 0 ${w} ${h}">`;
  for (const t of [0, 25, 50, 75, 100]) {
    const ty = h - padB - (t / maxY) * (h - padT - padB);
    svg += `<line x1="${padL}" y1="${ty}" x2="${w}" y2="${ty}" stroke="#f0f2f7"/>`;
  }
  svg += `<line x1="${padL}" y1="${h - padB}" x2="${w}" y2="${h - padB}" stroke="#dde3ee"/>`;
  categories.forEach((cat, ci) => {
    series.forEach((s, si) => {
      const v = s.values[ci];
      if (v === null || v === undefined) return;
      const barH = Math.max(0, (v / maxY) * (h - padT - padB));
      const x = padL + ci * groupW + si * barW + 4;
      const bw = barW - 5;
      svg += `<rect x="${x}" y="${h - padB - barH}" width="${bw}" height="${barH}" rx="4" fill="${s.color}"/>`;
      svg += `<text x="${x + bw / 2}" y="${h - padB - barH - 6}" font-size="10.5" font-weight="700" fill="#556" text-anchor="middle">${typeof v === "number" ? nl1(v).replace(",00", "") : v}</text>`;
    });
    const labelX = padL + ci * groupW + groupW / 2;
    svg += `<text x="${labelX}" y="${h - padB + 18}" font-size="10.5" fill="#556" text-anchor="middle">${cat}</text>`;
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

/**
 * Gedeelde stepper voor Dashboard/Development Runs/Candidates/Experiment-
 * detail: genummerde cirkels verbonden door een lijn (zoals elke
 * referentiepagina) — nooit een latere stap groen tonen als een eerdere niet
 * gehaald is. `s.status` is "done"|"active"|"failed"|"pending"; `s.sub` is
 * optioneel een klein onderschrift.
 */
export function renderStepper(el, stages) {
  el.innerHTML = (stages || []).map((s, i) => {
    const nummer = s.status === "done" ? ICONS.check : s.status === "failed" ? ICONS.x : String(i + 1);
    const connector = i > 0 ? `<div class="step-connector ${stages[i - 1].status === "done" ? "done" : ""}"></div>` : "";
    return `${connector}<div class="step ${s.status}"><div class="step-circle">${nummer}</div><div class="step-label">${s.label}${s.sub ? `<div class="step-sub">${s.sub}</div>` : ""}</div></div>`;
  }).join("");
}

/** Eén trage/mislukte deelvernieuwing mag de rest van de pagina nooit permanent op "wordt geladen…" laten hangen. */
export async function veilig(naam, fn) {
  try {
    await fn();
  } catch (fout) {
    console.error(`laden(${naam}) mislukt:`, fout);
  }
}
