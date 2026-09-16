"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import type { ActionState } from "@/lib/action-state";
import { Alert, Button } from "@/components/ui/primitives";

/**
 * De scenariokeuze met één opdracht tegelijk.
 *
 * ## Waarom dit één component is en geen zeven losse formulieren
 *
 * Elk scenario had zijn eigen formulier, en elk formulier wist alleen van
 * zichzelf. Wie tijdens een lopende berekening op een tweede scenario klikte,
 * startte er gewoon nog één — met twee CP-SAT-processen naast elkaar en twee
 * kandidaten die op hetzelfde moment leken te zijn gemaakt. Hier weet het
 * paneel welke opdracht loopt, en zolang die loopt zijn de andere knoppen dicht.
 *
 * ## Waarom er geen percentage staat
 *
 * De server stuurt tijdens het rekenen niets terug; er is dus geen voortgang om
 * te tonen. Een balk die toch oploopt is een verzinsel, en precies op het moment
 * dat het lang duurt is dat het vervelendst. Wat er wél staat is wat er gebeurt
 * en hoe lang het ongeveer duurt.
 */

export interface ScenarioKeuze {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  /** CP-SAT rekent, de eenvoudige variant niet. Dat scheelt een minuut. */
  readonly rekent: boolean;
}

/** De stappen die een opdracht doorloopt, in deze volgorde. */
const STAPPEN = [
  "Diensten controleren",
  "Rooster optimaliseren",
  "Resultaat verwerken",
  "Validatie voorbereiden",
] as const;

export function GenereerPaneel({
  scenarios,
  genereerAction,
  valideerAction,
}: {
  scenarios: readonly ScenarioKeuze[];
  genereerAction: (state: ActionState, formData: FormData) => Promise<ActionState>;
  valideerAction: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [bezigMet, setBezigMet] = useState<string | null>(null);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {scenarios.map((scenario) => (
          <GenereerKaart
            key={scenario.key}
            scenario={scenario}
            genereerAction={genereerAction}
            valideerAction={valideerAction}
            bezigMet={bezigMet}
            meld={(sleutel, bezig) =>
              setBezigMet((vorige) => (bezig ? sleutel : vorige === sleutel ? null : vorige))
            }
          />
        ))}
      </div>

      {bezigMet === null ? (
        <p className="mt-3 text-[11px] text-ink-muted">
          Een scenario berekenen duurt ongeveer één tot twee minuten. Zolang een opdracht loopt,
          kan er geen tweede worden gestart.
        </p>
      ) : (
        <div className="mt-3 rounded-md border border-line bg-canvas p-3">
          <p className="text-[12px] font-semibold text-ink">
            Scenario wordt berekend. Dit kan ongeveer 1–2 minuten duren.
          </p>
          <ol className="mt-2 space-y-0.5 text-[11.5px] text-ink-muted">
            {STAPPEN.map((stap, nummer) => (
              <li key={stap}>
                {nummer + 1}. {stap}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[11px] text-ink-faint">
            Deze stappen worden in deze volgorde doorlopen. Er is geen tussenstand: de
            optimalisatie meldt zich pas als ze klaar is.
          </p>
        </div>
      )}
    </>
  );
}

function GenereerKaart({
  scenario,
  genereerAction,
  valideerAction,
  bezigMet,
  meld,
}: {
  scenario: ScenarioKeuze;
  genereerAction: (state: ActionState, formData: FormData) => Promise<ActionState>;
  valideerAction: (state: ActionState, formData: FormData) => Promise<ActionState>;
  bezigMet: string | null;
  meld: (sleutel: string, bezig: boolean) => void;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(genereerAction, {});

  // Het paneel moet weten dat er iets loopt; alleen dit formulier weet het.
  useEffect(() => {
    meld(scenario.key, pending);
  }, [pending, scenario.key, meld]);

  const anderBezig = bezigMet !== null && bezigMet !== scenario.key;

  return (
    <div className="rounded-md border border-line p-3">
      <p className="text-sm font-semibold">{scenario.label}</p>
      <p className="mt-1 text-xs text-ink-muted">{scenario.description}</p>

      <form action={formAction} className="mt-3">
        <input type="hidden" name="strategy" value={scenario.key} />
        <Button variant="outline-rc" disabled={pending || anderBezig}>
          {pending ? "Bezig met berekenen…" : "Genereren"}
        </Button>
      </form>

      {state.error ? (
        <div className="mt-2">
          <Alert tone="error" title={state.error}>
            {state.reasons && state.reasons.length > 0 ? (
              <ul className="list-disc space-y-0.5 pl-4">
                {state.reasons.map((reden) => (
                  <li key={reden}>{reden}</li>
                ))}
              </ul>
            ) : null}
          </Alert>
        </div>
      ) : null}

      {/* Wat er net is gemaakt, staat hier — met de knoppen ernaartoe. Wie een
          scenario genereert, wil het bekijken, vergelijken of laten toetsen, en
          hoeft daarvoor niet terug door het menu. */}
      {state.notice && !pending ? (
        <div className="mt-2 rounded-md border border-line bg-state-ok-soft p-2.5">
          <p className="text-[11.5px] text-ink">{state.notice}</p>
          {state.resultId ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Link
                href={`/roostercommissie/simulatie?kandidaat=${state.resultId}`}
                className="inline-flex items-center rounded-md border border-line bg-surface px-2.5 py-1 text-[11px] font-semibold"
              >
                Bekijk scenario
              </Link>
              <Link
                href="#scenarios"
                className="inline-flex items-center rounded-md border border-line bg-surface px-2.5 py-1 text-[11px] font-semibold"
              >
                Vergelijk scenario&apos;s
              </Link>
              <ValideerKnop candidateId={state.resultId} valideerAction={valideerAction} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Meteen laten toetsen wat er net is gemaakt.
 *
 * Dezelfde handeling als de knop op de scenariokaart eronder; hij staat hier
 * alleen ook, zodat de volgorde genereren → valideren geen omweg is. De
 * uitkomst blijft kort: het oordeel zelf staat op de kaart, met de uitsplitsing
 * erbij.
 */
function ValideerKnop({
  candidateId,
  valideerAction,
}: {
  candidateId: string;
  valideerAction: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(valideerAction, {});

  return (
    <form action={formAction} className="contents">
      <input type="hidden" name="candidateId" value={candidateId} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center rounded-md border border-line bg-surface px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50"
      >
        {pending ? "Valideren…" : "Valideren"}
      </button>
      {pending ? (
        <span className="basis-full text-[11px] text-ink-muted">
          De eindvalidatie rekent elke toewijzing opnieuw na. Dit kan enkele minuten duren.
        </span>
      ) : null}
      {state.error || state.notice ? (
        <span className="basis-full text-[11px] text-ink-muted">
          {state.error ?? state.notice}
        </span>
      ) : null}
    </form>
  );
}
