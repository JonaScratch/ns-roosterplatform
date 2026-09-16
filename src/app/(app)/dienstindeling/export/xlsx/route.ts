import { NextResponse } from "next/server";
import { z } from "zod";
import { toCalendarDate } from "@/domain/time";
import { recordAudit } from "@/server/audit/log";
import { requirePermission, toPublicError } from "@/server/security/authorize";
import { PERMISSIONS } from "@/server/security/permissions";
import { locationScopeFor } from "@/server/security/location-scope";
import { buildDagplanningWorkbook } from "@/server/services/dagplanning-export-service";
import { metSessieUitVerzoek } from "@/server/auth/session";

/**
 * Nooit vooraf uitrekenen: zie de toelichting in
 * `roostercommissie/pakketten/sjabloon/route.ts`. Een route die zonder verzoek
 * wordt uitgevoerd, heeft geen sessie, en het antwoord dat daaruit komt is de
 * toegangsfout — voor iedereen.
 */
export const dynamic = "force-dynamic";

/**
 * De dagplanning als professioneel Excel-bestand — de primaire export.
 *
 * Zie `dagplanning-export-service.ts` voor waarom dit de primaire export is
 * en de CSV-route (`/dienstindeling/export`) alleen nog optioneel/technisch.
 */
export async function GET(request: Request): Promise<NextResponse> {
  return metSessieUitVerzoek(request, () => exporteer(request));
}

async function exporteer(request: Request): Promise<NextResponse> {
  try {
    const actor = await requirePermission(PERMISSIONS.ASSIGNMENT_EXPORT);
    const scope = await locationScopeFor(actor, null);

    const raw = new URL(request.url).searchParams.get("datum");
    const parsed = z.iso.date().safeParse(raw ?? toCalendarDate(new Date()));
    if (!parsed.success) {
      return NextResponse.json({ error: "Ongeldige datum." }, { status: 400 });
    }
    const date = parsed.data;

    const bytes = await buildDagplanningWorkbook(date, scope.code);

    await recordAudit({
      actor,
      action: "dagplanning.geexporteerd",
      objectType: "ScheduledDuty",
      newValue: { datum: date, formaat: "xlsx" },
    });

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="dagplanning-${scope.code}-${date}.xlsx"`,
        "Cache-Control": "no-store, private",
      },
    });
  } catch (error) {
    const publicError = toPublicError(error);
    if (publicError.status === 500) {
      console.error("[export dagplanning xlsx] mislukt", error);
    }
    return NextResponse.json({ error: publicError.message }, { status: publicError.status });
  }
}
