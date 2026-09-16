import { caoDayQueue } from "@/server/services/cao-day-service";
import { DutyAssignmentShell } from "@/components/layout/area-shell";
import { ActionForm } from "@/components/ui/action-form";
import { Alert, Badge, EmptyState, WidgetCard } from "@/components/ui/primitives";
import { TD, TH, THead, Table } from "@/components/ui/table";
import { CalendarCheckIcon } from "@/components/ui/icons";
import { caoDagVerwerktAction } from "../acties";

export const dynamic = "force-dynamic";

/**
 * CAO-dagaanvragen voor de dienstindeling.
 *
 * ## Waarom hier niet wordt goedgekeurd
 *
 * Een aanvraag die door de controles heen is gekomen — op tijd, op een dag
 * waarop de medewerker rijdt, binnen het tegoed — is een recht en geen verzoek.
 * Wat hier gebeurt, is het overnemen ervan in het NS-verlofboek. De knop zegt
 * daarom wat er is gebeurd ("verwerkt in verlofboek") en niet wat er is
 * besloten.
 *
 * Er staat bewust geen afwijsknop. Zou een aanvraag toch niet kunnen, dan is
 * dat een gesprek met de medewerker en geen klik in dit scherm — en dan trekt
 * de medewerker hem zelf in.
 *
 * ## Waarom de dienst erbij staat
 *
 * De aanvraag draagt de roostergegevens van het moment van aanvragen met zich
 * mee. Wie de dag in het verlofboek zet, ziet dus welke dienst er dan vrijvalt,
 * ook als het rooster inmiddels is veranderd.
 */
export default async function CaoDagen() {
  const aanvragen = await caoDayQueue();
  const open = aanvragen.filter((aanvraag) => aanvraag.status === "REQUESTED");
  const rest = aanvragen.filter((aanvraag) => aanvraag.status !== "REQUESTED");

  return (
    <DutyAssignmentShell
      activeHref="/dienstindeling/cao-dagen"
      header={{
        title: "CAO-dagen",
        subtitle:
          open.length === 0
            ? "Geen aanvragen die nog in het verlofboek moeten"
            : `${open.length} ${open.length === 1 ? "aanvraag" : "aanvragen"} nog te verwerken`,
      }}
    >
      <div className="space-y-4">
        <Alert tone="info" title="Wat u hier doet">
          Zet de aangevraagde dag in het NS-verlofboek en markeer hem daarna hier als verwerkt. De
          medewerker krijgt dan bericht. De aanvraag is al getoetst op de termijn van zes weken, op
          het tegoed en op de vraag of de medewerker die dag werkelijk werkt.
        </Alert>

        <WidgetCard
          icon={<CalendarCheckIcon size={18} />}
          tone="did"
          title="Nog te verwerken"
          subtitle="Op datum van de aangevraagde dag"
          bodyClassName="border-t border-line"
        >
          {open.length === 0 ? (
            <div className="p-4">
              <EmptyState>Er staat geen CAO-dagaanvraag open.</EmptyState>
            </div>
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Medewerker</TH>
                  <TH>Aangevraagde dag</TH>
                  <TH>Wat vervalt</TH>
                  <TH>Aangevraagd op</TH>
                  <TH> </TH>
                </tr>
              </THead>
              <tbody>
                {open.map((aanvraag) => (
                  <tr key={aanvraag.id}>
                    <TD>
                      <span className="font-semibold text-ink">{aanvraag.employeeNumber}</span>
                    </TD>
                    <TD>{aanvraag.dateLabel}</TD>
                    <TD>
                      {aanvraag.snapshot.dutyCode ? (
                        <>
                          <span className="font-semibold text-ink">
                            dienst {aanvraag.snapshot.dutyCode}
                          </span>
                          {aanvraag.snapshot.timeRange && (
                            <span className="block text-[11px] text-ink-muted">
                              {aanvraag.snapshot.timeRange}
                            </span>
                          )}
                        </>
                      ) : aanvraag.snapshot.positionType === "RES" ? (
                        "reservedienst"
                      ) : (
                        "—"
                      )}
                      {aanvraag.snapshot.rosterCode && (
                        <span className="block text-[11px] text-ink-muted">
                          {aanvraag.snapshot.rosterCode}
                          {aanvraag.snapshot.lineNumber !== null
                            ? ` · regel ${aanvraag.snapshot.lineNumber}`
                            : ""}
                        </span>
                      )}
                    </TD>
                    <TD>
                      {aanvraag.requestedAt.toLocaleDateString("nl-NL", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        timeZone: "Europe/Amsterdam",
                      })}
                    </TD>
                    <TD>
                      <ActionForm
                        action={caoDagVerwerktAction}
                        submitLabel="Verwerkt in verlofboek"
                        variant="outline-did"
                        compact
                      >
                        <input type="hidden" name="id" value={aanvraag.id} />
                        <input type="hidden" name="versie" value={aanvraag.version} />
                      </ActionForm>
                    </TD>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </WidgetCard>

        {rest.length > 0 && (
          <WidgetCard
            icon={<CalendarCheckIcon size={18} />}
            tone="neutral"
            title="Afgehandeld"
            subtitle="Verwerkt of door de medewerker ingetrokken"
            bodyClassName="border-t border-line"
          >
            <Table>
              <THead>
                <tr>
                  <TH>Medewerker</TH>
                  <TH>Dag</TH>
                  <TH>Status</TH>
                </tr>
              </THead>
              <tbody>
                {rest.map((aanvraag) => (
                  <tr key={aanvraag.id}>
                    <TD>{aanvraag.employeeNumber}</TD>
                    <TD>{aanvraag.dateLabel}</TD>
                    <TD>
                      <Badge
                        tone={aanvraag.status === "REGISTERED_IN_LEAVE_BOOK" ? "ok" : "neutral"}
                      >
                        {aanvraag.statusLabel}
                      </Badge>
                    </TD>
                  </tr>
                ))}
              </tbody>
            </Table>
          </WidgetCard>
        )}
      </div>
    </DutyAssignmentShell>
  );
}
