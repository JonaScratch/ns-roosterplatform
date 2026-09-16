import Link from "next/link";
import {
  currentRosterYear,
  describeRosterYear,
  rosterYear,
  selectableRosterYears,
} from "@/domain/roster-year";
import { listBaseRosters } from "@/server/services/roster-service";
import { SCENARIOS } from "@/server/services/simulation-service";
import { RosterCommitteeShell } from "@/components/layout/area-shell";
import { ActionForm } from "@/components/ui/action-form";
import { Alert, Badge, EmptyState, WidgetCard, inputClass } from "@/components/ui/primitives";
import { SparkIcon, ShieldIcon } from "@/components/ui/icons";
import { genereerEnLegVastAction } from "./acties";

export const dynamic = "force-dynamic";

/**
 * Genereren en simuleren.
 *
 * ## Waarom hier geen basisroosterkeuze staat
 *
 * De opdracht neemt altijd álle basisroosters van de standplaats in één keer
 * mee — de optimizer bouwt zijn invoer zo (`buildOptimizerInput`), en dat is
 * met opzet: eerst het profiel Vroeg perfect vullen en de rest de overgebleven
 * diensten geven, benadeelt de andere roosters aantoonbaar. Een checkbox die
 * suggereert dat je er één apart kunt draaien, bestaat hier daarom niet meer —
 * hij deed voorheen ook niets, want de generator negeerde hem al.
 *
 * ## Waarom het roosterjaar een label is en geen tweede opdracht
 *
 * De roosterstructuur zelf is een cyclus, geen kalender: dezelfde dienstdagen
 * herhalen zich week na week, ongeacht welk jaar er ooit op wordt uitgerold.
 * Het roosterjaar hieronder verandert dus niets aan wát er wordt gegenereerd —
 * het bepaalt alleen onder welk label de uitkomst als roosterversie wordt
 * vastgelegd, zodat "Roosterjaar 2027" en "Roosterjaar 2028" naast elkaar
 * kunnen bestaan zonder elkaar te overschrijven.
 */
export default async function Genereren() {
  const rosters = await listBaseRosters();
  const jaren = selectableRosterYears();
  const huidig = currentRosterYear();
  const volgend = rosterYear(huidig.year + 1);

  return (
    <RosterCommitteeShell
      activeHref="/roostercommissie/genereren"
      header={{
        title: "Genereren & simulatie",
        subtitle: "Alle basisroosters gezamenlijk optimaliseren",
      }}
    >
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <WidgetCard
            icon={<SparkIcon size={18} />}
            tone="rc"
            title="Generatieopdracht"
            subtitle="Dienstenpakket + regels + roosterstructuur + geaggregeerde voorkeuren"
            bodyClassName="border-t border-line p-4"
          >
            {rosters.length === 0 ? (
              <EmptyState>Er zijn nog geen basisroosters om te genereren.</EmptyState>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-[12px] font-semibold text-ink">
                    Basisroosters in deze opdracht
                  </p>
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {rosters.map((roster) => (
                      <li key={roster.id}>
                        <Badge tone="neutral">
                          {roster.code} · {roster.profileLabel} · {roster.lines} lijnen
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </div>

                <ActionForm
                  action={genereerEnLegVastAction}
                  submitLabel="Genereren en valideren"
                  pendingLabel="Optimaliseren en valideren… (kan anderhalve minuut duren)"
                >
                  <fieldset className="space-y-1.5">
                    <legend className="text-[12px] font-semibold text-ink">Scenario</legend>
                    {SCENARIOS.map((scenario, index) => (
                      <label
                        key={scenario.key}
                        className="flex items-start gap-2 rounded-md border border-line p-2 text-[12.5px] text-ink"
                      >
                        <input
                          type="radio"
                          name="strategy"
                          value={scenario.key}
                          defaultChecked={index === 0}
                          className="mt-0.5"
                        />
                        <span>
                          <span className="block font-semibold">{scenario.label}</span>
                          <span className="block text-ink-muted">{scenario.description}</span>
                        </span>
                      </label>
                    ))}
                  </fieldset>

                  <div className="border-t border-line pt-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-[12px] font-semibold text-ink">
                        Roosterjaar (label voor de vastgelegde versie)
                      </span>
                      <select
                        name="rosterYear"
                        required
                        defaultValue={String(volgend.year)}
                        className={`${inputClass} max-w-[16rem]`}
                      >
                        {jaren.map((jaar) => (
                          <option key={jaar.year} value={jaar.year}>
                            {jaar.year}
                            {jaar.year === huidig.year ? " (lopend)" : ""}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="mt-2 rounded-lg border border-line bg-canvas px-3 py-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                        Periode wordt automatisch berekend
                      </p>
                      <ul className="mt-1 space-y-0.5 text-[12px] text-ink">
                        {jaren.map((jaar) => (
                          <li key={jaar.year}>
                            <span className="font-semibold tabular">{jaar.year}</span>
                            <span className="text-ink-muted">
                              {" "}
                              — {describeRosterYear(jaar)} ({jaar.weeks} weken)
                            </span>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
                        Een roosterjaar loopt van de tweede zondag van december tot de tweede
                        zondag van december daarna. De roosterjaren sluiten op elkaar aan: er zit
                        geen dag tussen en geen dag dubbel.
                      </p>
                    </div>
                  </div>
                </ActionForm>
              </div>
            )}
          </WidgetCard>
        </div>

        <div className="space-y-4">
          <Alert tone="info" title="Wat er echt gebeurt bij op de knop drukken">
            {/* Niet élk scenario gaat naar CP-SAT: de nulmeting en de
                rangeervariant worden door de eenvoudige optimizer gemaakt. Er
                stond hier één motor genoemd, en dat is onjuist zodra iemand op
                "Nulmeting" klikt. */}
            De opdracht gaat naar de optimizer — de CP-SAT-oplosser voor de scenario&apos;s
            A tot en met E, de eenvoudige variant voor de nulmeting en de rangeervariant —
            samen met alle actieve diensten, medewerkers en geaggregeerde feedback. Het
            resultaat wordt daarna onafhankelijk nagerekend door de eindvalidator, die de
            optimizer niet kent en zijn oordeel dus niet kan overnemen. Alleen een kandidaat
            die dat doorstaat én op een bevestigd regelbestand rust, wordt vastgelegd als
            roosterversie. Bij weigering of afwijzing verschijnt de exacte reden hieronder,
            nooit alleen &quot;geen rooster gegenereerd&quot;.
          </Alert>

          <WidgetCard
            icon={<ShieldIcon size={18} />}
            tone="neutral"
            title="Verder kijken"
            subtitle="Waar de uitkomst terechtkomt"
          >
            <ul className="space-y-2 text-[12.5px] text-ink">
              <li>
                <Link
                  href="/roostercommissie/simulatie"
                  className="font-semibold text-ns-blue underline"
                >
                  Scenario&apos;s vergelijken
                </Link>{" "}
                — elke gegenereerde kandidaat, met optimalisatiescore en validatie-oordeel.
              </li>
              <li>
                <Link
                  href="/roostercommissie/roosters"
                  className="font-semibold text-ns-blue underline"
                >
                  Basisroosters
                </Link>{" "}
                — de vastgelegde roosterversies per basisrooster, klaar om te vergelijken of te
                publiceren.
              </li>
            </ul>
          </WidgetCard>

          <Alert tone="neutral" title="Geen medewerker wordt voorgetrokken">
            Feedback gaat uitsluitend geaggregeerd per roosterprofiel mee. Individuele antwoorden
            bereiken de engine niet, en de engine kent geen namen — alleen personeelsnummers.{" "}
            <Badge tone="ok">Privacy by design</Badge>
          </Alert>
        </div>
      </div>
    </RosterCommitteeShell>
  );
}
