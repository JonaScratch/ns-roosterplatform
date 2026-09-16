# PHASE L — NS DORDRECHT OPERATIONAL PLANNING REPORT

Datum: 4 september 2026
Status: **Production-safe: NO — simulatie/ontwikkeling.**

---

## Branding

**Official NS logo installed: NO.**

Het logo is in de opdracht als afbeelding meegestuurd, maar staat niet als
bestand op deze machine — niet in de repository, niet in `public/brand/`, niet
in Downloads of op het bureaublad. Een afbeelding in een gesprek is geen bestand:
de bytes zijn niet te kopiëren zonder het beeld na te tekenen, en natekenen was
uitdrukkelijk verboden.

Wat er wél is:

- `src/components/ui/ns-logo.tsx` — het centrale component dat op alle plekken
  wordt gebruikt (zijbalk, aanmeldscherm, alle vier de omgevingen, print);
- `src/server/branding/assets.ts` — zoekt `public/brand/ns-logo.svg|png` en een
  witte variant voor donkere achtergronden;
- `public/brand/LEESMIJ.md` — waar het bestand hoort.

Zodra het bestand daar staat, verschijnt het overal tegelijk, met behoud van de
beeldverhouding (alleen de hoogte wordt gezet, `width: auto`). Tot dat moment
staat er de bestaande neutrale vorm — geen nagetekend en geen "NS-achtig" merk.

---

## Import

| | |
| --- | --- |
| Expected Dordrecht duties | **223** |
| Aangeleverd bestand aanwezig | **NEE** |
| Parsed | n.v.t. |
| Normalized | n.v.t. |
| Dropped | n.v.t. |
| Duplicated | n.v.t. |

De volledige Dordrecht-dienstenset van 223 diensten (34/36/34/35/33/26/25 per
weekdag) is **niet als bestand aangetroffen**. Er is niets "ongeveer" ingevuld en
er zijn geen 223 diensten verzonnen: dat zou precies het soort fictieve
brongegevens opleveren waar dit platform tegen is gebouwd. Conform de opdracht
("Wanneer parser en bron verschillen: STOP") is de import op de bestaande
gegevens gedraaid en is het verschil hier gemeld.

Wat er nu in de database staat, is het eerder geseede pakket: **22 diensten,
DDR-DR2026-V1**.

### Wat wél is gebouwd aan de importkant

- **Herkomst per dienst** (`Duty.sourceRow`, `Duty.sourceValues`): bestandsnaam,
  SHA-256, importversie, regelnummer en de letterlijke celwaarden vóór
  normalisatie. De vraag "waar komt dienst 101 vandaan" heeft nu een antwoord op
  het scherm.
- **Reconciliatie**, gemeten met `npm run verify:import`: het huidige pakket
  wordt teruggeschreven naar het aanleverformaat en opnieuw ingelezen. Uitkomst:
  22 van 22 diensten terug, **geen enkel veld verandert onderweg**, 6
  nachtdiensten houden hun eindtijd voorbij middernacht, twee keer lezen geeft
  hetzelfde resultaat.
- **Importbeveiliging**: formule-injectie geweigerd, padtrucs gestript, 5 MB
  grens, alleen `.csv`/`.txt`, nulbytes geweigerd, dubbele records geweigerd,
  bestand nooit uitgevoerd. 22 tests in `tests/import/dienstenpakket.test.ts`.

---

## Duty Pool

Gemeten op de huidige Dordrecht-gegevens (`npm run measure:optimizer`), per
scenario identiek:

| | |
| --- | --- |
| Dienstinstanties (dienstnummer × weekdag) | **78** |
| Fixed roster | **78** |
| Operational pool | 0 |
| Unassignable | 0 |
| Excluded (met reden) | 6 |
| **Conservation** | **PASS** — 78 + 0 + 0 = 78 |

De zes uitgesloten diensten dragen een reden: het pakket vermeldt geen
weekdagen en ze komen in geen enkele roosterlijn voor. Zonder weekdag is er geen
roosterdag om ze op te plaatsen. Ze verdwijnen niet; ze staan in de boekhouding.

**Wat dit blootlegt:** de roosterlijnen hebben samen **830 dienstdagen** en er
zijn 78 dienstinstanties. De solver laat de overige dienstdagen daarom leeg en
meldt dat ("752 van de 830 dienstdagen bleef leeg"). Dat is geen fout van de
solver maar de waarheid over deze gegevens: met 22 diensten is een rooster voor
30 lijnen niet te vullen. Het volledige pakket van 223 diensten is precies wat
hier ontbreekt.

---

## Optimizer

| | |
| --- | --- |
| CP-SAT | **YES** — Google OR-Tools, `python/cpsat_roster.py` |
| Global optimization | **YES** — alle lijnen en profielen in één model |
| Profiles solved simultaneously | **YES** |
| Scenarios generated | **5** (A–E, alleen gewichten en zaadwaarde verschillen) |

Gemeten op de volledige Dordrecht-dataset:

| Scenario | Solverstatus | Optimaliteit bewezen | Rekentijd | Model |
| --- | --- | --- | --- | --- |
| A — beste totale balans | OPTIMAL | ja | 3,8 s | 8 924 variabelen, 15 231 constraints |
| B — beste rustkwaliteit | OPTIMAL | ja | 3,1 s | idem |
| C — eerlijkste lastenverdeling | OPTIMAL | ja | 1,4 s | idem |
| D — minste verschil met huidig | OPTIMAL | ja | 3,1 s | idem |
| E — maximale plaatsing | OPTIMAL | ja | 3,3 s | idem |

Eigenschappen die per test zijn vastgelegd (`tests/optimizer/cpsat.test.ts`, 12
tests):

- de optimizer draait als **apart proces zonder databaseverbinding**;
- ankerdagen komen niet als variabele in het model voor — ze zijn niet te
  verplaatsen, ook niet door een fout in de gewichten;
- een dienstinstantie wordt hooguit één keer gebruikt;
- een maandagdienst komt niet op dinsdag terecht;
- twee runs met dezelfde invoer en zaadwaarde geven identieke plaatsingen;
- bij een onoplosbaar model komt er geen half rooster maar een weigering met
  conflictanalyse;
- `FEASIBLE` en `OPTIMAL` worden apart gerapporteerd, ook op het scherm.

---

## Validation

| | |
| --- | --- |
| Independent FinalValidator | **PASS** — 100 % van de toewijzingen, geen steekproef |
| Hard violation bypass possible | **NO** |

De architectuurtest loopt de volledige importgraaf van de validator af en faalt
zodra daar iets uit `server/optimizer` in voorkomt. De validator hertoetst elke
kandidaat vanaf de databasestand, niet vanuit het geheugen van de solver.

Uitkomst op de gegenereerde scenario's: **REJECTED**, met 0 bevestigde
overtredingen, 10–11 mogelijke overtredingen, 29–47 toewijzingen met een
onvolledig regelbestand en 56–69 met onvoldoende roosterhistorie. Dat is het
verwachte gedrag zolang de juridische regelverzameling niet is gevalideerd.

---

## Reserve

| | |
| --- | --- |
| Normal duties in Reserve baseline | **NO** |
| OperationalAssignment layer | **PASS** |
| Self-service suitability | **PASS** |
| Late → RES → early unsuitable filtering | **PASS** |

De geschiktheidslaag (`src/domain/suitability.ts`) is de belangrijkste
toevoeging van deze fase, en het uitwerken ervan leverde meteen een correctie op
het voorbeeld uit de opdracht op — zie *Gevonden defecten* hieronder.

De laag beoordeelt altijd `vorige → kandidaat → volgende` en weegt rust vooraf,
rust erna, draairichting, ritme en zwaarte. Eén slecht oordeel is genoeg om een
dienst niet vanzelf aan een medewerker voor te stellen; middelen zou juist het
geval verbergen waar het om gaat.

De medewerker ziet alleen wat past, met een verantwoording eronder ("3 diensten
sluiten niet goed aan op uw eigen rooster"). De dienstindeling ziet ook wat
minder goed aansluit, met de bezwaren per onderdeel. Wat de rules engine
afkeurt, is voor beiden onbereikbaar.

---

## Amendment

| | |
| --- | --- |
| R locked | **YES** |
| WR locked | **YES** |
| CO locked | **YES** |
| RES locked | **YES** |
| WTV locked | **YES** (gedragen door `WR` in dit datamodel) |
| Structural changes | **0** |

Twee onafhankelijke lagen, zoals gevraagd: de solver kan een anker niet
aanraken omdat het geen variabele is, en de rules engine blokkeert het als
`ROSTER_ANCHOR_LOCKED`. `npm run verify:wijzigingsblad` vergelijkt bovendien de
database met de bevroren baseline.

Minimale verandering is scenario D (`keepExisting`), met een hoog gewicht op het
behouden van bestaande dienstnummers.

---

## DID

| | |
| --- | --- |
| Reserve matching | **PASS** — `/dienstindeling/koppelen/[id]` |
| Final revalidation | **PASS** — volledige hertoetsing op het moment van klikken |
| Concurrency | **PASS** — voorwaardelijke claim binnen één transactie |

De planner ziet per kandidaat de onderbouwing per onderdeel (rust vooraf, rust
erna, draairichting, ritme, zwaarte) en de voorkeur. Niet-inzetbare medewerkers
staan er mét reden bij, zonder knop.

Bij het toewijzen wordt eerst voorwaardelijk geclaimd en dan pas geschreven; een
tweede planner die tegelijk klikt, krijgt "Een andere planner heeft deze dienst
zojuist toegewezen".

---

## Export

| | |
| --- | --- |
| Official template | **NO** — de canonieke NS-roosterbladen zijn niet aangeleverd |
| PDF | **NO** — printbare HTML met A4-liggend printprofiel |
| Preview parity | **PASS** — één renderer voor scherm en export |
| Official logo | **NO** — zie Branding |

`renderRosterDocument` is de enige renderer. Het blad draagt een metagegevensblok
en, zolang het regelbestand niet in productie draait en geverifieerd is, op drie
plaatsen `SIMULATIE — GEEN VASTGESTELD ROOSTER`. Die bewering komt uit de stand
van het regelbestand en is niet via de interface uit te zetten. 14 tests.

Een echte PDF-generator is bewust niet gebouwd: zonder de officiële opmaak zou
hij alleen overtuigender liegen over hoe officieel het blad is.

---

## Security

| | |
| --- | --- |
| Authorization | **PASS** — 17 paden × 4 rollen, per rol zoals verwacht |
| Location isolation | **PASS** — server bepaalt de standplaats, niet het scherm |
| Audit | **PASS** — import, bevestiging, activering, generatie, toewijzing, export, statuswijziging |
| Concurrency | **PASS** |
| Tamper protection | **PASS** — kandidaathash, stale-state op regelbestand, invoer en rooster |

Een medewerker die `?standplaats=RTD` opvraagt, krijgt zijn eigen gegevens plus
een regel in het beveiligingslog. Geen foutmelding die bevestigt dat die
standplaats bestaat.

---

## Reliability

| | |
| --- | --- |
| Data integrity | `npm run verify:integriteit` — 9 van 10 controles groen |
| Duty conservation | **PASS** in de optimizer; **1 bevinding** in de bestaande gegevens |
| Crash recovery | Solver draait als apart proces; een crash raakt geen gegevens |
| Stale-state protection | **PASS** — regelbestandversie, invoerversie en roosterversie |

De ene rode controle is echt en staat hieronder bij de defecten.

---

## Tests

| Soort | Aantal |
| --- | --- |
| Unit + integratie (vitest) | **287**, 22 bestanden, alles groen |
| Optimizer (incl. CP-SAT) | 43 + 12 |
| Import | 22 |
| Export | 14 |
| Geschiktheid | 14 |
| Structuur en standplaats | 19 + 6 |
| Security (verify:toegang) | 17 paden × 4 rollen |
| Mutatietests fase J | behouden en groen |

`tsc --noEmit` schoon, `eslint` schoon, `npm run build` slaagt.

---

## Gevonden defecten

Alles hieronder kwam boven door de code tegen echte gegevens te draaien.

1. **Het voorbeeld uit de opdracht was met de rusttijd al afgevangen.** De eerste
   versie van de geschiktheidstests gebruikte "101 tot 01:24, dinsdag 05:00" als
   het geval waarvoor de laag bestaat. Dat is 3 uur 36 rust: dat valt al af op de
   rustnorm zelf. De laag bijt op twee andere plekken, en die staan nu in de
   tests: **met een vrije of reservedag ertussen** (maandag laat, woensdag 05:00
   — 27 uur rust, juridisch niets aan de hand, ritme in één stap omgedraaid) en
   **net boven het minimum** (12 uur 6 minuten: toegestaan, maar niet iets om als
   eerste voor te stellen).

2. **440 dubbel bezette diensten in de bestaande gegevens.** Dezelfde dienst
   wordt op dezelfde dag door meerdere mensen gereden. Met 22 dienstnummers en 30
   roosterlijnen kan dat niet anders. De CP-SAT-solver weigert die dubbeling —
   daarom laat hij 752 dienstdagen leeg in plaats van ze te vullen met diensten
   die al elders rijden. Gegevensprobleem, geen codeprobleem; het volledige
   pakket lost het op.

3. **De prestatiemeting verzon weekdagen.** `measure-optimizer.ts` gaf elke
   dienst `weekdays: [1..7]` mee. Daarmee zou de optimizer geloven dat elke
   dienst elke dag rijdt. Nu komen de weekdagen uit het pakket, en waar dat
   niets zegt uit de dagen waarop de dienst werkelijk in de roosterlijnen staat.

4. **De reservelaag was bijna dode code.** De `OperationalAssignment`-laag
   bestond sinds fase K, maar `attemptReserveFill` overschreef het RES-slot nog
   rechtstreeks. Nu loopt de invulling door de laag en herstelt intrekken de
   reservedag.

5. **Beschikbare diensten toonden juridisch geldige maar onlogische diensten.**
   De lijst filterde alleen op de rules engine. Nu gaat elke kandidaat door de
   geschiktheidslaag en verantwoordt de pagina wat er is weggelaten.

6. **Zaadloze solverruns zijn niet reproduceerbaar.** Zonder vaste zaadwaarde en
   met meerdere zoekthreads gaf CP-SAT wisselende oplossingen bij identieke
   invoer. Nu één thread, vaste zaadwaarde per scenario, en de hele run wordt
   opgeslagen.

7. **Seedgegevens noemden Utrechtse ritten en namen op Dordrechtse diensten**
   ("Sprinter Utrecht – Amersfoort", "Rooster Commissie Utrecht"). Vervangen door
   neutrale omschrijvingen; er zijn geen Dordrechtse ritten verzonnen.

---

## Remaining NS inputs

Alleen wat werkelijk ontbreekt:

1. **Het NS-logobestand** in `public/brand/` (SVG of PNG; een witte variant voor
   donkere achtergronden is welkom).
2. **Het volledige Dordrecht-dienstenpakket** (223 diensten) als bestand, met per
   dienst minimaal: dienstnummer, weekdag, begintijd, eindtijd, standplaats. Waar
   beschikbaar ook taken, treinnummers, van/naar en benodigde bevoegdheden.
3. **De canonieke NS-roosterblad-PDF's** als sjabloon voor de export.
4. **De bevoegdhedenmatrix**: materieel, baanvakken, certificaten en hun
   geldigheid (nu `QUALIFICATION_DATA_INCOMPLETE`).
5. **De bijzondere regels voor Mix, 50+ Mix en BLM** (nu `POLICY_PENDING`).
6. **Het lokale regelkader** van elke standplaats die live moet; zonder dat
   blijft het `LOCAL_RULESET_NOT_CONFIGURED`.
7. **De dienstregelingdatums** voor de eerstvolgende Dordrechtronde.
8. **De betekenis van de planeenheden** 1 en 2 (ASD, RTD, UT).
9. **Formele validatie van de juridische regelverzameling** — ATW, ATB-vervoer,
   CAO en lokale afspraken. Dit is wat productie blokkeert.

---

## Wat níet is gebouwd

Eerlijk en zonder omweg:

- **Echte PDF-generatie** (§77–§79): geblokkeerd op het ontbrekende sjabloon.
- **De structurele herindeling bij een nieuwe dienstregeling** (§54): de solver
  neemt de bestaande ankerstructuur als gegeven. Ankers verplaatsen kan hij dus
  niet — veilig, maar het betekent dat een compleet nieuwe roosterstructuur nog
  met de hand wordt bepaald.
- **De heatmap en de "wat als ik dienst 101 hier zet"-simulator** (§61, §107):
  het roosterscherm toont wel elke cel met rust ervoor, rust erna, ritme en
  ankersoort, en is doorklikbaar naar de dienstenbak.
- **Het interessevenster met allocatiefasen** (§98): de bestaande
  roulatie-toewijzing blijft zoals hij was.
- **Historische eerlijkheid over meerdere jaren** (§114): alleen het contract
  staat klaar; er is geen betrouwbare historie.

---

## Production status

**Production-safe: NO.**
Reden: de juridische regelverzameling (ATW, ATB-vervoer, CAO en lokale kaders) is
nog niet volledig formeel gevalideerd. 2 van de 71 regels zijn gevalideerd; 10
regelpakketten ontbreken.

**Simulation readiness: YES.** Importeren, inspecteren, optimaliseren,
onafhankelijk valideren, vergelijken en als simulatie exporteren werken
end-to-end op de Dordrecht-gegevens.

**Dordrecht end-to-end demo readiness: PARTIAL.** Alles werkt, maar op 22 in
plaats van 223 diensten en zonder officieel logo of exportsjabloon. Met die drie
bestanden erbij is de demo compleet.
