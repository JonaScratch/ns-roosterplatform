import "dotenv/config";
import { toCalendarDate } from "@/domain/time";
import { advanceRotation } from "@/server/services/rotation-service";

/**
 * Schuift de roulatielijsten één plaats op.
 *
 * Bedoeld voor een wekelijkse geplande taak. De handeling is idempotent: een
 * tweede aanroep in dezelfde ISO-week verschuift niets. Dat is geen luxe maar
 * noodzaak — twee keer draaien zou iedereen twee plaatsen laten opschuiven, en
 * dat is precies het soort onopgemerkte oneerlijkheid dat het systeem hoort uit
 * te sluiten.
 *
 * Draaien met: npm run rotation:advance
 */
async function main(): Promise<void> {
  const reference = process.argv[2] ?? toCalendarDate(new Date());
  const result = await advanceRotation(reference);

  console.log(`ISO-week      ${result.isoWeek}`);
  console.log(`Verschoven    ${result.advanced} lijst(en)`);
  console.log(`Overgeslagen  ${result.skipped} lijst(en) — al verschoven deze week`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
