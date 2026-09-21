"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import type { GenerationRunJson } from "@/domain/generation-progress";
import { Alert, Badge, Button, type Tone } from "@/components/ui/primitives";
import { stopActiviteitAction, stopOpdrachtAction, zetAgentStilAction } from "./acties";

/**
 * Het activiteitenpaneel: wat de agent doet, en hoe je hem stopt.
 *
 * ## Waarom dit blijft staan
 *
 * Een agent die iets doet zonder dat iemand ziet wát, is niet te vertrouwen en
 * niet te corrigeren. Dit paneel staat er altijd: het toont de stappen van de
 * laatste activiteiten, de lopende rekenopdracht, en of de agent überhaupt aan
 * staat.
 *
 * ## Waarom de stand van de server komt
 *
 * De activiteiten en hun stappen staan in de database, niet in dit tabblad.
 * Wegklikken, verversen of de laptop dichtdoen verandert niets; bij terugkomst
 * staat de waarheid er nog. Valt de server weg, dan blijft een activiteit niet
 * eeuwig "bezig" heten: de eerstvolgende peiling markeert hem als onderbroken.
 *
 * ## De stopknoppen doen echt iets
 *
 * "Stilzetten" schrijft een vlag die de agent leest voordat hij iets start.
 * "Stop de opdracht" vraagt de server de berekening af te breken. Geen van
 * beide verandert alleen dit scherm.
 */

const PEILING_MS = 4000;

interface Gebeurtenis {
  readonly id: string;
  readonly kind: string;
  readonly message: string;
  readonly at: string;
}

interface Activiteit {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly status: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly stopRequested: boolean;
  readonly generationRunId: string | null;
  readonly events: readonly Gebeurtenis[];
}

interface Stand {
  readonly level: "A" | "B" | "C";
  readonly suspended: boolean;
  readonly suspendReason: string | null;
  readonly maySteer: boolean;
  readonly recoveredCount: number;
  readonly activities: readonly Activiteit[];
  readonly run: GenerationRunJson | null;
}

const STATUS_TOON: Record<string, { label: string; tone: Tone }> = {
  RUNNING: { label: "bezig", tone: "info" },
  DONE: { label: "klaar", tone: "ok" },
  FAILED: { label: "mislukt", tone: "error" },
  STOPPED: { label: "gestopt", tone: "warn" },
  INTERRUPTED: { label: "onderbroken", tone: "warn" },
};

const klok = (iso: string) =>
  new Date(iso).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function ActiviteitenPaneel({ locationCode }: { locationCode: string }) {
  const [stand, setStand] = useState<Stand | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [melding, setMelding] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [bezig, startOvergang] = useTransition();

  const peil = useCallback(async () => {
    try {
      const res = await fetch(`/roostercommissie/agent/activiteit?standplaats=${encodeURIComponent(locationCode)}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setFout((await res.json().catch(() => ({}))).error ?? "De stand kon niet worden opgehaald.");
        return;
      }
      setFout(null);
      setStand((await res.json()) as Stand);
    } catch {
      setFout("Geen verbinding met de server.");
    }
  }, [locationCode]);

  useEffect(() => {
    // De eerste peiling loopt via een timer en niet rechtstreeks in de effect:
    // rechtstreeks zou een cascade van renders opleveren (react-hooks).
    const eerste = setTimeout(() => void peil(), 0);
    const timer = setInterval(() => void peil(), PEILING_MS);
    return () => {
      clearTimeout(eerste);
      clearInterval(timer);
    };
  }, [peil]);

  const handel = (fn: () => Promise<{ ok: boolean; message: string }>) => {
    startOvergang(async () => {
      const uitkomst = await fn();
      setMelding(uitkomst.message);
      await peil();
    });
  };

  const lopend = stand?.activities.filter((a) => a.status === "RUNNING") ?? [];

  return (
    <section className="flex flex-col rounded-xl border border-line bg-surface">
      <header className="flex items-start justify-between gap-3 px-4 py-3.5">
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold text-ink-strong">Activiteit</h2>
          <p className="truncate text-[12px] text-ink-muted">
            {stand === null
              ? "Stand ophalen…"
              : stand.suspended
                ? "De agent is stilgezet"
                : lopend.length > 0
                  ? `${lopend.length} bezig`
                  : "Niets aan het werk"}
          </p>
        </div>
        <Badge tone={stand?.suspended ? "warn" : lopend.length > 0 ? "info" : "ok"}>
          {stand?.suspended ? "uit" : "aan"}
        </Badge>
      </header>

      <div className="space-y-3 border-t border-line px-4 py-3">
        {fout && <Alert tone="error">{fout}</Alert>}
        {melding && <Alert tone="neutral">{melding}</Alert>}

        {stand?.suspended && (
          <Alert tone="warn" title="Stilgezet">
            De agent start niets: geen berekening, geen ronde, geen experiment. Vragen beantwoorden
            kan nog wel.
            {stand.suspendReason ? ` Reden: ${stand.suspendReason}` : ""}
          </Alert>
        )}

        {stand && stand.recoveredCount > 0 && (
          <Alert tone="neutral">
            {stand.recoveredCount === 1 ? "Eén activiteit" : `${stand.recoveredCount} activiteiten`} van
            vóór de laatste herstart stonden nog als bezig geregistreerd. Ze zijn als onderbroken
            gemarkeerd; er is niets half afgemaakt vastgelegd.
          </Alert>
        )}

        {/* ── De lopende rekenopdracht ─────────────────────────────────── */}
        {stand?.run && (
          <div className="rounded-lg border border-line-strong bg-canvas px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12.5px] font-semibold text-ink-strong">Rekenopdracht</span>
              <Badge tone={stand.run.status === "RUNNING" ? "info" : "neutral"}>
                {stand.run.status.toLowerCase()}
              </Badge>
            </div>
            <p className="mt-1 text-[12px] text-ink-muted">
              {stand.run.stageMessage ?? stand.run.strategyLabel}
              {stand.run.progress
                ? ` · kandidaat ${stand.run.progress.candidatesFound} van ${stand.run.progress.candidatesRequested}`
                : ""}
            </p>
            {stand.maySteer && stand.run.status === "RUNNING" && (
              <div className="mt-2">
                <Button
                  variant="danger"
                  size="small"
                  type="button"
                  disabled={bezig || stand.run.cancelRequested}
                  onClick={() => handel(() => stopOpdrachtAction({ runId: stand.run!.id }))}
                >
                  {stand.run.cancelRequested ? "Stoppen gevraagd…" : "Stop de opdracht"}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ── De noodrem ───────────────────────────────────────────────── */}
        {stand?.maySteer && (
          <Button
            variant={stand.suspended ? "outline-rc" : "secondary"}
            size="small"
            type="button"
            block
            disabled={bezig}
            onClick={() => handel(() => zetAgentStilAction({ suspended: !stand.suspended, locationCode }))}
          >
            {stand.suspended ? "Agent weer aanzetten" : "Agent stilzetten"}
          </Button>
        )}

        {/* ── De stappen ───────────────────────────────────────────────── */}
        {stand && stand.activities.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-[12.5px] text-ink-muted">
            De agent heeft op deze standplaats nog niets gedaan.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {stand?.activities.map((a) => {
              const toon = STATUS_TOON[a.status] ?? { label: a.status.toLowerCase(), tone: "neutral" as Tone };
              const uitgeklapt = open === a.id;
              return (
                <li key={a.id} className="py-2">
                  <button
                    type="button"
                    onClick={() => setOpen(uitgeklapt ? null : a.id)}
                    className="flex w-full items-start justify-between gap-2 text-left"
                    aria-expanded={uitgeklapt}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] text-ink">{a.title}</span>
                      <span className="block text-[11px] text-ink-faint">
                        {klok(a.startedAt)} · {a.events.length} {a.events.length === 1 ? "stap" : "stappen"}
                      </span>
                    </span>
                    <Badge tone={toon.tone}>{a.stopRequested && a.status === "RUNNING" ? "stoppen…" : toon.label}</Badge>
                  </button>

                  {uitgeklapt && (
                    <ol className="mt-2 space-y-1 border-l border-line pl-3">
                      {a.events.map((e) => (
                        <li key={e.id} className="text-[11.5px] leading-snug text-ink-muted">
                          <span className="font-mono text-[10.5px] text-ink-faint">{klok(e.at)}</span>{" "}
                          <span className="font-semibold text-ink">{e.kind.toLowerCase()}</span> — {e.message}
                        </li>
                      ))}
                      {a.status === "RUNNING" && stand.maySteer && (
                        <li className="pt-1">
                          <Button
                            variant="danger"
                            size="small"
                            type="button"
                            disabled={bezig || a.stopRequested}
                            onClick={() => handel(() => stopActiviteitAction({ activityId: a.id }))}
                          >
                            {a.stopRequested ? "Stoppen gevraagd…" : "Stop deze activiteit"}
                          </Button>
                        </li>
                      )}
                    </ol>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
