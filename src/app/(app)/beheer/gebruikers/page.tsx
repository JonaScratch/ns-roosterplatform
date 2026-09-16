import { Role } from "@/lib/generated/prisma/enums";
import { ALL_ROLES, ROLE_LABELS, permissionsForRole } from "@/server/security/permissions";
import { roleCounts, searchUsers } from "@/server/services/role-service";
import { AdminShell } from "@/components/layout/area-shell";
import { ActionForm } from "@/components/ui/action-form";
import {
  Alert,
  Badge,
  EmptyState,
  StatCard,
  WidgetCard,
  inputClass,
} from "@/components/ui/primitives";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";
import { SearchIcon, ShieldIcon, UsersIcon } from "@/components/ui/icons";
import { rollenAction } from "../acties";

export const dynamic = "force-dynamic";

const ROLE_TONES: Record<Role, "neutral" | "rc" | "did" | "error"> = {
  EMPLOYEE: "neutral",
  ROSTER_COMMITTEE: "rc",
  DUTY_ASSIGNMENT: "did",
  ADMIN: "error",
};

/**
 * Gebruikers- en rollenbeheer.
 *
 * Zoeken gaat op personeelsnummer, niet op naam: dit is een rollenbeheerscherm
 * en geen personeelsregister. Er wordt op deze pagina dan ook geen enkel
 * persoonsgegeven geladen.
 *
 * De vinkjes beschrijven de gewenste eindtoestand; de server vervangt de hele
 * verzameling in één opdracht. Dat kan niet halverwege blijven steken, en het
 * levert één auditregel op met de oude én de nieuwe rollen.
 */
export default async function Gebruikersbeheer({
  searchParams,
}: PageProps<"/beheer/gebruikers">) {
  const params = await searchParams;
  const query = typeof params.zoek === "string" ? params.zoek : "";
  const roleFilter =
    typeof params.rol === "string" && ALL_ROLES.includes(params.rol as Role)
      ? (params.rol as Role)
      : undefined;

  const [counts, users] = await Promise.all([
    roleCounts(),
    searchUsers({ query, role: roleFilter, limit: 25 }),
  ]);

  return (
    <AdminShell
      activeHref="/beheer/gebruikers"
      header={{
        title: "Gebruikers & rollen",
        subtitle: "Rollen toekennen en intrekken — elke wijziging wordt vastgelegd",
      }}
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {counts.map((entry) => (
          <StatCard
            key={entry.role}
            icon={entry.role === Role.ADMIN ? <ShieldIcon size={20} /> : <UsersIcon size={20} />}
            tone={entry.role === Role.ADMIN ? "error" : entry.role === Role.EMPLOYEE ? "info" : entry.role === Role.ROSTER_COMMITTEE ? "rc" : "did"}
            label={entry.label}
            value={entry.count.toLocaleString("nl-NL")}
            hint="accounts met deze rol"
            href={`/beheer/gebruikers?rol=${entry.role}`}
            linkLabel="Filter op deze rol"
          />
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <WidgetCard
            icon={<UsersIcon size={18} />}
            tone="info"
            title="Medewerkers"
            subtitle="Zoek op volledig of gedeeltelijk personeelsnummer"
            actions={
              <form className="flex items-end gap-2">
                {roleFilter && <input type="hidden" name="rol" value={roleFilter} />}
                <label className="relative">
                  <span className="sr-only">Personeelsnummer</span>
                  <SearchIcon
                    size={15}
                    className="pointer-events-none absolute left-2.5 top-2 text-ink-faint"
                  />
                  <input
                    name="zoek"
                    defaultValue={query}
                    placeholder="personeelsnummer"
                    className={`${inputClass} w-44 pl-8`}
                  />
                </label>
                <button
                  type="submit"
                  className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-[12.5px] font-semibold hover:bg-canvas"
                >
                  Zoeken
                </button>
              </form>
            }
          >
            {users.length === 0 ? (
              <div className="py-3">
                <EmptyState>
                  Geen medewerkers gevonden. Zoek op personeelsnummer of wis het filter.
                </EmptyState>
              </div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Personeelsnr.</TH>
                    <TH>Standplaats</TH>
                    <TH>Status</TH>
                    <TH>Rollen</TH>
                    <TH>Wijzigen</TH>
                  </TR>
                </THead>
                <tbody>
                  {users.map((user) => (
                    <TR key={user.userId}>
                      <TD>
                        <span className="tabular font-semibold text-ink-strong">
                          {user.employeeNumber}
                        </span>
                      </TD>
                      <TD>{user.depot}</TD>
                      <TD>
                        <Badge tone={user.status === "ACTIVE" ? "ok" : "error"}>
                          {user.status === "ACTIVE" ? "Actief" : user.status.toLowerCase()}
                        </Badge>
                      </TD>
                      <TD>
                        <span className="flex flex-wrap gap-1">
                          {user.roles.map((role) => (
                            <Badge key={role} tone={ROLE_TONES[role]}>
                              {ROLE_LABELS[role]}
                            </Badge>
                          ))}
                        </span>
                      </TD>
                      <TD>
                        <ActionForm action={rollenAction} submitLabel="Opslaan" compact>
                          <input type="hidden" name="userId" value={user.userId} />
                          <div className="mb-1.5 space-y-1">
                            {ALL_ROLES.map((role) => (
                              <label
                                key={role}
                                className="flex items-center gap-1.5 whitespace-nowrap text-[11.5px]"
                              >
                                <input
                                  type="checkbox"
                                  name="roles"
                                  value={role}
                                  defaultChecked={user.roles.includes(role)}
                                  disabled={role === Role.EMPLOYEE}
                                />
                                <span
                                  className={role === Role.EMPLOYEE ? "text-ink-faint" : "text-ink"}
                                >
                                  {ROLE_LABELS[role]}
                                </span>
                              </label>
                            ))}
                          </div>
                        </ActionForm>
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            )}
          </WidgetCard>
        </div>

        <div className="space-y-4">
          <Alert tone="info" title="Hoe rolwijzigingen worden afgedwongen">
            De vinkjes sturen een voorstel; de server beslist. Elke wijziging wordt
            server-side geautoriseerd op het recht <code>role:manage</code>, vastgelegd met de
            oude én nieuwe rollen, en gemeld als beveiligingsgebeurtenis. Wie rechten verliest,
            wordt uitgelogd zodat de wijziging meteen zichtbaar is.
          </Alert>

          <Alert tone="warn" title="De laatste beheerder blijft staan">
            De rol Admin kan niet worden ingetrokken en het account kan niet worden geblokkeerd
            wanneer er daarna geen actieve beheerder meer over is. De poging wordt geweigerd én
            vastgelegd.
          </Alert>

          <Alert tone="neutral" title="Medewerker is de basisrol">
            Iedere gebruiker is eerst medewerker; die rol is niet uit te vinken. Een planner heeft
            immers ook een eigen rooster.
          </Alert>

          <WidgetCard title="Wat elke rol mag" subtitle="Uit de rechtentabel, niet uit een tekst">
            {ALL_ROLES.map((role) => (
              <div key={role} className="border-b border-line/70 py-2.5 last:border-0">
                <p className="flex items-center gap-2 text-[12.5px] font-semibold text-ink">
                  <Badge tone={ROLE_TONES[role]}>{ROLE_LABELS[role]}</Badge>
                  <span className="tabular text-[11.5px] font-normal text-ink-muted">
                    {permissionsForRole(role).length} rechten
                  </span>
                </p>
              </div>
            ))}
          </WidgetCard>
        </div>
      </div>
    </AdminShell>
  );
}
