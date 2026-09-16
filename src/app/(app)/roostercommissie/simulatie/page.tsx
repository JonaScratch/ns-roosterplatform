import Link from "next/link";
import { formatClock, formatSpan, localDateOf, localMinuteOfDay } from "@/domain/amsterdam-time";
import {
  SCENARIOS,
  comparisonFor,
  listCandidates,
  rankStoredCandidates,
} from "@/server/services/simulation-service";
import {
  SCORE_EXPLANATION,
  type ScenarioComparison,
  compareScenarios,
} from "@/server/services/scenario-compare-service";
import { RosterCommitteeShell } from "@/components/layout/area-shell";
import { ActionForm } from "@/components/ui/action-form";
import { Alert, Badge, EmptyState, type Tone, WidgetCard } from "@/components/ui/primitives";
import { GenereerPaneel } from "./genereer-paneel";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";
import { SparkIcon, ShieldIcon } from "@/components/ui/icons";
import {
  genereerScenarioAction,
  valideerKandidaatAction,
  verwerpKandidaatAction,
} from "./acties";

export const dynamic = "force-dynamic";

/**
 * Scenario's vergelijken.
 *
 * ## Waarom dit scherm zo is opgebouwd
 *
 * Wie hier voor het eerst komt, weet niet wat een scenario is, waarom je er
 * meerdere maakt, of wat "Nulmeting" betekent. Het scherm begon daarom eerder
 * bij een tabel met kolomkoppen als `TECHNICALLY_VALIDATED` — begrijpelijk voor
 * wie de code kent en voor niemand anders. Nu staat de uitleg eerst, dan de
 * scenario's, dan de vergelijking.
 *
 * ## Waarom hier geen publicatieknop staat
 *
 * Niet uitgeschakeld — afwezig. Een uitgeschakelde knop nodigt uit om te zoeken
 * naar de voorwaarde die hem aanzet, en die voorwaarde is dan één regel code.
 * Zolang de actuele juridische bron niet is bevestigd, is de veiligste
 * publicatiecode geen publicatiecode. Wat er wél staat is de reden.
 */
export default async function Simulatie({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const selected = typeof params.kandidaat === "string" ? params.kandidaat : null;
  const gekozen = selectedIds(params.vergelijk);

  const [candidates, ranked] = await Promise.all([listCandidates(), rankStoredCandidates()]);
  // Een `?kandidaat=`-verwijzing kan naar een scenario wijzen dat er niet meer
  // is: verworpen, of uit een vorige vulling van de database. De analyse haalde
  // die dan alsnog op en liet de hele pagina omvallen op "Er is iets
  // misgegaan" met een foutcode — terwijl er niets kapot is. Er wordt daarom
  // eerst gekeken of het scenario in dit overzicht staat.
  const gevraagdeBestaat = selected !== null && candidates.some((entry) => entry.id === selected);
  const comparison = gevraagdeBestaat ? await comparisonFor(selected) : null;
  const verdwenenScenario = selected !== null && !gevraagdeBestaat;
  const rankByCandidate = new Map(ranked.map((entry) => [entry.candidateId, entry]));

  // Ook een nog niet getoetst scenario mag mee in de vergelijking: score,
  // plaatsing en urenbalans zijn dan al berekend, en de kolom "bevestigde
  // overtredingen" zegt eerlijk "nog niet getoetst". Wat er niet in mag, is een
  // scenario dat de validator inhoudelijk heeft afgewezen — dan zou de
  // vergelijking een voorstel tonen dat niet mag bestaan.
  const vergelijkbaar = candidates.filter(
    (candidate) => candidate.simulationEligible || candidate.validationState === "NOT_VALIDATED",
  );
  const teVergelijken = gekozen.filter((id) =>
    vergelijkbaar.some((entry) => entry.id === id),
  );
  const scenarioVergelijking =
    teVergelijken.length >= 2 ? await compareScenarios(teVergelijken) : null;

  return (
    <RosterCommitteeShell
      activeHref="/roostercommissie/simulatie"
      header={{
        title: "Scenario's vergelijken",
        subtitle: "Dezelfde diensten, andere accenten — naast elkaar beoordeeld",
      }}
    >
      <div className="mb-4">
        <WidgetCard
          icon={<SparkIcon size={18} />}
          tone="rc"
          title="Vergelijk verschillende roosterstrategieën"
          bodyClassName="border-t border-line p-4"
        >
          <p className="text-[12.5px] leading-relaxed text-ink">
            Vergelijk scenario&apos;s op urenverdeling, plaatsing en belasting. Een hogere
            optimalisatiescore betekent niet automatisch dat een scenario beter is; de
            Roostercommissie bepaalt welke verdeling het meest wenselijk is.
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">
            Elk scenario gebruikt hetzelfde dienstenpakket en dezelfde basisstructuur, maar legt
            andere accenten in de optimalisatie.
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">
            Een scenario is een voorstel, geen rooster. Het schrijft geen diensten naar
            medewerkers en raakt de dienstindeling niet. Analyseren en vergelijken kan altijd;
            formeel vastleggen pas wanneer de regelvalidatie compleet is.
          </p>
        </WidgetCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <WidgetCard
            icon={<SparkIcon size={18} />}
            tone="rc"
            title="Scenario genereren"
            subtitle="Alle basisroosters in één opdracht — geen profiel na profiel"
            bodyClassName="border-t border-line p-4"
          >
            <GenereerPaneel
              scenarios={SCENARIOS.map((scenario) => ({
                key: scenario.key,
                label: scenario.label,
                description: scenario.description,
                rekent: scenario.engine === "SOLVER",
              }))}
              genereerAction={genereerScenarioAction}
              valideerAction={valideerKandidaatAction}
            />
          </WidgetCard>

          {candidates.length === 0 ? (
            <WidgetCard title="Scenario's">
              <EmptyState>Nog geen scenario&apos;s om te vergelijken.</EmptyState>
              <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">
                Genereer hierboven een scenario. Begin met de <strong>Nulmeting</strong>: die
                neemt het bestaande rooster letterlijk over en dient daarna als ijkpunt voor
                alle andere scenario&apos;s.
              </p>
            </WidgetCard>
          ) : (
            <WidgetCard
              id="scenarios"
              title={`Scenario's (${candidates.length})`}
              subtitle={
                vergelijkbaar.length === 1
                  ? "Genereer nog een scenario om verschillen te kunnen vergelijken."
                  : "Vink twee of meer scenario's aan en vergelijk ze."
              }
              bodyClassName="border-t border-line p-4"
            >
              {/* Géén <form> om de kaarten heen. Elke kaart bevat zelf al
                  formulieren (Valideren, Verwerpen), en een <form> in een <form>
                  bestaat niet in HTML: de browser gooit het binnenste starttag
                  weg en laat de eerste </form> het buitenste formulier sluiten.
                  Het gevolg was dat alleen het eerste vinkje ooit werd
                  meegestuurd en de knop "Vergelijken" buiten elk formulier
                  stond. De vinkjes horen daarom bij het formulier via het
                  `form`-attribuut, dat juist voor dit geval bestaat. */}
              <div className="space-y-3">
                {candidates.map((candidate) => {
                  const rank = rankByCandidate.get(candidate.id);
                  return (
                    <ScenarioKaart
                      key={candidate.id}
                      candidate={candidate}
                      rank={rank ? { rank: rank.rank, reason: rank.reason } : null}
                      checked={teVergelijken.includes(candidate.id)}
                      selecteerbaar={vergelijkbaar.some((entry) => entry.id === candidate.id)}
                    />
                  );
                })}

                {vergelijkbaar.length >= 2 ? (
                  <form
                    id={VERGELIJK_FORM}
                    method="get"
                    className="flex items-center gap-3 border-t border-line pt-3"
                  >
                    <button
                      type="submit"
                      className="rounded-lg bg-ns-blue px-3 py-1.5 text-xs font-semibold text-white hover:bg-ns-blue-dark"
                    >
                      Vergelijken
                    </button>
                    <span className="text-[11px] text-ink-muted">
                      Kies er minstens twee. Alleen scenario&apos;s die bruikbaar zijn voor
                      simulatie kunnen worden vergeleken.
                    </span>
                  </form>
                ) : null}
              </div>
            </WidgetCard>
          )}

          {scenarioVergelijking ? (
            <ScenarioVergelijking vergelijking={scenarioVergelijking} />
          ) : teVergelijken.length === 1 ? (
            <WidgetCard title="Vergelijking">
              <EmptyState>
                Eén scenario geselecteerd. Genereer of kies nog een scenario om verschillen te
                kunnen zien.
              </EmptyState>
            </WidgetCard>
          ) : null}

          {verdwenenScenario ? (
            <Alert tone="info" title="Dit scenario staat niet meer in het overzicht">
              Het is verworpen, of het hoort bij een eerdere vulling van de database. De
              scenario&apos;s die er wél zijn, staan hierboven.{" "}
              <Link href="/roostercommissie/simulatie" className="font-semibold underline">
                Terug naar het overzicht
              </Link>
              .
            </Alert>
          ) : null}

          {comparison ? <Comparison comparison={comparison} /> : null}
        </div>

        <div className="space-y-4">
          <WidgetCard
            icon={<ShieldIcon size={18} />}
            tone="neutral"
            title="Publiceren"
            bodyClassName="border-t border-line p-4"
          >
            <p className="text-[12px] leading-relaxed text-ink">
              Een scenario kan worden geanalyseerd en vergeleken, maar nog niet formeel worden
              gepubliceerd.
            </p>
            <p className="mt-2 text-[11.5px] leading-relaxed text-ink-muted">
              De formele regelvalidatie is niet voltooid: de aangeleverde CAO is niet bevestigd
              als actueel, en er ontbreken regelpakketten. Zolang dat zo is, bestaat er geen
              publicatieknop — niet uitgeschakeld, maar afwezig.
            </p>
            <Link
              href="/beheer/regelbronnen"
              className="mt-3 inline-block text-[11.5px] font-semibold text-ns-blue underline"
            >
              Bekijk regelstatus
            </Link>
          </WidgetCard>

          <WidgetCard tone="neutral" title="Over de optimalisatiescore">
            <p className="text-[11.5px] leading-relaxed text-ink-muted">{SCORE_EXPLANATION}</p>
          </WidgetCard>
        </div>
      </div>
    </RosterCommitteeShell>
  );
}

/**
 * Het formulier waar de vinkjes bij horen.
 *
 * De vinkjes staan in de scenariokaarten, het formulier staat eronder. Dat kan
 * omdat een `input` via `form="…"` bij een formulier elders op de pagina mag
 * horen — en het moet, omdat een kaart zelf al formulieren bevat.
 */
const VERGELIJK_FORM = "scenario-vergelijking";

/**
 * Een tijdstip zoals de lezer het op de klok ziet.
 *
 * Hier stond eerder de ruwe UTC-tijd uit `toISOString()`. In de zomer scheelt
 * dat twee uur met de klok in de kantine, en niemand kan aan de tekst zien dat
 * er UTC staat.
 */
function tijdstip(moment: Date): string {
  const instant = moment.getTime();
  return `${localDateOf(instant)} ${formatClock(localMinuteOfDay(instant))}`;
}

/** De aangevinkte scenario's uit de URL. */
function selectedIds(value: string | string[] | undefined): readonly string[] {
  if (Array.isArray(value)) {
    return value;
  }
  return value ? [value] : [];
}

// ── Eén scenario ─────────────────────────────────────────────────────────────

type Candidate = Awaited<ReturnType<typeof listCandidates>>[number];

/**
 * Het resultaat van één scenario, als kaart.
 *
 * De ruwe enumwaarde stond hier eerder als badge op het scherm. Dat is precies
 * het soort tekst waarvan een lezer denkt dat hij iets verkeerd heeft gedaan.
 */
function ScenarioKaart({
  candidate,
  rank,
  checked,
  selecteerbaar,
}: {
  candidate: Candidate;
  rank: { rank: number; reason: string } | null;
  checked: boolean;
  selecteerbaar: boolean;
}) {
  const oordeel = statusOordeel(candidate.validationState);
  // Dezelfde telling als de vergelijkingstabel hiernaast: uit de toewijzingen,
  // niet uit de solverboekhouding die alleen bij CP-SAT bestaat.
  const leeg = candidate.dutiesUnfilled;
  const dienstdagen = candidate.dutiesPlaced + leeg;

  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          {selecteerbaar ? (
            <input
              type="checkbox"
              form={VERGELIJK_FORM}
              name="vergelijk"
              value={candidate.id}
              defaultChecked={checked}
              className="mt-1"
              aria-label={`${candidate.scenarioLabel} meenemen in de vergelijking`}
            />
          ) : (
            <span className="mt-1 inline-block w-3.5" aria-hidden />
          )}
          <div>
            <p className="text-sm font-semibold">{candidate.scenarioLabel}</p>
            <p className="text-[11.5px] text-ink-muted">{strategieOmschrijving(candidate)}</p>
            <p className="mt-0.5 text-[11px] text-ink-faint">
              Gegenereerd {tijdstip(candidate.generatedAt)}
            </p>
          </div>
        </div>
        <div className="text-right">
          <Badge tone={oordeel.tone}>{oordeel.label}</Badge>
          {candidate.stale ? (
            <span className="mt-1 block">
              <Badge tone="warn">verouderd</Badge>
            </span>
          ) : null}
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11.5px] sm:grid-cols-4">
        <Cijfer
          label="Optimalisatiescore"
          waarde={String(candidate.overallQualityScore)}
          uitleg={SCORE_TOOLTIP}
        />
        <Cijfer
          label="Diensten geplaatst"
          waarde={dienstdagen > 0 ? `${candidate.dutiesPlaced} / ${dienstdagen}` : "—"}
        />
        <Cijfer
          label="Ongevulde diensten"
          waarde={dienstdagen > 0 ? String(leeg) : "—"}
          tone={leeg > 0 ? "warn" : undefined}
        />
        <Cijfer
          label="Bevestigde harde overtredingen"
          waarde={
            candidate.tally ? String(candidate.tally.confirmedHardViolations) : "nog niet getoetst"
          }
          tone={candidate.tally && candidate.tally.confirmedHardViolations > 0 ? "error" : undefined}
        />
      </dl>

      <ValidatieBlokken candidate={candidate} />

      <Roosterbladen candidate={candidate} />

      {/* De technische namen bestaan nog en zijn nog steeds op te zoeken; ze
          staan alleen niet meer in het beeld van wie een scenario beoordeelt. */}
      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] text-ink-muted hover:text-ink">
          Details
        </summary>
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
          <dt className="text-ink-muted">Optimizer</dt>
          <dd className="font-mono">{candidate.optimizer}</dd>
          <dt className="text-ink-muted">Validatiestatus</dt>
          <dd className="font-mono">{candidate.validationState}</dd>
          <dt className="text-ink-muted">Modus</dt>
          <dd className="font-mono">{candidate.mode}</dd>
        </dl>

        {candidate.uncertainties.length > 0 ? (
          <div className="mt-2">
            <Table>
              <THead>
                <TR>
                  <TH>Regel</TH>
                  <TH>Reden</TH>
                  <TH numeric>Toewijzingen</TH>
                </TR>
              </THead>
              <tbody>
                {candidate.uncertainties.slice(0, 12).map((entry) => (
                  <TR key={`${entry.kind}-${entry.ruleId}`}>
                    <TD mono>{entry.ruleId}</TD>
                    <TD>{ONZEKERHEID_LABEL[entry.kind] ?? entry.kind}</TD>
                    <TD numeric>{entry.affectedAssignments}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
            {candidate.uncertainties.length > 12 ? (
              <p className="mt-1 text-[11px] text-ink-muted">
                en nog {candidate.uncertainties.length - 12} regelgroepen.
              </p>
            ) : null}
          </div>
        ) : null}
      </details>

      {rank ? (
        <p className="mt-1.5 text-[11px] text-ink-muted">
          Rangschikking #{rank.rank} — {rank.reason}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {/* De eindvalidatie rekent elke toewijzing opnieuw na tegen de hele
            regelcatalogus. Op een ontwikkelmachine duurt dat ongeveer een
            minuut, in de draagbare versie enkele minuten — dus staat dat erbij
            in plaats van een knop die alleen "bezig" zegt. */}
        <ActionForm
          action={valideerKandidaatAction}
          submitLabel="Valideren"
          pendingLabel="Valideren… (kan enkele minuten duren)"
          variant="secondary"
          compact
        >
          <input type="hidden" name="candidateId" value={candidate.id} />
        </ActionForm>
        <Link
          href={`/roostercommissie/simulatie?kandidaat=${candidate.id}`}
          className="inline-flex items-center rounded-md border border-line px-2.5 py-1 text-xs font-semibold"
        >
          Analyse
        </Link>
        <ActionForm
          action={verwerpKandidaatAction}
          submitLabel="Verwerpen"
          variant="danger"
          compact
        >
          <input type="hidden" name="candidateId" value={candidate.id} />
        </ActionForm>
      </div>
    </div>
  );
}

/** De uitleg bij de score, overal waar het getal staat. */
const SCORE_TOOLTIP =
  "Deze score geeft aan hoe het scenario volgens de ingestelde optimalisatiedoelen " +
  "presteert. De score is geen juridische goedkeuring en moet samen met de " +
  "detailanalyse en urenverdeling worden bekeken.";

/**
 * Welke aanpak dit scenario heeft gebruikt, in gewone taal.
 *
 * Afgeleid uit de optimizerstempel die al op de kandidaat staat; er wordt hier
 * niets bijgehouden wat er niet is. Het roosterjaar staat er bewust níet bij:
 * een kandidaat draagt geen roosterjaar, dat wordt pas bij het vastleggen als
 * roosterversie gekozen. Een jaartal verzinnen zou een gegeven suggereren dat
 * niet bestaat.
 */
const STRATEGIE_LABEL: Record<string, string> = {
  REPRODUCE: "Referentiescenario — neemt het huidige rooster over",
  BALANCE_SHUNTING: "Herverdeling van rangeerdiensten",
  BALANCED: "Optimalisatie — totale balans",
  REST_QUALITY: "Optimalisatie — rustkwaliteit",
  FAIR_BURDEN: "Optimalisatie — lastenverdeling",
  MINIMAL_CHANGE: "Optimalisatie — minimale wijziging",
  COVERAGE: "Optimalisatie — maximale plaatsing",
};

function strategieOmschrijving(candidate: Candidate): string {
  const sleutel = candidate.optimizer.split("+")[1] ?? "";
  return STRATEGIE_LABEL[sleutel] ?? "Optimalisatie";
}

/**
 * De uitkomst van de toetsing in drie blokken.
 *
 * Eerder stond hier één alinea waarin "geen bevestigde overtredingen", "46
 * onzekere regels" en "publicatie geblokkeerd" achter elkaar liepen. Drie
 * verschillende dingen in één zin leest als één probleem, terwijl het eerste
 * juist goed nieuws is. Ze staan nu los, elk met een eigen teken.
 */
function ValidatieBlokken({ candidate }: { candidate: Candidate }) {
  if (candidate.validationState === "NOT_VALIDATED") {
    return (
      <div className="mt-2.5 rounded-md border border-line bg-canvas px-2.5 py-2 text-[11.5px] text-ink-muted">
        Nog niet getoetst. Druk op <strong className="font-semibold">Valideren</strong> om dit
        scenario onafhankelijk te laten narekenen.
      </div>
    );
  }

  const bevestigd = candidate.tally?.confirmedHardViolations ?? 0;
  const perSoort = new Map<string, number>();
  for (const entry of candidate.uncertainties) {
    perSoort.set(entry.kind, (perSoort.get(entry.kind) ?? 0) + 1);
  }
  const onbevestigdeBron = perSoort.get("UNVERIFIED_RULE_SOURCE") ?? 0;
  const ontbrekendeContext = perSoort.get("MISSING_RULE_CONTEXT") ?? 0;
  const teWeinigHistorie = perSoort.get("INSUFFICIENT_HISTORY") ?? 0;

  return (
    <div className="mt-2.5 grid gap-2 sm:grid-cols-3">
      <Blok titel="Technische controle">
        {bevestigd === 0 ? (
          <Regelmelding teken="ok">Geen bevestigde harde overtredingen</Regelmelding>
        ) : (
          <Regelmelding teken="fout">
            {bevestigd} bevestigde harde {bevestigd === 1 ? "overtreding" : "overtredingen"}
          </Regelmelding>
        )}
      </Blok>

      <Blok titel="Onzekerheden">
        {candidate.uncertainties.length === 0 ? (
          <Regelmelding teken="ok">Alle regels volledig nagerekend</Regelmelding>
        ) : (
          <>
            {onbevestigdeBron > 0 ? (
              <Regelmelding teken="let-op">
                {onbevestigdeBron} regelgroepen met onbevestigde bron
              </Regelmelding>
            ) : null}
            {ontbrekendeContext > 0 ? (
              <Regelmelding teken="let-op">
                {ontbrekendeContext} regels niet volledig te beoordelen
              </Regelmelding>
            ) : null}
            {teWeinigHistorie > 0 ? (
              <Regelmelding teken="let-op">
                {teWeinigHistorie} regels met te weinig historie
              </Regelmelding>
            ) : null}
          </>
        )}
      </Blok>

      <Blok titel="Formele publicatie">
        {candidate.publicationEligible ? (
          <Regelmelding teken="ok">Toegestaan</Regelmelding>
        ) : (
          <Regelmelding teken="let-op">Nog niet toegestaan</Regelmelding>
        )}
      </Blok>
    </div>
  );
}

/**
 * De roosterbladen van dit scenario, per basisrooster.
 *
 * Hetzelfde blad en dezelfde renderer als het vastgelegde rooster; alleen de
 * bron is het voorstel. Elk blad draagt bovenaan de simulatiewaarschuwing, en
 * de bestandsnaam eindigt op `-SCENARIO-SIMULATIE` — een blad dat uit een
 * voorstel komt, mag nergens op een vastgesteld rooster lijken.
 */
function Roosterbladen({ candidate }: { candidate: Candidate }) {
  if (candidate.rosterCodes.length === 0) {
    return null;
  }

  return (
    <div className="mt-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        Roosterbladen van dit scenario
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {candidate.rosterCodes.map((code) => (
          <Link
            key={code}
            href={`/roostercommissie/roosterblad/${code}?kandidaat=${candidate.id}`}
            className="inline-flex items-center rounded-md border border-line px-2 py-0.5 font-mono text-[11px] hover:border-line-strong"
          >
            {code}
          </Link>
        ))}
        <span className="text-[11px] text-ink-muted">
          — openen als blad, met een knop om het als PDF op te halen.
        </span>
      </div>
    </div>
  );
}

function Blok({ titel, children }: { titel: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-line bg-canvas px-2.5 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{titel}</p>
      <div className="mt-1 space-y-0.5">{children}</div>
    </div>
  );
}

function Regelmelding({
  teken,
  children,
}: {
  teken: "ok" | "let-op" | "fout";
  children: React.ReactNode;
}) {
  const stijl = {
    ok: { merk: "✓", kleur: "text-state-ok" },
    "let-op": { merk: "⚠", kleur: "text-state-warn" },
    fout: { merk: "✕", kleur: "text-state-error" },
  }[teken];

  return (
    <p className="flex gap-1.5 text-[11.5px] leading-snug text-ink">
      <span aria-hidden className={`${stijl.kleur} font-semibold`}>
        {stijl.merk}
      </span>
      <span>{children}</span>
    </p>
  );
}

function Cijfer({
  label,
  waarde,
  tone,
  uitleg,
}: {
  label: string;
  waarde: string;
  tone?: "warn" | "error";
  /** Verschijnt als tooltip bij een vraagteken achter het label. */
  uitleg?: string;
}) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-ink-muted">
        {label}
        {uitleg ? (
          <span
            title={uitleg}
            tabIndex={0}
            role="note"
            aria-label={uitleg}
            className="ml-1 inline-flex h-3 w-3 cursor-help items-center justify-center rounded-full border border-line-strong align-[1px] text-[8px] font-bold text-ink-muted"
          >
            i
          </span>
        ) : null}
      </dt>
      <dd
        className={`tabular font-semibold ${
          tone === "error" ? "text-state-error" : tone === "warn" ? "text-state-warn" : "text-ink"
        }`}
      >
        {waarde}
      </dd>
    </div>
  );
}

const ONZEKERHEID_LABEL: Record<string, string> = {
  UNVERIFIED_RULE_SOURCE: "Bron niet formeel bevestigd",
  MISSING_RULE_CONTEXT: "Parameter of bron ontbreekt",
  INSUFFICIENT_HISTORY: "Meer roosterhistorie nodig",
};

/**
 * De technische uitkomst in gewone taal.
 *
 * Geel en grijs zijn hier bewust geen rood: onzekerheid over een regelbron is
 * geen bewezen fout in het rooster, en die twee dezelfde kleur geven is precies
 * de verwarring die dit scherm moest oplossen.
 */
function statusOordeel(state: string): { label: string; tone: Tone } {
  switch (state) {
    case "TECHNICALLY_VALIDATED":
      return { label: "Gegenereerd — volledig getoetst", tone: "ok" };
    case "TECHNICALLY_VALID_UNVERIFIED_RULES":
      return { label: "Gegenereerd — formele validatie onvolledig", tone: "warn" };
    case "TECHNICALLY_VALID_INCOMPLETE_CONTEXT":
      return { label: "Gegenereerd — historie onvolledig", tone: "warn" };
    case "CONFIRMED_HARD_VIOLATION":
      return { label: "Afgewezen — bevestigde overtreding", tone: "error" };
    case "INVALID_STRUCTURE":
      return { label: "Afgewezen — niet volledig te beoordelen", tone: "error" };
    case "NOT_VALIDATED":
      return { label: "Nog niet getoetst", tone: "neutral" };
    case "STALE_SCHEDULE":
    case "STALE_RULESET":
    case "STALE_INPUT":
      return { label: "Verouderd — opnieuw genereren", tone: "warn" };
    case "TAMPERED":
      return { label: "Inhoud komt niet overeen", tone: "error" };
    default:
      // De oude verzamelbak. Zegt niet wat er aan de hand was, en dat staat er
      // dan ook bij in plaats van een verzonnen duiding.
      return { label: "Beoordeeld vóór de huidige indeling", tone: "neutral" };
  }
}

// ── Scenario's naast elkaar ──────────────────────────────────────────────────

function ScenarioVergelijking({ vergelijking }: { vergelijking: ScenarioComparison }) {
  const { scenarios, rosterCodes, incomparable } = vergelijking;
  const hoogsteScore = Math.max(...scenarios.map((entry) => entry.optimisationScore));
  // Eén scenario mag alleen worden uitgelicht als het ook werkelijk het hoogste
  // haalt. Delen er twee dezelfde score, dan is er geen beste en hoort het
  // scherm er ook geen aan te wijzen.
  const aantalMetHoogste = scenarios.filter(
    (entry) => entry.optimisationScore === hoogsteScore,
  ).length;
  const eenDuidelijkHoogste = aantalMetHoogste === 1;

  return (
    <WidgetCard
      title={`Vergelijking (${scenarios.length} scenario's)`}
      subtitle="De urenverdeling eerst: daar zit het verschil dat een medewerker merkt"
      bodyClassName="border-t border-line p-4"
    >
      {incomparable ? (
        <div className="mb-3">
          <Alert tone="warn" title="Let op: geen gelijke basis">
            {incomparable}
          </Alert>
        </div>
      ) : null}

      {/* De urenverdeling staat boven de maattabel. Twee scenario's kunnen op
          elke maat gelijk scoren en tóch een heel ander rooster opleveren; dat
          verschil is hier zichtbaar en nergens anders. */}
      <UrenVergelijking scenarios={scenarios} rosterCodes={rosterCodes} />

      <p className="mt-5 text-[12px] font-semibold text-ink">Overige maten</p>
      <div className="mt-2 overflow-x-auto">
        <Table>
          <THead>
            <TR>
              <TH>Maat</TH>
              {scenarios.map((scenario) => (
                <TH key={scenario.id}>
                  {scenario.label}
                  {/* Twee keer hetzelfde scenario draaien mag, en dan staan er
                      twee kolommen met dezelfde naam. Het tijdstip erbij maakt
                      zichtbaar welke welke is. */}
                  <span className="block font-normal normal-case text-ink-muted">
                    {tijdstip(scenario.generatedAt)}
                  </span>
                </TH>
              ))}
            </TR>
          </THead>
          <tbody>
            <Regel
              label="Optimalisatiescore"
              uitleg={SCORE_TOOLTIP}
              scenarios={scenarios}
              waarde={(entry) => String(entry.optimisationScore)}
              markeer={
                eenDuidelijkHoogste
                  ? (entry) => entry.optimisationScore === hoogsteScore
                  : undefined
              }
            />
            <Regel
              label="Diensten geplaatst"
              scenarios={scenarios}
              waarde={(entry) =>
                entry.dutiesRequired > 0
                  ? `${entry.dutiesPlaced} / ${entry.dutiesRequired}`
                  : String(entry.dutiesPlaced)
              }
            />
            <Regel
              label="Ongevulde diensten"
              scenarios={scenarios}
              waarde={(entry) => String(entry.dutiesUnfilled)}
            />
            <Regel
              label="Bevestigde overtredingen"
              scenarios={scenarios}
              waarde={(entry) =>
                entry.confirmedHardViolations === null
                  ? "nog niet getoetst"
                  : String(entry.confirmedHardViolations)
              }
            />
            <Regel
              label="Regels met onzekerheid"
              scenarios={scenarios}
              waarde={(entry) =>
                entry.uncertaintyGroups === null
                  ? "nog niet getoetst"
                  : `${entry.uncertaintyGroups} regels`
              }
            />
            <Regel
              label="Rustkwaliteit"
              scenarios={scenarios}
              waarde={(entry) => String(entry.restQuality)}
            />
            <Regel
              label="Weekendverdeling"
              scenarios={scenarios}
              waarde={(entry) => String(entry.weekendBalance)}
            />
            <Regel
              label="Nachtverdeling"
              scenarios={scenarios}
              waarde={(entry) => String(entry.nightBalance)}
            />
            <Regel
              label="Rangeerverdeling"
              scenarios={scenarios}
              waarde={(entry) => String(entry.shuntingBalance)}
            />
            <Regel
              label="Simulatie"
              scenarios={scenarios}
              waarde={(entry) =>
                entry.validationState === "NOT_VALIDATED"
                  ? "nog niet getoetst"
                  : entry.simulationEligible
                    ? "geschikt"
                    : "niet geschikt"
              }
            />
            <Regel
              label="Publicatie"
              scenarios={scenarios}
              waarde={(entry) => (entry.publicationEligible ? "toegestaan" : "geblokkeerd")}
            />
          </tbody>
        </Table>
      </div>

      <p className="mt-3 text-[11px] text-ink-muted">
        {eenDuidelijkHoogste
          ? "Het scenario met de hoogste optimalisatiescore is gemarkeerd. Dat is geen advies: welke verdeling het beste past, is een afweging van de Rooster Commissie."
          : "Deze scenario's halen dezelfde optimalisatiescore; er is er dus geen aan te wijzen als beste. Het verschil zit in de urenverdeling hierboven, en welke verdeling het beste past is een afweging van de Rooster Commissie."}
      </p>
    </WidgetCard>
  );
}

/**
 * De urenverdeling per basisrooster, met een leeshulp in kleur.
 *
 * ## Waarom dit bovenaan staat
 *
 * Twee scenario's kunnen op elke maat gelijk uitkomen en toch een heel ander
 * rooster zijn. Wat een medewerker merkt is de weekomvang van zíjn rooster, en
 * dat is precies wat hier staat: per basisrooster, niet gemiddeld over de
 * standplaats heen, want een gemiddelde van 40:00 kan uit 38:00 en 42:00
 * bestaan.
 *
 * ## Wat de kleuren zijn en wat ze niet zijn
 *
 * Een leeshulp, geen norm. De grenzen staan eronder in de legenda zodat
 * iedereen kan zien waar ze liggen; ze komen niet uit de CAO en er wordt in de
 * validatie niets mee gedaan. Wat juridisch is toegestaan, bepaalt de
 * regeltoetsing en niet deze kleur.
 */
const AFWIJKING_GOED_MINUTEN = 5;
const AFWIJKING_MERKBAAR_MINUTEN = 30;

function UrenVergelijking({
  scenarios,
  rosterCodes,
}: {
  scenarios: ScenarioComparison["scenarios"];
  rosterCodes: readonly string[];
}) {
  if (rosterCodes.length === 0) {
    return (
      <EmptyState>
        Geen urenverdeling te tonen: er zijn geen basisroosters in deze scenario&apos;s.
      </EmptyState>
    );
  }

  return (
    <div>
      <p className="text-[12.5px] font-semibold text-ink">Gemiddelde weekomvang per rooster</p>
      <p className="mt-0.5 text-[11.5px] text-ink-muted">
        Per basisrooster afzonderlijk, afgezet tegen 40:00. De veertig uur moet per rooster
        kloppen, niet gemiddeld over de standplaats heen.
      </p>

      <div className="mt-2 overflow-x-auto rounded-md border border-line">
        <Table>
          <THead>
            <TR>
              <TH>Basisrooster</TH>
              {scenarios.map((scenario) => (
                <TH key={scenario.id}>
                  {scenario.label}
                  <span className="block font-normal normal-case text-ink-muted">
                    {tijdstip(scenario.generatedAt)}
                  </span>
                </TH>
              ))}
            </TR>
          </THead>
          <tbody>
            {rosterCodes.map((code) => (
              <TR key={code}>
                <TD>{code}</TD>
                {scenarios.map((scenario) => {
                  const uren = scenario.hoursByRoster.find((entry) => entry.rosterCode === code);
                  return (
                    <TD key={scenario.id}>
                      {uren ? <Weekomvang uren={uren} /> : <span className="text-ink-faint">—</span>}
                    </TD>
                  );
                })}
              </TR>
            ))}
          </tbody>
        </Table>
      </div>

      <p className="mt-1.5 text-[11px] text-ink-muted">
        <IndicatorStip tone="ok" /> tot {AFWIJKING_GOED_MINUTEN} minuten van 40:00 ·{" "}
        <IndicatorStip tone="warn" /> tot {AFWIJKING_MERKBAAR_MINUTEN} minuten ·{" "}
        <IndicatorStip tone="error" /> meer dan {AFWIJKING_MERKBAAR_MINUTEN} minuten. Een
        leeshulp bij het lezen van de tabel, geen norm en geen onderdeel van de regeltoetsing.
      </p>
    </div>
  );
}

/** Eén weekomvang: de tijd, de afwijking en de stip die erbij hoort. */
function Weekomvang({ uren }: { uren: ScenarioComparison["scenarios"][number]["hoursByRoster"][number] }) {
  const afwijking = uren.deviationMinutes;
  const grootte = Math.abs(afwijking);
  const tone: Tone =
    grootte <= AFWIJKING_GOED_MINUTEN
      ? "ok"
      : grootte <= AFWIJKING_MERKBAAR_MINUTEN
        ? "warn"
        : "error";
  const kleur =
    tone === "ok" ? "text-state-ok" : tone === "warn" ? "text-state-warn" : "text-state-error";

  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <IndicatorStip tone={tone} />
      <span className="tabular font-semibold text-ink">{uren.averageWeek}</span>
      <span className={`tabular text-[11px] ${kleur}`}>({afwijkingLabel(afwijking)})</span>
    </span>
  );
}

/** Een afwijking als ±u:mm, zodat hij naast de weekomvang leest. */
function afwijkingLabel(minuten: number): string {
  const teken = minuten > 0 ? "+" : minuten < 0 ? "−" : "±";
  const grootte = Math.abs(minuten);
  const uren = Math.floor(grootte / 60);
  const rest = grootte % 60;
  return `${teken}${uren}:${String(rest).padStart(2, "0")}`;
}

function IndicatorStip({ tone }: { tone: Tone }) {
  const kleur =
    tone === "ok" ? "bg-state-ok" : tone === "warn" ? "bg-state-warn" : "bg-state-error";
  return <span aria-hidden className={`inline-block h-2 w-2 shrink-0 rounded-full ${kleur}`} />;
}

function Regel({
  label,
  uitleg,
  scenarios,
  waarde,
  markeer,
}: {
  label: string;
  uitleg?: string;
  scenarios: ScenarioComparison["scenarios"];
  waarde: (entry: ScenarioComparison["scenarios"][number]) => string;
  markeer?: (entry: ScenarioComparison["scenarios"][number]) => boolean;
}) {
  return (
    <TR>
      <TD>
        {label}
        {uitleg ? (
          <span
            title={uitleg}
            tabIndex={0}
            role="note"
            aria-label={uitleg}
            className="ml-1 inline-flex h-3 w-3 cursor-help items-center justify-center rounded-full border border-line-strong align-[1px] text-[8px] font-bold text-ink-muted"
          >
            i
          </span>
        ) : null}
      </TD>
      {scenarios.map((scenario) => (
        <TD key={scenario.id}>
          <span className={markeer?.(scenario) ? "font-semibold text-ns-blue" : undefined}>
            {waarde(scenario)}
          </span>
        </TD>
      ))}
    </TR>
  );
}

// ── Analyse van één scenario tegen het huidige rooster ───────────────────────

function Comparison({
  comparison,
}: {
  comparison: NonNullable<Awaited<ReturnType<typeof comparisonFor>>>;
}) {
  return (
    <WidgetCard
      title="Analyse tegen het huidige rooster"
      subtitle="Wat dit scenario verandert ten opzichte van wat er nu ligt"
      bodyClassName="border-t border-line p-4"
    >
      <div className="overflow-x-auto">
        <Table>
          <THead>
            <TR>
              <TH>Maat</TH>
              <TH numeric>Nu</TH>
              <TH numeric>Scenario</TH>
            </TR>
          </THead>
          <tbody>
            <Row label="Roosterlijnen" current={comparison.total.current.lines} candidate={comparison.total.candidate.lines} />
            <Row label="Dienstdagen" current={comparison.total.current.duties} candidate={comparison.total.candidate.duties} />
            <Row label="Vroege diensten" current={comparison.total.current.early} candidate={comparison.total.candidate.early} />
            <Row label="Late diensten" current={comparison.total.current.late} candidate={comparison.total.candidate.late} />
            <Row label="Nachtdiensten" current={comparison.total.current.night} candidate={comparison.total.candidate.night} />
            <Row label="Weekenddiensten" current={comparison.total.current.weekendDuties} candidate={comparison.total.candidate.weekendDuties} />
            <Row label="Rangeerdiensten" current={comparison.total.current.shunting} candidate={comparison.total.candidate.shunting} />
            <Row label="Reservedagen" current={comparison.total.current.reserveDays} candidate={comparison.total.candidate.reserveDays} />
          </tbody>
        </Table>
      </div>

      {comparison.changes.length > 0 ? (
        <div className="mt-3">
          <p className="text-[12px] font-semibold text-ink">Wat er verandert</p>
          <ul className="mt-1 space-y-1 text-[11.5px] text-ink-muted">
            {comparison.changes.map((change) => (
              <li key={change.headline}>
                <span className="font-semibold text-ink">{change.headline}</span>
                {change.reasons.length > 0 ? ` — ${change.reasons.join(" ")}` : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-3 text-[11px] text-ink-muted">
        Gemiddelde rust {formatSpan(comparison.total.candidate.averageRestMinutes ?? 0)}, kortste{" "}
        {formatSpan(comparison.total.candidate.minimumRestMinutes ?? 0)}.
      </p>
    </WidgetCard>
  );
}

function Row({
  label,
  current,
  candidate,
}: {
  label: string;
  current: number;
  candidate: number;
}) {
  const verschil = candidate - current;
  return (
    <TR>
      <TD>{label}</TD>
      <TD numeric>{current}</TD>
      <TD numeric>
        {candidate}
        {verschil !== 0 ? (
          <span
            className={`ml-1 text-[10px] ${verschil > 0 ? "text-state-warn" : "text-ink-muted"}`}
          >
            ({verschil > 0 ? "+" : ""}
            {verschil})
          </span>
        ) : null}
      </TD>
    </TR>
  );
}
