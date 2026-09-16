import { dutyPackageTemplate } from "@/server/services/duty-package-service";
import { toPublicError } from "@/server/security/authorize";
import { metSessieUitVerzoek } from "@/server/auth/session";

/**
 * Nooit vooraf uitrekenen.
 *
 * Zonder deze regel voert Next deze route bij het maken van de productiebundel
 * alvast één keer uit — zonder verzoek, en dus zonder sessie. Wat er dan
 * uitkomt is de foutpagina van de toegangscontrole, en juist die wordt daarna
 * aan iedereen teruggegeven. Op de ontwikkelserver viel dat nergens op, want
 * die bouwt elke route bij elk verzoek opnieuw; in de draagbare versie gaf elke
 * download een 500. Wat iemand mag downloaden hangt per definitie af van wie
 * het vraagt, dus vooraf uitrekenen kan hier nooit goed gaan.
 */
export const dynamic = "force-dynamic";

/**
 * Het Excel-sjabloon downloaden.
 *
 * Een route en geen server action: dit levert een bestand op, en dat hoort een
 * gewoon verzoek te zijn dat de browser zelf kan opslaan.
 */
export async function GET(request: Request): Promise<Response> {
  return metSessieUitVerzoek(request, () => sjabloon(request));
}

async function sjabloon(request: Request): Promise<Response> {
  const parameters = new URL(request.url).searchParams;
  const standplaats = parameters.get("standplaats") ?? "";
  const dienstregeling = parameters.get("dienstregeling") ?? "HUIDIG";

  if (!/^[A-Za-z]{2,5}$/.test(standplaats)) {
    return new Response("Geef een standplaatscode op.", { status: 400 });
  }

  try {
    const sjabloon = await dutyPackageTemplate({
      locationCode: standplaats,
      timetableId: dienstregeling,
    });
    return new Response(new Uint8Array(sjabloon.bytes), {
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${sjabloon.filename}"`,
        // Een sjabloon met de huidige diensten erin is momentopname; een
        // bewaarde kopie in een tussenliggende cache zou een oud pakket
        // teruggeven en het verschil daarna verkeerd laten uitpakken.
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const publiek = toPublicError(error);
    return new Response(publiek.message, { status: publiek.status });
  }
}
