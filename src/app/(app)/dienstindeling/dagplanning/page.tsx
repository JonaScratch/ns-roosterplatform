import { formatCalendarDate, formatMinuteOfDay, toCalendarDate } from "@/domain/time";
import { assignmentOverview, dayPlan } from "@/server/services/duty-assignment-service";
import { DutyAssignmentShell } from "@/components/layout/area-shell";
import { Badge, EmptyState, StatCard, WidgetCard } from "@/components/ui/primitives";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";
import { CalendarIcon, CheckCircleIcon, ClipboardListIcon, UsersIcon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

const POSITION_LABELS: Record<string, string> = {
  DUTY: "Dienst",
  RES: "RES-positie",
  WR: "WR",
  CO: "CO",
  RUST: "Vrije dag",
  VERLOF: "Verlof",
  OPLEIDING: "Opleiding",
};

const POSITION_TONES: Record<string, "rc" | "info" | "ok" | "warn" | "neutral"> = {
  DUTY: "rc",
  RES: "info",
  WR: "neutral",
  CO: "neutral",
  RUST: "ok",
  VERLOF: "ok",
  OPLEIDING: "warn",
};

/**
 * De dagplanning: wie doet vandaag wat.
 *
 * Toont personeelsnummers, geen namen. Voor het beoordelen van de bezetting is
 * een naam niet nodig; wie er wél een nodig heeft, vraagt die apart op en die
 * inzage wordt gelogd.
 */
export default async function Dagplanning({
  searchParams,
}: PageProps<"/dienstindeling/dagplanning">) {
  const params = await searchParams;
  const date = typeof params.datum === "string" ? params.datum : toCalendarDate(new Date());

  const [plan, overview] = await Promise.all([dayPlan(date), assignmentOverview(date)]);
  const duties = plan.filter((row) => row.positionType === "DUTY");
  const reserves = plan.filter((row) => row.positionType === "RES");
  const absent = plan.filter((row) => row.positionType === "VERLOF" || row.positionType === "OPLEIDING");

  return (
    <DutyAssignmentShell
      activeHref="/dienstindeling/dagplanning"
      header={{
        title: "Dagplanning",
        subtitle: formatCalendarDate(date),
        context: (
          <form className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5">
            <CalendarIcon size={15} />
            <input
              type="date"
              name="datum"
              defaultValue={date}
              className="bg-transparent text-[12.5px] font-medium text-ink outline-none"
            />
            <button type="submit" className="text-[12px] font-semibold text-accent-did">
              Tonen
            </button>
          </form>
        ),
      }}
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<CheckCircleIcon size={20} />}
          tone={overview.occupancyRate >= overview.occupancyTarget ? "ok" : "warn"}
          label="Bezettingsgraad"
          value={`${Math.round(overview.occupancyRate * 100)}%`}
          hint={`Doel ${Math.round(overview.occupancyTarget * 100)}%`}
        />
        <StatCard
          icon={<ClipboardListIcon size={20} />}
          tone="rc"
          label="Toegewezen diensten"
          value={duties.length}
          hint="op deze dag"
        />
        <StatCard
          icon={<UsersIcon size={20} />}
          tone="did"
          label="Reserve"
          value={reserves.length}
          hint="RES-posities"
        />
        <StatCard
          icon={<CalendarIcon size={20} />}
          tone="neutral"
          label="Afwezig"
          value={absent.length}
          hint="verlof of opleiding"
        />
      </div>

      <div className="mt-4">
        <WidgetCard
          icon={<ClipboardListIcon size={18} />}
          tone="did"
          title="Alle roosterposities"
          subtitle={`${plan.length} medewerkers, personeelsnummers zonder namen`}
        >
          {plan.length === 0 ? (
            <div className="py-3">
              <EmptyState>Voor deze dag is geen rooster uitgeschreven.</EmptyState>
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Personeelsnr.</TH>
                  <TH>Roosterprofiel</TH>
                  <TH>Positie</TH>
                  <TH>Dienst</TH>
                  <TH>Tijden</TH>
                  <TH>Herkomst</TH>
                </TR>
              </THead>
              <tbody>
                {plan.map((row) => (
                  <TR key={row.employeeNumber}>
                    <TD>
                      <span className="tabular font-semibold">{row.employeeNumber}</span>
                    </TD>
                    <TD>{row.rosterProfile}</TD>
                    <TD>
                      <Badge tone={POSITION_TONES[row.positionType] ?? "neutral"}>
                        {POSITION_LABELS[row.positionType] ?? row.positionType}
                      </Badge>
                    </TD>
                    <TD mono>{row.dutyCode ?? "—"}</TD>
                    <TD>
                      {row.startMinute !== null && row.endMinute !== null ? (
                        <span className="tabular whitespace-nowrap">
                          {formatMinuteOfDay(row.startMinute)} – {formatMinuteOfDay(row.endMinute)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TD>
                    <TD>
                      <span className="text-[11.5px] text-ink-muted">{row.source}</span>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </WidgetCard>
      </div>
    </DutyAssignmentShell>
  );
}
