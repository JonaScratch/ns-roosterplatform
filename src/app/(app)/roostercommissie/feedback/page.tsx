import { feedbackReport } from "@/server/services/feedback-service";
import { RosterCommitteeShell } from "@/components/layout/area-shell";
import { Alert, Badge, EmptyState, WidgetCard } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

/**
 * Geaggregeerde medewerkerfeedback.
 *
 * Er is geen knop om door te klikken naar individuele antwoorden, en geen
 * parameter die ze zou opleveren. Dat is geen ontbrekende functie: de service
 * die deze pagina vult, haalt geen enkele verwijzing naar een medewerker op.
 */
export default async function FeedbackOverzicht({ searchParams }: PageProps<"/roostercommissie/feedback">) {
  const params = await searchParams;
  const quarter = typeof params.kwartaal === "string" ? params.kwartaal : undefined;
  const report = await feedbackReport(quarter);

  return (
    <RosterCommitteeShell
      activeHref="/roostercommissie/feedback"
      header={{
        title: `Feedback ${report.quarterKey}`,
        subtitle:
          "Samengevat per roosterprofiel — individuele antwoorden zijn voor niemand zichtbaar",
        context: (
          <form className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5">
            <label className="sr-only" htmlFor="kwartaal">
              Kwartaal
            </label>
            <input
              id="kwartaal"
              name="kwartaal"
              defaultValue={report.quarterKey}
              placeholder="2026-Q3"
              className="w-24 bg-transparent text-[12.5px] font-medium text-ink outline-none"
            />
            <button type="submit" className="text-[12px] font-semibold text-accent-rc">
              Tonen
            </button>
          </form>
        ),
      }}
    >

      {report.suppressedProfiles > 0 && (
        <div className="mb-4">
          <Alert tone="neutral" title="Niet alles wordt getoond">
            {report.suppressedProfiles === 1
              ? "Eén roosterprofiel is weggelaten"
              : `${report.suppressedProfiles} roosterprofielen zijn weggelaten`}{" "}
            omdat er minder dan {report.minimumCohort} antwoorden waren. Bij zulke aantallen is
            een percentage in de praktijk herleidbaar tot personen.
          </Alert>
        </div>
      )}

      {report.aggregates.length === 0 ? (
        <EmptyState>
          Voor {report.quarterKey} zijn geen resultaten te tonen die aan de privacydrempel
          voldoen.
        </EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {report.aggregates.map((aggregate) => (
            <WidgetCard
              key={aggregate.rosterProfile}
              title={aggregate.profileLabel}
              tone={aggregate.status === "VOLDOENDE" ? "neutral" : "warn"}
              subtitle={
                aggregate.status === "VOLDOENDE"
                  ? `${aggregate.respondents} respondenten · gemiddelde tevredenheid ` +
                    `${aggregate.averageSatisfaction!.toFixed(1)} van 5`
                  : aggregate.status === "GEEN_RESPONS"
                    ? "Geen respons"
                    : "Onvoldoende respons"
              }
            >
              {aggregate.status !== "VOLDOENDE" && (
                <p className="text-[12px] leading-relaxed text-ink-muted">
                  {aggregate.status === "GEEN_RESPONS"
                    ? "Voor dit rooster is dit kwartaal geen enkele reactie binnengekomen. " +
                      "Dat is geen uitkomst over het rooster maar over de uitvraag."
                    : `Er zijn wel reacties, maar minder dan ${report.minimumCohort}. Bij zulke ` +
                      "kleine aantallen is een percentage hetzelfde als namen noemen, dus er " +
                      "worden geen cijfers getoond — ook het aantal niet."}
                </p>
              )}
              <ul className="space-y-2">
                {aggregate.categories.map((category) => (
                  <li key={category.category}>
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                      <span>{category.label}</span>
                      <span className="tabular font-semibold">
                        {Math.round(category.share * 100)}%
                      </span>
                    </div>
                    <div
                      className="mt-1 h-1.5 w-full rounded bg-canvas"
                      role="img"
                      aria-label={`${Math.round(category.share * 100)} procent`}
                    >
                      <div
                        className="h-1.5 rounded bg-ns-blue"
                        style={{ width: `${Math.round(category.share * 100)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </WidgetCard>
          ))}
        </div>
      )}

      <div className="mt-4">
        <Alert tone="info" title="Hoe deze cijfers doorwerken">
          De percentages gaan als geaggregeerd signaal mee in de generatieopdracht aan de
          rooster-engine, onder de doelstelling{" "}
          <span className="font-mono text-[11px]">objective.medewerkerfeedback</span>. Ze sturen
          de verdeling; ze zijn geen harde eis en overrulen geen enkele constraint.{" "}
          <Badge tone="ok">Alleen aantallen</Badge>
        </Alert>
      </div>
    </RosterCommitteeShell>
  );
}
