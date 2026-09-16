import { NextResponse } from "next/server";
import { z } from "zod";
import { formatMinuteOfDay, toCalendarDate } from "@/domain/time";
import { recordAudit } from "@/server/audit/log";
import { requirePermission, toPublicError } from "@/server/security/authorize";
import { PERMISSIONS } from "@/server/security/permissions";
import { dayPlan } from "@/server/services/duty-assignment-service";
import { metSessieUitVerzoek } from "@/server/auth/session";

/**
 * Nooit vooraf uitrekenen: zie de toelichting in
 * `roostercommissie/pakketten/sjabloon/route.ts`. Een route die zonder verzoek
 * wordt uitgevoerd, heeft geen sessie, en het antwoord dat daaruit komt is de
 * toegangsfout — voor iedereen.
 */
export const dynamic = "force-dynamic";

/**
 * De dagplanning als CSV.
 *
 * Een route handler in plaats van een server action, omdat de uitkomst een
 * bestand is en geen paginastatus. De rechtencontrole staat hier én in de
 * service: het eindpunt is een doorgeefluik, de service beslist.
 *
 * Personeelsnummers, geen namen. Een export verlaat het systeem; de beperking
 * hoort daarom in de export zelf te zitten.
 */
export async function GET(request: Request): Promise<NextResponse> {
  return metSessieUitVerzoek(request, () => exporteer(request));
}

async function exporteer(request: Request): Promise<NextResponse> {
  try {
    const actor = await requirePermission(PERMISSIONS.ASSIGNMENT_EXPORT);

    const raw = new URL(request.url).searchParams.get("datum");
    const parsed = z.iso.date().safeParse(raw ?? toCalendarDate(new Date()));
    if (!parsed.success) {
      return NextResponse.json({ error: "Ongeldige datum." }, { status: 400 });
    }
    const date = parsed.data;

    const rows = await dayPlan(date);
    const content = [
      "datum;personeelsnummer;roosterprofiel;positie;dienst;start;eind;herkomst",
      ...rows.map((row) =>
        [
          date,
          row.employeeNumber,
          row.rosterProfile,
          row.positionType,
          row.dutyCode ?? "",
          row.startMinute === null ? "" : formatMinuteOfDay(row.startMinute),
          row.endMinute === null ? "" : formatMinuteOfDay(row.endMinute),
          row.source,
        ].join(";"),
      ),
    ].join("\n");

    await recordAudit({
      actor,
      action: "dagplanning.geexporteerd",
      objectType: "ScheduledDuty",
      newValue: { datum: date, regels: rows.length, formaat: "csv" },
    });

    return new NextResponse(content, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="dagplanning-${date}.csv"`,
        "Cache-Control": "no-store, private",
      },
    });
  } catch (error) {
    const publicError = toPublicError(error);
    if (publicError.status === 500) {
      console.error("[export dagplanning] mislukt", error);
    }
    return NextResponse.json({ error: publicError.message }, { status: publicError.status });
  }
}
