import { REBUILD_GOAL_LABELS, type RebuildGoal } from "@/server/optimizer/objective-weights";

/**
 * Een voorstel in woorden.
 *
 * Stond in de stub. Bij de doorloop van fase 9 bleek waarom dat niet houdbaar
 * is: het lokale model kon sinds kort wél een voorstel plannen, maar de tekst
 * ervan stond in de andere adapter — dus verdween het voorstel tussen plannen en
 * antwoorden. Wat een voorstel is en hoe het wordt verwoord, hoort één keer te
 * bestaan; welk model het bedacht, doet er niet toe.
 */

interface VoorstelVorm {
  readonly kind: string;
  readonly strategyLabel: string;
  readonly searchMode: string;
  readonly goals: readonly string[];
  readonly layerTwoGoals?: readonly { readonly goal: string; readonly label: string }[];
}

const MINUTEN: Readonly<Record<string, number>> = { FAST: 2, NORMAL: 5, DEEP: 15, EXTENSIVE: 30 };

export function beschrijfVoorstel(voorstel: Record<string, unknown>): string {
  const p = voorstel as unknown as VoorstelVorm;

  // Wat de gebruiker vroeg en wat de commissie er als laag 2 bij heeft gezet,
  // zijn twee verschillende dingen. Ze op één hoop gooien zou de strategie de
  // eer geven van een doel dat ergens anders vandaan komt.
  const laag2 = (p.layerTwoGoals ?? []).map((g) => g.label);
  const laag2Codes = new Set((p.layerTwoGoals ?? []).map((g) => g.goal));
  const doelen = (p.goals ?? []).filter((g) => !laag2Codes.has(g)).map((g) => REBUILD_GOAL_LABELS[g as RebuildGoal] ?? g);
  const minuten = MINUTEN[p.searchMode] ?? 5;

  const wat =
    p.kind === "RESEARCH"
      ? // Niveau C: geen losse opdracht maar een reeks rondes, met een budget en
        // een conclusie. Dat verschil hoort in de zin te staan.
        `Voorstel: ik ga hier zelfstandig aan rekenen, gericht op ${doelen.join(" en ")}. ` +
        "Na elke ronde meet ik of het beter is geworden en beslis ik of een volgende ronde zin heeft. " +
        "Ik stop vanzelf bij het rondebudget of zodra twee rondes niets opleveren, en zeg dan wat ik heb gevonden — " +
        "ook als dat is dat er niets beters is."
      : p.kind === "REBUILD"
        ? `Voorstel: deze kandidaat herbouwen met de nadruk op ${doelen.join(" en ")}.`
        : // Bij een nieuwe generatie stuurt de strategie, niet een los doel. Dat
          // verschil hoort er te staan: anders belooft het voorstel een knop die
          // er niet is.
          `Voorstel: een nieuwe reeks kandidaten laten maken met strategie "${p.strategyLabel}"` +
          (doelen.length > 0
            ? `. Die strategie stuurt op ${doelen.join(" en ")}; bij een nieuwe generatie gaat dat via de strategie en niet via een apart doel.`
            : ".");

  return (
    wat +
    (laag2.length > 0 ? ` Daarbij gelden de extra doelen die de commissie voor dit project heeft gezet: ${laag2.join(" en ")}.` : "") +
    ` Dat kost ongeveer ${minuten} minuten rekentijd. Er wordt niets vervangen en niets gepubliceerd:` +
    " het resultaat komt als kandidaat naast de bestaande te staan, en de validator beoordeelt hem onafhankelijk." +
    // Een voorstel dat alleen succes beschrijft, wekt een verwachting die de
    // zoekmachine niet kan waarmaken. Bij doelen die elkaar tegenspreken is
    // "niets beters" de eerlijke uitkomst, en die hoort vooraf genoemd te worden
    // en niet pas als teleurstelling achteraf.
    " Het kan ook zijn dat er niets beters uitkomt dan wat er nu ligt; dan is dat de uitkomst, en niet een mislukking." +
    " Zal ik dat doen?"
  );
}
