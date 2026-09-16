import { formatCalendarDate, formatMinuteOfDay } from "@/domain/time";
import { openDuties } from "@/server/services/duty-assignment-service";
import { rotationOverview } from "@/server/services/rotation-service";
import { DutyAssignmentShell } from "@/components/layout/area-shell";
import { ActionForm } from "@/components/ui/action-form";
import { Alert, Badge, EmptyState, WidgetCard } from "@/components/ui/primitives";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";
import { CalendarCheckIcon, ListIcon } from "@/components/ui/icons";
import { DutyKinds } from "@/components/schedule/duty-label";
import { weekdayLabel } from "@/domain/time";
import { dienstToewijzenAction } from "../acties";

export const dynamic = "force-dynamic";

/**
 * Beschikbare diensten, vanuit Dienstindeling gezien.
 *
 * Hier staat wat er opengesteld is en wie er belangstelling heeft. Toewijzen
 * doet de planner niet zelf: hij zet de procedure in gang en de roulatielijst
 * van die weekdag bepaalt de uitkomst. Daarom staat de lijst ernaast — wie de
 * uitkomst wil begrijpen, moet de volgorde kunnen zien.
 */
export default async function BeschikbaarOverzicht() {
  const [duties, rotation] = await Promise.all([openDuties({ limit: 50 }), rotationOverview()]);
  const open = duties.filter((duty) => duty.status === "OPEN");

  return (
    <DutyAssignmentShell
      activeHref="/dienstindeling/beschikbaar"
      header={{
        title: "Beschikbare diensten",
        subtitle: "Opengesteld voor medewerkers, toegewezen via de roulatielijst",
      }}
    >
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <WidgetCard
            icon={<CalendarCheckIcon size={18} />}
            tone="info"
            title="Opengestelde diensten"
            subtitle="Met het aantal belangstellenden"
          >
            {open.length === 0 ? (
              <div className="py-3">
                <EmptyState>
                  Er staan geen diensten open voor medewerkers. Diensten komen hier pas nadat het
                  reserve-rooster geen invulling bood.
                </EmptyState>
              </div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Dienst</TH>
                    <TH>Datum</TH>
                    <TH>Tijden</TH>
                    <TH>Soort</TH>
                    <TH numeric>Belangstelling</TH>
                    <TH>Actie</TH>
                  </TR>
                </THead>
                <tbody>
                  {open.map((duty) => (
                    <TR key={duty.id}>
                      <TD mono>{duty.dutyCode}</TD>
                      <TD>{formatCalendarDate(duty.date)}</TD>
                      <TD>
                        <span className="tabular whitespace-nowrap">
                          {formatMinuteOfDay(duty.startMinute)} –{" "}
                          {formatMinuteOfDay(duty.endMinute)}
                        </span>
                      </TD>
                      <TD>
                        <DutyKinds kinds={duty.kinds} />
                      </TD>
                      <TD numeric>
                        {duty.interestCount === 0 ? (
                          <Badge tone="warn">geen</Badge>
                        ) : (
                          duty.interestCount
                        )}
                      </TD>
                      <TD>
                        {duty.interestCount === 0 ? (
                          <span className="text-[11.5px] text-ink-muted">Wacht op reacties</span>
                        ) : (
                          <ActionForm
                            action={dienstToewijzenAction}
                            submitLabel="Toewijzen via roulatie"
                            compact
                          >
                            <input type="hidden" name="availableDutyId" value={duty.id} />
                          </ActionForm>
                        )}
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            )}
          </WidgetCard>
        </div>

        <div className="space-y-4">
          <WidgetCard
            icon={<ListIcon size={18} />}
            tone="neutral"
            title="Roulatielijsten"
            subtitle="Per weekdag een eigen volgorde"
          >
            {rotation.length === 0 ? (
              <div className="py-3">
                <EmptyState>Er zijn nog geen roulatielijsten ingericht.</EmptyState>
              </div>
            ) : (
              rotation.map((list) => (
                <div
                  key={`${list.weekday}-${list.depot}`}
                  className="flex items-center justify-between gap-3 border-b border-line/70 py-2.5 last:border-0"
                >
                  <span className="text-[12.5px] capitalize text-ink">
                    {weekdayLabel(list.weekday)}
                    <span className="ml-1.5 text-[11px] text-ink-muted">{list.depot}</span>
                  </span>
                  <span className="text-right">
                    <span className="tabular block text-[12.5px] font-semibold text-ink-strong">
                      {list.participants} deelnemers
                    </span>
                    <span className="tabular block text-[11px] text-ink-muted">
                      verschuiving {list.offset}
                    </span>
                  </span>
                </div>
              ))
            )}
          </WidgetCard>

          <Alert tone="info" title="Niet wie het snelste klikt">
            Van de medewerkers die belangstelling tonen én roostertechnisch geldig zijn, krijgt de
            hoogst geplaatste op de lijst van die weekdag de dienst. Wie geen belangstelling toont,
            heeft geen invloed op de uitkomst — staat hij op positie 1 en toont hij niets, dan gaat
            de dienst naar de eerstvolgende die dat wél deed.
          </Alert>

          <Alert tone="neutral" title="Vastgelegd bij het toewijzen">
            De volledige volgorde op dat moment wordt bewaard, inclusief wie belangstelling had en
            wie geldig was. Zonder die momentopname is de uitkomst achteraf niet na te rekenen.
          </Alert>
        </div>
      </div>
    </DutyAssignmentShell>
  );
}
