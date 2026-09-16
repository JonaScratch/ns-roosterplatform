import { pdfPages } from "@/server/import/pdf-text";

/**
 * De artikelen van de CAO, uit de CAO zelf.
 *
 * ## Waartoe dit dient
 *
 * Elke regel in het regelbestand draagt een artikelverwijzing mee: "artikel 98,
 * dagelijkse rust". Zo'n verwijzing is een bewering, en tot nu toe een
 * onbewezen bewering — er stond nergens iets dat haar kon tegenspreken. Met de
 * aangeleverde CAO kan dat wel: bestaat artikel 98, en gaat het over wat wij
 * zeggen dat het over gaat?
 *
 * ## Waarom de inhoudsopgave en niet de artikelkoppen
 *
 * In de opgemaakte tekst is een artikelkop niet van gewone tekst te
 * onderscheiden: er staat geen "Artikel 98" boven, alleen een nummer en een
 * titel in een ander lettertype, en dat lettertype overleeft de tekstextractie
 * niet. De inhoudsopgave heeft die vorm wél expliciet — nummer, titel,
 * paginanummer — en is daarmee de betrouwbaarste plek om de nummering uit te
 * lezen.
 *
 * De keerzijde staat hieronder in `CaoArticle.confidence`: dit levert de titel
 * van een artikel, niet zijn inhoud. Dat een regel naar het juiste artikel
 * verwijst, is daarmee te controleren; dat de wáárde van die regel klopt, niet.
 * Die stap vraagt een mens en staat als `FORMALLY_VALIDATED` in
 * `docs/rule-coverage.md` — op false.
 */

export interface CaoArticle {
  /** "98", of "90a" bij een tussengevoegd artikel. */
  readonly number: string;
  readonly title: string;
  /** De pagina in het document zoals de inhoudsopgave die noemt. */
  readonly page: number | null;
}

/** Het aantal koppen dat een geldige inhoudsopgave minstens moet opleveren. */
const MINIMUM_ARTIKELEN = 50;

/**
 * De artikelen uit de inhoudsopgave.
 *
 * Levert een lege lijst wanneer er geen bruikbare inhoudsopgave in staat. Dat
 * is uitdrukkelijk geen halve lijst: een reconciliatie tegen een half gelezen
 * inhoudsopgave zou elk niet-gevonden artikel als een fout in het regelbestand
 * aanwijzen, terwijl de fout in de lezing zit.
 */
export function caoArticles(bytes: Buffer): readonly CaoArticle[] {
  const regels = pdfPages(bytes)
    .join("\n")
    .split("\n")
    .map((regel) => regel.trim())
    .filter((regel) => regel.length > 0);

  const gevonden = new Map<string, CaoArticle>();

  for (let index = 0; index < regels.length; index += 1) {
    const regel = regels[index];

    // Vorm 1: nummer en titel op één regel — "90a Doorwerken oudere werknemer".
    const samen = /^(\d{1,3}[a-z]?)\s+(\D.{2,80})$/.exec(regel);
    if (samen && !gevonden.has(samen[1])) {
      const titel = schoon(samen[2]);
      if (bruikbareTitel(titel)) {
        gevonden.set(samen[1], {
          number: samen[1],
          title: titel,
          page: paginaNa(regels, index + 1),
        });
      }
      continue;
    }

    // Vorm 2: nummer op een eigen regel, titel op de volgende.
    const alleen = /^(\d{1,3}[a-z]?)$/.exec(regel);
    if (!alleen || gevonden.has(alleen[1])) {
      continue;
    }
    const titel = schoon(regels[index + 1] ?? "");
    if (bruikbareTitel(titel)) {
      gevonden.set(alleen[1], {
        number: alleen[1],
        title: titel,
        page: paginaNa(regels, index + 2),
      });
    }
  }

  if (gevonden.size < MINIMUM_ARTIKELEN) {
    return [];
  }

  return [...gevonden.values()].sort(
    (a, b) => Number.parseInt(a.number, 10) - Number.parseInt(b.number, 10),
  );
}

/** Zoekt één artikel op. Null wanneer het er niet in staat. */
export function findCaoArticle(
  articles: readonly CaoArticle[],
  number: string,
): CaoArticle | null {
  // Een verwijzing als "98 lid 3" wijst naar artikel 98.
  const kern = /^(\d{1,3}[a-z]?)/.exec(number.trim());
  if (!kern) {
    return null;
  }
  return articles.find((artikel) => artikel.number === kern[1]) ?? null;
}

/**
 * De tekst die bij een artikel hoort, met de pagina waarop zij staat.
 *
 * ## Waarom de grenzen ruim zijn
 *
 * De artikelen over arbeids- en rusttijden zijn opgemaakt als tabellen met de
 * kolommen "Lid / Onderwerp / Norm / Status". Zo'n tabel loopt door over de
 * paginagrens, en de inhoudsopgave noemt alleen de pagina waarop een artikel
 * begint. Het einde van artikel 98 staat daardoor op de pagina waar de
 * inhoudsopgave artikel 99 laat beginnen.
 *
 * Het bereik loopt daarom tot en met de beginpagina van het volgende artikel.
 * Dat overlapt bewust: liever een norm die aan twee artikelen wordt toegekend
 * dan een norm die aan geen van beide wordt toegekend en daardoor "niet in de
 * bron gevonden" heet.
 */
export interface CaoArticleBody {
  readonly number: string;
  readonly title: string;
  readonly firstPage: number;
  readonly lastPage: number;
  readonly text: string;
}

export function caoArticleBodies(bytes: Buffer): readonly CaoArticleBody[] {
  const artikelen = caoArticles(bytes).filter((artikel) => artikel.page !== null);
  const paginas = pdfPages(bytes);
  const uit: CaoArticleBody[] = [];

  for (let index = 0; index < artikelen.length; index += 1) {
    const artikel = artikelen[index];
    const volgende = artikelen[index + 1];
    const eerste = artikel.page as number;
    const laatste = Math.max(eerste, volgende?.page ?? eerste + 1);

    // De inhoudsopgave telt gedrukte pagina's; `pdfPages` telt vanaf nul.
    const tekst = paginas.slice(eerste - 1, laatste).join("\n");
    uit.push({
      number: artikel.number,
      title: artikel.title,
      firstPage: eerste,
      lastPage: laatste,
      text: tekst,
    });
  }
  return uit;
}

/**
 * De schrijfwijzen waarin een getal in de CAO kan staan.
 *
 * De CAO schrijft halve uren als "9 ½" en niet als "9,5" of "9.5". Wie alleen
 * op het decimale getal zoekt, vindt de norm niet en concludeert dat zij niet
 * in de bron staat — een conclusie die precies verkeerd om is.
 */
export function numberNotations(value: number): readonly string[] {
  const heel = Math.floor(value);
  const rest = value - heel;
  const vormen = new Set<string>();

  if (rest === 0) {
    vormen.add(String(heel));
  } else if (Math.abs(rest - 0.5) < 1e-9) {
    vormen.add(`${heel} ½`);
    vormen.add(`${heel}½`);
    vormen.add(`${heel},5`);
    vormen.add(`${heel}.5`);
  } else {
    vormen.add(String(value));
    vormen.add(String(value).replace(".", ","));
  }
  return [...vormen];
}

/** Staat dit getal in deze tekst? */
export function containsNumber(text: string, value: number): boolean {
  const genormaliseerd = text.replace(/\s+/g, " ");
  return numberNotations(value).some((vorm) => {
    // Woordgrenzen, anders vindt "7" ook de 7 in "17" en "27".
    const patroon = new RegExp(
      `(?<![\\d,.])${vorm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\d])`,
    );
    return patroon.test(genormaliseerd);
  });
}

function schoon(waarde: string): string {
  return waarde.replace(/\s*[,.]$/, "").trim();
}

/**
 * Ziet dit eruit als een artikeltitel?
 *
 * De inhoudsopgave staat vol losse paginanummers en hoofdstukregels. Zonder
 * deze zeef zou "27" de titel van artikel 97 worden, en dan lijkt elke
 * verwijzing te kloppen zolang het nummer maar bestaat.
 */
function bruikbareTitel(titel: string): boolean {
  return (
    titel.length >= 3 &&
    titel.length <= 90 &&
    /[a-zA-Z]/.test(titel) &&
    !/^\d/.test(titel) &&
    !/^(Bijlage|Hoofdstuk|Inhoudsopgave|CAO NS)\b/i.test(titel)
  );
}

function paginaNa(regels: readonly string[], vanaf: number): number | null {
  for (let index = vanaf; index < Math.min(vanaf + 2, regels.length); index += 1) {
    if (/^\d{1,3}$/.test(regels[index])) {
      return Number(regels[index]);
    }
  }
  return null;
}
