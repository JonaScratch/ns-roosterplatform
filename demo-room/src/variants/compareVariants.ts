import "server-only";
import { runSuite } from "../benchmark/run";
import { beoordeelPromotie } from "../promotion/proposal";
import type { PromotionProposal } from "../types";
import { CONTROL, type PromptVariant, chatModelForVariant } from "./promptVariants";

/**
 * Eén variant tegen de controle houden, op dezelfde suite (§14/§16/§29).
 *
 * Beide kanten lopen door exact dezelfde `askAgent()`-keten — context,
 * rechten, tools, grondingscontrole — alleen de systeeminstructie verschilt.
 * Zo meet dit de variant en niet toevallige verschillen in de rest van de
 * keten.
 */
export async function compareVariantToControl(
  variant: PromptVariant,
  suite: "dev" | "holdout" | "hidden",
  runLabel: string,
): Promise<{ readonly controlResult: Awaited<ReturnType<typeof runSuite>>; readonly variantResult: Awaited<ReturnType<typeof runSuite>>; readonly proposal: PromotionProposal }> {
  const controlModel = variant.id === CONTROL.id ? undefined : chatModelForVariant(CONTROL);
  const controlResult = await runSuite(suite, { runLabel: `${runLabel}-control`, modelName: "control", modelOverride: controlModel });

  const variantModel = chatModelForVariant(variant);
  const variantResult = await runSuite(suite, { runLabel: `${runLabel}-${variant.id}`, modelName: variant.id, modelOverride: variantModel });

  const proposal = beoordeelPromotie({
    change: variant.label,
    reason: variant.description,
    pre: { passRate: controlResult.passRate },
    post: { passRate: variantResult.passRate },
    holdout: null,
  });

  return { controlResult, variantResult, proposal };
}
