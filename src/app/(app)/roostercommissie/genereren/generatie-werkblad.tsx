"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import type { GenerationRunJson, ProgressStep } from "@/domain/generation-progress";
import { Alert, Badge, Button, type Tone, inputClass } from "@/components/ui/primitives";
import { startGeneratieAction, stopGeneratieAction } from "./acties";

/**
 * Een generatieopdracht geven en volgen.
 *
 * ## Waarom de voortgang van de server komt
 *
 * De opdracht draait op de server en staat in de database. Dit scherm vraagt
 * alleen op hoe het ervoor staat. Verversen, wegklikken of de laptop even
 * dichtdoen verandert niets aan de opdracht; bij terugkomst vindt het scherm
 * hem terug.
 *
 * ## Waarom de balk soms stilstaat
 *
 * Het percentage is het deel van de werkelijke stappen dat klaar is. Tijdens
 * het opbouwen van een kandidaat rekent de solver een minuut of langer zonder
 * tussenstand, en dan staat de balk die minuut stil. De tekst eronder zegt wat
 * er gebeurt, en de klok loopt door.
 */

export interface StrategyTile {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly primary: boolean;
  readonly candidates: number;
}

export interface YearOption {
  readonly year: number;
  readonly label: string;
  readonly period: string;
}

export interface ModeOption {
  readonly key: string;
  readonly label: string;
  readonly duration: string;
  readonly description: string;
}

const PEILING_MS = 2000;

/**
 * De standaardgeneratie.
 *
 * Vier gelijkwaardige tegels vroegen van de gebruiker een keuze die hij niet
 * kan onderbouwen: de verschillen tussen de strategieën zijn in het resultaat
 * klein en in de uitleg abstract. Eén opdracht met de best gemeten
 * standaardstrategie is de gewone weg; wie een accent wil verleggen, kiest dat
 * alsnog — de strategieën zijn er nog en werken onveranderd.
 */
const STANDAARDSTRATEGIE = "BALANCED";

const tot = (aantal: number) => (aantal === 1 ? "één" : `${aantal}`);

export function GeneratieWerkblad({
  strategies,
  years,
  modes,
  defaultMode,
  defaultYear,
  initialRun,
}: {
  strategies: readonly StrategyTile[];
  years: readonly YearOption[];
  modes: readonly ModeOption[];
  defaultMode: string;
  defaultYear: number;
  initialRun: GenerationRunJson | null;
}) {
  const router = useRouter();
  const [strategie, setStrategie] = useState<string>(
    strategies.find((entry) => entry.key === "BALANCED")?.key ?? strategies[0]?.key ?? "",
  );
  const [modus, setModus] = useState<string>(
    modes.find((entry) => entry.key === defaultMode)?.key ?? modes[0]?.key ?? "",
  );
  const [jaar, setJaar] = useState<number>(defaultYear);
  const [run, setRun] = useState<GenerationRunJson | null>(initialRun);
  const [fout, setFout] = useState<string | null>(null);
  const [verbindingHapert, setVerbindingHapert] = useState(false);
  const [starten, startTransition] = useTransition();

  const volg = useCallback(async (runId: string) => {
    try {
      const antwoord = await fetch(`/roostercommissie/genereren/voortgang?run=${encodeURIComponent(runId)}`, {
        cache: "no-store",
      });
      if (!antwoord.ok) {
        setVerbindingHapert(true);
        return null;
      }
      const body = (await antwoord.json()) as { run: GenerationRunJson | null };
      setVerbindingHapert(false);
      if (body.run) {
        setRun(body.run);
      }
      return body.run;
    } catch {
      setVerbindingHapert(true);
      return null;
    }
  }, []);

  const actiefId = run?.active ? run.id : null;
  useEffect(() => {
    if (!actiefId) {
      return;
    }
    let gestopt = false;
    const timer = setInterval(() => {
      void volg(actiefId).then((bijgewerkt) => {
        if (!gestopt && bijgewerkt && !bijgewerkt.active) {
          // Klaar: de lijst met recente opdrachten ernaast mag mee.
          router.refresh();
        }
      });
    }, PEILING_MS);
    return () => {
      gestopt = true;
      clearInterval(timer);
    };
  }, [actiefId, volg, router]);

  const start = () => {
    setFout(null);
    startTransition(async () => {
      const uitkomst = await startGeneratieAction({
        strategy: strategie,
        rosterYear: jaar,
        mode: modus || null,
      });
      if (uitkomst.ok) {
        await volg(uitkomst.runId);
        router.refresh();
        return;
      }
      setFout(uitkomst.error);
      if (uitkomst.activeRunId) {
        await volg(uitkomst.activeRunId);
      }
    });
  };

  if (run) {
    return (
      <Voortgang
        run={run}
        verbindingHapert={verbindingHapert}
        melding={fout}
        onNieuw={() => {
          setRun(null);
          setFout(null);
        }}
      />
    );
  }

  const hoofd = strategies.filter((entry) => entry.primary);
  const meer = strategies.filter((entry) => !entry.primary);
  const gekozen = strategies.find((entry) => entry.key === strategie);
  const gekozenJaar = years.find((entry) => entry.year === jaar);

  const standaard = strategies.find((entry) => entry.key === STANDAARDSTRATEGIE);
  const afwijkend = standaard ? strategie !== standaard.key : false;

  return (
    <div className="space-y-5">
      {/* ── De gewone weg ─────────────────────────────────────────────────
          Eén opdracht met de standaardstrategie. De losse strategieën zijn er
          nog — ze werken en ze zijn gemeten — maar ze zijn geen eerste keuze
          meer: wie ze nodig heeft, weet ze te vinden, en wie ze niet nodig
          heeft, hoeft er niet eerst iets van te vinden. */}
      {standaard && !afwijkend ? (
        <div className="rounded-lg border border-accent-rc/40 bg-accent-rc-soft/40 p-4">
          <p className="text-[13.5px] font-semibold text-ink-strong">{standaard.label}</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink">{standaard.description}</p>
          <p className="mt-2 text-[11.5px] text-ink-muted">
            De zoekmachine kiest zelf hoeveel varianten ze naast elkaar zet en waar ze bijstuurt.
            Alle {tot(standaard.candidates)} kandidaten worden onafhankelijk gevalideerd; er wordt
            niets vervangen of gepubliceerd.
          </p>
        </div>
      ) : null}

      <details className="group" open={afwijkend}>
        <summary className="cursor-pointer select-none text-[12.5px] font-semibold text-accent-rc hover:underline">
          Een andere strategie kiezen ({strategies.length})
        </summary>
        <fieldset className="mt-3">
          <legend className="sr-only">Strategie</legend>
          <p className="text-[12px] text-ink-muted">
            Elke strategie werkt met hetzelfde dienstenpakket en dezelfde harde regels. Alleen de
            accenten in de optimalisatie verschillen.
          </p>
          <div role="radiogroup" aria-label="Strategie" className="mt-3 grid gap-2.5 sm:grid-cols-2">
            {hoofd.map((tile) => (
              <Tegel key={tile.key} tile={tile} gekozen={tile.key === strategie} onKies={setStrategie} />
            ))}
          </div>

          {meer.length > 0 ? (
            <div role="radiogroup" aria-label="Meer strategieën" className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
              {meer.map((tile) => (
                <Tegel
                  key={tile.key}
                  tile={tile}
                  gekozen={tile.key === strategie}
                  onKies={setStrategie}
                  compact
                />
              ))}
            </div>
          ) : null}
        </fieldset>
      </details>

      {modes.length > 0 ? (
        <details className="group border-t border-line pt-4" open={modus !== defaultMode}>
          <summary className="cursor-pointer select-none text-[12.5px] font-semibold text-accent-rc hover:underline">
            Rekentijd instellen ({modes.find((m) => m.key === modus)?.label ?? modus})
          </summary>
          <fieldset className="mt-3">
            <legend className="sr-only">Hoe grondig mag gezocht worden?</legend>
            <p className="text-[12px] text-ink-muted">
              Langer zoeken betekent meer varianten naast elkaar en meer verbeterrondes, niet andere
              regels. Wat mag en moet, verandert niet mee.
            </p>
          <div role="radiogroup" aria-label="Rekentijd" className="mt-3 grid gap-2.5 sm:grid-cols-2">
            {modes.map((optie) => (
              <button
                key={optie.key}
                type="button"
                role="radio"
                aria-checked={optie.key === modus}
                onClick={() => setModus(optie.key)}
                className={`flex h-full flex-col rounded-lg border p-3 text-left transition-colors focus-visible:outline-2 ${
                  optie.key === modus
                    ? "border-accent-rc bg-accent-rc-soft/60 ring-1 ring-accent-rc"
                    : "border-line bg-surface hover:border-line-strong hover:bg-canvas"
                }`}
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="text-[13px] font-semibold text-ink-strong">{optie.label}</span>
                  <span
                    aria-hidden
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                      optie.key === modus ? "border-accent-rc bg-accent-rc" : "border-line-strong bg-surface"
                    }`}
                  >
                    {optie.key === modus ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
                  </span>
                </span>
                <span className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">{optie.description}</span>
                <span className="mt-auto pt-2 text-[11px] font-medium text-ink-faint">{optie.duration}</span>
              </button>
            ))}
            </div>
          </fieldset>
        </details>
      ) : null}

      <div className="grid gap-3 border-t border-line pt-4 sm:grid-cols-[minmax(0,14rem)_1fr] sm:items-end">
        <label className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold text-ink-strong">Roosterjaar</span>
          <select
            value={jaar}
            onChange={(event) => setJaar(Number(event.target.value))}
            className={inputClass}
          >
            {years.map((option) => (
              <option key={option.year} value={option.year}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <p className="text-[12px] text-ink-muted">
          {gekozenJaar ? `Periode: ${gekozenJaar.period}.` : null} Het roosterjaar wordt bij de
          kandidaten bewaard; de roosterstructuur zelf is een cyclus en verandert er niet door.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-line bg-canvas p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-[12.5px] text-ink">
          <p className="font-semibold">
            {gekozen?.label ?? "Geen strategie gekozen"}
            {gekozen ? (
              <span className="font-normal text-ink-muted">
                {" "}
                —{" "}
                {gekozen.candidates === 1
                  ? "één referentiekandidaat"
                  : `tot ${gekozen.candidates} verschillende kandidaten`}
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 text-[11.5px] text-ink-muted">
            Dit duurt enkele minuten. U kunt dit scherm verlaten of verversen; de opdracht loopt
            door en is hier terug te vinden.
          </p>
        </div>
        <Button type="button" disabled={starten || !gekozen} onClick={start}>
          {starten ? "Opdracht starten…" : "Genereren starten"}
        </Button>
      </div>

      {fout ? <Alert tone="error" title={fout} /> : null}
    </div>
  );
}

function Tegel({
  tile,
  gekozen,
  onKies,
  compact = false,
}: {
  tile: StrategyTile;
  gekozen: boolean;
  onKies: (key: string) => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={gekozen}
      aria-label={tile.label}
      onClick={() => onKies(tile.key)}
      className={`flex h-full flex-col rounded-lg border p-3 text-left transition-colors focus-visible:outline-2 ${
        gekozen
          ? "border-accent-rc bg-accent-rc-soft/60 ring-1 ring-accent-rc"
          : "border-line bg-surface hover:border-line-strong hover:bg-canvas"
      }`}
    >
      <span className="flex items-start justify-between gap-2">
        <span className={`font-semibold text-ink-strong ${compact ? "text-[13px]" : "text-[14px]"}`}>
          {tile.label}
        </span>
        <span
          aria-hidden
          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
            gekozen ? "border-accent-rc bg-accent-rc" : "border-line-strong bg-surface"
          }`}
        >
          {gekozen ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
        </span>
      </span>
      <span className={`mt-1 text-ink-muted ${compact ? "text-[11.5px]" : "text-[12px]"} leading-relaxed`}>
        {tile.description}
      </span>
      <span className="mt-auto pt-2 text-[11px] font-medium text-ink-faint">
        {tile.candidates === 1 ? "1 referentiekandidaat" : `Tot ${tile.candidates} kandidaten`}
      </span>
    </button>
  );
}

// ── Wat de zoektocht doet ────────────────────────────────────────────────────

/**
 * De tellers van de adaptieve zoektocht.
 *
 * Geen versierde getallen: dit is wat er werkelijk is gebeurd. "Onderzocht"
 * telt elke variant die volledig is beoordeeld — de complete roosters van de
 * solver én elke ruil die tijdens het bijschaven is doorgerekend. "Geldig" zijn
 * de kandidaten die door de eindvalidatie kwamen; wat afvalt, valt af.
 */
function Zoekstand({
  run,
  search,
}: {
  run: GenerationRunJson;
  search: NonNullable<GenerationRunJson["search"]>;
}) {
  const getal = (waarde: number) => waarde.toLocaleString("nl-NL");
  const cellen = [
    { label: "varianten onderzocht", waarde: getal(search.variants) },
    { label: "volledige roosters berekend", waarde: getal(search.attempts) },
    { label: "gerichte verbeterrondes", waarde: getal(search.repairs) },
    { label: "geldige kandidaten", waarde: getal(search.validCandidates) },
  ];
  return (
    <div className="rounded-lg border border-line bg-canvas px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
          Zoektocht{run.searchMode ? ` · ${MODUS_LABEL[run.searchMode] ?? run.searchMode}` : ""}
        </p>
        {search.budgetSeconds > 0 ? (
          <p className="text-[11px] text-ink-faint">
            <span className="tabular">{klokTekst(search.elapsedSeconds)}</span> van maximaal{" "}
            <span className="tabular">{klokTekst(search.budgetSeconds)}</span> rekentijd
          </p>
        ) : null}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {cellen.map((cel) => (
          <div key={cel.label}>
            <dt className="text-[11px] text-ink-muted">{cel.label}</dt>
            <dd className="tabular text-[17px] font-semibold leading-tight text-ink-strong">{cel.waarde}</dd>
          </div>
        ))}
      </dl>
      {!run.active && search.stopReason ? (
        <p className="mt-2 text-[11.5px] text-ink-muted">Gestopt omdat: {search.stopReason}.</p>
      ) : null}
    </div>
  );
}

const MODUS_LABEL: Record<string, string> = {
  FAST: "Snel",
  NORMAL: "Normaal",
  DEEP: "Grondig",
  EXTENSIVE: "Zeer grondig",
};

// ── Voortgang ────────────────────────────────────────────────────────────────

const STATUS_TONE: Record<string, Tone> = {
  QUEUED: "info",
  RUNNING: "info",
  COMPLETED: "ok",
  PARTIAL: "warn",
  FAILED: "error",
  CANCELLED: "neutral",
  INTERRUPTED: "warn",
};

function Voortgang({
  run,
  verbindingHapert,
  melding,
  onNieuw,
}: {
  run: GenerationRunJson;
  verbindingHapert: boolean;
  melding: string | null;
  onNieuw: () => void;
}) {
  const [nu, setNu] = useState(() => Date.now());
  const [bevestigStop, setBevestigStop] = useState(false);
  const [stopFout, setStopFout] = useState<string | null>(null);
  const [stoppen, stopTransition] = useTransition();

  useEffect(() => {
    if (!run.active) {
      return;
    }
    const klok = setInterval(() => setNu(Date.now()), 1000);
    return () => clearInterval(klok);
  }, [run.active]);

  const begin = run.startedAt ?? run.createdAt;
  const einde = run.finishedAt ? Date.parse(run.finishedAt) : nu;
  const seconden = Math.max(0, Math.round((einde - Date.parse(begin)) / 1000));
  const stappen = run.progress?.steps ?? [];
  const klaar = stappen.filter((step) => step.state === "done" || step.state === "skipped").length;
  const groepen = groepeer(stappen);

  const stop = () => {
    setStopFout(null);
    stopTransition(async () => {
      const uitkomst = await stopGeneratieAction(run.id);
      if (uitkomst.error) {
        setStopFout(uitkomst.error);
      }
      setBevestigStop(false);
    });
  };

  return (
    <div className="space-y-4">
      {melding ? <Alert tone="info" title={melding}>Hieronder staat de opdracht die al loopt.</Alert> : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[15px] font-semibold text-ink-strong">
            {run.kind === "REBUILD" ? "Herbouw" : run.strategyLabel}
            <span className="font-normal text-ink-muted"> · roosterjaar {run.rosterYear}</span>
          </p>
          <p className="mt-0.5 text-[12px] text-ink-muted">
            {run.kind === "REBUILD"
              ? `${run.strategyLabel} — gericht verbeteren`
              : run.requestedCandidates === 1
                ? "Eén kandidaat"
                : `Tot ${run.requestedCandidates} kandidaten`}
            {" · "}
            <span className="tabular">{klokTekst(seconden)}</span>
          </p>
        </div>
        <Badge tone={STATUS_TONE[run.status] ?? "neutral"}>{run.statusLabel}</Badge>
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <p className="tabular text-[28px] font-bold leading-none text-ink-strong">{run.percentage}%</p>
          <p className="text-[12px] text-ink-muted">
            {klaar} van {stappen.length} stappen afgerond · {run.foundCandidates} van{" "}
            {run.requestedCandidates} {run.requestedCandidates === 1 ? "kandidaat" : "kandidaten"} gevonden
          </p>
        </div>
        <div
          className="mt-2 h-2.5 overflow-hidden rounded-full bg-canvas ring-1 ring-line"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={run.percentage}
          aria-label="Voortgang van de generatie"
        >
          <div
            className={`h-full rounded-full transition-[width] duration-700 ${
              run.status === "FAILED" ? "bg-state-error" : run.status === "CANCELLED" ? "bg-ink-faint" : "bg-accent-rc"
            }`}
            style={{ width: `${run.percentage}%` }}
          />
        </div>
        {run.stageMessage ? (
          <p className="mt-2 text-[13px] text-ink" aria-live="polite">
            {run.stageMessage}
          </p>
        ) : null}
        {run.active && run.progress && run.progress.attempt > (run.progress.currentCandidate ?? 0) ? (
          <p className="mt-0.5 text-[11.5px] text-ink-muted">
            Poging {run.progress.attempt}: een eerdere poging leverde geen bruikbare of geen afwijkende
            kandidaat op en telt niet mee.
          </p>
        ) : null}
        {verbindingHapert ? (
          <p className="mt-1 text-[11.5px] text-state-warn">
            De stand kon even niet worden opgehaald. De opdracht zelf loopt op de server door.
          </p>
        ) : null}
      </div>

      {run.search ? <Zoekstand run={run} search={run.search} /> : null}

      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {groepen.map((groep) => (
          <li key={groep.titel} className="rounded-lg border border-line bg-surface px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{groep.titel}</p>
            <ul className="mt-1 space-y-0.5">
              {groep.stappen.map((step) => (
                <Stap key={step.key} step={step} />
              ))}
            </ul>
          </li>
        ))}
      </ol>

      {run.active ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          {run.cancelRequested ? (
            <p className="text-[12.5px] text-ink-muted">
              Stoppen is doorgegeven. De lopende berekening wordt beëindigd.
            </p>
          ) : bevestigStop ? (
            <>
              <p className="text-[12.5px] text-ink">
                Stoppen? Kandidaten die al volledig zijn gevalideerd en opgeslagen, blijven bewaard.
              </p>
              <Button type="button" variant="danger" size="small" disabled={stoppen} onClick={stop}>
                {stoppen ? "Stoppen…" : "Ja, stoppen"}
              </Button>
              <Button type="button" variant="secondary" size="small" onClick={() => setBevestigStop(false)}>
                Doorgaan
              </Button>
            </>
          ) : (
            <Button type="button" variant="secondary" size="small" onClick={() => setBevestigStop(true)}>
              Generatie stoppen
            </Button>
          )}
          {stopFout ? <p className="text-[12px] text-state-error">{stopFout}</p> : null}
        </div>
      ) : (
        <Uitkomst run={run} onNieuw={onNieuw} />
      )}
    </div>
  );
}

function Uitkomst({ run, onNieuw }: { run: GenerationRunJson; onNieuw: () => void }) {
  const tone: Tone =
    run.status === "COMPLETED" ? "ok" : run.status === "FAILED" ? "error" : run.status === "CANCELLED" ? "neutral" : "warn";
  const titel =
    run.status === "COMPLETED"
      ? run.foundCandidates === 1
        ? "De kandidaat staat klaar."
        : `${run.foundCandidates} kandidaten staan klaar.`
      : run.status === "PARTIAL"
        ? `${run.foundCandidates} van ${run.requestedCandidates} geldige kandidaten gevonden.`
        : run.status === "CANCELLED"
          ? "De generatie is gestopt."
          : run.status === "INTERRUPTED"
            ? "De generatie is onderbroken."
            : "Er is geen geldige kandidaat gevonden.";

  return (
    <div className="space-y-3 border-t border-line pt-3">
      <Alert tone={tone} title={titel}>
        {run.status === "COMPLETED"
          ? `${run.kind === "REBUILD" && run.stageMessage ? `${run.stageMessage} ` : ""}${
              run.foundCandidates === 1 ? "De kandidaat is" : "Elke kandidaat is"
            } compleet, onafhankelijk gevalideerd en heeft nul bevestigde harde overtredingen.`
          : (run.failureReason ?? run.stageMessage)}
      </Alert>
      <div className="flex flex-wrap gap-2">
        {run.foundCandidates > 0 ? (
          <Link
            href={`/roostercommissie/simulatie?run=${run.id}`}
            className="inline-flex items-center rounded-lg bg-accent-rc px-3.5 py-2 text-[12.5px] font-semibold text-white hover:bg-ns-blue"
          >
            Resultaten bekijken
          </Link>
        ) : null}
        <Button type="button" variant="secondary" onClick={onNieuw}>
          Nieuwe opdracht
        </Button>
      </div>
    </div>
  );
}

function Stap({ step }: { step: ProgressStep }) {
  const teken = {
    done: { merk: "✓", kleur: "text-state-ok", tekst: "text-ink" },
    active: { merk: "●", kleur: "text-accent-rc motion-safe:animate-pulse", tekst: "font-semibold text-ink-strong" },
    pending: { merk: "○", kleur: "text-ink-faint", tekst: "text-ink-muted" },
    skipped: { merk: "–", kleur: "text-ink-faint", tekst: "text-ink-faint" },
    failed: { merk: "✕", kleur: "text-state-error", tekst: "text-ink-muted" },
  }[step.state];
  const toelichting =
    step.state === "skipped" ? " (niet nodig)" : step.state === "failed" ? " (afgekeurd, nieuwe poging)" : "";
  return (
    <li className="flex gap-1.5 text-[12px] leading-snug">
      <span aria-hidden className={`w-3 shrink-0 text-center font-semibold ${teken.kleur}`}>
        {teken.merk}
      </span>
      <span className={teken.tekst}>
        {step.label}
        <span className="sr-only"> — {STAP_STATUS[step.state]}</span>
        {toelichting ? <span className="text-ink-faint">{toelichting}</span> : null}
      </span>
    </li>
  );
}

const STAP_STATUS: Record<ProgressStep["state"], string> = {
  done: "klaar",
  active: "bezig",
  pending: "nog te doen",
  skipped: "overgeslagen",
  failed: "afgekeurd",
};

function groepeer(stappen: readonly ProgressStep[]): { titel: string; stappen: ProgressStep[] }[] {
  const groepen: { titel: string; stappen: ProgressStep[] }[] = [];
  for (const step of stappen) {
    const nummer = /_(\d+)$/.exec(step.key)?.[1];
    const titel = nummer
      ? stappen.filter((entry) => entry.key.startsWith("SOLVE_")).length > 1
        ? `Kandidaat ${nummer}`
        : "Kandidaat"
      : step.key === "FINISH"
        ? "Afronden"
        : "Voorbereiden";
    const laatste = groepen.at(-1);
    if (laatste && laatste.titel === titel) {
      laatste.stappen.push(step);
    } else {
      groepen.push({ titel, stappen: [step] });
    }
  }
  return groepen;
}

function klokTekst(seconden: number): string {
  const minuten = Math.floor(seconden / 60);
  return `${minuten}:${String(seconden % 60).padStart(2, "0")} verstreken`;
}
