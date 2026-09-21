"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, Badge, Button, type Tone, inputClass } from "@/components/ui/primitives";
import { beoordeelGeheugenAction, corrigeerGeheugenAction, stelGeheugenVoorAction, trekGeheugenInAction } from "./acties";

/**
 * Het leergeheugen, zoals de commissie het beheert.
 *
 * ## Waarom voorstellen en geldende kennis door elkaar staan
 *
 * Omdat het over hetzelfde gaat en het verschil eruit moet springen, niet
 * weggeklikt worden. Een voorstel dat in een apart tabblad wacht, wordt niet
 * beoordeeld; een voorstel tussen de geldende items in, met een duidelijke
 * markering en twee knoppen, wel.
 *
 * ## Waarom intrekken een reden vraagt
 *
 * "Dit geldt niet meer" is geen informatie. Over een jaar wil iemand weten
 * waarom het niet meer geldt, en dan is een leeg veld het verschil tussen een
 * besluit en een raadsel.
 */

export interface GeheugenItem {
  readonly id: string;
  readonly scope: string;
  readonly kind: string;
  readonly statement: string;
  readonly rationale: string | null;
  readonly status: string;
  readonly origin: string;
  readonly appliedCount: number;
  readonly contextStillCurrent: boolean;
  readonly locationCode: string | null;
  readonly withdrawnReason: string | null;
}

const STATUS_TOON: Record<string, { label: string; tone: Tone }> = {
  APPROVED: { label: "geldt", tone: "ok" },
  PROPOSED: { label: "voorstel", tone: "info" },
  REJECTED: { label: "afgewezen", tone: "neutral" },
  WITHDRAWN: { label: "ingetrokken", tone: "warn" },
  SUPERSEDED: { label: "vervangen", tone: "neutral" },
};

const BEREIK: Record<string, string> = {
  PROJECT: "dit project",
  LOCATION: "deze standplaats",
  NATIONAL: "NS-breed",
  TECHNICAL: "techniek",
};

export function Geheugenpaneel({
  items,
  locationCode,
  magBeoordelen,
}: {
  items: readonly GeheugenItem[];
  locationCode: string;
  magBeoordelen: boolean;
}) {
  const router = useRouter();
  const [melding, setMelding] = useState<string | null>(null);
  const [bezig, startOvergang] = useTransition();
  const [nieuw, setNieuw] = useState("");
  const [bewerkt, setBewerkt] = useState<{ id: string; modus: "corrigeer" | "trek-in"; tekst: string } | null>(null);

  const handel = (fn: () => Promise<{ ok: boolean; message: string }>) => {
    startOvergang(async () => {
      const uitkomst = await fn();
      setMelding(uitkomst.message);
      setBewerkt(null);
      router.refresh();
    });
  };

  return (
    <div className="space-y-3 py-2">
      {/* Zelf iets laten onthouden. */}
      <div className="space-y-1.5">
        <textarea
          aria-label="Wat moet er onthouden worden?"
          rows={2}
          className={`${inputClass} resize-none`}
          placeholder="Bijvoorbeeld: in Dordrecht liever vijf nachten aaneen dan losse nachten."
          value={nieuw}
          onChange={(e) => setNieuw(e.target.value)}
        />
        <Button
          variant="secondary"
          size="small"
          type="button"
          disabled={bezig || nieuw.trim().length < 8}
          onClick={() =>
            handel(async () => {
              const uitkomst = await stelGeheugenVoorAction({ statement: nieuw, locationCode, scope: "LOCATION" });
              if (uitkomst.ok) setNieuw("");
              return uitkomst;
            })
          }
        >
          Vastleggen als voorstel
        </Button>
      </div>

      {melding && <Alert tone="neutral">{melding}</Alert>}

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-5 text-center text-[12.5px] text-ink-muted">
          Er is nog niets vastgelegd. Wat niet is vastgelegd en goedgekeurd, wordt ook niet
          toegepast.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((item) => {
            const toon = STATUS_TOON[item.status] ?? { label: item.status.toLowerCase(), tone: "neutral" as Tone };
            return (
              <li key={item.id} className="space-y-1 py-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 text-[12.5px] leading-snug text-ink">{item.statement}</p>
                  <Badge tone={toon.tone}>{toon.label}</Badge>
                </div>
                <p className="text-[11px] text-ink-faint">
                  {BEREIK[item.scope] ?? item.scope} · {item.origin} ·{" "}
                  {item.appliedCount === 0 ? "nog nooit toegepast" : `${item.appliedCount}× toegepast`}
                </p>
                {item.rationale && <p className="text-[11px] text-ink-muted">{item.rationale}</p>}
                {!item.contextStillCurrent && (
                  <p className="text-[11px] text-state-warn">
                    Geleerd in een ander dienstenpakket; of het nu nog opgaat, is niet vastgesteld.
                  </p>
                )}
                {item.withdrawnReason && (
                  <p className="text-[11px] text-ink-muted">Ingetrokken: {item.withdrawnReason}</p>
                )}

                {magBeoordelen && item.status === "PROPOSED" && (
                  <div className="flex gap-1.5 pt-1">
                    <Button variant="primary" size="small" type="button" disabled={bezig} onClick={() => handel(() => beoordeelGeheugenAction({ id: item.id, approve: true }))}>
                      Goedkeuren
                    </Button>
                    <Button variant="secondary" size="small" type="button" disabled={bezig} onClick={() => handel(() => beoordeelGeheugenAction({ id: item.id, approve: false, reason: "Niet overgenomen door de commissie." }))}>
                      Afwijzen
                    </Button>
                  </div>
                )}

                {magBeoordelen && item.status === "APPROVED" && (
                  <div className="flex gap-1.5 pt-1">
                    <Button variant="secondary" size="small" type="button" disabled={bezig} onClick={() => setBewerkt({ id: item.id, modus: "corrigeer", tekst: item.statement })}>
                      Corrigeren
                    </Button>
                    <Button variant="secondary" size="small" type="button" disabled={bezig} onClick={() => setBewerkt({ id: item.id, modus: "trek-in", tekst: "" })}>
                      Intrekken
                    </Button>
                  </div>
                )}

                {bewerkt?.id === item.id && (
                  <div className="space-y-1.5 rounded-lg border border-line-strong bg-canvas p-2">
                    <label className="block text-[11.5px] font-semibold text-ink">
                      {bewerkt.modus === "corrigeer" ? "De juiste lezing" : "Waarom trekt u dit in?"}
                    </label>
                    <textarea
                      rows={2}
                      className={`${inputClass} resize-none`}
                      value={bewerkt.tekst}
                      onChange={(e) => setBewerkt({ ...bewerkt, tekst: e.target.value })}
                    />
                    <div className="flex gap-1.5">
                      <Button
                        variant="primary"
                        size="small"
                        type="button"
                        disabled={bezig || bewerkt.tekst.trim().length < 3}
                        onClick={() =>
                          handel(() =>
                            bewerkt.modus === "corrigeer"
                              ? corrigeerGeheugenAction({ id: item.id, statement: bewerkt.tekst })
                              : trekGeheugenInAction({ id: item.id, reason: bewerkt.tekst }),
                          )
                        }
                      >
                        {bewerkt.modus === "corrigeer" ? "Corrigeren" : "Intrekken"}
                      </Button>
                      <Button variant="secondary" size="small" type="button" onClick={() => setBewerkt(null)}>
                        Annuleren
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-[11px] text-ink-faint">
        Alleen goedgekeurde items tellen mee in een beslissing. Intrekken wist niets: het item
        blijft leesbaar met de reden erbij.
      </p>
    </div>
  );
}
