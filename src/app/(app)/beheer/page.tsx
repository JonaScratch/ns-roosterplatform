import Link from "next/link";
import {
  adminKpis,
  dutyAssignmentSummary,
  recentAdminActivity,
  rosterCommitteeSummary,
  systemHealth,
} from "@/server/services/admin-dashboard-service";
import { roleCounts } from "@/server/services/role-service";
import { AdminShell } from "@/components/layout/area-shell";
import {
  Alert,
  LinkButton,
  StatCard,
  StatusDot,
  WidgetCard,
  WidgetRow,
} from "@/components/ui/primitives";
import {
  ActivityIcon,
  CalendarCheckIcon,
  CalendarIcon,
  CheckCircleIcon,
  ClockIcon,
  HistoryIcon,
  ListIcon,
  MonitorIcon,
  ShieldCheckIcon,
  ShieldIcon,
  SwapIcon,
  UserSquareIcon,
  UsersIcon,
} from "@/components/ui/icons";

export const dynamic = "force-dynamic";

/**
 * Het beheerdersdashboard.
 *
 * Geen vierde plannersomgeving maar een bedieningspaneel: kerncijfers bovenaan,
 * daaronder drie blokken die elk naar een hele omgeving leiden, en onderin de
 * technische en toezichtsstand.
 *
 * Alles op deze pagina is een aantal, een percentage of een status. Er wordt
 * geen enkel persoonsgegeven geladen — een beheerdersscherm dat standaard namen
 * toont, is een personeelsregister dat de hele dag openstaat.
 */
export default async function AdminDashboard() {
  const [kpis, roles, rc, did, health, activity] = await Promise.all([
    adminKpis(),
    roleCounts(),
    rosterCommitteeSummary(),
    dutyAssignmentSummary(),
    systemHealth(),
    recentAdminActivity(6),
  ]);

  const problems = health.filter((component) => component.state === "ERROR");
  const attention = health.filter((component) => component.state === "WARN");

  return (
    <AdminShell
      activeHref="/beheer"
      header={{
        title: "Admin Dashboard",
        subtitle: "Beheer, toezicht en de stand van beide plannersomgevingen",
        notificationCount: attention.length + problems.length,
      }}
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<UsersIcon size={20} />}
          tone="info"
          label="Actieve medewerkers"
          value={kpis.activeEmployees.toLocaleString("nl-NL")}
          hint={
            kpis.employeesAddedThisMonth > 0
              ? `+${kpis.employeesAddedThisMonth} deze maand`
              : "geen nieuwe deze maand"
          }
          hintTone={kpis.employeesAddedThisMonth > 0 ? "ok" : "neutral"}
          href="/beheer/gebruikers"
          linkLabel="Naar gebruikersoverzicht"
        />
        <StatCard
          icon={<CalendarIcon size={20} />}
          tone="rc"
          label="Rooster Commissie"
          value={percentage(kpis.ruleConformity)}
          hint="Regelconformiteit laatste 30 dagen"
          href="/roostercommissie"
          linkLabel="Naar Rooster Commissie"
        />
        <StatCard
          icon={<UserSquareIcon size={20} />}
          tone="did"
          label="Dienstindeling"
          value={percentage(kpis.occupancyRate)}
          hint="Bezettingsgraad vandaag"
          href="/dienstindeling"
          linkLabel="Naar Dienstindeling"
        />
        <StatCard
          icon={<ShieldCheckIcon size={20} />}
          tone={problems.length > 0 ? "error" : attention.length > 0 ? "warn" : "ok"}
          label="Systeemstatus"
          value={
            problems.length > 0
              ? "Storing"
              : attention.length > 0
                ? `${attention.length} aandachtspunt${attention.length === 1 ? "" : "en"}`
                : "Alles operationeel"
          }
          hint={`Laatste controle ${kpis.lastCheckAt.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}`}
          href="/beheer/systeemstatus"
          linkLabel="Naar systeemstatus"
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <WidgetCard
          icon={<UsersIcon size={18} />}
          tone="info"
          title="Rollen & gebruikers"
          subtitle="Beheer gebruikers, rollen en rechten"
          footer={
            <LinkButton href="/beheer/gebruikers" block>
              Rollen beheren
            </LinkButton>
          }
        >
          {roles.map((role) => (
            <WidgetRow
              key={role.role}
              icon={role.role === "ADMIN" ? <ShieldIcon size={15} /> : <UsersIcon size={15} />}
              label={role.label}
              value={role.count.toLocaleString("nl-NL")}
            />
          ))}
        </WidgetCard>

        <WidgetCard
          icon={<CalendarIcon size={18} />}
          tone="rc"
          title="Rooster Commissie"
          subtitle="Jaarroosters samenstellen en publiceren"
          footer={
            <LinkButton href="/roostercommissie" variant="outline-rc" block>
              Open Rooster Commissie
            </LinkButton>
          }
        >
          <WidgetRow
            icon={<CalendarIcon size={15} />}
            label="Actief dienstenpakket"
            value={
              rc.activePackage ? `${rc.activePackage.name} v${rc.activePackage.version}` : "geen"
            }
            valueTone={rc.activePackage ? "neutral" : "warn"}
          />
          <WidgetRow icon={<ListIcon size={15} />} label="Basisroosters" value={rc.baseRosters} />
          <WidgetRow icon={<ListIcon size={15} />} label="Roosterlijnen" value={rc.rosterLines} />
          <WidgetRow
            icon={<ShieldIcon size={15} />}
            label="Harde overtredingen"
            value={rc.hardViolations}
            valueTone={rc.hardViolations > 0 ? "error" : "ok"}
          />
          <WidgetRow
            icon={<ActivityIcon size={15} />}
            label="Feedbackverwerking"
            value={percentage(rc.feedbackResponseRate)}
          />
          <WidgetRow
            icon={<ClockIcon size={15} />}
            label="Laatst gepubliceerd"
            value={
              rc.lastPublishedAt ? rc.lastPublishedAt.toLocaleDateString("nl-NL") : "nog niet"
            }
            valueTone={rc.lastPublishedAt ? "neutral" : "warn"}
          />
        </WidgetCard>

        <WidgetCard
          icon={<UserSquareIcon size={18} />}
          tone="did"
          title="Dienstindeling"
          subtitle="Diensten invullen en dagelijks sturen"
          footer={
            <LinkButton href="/dienstindeling" variant="outline-did" block>
              Open Dienstindeling
            </LinkButton>
          }
        >
          <WidgetRow
            icon={<CalendarCheckIcon size={15} />}
            label="Bezettingsgraad vandaag"
            value={percentage(did.occupancyRate)}
            valueTone={
              did.occupancyRate !== null && did.occupancyRate < 0.95 ? "warn" : "ok"
            }
          />
          <WidgetRow
            icon={<ClockIcon size={15} />}
            label="Openstaande diensten"
            value={did.openDuties}
            valueTone={did.openDuties > 0 ? "warn" : "neutral"}
          />
          <WidgetRow
            icon={<UsersIcon size={15} />}
            label="Reserve inzetbaar"
            value={did.reserveAvailable}
          />
          <WidgetRow
            icon={<CalendarCheckIcon size={15} />}
            label="Beschikbare diensten"
            value={did.availableForEmployees}
          />
          <WidgetRow
            icon={<SwapIcon size={15} />}
            label="Openstaande ruilingen"
            value={did.pendingSwaps}
          />
          <WidgetRow
            icon={<ShieldIcon size={15} />}
            label="Diensten zonder oplossing"
            value={did.unresolvedDuties}
            valueTone={did.unresolvedDuties > 0 ? "error" : "ok"}
          />
        </WidgetCard>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <WidgetCard
          icon={<MonitorIcon size={18} />}
          tone="neutral"
          title="Systeemprestaties"
          subtitle="Elke regel is een echte controle"
          bodyClassName="border-t border-line p-4"
        >
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
            <ul className="space-y-2">
              {health.map((component) => (
                <li
                  key={component.name}
                  className="flex items-center justify-between gap-3 border-b border-line/70 pb-2 last:border-0"
                >
                  <StatusDot tone={dotTone(component.state)}>{component.name}</StatusDot>
                  <span
                    className={`text-[12px] ${
                      component.state === "ERROR"
                        ? "text-state-error"
                        : component.state === "WARN"
                          ? "text-state-warn"
                          : "text-ink-muted"
                    }`}
                  >
                    {component.detail}
                  </span>
                </li>
              ))}
            </ul>

            <div className="flex flex-col items-center justify-center rounded-xl border border-line bg-canvas px-6 py-5 text-center">
              <span
                className={
                  problems.length > 0
                    ? "text-state-error"
                    : attention.length > 0
                      ? "text-state-warn"
                      : "text-state-ok"
                }
              >
                {problems.length > 0 ? <ShieldIcon size={30} /> : <ShieldCheckIcon size={30} />}
              </span>
              <p className="mt-2 text-[12.5px] font-semibold text-ink-strong">
                {problems.length > 0 ? "Storing" : "Geen storingen"}
              </p>
              <p className="mt-0.5 max-w-40 text-[11.5px] text-ink-muted">
                {attention.length > 0
                  ? attention.length === 1
                    ? "Eén onderdeel vraagt aandacht"
                    : `${attention.length} onderdelen vragen aandacht`
                  : "Alle gecontroleerde onderdelen in orde"}
              </p>
            </div>
          </div>
        </WidgetCard>

        <WidgetCard
          icon={<HistoryIcon size={18} />}
          tone="neutral"
          title="Recente beheer- en planningsacties"
          subtitle="Uit het auditlog, zonder persoonsgegevens"
          actions={
            <Link
              href="/beheer/auditlog"
              className="text-[12px] font-semibold text-accent-rc hover:underline"
            >
              Bekijk alle
            </Link>
          }
        >
          {activity.length === 0 ? (
            <p className="py-4 text-[12.5px] text-ink-muted">
              Nog geen acties vastgelegd in deze categorieën.
            </p>
          ) : (
            activity.map((entry) => (
              <div
                key={entry.id}
                className="flex items-start justify-between gap-3 border-b border-line/70 py-2.5 last:border-0"
              >
                <span className="flex min-w-0 items-start gap-2.5">
                  <span
                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                      entry.denied
                        ? "bg-state-error-soft text-state-error"
                        : "bg-state-info-soft text-state-info"
                    }`}
                  >
                    {entry.denied ? <ShieldIcon size={14} /> : <CheckCircleIcon size={14} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-medium text-ink">
                      {entry.action}
                    </span>
                    <span className="block truncate text-[11.5px] text-ink-muted">
                      {entry.actorEmployeeNumber
                        ? `door ${entry.actorEmployeeNumber}`
                        : "door het systeem"}{" "}
                      · {entry.summary}
                    </span>
                  </span>
                </span>
                <span className="tabular shrink-0 text-[11.5px] text-ink-faint">
                  {entry.occurredAt.toLocaleString("nl-NL", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            ))
          )}
        </WidgetCard>
      </div>

      <div className="mt-4">
        <Alert tone="neutral" title="Wat dit dashboard bewust niet toont">
          Geen namen, geen e-mailadressen, geen individuele feedback. Een beheerder die een naam
          nodig heeft, haalt die apart op — en die inzage komt in het auditlog te staan.
        </Alert>
      </div>
    </AdminShell>
  );
}

function percentage(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function dotTone(state: "OK" | "WARN" | "ERROR" | "UNKNOWN") {
  return state === "OK" ? "ok" : state === "WARN" ? "warn" : state === "ERROR" ? "error" : "neutral";
}
