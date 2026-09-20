import {
  HUMAN_REVIEW_REASONS,
  HUMAN_REVIEW_VERDICT_LABELS,
  HUMAN_REVIEW_VERDICTS,
  PAIRWISE_REASONS,
  type HumanReviewReason,
  type PairwiseReason,
} from "@/domain/human-review";
import { ActionForm } from "@/components/ui/action-form";
import { inputClass } from "@/components/ui/primitives";
import { beoordeelRegelAction, kiesVoorkeurAction } from "./acties";

/**
 * Het menselijke oordeel over een roosterregel, en tussen twee kandidaten.
 *
 * ## Waarvoor
 *
 * De zoekmachine is geijkt op de zeven menselijke Dordrechtse roosters. Of het
 * resultaat ook als een menselijk rooster rijdt, kan alleen de Roostercommissie
 * zeggen. Dit formulier legt dat vast, met redenen die aansluiten op wat het
 * kwaliteitsmodel meet. Het oordeel verandert niets automatisch: het is
 * grondstof voor de volgende ijking.
 */

export interface BestaandOordeel {
  readonly id: string;
  readonly lineNumber: number | null;
  readonly verdict: string;
  readonly reasons: readonly string[];
  readonly note: string | null;
  readonly createdAt: Date;
  readonly reviewer: string | null;
}

const TOON: Record<string, string> = {
  GOOD: "text-state-ok",
  DOUBT: "text-state-warn",
  BAD: "text-state-error",
};

export function RegelBeoordeling({
  candidateId,
  rosterCode,
  lineNumber,
  eerder,
}: {
  candidateId: string;
  rosterCode: string;
  lineNumber: number | null;
  eerder: readonly BestaandOordeel[];
}) {
  const redenen = Object.entries(HUMAN_REVIEW_REASONS) as [HumanReviewReason, { label: string; tone: string }][];
  return (
    <details className="group mt-4 rounded-lg border border-line bg-canvas px-3 py-2.5">
      <summary className="cursor-pointer select-none text-[12.5px] font-semibold text-ink-strong">
        {lineNumber === null ? "Dit basisrooster beoordelen" : `Regel ${lineNumber} beoordelen`}
        <span className="ml-1.5 font-normal text-ink-muted">
          — voor de training van de zoekmachine{eerder.length > 0 ? ` · ${eerder.length} eerder oordeel` : ""}
        </span>
      </summary>

      <div className="mt-3">
        <ActionForm action={beoordeelRegelAction} submitLabel="Oordeel bewaren" variant="outline-rc">
          <input type="hidden" name="candidateId" value={candidateId} />
          <input type="hidden" name="rosterCode" value={rosterCode} />
          <input type="hidden" name="lineNumber" value={lineNumber ?? ""} />

          <fieldset>
            <legend className="text-[12px] font-semibold text-ink">Hoe rijdt {lineNumber === null ? "dit rooster" : "deze regel"}?</legend>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {HUMAN_REVIEW_VERDICTS.map((oordeel) => (
                <label
                  key={oordeel}
                  className="flex cursor-pointer items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12.5px] has-[:checked]:border-accent-rc has-[:checked]:ring-1 has-[:checked]:ring-accent-rc"
                >
                  <input type="radio" name="verdict" value={oordeel} required />
                  {HUMAN_REVIEW_VERDICT_LABELS[oordeel]}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-[12px] font-semibold text-ink">Waarom? (meerdere mogelijk)</legend>
            <div className="mt-1.5 grid gap-1 sm:grid-cols-2">
              {redenen.map(([code, reden]) => (
                <label key={code} className="flex items-start gap-1.5 text-[12px]">
                  <input type="checkbox" name="reasons" value={code} className="mt-0.5" />
                  <span>{reden.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-ink">Toelichting (optioneel)</span>
            <textarea name="note" rows={2} maxLength={1000} className={inputClass} placeholder="Wat valt op aan deze regel?" />
          </label>
        </ActionForm>
      </div>

      {eerder.length > 0 ? (
        <ul className="mt-3 space-y-1.5 border-t border-line pt-2.5 text-[12px]">
          {eerder.map((oordeel) => (
            <li key={oordeel.id}>
              <span className={`font-semibold ${TOON[oordeel.verdict] ?? "text-ink"}`}>
                {HUMAN_REVIEW_VERDICT_LABELS[oordeel.verdict as keyof typeof HUMAN_REVIEW_VERDICT_LABELS] ?? oordeel.verdict}
              </span>
              {oordeel.reasons.length > 0 ? (
                <span className="text-ink-muted">
                  {" "}
                  — {oordeel.reasons.map((r) => HUMAN_REVIEW_REASONS[r as HumanReviewReason]?.label ?? r).join(", ")}
                </span>
              ) : null}
              {oordeel.note ? <span className="block text-ink-muted">“{oordeel.note}”</span> : null}
              <span className="block text-[11px] text-ink-faint">
                {oordeel.createdAt.toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short" })}
                {oordeel.reviewer ? ` · ${oordeel.reviewer}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}

export function VoorkeurKeuze({
  first,
  second,
}: {
  first: { id: string; label: string };
  second: { id: string; label: string };
}) {
  const redenen = Object.entries(PAIRWISE_REASONS) as [PairwiseReason, string][];
  return (
    <ActionForm action={kiesVoorkeurAction} submitLabel="Voorkeur bewaren" variant="outline-rc">
      <input type="hidden" name="firstCandidateId" value={first.id} />
      <input type="hidden" name="secondCandidateId" value={second.id} />
      <fieldset>
        <legend className="text-[12px] font-semibold text-ink">Welke rijdt menselijker?</legend>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {[
            { value: "FIRST", label: first.label },
            { value: "SECOND", label: second.label },
            { value: "EQUAL", label: "Even goed" },
          ].map((optie) => (
            <label
              key={optie.value}
              className="flex cursor-pointer items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12.5px] has-[:checked]:border-accent-rc has-[:checked]:ring-1 has-[:checked]:ring-accent-rc"
            >
              <input type="radio" name="choice" value={optie.value} required />
              {optie.label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-[12px] font-semibold text-ink">Waarom? (meerdere mogelijk)</legend>
        <div className="mt-1.5 grid gap-1 sm:grid-cols-2">
          {redenen.map(([code, label]) => (
            <label key={code} className="flex items-start gap-1.5 text-[12px]">
              <input type="checkbox" name="reasons" value={code} className="mt-0.5" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1">
        <span className="text-[12px] font-semibold text-ink">Toelichting (optioneel)</span>
        <textarea name="note" rows={2} maxLength={1000} className={inputClass} />
      </label>
    </ActionForm>
  );
}
