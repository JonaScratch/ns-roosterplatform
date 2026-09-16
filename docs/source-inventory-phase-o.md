# Broninventaris — fase O

Opgemaakt op 2026-09-05. Alle aangeleverde bestanden zijn in het project opgenomen
onder `tests/fixtures/dordrecht-bronnen/`, zodat elke controle herhaalbaar is en
niet leunt op een pad in iemands downloadmap.

Herhaalbaar te draaien met:

```bash
npm run verify:bronnen
```

Dat script maakt deze inventaris opnieuw en telt de diensten drie keer op
manieren die elkaars fouten niet delen. Onderstaande tabel is de uitkomst van die
draai, niet een met de hand bijgehouden lijst.

## Alle aangeleverde bestanden

| Bestand | Werkelijk type | Doel | Ontleed | Canonieke bron voor | sha256 | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `Vroeg 1 VA.pdf` | PDF (32 kB) | Roosterblad Dordrecht, variant Vroeg | ja | rooster "Vroeg 1 VA": 12 regels, 41 diensten | `3c9321215fb475c5ad37dedc321de02c70518301422fe8ebd9ca4064be47828d` | `PARSED` |
| `Vroeg Laat 1 B.pdf` | PDF (31 kB) | Roosterblad, variant Vroeg/Laat | ja | rooster "Vroeg/Laat 1 - B": 10 regels, 34 diensten | `1a31cf05d049bee4e01f62bfdf5dec81adf243cf2906f31cc3e8769e3a906694` | `PARSED` |
| `Laat 1 LA.pdf` | PDF (32 kB) | Roosterblad, variant Laat | ja | rooster "Laat 1 - LA": 12 regels, 37 diensten | `15992e131fa0af45fcb48667bd21a48eb5a4fb7f82ecc3f4b2243ecf049d4ee0` | `PARSED` |
| `Laat Nacht 1 C.pdf` | PDF (30 kB) | Roosterblad, variant Laat/Nacht | ja | rooster "Laat/Nacht 1 - C": 6 regels, 22 diensten | `253698be2097226acbdab32f6fc95d87d1637f148ab9efc4a6ecfb99a2fa50a6` | `PARSED` |
| `Mix 1 A.pdf` | PDF (32 kB) | Roosterblad, variant Mix | ja | rooster "Mix 1 A": 12 regels, 44 diensten | `93ebdb8152c8ef04094126c884e070c1d5fd381ed38d701d648d1adb207bba73` | `PARSED` |
| `50+ mix 1.pdf` | PDF (30 kB) | Roosterblad, variant 50+ Mix | ja | rooster "50+ mix 1 - Y": 6 regels, 19 diensten | `beb9f86420bd516741dc0039de5cf0897a40537b476aeceef066b10c51f5700e` | `PARSED` |
| `BLM 1.pdf` | PDF (30 kB) | Roosterblad, variant BLM | ja | rooster "BLM 1 - BLMD": 6 regels, 26 diensten | `95ef1e9806f6a6938157f84248351ee908a22d90462f25cf012d92d3dadcf54b` | `PARSED` |
| `BDU DDR Oktober 2026.docx` | ZIP/OOXML (1456 kB) | Aangekondigd als het dienstenboekje | ja, en leeg bevonden | — | `daa054f99c432c1c090beeb268344a709e75eacdd5345f65005753f6519d8578` | `PARSED_NO_DUTY_DATA` |
| `NS CAO 2024-2025.pdf` | PDF (1976 kB) | Collectieve arbeidsovereenkomst | ja, 107 pagina's | formele CAO-regels | `dac91470bfa678812ad72ce75ef5299413f93ca5ab1a4faf35cbdd1082d8b14f` | `PARSED` |
| `Roosterkaders Regio West 2026 ondertekend (1).pdf` | PDF (3487 kB) | Regionaal roosterkader | nee — geen tekstlaag | regionale kaders (nog niet overneembaar) | `506bc4ffd495c21c70aa938b6be900da7c08a8c634483a0fd6a01502f7604986` | `SOURCE_PRESENT_NOT_MACHINE_READABLE` |
| `ns-logo.svg` | **PNG** (13 kB, 476×273) | Officieel NS-beeldmerk | ja | het beeldmerk in alle schermen en de export | `20563d222dda94eccc0bb9d03ccf99c24874c8373ff697cb6cc78ed9d8bd98ec` | `PARSED` |

Elf bestanden aangeleverd, elf gecontroleerd. Er is niets als ontbrekend
gerapporteerd zonder het te hebben geopend.

## Drie bevindingen die aandacht nodig hebben

### 1. `ns-logo.svg` is geen SVG

Het bestand heeft de extensie `.svg` maar begint met de bytes `89 50 4E 47` — het
is een PNG van 476×273. Het is opgeslagen als `public/brand/ns-logo.png` en wordt
als PNG uitgeleverd, ook in de export (als data-URI, zodat een geëxporteerd blad
buiten de applicatie niet met een gebroken plaatje aankomt).

Dit is uitdrukkelijk het aangeleverde bestand. Er is niets nagetekend, niets
gegenereerd en niets vervangen. Het gevolg van de extensie is wel dat het
beeldmerk niet meeschaalt zoals een vectorbestand zou doen; op een groot formaat
kan het zichtbaar zachter worden. Wie een vectorversie heeft, kan die zonder
codewijziging naast dit bestand zetten — `ns-logo.svg` staat vóór `ns-logo.png` in
de zoekvolgorde.

### 2. Het BDU-bestand bevat geen diensten

`BDU DDR Oktober 2026.docx` is aangekondigd als het dienstenboekje. Uitgepakt
bevat het:

- `word/document.xml`, 9916 bytes, met uitsluitend een omslagtekst:
  "BDU Oktober 2026 / Machinisten Dordrecht / Geldig van 5 Oktober 2026 tot en met
  12 December 2026";
- `word/media/image1.jpeg`, 1,4 MB, een **foto van een trein**.

Er staat geen dienstenlijst in. Dat is geen leesfout: het document is volledig
uitgepakt en doorzocht. De volledige dienstenset komt daarom uit de zeven
roosterbladen, wat hieronder wordt onderbouwd.

### 3. Het regionale roosterkader is een scan

`Roosterkaders Regio West 2026 ondertekend (1).pdf` heeft 10 pagina's, 11
afbeeldingen en **nul lettertypen**. Er is geen tekstlaag. Het bestand is er, maar
er valt machinaal niets uit over te nemen.

Dit is opzettelijk niet met OCR opgelost. Een raadslag over wat er in een
ondertekend regionaal kader staat, is precies het soort bron dat later niemand
meer als raadslag herkent. De status is `SOURCE_PRESENT_NOT_MACHINE_READABLE`:
aanwezig, niet overneembaar, en de regels hieruit blijven open tot iemand ze
overschrijft. Zie `docs/rule-coverage.md`.

## De dienstentelling

De canonieke telling uit een eerdere fase — maandag 34, dinsdag 36, woensdag 34,
donderdag 35, vrijdag 33, zaterdag 26, zondag 25, samen 223 — is niet
overgenomen als aanname maar opnieuw uit de bron geteld.

| Weekdag | Uit de bron | Eerder vastgesteld |
| --- | --- | --- |
| maandag | 34 | 34 |
| dinsdag | 36 | 36 |
| woensdag | 34 | 34 |
| donderdag | 35 | 35 |
| vrijdag | 33 | 33 |
| zaterdag | 26 | 26 |
| zondag | 25 | 25 |
| **totaal** | **223** | **223** |

De zeven bladen samen: 64 roosterregels, 448 dagcellen, 223 diensten, 56
reservedagen, 32 WTV-dagen, 9 compensatiedagen, 128 rustdagen. Elke cel is
gelezen; er is er geen als onbekend blijven staan.

### Waarom er drie keer geteld is

Eén telling die op het verwachte getal uitkomt, bewijst vooral dat de teller en de
verwachting uit dezelfde pen komen. Er zijn daarom drie tellingen gedaan die
elkaars fouten niet delen:

1. **Ontlede dagcellen** — de cellen worden per regel in groepen van drie
   fragmenten gelezen, waardoor de weekdag vastligt. Uitkomst: 223.
2. **Tijdvakken in de ruwe brontekst** — buiten de ontleding om geteld: elk
   fragment dat eruitziet als `HH:MM - HH:MM`. Een dienstcel heeft er precies één,
   een rust-, reserve- of WTV-cel geen. Uitkomst: 223.
3. **Urenbehoud per regel** — de zeven celduren van een regel moeten optellen tot
   de weeklengte die het blad zelf bovenaan die regel noemt. Uitkomst: 64 van de
   64 regels sluiten exact.

De derde is de scherpste. De eerste twee zouden allebei kloppen wanneer een cel
op de verkeerde dag terechtkomt; de derde merkt een cel die wegvalt of dubbel
gelezen wordt, ook als het totaal toevallig uitkomt.

### Identiteit

Dienstidentiteit is standplaats + dienstregeling + weekdag + dienstnummer. Over de
zeven bladen samen:

- 46 verschillende dienstnummers;
- 223 verschillende identiteiten bij 223 instanties — **geen enkele dienst komt
  twee keer voor**;
- geen enkel geval waarin dezelfde dienst op twee bladen andere tijden heeft.

### Diensten over middernacht

55 van de 223 diensten eindigen na middernacht. Een eindtijd die niet later is dan
de begintijd, telt door voorbij 24:00 in plaats van als negatieve duur te worden
gelezen. Beide gevallen uit de opdracht komen in de bron voor:

- dienst 761, dinsdag: `23:00 → 07:00` (8 uur, volgende dag);
- dienst 170, maandag: `16:52 → 00:28` (7 uur 36, volgende dag).

## Gemeenschappelijke kop van alle zeven bladen

| Veld | Waarde |
| --- | --- |
| Standplaats | MCN - Dordrecht plan |
| Rol | MCN |
| Roostervariant | BDU-05-10-2026 |
| Geldig | 5 okt. 2026 t/m 12 dec. 2026 |
| Contracturen per week | 40:00 |
| Status | Goedgekeurd |
| WTV ingeroosterd | Ja |

De zeven bladen horen dus bij één en dezelfde roosterperiode. Dat is wat de
onderlinge reconciliatie in stap 4 zinvol maakt: het zijn geen losse uitdraaien
van verschillende momenten.

## Hoe deze bestanden gelezen worden

`src/server/import/roster-pdf.ts` leest de roosterbladen. Die bevatten gewone
tekstbytes; er is geen OCR gebruikt en niets geraden. Een cel die niet te plaatsen
is, komt terug als `ONBEKEND` en uitdrukkelijk niet als rustdag — het verschil
tussen "hij heeft vrij" en "wij konden het niet lezen" is het verschil dat iemand
thuis houdt terwijl hij had moeten rijden.

`src/server/import/pdf-text.ts` leest de CAO. Dat bestand is opgemaakt in InDesign
met subset-lettertypen en bewaart bijna al zijn objecten in objectstromen; wie de
bytes rechtstreeks leest, krijgt betekenisloze tekens terug zonder foutmelding.
Twee dingen bleken daar noodzakelijk en zijn met zoveel woorden in de code
vastgelegd:

- de codebreedte moet uit de ToUnicode-tabel zelf worden **gemeten**, niet uit de
  `codespacerange` gevraagd — die zegt hier bij elk lettertype twee bytes terwijl
  de tabel eronder codes van één byte opsomt;
- octale ontsnappingen (`\037`) moeten worden uitgevoerd, anders leest "CAO NS
  2024" als "CAO NS0372024": tekst die er net genoeg uitziet om te blijven staan.

Na beide correcties levert de CAO 107 pagina's en circa 338 000 tekens leesbare
tekst op. Die tekst is de bron voor de regelreconciliatie in stap 5.
