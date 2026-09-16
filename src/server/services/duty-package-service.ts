import "server-only";
import { createHash } from "node:crypto";
import { type DutyKind, DutyPackageStatus } from "@/lib/generated/prisma/enums";
import { recordAudit } from "@/server/audit/log";
import { requirePermission } from "@/server/security/authorize";
import { depotFilter, locationScopeFor } from "@/server/security/location-scope";
import { PERMISSIONS } from "@/server/security/permissions";
import { prisma } from "@/server/data/prisma";
import { toJson } from "@/server/data/json";
import {
  type ComparableDuty,
  type ImportOutcome,
  type PackageDiff,
  diffPackages,
  runImport,
  runPdfImport,
  runSheetImport,
} from "@/server/import/duty-import";
import { buildTemplate } from "@/server/import/duty-package-sheet";

/**
 * Dienstenpakketten importeren.
 *
 * ## De weg die een levering aflegt
 *
 *     UPLOADED → PARSED → NORMALIZED → VALIDATED → REVIEW_REQUIRED
 *                                          ↓
 *                                      CONFIRMED → ACTIVE
 *
 * De eerste vier stappen zitten in `runImport` en raken de database niet. Pas
 * wanneer het pakket door de controle komt, wordt het vastgelegd — met zijn
 * tellingen, zijn bevindingen en het verschil met de vorige versie erbij, zodat
 * later na te gaan is waarop iemand "akkoord" heeft geklikt.
 *
 * `CONFIRMED` en `ACTIVE` zijn twee handelingen van mensen. Bevestigen zegt:
 * deze levering klopt. Activeren zegt: hier wordt vanaf nu mee gepland. Dat is
 * niet hetzelfde moment, en het zijn niet altijd dezelfde gevolgen.
 *
 * ## Versies in plaats van bijwerken
 *
 * Een pakket wordt nooit ter plekke gewijzigd. Een nieuw aanbod is een nieuwe
 * versie met een eigen nummer en een eigen label (DDR-DR2027-V2). Roosterdagen
 * verwijzen naar een concrete `Duty`-rij, dus een vastgesteld rooster blijft
 * wijzen naar de diensten zoals ze golden toen het werd vastgesteld.
 *
 * ## De checksum
 *
 * Van het aangeleverde bestand wordt een SHA-256 bewaard. Daarmee is achteraf
 * te bewijzen dat wat in het systeem staat overeenkomt met wat er is
 * aangeleverd, en wordt herkend wanneer hetzelfde bestand tweemaal binnenkomt.
 */

export interface ImportResult {
  readonly ok: boolean;
  readonly packageId?: string;
  readonly label?: string;
  readonly outcome: ImportOutcome;
  readonly diff?: PackageDiff;
  readonly duplicateOf?: { readonly id: string; readonly label: string };
}

/**
 * "Geef me het pakket waarmee nu wordt gepland, welke dienstregeling dat ook is."
 *
 * Een scherm dat een sjabloon ophaalt, weet die code niet — en hoort hem ook
 * niet te hoeven weten. Deze waarde vraagt om het actieve pakket van de
 * standplaats in plaats van om een specifieke dienstregeling.
 */
export const HUIDIG_PAKKET = "HUIDIG";

/** Hoe het pakket is aangeleverd. */
export type DeliveryFormat = "CSV" | "XLSX" | "PDF";

export interface ImportInput {
  readonly locationCode: string;
  /** De dienstregeling, bijvoorbeeld "DR2027". */
  readonly timetableId: string;
  readonly validFrom: Date;
  readonly filename: string;
  /** Bij de CSV-route: de tekst. Bij de andere routes: de bytes. */
  readonly content?: string;
  readonly bytes?: Buffer;
  readonly format?: DeliveryFormat;
  /** Alleen controleren en tonen, nog niet vastleggen. */
  readonly dryRun?: boolean;
}

/**
 * Leest een levering in en legt hem vast wanneer hij door de controle komt.
 *
 * Met `dryRun` wordt er niets weggeschreven: dat is de importcontrole, waarin
 * een planner ziet wat er zou gebeuren voordat hij het laat gebeuren.
 */
export async function importDutyPackage(input: ImportInput): Promise<ImportResult> {
  const actor = await requirePermission(PERMISSIONS.DUTY_PACKAGE_IMPORT);

  const location = await prisma.stationLocation.findUnique({
    where: { code: input.locationCode.toUpperCase() },
    select: { id: true, code: true, name: true },
  });
  if (!location) {
    throw new Error(`Standplaats ${input.locationCode} bestaat niet.`);
  }

  // Drie manieren om binnen te komen, één straat erna. Welke route het was,
  // staat in het pakket zelf: bij een PDF hoort een andere mate van vertrouwen
  // dan bij een ingevuld sjabloon, en dat mag later niet meer te achterhalen
  // zijn uit alleen de tellingen.
  const format: DeliveryFormat = input.format ?? "CSV";
  const rauw =
    input.bytes ?? Buffer.from(input.content ?? "", "utf8");

  const outcome =
    format === "XLSX"
      ? runSheetImport({ filename: input.filename, bytes: rauw, locationCode: location.code })
      : format === "PDF"
        ? runPdfImport({ filename: input.filename, bytes: rauw, locationCode: location.code })
        : runImport({
            filename: input.filename,
            content: input.content ?? "",
            locationCode: location.code,
          });

  const checksum = createHash("sha256").update(rauw).digest("hex");
  const duplicate = await prisma.dutyPackage.findFirst({
    where: { sourceChecksum: checksum },
    select: { id: true, label: true, name: true, version: true, importedAt: true },
  });

  const vorige = await prisma.dutyPackage.findFirst({
    where: { locationId: location.id, timetableId: input.timetableId },
    orderBy: { version: "desc" },
    select: {
      id: true,
      version: true,
      label: true,
      duties: {
        select: {
          code: true,
          startMinute: true,
          endMinute: true,
          depot: true,
          weekday: true,
          weight: true,
          requiredQualifications: true,
        },
      },
    },
  });

  const diff = vorige
    ? diffPackages(vorige.duties, outcome.duties as readonly ComparableDuty[])
    : undefined;

  if (duplicate) {
    const label = duplicate.label ?? `${duplicate.name} versie ${duplicate.version}`;
    await recordAudit({
      actor,
      action: "dienstenpakket.import-dubbel",
      objectType: "DutyPackage",
      objectId: duplicate.id,
      result: "DENIED",
      reason: `Dit bestand is eerder geïmporteerd als ${label}.`,
      newValue: { bestand: outcome.safeFilename, checksum },
    });
    return {
      ok: false,
      outcome: {
        ...outcome,
        importable: false,
        problems: [
          {
            severity: "BLOCKING",
            line: 0,
            code: "DUPLICATE_FILE",
            message:
              `Dit bestand is eerder geïmporteerd als ${label} op ` +
              `${duplicate.importedAt.toLocaleDateString("nl-NL")}. Er verandert niets.`,
          },
          ...outcome.problems,
        ],
      },
      diff,
      duplicateOf: { id: duplicate.id, label },
    };
  }

  if (!outcome.importable) {
    await recordAudit({
      actor,
      action: "dienstenpakket.import-geweigerd",
      objectType: "DutyPackage",
      result: "FAILED",
      reason: outcome.problems.find((p) => p.severity === "BLOCKING")?.message,
      newValue: {
        bestand: outcome.safeFilename,
        standplaats: location.code,
        fase: outcome.stage,
        blokkerend: outcome.problems.filter((p) => p.severity === "BLOCKING").length,
      },
    });
    return { ok: false, outcome, diff };
  }

  if (input.dryRun) {
    // De importcontrole. Niets vastgelegd, alles getoond.
    return { ok: true, outcome, diff };
  }

  const version = (vorige?.version ?? 0) + 1;
  const label = `${location.code}-${input.timetableId}-V${version}`;
  const status =
    outcome.stage === "REVIEW_REQUIRED"
      ? DutyPackageStatus.REVIEW_REQUIRED
      : DutyPackageStatus.VALIDATED;

  const created = await prisma.dutyPackage.create({
    data: {
      name: `${location.code}-${input.timetableId}`,
      version,
      label,
      locationId: location.id,
      timetableId: input.timetableId,
      depot: location.code,
      validFrom: input.validFrom,
      sourceChecksum: checksum,
      sourceFilename: outcome.safeFilename,
      importedByUserId: actor.userId,
      status,
      totals: toJson(outcome.totals),
      problems: toJson(outcome.problems),
      diffFromPrevious: diff ? toJson(diff) : undefined,
      duties: {
        create: outcome.duties.map((duty) => ({
          code: duty.code,
          weekday: duty.weekday,
          numericCode: duty.numericCode,
          // Dagdeel en werksoort worden apart opgeslagen: 760 is nacht én
          // rangeer, en dat is met één veld niet vast te leggen.
          period: duty.period,
          workType: duty.workType,
          kinds: duty.kinds as DutyKind[],
          startMinute: duty.startMinute,
          endMinute: duty.endMinute,
          depot: duty.depot,
          requiredQualifications: [...duty.requiredQualifications],
          weight: duty.weight,
          description: duty.description,
          sourceRow: duty.sourceRow,
          sourceValues: toJson({ ...duty.sourceValues }),
        })),
      },
    },
    select: { id: true },
  });

  await recordAudit({
    actor,
    action: "dienstenpakket.geimporteerd",
    objectType: "DutyPackage",
    objectId: created.id,
    newValue: {
      label,
      standplaats: location.code,
      dienstregeling: input.timetableId,
      diensten: outcome.duties.length,
      status,
      checksum,
      bestand: outcome.safeFilename,
      verschil: diff
        ? { erbij: diff.added.length, eruit: diff.removed.length, gewijzigd: diff.changed.length }
        : "eerste versie",
    },
  });

  return { ok: true, packageId: created.id, label, outcome, diff };
}

/** Bevestigt dat de levering klopt. Nog geen ingebruikname. */
export async function confirmDutyPackage(
  packageId: string,
  reason: string,
): Promise<{ ok: boolean; reason?: string }> {
  const actor = await requirePermission(PERMISSIONS.DUTY_PACKAGE_IMPORT);
  const target = await prisma.dutyPackage.findUnique({
    where: { id: packageId },
    select: { id: true, label: true, status: true },
  });
  if (!target) {
    return { ok: false, reason: "Onbekend pakket." };
  }
  const toegestaan: DutyPackageStatus[] = [
    DutyPackageStatus.VALIDATED,
    DutyPackageStatus.REVIEW_REQUIRED,
  ];
  if (!toegestaan.includes(target.status)) {
    return {
      ok: false,
      reason: `Een pakket met status ${target.status} kan niet worden bevestigd.`,
    };
  }

  await prisma.dutyPackage.update({
    where: { id: packageId },
    data: { status: DutyPackageStatus.CONFIRMED },
  });
  await recordAudit({
    actor,
    action: "dienstenpakket.bevestigd",
    objectType: "DutyPackage",
    objectId: packageId,
    oldValue: { status: target.status },
    newValue: { status: DutyPackageStatus.CONFIRMED, label: target.label },
    reason,
  });
  return { ok: true };
}

/**
 * Een pakket in gebruik nemen als actieve dienstvoorraad.
 *
 * Alleen na bevestiging. Een levering die niemand heeft nagekeken, hoort niet
 * de bron te worden waaruit roosters worden gevuld.
 */
export async function activateDutyPackage(
  packageId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const actor = await requirePermission(PERMISSIONS.DUTY_PACKAGE_IMPORT);

  const target = await prisma.dutyPackage.findUnique({
    where: { id: packageId },
    select: { id: true, name: true, label: true, version: true, depot: true, status: true },
  });
  if (!target) {
    return { ok: false, reason: "Onbekend pakket." };
  }
  if (target.status === DutyPackageStatus.ACTIVE) {
    return { ok: false, reason: "Dit pakket is al actief." };
  }
  if (target.status !== DutyPackageStatus.CONFIRMED) {
    return {
      ok: false,
      reason:
        `Dit pakket staat op ${target.status}. Bevestig de levering eerst; ` +
        "activeren zonder controle maakt een ongecontroleerde levering leidend.",
    };
  }

  await prisma.$transaction([
    prisma.dutyPackage.updateMany({
      where: { depot: target.depot, status: DutyPackageStatus.ACTIVE },
      data: { status: DutyPackageStatus.SUPERSEDED },
    }),
    prisma.dutyPackage.update({
      where: { id: packageId },
      data: { status: DutyPackageStatus.ACTIVE },
    }),
  ]);

  await recordAudit({
    actor,
    action: "dienstenpakket.geactiveerd",
    objectType: "DutyPackage",
    objectId: packageId,
    oldValue: { status: target.status },
    newValue: {
      status: DutyPackageStatus.ACTIVE,
      label: target.label ?? target.name,
      versie: target.version,
    },
  });

  return { ok: true };
}

export interface DutyPackageView {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly version: number;
  readonly status: DutyPackageStatus;
  readonly depot: string;
  readonly timetableId: string;
  readonly dutyCount: number;
  readonly importedAt: Date;
  readonly checksum: string;
  readonly filename: string;
  readonly problemCount: number;
}

export async function listDutyPackages(
  requestedLocation?: string | null,
): Promise<readonly DutyPackageView[]> {
  const actor = await requirePermission(PERMISSIONS.DUTY_PACKAGE_READ);
  const scope = await locationScopeFor(actor, requestedLocation);
  const rows = await prisma.dutyPackage.findMany({
    where: depotFilter(scope),
    orderBy: [{ name: "asc" }, { version: "desc" }],
    select: {
      id: true,
      name: true,
      label: true,
      version: true,
      status: true,
      depot: true,
      timetableId: true,
      importedAt: true,
      sourceChecksum: true,
      sourceFilename: true,
      problems: true,
      _count: { select: { duties: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    label: row.label ?? `${row.name} v${row.version}`,
    version: row.version,
    status: row.status,
    depot: row.depot,
    timetableId: row.timetableId,
    dutyCount: row._count.duties,
    importedAt: row.importedAt,
    checksum: row.sourceChecksum,
    filename: row.sourceFilename,
    problemCount: Array.isArray(row.problems) ? row.problems.length : 0,
  }));
}

/** Eén pakket met alles wat de importcontrole erover heeft vastgelegd. */
export async function dutyPackageDetail(packageId: string) {
  await requirePermission(PERMISSIONS.DUTY_PACKAGE_READ);
  return prisma.dutyPackage.findUnique({
    where: { id: packageId },
    include: {
      location: { select: { code: true, name: true } },
      _count: { select: { duties: true } },
    },
  });
}

/**
 * Het Excel-sjabloon voor een standplaats, gevuld met de diensten die er nu zijn.
 *
 * ## Waarom gevuld en niet leeg
 *
 * Wie een pakket bijwerkt, wijzigt zelden alles. Een leeg sjabloon dwingt tot
 * overtypen, en dan is het verschil met de vorige versie voor de helft het
 * gevolg van tikfouten. Met de huidige diensten erin is het verschil dat het
 * systeem straks toont ook werkelijk de wijziging.
 *
 * Is er nog geen pakket, dan komt er één voorbeeldrij mee zodat de vorm van een
 * cel zichtbaar is zonder de toelichting te lezen.
 */
export async function dutyPackageTemplate(input: {
  readonly locationCode: string;
  readonly timetableId: string;
}): Promise<{ readonly filename: string; readonly bytes: Buffer }> {
  await requirePermission(PERMISSIONS.DUTY_PACKAGE_READ);

  const location = await prisma.stationLocation.findUnique({
    where: { code: input.locationCode.toUpperCase() },
    select: { id: true, code: true },
  });
  if (!location) {
    throw new Error(`Standplaats ${input.locationCode} bestaat niet.`);
  }

  // Hetzelfde pakket als de generator gebruikt, en langs dezelfde weg gevonden.
  //
  // De eerdere opzoeking filterde op `locationId` én op een meegegeven
  // `timetableId`. Allebei gaan in de praktijk mis: `locationId` is nullable en
  // staat bij pakketten van vóór de standplaatsstructuur leeg, en de knop in het
  // scherm gaf een vaste `HUIDIG` mee terwijl een echt pakket een
  // dienstregelingcode als `BDU-05-10-2026` draagt. Het gevolg was geen fout maar
  // iets vervelenders: een sjabloon dat gewoon werd geleverd, alleen leeg.
  //
  // De diensten zelf hangen aan `depot`, en dat is ook de sleutel waarmee
  // `buildOptimizerInput` ze ophaalt. Door hier dezelfde sleutel te gebruiken kan
  // het sjabloon niet meer iets anders bevatten dan wat het rooster straks
  // doorrekent.
  const huidig = await prisma.dutyPackage.findFirst({
    where: {
      status: { in: [DutyPackageStatus.ACTIVE, DutyPackageStatus.CONFIRMED] },
      ...(input.timetableId === HUIDIG_PAKKET ? {} : { timetableId: input.timetableId }),
      OR: [{ locationId: location.id }, { depot: location.code }],
    },
    orderBy: [{ status: "asc" }, { version: "desc" }],
    select: {
      timetableId: true,
      duties: {
        select: {
          code: true,
          weekday: true,
          startMinute: true,
          endMinute: true,
          depot: true,
          weight: true,
          requiredQualifications: true,
          description: true,
        },
      },
    },
  });

  // De dienstregeling van het gevonden pakket, niet de tijdelijke aanduiding
  // waarmee het scherm erom vroeg: die staat straks ook in de bestandsnaam en in
  // het tabblad Toelichting.
  const dienstregeling =
    huidig?.timetableId ?? (input.timetableId === HUIDIG_PAKKET ? "HUIDIG" : input.timetableId);

  const bytes = buildTemplate({
    locationCode: location.code,
    timetable: dienstregeling,
    duties: huidig?.duties ?? [],
  });

  return {
    filename: `dienstenpakket-${location.code}-${dienstregeling}.xlsx`,
    bytes,
  };
}
