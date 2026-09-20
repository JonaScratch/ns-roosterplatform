import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { REBUILD_GOAL_LABELS, type RebuildGoal } from "@/server/optimizer/objective-weights";
import { NotFoundError } from "@/server/security/authorize";
import { candidatePackage } from "@/server/services/candidate-results-service";
import { RosterCommitteeShell } from "@/components/layout/area-shell";
import { ActionForm } from "@/components/ui/action-form";
import { Alert, Badge, WidgetCard, inputClass } from "@/components/ui/primitives";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";
import { DownloadIcon, GridIcon, RefreshIcon, ShieldIcon } from "@/components/ui/icons";
import { archiveerAction, herbouwAction, legVastAction, voorkeurAction } from "../acties";
import {
  Cijfer,
  Nachtreeksen,
  PERCENTAGE_SCORES,
  StatusBadge,
  UrenStip,
  VoorkeurBadge,
  afwijkingTekst,
  datumTijd,
  naamVan,
  scoreTekst,
} from "../onderdelen";

export const dynamic = "force-dynamic";

/**
 * Eén kandidaat: het complete pakket van alle basisroosters.
 *
 * ## Waarom een pakket en geen los rooster
 *
 * De solver bouwt alle basisroosters samen op: wat Laat/Nacht krijgt, krijgt
 * Mix niet. Een kandidaat is daarom alleen als geheel te beoordelen, en
 * "Opnieuw bouwen" werkt ook op het geheel. Per basisrooster is daarna in te
 * zoomen tot op de dag.
 *
 * ## Waarom de PDF pas op verzoek komt
 *
 * Het blad wordt gemaakt door dezelfde generator als het officiële roosterblad,
 * met de simulatiestempel erop. Het verschijnt pas wanneer iemand erom vraagt:
 * een map vol PDF's van kandidaten die niemand heeft gekozen, helpt niemand.
 */
export default async function KandidaatPakket({
  params,
}: {
  params: Promise<{ candidateId: string }>;
}) {
  const { candidateId } = await params;
  if (!z.uuid().safeParse(candidateId).success) {
    notFound();
  }
  const pakket = await candidatePackage(candidateId).catch((error: unknown) => {
    if (error instanceof NotFoundError) {
      return null;
    }
    throw error;
  });
  if (!pakket) {
    notFound();
  }
  const { card, run, rosters, subscores, official, validation, lineage, search } = pakket;
  const ouderScores = new Map(lineage.parent?.subscores.map((entry) => [entry.key, entry.score]) ?? []);
  const officieel = new Map(official.map((entry) => [entry.key, entry.score]));
  const bruikbaar = card.status === "GEREED" || card.status === "VEROUDERD";

  const perSoort = new Map<string, number>();
  for (const entry of validation.uncertainties) {
    perSoort.set(entry.kind, (perSoort.get(entry.kind) ?? 0) + 1);
  }

  return (
    <RosterCommitteeShell
      activeHref="/roostercommissie/simulatie"
      header={{
        title: `${naamVan(card)} — ${card.strategyLabel}`,
        subtitle: run
          ? `Roosterjaar ${run.rosterYear} (${run.periodLabel}) · gegenereerd ${datumTijd(card.generatedAt)}`
          : `Legacy kandidaat · gegenereerd ${datumTijd(card.generatedAt)}`,
      }}
    >
      <p className="mb-3 text-[12px]">
        <Link
          href={run ? `/roostercommissie/simulatie?run=${run.id}#run-${run.id}` : "/roostercommissie/simulatie"}
          className="text-ink-muted underline"
        >
          ← Scenario&apos;s vergelijken
        </Link>
      </p>

      {card.archived ? (
        <div className="mb-3">
          <Alert tone="neutral" title="Deze kandidaat is gearchiveerd.">
            Hij blijft bewaard en te openen, maar staat niet meer tussen de resultaten.
          </Alert>
        </div>
      ) : null}

      <div className="mb-4 grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <p className="text-[10px] uppercase tracking-wide text-ink-muted">Status</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <StatusBadge kaart={card} />
            {card.preferred ? <VoorkeurBadge /> : null}
          </div>
          <p className="mt-1 text-[12px] text-ink-muted">{card.statusDetail}</p>
        </div>
        <dl className="contents">
          <Cijfer label="Diensten geplaatst" waarde={`${card.coverage.placed}/${card.coverage.required}`} />
          <Cijfer
            label="Bevestigde harde overtredingen"
            waarde={card.confirmedHardViolations === null ? "niet getoetst" : String(card.confirmedHardViolations)}
            tone={card.confirmedHardViolations ? "error" : card.confirmedHardViolations === 0 ? "ok" : undefined}
          />
          <Cijfer
            label="Anders dan huidig rooster"
            waarde={pakket.changedFromOfficial === null ? "—" : `${pakket.changedFromOfficial} dienstdagen`}
          />
        </dl>
      </div>

      <div className="mb-4 flex flex-wrap items-start gap-2">
        {bruikbaar && !card.archived ? (
          <ActionForm
            action={voorkeurAction}
            submitLabel={card.preferred ? "Voorkeur intrekken" : "Markeren als voorkeurskandidaat"}
            pendingLabel="Bezig…"
            variant={card.preferred ? "secondary" : "outline-rc"}
            compact
          >
            <input type="hidden" name="candidateId" value={card.id} />
            <input type="hidden" name="preferred" value={card.preferred ? "false" : "true"} />
          </ActionForm>
        ) : null}
        {bruikbaar ? (
          <a
            href={`/roostercommissie/simulatie/${card.id}/pdf`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3.5 py-2 text-[12.5px] font-semibold text-ink hover:bg-canvas"
          >
            <DownloadIcon size={14} aria-hidden />
            Alle basisroosters exporteren (PDF)
          </a>
        ) : null}
        {run && run.found > 1 ? (
          <Link
            href={`/roostercommissie/simulatie/vergelijken?run=${run.id}`}
            className="inline-flex items-center rounded-lg border border-line-strong bg-surface px-3.5 py-2 text-[12.5px] font-semibold text-ink hover:bg-canvas"
          >
            Vergelijken met de andere kandidaten
          </Link>
        ) : null}
        <div className="ml-auto">
          <ActionForm
            action={archiveerAction}
            submitLabel={card.archived ? "Terugzetten uit archief" : "Archiveren"}
            pendingLabel="Bezig…"
            variant="secondary"
            compact
          >
            <input type="hidden" name="candidateId" value={card.id} />
            <input type="hidden" name="archived" value={card.archived ? "false" : "true"} />
          </ActionForm>
        </div>
      </div>

      <WidgetCard
        icon={<GridIcon size={18} />}
        tone="rc"
        title={`Basisroosters in dit pakket (${rosters.length})`}
        subtitle="Samen opgebouwd; open een rooster om het per regel en per dag te bekijken"
        bodyClassName="border-t border-line p-4"
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {rosters.map((tegel) => (
            <article key={tegel.code} className="flex flex-col rounded-lg border border-line p-3">
              <header>
                <h3 className="font-mono text-[13.5px] font-semibold text-ink-strong">{tegel.code}</h3>
                <p className="text-[11.5px] text-ink-muted">
                  {tegel.name} · {tegel.profileLabel} · {tegel.lines} regels
                </p>
              </header>
              <p className="mt-2 flex items-center gap-1.5 text-[13px]">
                <UrenStip afwijking={tegel.deviationMinutes} />
                <span className="tabular font-semibold text-ink-strong">{tegel.averageWeek}</span>
                <span className="tabular text-[11.5px] text-ink-muted">
                  gemiddeld per week ({afwijkingTekst(tegel.deviationMinutes)})
                </span>
              </p>
              <dl className="mt-2 grid grid-cols-4 gap-1 text-center text-[11px]">
                {[
                  ["V", tegel.early, "Vroege diensten"],
                  ["L", tegel.late, "Late diensten"],
                  ["N", tegel.night, "Nachtdiensten"],
                  ["R", tegel.shunting, "Rangeerdiensten"],
                ].map(([letter, aantal, uitleg]) => (
                  <div key={letter} className="rounded border border-line bg-canvas py-1" title={String(uitleg)}>
                    <dt className="text-[10px] text-ink-muted">{letter}</dt>
                    <dd className="tabular font-semibold text-ink">{aantal}</dd>
                  </div>
                ))}
              </dl>
              <ul className="mt-2 space-y-0.5 text-[11.5px] text-ink">
                <li className="flex justify-between gap-2">
                  <span className="text-ink-muted">Weekenddiensten</span>
                  <span className="tabular">{tegel.weekendDuties}</span>
                </li>
                <li className="flex justify-between gap-2">
                  <span className="text-ink-muted">Nachtreeksen</span>
                  <Nachtreeksen tegel={tegel} />
                </li>
                <li className="flex justify-between gap-2">
                  <span className="text-ink-muted">Zware overgangen</span>
                  <span className={`tabular ${tegel.heavyTransitions > 0 ? "font-semibold text-state-warn" : ""}`}>
                    {tegel.heavyTransitions}
                  </span>
                </li>
                <li className="flex justify-between gap-2">
                  <span className="text-ink-muted">Validatie</span>
                  <span className="text-right">
                    {card.confirmedHardViolations === 0 ? "0 bevestigd (pakket)" : card.statusLabel}
                  </span>
                </li>
              </ul>
              <div className="min-h-3 flex-1" aria-hidden />
              <div className="flex flex-wrap gap-1.5 border-t border-line pt-2">
                <Link
                  href={`/roostercommissie/simulatie/${card.id}/${tegel.code}`}
                  className="inline-flex items-center rounded-md bg-accent-rc px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-ns-blue"
                >
                  Openen
                </Link>
                {bruikbaar ? (
                  <a
                    href={`/roostercommissie/roosterblad/${tegel.code}?kandidaat=${card.id}&formaat=pdf`}
                    className="inline-flex items-center rounded-md border border-line px-2.5 py-1 text-[11.5px] font-semibold text-ink hover:border-line-strong"
                  >
                    Exporteren naar PDF
                  </a>
                ) : null}
              </div>
            </article>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-ink-muted">
          De stip bij de weekomvang is een leeshulp: groen tot 5 minuten van 40:00, oranje tot 30
          minuten, rood daarboven. Geen norm en geen onderdeel van de regeltoetsing. De validatie
          geldt voor het pakket als geheel.
        </p>
      </WidgetCard>

      <div className="mt-4 grid gap-4 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <WidgetCard
            tone="neutral"
            title="Roosterkwaliteit"
            subtitle="Comfort en regelmaat, gemeten zoals bij het huidige rooster — geen juridisch oordeel"
            bodyClassName="border-t border-line p-4"
          >
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Maat</TH>
                    <TH numeric>Deze kandidaat</TH>
                    <TH numeric>Huidig rooster</TH>
                    {lineage.parent ? <TH numeric>Vóór herbouw</TH> : null}
                  </TR>
                </THead>
                <tbody>
                  {subscores.map((entry) => {
                    const eenheid = PERCENTAGE_SCORES.has(entry.key) ? "%" : "";
                    const ouder = ouderScores.get(entry.key) ?? null;
                    const verschil = entry.score !== null && ouder !== null ? Math.round((entry.score - ouder) * 10) / 10 : null;
                    return (
                      <TR key={entry.key}>
                        <TD>
                          <span className="font-medium">{entry.label}</span>
                          <span className="block max-w-[34rem] text-[11px] text-ink-muted">{entry.explanation}</span>
                        </TD>
                        <TD numeric>
                          <span className="font-semibold">{scoreTekst(entry.score, eenheid)}</span>
                        </TD>
                        <TD numeric>{scoreTekst(officieel.get(entry.key) ?? null, eenheid)}</TD>
                        {lineage.parent ? (
                          <TD numeric>
                            {scoreTekst(ouder, eenheid)}
                            {verschil !== null && verschil !== 0 ? (
                              <span className={`ml-1 text-[11px] ${verschil > 0 ? "text-state-ok" : "text-state-warn"}`}>
                                ({verschil > 0 ? "+" : ""}
                                {scoreTekst(verschil)})
                              </span>
                            ) : null}
                          </TD>
                        ) : null}
                      </TR>
                    );
                  })}
                </tbody>
              </Table>
            </div>
            <p className="mt-2 text-[11px] text-ink-muted">
              Nachten: {card.nights.total} in {card.nights.threeOrMore + card.nights.pairs + card.nights.singletons}{" "}
              reeksen — {card.nights.threeOrMore} van drie of meer, {card.nights.pairs} van twee,{" "}
              {card.nights.singletons} losse. Zware overgangen: {card.heavyTransitions}.
            </p>
          </WidgetCard>
        </div>

        <div className="space-y-4 xl:col-span-2">
          <WidgetCard
            icon={<ShieldIcon size={18} />}
            tone="neutral"
            title="Validatie"
            subtitle={validation.validatedAt ? `Onafhankelijk nagerekend ${datumTijd(validation.validatedAt)}` : "Nog niet nagerekend"}
            bodyClassName="border-t border-line p-4"
          >
            <ul className="space-y-1.5 text-[12px]">
              <li className="flex gap-2">
                <span className={card.confirmedHardViolations ? "text-state-error" : "text-state-ok"} aria-hidden>
                  {card.confirmedHardViolations ? "✕" : "✓"}
                </span>
                <span>
                  <strong className="font-semibold">Technische controle:</strong>{" "}
                  {card.confirmedHardViolations === null
                    ? "nog niet uitgevoerd"
                    : `${card.confirmedHardViolations} bevestigde harde overtredingen`}
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-state-warn" aria-hidden>
                  ⚠
                </span>
                <span>
                  <strong className="font-semibold">Onzekerheden:</strong>{" "}
                  {validation.uncertainties.length === 0
                    ? "geen"
                    : [
                        perSoort.get("UNVERIFIED_RULE_SOURCE") ? `${perSoort.get("UNVERIFIED_RULE_SOURCE")} regelgroepen met onbevestigde bron` : null,
                        perSoort.get("MISSING_RULE_CONTEXT") ? `${perSoort.get("MISSING_RULE_CONTEXT")} regels niet volledig te beoordelen` : null,
                        perSoort.get("INSUFFICIENT_HISTORY") ? `${perSoort.get("INSUFFICIENT_HISTORY")} regels met te weinig historie` : null,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                </span>
              </li>
              <li className="flex gap-2">
                <span className={card.publicationEligible ? "text-state-ok" : "text-state-warn"} aria-hidden>
                  {card.publicationEligible ? "✓" : "⚠"}
                </span>
                <span>
                  <strong className="font-semibold">Formele publicatie:</strong>{" "}
                  {card.publicationEligible ? "toegestaan" : "nog niet toegestaan"}
                </span>
              </li>
            </ul>
            {validation.reasons.formal.length > 0 || validation.reasons.uncertainty.length > 0 ? (
              <details className="mt-2">
                <summary className="cursor-pointer text-[11.5px] text-ink-muted hover:text-ink">Details</summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11.5px] text-ink-muted">
                  {[...validation.reasons.formal, ...validation.reasons.uncertainty].map((reden) => (
                    <li key={reden}>{reden}</li>
                  ))}
                </ul>
              </details>
            ) : null}
            {card.publicationEligible && run ? (
              <div className="mt-3 border-t border-line pt-3">
                <ActionForm action={legVastAction} submitLabel="Vastleggen als roosterversie" variant="secondary">
                  <input type="hidden" name="candidateId" value={card.id} />
                  <input type="hidden" name="rosterYear" value={run.rosterYear} />
                </ActionForm>
              </div>
            ) : null}
          </WidgetCard>

          {search ? <Zoektocht search={search} /> : null}

          {lineage.parent || lineage.children.length > 0 ? (
            <WidgetCard tone="neutral" title="Herkomst" bodyClassName="border-t border-line p-4">
              {lineage.parent ? (
                <p className="text-[12px]">
                  Herbouwd uit{" "}
                  <Link href={`/roostercommissie/simulatie/${lineage.parent.id}`} className="font-semibold underline">
                    {lineage.parent.label}
                  </Link>
                  {run?.goals.length ? <> met als doel: {run.goals.join(", ").toLowerCase()}</> : null}.
                  {run?.note ? <span className="block text-ink-muted">Opmerking: “{run.note}”</span> : null}
                </p>
              ) : null}
              {lineage.parent && run?.stageMessage && run.kind === "REBUILD" ? (
                <p className="mt-1.5 text-[12px] text-ink-muted">{run.stageMessage}</p>
              ) : null}
              {lineage.children.length > 0 ? (
                <div className={lineage.parent ? "mt-2" : ""}>
                  <p className="text-[12px] font-semibold text-ink">Herbouwd tot</p>
                  <ul className="mt-1 space-y-0.5 text-[12px]">
                    {lineage.children.map((kind) => (
                      <li key={kind.id} className="flex items-center justify-between gap-2">
                        <Link href={`/roostercommissie/simulatie/${kind.id}`} className="truncate underline">
                          {kind.label}
                        </Link>
                        <span className="shrink-0 text-[11px] text-ink-muted">
                          {kind.statusLabel} · {datumTijd(kind.generatedAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </WidgetCard>
          ) : null}
        </div>
      </div>

      {bruikbaar && !card.archived ? (
        <div className="mt-4" id="opnieuw-bouwen">
          <WidgetCard
            icon={<RefreshIcon size={18} />}
            tone="rc"
            title="Opnieuw bouwen"
            subtitle="Een nieuwe versie van dit hele pakket, gericht verbeterd. Deze kandidaat blijft bestaan."
            bodyClassName="border-t border-line p-4"
          >
            <ActionForm action={herbouwAction} submitLabel="Opnieuw bouwen" pendingLabel="Opdracht starten…">
              <input type="hidden" name="candidateId" value={card.id} />
              <fieldset>
                <legend className="text-[12.5px] font-semibold text-ink">Wat moet beter?</legend>
                <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {(Object.keys(REBUILD_GOAL_LABELS) as RebuildGoal[])
                    .filter((goal) => goal !== "KEEP_GOOD_PARTS")
                    .map((goal) => (
                      <label key={goal} className="flex items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-[12.5px] text-ink hover:border-line-strong">
                        <input type="checkbox" name="goals" value={goal} />
                        {REBUILD_GOAL_LABELS[goal]}
                      </label>
                    ))}
                </div>
              </fieldset>
              <label className="flex items-start gap-2 text-[12.5px] text-ink">
                <input type="checkbox" name="preserveGoodParts" defaultChecked className="mt-0.5" />
                <span>
                  {REBUILD_GOAL_LABELS.KEEP_GOOD_PARTS}
                  <span className="block text-[11.5px] text-ink-muted">
                    De huidige indeling is het vertrekpunt; afwijken kost de optimizer iets, zodat alleen
                    verandert wat voor de gekozen punten nodig is.
                  </span>
                </span>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12.5px] font-semibold text-ink">Opmerking (optioneel)</span>
                <textarea name="note" rows={2} maxLength={1000} className={inputClass} placeholder="Bijvoorbeeld: bespreking commissie 12 oktober" />
                <span className="text-[11px] text-ink-muted">
                  Wordt bewaard in de herkomst en het auditlog. De optimizer leest deze tekst niet; alleen
                  de aangevinkte punten sturen de berekening.
                </span>
              </label>
              <p className="text-[11.5px] text-ink-muted">
                De herbouw loopt als opdracht op de achtergrond, met dezelfde validatie als een nieuwe
                generatie. U gaat naar het generatiescherm om de voortgang te volgen.
              </p>
            </ActionForm>
          </WidgetCard>
        </div>
      ) : null}

      <details className="mt-4 rounded-xl border border-line bg-surface px-4 py-3">
        <summary className="cursor-pointer text-[12px] text-ink-muted hover:text-ink">Technische details</summary>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-[11.5px]">
          <dt className="text-ink-muted">Kandidaat</dt>
          <dd className="font-mono">{card.id}</dd>
          <dt className="text-ink-muted">Label</dt>
          <dd>{card.label}</dd>
          <dt className="text-ink-muted">Strategie</dt>
          <dd className="font-mono">{card.strategyKey}</dd>
          <dt className="text-ink-muted">Validatiestatus</dt>
          <dd className="font-mono">{validation.state}</dd>
          {run ? (
            <>
              <dt className="text-ink-muted">Opdracht</dt>
              <dd className="font-mono">{run.id}</dd>
            </>
          ) : null}
          <dt className="text-ink-muted">Actueel</dt>
          <dd>{card.stale ? <Badge tone="warn">gebaseerd op oudere gegevens</Badge> : "ja"}</dd>
        </dl>
      </details>
    </RosterCommitteeShell>
  );
}

/**
 * Hoe de zoekmachine aan deze kandidaat kwam.
 *
 * ## Waarom dit op het scherm staat
 *
 * De machine onderzoekt duizenden varianten en laat er drie zien. Zonder uitleg
 * is dat een orakel. Hier staat wat er van die zoektocht bewaard is: welke
 * poging het was, waar hij het van won, en waar hij zelf zwak is. Alles komt uit
 * de opgeslagen herkomst; staat er niets, dan staat er ook niets.
 */
function Zoektocht({ search }: { search: NonNullable<Awaited<ReturnType<typeof candidatePackage>>["search"]> }) {
  const onderdelen = search.components.filter((entry) => entry.score !== null);
  return (
    <WidgetCard tone="neutral" title="Waarom deze kandidaat" bodyClassName="border-t border-line p-4">
      {search.whySurvived.length > 0 ? (
        <ul className="space-y-1 text-[12px]">
          {search.whySurvived.map((regel) => (
            <li key={regel} className="flex gap-1.5">
              <span aria-hidden className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent-rc" />
              <span>{regel}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-ink-muted">
          Voor deze kandidaat is geen zoekverslag bewaard; hij komt uit de klassieke zoekmachine.
        </p>
      )}

      {onderdelen.length > 0 ? (
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Kwaliteitsopbouw</p>
          <dl className="mt-1.5 space-y-1">
            {onderdelen.map((entry) => (
              <div key={entry.key} className="flex items-center gap-2">
                <dt className="w-[42%] shrink-0 text-[12px]">{entry.label}</dt>
                <dd className="flex flex-1 items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-canvas ring-1 ring-line">
                    <div
                      className="h-full rounded-full bg-accent-rc"
                      style={{ width: `${Math.max(0, Math.min(100, entry.score ?? 0))}%` }}
                    />
                  </div>
                  <span className="tabular w-9 shrink-0 text-right text-[11.5px] font-semibold">
                    {Math.round(entry.score ?? 0)}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
          {search.worstLine ? (
            <p className="mt-2 text-[11.5px] text-ink-muted">
              Zwakste roosterregel: {search.worstLine.roster} regel {search.worstLine.lineNumber} (
              {Math.round(search.worstLine.score ?? 0)} van 100). Die regel telt apart mee, zodat een goed
              gemiddelde geen slechte regel kan verbergen.
            </p>
          ) : null}
        </div>
      ) : null}

      {search.explanations.length > 0 ? (
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            Waar deze kandidaat zwak is
          </p>
          <ul className="mt-1.5 space-y-1.5 text-[12px]">
            {search.explanations.map((uitleg) => (
              <li key={`${uitleg.title}-${uitleg.detail}`}>
                <span className="font-semibold">{uitleg.title}</span>
                <span className="block text-ink-muted">{uitleg.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-3 border-t border-line pt-2 text-[12px] text-ink-muted">
        Dit is de <strong className="font-semibold text-ink">beste gevonden kandidaat</strong> binnen de
        gekozen rekentijd, niet het best mogelijke rooster: het aantal mogelijke roosters is te groot om
        allemaal door te rekenen. Wat er ligt is wel volledig doorgerekend en onafhankelijk gevalideerd.
      </p>

      <p className="mt-2 text-[11px] text-ink-faint">
        {search.modeLabel ? `Zoekmodus ${search.modeLabel}` : "Zoekmodus onbekend"}
        {search.attempt !== null ? ` · poging ${search.attempt}` : ""}
        {search.seed !== null ? ` · zaadwaarde ${search.seed}` : ""}
        {search.paretoFront ? " · op het Pareto-front" : ""}
        {search.qualityModelVersion ? ` · kwaliteitsmodel ${search.qualityModelVersion}` : ""}
      </p>
    </WidgetCard>
  );
}
