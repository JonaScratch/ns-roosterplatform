# Rule Engine Implementation Report

> **Gecorrigeerd na de regelinterpretatie-audit.** Dit rapport noemde 933 dienstdagen
> een harde overtreding. Die kwalificatie was te sterk. Na de audit staat de teller op
> **nul bevestigde overtredingen** en 1139 dienstdagen met een *mogelijke* overtreding.
> De audit vond zeven defecten, waaronder de "overlap op 05:00" die hier ten onrechte
> als bronvraag stond en een fout in de code bleek. Zie
> [rule-interpretation-audit.md](rule-interpretation-audit.md) voor de onderbouwing;
> de cijfers in hoofdstuk 4 en 5 hieronder zijn van vóór die audit.

Fase 3 — centrale, fail-closed rules engine voor arbeids- en rusttijden.
Peildatum van de meting: 2026-09-02, standplaats Dordrecht, NS Reizigers, machinisten.

---

## 1. Production-safe

**Production-safe: NO — simulation/development only**

Dit is geen fout maar het gewenste gedrag. De voorwaarden waaronder dit op `YES`
mag komen te staan, staan in hoofdstuk 8. Op dit moment is er geen enkele regel
die door NS is bevestigd, en ontbreken tien regelpakketten waarvan er twee
wettelijk zijn.

| | |
|---|---|
| Regelbestand | `2026.1-cao-2024-2025-transcribed` |
| Modus | `SOURCE_RULESET_SIMULATION` |
| Juridische status | `LEGAL_RULESET_NOT_CURRENTLY_VERIFIED` |
| Gevalideerde regels | 0 van 69 |
| Ontbrekende regelpakketten | 10 |

De modus is niet met een omgevingsvariabele te forceren. `RULESET_MODE=production`
wordt door `activeRuleset()` teruggezet naar simulatie zolang er blokkerende
pakketten ontbreken: een vlag in een `.env`-bestand mag geen juridische
bevestiging kunnen vervangen.

---

## 2. Wat er is gebouwd

Eén ingang, `evaluateAssignment()`, met daarachter één regelbestand. Roostercommissie,
dienstindeling, reserve-inzet, beschikbare diensten, ruilingen en de latere optimizer
lopen alle vier langs dezelfde functie.

### Regelbestand (`src/server/rules-engine/ruleset/`)

Elke regel draagt bron, artikel, laag, reikwijdte, geldigheidsperiode en
validatiestatus mee. `const MIN_REST = 12` bestaat niet meer: dat is in een
roosterapplicatie geen constante maar een juridische bewering.

| Verdeling | Aantal |
|---|---|
| CAO NS 2024–2025 | 59 |
| Roosterkaders Regio West 2026 | 4 |
| Functionele uitgangspunten platform | 6 |
| **Totaal** | **69** |
| waarvan hard | 64 |
| waarvan zacht | 4 |
| waarvan optimalisatiedoel | 1 |

| Status | Aantal | Betekenis |
|---|---|---|
| `SOURCE_TRANSCRIBED` | 63 | Overgenomen uit de bron, niet bevestigd |
| `UNVALIDATED_LOCAL_PARAMETER` | 2 | Standplaatswaarde niet aangeleverd |
| `UNRESOLVED` | 2 | Bron laat meerdere lezingen toe |
| `NEEDS_POLICY_VALIDATION` | 1 | Juridische status nog te bepalen |
| `POLICY_PENDING` | 1 | Aangekondigd, niet uitgewerkt |
| `VALIDATED` | **0** | — |

Er staat **geen enkele** regel uit de Arbeidstijdenwet of het Arbeidstijdenbesluit
vervoer in het bestand. Die bronnen zijn niet aangeleverd en zijn niet
gereconstrueerd.

### Controles

| Bestand | Wat het toetst |
|---|---|
| `checks/eligibility.ts` | Profiel, standplaats, dagbeschikbaarheid, bevoegdheden, individuele beperkingen |
| `checks/duty-limits.ts` | Arbeidstijd en dienstlengte per dienst, incl. nacht- en startbandvarianten |
| `checks/daily-rest.ts` | 12 uur gepland, 8 uur niet-planmatig, 14 uur na nacht, 46 uur herstel |
| `checks/sequences.ts` | Maximaal 7 aaneengesloten diensten, 7 in een nachtreeks |
| `checks/weekly-hours.ts` | 60 per week, 55 per 4 weken, 48 per 16 weken, 40 bij veel nachten |
| `checks/weekly-rest.ts` | 36 uur per 7×24 óf 72 uur per 14×24, R-daglengte, R-dagen per week |
| `checks/counters.ts` | Vroege starts per 4 weken, lange diensten per jaar, nachten per 16 weken, vrije zondagen per 52 weken |
| `checks/weekend.ts` | Driewekelijks vrij weekend |
| `checks/quality.ts` | Rustkwaliteit en rotatierichting — uitsluitend als score |

### Vijf uitkomsten, geen boolean

> **Verouderd (§ LYRA MASTER PROGRAM, conflict-report.md #7, 2026-09-29):** de
> tabel hieronder gebruikt een oudere, vijfvoudige naamgeving die door de
> audit is ingehaald. De huidige code (`src/server/rules-engine/validation/result.ts`)
> hanteert een zesvoudige naamgeving: `VALID_WITHIN_VALIDATED_RULESET`,
> `VALID_WITH_WARNINGS`, `CONTEXT_INCOMPLETE`, `RULESET_INCOMPLETE`,
> `POTENTIAL_HARD_VIOLATION`, `CONFIRMED_HARD_VIOLATION`. De tabel zelf blijft
> hier ongewijzigd staan als punt-in-tijd-record van dit rapport; voor de
> huidige, geldende uitkomsten geldt `validation/result.ts`, niet deze tabel.

| | Uitkomst | Laat door | Wat je eraan doet |
|---|---|---|---|
| 🟢 | `VALID` | ja | niets |
| 🟡 | `VALID_WITH_WARNINGS` | ja | afwegen |
| 🟠 | `REQUIRES_REVIEW` | **nee** | roosterhistorie aanleveren |
| ⚫ | `RULESET_INCOMPLETE` | **nee** | regel of parameter aanleveren |
| 🔴 | `HARD_VIOLATION` | **nee** | rooster aanpassen |

"Ongeldig" en "niet te beoordelen" zijn twee verschillende antwoorden met twee
verschillende vervolgacties. Beide blokkeren; alleen de oplossing verschilt.

---

## 3. Hoe onbekende waarden worden behandeld

Twee mechanismen, allebei bedoeld om te voorkomen dat er een aannemelijk getal
wordt ingevuld.

**Bandbreedtes.** De duur van de werkonderbreking voor Dordrecht is niet
aangeleverd; de bron noemt 32–40 minuten. De arbeidstijd is daarmee geen getal
maar een bereik. Een toets blokkeert alleen wanneer de onzekerheid het antwoord
werkelijk bepaalt: een dienst van zes uur wordt niet tegengehouden door een
onbekende marge van acht minuten op een grens van negen uur. Een dienst van 9:30
wél.

**Toepasselijkheidsgestuurde context.** Een regel vraagt zijn venster pas op
wanneer hij op deze dienst van toepassing is. Een gewone dinsdagdienst heeft geen
kalenderjaar aan historie nodig; een dienst van meer dan negen uur wel. Zonder
dit zou elke plaatsing op het langste venster vastlopen en zou fail-closed in de
praktijk fail-useless worden.

---

## 4. Wat de meting op het bestaande rooster opleverde

`npm run verify:rooster` — 30 medewerkers, 1678 roosterdagen met een dienst,
dekking 2026-08-03 t/m 2026-11-01.

| Uitkomst | Aantal | Aandeel |
|---|---|---|
| 🟢 Geldig | 0 | 0% |
| 🟡 Geldig met aandachtspunten | 0 | 0% |
| 🟠 Niet te beoordelen | 345 | 21% |
| ⚫ Regelbestand onvolledig | 400 | 24% |
| 🔴 Harde overtreding | 933 | 56% |

Veertig regels zijn daadwerkelijk doorgerekend. Zesendertig daarvan zijn toegepast
terwijl hun bron op de roosterdatum niet loopt — de CAO eindigt op 2025-12-31 en
het rooster staat in 2026. In productiemodus zou dat blokkeren; in simulatiemodus
wordt de laatst bekende versie toegepast en per uitkomst gemeld.

### 4a. Harde bevindingen — `REQUIRES_RULE_REVIEW`

Dit zijn **geen** conclusies dat het rooster fout is. Bij een niet-gevalideerde
bron is een verkeerd overgenomen regel minstens zo waarschijnlijk.

| Aantal | Regel | Wat NS moet vaststellen |
|---|---|---|
| 698 | `RED_WEEKEND_MIN_REST` | Of 60 uur aaneengesloten rust rond zaterdag 00:00 – maandag 04:00 de juiste lezing is. De gemeten roosterlijnen halen dit nergens: een vrije zaterdag én zondag tussen een late vrijdagdienst en een vroege maandagdienst levert ±55 uur op. Steekproef bevestigd: medewerker 100001 werkt 29-08, 05-09 én 12-09. |
| 234 | `RP_MAX_DUTY_START_0400_0501` | Zie hoofdstuk 5: overlap op 05:00. |
| 208 | `RP_MAX_EARLY_STARTS_0500_0600_PER_4W` | De VROEG-lijnen leveren 15 starts tussen 05:00 en 06:00 per vier weken; de bron noemt 10. Of de lijn of de regel klopt niet. |
| 63 | `WEEKLY_REST_36H_PER_7D` | Weken waarin noch 36 uur per 7×24 noch 72 uur per 14×24 wordt gehaald. |
| 2 | `NIGHT_MAX_WORK` | Nachtdiensten boven 8,5 uur arbeidstijd. |
| 2 | `RP_NIGHT_ACROSS_0230_MAX_WORK` | Idem, band rond 02:30. |
| 2 | `NIGHT_MAX_DUTY_DURATION` | Nachtdiensten boven 9 uur dienstlengte. |
| 2 | `RP_NIGHT_ACROSS_0230_MAX_DUTY` | Idem, band rond 02:30. |

### 4b. Ontbrekende regels of parameters

Op te lossen door aanlevering, niet door roosterwijziging.

| Aantal | Ontbrekend |
|---|---|
| 668 | `R_DAY_TRANSFER_REGISTER` — weken met minder dan twee R-dagen; er is geen bron waaruit blijkt of een R-dag is overgebracht |
| 332 | `MIX_PROFILE_SPECIAL_RULES` — bijzondere regels voor Mix, 50+ Mix en BLM |
| 38 | `QUALIFICATION_MATRIX` — geen gevalideerde bron voor bevoegdheden |

### 4c. Onvoldoende roosterhistorie

Een gegevensprobleem, geen roosterprobleem. De database bevat 91 dagen.

| Aantal | Venster |
|---|---|
| 1678 | `WEEKS_16` |
| 516 | `DAYS_14` |
| 516 | `WEEKS_4` |
| 260 | `DAYS_7` |
| 120 | `WEEKS_52` |
| 117 | `ADJACENT_DUTIES` |
| 2 | `CALENDAR_YEAR` |

---

## 5. Openstaande vragen over de bron

1. **Overlap op 05:00.** De banden "start tussen 04:00 en 05:01" (maximaal 7 uur
   dienstlengte) en "start tussen 05:00 en 06:00" (maximaal 8,5 uur) overlappen.
   Een dienst die om precies 05:00 begint valt onder beide en krijgt de strengste
   grens. In het aangeleverde rooster start een groot deel van de vroege diensten
   om 05:00; dat verklaart 234 van de 933 harde bevindingen. Er is hier geen grens
   verschoven om het rooster passend te maken.
2. **Rood weekend: 60 uur versus zaterdag 00:00 – maandag 04:00.** Dat venster is
   52 uur. De 60 uur moet dus eerder beginnen dan zaterdag 00:00. Waar precies,
   staat niet in de bron.
3. **Vrijstelling zeer vroege start vanaf 55 jaar.** De formulering "prioritair,
   voor zover de omstandigheden dit toelaten" laat in het midden of dit een harde
   constraint of een prioriteitsregel is.
4. **Verkorte wekelijkse rust, eens per vijf weken.** De engine kan dat interval
   niet zelf bewaken: er is geen register van eerder verleende verkortingen. Dit
   wordt bij elke toepassing expliciet gemeld en blijft de verantwoordelijkheid
   van de roostercommissie.

---

## 6. Defecten die tijdens de bouw zijn gevonden

Alle zes zijn gevonden door de code te draaien, niet door hem te lezen.

1. **Een verlopen CAO keurde alles goed.** Bij de eerste testrun kwamen twaalf
   tests terug met "geen bevindingen" voor een rooster in 2026. Oorzaak: de
   regelopzoeker gaf zowel "deze regel gaat niet over deze medewerker" als "er is
   geen versie die op deze datum loopt" terug als *niet van toepassing*. Het
   resultaat was een systeem dat na 2025-12-31 elke plaatsing zonder één bevinding
   goedkeurde — het gevaarlijkste antwoord dat dit systeem kan geven. Opgelost met
   een aparte uitkomst `OUT_OF_PERIOD`, die in productiemodus blokkeert en in
   simulatiemodus de laatst bekende versie toepast en dat per uitkomst meldt.
2. **Twee regelboeken naast elkaar.** De oude `parameters.ts` bevatte eigen
   grenswaarden: 11 uur minimumrust waar de CAO-transcriptie 12 zegt, 6
   opeenvolgende werkdagen waar de CAO 7 zegt. Beide werden gebruikt, door
   verschillende onderdelen. Verwijderd; `parameters.ts` bevat nu uitsluitend
   productinstellingen zonder juridische betekenis.
3. **`NEEDS_POLICY_VALIDATION` blokkeerde niet.** Gevonden door `verify:rules`.
   Een regel waarvan NS de juridische status nog moet vaststellen, kon met een
   ingevulde waarde gewoon worden toegepast. Toegevoegd aan `BLOCKING_STATUSES`.
4. **De dagbezettingscontrole ging verloren bij de overzetting.** Bij het
   herschrijven van de integratietests bleek dat een dienst op een dag waar al een
   dienst stond, stilzwijgend werd overschreven. Hersteld, inclusief het
   onderscheid met een ruil, waarbij de dag juist vrijkomt.
5. **Contractomvang was nooit geseed.** Het veld bestond na de migratie maar was
   leeg, waardoor de validator terecht élke urenregel weigerde te beoordelen:
   1678 blokkades. Toegevoegd aan de seed en aangevuld in de bestaande database.
6. **De overlap op 05:00** (hoofdstuk 5.1) — gevonden doordat een testfixture die
   toevallig om 05:00 begon, onverwacht op een 7-uursgrens stukliep.

---

## 7. Verificatie

| Controle | Uitkomst |
|---|---|
| `npx eslint` | 0 problemen |
| `npx tsc --noEmit` | 0 fouten |
| `npx vitest run` | 133 tests, 9 bestanden, alles groen |
| `npm run build` | geslaagd |
| `npm run verify:rules` | regelbestand structureel in orde |
| `npm run verify:rooster` | 1678 dienstdagen doorgerekend, zie hoofdstuk 4 |
| `npm run verify:toegang` | alle vier de rollen gedragen zich zoals verwacht; 50 weigeringen vastgelegd |

Tests per onderwerp: grenswaarden op de minuut (11:59/12:00/12:01, 9:30/9:31,
7 en 8 aaneengesloten diensten, 10 en 11 vroege starts, 14 uur na een nachtdienst,
46 uur herstel), fail-closed gedrag (verlopen bron, ontbrekende standplaatswaarde,
onbekende contractomvang, ontbrekende kwalificatiematrix, Mix-profiel, te korte
historie), zomer- en wintertijd, rood weekend, wekelijkse arbeidstijd en de
terugvalvariant van 72 uur per veertien dagen.

---

## 8. Wat er nodig is voordat `Production-safe: YES` mag

1. Een gevalideerd Arbeidstijdenwet-pakket.
2. Een gevalideerd Arbeidstijdenbesluit vervoer-pakket.
3. Bevestiging welke CAO actueel is voor de planningsperiode.
4. De standplaatswaarden voor Dordrecht: duur van de werkonderbreking en de
   daaraan gekoppelde verlaging van de maximale arbeidstijd.
5. Een gevalideerde kwalificatiematrix uit een bronsysteem.
6. Een geautoriseerde bron voor individuele arbeidstijdbeperkingen.
7. De bijzondere regels voor Mix, 50+ Mix en BLM.
8. De definitie van de weekendmaatstaf Regio West.
9. De regels van de roosterposities WR en CO.
10. Beantwoording van de vier openstaande bronvragen uit hoofdstuk 5.
11. Roosterhistorie van ten minste 52 weken, zodat de lange vensters beoordeeld
    kunnen worden in plaats van als hiaat gemeld.

Pas wanneer 1 tot en met 10 zijn afgehandeld, laat `activeRuleset()` de
productiemodus toe. Punt 11 is een gegevensvoorwaarde en blokkeert de modus niet,
maar zonder die historie blijft een deel van de uitkomsten "niet te beoordelen".

---

## 9. Wat dit betekent voor het gebruik nu

Beschikbare diensten, ruilingen en reserve-invulling leveren op dit moment nul
toegestane plaatsingen op. Dat is geen storing: het is de fail-closed engine die
weigert goed te keuren wat zij niet kan bewijzen. Elk scherm draagt daarom een
balk die dit benoemt, met een verwijzing naar de regelcatalogus — anders leest een
lege lijst als "er is niets" terwijl de werkelijkheid "dit is niet te beoordelen"
is.
