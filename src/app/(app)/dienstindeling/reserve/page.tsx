import { formatCalendarDate, formatMinuteOfDay, toCalendarDate } from "@/domain/time";
import { dayPlan, reserveProposals } from "@/server/services/duty-assignment-service";
import { DutyAssignmentShell } from "@/components/layout/area-shell";
import { ActionForm } from "@/components/ui/action-form";
import { Alert, EmptyState, Meter, WidgetCard } from "@/components/ui/primitives";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";
import { UsersIcon } from "@/components/ui/icons";
import { reserveInvullenAction } from "../acties";

export const dynamic = "force-dynamic";

/**
 * Het reserve-overzicht.
 *
 * Links wie er vandaag op een RES-positie staat, rechts wat het systeem met die
 * mensen zou doen en waarom. De reden staat er altijd bij: een planner die een
 * voorstel overneemt, moet weten waar hij voor tekent.
 *
 * De reservevoorkeur stuurt de rangschikking maar sluit niemand uit. Een
 * medewerker met voorkeur "vroeg" kan dus een late dienst krijgen — alleen pas
 * nadat iemand met de passende voorkeur is langsgekomen.
 */
export default async function ReserveOverzicht({
  searchParams,
}: PageProps<"/dienstindeling/reserve">) {
  const params = await searchParams;
  const date = typeof params.datum === "string" ? params.datum : toCalendarDate(new Date());

  const [plan, proposals] = await Promise.all([dayPlan(date), reserveProposals(10)]);
  const reserves = plan.filter((row) => row.positionType === "RES");

  return (
    <DutyAssignmentShell
      activeHref="/dienstindeling/reserve"
      header={{
        title: "Reserve-overzicht",
        subtitle: `${reserves.length} medewerkers op een RES-positie op ${formatCalendarDate(date)}`,
      }}
    >
      <div className="grid gap-4 xl:grid-cols-2">
        <WidgetCard
          icon={<UsersIcon size={18} />}
          tone="did"
          title="Reserve vandaag"
          subtitle="Medewerkers met een RES-positie"
        >
          {reserves.length === 0 ? (
            <div className="py-3">
              <EmptyState>Niemand staat vandaag op een RES-positie.</EmptyState>
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Personeelsnr.</TH>
                  <TH>Roosterprofiel</TH>
                  <TH>Herkomst</TH>
                </TR>
              </THead>
              <tbody>
                {reserves.map((row) => (
                  <TR key={row.employeeNumber}>
                    <TD>
                      <span className="tabular font-semibold">{row.employeeNumber}</span>
                    </TD>
                    <TD>{row.rosterProfile}</TD>
                    <TD>
                      <span className="text-[11.5px] text-ink-muted">{row.source}</span>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </WidgetCard>

        <WidgetCard
          icon={<UsersIcon size={18} />}
          tone="rc"
          title="Inzetvoorstellen"
          subtitle="Automatisch, met de onderbouwing erbij"
        >
          {proposals.length === 0 ? (
            <div className="py-3">
              <EmptyState>Er ligt niets bij het reserve-rooster.</EmptyState>
            </div>
          ) : (
            proposals.map((proposal) => (
              <div
                key={proposal.availableDutyId}
                className="border-b border-line/70 py-3 last:border-0"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="tabular text-[13px] font-semibold text-ink-strong">
                    {proposal.dutyCode}
                  </span>
                  <span className="text-[11.5px] text-ink-muted">
                    {formatCalendarDate(proposal.date)} ·{" "}
                    {formatMinuteOfDay(proposal.startMinute)} –{" "}
                    {formatMinuteOfDay(proposal.endMinute)}
                  </span>
                </div>

                {proposal.bestMatch ? (
                  <>
                    <p className="mt-1 text-[12.5px]">
                      <span className="tabular font-semibold">
                        {proposal.bestMatch.employeeNumber}
                      </span>{" "}
                      <span className="text-ink-muted">
                        — {proposal.bestMatch.preferenceLabel.toLowerCase()}, aansluiting{" "}
                        {Math.round(proposal.bestMatch.preferenceFit * 100)}%
                      </span>
                    </p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <Meter value={proposal.bestMatch.score} tone="did" />
                      <span className="tabular w-9 text-right text-[11px] text-ink-muted">
                        {Math.round(proposal.bestMatch.score * 100)}%
                      </span>
                    </div>
                    <p className="mt-1 text-[11.5px] text-ink-muted">
                      {proposal.bestMatch.explanation}
                    </p>
                    <div className="mt-2">
                      <ActionForm action={reserveInvullenAction} submitLabel="Toewijzen" compact>
                        <input
                          type="hidden"
                          name="availableDutyId"
                          value={proposal.availableDutyId}
                        />
                      </ActionForm>
                    </div>
                  </>
                ) : (
                  <p className="mt-1 text-[12px] text-state-warn">
                    Geen geldige reservekandidaat. Deze dienst kan worden opengesteld voor
                    medewerkers.
                  </p>
                )}
              </div>
            ))
          )}
        </WidgetCard>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Alert tone="info" title="Hoe de rangschikking werkt">
          Eerst vallen alle kandidaten af die op een harde regel stuiten: rust vóór en na,
          roosterprofiel, bevoegdheden, reeksen. Van wie overblijft, weegt de score de
          rustkwaliteit en de opgegeven voorkeur mee. De voorkeur kan een geldige kandidaat nooit
          onder een ongeldige duwen.
        </Alert>
        <Alert tone="neutral" title="Wat er nog niet in zit">
          Het eerlijk verdelen van aantrekkelijke en onaantrekkelijke diensten over een langere
          periode. Dat vraagt een maat over het hele rooster en hoort bij de optimizer, waar alle
          roosters tegelijk in beeld zijn.
        </Alert>
      </div>
    </DutyAssignmentShell>
  );
}
