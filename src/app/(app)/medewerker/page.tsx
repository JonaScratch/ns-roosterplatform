import Link from "next/link";
import { formatCalendarDate, formatMinuteOfDay, weekdayLabel } from "@/domain/time";
import { employeeDashboard } from "@/server/services/employee-dashboard-service";
import { ownIdentity } from "@/server/data/repositories/identity-repository";
import { EmployeeShell } from "@/components/layout/area-shell";
import { DidContactCard } from "@/components/medewerker/did-contact-card";
import { MijnBasisroosterCard } from "@/components/medewerker/mijn-basisrooster-card";
import { ActionForm } from "@/components/ui/action-form";
import {
  Alert,
  Badge,
  EmptyState,
  LinkButton,
  StatusDot,
  WidgetCard,
  WidgetRow,
} from "@/components/ui/primitives";
import {
  CalendarCheckIcon,
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  ListIcon,
  MailIcon,
  StarIcon,
  SwapIcon,
  UsersIcon,
} from "@/components/ui/icons";
import { DutyKinds } from "@/components/schedule/duty-label";
import { beantwoordRuilAction } from "./acties";
import { addDays } from "@/domain/time";

export const dynamic = "force-dynamic";

/**
 * Het persoonlijke dashboard van een medewerker.
 *
 * Alles op deze pagina gaat over de ingelogde gebruiker zelf. Er is geen
 * parameter waarmee een ander dashboard op te vragen is: `employeeDashboard`
 * accepteert er geen.
 */
export default async function MedewerkerDashboard({
  searchParams,
}: PageProps<"/medewerker">) {
  const params = await searchParams;
  const weekStart = typeof params.week === "string" ? params.week : undefined;
  const [board, identity] = await Promise.all([employeeDashboard(weekStart), ownIdentity()]);

  return (
    <EmployeeShell
      activeHref="/medewerker"
      header={{
        title: `${greeting()}, ${identity?.firstName ?? board.profile.employeeNumber}`,
        subtitle: `Roosterprofiel ${board.profile.rosterProfileLabel} · standplaats ${board.profile.depot}${
          board.profile.baseRosterCode
            ? ` · ${board.profile.baseRosterCode} lijn ${board.profile.lineNumber}`
            : ""
        }`,
      }}
    >
      <div className="grid gap-4 xl:grid-cols-3">
        <NextDuties board={board} />
        <Messages board={board} />
        <QuickLinks />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <WeekStrip board={board} />
        </div>
        <Balance board={board} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <SwapRequests board={board} />
        <AvailableForYou />
        <Waitlists board={board} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <MijnBasisroosterCard />
        <DidContactCard />
      </div>
    </EmployeeShell>
  );
}

function greeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) {
    return "Goedemorgen";
  }
  return hour < 18 ? "Goedemiddag" : "Goedenavond";
}

type Board = Awaited<ReturnType<typeof employeeDashboard>>;

function NextDuties({ board }: { board: Board }) {
  return (
    <WidgetCard
      icon={<CalendarIcon size={18} />}
      tone="rc"
      title="Eerstvolgende diensten"
      subtitle="Uit uw eigen rooster"
      actions={
        <Link
          href="/medewerker/rooster"
          className="text-[12px] font-semibold text-accent-rc hover:underline"
        >
          Bekijk volledige rooster
        </Link>
      }
    >
      {board.upcoming.length === 0 ? (
        <div className="py-3">
          <EmptyState>Er staan geen diensten gepland in de komende twee weken.</EmptyState>
        </div>
      ) : (
        board.upcoming.map((day) => (
          <div
            key={day.id}
            className="flex items-center gap-3 border-b border-line/70 py-2.5 last:border-0"
          >
            <span className="w-16 shrink-0 text-[12px] text-ink-muted">
              {shortDate(day.date)}
            </span>
            <span
              className={`tabular w-12 shrink-0 rounded-md px-1.5 py-1 text-center text-[12px] font-semibold ${
                day.duty ? "bg-accent-rc text-white" : "bg-canvas text-ink-muted"
              }`}
            >
              {day.duty?.code ?? day.positionType}
            </span>
            <span className="tabular flex-1 text-[12.5px] text-ink">
              {day.duty
                ? `${formatMinuteOfDay(day.duty.startMinute)} – ${formatMinuteOfDay(day.duty.endMinute)}`
                : "—"}
            </span>
            {day.duty && <DutyKinds kinds={day.duty.kinds} />}
          </div>
        ))
      )}
    </WidgetCard>
  );
}

function Messages({ board }: { board: Board }) {
  return (
    <WidgetCard
      icon={<MailIcon size={18} />}
      tone="info"
      title="Berichten"
      subtitle="Afgeleid uit wat er speelt"
    >
      {board.messages.length === 0 ? (
        <div className="py-3">
          <EmptyState>Geen openstaande punten.</EmptyState>
        </div>
      ) : (
        board.messages.map((message) => (
          <div key={message.id} className="border-b border-line/70 py-2.5 last:border-0">
            <StatusDot tone={message.tone}>
              <span className="font-medium text-ink">{message.title}</span>
            </StatusDot>
            <p className="mt-0.5 pl-4 text-[12px] text-ink-muted">{message.body}</p>
          </div>
        ))
      )}
    </WidgetCard>
  );
}

const QUICK_LINKS = [
  { href: "/medewerker/diensten", label: "Beschikbare diensten", icon: CalendarCheckIcon },
  { href: "/medewerker/ruilen", label: "Dienst ruilen", icon: SwapIcon },
  { href: "/medewerker/wachtlijsten", label: "Wachtlijsten", icon: UsersIcon },
  // Bewust niet "Reservevoorkeur": die pagina geldt alleen voor wie in een
  // reserverooster zit, en die afweging staat in de zijbalk. Een snelkoppeling
  // die voor de helft van de medewerkers naar een lege pagina leidt, is erger
  // dan geen snelkoppeling.
  { href: "/medewerker/cao-dagen", label: "CAO-dagen", icon: StarIcon },
  { href: "/medewerker/feedback", label: "Kwartaalfeedback", icon: MailIcon },
  { href: "/medewerker/rooster", label: "Mijn rooster", icon: CalendarIcon },
];

function QuickLinks() {
  return (
    <WidgetCard title="Snel naar" bodyClassName="border-t border-line p-4">
      <div className="grid grid-cols-3 gap-2">
        {QUICK_LINKS.map((link) => {
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className="flex flex-col items-center gap-2 rounded-lg border border-line px-2 py-3 text-center text-[11.5px] font-medium text-ink transition-colors hover:border-accent-rc/40 hover:bg-accent-rc-soft"
            >
              <span className="text-accent-rc">
                <Icon size={20} />
              </span>
              {link.label}
            </Link>
          );
        })}
      </div>
    </WidgetCard>
  );
}

const POSITION_STYLES: Record<string, string> = {
  DUTY: "border-accent-rc bg-accent-rc text-white",
  RES: "border-line-strong bg-canvas text-ink",
  WR: "border-line-strong bg-canvas text-ink",
  CO: "border-line-strong bg-canvas text-ink",
  RUST: "border-state-ok/30 bg-state-ok-soft text-state-ok",
  VERLOF: "border-state-ok/30 bg-state-ok-soft text-state-ok",
  OPLEIDING: "border-state-warn/30 bg-state-warn-soft text-state-warn",
};

const POSITION_LABELS: Record<string, string> = {
  RES: "Reserve",
  WR: "WR",
  CO: "CO",
  RUST: "Vrije dag",
  VERLOF: "Verlof",
  OPLEIDING: "Opleiding",
};

function WeekStrip({ board }: { board: Board }) {
  const previous = addDays(board.week.from, -7);
  const next = addDays(board.week.from, 7);

  return (
    <WidgetCard
      title={`Mijn rooster — ${board.week.key}`}
      subtitle={`${formatCalendarDate(board.week.from)} tot en met ${formatCalendarDate(board.week.to)}`}
      actions={
        <span className="flex items-center gap-1">
          <Link
            href={`/medewerker?week=${previous}`}
            aria-label="Vorige week"
            className="rounded-md border border-line p-1 text-ink-muted hover:bg-canvas"
          >
            <ChevronLeftIcon size={15} />
          </Link>
          <Link
            href={`/medewerker?week=${next}`}
            aria-label="Volgende week"
            className="rounded-md border border-line p-1 text-ink-muted hover:bg-canvas"
          >
            <ChevronRightIcon size={15} />
          </Link>
        </span>
      }
      bodyClassName="border-t border-line p-4"
    >
      <div className="grid grid-cols-7 gap-2">
        {board.week.days.map((day) => (
          <div key={day.date} className="min-w-0">
            <p className="mb-1 truncate text-[11px] font-medium text-ink-muted">
              {weekdayLabel(day.weekday).slice(0, 2)} {day.date.slice(8)}-{day.date.slice(5, 7)}
            </p>
            <div
              className={`min-h-[68px] rounded-lg border px-2 py-2 ${
                POSITION_STYLES[day.positionType] ?? "border-line bg-canvas text-ink"
              } ${day.date === board.today ? "ring-2 ring-ns-yellow" : ""}`}
            >
              <p className="tabular text-[13px] font-semibold">
                {day.dutyCode ?? POSITION_LABELS[day.positionType] ?? day.positionType}
              </p>
              {day.startMinute !== null && day.endMinute !== null && (
                <p className="tabular mt-0.5 text-[10.5px] opacity-90">
                  {formatMinuteOfDay(day.startMinute)} – {formatMinuteOfDay(day.endMinute)}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-3 border-t border-line pt-3 text-[11px] text-ink-muted">
        <StatusDot tone="rc">Dienst</StatusDot>
        <StatusDot tone="neutral">RES / WR / CO</StatusDot>
        <StatusDot tone="ok">Vrije dag of verlof</StatusDot>
        <StatusDot tone="warn">Opleiding</StatusDot>
      </div>
    </WidgetCard>
  );
}

function Balance({ board }: { board: Board }) {
  return (
    <WidgetCard
      icon={<ClockIcon size={18} />}
      tone="ok"
      title="Status & saldo"
      subtitle="Deze maand, volgens het rooster"
      footer={
        <Alert tone="neutral">
          Verlof- en WTV-saldo komen uit de personeelsadministratie en worden hier bewust niet
          getoond zolang die koppeling ontbreekt.
        </Alert>
      }
    >
      <WidgetRow
        icon={<ClockIcon size={15} />}
        label="Geplande uren deze maand"
        value={formatHours(board.balance.plannedMinutesThisMonth)}
      />
      <WidgetRow
        icon={<ClockIcon size={15} />}
        label="Waarvan tot vandaag"
        value={formatHours(board.balance.workedMinutesSoFar)}
      />
      <WidgetRow
        icon={<CalendarIcon size={15} />}
        label="Vrije dagen"
        value={board.balance.restDaysThisMonth}
      />
      <WidgetRow
        icon={<ClockIcon size={15} />}
        label="Nachtdiensten"
        value={board.balance.nightDutiesThisMonth}
        valueTone={board.balance.nightDutiesThisMonth > 6 ? "warn" : "neutral"}
      />
      <WidgetRow
        icon={<ListIcon size={15} />}
        label="Rangeerdiensten"
        value={board.balance.shuntingDutiesThisMonth}
      />
    </WidgetCard>
  );
}

function formatHours(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}:${String(rest).padStart(2, "0")} uur`;
}

function shortDate(date: string): string {
  return new Intl.DateTimeFormat("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function SwapRequests({ board }: { board: Board }) {
  return (
    <WidgetCard
      icon={<SwapIcon size={18} />}
      tone="did"
      title="Ruilverzoeken"
      subtitle="Aan u gericht en door u verstuurd"
      footer={
        <LinkButton href="/medewerker/ruilen" variant="secondary" block>
          Naar ruiloverzicht
        </LinkButton>
      }
    >
      {board.incomingSwaps.length === 0 && board.outgoingSwaps.length === 0 ? (
        <div className="py-3">
          <EmptyState>Geen openstaande ruilverzoeken.</EmptyState>
        </div>
      ) : (
        <>
          {board.incomingSwaps.map((swap) => (
            <div key={swap.id} className="border-b border-line/70 py-2.5 last:border-0">
              <p className="text-[12.5px]">
                <span className="tabular font-semibold">{swap.fromEmployeeNumber}</span> biedt{" "}
                <span className="font-mono">{swap.theirDutyCode}</span> ({shortDate(swap.theirDate)}){" "}
                voor uw <span className="font-mono">{swap.yourDutyCode}</span> (
                {shortDate(swap.yourDate)})
              </p>
              <div className="mt-2 flex gap-2">
                <ActionForm action={beantwoordRuilAction} submitLabel="Accepteren" compact>
                  <input type="hidden" name="proposalId" value={swap.id} />
                  <input type="hidden" name="antwoord" value="accepteren" />
                </ActionForm>
                <ActionForm
                  action={beantwoordRuilAction}
                  submitLabel="Afwijzen"
                  variant="secondary"
                  compact
                >
                  <input type="hidden" name="proposalId" value={swap.id} />
                  <input type="hidden" name="antwoord" value="afwijzen" />
                </ActionForm>
              </div>
            </div>
          ))}

          {board.outgoingSwaps.map((swap) => (
            <div
              key={swap.id}
              className="flex items-center justify-between gap-2 border-b border-line/70 py-2.5 last:border-0"
            >
              <span className="text-[12.5px] text-ink-muted">
                Naar <span className="tabular font-semibold text-ink">{swap.toEmployeeNumber}</span>{" "}
                · <span className="font-mono">{swap.ownDutyCode}</span> {shortDate(swap.ownDate)}
              </span>
              <Badge tone={swap.status === "ACCEPTED" ? "ok" : swap.status === "PENDING" ? "info" : "neutral"}>
                {swap.status === "PENDING" ? "In behandeling" : swap.status.toLowerCase()}
              </Badge>
            </div>
          ))}
        </>
      )}
    </WidgetCard>
  );
}

/**
 * Beschikbare diensten voor deze medewerker.
 *
 * Bewust een verwijzing en geen lijst: de geschiktheidstoets is een volledige
 * doorrekening per dienst en hoort niet bij elke weergave van het dashboard te
 * draaien. De lijst zelf staat op de eigen pagina.
 */
function AvailableForYou() {
  return (
    <WidgetCard
      icon={<CalendarCheckIcon size={18} />}
      tone="ok"
      title="Beschikbare diensten"
      subtitle="Alleen diensten die u ook echt mag rijden"
      footer={
        <LinkButton href="/medewerker/diensten" block>
          Bekijk beschikbare diensten
        </LinkButton>
      }
    >
      <p className="py-3 text-[12.5px] text-ink-muted">
        Vrijgekomen diensten gaan eerst langs het reserve-rooster. Wat daar geen invulling krijgt,
        wordt opengesteld voor medewerkers die er roostertechnisch geschikt voor zijn.
      </p>
      <p className="pb-3 text-[12.5px] text-ink-muted">
        Bij meerdere gegadigden beslist de roulatielijst van die weekdag — niet wie het snelste
        klikt.
      </p>
    </WidgetCard>
  );
}

function Waitlists({ board }: { board: Board }) {
  return (
    <WidgetCard
      icon={<ListIcon size={18} />}
      tone="info"
      title="Wachtlijsten"
      subtitle="Positie volgt uit inschrijfdatum"
      footer={
        <LinkButton href="/medewerker/wachtlijsten" variant="secondary" block>
          Naar wachtlijsten
        </LinkButton>
      }
    >
      {board.waitlists.length === 0 ? (
        <div className="py-3">
          <EmptyState>U staat op geen enkele wachtlijst.</EmptyState>
        </div>
      ) : (
        board.waitlists.map((entry) => (
          <div
            key={entry.code}
            className="flex items-center justify-between gap-3 border-b border-line/70 py-2.5 last:border-0"
          >
            <span className="min-w-0">
              <span className="block truncate text-[12.5px] font-medium text-ink">
                {entry.profileLabel}
              </span>
              <span className="block text-[11.5px] text-ink-muted">
                Ingeschreven {entry.enrolledAt.toLocaleDateString("nl-NL")}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block text-[11px] text-ink-muted">Positie</span>
              <span className="tabular block text-[15px] font-bold text-ink-strong">
                {entry.position}
              </span>
            </span>
          </div>
        ))
      )}
    </WidgetCard>
  );
}
