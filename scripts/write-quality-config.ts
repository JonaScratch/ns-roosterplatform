import { writeFileSync } from "node:fs";
import path from "node:path";
import { QUALITY_MODEL_V1, QUALITY_MODEL_V2, QUALITY_MODEL_V3 } from "@/domain/quality-model";

/**
 * Schrijft de kwaliteitsmodellen als JSON naar configs/. Eén bron: quality-model.ts.
 *
 * Beide versies blijven bestaan: kandidaten dragen de versie waarmee ze zijn
 * beoordeeld, en een oude uitkomst moet met de oude maat na te rekenen zijn.
 */
for (const model of [QUALITY_MODEL_V1, QUALITY_MODEL_V2, QUALITY_MODEL_V3]) {
  const doel = path.resolve(__dirname, "..", "configs", `${model.version}.json`);
  writeFileSync(doel, `${JSON.stringify(model, null, 2)}\n`, "utf8");
  console.log(doel);
}
