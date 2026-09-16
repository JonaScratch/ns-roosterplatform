import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { CAO_DAY_ALLOWANCE, earliestCaoDay, todayInAmsterdam } from "@/domain/cao-days";
import { addDays, daysBetween, toCalendarDate, toDatabaseDate } from "@/domain/time";
import type { Actor } from "@/server/auth/session";
import {
  caoDayOverviewCore,
  caoDayQueueCore,
  cancelCaoDayCore,
  registerCaoDayCore,
  requestCaoDayCore,
} from "@/server/services/cao-day-service";

/**
 * De CAO-dagstroom, van aanvraag tot verlofboek, op echte gegevens.
 *
 * ## Wat dit script wil bewijzen
 *
 * Vier dingen die geen van alle uit een groene unittest volgen:
 *
 * 1. De termijn van zes weken wordt door de **server** afgedwongen, niet door
 *    een uitgeschakelde knop. Het script belt de service rechtstreeks — precies
 *    wat iemand doet die het formulier omzeilt.
 * 2. Een bevestigde aanvraag is **duurzaam**. Na "ok" wordt hij teruggelezen
 *    over een tweede verbinding: wat daar niet staat, stond nergens.
 * 3. Aanvraag en melding zitten in **één transactie**. Er wordt geteld of de
 *    dienstindeling werkelijk bericht heeft gekregen, en of de medewerker dat
 *    krijgt zodra de dag in het verlofboek staat.
 * 4. Twee gelijktijdige klikken op "verwerkt in verlofboek" leveren **één**
 *    verwerking en **één** melding op.
 *
 * Alles wat het aanmaakt, draait het aan het eind terug. Wat het niet
 * terugdraait, meldt het.
 *
 * Draaien met: npm run verify:cao-dagen
 */

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

/** Een tweede verbinding, om duurzaamheid te kunnen controleren. */
const tweedeVerbinding = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

let geslaagd = 0;
let mislukt = 0;
let geblokkeerd = 0;

function toets(naam: string, goed: boolean, toelichting = ""): void {
  if (goed) {
    geslaagd += 1;
    console.log(`  ✓ ${naam}`);
  } else {
    mislukt += 1;
    console.log(`  ✗ ${naam}${toelichting ? ` — ${toelichting}` : ""}`);
  }
}

function blokkade(naam: string, toelichting: string): void {
  geblokkeerd += 1;
  console.log(`  ⊘ ${naam} — ${toelichting}`);
}

function actorVoor(
  row: { userId: string; employeeId: string; employeeNumber: string; depot: string },
  roles: Actor["roles"],
): Actor {
  return {
    sessionId: "verify-cao-dagen",
    userId: row.userId,
    employeeId: row.employeeId,
    employeeNumber: row.employeeNumber,
    roles,
    authLevel: "PASSWORD",
    depot: row.depot,
  };
}

/** De dagen die de kalender op dit moment als kiesbaar toont. */
function kiesbareDagen(overzicht: {
  months: readonly { cells: readonly ({ date: string; check: { allowed: boolean } } | null)[] }[];
}): readonly string[] {
  return overzicht.months
    .flatMap((maand) => maand.cells)
    .filter((cel): cel is { date: string; check: { allowed: boolean } } => cel !== null)
    .filter((cel) => cel.check.allowed)
    .map((cel) => cel.date);
}

/** Liggen deze twee dagen naast elkaar? */
function buren(een: string, ander: string): boolean {
  return Math.abs(daysBetween(een, ander)) === 1;
}

/** Onthoudt een aangemaakte aanvraag, zodat het opruimen hem terugvindt. */
async function onthoud(
  lijst: string[],
  employeeId: string,
  datum: string,
): Promise<string | null> {
  const rij = await prisma.caoDayRequest.findFirst({
    where: { employeeId, requestedDate: toDatabaseDate(datum) },
    select: { id: true },
  });
  if (rij) {
    lijst.push(rij.id);
  }
  return rij?.id ?? null;
}

/** Alle aanvragen van een medewerker weghalen, om met een schone lei verder te gaan. */
async function leegmaken(employeeId: string): Promise<void> {
  const rijen = await prisma.caoDayRequest.findMany({ where: { employeeId }, select: { id: true } });
  const ids = rijen.map((rij) => rij.id);
  await prisma.notification.deleteMany({
    where: { entityType: "CaoDayRequest", entityId: { in: ids } },
  });
  await prisma.outboxEvent.deleteMany({
    where: {
      OR: ids.flatMap((id) => [
        { eventKey: `cao-dag-aangevraagd:${id}` },
        { eventKey: `cao-dag-verwerkt:${id}` },
      ]),
    },
  });
  await prisma.caoDayRequest.deleteMany({ where: { id: { in: ids } } });
}

/**
 * Zet één lopende CAO-dagaanvraag klaar, buiten de service om.
 *
 * Voor de jaargrensmeting. Het geseede rooster loopt niet tot 31 december, dus
 * die dag valt niet via de gewone weg aan te vragen — er is dan geen dienst om
 * vrij van te vragen. De regel die hier gemeten wordt, gaat echter niet over
 * diensten maar over kalenderdagen: staat er al een aanvraag op de dag ernaast?
 *
 * Daarom wordt de eerste dag als gegeven neergezet en de tweede wél door de
 * echte service gehaald. Zo meet dit de regel en niet de dekking van de seed.
 */
async function zetAanvraagKlaar(
  employeeId: string,
  locationId: string,
  datum: string,
): Promise<string> {
  const rij = await prisma.caoDayRequest.create({
    data: {
      employeeId,
      locationId,
      requestedDate: toDatabaseDate(datum),
      rosterSnapshot: { herkomst: "verify-cao-dagen" },
      status: "REQUESTED",
    },
  });
  return rij.id;
}

async function main(): Promise<void> {
  console.log("CAO-DAGEN");
  console.log("═".repeat(66));

  const vandaag = todayInAmsterdam();
  const vroegste = earliestCaoDay(vandaag);

  // Een medewerker met een account, in Dordrecht, die op de eerste geldige dag
  // ook werkelijk een dienst heeft. Zonder die dienst meet je de weigering in
  // plaats van de aanvraag.
  const kandidaten = await prisma.scheduledDuty.findMany({
    where: {
      positionType: "DUTY",
      dutyId: { not: null },
      date: { gte: toDatabaseDate(vroegste), lte: toDatabaseDate(addDays(vroegste, 45)) },
      employee: { depot: "DDR", account: { isNot: null } },
    },
    orderBy: { date: "asc" },
    include: {
      employee: {
        select: {
          id: true,
          employeeNumber: true,
          depot: true,
          account: { select: { id: true } },
        },
      },
    },
    take: 200,
  });

  if (kandidaten.length === 0) {
    blokkade(
      "een medewerker met een dienst op of na de eerste geldige dag",
      "BLOCKED_BY_MISSING_DATA. Er staan geen ingeroosterde diensten in dit bereik; " +
        `verwacht vanaf ${vroegste}. Draai eerst npm run db:seed.`,
    );
    afsluiten();
    return;
  }

  const eerste = kandidaten[0];
  const medewerker = actorVoor(
    {
      userId: eerste.employee.account!.id,
      employeeId: eerste.employee.id,
      employeeNumber: eerste.employee.employeeNumber,
      depot: eerste.employee.depot,
    },
    ["EMPLOYEE"],
  );
  const werkdag = toCalendarDate(eerste.date);
  console.log(
    `\nMedewerker ${medewerker.employeeNumber} (DDR); vandaag ${vandaag}, ` +
      `eerste geldige dag ${vroegste}, gekozen werkdag ${werkdag}.`,
  );

  const dienstindelingAccount = await prisma.userAccount.findFirst({
    where: { status: "ACTIVE", roles: { has: "DUTY_ASSIGNMENT" }, employee: { depot: "DDR" } },
    select: { id: true, employee: { select: { id: true, employeeNumber: true, depot: true } } },
  });

  // Alles wat we aanmaken, verzamelen we om terug te draaien.
  const aangemaakt: string[] = [];

  try {
    // ── 1. De termijn wordt aan de serverkant afgedwongen ───────────────────
    console.log("\n1. De termijn van zes weken");

    const teVroeg = addDays(vroegste, -1);
    const weigering = await requestCaoDayCore(medewerker, teVroeg);
    toets(
      `de dag vóór de grens (${teVroeg}) wordt geweigerd, ook zonder formulier`,
      !weigering.ok,
      "de service accepteerde een dag binnen zes weken",
    );
    const teVroegRij = await prisma.caoDayRequest.count({
      where: { employeeId: medewerker.employeeId, requestedDate: toDatabaseDate(teVroeg) },
    });
    toets("van die geweigerde dag staat niets in de database", teVroegRij === 0);

    const gisteren = await requestCaoDayCore(medewerker, addDays(vandaag, -1));
    toets("een datum in het verleden wordt geweigerd", !gisteren.ok);

    const onzin = await requestCaoDayCore(medewerker, "niet-een-datum");
    toets("een onherkenbare datum wordt geweigerd", !onzin.ok);

    // ── 2. Een geldige aanvraag ─────────────────────────────────────────────
    console.log("\n2. Een geldige aanvraag");

    const meldingenVoor = dienstindelingAccount
      ? await prisma.notification.count({
          where: { recipientUserId: dienstindelingAccount.id, category: "CAO_DAG" },
        })
      : 0;

    const aanvraag = await requestCaoDayCore(medewerker, werkdag);
    toets(
      `de werkdag ${werkdag} wordt aangenomen`,
      aanvraag.ok,
      aanvraag.reason ?? "zonder reden geweigerd",
    );

    if (!aanvraag.ok) {
      throw new Error("Zonder aangenomen aanvraag valt de rest niet te meten.");
    }

    // Duurzaam: terugkijken over een tweede verbinding. Een waarde die alleen
    // in de eigen sessie bestond, is hier niet te vinden.
    const opgeslagen = await tweedeVerbinding.caoDayRequest.findFirst({
      where: { employeeId: medewerker.employeeId, requestedDate: toDatabaseDate(werkdag) },
    });
    toets(
      "de aanvraag is meteen leesbaar over een tweede verbinding",
      opgeslagen !== null,
      "de bevestiging kwam vóór de commit",
    );
    if (!opgeslagen) {
      throw new Error("De aanvraag is niet vastgelegd.");
    }
    aangemaakt.push(opgeslagen.id);

    toets("hij staat op REQUESTED", opgeslagen.status === "REQUESTED", opgeslagen.status);

    const momentopname = opgeslagen.rosterSnapshot as Record<string, unknown> | null;
    toets(
      "de dienst die vervalt is meegeschreven",
      momentopname !== null && typeof momentopname.dutyCode === "string",
      `momentopname: ${JSON.stringify(momentopname)}`,
    );

    const gebeurtenis = await tweedeVerbinding.outboxEvent.findFirst({
      where: { eventKey: `cao-dag-aangevraagd:${opgeslagen.id}` },
    });
    toets(
      "de gebeurtenis staat in dezelfde transactie in de outbox",
      gebeurtenis !== null,
      "er is een aanvraag zonder gebeurtenis",
    );

    if (dienstindelingAccount) {
      const meldingenNa = await prisma.notification.count({
        where: { recipientUserId: dienstindelingAccount.id, category: "CAO_DAG" },
      });
      toets(
        "de dienstindeling van deze standplaats heeft bericht gekregen",
        meldingenNa === meldingenVoor + 1,
        `${meldingenVoor} → ${meldingenNa}`,
      );
    } else {
      blokkade(
        "de dienstindeling krijgt bericht",
        "BLOCKED_BY_MISSING_DATA. Geen actief DUTY_ASSIGNMENT-account op DDR.",
      );
    }

    const auditRij = await prisma.auditLogEntry.findFirst({
      where: { action: "cao-dag.aangevraagd", objectId: opgeslagen.id },
    });
    toets("de aanvraag staat in het auditlog", auditRij !== null);

    // ── 3. Wat niet twee keer kan ───────────────────────────────────────────
    console.log("\n3. Wat niet twee keer kan");

    const nogmaals = await requestCaoDayCore(medewerker, werkdag);
    toets("dezelfde dag kan niet twee keer worden aangevraagd", !nogmaals.ok);
    const aantalVoorDeDag = await prisma.caoDayRequest.count({
      where: { employeeId: medewerker.employeeId, requestedDate: toDatabaseDate(werkdag) },
    });
    toets("en er staat nog steeds één rij", aantalVoorDeDag === 1, `${aantalVoorDeDag} rijen`);

    // ── 4. Het tegoed ───────────────────────────────────────────────────────
    console.log(`\n4. Het tegoed van ${CAO_DAY_ALLOWANCE} dagen`);

    const overzicht = await caoDayOverviewCore(medewerker);
    const verdereWerkdagen = overzicht.months
      .flatMap((maand) => maand.cells)
      .filter((cel) => cel !== null && cel.check.allowed)
      .map((cel) => cel!.date);

    if (verdereWerkdagen.length < CAO_DAY_ALLOWANCE) {
      blokkade(
        "het tegoed raakt op na de laatste dag",
        `BLOCKED_BY_MISSING_DATA. Er zijn maar ${verdereWerkdagen.length} kiesbare dagen ` +
          "in het getoonde bereik.",
      );
    } else {
      // Het tegoed volmaken. De kalender wordt tussendoor opnieuw opgehaald,
      // omdat elke aanvraag ook de dagen ernaast blokkeert: een lijst van vóór
      // de eerste aanvraag zou nu naar een aangrenzende dag kunnen wijzen.
      for (let index = 0; index < CAO_DAY_ALLOWANCE - 1; index += 1) {
        const kiesbaar = kiesbareDagen(await caoDayOverviewCore(medewerker));
        if (kiesbaar.length === 0) {
          break;
        }
        const extra = await requestCaoDayCore(medewerker, kiesbaar[0]);
        if (extra.ok) {
          await onthoud(aangemaakt, medewerker.employeeId, kiesbaar[0]);
        }
      }

      // Een dag die op zichzelf mag: ver genoeg vooruit, een werkdag, en niet
      // naast een lopende aanvraag. Alleen het tegoed staat nog in de weg.
      const naTegoed = await caoDayOverviewCore(medewerker);
      const losseDag = verdereWerkdagen.find(
        (dag) => !naTegoed.requests.some((rij) => rij.date === dag || buren(rij.date, dag)),
      );
      const teveel = await requestCaoDayCore(medewerker, losseDag ?? verdereWerkdagen[0]);
      toets(
        `de ${CAO_DAY_ALLOWANCE + 1}e aanvraag wordt geweigerd`,
        !teveel.ok,
        "het tegoed werd overschreden",
      );
      toets(
        "en de melding gaat over het tegoed, niet over iets anders",
        !teveel.ok && (teveel.reason ?? "").includes("CAO-dagen van deze periode"),
        teveel.reason ?? "geen reden",
      );
      const totaal = await prisma.caoDayRequest.count({
        where: { employeeId: medewerker.employeeId, status: { not: "CANCELLED" } },
      });
      toets(
        `er staan niet meer dan ${CAO_DAY_ALLOWANCE} lopende aanvragen`,
        totaal <= CAO_DAY_ALLOWANCE,
        `${totaal} lopende aanvragen`,
      );
    }

    // ── 5. Verwerken in het verlofboek ──────────────────────────────────────
    console.log("\n5. Verwerken in het verlofboek");

    if (!dienstindelingAccount?.employee) {
      blokkade(
        "de dienstindeling verwerkt de aanvraag",
        "BLOCKED_BY_MISSING_DATA. Geen DUTY_ASSIGNMENT-account op DDR.",
      );
    } else {
      const dienstindeling = actorVoor(
        {
          userId: dienstindelingAccount.id,
          employeeId: dienstindelingAccount.employee.id,
          employeeNumber: dienstindelingAccount.employee.employeeNumber,
          depot: dienstindelingAccount.employee.depot,
        },
        ["DUTY_ASSIGNMENT"],
      );

      const wachtrij = await caoDayQueueCore(dienstindeling);
      toets(
        "de aanvraag staat in de wachtrij van de dienstindeling",
        wachtrij.some((rij) => rij.id === opgeslagen.id),
        `${wachtrij.length} rijen in de wachtrij`,
      );

      const medewerkerMeldingenVoor = await prisma.notification.count({
        where: { recipientUserId: medewerker.userId, category: "CAO_DAG" },
      });

      // Twee gelijktijdige klikken op dezelfde versie: precies één mag slagen.
      const [eersteKlik, tweedeKlik] = await Promise.all([
        registerCaoDayCore(dienstindeling, opgeslagen.id, opgeslagen.version),
        registerCaoDayCore(dienstindeling, opgeslagen.id, opgeslagen.version),
      ]);
      const geslaagdeKlikken = [eersteKlik, tweedeKlik].filter((klik) => klik.ok).length;
      toets(
        "twee gelijktijdige klikken leveren één verwerking op",
        geslaagdeKlikken === 1,
        `${geslaagdeKlikken} van de 2 klikken slaagde`,
      );

      const na = await tweedeVerbinding.caoDayRequest.findUnique({
        where: { id: opgeslagen.id },
      });
      toets(
        "de aanvraag staat op REGISTERED_IN_LEAVE_BOOK",
        na?.status === "REGISTERED_IN_LEAVE_BOOK",
        na?.status ?? "verdwenen",
      );
      toets(
        "wie hem verwerkte is vastgelegd",
        na?.registeredBy === dienstindeling.employeeNumber && na?.registeredAt !== null,
        `${na?.registeredBy ?? "niemand"} op ${String(na?.registeredAt)}`,
      );
      toets("de versie is opgehoogd", (na?.version ?? 0) === opgeslagen.version + 1);

      const medewerkerMeldingenNa = await prisma.notification.count({
        where: { recipientUserId: medewerker.userId, category: "CAO_DAG" },
      });
      toets(
        "de medewerker krijgt precies één melding, niet twee",
        medewerkerMeldingenNa === medewerkerMeldingenVoor + 1,
        `${medewerkerMeldingenVoor} → ${medewerkerMeldingenNa}`,
      );

      // ── 6. Wat na verwerking niet meer kan ────────────────────────────────
      console.log("\n6. Na verwerking");

      const intrekken = await cancelCaoDayCore(medewerker, opgeslagen.id);
      toets(
        "een verwerkte dag kan de medewerker niet meer intrekken",
        !intrekken.ok,
        "het platform beloofde iets terug te draaien wat elders staat",
      );

      const nogmaalsVerwerken = await registerCaoDayCore(
        dienstindeling,
        opgeslagen.id,
        opgeslagen.version + 1,
      );
      toets("verwerken kan niet nog een keer", !nogmaalsVerwerken.ok);
    }

    // ── 7. Andermans aanvraag ───────────────────────────────────────────────
    console.log("\n7. Andermans aanvraag");

    const ander = kandidaten.find((rij) => rij.employee.id !== medewerker.employeeId);
    if (!ander) {
      blokkade("een tweede medewerker", "BLOCKED_BY_MISSING_DATA. Maar één kandidaat gevonden.");
    } else {
      const anderActor = actorVoor(
        {
          userId: ander.employee.account!.id,
          employeeId: ander.employee.id,
          employeeNumber: ander.employee.employeeNumber,
          depot: ander.employee.depot,
        },
        ["EMPLOYEE"],
      );
      const poging = await cancelCaoDayCore(anderActor, opgeslagen.id);
      toets("een collega kan uw aanvraag niet intrekken", !poging.ok);

      const eigenOverzicht = await caoDayOverviewCore(anderActor);
      toets(
        "en ziet uw aanvragen niet in zijn eigen overzicht",
        eigenOverzicht.requests.every((rij) => !aangemaakt.includes(rij.id)),
      );
    }

    // ── 8. Twee CAO-dagen achter elkaar ─────────────────────────────────────
    console.log("\n8. Twee CAO-dagen achter elkaar");

    // Met een schone lei: de eerdere aanvragen van deze medewerker staan de
    // metingen hieronder in de weg.
    await leegmaken(medewerker.employeeId);
    aangemaakt.length = 0;

    const schoon = await caoDayOverviewCore(medewerker);
    const kiesbaar = kiesbareDagen(schoon);
    // Twee opeenvolgende kalenderdagen waarop de medewerker allebei werkt.
    const paar = kiesbaar.find((dag) => kiesbaar.includes(addDays(dag, 1)));

    if (!paar) {
      blokkade(
        "twee opeenvolgende werkdagen",
        "BLOCKED_BY_MISSING_DATA. Deze medewerker heeft in het getoonde bereik geen twee " +
          "aansluitende kiesbare dagen.",
      );
    } else {
      const eersteDag = paar;
      const tweedeDag = addDays(paar, 1);
      const derdeDag = addDays(paar, 2);

      // (1) maandag aangevraagd → dinsdag geblokkeerd
      const dagEen = await requestCaoDayCore(medewerker, eersteDag);
      toets(`${eersteDag} wordt aangenomen`, dagEen.ok, dagEen.reason ?? "");
      await onthoud(aangemaakt, medewerker.employeeId, eersteDag);

      const dagTwee = await requestCaoDayCore(medewerker, tweedeDag);
      toets(
        `de dag erna (${tweedeDag}) wordt geweigerd — directe serviceaanroep`,
        !dagTwee.ok,
        "twee CAO-dagen kwamen achter elkaar te staan",
      );
      toets(
        "en de melding zegt in gewone taal waarom",
        (dagTwee.reason ?? "").includes("niet op twee opeenvolgende dagen"),
        dagTwee.reason ?? "geen reden",
      );
      toets(
        "van die geweigerde dag staat niets in de database",
        (await prisma.caoDayRequest.count({
          where: {
            employeeId: medewerker.employeeId,
            requestedDate: toDatabaseDate(tweedeDag),
          },
        })) === 0,
      );

      // (7) de kalender toont de aangrenzende dag als niet-kiesbaar
      const naEerste = await caoDayOverviewCore(medewerker);
      const buurvakje = naEerste.months
        .flatMap((maand) => maand.cells)
        .find((cel) => cel?.date === tweedeDag);
      toets(
        "de kalender toont de dag ernaast als niet-kiesbaar",
        buurvakje?.check.allowed === false && buurvakje?.check.refusal === "AANEENGESLOTEN",
        `${buurvakje?.check.refusal ?? "geen vakje gevonden"}`,
      );

      // (3) met een dag ertussen mag het wel
      const dagDrie = await requestCaoDayCore(medewerker, derdeDag);
      if (kiesbaar.includes(derdeDag)) {
        toets(
          `met een dag ertussen (${derdeDag}) mag het wel`,
          dagDrie.ok,
          dagDrie.reason ?? "geweigerd terwijl er een dag tussen zit",
        );
        if (dagDrie.ok) {
          await onthoud(aangemaakt, medewerker.employeeId, derdeDag);
        }
      } else {
        blokkade(
          `met een dag ertussen (${derdeDag}) mag het wel`,
          "BLOCKED_BY_MISSING_DATA. Die dag is om een andere reden niet kiesbaar.",
        );
      }

      // (2) andersom: eerst de tweede dag, dan de eerste
      await leegmaken(medewerker.employeeId);
      aangemaakt.length = 0;

      const omgekeerdEerst = await requestCaoDayCore(medewerker, tweedeDag);
      toets(`${tweedeDag} wordt op zichzelf aangenomen`, omgekeerdEerst.ok);
      await onthoud(aangemaakt, medewerker.employeeId, tweedeDag);

      const omgekeerdDaarna = await requestCaoDayCore(medewerker, eersteDag);
      toets(
        `de dag ervóór (${eersteDag}) wordt óók geweigerd`,
        !omgekeerdDaarna.ok,
        "de regel werkt maar één kant op",
      );

      // (6) twee gelijktijdige aanvragen voor aansluitende dagen
      //
      // Twee metingen, en het verschil ertussen is belangrijk.
      //
      // De eerste is de uitkomstmeting: twee aanvragen tegelijk afvuren en
      // tellen wat er blijft staan. Die is waardevol maar bewijst de grendel
      // niet — zonder grendel lopen de twee aanroepen in de praktijk vaak tóch
      // netjes na elkaar, en dan is hij groen zonder dat er iets beschermt.
      // Dat is precies gemeten: met de grendel eruit bleef deze drie keer op
      // rij groen.
      //
      // De tweede meting is daarom de echte: de grendel wordt van buitenaf
      // vastgehouden, en dan hoort de aanvraag te wachten in plaats van door te
      // lopen. Die valt onmiddellijk om zodra de grendel verdwijnt.
      await leegmaken(medewerker.employeeId);
      aangemaakt.length = 0;

      const [gelijkA, gelijkB] = await Promise.all([
        requestCaoDayCore(medewerker, eersteDag),
        requestCaoDayCore(medewerker, tweedeDag),
      ]);
      const geslaagdeAanvragen = [gelijkA, gelijkB].filter((poging) => poging.ok).length;
      const bewaard = await prisma.caoDayRequest.count({
        where: { employeeId: medewerker.employeeId, status: { not: "CANCELLED" } },
      });
      toets(
        "twee gelijktijdige aanvragen voor aansluitende dagen: hoogstens één slaagt",
        geslaagdeAanvragen === 1 && bewaard === 1,
        `${geslaagdeAanvragen} van de 2 slaagden, ${bewaard} rijen bewaard`,
      );
      await onthoud(aangemaakt, medewerker.employeeId, eersteDag);
      await onthoud(aangemaakt, medewerker.employeeId, tweedeDag);

      // De grendel zelf, deterministisch.
      await leegmaken(medewerker.employeeId);
      aangemaakt.length = 0;

      let losmaken: (() => void) | null = null;
      const vastgehouden = new Promise<void>((resolve) => {
        losmaken = resolve;
      });
      const sleutel = `cao-dag:${medewerker.employeeId}`;
      const houder = tweedeVerbinding.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${sleutel}))`;
          await vastgehouden;
        },
        { timeout: 20_000 },
      );

      // Even wachten tot de houder de grendel werkelijk heeft.
      await new Promise((resolve) => setTimeout(resolve, 250));

      const lopendeAanvraag = requestCaoDayCore(medewerker, eersteDag);
      const wieEerst = await Promise.race([
        lopendeAanvraag.then(() => "doorgelopen" as const),
        new Promise<"gewacht">((resolve) => setTimeout(() => resolve("gewacht"), 750)),
      ]);
      toets(
        "een aanvraag wacht op de grendel van dezelfde medewerker",
        wieEerst === "gewacht",
        "de aanvraag liep door terwijl een ander de grendel had",
      );

      losmaken!();
      await houder;
      const naDeGrendel = await lopendeAanvraag;
      toets(
        "en gaat door zodra de grendel los is",
        naDeGrendel.ok,
        naDeGrendel.reason ?? "de aanvraag bleef hangen",
      );
      await onthoud(aangemaakt, medewerker.employeeId, eersteDag);
    }

    // ── 9. De jaargrens ─────────────────────────────────────────────────────
    //
    // 31 december en 1 januari staan in verschillende jaren en verschillende
    // maanden. Code die op maand of jaar vergelijkt in plaats van op dagnummers
    // ziet ze niet als buren, en dan glipt precies deze combinatie erdoor.
    console.log("\n9. De jaargrens: 31 december en 1 januari");

    await leegmaken(medewerker.employeeId);
    aangemaakt.length = 0;

    const standplaats = await prisma.stationLocation.findUnique({
      where: { code: "DDR" },
      select: { id: true },
    });

    if (!standplaats) {
      blokkade("31 december en 1 januari", "BLOCKED_BY_MISSING_DATA. Standplaats DDR ontbreekt.");
    } else {
      // Een jaarwisseling die ruim voorbij de zes weken ligt.
      const jaar = Number(vroegste.slice(0, 4)) + (vroegste.slice(5) > "12-31" ? 1 : 0);
      const oud = `${jaar}-12-31`;
      const nieuw = `${jaar + 1}-01-01`;

      // (4) 31 december staat er → 1 januari wordt geweigerd
      const decemberRij = await zetAanvraagKlaar(medewerker.employeeId, standplaats.id, oud);
      aangemaakt.push(decemberRij);

      const januari = await requestCaoDayCore(medewerker, nieuw);
      toets(
        `met ${oud} aangevraagd wordt ${nieuw} geweigerd`,
        !januari.ok,
        "de jaargrens werd als onderbreking gezien",
      );
      toets(
        "en om de juiste reden: aaneengesloten, niet iets anders",
        (januari.reason ?? "").includes("niet op twee opeenvolgende dagen"),
        januari.reason ?? "geen reden",
      );
      toets(
        `en van ${nieuw} staat niets in de database`,
        (await prisma.caoDayRequest.count({
          where: { employeeId: medewerker.employeeId, requestedDate: toDatabaseDate(nieuw) },
        })) === 0,
      );

      // (5) andersom: 1 januari staat er → 31 december wordt geweigerd
      await leegmaken(medewerker.employeeId);
      aangemaakt.length = 0;

      const januariRij = await zetAanvraagKlaar(medewerker.employeeId, standplaats.id, nieuw);
      aangemaakt.push(januariRij);

      const december = await requestCaoDayCore(medewerker, oud);
      toets(
        `met ${nieuw} aangevraagd wordt ${oud} óók geweigerd`,
        !december.ok,
        "de regel werkt over de jaargrens maar één kant op",
      );
      toets(
        "en ook hier om de reden aaneengesloten",
        (december.reason ?? "").includes("niet op twee opeenvolgende dagen"),
        december.reason ?? "geen reden",
      );

      // De tegenproef: met een dag ertussen valt de weigering weg, en blijft er
      // een andere reden over (of geen). Zonder deze meting zou "alles wordt
      // geweigerd" ook groen zijn.
      const tweeDagenErvoor = addDays(nieuw, -2);
      const ruim = await requestCaoDayCore(medewerker, tweeDagenErvoor);
      toets(
        `${tweeDagenErvoor} wordt niet om aaneengeslotenheid geweigerd`,
        !(ruim.reason ?? "").includes("niet op twee opeenvolgende dagen"),
        ruim.reason ?? "aangenomen",
      );
      await onthoud(aangemaakt, medewerker.employeeId, tweeDagenErvoor);
    }
    // ── 10. Opnieuw aanvragen na intrekken ──────────────────────────────────
    //
    // Regressie: `CaoDayRequest` heeft een unieke sleutel op (medewerker,
    // datum) die over alle statussen geldt, dus ook over CANCELLED. Een
    // medewerker die een aanvraag intrekt en dezelfde dag daarna opnieuw
    // aanvraagt, mag daar niet op stuklopen — de regelcontrole staat het toe
    // (ingetrokken telt niet als lopend), dus de opslag moet het ook toestaan.
    console.log("\n10. Opnieuw aanvragen na intrekken");

    await leegmaken(medewerker.employeeId);
    aangemaakt.length = 0;

    const heraanvraagOverzicht = await caoDayOverviewCore(medewerker);
    const heraanvraagDag = kiesbareDagen(heraanvraagOverzicht)[0];

    if (!heraanvraagDag) {
      blokkade(
        "opnieuw aanvragen na intrekken",
        "BLOCKED_BY_MISSING_DATA. Geen kiesbare dag over voor deze meting.",
      );
    } else {
      const eersteRonde = await requestCaoDayCore(medewerker, heraanvraagDag);
      toets(`${heraanvraagDag} wordt de eerste keer aangenomen`, eersteRonde.ok, eersteRonde.reason ?? "");

      const eersteRij = await onthoud(aangemaakt, medewerker.employeeId, heraanvraagDag);
      if (eersteRij) {
        const ingetrokken = await cancelCaoDayCore(medewerker, eersteRij);
        toets("de aanvraag kan worden ingetrokken", ingetrokken.ok, ingetrokken.reason ?? "");
      }

      // Dit is de regel die eerder een onafgevangen
      // `PrismaClientKnownRequestError` (unique constraint) opleverde in
      // plaats van een gewoon "ok" of een nette weigering.
      const tweedeRonde = await requestCaoDayCore(medewerker, heraanvraagDag);
      toets(
        `${heraanvraagDag} kan na intrekken opnieuw worden aangevraagd`,
        tweedeRonde.ok,
        tweedeRonde.reason ?? "de aanvraag liep vast op de unieke sleutel",
      );

      const rijenVoorDezeDag = await prisma.caoDayRequest.findMany({
        where: { employeeId: medewerker.employeeId, requestedDate: toDatabaseDate(heraanvraagDag) },
      });
      toets(
        "er staat precies één rij voor deze medewerker en datum, niet twee",
        rijenVoorDezeDag.length === 1,
        `${rijenVoorDezeDag.length} rijen`,
      );
      toets(
        "die rij staat weer op REQUESTED",
        rijenVoorDezeDag[0]?.status === "REQUESTED",
        rijenVoorDezeDag[0]?.status ?? "geen rij",
      );

      if (rijenVoorDezeDag[0]) {
        aangemaakt.push(rijenVoorDezeDag[0].id);
      }
    }
  } finally {
    // ── Opruimen ────────────────────────────────────────────────────────────
    console.log("\nOpruimen");
    const aanvragen = await prisma.caoDayRequest.findMany({
      where: { id: { in: aangemaakt } },
      select: { id: true },
    });
    await prisma.notification.deleteMany({
      where: { entityType: "CaoDayRequest", entityId: { in: aanvragen.map((rij) => rij.id) } },
    });
    await prisma.outboxEvent.deleteMany({
      where: {
        OR: aanvragen.flatMap((rij) => [
          { eventKey: `cao-dag-aangevraagd:${rij.id}` },
          { eventKey: `cao-dag-verwerkt:${rij.id}` },
        ]),
      },
    });
    await prisma.auditLogEntry.deleteMany({
      where: { objectType: "CaoDayRequest", objectId: { in: aanvragen.map((rij) => rij.id) } },
    });
    await prisma.caoDayRequest.deleteMany({ where: { id: { in: aanvragen.map((r) => r.id) } } });

    const rest = await prisma.caoDayRequest.count({ where: { id: { in: aangemaakt } } });
    toets(
      "alles wat dit script aanmaakte is teruggedraaid",
      rest === 0,
      `${rest} aanvragen bleven staan`,
    );
  }

  afsluiten();
}

function afsluiten(): void {
  console.log(`\n${"═".repeat(66)}`);
  console.log(
    `${geslaagd} controles geslaagd, ${mislukt} mislukt, ${geblokkeerd} geblokkeerd door ` +
      "ontbrekende gegevens.",
  );
  if (mislukt > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await tweedeVerbinding.$disconnect();
  });
