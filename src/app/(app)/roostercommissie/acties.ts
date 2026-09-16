"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import {
  activateDutyPackage,
  confirmDutyPackage,
  importDutyPackage,
} from "@/server/services/duty-package-service";
import { publishVersion } from "@/server/services/roster-service";

/**
 * De handelingen van een roostermaker.
 *
 * Net als bij de medewerkeracties staat hier alleen invoervalidatie en
 * doorgeven. Rechten, regels en het auditspoor zitten in de services.
 */



const importSchema = z.object({
  locationCode: z
    .string()
    .trim()
    .min(2, "Kies de standplaats.")
    .max(8)
    .regex(/^[A-Za-z]+$/, "Een standplaatscode bestaat uit letters."),
  timetableId: z
    .string()
    .trim()
    .min(2, "Geef de dienstregeling op, bijvoorbeeld DR2027.")
    .max(20)
    .regex(/^[A-Za-z0-9-]+$/, "Gebruik letters, cijfers en streepjes."),
  validFrom: z.iso.date("Kies een ingangsdatum."),
  content: z.string().min(10, "Plak de inhoud van het dienstenpakket."),
  // De naam van het aangeleverde bestand is een label, geen pad. Hij wordt in
  // de importstraat teruggebracht tot iets ongevaarlijks; hier wordt hij
  // alleen begrensd.
  filename: z.string().trim().max(200).optional(),
});

export async function importeerPakketAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = importSchema.safeParse({
    locationCode: formData.get("locationCode"),
    timetableId: formData.get("timetableId"),
    validFrom: formData.get("validFrom"),
    content: formData.get("content"),
    filename: formData.get("filename") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message };
  }

  // Zonder bevestigingsvinkje wordt er alleen gecontroleerd. De planner ziet
  // dan wat er zou gebeuren; er verandert nog niets aan de gegevens.
  const bevestigd = formData.get("bevestigd") === "ja";

  const result = await importDutyPackage({
    locationCode: parsed.data.locationCode,
    timetableId: parsed.data.timetableId,
    validFrom: new Date(`${parsed.data.validFrom}T00:00:00.000Z`),
    filename: parsed.data.filename || "handmatige-invoer.csv",
    content: parsed.data.content,
    dryRun: !bevestigd,
  });

  revalidatePath("/roostercommissie/pakketten");

  if (!result.ok) {
    return {
      error: "Het pakket is niet geïmporteerd.",
      reasons: result.outcome.problems
        .filter((problem) => problem.severity !== "NOTICE")
        .slice(0, 25)
        .map((problem) =>
          problem.line > 0 ? `Regel ${problem.line}: ${problem.message}` : problem.message,
        ),
    };
  }

  const t = result.outcome.totals;
  const verschil = result.diff
    ? ` Verschil met de vorige versie: ${result.diff.added.length} erbij, ` +
      `${result.diff.removed.length} eruit, ${result.diff.changed.length} gewijzigd.`
    : " Dit is de eerste versie voor deze dienstregeling.";

  if (!bevestigd) {
    return {
      notice:
        `Controle uitgevoerd: ${t.duties} diensten gelezen (${t.vroeg} vroeg, ${t.laat} laat, ` +
        `${t.nacht} nacht, ${t.overMidnight} over middernacht). Er is nog niets vastgelegd.` +
        verschil,
      reasons: result.outcome.problems.slice(0, 25).map((problem) => problem.message),
    };
  }

  return {
    notice:
      `${result.label} vastgelegd met ${t.duties} diensten. Bevestig de levering om hem ` +
      "daarna in gebruik te kunnen nemen." +
      verschil,
  };
}

export async function bevestigPakketAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = z.uuid().safeParse(formData.get("packageId"));
  if (!parsed.success) {
    return { error: "Ongeldige verwijzing." };
  }
  const reden = z
    .string()
    .trim()
    .min(3, "Noteer kort waarop de bevestiging is gebaseerd.")
    .max(300)
    .safeParse(formData.get("reden") ?? "Levering nagekeken in de importcontrole.");
  if (!reden.success) {
    return { error: reden.error.issues[0]?.message };
  }

  const result = await confirmDutyPackage(parsed.data, reden.data);
  revalidatePath("/roostercommissie/pakketten");
  return result.ok
    ? { notice: "De levering is bevestigd. Activeren is de volgende, aparte stap." }
    : { error: result.reason };
}

export async function activeerPakketAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = z.uuid().safeParse(formData.get("packageId"));
  if (!parsed.success) {
    return { error: "Ongeldige verwijzing." };
  }
  const result = await activateDutyPackage(parsed.data);
  revalidatePath("/roostercommissie/pakketten");
  return result.ok
    ? {
        notice:
          "Het pakket is de actieve dienstvoorraad. Het vorige actieve pakket is vervangen; " +
          "bestaande roosters blijven wijzen naar de diensten waarmee ze zijn vastgesteld.",
      }
    : { error: result.reason };
}

export async function publiceerRoosterAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = z.uuid().safeParse(formData.get("versionId"));
  if (!parsed.success) {
    return { error: "Ongeldige verwijzing." };
  }

  const result = await publishVersion(parsed.data);
  revalidatePath("/roostercommissie/publiceren");
  revalidatePath("/roostercommissie/roosters");
  revalidatePath("/roostercommissie");

  return result.ok ? { notice: result.reason } : { error: result.reason };
}

const bestandSchema = z.object({
  locationCode: z.string().trim().min(2),
  timetableId: z.string().trim().min(2),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Kies een ingangsdatum."),
});

/**
 * Een aangeleverd bestand inlezen: ingevuld Excel-sjabloon of PDF-document.
 *
 * Het formaat volgt uit de extensie en wordt in de importstraat opnieuw
 * gecontroleerd tegen de eerste bytes van het bestand — een hernoemde PDF is
 * daarmee geen xlsx, hoe hij ook heet.
 *
 * Net als bij de tekstroute geldt: zonder bevestigingsvinkje wordt er alleen
 * gecontroleerd. Activeren gebeurt hier sowieso niet; dat is een aparte
 * handeling op een pakket dat al is vastgelegd.
 */
export async function importeerBestandAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = bestandSchema.safeParse({
    locationCode: formData.get("locationCode"),
    timetableId: formData.get("timetableId"),
    validFrom: formData.get("validFrom"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message };
  }

  const bestand = formData.get("bestand");
  if (!(bestand instanceof File) || bestand.size === 0) {
    return { error: "Kies een bestand." };
  }

  const naam = bestand.name.toLowerCase();
  const format = naam.endsWith(".xlsx") ? "XLSX" : naam.endsWith(".pdf") ? "PDF" : null;
  if (!format) {
    return {
      error: "Dit bestandstype wordt niet ingelezen.",
      reasons: [
        "Lever een ingevuld Excel-sjabloon (.xlsx) aan, of een PDF-document (.pdf).",
        "Een werkmap met macro's (.xlsm) wordt niet geopend.",
      ],
    };
  }

  const result = await importDutyPackage({
    locationCode: parsed.data.locationCode,
    timetableId: parsed.data.timetableId,
    validFrom: new Date(`${parsed.data.validFrom}T00:00:00.000Z`),
    filename: bestand.name,
    bytes: Buffer.from(await bestand.arrayBuffer()),
    format,
    dryRun: formData.get("bevestigd") !== "ja",
  });

  revalidatePath("/roostercommissie/pakketten");

  if (!result.ok) {
    return {
      error: "Het pakket is niet ingelezen.",
      reasons: result.outcome.problems
        .filter((probleem) => probleem.severity !== "NOTICE")
        .slice(0, 25)
        .map((probleem) => probleem.message),
    };
  }

  const totalen = result.outcome.totals;
  const teBeoordelen = result.outcome.problems.filter(
    (probleem) => probleem.severity === "REVIEW",
  );
  const verschil = result.diff
    ? ` Verschil met de vorige versie: ${result.diff.added.length} erbij, ` +
      `${result.diff.removed.length} eruit, ${result.diff.changed.length} gewijzigd.`
    : "";

  return {
    notice:
      (result.packageId
        ? `Vastgelegd als ${result.label}: ${totalen.duties} diensten.`
        : `Controle geslaagd: ${totalen.duties} diensten gelezen. Er is nog niets vastgelegd.`) +
      verschil,
    reasons: teBeoordelen.slice(0, 15).map((probleem) => probleem.message),
  };
}
