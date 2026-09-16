import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { toCalendarDate } from "@/domain/time";
import type { BaselineSlot } from "@/domain/roster-structure";
import { evaluateAssignment } from "@/server/rules-engine/assignment";
import { evaluateStructuralChange } from "@/server/rules-engine/structure-change";
import type { AssignmentRequest } from "@/server/rules-engine/validation/subject";
import {
  baselineOf,
  createPeriodCore,
  sealBaselineCore,
} from "@/server/services/roster-period-service";
import {
  fillOperationallyIn,
  withdrawOperationallyIn,
} from "@/server/services/operational-assignment-service";

/**
 * De structuurvergrendeling, gedraaid tegen de echte gegevens.
 *
 * ## Waarom dit naast de unittests staat
 *
 * `tests/rules/structuur.test.ts` bewijst dat de regel doet wat hij belooft op
 * verzonnen invoer. Dat is iets anders dan bewijzen dat hij op het rooster van
 * Dordrecht ook werkelijk ergens aan komt. Twee dingen kunnen daar stil
 * misgaan: de baseline kan leeg blijken (dan vindt de toets geen enkel anker en
 * slaagt alles), en de operationele laag kan bestaan zonder dat iemand hem
 * aanroept (dan wordt de reservedag alsnog overschreven).
 *
 * Dit script legt daarom een echte baseline vast, vuurt de regel af op echte
 * ankerdagen, en vult en trekt een echte reservedag in.
 *
 * Draaien met: npm run verify:structuur
 */

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const STANDPLAATS = "DDR";
const PROEF_DIENSTREGELING = "VERIFY";

let geslaagd = 0;
let mislukt = 0;

function toets(naam: string, voorwaarde: boolean, toelichting: string): void {
  if (voorwaarde) {
    geslaagd += 1;
    console.log(`  ✓ ${naam}`);
  } else {
    mislukt += 1;
    console.log(`  ✗ ${naam} — ${toelichting}`);
  }
}

/** Een plaatsingsverzoek dat alleen bedoeld is om de structuurtoets te raken. */
function verzoek(
  overrides: Partial<AssignmentRequest> & Pick<AssignmentRequest, "subject" | "candidate" | "date">,
): AssignmentRequest {
  const datum = overrides.date;
  return {
    planningStage: "BASE_ROSTER",
    reason: "BASE_ROSTER_GENERATION",
    exceptions: [],
    timeline: {
      days: [
        {
          date: datum,
          positionType: "DUTY",
          duty: {
            dutyId: overrides.candidate.dutyId,
            code: overrides.candidate.code,
            shape: overrides.candidate.shape,
          },
          replacedPosition: null,
        },
      ],
      coverage: { from: datum, to: datum },
    },
    ...overrides,
  };
}

async function main(): Promise<void> {
  const location = await prisma.stationLocation.findUnique({ where: { code: STANDPLAATS } });
  if (!location) {
    throw new Error(`Standplaats ${STANDPLAATS} bestaat niet. Draai eerst npm run sync:locations.`);
  }

  // ── 1. Een periode met een vastgelegde structuur ──────────────────────────
  console.log("\n1. Structuur vastleggen");
  const periode = await createPeriodCore(
    prisma,
    {
      locationCode: STANDPLAATS,
      timetableId: PROEF_DIENSTREGELING,
      year: 2027,
      changeType: "NEW_TIMETABLE",
      validFrom: new Date("2026-12-13T00:00:00.000Z"),
    },
    null,
  );

  try {
    const seal = await sealBaselineCore(prisma, periode.id, null);
    console.log(
      `  ${seal.slots} slots vastgelegd uit ${seal.rosters.length} roosters ` +
        `(${seal.rosters.join(", ")}), waarvan ${seal.anchors} structurele ankers.`,
    );
    toets("de baseline is niet leeg", seal.slots > 0, "zonder slots toetst de regel niets");
    toets(
      "er zitten ankers in",
      seal.anchors > 0,
      "een baseline zonder ankers laat elke wijziging door",
    );

    let herhaald = false;
    try {
      await sealBaselineCore(prisma, periode.id, null);
    } catch {
      herhaald = true;
    }
    toets(
      "een tweede vastlegging wordt geweigerd",
      herhaald,
      "een baseline die opnieuw kan worden geschreven, is geen baseline",
    );

    const slots = await baselineOf(periode.id, prisma);
    const ankers = slots.filter((slot) => slot.structuralAnchor);
    const dienstdagen = slots.filter((slot) => !slot.structuralAnchor);

    // ── 2. De regel op echte ankerdagen ─────────────────────────────────────
    console.log("\n2. Wijzigingsblad tegen de vastgelegde structuur");
    const medewerker = await prisma.employee.findFirst({
      where: { depot: STANDPLAATS },
      select: {
        id: true,
        employeeNumber: true,
        employeeGroup: true,
        company: true,
        depot: true,
        rosterProfile: true,
        contractHours: true,
      },
    });
    const dienst = await prisma.duty.findFirst({
      where: { depot: STANDPLAATS },
      select: {
        id: true,
        code: true,
        kinds: true,
        depot: true,
        requiredQualifications: true,
        weight: true,
        startMinute: true,
        endMinute: true,
        breakMinutes: true,
        overtimeMinutes: true,
      },
    });
    if (!medewerker || !dienst) {
      throw new Error("Geen medewerker of dienst gevonden voor deze standplaats.");
    }

    const subject: AssignmentRequest["subject"] = {
      employeeId: medewerker.id,
      employeeNumber: medewerker.employeeNumber,
      employeeGroup: medewerker.employeeGroup,
      company: medewerker.company as AssignmentRequest["subject"]["company"],
      depot: medewerker.depot,
      rosterProfile: medewerker.rosterProfile,
      qualifications: [],
      // Prisma levert een Decimal; de engine rekent met getallen.
      contractHours:
        medewerker.contractHours === null ? null : Number(medewerker.contractHours),
      earlyStartProtectionWaived: false,
      protections: [],
    };
    const candidate: AssignmentRequest["candidate"] = {
      dutyId: dienst.id,
      code: dienst.code,
      kinds: dienst.kinds,
      depot: dienst.depot,
      requiredQualifications: dienst.requiredQualifications,
      weight: dienst.weight,
      shape: {
        startMinute: dienst.startMinute,
        endMinute: dienst.endMinute,
        breakMinutes: dienst.breakMinutes,
        overtimeMinutes: dienst.overtimeMinutes,
      },
    };

    const steekproef = ankers.slice(0, 25);
    const geblokkeerd = steekproef.filter((slot) => {
      const uitkomst = evaluateAssignment(
        verzoek({
          subject,
          candidate,
          date: "2027-01-13",
          changeType: "AMENDMENT",
          baselineSlot: slot,
        }),
      );
      return uitkomst.hardViolations.some((v) => v.ruleId === "ROSTER_ANCHOR_LOCKED");
    });
    toets(
      `alle ${steekproef.length} bekeken ankerdagen blokkeren een dienst`,
      geblokkeerd.length === steekproef.length,
      `${steekproef.length - geblokkeerd.length} ankerdagen lieten een dienst toe`,
    );

    const dienstSteekproef = dienstdagen.slice(0, 25);
    const dienstGeblokkeerd = dienstSteekproef.filter((slot) => {
      const uitkomst = evaluateAssignment(
        verzoek({
          subject,
          candidate,
          date: "2027-01-13",
          changeType: "AMENDMENT",
          baselineSlot: slot,
        }),
      );
      return uitkomst.hardViolations.some((v) => v.ruleId === "ROSTER_ANCHOR_LOCKED");
    });
    toets(
      `alle ${dienstSteekproef.length} bekeken dienstdagen laten een ander dienstnummer toe`,
      dienstGeblokkeerd.length === 0,
      `${dienstGeblokkeerd.length} dienstdagen werden onterecht geblokkeerd`,
    );

    const nieuweRonde = ankers.slice(0, 5).every((slot) => {
      const uitkomst = evaluateAssignment(
        verzoek({ subject, candidate, date: "2027-01-13", changeType: "NEW_TIMETABLE", baselineSlot: slot }),
      );
      return !uitkomst.hardViolations.some((v) => v.ruleId === "ROSTER_ANCHOR_LOCKED");
    });
    toets(
      "een nieuwe dienstregeling mag de structuur wél bepalen",
      nieuweRonde,
      "de vergrendeling geldt ook buiten een wijzigingsblad",
    );

    const zonderBaseline = evaluateAssignment(
      verzoek({ subject, candidate, date: "2027-01-13", changeType: "AMENDMENT", baselineSlot: null }),
    );
    toets(
      "een wijzigingsblad zonder baseline blokkeert",
      !zonderBaseline.valid &&
        zonderBaseline.missingRules.some((m) => m.ruleId === "ROSTER_STRUCTURE_BASELINE"),
      "een ontbrekende baseline leverde geen blokkade op",
    );

    const anker = ankers[0] as BaselineSlot;
    const slotwijziging = evaluateStructuralChange({
      changeType: "AMENDMENT",
      date: "2027-01-13",
      baseline: anker,
      proposed: { kind: "POSITION", slotType: anker.slotType === "RES" ? "RUST" : "RES" },
      employeeGroup: medewerker.employeeGroup,
      company: medewerker.company as AssignmentRequest["subject"]["company"],
      location: STANDPLAATS,
      scope: `${anker.baseRosterCode}/${anker.lineNumber}`,
    });
    toets(
      "een anker omzetten naar een ander anker blokkeert",
      slotwijziging.decision === "BLOCK",
      `uitkomst was ${slotwijziging.decision}`,
    );

    // ── 3. De operationele laag ─────────────────────────────────────────────
    console.log("\n3. Reservedag operationeel invullen en weer intrekken");
    const resDag = await prisma.scheduledDuty.findFirst({
      where: {
        positionType: "RES",
        operationalAssignment: null,
        employee: { depot: STANDPLAATS },
      },
      orderBy: { date: "asc" },
      select: { id: true, employeeId: true, date: true },
    });

    if (!resDag) {
      console.log("  — geen vrije RES-dag in de planning gevonden; deze toets is overgeslagen.");
    } else {
      const onderliggend = await prisma.$transaction((tx) =>
        fillOperationallyIn(tx, {
          employeeId: resDag.employeeId,
          date: resDag.date,
          dutyId: dienst.id,
          reason: "verificatie van de tweelagenopzet",
        }),
      );
      const naVullen = await prisma.scheduledDuty.findUnique({
        where: { id: resDag.id },
        select: { positionType: true, dutyId: true, operationalAssignment: true },
      });
      toets(
        `de dag toont nu de dienst (${toCalendarDate(resDag.date)})`,
        naVullen?.positionType === "DUTY" && naVullen.dutyId === dienst.id,
        "de invulling is niet zichtbaar geworden",
      );
      toets(
        "het onderliggende slot is bewaard",
        onderliggend === "RES" && naVullen?.operationalAssignment?.underlyingSlotType === "RES",
        `bewaard slottype was ${naVullen?.operationalAssignment?.underlyingSlotType ?? "niets"}`,
      );

      const hersteld = await prisma.$transaction((tx) => withdrawOperationallyIn(tx, resDag.id));
      const naIntrekken = await prisma.scheduledDuty.findUnique({
        where: { id: resDag.id },
        select: { positionType: true, dutyId: true, operationalAssignment: true },
      });
      toets(
        "na intrekken staat de reservedag er weer",
        hersteld?.restored === "RES" &&
          naIntrekken?.positionType === "RES" &&
          naIntrekken.dutyId === null,
        `de dag staat nu op ${naIntrekken?.positionType} met dienst ${naIntrekken?.dutyId ?? "geen"}`,
      );
      toets(
        "de operationele laag is opgeruimd",
        naIntrekken?.operationalAssignment === null,
        "er bleef een invulling achter",
      );
    }

    // ── 4. Het basisreserverooster ──────────────────────────────────────────
    console.log("\n4. Basisreserverooster");
    const reserveRoosters = await prisma.baseRoster.findMany({
      where: { depot: STANDPLAATS, profile: "RESERVE" },
      include: { lines: { include: { days: true } } },
    });
    if (reserveRoosters.length === 0) {
      console.log(
        "  — voor deze standplaats is (nog) geen reserverooster ingericht; " +
          "er valt niets te controleren.",
      );
    } else {
      const fout = reserveRoosters.flatMap((roster) =>
        roster.lines.flatMap((line) =>
          line.days
            .filter((day) => day.positionType === "DUTY" || day.dutyCode)
            .map((day) => `${roster.code}/${line.lineNumber} wk${day.weekIndex} dag${day.weekday}`),
        ),
      );
      toets(
        "het basisreserverooster bevat geen dienstnummers",
        fout.length === 0,
        `${fout.length} slots met een dienst: ${fout.slice(0, 5).join(", ")}`,
      );
    }
  } finally {
    // De proefperiode hoort niet in de gegevens achter te blijven.
    await prisma.rosterPeriod.delete({ where: { id: periode.id } }).catch(() => undefined);
  }

  console.log(`\n${geslaagd} toetsen geslaagd, ${mislukt} mislukt.`);
  if (mislukt > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
