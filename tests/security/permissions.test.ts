import { describe, expect, it } from "vitest";
import { Role } from "@/lib/generated/prisma/enums";
import {
  ALL_ROLES,
  DEFAULT_ROLES,
  PERMISSIONS,
  type Permission,
  homePathForRoles,
  permissionsForRole,
  permissionsForRoles,
  rolesHavePermission,
} from "@/server/security/permissions";
import { forbiddenAuditKeys, redactForAudit } from "@/server/audit/redact";

/**
 * Toetsen op de rechtentabel.
 *
 * Deze tests lezen als een lijst van beloften over privacy en toegang. Dat is
 * precies de bedoeling: het zijn de eigenschappen waarop een gebruiker en een
 * toezichthouder moeten kunnen vertrouwen, en ze horen te breken zodra iemand
 * de tabel losjes uitbreidt.
 *
 * Ze toetsen de tabel, niet de schermen. Dat is genoeg omdat de applicatie
 * nergens op een rol vergelijkt: elke controle loopt via `rolesHavePermission`.
 */

const EMPLOYEE = [Role.EMPLOYEE];
const ROSTER_COMMITTEE = [Role.EMPLOYEE, Role.ROSTER_COMMITTEE];
const DUTY_ASSIGNMENT = [Role.EMPLOYEE, Role.DUTY_ASSIGNMENT];
const ADMIN = [Role.EMPLOYEE, Role.ADMIN];

describe("de vier rollen", () => {
  it("geeft een nieuwe gebruiker alleen de medewerkersrol", () => {
    expect(DEFAULT_ROLES).toEqual([Role.EMPLOYEE]);
  });

  it("kent precies vier rollen", () => {
    expect(ALL_ROLES).toEqual([
      Role.EMPLOYEE,
      Role.ROSTER_COMMITTEE,
      Role.DUTY_ASSIGNMENT,
      Role.ADMIN,
    ]);
  });

  it("stuurt elke rol naar zijn eigen omgeving", () => {
    expect(homePathForRoles(EMPLOYEE)).toBe("/medewerker");
    expect(homePathForRoles(ROSTER_COMMITTEE)).toBe("/roostercommissie");
    expect(homePathForRoles(DUTY_ASSIGNMENT)).toBe("/dienstindeling");
    expect(homePathForRoles(ADMIN)).toBe("/beheer");
  });

  it("verenigt de rechten van meerdere rollen", () => {
    const combined = permissionsForRoles([Role.ROSTER_COMMITTEE, Role.DUTY_ASSIGNMENT]);
    expect(combined.has(PERMISSIONS.ROSTER_GENERATE)).toBe(true);
    expect(combined.has(PERMISSIONS.ASSIGNMENT_MANAGE)).toBe(true);
    // En nog steeds geen beheerrechten: de vereniging voegt niets toe wat geen
    // van beide rollen had.
    expect(combined.has(PERMISSIONS.ROLE_MANAGE)).toBe(false);
  });
});

describe("de medewerker", () => {
  it("kan het rooster van anderen niet opvragen", () => {
    expect(rolesHavePermission(EMPLOYEE, PERMISSIONS.SCHEDULE_READ_OWN)).toBe(true);
    expect(rolesHavePermission(EMPLOYEE, PERMISSIONS.SCHEDULE_READ_ANY)).toBe(false);
  });

  it("heeft geen enkel recht van de Rooster Commissie, Dienstindeling of het beheer", () => {
    for (const permission of [
      PERMISSIONS.ROSTER_READ,
      PERMISSIONS.ROSTER_MANAGE,
      PERMISSIONS.ROSTER_GENERATE,
      PERMISSIONS.ROSTER_PUBLISH,
      PERMISSIONS.ROSTER_EXPORT,
      PERMISSIONS.DUTY_PACKAGE_IMPORT,
      PERMISSIONS.FEEDBACK_READ_AGGREGATE,
      PERMISSIONS.ASSIGNMENT_READ,
      PERMISSIONS.ASSIGNMENT_MANAGE,
      PERMISSIONS.SWAP_OVERSEE,
      PERMISSIONS.IDENTITY_READ_ANY,
      PERMISSIONS.AUDIT_READ,
      PERMISSIONS.ROLE_MANAGE,
      PERMISSIONS.ACCOUNT_MANAGE,
      PERMISSIONS.SYSTEM_READ,
    ] satisfies Permission[]) {
      expect(rolesHavePermission(EMPLOYEE, permission)).toBe(false);
    }
  });
});

describe("de Rooster Commissie", () => {
  it("mag basisroosters samenstellen en publiceren", () => {
    for (const permission of [
      PERMISSIONS.ROSTER_READ,
      PERMISSIONS.ROSTER_MANAGE,
      PERMISSIONS.ROSTER_GENERATE,
      PERMISSIONS.ROSTER_COMPARE,
      PERMISSIONS.ROSTER_PUBLISH,
      PERMISSIONS.DUTY_PACKAGE_IMPORT,
      PERMISSIONS.FEEDBACK_READ_AGGREGATE,
    ] satisfies Permission[]) {
      expect(rolesHavePermission(ROSTER_COMMITTEE, permission)).toBe(true);
    }
  });

  it("krijgt geen enkel recht van de dagelijkse operatie", () => {
    // Dit is de scheiding met Dienstindeling. Zou de Rooster Commissie diensten
    // kunnen toewijzen, dan verwatert het onderscheid tussen "het jaarrooster
    // samenstellen" en "vandaag invullen" binnen een week.
    for (const permission of [
      PERMISSIONS.ASSIGNMENT_READ,
      PERMISSIONS.ASSIGNMENT_MANAGE,
      PERMISSIONS.ASSIGNMENT_EXPORT,
      PERMISSIONS.SCHEDULE_READ_ANY,
      PERMISSIONS.SWAP_OVERSEE,
      PERMISSIONS.IDENTITY_READ_ANY,
    ] satisfies Permission[]) {
      expect(rolesHavePermission(ROSTER_COMMITTEE, permission)).toBe(false);
    }
  });

  it("krijgt geen beheerrechten", () => {
    for (const permission of [
      PERMISSIONS.ROLE_MANAGE,
      PERMISSIONS.ACCOUNT_MANAGE,
      PERMISSIONS.AUDIT_READ,
      PERMISSIONS.SECURITY_EVENT_READ,
      PERMISSIONS.SYSTEM_READ,
    ] satisfies Permission[]) {
      expect(rolesHavePermission(ROSTER_COMMITTEE, permission)).toBe(false);
    }
  });
});

describe("Dienstindeling", () => {
  it("mag de dagelijkse operatie sturen", () => {
    for (const permission of [
      PERMISSIONS.ASSIGNMENT_READ,
      PERMISSIONS.ASSIGNMENT_MANAGE,
      PERMISSIONS.ASSIGNMENT_EXPORT,
      PERMISSIONS.SCHEDULE_READ_ANY,
      PERMISSIONS.SWAP_OVERSEE,
    ] satisfies Permission[]) {
      expect(rolesHavePermission(DUTY_ASSIGNMENT, permission)).toBe(true);
    }
  });

  it("kan de structuur van een basisrooster niet aanraken", () => {
    // De andere kant van dezelfde scheiding: Dienstindeling vult in binnen de
    // roosters die er zijn, en verandert die roosters niet.
    for (const permission of [
      PERMISSIONS.ROSTER_MANAGE,
      PERMISSIONS.ROSTER_GENERATE,
      PERMISSIONS.ROSTER_PUBLISH,
      PERMISSIONS.ROSTER_COMPARE,
      PERMISSIONS.DUTY_PACKAGE_IMPORT,
      PERMISSIONS.FEEDBACK_READ_AGGREGATE,
    ] satisfies Permission[]) {
      expect(rolesHavePermission(DUTY_ASSIGNMENT, permission)).toBe(false);
    }
  });

  it("krijgt geen beheerrechten", () => {
    for (const permission of [
      PERMISSIONS.ROLE_MANAGE,
      PERMISSIONS.ACCOUNT_MANAGE,
      PERMISSIONS.AUDIT_READ,
      PERMISSIONS.SYSTEM_READ,
    ] satisfies Permission[]) {
      expect(rolesHavePermission(DUTY_ASSIGNMENT, permission)).toBe(false);
    }
  });
});

describe("de beheerder", () => {
  it("heeft elk recht dat in de applicatie bestaat", () => {
    // De masterrol wordt berekend uit de andere rollen plus de beheerrechten.
    // Deze test is de vangrail: een nieuw recht dat aan één rol wordt toegekend
    // en per ongeluk buiten het beheerdersbereik valt, breekt hier.
    for (const permission of Object.values(PERMISSIONS)) {
      expect(rolesHavePermission(ADMIN, permission)).toBe(true);
    }
  });

  it("kan de medewerkerweergave gebruiken", () => {
    expect(rolesHavePermission(ADMIN, PERMISSIONS.SCHEDULE_READ_OWN)).toBe(true);
  });

  it("kan beide plannersomgevingen openen", () => {
    expect(rolesHavePermission(ADMIN, PERMISSIONS.ROSTER_READ)).toBe(true);
    expect(rolesHavePermission(ADMIN, PERMISSIONS.ASSIGNMENT_READ)).toBe(true);
  });
});

describe("privacybeloften in de rechtentabel", () => {
  it("kent geen enkel recht op individuele feedback", () => {
    // De belofte aan de medewerker: niemand kan zien wat hij persoonlijk heeft
    // geantwoord. Dat is geen instelling maar een ontbrekend recht.
    const all = ALL_ROLES.flatMap((role) => permissionsForRole(role));
    const feedbackReads = [...new Set(all.filter((p) => p.startsWith("feedback:read")))];
    expect(feedbackReads).toEqual([PERMISSIONS.FEEDBACK_READ_AGGREGATE]);
  });

  it("geeft alleen wie het echt nodig heeft toegang tot persoonsgegevens", () => {
    expect(rolesHavePermission(EMPLOYEE, PERMISSIONS.IDENTITY_READ_ANY)).toBe(false);
    expect(rolesHavePermission(ROSTER_COMMITTEE, PERMISSIONS.IDENTITY_READ_ANY)).toBe(false);
    // Dienstindeling belt medewerkers voor de dagelijkse invulling en heeft het
    // dus wél nodig; de inzage wordt gelogd.
    expect(rolesHavePermission(DUTY_ASSIGNMENT, PERMISSIONS.IDENTITY_READ_ANY)).toBe(true);
  });

  it("geeft iedere rol inzage in de regelcatalogus", () => {
    for (const role of ALL_ROLES) {
      expect(rolesHavePermission([role], PERMISSIONS.RULES_READ)).toBe(true);
    }
  });
});

describe("redactie van het auditlog", () => {
  it("verwijdert wachtwoorden, tokens, namen en e-mailadressen", () => {
    const geredigeerd = redactForAudit({
      employeeNumber: "100001",
      passwordHash: "$2b$12$geheim",
      sessionToken: "abc",
      displayName: "Verzonnen Naam",
      email: "iemand@voorbeeld.intern",
      dienst: "043",
    }) as Record<string, unknown>;

    expect(geredigeerd.employeeNumber).toBe("100001");
    expect(geredigeerd.dienst).toBe("043");
    expect(geredigeerd.passwordHash).toBe("[geredigeerd]");
    expect(geredigeerd.sessionToken).toBe("[geredigeerd]");
    expect(geredigeerd.displayName).toBe("[geredigeerd]");
    expect(geredigeerd.email).toBe("[geredigeerd]");
  });

  it("werkt ook op geneste objecten en lijsten", () => {
    const geredigeerd = redactForAudit({
      wijziging: { oud: { wachtwoord: "x" }, nieuw: [{ email: "a@b.c" }] },
    }) as { wijziging: { oud: Record<string, unknown>; nieuw: Record<string, unknown>[] } };

    expect(geredigeerd.wijziging.oud.wachtwoord).toBe("[geredigeerd]");
    expect(geredigeerd.wijziging.nieuw[0].email).toBe("[geredigeerd]");
  });

  it("laat rollen wél staan", () => {
    // Rolwijzigingen moeten juist volledig leesbaar in het auditlog staan; de
    // redactie mag ze niet onbedoeld meenemen.
    const geredigeerd = redactForAudit({
      rollen: ["EMPLOYEE", "ROSTER_COMMITTEE"],
      ingetrokken: ["ADMIN"],
    }) as Record<string, unknown>;
    expect(geredigeerd.rollen).toEqual(["EMPLOYEE", "ROSTER_COMMITTEE"]);
    expect(geredigeerd.ingetrokken).toEqual(["ADMIN"]);
  });

  it("loopt niet vast op een cyclisch object", () => {
    const cyclisch: Record<string, unknown> = { naamloos: 1 };
    cyclisch.zelf = cyclisch;
    expect(() => redactForAudit(cyclisch)).not.toThrow();
  });

  it("zet datums om naar tekst in plaats van een leeg object", () => {
    const geredigeerd = redactForAudit({ moment: new Date("2026-09-02T10:00:00.000Z") }) as {
      moment: string;
    };
    expect(geredigeerd.moment).toBe("2026-09-02T10:00:00.000Z");
  });

  it("bewaakt dat de lijst met verboden velden niet leeg raakt", () => {
    expect(forbiddenAuditKeys().length).toBeGreaterThan(5);
  });
});
