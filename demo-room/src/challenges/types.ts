/**
 * Het challengeformaat (§6 van de opdracht). Zie ook demo-room/docs/CHALLENGE-FORMAT.md.
 */

export type ChallengeCategory =
  | "DIRECTE_ANALYSE"
  | "ONBEKENDE_VARIANT"
  | "CONFLICTERENDE_DOELEN"
  | "OPEN_DIAGNOSE"
  | "ADVERSARIAL_USER"
  | "WAARSCHIJNLIJK_ONMOGELIJK"
  | "LONG_HORIZON_RESEARCH";

export type ChallengeTrack =
  /** Spoor A: Lyra als chatbot — één of meer beurten door askAgent(). */
  | "CHATBOT"
  /** Spoor B: Lyra als autonome roosteronderzoeker — via de onderzoekslus. */
  | "RESEARCHER";

export interface ChallengeTurn {
  readonly text: string;
}

export interface HiddenInvariant {
  readonly id: string;
  readonly description: string;
  /**
   * Wordt na afloop gecontroleerd, buiten het zicht van Lyra — Lyra ziet deze
   * beschrijving nooit in haar prompt (§8 van de opdracht: verborgen evaluatie).
   */
  readonly check: (answer: { readonly text: string; readonly data: unknown; readonly sources: readonly string[]; readonly status: string }) => boolean;
}

export interface ChallengeDefinition {
  readonly id: string;
  readonly name: string;
  readonly category: ChallengeCategory;
  readonly track: ChallengeTrack;
  /** 1 (makkelijkst) t/m 7 (open-ended, lange horizon). */
  readonly difficulty: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  readonly datasetLocationCode: string;
  readonly startCandidate: "official" | "candidate";
  /** De zichtbare opdracht — wat Lyra te zien krijgt. */
  readonly visibleTask: string;
  /** CHATBOT: de beurten die worden gestuurd. RESEARCHER: leeg — het doel staat in visibleTask/researchGoal. */
  readonly turns: readonly ChallengeTurn[];
  /** RESEARCHER-track: het doel + herbouwdoelen die aan startResearchLoop worden meegegeven. */
  readonly researchGoal?: { readonly goal: string; readonly goals: readonly string[]; readonly searchMode: "FAST" | "NORMAL" | "DEEP" | "EXTENSIVE" };
  readonly hiddenInvariants: readonly HiddenInvariant[];
  readonly computeBudgetMinutes: number;
  readonly maxOptimizerRuns: number;
  readonly maxModelCalls: number;
  readonly seed?: number;
  /**
   * Wat een "goed" resultaat betekent voor dít type opdracht — inclusief het
   * expliciet toegestane "geen betere oplossing gevonden" (§7 van de opdracht).
   */
  readonly expectedInvariants: readonly string[];
  /** Voor level 5 (adversarial user): is de aanname in de opdracht zelf fout? */
  readonly premiseIsFalse?: boolean;
}
