import { NextResponse } from "next/server";
import { metSessieUitVerzoek } from "@/server/auth/session";
import { currentActor } from "@/server/auth/session";
import { recentActivity, recoverStaleActivities } from "@/server/agent/activity";
import { currentGrant, levelOf } from "@/server/agent/capabilities";
import { toPublicError } from "@/server/security/authorize";
import { actorHasPermission } from "@/server/security/authorize";
import { PERMISSIONS } from "@/server/security/permissions";
import { locationScopeFor } from "@/server/security/location-scope";
import { activeGenerationRun, runJson } from "@/server/services/generation-service";

export const dynamic = "force-dynamic";

/**
 * De stand van zaken voor het activiteitenpaneel.
 *
 * Een gewoon GET-verzoek, net als de voortgang van een generatieopdracht: het
 * paneel vraagt dit elke paar seconden op, en server actions van één tabblad
 * worden achter elkaar afgehandeld — een stopknop zou dan moeten wachten op de
 * vorige peiling.
 *
 * Elke peiling kijkt eerst of er activiteiten zijn blijven hangen. Zo begint
 * het paneel na een herstart niet met "bezig" terwijl er niemand meer rekent.
 */
export async function GET(request: Request): Promise<NextResponse> {
  return metSessieUitVerzoek(request, async () => {
    try {
      const actor = await currentActor();
      if (!actor || !actorHasPermission(actor, PERMISSIONS.AGENT_CHAT)) {
        return NextResponse.json({ error: "Geen toegang tot de roosteragent." }, { status: 403 });
      }
      const gevraagd = new URL(request.url).searchParams.get("standplaats");
      const scope = await locationScopeFor(actor, gevraagd);
      const onderbroken = await recoverStaleActivities(scope.code);

      const [grant, activiteiten] = await Promise.all([currentGrant(scope.code), recentActivity(scope.code)]);
      // De lopende generatieopdracht hoort in hetzelfde paneel: dat is werk dat
      // draait, ongeacht wie het heeft gestart.
      const run = actorHasPermission(actor, PERMISSIONS.ROSTER_GENERATE) ? await activeGenerationRun() : null;

      return NextResponse.json(
        {
          locationCode: scope.code,
          level: levelOf(grant),
          suspended: grant.suspendedAt !== null,
          suspendReason: grant.suspendReason,
          maySteer: actorHasPermission(actor, PERMISSIONS.AGENT_STOP),
          recoveredCount: onderbroken,
          activities: activiteiten,
          run: run ? runJson(run) : null,
        },
        { headers: { "Cache-Control": "no-store, private" } },
      );
    } catch (error) {
      const publicError = toPublicError(error);
      if (publicError.status === 500) {
        console.error("[agent] activiteit lezen mislukt", error);
      }
      return NextResponse.json({ error: publicError.message }, { status: publicError.status });
    }
  });
}
