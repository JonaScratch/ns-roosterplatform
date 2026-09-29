import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterStatus } from "./after-status";

/**
 * Een bestaande AFTER-run opnieuw verifiëren met de huidige statusregel, zonder
 * iets van die run te wijzigen: `AFTER-VERIFICATION.json` blijft zoals het
 * gemeten is (bewijsmateriaal), de uitkomst komt in een eigen bestand
 * `AFTER-REVERIFICATION.json` ernaast, met de oorspronkelijke status erbij.
 *
 *   npx tsx scripts/lyra-master/reverify-after.ts --run 20260929-193436
 */

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const WORTEL = path.resolve(__dirname, "..", "..");

function main(): void {
  const i = process.argv.indexOf("--run");
  const runId = i >= 0 ? process.argv[i + 1] : null;
  if (!runId) throw new Error("gebruik: --run <runId>");
  const map = path.join(WORTEL, "docs", "lyra-knowledge", "benchmarks", "after", runId);
  const bron = path.join(map, "AFTER-VERIFICATION.json");
  const doel = path.join(map, "AFTER-REVERIFICATION.json");
  if (!existsSync(bron)) throw new Error(`${bron} bestaat niet`);
  if (existsSync(doel)) throw new Error(`${doel} bestaat al; niet overschreven`);
  const v = JSON.parse(readFileSync(bron, "utf8")) as Json;

  const hashes = (v.rawArtifacts as { pad: string; sha256: string }[]).map((a) => {
    const p = path.resolve(map, a.pad);
    const echt = existsSync(p) ? createHash("sha256").update(readFileSync(p)).digest("hex") : null;
    return { pad: a.pad, verwacht: a.sha256, klopt: echt === a.sha256 };
  });
  const aggregaatAanwezig = existsSync(path.join(map, "aggregate.json"));
  const uitkomst = afterStatus({
    replicaten: v.replicates,
    modelBereikbaar: v.model?.reachable === true,
    stubUit: v.stubExplicitlyDisabled === true,
    alleReplicatenOk: v.allReplicatesCompleted === true,
    aggregatieOk: v.gradingCompleted === true && aggregaatAanwezig,
    ruweBestandsnamen: hashes.filter((h) => h.klopt).map((h) => path.posix.basename(h.pad)),
    extensieGedraaid: v.extension?.ranOk === true,
  });
  const kapot = hashes.filter((h) => !h.klopt).map((h) => `hash klopt niet of bestand ontbreekt: ${h.pad}`);

  const uit = {
    schema: "ns-lyra-master-after-reverification/1",
    runId,
    reverifiedAt: new Date().toISOString(),
    originalStatus: v.status,
    status: kapot.length === 0 ? uitkomst.status : "FAIL",
    failReasons: [...kapot, ...uitkomst.redenen],
    hashesChecked: hashes.length,
    hashesOk: hashes.filter((h) => h.klopt).length,
    explanation:
      v.status !== uitkomst.status
        ? "De oorspronkelijke status kwam uit de oude telling ruweBestanden.length === replicates * 2; sinds commit 8c19d91 bevat die lijst ook de extensiebestanden (4 per replicaat), zodat elke volledige run FAIL gaf. Zie scripts/lyra-master/after-status.ts."
        : "Oorspronkelijke en herberekende status zijn gelijk.",
  };
  writeFileSync(doel, `${JSON.stringify(uit, null, 2)}\n`);
  console.log(JSON.stringify(uit, null, 2));
}

main();
