import "server-only";
import { currentActor } from "@/server/auth/session";
import { upcomingWeeks } from "@/server/services/roster-membership-service";
import { currentAndNextRule } from "@/server/services/roster-transfer-service";
import { Alert, Badge, EmptyState, WidgetCard } from "@/components/ui/primitives";
import { GridIcon } from "@/components/ui/icons";

/**
 * Waar sta ik in mijn rooster?
 *
 * ## Waarom deze kaart bestaat
 *
 * Een machinist weet dat hij in Laat 1-LA zit, maar niet uit zijn hoofd op welke
 * regel hij deze week staat — en dat is precies wat bepaalt welke diensten hij
 * rijdt. Die twee getallen, deze week en volgende week, zijn het antwoord op de
 * vraag waarmee de meeste mensen hun rooster openen.
 *
 * ## Waarom er geen andere namen op staan
 *
 * Wie er verder op welke regel staat, gaat een medewerker niet aan. Deze kaart
 * toont uitsluitend de eigen positie.
 */
export async function MijnBasisroosterCard() {
  const actor = await currentActor();
  if (!actor) {
    return null;
  }

  const [positie, weken] = await Promise.all([
    currentAndNextRule(actor.employeeId),
    upcomingWeeks(actor.employeeId, 6),
  ]);

  return (
    <WidgetCard
      icon={<GridIcon size={18} />}
      tone="info"
      title="Mijn basisrooster"
      subtitle={positie ? `${positie.rosterCode} — ${positie.rosterName}` : "Nog niet gekoppeld"}
    >
      {!positie ? (
        <EmptyState>
          U bent nog niet aan een basisrooster gekoppeld. Neem contact op met de dienstindeling.
        </EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded border border-line p-2">
              <span className="block text-lg font-semibold tabular">
                regel {positie.currentRule}
              </span>
              <span className="text-[11px] text-ink-muted">deze week</span>
            </div>
            <div className="rounded border border-line p-2">
              <span className="block text-lg font-semibold tabular">
                regel {positie.nextRule}
              </span>
              <span className="text-[11px] text-ink-muted">volgende week</span>
            </div>
          </div>

          {positie.placementType === "TEMPORARY" && (
            <div className="mt-3">
              <Alert tone="warn" title="Tijdelijk rooster actief">
                U volgt tijdelijk {positie.rosterCode}
                {positie.validUntil ? ` tot en met ${positie.validUntil}` : ""}. Daarna keert u
                terug naar uw basisrooster.
              </Alert>
            </div>
          )}

          <ul className="mt-3 space-y-1 text-[11.5px]">
            {weken.map((week) => (
              <li key={week.week} className="flex items-center justify-between gap-2">
                <span className="text-ink-muted">
                  {week.week} · vanaf {week.monday}
                </span>
                <span className="flex items-center gap-2">
                  {week.temporary && <Badge tone="warn">tijdelijk</Badge>}
                  <span className="font-mono">{week.rosterCode}</span>
                  <span className="tabular font-semibold">regel {week.ruleIndex}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-ink-muted">
            De regel schuift elke week één op en begint na de laatste regel weer bij regel 1.
          </p>
        </>
      )}
    </WidgetCard>
  );
}
