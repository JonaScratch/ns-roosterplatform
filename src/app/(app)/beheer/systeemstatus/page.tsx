import Link from "next/link";
import { securitySummary } from "@/server/services/audit-service";
import { systemHealth } from "@/server/services/admin-dashboard-service";
import { SESSION_POLICY } from "@/server/auth/session";
import {
  DEFAULT_PRODUCT_PARAMETERS,
  activeRuleset,
  isReleasedForProduction,
  rulesEngine,
} from "@/server/rules-engine";
import { AdminShell } from "@/components/layout/area-shell";
import { Alert, StatCard, StatusDot, WidgetCard, WidgetRow } from "@/components/ui/primitives";
import {
  ActivityIcon,
  ClockIcon,
  LockIcon,
  MonitorIcon,
  ShieldCheckIcon,
  UsersIcon,
} from "@/components/ui/icons";

export const dynamic = "force-dynamic";

/**
 * Systeem- en beveiligingsstatus.
 *
 * Elke regel is ofwel een echte controle, ofwel eerlijk als onbekend gemeld.
 * Een groen vinkje voor een voorziening die niet draait, is gevaarlijker dan
 * een leeg vak.
 */
export default async function Systeemstatus() {
  const [health, security] = await Promise.all([systemHealth(), securitySummary()]);
  const engine = rulesEngine();
  const ruleset = activeRuleset();
  const released = isReleasedForProduction(ruleset);

  const problems = health.filter((component) => component.state === "ERROR").length;
  const attention = health.filter((component) => component.state === "WARN").length;

  return (
    <AdminShell
      activeHref="/beheer/systeemstatus"
      header={{
        title: "Systeemstatus",
        subtitle: "Technische onderdelen, sessiebeleid en beveiligingssignalen",
      }}
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<ShieldCheckIcon size={20} />}
          tone={problems > 0 ? "error" : attention > 0 ? "warn" : "ok"}
          label="Onderdelen"
          value={`${health.length - problems - attention}/${health.length}`}
          hint="in orde"
        />
        <StatCard
          icon={<LockIcon size={20} />}
          tone={security.failedLoginsLastDay > 10 ? "warn" : "neutral"}
          label="Mislukte aanmeldingen"
          value={security.failedLoginsLastDay}
          hint="laatste 24 uur"
        />
        <StatCard
          icon={<UsersIcon size={20} />}
          tone="info"
          label="Actieve sessies"
          value={security.activeSessions}
          hint={`${SESSION_POLICY.idleTimeoutMinutes} min inactiviteit, ${SESSION_POLICY.absoluteTimeoutHours} u absoluut`}
        />
        <StatCard
          icon={<ActivityIcon size={20} />}
          tone={security.deniedAuthorizationsLastDay > 0 ? "warn" : "ok"}
          label="Geweigerde toegang"
          value={security.deniedAuthorizationsLastDay}
          hint="laatste 24 uur"
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <WidgetCard
          icon={<MonitorIcon size={18} />}
          tone="neutral"
          title="Onderdelen"
          subtitle="Elke regel is een echte controle"
        >
          {health.map((component) => (
            <div
              key={component.name}
              className="flex items-center justify-between gap-3 border-b border-line/70 py-2.5 last:border-0"
            >
              <StatusDot
                tone={
                  component.state === "OK"
                    ? "ok"
                    : component.state === "WARN"
                      ? "warn"
                      : component.state === "ERROR"
                        ? "error"
                        : "neutral"
                }
              >
                {component.name}
              </StatusDot>
              <span className="text-[12px] text-ink-muted">{component.detail}</span>
            </div>
          ))}
        </WidgetCard>

        <WidgetCard
          icon={<ClockIcon size={18} />}
          tone="rc"
          title="Beleid en instellingen"
          subtitle="Wat er nu geldt"
        >
          <WidgetRow label="Rules engine" value={`${engine.name} ${engine.version}`} />
          <WidgetRow
            label="Sessie: inactiviteit"
            value={`${SESSION_POLICY.idleTimeoutMinutes} minuten`}
          />
          <WidgetRow
            label="Sessie: absolute duur"
            value={`${SESSION_POLICY.absoluteTimeoutHours} uur`}
          />
          <WidgetRow
            label="Venster regelcontrole"
            value={`${DEFAULT_PRODUCT_PARAMETERS.windowDaysBack} dagen terug, ${DEFAULT_PRODUCT_PARAMETERS.windowDaysForward} vooruit`}
          />
          <WidgetRow
            label="Horizon beschikbare diensten"
            value={`${DEFAULT_PRODUCT_PARAMETERS.availableDutyHorizonDays} dagen`}
          />
          <WidgetRow
            label="Geblokkeerde accounts"
            value={security.lockedAccounts}
            valueTone={security.lockedAccounts > 0 ? "error" : "ok"}
          />
        </WidgetCard>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Alert
          tone={released ? "ok" : "warn"}
          title={`Regelbestand ${ruleset.version} — ${ruleset.mode}`}
        >
          Juridische status <span className="font-mono text-[11px]">{ruleset.legalStatus}</span>.{" "}
          <span className="font-semibold">
            {released
              ? "Formele NS-validatie voltooid."
              : "Formele NS-validatie niet voltooid — production-safe: NO zolang formele goedkeuring ontbreekt."}
          </span>{" "}
          Volledig overzicht per regel op{" "}
          <Link href="/beheer/regelbronnen" className="underline">
            Regelbronnen
          </Link>
          .
        </Alert>
        <Alert tone="warn" title="Nog niet ingericht voor productie">
          Back-up en herstel zijn niet geconfigureerd, en de authenticatie draait op lokale
          testaccounts. Beide staan hierboven als zodanig gemeld en worden niet als in orde
          gerapporteerd.
        </Alert>
        <Alert tone="neutral" title="Wat er wordt vastgelegd">
          Herkomst van verzoeken wordt opgeslagen als HMAC-vingerafdruk, niet als IP-adres.
          Wachtwoorden, tokens, namen en e-mailadressen worden vóór opslag uit elke logregel
          verwijderd.
        </Alert>
      </div>
    </AdminShell>
  );
}
