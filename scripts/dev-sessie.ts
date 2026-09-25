import "dotenv/config";
import { createHmac, randomBytes } from "node:crypto";
import { config } from "@/server/config/env";
import { prisma } from "@/server/data/prisma";

// Dezelfde afleiding als in session.ts; die functie is daar niet geëxporteerd.
const hashToken = (token: string): string =>
  createHmac("sha256", config().SESSION_SECRET).update(token).digest("hex");

/**
 * Een sessietoken voor een ontwikkelaccount, om de draaiende applicatie te
 * kunnen doorlopen.
 *
 * ## Waarom dit bestaat
 *
 * De praktijktest van fase 9 loopt door het echte scherm. Daarvoor is een
 * sessie nodig, en die zou je kunnen krijgen door het aanmeldformulier in te
 * vullen. Dat gebeurt hier bewust niet: een wachtwoord intypen hoort niet bij
 * geautomatiseerd werk, ook niet als het een testwachtwoord is. De
 * schermcontrole (`verify-schermen.ts`) doet het al jaren zo — die zet de
 * sessie aan de serverkant en stuurt hem als cookie mee.
 *
 * Dit script doet hetzelfde, maar drukt het token af zodat het in een browser
 * kan worden gezet.
 *
 * ## Waarom dit niet gevaarlijk is, en waar de grens ligt
 *
 * Het schrijft een sessierij in de ontwikkeldatabase met een korte looptijd. Het
 * omzeilt geen rechten: wat de gebruiker mag, hangt aan zijn rollen en aan de
 * toekenning, en die worden bij elk verzoek opnieuw gelezen. Het is geen
 * achterdeur in de applicatie maar een sleutel voor de testomgeving, en hij
 * hoort daar te blijven — vandaar de weigering hieronder als NODE_ENV op
 * production staat.
 *
 *   npx tsx --conditions=react-server scripts/dev-sessie.ts 900001
 */

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Dit script is voor de ontwikkelomgeving en weigert te draaien op production.");
  }

  const employeeNumber = process.argv[2] ?? "900001";
  const account = await prisma.userAccount.findFirst({
    where: { employee: { employeeNumber } },
    select: { id: true, roles: true, employee: { select: { depot: true, employeeNumber: true } } },
  });
  if (!account) throw new Error(`Geen account ${employeeNumber}. Draai eerst de seed.`);

  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  await prisma.session.create({
    data: {
      userId: account.id,
      tokenHash: hashToken(token),
      // Kort, en dat is de bedoeling: een doorloopsessie hoort niet te blijven
      // hangen in een omgeving waar iedereen bij kan.
      expiresAt: new Date(now + 60 * 60_000),
      absoluteExpiry: new Date(now + 120 * 60_000),
      clientFingerprint: "dev-sessie",
    },
  });

  console.log(`account ${account.employee?.employeeNumber} · ${account.roles.join(", ")} · standplaats ${account.employee?.depot}`);
  console.log(`cookie: nsr_session=${token}`);
}

main()
  .then(() => process.exit(0))
  .catch((fout) => {
    console.error(fout);
    process.exit(1);
  });
