import "server-only";
import { AccountStatus, Role, SecurityEventKind } from "@/lib/generated/prisma/enums";
import { recordAudit, recordSecurityEvent } from "@/server/audit/log";
import { requirePermission } from "@/server/security/authorize";
import { ALL_ROLES, PERMISSIONS, ROLE_LABELS } from "@/server/security/permissions";
import { revokeAllSessions } from "@/server/auth/session";
import { prisma } from "@/server/data/prisma";

/**
 * Gebruikers- en rollenbeheer.
 *
 * De enige plek waar rollen veranderen. Drie eigenschappen die daarbij horen en
 * die nergens omzeild kunnen worden:
 *
 *  1. **Server-side geautoriseerd.** Elke functie hier begint met
 *     `requirePermission(role:manage)`. De frontend stuurt een voorstel; deze
 *     laag beslist.
 *  2. **Altijd auditbaar.** Elke wijziging schrijft de oude én de nieuwe
 *     rollenverzameling weg. Een rolwijziging zonder spoor bestaat niet.
 *  3. **De laatste beheerder blijft staan.** Zie `LastAdminError`.
 *
 * ## Waarom sessies worden ingetrokken bij het afnemen van een rol
 *
 * Rechten worden per verzoek uit de sessie gelezen, en de sessie leest de
 * rollen uit de database — dus een ingetrokken rol werkt meteen. Toch worden de
 * sessies van de betrokken gebruiker beëindigd wanneer er rechten wegvallen:
 * dan is er geen halfvolle interface waarin de helft van de knoppen opeens
 * foutmeldingen geeft, en is in het log te zien dat de wijziging is
 * doorgewerkt.
 */

/** De beheerder zou zichzelf of de organisatie buitensluiten. */
export class LastAdminError extends Error {
  constructor() {
    super(
      "Dit is de laatste actieve beheerder. Ken eerst iemand anders de rol Admin toe " +
        "voordat u deze intrekt.",
    );
    this.name = "LastAdminError";
  }
}

export interface RoleCount {
  readonly role: Role;
  readonly label: string;
  readonly count: number;
}

/**
 * Het aantal accounts per rol.
 *
 * Telt per rol en niet per account: een gebruiker met twee rollen telt in beide
 * mee. Dat is wat een beheerder wil weten — "hoeveel mensen kunnen bij de
 * Dienstindeling" — en niet hoe de accounts verdeeld zijn.
 */
export async function roleCounts(): Promise<readonly RoleCount[]> {
  await requirePermission(PERMISSIONS.ROLE_MANAGE);

  const accounts = await prisma.userAccount.findMany({
    where: { status: { not: AccountStatus.DISABLED } },
    select: { roles: true },
  });

  return ALL_ROLES.map((role) => ({
    role,
    label: ROLE_LABELS[role],
    count: accounts.filter((account) => account.roles.includes(role)).length,
  }));
}

export interface ManagedUserView {
  readonly userId: string;
  readonly employeeId: string;
  readonly employeeNumber: string;
  readonly depot: string;
  readonly status: AccountStatus;
  readonly roles: readonly Role[];
  readonly lastLoginAt: Date | null;
}

/**
 * Medewerkers zoeken om hun rollen te beheren.
 *
 * Zoeken kan op personeelsnummer, niet op naam. Dat is geen beperking uit
 * gemakzucht: een beheerscherm waarin je op naamfragmenten door het
 * personeelsbestand kunt bladeren, is een personeelsregister, en dat is iets
 * anders dan een rollenbeheerscherm. Namen worden hier dan ook niet opgehaald.
 */
export async function searchUsers(options: {
  readonly query?: string;
  readonly role?: Role;
  readonly limit?: number;
} = {}): Promise<readonly ManagedUserView[]> {
  await requirePermission(PERMISSIONS.ROLE_MANAGE);

  const query = options.query?.trim();
  const accounts = await prisma.userAccount.findMany({
    where: {
      roles: options.role ? { has: options.role } : undefined,
      employee: query
        ? { employeeNumber: { contains: query, mode: "insensitive" } }
        : undefined,
    },
    orderBy: { employee: { employeeNumber: "asc" } },
    take: Math.min(options.limit ?? 25, 100),
    select: {
      id: true,
      roles: true,
      status: true,
      lastLoginAt: true,
      employee: { select: { id: true, employeeNumber: true, depot: true } },
    },
  });

  return accounts.map((account) => ({
    userId: account.id,
    employeeId: account.employee.id,
    employeeNumber: account.employee.employeeNumber,
    depot: account.employee.depot,
    status: account.status,
    roles: account.roles,
    lastLoginAt: account.lastLoginAt,
  }));
}

/**
 * De rollen van één account vervangen.
 *
 * Vervangen en niet toevoegen/verwijderen per rol: het scherm toont de volledige
 * verzameling met vinkjes, en één opdracht die de eindtoestand beschrijft kan
 * niet halverwege een inconsistente tussenstand opleveren.
 */
export async function setRoles(options: {
  readonly userId: string;
  readonly roles: readonly Role[];
}): Promise<{ readonly ok: boolean; readonly reason?: string }> {
  const actor = await requirePermission(PERMISSIONS.ROLE_MANAGE);

  // De medewerkersrol is de basis en wordt altijd behouden: iedereen in dit
  // platform is eerst medewerker. Zonder deze regel kan een beheerder iemand
  // zijn eigen rooster afnemen door hem planner te maken.
  const requested = new Set<Role>([Role.EMPLOYEE, ...options.roles]);
  const unknown = [...requested].filter((role) => !ALL_ROLES.includes(role));
  if (unknown.length > 0) {
    return { ok: false, reason: `Onbekende rol: ${unknown.join(", ")}.` };
  }
  const nextRoles = ALL_ROLES.filter((role) => requested.has(role));

  const target = await prisma.userAccount.findUnique({
    where: { id: options.userId },
    select: {
      id: true,
      roles: true,
      status: true,
      employee: { select: { employeeNumber: true } },
    },
  });
  if (!target) {
    return { ok: false, reason: "Onbekend account." };
  }

  const losesAdmin = target.roles.includes(Role.ADMIN) && !nextRoles.includes(Role.ADMIN);
  if (losesAdmin && !(await anotherActiveAdminExists(target.id))) {
    await recordAudit({
      actor,
      action: "rollen.wijziging-geweigerd",
      objectType: "UserAccount",
      objectId: target.id,
      result: "DENIED",
      reason: "laatste actieve beheerder",
      newValue: { personeelsnummer: target.employee.employeeNumber, gevraagd: nextRoles },
    });
    throw new LastAdminError();
  }

  if (sameRoles(target.roles, nextRoles)) {
    return { ok: true };
  }

  await prisma.userAccount.update({
    where: { id: target.id },
    data: { roles: nextRoles },
  });

  const removed = target.roles.filter((role) => !nextRoles.includes(role));
  if (removed.length > 0) {
    await revokeAllSessions(target.id, "rollen gewijzigd");
  }

  await recordAudit({
    actor,
    action: "rollen.gewijzigd",
    objectType: "UserAccount",
    objectId: target.id,
    oldValue: { rollen: target.roles },
    newValue: {
      personeelsnummer: target.employee.employeeNumber,
      rollen: nextRoles,
      toegekend: nextRoles.filter((role) => !target.roles.includes(role)),
      ingetrokken: removed,
    },
    reason: options.userId === actor.userId ? "eigen account" : undefined,
  });

  // Rolwijzigingen zijn ook een beveiligingsgebeurtenis: het toezicht wil ze
  // zien zonder eerst het functionele auditlog te hoeven doorzoeken.
  await recordSecurityEvent({
    kind: SecurityEventKind.ROLE_CHANGED,
    userId: target.id,
    subject: target.employee.employeeNumber,
    detail: { gebeurtenis: "rollen gewijzigd", door: actor.employeeNumber, rollen: nextRoles },
  });

  return { ok: true };
}

/** Bestaat er nog een ándere actieve beheerder dan dit account? */
async function anotherActiveAdminExists(excludeUserId: string): Promise<boolean> {
  const count = await prisma.userAccount.count({
    where: {
      id: { not: excludeUserId },
      roles: { has: Role.ADMIN },
      status: AccountStatus.ACTIVE,
    },
  });
  return count > 0;
}

function sameRoles(a: readonly Role[], b: readonly Role[]): boolean {
  return a.length === b.length && a.every((role) => b.includes(role));
}

/**
 * Een account blokkeren of vrijgeven.
 *
 * Dezelfde bescherming als bij rollen: de laatste actieve beheerder kan niet
 * worden geblokkeerd, want dan is er niemand meer die het ongedaan kan maken.
 */
export async function setAccountStatus(options: {
  readonly userId: string;
  readonly status: AccountStatus;
}): Promise<{ readonly ok: boolean; readonly reason?: string }> {
  const actor = await requirePermission(PERMISSIONS.ACCOUNT_MANAGE);

  const target = await prisma.userAccount.findUnique({
    where: { id: options.userId },
    select: { id: true, roles: true, status: true, employee: { select: { employeeNumber: true } } },
  });
  if (!target) {
    return { ok: false, reason: "Onbekend account." };
  }

  const losesAccess = options.status !== AccountStatus.ACTIVE;
  if (losesAccess && target.roles.includes(Role.ADMIN) && !(await anotherActiveAdminExists(target.id))) {
    throw new LastAdminError();
  }

  await prisma.userAccount.update({ where: { id: target.id }, data: { status: options.status } });
  if (losesAccess) {
    await revokeAllSessions(target.id, `account ${options.status.toLowerCase()}`);
  }

  await recordSecurityEvent({
    kind: SecurityEventKind.ACCOUNT_STATUS_CHANGED,
    userId: target.id,
    subject: target.employee.employeeNumber,
    detail: { van: target.status, naar: options.status, door: actor.employeeNumber },
  });

  await recordAudit({
    actor,
    action: "account.status-gewijzigd",
    objectType: "UserAccount",
    objectId: target.id,
    oldValue: { status: target.status },
    newValue: { status: options.status, personeelsnummer: target.employee.employeeNumber },
  });

  return { ok: true };
}
