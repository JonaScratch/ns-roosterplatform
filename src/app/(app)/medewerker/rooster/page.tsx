import { addDays, isWeekend, toCalendarDate } from "@/domain/time";
import { defaultRange, ownSchedule } from "@/server/services/schedule-service";
import { EmployeeShell } from "@/components/layout/area-shell";
import { EmptyState, WidgetCard, inputClass } from "@/components/ui/primitives";
import { TD, TH, THead, Table } from "@/components/ui/table";
import { CalendarIcon } from "@/components/ui/icons";
import { DateLabel, DutyKinds, DutyTimes, PositionLabel } from "@/components/schedule/duty-label";

export const dynamic = "force-dynamic";

const SOURCE_LABELS: Record<string, string> = {
  BASE: "Basisrooster",
  RESERVE_FILL: "Reserve-invulling",
  AVAILABLE_DUTY: "Beschikbare dienst",
  SWAP: "Ruil",
  PLANNER_MANUAL: "Handmatig",
};

/**
 * Het eigen rooster.
 *
 * De periode komt uit de zoekparameters, maar de medewerker komt uit de sessie.
 * Er is geen parameter waarmee een ander rooster op te vragen is: `ownSchedule`
 * accepteert er geen.
 */
export default async function MijnRooster({ searchParams }: PageProps<"/medewerker/rooster">) {
  const params = await searchParams;
  const fallback = defaultRange();
  const from = typeof params.van === "string" ? params.van : fallback.from;
  const to = typeof params.tot === "string" ? params.tot : fallback.to;

  const schedule = await ownSchedule(from, to);
  const today = toCalendarDate(new Date());

  return (
    <EmployeeShell
      activeHref="/medewerker/rooster"
      header={{
        title: "Mijn rooster",
        subtitle: `${from} tot en met ${to} — weekenden zijn gemarkeerd`,
      }}
    >
      <WidgetCard
        icon={<CalendarIcon size={18} />}
        tone="rc"
        title="Roosterdagen"
        subtitle="Inclusief de herkomst van elke dag"
        actions={
          <form className="flex items-end gap-2">
            <label className="flex flex-col gap-0.5">
              <span className="text-[11px] text-ink-muted">Van</span>
              <input type="date" name="van" defaultValue={from} className={`${inputClass} w-36`} />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[11px] text-ink-muted">Tot en met</span>
              <input type="date" name="tot" defaultValue={to} className={`${inputClass} w-36`} />
            </label>
            <button
              type="submit"
              className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-[12.5px] font-semibold hover:bg-canvas"
            >
              Tonen
            </button>
          </form>
        }
      >
        {schedule.days.length === 0 ? (
          <div className="py-3">
            <EmptyState>
              In deze periode staan geen roosterdagen. Kies een andere periode of neem contact op
              met de roostermaker.
            </EmptyState>
          </div>
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Datum</TH>
                <TH>Positie</TH>
                <TH>Dienst</TH>
                <TH>Tijden</TH>
                <TH>Soort</TH>
                <TH>Herkomst</TH>
              </tr>
            </THead>
            <tbody>
              {schedule.days.map((day) => (
                <tr
                  key={day.id}
                  className={`border-b border-line/60 last:border-0 ${
                    isWeekend(day.date) ? "bg-canvas" : ""
                  } ${day.date === today ? "outline outline-1 -outline-offset-1 outline-accent-rc/40" : ""}`}
                >
                  <TD>
                    <DateLabel date={day.date} />
                  </TD>
                  <TD>
                    <PositionLabel positionType={day.positionType} />
                  </TD>
                  <TD mono>{day.duty?.code ?? "—"}</TD>
                  <TD>
                    {day.duty ? (
                      <DutyTimes start={day.duty.startMinute} end={day.duty.endMinute} />
                    ) : (
                      "—"
                    )}
                  </TD>
                  <TD>{day.duty ? <DutyKinds kinds={day.duty.kinds} /> : null}</TD>
                  <TD>
                    <span className="text-[11.5px] text-ink-muted">
                      {SOURCE_LABELS[day.source] ?? day.source}
                    </span>
                  </TD>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </WidgetCard>

      <p className="mt-3 text-[11.5px] text-ink-muted">
        Volgende periode:{" "}
        <a
          className="font-semibold text-accent-rc hover:underline"
          href={`/medewerker/rooster?van=${addDays(to, 1)}&tot=${addDays(to, 28)}`}
        >
          {addDays(to, 1)} en verder
        </a>
      </p>
    </EmployeeShell>
  );
}
