import { SESSION_POLICY } from "@/server/auth/session";
import { currentActor } from "@/server/auth/session";
import { redirect } from "next/navigation";
import { ROLE_LABELS, permissionsForRoles } from "@/server/security/permissions";
import { SharedShell } from "@/components/layout/area-shell";
import { Alert, Badge, WidgetCard, WidgetRow } from "@/components/ui/primitives";
import { LockIcon, SettingsIcon, UserIcon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

/**
 * Instellingen.
 *
 * Toont wat er over de eigen sessie en rechten bekend is. Bewust geen
 * profielgegevens: naam en e-mailadres worden hier niet geladen, want daarvoor
 * is geen reden en elke uitlezing zou een auditregel opleveren.
 */
export default async function Instellingen() {
  const actor = await currentActor();
  if (!actor) {
    redirect("/aanmelden");
  }

  const permissions = [...permissionsForRoles(actor.roles)].sort();

  return (
    <SharedShell
      activeHref="/instellingen"
      header={{ title: "Instellingen", subtitle: "Uw account, rollen en sessie" }}
    >
      <div className="grid gap-4 xl:grid-cols-3">
        <WidgetCard
          icon={<UserIcon size={18} />}
          tone="info"
          title="Account"
          subtitle="Wat het systeem van u weet"
        >
          <WidgetRow label="Personeelsnummer" value={actor.employeeNumber} />
          <WidgetRow label="Standplaats" value={actor.depot} />
          <WidgetRow
            label="Rollen"
            value={actor.roles.map((role) => ROLE_LABELS[role]).join(", ")}
          />
          <WidgetRow
            label="Authenticatieniveau"
            value={actor.authLevel}
            valueTone={actor.authLevel === "MFA" ? "ok" : "warn"}
          />
        </WidgetCard>

        <WidgetCard
          icon={<LockIcon size={18} />}
          tone="neutral"
          title="Sessie"
          subtitle="Beleid dat nu geldt"
        >
          <WidgetRow
            label="Inactiviteit"
            value={`${SESSION_POLICY.idleTimeoutMinutes} minuten`}
          />
          <WidgetRow
            label="Absolute duur"
            value={`${SESSION_POLICY.absoluteTimeoutHours} uur`}
          />
          <WidgetRow label="Cookie" value="httpOnly, SameSite=Lax" />
        </WidgetCard>

        <WidgetCard
          icon={<SettingsIcon size={18} />}
          tone="rc"
          title="Uw rechten"
          subtitle={`${permissions.length} rechten uit ${actor.roles.length} rol(len)`}
          bodyClassName="scroll-slim max-h-72 overflow-y-auto border-t border-line p-4"
        >
          <div className="flex flex-wrap gap-1.5">
            {permissions.map((permission) => (
              <Badge key={permission} tone="neutral">
                {permission}
              </Badge>
            ))}
          </div>
        </WidgetCard>
      </div>

      <div className="mt-4">
        <Alert tone="neutral" title="Wachtwoord en tweefactorauthenticatie">
          Deze omgeving draait op lokale testaccounts. Wachtwoordbeheer en MFA lopen straks via NS
          SSO en worden daar ingesteld, niet hier.
        </Alert>
      </div>
    </SharedShell>
  );
}
