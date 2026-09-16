import { formatCalendarDate } from "@/domain/time";
import { swapOversight } from "@/server/services/duty-assignment-service";
import { DutyAssignmentShell } from "@/components/layout/area-shell";
import { Alert, EmptyState, WidgetCard } from "@/components/ui/primitives";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";
import { SwapIcon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

/**
 * Ruilverzoeken, ter informatie.
 *
 * Bewust alleen lezen. Een ruil is een afspraak tussen twee medewerkers die de
 * rules engine twee keer heeft goedgekeurd — bij het versturen en opnieuw bij
 * het accepteren. Dienstindeling ziet hem zodat de dagplanning klopt, en hoeft
 * er niet tussen te komen. Een knop "goedkeuren" zou suggereren dat er nog een
 * menselijk oordeel bij hoort, en dat is er niet.
 */
export default async function Ruilverzoeken() {
  const swaps = await swapOversight(50);

  return (
    <DutyAssignmentShell
      activeHref="/dienstindeling/ruilverzoeken"
      header={{
        title: "Ruilverzoeken",
        subtitle: `${swaps.length} verzoeken in behandeling tussen medewerkers`,
        notificationCount: swaps.length,
      }}
    >
      <div className="mb-4">
        <Alert tone="info" title="Wat er al is gecontroleerd">
          Voordat een voorstel kon worden verstuurd, is de ruil voor beide medewerkers volledig
          doorgerekend: de dienst vóór en na de ruildag, de rust aan beide kanten, het
          roosterprofiel, de bevoegdheden en de reeksregels. Bij accepteren gebeurt dat opnieuw,
          want tussen versturen en accepteren kan er van alles zijn veranderd.
        </Alert>
      </div>

      <WidgetCard
        icon={<SwapIcon size={18} />}
        tone="neutral"
        title="Openstaande ruilverzoeken"
        subtitle="Alleen lezen — de medewerkers beslissen"
      >
        {swaps.length === 0 ? (
          <div className="py-3">
            <EmptyState>Er zijn geen openstaande ruilverzoeken.</EmptyState>
          </div>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Van</TH>
                <TH>Naar</TH>
                <TH>Dienst</TH>
                <TH>Datum</TH>
                <TH>Verstuurd</TH>
                <TH>Vervalt</TH>
              </TR>
            </THead>
            <tbody>
              {swaps.map((swap) => (
                <TR key={swap.id}>
                  <TD>
                    <span className="tabular font-semibold">{swap.fromEmployeeNumber}</span>
                  </TD>
                  <TD>
                    <span className="tabular font-semibold">{swap.toEmployeeNumber}</span>
                  </TD>
                  <TD mono>{swap.dutyCode}</TD>
                  <TD>{formatCalendarDate(swap.date)}</TD>
                  <TD>
                    <span className="tabular text-[11.5px] text-ink-muted">
                      {swap.createdAt.toLocaleString("nl-NL")}
                    </span>
                  </TD>
                  <TD>
                    <span className="tabular text-[11.5px] text-ink-muted">
                      {swap.expiresAt.toLocaleString("nl-NL")}
                    </span>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </WidgetCard>
    </DutyAssignmentShell>
  );
}
