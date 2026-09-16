/**
 * Het roosterblad zoals het naar buiten gaat.
 *
 * ## Eén opmaak voor scherm en export
 *
 * Preview en export gebruiken letterlijk deze functie. Twee renderers zouden
 * betekenen dat wat een planner op het scherm goedkeurt, niet hetzelfde is als
 * wat een machinist in handen krijgt — en dat verschil merk je pas wanneer het
 * verkeerd is afgedrukt.
 *
 * ## De export mag niet liegen
 *
 * Zolang het platform in simulatiemodus draait, staat dat op elk blad: in de
 * kop, in de metagegevens en over de pagina heen. Een blad dat eruitziet als
 * een vastgesteld rooster maar het niet is, is gevaarlijker dan geen blad —
 * iemand plant er zijn leven mee.
 *
 * ## Waarom HTML en geen PDF-bibliotheek
 *
 * Het blad wordt als printbare HTML uitgeleverd; de browser maakt er met
 * "opslaan als PDF" een PDF van, met dezelfde opmaak. Een PDF-bibliotheek
 * toevoegen is een besluit met gevolgen voor onderhoud en beveiliging, en
 * levert bovendien pas iets op zodra de officiële NS-opmaak is aangeleverd.
 * Tot die tijd zou een eigen PDF-opmaak alleen maar overtuigender liegen over
 * hoe officieel hij is.
 */

export interface RosterDocumentMeta {
  /**
   * Het beeldmerk als data-URI.
   *
   * Bewust ingesloten en niet als verwijzing: dit blad wordt opgeslagen,
   * gemaild en afgedrukt, en een plaatje dat alleen laadt zolang de server
   * bereikbaar is, ontbreekt precies op het moment dat het wordt gebruikt.
   * Null wanneer het aangeleverde bestand er niet is — dan staat er geen
   * beeldmerk, en zeker geen nagetekend.
   */
  readonly logoDataUri: string | null;
  readonly locationCode: string;
  readonly locationName: string;
  readonly rosterCode: string;
  readonly rosterName: string;
  readonly profileLabel: string;
  readonly timetableId: string;
  readonly periodLabel: string;
  readonly changeType: "NEW_TIMETABLE" | "AMENDMENT";
  readonly structureState: string;
  readonly rulesetVersion: string;
  readonly rulesetMode: string;
  readonly legalStatus: string;
  readonly generatedAt: string;
  readonly generatedBy: string;
  /** Is dit een vastgesteld rooster of een simulatie? */
  readonly productionSafe: boolean;
  readonly dutyPackageLabel: string | null;
}

export interface RosterDocumentLine {
  readonly lineNumber: number;
  readonly employeeNumber: string | null;
  /** Per cyclusweek zeven cellen, maandag tot en met zondag. */
  readonly weeks: readonly (readonly string[])[];
}

export interface RosterDocument {
  readonly meta: RosterDocumentMeta;
  readonly lines: readonly RosterDocumentLine[];
}

const WEEKDAYS = ["ma", "di", "wo", "do", "vr", "za", "zo"] as const;

export const SIMULATION_LABEL = "SIMULATIE — GEEN VASTGESTELD ROOSTER";

/** HTML-escaping. Alle inhoud komt uit de database en gaat hier doorheen. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function metaRows(meta: RosterDocumentMeta): readonly [string, string][] {
  return [
    ["Standplaats", `${meta.locationCode} — ${meta.locationName}`],
    ["Rooster", `${meta.rosterCode} (${meta.rosterName})`],
    ["Roosterprofiel", meta.profileLabel],
    ["Dienstregeling", meta.timetableId],
    ["Periode", meta.periodLabel],
    [
      "Soort ronde",
      meta.changeType === "AMENDMENT" ? "Wijzigingsblad" : "Nieuwe dienstregeling",
    ],
    [
      "Structuur",
      meta.structureState === "STRUCTURE_LOCKED" ? "Vastgelegd" : "Nog te bepalen",
    ],
    ["Dienstenpakket", meta.dutyPackageLabel ?? "niet vastgelegd"],
    ["Regelbestand", `${meta.rulesetVersion} (${meta.rulesetMode})`],
    ["Juridische status", meta.legalStatus],
    ["Opgesteld op", meta.generatedAt],
    ["Opgesteld door", meta.generatedBy],
    ["Status van dit blad", meta.productionSafe ? "Vastgesteld" : SIMULATION_LABEL],
  ];
}

/** Het volledige blad, klaar om te tonen of af te drukken. */
export function renderRosterDocument(document: RosterDocument): string {
  const { meta } = document;
  const cyclusWeken = document.lines[0]?.weeks.length ?? 0;

  const kop = [
    "<tr>",
    '<th class="lijn">Lijn</th>',
    '<th class="mw">Personeelsnr.</th>',
    ...Array.from({ length: cyclusWeken }, (_, week) =>
      WEEKDAYS.map(
        (dag) =>
          `<th class="dag${dag === "za" || dag === "zo" ? " weekend" : ""}">w${week + 1} ${dag}</th>`,
      ).join(""),
    ),
    "</tr>",
  ].join("");

  const rijen = document.lines
    .map((line) => {
      const cellen = line.weeks
        .map((week) =>
          week
            .map((cel, index) => {
              const weekend = index >= 5;
              const soort = celSoort(cel);
              return `<td class="cel ${soort}${weekend ? " weekend" : ""}">${escapeHtml(cel)}</td>`;
            })
            .join(""),
        )
        .join("");
      return (
        `<tr><td class="lijn">${line.lineNumber}</td>` +
        `<td class="mw">${escapeHtml(line.employeeNumber ?? "—")}</td>${cellen}</tr>`
      );
    })
    .join("");

  const meta_html = metaRows(meta)
    .map(
      ([label, waarde]) =>
        `<div class="metaregel"><span class="metalabel">${escapeHtml(label)}</span>` +
        `<span class="metawaarde">${escapeHtml(waarde)}</span></div>`,
    )
    .join("");

  return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<title>${escapeHtml(`${meta.rosterCode} — ${meta.locationCode} ${meta.timetableId}`)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 16mm 12mm; background: #fff; color: #0a0a0a;
         font-family: "Segoe UI", system-ui, sans-serif; font-size: 9pt; }
  h1 { font-size: 14pt; margin: 0 0 2mm; }
  .kop { display: flex; align-items: flex-start; gap: 6mm; margin-bottom: 2mm; }
  /* Alleen de hoogte wordt gezet; de breedte volgt uit het bestand, zodat het
     beeldmerk niet vervormt. */
  .merk { height: 12mm; width: auto; }
  .sub { color: #555; margin: 0 0 6mm; }
  .stempel { display: inline-block; border: 2px solid #b45309; color: #b45309;
             padding: 1mm 3mm; font-weight: 700; letter-spacing: .04em; margin-bottom: 4mm; }
  .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0 8mm; margin-bottom: 6mm; border-top: 1px solid #ddd;
          border-bottom: 1px solid #ddd; padding: 3mm 0; }
  .metaregel { display: flex; justify-content: space-between; gap: 4mm; padding: .6mm 0; }
  .metalabel { color: #555; }
  .metawaarde { font-weight: 600; text-align: right; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: .3mm solid #cbd5e1; padding: .8mm 1mm; text-align: center;
           font-variant-numeric: tabular-nums; }
  th { background: #f1f5f9; font-size: 7.5pt; font-weight: 600; }
  td.lijn, th.lijn { width: 8mm; font-weight: 700; }
  td.mw, th.mw { width: 18mm; }
  td.cel { font-size: 8pt; }
  .weekend { background: #f8fafc; }
  .rust { color: #64748b; }
  .anker { color: #0f766e; font-weight: 600; }
  .leeg { color: #cbd5e1; }
  .watermerk { position: fixed; inset: 0; display: flex; align-items: center;
               justify-content: center; pointer-events: none; z-index: 0; }
  .watermerk span { font-size: 46pt; font-weight: 800; color: rgba(180, 83, 9, .10);
                    transform: rotate(-24deg); letter-spacing: .08em; white-space: nowrap; }
  .inhoud { position: relative; z-index: 1; }
  footer { margin-top: 6mm; color: #555; font-size: 7.5pt; }
  @page { size: A4 landscape; margin: 10mm; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
${meta.productionSafe ? "" : `<div class="watermerk"><span>${escapeHtml(SIMULATION_LABEL)}</span></div>`}
<div class="inhoud">
<div class="kop">
${meta.logoDataUri ? `<img class="merk" src="${meta.logoDataUri}" alt="NS">` : ""}
<div>
<h1>${escapeHtml(`${meta.rosterCode} — ${meta.rosterName}`)}</h1>
<p class="sub">${escapeHtml(`${meta.locationCode} ${meta.locationName} · ${meta.profileLabel} · ${meta.periodLabel}`)}</p>
</div>
</div>
${meta.productionSafe ? "" : `<div class="stempel">${escapeHtml(SIMULATION_LABEL)}</div>`}
<div class="meta">${meta_html}</div>
<table><thead>${kop}</thead><tbody>${rijen}</tbody></table>
<footer>
${escapeHtml(
  meta.productionSafe
    ? "Vastgesteld roosterblad."
    : "Dit blad komt uit een simulatie. Het is geen vastgesteld rooster en er kunnen geen " +
        "rechten aan worden ontleend. De onderliggende regelverzameling is niet als actueel " +
        "geverifieerd.",
)}
</footer>
</div>
</body>
</html>`;
}

function celSoort(cel: string): string {
  if (cel === "") {
    return "leeg";
  }
  if (cel === "R" || cel === "RUST") {
    return "rust";
  }
  if (["RES", "WR", "CO", "WTV"].includes(cel)) {
    return "anker";
  }
  return "dienst";
}

/** De korte celaanduiding voor een positietype. */
export function cellFor(positionType: string, dutyCode: string | null): string {
  switch (positionType) {
    case "DUTY":
      return dutyCode ?? "?";
    case "RUST":
      return "R";
    case "RES":
      return "RES";
    case "WR":
      return "WR";
    case "CO":
      return "CO";
    case "VERLOF":
      return "V";
    case "OPLEIDING":
      return "OPL";
    default:
      return positionType;
  }
}
