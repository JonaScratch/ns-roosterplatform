import Link from "next/link";
import {
  type CandidateStatusKey,
  MAX_COMPARED,
  resultsOverview,
} from "@/server/services/candidate-results-service";
import { RosterCommitteeShell } from "@/components/layout/area-shell";
import { ActionForm } from "@/components/ui/action-form";
import { Alert, Badge, EmptyState, type Tone, WidgetCard, inputClass } from "@/components/ui/primitives";
import { CompareIcon, ShieldIcon, SparkIcon } from "@/components/ui/icons";
import { valideerKandidaatAction } from "./acties";
import { KandidaatKaart, datumTijd, scoreTekst } from "./onderdelen";

export const dynamic = "force-dynamic";

/**
 * Scenario's vergelijken: de resultaten van generatieopdrachten.
 *
 * ## Waarom hier geen generatieknop staat
 *
 * Genereren is een opdracht van minuten met een eigen scherm en een eigen
 * voortgang. Hier staat wat eruit kwam: per opdracht de kandidaten, elk als
 * compleet pakket van alle basisroosters, om te openen, te vergelijken en zo
 * nodig gericht opnieuw te laten bouwen.
 *
 * ## Waarom er geen winnaar wordt aangewezen
 *
 * Welke verdeling het best past, is een afweging van de Roostercommissie. Het
 * scherm zet de cijfers naast elkaar en zegt hooguit welke kandidaat op één
 * maat het hoogst scoort. Een "beste rooster" bestaat hier niet.
 */
export default async function Simulatie({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const tekst = (waarde: string | string[] | undefined) => (typeof waarde === "string" && waarde !== "" ? waarde : null);
  const strategie = tekst(params.strategie);
  const jaar = tekst(params.jaar) ? Number(params.jaar) : null;
  const status = tekst(params.status) as CandidateStatusKey | null;
  const archief = params.archief === "1";
  const uitgelicht = tekst(params.run);

  const overzicht = await resultsOverview({
    strategy: strategie,
    rosterYear: jaar && Number.isInteger(jaar) ? jaar : null,
    status: status && ["GEREED", "NIET_BRUIKBAAR", "NIET_GETOETST", "VEROUDERD"].includes(status) ? status : null,
    archived: archief,
  });
  const gefilterd = Boolean(strategie || jaar || status);
  const aantalKandidaten =
    overzicht.runs.reduce((som, groep) => som + groep.candidates.length, 0) + overzicht.legacy.length;

  return (
    <RosterCommitteeShell
      activeHref="/roostercommissie/simulatie"
      header={{
        title: "Scenario's vergelijken",
        subtitle: "De uitkomst van generatieopdrachten: openen, vergelijken, opnieuw bouwen",
      }}
    >
      <div className="grid gap-4 xl:grid-cols-4">
        <div className="space-y-4 xl:col-span-3">
          <WidgetCard
            icon={<CompareIcon size={18} />}
            tone="rc"
            title={archief ? "Archief" : "Resultaten"}
            subtitle={
              archief
                ? "Gearchiveerde kandidaten. Ze blijven bewaard en zijn terug te zetten."
                : `${aantalKandidaten} ${aantalKandidaten === 1 ? "kandidaat" : "kandidaten"}${gefilterd ? " die aan het filter voldoen" : ""}`
            }
            actions={
              <Link
                href="/roostercommissie/genereren"
                className="inline-flex items-center gap-1.5 rounded-lg border border-accent-rc/40 px-3 py-1.5 text-[12px] font-semibold text-accent-rc hover:bg-accent-rc-soft"
              >
                <SparkIcon size={14} aria-hidden />
                Nieuwe generatie
              </Link>
            }
            bodyClassName="border-t border-line p-4"
          >
            <form method="get" className="flex flex-wrap items-end gap-2">
              {archief ? <input type="hidden" name="archief" value="1" /> : null}
              <Keuze label="Strategie" name="strategie" waarde={strategie}>
                <option value="">Alle strategieën</option>
                {overzicht.strategies.map((entry) => (
                  <option key={entry.key} value={entry.key}>
                    {entry.label}
                  </option>
                ))}
              </Keuze>
              <Keuze label="Roosterjaar" name="jaar" waarde={jaar ? String(jaar) : null}>
                <option value="">Alle jaren</option>
                {overzicht.years.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </Keuze>
              <Keuze label="Status" name="status" waarde={status}>
                <option value="">Alle statussen</option>
                <option value="GEREED">Gereed</option>
                <option value="VEROUDERD">Verouderd</option>
                <option value="NIET_BRUIKBAAR">Niet bruikbaar</option>
                <option value="NIET_GETOETST">Nog niet getoetst</option>
              </Keuze>
              <button
                type="submit"
                className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-[12.5px] font-semibold hover:bg-canvas"
              >
                Filteren
              </button>
              {gefilterd ? (
                <Link
                  href={archief ? "/roostercommissie/simulatie?archief=1" : "/roostercommissie/simulatie"}
                  className="px-1 py-1.5 text-[12px] text-ink-muted underline"
                >
                  Filter wissen
                </Link>
              ) : null}
              <span className="ml-auto text-[12px]">
                {archief ? (
                  <Link href="/roostercommissie/simulatie" className="font-semibold text-accent-rc hover:underline">
                    ← Terug naar de resultaten
                  </Link>
                ) : (
                  <Link href="/roostercommissie/simulatie?archief=1" className="text-ink-muted hover:underline">
                    Archief ({overzicht.archivedCount})
                  </Link>
                )}
              </span>
            </form>

            {!archief ? (
              <form
                id={VERGELIJK_FORM}
                method="get"
                action="/roostercommissie/simulatie/vergelijken"
                className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-canvas px-3 py-2"
              >
                <button
                  type="submit"
                  className="rounded-lg bg-accent-rc px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-ns-blue"
                >
                  Geselecteerde vergelijken
                </button>
                <span className="text-[11.5px] text-ink-muted">
                  Vink bij twee of drie kandidaten &quot;Vergelijken&quot; aan. Bij meer dan{" "}
                  {MAX_COMPARED} worden de eerste {MAX_COMPARED} getoond.
                </span>
              </form>
            ) : null}
          </WidgetCard>

          {overzicht.runs.length === 0 && overzicht.legacy.length === 0 ? (
            <WidgetCard title={archief ? "Archief is leeg" : "Nog geen resultaten"}>
              <div className="py-3">
                <EmptyState>
                  {archief
                    ? "Er zijn geen gearchiveerde kandidaten."
                    : gefilterd
                      ? "Geen kandidaten die aan dit filter voldoen."
                      : "Er is nog geen generatie uitgevoerd. Start een opdracht onder Genereren & simulatie."}
                </EmptyState>
              </div>
            </WidgetCard>
          ) : null}

          {overzicht.runs.map(({ run, candidates }) => (
            <section
              key={run.id}
              id={`run-${run.id}`}
              className={`rounded-xl border bg-surface ${
                uitgelicht === run.id ? "border-accent-rc ring-1 ring-accent-rc/30" : "border-line"
              }`}
            >
              <header className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <h2 className="text-[15px] font-semibold text-ink-strong">
                    {run.kind === "REBUILD" ? `Herbouw — ${run.parent?.label ?? run.strategyLabel}` : run.strategyLabel}
                  </h2>
                  <p className="text-[12px] text-ink-muted">
                    Roosterjaar {run.rosterYear} ({run.periodLabel}) · gestart {datumTijd(run.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="tabular text-[12px] text-ink-muted">
                    {run.found} van {run.requested} {run.requested === 1 ? "kandidaat" : "kandidaten"}
                  </span>
                  <Badge tone={run.statusTone as Tone}>{run.statusLabel}</Badge>
                </div>
              </header>

              {run.goals.length > 0 || run.note ? (
                <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-4 py-2 text-[11.5px]">
                  <span className="text-ink-muted">Verbeteren op:</span>
                  {run.goals.map((goal) => (
                    <Badge key={goal} tone="rc">
                      {goal}
                    </Badge>
                  ))}
                  {run.note ? <span className="text-ink-muted">· Opmerking: “{run.note}”</span> : null}
                </div>
              ) : null}

              {run.active ? (
                <div className="border-t border-line px-4 py-3">
                  <Alert tone="info" title="Deze opdracht loopt nog.">
                    {run.stageMessage}{" "}
                    <Link href="/roostercommissie/genereren" className="font-semibold underline">
                      Voortgang volgen
                    </Link>
                  </Alert>
                </div>
              ) : run.status !== "COMPLETED" && (run.failureReason || run.stageMessage) ? (
                <div className="border-t border-line px-4 py-3">
                  <Alert tone={run.status === "FAILED" ? "error" : run.status === "CANCELLED" ? "neutral" : "warn"}>
                    {run.failureReason ?? run.stageMessage}
                  </Alert>
                </div>
              ) : null}

              {candidates.length > 0 ? (
                <div className="grid gap-3 border-t border-line p-4 md:grid-cols-2 2xl:grid-cols-3">
                  {candidates.map((kaart) => (
                    <KandidaatKaart key={kaart.id} kaart={kaart} vergelijkForm={archief ? undefined : VERGELIJK_FORM} />
                  ))}
                </div>
              ) : null}
            </section>
          ))}

          {overzicht.legacy.length > 0 ? (
            <details className="rounded-xl border border-line bg-surface" open={archief || gefilterd}>
              <summary className="cursor-pointer px-4 py-3 text-[14px] font-semibold text-ink-strong">
                Legacy kandidaten ({overzicht.legacy.length})
                <span className="block text-[12px] font-normal text-ink-muted">
                  Gemaakt vóór de generatieopdrachten in versie 1.0.3: zonder opdracht, roosterjaar of
                  kandidaatnummer. Ze blijven te openen en te vergelijken.
                </span>
              </summary>
              <div className="grid gap-3 border-t border-line p-4 md:grid-cols-2 2xl:grid-cols-3">
                {overzicht.legacy.map((kaart) => (
                  <KandidaatKaart
                    key={kaart.id}
                    kaart={kaart}
                    vergelijkForm={archief ? undefined : VERGELIJK_FORM}
                    extra={
                      kaart.status === "NIET_GETOETST" ? (
                        <ActionForm
                          action={valideerKandidaatAction}
                          submitLabel="Valideren"
                          pendingLabel="Valideren…"
                          variant="secondary"
                          compact
                        >
                          <input type="hidden" name="candidateId" value={kaart.id} />
                        </ActionForm>
                      ) : null
                    }
                  />
                ))}
              </div>
            </details>
          ) : null}
        </div>

        <div className="space-y-4">
          <WidgetCard tone="neutral" title="Huidig rooster als ijkpunt" bodyClassName="border-t border-line px-4 py-2">
            <p className="py-1 text-[11.5px] text-ink-muted">
              Dezelfde meting op het rooster dat nu draait. Roosterkwaliteit gaat over comfort en
              regelmaat, niet over rechtmatigheid.
            </p>
            <dl className="divide-y divide-line/70 text-[12px]">
              {IJKPUNT.map(([sleutel, label, eenheid]) => (
                <div key={sleutel} className="flex items-center justify-between gap-2 py-1.5">
                  <dt className="text-ink">{label}</dt>
                  <dd className="tabular font-semibold text-ink">{scoreTekst(overzicht.official[sleutel], eenheid)}</dd>
                </div>
              ))}
            </dl>
          </WidgetCard>

          <WidgetCard
            icon={<ShieldIcon size={18} />}
            tone="neutral"
            title="Publiceren"
            bodyClassName="border-t border-line p-4"
          >
            <p className="text-[12px] leading-relaxed text-ink">
              Een kandidaat kan worden geopend, vergeleken, herbouwd en als voorkeurskandidaat
              gemarkeerd, maar nog niet formeel worden gepubliceerd.
            </p>
            <p className="mt-2 text-[11.5px] leading-relaxed text-ink-muted">
              De formele regelvalidatie is niet voltooid: de aangeleverde CAO is niet bevestigd als
              actueel, en er ontbreken regelpakketten. Zolang dat zo is, bestaat er geen
              publicatieknop.
            </p>
            <Link
              href="/beheer/regelbronnen"
              className="mt-3 inline-block text-[11.5px] font-semibold text-ns-blue underline"
            >
              Bekijk regelstatus
            </Link>
          </WidgetCard>
        </div>
      </div>
    </RosterCommitteeShell>
  );
}

/** De vinkjes staan in de kaarten; het formulier bovenaan. Zie het `form`-attribuut. */
const VERGELIJK_FORM = "kandidaten-vergelijken";

const IJKPUNT = [
  ["hoursBalance", "Urenbalans", ""],
  ["restQuality", "Rustkwaliteit", "%"],
  ["transitionQuality", "Overgangskwaliteit", "%"],
  ["nightClustering", "Nachtclustering", "%"],
  ["nightFairness", "Eerlijke nachtverdeling", ""],
  ["shuntingFairness", "Eerlijke rangeerverdeling", ""],
  ["weekendFairness", "Eerlijke weekendbelasting", ""],
] as const;

function Keuze({
  label,
  name,
  waarde,
  children,
}: {
  label: string;
  name: string;
  waarde: string | null;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[11px] text-ink-muted">{label}</span>
      <select name={name} defaultValue={waarde ?? ""} className={`${inputClass} min-w-[10rem]`}>
        {children}
      </select>
    </label>
  );
}
