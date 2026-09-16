import "server-only";
import { type CalendarDate, addDays, toCalendarDate } from "@/domain/time";
import { recordAudit } from "@/server/audit/log";
import type { Actor } from "@/server/auth/session";
import { assertOwnEmployeeOrPermission, requirePermission } from "@/server/security/authorize";
import { PERMISSIONS } from "@/server/security/permissions";
import {
  type ScheduleDayView,
  scheduleForEmployee,
} from "@/server/data/repositories/schedule-repository";

/**
 * Het rooster opvragen.
 *
 * Elke ingang loopt langs een rechtencontrole vóór de query, niet erna. Er is
 * geen functie in dit bestand die een `employeeId` accepteert zonder eerst vast
 * te stellen dat de aanroeper die medewerker mag zien.
 */

export interface ScheduleRange {
  readonly from: CalendarDate;
  readonly to: CalendarDate;
  readonly days: readonly ScheduleDayView[];
}

/** Het eigen rooster. Het enige dat een medewerker langs deze weg kan krijgen. */
export async function ownSchedule(from: CalendarDate, to: CalendarDate): Promise<ScheduleRange> {
  const actor = await requirePermission(PERMISSIONS.SCHEDULE_READ_OWN);
  const days = await scheduleForEmployee(actor.employeeId, from, to);
  return { from, to, days };
}

/**
 * Het rooster van een willekeurige medewerker.
 *
 * De aanroeper geeft een `employeeId` mee; dat is precies de parameter waarmee
 * iemand zou proberen andermans gegevens te lezen. `assertOwnEmployeeOrPermission`
 * laat dat alleen toe voor wie het eigen rooster opvraagt of het recht
 * `schedule:read:any` heeft. De inzage van een ander wordt gelogd.
 */
export async function scheduleOf(
  employeeId: string,
  from: CalendarDate,
  to: CalendarDate,
): Promise<ScheduleRange> {
  const actor = await requirePermission(PERMISSIONS.SCHEDULE_READ_OWN);
  await assertOwnEmployeeOrPermission(actor, employeeId, PERMISSIONS.SCHEDULE_READ_ANY);

  if (employeeId !== actor.employeeId) {
    await recordAudit({
      actor,
      action: "rooster.ingezien",
      objectType: "Employee",
      objectId: employeeId,
      newValue: { van: from, tot: to },
    });
  }

  const days = await scheduleForEmployee(employeeId, from, to);
  return { from, to, days };
}

/** Handige standaardperiode: van vandaag tot vier weken vooruit. */
export function defaultRange(reference: Date = new Date()): {
  from: CalendarDate;
  to: CalendarDate;
} {
  const today = toCalendarDate(reference);
  return { from: addDays(today, -7), to: addDays(today, 28) };
}

/** Wie is de ingelogde gebruiker? Voor schermen die dat willen tonen. */
export function actorSummary(actor: Actor): {
  employeeNumber: string;
  roles: readonly string[];
  depot: string;
} {
  return { employeeNumber: actor.employeeNumber, roles: actor.roles, depot: actor.depot };
}
