import Link from "next/link";
import { notFound } from "next/navigation";
import { formatCalendarDate, formatMinuteOfDay, toCalendarDate } from "@/domain/time";
import { prisma } from "@/server/data/prisma";
import { reserveMatching } from "@/server/services/reserve-matching-service";
import { requirePermission } from "@/server/security/authorize";
import { PERMISSIONS } from "@/server/security/permissions";
import { DutyAssignmentShell } from "@/components/layout/area-shell";
import { ActionForm } from "@/components/ui/action-form";
import { Alert, Badge, EmptyState, WidgetCard, inputClass } from "@/components/ui/primitives";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";
import { toewijzenAanReserveAction } from "../../acties";

export const dynamic = "force-dynamic";

/**
 * Eén openstaande dienst, en wie hem kan rijden.
 *
 * ## Waarom hier meer staat dan een lijstje namen
 *
 * De dienstindeling neemt de beslissing, niet het systeem. Dan moet zichtbaar
 * zijn waaróp een kandidaat bovenaan staat: de rust ervoor, de rust erna, het
 * ritme, de voorkeur. Een score zonder onderbouwing wordt óf blind gevolgd óf
 * genegeerd, en beide zijn slecht.
 *
 * ## Twee lijsten, en het verschil is hard
 *
 * Boven staan de kandidaten die mogen. Onder staan de kandidaten die de regels
 * uitsluiten, mét reden — zichtbaar, maar zonder knop. Er is geen route, ook
 * niet voor een beheerder, om iemand uit de onderste lijst in te delen.
 *
 * Kandidaten die wél mogen maar slecht aansluiten, staan gewoon in de bovenste
 * lijst met hun bezwaren erbij. Dat is het verschil tussen "mag niet" en "is
 * geen goed idee", en dat onderscheid hoort bij de planner te liggen.
 */
export default async function Koppelen({
  params,
}: {
  params: Promise<{ availableDutyId: string }>;
}) {
  await requirePermission(PERMISSIONS.ASSIGNMENT_READ);
  const { availableDutyId } = await params;

  const available = await prisma.availableDuty.findUnique({
    where: { id: availableDutyId },
    select: {
      id: true,
      date: true,
      status: true,
      openReason: true,
      duty: {
        select: { id: true, code: true, startMinute: true, endMinute: true, description: true },
      },
    },
  });
  if (!available) {
    notFound();
  }

  const date = toCalendarDate(available.date);
  const matching = await reserveMatching(available.duty.id, date);

  return (
    <DutyAssignmentShell
      activeHref="/dienstindeling/openstaand"
      header={{
        title: `Dienst ${available.duty.code} koppelen`,
        subtitle: `${formatCalendarDate(date)} · ${formatMinuteOfDay(
          available.duty.startMinute,
        )}–${formatMinuteOfDay(available.duty.endMinute)}`,
      }}
    >
      <p className="mb-3 text-[11px]">
        <Link href="/dienstindeling/openstaand" className="text-ink-muted underline">
          ← Openstaande diensten
        </Link>
      </p>

      <div className="mb-4">
        <Alert tone="info" title="Waarom deze dienst openstaat">
          {available.openReason ?? "Geen reden vastgelegd."} Er staan {matching.consideredReserves}{" "}
          medewerkers die dag op een reservepositie.
        </Alert>
      </div>

      <WidgetCard
        title="Kandidaten"
        subtitle="Gerangschikt op aansluiting; de voorkeur weegt pas daarna mee."
      >
        {matching.matches.length === 0 ? (
          <EmptyState>
            Geen enkele reservemedewerker kan deze dienst rijden. De reden staat per medewerker
            in de lijst hieronder.
          </EmptyState>
        ) : (
          <div className="space-y-3">
            {matching.matches.map((match, index) => (
              <div key={match.employeeId} className="rounded border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className="tabular text-[13px] font-semibold text-ink-strong">
                      {index + 1}.
                    </span>
                    <span className="font-mono text-[13px]">{match.employeeNumber}</span>
                    <Badge tone={match.selfServiceSuitable ? "ok" : "warn"}>
                      {match.selfServiceSuitable ? "Sluit aan" : "Aandachtspunten"}
                    </Badge>
                    <span className="text-[11px] text-ink-muted">{match.preferenceLabel}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="tabular text-[12px] text-ink-muted">
                      score {(match.score * 100).toFixed(0)}
                    </span>
                    <ActionForm
                      action={toewijzenAanReserveAction}
                      submitLabel="Toewijzen"
                      variant={match.selfServiceSuitable ? "primary" : "secondary"}
                      compact
                    >
                      <input type="hidden" name="availableDutyId" value={available.id} />
                      <input type="hidden" name="employeeId" value={match.employeeId} />
                      <input
                        name="reden"
                        placeholder="Reden van deze keuze"
                        className={`${inputClass} w-52`}
                        required
                      />
                    </ActionForm>
                  </span>
                </div>

                <Table>
                  <THead>
                    <TR>
                      <TH>Onderdeel</TH>
                      <TH>Oordeel</TH>
                      <TH>Toelichting</TH>
                    </TR>
                  </THead>
                  <tbody>
                    {match.factors.map((factor) => (
                      <TR key={factor.key}>
                        <TD>{factor.label}</TD>
                        <TD>
                          <Badge
                            tone={
                              factor.verdict === "GOOD"
                                ? "ok"
                                : factor.verdict === "POOR"
                                  ? "warn"
                                  : "neutral"
                            }
                          >
                            {factor.verdict === "GOOD"
                              ? "goed"
                              : factor.verdict === "ACCEPTABLE"
                                ? "voldoende"
                                : factor.verdict === "POOR"
                                  ? "aandacht"
                                  : "onbekend"}
                          </Badge>
                        </TD>
                        <TD>
                          <span className="text-[11px]">{factor.detail}</span>
                        </TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              </div>
            ))}
          </div>
        )}
      </WidgetCard>

      {matching.blocked.length > 0 && (
        <div className="mt-4">
          <WidgetCard
            title="Niet inzetbaar"
            subtitle="De regels laten deze invulling niet toe. Er is geen knop om dat te omzeilen."
          >
            <Table>
              <THead>
                <TR>
                  <TH>Medewerker</TH>
                  <TH>Reden</TH>
                </TR>
              </THead>
              <tbody>
                {matching.blocked.map((match) => (
                  <TR key={match.employeeId}>
                    <TD mono>{match.employeeNumber}</TD>
                    <TD>
                      <span className="text-[11px]">
                        {match.blockingReasons[0] ?? "Regels laten deze plaatsing niet toe."}
                      </span>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </WidgetCard>
        </div>
      )}
    </DutyAssignmentShell>
  );
}
