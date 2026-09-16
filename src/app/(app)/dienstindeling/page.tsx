import Link from "next/link";
import { toCalendarDate, formatCalendarDate, formatMinuteOfDay, isoWeekday, weekdayLabel } from "@/domain/time";
import {
  assignmentOverview,
  occupancyTrend,
  openDuties,
  reserveProposals,
  swapOversight,
} from "@/server/services/duty-assignment-service";
import { DutyAssignmentShell } from "@/components/layout/area-shell";
import { ActionForm } from "@/components/ui/action-form";
import {
  Alert,
  Badge,
  EmptyState,
  LinkButton,
  Meter,
  StatCard,
  WidgetCard,
} from "@/components/ui/primitives";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";
import {
  CalendarCheckIcon,
  CalendarIcon,
  CheckCircleIcon,
  ClipboardListIcon,
  ClockIcon,
  MegaphoneIcon,
  ShieldCheckIcon,
  SwapIcon,
  UsersIcon,
} from "@/components/ui/icons";
import { DutyKinds } from "@/components/schedule/duty-label";
import { reserveInvullenAction, dienstOpenstellenAction } from "./acties";

export const dynamic = "force-dynamic";

const PRIORITY_TONES = { KRITIEK: "error", HOOG: "warn", NORMAAL: "neutral" } as const;

/**
 * Het dashboard van Dienstindeling.
 *
 * Dit gaat over vandaag en de komende dagen: wie rijdt wat, wat staat er open,
 * en wie kan het opvangen. De structuur van het basisrooster staat hier niet ter
 * discussie — Dienstindeling heeft daar geen enkel recht op, en dat is precies
 * de scheiding met de Rooster Commissie.
 */
export default async function DienstindelingDashboard({
  searchParams,
}: PageProps<"/dienstindeling">) {
  const params = await searchParams;
  const today = toCalendarDate(new Date());
  const date = typeof params.datum === "string" ? params.datum : today;

  const [overview, open, proposals, trend, swaps] = await Promise.all([
    assignmentOverview(date),
    openDuties({ limit: 8 }),
    reserveProposals(4),
    occupancyTrend(today, 7),
    swapOversight(5),
  ]);

  return (
    <DutyAssignmentShell
      activeHref="/dienstindeling"
      header={{
        title: "Dienstindeling",
        subtitle: "Dagelijkse bezetting, open diensten en operationele sturing",
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
        notificationCount: overview.criticalOpenDuties,
      }}
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <StatCard
          icon={<CheckCircleIcon size={20} />}
          tone={overview.occupancyRate >= overview.occupancyTarget ? "ok" : "warn"}
          label="Bezettingsgraad"
          value={`${Math.round(overview.occupancyRate * 100)}%`}
          hint={`Doel ${Math.round(overview.occupancyTarget * 100)}%`}
        />
        <StatCard
          icon={<ClipboardListIcon size={20} />}
          tone={overview.criticalOpenDuties > 0 ? "error" : "neutral"}
          label="Openstaande diensten"
          value={overview.openDuties}
          hint={
            overview.criticalOpenDuties > 0
              ? `${overview.criticalOpenDuties} kritiek`
              : "geen kritieke"
          }
          hintTone={overview.criticalOpenDuties > 0 ? "error" : "neutral"}
          href="/dienstindeling/openstaand"
          linkLabel="Naar openstaand"
        />
        <StatCard
          icon={<UsersIcon size={20} />}
          tone="did"
          label="Reserve beschikbaar"
          value={overview.reserveAvailable}
          hint="RES-posities vandaag"
          href="/dienstindeling/reserve"
          linkLabel="Naar reserve"
        />
        <StatCard
          icon={<CalendarCheckIcon size={20} />}
          tone="info"
          label="Beschikbare diensten"
          value={overview.availableForEmployees}
          hint="opengesteld voor medewerkers"
          href="/dienstindeling/beschikbaar"
          linkLabel="Naar beschikbaar"
        />
        <StatCard
          icon={<SwapIcon size={20} />}
          tone="neutral"
          label="Ruilverzoeken"
          value={overview.pendingSwaps}
          hint="in behandeling"
          href="/dienstindeling/ruilverzoeken"
          linkLabel="Naar ruilverzoeken"
        />
        <StatCard
          icon={<ShieldCheckIcon size={20} />}
          tone={overview.unresolvedDuties > 0 ? "error" : "ok"}
          label="Operationele status"
          value={overview.unresolvedDuties > 0 ? "Actie nodig" : "Onder controle"}
          hint={
            overview.unresolvedDuties > 0
              ? `${overview.unresolvedDuties} zonder oplossing`
              : "geen diensten zonder oplossing"
          }
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <WidgetCard
            icon={<ClipboardListIcon size={18} />}
            tone="did"
            title="Openstaande diensten"
            subtitle="Urgentste eerst, met de fase waarin ze zitten"
            actions={
              <Link
                href="/dienstindeling/openstaand"
                className="text-[12px] font-semibold text-accent-did hover:underline"
              >
                Volledig overzicht
              </Link>
            }
          >
            {open.length === 0 ? (
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
                    <TH>Prioriteit</TH>
                    <TH>Fase</TH>
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
                      <TD>
                        <Badge tone={PRIORITY_TONES[duty.priority]}>
                          {duty.priority.toLowerCase()}
                        </Badge>
                      </TD>
                      <TD>
                        {duty.status === "RESERVE_PENDING" ? (
                          <Badge tone="warn">Bij reserve</Badge>
                        ) : (
                          <Badge tone="info">
                            Open · {duty.interestCount} belangstellende
                            {duty.interestCount === 1 ? "" : "n"}
                          </Badge>
                        )}
                      </TD>
                      <TD>
                        {duty.status === "RESERVE_PENDING" ? (
                          <ActionForm
                            action={duty.reserveAttempted ? dienstOpenstellenAction : reserveInvullenAction}
                            submitLabel={duty.reserveAttempted ? "Openstellen" : "Reserve proberen"}
                            variant={duty.reserveAttempted ? "outline-did" : "primary"}
                            compact
                          >
                            <input type="hidden" name="availableDutyId" value={duty.id} />
                          </ActionForm>
                        ) : (
                          <span className="text-[11.5px] text-ink-muted">Loopt</span>
                        )}
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            )}
          </WidgetCard>
        </div>

        <WidgetCard
          icon={<UsersIcon size={18} />}
          tone="did"
          title="Reserve-inzetvoorstellen"
          subtitle="Automatisch, met de reden erbij"
          footer={
            <LinkButton href="/dienstindeling/reserve" variant="outline-did" block>
              Naar reserveoverzicht
            </LinkButton>
          }
        >
          {proposals.length === 0 ? (
            <div className="py-3">
              <EmptyState>Er ligt niets bij het reserve-rooster.</EmptyState>
            </div>
          ) : (
            proposals.map((proposal) => (
              <div
                key={proposal.availableDutyId}
                className="border-b border-line/70 py-2.5 last:border-0"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="tabular text-[12.5px] font-semibold text-ink-strong">
                    {proposal.dutyCode}
                  </span>
                  <span className="text-[11.5px] text-ink-muted">
                    {formatCalendarDate(proposal.date)}
                  </span>
                </div>

                {proposal.bestMatch ? (
                  <>
                    <p className="mt-1 text-[12px] text-ink">
                      Beste match:{" "}
                      <span className="tabular font-semibold">
                        {proposal.bestMatch.employeeNumber}
                      </span>{" "}
                      <span className="text-ink-muted">
                        ({proposal.bestMatch.preferenceLabel.toLowerCase()})
                      </span>
                    </p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <Meter value={proposal.bestMatch.score} tone="did" />
                      <span className="tabular w-9 text-right text-[11px] text-ink-muted">
                        {Math.round(proposal.bestMatch.score * 100)}%
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-ink-muted">
                      {proposal.bestMatch.explanation}
                    </p>
                    <div className="mt-2">
                      <ActionForm action={reserveInvullenAction} submitLabel="Toewijzen" compact>
                        <input
                          type="hidden"
                          name="availableDutyId"
                          value={proposal.availableDutyId}
                        />
                      </ActionForm>
                    </div>
                  </>
                ) : (
                  <p className="mt-1 text-[12px] text-state-warn">
                    Geen geldige reservekandidaat — deze dienst kan worden opengesteld.
                  </p>
                )}
              </div>
            ))
          )}
        </WidgetCard>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <WidgetCard
            icon={<CalendarCheckIcon size={18} />}
            tone="info"
            title="Bezetting komende 7 dagen"
            subtitle={`Doel ${Math.round(overview.occupancyTarget * 100)}% — toegewezen diensten gedeeld door alles wat gereden moet worden`}
            bodyClassName="border-t border-line p-4"
          >
            <ul className="space-y-1.5">
              {trend.map((point) => {
                // Groen: volledig bezet. Oranje: een klein tekort — tot 5% van
                // de vraag of hooguit twee diensten, wat van de twee groter is.
                // Rood: een tekort dat daarboven uitkomt. De kleur staat nooit
                // alleen: het aantal en het percentage staan er altijd naast.
                const kleineDrempel = Math.max(2, Math.round(point.needed * 0.05));
                const status: "VOLLEDIG" | "KLEIN_TEKORT" | "TEKORT" =
                  point.open === 0
                    ? "VOLLEDIG"
                    : point.open <= kleineDrempel
                      ? "KLEIN_TEKORT"
                      : "TEKORT";
                const tone =
                  status === "VOLLEDIG" ? "ok" : status === "KLEIN_TEKORT" ? "warn" : "error";
                const dagnaam = weekdayLabel(isoWeekday(point.date));
                return (
                  <li key={point.date}>
                    <Link
                      href={`/dienstindeling/openstaand?datum=${point.date}`}
                      className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-[12.5px] hover:bg-canvas"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                            tone === "ok"
                              ? "bg-state-ok"
                              : tone === "warn"
                                ? "bg-state-warn"
                                : "bg-state-error"
                          }`}
                          aria-hidden="true"
                        />
                        <span className="font-semibold capitalize text-ink-strong">{dagnaam}</span>
                      </span>
                      <span className="tabular text-ink-muted">
                        {point.assigned}/{point.needed}
                      </span>
                      <span className="tabular w-12 text-right font-semibold text-ink-strong">
                        {Math.round(point.rate * 100)}%
                      </span>
                      <span className="w-28 shrink-0 text-right">
                        <Badge tone={tone}>
                          {status === "VOLLEDIG" ? "Volledig" : `${point.open} openstaand`}
                        </Badge>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </WidgetCard>
        </div>

        <WidgetCard
          icon={<SwapIcon size={18} />}
          tone="neutral"
          title="Ruilverzoeken"
          subtitle="Ter informatie — de ruil is een afspraak tussen medewerkers"
          footer={
            <LinkButton href="/dienstindeling/ruilverzoeken" variant="secondary" block>
              Alle ruilverzoeken
            </LinkButton>
          }
        >
          {swaps.length === 0 ? (
            <div className="py-3">
              <EmptyState>Geen openstaande ruilverzoeken.</EmptyState>
            </div>
          ) : (
            swaps.map((swap) => (
              <div
                key={swap.id}
                className="flex items-center justify-between gap-3 border-b border-line/70 py-2.5 last:border-0"
              >
                <span className="min-w-0 text-[12.5px]">
                  <span className="tabular font-semibold">{swap.fromEmployeeNumber}</span>
                  <span className="mx-1 text-ink-faint">→</span>
                  <span className="tabular font-semibold">{swap.toEmployeeNumber}</span>
                  <span className="ml-2 font-mono text-[11.5px] text-ink-muted">
                    {swap.dutyCode}
                  </span>
                </span>
                <span className="tabular shrink-0 text-[11px] text-ink-faint">
                  <ClockIcon size={12} className="mr-1 inline" />
                  {swap.expiresAt.toLocaleDateString("nl-NL")}
                </span>
              </div>
            ))
          )}
        </WidgetCard>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Alert tone="info" title="Vaste volgorde bij een vrijgekomen dienst">
          Eerst het reserve-rooster, dan pas openstellen voor medewerkers. Een dienst die nog bij
          reserve ligt, verschijnt in geen enkele medewerkerslijst. Elke poging wordt vastgelegd,
          ook een mislukte — anders is niet aantoonbaar dát reserve eerst aan bod kwam.
        </Alert>
        <Alert tone="neutral" title="Wat Dienstindeling niet kan">
          De structuur van een basisrooster wijzigen. Dat is werk van de Rooster Commissie en
          Dienstindeling heeft er geen enkel recht op.{" "}
          <MegaphoneIcon size={13} className="inline" />
        </Alert>
      </div>
    </DutyAssignmentShell>
  );
}
