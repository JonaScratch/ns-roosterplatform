import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDuration } from "@/domain/time";
import { WEEKDAY_HEADS, rosterView } from "@/server/services/roster-inspection-service";
import { RosterCommitteeShell } from "@/components/layout/area-shell";
import { LocationSelector } from "@/components/layout/location-selector";
import { EmptyState, WidgetCard } from "@/components/ui/primitives";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";

export const dynamic = "force-dynamic";

/**
 * Het rooster, cel voor cel.
 *
 * ## Waarom elke cel zijn eigen verhaal draagt
 *
 * Een roostercel is niet "042". Het is een dienst met een begintijd, een
 * eindtijd, een dagdeel, een dienst ervoor en een dienst erna, en daartussen
 * een hoeveelheid rust. Wie een rooster beoordeelt, heeft die context nodig —
 * anders is het een tabel met nummers en beoordeelt niemand iets.
 *
 * De uitleg staat daarom in de cel zelf (als tooltip) en niet in een handleiding.
 *
 * ## Waarom er geen kleurenfestival is
 *
 * Nachtdiensten en rangeerwerk krijgen een terughoudende markering, weekenden
 * een lichtere achtergrond. Meer niet. Een rooster met acht kleuren leest als
 * een spel; dit is het document waarop iemand zijn jaar plant.
 */
export default async function Roosterweergave({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ standplaats?: string }>;
}) {
  const [{ code }, query] = await Promise.all([params, searchParams]);
  const view = await rosterView(code, query.standplaats ?? null);
  if (!view) {
    notFound();
  }

  return (
    <RosterCommitteeShell
      activeHref="/roostercommissie/roosters"
      header={{
        title: `${view.code} — ${view.name}`,
        subtitle: `${view.profileLabel} · ${view.lines.length} regels · cyclus van ${view.cycleWeeks} weken`,
      }}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px]">
          <Link href="/roostercommissie/roosters" className="text-ink-muted underline">
            ← Basisroosters
          </Link>
          <a
            href={`/roostercommissie/roosterblad/${view.code}`}
            className="ml-3 underline"
            target="_blank"
            rel="noreferrer"
          >
            Roosterblad openen
          </a>
        </p>
        <LocationSelector requested={query.standplaats ?? null} />
      </div>

      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: "Regels", waarde: view.totals.lines },
          { label: "Dienstdagen", waarde: view.totals.dutyDays },
          { label: "Nachtdiensten", waarde: view.totals.nightDuties },
          { label: "Rangeerdiensten", waarde: view.totals.shuntingDuties },
          { label: "Weekenddiensten", waarde: view.totals.weekendDuties },
          { label: "Lege dienstdagen", waarde: view.totals.emptyDutyDays },
        ].map((kaart) => (
          <div key={kaart.label} className="rounded border border-line p-2">
            <span className="block text-lg font-semibold tabular">{kaart.waarde}</span>
            <span className="text-[11px] text-ink-muted">{kaart.label}</span>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <WidgetCard
          title="Het rooster"
          subtitle="Beweeg over een cel voor de dienst, de rust ervoor en de rust erna."
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr>
                  <th className="border border-line bg-surface-2 p-1 text-left">Regel</th>
                  <th className="border border-line bg-surface-2 p-1 text-left">Mw.</th>
                  {Array.from({ length: view.cycleWeeks }, (_, week) =>
                    WEEKDAY_HEADS.map((kop) => (
                      <th
                        key={`${week}-${kop.weekday}`}
                        className={`border border-line p-1 text-center font-semibold ${
                          kop.weekend ? "bg-surface-2" : "bg-surface-2"
                        }`}
                      >
                        <span className="block text-[9px] text-ink-muted">w{week + 1}</span>
                        {kop.label}
                      </th>
                    )),
                  )}
                </tr>
              </thead>
              <tbody>
                {view.lines.map((line) => (
                  <tr key={line.lineNumber}>
                    <td className="border border-line p-1 font-semibold tabular">
                      {line.lineNumber}
                    </td>
                    <td className="border border-line p-1 font-mono text-[10px] text-ink-muted">
                      {line.occupiedBy ?? "—"}
                    </td>
                    {line.cells.map((cel) => (
                      <td
                        key={`${cel.weekIndex}-${cel.weekday}`}
                        title={cel.summary}
                        className={`border border-line p-1 text-center tabular ${
                          cel.weekend ? "bg-surface-2/60" : ""
                        } ${
                          cel.positionType !== "DUTY"
                            ? "text-ink-muted"
                            : cel.kinds.includes("NACHT")
                              ? "font-semibold text-indigo-700"
                              : cel.shunting
                                ? "text-teal-700"
                                : "text-ink"
                        }`}
                      >
                        {cel.positionType === "DUTY" && !cel.dutyCode ? (
                          <span className="text-amber-700">leeg</span>
                        ) : (
                          <Link
                            href={
                              cel.dutyCode
                                ? `/roostercommissie/dienstenbak/${cel.dutyCode}?weekdag=${cel.weekday}${
                                    query.standplaats ? `&standplaats=${query.standplaats}` : ""
                                  }`
                                : "#"
                            }
                            className={cel.dutyCode ? "underline decoration-dotted" : ""}
                          >
                            {cel.label}
                          </Link>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-ink-muted">
            Nachtdiensten staan in donkerblauw, rangeerwerk in groenblauw, ankerdagen grijs.
            Zaterdag en zondag hebben een lichtere achtergrond. Een cel met &quot;leeg&quot; is een
            dienstdag zonder dienstnummer — zichtbaar in plaats van stilzwijgend gevuld.
          </p>
        </WidgetCard>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <WidgetCard title="Per regel" subtitle="De belasting per roosterlijn.">
          <Table>
            <THead>
              <TR>
                <TH numeric>Regel</TH>
                <TH numeric>Diensten</TH>
                <TH numeric>Nacht</TH>
                <TH numeric>Rangeer</TH>
                <TH numeric>Weekend</TH>
                <TH numeric>Rust</TH>
                <TH numeric>Reserve</TH>
                <TH>Kortste rust</TH>
              </TR>
            </THead>
            <tbody>
              {view.lines.map((line) => (
                <TR key={line.lineNumber}>
                  <TD numeric>{line.lineNumber}</TD>
                  <TD numeric>{line.dutyDays}</TD>
                  <TD numeric>{line.nightDuties}</TD>
                  <TD numeric>{line.shuntingDuties}</TD>
                  <TD numeric>{line.weekendDuties}</TD>
                  <TD numeric>{line.restDays}</TD>
                  <TD numeric>{line.reserveDays}</TD>
                  <TD>
                    {line.shortestRest === null ? (
                      <span className="text-ink-muted">—</span>
                    ) : (
                      <span className="tabular">{formatDuration(line.shortestRest)}</span>
                    )}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </WidgetCard>

        <WidgetCard
          title="Uitersten"
          subtitle="Om het rooster te beoordelen, niet de mensen erin."
        >
          <Table>
            <tbody>
              <TR>
                <TD>Kortste geplande rust</TD>
                <TD>
                  {view.extremes.shortestRest ? (
                    <>
                      <span className="tabular">
                        {formatDuration(view.extremes.shortestRest.minutes)}
                      </span>{" "}
                      <span className="text-[11px] text-ink-muted">
                        (regel {view.extremes.shortestRest.line})
                      </span>
                    </>
                  ) : (
                    "—"
                  )}
                </TD>
              </TR>
              <TR>
                <TD>Langste dienst</TD>
                <TD>
                  {view.extremes.longestDuty ? (
                    <>
                      <span className="font-mono">{view.extremes.longestDuty.code}</span>{" "}
                      <span className="tabular">
                        {formatDuration(view.extremes.longestDuty.minutes)}
                      </span>{" "}
                      <span className="text-[11px] text-ink-muted">
                        (regel {view.extremes.longestDuty.line})
                      </span>
                    </>
                  ) : (
                    "—"
                  )}
                </TD>
              </TR>
              <TR>
                <TD>Meeste nachtdiensten</TD>
                <TD>
                  {view.extremes.mostNights
                    ? `${view.extremes.mostNights.count} (regel ${view.extremes.mostNights.line})`
                    : "—"}
                </TD>
              </TR>
              <TR>
                <TD>Meeste rangeerdiensten</TD>
                <TD>
                  {view.extremes.mostShunting
                    ? `${view.extremes.mostShunting.count} (regel ${view.extremes.mostShunting.line})`
                    : "—"}
                </TD>
              </TR>
              <TR>
                <TD>Meeste weekenddiensten</TD>
                <TD>
                  {view.extremes.mostWeekends
                    ? `${view.extremes.mostWeekends.count} (regel ${view.extremes.mostWeekends.line})`
                    : "—"}
                </TD>
              </TR>
            </tbody>
          </Table>
        </WidgetCard>
      </div>

      {view.lines.length === 0 && <EmptyState>Dit rooster heeft nog geen regels.</EmptyState>}
    </RosterCommitteeShell>
  );
}
