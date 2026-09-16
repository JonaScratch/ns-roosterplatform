import { classifyDutyCode } from "../../src/domain/duty-classification";

/**
 * Het voorbeelddienstenpakket voor de ontwikkelomgeving.
 *
 * De tijden zijn zo gekozen dat de roosterpatronen in `patterns.ts` de harde
 * rustregels halen. Dat is geen toeval en ook geen truc: het is de manier
 * waarop je een testomgeving bouwt waarin de regels iets betekenen. Zou de
 * seed roosters opleveren die de eigen regels overtreden, dan zou elke ruil en
 * elke beschikbare dienst geblokkeerd worden en zou er niets te demonstreren
 * zijn — behalve dat de regels werken.
 */

export interface SeedDuty {
  readonly code: string;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly weight: number;
  readonly description: string;
  readonly requiredQualifications: readonly string[];
}

/**
 * De omschrijvingen noemen het soort dienst en geen traject.
 *
 * Dit zijn oefengegevens. Een omschrijving met een echte rit erin leest als
 * informatie en is het niet: welke treinen er vanuit Dordrecht rijden, staat
 * niet in de aangeleverde stukken. Liever een omschrijving die niets belooft
 * dan een die iets belooft wat niemand heeft gezegd.
 */

/** Vroege diensten: 1–99. */
const VROEG: readonly SeedDuty[] = [
  { code: "041", startMinute: 300, endMinute: 795, weight: 3, description: "Sprinterdienst", requiredQualifications: [] },
  { code: "042", startMinute: 315, endMinute: 810, weight: 3, description: "Sprinterdienst", requiredQualifications: [] },
  { code: "043", startMinute: 330, endMinute: 825, weight: 2, description: "Intercitydienst", requiredQualifications: [] },
  { code: "044", startMinute: 345, endMinute: 840, weight: 4, description: "Intercitydienst", requiredQualifications: [] },
  { code: "045", startMinute: 360, endMinute: 855, weight: 3, description: "Sprinterdienst", requiredQualifications: [] },
  { code: "046", startMinute: 300, endMinute: 780, weight: 4, description: "Intercitydienst", requiredQualifications: [] },
];

/** Late diensten: 100–199. */
const LAAT: readonly SeedDuty[] = [
  { code: "141", startMinute: 780, endMinute: 1290, weight: 3, description: "Intercitydienst", requiredQualifications: [] },
  { code: "142", startMinute: 795, endMinute: 1305, weight: 3, description: "Sprinterdienst", requiredQualifications: [] },
  { code: "143", startMinute: 810, endMinute: 1320, weight: 4, description: "Intercitydienst", requiredQualifications: [] },
  { code: "144", startMinute: 825, endMinute: 1335, weight: 3, description: "Sprinterdienst", requiredQualifications: [] },
  { code: "145", startMinute: 840, endMinute: 1350, weight: 2, description: "Sprinterdienst", requiredQualifications: [] },
];

/** Nachtdiensten: 200–299. */
const NACHT: readonly SeedDuty[] = [
  { code: "241", startMinute: 1350, endMinute: 1845, weight: 5, description: "Nachtnetdienst", requiredQualifications: [] },
  { code: "242", startMinute: 1350, endMinute: 1830, weight: 5, description: "Nachtnetdienst", requiredQualifications: [] },
  { code: "243", startMinute: 1365, endMinute: 1860, weight: 4, description: "Nachtnetdienst", requiredQualifications: [] },
];

/** Reservediensten: 600-serie. Iets anders dan een RES-positie in het rooster. */
const RESERVE: readonly SeedDuty[] = [
  { code: "601", startMinute: 300, endMinute: 780, weight: 2, description: "Reserve vroeg", requiredQualifications: [] },
  { code: "602", startMinute: 780, endMinute: 1260, weight: 2, description: "Reserve laat", requiredQualifications: [] },
  { code: "603", startMinute: 1350, endMinute: 1830, weight: 3, description: "Reserve nacht", requiredQualifications: [] },
];

/** Rangeer/RET: 700-serie. */
const RANGEER: readonly SeedDuty[] = [
  { code: "711", startMinute: 420, endMinute: 915, weight: 3, description: "Rangeren opstelterrein Utrecht", requiredQualifications: ["RANGEER"] },
  { code: "712", startMinute: 435, endMinute: 930, weight: 3, description: "Rangeren Cartesiusweg", requiredQualifications: ["RANGEER"] },
  { code: "713", startMinute: 450, endMinute: 945, weight: 4, description: "Rangeren met wisselbediening", requiredQualifications: ["RANGEER", "WISSELBEDIENING"] },
];

/**
 * De uitzonderingen: nacht én rangeer.
 *
 * Deze twee staan hier apart omdat ze het hele punt van de classificatie zijn.
 * Ze vallen buiten elk roosterprofiel zonder nacht, ook al lijkt hun nummer op
 * een gewone rangeerdienst.
 */
const NACHT_RANGEER: readonly SeedDuty[] = [
  { code: "760", startMinute: 1390, endMinute: 1880, weight: 5, description: "Nachtrangeren opstelterrein", requiredQualifications: ["RANGEER"] },
  { code: "761", startMinute: 1380, endMinute: 1875, weight: 5, description: "Nachtrangeren Cartesiusweg", requiredQualifications: ["RANGEER"] },
];

export const SEED_DUTIES: readonly SeedDuty[] = [
  ...VROEG,
  ...LAAT,
  ...NACHT,
  ...RESERVE,
  ...RANGEER,
  ...NACHT_RANGEER,
];

/** De dienstnummers per patroonletter, voor het opbouwen van roosterlijnen. */
export const DUTY_POOLS: Record<string, readonly string[]> = {
  V: VROEG.map((duty) => duty.code),
  L: LAAT.map((duty) => duty.code),
  N: NACHT.map((duty) => duty.code),
  R: RANGEER.map((duty) => duty.code),
};

/**
 * Controle bij het bouwen van de seed.
 *
 * Een dienstnummer dat de classificatie niet kent, zou hier stil een pakket in
 * glijden en pas veel later opvallen. Beter meteen stuklopen.
 */
export function assertClassifiable(): void {
  for (const duty of SEED_DUTIES) {
    classifyDutyCode(duty.code);
  }
}
