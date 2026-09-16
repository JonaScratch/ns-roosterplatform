import { DEFAULT_PRODUCT_PARAMETERS } from "@/server/rules-engine";
import {
  availableDutiesForActor,
  rotationStandingForActor,
} from "@/server/services/available-duty-service";
import { EmployeeShell } from "@/components/layout/area-shell";
import { ActionForm } from "@/components/ui/action-form";
import { Alert, Badge, EmptyState, WidgetCard } from "@/components/ui/primitives";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";
import { CalendarCheckIcon, ListIcon } from "@/components/ui/icons";
import { DateLabel, DutyKinds, DutyTimes } from "@/components/schedule/duty-label";
import { weekdayLabel } from "@/domain/time";
import { toonBelangstellingAction, trekBelangstellingInAction } from "../acties";

export const dynamic = "force-dynamic";

/**
 * Beschikbare diensten.
 *
 * Wat hier staat, is wat de server na volledige toetsing heeft overgehouden. Er
 * wordt in deze pagina niets gefilterd: een dienst die een medewerker niet mag
 * rijden, komt niet in het antwoord voor en is dus ook niet via de
 * netwerkinspectie of een aangepast verzoek te zien.
 */
export default async function BeschikbareDiensten() {
  const [listing, rotation] = await Promise.all([
    availableDutiesForActor(),
    rotationStandingForActor(),
  ]);
  const duties = listing.duties;

  return (
    <EmployeeShell
      activeHref="/medewerker/diensten"
      header={{
        title: "Beschikbare diensten",
        subtitle: `Diensten waarvoor u roostertechnisch geschikt bent — kiezen kan tot ${DEFAULT_PRODUCT_PARAMETERS.availableDutyHorizonDays} dagen vooruit`,
      }}
    >
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <WidgetCard
            icon={<CalendarCheckIcon size={18} />}
            tone="ok"
            title="Open diensten"
            subtitle="Alleen wat u ook echt mag rijden"
          >
            {duties.length === 0 ? (
              <div className="py-3">
                <EmptyState>
                  Er zijn op dit moment geen diensten beschikbaar waarvoor u in aanmerking komt.
                  Diensten worden eerst via het reserve-rooster aangeboden en verschijnen hier pas
                  wanneer daar geen invulling mogelijk was.
                </EmptyState>
              </div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Datum</TH>
                    <TH>Dienst</TH>
                    <TH>Tijden</TH>
                    <TH>Soort</TH>
                    <TH>Aansluiting</TH>
                    <TH>Sluit</TH>
                    <TH>Actie</TH>
                  </TR>
                </THead>
                <tbody>
                  {duties.map((duty) => (
                    <TR key={duty.id}>
                      <TD>
                        <DateLabel date={duty.date} />
                      </TD>
                      <TD mono>
                        {duty.dutyCode}
                        {duty.description && (
                          <span className="block font-sans text-[11px] text-ink-muted">
                            {duty.description}
                          </span>
                        )}
                      </TD>
                      <TD>
                        <DutyTimes start={duty.startMinute} end={duty.endMinute} />
                      </TD>
                      <TD>
                        <DutyKinds kinds={duty.kinds} />
                      </TD>
                      <TD>
                        {duty.concerns.length === 0 ? (
                          <span className="text-[11.5px] text-ink-muted">Sluit aan</span>
                        ) : (
                          <ul className="space-y-0.5 text-[11.5px] text-state-warn">
                            {duty.concerns.map((concern) => (
                              <li key={concern}>{concern}</li>
                            ))}
                          </ul>
                        )}
                      </TD>
                      <TD>
                        <span className="tabular text-[11.5px] text-ink-muted">
                          {duty.closesAt.toLocaleDateString("nl-NL")}
                        </span>
                      </TD>
                      <TD>
                        {duty.alreadyInterested ? (
                          <ActionForm
                            action={trekBelangstellingInAction}
                            submitLabel="Intrekken"
                            variant="secondary"
                            compact
                          >
                            <input type="hidden" name="availableDutyId" value={duty.id} />
                          </ActionForm>
                        ) : (
                          <ActionForm
                            action={toonBelangstellingAction}
                            submitLabel="Belangstelling"
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
            {(listing.hiddenUnsuitable > 0 || listing.hiddenIneligible > 0) && (
              <p className="mt-2 text-[11px] text-ink-muted">
                {listing.duties.length} passende{" "}
                {listing.duties.length === 1 ? "dienst" : "diensten"} getoond.{" "}
                {listing.hiddenIneligible > 0 && (
                  <>
                    {listing.hiddenIneligible}{" "}
                    {listing.hiddenIneligible === 1 ? "dienst valt" : "diensten vallen"} af op de
                    roosterregels.{" "}
                  </>
                )}
                {listing.hiddenUnsuitable > 0 && (
                  <>
                    {listing.hiddenUnsuitable}{" "}
                    {listing.hiddenUnsuitable === 1 ? "dienst sluit" : "diensten sluiten"} niet
                    goed aan op uw eigen rooster en {listing.hiddenUnsuitable === 1 ? "wordt" : "worden"}{" "}
                    daarom niet voorgesteld.
                  </>
                )}
              </p>
            )}
          </WidgetCard>
        </div>

        <div className="space-y-4">
          <WidgetCard
            icon={<ListIcon size={18} />}
            tone="info"
            title="Uw roulatiepositie"
            subtitle="Per weekdag een eigen lijst"
          >
            {rotation.length === 0 ? (
              <div className="py-3">
                <EmptyState>U staat nog niet op een roulatielijst.</EmptyState>
              </div>
            ) : (
              rotation.map((entry) => (
                <div
                  key={entry.weekday}
                  className="flex items-center justify-between gap-3 border-b border-line/70 py-2.5 last:border-0"
                >
                  <span className="text-[12.5px] capitalize text-ink">
                    {weekdayLabel(entry.weekday)}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tabular text-[13px] font-semibold text-ink-strong">
                      {entry.position}
                    </span>
                    <span className="text-[11.5px] text-ink-muted">van {entry.participants}</span>
                  </span>
                </div>
              ))
            )}
          </WidgetCard>

          <Alert tone="info" title="Hoe de toewijzing werkt">
            Per weekdag bestaat een aparte roulatielijst die elke week een plaats opschuift. Van de
            medewerkers die belangstelling tonen én roostertechnisch geldig zijn, krijgt de hoogst
            geplaatste de dienst. Wie geen belangstelling toont, heeft geen invloed op de uitkomst.
            De volgorde op het moment van toewijzen wordt vastgelegd en is opvraagbaar.
          </Alert>

          <Alert tone="neutral" title="Na twee weken">
            Binnen{" "}
            <Badge tone="neutral">{DEFAULT_PRODUCT_PARAMETERS.availableDutyHorizonDays} dagen</Badge>{" "}
            vóór de dienst loopt dit niet meer via het platform; dan wordt operationeel en
            onderling geregeld.
          </Alert>
        </div>
      </div>
    </EmployeeShell>
  );
}
