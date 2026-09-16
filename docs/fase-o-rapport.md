# PHASE O — DORDRECHT FINAL BUILD REPORT

Opgemaakt op 2026-09-05. Alle cijfers hieronder komen uit een draai van de
genoemde scripts op de aangeleverde bronnen; er staat geen getal in dat niet
ergens uit is gemeten.

---

## 1. Bronnen

Elf bestanden aangeleverd, elf geopend en gecontroleerd. Ze staan als fixture in
`tests/fixtures/dordrecht-bronnen/`, zodat elke controle herhaalbaar is en niet
leunt op een pad in een downloadmap. Volledige inventaris met hashes:
`docs/source-inventory-phase-o.md`. Draaien: `npm run verify:bronnen` — 8/8.

| Bron | Status |
| --- | --- |
| 7 roosterbladen (PDF) | `PARSED` — 64 regels, 448 dagcellen, 223 diensten |
| `NS CAO 2024-2025.pdf` | `PARSED` — 107 pagina's, 175 artikelen, ~338k tekens |
| `BDU DDR Oktober 2026.docx` | `PARSED_NO_DUTY_DATA` — omslagtekst en een foto van een trein |
| `Roosterkaders Regio West 2026` | `SOURCE_PRESENT_NOT_MACHINE_READABLE` — scan, 0 lettertypen |
| `ns-logo.svg` | `PARSED` — is in werkelijkheid een **PNG** (476×273) |

Drie dingen die aandacht vragen en niet zijn opgelost omdat ze niet door mij
opgelost kunnen worden:

- het regionale roosterkader is een scan zonder tekstlaag. Er is bewust géén OCR
  op losgelaten: een raadslag over wat er in een ondertekend kader staat, is
  precies het soort bron dat later niemand meer als raadslag herkent;
- het BDU-document bevat geen dienstgegevens. De volledige dienstenset komt uit
  de zeven roosterbladen;
- het beeldmerk is een PNG met een `.svg`-naam. Het is als PNG uitgeleverd, niet
  nagetekend en niet vervangen.

## 2. Branding

`npm run verify:branding` — 9 geslaagd, 0 mislukt, 0 geblokkeerd.

Het aangeleverde bestand staat als `public/brand/ns-logo.png` (sha256
`20563d22…`) en wordt gebruikt in het aanmeldscherm, de zijbalk van alle vier de
omgevingen, en de export. In de PDF-export gaat het als uitgepakte pixels mee
(`src/server/export/png-decode.ts`) en niet als PNG-bytes: PDF en PNG delen wel
de compressie maar niet de filterlaag, en die overeenkomst geldt niet voor elke
PNG. In de HTML-export gaat het als data-URI mee, zodat een opgeslagen blad geen
gebroken plaatje wordt.

Het beeldmerk is donkerblauw; de zijbalk is donker. Het staat daar op een witte
chip. Niet nagetekend, niet gegenereerd, niet vervangen.

## 3. Dienstenimport — 223

`npm run verify:bronnen` telt de diensten op drie manieren die elkaars fouten
niet delen:

| Telling | Uitkomst |
| --- | --- |
| ontlede dagcellen | 223 |
| tijdvakken in de ruwe brontekst, buiten de ontleding om | 223 |
| urenbehoud: celduren tegen de weeklengte van het blad | 64/64 regels sluitend |

Per weekdag: maandag 34, dinsdag 36, woensdag 34, donderdag 35, vrijdag 33,
zaterdag 26, zondag 25 — **exact de eerder vastgestelde canonieke telling**. Er
is niets bijgesteld om dat uit te laten komen; het script vergelijkt en past niet
aan.

`npm run verify:import` doet de terugweg: het pakket wordt naar CSV geschreven en
opnieuw ingelezen. Alle 223 komen terug, geen enkel veld verandert onderweg, en
de 55 diensten over middernacht houden hun eindtijd voorbij 24:00.

### De belangrijkste vondst van deze fase

**Een dienstnummer is geen dienst.** 39 van de 46 Dordrechtse dienstnummers
hebben per weekdag andere tijden — 101 begint op maandag om 18:08 en op donderdag
om 16:27. Het schema had `@@unique([packageId, code])`. Daarmee passen 223
diensten in 46 rijen en verdwijnen er 177 zonder foutmelding.

De identiteit is nu standplaats + dienstregeling + weekdag + nummer, en dat is
overal doorgevoerd: databasesleutel, CSV-kolom `weekdag`, versievergelijking,
dekkingscategorisering, dienstenbak, detailscherm met weekdagkiezer,
eindvalidatie. Dit was óók de oorzaak van het openstaande integriteitsdefect uit
fase N (§6).

## 4. Roosterreconciliatie

`npm run verify:roosterbron` — 11/11, **nul verschillen** tussen de zeven bladen
en de database.

| Rooster | Blad | Regels |
| --- | --- | --- |
| DDR-V | Vroeg 1 VA | 12 |
| DDR-VL | Vroeg/Laat 1 - B | 10 |
| DDR-L | Laat 1 - LA | 12 |
| DDR-LN | Laat/Nacht 1 - C | 6 |
| DDR-MIX | Mix 1 A | 12 |
| DDR-50MIX | 50+ mix 1 - Y | 6 |
| DDR-BLM | BLM 1 - BLMD | 6 |

448 dagcellen één voor één vergeleken op positietype en dienstnummer. Het
behoud sluit:

```
448 invoer = 223 vast rooster + 56 operationele pool + 169 niet-toewijsbaar + 0 uitgesloten
verdwenen 0 · dubbel 0
```

Het dienstenpakket draagt de sha256 over de zeven bladen samen; wijzigt één blad,
dan valt de reconciliatie om.

## 5. Regels tegen de bronnen

`npm run verify:regelbronnen` — 7/7. `docs/rule-coverage.md` wordt gegenereerd
door `npm run docs:regeldekking`, niet met de hand bijgehouden.

| Status | Aantal |
| --- | --- |
| SOURCE_PRESENT | 66 / 71 |
| TRANSCRIBED | 71 / 71 |
| IMPLEMENTED | 71 / 71 |
| TESTED | 25 / 71 |
| **FORMALLY_VALIDATED** | **0 / 71** |

Alle 59 CAO-regels noemen een artikel, en elk genoemd artikel bestaat werkelijk
in de aangeleverde CAO. Sterker: van de 58 regels met een waarde staan er **49**
met dat getal in de tekst van het artikel waar zij naar verwijzen.

Zeven waarden staan niet in het aangehaalde artikel. Eén daarvan is een concrete
aanwijzing: `WEEKLY_REST_72H_PER_14D` verwijst naar artikel 100 ("Maximum aantal
diensten"), terwijl het getal 72 in het hele hoofdstuk arbeids- en rusttijden
alleen in artikel 99 ("Wekelijkse arbeids- en rusttijd") voorkomt. **Dit is niet
aangepast.** Een artikelnummer bijstellen op grond van een getalsvergelijking zou
een bronverwijzing verzinnen, en dat is erger dan een verwijzing die niet klopt:
bij die laatste is tenminste te zien dát er iets nagekeken moet worden.

Eén defect wél opgelost: het eigen productbeleid stond met `legalAuthority:
"LOKAAL"` in laag `LOCAL`, dus binnen de NS-bronhiërarchie, waar het bij gelijke
naam een CAO-regel had kunnen overstemmen. Het heeft nu een eigen laag
`PRODUCT_POLICY`, onderaan.

`FORMALLY_VALIDATED` blijft op nul. Dat is geen tekortkoming van de bouw: het
betekent dat niemand bij NS heeft bevestigd dat deze waarden de juiste zijn.

## 6. Gegevensintegriteit — 19/19

`npm run verify:integriteit` — 19 geslaagd, 0 mislukt.

Het openstaande defect uit fase N (de "440 dubbelgeboekte diensten") was geen
dubbelboeking. Het script toetste op dienstnummer alleen en meldde 177
"duplicaten" die dezelfde nummers op verschillende weekdagen waren. Op het
nummer toetsen zou juist afdwingen dat er van dienst 101 nog maar één overblijft.
De toets kijkt nu naar de identiteit.

```
DDR-BDU-05-10-2026-V1: 223 diensten (46 nummers) · 223 in vaste roosters · 0 niet geplaatst
```

## 7. NEW_TIMETABLE — structurele generatie

`npm run verify:structuurgeneratie` — 3/3. Nieuw:
`src/domain/structure-generation.ts` (zuiver, geen database) en
`src/server/services/roster-structure-service.ts`.

Voor elk van de zeven roosters kan een structuur worden bepaald waarin **elk
positietype exact bewaard blijft** — evenveel rust-, reserve-, WTV- en
compensatiedagen als er nu zijn. Het voorstel zou 256 van de 448 dagcellen (57%)
anders leggen.

**Er wordt niets weggeschreven.** Het huidige rooster komt uit de aangeleverde
bladen van NS; een generator die dat overschrijft, vervangt een bron door een
berekening, en in de database ziet dat er hetzelfde uit.

Tijdens de meting bleek dat het aantal reservedagen kromp (7→6, 15→12): een
gemiddelde per week dat werd afgerond. Drie reservedagen minder is drie dagen
waarop de dienstindeling een uitval niet meer kan opvangen. Reservedagen zijn nu
een totaal dat over de regels wordt verdeeld en niet kan krimpen.

Ook bleek dat er helemaal geen roosterperiode bestond — de seed maakte er geen.
Zonder periode weigert de structuurgenerator, zegt het roosterblad "geen
roosterperiode vastgelegd" en heeft een wijzigingsblad geen baseline. Die staat
er nu, met de datums van de bladen zelf.

## 8. Wijzigingsblad — de ankers liggen vast

`npm run verify:wijzigingsblad` — 12/12, **werkelijk uitgevoerd** en daarna
opgeruimd. Dit meldde eerder "er is nog geen wijzigingsblad aangemaakt; niets te
vergelijken": een groene uitkomst over een controle die niet was gedaan.

Het script legt de structuur vast (448 dagen, 225 ankers), opent een echt
wijzigingsblad daarop, en probeert vervolgens een rustdag in een dienstdag te
veranderen. Geweigerd. Alle vier de ankertypen (RUST, RES, WR, CO) zijn getoetst,
niet alleen de rustdag. Wat wél mag — een ander dienstnummer op een dienstdag —
wordt toegelaten.

## 9. Optimizer op de volledige set

`npm run measure:optimizer`, vijf scenario's, model met 29 557 variabelen en
71 754 constraints.

| Scenario | Solver | Diensten | Sluitend | Eindvalidatie |
| --- | --- | --- | --- | --- |
| A beste balans | FEASIBLE | 221 vast, 2 pool | ja | REJECTED |
| B rustkwaliteit | FEASIBLE | 221 vast, 2 pool | ja | REJECTED |
| C lastenverdeling | FEASIBLE | 218 vast, 5 pool | ja | REJECTED |
| D minste verschil | OPTIMAL | 220 vast, 3 pool | ja | REJECTED |
| E maximale plaatsing | FEASIBLE | **223 vast, 0 pool** | ja | REJECTED |

Alle vijf sluiten: `223 = vast + pool + niet-plaatsbaar + uitgesloten`, met nul
niet-plaatsbaar en nul uitgesloten.

## 10. Twee defecten in de eindvalidatie

Dit is het ernstigste dat deze fase heeft opgeleverd, en het kwam pas boven water
doordat de echte gegevens erin gingen.

**Vóór:** scenario E kwam eruit als `TECHNICALLY_VALIDATED` — het gunstigste
oordeel dat dit systeem kan geven — met **nul beoordeelde toewijzingen**.

De oorzaak: `expand()` bouwde zijn sleutel met een weekindex vanaf nul, terwijl
`RosterLineDay.weekIndex` vanaf één telt. Bij de oude cyclus van vier weken
vielen drie van de vier weken toevallig nog samen en leek het te werken. Bij de
echte cyclus van één week viel er niets meer samen en kwam er geen enkele dienst
door. De testfixture had exact dezelfde verschuiving, dus de suite bleef groen.

Twee fouten die elkaar opheffen, zien er precies zo uit als geen fouten.

**Drie reparaties:**

1. de weekindex telt vanaf één, in de validator én in de fixture;
2. de dienstenlijst wordt op nummer + weekdag gesleuteld; op nummer alleen hield
   101 van zondag de tijden van 101 van maandag;
3. een kandidaat met dienstdagen waarvan er nul zijn beoordeeld, geldt niet meer
   als schoon maar als ongetoetst.

**En één modelleringsfout eronder:** de validator rolde één roosterregel
herhaald uit. Maar een medewerker rijdt niet elke week dezelfde regel — hij
schuift er elke week één op. Het rooster dat werd getoetst, reed niemand. De
uitrol volgt nu de echte rotatie langs alle regels.

**Na:** scenario E beoordeelt **2206 toewijzingen** in plaats van 0, en komt uit
op REJECTED met 1138 mogelijke overtredingen, 1842 ontbrekende regels en 1222
ontbrekende historie. Dat is geen verslechtering; dat is de eerste keer dat er
werkelijk iets is beoordeeld.

## 11. Beschikbare diensten — de toestandsmachine

`EXPIRED` en `WITHDRAWN` stonden in de opsomming maar werden nergens gezet. Een
dienst waarvan de inschrijving was gesloten, bleef daardoor eeuwig `OPEN`:
verdwenen uit het scherm van de medewerker (dat op de sluitingstijd filtert) maar
nog openstaand bij de dienstindeling. Twee schermen die iets anders zeggen over
dezelfde dienst, geen van beide aanwijsbaar fout.

De toestanden zijn nu compleet, met de overgangstabel als enige waarheid
(`src/domain/available-duty-state.ts`, 14 tests):

```
RESERVE_PENDING → OPEN → ALLOCATION_PENDING → ALLOCATED
                     ↘        ↘ CLOSED
                      ↘ CANCELLED
```

Wat de opdracht `INTEREST_PERIOD` noemt, heet hier `OPEN`: het is dezelfde
toestand, en er twee namen voor hebben zou een verschil suggereren dat er niet is
— een verschil dat vroeg of laat door iemand wordt ingevuld. `ALLOCATION_PENDING`
staat er wél apart in, want dat moment bestond niet.

Geen wie-het-eerst-klikt: toewijzen volgt de roulatievolgorde, toetst elke
belangstellende opnieuw op het moment van toewijzen, en legt een momentopname van
de ranglijst vast (`awardRanking`).

## 12. Bezetting per weekdag

Nieuw scherm `/roostercommissie/bezetting`
(`src/server/services/coverage-heatmap-service.ts`): per weekdag en dagdeel
hoeveel diensten er te rijden zijn, hoeveel roosterregels die dragen, hoeveel
reservedagen en hoeveel vrije regels ernaast liggen.

Geen streefwaarde en geen stoplicht. De kleur is een verhouding binnen deze
standplaats — de donkerste cel is de drukste cel van dit rooster — en dat staat
er ook bij. Welke bezetting gewenst is, volgt uit afspraken die niet zijn
aangeleverd, en die worden hier niet verzonnen.

## 13. Plaatsingssimulator

`analyseTransfer` (`src/server/services/roster-transfer-service.ts`, uit fase N)
loopt elke startregel van een doelrooster langs en toetst de overgang daarheen:
eerst mág het, dan sluit het aan. Er wordt niets geschreven. Bereikbaar via
`/dienstindeling/roosters/[employeeId]`.

## 14. Export — een echt PDF-bestand

Nieuw: `src/server/export/pdf-writer.ts`, `png-decode.ts` en `roster-pdf.ts`.
Zonder bibliotheek, want een PDF-generator die alles kan, is een grote
afhankelijkheid met een eigen aanvalsoppervlak voor een document dat uit tekst,
lijnen en één afbeelding bestaat.

`/roostercommissie/roosterblad/DDR-V?formaat=pdf` levert `application/pdf`, 9561
bytes, `%PDF-1.4`, met `%%EOF` en een kruisverwijzingstabel. Gecontroleerd in
`verify:schermen`.

22 tests lezen het geschreven bestand terug met dezelfde lezer waarmee de
aangeleverde NS-bladen worden ingelezen. Wat daar uitkomt, is wat er werkelijk in
staat en niet wat de schrijver dacht te schrijven.

Waarom niet de browser laten printen: een blad dat wordt gemaild of afgedrukt,
moet bij iedereen hetzelfde zijn. Een browserprint hangt af van de browser, de
printerinstelling en de schermbreedte, en dan hebben twee machinisten met
hetzelfde rooster twee verschillende bladen in handen.

Het blad liegt niet: het simulatiestempel staat op drie plaatsen (kop, watermerk,
voet). Wie er één wegknipt, laat de andere twee staan. Past een rooster niet op
één pagina, dan komt er een pagina bij — er valt geen regel weg. Past een
dienstnummer niet in een cel, dan wordt het zichtbaar afgekapt.

## 15. Schermen, toegang en standplaatsafbakening

| Meting | Uitkomst |
| --- | --- |
| `verify:schermen` | 19 schermen in orde, 0 met bevindingen |
| `verify:toegang` | alle vier de rollen gedragen zich zoals verwacht |
| `verify:standplaatsen` | 6/6 — 41 standplaatsen, alleen DDR ingericht |

Alleen Dordrecht is functioneel ingericht. Geen enkele andere standplaats erft
de inrichting van Dordrecht; wie er een opvraagt, krijgt
`LOCAL_RULESET_NOT_CONFIGURED` en geen stille terugval.

## 16. Meldingen, ruilingen, plaatsingen

| Meting | Uitkomst |
| --- | --- |
| `verify:meldingen` | 8/8 |
| `verify:ruilingen` | 7/7 |
| `verify:ruilflow` | 8/8 |
| `verify:rotatie` | 14/14 — twee onafhankelijke berekeningen, 1560 weekposities |
| `verify:plaatsingen` | 10/10 |
| `verify:tijdelijk` | 12/12 |
| `verify:projectie` | 3/3 |

De seed maakt nu zelf de 64 roosterplaatsingen aan. Dat was een los
backfill-script, en daardoor was een half gevulde database — medewerkers zonder
rooster — de normale toestand na `npm run db:seed`.

## 17. De tests testen

`npm run verify:mutanten` — **18 van de 18 opzettelijke fouten gevangen**, elk met
de naam van de bewering die rood werd.

Dit ging twee keer mis voordat het klopte, en beide keren op de manier waar de
meting tegen bedoeld is:

1. de eerste draai meldde 18/18 met "? tests werden rood". Het patroon vond niets
   omdat vitest kleurcodes tussen het getal en het woord zet;
2. daarna bleek dat er helemaal geen test had gedraaid: `spawnSync npx.cmd
   EINVAL`. Node weigert sinds versie 20 een `.cmd` zonder shell. Elke "gevangen"
   mutant was een startfout. Een meting die "de testrun mislukte" als "gevangen"
   leest, staat dan op 18/18 zonder iets te hebben gemeten.

Nu telt een mutant alleen als gevangen wanneer er aantoonbaar een *bewering* rood
werd. De eerste eerlijke draai gaf 14/18 en vier echte gaten in de dekking:

- een onleesbare cel die als rustdag wordt gelezen;
- reservedagen die bij afronding krimpen;
- duplicaatdetectie op dienstnummer alleen;
- versievergelijking die de weekdag negeert.

Alle vier zijn met tests gedicht. Daarna 18/18.

## 18. Testsuite

| | |
| --- | --- |
| Testbestanden | 27 |
| Tests | 407, allemaal geslaagd |
| Overgeslagen | 0 |
| Todo | 0 |
| Beweringen | 708 |
| `toets(..., true)` of gelijkwaardig | 0 |

Project-breed gezocht naar overgeslagen tests, todo's en beweringen die niets
toetsen. De twee treffers op `, true)` in `verify-ruilflow.ts` zijn de parameter
`accept` van `respondToSwapCore` en geen holle bewering.

`npm run typecheck` en `npx eslint .` geven beide nul meldingen.

## 19. Wat er niet af is

Eerlijk, want dit is de sectie waar het om gaat.

**Niet aangeleverd, dus niet gebouwd:**

- de Arbeidstijdenwet en het Arbeidstijdenbesluit vervoer. Niet gereconstrueerd;
- de kwalificatiematrix. Elke dienst heeft een lege bevoegdhedenlijst met
  `QUALIFICATION_DATA_NOT_AVAILABLE`, geen verzonnen bevoegdheden;
- de werkonderbreking per standplaats;
- de betekenis en regels van WR en CO. Zij worden als code gedragen;
- de bijzondere regels voor Mix, BLM en 50+ Mix;
- de individuele arbeidstijdbeperkingen uit een HR-bron;
- de contractomvang per medewerker. Er wordt geen 36 of 40 uur aangenomen;
- bevestiging welke CAO in 2026 geldt. De aangeleverde heet 2024–2025.

**Aangeleverd maar niet leesbaar:** het regionale roosterkader is een scan. De
vier regionale regels blijven op hun huidige status.

**Gebouwd maar nog niet volledig getoetst:**

- 46 van de 71 regels worden door geen enkele test bij naam genoemd. Zij kunnen
  stilletjes verkeerd rekenen zonder dat er iets rood wordt. Dit staat per regel
  in `docs/rule-coverage.md`;
- geen enkele kandidaat komt door de eindvalidatie. Dat is fail-closed en
  correct gedrag, maar het betekent ook dat de weg van generatie naar publicatie
  nog nooit helemaal is afgelegd;
- de structuurgenerator schrijft niets weg. Er is dus geen bewijs dat een
  gegenereerde structuur ook door de hele keten komt;
- visuele regressie op de zes roosterbladen is niet ingericht; de PDF-export is
  op inhoud getoetst en niet op beeld.

**Eén bronverwijzing die vermoedelijk niet klopt:** `WEEKLY_REST_72H_PER_14D`
noemt artikel 100 terwijl het getal alleen in artikel 99 staat (§5). Niet
aangepast.

---

## Production-safe: NO

Dit platform is niet vrijgegeven voor productieplanning, en dat is geen formule
maar de uitkomst van de meting:

- `FORMALLY_VALIDATED` staat op 0 van de 71. Geen enkele regel is door NS
  bevestigd;
- twee wettelijke regelpakketten ontbreken volledig;
- het regelbestand draait in `SOURCE_RULESET_SIMULATION` met juridische status
  `LEGAL_RULESET_NOT_CURRENTLY_VERIFIED`;
- geen enkele roosterkandidaat is technisch gevalideerd;
- `publiceerbaar` staat bij elke kandidaat op false.

Elke export draagt het stempel. Elk plannerscherm draagt de banner.

**Automatische roostergeneratie voor productie: NEE.**

---

## Draaien

```bash
npm run db:up && npm run db:seed
npm run verify:bronnen
npm run verify:roosterbron
npm run verify:regelbronnen
npm run verify:structuurgeneratie
npm run verify:wijzigingsblad
npm run verify:integriteit
npm run verify:mutanten
npm run docs:regeldekking
npm test
```

De schermcontroles vragen een lopende ontwikkelserver:

```bash
npm run verify:schermen && npm run verify:toegang
```
