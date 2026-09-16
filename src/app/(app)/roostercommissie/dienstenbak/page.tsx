import Link from "next/link";
import { formatDuration, formatMinuteOfDay, weekdayLabel } from "@/domain/time";
import { PLACEMENT_LABELS, type PlacementCategory } from "@/domain/duty-placement";
import { dutyPool } from "@/server/services/duty-pool-service";
import { RosterCommitteeShell } from "@/components/layout/area-shell";
import { LocationSelector } from "@/components/layout/location-selector";
import { Alert, Badge, EmptyState, WidgetCard } from "@/components/ui/primitives";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";
import { DutyKinds } from "@/components/schedule/duty-label";

export const dynamic = "force-dynamic";

/**
 * De dienstenbak.
 *
 * ## Waarom elk getal hier een lijst is
 *
 * "223 diensten, waarvan 198 geplaatst" is pas bruikbaar als je kunt doorklikken
 * naar wélke 25 er niet in zitten. Elke telling op deze pagina is daarom een
 * filter: klik erop en je ziet precies die diensten. Een getal zonder lijst
 * eronder is een getal dat niemand kan controleren.
 */

const PLAATSING_TONEN: Record<string, "ok" | "warn" | "neutral"> = {
  IN_FIXED_ROSTER: "ok",
  IN_RESERVE_STOCK: "neutral",
  NOT_PLACEABLE: "warn",
  EXCLUDED: "neutral",
};

export default async function Dienstenbak({
  searchParams,
}: {
  searchParams: Promise<{ standplaats?: string; soort?: string; plaatsing?: string }>;
}) {
  const params = await searchParams;
  const { summary, duties } = await dutyPool(params.standplaats ?? null);

  const gefilterd = duties.filter((duty) => {
    if (params.soort && !duty.kinds.includes(params.soort)) {
      return false;
    }
    if (params.plaatsing && duty.placement !== params.plaatsing) {
      return false;
    }
    return true;
  });

  const basis = new URLSearchParams();
  if (params.standplaats) {
    basis.set("standplaats", params.standplaats);
  }
  const filterHref = (sleutel: string, waarde: string | null) => {
    const zoek = new URLSearchParams(basis);
    if (params.soort && sleutel !== "soort") {
      zoek.set("soort", params.soort);
    }
    if (params.plaatsing && sleutel !== "plaatsing") {
      zoek.set("plaatsing", params.plaatsing);
    }
    if (waarde) {
      zoek.set(sleutel, waarde);
    }
    return `/roostercommissie/dienstenbak?${zoek.toString()}`;
  };

  return (
    <RosterCommitteeShell
      activeHref="/roostercommissie/dienstenbak"
      header={{
        title: "Dienstenbak",
        subtitle: summary.packageLabel
          ? `${summary.locationCode} — ${summary.packageLabel} · ${summary.total} diensten`
          : `${summary.locationCode} — nog geen dienstenpakket`,
      }}
    >
      <div className="mb-3">
        <LocationSelector requested={params.standplaats ?? null} />
      </div>

      {summary.total === 0 ? (
        <EmptyState>
          Voor deze standplaats is nog geen dienstenpakket ingelezen. De dienstenbak vult zich
          zodra een levering is bevestigd.
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <WidgetCard title="Dienstsoorten" subtitle="Klik om te filteren.">
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {Object.entries(summary.byKind).map(([soort, aantal]) => (
                  <Link
                    key={soort}
                    href={filterHref("soort", params.soort === soort ? null : soort)}
                    className={`rounded border p-2 text-center ${
                      params.soort === soort ? "border-ink" : "border-line"
                    }`}
                  >
                    <span className="block text-lg font-semibold tabular">{aantal}</span>
                    <span className="text-[11px] text-ink-muted">{soort.toLowerCase()}</span>
                  </Link>
                ))}
              </div>
            </WidgetCard>

            <WidgetCard title="Waar de diensten terechtkomen" subtitle="Klik om te filteren.">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(
                  [
                    "IN_FIXED_ROSTER",
                    "IN_RESERVE_STOCK",
                    "NOT_PLACEABLE",
                    "EXCLUDED",
                  ] as PlacementCategory[]
                ).map((categorie) => (
                  <Link
                    key={categorie}
                    href={filterHref(
                      "plaatsing",
                      params.plaatsing === categorie ? null : categorie,
                    )}
                    className={`rounded border p-2 ${
                      params.plaatsing === categorie ? "border-ink" : "border-line"
                    }`}
                  >
                    <span className="block text-lg font-semibold tabular">
                      {summary.placement[categorie] ?? 0}
                    </span>
                    <span className="text-[11px] text-ink-muted">
                      {PLACEMENT_LABELS[categorie]}
                    </span>
                  </Link>
                ))}
              </div>
            </WidgetCard>
          </div>

          {summary.notPlaceable.length > 0 && (
            <div className="mt-4">
              <Alert tone="warn" title={`${summary.notPlaceable.length} diensten zijn niet te plaatsen`}>
                {summary.notPlaceable
                  .slice(0, 3)
                  .map((duty) => `${duty.code}: ${duty.explanation[0]}`)
                  .join(" · ")}
              </Alert>
            </div>
          )}

          <div className="mt-4">
            <WidgetCard
              title={`Diensten (${gefilterd.length})`}
              subtitle={
                summary.sourceFilename
                  ? `Bron: ${summary.sourceFilename} · SHA-256 ${summary.checksum?.slice(0, 12)}…`
                  : "Herkomst niet vastgelegd."
              }
            >
              {gefilterd.length === 0 ? (
                <EmptyState>Geen diensten die aan dit filter voldoen.</EmptyState>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Dienst</TH>
                      <TH>Tijden</TH>
                      <TH numeric>Duur</TH>
                      <TH>Soort</TH>
                      <TH>Weekdagen</TH>
                      <TH>Plaatsing</TH>
                    </TR>
                  </THead>
                  <tbody>
                    {gefilterd.map((duty) => (
                      <TR key={`${duty.code}|${duty.weekday}`}>
                        <TD mono>
                          <Link
                            href={`/roostercommissie/dienstenbak/${duty.code}?weekdag=${duty.weekday}${
                              params.standplaats ? `&standplaats=${params.standplaats}` : ""
                            }`}
                            className="underline"
                          >
                            {duty.code}
                          </Link>
                          {duty.description && (
                            <span className="block font-sans text-[11px] text-ink-muted">
                              {duty.description}
                            </span>
                          )}
                        </TD>
                        <TD>
                          <span className="tabular text-[11.5px]">
                            {formatMinuteOfDay(duty.startMinute)}–
                            {formatMinuteOfDay(duty.endMinute)}
                          </span>
                        </TD>
                        <TD numeric>{formatDuration(duty.durationMinutes)}</TD>
                        <TD>
                          <DutyKinds kinds={duty.kinds} />
                        </TD>
                        <TD>
                          <span className="text-[11px] text-ink-muted">
                            {weekdayLabel(duty.weekday)}
                          </span>
                        </TD>
                        <TD>
                          <Badge tone={PLAATSING_TONEN[duty.placement] ?? "neutral"}>
                            {PLACEMENT_LABELS[duty.placement as PlacementCategory] ??
                              duty.placement}
                          </Badge>
                        </TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              )}
            </WidgetCard>
          </div>
        </>
      )}
    </RosterCommitteeShell>
  );
}
