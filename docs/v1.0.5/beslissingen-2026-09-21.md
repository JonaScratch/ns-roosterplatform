# Aanvullende ontwikkelbeslissingen — 21 september 2026

*Vastgelegd naar aanleiding van de beslissingen van Jonathan van 21-09-2026. Deze
beslissingen wijzigen de masterprompt v1.0.5 op de hieronder genoemde punten; wat er niet
staat, blijft zoals het was. De benchmarkmethodiek (`benchmark-methodology.md`) en de
eerdere metingen M0, M1 en M2 blijven onaangetast.*

## 1. RET betekent rangeerdienst

**Besluit.** RET is binnen dit project de aanduiding voor een rangeerdienst.

**Herkomst.** Opgegeven door Jonathan, 21-09-2026. Dit is domeinkennis van de gebruiker,
geen formeel bevestigde NS-terminologie, en staat als zodanig in het woordenboek
(`src/server/agent/vocabulary.ts`, bron `GEBRUIKER`).

**Wat er in de gegevens staat — eerst gecontroleerd, niet aangenomen.** In het
Dordrechtse pakket `DDR-BDU-05-10-2026-V1` komt de letterlijke tekst "RET" in geen enkele
dienstcode, omschrijving of bronwaarde voor. Rangeerdiensten staan er als:

| Nummer | Dagdeel | Instanties |
| --- | --- | --- |
| 701, 702, 703 | vroeg | 13 |
| 730, 731, 732 | laat | 12 |
| 760, 761 | nacht | 14 |

Samen 39 dienstinstanties met `workType = RANGEER`. De vertaling van het begrip loopt
daarom via de dienstsoort en niet via de letters. Wie op de letters had gezocht, had
"niet gevonden" geantwoord op een vraag waarvan het antwoord in de gegevens staat.

**Gevolg.** De hoofdvraag uit de praktijkscenario's wordt nu uit de gegevens beantwoord;
zie `docs/v1.0.5/scenario-ret.md` voor het letterlijke antwoord.

## 2. Einddoel: een volledig lokale AI-agent

**Besluit.** Het productieplatform mag voor zijn normale AI-functionaliteit niet
afhankelijk zijn van Claude, OpenAI, andere externe taalmodel-API's, externe
inferentiediensten of een permanente internetverbinding. Claude blijft ontwikkelassistent
en wordt geen runtime-afhankelijkheid.

**Gevolg voor de architectuur.** De modeladapter (`src/server/agent/model/types.ts`) was
hier al op gebouwd: het model kiest de weg, de feiten komen uit de eigen database. Wat
erbij komt is een lokale runtime achter diezelfde adapter. Wat er niet verandert: tools,
rechten, geheugen, regels en validator blijven waar ze zijn.

**Gevolg voor de benchmark.** De intelligentiebenchmark blijft bestaan, maar krijgt er
een aparte lokale-AI-benchmark naast (zie punt 6). De stub blijft bestaan voor het testen
van de infrastructuur en telt nooit als bewijs van intelligentie.

## 3. Modelkeuze: onderzoeken, niet aannemen

**Besluit.** Onderzoek welke lokaal uitvoerbare modellen geschikt zijn voor Nederlands,
machinistentaal, meerstaps redeneren, gestructureerd toolgebruik, regelinterpretatie,
lange gesprekken en hypothesevorming. Niet automatisch het grootste model; wel een
licentie die het beoogde gebruik én verdere training toestaat.

**Stand.** Hardware en kandidaten staan in `lokale-ai/hardware-en-modellen.md`. Er is nog
geen model gekozen; die keuze volgt uit de meting op deze machine.

## 4. Permanente lokale kennisarchitectuur

**Besluit.** Kennis en geheugen mogen niet uitsluitend in modelgewichten zitten. Het
systeem moet kennis kunnen toevoegen, corrigeren en intrekken zonder hertraining.

**Stand.** Dit is al zo gebouwd en gemeten:

| Onderdeel | Waar het staat | Gemeten |
| --- | --- | --- |
| Regelkennisbank met bron en status | `src/server/agent/knowledge.ts`, regelbestand | M1, M2 (categorie C: 4/4) |
| Domeinwoordenboek | `src/server/agent/vocabulary.ts` | RET-scenario |
| Gestructureerde roostergegevens | 11 tools met rechtencontrole | M1, M2 (A, B, F) |
| Project- en standplaatsgeheugen | `AgentMemoryItem`, vier lagen | M2 (categorie E: 3/3), `verify:geheugen` |
| Gecontroleerde optimizertoegang | `jobs.ts`, `research.ts` | `verify:agent --zwaar`, `verify:onderzoek --zwaar` |
| Onafhankelijke validator | ongewijzigd sinds M0 | elke meting |
| Chat- en agentorchestratie | `agent.ts`, activiteitenpaneel | fase 1 t/m 6 |

Wat nog ontbreekt: een technische beschrijving van de roosterengine in machineleesbare
vorm, en het technische ontwikkelgeheugen (laag TECHNICAL is er, maar wordt nog niet
gevuld). Beide horen bij het lokale-AI-traject.

## 5. Gerichte modeltraining: pas later, en gescheiden

**Besluit.** Onderscheid vier dingen die vaak op één hoop gaan: kennis in de database,
retrieval en toolgebruik, agentorchestratie, en het trainen van het model zelf. Niet
trainen op iedere uitspraak of ieder AI-antwoord. Meten met apart gehouden testgevallen.

**Gevolg.** Training komt pas in beeld nadat de lokale runtime meetbaar functioneert. De
holdout-tests in `intelligence-testset.json` (`holdout: true`) worden daarvoor apart
gehouden en niet gebruikt om bij te sturen.

## 6. Aparte lokale-AI-benchmark

**Besluit.** Naast de bestaande sporen komt er een benchmark die het werkelijk lokaal
draaiende model meet: Nederlandse taalvaardigheid, machinistentaal, roostercontext,
toolgebruik, regelkennis, uitleg, geheugen, verwerking van correcties, voorbereiden van
optimalisatieopdrachten, ongefundeerde antwoorden, antwoordtijd, geheugen- en
hardwaregebruik.

**Harde regel.** Stubresultaten worden nooit als bewijs van de intelligentie van het
lokale model gepresenteerd. In de uitvoer staat per meting welk model draaide en of dat
een taalmodel was.

## 7. Bronstatus en gegevens

**Besluit.** Jonathan controleert voorlopig zelf de aangeleverde NS- en CAO-bronnen. Dat
is een voorlopige inhoudelijke controle en **geen** formele goedkeuring namens NS. Het
onderscheid blijft zichtbaar.

**Gevolg.** Er komt een derde status naast "letterlijk overgenomen" en "door NS
bevestigd": *voorlopig gecontroleerd door de gebruiker*. Een door Jonathan gecontroleerde
regel wordt dus niet `VALIDATED`; hij blijft `SOURCE_TRANSCRIBED` met een aparte,
zichtbare aantekening wie hem wanneer heeft nagelopen.

**Gegevens.** Voorlopig uitsluitend noodzakelijke, toegestane en bij voorkeur fictieve of
geanonimiseerde testgegevens voor AI-ontwikkeling en training. Externe
gegevensverwerking en onomkeerbare keuzes over bewaartermijnen worden uitgesteld tot
daarover afspraken bestaan. De demo-omgeving gebruikt al fictieve namen; het
personeelsnummer is de enige sleutel.

## 8. Ontwikkelrichting

De bestaande fasen en het benchmarkprogramma M0 t/m M3 lopen door. Daarnaast komt een
apart traject voor de lokale AI-runtime, in deze volgorde:

| Stap | Wat | Status |
| --- | --- | --- |
| LOKAAL-1 | Hardware, kandidaatmodellen en haalbaarheid onderzoeken | gedaan, zie `lokale-ai/hardware-en-modellen.md` |
| LOKAAL-2 | Runtime-adapter achter de bestaande modeladapter | volgt |
| LOKAAL-3 | Eerste werkende lokale modelintegratie | volgt |
| LOKAAL-4 | Lokale-AI-benchmark op het draaiende model | volgt |
| LOKAAL-5 | Verbeteren op grond van gemeten tekortkomingen | volgt |
| LOKAAL-6 | Onderzoeken of gerichte training iets toevoegt | volgt |

Behouden blijven: de roosterengine, de validator, de goedgekeurde kandidaten en alle
historische benchmarkresultaten.
