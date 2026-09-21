/**
 * Wat er tussen het scherm en de agent heen en weer gaat.
 *
 * Bewust een eigen bestand: uit een `"use server"`-module mogen alleen
 * asynchrone functies worden geëxporteerd.
 */

export interface AgentContextKeuze {
  readonly source: "official" | "candidate";
  readonly candidateId: string | null;
  readonly rosterCode: string | null;
  readonly lineNumber: number | null;
  readonly weekday: number | null;
  readonly dutyCode: string | null;
  readonly locationCode: string;
}

/** Eén antwoord, met alles wat nodig is om het te kunnen narekenen. */
export interface AgentAntwoordJson {
  readonly ok: boolean;
  readonly sessionId: string | null;
  readonly text: string;
  readonly status: string;
  readonly intent: string;
  readonly reasoning: string;
  readonly sources: readonly string[];
  readonly tools: readonly { readonly tool: string; readonly ok: boolean; readonly durationMs: number }[];
  readonly contextUsed: {
    readonly source: string;
    readonly rosterCode: string | null;
    readonly lineNumber: number | null;
    readonly weekday: number | null;
    readonly dutyCode: string | null;
    readonly missing: readonly string[];
  };
  /**
   * Het basisrooster waar de agent werkelijk naar keek.
   *
   * Kan afwijken van de keuzelijst: wie in zijn vraag een rooster noemt,
   * bedoelt dat rooster. Het scherm zegt het erbij als die twee verschillen —
   * anders staat er een antwoord over het ene rooster onder een label van het
   * andere.
   */
  readonly usedRosterCode: string | null;
  readonly level: "A" | "B" | "C";
  readonly model: string;
  /** Onwaar bij de lokale stub. Het scherm moet dat blijven tonen. */
  readonly isLanguageModel: boolean;
}

export interface GesprekBericht {
  readonly id: string;
  readonly rol: "USER" | "AGENT";
  readonly tekst: string;
  readonly status?: string;
  readonly sources?: readonly string[];
  readonly tools?: readonly string[];
  readonly missing?: readonly string[];
  readonly context?: string | null;
}
