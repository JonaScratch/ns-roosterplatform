import { waitlistOptions } from "@/server/services/waitlist-service";
import { EmployeeShell } from "@/components/layout/area-shell";
import { ActionForm } from "@/components/ui/action-form";
import { Alert, Badge, EmptyState, WidgetCard } from "@/components/ui/primitives";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";
import { wachtlijstAction } from "../acties";

export const dynamic = "force-dynamic";

export default async function Wachtlijsten() {
  const options = await waitlistOptions();

  return (
    <EmployeeShell
      activeHref="/medewerker/wachtlijsten"
      header={{ title: "Wachtlijsten", subtitle: "Schrijf u in voor een ander basisrooster. Uw plaats volgt uitsluitend uit de datum van inschrijving." }}
    >

      <Alert tone="info" title="Hoe uw positie tot stand komt">
        Er is één ordening: wie zich eerder inschreef, staat hoger. Er zijn geen andere
        criteria en er is geen voorrang. Schrijft u zich uit en later opnieuw in, dan telt de
        nieuwe inschrijfdatum.
      </Alert>

      <div className="mt-4">
        <WidgetCard title="Basisroosters op uw standplaats">
          {options.length === 0 ? (
            <EmptyState>Er zijn op dit moment geen actieve basisroosters.</EmptyState>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Rooster</TH>
                  <TH>Profiel</TH>
                  <TH numeric>Wachtenden</TH>
                  <TH numeric>Uw positie</TH>
                  <TH>Actie</TH>
                </TR>
              </THead>
              <tbody>
                {options.map((option) => (
                  <TR key={option.baseRosterId}>
                    <TD>
                      <span className="font-semibold">{option.code}</span>
                      <span className="block text-[11px] text-ink-muted">{option.name}</span>
                    </TD>
                    <TD>
                      <Badge tone="info">{option.profileLabel}</Badge>
                    </TD>
                    <TD numeric>{option.totalWaiting}</TD>
                    <TD numeric>
                      {option.position === null ? (
                        <span className="text-ink-muted">—</span>
                      ) : (
                        <span className="font-semibold">{option.position}</span>
                      )}
                    </TD>
                    <TD>
                      {option.enrolled ? (
                        <ActionForm
                          action={wachtlijstAction}
                          submitLabel="Uitschrijven"
                          variant="secondary"
                          compact
                        >
                          <input type="hidden" name="baseRosterId" value={option.baseRosterId} />
                          <input type="hidden" name="handeling" value="uitschrijven" />
                        </ActionForm>
                      ) : (
                        <ActionForm action={wachtlijstAction} submitLabel="Inschrijven" compact>
                          <input type="hidden" name="baseRosterId" value={option.baseRosterId} />
                          <input type="hidden" name="handeling" value="inschrijven" />
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
    </EmployeeShell>
  );
}
