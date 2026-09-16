/**
 * Een aangeleverd bestand is onbetrouwbare invoer.
 *
 * ## Wat dat hier betekent
 *
 * Het bestand komt van buiten: uit een mailbox, van een gedeelde schijf, uit
 * een export van een ander systeem. Het is geen kwaadwillende aanname dat het
 * fout kan zijn — het is de normale gang van zaken dat het fout ís, en af en
 * toe dat het gevaarlijk is. Deze module gaat over die tweede categorie.
 *
 * Drie dingen worden hier voorkomen:
 *
 *  1. **Uitvoeren.** Het bestand wordt gelezen als tekst en nergens anders voor
 *     gebruikt. Geen `eval`, geen dynamische import, geen shell, geen
 *     spreadsheetbibliotheek die formules evalueert. Het staat hier expliciet
 *     omdat "dat doen we toch niet" geen controle is.
 *  2. **Uitvoeren elders.** Een cel die met `=`, `+`, `-` of `@` begint, wordt
 *     door Excel en Google Sheets als formule opgevat zodra iemand onze export
 *     opent. `=cmd|'/c calc'!A1` in een dienstomschrijving is dan geen tekst
 *     meer maar een opdracht op de computer van een planner. De invoer wordt
 *     daarom gemarkeerd en de uitvoer geneutraliseerd.
 *  3. **Ontsnappen uit de map.** Een bestandsnaam als
 *     `..\\..\\Windows\\System32\\x` of `rooster.csv\u0000.exe` is bedoeld om
 *     ergens anders te belanden dan waar hij hoort. De naam wordt alleen als
 *     label bewaard en eerst tot een veilige vorm teruggebracht.
 */

/** Groter dan dit is geen dienstenpakket meer. */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/** De extensies die we accepteren. Tekstformaten, geen werkmappen. */
export const ALLOWED_EXTENSIONS = [".csv", ".txt"] as const;

export interface FileCheck {
  readonly ok: boolean;
  readonly safeFilename: string;
  readonly problems: readonly string[];
}

/**
 * Brengt een aangeleverde bestandsnaam terug tot een veilig label.
 *
 * De naam wordt nergens gebruikt om een pad mee te bouwen — hij staat alleen in
 * het overzicht en in het auditlog. Juist daarom wordt hij hier ontdaan van
 * alles wat elders betekenis heeft: mappen, stationsaanduidingen, nulbytes en
 * stuurtekens.
 */
export function safeFilename(raw: string): string {
  const zonderPad = raw.split(/[\\/]/).pop() ?? "";
  const schoon = zonderPad
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"|?*]/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);
  return schoon.length > 0 ? schoon : "aangeleverd-bestand";
}

/** Heeft dit bestand een extensie die we inlezen? */
export function hasAllowedExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return ALLOWED_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/**
 * Controleert het bestand vóór er ook maar één regel wordt geparseerd.
 *
 * Weigeren is hier goedkoop; een half ingelezen pakket repareren niet.
 */
export function checkFile(input: {
  readonly filename: string;
  readonly content: string;
}): FileCheck {
  const problems: string[] = [];
  const naam = safeFilename(input.filename);

  if (!hasAllowedExtension(naam)) {
    problems.push(
      `Bestandstype wordt niet ingelezen. Toegestaan: ${ALLOWED_EXTENSIONS.join(", ")}. ` +
        "Een werkmap (.xlsx) eerst als CSV opslaan.",
    );
  }

  const bytes = Buffer.byteLength(input.content, "utf8");
  if (bytes > MAX_IMPORT_BYTES) {
    problems.push(
      `Het bestand is ${(bytes / 1024 / 1024).toFixed(1)} MB; het maximum is ` +
        `${MAX_IMPORT_BYTES / 1024 / 1024} MB.`,
    );
  }
  if (bytes === 0) {
    problems.push("Het bestand is leeg.");
  }

  // Een nulbyte hoort niet in een tekstbestand en is een klassiek signaal dat
  // er iets anders wordt aangeboden dan wat de extensie belooft.
  if (input.content.includes("\u0000")) {
    problems.push("Het bestand bevat nulbytes en is daarmee geen tekstbestand.");
  }

  return { ok: problems.length === 0, safeFilename: naam, problems };
}

/** De extensies van de twee binaire routes, elk met de bytes die ze horen te beginnen. */
export const BINARY_SIGNATURES = {
  ".xlsx": Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  ".pdf": Buffer.from("%PDF-", "latin1"),
} as const;

/**
 * Controleert een binair aangeleverd bestand.
 *
 * Naast de grootte wordt hier gekeken of het bestand ook werkelijk is wat de
 * extensie belooft. Dat is geen wantrouwen jegens de aanleveraar maar
 * ervaringsfeit: een `.xlsx` die eigenlijk een oud `.xls` is of een als xlsx
 * hernoemde PDF komt vaker voor dan opzet, en de foutmelding die je dan zonder
 * deze controle krijgt ("geen leesbare xlsx") wijst niet naar de oorzaak.
 *
 * Werkmappen mét macro's (.xlsm, .xlsb) staan niet in de lijst. Ze worden niet
 * uitgevoerd — er wordt hier nergens iets uitgevoerd — maar ze horen niet in
 * een aanleverstroom waarin een mens ze per ongeluk elders opent.
 */
export function checkBinaryFile(input: {
  readonly filename: string;
  readonly bytes: Buffer;
  readonly extension: keyof typeof BINARY_SIGNATURES;
}): FileCheck {
  const problems: string[] = [];
  const naam = safeFilename(input.filename);

  if (!naam.toLowerCase().endsWith(input.extension)) {
    problems.push(
      `Dit is geen ${input.extension}-bestand. Lever het aan met de juiste extensie.`,
    );
  }

  if (input.bytes.length > MAX_IMPORT_BYTES) {
    problems.push(
      `Het bestand is ${(input.bytes.length / 1024 / 1024).toFixed(1)} MB; het maximum is ` +
        `${MAX_IMPORT_BYTES / 1024 / 1024} MB.`,
    );
  }
  if (input.bytes.length === 0) {
    problems.push("Het bestand is leeg.");
  }

  const handtekening = BINARY_SIGNATURES[input.extension];
  if (
    input.bytes.length >= handtekening.length &&
    !input.bytes.subarray(0, handtekening.length).equals(handtekening)
  ) {
    problems.push(
      `De inhoud begint niet zoals een ${input.extension}-bestand hoort te beginnen. ` +
        "Waarschijnlijk is het bestand hernoemd in plaats van opgeslagen in dit formaat.",
    );
  }

  return { ok: problems.length === 0, safeFilename: naam, problems };
}

/** Verwijdert een UTF-8 BOM, die anders in de eerste kolomnaam blijft plakken. */
export function stripBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

const FORMULA_START = /^[=+\-@\t\r]/;

/** Zou een spreadsheet deze cel als formule opvatten? */
export function looksLikeFormula(cell: string): boolean {
  return FORMULA_START.test(cell);
}

/**
 * Maakt een cel veilig om te exporteren.
 *
 * Een enkel aanhalingsteken ervoor is de gangbare oplossing: de cel toont
 * dezelfde tekst, maar wordt niet meer als formule uitgevoerd.
 */
export function neutraliseForExport(cell: string): string {
  return looksLikeFormula(cell) ? `'${cell}` : cell;
}
