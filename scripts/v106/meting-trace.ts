import { writeFileSync } from "node:fs";
import path from "node:path";
import { meetOmgeving } from "@/server/agent/meetomgeving";
import { type AgentTrace, metTrace, nieuweTrace, ontdubbelSysteem } from "@/server/agent/trace";

export { meetOmgeving };

/**
 * Tracing voor elke meting (kern, extensie, adversarial, r2, diagnose).
 *
 * Twee delen, allebei naast het meetbestand in `traces.json`:
 *  - `omgeving`: wat er op déze machine draaide — commit en werkboomstatus,
 *    de hash van elk agentbestand zoals het op schijf stond, de actieve
 *    Lyra-versie (met hash van de systeemtoevoeging) en de recente activaties,
 *    het model met zijn digest volgens Ollama, en de agentbevoegdheid;
 *  - `traces`: per beurt de volledige keten (src/server/agent/trace.ts).
 *
 * Aanleiding: bij adversarial M (20260930) was achteraf niet vast te stellen of
 * twee metingen met dezelfde code ook dezelfde systeeminstructie gebruikten —
 * de actieve Lyra-versie staat alleen op de meetmachine.
 */

/** Verzamelt de traces van één meting. */
export class MetingTraces {
  private readonly lijst: AgentTrace[] = [];
  constructor(private readonly meting: string) {}

  /** Eén agentbeurt met trace; de trace gaat mee in het meetbestand `traces.json`. */
  async beurt<T>(labels: Record<string, unknown>, werk: () => Promise<T>): Promise<T> {
    const trace = nieuweTrace({ meting: this.meting, ...labels });
    this.lijst.push(trace);
    return metTrace(trace, werk);
  }

  get traces(): readonly AgentTrace[] {
    return this.lijst;
  }

  /** Schrijft `traces.json` (nooit overschrijven: bewijsmateriaal). */
  schrijf(map: string, omgeving: Record<string, unknown>, bestand = "traces.json"): string {
    const uit = path.join(map, bestand);
    const { traces, systeem } = ontdubbelSysteem(this.lijst);
    writeFileSync(uit, `${JSON.stringify({ schema: "ns-meting-traces/1", meting: this.meting, omgeving, systeeminstructies: systeem, traces }, null, 1)}\n`, { flag: "wx" });
    return uit;
  }
}
