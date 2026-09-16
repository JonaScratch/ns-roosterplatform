import "server-only";
import { prisma } from "@/server/data/prisma";
import { parseProtections } from "@/server/validation/protections";
import type { CandidateDataPort, ValidatorDuty, ValidatorRoster } from "./final-validator";

/**
 * De brongegevens voor de eindvalidatie, uit de database.
 *
 * ## Waarom dit een eigen bestand is
 *
 * De validator zelf bevat geen enkele databaseverbinding. Dat is niet netjesheid
 * maar toetsbaarheid: een kandidaat met acht diensten op rij hoort te worden
 * afgewezen, en dat moet aantoonbaar zijn zonder dat er een Postgres draait. De
 * poort staat hier, de redenering staat daar.
 *
 * ## Waarom de gegevens opnieuw worden opgehaald
 *
 * De kandidaat draagt zijn eigen toewijzingen mee, maar niets over medewerkers,
 * diensten of contracturen. Die haalt de validator zelf op, uit dezelfde tabellen
 * waaruit de rest van de applicatie leest. Zou hij de invoer van de optimizer
 * hergebruiken, dan zou een fout in die invoer twee keer hetzelfde antwoord
 * geven — en dan is de tweede toetsing geen toetsing meer.
 */
export const prismaCandidateData: CandidateDataPort = {
  async rosters(codes: readonly string[]): Promise<readonly ValidatorRoster[]> {
    const rows = await prisma.baseRoster.findMany({
      where: { code: { in: [...codes] } },
      select: {
        code: true,
        cycleWeeks: true,
        lines: {
          orderBy: { lineNumber: "asc" },
          select: {
            lineNumber: true,
            assignments: {
              where: { validUntil: null },
              orderBy: { validFrom: "desc" },
              take: 1,
              select: {
                employee: {
                  select: {
                    id: true,
                    employeeNumber: true,
                    rosterProfile: true,
                    depot: true,
                    qualifications: true,
                    employeeGroup: true,
                    company: true,
                    contractHours: true,
                    earlyStartProtectionWaived: true,
                    protections: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    return rows.map((roster) => ({
      code: roster.code,
      cycleWeeks: roster.cycleWeeks,
      lines: roster.lines.map((line) => {
        const employee = line.assignments[0]?.employee;
        return {
          lineNumber: line.lineNumber,
          occupant: employee
            ? {
                id: employee.id,
                employeeNumber: employee.employeeNumber,
                employeeGroup: employee.employeeGroup,
                company: employee.company,
                depot: employee.depot,
                rosterProfile: employee.rosterProfile,
                qualifications: [...employee.qualifications],
                contractHours: employee.contractHours ? Number(employee.contractHours) : null,
                earlyStartProtectionWaived: employee.earlyStartProtectionWaived,
                protections: parseProtections(employee.protections, employee.employeeNumber),
              }
            : null,
        };
      }),
    }));
  },

  async duties(codes: readonly string[]): Promise<readonly ValidatorDuty[]> {
    const rows = await prisma.duty.findMany({
      where: { code: { in: [...codes] } },
      select: {
        id: true,
        code: true,
        kinds: true,
        weekday: true,
        depot: true,
        requiredQualifications: true,
        weight: true,
        startMinute: true,
        endMinute: true,
        breakMinutes: true,
        overtimeMinutes: true,
      },
    });

    return rows.map((duty) => ({
      id: duty.id,
      code: duty.code,
      weekday: duty.weekday,
      kinds: duty.kinds,
      depot: duty.depot,
      requiredQualifications: [...duty.requiredQualifications],
      weight: duty.weight,
      startMinute: duty.startMinute,
      endMinute: duty.endMinute,
      breakMinutes: duty.breakMinutes,
      overtimeMinutes: duty.overtimeMinutes,
    }));
  },
};
