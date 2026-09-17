import "dotenv/config";
import { createHmac, randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { Role } from "@/lib/generated/prisma/enums";
import { toCalendarDate } from "@/domain/time";

/**
 * Toegangscontrole van de vier rollen, end-to-end tegen de draaiende applicatie.
 *
 * ## Waarom dit naast de unittests bestaat
 *
 * `tests/security/permissions.test.ts` bewijst dat de rechtentabel klopt. Dat is
 * iets anders dan bewijzen dat de applicatie zich eraan houdt. Een pagina die
 * vergeet `requirePermission` aan te roepen, of een route handler die de
 * controle na de query doet, komt in die tests niet naar boven.
 *
 * Dit script maakt daarom voor elke rol een echte sessie in de database, doet
 * echte HTTP-verzoeken met die sessiecookie, en kijkt wat er terugkomt. Dat is
 * dezelfde weg die een aanvaller zou nemen: niet via de knoppen, maar via de
 * URL.
 *
 * Draaien met een lopende ontwikkelserver:
 *   npm run verify:toegang
 */

const BASE_URL = process.env.VERIFY_BASE_URL ?? "http://localhost:3300";
const SESSION_COOKIE = "nsr_session";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

/** Wat we van een pad verwachten: bereikbaar, of weggestuurd. */
type Expectation = "toegang" | "geweigerd";

interface Probe {
  readonly path: string;
  readonly description: string;
  /** Verwachting per rol-etiket. */
  readonly expect: Record<string, Expectation>;
}

const ACCOUNTS = [
  { label: "medewerker", employeeNumber: "100001", roles: [Role.EMPLOYEE] },
  {
    label: "rooster-commissie",
    employeeNumber: "900001",
    roles: [Role.EMPLOYEE, Role.ROSTER_COMMITTEE],
  },
  {
    label: "dienstindeling",
    employeeNumber: "910001",
    roles: [Role.EMPLOYEE, Role.DUTY_ASSIGNMENT],
  },
  { label: "admin", employeeNumber: "990001", roles: [Role.EMPLOYEE, Role.ADMIN] },
] as const;

const today = toCalendarDate(new Date());

const PROBES: readonly Probe[] = [
  {
    path: "/medewerker",
    description: "eigen roosterportaal",
    expect: {
      medewerker: "toegang",
      "rooster-commissie": "toegang",
      dienstindeling: "toegang",
      admin: "toegang",
    },
  },
  {
    path: "/roostercommissie",
    description: "dashboard Rooster Commissie",
    expect: {
      medewerker: "geweigerd",
      "rooster-commissie": "toegang",
      dienstindeling: "geweigerd",
      admin: "toegang",
    },
  },
  {
    path: "/roostercommissie/genereren",
    description: "roosters genereren",
    expect: {
      medewerker: "geweigerd",
      "rooster-commissie": "toegang",
      dienstindeling: "geweigerd",
      admin: "toegang",
    },
  },
  {
    path: "/dienstindeling",
    description: "dashboard Dienstindeling",
    expect: {
      medewerker: "geweigerd",
      "rooster-commissie": "geweigerd",
      dienstindeling: "toegang",
      admin: "toegang",
    },
  },
  {
    path: "/dienstindeling/openstaand",
    description: "openstaande diensten",
    expect: {
      medewerker: "geweigerd",
      "rooster-commissie": "geweigerd",
      dienstindeling: "toegang",
      admin: "toegang",
    },
  },
  {
    path: "/beheer",
    description: "beheerdersdashboard",
    expect: {
      medewerker: "geweigerd",
      "rooster-commissie": "geweigerd",
      dienstindeling: "geweigerd",
      admin: "toegang",
    },
  },
  {
    path: "/beheer/gebruikers",
    description: "rollenbeheer",
    expect: {
      medewerker: "geweigerd",
      "rooster-commissie": "geweigerd",
      dienstindeling: "geweigerd",
      admin: "toegang",
    },
  },
  {
    path: "/beheer/auditlog",
    description: "auditlog",
    expect: {
      medewerker: "geweigerd",
      "rooster-commissie": "geweigerd",
      dienstindeling: "geweigerd",
      admin: "toegang",
    },
  },
  {
    // Een route handler in plaats van een pagina: die kan niet omleiden en moet
    // dus met een 403 antwoorden. Precies het soort eindpunt waar een
    // vergeten controle onzichtbaar zou blijven.
    path: `/dienstindeling/export?datum=${today}`,
    description: "export dagplanning (API)",
    expect: {
      medewerker: "geweigerd",
      "rooster-commissie": "geweigerd",
      dienstindeling: "toegang",
      admin: "toegang",
    },
  },
  {
    path: "/beheer/organisatie",
    description: "standplaatsenoverzicht",
    expect: {
      medewerker: "geweigerd",
      "rooster-commissie": "geweigerd",
      dienstindeling: "geweigerd",
      admin: "toegang",
    },
  },
  {
    path: "/beheer/organisatie/DDR",
    description: "één standplaats",
    expect: {
      medewerker: "geweigerd",
      "rooster-commissie": "geweigerd",
      dienstindeling: "geweigerd",
      admin: "toegang",
    },
  },
  {
    path: "/roostercommissie/pakketten",
    description: "dienstenpakketten",
    expect: {
      medewerker: "geweigerd",
      "rooster-commissie": "toegang",
      dienstindeling: "geweigerd",
      admin: "toegang",
    },
  },
  {
    // Een route handler die een compleet roosterblad teruggeeft. Precies het
    // soort eindpunt waar een vergeten controle een heel rooster prijsgeeft.
    path: "/roostercommissie/roosterblad/DDR-V",
    description: "roosterblad (document)",
    expect: {
      medewerker: "geweigerd",
      "rooster-commissie": "toegang",
      dienstindeling: "geweigerd",
      admin: "toegang",
    },
  },
  {
    path: "/roostercommissie/dienstenbak",
    description: "dienstenbak",
    expect: {
      medewerker: "geweigerd",
      "rooster-commissie": "toegang",
      dienstindeling: "geweigerd",
      admin: "toegang",
    },
  },
  {
    path: "/roostercommissie/dienstenbak/101?weekdag=4",
    description: "dienstdetail",
    expect: {
      medewerker: "geweigerd",
      "rooster-commissie": "toegang",
      dienstindeling: "geweigerd",
      admin: "toegang",
    },
  },
  {
    // De voortgang van een generatie, als JSON. Een route handler: zonder
    // controle zou hij strategie, status en kandidaatverwijzingen prijsgeven.
    path: "/roostercommissie/genereren/voortgang",
    description: "generatievoortgang (API)",
    expect: {
      medewerker: "geweigerd",
      "rooster-commissie": "toegang",
      dienstindeling: "geweigerd",
      admin: "toegang",
    },
  },
  {
    path: "/roostercommissie/simulatie/vergelijken",
    description: "kandidaten vergelijken",
    expect: {
      medewerker: "geweigerd",
      "rooster-commissie": "toegang",
      dienstindeling: "geweigerd",
      admin: "toegang",
    },
  },
  {
    path: "/roostercommissie/simulatie",
    description: "simulatie en scenario's",
    expect: {
      medewerker: "geweigerd",
      "rooster-commissie": "toegang",
      dienstindeling: "geweigerd",
      admin: "toegang",
    },
  },
  {
    path: "/medewerker/diensten",
    description: "beschikbare diensten (medewerker)",
    expect: {
      medewerker: "toegang",
      "rooster-commissie": "toegang",
      dienstindeling: "toegang",
      admin: "toegang",
    },
  },
];

function hashToken(token: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET ontbreekt.");
  }
  return createHmac("sha256", secret).update(token).digest("hex");
}

/** Maakt een sessie voor dit account en geeft het bijbehorende token terug. */
async function openSession(employeeNumber: string): Promise<string> {
  const account = await prisma.userAccount.findFirst({
    where: { employee: { employeeNumber } },
    select: { id: true, roles: true },
  });
  if (!account) {
    throw new Error(`Geen account met personeelsnummer ${employeeNumber}. Draai eerst de seed.`);
  }

  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  await prisma.session.create({
    data: {
      userId: account.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(now + 15 * 60_000),
      absoluteExpiry: new Date(now + 30 * 60_000),
      clientFingerprint: "verify-toegang",
    },
  });
  return token;
}

/**
 * Eén verzoek, zonder omleidingen te volgen.
 *
 * Een omleiding telt als geweigerd: de layout stuurt wie geen recht heeft terug
 * naar zijn eigen omgeving. Een 200 op een beschermd pad zou betekenen dat de
 * pagina daadwerkelijk gegevens heeft opgeleverd.
 */
async function probe(path: string, token: string): Promise<{ status: number; location: string | null }> {
  const response = await fetch(`${BASE_URL}${path}`, {
    redirect: "manual",
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  });
  return { status: response.status, location: response.headers.get("location") };
}

function outcomeOf(status: number): Expectation {
  // 2xx betekent dat de pagina of het bestand is opgeleverd. Alles daarbuiten —
  // een omleiding, een 401 of een 403 — betekent dat er niets is prijsgegeven.
  return status >= 200 && status < 300 ? "toegang" : "geweigerd";
}


/**
 * De standplaatsafbakening.
 *
 * Niet of iemand de pagina mag zien, maar wélke gegevens hij terugkrijgt. Een
 * verzoek om een andere standplaats hoort niet te leiden tot een foutmelding
 * maar tot de eigen gegevens — anders is de foutmelding zelf het lek: hij
 * bevestigt dat die standplaats bestaat en gegevens heeft.
 */
async function checkStandplaatsAfbakening(tokens: Map<string, string>): Promise<number> {
  console.log("\nStandplaatsafbakening");
  let fouten = 0;

  const gevallen = [
    {
      label: "medewerker",
      path: "/medewerker/rooster?standplaats=RTD",
      verwacht: "eigen gegevens",
    },
    {
      label: "rooster-commissie",
      path: "/roostercommissie/roosters?standplaats=NIETBESTAAND",
      verwacht: "eigen gegevens",
    },
  ] as const;

  for (const geval of gevallen) {
    const token = tokens.get(geval.label)!;
    const response = await fetch(`${BASE_URL}${geval.path}`, {
      redirect: "manual",
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    const body = response.status === 200 ? await response.text() : "";
    // Geen enkele Rotterdamse roostercode mag in het antwoord voorkomen.
    const lekt = /RTD-[A-Z]/.test(body);
    const ok = response.status === 200 && !lekt;
    if (!ok) {
      fouten += 1;
    }
    console.log(
      `  ${ok ? "✓" : "✗"} ${geval.label}: ${geval.path} → ${response.status}` +
        `${lekt ? " (bevat gegevens van een andere standplaats!)" : ""}`,
    );
  }
  return fouten;
}

/**
 * Het beeldmerk moet zichtbaar zijn vóórdat iemand is aangemeld: het
 * aanmeldscherm toont het zelf. Zonder sessiecookie hoort dit dus altijd 200
 * te zijn — een omleiding naar /aanmelden betekent een kapot logo op precies
 * het scherm dat het moet tonen.
 */
async function checkBeeldmerkZonderSessie(): Promise<number> {
  const response = await fetch(`${BASE_URL}/brand/ns-logo.svg`, { redirect: "manual" });
  const ok = response.status === 200;
  console.log(
    `\nBeeldmerk zonder sessie\n  ${ok ? "✓" : "✗"} /brand/ns-logo.svg → ${response.status}` +
      (ok ? "" : " (hoort 200 te zijn, ook zonder aangemeld te zijn)"),
  );
  return ok ? 0 : 1;
}

async function main(): Promise<void> {
  console.log(`Toegangscontrole tegen ${BASE_URL}\n`);

  const tokens = new Map<string, string>();
  for (const account of ACCOUNTS) {
    tokens.set(account.label, await openSession(account.employeeNumber));
  }

  let failures = 0;
  const header = ["pad", ...ACCOUNTS.map((account) => account.label)];
  console.log(header.map((cell, index) => cell.padEnd(index === 0 ? 42 : 20)).join(""));
  console.log("-".repeat(42 + ACCOUNTS.length * 20));

  for (const item of PROBES) {
    const cells: string[] = [item.path.padEnd(42)];

    for (const account of ACCOUNTS) {
      const token = tokens.get(account.label)!;
      const { status } = await probe(item.path, token);
      const actual = outcomeOf(status);
      const expected = item.expect[account.label];
      const ok = actual === expected;
      if (!ok) {
        failures += 1;
      }
      cells.push(`${ok ? "  " : "!!"} ${actual} (${status})`.padEnd(20));
    }
    console.log(cells.join(""));
  }

  failures += await checkStandplaatsAfbakening(tokens);
  failures += await checkBeeldmerkZonderSessie();

  // Opruimen: de sessies van dit script horen niet in de teller met actieve
  // sessies te blijven staan.
  for (const token of tokens.values()) {
    await prisma.session.updateMany({
      where: { tokenHash: hashToken(token) },
      data: { revokedAt: new Date(), revokedReason: "toegangscontrole afgerond" },
    });
  }

  const denials = await prisma.securityEvent.count({
    where: {
      kind: "AUTHORIZATION_DENIED",
      occurredAt: { gte: new Date(Date.now() - 5 * 60_000) },
    },
  });

  console.log(`\nGeweigerde toegang vastgelegd in het beveiligingslog: ${denials}`);

  if (failures > 0) {
    console.log(`\n${failures} afwijking(en) van de verwachting.`);
    process.exitCode = 1;
    return;
  }
  console.log("\nAlle rollen gedragen zich zoals verwacht.");
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
