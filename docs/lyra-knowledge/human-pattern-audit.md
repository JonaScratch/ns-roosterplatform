# Human-pattern-audit: menselijke-roosterwaarnemingen tegenover platform en opdracht

*Vereist deliverable §99 van de LYRA MASTER PROGRAM-opdracht. Focus: de **OBSERVED-FROM-HUMAN-
ROSTERS**-kant — wat in de zeven officiële Dordrechtse basisroosters is waargenomen, en hoe dat
zich verhoudt tot de domeinkennis-claims uit de master-opdracht en tot de implementatie. De
volledige tekst van `docs/human-roster-benchmark/human-roster-design-principles.md` is voor dit
document zelf gelezen (niet alleen de samenvatting in de Fase 0-inventaris); de overige citaten
en risicostatussen zijn overgenomen uit
`docs/lyra-knowledge/inventory-quality-and-preferences.md` en
`docs/lyra-knowledge/current-state.md`. Geen getal is hier herberekend of afgerond; waar iets niet
kon worden teruggevonden staat "niet vastgesteld".*

---

## 0. De brondata in één zin

`docs/human-roster-benchmark/human-roster-design-principles.md:1-9`: afgeleid uit de zeven
officiële basisroosters van dienstenpakket **DDR-BDU-05-10-2026**
(`learnedFromBenchmark = DDR_BDU_05_10_2026`), 64 regels, 223 gewerkte dagen — *"één steekproef
(...), geen mathematisch optimum en geen regelboek."* Elk principe in dat document volgt het
format **Waarneming → Principe → (soms) Gevolg voor het platform**, zie §10 hieronder.

---

## 1. Nachtritme-curve

**Status: solide — curve exact overeenkomend, bronstatus consequent niet-fysiologisch.**

`src/domain/night-rhythm.ts:31-32`:

```ts
export const NIGHT_RHYTHM = { 1: 0, 2: 0.35, 3: 0.7, 4: 0.85, 5: 0.95, 6: 1, 7: 1 };
export const NIGHT_LOAD   = { 1: 0, 2: 0,    3: 0,   4: 0,    5: 0,    6: 0.05, 7: 0.3 };
```

Dit is exact de curve uit het referentieblok (1 slecht, 2≈0,35, 3≈0,70 "vaak net niet lekker",
4≈0,85, 5≈0,95, 6=1,00 met hogere belasting, 7=1,00 ritme maar niet wenselijk als structurele
oplossing door de belasting). `nightBlockWorth()` (regel 45-47) = ritme − belasting, dus 6 scoort
per saldo 0,95 en 7 slechts 0,70. In de human-roster-benchmark-tegenhanger,
`human-roster-design-principles.md` §4 (regels 92-113): vier nachtreeksen waargenomen, lengtes
**3, 5, 5 en 6** — *"geen enkele losse nacht, geen enkele reeks van twee"* — en het document wijst
er expliciet op dat een rooster als **cirkel** moet worden beoordeeld: Laat/Nacht-regel 2→3 en
Mix-regel 2→3 blijken bij rotatie-lezing één doorlopende reeks (zes, resp. vijf nachten) i.p.v.
twee losse blokken per regel gelezen.

Bronstatus expliciet in de code (regels 1-29, en
`docs/v1.0.4-final-brain/machinist-preferences/night-preference-curve.json`,
`sourceStatus: "MACHINIST_PREFERENCE — praktijk van machinisten, geen medische of fysiologische
claim"`): dit is nooit als fysiologisch feit gepresenteerd. De docstring: *"de afstanden zijn een
aanname, uitgedrukt in stappen die de volgorde volgen."*

Twee modelversies verschillen: `quality-model.ts` v2 (regel 245) gebruikt nog
`valueByLength: {1:0, 2:0.4, 3:0.9, 4:0.95, 5:1}` (geen 6/7-onderscheid); v3 is bijgesteld omdat
*"Versie 2 gaf drie nachten 0,90; de machinisteninvoer zegt 'vaak net niet lekker'"*
(`design.md:94`). V2 blijft bewaard voor reproduceerbaarheid; v3 is actief in de Lyra-agent
(`src/server/agent/tools.ts:5,384,387`, `research.ts:2,173,200`).

**Citaat:** `night-rhythm.ts:1-32,45-47`, `human-roster-design-principles.md:92-113`,
`design.md:94`.
**Regressietest:** `tests/domain/profielaffiniteit.test.ts` ("test 9 — nachtreeksen van 1 tot 7 in
model v3", regels 231-246): toetst dat 3 nachten duidelijk onder 4 en 5 zit, en dat 6/7 niet
domineren over 5.

---

## 2. Herstel na nachten: het 46-uursdrempel, en het waargenomen minimum van 56 uur

**Status: gap/risico — drie plekken, één getal, geen centrale koppeling; de menselijke data komt
er nooit dicht bij.**

**(a) CAO-regel (hard).** `src/server/rules-engine/ruleset/cao-ns-2024-2025.ts:546-556`:
`RULE.NIGHT_SEQUENCE_RECOVERY`, `value: 46`, `unit: "HOURS"`, status `SOURCE_TRANSCRIBED`
(`validatedBy: null`) — overgenomen uit een brondocument, nog niet extern gevalideerd. Het enige
op dit moment aangeleverde CAO-achtige brondocument, "Roosterkaders Regio West 2026", is
uitdrukkelijk gemarkeerd *"GEEN CAO-document"* (`progress.md:38`, `sources/manifest.json:141`);
de daadwerkelijke CAO Spoor-tekst voor rij-/rusttijden ontbreekt. De rule-engine markeert dit zelf
systematisch als niet-gevalideerd (`SOURCE_TRANSCRIBED`, `rulesWithUnverifiedCurrency`,
`POTENTIAL_HARD_VIOLATION` in `src/server/rules-engine/validation/result.ts:37,79`).

**(b) Menselijke-roosterwaarneming (zacht).**
`human-roster-design-principles.md:26` (tabel "Wat hard is en wat zacht"): *"Herstelrust na 3+
nachten (46 uur, **bronstatus POTENTIAL**)"* staat in de kolom "Hard", maar met de aantekening
`POTENTIAL`. §5 van hetzelfde document (regels 115-126): *"Het kortste herstel tussen het einde
van de laatste nacht en de volgende dienst is 56 uur; de regel eist 46."* En expliciet: *"Nacht,
één vrije dag, laat (ongeveer 32 uur) is geen menselijke uitgang"* — de menselijke data zelf komt
dus nooit dicht bij de 46-uursgrens (kleinste waargenomen waarde: **56 uur, niet 46 uur**). Dit is
precies het "laat sterk, vroeg beperkt"-onderscheid uit het referentieblok, en de reden waarom een
meting die "nacht → 1 vrij → vroeg (48u)" boven "nacht → 2 vrij → laat (56u)" zou zetten de
zoekmachine rust laat inleveren (ontwikkellog H04/H09, genoemd in §5).

**(c) Kwaliteitsmodel-drempel (zacht).** `src/domain/quality-model.ts:248-266`
(`nights.parts.exit`): `earlyAcceptableAfterMinutes: 4320` (=72u); `valueTable`:
`belowRule: {late:0, early:0}`, `atLeastRule: {late:1, early:0.25}`,
`afterEarlyAcceptable: {late:1, early:0.5}` — exact het "laat sterk, vroeg beperkt (0,25)" vs.
">=72u vroeg iets beter (0,5)"-patroon, met `belowRule` = onder de 46-uursregel. Bronstatus ook
hier `MACHINIST_PREFERENCE`, expliciet niet fysiologisch (`quality-model.ts:341`).

**Conclusie.** Het 46-uursgetal is niet stilzwijgend gepromoveerd tot onbetwiste harde regel: het
draagt in de rules-engine zelf nog de status `SOURCE_TRANSCRIBED`/niet-gevalideerd, en in de
mensen-patronen-documentatie staat het letterlijk `POTENTIAL`. Het risico is dat er **drie plekken
zijn (CAO-regel, mensen-benchmark-document, kwaliteitsmodel) die hetzelfde getal gebruiken zonder
een enkele centrale "dit getal is nog niet extern geverifieerd"-vlag** die ze alle tegelijk zou
bijwerken als de echte CAO-tekst een andere waarde blijkt te hebben. `current-state.md` labelt dit
zelf als **hoog risico**.

**Citaat:** `cao-ns-2024-2025.ts:546-556`, `result.ts:37,79`, `progress.md:38`,
`sources/manifest.json:141`, `human-roster-design-principles.md:26,115-126`,
`quality-model.ts:248-266,341`.
**Regressietest:** `tests/rules-engine/nachtregels.test.ts` (regels 79, 172-184: test met
`nightRecoveryMinutes: 46*60` en uren-reeks 8..120, toetst monotone stijging rond de 46-uursgrens)
en `tests/domain/operationele-eisen.test.ts`. Geen test die de CAO-bronstatus zelf
(transcribed/niet-gevalideerd) als voorwaarde controleert bovenop de numerieke waarde.

---

## 3. Werkblok-coherentie (~96%, 98 van 102)

**Status: solide — empirisch getal is kalibratiebron, niet ingebakken doelwaarde.**

`docs/v1.0.4-final-brain/human-pattern-evidence.md:19`: *"Werkblokken met één dagdeel | 98 van
102 (96,1%; op dagen gewogen 97,8%) | work-blocks.csv"*.
`human-roster-design-principles.md` §1 (regels 38-44) bevestigt dit: 98 van 102 werkblokken één
en hetzelfde dagdeel; 100% in Vroeg, Vroeg/Laat, Laat, Laat/Nacht en Mix; de vier uitzonderingen
zitten in BLM (één overgang laat → nacht) en 50+ Mix.

**Implementatie:** `src/domain/rhythm-metrics.ts:66` (`coherence`) en
`src/domain/quality-model.ts:179` (`flow.parts.coherence`, gewicht 0,25): *"aandeel dagen in het
dominante dagdeel van hun werkblok (blokken van twee of meer dagen)"*. Het getal 96%/98-van-102
zelf staat **niet** als harde targetwaarde in de code — het is de empirische aanleiding voor het
bestaan van deze maat, niet een ingebakken doelwaarde.

**Citaat:** `human-pattern-evidence.md:19`, `human-roster-design-principles.md:38-44`,
`rhythm-metrics.ts:66`, `quality-model.ts:179`.
**Regressietest:** `tests/domain/brein-eigenschappen.test.ts:108,121`
(`expect(r.components.flow.parts.coherence).toBe(100)` voor een volledig coherent synthetisch
rooster) en `tests/domain/menselijk-ritme.test.ts`.

---

## 4. Klok- vs. label-overgangsdrempel: geschiedenis 180min → 60min, de BLM 19/41-minuten-casus

**Status: risico — correct in één actief onderdeel, ontbreekt in een ander actief onderdeel van
hetzelfde v3-rapport.**

`human-roster-design-principles.md` §3 (regels 67-90): *"Geen heen-en-weer — op de klok, niet op
het etiket."* Waarneming: vroeg → laat → vroeg komt in zes van de zeven roosters niet voor; in
50+ Mix staat het er wel, drie keer, maar vroeg en laat overlappen daar qua klok (vroeg 07:00-
11:06, laat 09:54-13:08) — *"het etiket wisselt, de lichaamsklok nauwelijks."* Concreet voorbeeld
(regels 79-90, "Gevolg voor het platform"): de kwaliteitsmaat noemde twee regels van het
officiële 50+ Mix-rooster *"zware overgang"* (laat → vroeg), terwijl de begintijd er **19 en 41
minuten** verschoof, bij 16 en 14,6 uur rust — *"dat was een fout in de maat, niet in het
rooster."* De grens ligt op **één uur**: *"Een wissel telt als alleen een ander etiket als de
begintijd hooguit een uur verschuift."* Een eerste versie legde de grens op **drie uur**; de
zoekmachine vond dat gat zelf: in BLM liet hij een "laat" van 09:47 direct volgen door een "vroeg"
van 07:22 (13 uur rust) — iets wat in geen van de zeven officiële roosters voorkomt. Dit
ontwikkellog heet **H09** in het document.

**Implementatie** in `src/domain/quality-model.ts:181-199`
(`flow.parts.oscillation`/`flow.parts.penalty`):

```ts
oscillation: { minClockSwingMinutes: 60, /* H09: was 180 */ },
penalty:     { minClockShiftMinutes: 60, /* H09: was 180 */ },
```

en `src/domain/rhythm-metrics.ts:50` (`oscillationMinClockSwingMinutes`). De code citeert precies
hetzelfde empirische bewijs (19/41 minuten; >3 uur bij elke andere officiële wissel met >1
strafpunt) in de toelichting bij regels 191-196.

**Let op — twee code-paden, niet één.** `src/domain/roster-quality.ts` (`categoryOf()`, regels
176-186, gebruikt door `machinist-preference.ts` en het kwaliteitsmodel-v3-onderdeel *voorkeur*)
categoriseert een overgang **uitsluitend op `duty.kinds`** (het label VROEG/LAAT/NACHT), niet op
klokoverlap. De >60-minuten "alleen een ander etiket"-correctie zit dus alleen in de oudere
`rhythm-metrics.ts`/`quality-model.ts`-v1/v2-lijn (het `flow`-onderdeel), **niet** in de nieuwere
v3-voorkeurslaag die op `roster-quality.ts` steunt. Voor profielen waar labels kunnen overlappen
(BLM, 50+ Mix — precies de profielen die het referentieblok noemt) betekent dit dat de
v3-voorkeursscore een "laat → vroeg"-overgang van bijvoorbeeld 19 minuten verschil nog steeds als
een volwaardige labelwissel telt, terwijl `flow` (v1/v2) hem terecht als "geen wissel" zou zien.
Dit is een reëel verschil tussen twee actieve onderdelen van hetzelfde kwaliteitsmodel-v3-rapport.
`current-state.md` neemt dit expliciet op als één van vier concreet vastgestelde, nog niet eerder
zo benoemde defecten van deze ronde.

**Citaat:** `human-roster-design-principles.md:67-90`, `quality-model.ts:181-199`,
`rhythm-metrics.ts:50`, `roster-quality.ts:176-186`, `current-state.md` (defecttabel, rij 4).
**Regressietest:** `tests/domain/menselijk-ritme.test.ts:218` (springerig-scenario,
`expect(...flow.score!).toBeGreaterThan(60)`). Geen test gevonden die specifiek de 19/41-minuten-
BLM-casus als regressietest reproduceert (alleen als verhaal in documentatie) — dat is zelf een
gat.

---

## 5. Begintijdsprong-referentie (73 min gemiddeld/60 mediaan/150 p90/229 max)

**Status: solide — als kalibratie behandeld, expliciet niet als wettelijke grens.**

`docs/v1.0.4-final-brain/human-pattern-evidence.md:24`: *"Begintijdsprong binnen een dagdeel |
gemiddeld 73 min, mediaan 60, p90 150, max 229 | official-features.json"*.
`human-roster-design-principles.md` §6 (regels 128-137) bevestigt dit: *"Tussen twee
opeenvolgende diensten met hetzelfde dagdeel verschuift de begintijd gemiddeld 73 minuten
(mediaan 60, p90 150, maximum 229). Een op de vijf sprongen is groter dan twee uur."* En:
*"mensen accepteren een uur verschil zonder problemen. Een maat die elke minuut straft, noemt
deze roosters ten onrechte slecht."*

**Implementatie:** `src/domain/quality-model.ts:201-207`
(`flow.parts.startJitter: { freeMinutes: 60, fullMinutes: 240, ... }`) — 60 minuten (de mediaan)
is de vrije marge, 240 minuten (net boven het waargenomen maximum van 229) is waar de aftrek vol
is. `rhythm-metrics.ts:45-48` herhaalt dit met verwijzing naar dezelfde brongetallen. De
module-docstring zegt expliciet dat dit één steekproef is (`RHYTHM_CALIBRATION.learnedFromBenchmark`)
en *"bij een tweede steekproef opnieuw te ijken"* — nadrukkelijk kalibratie, geen wettelijke of
contractuele limiet.

**Citaat:** `human-pattern-evidence.md:24`, `human-roster-design-principles.md:128-137`,
`quality-model.ts:201-207`, `rhythm-metrics.ts:45-48`.
**Regressietest:** `tests/domain/menselijk-ritme.test.ts`.

---

## 6. Per-profiel karakter (principe 12)

**Status: solide, met de eigen kanttekening van het document over dunne steekproef per profiel.**

`human-roster-design-principles.md:190-205`:

| Profiel | Wat het menselijke rooster laat zien |
| --- | --- |
| Vroeg | Alleen vroeg, begintijden 04:23–09:27; blokken tot vier dagen |
| Laat | Alleen laat, begintijden 11:09–18:08 |
| Vroeg/Laat | Beide dagdelen, maar elk blok één familie; wissels altijd over 1–4 vrije dagen |
| Laat/Nacht | Laat plus één nachtreeks van zes over de regelgrens; daarna RRL |
| Mix | Families per regel: vroeg, laat of nacht; twee reeksen van vijf nachten |
| BLM | Regels 1–3 vroeg, regel 4 laat → drie nachten, regels 5–6 laat |
| 50+ Mix | Daguren: vroeg én laat tussen 07:00 en 13:08 beginnen; geen nachten; wisselt vaker van etiket, niet van klok |

Principe: *"Gebruik profielkenmerken als zachte verwachting, niet als sjabloon. Met één
roosterperiode per profiel is een getal per profiel te dun om hard op te sturen; de
profielverschillen worden daarom vooral opgevangen door klokbewust te meten (zie principe 3), en
per profiel gerapporteerd."* Dit is zelf al een eerlijke bronstatus-erkenning door het brondocument
— geen extra "niet vastgesteld" nodig, het document zegt het zelf.

**Citaat:** `human-roster-design-principles.md:190-205`.

---

## 7. Overige waarnemingen ter volledigheid (principes 2, 7-9, 11)

Kort, zonder her-onderzoek, alleen ter referentie voor de architectuurronde:

- **Dagdeelwissels over rust heen** (principe 2, regels 49-65): elke wissel na minstens één vrije
  dag, meestal twee tot vier; hoe groter de kloksprong, hoe meer vrije dagen ertussen.
- **Rust ruimer dan minimum** (principe 7, regels 139-146): gemiddeld 3,7-4,8 uur meer rust dan de
  geplande 12 uur; minder dan een uur extra in 6 van de 121 gevallen, krapste 12:29.
- **Blokken kort, vrije dagen in paren** (principe 8, regels 148-159): werkblokken gemiddeld 2,2
  dagen; 41 blokken van twee vrije dagen tegen 26 losse. Structureel bepaald door RES/R/WR-plaatsing,
  niet door de zoekmachine te optimaliseren — vandaar dat de oude maat die lange blokken beloonde is
  vervangen.
- **Weekenden** (principe 9, regels 161-168): in elk van de zeven roosters heeft precies de helft
  van de regels een volledig vrij weekend — structureel, wordt gemeten, niet geoptimaliseerd.
- **Regelgrens als gewone dag** (principe 11, regels 180-188): de overgang zondag→volgende-maandag
  weegt even zwaar als elke andere dag; bijna altijd hetzelfde dagdeel waar beide dagen gewerkt
  worden.

**Wat het document zelf zegt niet te laten zien** (slotsectie, regels 209-217): of medewerkers
deze patronen expliciet waarderen (vraagt menselijk oordeel, niet deze steekproef); of dit op
andere standplaatsen/periodes hetzelfde is (zie §9 hieronder); en dat "na nachten liever laat dan
vroeg" hier een **voorkeur in het roosterontwerp** is, gemeten aan wat mensen maakten — expliciet
**geen medische claim**.

---

## 8. Ontbrekende taxonomie: OBSERVED / PREFERRED / REQUIRED

**Bevinding — het concept bestaat inhoudelijk verspreid, maar niet als één benoemd 3-niveau
model in code.**

Er is **geen** letterlijke tekst `OBSERVED`, `"kennisniveau"` of een vergelijkbare naam voor een
uniform drieledig model aangetroffen in `src/` (brede grep op deze en verwante termen). Wat wél
bestaat, functioneel overlappend maar niet samengevoegd:

- **Statuslabels als los datatype**, verspreid over losse bronstatus-strings:
  `MACHINIST_PREFERENCE`, `HUMAN_DOMAIN_INPUT`, `USER_PROVIDED_OPERATIONAL_DESIGN_REQUIREMENT`,
  `SOURCE_TRANSCRIBED` (met `validatedBy`/`validatedAt`), en de violation-confidence-enum
  `"CONFIRMED" | "POTENTIAL"` in `src/server/rules-engine/validation/result.ts:79`. Vergelijkbare
  ideeën (hoe zeker is deze bewering), maar geen gedeeld enum/type dat overal wordt hergebruikt.
- **Een impliciete drieslag in de menselijke-patronen-documentatie zelf**: elk principe in
  `human-roster-design-principles.md` volgt het format **Waarneming** (het geobserveerde feit) →
  **Principe** (de zachte voorkeur die eruit volgt) → **Gevolg voor het platform** (wat er concreet
  mee gedaan is — niet bij elk principe aanwezig, bijvoorbeeld wel bij principe 3, 8 en 9, niet
  expliciet als aparte kop bij principe 1, 2, 4-7, 10-12). Dat is inhoudelijk dicht bij
  OBSERVED → PREFERRED → (geïmplementeerd), maar heeft **geen REQUIRED-laag** en is een
  documentopmaakconventie, geen data-model in code.
- `docs/lyra-knowledge/progress.md:40` noemt de term `HUMAN_REVIEW_REQUIRED` als gewenste status
  voor het Vroeg=10-gewicht, maar deze exacte string komt **niet voor** in `src/` — **niet
  vastgesteld** of dit label al ergens is geïmplementeerd; het lijkt een voorstel, geen bestaande
  code.

**Conclusie.** Het gevraagde OBSERVED/PREFERRED/REQUIRED-onderscheid is inhoudelijk deels aanwezig
via verschillende, niet-uniforme statuslabels, maar er bestaat geen centrale, herbruikbare
taxonomie die alle drie niveaus in één enum/type vastlegt.

**Citaat:** overgenomen uit `inventory-quality-and-preferences.md` §14; brontekst zelf:
`result.ts:79`, `human-roster-design-principles.md` (documentstructuur), `progress.md:40`.
**Risiconiveau (uit `inventory-quality-and-preferences.md` samenvattingstabel, bevestigd in
`current-state.md`): middel** — vergroot kans op toekomstige stille statusvermenging.

---

## 9. Ontbrekende scope: Dordrecht-lokaal versus NS-breed

**Bevinding — niet aangetroffen.**

Brede grep op "Dordrecht-lokaal", "NS-breed/NS-wide", "landelijk geldig" en vergelijkbare
formuleringen in `src/domain/` levert niets op. Alle brondata (de zeven officiële roosters, de
machinistenvoorkeur-opgave) is Dordrecht-specifiek (`DDR_BDU_05_10_2026`, zie
`human-roster-design-principles.md:4`: *"Afgeleid uit de zeven officiële basisroosters van
dienstenpakket DDR-BDU-05-10-2026"*), en dat wordt overal consequent vermeld als
steekproefgrootte/oorsprong (*"Alles hieronder is één steekproef: 7 basisroosters, 64 regels, 223
gewerkte dagen"*, regel 9), maar er is **geen expliciet veld, vlag of type in de code** dat een
regel of voorkeur markeert als "alleen geldig voor Dordrecht" tegenover "NS-breed toepasbaar". De
platformcode past de Dordrecht-geleerde kalibraties (nachtritme, klokdrempel, begintijdsprong,
dagdienstgewichten) toe zonder een mechanisme om ze per standplaats te differentiëren.
`rhythm-metrics.ts:36` erkent dit gedeeltelijk: *"Alles hier is één steekproef (...). De drempels
staan in `RHYTHM_CALIBRATION` zodat ze bij een tweede steekproef opnieuw te ijken zijn"* — er is
dus een mechanisme om de kalibratie **te vervangen**, maar niet om meerdere scopes **tegelijk** te
laten bestaan. Het brondocument zelf erkent deze beperking eerlijk in zijn slotsectie: *"Of dit op
andere standplaatsen of in andere roosterperiodes hetzelfde is"* staat expliciet in de lijst van
wat de roosters **niet** laten zien (`human-roster-design-principles.md:214`).

**Citaat:** `human-roster-design-principles.md:4,9,214`, `rhythm-metrics.ts:36`; overgenomen uit
`inventory-quality-and-preferences.md` §15.
**Risiconiveau (uit `inventory-quality-and-preferences.md` samenvattingstabel, bevestigd in
`current-state.md`): middel** — relevant zodra het platform een tweede standplaats/steekproef
krijgt.

---

## Samenvatting (alleen observed-from-human-rosters-kant)

| # | Onderwerp | Status | Risiconiveau |
| --- | --- | --- | --- |
| 1 | Nachtritme-curve (1..7) | Exact overeenkomend, `MACHINIST_PREFERENCE`, expliciet geen fysiologische claim | Laag |
| 2 | 46-uursherstel na nachten (waargenomen minimum: 56u) | Drie plekken, één getal, geen centrale koppeling; CAO-brontekst zelf ontbreekt | **Hoog** |
| 3 | Werkblok-coherentie (98/102, ~96%) | Kalibratiebron, geen ingebakken doelwaarde, getest | Geen |
| 4 | Klok- vs. label-drempel (180→60min, BLM 19/41min) | Correct in flow v1/v2, ontbreekt in v3-voorkeurslaag (`roster-quality.ts`) | **Middel/Hoog** |
| 5 | Begintijdsprong (73/60/150/229) | Kalibratie, expliciet niet wettelijk | Geen |
| 6 | Per-profiel karakter | Aanwezig, dunne steekproef zelf erkend door brondocument | Laag |
| 8 | OBSERVED/PREFERRED/REQUIRED-taxonomie | Inhoudelijk verspreid, geen centraal type | Middel |
| 9 | Dordrecht-lokaal vs. NS-breed scope | Geen scope-veld; vervangbaar, niet naast elkaar te laten bestaan | Middel |

**Belangrijkste risico op deze kant van het model:** het 46-uursherstel na nachten (§2) — drie
onafhankelijke plekken (CAO-regel, mensen-benchmark-document, kwaliteitsmodel-drempel) delen
hetzelfde getal zonder centrale "nog niet extern geverifieerd"-koppeling, terwijl de menselijke
data zelf nooit dichter dan 56 uur bij die 46-uursgrens komt en de onderliggende CAO-brontekst op
dit moment niet als geleverd document bestaat.

*Bron van alle bovenstaande citaten en bevindingen:
`docs/lyra-knowledge/inventory-quality-and-preferences.md` §5-9, §14-15 en
`docs/human-roster-benchmark/human-roster-design-principles.md` (volledig gelezen voor dit
document). Risiconiveaus overgenomen uit de inventaris-samenvattingstabel en bevestigd in
`docs/lyra-knowledge/current-state.md`.*
