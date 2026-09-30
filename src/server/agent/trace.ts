import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";

/**
 * Beurttrace: wat er in één agentbeurt werkelijk gebeurde, stap voor stap.
 *
 * Aanleiding (adversarial M, 20260930): drie reparaties op rij steunden op een
 * reconstructie van tussenstappen die nergens waren vastgelegd — het ruwe plan,
 * wat de planbewaking per regel deed, wat de compose precies naar het model
 * stuurde en wat er terugkwam, en welke systeemtoevoeging (actieve Lyra-versie)
 * op die machine meeliep. Deze trace legt dat vast, voor elke beurt en elke
 * meting (kern, extensie, adversarial, development runs), niet voor één item.
 *
 * Het onderscheid dat de trace bewaakt:
 *  - `modelAanroepen`: wat het model zelf kreeg en teruggaf (ongeparsed);
 *  - `plan.bewaking`, `tools`, `poorten`: wat deterministische platformcode deed;
 *  - `eind`: wat de gebruiker zag;
 *  - de grader-kant (invoer, bewijs, oordeel) schrijft de grader zelf, naast
 *    het meetbestand, op hetzelfde item-id.
 *
 * Opt-in via `metTrace()`: buiten een trace is elke opname een no-op, zodat de
 * gewone runtime niets extra's bewaart. Er gaat geen wachtwoord, token of
 * sessiesleutel in; van de actor alleen rollen en bevoegdheden.
 */

export type PoortUitkomst = "PASS" | "BLOCK" | "APPEND" | "NVT";

export interface ModelAanroep {
  readonly fase: "plan" | "compose";
  readonly verzoek: { readonly model: string; readonly temperature: number; readonly max_tokens: number; readonly messages: readonly { role: string; content: string }[] };
  readonly ruweUitvoer: string | null;
  readonly fout: string | null;
  readonly ms: number;
}

export interface BewakingsStap {
  readonly regel: string;
  readonly getriggerd: boolean;
  readonly reden: string;
  readonly gewijzigd: readonly string[];
  readonly voor: unknown;
  readonly na: unknown;
}

export interface AgentTrace {
  readonly schema: "ns-agent-trace/1";
  readonly traceId: string;
  readonly gestart: string;
  /** Door de aanroeper meegegeven: meting, item, beurt, kandidaat/versie. */
  readonly labels: Record<string, unknown>;
  model?: { naam: string; taalmodel: boolean; instellingen: Record<string, unknown> | null };
  release?: { versionId: string | null; generation: number | null; promptSha256: string | null; integrity: string };
  actor?: { rollen: readonly string[]; niveau: string; bevoegdheden: readonly string[]; geschorst: boolean };
  toegestaneTools?: readonly string[];
  invoer?: { tekst: string; uiContext: unknown; context: unknown };
  platformWeigering?: string | null;
  readonly modelAanroepen: ModelAanroep[];
  plan?: {
    parse?: { ok: boolean; terugval: string | null };
    geparsed?: unknown;
    bewaking?: readonly BewakingsStap[];
    definitief?: unknown;
  };
  readonly tools: {
    tool: string;
    invoer: unknown;
    ok: boolean;
    ms: number;
    note: string | null;
    fout: string | null;
    gesimuleerd: boolean;
    data: unknown;
    bronnen: readonly string[];
  }[];
  /** Welke tak de compose nam (door de modeladapter gezet). */
  composePad?: string;
  compose?: { pad: string; status: string; tekst: string; dataSleutels: readonly string[]; bronnen: readonly string[] };
  readonly poorten: { naam: string; uitkomst: PoortUitkomst; reden: string; bewijs: unknown; tekstVoor?: string; tekstNa?: string }[];
  eind?: {
    status: string;
    intent: string;
    tekst: string;
    bronnen: readonly string[];
    geheugenvoorstel: { uitPlan: boolean; naBewaking: boolean; inAntwoord: boolean };
  };
}

const opslag = new AsyncLocalStorage<AgentTrace>();

export function nieuweTrace(labels: Record<string, unknown> = {}): AgentTrace {
  return { schema: "ns-agent-trace/1", traceId: randomUUID(), gestart: new Date().toISOString(), labels, modelAanroepen: [], tools: [], poorten: [] };
}

/** Voer `werk` uit met `trace` als actieve beurttrace. */
export function metTrace<T>(trace: AgentTrace, werk: () => Promise<T>): Promise<T> {
  return opslag.run(trace, werk);
}

/** De actieve trace, of `null` buiten een trace (dan is opnemen een no-op). */
export function actieveTrace(): AgentTrace | null {
  return opslag.getStore() ?? null;
}

/** Diepe, JSON-zuivere kopie: een snapshot mag later niet meeveranderen. */
export function momentopname<T>(waarde: T): T {
  return waarde === undefined ? waarde : (JSON.parse(JSON.stringify(waarde)) as T);
}

/** Welke velden van het plan veranderden (ondiep, op JSON-waarde). */
export function gewijzigdeVelden(voor: Record<string, unknown>, na: Record<string, unknown>): string[] {
  const sleutels = [...new Set([...Object.keys(voor), ...Object.keys(na)])];
  return sleutels.filter((k) => JSON.stringify(voor[k]) !== JSON.stringify(na[k])).sort();
}

export const sha256 = (tekst: string): string => createHash("sha256").update(tekst, "utf8").digest("hex");

/**
 * Een trace kleiner maken voor opslag naast een meting: identieke
 * systeeminstructies (vele kilobytes, per beurt gelijk) één keer bewaren, per
 * hash. Het resultaat is verliesvrij terug te zetten met `zetSysteemTerug`.
 */
export function ontdubbelSysteem(traces: readonly AgentTrace[]): { traces: AgentTrace[]; systeem: Record<string, string> } {
  const systeem: Record<string, string> = {};
  const uit = traces.map((t) => ({
    ...t,
    modelAanroepen: t.modelAanroepen.map((a) => ({
      ...a,
      verzoek: {
        ...a.verzoek,
        messages: a.verzoek.messages.map((m) => {
          if (m.role !== "system") return m;
          const h = sha256(m.content);
          systeem[h] = m.content;
          return { role: "system", content: `sha256:${h}` };
        }),
      },
    })),
  }));
  return { traces: uit, systeem };
}

export function zetSysteemTerug(traces: readonly AgentTrace[], systeem: Readonly<Record<string, string>>): AgentTrace[] {
  return traces.map((t) => ({
    ...t,
    modelAanroepen: t.modelAanroepen.map((a) => ({
      ...a,
      verzoek: {
        ...a.verzoek,
        messages: a.verzoek.messages.map((m) => (m.role === "system" && m.content.startsWith("sha256:") ? { role: "system", content: systeem[m.content.slice(7)] ?? m.content } : m)),
      },
    })),
  }));
}
