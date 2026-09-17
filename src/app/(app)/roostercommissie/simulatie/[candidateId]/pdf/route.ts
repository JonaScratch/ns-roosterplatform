import { NextResponse } from "next/server";
import { z } from "zod";
import { metSessieUitVerzoek } from "@/server/auth/session";
import { toPublicError } from "@/server/security/authorize";
import { exportCandidatePackagePdf } from "@/server/services/roster-sheet-service";

/** Zie `pakketten/sjabloon/route.ts`: nooit vooraf uitrekenen. */
export const dynamic = "force-dynamic";

/**
 * Alle basisroosters van een kandidaat als één PDF.
 *
 * Dezelfde bladen als per rooster via het roosterblad, met de
 * simulatiestempel. Als download: wie "Alle basisroosters exporteren" kiest,
 * wil een bestand, geen voorvertoning.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ candidateId: string }> },
): Promise<NextResponse> {
  return metSessieUitVerzoek(request, async () => {
    const { candidateId } = await context.params;
    const id = z.uuid().safeParse(candidateId);
    if (!id.success) {
      return NextResponse.json({ error: "Ongeldige kandidaatverwijzing." }, { status: 400 });
    }
    try {
      const pdf = await exportCandidatePackagePdf(id.data);
      return new NextResponse(new Uint8Array(pdf.bytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${pdf.filename}"`,
          "Cache-Control": "no-store, private",
        },
      });
    } catch (error) {
      const publicError = toPublicError(error);
      return NextResponse.json({ error: publicError.message }, { status: publicError.status });
    }
  });
}
