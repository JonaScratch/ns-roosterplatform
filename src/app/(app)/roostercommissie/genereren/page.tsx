import Link from "next/link";
import { z } from "zod";
import {
  currentRosterYear,
  describeRosterYear,
  rosterYear,
  selectableRosterYears,
} from "@/domain/roster-year";
import { listBaseRosters } from "@/server/services/roster-service";
import { strategyTiles } from "@/server/services/candidate-results-service";
import {
  activeGenerationRun,
  generationRun,
  recentGenerationRuns,
  runJson,
} from "@/server/services/generation-service";
import { standaardZoekmodus, zoekmodi } from "@/server/services/search-mode-options";
import { RosterCommitteeShell } from "@/components/layout/area-shell";
import { Alert, Badge, EmptyState, type Tone, WidgetCard } from "@/components/ui/primitives";
import { ClockIcon, SparkIcon } from "@/components/ui/icons";
import { GeneratieWerkblad } from "./generatie-werkblad";

export const dynamic = "force-dynamic";

/**
 * Nieuw rooster genereren.
 *
 * ## Wat hier gebeurt en wat niet
 *
 * Hier wordt een opdracht gegeven en gevolgd: strategie kiezen, roosterjaar
 * kiezen, starten. De uitkomst — tot drie complete, onafhankelijk gevalideerde
 * kandidaten — staat daarna onder Scenario's vergelijken. Daar wordt niets
 * gegenereerd; hier wordt niets beoordeeld.
 *
 * ## Waarom er geen basisroosterkeuze is
 *
 * Een opdracht neemt altijd alle basisroosters van de standplaats tegelijk mee.
 * Eerst Vroeg vullen en de rest de overgebleven diensten geven, benadeelt de
 * roosters die later aan de beurt zijn aantoonbaar.
 */
export default async function Genereren({
  searchParams,
}: {
  searchParams: Promise<{ run?: string }>;
}) {
  const { run: gevraagdeRun } = await searchParams;
  const [rosters, actief, recent] = await Promise.all([
    listBaseRosters(),
    activeGenerationRun(),
    recentGenerationRuns(8),
  ]);
  // Een lopende opdracht gaat voor; anders de opdracht uit de verwijzing, zodat
  // wie na een herbouw of een afgeronde opdracht hier terugkomt, de uitkomst ziet.
  const getoond =
    actief ??
    (gevraagdeRun && z.uuid().safeParse(gevraagdeRun).success
      ? await generationRun(gevraagdeRun).catch(() => null)
      : null);
  const huidig = currentRosterYear();
  const volgend = rosterYear(huidig.year + 1);
  const jaren = selectableRosterYears().map((jaar) => ({
    year: jaar.year,
    label: `${jaar.year}${jaar.year === huidig.year ? " (lopend)" : ""}`,
    period: `${describeRosterYear(jaar)} (${jaar.weeks} weken)`,
  }));

  return (
    <RosterCommitteeShell
      activeHref="/roostercommissie/genereren"
      header={{
        title: "Genereren & simulatie",
        subtitle: "Een opdracht geven: tot drie complete roosterpakketten, automatisch gevalideerd",
      }}
    >
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <WidgetCard
            icon={<SparkIcon size={18} />}
            tone="rc"
            title="Nieuw rooster genereren"
            subtitle={`Alle ${rosters.length} basisroosters van de standplaats in één opdracht`}
            bodyClassName="border-t border-line p-4"
          >
            {rosters.length === 0 ? (
              <EmptyState>Er zijn nog geen basisroosters om te genereren.</EmptyState>
            ) : (
              <GeneratieWerkblad
                strategies={strategyTiles()}
                years={jaren}
                modes={zoekmodi()}
                defaultMode={standaardZoekmodus()}
                defaultYear={volgend.year}
                initialRun={getoond ? runJson(getoond) : null}
              />
            )}
          </WidgetCard>
        </div>

        <div className="space-y-4">
          <WidgetCard
            icon={<ClockIcon size={18} />}
            tone="neutral"
            title="Recente opdrachten"
            subtitle="De uitkomsten staan onder Scenario's vergelijken"
            bodyClassName="border-t border-line px-4 py-2"
          >
            {recent.length === 0 ? (
              <div className="py-2">
                <EmptyState>Nog geen opdrachten gegeven.</EmptyState>
              </div>
            ) : (
              <ul className="divide-y divide-line/70">
                {recent.map((run) => (
                  <li key={run.id} className="py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[12.5px] font-semibold text-ink">
                          {run.kind === "REBUILD" ? `Herbouw · ${run.strategyLabel}` : run.strategyLabel}
                        </p>
                        <p className="text-[11px] text-ink-muted">
                          Roosterjaar {run.rosterYear} · {datumTijd(run.createdAt)}
                          {run.elapsedSeconds !== null ? ` · ${duur(run.elapsedSeconds)}` : ""}
                        </p>
                      </div>
                      <Badge tone={RUN_TONE[run.status] ?? "neutral"}>{run.statusLabel}</Badge>
                    </div>
                    <p className="mt-0.5 text-[11.5px] text-ink-muted">
                      {run.foundCandidates} van {run.requestedCandidates}{" "}
                      {run.requestedCandidates === 1 ? "kandidaat" : "kandidaten"}
                      {run.foundCandidates > 0 && !run.active ? (
                        <>
                          {" · "}
                          <Link
                            href={`/roostercommissie/simulatie?run=${run.id}`}
                            className="font-semibold text-accent-rc hover:underline"
                          >
                            Bekijken
                          </Link>
                        </>
                      ) : null}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </WidgetCard>

          <Alert tone="info" title="Wat een opdracht doet">
            <ol className="mt-1 list-decimal space-y-1 pl-4 text-[12px]">
              <li>Het dienstenpakket en de roosterstructuur worden gecontroleerd.</li>
              <li>
                De solver bouwt alle basisroosters tegelijk op. Hard: elke dienst geplaatst, alleen
                diensten die het roosterprofiel toestaat, rust en reeksgrenzen.
              </li>
              <li>
                Nachtreeksen, overgangen en uren worden gemeten. Bij losse nachten of zware
                overgangen volgt één gerichte verbeterpass.
              </li>
              <li>
                De eindvalidatie rekent de kandidaat onafhankelijk na. Alleen een kandidaat met nul
                bevestigde harde overtredingen wordt bewaard.
              </li>
              <li>
                De volgende kandidaat moet op ten minste een tiende van de dienstdagen verschillen.
                Lukt dat niet binnen de rekentijd, dan zijn het er minder dan drie.
              </li>
            </ol>
          </Alert>

          <Alert tone="neutral" title="Geen publicatie">
            Genereren legt niets vast en publiceert niets. De publicatiepoort blijft ongewijzigd:
            zolang de regelbron niet formeel is bevestigd, kan geen kandidaat worden gepubliceerd.
            Feedback van medewerkers gaat alleen geaggregeerd per roosterprofiel mee.
          </Alert>
        </div>
      </div>
    </RosterCommitteeShell>
  );
}

const RUN_TONE: Record<string, Tone> = {
  QUEUED: "info",
  RUNNING: "info",
  COMPLETED: "ok",
  PARTIAL: "warn",
  FAILED: "error",
  CANCELLED: "neutral",
  INTERRUPTED: "warn",
};

function datumTijd(moment: Date): string {
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(moment);
}

function duur(seconden: number): string {
  const minuten = Math.floor(seconden / 60);
  return minuten === 0 ? `${seconden} s` : `${minuten} min ${String(seconden % 60).padStart(2, "0")} s`;
}
