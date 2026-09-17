import Link from "next/link";
import type { ReactNode } from "react";
import type { CandidateCard, RosterTile } from "@/server/services/candidate-results-service";
import { Badge, type Tone } from "@/components/ui/primitives";
import { StarIcon } from "@/components/ui/icons";

/**
 * Gedeelde weergave voor de resultaten: kandidaatkaarten, scores en uren.
 *
 * ## Waarom "Roosterkwaliteit" en geen "score"
 *
 * De getallen hier zeggen iets over comfort en regelmaat: nachten in reeksen,
 * rustige overgangen, uren rond 40:00, een eerlijke verdeling. Ze zeggen niets
 * over rechtmatigheid. Die komt uit de eindvalidatie en staat er apart bij, met
 * een eigen teken. Een hoge roosterkwaliteit maakt een overtreding niet goed.
 */

const NL = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 1, minimumFractionDigits: 0 });

export function scoreTekst(score: number | null, eenheid: "%" | "" = ""): string {
  return score === null ? "—" : `${NL.format(score)}${eenheid}`;
}

export function afwijkingTekst(minuten: number): string {
  const teken = minuten > 0 ? "+" : minuten < 0 ? "−" : "±";
  const grootte = Math.abs(Math.round(minuten));
  return `${teken}${Math.floor(grootte / 60)}:${String(grootte % 60).padStart(2, "0")}`;
}

export function datumTijd(moment: Date): string {
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(moment);
}

/** Welke subscore als percentage leest en welke als score van 0–100. */
export const PERCENTAGE_SCORES = new Set(["coverage", "restQuality", "transitionQuality", "nightClustering", "changeImpact"]);

export function naamVan(kaart: CandidateCard): string {
  if (kaart.kind === "REBUILD") {
    return "Herbouw";
  }
  return kaart.number !== null ? `Kandidaat ${kaart.number}` : kaart.label;
}

export function StatusBadge({ kaart }: { kaart: CandidateCard }) {
  return <Badge tone={kaart.statusTone as Tone}>{kaart.statusLabel}</Badge>;
}

export function VoorkeurBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-accent-rc/30 bg-accent-rc-soft px-1.5 py-0.5 text-[11px] font-semibold text-accent-rc">
      <StarIcon size={12} aria-hidden />
      Voorkeurskandidaat
    </span>
  );
}

/**
 * Eén kandidaat als kaart.
 *
 * De cijfers die de commissie als eerste wil zien: is alles geplaatst, is er
 * een bewezen overtreding, hoe dicht zit het bij 40:00, en hoe prettig rijdt
 * het rooster. De rest staat in het pakket zelf.
 */
export function KandidaatKaart({
  kaart,
  vergelijkForm,
  gekozen = false,
  extra,
}: {
  kaart: CandidateCard;
  /** Het formulier waar het vergelijkvinkje bij hoort; zonder vinkje als dit ontbreekt. */
  vergelijkForm?: string;
  gekozen?: boolean;
  extra?: ReactNode;
}) {
  const bruikbaar = kaart.status === "GEREED" || kaart.status === "VEROUDERD";
  return (
    <article
      className={`flex flex-col rounded-lg border bg-surface p-3 ${
        kaart.preferred ? "border-accent-rc ring-1 ring-accent-rc/40" : "border-line"
      }`}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold text-ink-strong">{naamVan(kaart)}</h3>
          <p className="truncate text-[11.5px] text-ink-muted" title={kaart.label}>
            {kaart.legacy ? "Legacy kandidaat · " : ""}
            {kaart.strategyLabel}
            {kaart.rosterYear ? ` · roosterjaar ${kaart.rosterYear}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusBadge kaart={kaart} />
          {kaart.preferred ? <VoorkeurBadge /> : null}
        </div>
      </header>

      {kaart.parent ? (
        <p className="mt-1 text-[11px] text-ink-muted">
          Herbouwd uit{" "}
          <Link href={`/roostercommissie/simulatie/${kaart.parent.id}`} className="underline">
            {kaart.parent.label}
          </Link>
        </p>
      ) : null}

      <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11.5px]">
        <Cijfer
          label="Diensten geplaatst"
          waarde={`${kaart.coverage.placed}/${kaart.coverage.required}`}
          tone={kaart.coverage.placed < kaart.coverage.required ? "warn" : undefined}
        />
        <Cijfer
          label="Bevestigde overtredingen"
          waarde={kaart.confirmedHardViolations === null ? "niet getoetst" : String(kaart.confirmedHardViolations)}
          tone={kaart.confirmedHardViolations ? "error" : undefined}
        />
        <Cijfer
          label="Uren t.o.v. 40:00"
          waarde={`gem. ${kaart.averageHoursDeviationMinutes} min`}
          toelichting={`grootste ${kaart.maxHoursDeviationMinutes} min`}
        />
        <Cijfer label="Nachtclustering" waarde={scoreTekst(kaart.scores.nightClustering, "%")} />
        <Cijfer label="Overgangskwaliteit" waarde={scoreTekst(kaart.scores.transitionQuality, "%")} />
        <Cijfer label="Eerlijke rangeerverdeling" waarde={scoreTekst(kaart.scores.shuntingFairness)} />
      </dl>

      <p className="mt-2 text-[11px] leading-snug text-ink-muted">{kaart.statusDetail}</p>

      <div className="min-h-3 flex-1" aria-hidden />
      <footer className="flex flex-wrap items-center gap-1.5 border-t border-line pt-2.5">
        <Link
          href={`/roostercommissie/simulatie/${kaart.id}`}
          className="inline-flex items-center rounded-md bg-accent-rc px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-ns-blue"
        >
          Openen
        </Link>
        {vergelijkForm && bruikbaar ? (
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-line px-2 py-1 text-[11.5px] font-semibold text-ink hover:border-line-strong">
            <input type="checkbox" form={vergelijkForm} name="k" value={kaart.id} defaultChecked={gekozen} />
            Vergelijken
          </label>
        ) : null}
        {bruikbaar && !kaart.archived ? (
          <Link
            href={`/roostercommissie/simulatie/${kaart.id}#opnieuw-bouwen`}
            className="inline-flex items-center rounded-md border border-line px-2.5 py-1 text-[11.5px] font-semibold text-ink hover:border-line-strong"
          >
            Opnieuw bouwen
          </Link>
        ) : null}
        {extra}
      </footer>
    </article>
  );
}

export function Cijfer({
  label,
  waarde,
  toelichting,
  tone,
}: {
  label: string;
  waarde: string;
  toelichting?: string;
  tone?: "warn" | "error" | "ok";
}) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[10px] uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd
        className={`tabular font-semibold ${
          tone === "error" ? "text-state-error" : tone === "warn" ? "text-state-warn" : tone === "ok" ? "text-state-ok" : "text-ink"
        }`}
      >
        {waarde}
        {toelichting ? <span className="ml-1 font-normal text-ink-muted">({toelichting})</span> : null}
      </dd>
    </div>
  );
}

/** De urenstip: een leeshulp, geen norm. */
export function UrenStip({ afwijking }: { afwijking: number }) {
  const grootte = Math.abs(afwijking);
  const kleur = grootte <= 5 ? "bg-state-ok" : grootte <= 30 ? "bg-state-warn" : "bg-state-error";
  return <span aria-hidden className={`inline-block h-2 w-2 shrink-0 rounded-full ${kleur}`} />;
}

export function Nachtreeksen({ tegel }: { tegel: RosterTile }) {
  if (tegel.night === 0) {
    return <span className="text-ink-faint">geen nachten</span>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {tegel.nightBlocks.map((lengte, index) => (
        <span
          key={index}
          title={`Reeks van ${lengte} ${lengte === 1 ? "nacht" : "nachten"}`}
          className={`tabular rounded px-1 text-[10.5px] font-semibold ${
            lengte >= 3
              ? "bg-state-ok-soft text-state-ok"
              : lengte === 2
                ? "bg-state-warn-soft text-state-warn"
                : "bg-state-error-soft text-state-error"
          }`}
        >
          {lengte}
        </span>
      ))}
    </span>
  );
}
