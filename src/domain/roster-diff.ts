import { weekdayLabel } from "./time";

/**
 * Twee roosters vergelijken op de sleutel lijn/week/dag, niet op volgorde.
 *
 * ## Waarom dit een eigen, gedeeld bestand is
 *
 * Deze vergelijking bestond al in `roster-service.ts`, maar uitsluitend voor
 * twee opgeslagen `RosterVersion`-rijen — en die ontstaan pas als een
 * kandidaat is gepubliceerd. Zolang er niets gepubliceerd is (het geval in
 * deze ontwikkelomgeving), had "Roosters vergelijken" altijd minder dan twee
 * versies om uit te kiezen: niet gebroken in de zin van een fout, maar leeg op
 * een manier die niemand iets leert. §19/§20 van de v1.0.6-opdracht vragen
 * juist officieel-tegen-kandidaat en kandidaat-tegen-kandidaat te kunnen
 * vergelijken, met bestaande, echte data.
 *
 * De vergelijking zelf — de sleutel, de telling van "alleen links/rechts" —
 * hoefde niet opnieuw bedacht te worden. Hij staat hier, zodat zowel de oude
 * versievergelijking (`compareVersions`) als de nieuwe officieel/kandidaat-
 * vergelijking (`compareRosterSelections`, in `roster-service.ts`) hem delen
 * in plaats van elk hun eigen kopie bij te houden.
 *
 * ## Waarom op cel en niet op regel
 *
 * Twee roosters kunnen een verschillend aantal lijnen of weken hebben — een
 * kandidaat kan een andere rotatielengte krijgen dan het officiële rooster.
 * Vergelijken per rij zou dan een verschoven overzicht opleveren. Per cel
 * (lijn, week, dag) blijft de vergelijking eerlijk: wat niet aan beide kanten
 * bestaat, telt gewoon als "alleen links" of "alleen rechts".
 */

export interface RosterDiffDay {
  readonly lineNumber: number;
  readonly weekIndex: number;
  readonly weekday: number;
  readonly positionType: string;
  readonly dutyCode: string | null;
}

export interface RosterDiffCell {
  readonly lineNumber: number;
  readonly weekIndex: number;
  readonly weekday: number;
  readonly weekdayLabel: string;
  readonly before: string;
  readonly after: string;
}

export interface RosterDiff {
  readonly leftLabel: string;
  readonly rightLabel: string;
  readonly leftLines: number;
  readonly rightLines: number;
  readonly changed: readonly RosterDiffCell[];
  readonly unchangedCount: number;
  readonly onlyInLeft: number;
  readonly onlyInRight: number;
}

function describeCell(day: RosterDiffDay): string {
  return day.positionType === "DUTY" ? (day.dutyCode ?? "?") : day.positionType;
}

export function diffRosterDays(
  left: { readonly label: string; readonly days: readonly RosterDiffDay[] },
  right: { readonly label: string; readonly days: readonly RosterDiffDay[] },
): RosterDiff {
  const key = (day: RosterDiffDay) => `${day.lineNumber}|${day.weekIndex}|${day.weekday}`;
  const leftMap = new Map(left.days.map((day) => [key(day), day]));
  const rightMap = new Map(right.days.map((day) => [key(day), day]));

  const changed: RosterDiffCell[] = [];
  let unchanged = 0;
  let onlyInLeft = 0;

  for (const [cellKey, leftDay] of leftMap) {
    const rightDay = rightMap.get(cellKey);
    if (!rightDay) {
      onlyInLeft += 1;
      continue;
    }
    const before = describeCell(leftDay);
    const after = describeCell(rightDay);
    if (before === after) {
      unchanged += 1;
      continue;
    }
    changed.push({
      lineNumber: leftDay.lineNumber,
      weekIndex: leftDay.weekIndex,
      weekday: leftDay.weekday,
      weekdayLabel: weekdayLabel(leftDay.weekday),
      before,
      after,
    });
  }

  let onlyInRight = 0;
  for (const cellKey of rightMap.keys()) {
    if (!leftMap.has(cellKey)) onlyInRight += 1;
  }

  changed.sort((a, b) => a.lineNumber - b.lineNumber || a.weekIndex - b.weekIndex || a.weekday - b.weekday);

  const linesOf = (days: readonly RosterDiffDay[]) => new Set(days.map((d) => d.lineNumber)).size;

  return {
    leftLabel: left.label,
    rightLabel: right.label,
    leftLines: linesOf(left.days),
    rightLines: linesOf(right.days),
    changed,
    unchangedCount: unchanged,
    onlyInLeft,
    onlyInRight,
  };
}
