import { neutraliseForExport } from "@/server/import/file-safety";

/**
 * Een dienstenpakket terugschrijven in het formaat waarin het binnenkwam.
 *
 * ## Waarvoor dit bestaat
 *
 * Twee dingen. Ten eerste kan een planner een pakket teruggeven aan wie het
 * heeft aangeleverd, in dezelfde vorm. Ten tweede, en belangrijker: hiermee is
 * te controleren dat de import niets heeft verloren. Wat eruit komt, gaat er
 * opnieuw in; komt er dan iets anders uit, dan zit er een fout in de
 * verwerking die je op geen andere manier ziet.
 *
 * ## De aanhalingstekens
 *
 * Elke cel gaat langs `neutraliseForExport`. Een omschrijving die met `=`
 * begint, is in ons systeem gewoon tekst; in Excel is het een formule. Wie dit
 * bestand opent, hoort geen opdracht uit te voeren die iemand anders in een
 * dienstomschrijving heeft gezet.
 */

export const DUTY_CSV_HEADER = [
  "dienst",
  "weekdag",
  "start",
  "eind",
  "standplaats",
  "zwaarte",
  "bevoegdheden",
  "omschrijving",
] as const;

export interface ExportableDuty {
  readonly code: string;
  /** 1 = maandag tot en met 7 = zondag; samen met de code de identiteit. */
  readonly weekday: number;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly depot: string;
  readonly weight: number;
  readonly requiredQualifications: readonly string[];
  readonly description: string | null;
}

function klok(minuten: number): string {
  const dagminuut = ((minuten % 1440) + 1440) % 1440;
  const uur = Math.floor(dagminuut / 60);
  const min = dagminuut % 60;
  return `${String(uur).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Zet een pakket om naar de puntkomma-vorm waarin het wordt aangeleverd. */
export function toDutyCsv(duties: readonly ExportableDuty[]): string {
  const regels = duties.map((duty) =>
    [
      duty.code,
      String(duty.weekday),
      klok(duty.startMinute),
      klok(duty.endMinute),
      duty.depot,
      String(duty.weight),
      [...duty.requiredQualifications].join(","),
      duty.description ?? "",
    ]
      .map((cel) => neutraliseForExport(cel).replace(/;/g, ","))
      .join(";"),
  );
  return [DUTY_CSV_HEADER.join(";"), ...regels].join("\n");
}
