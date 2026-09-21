"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/primitives";
import { zetProjectdoelAction } from "./acties";

/**
 * Laag 2: extra doelen voor de volgende opdracht.
 *
 * ## Waarom dit naast de meting staat en er niet in zit
 *
 * De kwaliteitsmeting is geijkt aan zeven officiële roosters. Zou dit paneel
 * die gewichten verzetten, dan betekent een score van volgende maand iets
 * anders dan die van vandaag, en is vergelijken met eerdere kandidaten zinloos
 * geworden. Deze doelen staan daarom bóvenop de meting: ze sturen wat de
 * zoekmachine de volgende keer extra zwaar laat wegen, en laten de meetlat
 * ongemoeid.
 *
 * ## Waarom er een naam aan hangt
 *
 * "We wilden deze ronde vooral betere nachten" is een besluit van mensen. Het
 * hoort terug te vinden te zijn: wie, wanneer, en waarom. De agent leest deze
 * doelen en noemt ze in zijn voorstel; aanzetten kan hij ze niet.
 */

export interface DoelOptie {
  readonly goal: string;
  readonly label: string;
  readonly active: boolean;
  readonly note: string | null;
}

export function Laag2Paneel({ doelen, locationCode }: { doelen: readonly DoelOptie[]; locationCode: string }) {
  const router = useRouter();
  const [melding, setMelding] = useState<string | null>(null);
  const [bezig, startOvergang] = useTransition();

  const zet = (goal: string, active: boolean) => {
    startOvergang(async () => {
      const uitkomst = await zetProjectdoelAction({ goal, active, locationCode });
      setMelding(uitkomst.message);
      router.refresh();
    });
  };

  const aan = doelen.filter((d) => d.active);

  return (
    <div className="space-y-2 py-2">
      <p className="text-[11.5px] leading-snug text-ink-muted">
        Deze doelen komen bóvenop de vaste meting en veranderen die niet. Ze gelden voor de
        volgende opdracht; de roosteragent noemt ze in zijn voorstel.
      </p>

      <ul className="divide-y divide-line">
        {doelen.map((doel) => (
          <li key={doel.goal} className="flex items-center justify-between gap-2 py-1.5">
            <span className="min-w-0 text-[12.5px] text-ink">{doel.label}</span>
            <button
              type="button"
              disabled={bezig}
              onClick={() => zet(doel.goal, !doel.active)}
              aria-pressed={doel.active}
              className={`shrink-0 rounded-md border px-2 py-1 text-[11.5px] font-semibold transition-colors disabled:opacity-50 ${
                doel.active
                  ? "border-accent-rc bg-accent-rc text-white"
                  : "border-line-strong bg-surface text-ink-muted hover:border-accent-rc hover:text-accent-rc"
              }`}
            >
              {doel.active ? "aan" : "uit"}
            </button>
          </li>
        ))}
      </ul>

      {aan.length === 0 ? (
        <p className="text-[11px] text-ink-faint">
          Niets extra aan: de volgende opdracht gebruikt alleen de vaste meting.
        </p>
      ) : (
        <p className="text-[11px] text-ink-faint">
          {aan.length === 1 ? "Eén extra doel" : `${aan.length} extra doelen`} actief voor de volgende
          opdracht.
        </p>
      )}

      {melding && <Alert tone="neutral">{melding}</Alert>}
    </div>
  );
}
