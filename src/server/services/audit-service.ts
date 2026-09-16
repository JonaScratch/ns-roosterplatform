import "server-only";
import type { AuditResult, Role, SecurityEventKind } from "@/lib/generated/prisma/enums";
import { requirePermission } from "@/server/security/authorize";
import { PERMISSIONS } from "@/server/security/permissions";
import { prisma } from "@/server/data/prisma";

/**
 * Het auditlog en de beveiligingsgebeurtenissen uitlezen.
 *
 * ## Alleen lezen
 *
 * Er is geen functie om een auditregel te wijzigen of te verwijderen, en dat is
 * geen omissie. Een logboek dat de gelogde partij kan aanpassen, is geen
 * logboek. Opschonen na de bewaartermijn hoort een taak buiten de applicatie te
 * zijn, met eigen rechten.
 *
 * ## Wat de lezer ziet
 *
 * Personeelsnummers, geen namen. Wie wil weten wie `100234` is, moet dat via de
 * identiteitsrepository doen — en die inzage komt dan zelf weer in het log.
 */

export interface AuditEntryView {
  readonly id: string;
  readonly occurredAt: Date;
  readonly actorEmployeeNumber: string | null;
  readonly actorRoles: readonly Role[];
  readonly action: string;
  readonly objectType: string;
  readonly objectId: string | null;
  readonly result: AuditResult;
  readonly reason: string | null;
  readonly oldValue: unknown;
  readonly newValue: unknown;
}

export async function recentAuditEntries(options: {
  readonly limit?: number;
  readonly action?: string;
  readonly employeeNumber?: string;
} = {}): Promise<readonly AuditEntryView[]> {
  await requirePermission(PERMISSIONS.AUDIT_READ);

  const rows = await prisma.auditLogEntry.findMany({
    where: {
      // `contains` en niet `equals`, zodat "ruil" alle ruilhandelingen vindt.
      // De invoer wordt door Prisma geparametriseerd; er wordt nergens een
      // query samengesteld uit tekst.
      action: options.action ? { contains: options.action } : undefined,
      actorEmployeeNumber: options.employeeNumber || undefined,
    },
    orderBy: { occurredAt: "desc" },
    take: Math.min(options.limit ?? 100, 500),
    select: {
      id: true,
      occurredAt: true,
      actorEmployeeNumber: true,
      actorRoles: true,
      action: true,
      objectType: true,
      objectId: true,
      result: true,
      reason: true,
      oldValue: true,
      newValue: true,
    },
  });

  return rows;
}

export interface SecurityEventView {
  readonly id: string;
  readonly occurredAt: Date;
  readonly kind: SecurityEventKind;
  readonly subject: string | null;
  readonly detail: unknown;
}

export async function recentSecurityEvents(limit = 100): Promise<readonly SecurityEventView[]> {
  await requirePermission(PERMISSIONS.SECURITY_EVENT_READ);
  return prisma.securityEvent.findMany({
    orderBy: { occurredAt: "desc" },
    take: Math.min(limit, 500),
    select: { id: true, occurredAt: true, kind: true, subject: true, detail: true },
  });
}

export interface SecuritySummary {
  readonly failedLoginsLastDay: number;
  readonly deniedAuthorizationsLastDay: number;
  readonly activeSessions: number;
  readonly lockedAccounts: number;
}

/** Een korte stand van zaken voor het toezichtsdashboard. */
export async function securitySummary(): Promise<SecuritySummary> {
  await requirePermission(PERMISSIONS.SECURITY_EVENT_READ);
  const since = new Date(Date.now() - 24 * 3_600_000);
  const now = new Date();

  const [failedLogins, denied, activeSessions, lockedAccounts] = await Promise.all([
    prisma.securityEvent.count({ where: { kind: "LOGIN_FAILED", occurredAt: { gte: since } } }),
    prisma.securityEvent.count({
      where: { kind: "AUTHORIZATION_DENIED", occurredAt: { gte: since } },
    }),
    prisma.session.count({
      where: { revokedAt: null, expiresAt: { gt: now }, absoluteExpiry: { gt: now } },
    }),
    prisma.userAccount.count({ where: { status: "LOCKED" } }),
  ]);

  return {
    failedLoginsLastDay: failedLogins,
    deniedAuthorizationsLastDay: denied,
    activeSessions,
    lockedAccounts,
  };
}
