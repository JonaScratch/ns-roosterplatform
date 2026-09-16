import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hasTextLayer, parseCMap, pdfPages } from "@/server/import/pdf-text";
import { conservation, positieVoorCel, readDordrechtSource } from "@/server/import/dordrecht-source";
import {
  dutyInstancesOf,
  leesTijdvak,
  parseRosterPdf,
  pdfTextFragments,
} from "@/server/import/roster-pdf";

/**
 * De lezing van de aangeleverde bronnen.
 *
 * ## Waarom hier op de echte bestanden wordt getoetst
 *
 * Een verzonnen roosterblad bewijst dat de ontleding overweg kan met een blad
 * dat wij zelf hebben opgemaakt. Dat is niet de vraag. De vraag is of zij
 * overweg kan met de bladen die NS werkelijk heeft aangeleverd, inclusief de
 * eigenaardigheden daarin. Die bestanden staan daarom in
 * `tests/fixtures/dordrecht-bronnen/` en worden hier rechtstreeks gelezen.
 *
 * ## Waar deze tests op letten
 *
 * Niet op "er komt iets uit", maar op de dingen die stil fout kunnen gaan: een
 * cel die een dag opschuift, een nachtdienst met een negatieve duur, een cel
 * die als rustdag wordt gelezen omdat hij onleesbaar was.
 */

const BRONMAP = join(__dirname, "..", "fixtures", "dordrecht-bronnen");

const BLADEN = readdirSync(BRONMAP)
  .filter((naam) => naam.endsWith(".pdf") && !/CAO|Roosterkaders/i.test(naam))
  .sort();

function blad(naam: string) {
  return parseRosterPdf(readFileSync(join(BRONMAP, naam)));
}

describe("de aangeleverde bronnen staan er", () => {
  it("bevat alle zeven roosterbladen", () => {
    expect(BLADEN).toHaveLength(7);
  });
});

describe("de kop van een roosterblad", () => {
  const document = blad("Vroeg 1 VA.pdf");

  it("noemt standplaats, rol en roostervariant", () => {
    expect(document.meta.standplaats).toBe("MCN - Dordrecht plan");
    expect(document.meta.rol).toBe("MCN");
    expect(document.meta.roostervariant).toBe("BDU-05-10-2026");
  });

  it("noemt de roosternaam zoals die op het blad staat", () => {
    expect(document.meta.roosterNaam).toBe("Vroeg 1 VA");
  });

  it("noemt de geldigheidsperiode en de contracturen", () => {
    expect(document.meta.startdatum).toBe("5 okt. 2026");
    expect(document.meta.einddatum).toBe("12 dec. 2026");
    expect(document.meta.contracturenPerWeek).toBe("40:00");
    expect(document.meta.status).toBe("Goedgekeurd");
  });
});

describe("de zeven bladen horen bij één roosterperiode", () => {
  it("hebben allemaal dezelfde standplaats, variant en periode", () => {
    const koppen = BLADEN.map((naam) => {
      const meta = blad(naam).meta;
      return `${meta.standplaats}|${meta.roostervariant}|${meta.startdatum}|${meta.einddatum}`;
    });
    expect(new Set(koppen).size).toBe(1);
  });
});

describe("elke dagcel wordt geplaatst", () => {
  it.each(BLADEN)("%s laat geen cel als onbekend staan", (naam) => {
    const document = blad(naam);
    expect(document.unparsed).toEqual([]);
    for (const regel of document.lines) {
      expect(regel.cells).toHaveLength(7);
      expect(regel.cells.map((cel) => cel.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(regel.cells.every((cel) => cel.kind !== "ONBEKEND")).toBe(true);
    }
  });
});

describe("de celduren sluiten aan op de weeklengte van het blad", () => {
  // Dit is de scherpste controle die er is: een cel die wegvalt of dubbel
  // gelezen wordt, maakt de som onherroepelijk anders. Een cel die een dag
  // opschuift, ontsnapt hieraan — daarvoor is de weekdagtoets hierboven.
  const minuten = (waarde: string | null): number => {
    if (!waarde) {
      return 0;
    }
    const treffer = /^(\d+):(\d{2})$/.exec(waarde);
    return treffer ? Number(treffer[1]) * 60 + Number(treffer[2]) : Number.NaN;
  };

  it.each(BLADEN)("%s sluit op elke regel", (naam) => {
    for (const regel of blad(naam).lines) {
      const som = regel.cells.reduce((totaal, cel) => totaal + minuten(cel.duration), 0);
      expect(som).toBe(minuten(regel.weekHoursIncludingBreak));
    }
  });
});

describe("de volledige dienstenset van Dordrecht", () => {
  const alle = BLADEN.flatMap((naam) =>
    dutyInstancesOf(blad(naam)).map((dienst) => ({ blad: naam, ...dienst })),
  );

  it("telt 223 diensten", () => {
    expect(alle).toHaveLength(223);
  });

  it("verdeelt ze over de week zoals de canonieke telling zegt", () => {
    const perDag = [0, 0, 0, 0, 0, 0, 0, 0];
    for (const dienst of alle) {
      perDag[dienst.weekday] += 1;
    }
    expect(perDag.slice(1)).toEqual([34, 36, 34, 35, 33, 26, 25]);
  });

  it("komt op hetzelfde getal uit als een telling buiten de ontleding om", () => {
    // Onafhankelijk: tel in de ruwe brontekst de tijdvakken. Alleen een
    // dienstcel heeft er een; rust, reserve en WTV niet.
    const tijdvakken = BLADEN.reduce(
      (totaal, naam) =>
        totaal +
        pdfTextFragments(readFileSync(join(BRONMAP, naam))).filter((deel) =>
          /^\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s*$/.test(deel),
        ).length,
      0,
    );
    expect(tijdvakken).toBe(alle.length);
  });

  it("bevat geen enkele dienst twee keer", () => {
    const identiteiten = alle.map((dienst) => `${dienst.dutyCode}|${dienst.weekday}`);
    expect(new Set(identiteiten).size).toBe(identiteiten.length);
  });

  it("geeft dezelfde dienst overal dezelfde tijden", () => {
    const perIdentiteit = new Map<string, Set<string>>();
    for (const dienst of alle) {
      const sleutel = `${dienst.dutyCode}|${dienst.weekday}`;
      const tijden = perIdentiteit.get(sleutel) ?? new Set<string>();
      tijden.add(`${dienst.startMinute}-${dienst.endMinute}`);
      perIdentiteit.set(sleutel, tijden);
    }
    const tegenstrijdig = [...perIdentiteit.entries()].filter(([, t]) => t.size > 1);
    expect(tegenstrijdig).toEqual([]);
  });
});

describe("diensten over middernacht", () => {
  it("leest een eindtijd voorbij middernacht als de volgende dag", () => {
    // 23:00 → 07:00 is acht uur, niet min zestien.
    expect(leesTijdvak("23:00 - 07:00")).toEqual({ start: 23 * 60, eind: 31 * 60 });
    expect(leesTijdvak("16:52 - 00:28")).toEqual({ start: 16 * 60 + 52, eind: 24 * 60 + 28 });
  });

  it("leest een gewone dagdienst niet als nachtdienst", () => {
    expect(leesTijdvak("05:27 - 12:32")).toEqual({ start: 5 * 60 + 27, eind: 12 * 60 + 32 });
  });

  it("geeft niets terug bij iets wat geen tijdvak is", () => {
    expect(leesTijdvak("")).toBeNull();
    expect(leesTijdvak("08:00")).toBeNull();
    expect(leesTijdvak("R")).toBeNull();
  });

  it("geeft geen enkele dienst in de bron een duur van nul of minder", () => {
    for (const naam of BLADEN) {
      for (const dienst of dutyInstancesOf(blad(naam))) {
        expect(dienst.endMinute).toBeGreaterThan(dienst.startMinute);
      }
    }
  });
});

describe("de ankers", () => {
  it("worden als hun eigen soort gelezen en niet als dienst", () => {
    const soorten = new Set<string>();
    for (const naam of BLADEN) {
      for (const regel of blad(naam).lines) {
        for (const cel of regel.cells) {
          soorten.add(cel.kind);
          if (cel.kind !== "DUTY") {
            expect(cel.dutyCode).toBeNull();
          }
        }
      }
    }
    expect([...soorten].sort()).toEqual(["CO", "DUTY", "R", "RES", "WR"]);
  });

  it("geeft een rustdag geen duur en een reservedag wel", () => {
    const cellen = BLADEN.flatMap((naam) => blad(naam).lines.flatMap((regel) => regel.cells));
    expect(cellen.filter((cel) => cel.kind === "R").every((cel) => cel.duration === null)).toBe(
      true,
    );
    expect(cellen.filter((cel) => cel.kind === "RES").every((cel) => cel.duration !== null)).toBe(
      true,
    );
  });
});

describe("de CAO is leesbaar", () => {
  const bytes = readFileSync(join(BRONMAP, "NS CAO 2024-2025.pdf"));

  it("levert alle 107 pagina's op", () => {
    expect(pdfPages(bytes)).toHaveLength(107);
  });

  it("levert leesbaar Nederlands op en geen bytesoep", () => {
    const tekst = pdfPages(bytes).join("\n");
    expect(tekst.length).toBeGreaterThan(100_000);
    expect(tekst).toContain("CAO NS 2024");
    expect(tekst).toContain("Begripsbepalingen");
    // De octale ontsnapping die anders "CAO NS0372024" oplevert: tekst die er
    // net genoeg uitziet om onopgemerkt te blijven staan.
    expect(tekst).not.toContain("NS0372024");
  });
});

describe("het regionale roosterkader", () => {
  it("heeft geen tekstlaag en levert daarom niets op", () => {
    // Dit is een uitkomst en geen defect: het bestand is een scan. Wat hier
    // niet mag gebeuren, is dat de inhoud alsnog "ongeveer" wordt ingevuld.
    const bytes = readFileSync(join(BRONMAP, "Roosterkaders Regio West 2026 ondertekend (1).pdf"));
    expect(hasTextLayer(bytes)).toBe(false);
  });
});

describe("de ToUnicode-tabel", () => {
  it("meet de codebreedte aan de tabel en niet aan de codespacerange", () => {
    // Precies de vorm die in de CAO staat: de codespacerange belooft twee
    // bytes, de tabel eronder gebruikt er één. Wie de belofte gelooft, leest
    // elk tekenpaar als één code en houdt lege tekst over.
    const tabel = parseCMap(`
      1 begincodespacerange
      <0000> <FFFF>
      endcodespacerange
      2 beginbfchar
      <20> <0020>
      <41> <0041>
      endbfchar
    `);
    expect(tabel.codeLength).toBe(1);
    expect(tabel.map.get(0x41)).toBe("A");
  });

  it("rolt een bereik met oplopende bestemming uit", () => {
    const tabel = parseCMap(`
      1 beginbfrange
      <30> <39> <0030>
      endbfrange
    `);
    expect(tabel.map.get(0x30)).toBe("0");
    expect(tabel.map.get(0x39)).toBe("9");
  });

  it("leest een bereik met een lijst als bestemming", () => {
    const tabel = parseCMap(`
      1 beginbfrange
      <41> <43> [<0058> <0059> <005A>]
      endbfrange
    `);
    expect(tabel.map.get(0x41)).toBe("X");
    expect(tabel.map.get(0x43)).toBe("Z");
  });
});

describe("een cel die niet te duiden is", () => {
  it("levert géén roosterpositie op", () => {
    // Dit is de belangrijkste regel van de hele inleesketen. Een onleesbare cel
    // die als rustdag terugkomt, houdt iemand thuis op een dag dat hij had
    // moeten rijden — en niets in het systeem klaagt daarover, want een rustdag
    // is een volstrekt normale uitkomst.
    //
    // De mutatietoets liet zien dat geen enkele test dit afdwong: de `default`
    // vervangen door RUST liet de hele suite groen. Vandaar deze test.
    expect(positieVoorCel("ONBEKEND")).toBeNull();
    expect(positieVoorCel("")).toBeNull();
    expect(positieVoorCel("iets anders")).toBeNull();
  });

  it("vertaalt de cellen die wél te duiden zijn", () => {
    expect(positieVoorCel("DUTY")).toBe("DUTY");
    expect(positieVoorCel("R")).toBe("RUST");
    expect(positieVoorCel("RES")).toBe("RES");
    expect(positieVoorCel("WR")).toBe("WR");
    expect(positieVoorCel("WTV")).toBe("WR");
    expect(positieVoorCel("CO")).toBe("CO");
  });

  it("maakt van een rustdag nooit iets anders dan rust", () => {
    // De omgekeerde fout: rust die als dienstdag terugkomt. Dan staat er een
    // dienstdag zonder dienstnummer in het rooster.
    expect(positieVoorCel("R")).not.toBe("DUTY");
  });
});

describe("het behoud over de hele bron", () => {
  it("sluit: elke cel komt in precies één bak terecht", () => {
    const bron = readDordrechtSource(BRONMAP);
    const behoud = conservation(bron);
    expect(behoud.invoer).toBe(448);
    expect(behoud.vastRooster + behoud.operationelePool + behoud.nietToewijsbaar +
      behoud.uitgeslotenMetReden).toBe(behoud.invoer);
    expect(behoud.verdwenen).toBe(0);
    expect(behoud.dubbel).toBe(0);
    expect(behoud.sluitend).toBe(true);
  });

  it("levert 223 diensten en zeven roosters zonder conflicten", () => {
    const bron = readDordrechtSource(BRONMAP);
    expect(bron.duties).toHaveLength(223);
    expect(bron.rosters).toHaveLength(7);
    expect(bron.conflicts).toEqual([]);
  });
});
