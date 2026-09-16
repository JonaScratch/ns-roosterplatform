import { NextResponse } from "next/server";
import { z } from "zod";
import { exportVersionCsv } from "@/server/services/roster-service";
import { toPublicError } from "@/server/security/authorize";
import { metSessieUitVerzoek } from "@/server/auth/session";

/**
 * Nooit vooraf uitrekenen: zie de toelichting in
 * `roostercommissie/pakketten/sjabloon/route.ts`. Een route die zonder verzoek
 * wordt uitgevoerd, heeft geen sessie, en het antwoord dat daaruit komt is de
 * toegangsfout — voor iedereen.
 */
export const dynamic = "force-dynamic";

/**
 * Roosterexport als download.
 *
 * Een route handler in plaats van een server action, omdat de uitkomst een
 * bestand is en geen paginastatus.
 *
 * De rechtencontrole zit in `exportVersionCsv`, niet hier. Dat is het patroon
 * door de hele applicatie: het eindpunt is een doorgeefluik, de service beslist.
 * Een tweede eindpunt naar dezelfde service erft daardoor vanzelf dezelfde
 * controle, en het spoor in het auditlog ook.
 */
export async function GET(
  request: Request,
  context: RouteContext<"/roostercommissie/export/[versionId]">,
): Promise<NextResponse> {
  return metSessieUitVerzoek(request, () => exporteer(context));
}

async function exporteer(
  context: RouteContext<"/roostercommissie/export/[versionId]">,
): Promise<NextResponse> {
  const { versionId } = await context.params;

  const parsed = z.uuid().safeParse(versionId);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ongeldige verwijzing." }, { status: 400 });
  }

  try {
    const file = await exportVersionCsv(parsed.data);
    return new NextResponse(file.content, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        // Een export met roostergegevens hoort nergens onderweg te blijven
        // hangen.
        "Cache-Control": "no-store, private",
      },
    });
  } catch (error) {
    const publicError = toPublicError(error);
    if (publicError.status === 500) {
      console.error("[export] mislukt", error);
    }
    return NextResponse.json({ error: publicError.message }, { status: publicError.status });
  }
}
