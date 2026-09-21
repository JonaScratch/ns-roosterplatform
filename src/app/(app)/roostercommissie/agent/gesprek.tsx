"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Alert, Badge, Button, type Tone, inputClass } from "@/components/ui/primitives";
import { startVoorstelAction, vraagAgentAction } from "./acties";
import type { AgentContextKeuze, GesprekBericht } from "./types";

/**
 * Het gesprek met de roosteragent.
 *
 * ## Waarom de context bovenaan staat en niet verstopt zit
 *
 * "Waarom staat die dienst daar?" betekent iets anders bij een ander rooster,
 * een andere regel of een kandidaat in plaats van het officiële rooster. De
 * agent beantwoordt de vraag in de context die hier zichtbaar is ingesteld, en
 * hij zegt bij elk antwoord waar hij naar keek. Wie iets anders bedoelde, ziet
 * dat meteen in plaats van een antwoord over het verkeerde rooster te geloven.
 *
 * ## Waarom bij elk antwoord staat waar het op steunt
 *
 * Elk getal komt uit een tool die de database heeft gelezen. Die tools staan
 * onder het antwoord, met de bronnen erbij. Een antwoord zonder bron is geen
 * bescheiden antwoord maar een onbruikbaar antwoord.
 */

const STATUS_LABELS: Record<string, { label: string; tone: Tone }> = {
  BEANTWOORD: { label: "Beantwoord", tone: "ok" },
  VOORSTEL: { label: "Voorstel", tone: "rc" },
  VERDUIDELIJKING: { label: "Wedervraag", tone: "info" },
  NIET_VAST_TE_STELLEN: { label: "Niet vast te stellen", tone: "warn" },
  GEWEIGERD: { label: "Mag niet", tone: "error" },
  FOUT: { label: "Fout", tone: "error" },
};

const WEEKDAGEN = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"];

export interface RoosterOptie {
  readonly code: string;
  readonly label: string;
  readonly lines: number;
}

export interface KandidaatOptie {
  readonly id: string;
  readonly label: string;
}

export function Gesprek({
  locationCode,
  roosters,
  kandidaten,
  beginBerichten,
  beginSessionId,
  voorbeelden,
  niveau,
  modelNaam,
  isTaalmodel,
}: {
  locationCode: string;
  roosters: readonly RoosterOptie[];
  kandidaten: readonly KandidaatOptie[];
  beginBerichten: readonly GesprekBericht[];
  beginSessionId: string | null;
  voorbeelden: readonly string[];
  niveau: "A" | "B" | "C";
  modelNaam: string;
  isTaalmodel: boolean;
}) {
  const [berichten, setBerichten] = useState<readonly GesprekBericht[]>(beginBerichten);
  const [sessionId, setSessionId] = useState<string | null>(beginSessionId);
  const [tekst, setTekst] = useState("");
  const [bezig, startOvergang] = useTransition();
  const [bron, setBron] = useState<"official" | "candidate">("official");
  const [kandidaatId, setKandidaatId] = useState<string | null>(kandidaten[0]?.id ?? null);
  const [roosterCode, setRoosterCode] = useState<string | null>(roosters[0]?.code ?? null);
  const [regel, setRegel] = useState<string>("");
  const [weekdag, setWeekdag] = useState<string>("");
  const onderkant = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    onderkant.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [berichten, bezig]);

  const huidigeContext = useCallback((): AgentContextKeuze => {
    return {
      source: bron,
      candidateId: bron === "candidate" ? kandidaatId : null,
      rosterCode: roosterCode,
      lineNumber: regel.trim() === "" ? null : Number(regel),
      weekday: weekdag === "" ? null : Number(weekdag),
      dutyCode: null,
      locationCode,
    };
  }, [bron, kandidaatId, roosterCode, regel, weekdag, locationCode]);

  const stuur = useCallback(
    (vraag: string) => {
      const schoon = vraag.trim();
      if (schoon.length < 2 || bezig) return;
      const context = huidigeContext();
      const beschrijving = [
        bron === "candidate" ? (kandidaten.find((k) => k.id === kandidaatId)?.label ?? "kandidaat") : "officieel rooster",
        context.rosterCode,
        context.lineNumber ? `regel ${context.lineNumber}` : null,
        context.weekday ? WEEKDAGEN[context.weekday - 1] : null,
      ]
        .filter(Boolean)
        .join(" · ");

      setBerichten((oud) => [
        ...oud,
        { id: `v-${Date.now()}`, rol: "USER", tekst: schoon, context: beschrijving },
      ]);
      setTekst("");

      startOvergang(async () => {
        const antwoord = await vraagAgentAction({ tekst: schoon, sessionId, context });
        setSessionId(antwoord.sessionId ?? sessionId);
        setBerichten((oud) => [
          ...oud,
          {
            id: `a-${Date.now()}`,
            rol: "AGENT",
            tekst: antwoord.text,
            status: antwoord.status,
            sources: antwoord.sources,
            tools: antwoord.tools.map((t) => `${t.tool}${t.ok ? "" : " (mislukt)"}`),
            missing: antwoord.contextUsed.missing,
            proposal: antwoord.proposal,
            // Noemde de vraag een ander rooster dan de kiezer? Dan hoort dat er
            // hardop bij te staan, anders leest een antwoord over het ene
            // rooster als een antwoord over het andere.
            context:
              antwoord.usedRosterCode && context.rosterCode && antwoord.usedRosterCode !== context.rosterCode
                ? `Je noemde ${antwoord.usedRosterCode} in je vraag; daar heb ik naar gekeken. De kiezer staat op ${context.rosterCode}.`
                : null,
          },
        ]);
      });
    },
    [bezig, bron, huidigeContext, kandidaatId, kandidaten, sessionId],
  );

  /**
   * Een voorstel bevestigen.
   *
   * De uitkomst komt onder het voorstel te staan, ook als hij negatief is: een
   * geweigerde opdracht hoort net zo zichtbaar te zijn als een gestarte.
   */
  const startVoorstel = useCallback(
    (berichtId: string, proposal: Record<string, unknown>) => {
      startOvergang(async () => {
        const uitkomst = await startVoorstelAction({ proposal, sessionId });
        setBerichten((oud) =>
          oud.map((b) => (b.id === berichtId ? { ...b, proposalResult: uitkomst.message } : b)),
        );
      });
    },
    [sessionId],
  );

  return (
    <div className="flex h-[calc(100vh-13rem)] min-h-[32rem] flex-col rounded-xl border border-line bg-surface">
      {/* ── Context ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">Kijkt naar</span>

        <select
          aria-label="Bron"
          className={`${inputClass} w-auto`}
          value={bron}
          onChange={(e) => setBron(e.target.value === "candidate" ? "candidate" : "official")}
        >
          <option value="official">Officieel rooster</option>
          <option value="candidate" disabled={kandidaten.length === 0}>
            Kandidaat
          </option>
        </select>

        {bron === "candidate" && kandidaten.length > 0 && (
          <select
            aria-label="Kandidaat"
            className={`${inputClass} w-auto`}
            value={kandidaatId ?? ""}
            onChange={(e) => setKandidaatId(e.target.value || null)}
          >
            {kandidaten.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        )}

        <select
          aria-label="Basisrooster"
          className={`${inputClass} w-auto`}
          value={roosterCode ?? ""}
          onChange={(e) => setRoosterCode(e.target.value || null)}
        >
          <option value="">Geen rooster gekozen</option>
          {roosters.map((r) => (
            <option key={r.code} value={r.code}>
              {r.code} — {r.label}
            </option>
          ))}
        </select>

        <input
          aria-label="Roosterregel"
          className={`${inputClass} w-28`}
          inputMode="numeric"
          placeholder="regel"
          value={regel}
          onChange={(e) => setRegel(e.target.value.replace(/[^0-9]/g, ""))}
        />

        <select
          aria-label="Weekdag"
          className={`${inputClass} w-auto`}
          value={weekdag}
          onChange={(e) => setWeekdag(e.target.value)}
        >
          <option value="">Hele week</option>
          {WEEKDAGEN.map((dag, i) => (
            <option key={dag} value={i + 1}>
              {dag}
            </option>
          ))}
        </select>

        <span className="ml-auto flex items-center gap-2">
          <Badge tone="rc">Niveau {niveau}</Badge>
          {berichten.length > 0 && (
            <Button
              variant="secondary"
              size="small"
              type="button"
              onClick={() => {
                setBerichten([]);
                setSessionId(null);
              }}
            >
              Nieuw gesprek
            </Button>
          )}
        </span>
      </div>

      {/* ── Gesprek ───────────────────────────────────────────────────────── */}
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {!isTaalmodel && (
          <Alert tone="warn" title="Dit is nog geen taalmodel">
            De antwoorden komen van <span className="font-mono">{modelNaam}</span>: een lokale, vaste
            redeneerlaag die de gegevens echt opzoekt, maar geen taal begrijpt. Wat hier goed gaat,
            zegt iets over de keten — context, toolkeuze, rechten en cijfers — en niets over
            taalvaardigheid. Formuleer vragen daarom nog kort en concreet.
          </Alert>
        )}

        {berichten.length === 0 && (
          <div className="space-y-3">
            <p className="text-[13px] text-ink-muted">
              Vraag iets over dit rooster. De agent leest mee in de gegevens en zegt erbij waar het
              antwoord op steunt — of dat hij het niet kan vaststellen.
            </p>
            <div className="flex flex-wrap gap-2">
              {voorbeelden.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => stuur(v)}
                  className="rounded-full border border-line-strong bg-canvas px-3 py-1.5 text-left text-[12.5px] text-ink transition-colors hover:border-accent-rc hover:text-accent-rc"
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        )}

        {berichten.map((bericht) =>
          bericht.rol === "USER" ? (
            <div key={bericht.id} className="flex justify-end">
              <div className="max-w-[46rem] rounded-xl rounded-br-sm bg-accent-rc px-3.5 py-2.5 text-[13px] text-white">
                <p className="whitespace-pre-wrap">{bericht.tekst}</p>
                {bericht.context && (
                  <p className="mt-1 text-[11px] text-white/70">{bericht.context}</p>
                )}
              </div>
            </div>
          ) : (
            <div key={bericht.id} className="flex justify-start">
              <div className="max-w-[46rem] rounded-xl rounded-bl-sm border border-line bg-canvas px-3.5 py-2.5">
                <div className="mb-1.5 flex items-center gap-2">
                  <Badge tone={STATUS_LABELS[bericht.status ?? ""]?.tone ?? "neutral"}>
                    {STATUS_LABELS[bericht.status ?? ""]?.label ?? "Antwoord"}
                  </Badge>
                  {bericht.tools && bericht.tools.length > 0 && (
                    <span className="text-[11px] text-ink-faint">
                      opgezocht met {bericht.tools.join(", ")}
                    </span>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-[13px] text-ink">{bericht.tekst}</p>
                {bericht.context && (
                  <p className="mt-1.5 text-[11px] text-accent-rc">{bericht.context}</p>
                )}
                {bericht.sources && bericht.sources.length > 0 && (
                  <p className="mt-1.5 text-[11px] text-ink-muted">Bron: {bericht.sources.join(" · ")}</p>
                )}
                {bericht.missing && bericht.missing.length > 0 && (
                  <p className="mt-1 text-[11px] text-state-warn">
                    Niet ingevuld in de context: {bericht.missing.join(", ")}
                  </p>
                )}

                {/* Een voorstel wacht op een mens. Zonder deze knop gebeurt er
                    niets — dat is precies het verschil tussen niveau B en C. */}
                {bericht.proposal && !bericht.proposalResult && (
                  <div className="mt-2 flex items-center gap-2">
                    <Button
                      variant="primary"
                      size="small"
                      type="button"
                      disabled={bezig}
                      onClick={() => startVoorstel(bericht.id, bericht.proposal!)}
                    >
                      Ja, laat berekenen
                    </Button>
                    <Button
                      variant="secondary"
                      size="small"
                      type="button"
                      disabled={bezig}
                      onClick={() =>
                        setBerichten((oud) =>
                          oud.map((b) => (b.id === bericht.id ? { ...b, proposalResult: "Niet gestart." } : b)),
                        )
                      }
                    >
                      Nee, laat maar
                    </Button>
                  </div>
                )}
                {bericht.proposalResult && (
                  <p className="mt-2 rounded-lg bg-canvas px-2.5 py-1.5 text-[11.5px] text-ink">
                    {bericht.proposalResult}
                  </p>
                )}
              </div>
            </div>
          ),
        )}

        {bezig && (
          <div className="flex justify-start">
            <div className="rounded-xl rounded-bl-sm border border-line bg-canvas px-3.5 py-2.5 text-[13px] text-ink-muted">
              De agent zoekt het op…
            </div>
          </div>
        )}

        <div ref={onderkant} />
      </div>

      {/* ── Invoer ────────────────────────────────────────────────────────── */}
      <div className="border-t border-line p-3">
        <div className="flex items-end gap-2">
          <textarea
            aria-label="Je vraag"
            rows={2}
            className={`${inputClass} resize-none`}
            placeholder="Stel je vraag over dit rooster…"
            value={tekst}
            onChange={(e) => setTekst(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                stuur(tekst);
              }
            }}
          />
          <Button type="button" disabled={bezig || tekst.trim().length < 2} onClick={() => stuur(tekst)}>
            {bezig ? "Bezig…" : "Vragen"}
          </Button>
        </div>
        <p className="mt-1.5 text-[11px] text-ink-faint">
          Enter verstuurt, Shift+Enter begint een nieuwe regel. De agent leest; hij wijzigt niets aan
          roosters, regels of publicaties.
        </p>
      </div>
    </div>
  );
}
