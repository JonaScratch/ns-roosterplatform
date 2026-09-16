import {
  recentAuditEntries,
  recentSecurityEvents,
  securitySummary,
} from "@/server/services/audit-service";
import { ROLE_LABELS } from "@/server/security/permissions";
import { AdminShell } from "@/components/layout/area-shell";
import { Alert, Badge, EmptyState, WidgetCard, StatCard, inputClass } from "@/components/ui/primitives";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";

export const dynamic = "force-dynamic";

const EVENT_LABELS: Record<string, string> = {
  LOGIN_SUCCESS: "Aanmelding gelukt",
  LOGIN_FAILED: "Aanmelding mislukt",
  LOGIN_BLOCKED: "Aanmelding geblokkeerd",
  ACCOUNT_LOCKED: "Account geblokkeerd",
  LOGOUT: "Afgemeld",
  SESSION_EXPIRED: "Sessie verlopen",
  AUTHORIZATION_DENIED: "Toegang geweigerd",
  RATE_LIMITED: "Te veel pogingen",
  CSRF_REJECTED: "Verzoek geweigerd (CSRF)",
  ROLE_CHANGED: "Rollen gewijzigd",
  ACCOUNT_STATUS_CHANGED: "Accountstatus gewijzigd",
};

export default async function Toezicht({ searchParams }: PageProps<"/beheer">) {
  const params = await searchParams;
  const actionFilter = typeof params.actie === "string" ? params.actie : undefined;
  const employeeFilter = typeof params.medewerker === "string" ? params.medewerker : undefined;

  const [summary, entries, events] = await Promise.all([
    securitySummary(),
    recentAuditEntries({ action: actionFilter, employeeNumber: employeeFilter, limit: 100 }),
    recentSecurityEvents(50),
  ]);

  return (
    <AdminShell
      activeHref="/beheer/auditlog"
      header={{
        title: "Auditlog & toezicht",
        subtitle:
          "Elke gevoelige handeling en elke beveiligingsgebeurtenis — uitsluitend leesbaar",
      }}
    >

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Mislukte aanmeldingen"
          value={summary.failedLoginsLastDay}
          hint="laatste 24 uur"
          tone={summary.failedLoginsLastDay > 10 ? "warn" : "neutral"}
        />
        <StatCard
          label="Geweigerde toegang"
          value={summary.deniedAuthorizationsLastDay}
          hint="laatste 24 uur"
          tone={summary.deniedAuthorizationsLastDay > 0 ? "warn" : "neutral"}
        />
        <StatCard label="Actieve sessies" value={summary.activeSessions} />
        <StatCard
          label="Geblokkeerde accounts"
          value={summary.lockedAccounts}
          tone={summary.lockedAccounts > 0 ? "error" : "neutral"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <WidgetCard
            title="Auditspoor"
            subtitle="Wie, wat, waarop, wanneer — met oude en nieuwe waarde waar die van belang zijn."
            actions={
              <form className="flex items-end gap-2 text-xs">
                <input
                  name="actie"
                  defaultValue={actionFilter}
                  placeholder="actie bevat…"
                  className={`${inputClass} w-32 py-1`}
                />
                <input
                  name="medewerker"
                  defaultValue={employeeFilter}
                  placeholder="personeelsnr."
                  className={`${inputClass} w-28 py-1`}
                />
                <button
                  type="submit"
                  className="rounded border border-line-strong bg-surface px-2.5 py-1 font-semibold hover:bg-canvas"
                >
                  Filteren
                </button>
              </form>
            }
          >
            {entries.length === 0 ? (
              <EmptyState>Geen auditregels gevonden.</EmptyState>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Tijdstip</TH>
                    <TH>Gebruiker</TH>
                    <TH>Actie</TH>
                    <TH>Object</TH>
                    <TH>Uitkomst</TH>
                    <TH>Waarden</TH>
                  </TR>
                </THead>
                <tbody>
                  {entries.map((entry) => (
                    <TR key={entry.id}>
                      <TD>
                        <span className="tabular whitespace-nowrap text-[11px]">
                          {entry.occurredAt.toLocaleString("nl-NL")}
                        </span>
                      </TD>
                      <TD>
                        <span className="tabular">{entry.actorEmployeeNumber ?? "systeem"}</span>
                        {entry.actorRoles.length > 0 && (
                          <span className="block text-[10px] text-ink-muted">
                            {entry.actorRoles.map((role) => ROLE_LABELS[role]).join(", ")}
                          </span>
                        )}
                      </TD>
                      <TD mono>{entry.action}</TD>
                      <TD>
                        <span className="text-[11px]">{entry.objectType}</span>
                        {entry.objectId && (
                          <span className="block font-mono text-[10px] text-ink-muted">
                            {entry.objectId.slice(0, 8)}…
                          </span>
                        )}
                      </TD>
                      <TD>
                        <Badge
                          tone={
                            entry.result === "SUCCESS"
                              ? "ok"
                              : entry.result === "DENIED"
                                ? "error"
                                : "warn"
                          }
                        >
                          {entry.result}
                        </Badge>
                        {entry.reason && (
                          <span className="mt-0.5 block text-[10px] text-ink-muted">
                            {entry.reason}
                          </span>
                        )}
                      </TD>
                      <TD>
                        <ValuePair label="oud" value={entry.oldValue} />
                        <ValuePair label="nieuw" value={entry.newValue} />
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            )}
          </WidgetCard>
        </div>

        <div className="space-y-4">
          <WidgetCard title="Beveiligingsgebeurtenissen">
            {events.length === 0 ? (
              <EmptyState>Nog geen gebeurtenissen.</EmptyState>
            ) : (
              <ul className="max-h-[32rem] space-y-1.5 overflow-y-auto">
                {events.map((event) => (
                  <li key={event.id} className="border-b border-line/60 pb-1.5 last:border-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs font-medium">
                        {EVENT_LABELS[event.kind] ?? event.kind}
                      </span>
                      <span className="tabular shrink-0 text-[10px] text-ink-muted">
                        {event.occurredAt.toLocaleString("nl-NL")}
                      </span>
                    </div>
                    {event.subject && (
                      <span className="tabular text-[11px] text-ink-muted">{event.subject}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </WidgetCard>

          <Alert tone="neutral" title="Wat hier niet staat">
            Geen namen, geen e-mailadressen, geen IP-adressen. Herkomst wordt vastgelegd als
            HMAC-vingerafdruk: twee verzoeken van dezelfde plek zijn herkenbaar, maar het adres
            zelf is er niet uit te halen.
          </Alert>
        </div>
      </div>
    </AdminShell>
  );
}

/** Compacte weergave van een oude of nieuwe waarde uit het auditlog. */
function ValuePair({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) {
    return null;
  }
  return (
    <span className="block font-mono text-[10px] text-ink-muted">
      {label}: {JSON.stringify(value).slice(0, 90)}
    </span>
  );
}
