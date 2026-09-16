import { RULE } from "@/server/rules-engine/ruleset/rule-ids";
import { activeRuleset } from "@/server/rules-engine/ruleset/index";
import { BLOCKING_STATUSES, type RuleDefinition } from "@/server/rules-engine/ruleset/types";

/**
 * Controleert het regelbestand zelf.
 *
 * ## Waarom een regelbestand een eigen controle nodig heeft
 *
 * De validator kan onberispelijk werken en toch niets waard zijn wanneer een
 * regel-id nergens in het bestand staat: `require()` levert dan netjes "onbekend"
 * en de beslissing blokkeert, maar niemand ziet dat er een regel ontbreekt die
 * er hoort te zijn. Dit script maakt van dat stille gat een luide fout.
 *
 * Draaien met: npm run verify:rules
 */

interface Bevinding {
  readonly ernst: "FOUT" | "SIGNAAL";
  readonly tekst: string;
}

function main(): void {
  const ruleset = activeRuleset();
  const bevindingen: Bevinding[] = [];

  const bekend = new Set(ruleset.rules.map((rule) => rule.id));
  const gebruikt = Object.values(RULE);

  // 1. Elk id dat de code kent, hoort in het bestand te staan.
  for (const id of gebruikt) {
    if (!bekend.has(id)) {
      bevindingen.push({
        ernst: "FOUT",
        tekst: `Regel-id ${id} wordt door de code gebruikt maar staat niet in het regelbestand.`,
      });
    }
  }

  // 2. Andersom: een regel die niemand opvraagt, doet niets.
  for (const id of bekend) {
    if (!gebruikt.includes(id as (typeof gebruikt)[number])) {
      bevindingen.push({
        ernst: "SIGNAAL",
        tekst: `Regel ${id} staat in het bestand maar wordt door geen enkele controle opgevraagd.`,
      });
    }
  }

  // 3. Herkomst is verplicht: zonder bron is een regel een bewering zonder grond.
  for (const rule of ruleset.rules) {
    for (const [veld, waarde] of [
      ["titel", rule.title],
      ["rationale", rule.rationale],
      ["document", rule.source.document],
      ["ingangsdatum", rule.source.effectiveFrom],
    ] as const) {
      if (!waarde || waarde.trim().length === 0) {
        bevindingen.push({ ernst: "FOUT", tekst: `Regel ${rule.id} mist ${veld}.` });
      }
    }
    if (rule.rationale.length < 20) {
      bevindingen.push({
        ernst: "SIGNAAL",
        tekst: `Regel ${rule.id} heeft een erg korte toelichting; de catalogus is voor mensen.`,
      });
    }
  }

  // 4. Dubbele definities met dezelfde reikwijdte en periode zijn dubbelzinnig.
  const sleutels = new Map<string, number>();
  for (const rule of ruleset.rules) {
    const sleutel = `${rule.id}|${JSON.stringify(rule.scope)}|${rule.source.effectiveFrom}`;
    sleutels.set(sleutel, (sleutels.get(sleutel) ?? 0) + 1);
  }
  for (const [sleutel, aantal] of sleutels) {
    if (aantal > 1) {
      bevindingen.push({
        ernst: "FOUT",
        tekst: `${aantal} definities met dezelfde reikwijdte en ingangsdatum: ${sleutel}.`,
      });
    }
  }

  // 5. Een waarde die er wel is maar niet gebruikt mag worden, is een valkuil:
  //    hij nodigt uit om de status te negeren.
  for (const rule of ruleset.rules) {
    if (rule.value !== null && BLOCKING_STATUSES.includes(rule.status)) {
      bevindingen.push({
        ernst: "SIGNAAL",
        tekst:
          `Regel ${rule.id} heeft waarde ${rule.value} maar status ${rule.status}; ` +
          "de waarde wordt niet gebruikt.",
      });
    }
    if (rule.value === null && !BLOCKING_STATUSES.includes(rule.status)) {
      bevindingen.push({
        ernst: "FOUT",
        tekst:
          `Regel ${rule.id} heeft geen waarde maar een status die niet blokkeert ` +
          `(${rule.status}). Zo zou een ontbrekende waarde stil worden overgeslagen.`,
      });
    }
  }

  // 6. Ontbrekende pakketten moeten zeggen wát ze tegenhouden.
  for (const pakket of ruleset.missingPackages) {
    if (pakket.blocks.length === 0) {
      bevindingen.push({
        ernst: "FOUT",
        tekst: `Ontbrekend pakket ${pakket.id} noemt geen enkele beslissing die het blokkeert.`,
      });
    }
  }

  rapporteer(ruleset, bevindingen);

  if (bevindingen.some((bevinding) => bevinding.ernst === "FOUT")) {
    process.exitCode = 1;
  }
}

function rapporteer(
  ruleset: ReturnType<typeof activeRuleset>,
  bevindingen: readonly Bevinding[],
): void {
  console.log("CONTROLE VAN HET REGELBESTAND");
  console.log("────────────────────────────────────────────────────────────");
  console.log(`Versie                 ${ruleset.version}`);
  console.log(`Modus                  ${ruleset.mode}`);
  console.log(`Juridische status      ${ruleset.legalStatus}`);
  console.log(`Regels                 ${ruleset.rules.length}`);
  console.log(`Ontbrekende pakketten  ${ruleset.missingPackages.length}`);

  console.log("\nPer status:");
  telling(ruleset.rules, (rule) => rule.status);
  console.log("\nPer bronlaag:");
  telling(ruleset.rules, (rule) => rule.source.layer);
  console.log("\nPer soort:");
  telling(ruleset.rules, (rule) => rule.category);

  const gevalideerd = ruleset.rules.filter((rule) => rule.status === "VALIDATED").length;
  console.log(
    `\nGevalideerde regels    ${gevalideerd} van ${ruleset.rules.length}` +
      (gevalideerd === 0
        ? " — er is nog geen enkele regel door NS bevestigd."
        : ""),
  );

  const fouten = bevindingen.filter((bevinding) => bevinding.ernst === "FOUT");
  const signalen = bevindingen.filter((bevinding) => bevinding.ernst === "SIGNAAL");

  if (fouten.length > 0) {
    console.log(`\nFouten (${fouten.length}):`);
    for (const fout of fouten) {
      console.log(`  ${fout.tekst}`);
    }
  }
  if (signalen.length > 0) {
    console.log(`\nSignalen (${signalen.length}):`);
    for (const signaal of signalen) {
      console.log(`  ${signaal.tekst}`);
    }
  }
  if (bevindingen.length === 0) {
    console.log("\nHet regelbestand is structureel in orde.");
  }

  console.log("\n────────────────────────────────────────────────────────────");
  console.log("Production-safe: NO — simulation/development only");
}

function telling(
  rules: readonly RuleDefinition[],
  sleutel: (rule: RuleDefinition) => string,
): void {
  const counts = new Map<string, number>();
  for (const rule of rules) {
    const key = sleutel(rule);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [key, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(4)}  ${key}`);
  }
}

main();
