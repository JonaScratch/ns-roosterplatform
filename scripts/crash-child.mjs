import pg from "pg";

/**
 * Een proces dat een wijziging doet en zich daarna laat doodmaken.
 *
 * Wordt gestart door `verify:crash-recovery`. Het meldt via stdout wanneer het
 * op het punt staat waar het gedood moet worden; de aanroeper wacht op die
 * melding en niet op een klok, zodat de proef niet van timing afhangt.
 *
 * Twee standen:
 *
 *   commit    schrijft, bevestigt, meldt "KLAAR" en blijft hangen.
 *             Na het doodmaken hoort de rij er te staan.
 *
 *   halfweg   opent een transactie, schrijft, meldt "MIDDENIN" en blijft hangen
 *             zonder te bevestigen. Na het doodmaken hoort er niets te staan.
 */

const stand = process.argv[2];
const merkteken = process.argv[3];

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const invoegen = async () =>
    client.query(
      'INSERT INTO "AuditLogEntry" ("id","action","objectType","result","actorRoles") ' +
        "VALUES (gen_random_uuid(), $1, 'Crashproef', 'SUCCESS', '{}')",
      [merkteken],
    );

  if (stand === "commit") {
    await client.query("BEGIN");
    await invoegen();
    await client.query("COMMIT");
    console.log("KLAAR");
  } else if (stand === "halfweg") {
    await client.query("BEGIN");
    await invoegen();
    // Bewust geen COMMIT. De transactie blijft openstaan tot dit proces sterft.
    console.log("MIDDENIN");
  } else {
    console.error(`Onbekende stand: ${stand}`);
    process.exit(1);
  }

  // Blijven hangen tot iemand ons doodmaakt. Niet netjes afsluiten: dat is
  // precies wat er bij een crash níét gebeurt.
  setInterval(() => {}, 1000);
}

main().catch((fout) => {
  console.error(String(fout));
  process.exit(1);
});
