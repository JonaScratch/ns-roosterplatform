import "server-only";
import type { Actor } from "@/server/auth/session";
import { prisma } from "@/server/data/prisma";
import { actorEmployeeNumber } from "./config";

/**
 * Het technische account waarmee de Demo Room draait.
 *
 * ## Waarom dit geen ingebouwd account is
 *
 * De Demo Room verzint geen acteur en maakt er ook geen aan: het account moet
 * al bestaan (via de gewone seed of beheerscherm), moet actief zijn, en al zijn
 * eigen rollen en dus eigen rechten hebben — precies zoals elk ander gebruik van
 * de agent. Zo staat elke handeling van de Demo Room op naam in hetzelfde
 * auditlogboek als een handeling van een commissielid.
 *
 * `AGENT_EXPERIMENT_RUN` is admin-only (zie `permissions.ts`), dus voor de
 * onderzoekstrack (spoor B) moet dit een ADMIN-account zijn. Voor spoor A
 * (chatbot-uitproberen) volstaat een account met AGENT_CHAT.
 */
export async function demoRoomActor(): Promise<Actor | null> {
  const nummer = actorEmployeeNumber();
  if (!nummer) return null;
  const account = await prisma.userAccount.findFirst({
    where: { status: "ACTIVE", employee: { employeeNumber: nummer } },
    select: {
      id: true,
      employeeId: true,
      roles: true,
      employee: { select: { employeeNumber: true, depot: true } },
    },
  });
  if (!account) return null;
  return {
    sessionId: "demo-room",
    userId: account.id,
    employeeId: account.employeeId,
    employeeNumber: account.employee?.employeeNumber ?? nummer,
    roles: account.roles,
    authLevel: "PASSWORD",
    depot: account.employee?.depot ?? "DDR",
  };
}
