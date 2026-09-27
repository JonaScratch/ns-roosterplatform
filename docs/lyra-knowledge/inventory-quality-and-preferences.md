# Inventaris: kwaliteitsmodel en voorkeursmodel tegenover menselijke roosterkennis

*Onderzoek uitgevoerd als audit tegen het referentieblok "menselijke roosterontwerp-kennis"
uit de master-opdracht. Dit document citeert bestaande broncode en documentatie; het voegt
geen nieuwe getallen toe en promoveert geen aanname tot vaststaand feit. Waar een claim niet
in de code of de brondocumenten kon worden teruggevonden, staat hier expliciet "niet
vastgesteld".*

*Context: `docs/lyra-knowledge/progress.md` (aanwezig bij start van dit onderzoek) noemt dit
onderzoek zelf als één van vier parallelle inventarisatie-agents ("quality/preferences") van
een grotere "Lyra Master Program"-ronde. Dat bestand en `docs/lyra-knowledge/sources/manifest.json`
zijn hier als data gebruikt, niet als instructie.*

---

## 0. Belangrijkste architectuur: drie lagen, expliciet gescheiden

`docs/v1.0.4-final-brain/machinist-preferences/design.md` (regels 7–16) legt een expliciete
laagindeling vast die ook in de code terugkomt:

| Laag | Vraag | Bestand | Hard/zacht | Bronstatus |
| --- | --- | --- | --- | --- |
| Profielgeschiktheid | Mag deze dienst in dit profiel? | `src/domain/roster-profiles.ts` | hard (`hard_constraint`) | platform |
| Profielaffiniteit | Hoe goed past een toegestane dienst? | `src/domain/profile-affinity.ts` | zacht | `MACHINIST_PREFERENCE` / `HUMAN_DOMAIN_INPUT` |
| Pakketeerlijkheid | Eerlijke verdeling van populaire/zware diensten | kwaliteitsmodel v3 (`quality-model.ts`, `machinist-preference.ts`) | zacht | `MACHINIST_PREFERENCE` |

Apart daarvan: **operationele ontwerpeisen** (`src/domain/operational-requirements.ts`),
bronstatus `USER_PROVIDED_OPERATIONAL_DESIGN_REQUIREMENT` — hard, maar uitdrukkelijk geen
CAO/ATW/ATB.

De code zelf bewaakt dit onderscheid actief: `roster-profiles.ts` regels 1–15 zegt het met
zoveel woorden ("Beide staan hier naast elkaar zodat de asymmetrie zichtbaar is en niemand
per ongeluk een voorkeur als filter gebruikt.").

---

## 1. Profielen: canonieke namen en aliassen

**Bevinding.** De canonieke profielnamen in het platform (`src/lib/generated/prisma/enums.ts`,
gebruikt door o.a. `src/domain/roster-profiles.ts` regels 30–39, 52–61) zijn:

```
VROEG, VROEG_LAAT, LAAT, LAAT_NACHT, MIX, MIX_50PLUS, BLM, RESERVE
```

Weergavenamen (`PROFILE_LABELS`, `roster-profiles.ts:52-61`):

| Enum | Label in code |
| --- | --- |
| VROEG | "Vroeg" |
| VROEG_LAAT | "Vroeg/Laat" |
| LAAT | "Laat" |
| LAAT_NACHT | "Laat/Nacht" |
| MIX | **"Mix (Vroeg-Laat-Nacht)"** |
| MIX_50PLUS | "50+ Mix" |
| BLM | "BLM" |
| RESERVE | "Reserve" |

**Risico — alias "Vroeg/Laat/Nacht" voor MIX is minder zeker dan de code suggereert.**
De code presenteert "Vroeg-Laat-Nacht" als vast onderdeel van het MIX-label
(`roster-profiles.ts:57`) én als bronvermelding bij het dagdienstgewicht
(`profile-affinity.ts:54`: `MIX: { weight: 20, source: "HUMAN_DOMAIN_INPUT (Vroeg/Laat/Nacht)" }`).
Dat suggereert een bevestigde 1-op-1 alias. Maar `docs/lyra-knowledge/sources/manifest.json`
(regel 94, over het brondocument `Mix_1_A.pdf`) zegt uitdrukkelijk: *"de master-prompt-tekst
noemt 'mogelijk historische displaynaam Vroeg-Laat-Nacht' voor dit profiel; op basis van dit
brondocument alléén is die alias NIET bevestigd."* En `docs/lyra-knowledge/progress.md` regel 39
noemt dit expliciet als open vraag die tegen de platformcode geaudit moet worden. Conclusie van
deze audit: **de code behandelt de alias stilzwijgend als vaststaand, terwijl de eigen
brondocumentatie van dit project hem als onbevestigd bestempelt.** Dit is een reële
inconsistentie tussen sourcing-discipline (elders in dezelfde bestanden zeer consequent
toegepast, zie §4 en §6 hieronder) en dit specifieke label.

**BLM** — geen voluit-geschreven naam gevonden in code of documentatie (`niet vastgesteld`
wat de afkorting betekent).

**Regressietests:** `tests/domain/profielaffiniteit.test.ts`, `tests/domain/machinistenvoorkeur.test.ts`
en e2e-log `docs/v1.0.4-final-brain/e2e-logs/verify-profielen.ts.log` dekken profielgrenzen af,
maar niet specifiek de "Vroeg/Laat/Nacht"-aliasclaim.

---

## 2. Profiel-affiniteitmodel: 7 dienstklassen, 3 niveaus, gescheiden van de getallen

**Bevinding — volledig geïmplementeerd, en het gevraagde onderscheid (kwalitatieve rangorde
apart van numerieke mapping) bestaat expliciet.**

`src/domain/duty-class.ts` (regels 33, 46–55) definieert de klassen:

```
EXTREME_EARLY, EARLY, DAYLIKE_EARLY, EARLY_LATE, LATE, PREMIUM_LATE, NIGHT (+ OTHER)
```

Dat zijn precies de 7 uit het referentieblok (extreem vroeg, gematigd vroeg, dagachtig vroeg,
vroege late, late, echte afloper, nacht).

`src/domain/profile-affinity.ts` regels 30–37:

```ts
export type AffinityLevel = "PREFERRED" | "NEUTRAL" | "LESS";
export const AFFINITY_VALUE: Readonly<Record<AffinityLevel, number>> = { PREFERRED: 1, NEUTRAL: 0.6, LESS: 0.2 };
```

Dat is exact voorkeur=1,0 / neutraal=0,6 / minder=0,2 uit het referentieblok. De scheiding die
gevraagd werd (kwalitatieve rangorde los van numerieke mapping) is in de typen zelf aanwezig:
elke cel in `PROFILE_AFFINITY` (regels 74–119) heeft een `level` (de rangorde, met bronvermelding
per cel) en pas `affinityValue()`/`AFFINITY_VALUE` (regel 122–124) vertaalt dat naar het getal.
De module-docstring (regels 14–22) zegt dit met zoveel woorden: *"Alleen de richting heeft een
bron (...). De afstand tussen de niveaus is een aanname."* — dus de afstand (1,0/0,6/0,2 in
plaats van bijv. 1,0/0,7/0,3) wordt zelf niet als bevestigd feit gepresenteerd, ook al staat het
getal hard in de code.

**Bron per cel is zichtbaar in de data**, bv. `MIX_50PLUS.EXTREME_EARLY` (regel 109):
`"menselijk rooster: 0 van 26 extreem vroege diensten in 50+ Mix"` — een empirische bron, geen
verzonnen aanname.

**Regressietest:** `tests/domain/profielaffiniteit.test.ts` (o.a. "tegenvoorbeeld 1 (§36)":
extreem vroeg naar Vroeg, geen monopolie voor Vroeg/Laat en Mix — regel 107).

---

## 3. Dienstklasse-grenzen

**Bevinding — exact overeenkomend met het referentieblok, en als constanten met
bronverwijzing.** `src/domain/duty-class.ts` regels 35–44:

```ts
export const DUTY_CLASS_BOUNDS = {
  extremeEarlyBefore: 5 * 60 + 30,   // < 05:30 → extreem vroeg
  daylikeEarlyFrom: 9 * 60,          // vanaf 09:00 → dagachtig vroeg
  earlyLateEndBefore: 21 * 60,       // einde < 21:00 → vroege late
  premiumLateEndAfter: 24 * 60,      // einde na 24:00 → echte afloper
} as const;
```

De module-docstring (regels 14–31) citeert de empirische onderbouwing uit het Dordrechtse
pakket: 17 diensten tussen 05:30–06:00 tegen 26 ervoor, 7 van de 80 dagachtige diensten vanaf
09:00, 25 van de 92 late diensten vroege late, 31 van de 92 echte aflopers (101/102/103 tussen
00:24–01:42).

**Regressietest:** `tests/domain/profielaffiniteit.test.ts` regels 27–33 ("dienstklassen op de
klok"), incl. het expliciete voorbeeld dat dienstnummer 115 op donderdag EARLY_LATE en op
dinsdag PREMIUM_LATE is (zelfde nummer, twee klassen — bewust getest).

---

## 4. Dagdienst-relatieve gewichten, inclusief de ontbrekende "Vroeg"

**Bevinding — exact overeenkomend, én de aanname is zichtbaar gehouden, niet stilzwijgend
gepromoveerd.** `src/domain/profile-affinity.ts` regels 52–61:

```ts
export const DAY_DUTY_WEIGHTS = {
  LAAT:        { weight: 10, source: "HUMAN_DOMAIN_INPUT" },
  MIX:         { weight: 20, source: "HUMAN_DOMAIN_INPUT (Vroeg/Laat/Nacht)" },
  VROEG_LAAT:  { weight: 20, source: "HUMAN_DOMAIN_INPUT" },
  BLM:         { weight: 20, source: "HUMAN_DOMAIN_INPUT" },
  LAAT_NACHT:  { weight: 10, source: "HUMAN_DOMAIN_INPUT" },
  MIX_50PLUS:  { weight: 40, source: "HUMAN_DOMAIN_INPUT" },
  VROEG:       { weight: 10, source: "AANNAME: niet opgegeven; gelijk aan Laat (spiegelbeeld)" },
  RESERVE:     { weight: 20, source: "AANNAME: niet opgegeven; midden van de opgave" },
};
```

Dit is letterlijk de tabel uit het referentieblok, inclusief het feit dat "Vroeg" ontbrak in de
oorspronkelijke opgave. De waarde 10 voor Vroeg staat expliciet gemarkeerd als `AANNAME`
(assumption), niet als `HUMAN_DOMAIN_INPUT`, en dat onderscheid is ook zichtbaar in de output
van `dutyAffinity()`/`dag()` (regels 66–71), die de bronstring letterlijk doorgeeft. Het ontwerp
(`design.md` regel 71–73) noemt bovendien expliciet de gevoeligheidsanalyse: 0 en 20 als
alternatieve waarden zijn doorgerekend (`assumption-sensitivity.json`).

**Nog steeds als open vraag genoteerd**: `docs/lyra-knowledge/progress.md` regel 40 herhaalt
dit expliciet als iets dat in `HUMAN_REVIEW_REQUIRED` moet blijven — een status-label dat
overigens *niet* letterlijk in de broncode voorkomt (zie §10).

**Regressietest:** geen losse test gevonden die specifiek "wat als Vroeg=0 of Vroeg=20" checkt
in de test-suite zelf; de gevoeligheidsmeting bestaat als los script/resultaat
(`docs/v1.0.4-final-brain/machinist-preferences/assumption-sensitivity.json`), niet als
`vitest`-regressietest. Dat is een gat: een toekomstige wijziging aan `DAY_DUTY_WEIGHTS.VROEG`
zou niet automatisch falen.

---

## 5. Nachtritme-curve

**Bevinding — exact overeenkomend, met aparte "ritme"- en "belasting"-as.**
`src/domain/night-rhythm.ts` regels 31–32:

```ts
export const NIGHT_RHYTHM = { 1: 0, 2: 0.35, 3: 0.7, 4: 0.85, 5: 0.95, 6: 1, 7: 1 };
export const NIGHT_LOAD   = { 1: 0, 2: 0,    3: 0,   4: 0,    5: 0,    6: 0.05, 7: 0.3 };
```

Dit is exact de curve uit het referentieblok (1 slecht, 2≈0,35, 3≈0,70 "vaak net niet lekker",
4≈0,85, 5≈0,95, 6=1,00 met hogere belasting, 7=1,00 ritme maar niet wenselijk als structurele
oplossing door de belasting). `nightBlockWorth()` (regel 45–47) = ritme − belasting, dus 6 scoort
per saldo 0,95 en 7 slechts 0,70 — dat maakt het "niet gewenst als vaste vorm" concreet meetbaar
in plaats van alleen tekst.

**Bronstatus expliciet in de code** (regels 1–29, en het losse bestand
`docs/v1.0.4-final-brain/machinist-preferences/night-preference-curve.json`,
`sourceStatus: "MACHINIST_PREFERENCE — praktijk van machinisten, geen medische of fysiologische
claim"`): dit is nooit als fysiologisch feit gepresenteerd. De docstring zegt letterlijk: *"de
afstanden zijn een aanname, uitgedrukt in stappen die de volgorde volgen."*

**Twee modelversies verschillen, en dat verschil is dus zelf een keuze-historie:**
`quality-model.ts` (v2, regel 245) gebruikt nog een grovere tabel
`valueByLength: {1:0, 2:0.4, 3:0.9, 4:0.95, 5:1}` (geen 6/7-onderscheid). `design.md` regel 94
legt uit waarom v3 is bijgesteld: *"Versie 2 gaf drie nachten 0,90; de machinisteninvoer zegt
'vaak net niet lekker'."* V2 blijft ongewijzigd bewaard voor reproduceerbaarheid van eerdere
metingen; v3 (met de curve hierboven) is de actieve versie in de Lyra-agent
(`src/server/agent/tools.ts:5,384,387` en `research.ts:2,173,200` gebruiken `QUALITY_MODEL_V3`).

**Regressietest:** `tests/domain/profielaffiniteit.test.ts` ("test 9 — nachtreeksen van 1 tot 7
in model v3", regels 231–246) toetst expliciet dat 3 nachten duidelijk onder 4 en 5 zit, en dat
6/7 niet domineren over 5.

---

## 6. Herstel na nachten: het 46-uursdrempel

**Dit is de meest gelaagde bevinding van het hele onderzoek — twee aparte plekken, twee
verschillende bronstatussen, die niet met elkaar zijn samengevoegd.**

**(a) Als CAO-regel (hard, in de regelmotor).**
`src/server/rules-engine/ruleset/cao-ns-2024-2025.ts` regels 546–556:

```ts
{
  id: RULE.NIGHT_SEQUENCE_RECOVERY,
  title: "Rust na een reeks van drie of meer nachtdiensten",
  category: "HARD_CONSTRAINT",
  source: cao("101", "Nachtarbeid"),
  value: 46,
  unit: "HOURS",
  ...TRANSCRIBED,   // status: "SOURCE_TRANSCRIBED", validatedBy: null, validatedAt: null
}
```
`TRANSCRIBED` (regels 71–75) betekent: overgenomen uit een brondocument, **nog niet
gevalideerd** (`validatedBy: null`). Belangrijk aanvullend feit uit
`docs/lyra-knowledge/progress.md` regel 38 en `docs/lyra-knowledge/sources/manifest.json`
regel 141: het enige brondocument dat op dit moment is aangeleverd voor CAO-achtige regels is
"Roosterkaders Regio West 2026" — expliciet gemarkeerd als *"GEEN CAO-document"* (een regionaal
OC-MT-convenant, geen CAO-artikelverwijzing). De daadwerkelijke CAO Spoor-tekst voor
rij-/rusttijden ontbreekt dus. Dat betekent dat de 46-uursregel in de regelmotor met
`source: cao("101", "Nachtarbeid")` een citatie draagt die verwijst naar een brontype dat op dit
moment niet als geleverd document bestaat — de rule-engine markeert dit zelf systematisch als
niet-gevalideerd (`SOURCE_TRANSCRIBED`, `rulesWithUnverifiedCurrency`,
`POTENTIAL_HARD_VIOLATION` in `src/server/rules-engine/validation/result.ts` regels 37, 79).

**(b) Als menselijke-roosterwaarneming (zacht, in de designdocumentatie).**
`docs/human-roster-benchmark/human-roster-design-principles.md` regel 26, in de tabel "Wat hard
is en wat zacht": *"Herstelrust na 3+ nachten (46 uur, **bronstatus POTENTIAL**)"* staat expliciet
in de kolom "Hard", maar met de aantekening `POTENTIAL` erbij. Dezelfde pagina, §5 (regels
115–126), zegt: het kortste werkelijk waargenomen herstel in de zeven officiële roosters is 56
uur — dus ruim boven 46 — en concludeert: *"Nacht, één vrije dag, laat (ongeveer 32 uur) is geen
menselijke uitgang."* De 46-uursregel wordt hier dus gebruikt als afkapwaarde, terwijl de
menselijke data zelf nooit dicht bij die grens komt (kleinste waargenomen waarde 56u, niet 46u) —
precies het "laat sterk, vroeg beperkt"-onderscheid uit het referentieblok.

**(c) Als kwaliteitsmodel-drempel (zacht, in de score).**
`src/domain/quality-model.ts` regels 248–266 (`nights.parts.exit`):

```ts
earlyAcceptableAfterMinutes: 4320,   // = 72 uur
valueTable: {
  belowRule:            { late: 0,    early: 0 },
  atLeastRule:          { late: 1,    early: 0.25 },
  afterEarlyAcceptable: { late: 1,    early: 0.5 },
},
```
Dit is exact het "laat sterk, vroeg beperkt (0,25)" vs. ">=72u vroeg iets beter (0,5)"-patroon uit
het referentieblok, met `belowRule` = onder de 46-uursregel (`NIGHT_SEQUENCE_RECOVERY`). Ook hier
weer bronstatus `MACHINIST_PREFERENCE`, expliciet niet fysiologisch (regel 341, quality-model.ts).

**Conclusie voor deze bullet.** Het 46-uursgetal is dus **niet stilzwijgend gepromoveerd tot
onbetwiste harde regel**: het draagt in de rules-engine zelf nog steeds de status
`SOURCE_TRANSCRIBED`/niet-gevalideerd, en in de menselijke-patronen-documentatie staat het
letterlijk gelabeld `POTENTIAL`. Het risico is niet dat de status is weggepoetst, maar dat er
**drie plekken zijn (CAO-regel, mensen-benchmark-document, kwaliteitsmodel) die hetzelfde getal
gebruiken zonder een enkele centrale "dit getal is nog niet extern geverifieerd"-vlag die ze
allemaal tegelijk zou bijwerken** als de echte CAO-tekst ooit binnenkomt en een andere waarde
blijkt te hebben.

**Regressietest:** `tests/rules-engine/nachtregels.test.ts` (regels 79, 172–184: test met
`nightRecoveryMinutes: 46 * 60` en uren-reeks 8..120 die toetst dat de waarde monotoon stijgt
rond de 46-uursgrens) en `tests/domain/operationele-eisen.test.ts`. Er is geen test die de
CAO-bronstatus zelf (transcribed/niet-gevalideerd) als voorwaarde controleert bovenop de
numerieke waarde.

---

## 7. Werkblok-coherentie (~96%, 98/102)

**Bevinding — het exacte getal staat letterlijk in de brondocumentatie en wordt als
kalibratiebron voor een geïmplementeerde maat gebruikt.**

`docs/v1.0.4-final-brain/human-pattern-evidence.md` regel 19:
`"Werkblokken met één dagdeel | 98 van 102 (96,1%; op dagen gewogen 97,8%) | work-blocks.csv"`.

`docs/human-roster-benchmark/human-roster-design-principles.md` regels 38–41 bevestigt dit
(98 van 102, 100% in Vroeg/Vroeg-Laat/Laat/Laat-Nacht/Mix, uitzonderingen alleen in BLM en 50+
Mix).

**Implementatie:** `src/domain/rhythm-metrics.ts` regel 66 (`coherence`) en
`src/domain/quality-model.ts` regel 179 (`flow.parts.coherence`, gewicht 0,25): *"aandeel dagen
in het dominante dagdeel van hun werkblok (blokken van twee of meer dagen)"*. Het getal 96%/98
van 102 zelf staat **niet** als harde targetwaarde in de code (er is geen `expect(coherence).toBe(0.961)`
ergens), het is de empirische aanleiding voor het bestaan van deze maat, niet een ingebakken
doelwaarde. Dat is consistent met hoe het model verder werkt (meten en rapporteren, niet een
menselijk observatiegetal als verplicht doel opleggen).

**Regressietest:** `tests/domain/brein-eigenschappen.test.ts` regels 108, 121
(`expect(r.components.flow.parts.coherence).toBe(100)` voor een volledig coherent synthetisch
rooster) en `tests/domain/menselijk-ritme.test.ts`.

---

## 8. Klok-overgangsdrempel (>60 minuten): "alleen een ander etiket" versus "echte klokverschuiving"

**Bevinding — geïmplementeerd, met een expliciete ontwikkelgeschiedenis van de drempelwaarde
zelf (180 → 60 minuten).**

`docs/human-roster-benchmark/human-roster-design-principles.md` §3 (regels 65–90) legt het
principe uit: een wissel telt pas als "heen-en-weer" als de kloktijd echt verschuift, niet als
alleen het dagdeel-label wisselt — relevant precies voor BLM en 50+ Mix, waar labels kunnen
overlappen (voorbeeld: een "laat" van 09:47 en een "vroeg" van 07:22 zijn qua klok bijna gelijk).
De grens ligt op **één uur** (regel 85: *"Een wissel telt als alleen een ander etiket als de
begintijd hooguit een uur verschuift"*), met een aantekening dat een eerdere versie 3 uur als
grens had en dat de zoekmachine dat gat vond (regel 86–90).

**Implementatie** in `src/domain/quality-model.ts` regels 181–199 (`flow.parts.oscillation` en
`flow.parts.penalty`):

```ts
oscillation: { minClockSwingMinutes: 60, /* H09: was 180 */ },
penalty:     { minClockShiftMinutes: 60, /* H09: was 180 */ },
```
en in `src/domain/rhythm-metrics.ts` regel 50 (`oscillationMinClockSwingMinutes`). De
toelichting in de code zelf (regels 191–196) citeert precies hetzelfde empirische bewijs als het
designdocument (19 en 41 minuten verschuiving bij de enige twee echte 50+Mix-labelwissels; >3
uur bij elke andere officiële wissel met >1 strafpunt).

**Let op — twee code-paden, niet één.** `src/domain/roster-quality.ts` (`categoryOf()`,
regels 176–186, gebruikt door `machinist-preference.ts` en het kwaliteitsmodel-v3-onderdeel
*voorkeur*) categoriseert een overgang **uitsluitend op `duty.kinds`** (het label VROEG/LAAT/NACHT),
niet op klokoverlap. De >60-minuten "alleen een ander etiket"-correctie zit dus alleen in de
oudere `rhythm-metrics.ts`/`quality-model.ts`-v1/v2-lijn (het `flow`-onderdeel), niet in de
nieuwere v3-voorkeurslaag die op `roster-quality.ts` steunt. Voor profielen waar labels kunnen
overlappen (BLM, 50+ Mix — precies de profielen die het referentieblok noemt) betekent dit dat
de v3-voorkeursscore een "laat → vroeg"-overgang van bv. 19 minuten verschil nog steeds als een
volwaardige labelwissel telt, terwijl `flow`(v1/v2) hem terecht als "geen wissel" zou zien. Dit
is een reëel verschil tussen de twee actieve onderdelen van hetzelfde kwaliteitsmodel-v3-rapport
en verdient aandacht in de architectuurronde.

**Regressietest:** `tests/rules-engine/... ` niet van toepassing; relevante tests zitten in
`tests/domain/menselijk-ritme.test.ts` (springerig-scenario, regel 218: `expect(...flow.score!).toBeGreaterThan(60)`)
en de e2e-log `docs/human-roster-benchmark/human-roster-design-principles.md` beschrijft het
ontwikkellog H09 als bewijsbron. Geen test gevonden die specifiek de 19/41-minuten-BLM-casus als
regressietest reproduceert (alleen als verhaal in documentatie).

---

## 9. Begintijdsprong-referentie (geen wettelijk maximum)

**Bevinding — exact overeenkomend, en uitdrukkelijk als kalibratiereferentie behandeld, niet
als grens.**

`docs/v1.0.4-final-brain/human-pattern-evidence.md` regel 24: *"Begintijdsprong binnen een
dagdeel | gemiddeld 73 min, mediaan 60, p90 150, max 229 | official-features.json"*.
`docs/human-roster-benchmark/human-roster-design-principles.md` §6 (regels 128–137) bevestigt
dit en zegt met zoveel woorden: *"mensen accepteren een uur verschil zonder problemen. Een maat
die elke minuut straft, noemt deze roosters ten onrechte slecht."*

**Implementatie:** `src/domain/quality-model.ts` regels 201–207
(`flow.parts.startJitter: { freeMinutes: 60, fullMinutes: 240, ... }`) — 60 minuten (de mediaan)
is de vrije marge, 240 minuten (net boven het waargenomen maximum van 229) is waar de aftrek vol
is. `rhythm-metrics.ts` regels 45–48 herhaalt dit met verwijzing naar dezelfde brongetallen in de
docstring. De module-docstring zegt expliciet dat dit één steekproef is
(`RHYTHM_CALIBRATION.learnedFromBenchmark`) en "bij een tweede steekproef opnieuw te ijken" —
dus nadrukkelijk gepresenteerd als kalibratie, geen wettelijke of contractuele limiet.

**Regressietest:** `tests/domain/menselijk-ritme.test.ts`.

---

## 10. Rangeer/RET: aantrekkelijk, niet straf — wel eerlijk verdelen

**Bevinding — expliciet en consistent geïmplementeerd, met een regressietest die de bedoeling
letterlijk in de naam draagt.**

`src/domain/roster-quality.ts` regels 607–614 definieert `shuntingFairness`
("Eerlijke rangeerverdeling") als eerlijkheidsmaat tussen roosters (variatiecoëfficiënt van
rangeerdiensten per regel), niet als strafcomponent. `src/domain/machinist-preference.ts` en
`profile-affinity.ts` kennen rangeerdiensten geen aparte (lagere) affiniteit toe — ze worden bij
de affiniteitsberekening genegeerd (`profileAllowsDuty`: reine rangeer- of reservediensten zijn
voor elk profiel toegestaan en tellen niet mee als "minder passend").

**Expliciete bevestiging in tests en rapportagescripts:**
- `tests/domain/machinistenvoorkeur.test.ts` regel 182: `describe("test 6 — rangeer is populair, dus eerlijk verdelen")`, met assertie (regel 199–201) dat concentratie de eerlijkheidsscore verlaagt terwijl de affiniteitsscore in beide gevallen gelijk blijft ("Rangeer is geen strafdienst: de affiniteit is in beide gelijk.").
- `scripts/report/machinist-chapters.ts` regel 260: `"Rangeer is populair: geen strafdienst, wel eerlijk spreiden"` — letterlijk terug te vinden in het gepubliceerde rapport `docs/NS-Roosterplatform-v1.0.4-Final-Brain-Report.html` (Hoofdstuk 29).
- `docs/v1.0.4-final-brain/machinist-preferences/human-vs-preference.md` punt 2: mensen concentreren rangeer in Mix (11 van de 39, variatiecoëfficiënt 0,56), de zoekmachine spreidt bijna gelijk (0,06) — expliciet genoteerd als een plek waar de zoekmachine dichter bij de opgegeven eerlijkheidswens zit dan het menselijke rooster zelf.

**Conclusie:** dit punt uit het referentieblok is volledig en consistent doorgevoerd, inclusief
in testnamen en rapportteksten — geen open vraag hier.

---

## 11. Vrij weekend: RUST+RUST, vrijdageis met nachtuitzondering

**Bevinding — exact overeenkomend, met een expliciet gedateerd gebruikersbesluit.**

`src/domain/operational-requirements.ts` regels 43–68 (`OPERATIONAL_REQUIREMENTS_V1`):

```ts
freeWeekendFriday: { latestEndMinute: 23*60+59, exemptKinds: ["NACHT"] },
freeWeekend:       { freeTypes: ["RUST","WR","CO"], requiredTypes: ["RUST","RUST"], structural: true },
```

De uitzondering voor nachtdiensten wordt letterlijk toegeschreven aan *"besluit van de gebruiker,
19 september 2026: 'de vrijdageis geldt niet voor nachten'"* (regels 16–19). Bronstatus:
`USER_PROVIDED_OPERATIONAL_DESIGN_REQUIREMENT` (regel 41), expliciet niet CAO/ATW/ATB (regel 11).
`fridayDutyAllowed()` (regels 78–84) implementeert precies deze uitzondering.

**Regressietest:** `tests/domain/operationele-eisen.test.ts` (16 tests, genoemd in `design.md`
regel 33) en `tests/optimizer/operationele-eisen-solver.test.ts` (10 tests, waarvan drie tonen
dat de oplosser zónder deze eis de andere kant op gaat — regel 34–35 in `design.md`).

---

## 12. Weekgemiddelde ≤ 40:00 (cyclusgemiddelde, niet elke week)

**Bevinding — exact overeenkomend.** `src/domain/operational-requirements.ts` regels 47–51:

```ts
rosterAverageHours: {
  maxAverageWeeklyMinutes: 40 * 60,
  semantics: "floor(roostercredit / cyclusweken) ≤ max; ... een losse regel mag erboven",
}
```

De module-docstring (regels 13–14) zegt het met zoveel woorden: *"het gemiddelde van een
basisrooster over al zijn regels is hoogstens 40:00 per week (...); een losse regel mag
erboven."* Dit is precies "cycle-average ≤ 40:00, niet elke losse week" uit het referentieblok.
`maxTotalCreditMinutes()` (regel 73–75) berekent de harde bovengrens per cyclus
(`(2400+1) × cyclusweken − 1`, dus 40:00 mag, 40:01 niet). Bronstatus ook hier
`USER_PROVIDED_OPERATIONAL_DESIGN_REQUIREMENT`, niet CAO.

**Regressietest:** zie §11 (dezelfde testbestanden dekken beide operationele eisen).

---

## 13. Tijdband-blootstelling als proxy (geen ORT/toeslag)

**Bevinding — expliciet en consequent als proxy gelabeld, nergens als geldbedrag
gepresenteerd.**

`src/domain/duty-class.ts` regels 73–77 (`nightWindowExposure`) en `profile-affinity.ts`
regels 152–160 (`AffinityMetrics.perRoster[...].nightWindowMinutesPerWeek`,
`weekendMinutesPerWeek`, met de inline aantekening *"Proxy voor toeslagblootstelling, per week:
GEEN toeslag"*). `docs/v1.0.4-final-brain/machinist-preferences/human-vs-preference.md` (regels
12–14): *"Toeslagen: er staan geen ORT-regels in het platform. Blootstelling is gemeten als
proxy (...), niet in geld."* `design.md` regel 108–109 herhaalt dit letterlijk: *"Toeslagen: geen
ORT-regels in het platform. Blootstelling (...) alleen als proxy in de diagnostiek, nooit als
bedrag."*

**Conclusie:** dit punt is zonder uitzondering correct gelabeld in elk bestand waar het getal
voorkomt — geen enkele plek presenteert de blootstellingsminuten als een echt toeslagbedrag.

---

## 14. OBSERVED / PREFERRED / REQUIRED — een centrale kennisniveau-taxonomie ontbreekt

**Bevinding — het concept bestaat inhoudelijk verspreid, maar niet als één benoemd 3-niveau
model.**

Er is **geen** letterlijke tekst `OBSERVED`, `"kennisniveau"` of een vergelijkbare naam voor een
uniform drieledig model aangetroffen in `src/` (gecontroleerd met brede grep op deze en
verwante termen). Wat wél bestaat, functioneel overlappend maar niet samengevoegd:

- **Statuslabels als los datatype**, verspreid over losse bronstatus-strings:
  `MACHINIST_PREFERENCE`, `HUMAN_DOMAIN_INPUT`, `USER_PROVIDED_OPERATIONAL_DESIGN_REQUIREMENT`,
  `SOURCE_TRANSCRIBED` (met `validatedBy`/`validatedAt`), en de violation-confidence-enum
  `"CONFIRMED" | "POTENTIAL"` in `src/server/rules-engine/validation/result.ts` regel 79. Dit
  zijn vergelijkbare ideeën (hoe zeker is deze bewering) maar géén gedeeld enum/type dat overal
  wordt hergebruikt.
- **Een impliciete drieslag in de menselijke-patronen-documentatie**: elk principe in
  `docs/human-roster-benchmark/human-roster-design-principles.md` volgt het format
  **Waarneming** (het geobserveerde feit) → **Principe** (de zachte voorkeur die eruit volgt) →
  **Gevolg voor het platform** (wat er concreet mee gedaan is). Dat is inhoudelijk dicht bij
  OBSERVED → PREFERRED → (geïmplementeerd), maar heeft geen REQUIRED-laag en is een
  documentopmaakconventie, geen data-model in code.
- `docs/lyra-knowledge/progress.md` regel 40 noemt de term `HUMAN_REVIEW_REQUIRED` als gewenste
  status voor het Vroeg=10-gewicht, maar deze exacte string komt **niet voor** in `src/`
  (`niet vastgesteld` of dit label al ergens geïmplementeerd is — het lijkt een voorstel, geen
  bestaande code).

**Conclusie:** het gevraagde §27-onderscheid (OBSERVED/PREFERRED/REQUIRED) is inhoudelijk deels
aanwezig via verschillende, niet-uniforme statuslabels, maar er bestaat geen centrale,
herbruikbare taxonomie die alle drie niveaus in één enum/type vastlegt.

---

## 15. Dordrecht-lokaal versus NS-breed: scope-onderscheid ontbreekt

**Bevinding — niet aangetroffen.** Brede grep op "Dordrecht-lokaal", "NS-breed/NS-wide",
"landelijk geldig" en vergelijkbare formuleringen in `src/domain/` levert niets op. Alle
brondata (de zeven officiële roosters, de machinistenvoorkeur-opgave) is Dordrecht-specifiek
(`DDR_BDU_05_10_2026`, zie `docs/human-roster-benchmark/human-roster-design-principles.md`
regel 4: *"Afgeleid uit de zeven officiële basisroosters van dienstenpakket
DDR-BDU-05-10-2026"*), en dat wordt overal consequent vermeld als steekproefgrootte/oorsprong
(*"Alles hieronder is één steekproef: 7 basisroosters, 64 regels, 223 gewerkte dagen"*, regel 9),
maar er is geen expliciet veld, vlag of type in de code dat een regel of voorkeur markeert als
"alleen geldig voor Dordrecht" tegenover "NS-breed toepasbaar". De platformcode past de
Dordrecht-geleerde kalibraties (nachtritme, klokdrempel, begintijdsprong, dagdienstgewichten)
toe zonder een mechanisme om ze per standplaats te differentiëren. `rhythm-metrics.ts` regel 36
erkent dit gedeeltelijk (*"Alles hier is één steekproef (...). De drempels staan in
`RHYTHM_CALIBRATION` zodat ze bij een tweede steekproef opnieuw te ijken zijn"*) — er is dus een
mechanisme om de kalibratie *te vervangen*, maar niet om meerdere scopes *tegelijk* te laten
bestaan.

---

## Samenvatting: wat is nog assumption/POTENTIAL vandaag

| # | Onderwerp | Status vandaag | Risiconiveau |
| --- | --- | --- | --- |
| 1 | MIX = "Vroeg-Laat-Nacht" alias | Code presenteert het als vast label/bron; eigen brondocument (`sources/manifest.json`) zegt "NIET bevestigd" | **Hoog** — stille inconsistentie tussen code en eigen sourcing-discipline |
| 4 | `DAY_DUTY_WEIGHTS.VROEG = 10` | Nog steeds gemarkeerd `AANNAME` in code en docs, niet stilzwijgend `HUMAN_DOMAIN_INPUT` gemaakt | Laag (correct gelabeld) — maar geen `vitest`-regressietest tegen ongemerkte wijziging |
| 5 | Nachtritmecurve (1..7) | `MACHINIST_PREFERENCE`, expliciet "geen fysiologische claim"; afstanden tussen niveaus een erkende aanname | Laag (correct gelabeld) |
| 6 | 46-uursherstel na nachten | Drie plekken (CAO-regel `SOURCE_TRANSCRIBED`/niet-gevalideerd, mensen-benchmark expliciet `POTENTIAL`, kwaliteitsmodel-drempel `MACHINIST_PREFERENCE`) gebruiken hetzelfde getal zonder centrale koppeling; onderliggende CAO-brontekst zelf ontbreekt nog volgens `progress.md` | **Hoog** — als de echte CAO-tekst een andere waarde blijkt te hebben, moeten drie plekken los worden bijgewerkt |
| 8 | Klok- vs. label-overgangsdrempel (60 min) | Correct geïmplementeerd in `rhythm-metrics.ts`/`quality-model.ts` (flow-onderdeel v1/v2); **niet** toegepast in `roster-quality.ts`/`categoryOf()`, dat door de v3-voorkeurslaag wordt gebruikt | **Middel/Hoog** — inconsistentie tussen twee actieve onderdelen van hetzelfde v3-rapport, specifiek relevant voor BLM/50+ Mix |
| 14 | OBSERVED/PREFERRED/REQUIRED-taxonomie | Inhoudelijk verspreid (losse statusstrings, Waarneming/Principe/Gevolg-conventie in docs), geen centraal type | Middel — vergroot kans op toekomstige stille statusvermenging |
| 15 | Dordrecht-lokaal vs. NS-breed scope | Geen expliciet scope-veld; kalibraties zijn vervangbaar maar niet naast elkaar te laten bestaan per standplaats | Middel — relevant zodra het platform een tweede standplaats/steekproef krijgt |

**Wat wél solide geïmplementeerd én gesourcet is, zonder aangetroffen probleem:** duty-class-
grenzen (§3), profielaffiniteit-schaal en -scheiding (§2), rangeer-als-populair-maar-eerlijk
(§10), vrij-weekend/vrijdageis met nachtuitzondering (§11), 40:00-cyclusgemiddelde (§12), en de
proxy-status van tijdband-blootstelling tegenover echte toeslagen (§13) — voor elk van deze is
zowel de precieze brontekst als minstens één automatische regressietest gevonden.

Geen van de in dit document genoemde getallen is door mij verzonnen of afgerond ten opzichte
van de bron; waar een claim uit het referentieblok niet in code of documentatie kon worden
teruggevonden, is dat expliciet vermeld ("niet vastgesteld" of "niet aangetroffen").
