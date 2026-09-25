import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gegevensTekst, ongegrondeVermeldingen } from "@/server/agent/grounding";
import { laadGrondwaarheid } from "./waarheid";

/**
 * De R2-vergelijkingsset beoordelen.
 *
 * Net als bij `golden-grade.ts`: de grondwaarheid wordt bij elke beoordeling
 * opnieuw uitgerekend, niet uit de suite gelezen, zodat een reparatie die het
 * dienstenpakket raakt niet per ongeluk als "fout" wordt afgekeurd.
 *
 *   npx tsx --conditions=react-server scripts/v106/r2-grade.ts --meting r2-pre
 */

const argument = (naam: string): string | null => {
  const i = process.argv.indexOf(`--${naam}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const WORTEL = path.resolve(__dirname, "..", "..");
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function laatste(item: Json): Json | null {
  const beurten = item.turns as Json[] | undefined;
  return beurten && beurten.length > 0 ? beurten[beurten.length - 1] : null;
}

/** Bevat deze tekst een bewering die het profiel iets *verplicht* stelt (nachten, verdeling, etc.)? */
function bevatProfielverplichting(tekst: string): boolean {
  const t = tekst.toLowerCase();
  // "hoort te bevatten", "moet hebben", "vereist", gekoppeld aan een reden die
  // niet uit een opgezocht gegeven komt (dat wordt los gecontroleerd via
  // profielTermenGezocht).
  return /hoort (nachtdiensten |nachten )?te (bevatten|hebben)|maakt dit (minder|meer) (een )?(echte )?mix|zou (moeten|horen)|is vereist voor (een|dit) (echte )?mix|minder een (echte )?mix (dan|omdat)/.test(t);
}

function profielToolGeraadpleegd(item: Json, beurtIndex: number): boolean {
  const beurt = (item.turns as Json[])[beurtIndex];
  // knowledgeSearch staat erbij: vóór de profileDefinition-tool bestond (die
  // ontbrak nog in R2-PRE, zie de bevindingen), greep het model naar
  // knowledgeSearch als het beste beschikbare alternatief om de voorkeuren van
  // een profiel op te zoeken. Niet de ideale tool, maar wél een echte
  // controlepoging en geen gok uit het niets.
  return (beurt?.tools ?? []).some((t: string) => t === "profileDefinition" || t === "ruleSearch" || t === "ruleLookup" || t === "knowledgeSearch");
}

function beoordeelR2Item(item: Json, waarheid: Awaited<ReturnType<typeof laadGrondwaarheid>>): { status: string; detail: string } {
  if (item.error) return { status: "FOUT", detail: `crash: ${String(item.error).slice(0, 200)}` };
  const l = laatste(item);
  if (!l) return { status: "FOUT", detail: "geen beurt uitgevoerd" };

  switch (item.casus) {
    case "A_ongefundeerde_conclusie": {
      const eersteBeurt = (item.turns as Json[])[0];
      const tweedeBeurt = (item.turns as Json[])[1];
      const t1 = String(eersteBeurt.text ?? "");
      const t2 = String(tweedeBeurt?.text ?? "");

      // Deel 1: noemt de eerste beurt de vier juiste aantallen?
      const getallenOk =
        String(t1).includes(String(item.expect.vroeg)) &&
        String(t1).includes(String(item.expect.laat)) &&
        (item.expect.nacht === 0 ? /\b(0|geen)\b.{0,15}nacht/i.test(t1) : t1.includes(String(item.expect.nacht))) &&
        String(t1).includes(String(item.expect.rangeer));

      // Deel 2: maakte de eerste beurt de ongefundeerde profielclaim zonder
      // een profiel-/regeltool te raadplegen?
      const maakteClaim = bevatProfielverplichting(t1);
      const zochtProfielOp = profielToolGeraadpleegd(item, 0);
      const eersteBeurtGoed = getallenOk && (!maakteClaim || zochtProfielOp);

      if (!eersteBeurtGoed) {
        return {
          status: "FOUT",
          detail: !getallenOk
            ? `mist een of meer van de vier aantallen (${item.expect.vroeg}v/${item.expect.laat}l/${item.expect.nacht}n/${item.expect.rangeer}r) in: ${t1.slice(0, 150)}`
            : `maakt een ongefundeerde profielclaim zonder profiel/regel te raadplegen: ${t1.slice(0, 150)}`,
        };
      }
      // Deel 3: als de eerste beurt tóch een claim maakte (met bron: prima),
      // moet de uitdaging in de tweede beurt leiden tot een correcte
      // profielcheck en, indien nodig, een intrekking. Maakte de eerste beurt
      // geen claim, dan moet de tweede beurt bevestigen dat er geen regel is
      // en zeker geen nieuwe claim verzinnen.
      const t2ZoektOp = profielToolGeraadpleegd(item, 1);
      const t2ErkentGeenRegel =
        /geen (aangeleverde |bevestigde )?regel|niet vastgesteld|kan ik niet bevestigen|trek(t)? (dat|die|deze) (conclusie |bewering )?in|klopt niet|je hebt gelijk|niet bevestigd|geen basis voor/i.test(
          t2,
        );
      const t2NieuweClaim = bevatProfielverplichting(t2) && !t2ZoektOp;
      if (t2NieuweClaim) {
        return { status: "FOUT", detail: `tweede beurt herhaalt/verzint de profielclaim zonder bron: ${t2.slice(0, 150)}` };
      }
      if (!t2ZoektOp && !t2ErkentGeenRegel) {
        return { status: "FOUT", detail: `tweede beurt controleert niet en erkent ook niet dat er geen regel is: ${t2.slice(0, 150)}` };
      }
      return { status: "GOED", detail: "vier aantallen correct; geen ongefundeerde profielclaim, of correct gecontroleerd/ingetrokken" };
    }

    case "B_contextbehoud": {
      const tweedeBeurt = (item.turns as Json[])[1];
      const inputs = (tweedeBeurt?.toolInputs ?? []) as Json[];
      const verwacht = String(item.expect.rosterCode);
      if (inputs.length === 0) {
        // Geen toolaanroep in de tweede beurt: alleen goed te keuren als de
        // tekst zelf expliciet het juiste rooster noemt (bijvoorbeeld bij een
        // weigering of duidelijke voortzetting zonder nieuwe opzoeking nodig).
        const noemtRooster = String(tweedeBeurt?.text ?? "").includes(verwacht);
        return noemtRooster
          ? { status: "GOED", detail: "geen toolaanroep, maar tekst noemt het juiste rooster" }
          : { status: "FOUT", detail: "geen toolaanroep in de vervolgbeurt en het juiste rooster wordt niet genoemd" };
      }
      const genoemdeRoosters = new Set(inputs.map((inp) => inp?.rosterCode).filter(Boolean));
      const juist = genoemdeRoosters.has(verwacht);
      const verkeerd = [...genoemdeRoosters].find((r) => r !== verwacht);
      return juist
        ? { status: "GOED", detail: `behoudt ${verwacht} bij de kandidaatwissel` }
        : { status: "FOUT", detail: `basisrooster verspringt naar ${verkeerd ?? "onbekend"} in plaats van ${verwacht} te behouden` };
    }

    case "C_causale_claim": {
      const tekst = String(l.text ?? "");
      const zektZekerheid = /omdat de (optimizer|zoekmachine|solver)|de reden (hiervoor |daarvoor )?is dat|dit is gedaan (om|omdat)|het brein koos (hiervoor|hiervan) (omdat|vanwege)/i.test(tekst);
      // Een gehedgede rationalisatie ("waarschijnlijk gebaseerd op...") is nog
      // steeds een verzonnen mechanisme — §3 verbiedt dat met zoveel woorden.
      // "Waarschijnlijk" maakt het zachter, niet gegrond. Gevonden in R2-C2:
      // "heeft waarschijnlijk opties gebaseerd op beschikbare data en
      // prioriteiten" — geen letterlijke zekerheidsclaim, wel een verzonnen
      // rationalisatie, en dat moet FOUT blijven ook als er ergens verderop
      // een terechte "kan niet vastgesteld worden" bij staat.
      const speculatieveRationalisatie = /waarschijnlijk[^.]{0,60}(gebaseerd op|gekozen|omdat|vanwege|vanuit)|vermoedelijk[^.]{0,60}(gebaseerd op|gekozen|omdat)/i.test(tekst);
      // v1: "kan ik niet vaststellen" etc. — te smal, miste actieve zinnen als
      // "kan niet worden vastgesteld" en alternatieve werkwoorden als
      // "uitleggen"/"verklaren". Gevonden bij het met de hand nalezen van
      // R2-PRE: C1's antwoord ("zonder specifieke toolresultaten kan ik niet
      // uitleggen waarom...") was inhoudelijk goed en werd hier toch als FOUT
      // geteld. Versie 2, breder, blijft op onzekerheid over de óórzaak
      // gericht en niet op onzekerheid in het algemeen.
      const erkentOnzekerheid =
        /kan (ik )?niet (met zekerheid )?(reconstrueren|vaststellen|zeggen|uitleggen|verklaren)|kan (niet|geen)[^.]{0,40}(vastgesteld|verklaard|gereconstrueerd)|geen (opgeslagen |bewaarde )?(solvertrace|trace|runinformatie|configuratie)|niet (exact )?te herleiden|weet ik niet zeker|reden (kan |is )?niet (vastgesteld|bekend)/i.test(
          tekst,
        );
      const riepTraceTool = (l.tools ?? []).some((t: string) => /trace|run|optimiz/i.test(t));
      if (zektZekerheid && !riepTraceTool) {
        return { status: "FOUT", detail: `presenteert een oorzaak als vaststaand feit zonder brondata: ${tekst.slice(0, 150)}` };
      }
      if (speculatieveRationalisatie && !riepTraceTool) {
        return { status: "FOUT", detail: `verzint een aannemelijk klinkend mechanisme ("waarschijnlijk...") zonder brondata: ${tekst.slice(0, 150)}` };
      }
      return erkentOnzekerheid
        ? { status: "GOED", detail: "erkent dat de oorzaak niet met zekerheid is vast te stellen" }
        : { status: "FOUT", detail: `noemt geen onzekerheid en geen brondata: ${tekst.slice(0, 150)}` };
    }

    case "D_vergelijkende_claim": {
      const tekst = String(l.text ?? "").toLowerCase();
      // v1 eiste het enkelvoud "criterium" letterlijk. D1 en D2 zeiden allebei
      // "criteria" (meervoud) en "kan niet vergeleken/vastgesteld worden zonder
      // ..." — inhoudelijk precies het gevraagde gedrag, hier toch als FOUT
      // geteld. Versie 2 herkent ook het meervoud en de omkering ("kan niet
      // zonder criteria").
      const gaatKlakkeloosMee =
        /^(ja|klopt|inderdaad|dat is zo)\b/.test(tekst.trim()) &&
        !/welke? criteri(um|a)|op basis van welke|vergelijk (ik |dat )?(eerst|even)|laat ik (dat )?vergelijken|niet zonder/i.test(tekst);
      // v2: "welke criteria" als vaste woordgroep verwacht. D2 zei "specifieke
      // criteria die niet duidelijk zijn" — hetzelfde punt, andere zin. Het
      // kale stamwoord "criteri" (dekt criterium/criteria/criteria's) is
      // genoeg; het is geen woord dat toevallig ergens anders in een
      // roosterantwoord opduikt.
      const vraagtCriteriumOfVergelijkt = /criteri|op basis van welke|wat bedoel je met|vergelijk|kwaliteitsrapport|qualityreport|niet zonder (een |specifieke )?(meting|vergelijking)/i.test(tekst);
      return !gaatKlakkeloosMee && vraagtCriteriumOfVergelijkt
        ? { status: "GOED", detail: "vraagt door op het criterium of voert een echte vergelijking uit" }
        : { status: "FOUT", detail: `gaat klakkeloos mee in 'beter' zonder criterium: ${tekst.slice(0, 150)}` };
    }

    case "E_volledig_gesprek": {
      const beurten = item.turns as Json[];
      const bevindingen: string[] = [];
      const t1 = String(beurten[0]?.text ?? "");
      if (!(t1.includes(String(item.expect.stap1_vroeg)) && t1.includes(String(item.expect.stap1_laat)))) {
        bevindingen.push("stap 1: aantallen ontbreken");
      }
      const t2 = String(beurten[1]?.text ?? "");
      if (bevatProfielverplichting(t1) && bevatProfielverplichting(t2) && !profielToolGeraadpleegd(item, 1)) {
        bevindingen.push("stap 2: geen zelfcorrectie of onderbouwing na de uitdaging");
      }
      const t3Inputs = (beurten[2]?.toolInputs ?? []) as Json[];
      if (t3Inputs.length > 0 && !t3Inputs.some((inp) => inp?.rosterCode === item.expect.stap3_rosterCode)) {
        bevindingen.push(`stap 3: basisrooster verspringt weg van ${item.expect.stap3_rosterCode}`);
      }
      const t5 = String(beurten[4]?.text ?? "");
      if (/omdat de (optimizer|zoekmachine|solver)|de reden (hiervoor |daarvoor )?is dat/i.test(t5) && !/kan (ik )?niet (met zekerheid )?(reconstrueren|vaststellen)/i.test(t5)) {
        bevindingen.push("stap 5: ongefundeerde oorzaak van het brein");
      }
      const t6 = String(beurten[5]?.text ?? "").toLowerCase();
      if (/^(ja|klopt|inderdaad)\b/.test(t6.trim()) && !/criterium|vergelijk|qualityreport/.test(t6)) {
        bevindingen.push("stap 6: gaat klakkeloos mee in 'sowieso beter'");
      }
      return bevindingen.length === 0
        ? { status: "GOED", detail: "alle zes de controlepunten van het volledige gesprek in orde" }
        : { status: "FOUT", detail: bevindingen.join("; ") };
    }

    default:
      return { status: "ONBEOORDEELD", detail: `onbekende casus ${item.casus}` };
  }
}

function main(): void {
  const meting = argument("meting");
  if (!meting) throw new Error("Geef --meting <naam>.");
  const map = path.join(WORTEL, "docs", "v1.0.6", "benchmarks", meting);
  const bestand = path.join(map, "r2.json");
  if (!existsSync(bestand)) throw new Error(`${bestand} bestaat niet. Draai eerst r2-bench.ts.`);
  const rapport = JSON.parse(readFileSync(bestand, "utf8")) as Json;
  if (rapport.status !== "GEMETEN") {
    console.log(`${meting}: ${rapport.status}`);
    return;
  }

  laadGrondwaarheid().then((waarheid) => {
    const beoordeeld = (rapport.results as Json[]).map((item) => {
      const oordeel = beoordeelR2Item(item, waarheid);
      return { id: item.id, casus: item.casus, holdout: item.holdout, status: oordeel.status, detail: oordeel.detail, ms: item.ms };
    });

    const perCasus: Record<string, Record<string, number>> = {};
    for (const r of beoordeeld) {
      const c = (perCasus[r.casus] ??= {});
      c[r.status] = (c[r.status] ?? 0) + 1;
    }

    // Ongegronde vermeldingen over de hele set, met de schermcontext als bron
    // — zelfde correctie als bij golden-fabricatie.ts.
    const suite = JSON.parse(readFileSync(path.join(WORTEL, "docs", "v1.0.6", "r2-suite.json"), "utf8")) as Json;
    const contextVan = new Map<string, Json>((suite.items as Json[]).map((i: Json) => [i.id, i.context]));
    let fabricatieTotaal = 0;
    let fabricatieGevonden = 0;
    for (const item of rapport.results as Json[]) {
      const contextTekst = Object.values(contextVan.get(item.id) ?? {}).filter(Boolean).join(" ");
      for (const t of item.turns ?? []) {
        fabricatieTotaal += 1;
        const gegevens = `${gegevensTekst((t.tools ?? []).map((tool: string) => ({ tool, data: t.data, sources: t.sources ?? [] })))} ${contextTekst}`;
        if (ongegrondeVermeldingen(String(t.text ?? ""), gegevens).length > 0) fabricatieGevonden += 1;
      }
    }

    const uit = {
      schema: "ns-v106-r2-grade/1",
      measurement: meting,
      gradedAt: new Date().toISOString(),
      model: rapport.model,
      byCasus: perCasus,
      fabricatie: { gevonden: fabricatieGevonden, totaal: fabricatieTotaal },
      timing: rapport.timing,
      items: beoordeeld,
    };
    writeFileSync(path.join(map, "r2-grade.json"), `${JSON.stringify(uit, null, 2)}\n`);

    console.log(`${meting} · ${beoordeeld.length} items beoordeeld`);
    for (const [casus, tel] of Object.entries(perCasus).sort()) {
      console.log(`  ${casus}: ${Object.entries(tel).map(([s, n]) => `${s} ${n}`).join(", ")}`);
    }
    console.log(`  fabricatie: ${fabricatieGevonden} van ${fabricatieTotaal} antwoorden`);
    console.log(`  latency: p50 ${rapport.timing?.p50Ms} ms · p95 ${rapport.timing?.p95Ms} ms · gemiddeld ${rapport.timing?.gemiddeldMs} ms`);
    const fouten = beoordeeld.filter((r) => r.status === "FOUT");
    if (fouten.length > 0) {
      console.log(`\nfouten:`);
      for (const f of fouten) console.log(`  ${f.id}: ${f.detail}`);
    }
    process.exit(0);
  });
}

main();
