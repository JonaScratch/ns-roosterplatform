import "server-only";
import { localConfigFromEnv, localModel } from "@/server/agent/model/local";
import type { ChatModel, PlanRequest } from "@/server/agent/model/types";

/**
 * Sandboxvarianten van Lyra's systeeminstructie (§14 van de opdracht).
 *
 * ## Waarom dit alleen de systeeminstructie raakt, in v0.1
 *
 * De hoofdapp heeft nu één gecontroleerde koppeling voor experimenten:
 * `LocalModelConfig.systemPromptOverride` (`src/server/agent/model/local.ts`)
 * en `askAgent({ modelOverride })` (`src/server/agent/agent.ts`). Beide zijn
 * additief en productiecode zet ze nooit. Tool-routinghints, contextbeleid en
 * retrievalstrategie leven op dit moment in dezelfde systeeminstructie-tekst
 * (`systeeminstructie()` in local.ts) en zijn dus al gedeeltelijk te testen via
 * een prompt-variant; een apart hook-punt per beleidslaag (bijvoorbeeld een
 * eigen contextresolver-variant) staat als vervolgwerk in
 * demo-room/docs/ARCHITECTURE.md.
 *
 * Een variant is een pure tekstfunctie: (basisinstructie, request) → nieuwe
 * instructie. `CONTROL` levert de basis ongewijzigd terug, dus een run met
 * `CONTROL` is bewijsbaar identiek aan productiegedrag.
 */

export interface PromptVariant {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly category: "PROMPT" | "TOOL_ROUTING" | "CONTEXT_POLICY";
  /**
   * De letterlijke, vaste tekst die deze variant toevoegt — `null` voor
   * `CONTROL`. Dit is ook precies wat `safePublish.ts` bij publicatie naar
   * `NS_PRODUCTION_PROMPT_FILE` schrijft: wat hier getest is, is wat live
   * gaat, woord voor woord, nooit een parafrase achteraf.
   */
  readonly productionText: string | null;
  readonly transform: (basis: string, request: PlanRequest) => string;
  /** Alleen bij een gegenereerde kandidaat: welke zwakte, met welke strategie (lessons.ts leert per paar). */
  readonly hypothesis?: { readonly dimensie: string; readonly strategie: string; /** Interventieklasse (develop/interventies.ts). */ readonly familie?: string };
}

function vasteTekstVariant(input: { id: string; label: string; description: string; category: PromptVariant["category"]; productionText: string }): PromptVariant {
  return { ...input, transform: (basis) => `${basis}\n\n${input.productionText}` };
}

export const CONTROL: PromptVariant = {
  id: "control",
  label: "Controle (huidige productie-instructie)",
  description: "Geen wijziging. Dit is de meetlat waar elke variant tegen wordt gehouden.",
  category: "PROMPT",
  productionText: null,
  transform: (basis) => basis,
};

export const VARIANT_TOOL_HINT_HARDER: PromptVariant = vasteTekstVariant({
  id: "variant-a-tool-hint",
  label: "Variant A — dringender toolgebruik vóór oordeel",
  description:
    "Hypothese: bij vage klachten en 'is dit eerlijk?'-achtige vragen slaat het model soms het opzoeken over. Deze variant herhaalt de eis dwingender, vlak vóór de planinstructie.",
  category: "TOOL_ROUTING",
  productionText:
    "HERHALING, want dit gaat weleens mis: je MAG NOOIT een oordeel geven over een rooster, regel of verdeling zonder eerst een tool te hebben aangeroepen die dat oordeel onderbouwt. Twijfel je of een tool nodig is? Roep hem dan aan.",
});

export const VARIANT_EXPLICIT_UNCERTAINTY: PromptVariant = vasteTekstVariant({
  id: "variant-b-uncertainty",
  label: "Variant B — expliciete onzekerheidsformulering",
  description:
    "Hypothese: 'niet vast te stellen' wordt soms vermeden ten gunste van een voorzichtig geformuleerd maar feitelijk giswerk. Deze variant geeft het model een concrete zin om te gebruiken.",
  category: "PROMPT",
  productionText:
    'Als je het antwoord niet met een toolresultaat kunt onderbouwen, gebruik dan letterlijk de formulering "dat kan ik niet vaststellen" — geen gehedgede gok ("waarschijnlijk...", "vermoedelijk...").',
});

export const PROMPT_VARIANTS: readonly PromptVariant[] = [CONTROL, VARIANT_TOOL_HINT_HARDER, VARIANT_EXPLICIT_UNCERTAINTY];

export function findPromptVariant(id: string): PromptVariant | null {
  return PROMPT_VARIANTS.find((v) => v.id === id) ?? null;
}

/**
 * Bouwt een `ChatModel` voor deze variant, via dezelfde `localModel()` die
 * productie gebruikt — alleen met de systeeminstructie vervangen. Faalt
 * hard (geen stille terugval) als er geen lokaal model is ingesteld: een
 * variant vergelijken met de stub zou taalvaardigheid meten die er niet is.
 *
 * ## Waarom dit de productieoverride niet zomaar wegveegt
 *
 * `localConfigFromEnv()` kan al een gepubliceerde productievariant instellen
 * (`systemPromptOverride`, gelezen van `NS_PRODUCTION_PROMPT_FILE`). Een
 * nieuwe kandidaat wordt daar bovenop getest, nooit in plaats van: anders zou
 * een tweede promotie de eerste stilletjes ongedaan maken tijdens het meten,
 * en zou PRE (huidige productie) een oneerlijke voorsprong hebben op POST
 * (kandidaat zonder de eerder gepubliceerde verbetering). Dit is ook de reden
 * dat elke promotie precies de gebenchmarkte kandidaat is en nooit een
 * ongeteste optelsom van experimenten.
 */
export function chatModelForVariant(variant: PromptVariant): ChatModel {
  const config = localConfigFromEnv();
  if (!config) {
    throw new Error(
      "Geen lokaal model ingesteld (NS_LOCAL_LLM_URL / NS_LOCAL_LLM_MODEL). " +
        "Variantvergelijking heeft een echt taalmodel nodig — de stub meet geen taalvaardigheid (zie model/stub.ts).",
    );
  }
  const productieOverride = config.systemPromptOverride;
  return localModel({
    ...config,
    systemPromptOverride: (basis, request) => variant.transform(productieOverride ? productieOverride(basis, request) : basis, request),
  });
}
