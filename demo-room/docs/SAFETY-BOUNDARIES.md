# Veiligheidsgrenzen

## Uitgangspunt

De Demo Room is standaard read-only richting het hoofdprogramma (§3 van de
opdracht). Alles wat schrijft, gaat door de bestaande bevoegdhedenlaag van de
hoofdapp — dezelfde laag die de Roostercommissie gebruikt — en nooit
daaromheen.

**v0.2-nuance:** het dashboard is niet langer alléén lezend — het kan runs
starten/stoppen en (ná expliciete bevestiging) publiceren/herstellen. Dat
verandert dit uitgangspunt niet: elke actie loopt door dezelfde
`safety.ts`-controles en dezelfde bevoegdhedenlaag als wanneer je de CLI zelf
zou typen (het dashboard spawnt letterlijk `cli.ts`, zie
`demo-room/src/runControl.ts`) — er is geen tweede, soepeler uitvoeringspad
"omdat het via de webinterface gaat". Zie ook `docs/SAFE-PUBLISH.md`.

**v0.3-nuance:** promotie vereist voortaan minimaal twee onafhankelijke
POST-runs op dezelfde bevroren suite wanneer modelgedrag onderdeel is van de
verbetering (§ `proof/decision.ts`, `MIN_POST_RUNS`); verbeteringen tellen op
het gemiddelde over de runs, regressies op de slechtste run — nooit
cherry-picken. Elke stap van elke run (ook afwijzingen, overgeslagen
experimenten, mislukkingen) komt bovendien terecht in het append-only
logboek (`store/logbook.ts`, zie `docs/LOGBOOK.md`) — dat is een aanvulling
op, geen vervanging van, journaal/rapport/HANDOFF, en verandert niets aan de
bevoegdhedenlaag hierboven.

## Wat de Demo Room WEL mag

- Data, regels, kennis, kandidaten en historische benchmarks lezen.
- De agent aanroepen (`askAgent()`), inclusief met een sandbox-promptvariant
  (via `modelOverride`).
- Optimizerjobs starten **in sandbox**, dat wil zeggen: via
  `startResearchLoop()`/`startProposedJob()`, die altijd een
  `CandidateRoster` opleveren — nooit een gepubliceerd basisrooster. Publiceren
  is een aparte, menselijke handeling die nergens in deze codebase wordt
  aangeroepen.
- Kandidaten laten genereren en onafhankelijk laten valideren
  (`validateCandidate()` — dezelfde validator als de Roostercommissie, met
  bewezen architectonische onafhankelijkheid van de optimizer, zie
  `tests/optimizer/architectuur.test.ts` in de hoofdapp).
- Experimentgeheugen opbouwen (in `demo-room/data/` en
  `demo-room/reports/`, buiten de Prisma-schema van de hoofdapp om).
- Experimentele Lyra-varianten (systeeminstructie) vergelijken met de
  controle, op de eigen dev/holdout/hidden-sets.

## Wat de Demo Room NOOIT automatisch doet

- Productieprompts wijzigen **zonder expliciete menselijke bevestiging**.
  Tijdens een benchmarkrun leeft een variant uitsluitend in het geheugen van
  het Demo Room-proces; het enige schrijfpad naar wat productie leest
  (`NS_PRODUCTION_PROMPT_FILE`) loopt via `safePublish.publishExperiment()`,
  en die functie wordt nergens automatisch aangeroepen — alleen door een
  mens die `--confirm` typt of de publiceerknop in het dashboard bevestigt
  ná het reviewscherm. Zie `docs/SAFE-PUBLISH.md`.
- Formele regels veranderen. `refusals.ts` (hoofdapp) weigert dit al vóór het
  model; `demo-room/src/safety.ts`'s `NOOIT_TOEGESTAAN`-lijst is een tweede,
  onafhankelijke controle op hetzelfde punt.
- Hoofdprojectgeheugen aanpassen zonder menselijke tussenstap:
  `AgentMemoryItem` blijft `PROPOSED` tot een commissielid het goedkeurt
  (`decideMemory()`), en de Demo Room roept `decideMemory()` nergens aan.
- Approved/gepubliceerde roosters wijzigen: er bestaat geen functie in deze
  codebase die dat doet zonder het publicatiescherm van de Roostercommissie.
- Zichzelf of het onderliggende account rechten of bevoegdheden geven.
  `demo-room/src/safety.ts` bevat geen enkele aanroep naar
  `setAgentLevel()`/`prisma.agentCapabilityGrant.create()`. Zonder een grant
  die een mens al heeft gezet, stopt elke schrijvende actie vóór de eerste
  stap, met een foutmelding die naar het juiste hoofdapp-scherm verwijst.
- De validator omzeilen: elke kandidaat die de Demo Room via de optimizer laat
  maken, loopt door dezelfde `validateCandidate()` als productie. Er is geen
  functie in deze codebase die een validatoroordeel overschrijft.
- Willekeurige shell-toegang via de agent: de agent heeft geen shell-tool
  (zie de toolcatalogus in `src/server/agent/tools.ts` — alle twaalf tools
  zijn lezend).
- Onbegrensde database-writes: alle schrijvende hoofdapp-aanroepen die de Demo
  Room gebruikt (`proposeExperiment`, `startResearchLoop`, ...) lopen door
  dezelfde `assertAgentMay()`-controle en dezelfde audit-log
  (`recordAudit()`) als elk ander gebruik van de agent.

## Compute-budget (§23)

Elke autonome run heeft een hard budget (`demo-room/src/config.ts`,
`ComputeBudget`): wandklok, modelaanroepen, optimizerruns, kandidaten,
mislukte experimenten, gelijktijdige workers. `demo-room/src/research/budget.ts`
bewaakt dit als pure, geteste functie. Bij het bereiken van een grens schrijft
de Demo Room een rapport en stopt — een nieuwe run gaat verder vanuit het
experimentgeheugen (`demo-room/src/store/runlog.ts`, append-only JSONL, dus
een crash kost hooguit de laatst onvoltooide regel).

## Wat "gecontroleerde koppeling" hier concreet betekent

Drie kleine, additieve, optionele parameters in de hoofdapp — zie
`ARCHITECTURE.md`. Geen van de drie verandert het gedrag van een bestaande
aanroep; ze zijn alleen bereikbaar voor code die ze expliciet meegeeft, en
alleen `demo-room/` doet dat.

## Wat nog een menselijke stap vergt (met opzet)

- Elke promotion proposal (`demo-room/src/promotion/proposal.ts`) is een
  tekst, geen actie. Promoveren blijft precies zoals de hoofdapp het al deed:
  een mens leest de poortuitslagen en verzet daarna zelf bijvoorbeeld
  `NS_ENGINE_PROFILE`, of keurt een `AgentMemoryItem` goed via het bestaande
  scherm.
- Het aanzetten van `AUTONOMOUS`/`EXPERIMENT_RUN`/`EXPERIMENT_PROPOSE` voor
  een standplaats gebeurt bij `/roostercommissie/agent` of `/beheer` — nooit
  door de Demo Room zelf.
