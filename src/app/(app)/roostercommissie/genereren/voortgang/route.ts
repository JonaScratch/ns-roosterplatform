import { NextResponse } from "next/server";
import { z } from "zod";
import { metSessieUitVerzoek } from "@/server/auth/session";
import { toPublicError } from "@/server/security/authorize";
import { activeGenerationRun, generationRun, runJson } from "@/server/services/generation-service";

/** Zie `pakketten/sjabloon/route.ts`: wat iemand mag zien, hangt af van wie het vraagt. */
export const dynamic = "force-dynamic";

/**
 * De stand van een generatieopdracht, voor het scherm dat hem volgt.
 *
 * Een gewoon GET-verzoek en geen server action: het scherm vraagt dit elke
 * paar seconden op, en server actions van één tabblad worden achter elkaar
 * afgehandeld. Een stopknop moest dan wachten tot de vorige peiling klaar was.
 *
 * Zonder `?run=` komt de lopende opdracht van de standplaats terug, of `null`.
 * Zo vindt een ververst scherm zijn opdracht terug zonder iets te onthouden.
 */
export async function GET(request: Request): Promise<NextResponse> {
  return metSessieUitVerzoek(request, async () => {
    const gevraagd = new URL(request.url).searchParams.get("run");
    try {
      if (gevraagd === null) {
        const actief = await activeGenerationRun();
        return antwoord({ run: actief ? runJson(actief) : null });
      }
      const id = z.uuid().safeParse(gevraagd);
      if (!id.success) {
        return NextResponse.json({ error: "Ongeldige opdrachtverwijzing." }, { status: 400 });
      }
      return antwoord({ run: runJson(await generationRun(id.data)) });
    } catch (error) {
      const publicError = toPublicError(error);
      if (publicError.status === 500) {
        console.error("[generatie] voortgang lezen mislukt", error);
      }
      return NextResponse.json({ error: publicError.message }, { status: publicError.status });
    }
  });
}

function antwoord(body: unknown): NextResponse {
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store, private" } });
}
