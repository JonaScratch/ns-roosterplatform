import "dotenv/config";
import { activeRuleset } from "@/server/rules-engine";
import { recordAudit } from "@/server/audit/log";
import { prisma } from "@/server/data/prisma";

/**
 * Vastleggen dat iemand een regelbron voorlopig heeft nagelopen.
 *
 * ## Wat dit wel en niet is
 *
 * Dit is een **voorlopige inhoudelijke controle** door een gebruiker: iemand
 * heeft het document naast het regelbestand gelegd en gekeken of de waarden
 * kloppen. Het is uitdrukkelijk **geen** formele goedkeuring namens NS, en het
 * verandert de status van de regels niet: wat `SOURCE_TRANSCRIBED` was, blijft
 * dat. De aantekening komt ernaast te staan, met naam en datum, en de agent
 * zegt dat er ook zo bij.
 *
 * Draaien met:
 *   npm run regelbron:gecontroleerd -- --document CAO-NS-2024-2025 \
 *     --personeelsnummer 900001 --notitie "artikelen 98 t/m 102 nagelopen"
 *
 * Zonder argumenten laat het script zien welke documenten er zijn en welke al
 * een controle dragen.
 */

const argument = (naam: string): string | null => {
  const i = process.argv.indexOf(`--${naam}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

async function main() {
  const ruleset = activeRuleset();
  const documenten = [...new Set(ruleset.rules.map((r) => r.source.document))].sort();
  const bestaande = await prisma.ruleSourceCheck.findMany({
    select: { document: true, checkedByName: true, checkedAt: true, note: true },
    orderBy: { checkedAt: "desc" },
  });

  const document = argument("document");
  const personeelsnummer = argument("personeelsnummer");

  if (!document || !personeelsnummer) {
    console.log(`Regelbestand ${ruleset.version} · ${documenten.length} brondocumenten:\n`);
    for (const doc of documenten) {
      const check = bestaande.find((b) => b.document === doc);
      const regels = ruleset.rules.filter((r) => r.source.document === doc).length;
      console.log(
        `  ${doc} (${regels} regels) — ${
          check ? `voorlopig nagelopen door ${check.checkedByName} op ${check.checkedAt.toISOString().slice(0, 10)}` : "nog niet nagelopen"
        }`,
      );
      if (check?.note) console.log(`      notitie: ${check.note}`);
    }
    console.log(
      "\nEen controle vastleggen:\n" +
        "  npm run regelbron:gecontroleerd -- --document <code> --personeelsnummer <nr> --notitie \"wat er is nagelopen\"\n" +
        "\nDit legt een voorlopige controle vast. Het is geen formele goedkeuring namens NS, en\n" +
        "de status van de regels verandert er niet door.",
    );
    return;
  }

  if (!documenten.includes(document)) {
    console.error(`Het document "${document}" komt niet voor in regelbestand ${ruleset.version}.`);
    console.error(`Bekend: ${documenten.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const account = await prisma.userAccount.findFirst({
    where: { status: "ACTIVE", employee: { employeeNumber: personeelsnummer } },
    select: { id: true, roles: true, employee: { select: { id: true, employeeNumber: true, depot: true, identity: { select: { displayName: true } } } } },
  });
  if (!account) {
    console.error(`Geen actief account met personeelsnummer ${personeelsnummer}.`);
    process.exitCode = 1;
    return;
  }

  const naam = account.employee.identity?.displayName ?? account.employee.employeeNumber;
  const notitie = argument("notitie");

  await prisma.ruleSourceCheck.upsert({
    where: { document_checkedByUserId: { document, checkedByUserId: account.id } },
    create: { document, checkedByUserId: account.id, checkedByName: naam, note: notitie, kind: "USER_PRELIMINARY" },
    update: { checkedAt: new Date(), checkedByName: naam, note: notitie },
  });

  await recordAudit({
    actor: {
      sessionId: "regelbron-cli",
      userId: account.id,
      employeeId: account.employee.id,
      employeeNumber: account.employee.employeeNumber,
      roles: account.roles,
      authLevel: "PASSWORD",
      depot: account.employee.depot,
    },
    action: "regelbron.voorlopig-gecontroleerd",
    objectType: "RuleSourceCheck",
    objectId: document,
    newValue: { document, by: naam, note: notitie, kind: "USER_PRELIMINARY" },
  });

  console.log(`Vastgelegd: ${document} is voorlopig nagelopen door ${naam}.`);
  console.log("Dit is geen formele goedkeuring namens NS; de status van de regels is ongewijzigd.");
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
