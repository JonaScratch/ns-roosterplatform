import "server-only";
import { z } from "zod";
import type { CandidateAssignment } from "@/domain/candidate";
import { type QualityDuty, type QualityRosterInput, dutyKey } from "@/domain/roster-quality";
import { prisma } from "@/server/data/prisma";
import { type QualityContext, candidateRosterInputs, loadQualityContextCore } from "@/server/services/roster-quality-service";

/**
 * Waar gaat de vraag over?
 *
 * ## Waarom dit een eigen laag is
 *
 * "Waarom staat die dienst hier?" is zonder context onbeantwoordbaar. Het
 * scherm weet wél waar de gebruiker naar keek: welke kandidaat, welk
 * basisrooster, welke regel, welke dag. Die verwijzing komt hier binnen als
 * gegevens en wordt omgezet in echte objecten: roosterdagen met dienstnummers,
 * en dienstinstanties met hun werkelijke begin- en eindtijd op díe weekdag.
 *
 * ## Een dienstnummer is geen dienst
 *
 * Dienst 115 begint op donderdag om 09:47 en op dinsdag om 17:19. Alles in deze
 * laag werkt daarom met de combinatie nummer + weekdag, nooit met het nummer
 * alleen. Dat is dezelfde afspraak als in de rest van het platform.
 */

export const uiContextSchema = z.object({
  /** Het officiële rooster of een kandidaat. Zonder opgave: het officiële. */
  source: z.enum(["official", "candidate"]).default("official"),
  candidateId: z.string().min(1).nullish(),
  rosterCode: z.string().min(1).nullish(),
  lineNumber: z.number().int().positive().nullish(),
  weekday: z.number().int().min(1).max(7).nullish(),
  dutyCode: z.string().min(1).nullish(),
  locationCode: z.string().min(1).default("DDR"),
});

export type UiContext = z.infer<typeof uiContextSchema>;

export interface ResolvedContext {
  readonly locationCode: string;
  readonly source: "official" | "candidate";
  readonly candidate: { readonly id: string; readonly label: string; readonly validationState: string } | null;
  readonly quality: QualityContext;
  readonly rosters: readonly QualityRosterInput[];
  readonly roster: QualityRosterInput | null;
  readonly lineNumber: number | null;
  readonly weekday: number | null;
  /** De dienstinstantie waar de vraag over gaat, als die uit de context volgt. */
  readonly duty: QualityDuty | null;
  /** Wat de agent hierover mag zeggen als de context onvolledig is. */
  readonly missing: readonly string[];
}

/** Zet een verwijzing uit het scherm om in echte roosterobjecten. */
export async function resolveContext(input: UiContext): Promise<ResolvedContext> {
  const ctx = uiContextSchema.parse(input);
  const quality = await loadQualityContextCore(ctx.locationCode);
  const missing: string[] = [];

  let rosters: readonly QualityRosterInput[] = quality.official;
  let candidate: ResolvedContext["candidate"] = null;
  if (ctx.source === "candidate") {
    const rij = ctx.candidateId
      ? await prisma.candidateRoster.findUnique({ where: { id: ctx.candidateId }, select: { id: true, scenarioLabel: true, validationState: true, assignments: true, locationCode: true } })
      : null;
    if (!rij) {
      missing.push("kandidaat");
    } else {
      candidate = { id: rij.id, label: rij.scenarioLabel, validationState: rij.validationState };
      rosters = candidateRosterInputs(rij.assignments as unknown as CandidateAssignment[], quality);
    }
  }

  const roster = ctx.rosterCode ? (rosters.find((r) => r.code === ctx.rosterCode) ?? null) : null;
  if (ctx.rosterCode && !roster) missing.push(`basisrooster ${ctx.rosterCode}`);
  if (!ctx.rosterCode) missing.push("basisrooster");
  if (roster && ctx.lineNumber && !roster.days.some((d) => d.lineNumber === ctx.lineNumber)) missing.push(`regel ${ctx.lineNumber}`);

  let duty: QualityDuty | null = null;
  if (ctx.dutyCode && ctx.weekday) {
    duty = quality.duties.get(dutyKey(ctx.dutyCode, ctx.weekday)) ?? null;
    if (!duty) missing.push(`dienst ${ctx.dutyCode} op weekdag ${ctx.weekday}`);
  } else if (roster && ctx.lineNumber && ctx.weekday) {
    const dag = roster.days.find((d) => d.lineNumber === ctx.lineNumber && d.weekday === ctx.weekday);
    duty = dag?.dutyCode ? (quality.duties.get(dutyKey(dag.dutyCode, ctx.weekday)) ?? null) : null;
  }

  return {
    locationCode: ctx.locationCode,
    source: ctx.source,
    candidate,
    quality,
    rosters,
    roster,
    lineNumber: ctx.lineNumber ?? null,
    weekday: ctx.weekday ?? null,
    duty,
    missing,
  };
}

/** Eén regel van een basisrooster, met de echte tijden erbij. */
export interface LineDay {
  readonly weekday: number;
  readonly positionType: string;
  readonly dutyCode: string | null;
  readonly startMinute: number | null;
  readonly endMinute: number | null;
  readonly kinds: readonly string[];
}

export function lineDays(roster: QualityRosterInput, lineNumber: number, duties: ReadonlyMap<string, QualityDuty>): LineDay[] {
  return roster.days
    .filter((d) => d.lineNumber === lineNumber)
    .sort((a, b) => a.weekIndex - b.weekIndex || a.weekday - b.weekday)
    .map((d) => {
      const duty = d.dutyCode ? duties.get(dutyKey(d.dutyCode, d.weekday)) : undefined;
      return {
        weekday: d.weekday,
        positionType: d.positionType,
        dutyCode: d.dutyCode,
        startMinute: duty?.startMinute ?? null,
        endMinute: duty?.endMinute ?? null,
        kinds: duty?.kinds ?? [],
      };
    });
}

/** Kloktijd; een dienst die na middernacht eindigt krijgt "(+1)" mee. */
export const klok = (m: number | null): string | null =>
  m === null ? null : `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}${m >= 1440 ? " (+1)" : ""}`;

/** Duur, niet afgekapt op 24 uur: 39:59 is geen 15:59. */
export const duur = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export const DAG_NAMEN = ["", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"] as const;
