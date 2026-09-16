import { LOCATIONS_WITH_LOCAL_RULESET } from "../../ruleset/regio-west-2026";
import type { Evaluation } from "../evaluation";
import type { AssignmentRequest } from "../subject";

/**
 * Geldt er voor deze standplaats een ingericht lokaal regelkader?
 *
 * ## Waarom het ontbreken hiervan blokkeert
 *
 * De CAO geldt overal; het regionale kader geldt in de regio; het lokale kader
 * geldt op één standplaats. Alleen voor Dordrecht is dat lokale kader
 * aangeleverd. Voor Rotterdam, Amsterdam of Zwolle weten we het simpelweg niet:
 * hun werkonderbreking kan anders zijn, hun roostergrootte kan een andere deler
 * hebben, hun afspraken over reserve kunnen afwijken.
 *
 * Twee uitwegen liggen voor de hand en zijn allebei fout.
 *
 * De eerste is: dan gelden alleen de CAO-regels. Dat leest als voorzichtig,
 * maar het is het tegendeel — je verklaart daarmee dat er geen lokale
 * beperkingen zijn, en dat is een bewering die niemand heeft gedaan.
 *
 * De tweede is: neem dan de regels van Dordrecht. Dat is nog erger. Dan rijdt
 * Rotterdam op de afspraken van een andere standplaats, en niets in het scherm
 * verraadt dat.
 *
 * Daarom: geen kader betekent niet te beoordelen. Dat is zichtbaar, het is op
 * te lossen door het kader aan te leveren, en het is niet stil.
 */
export function checkLocationRuleset(request: AssignmentRequest, evaluation: Evaluation): void {
  const depot = request.subject.depot;
  if (LOCATIONS_WITH_LOCAL_RULESET.includes(depot)) {
    return;
  }

  evaluation.blockOnMissing({
    ruleId: "LOCAL_RULESET_NOT_CONFIGURED",
    title: `Lokaal regelkader voor standplaats ${depot}`,
    status: "NOT_SUPPLIED",
    reason:
      `Voor standplaats ${depot} is geen lokaal regelkader aangeleverd. De CAO en het ` +
      "regionale kader zijn toegepast, maar wat er lokaal aanvullend geldt — " +
      "werkonderbreking, roostergrootte, lokale afspraken — is onbekend. Er wordt niets " +
      `overgenomen van een andere standplaats. Ingericht: ${LOCATIONS_WITH_LOCAL_RULESET.join(", ")}.`,
  });
}
