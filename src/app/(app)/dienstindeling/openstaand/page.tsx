import Link from "next/link";
import { formatCalendarDate, formatMinuteOfDay, isCalendarDate, isoWeekday, weekdayLabel } from "@/domain/time";
import { openDuties, reserveProposals } from "@/server/services/duty-assignment-service";
import { DutyAssignmentShell } from "@/components/layout/area-shell";
import { ActionForm } from "@/components/ui/action-form";
import { Alert, Badge, EmptyState, Meter, WidgetCard } from "@/components/ui/primitives";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";
import { ClipboardListIcon } from "@/components/ui/icons";
import { DutyKinds } from "@/components/schedule/duty-label";
import { dienstOpenstellenAction, reserveInvullenAction } from "../acties";

export const dynamic = "force-dynamic";

const PRIORITY_TONES = { KRITIEK: "error", HOOG: "warn", NORMAAL: "neutral" } as const;

/**
 * Alle openstaande diensten.
 *
 * De kolom "fase" is het hart van dit scherm: een dienst ligt eerst bij het
 * reserve-rooster en gaat pas daarna open. Wie die volgorde wil overslaan,
 * krijgt van de service te horen dat de reservepoging verplicht is — het is
 * geen aanbeveling maar een voorwaarde.
 *
 * Een `datum` in de zoekopdracht komt vanuit het bezettingsoverzicht op het
 * dashboard: een dag aanklikken toont precies de openstaande diensten van die
 * dag, met de reservekandidaten ernaast — niet omdat dit scherm dat zelf apart
 * onthoudt, maar omdat dezelfde functies die het dashboard al gebruikt hier
 * gewoon een datum meekrijgen.
 */
export default async function OpenstaandeDiensten({
  searchParams,
}: {
  searchParams: Promise<{ datum?: string }>;
}) {
  const { datum: datumRuw } = await searchParams;
  // Een ongeldige datum in de URL (verkeerd getypt, of iemand die met de hand
  // aan de query sleutelt) hoort geen technische foutpagina op te leveren —
  // het scherm valt terug op "alle dagen", zoals zonder parameter.
  const datum = datumRuw && isCalendarDate(datumRuw) ? datumRuw : undefined;
  const [duties, kandidaten] = await Promise.all([
    openDuties({ limit: 100, date: datum }),
    datum ? reserveProposals(25, datum) : Promise.resolve([]),
  ]);
  const bijReserve = duties.filter((duty) => duty.status === "RESERVE_PENDING");
  const open = duties.filter((duty) => duty.status === "OPEN");

  return (
    <DutyAssignmentShell
      activeHref="/dienstindeling/openstaand"
      header={{
        title: "Openstaande diensten",
        subtitle: datum
          ? `${weekdayLabel(isoWeekday(datum))} ${formatCalendarDate(datum)} — ${bijReserve.length} bij reserve, ${open.length} opengesteld`
          : `${bijReserve.length} bij reserve, ${open.length} opengesteld voor medewerkers`,
        notificationCount: duties.filter((duty) => duty.priority === "KRITIEK").length,
      }}
    >
      {datum && (
        <div className="mb-4">
          <Alert tone="info" title={`Alleen ${formatCalendarDate(datum)}`}>
            Deze lijst toont uitsluitend deze dag.{" "}
            <Link href="/dienstindeling/openstaand" className="font-semibold underline">
              Alle dagen tonen
            </Link>
            .
          </Alert>
        </div>
      )}

      <div className="mb-4">
        <Alert tone="info" title="De vaste volgorde">
          Fase 1: het reserve-rooster. Fase 2: openstellen voor medewerkers die er
          roostertechnisch geschikt voor zijn. Elke poging wordt vastgelegd, ook een mislukte.
        </Alert>
      </div>

      {datum && kandidaten.length > 0 && (
        <div className="mb-4">
          <WidgetCard
            title="Reservekandidaten voor deze dag"
            subtitle="Zelfde matching als het reserveoverzicht, hier per dag"
          >
            <div className="space-y-3">
              {kandidaten.map((voorstel) => (
                <div
                  key={voorstel.availableDutyId}
                  className="border-b border-line/70 pb-2.5 last:border-0"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="tabular text-[12.5px] font-semibold text-ink-strong">
                      {voorstel.dutyCode}
                    </span>
                  </div>
                  {voorstel.bestMatch ? (
                    <>
                      <p className="mt-1 text-[12px] text-ink">
                        Beste match:{" "}
                        <span className="tabular font-semibold">
                          {voorstel.bestMatch.employeeNumber}
                        </span>{" "}
                        <span className="text-ink-muted">
                          ({voorstel.bestMatch.preferenceLabel.toLowerCase()})
                        </span>
                      </p>
                      <div className="mt-1.5 flex items-center gap-2">
                        <Meter value={voorstel.bestMatch.score} tone="did" />
                        <span className="tabular w-9 text-right text-[11px] text-ink-muted">
                          {Math.round(voorstel.bestMatch.score * 100)}%
                        </span>
                      </div>
                    </>
                  ) : (
                    <p className="mt-1 text-[12px] text-state-warn">
                      Geen geldige reservekandidaat.
                    </p>
                  )}
                </div>
              ))}
            </div>
          </WidgetCard>
        </div>
      )}

      <WidgetCard
        icon={<ClipboardListIcon size={18} />}
        tone="did"
        title="Alle openstaande diensten"
        subtitle="Urgentste eerst"
      >
        {duties.length === 0 ? (
          <div className="py-3">
            <EmptyState>Er staan geen diensten open.</EmptyState>
          </div>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Dienst</TH>
                <TH>Datum</TH>
                <TH>Tijden</TH>
                <TH>Soort</TH>
                <TH>Standplaats</TH>
                <TH>Prioriteit</TH>
                <TH>Fase</TH>
                <TH numeric>Belangstelling</TH>
                <TH>Actie</TH>
              </TR>
            </THead>
            <tbody>
              {duties.map((duty) => (
                <TR key={duty.id}>
                  <TD mono>{duty.dutyCode}</TD>
                  <TD>{formatCalendarDate(duty.date)}</TD>
                  <TD>
                    <span className="tabular whitespace-nowrap">
                      {formatMinuteOfDay(duty.startMinute)} – {formatMinuteOfDay(duty.endMinute)}
                    </span>
                  </TD>
                  <TD>
                    <DutyKinds kinds={duty.kinds} />
                  </TD>
                  <TD>{duty.depot}</TD>
                  <TD>
                    <Badge tone={PRIORITY_TONES[duty.priority]}>
                      {duty.priority.toLowerCase()}
                    </Badge>
                  </TD>
                  <TD>
                    {duty.status === "RESERVE_PENDING" ? (
                      <Badge tone="warn">
                        {duty.reserveAttempted ? "Reserve geprobeerd" : "Bij reserve"}
                      </Badge>
                    ) : (
                      <Badge tone="info">Opengesteld</Badge>
                    )}
                  </TD>
                  <TD numeric>{duty.status === "OPEN" ? duty.interestCount : "—"}</TD>
                  <TD>
                    {duty.status === "RESERVE_PENDING" ? (
                      duty.reserveAttempted ? (
                        <ActionForm
                          action={dienstOpenstellenAction}
                          submitLabel="Openstellen"
                          variant="outline-did"
                          compact
                        >
                          <input type="hidden" name="availableDutyId" value={duty.id} />
                        </ActionForm>
                      ) : (
                        <ActionForm
                          action={reserveInvullenAction}
                          submitLabel="Reserve proberen"
                          compact
                        >
                          <input type="hidden" name="availableDutyId" value={duty.id} />
                        </ActionForm>
                      )
                    ) : (
                      <span className="text-[11.5px] text-ink-muted">Loopt</span>
                    )}
                    <a
                      href={`/dienstindeling/koppelen/${duty.id}`}
                      className="ml-2 text-[11px] underline"
                    >
                      Kandidaten
                    </a>
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
