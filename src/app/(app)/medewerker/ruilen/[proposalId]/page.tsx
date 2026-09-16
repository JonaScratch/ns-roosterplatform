import Link from "next/link";
import { notFound } from "next/navigation";
import { formatCalendarDate } from "@/domain/time";
import {
  SWAP_STATUS_LABELS,
  proposalDetail,
} from "@/server/services/swap-workspace-service";
import { EmployeeShell } from "@/components/layout/area-shell";
import { ActionForm } from "@/components/ui/action-form";
import { Alert, Badge, WidgetCard } from "@/components/ui/primitives";
import { TD, TR, Table } from "@/components/ui/table";
import { beantwoordRuilAction, trekRuilInAction } from "../../acties";

export const dynamic = "force-dynamic";

/**
 * Eén ruilverzoek.
 *
 * ## Waarom een melding hierheen wijst en niet naar een overzicht
 *
 * Een melding die op "Ruilen" uitkomt, laat de lezer zoeken welk verzoek werd
 * bedoeld — en bij drie openstaande verzoeken is dat gokken. Deze pagina gaat
 * over precies dat ene verzoek, met de knoppen die erbij horen.
 *
 * ## Waarom accepteren hier niets verandert
 *
 * De knop stuurt een opdracht naar de server. Daar wordt het rooster van beide
 * medewerkers opnieuw ingelezen en volledig hertoetst; pas als dat slaagt,
 * wisselen de diensten. Wat u hieronder ziet is de stand van het moment waarop
 * de pagina werd geladen, en die kan inmiddels verlopen zijn.
 */
export default async function Ruilverzoek({
  params,
}: {
  params: Promise<{ proposalId: string }>;
}) {
  const { proposalId } = await params;
  const proposal = await proposalDetail(proposalId);
  if (!proposal) {
    notFound();
  }

  const openstaand = proposal.status === "PENDING";

  return (
    <EmployeeShell
      activeHref="/medewerker/ruilen"
      header={{
        title: "Ruilverzoek",
        subtitle:
          proposal.role === "ONTVANGER"
            ? `Van medewerker ${proposal.otherEmployeeNumber}`
            : `Aan medewerker ${proposal.otherEmployeeNumber}`,
      }}
    >
      <p className="mb-3 text-[11px]">
        <Link href="/medewerker/ruilen" className="text-ink-muted underline">
          ← Mijn ruilingen
        </Link>
      </p>

      <WidgetCard
        title={SWAP_STATUS_LABELS[proposal.status]}
        subtitle={`Aangevraagd op ${proposal.createdAt.toLocaleString("nl-NL")}`}
      >
        <Table>
          <tbody>
            <TR>
              <TD>Uw dienst</TD>
              <TD>
                <span className="font-mono">{proposal.ownDutyCode}</span> op{" "}
                {formatCalendarDate(proposal.ownDate)}
              </TD>
            </TR>
            <TR>
              <TD>
                {proposal.role === "ONTVANGER" ? "Dienst van de aanvrager" : "Dienst van uw collega"}
              </TD>
              <TD>
                <span className="font-mono">{proposal.theirDutyCode}</span> op{" "}
                {formatCalendarDate(proposal.theirDate)}
              </TD>
            </TR>
            <TR>
              <TD>Collega</TD>
              <TD mono>{proposal.otherEmployeeNumber}</TD>
            </TR>
            <TR>
              <TD>Status</TD>
              <TD>
                <Badge
                  tone={
                    proposal.status === "ACCEPTED"
                      ? "ok"
                      : proposal.status === "PENDING"
                        ? "info"
                        : "neutral"
                  }
                >
                  {SWAP_STATUS_LABELS[proposal.status]}
                </Badge>
              </TD>
            </TR>
            <TR>
              <TD>Geldig tot</TD>
              <TD>{proposal.expiresAt.toLocaleString("nl-NL")}</TD>
            </TR>
            {proposal.message && (
              <TR>
                <TD>Bericht</TD>
                <TD>{proposal.message}</TD>
              </TR>
            )}
            {proposal.respondedAt && (
              <TR>
                <TD>Afgehandeld op</TD>
                <TD>{proposal.respondedAt.toLocaleString("nl-NL")}</TD>
              </TR>
            )}
          </tbody>
        </Table>

        {openstaand && proposal.role === "ONTVANGER" && (
          <div className="mt-3 flex flex-wrap gap-2">
            <ActionForm action={beantwoordRuilAction} submitLabel="Accepteren">
              <input type="hidden" name="proposalId" value={proposal.id} />
              <input type="hidden" name="antwoord" value="accepteren" />
            </ActionForm>
            <ActionForm action={beantwoordRuilAction} submitLabel="Afwijzen" variant="secondary">
              <input type="hidden" name="proposalId" value={proposal.id} />
              <input type="hidden" name="antwoord" value="afwijzen" />
            </ActionForm>
          </div>
        )}

        {openstaand && proposal.role === "AANVRAGER" && (
          <div className="mt-3">
            <ActionForm action={trekRuilInAction} submitLabel="Verzoek intrekken" variant="secondary">
              <input type="hidden" name="proposalId" value={proposal.id} />
            </ActionForm>
          </div>
        )}

        {proposal.status === "INVALIDATED" && (
          <div className="mt-3">
            <Alert tone="warn" title="Deze ruil kon niet meer worden uitgevoerd">
              Een van beide roosters is sinds de aanvraag gewijzigd. Er is niets aan uw rooster
              veranderd.
            </Alert>
          </div>
        )}
      </WidgetCard>

      {openstaand && (
        <div className="mt-3">
          <Alert tone="neutral" title="Wat er gebeurt als u accepteert">
            De server leest beide roosters opnieuw in en toetst de ruil volledig — rust ervoor,
            rust erna, reeksen, profielen en bevoegdheden. Pas als dat slaagt, wisselen de
            diensten. Lukt het niet, dan verandert er niets en hoort u waarom.
          </Alert>
        </div>
      )}
    </EmployeeShell>
  );
}
