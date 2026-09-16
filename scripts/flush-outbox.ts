import "dotenv/config";
import { processOutbox } from "@/server/services/notification-service";

/**
 * De uitgaande wachtrij verwerken, los van een verzoek.
 *
 * Wordt gebruikt door `verify:crash-recovery` om na te bootsen wat er bij een
 * herstart gebeurt, en is daarnaast bruikbaar als losse taak wanneer een
 * gebeurtenis is blijven staan doordat het proces wegviel.
 */
async function main(): Promise<void> {
  const uitkomst = await processOutbox(200);
  console.log(
    `${uitkomst.processed} gebeurtenissen bekeken, ${uitkomst.delivered} meldingen bezorgd, ` +
      `${uitkomst.failed} mislukt.`,
  );
}

main().catch((fout) => {
  console.error(fout);
  process.exit(1);
});
