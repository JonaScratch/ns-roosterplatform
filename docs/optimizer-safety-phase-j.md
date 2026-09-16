# Optimizer Safety — Phase J Report

Doel van deze fase: aantonen dat een toekomstige optimizer technisch onmogelijk
een kandidaat kan doorzetten zonder dat de centrale rules engine hem
onafhankelijk opnieuw valideert.

```
Automatic live roster generation enabled: NO
Simulation optimizer available:            YES
Independent final validation:              YES
Production-safe:                           NO
```

---

## 1. Architectuur

```
RosterOptimizer  →  CandidateRoster  →  FinalRosterValidator  →  ReviewableRoster
   (zuiver)          (bevroren)            (kent de optimizer niet)     (niet publiceerbaar)
```

| Onderdeel | Bestand | Wat het mag |
|---|---|---|
| `RosterOptimizer` | `server/optimizer/contract.ts` | voorstellen; méér niet |
| `BaselineOptimizer` | `server/optimizer/baseline-optimizer.ts` | reproduceren of rangeerdiensten herverdelen |
| `FutureCpSatOptimizer` | `server/optimizer/cp-sat-optimizer.ts` | weigeren, met opgave van reden |
| `CandidateRoster` | `domain/candidate.ts` | onveranderlijk zijn |
| `FinalRosterValidator` | `server/rules-engine/final-validator.ts` | oordelen |
| `ReviewableRoster` | `domain/candidate.ts` | het oordeel dragen |

Het enige wat een optimizer over zijn uitkomst mag zeggen is
`status: "CANDIDATE_GENERATED"`. `legalStatus` is geen veld dat de maker invult;
het volgt de status van het regelbestand.

**De kandidaat woont in `domain/`, niet bij de optimizer.** Daardoor kan de
validator hem kennen zonder de optimizer te kennen. Zou het type bij de
optimizer wonen, dan was de scheiding tussen "wie stelt voor" en "wie keurt goed"
alleen nog een afspraak.

---

## 2. Onafhankelijkheid van de validator

De validator bouwt de kandidaat opnieuw op uit de brongegevens — medewerkers,
diensten, contracturen, beperkingen — en haalt hem langs dezelfde
`evaluateAssignment` die ook een ruil of een reserve-invulling toetst. Hij
gebruikt niets van de vertaalslag die de optimizer maakte.

Twee architectuurtests bewaken dat, door de importgraaf af te lopen:

| Test | Wat hij eist |
|---|---|
| `final-validator` importeert nergens in zijn keten iets uit `server/optimizer/` | scheiding |
| `final-validator` deelt met de optimizer uitsluitend `@/domain/candidate` | alleen domeintypen |
| geen bestand in `server/optimizer/` importeert een databaseclient, `server/data` of `server/services` | geen schrijfweg |
| geen bestand in `server/optimizer/` bevat `.create(`, `.update(`, `.delete(` of een verwijzing naar roosterdagtabellen | geen schrijfactie |

De cyclus wordt drie keer uitgerold en alleen de middelste herhaling beoordeeld,
zodat elke beoordeelde dag een volledige cyclus historie vóór zich heeft en een
volledige erna. De overgang van de laatste week naar de eerste is een echte
overgang met echte rusttijden.

---

## 3. Geen schrijfrecht voor de optimizer

De optimizer is een zuivere functie: invoerobject in, kandidaat uit. Hij heeft
geen databaseverbinding — niet afgeschermd, maar afwezig. Alleen de servicelaag
schrijft, en uitsluitend naar `candidate_rosters`.

Dat gaat verder dan de eis ("geen permission op assignments"): er is geen pad
waarlangs een optimizerbug een roosterdag kan raken, ook niet met een verkeerde
tabelnaam. Voor productie hoort daar nog een databaserol bij die alleen op die
tabel mag schrijven; dat is een inrichtingsstap buiten deze codebase.

---

## 4. Simulation mode

Elke kandidaat draagt `mode: "SIMULATION"` en `legalStatus: "SIMULATION_ONLY"`.
De simulatiepagina toont dat permanent, boven de scenario's.

| Mag | Mag niet |
|---|---|
| genereren | publiceren als live rooster |
| analyseren | assignments naar medewerkers schrijven |
| vergelijken met het huidige rooster | de dienstindeling wijzigen |
| scores krijgen | |
| als simulatie geëxporteerd worden | |

**Er staat geen publicatieknop op de pagina — ook geen uitgeschakelde.** Een
uitgeschakelde knop nodigt uit om te zoeken naar de voorwaarde die hem aanzet,
en die voorwaarde is dan één regel code. Wat er wél staat, is de reden:
*"Publicatie is uitgesloten zolang de actuele juridische ruleset niet is
gevalideerd"*, met een verwijzing naar de regelcatalogus.

---

## 5. Geen tweede regelboek

De optimizer krijgt de harde constraints uit de centrale catalogus
(`constraintsFromCatalog()`), met per regel of hij naar een solverconstraint te
vertalen is en zo niet, waarom niet. Op de huidige dataset:

| | Aantal |
|---|---|
| Harde constraints in de catalogus | 64 |
| vertaalbaar naar een optimizerconstraint | 54 |
| niet vertaalbaar | 10 |

De tien niet-vertaalbare blijven volledig bij de eindvalidatie liggen. De
optimizer mag daarmee kandidaten blijven maken; de validator blijft beslissend.

De enige domeinfunctie die de `BaselineOptimizer` raadpleegt is
`profileAllowsDuty` — dezelfde functie die de rules engine gebruikt, niet een
tweede implementatie ervan. Verder rekent hij geen enkele grens na.

---

## 6. Kandidaatversies en onveranderlijkheid

```ts
CandidateRoster {
  id, optimizerName, optimizerVersion, scenarioLabel,
  sourceScheduleVersion, rulesetVersion, inputDataVersion,
  generatedAt, mode, legalStatus, assignments, scoreBreakdown, hash
}
```

`sealCandidate()` bevriest het object en zet de vingerafdruk erop. De hash gaat
over inhoud **en** herkomst: dezelfde toewijzingen onder een ander regelbestand
zijn niet hetzelfde voorstel. Een wijziging maakt een nieuwe kandidaat.

---

## 7. Stale-state protection

Bij elke beoordeling worden drie versies vergeleken. Wijkt er één af, dan wordt
er niets beoordeeld:

| Situatie | Status | Getoetst |
|---|---|---|
| bronrooster gewijzigd | `STALE_SCHEDULE` | 0 toewijzingen |
| regelbestand gewijzigd | `STALE_RULESET` | 0 toewijzingen |
| diensten/medewerkers/contracturen gewijzigd | `STALE_INPUT` | 0 toewijzingen |
| inhoud wijkt af van de vingerafdruk | `TAMPERED` | 0 toewijzingen |

`sourceScheduleVersion` is een vingerafdruk over álle cyclusdagen van alle
roosterlijnen: één gewijzigd dienstnummer maakt elke eerdere kandidaat verouderd.
De kandidatenlijst toont dat vooraf, zodat niemand eerst een validatie hoeft te
starten om het te ontdekken.

---

## 8. Scoremodel

Negen deelscores van 0 tot 100, elk met een uitgeschreven formule:

| Deelscore | Formule |
|---|---|
| `restQuality` | gemiddelde waardering per rustperiode: <12 u → 0, 12–14 u → 50, 14–16 u → 75, ≥16 u → 100 |
| `weekendBalance` … `reserveBalance` | 100 − min(100, verschil zwaarste/lichtste lijn als % van het gemiddelde), **binnen** een basisrooster |
| `patternQuality` | 100 · (1 − min(1, (2·geïsoleerd + 3·achterwaarts + 1·groot + 2·cluster) / dienstdagen)) |
| `feedbackAlignment` | 50 + gemiddelde relatieve daling van de belasting waarover een meerderheid klaagt, ten opzichte van het huidige rooster |
| `overallQualityScore` | gewogen gemiddelde; gewichten staan zichtbaar in `scoring.ts` |

`overallQualityScore = 100` betekent "zo goed als dit model kan meten" en
uitdrukkelijk niet "juridisch geldig". Die twee staan nergens op dezelfde as.

**Ongewenste patronen**, alle vier zacht en geen van alle een grens:

- *geïsoleerde late dienst* — late dienst met aan beide kanten een vroege dienst;
- *achterwaartse verschuiving* — volgende dienst begint ≥4 uur eerder, met <16 uur rust;
- *grote verschuiving* — starttijd verspringt ≥6 uur tussen twee dienstdagen;
- *zware cluster* — ≥3 opeenvolgende dienstdagen die alle nacht of alle rangeer zijn.

**Rustkwaliteit** wordt niet alleen als minimum gerapporteerd maar als verdeling
over vijf bakken (<12, 12–14, 14–16, 16–24, >24 uur), met het nachtherstel
apart.

---

## 9. Hard constraint dominance

De rangschikking is lexicografisch, niet gewogen:

```
bevestigde overtredingen ↑ · mogelijke overtredingen ↑ ·
ontbrekende regels ↑ · ontbrekende historie ↑ · kwaliteit ↓
```

Kwaliteit doet pas mee wanneer twee kandidaten op rechtmatigheid gelijk staan.
Getest: kwaliteit 97 met één bevestigde overtreding komt onder kwaliteit 82 met
nul, en kwaliteit 100 met één *mogelijke* overtreding onder kwaliteit 10 zonder.
Er bestaat geen aantal kwaliteitspunten waarvoor een overtreding te koop is.

---

## 10. Vergelijking en eerlijkheid

Per basisrooster én in totaal: lijnen, diensten, vroeg, laat, nacht, harde nacht,
rangeer, 760/761, weekenddiensten, lange diensten, RES, WTV, CO, gemiddelde
rust, kortste rust, rustverdeling, kortste nachtherstel en kwaliteitsscore.

Eerlijkheid wordt in een navertelbare zin gerapporteerd:

```
Rangeerbelasting: verschil zwaarste/lichtste rooster 18% → 9% (50% gelijkmatiger)
```

Naast het bereik wordt de variatiecoëfficiënt vastgelegd, maar de zin die de
planner leest, gebruikt de maat die in de wandelgangen wordt besproken.

**Uitlegbaarheid.** Voor elke significante wijziging staat er wat er gebeurde,
dat beide profielen de dienstsoort toestaan, wat het met de verdeling deed, wat
het met de rustkwaliteit deed — en dat de eindvalidatie beslist of het mag. Geen
solverinternals.

---

## 11. Historische eerlijkheid

`HistoricalBurden` staat in het contract met `historicalNightBurden`,
`historicalWeekendBurden`, `historicalShuntingBurden` en `observedDays`. De lijst
is **leeg**: met 91 dagen historie is elke uitspraak hierover ruis. Het contract
staat klaar, de gegevens niet.

## 12. Feedback

Uitsluitend geaggregeerd, per profiel, als aandeel met het aantal respondenten.
Er gaat geen personeelsnummer langs. Een signaal telt pas mee bij een meerderheid
(≥50%) en genoeg respondenten (≥5) — anders zou één ontevreden medewerker het
rooster van een heel profiel kunnen sturen.

---

## 13. Mutantkandidaten — de kritieke acceptatietest

Elke mutant komt tot stand als kandidaat en wordt door de validator afgewezen
mét de regel die erbij hoort. Alleen "afgewezen" zou te zwak zijn: op dit moment
wordt élke kandidaat afgewezen omdat het regelbestand onvolledig is.

| Mutant | Afgewezen op |
|---|---|
| 8 diensten achter elkaar | `MAX_CONSECUTIVE_SERVICES` |
| 11 u 59 dagelijkse rust | `RP_DAILY_REST_PLANNED` |
| 13 u 59 na een nachtdienst | `NIGHT_REST_AFTER_0200` |
| 45 u 59 na drie nachtdiensten | `NIGHT_SEQUENCE_RECOVERY` |
| nachtdienst in het profiel Vroeg | `ROSTER_PROFILE_BOUNDS` |
| dubbele toewijzing op één cyclusdag | structurele controle |
| roosterlijn zonder bezetter | `unvalidatableAssignments` |

---

## 14. Race conditions en regelwijzigingen

| Scenario | Uitkomst |
|---|---|
| kandidaat op bronrooster X, rooster wordt X+1 | `STALE_SCHEDULE`, niets beoordeeld |
| kandidaat onder regelbestand V1, V2 geactiveerd | `STALE_RULESET`, opnieuw valideren |
| dienst- of medewerkergegevens gewijzigd | `STALE_INPUT` |
| inhoud aangepast, vingerafdruk blijft staan | `TAMPERED` |

---

## 15. Prestatie op de volledige Dordrecht-dataset

5 basisroosters, 30 roosterlijnen, 5 profielen, 22 diensten, 840 toewijzingen.

| | Nulmeting | Rangeerbelasting |
|---|---|---|
| generatie | 3 ms · 245.000 toewijzingen/s | 1 ms · 737.000 toewijzingen/s |
| eindvalidatie | 1420 ms · 279 dienstdagen/s | 1355 ms · 292 dienstdagen/s |
| vergelijking | 3 ms | 2 ms |
| geheugen (heap-delta) | 7,3 MB | 1,9 MB |
| kwaliteitsscore | 95,1 | 95,1 |
| uitkomst | `REJECTED` | `REJECTED` |

De validatie is ruim vierhonderd keer duurder dan de generatie. Dat is de juiste
verhouding voor deze keten: goedkoop voorstellen, grondig narekenen. Geen SLA —
alleen een nulmeting om later een verslechtering te kunnen zien.

**Uitkomst van de eindvalidatie op beide kandidaten:** 0 bevestigde
overtredingen, 204 mogelijke, 160 toewijzingen met een ontbrekende regel, 396
zonder de vereiste historie. Zoals voorzien haalt geen enkele kandidaat
`TECHNICALLY_VALIDATED`, en dat is correct gedrag.

---

## 16. Defecten gevonden tijdens deze fase

1. **Verdeling werd over alle profielen samen gemeten.** Een lijn in Vroeg heeft
   nul nachtdiensten en een lijn in Laat/Nacht een stuk of tien; dat verschil is
   de bedoeling. De oude berekening las het als extreme scheefheid en gaf het
   bestaande rooster kwaliteitsscore 50 in plaats van 95,1. Scheefheid wordt nu
   binnen een basisrooster gemeten en gewogen naar het aantal lijnen.
2. **Een cyclus met één dienst leverde geen rustperiode op.** De rustberekening
   sloeg lijnen met minder dan twee diensten over, terwijl de cyclus rond is: de
   rust loopt van het einde van die dienst tot zijn eigen begin een cyclus later.
   Gevonden door een test op de wikkeling.
3. **Een dubbele toewijzing verdween stilzwijgend.** Bij het uitrollen won de
   laatste toewijzing voor een cyclusdag, zonder melding. Nu een structurele
   controle die de kandidaat afwijst.
4. **De draaiende dev-server had een verouderde Prisma-client** na de migratie,
   waardoor de pagina een generieke fout gaf in plaats van de kandidatenlijst.
   Geen codedefect, wel een die tijd kost als je hem niet herkent.

---

## 17. Verificatie

| Controle | Uitkomst |
|---|---|
| `npx eslint` | 0 problemen |
| `npx tsc --noEmit` | 0 fouten |
| `npx vitest run` | 201 tests, 16 bestanden, alles groen |
| `npm run build` | geslaagd |
| `npm run verify:rules` | regelbestand structureel in orde |
| `npm run measure:optimizer` | zie hoofdstuk 15 |
| handmatig in de applicatie | scenario gegenereerd, gevalideerd (`REJECTED`), vergelijking getoond |

Nieuwe tests in deze fase: 44, verdeeld over mutanten (9), versies en
onveranderlijkheid (7), architectuur (5), scoremodel en rangschikking (16),
baseline-optimizer (7).

---

## 18. Wat er niet is gebouwd

- **Geen CP-SAT-productieoptimizer.** Het contract ligt vast en er is een tweede
  implementatie die weigert, zodat bewezen is dat de keten een tweede optimizer
  aankan zonder wijziging elders.
- **Geen publicatie.** Niet uitgeschakeld: afwezig.
- **Geen historische eerlijkheid.** Contract klaar, gegevens ontbreken.
- **Geen live roostergeneratie.**

---

```
Automatic live roster generation enabled: NO
Simulation optimizer available:            YES
Independent final validation:              YES
Production-safe:                           NO
```
