import { writeFileSync } from "node:fs";
import path from "node:path";
import { ADAPTIVE_CONFIG } from "@/server/generation/adaptive/config";
import { STRATEGY_WEIGHTS } from "@/server/optimizer/objective-weights";
import { CURRENT_QUALITY_MODEL } from "@/domain/quality-model";

/**
 * De hele zoekmachine als één leesbaar bestand.
 *
 * Wie later wil weten waarmee een kandidaat uit v1.0.4 is gemaakt, moet dat
 * kunnen nalezen zonder de broncode te doorzoeken: de rekentijdmodi, de
 * reparatie- en diversiteitsdrempels, de kwaliteitspoort én de zachte
 * gewichten per strategie. Eén bron blijft de TypeScript; dit is de afdruk, en
 * een test houdt beide gelijk.
 */
// Eén bestand per engineversie: een oudere afdruk blijft staan als verslag van
// waarmee destijds is gemeten.
const doel = path.resolve(
  __dirname,
  "..",
  "configs",
  `optimizer-config-${ADAPTIVE_CONFIG.version.replace("adaptive-", "v")}.json`,
);
const inhoud = {
  version: ADAPTIVE_CONFIG.version,
  qualityModelVersion: CURRENT_QUALITY_MODEL.version,
  adaptive: ADAPTIVE_CONFIG,
  baseWeights: STRATEGY_WEIGHTS,
};
writeFileSync(doel, `${JSON.stringify(inhoud, null, 2)}\n`, "utf8");
console.log(doel);
