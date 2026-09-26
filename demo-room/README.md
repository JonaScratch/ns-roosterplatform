# Lyra Demo Room v0.3

Een apart, lokaal laboratorium naast het NS Roosterplatform, om de ingebouwde
roosteragent (in deze codebase "de agent" genoemd — er staat nergens de naam
"Lyra" in de hoofdapp; deze Demo Room gebruikt die naam zoals de opdracht die
gaf) hard te testen, te benchmarken en — via een veilige, met een klik
bevestigde publicatiepijplijn, nooit automatisch — te verbeteren.

Zie ook: `docs/ARCHITECTURE.md`, `docs/SAFETY-BOUNDARIES.md`,
`docs/CHALLENGE-FORMAT.md`, `docs/BENCHMARK-FORMAT.md`, `docs/SAFE-PUBLISH.md`,
`docs/LOGBOOK.md`.

## Wat dit WEL en NIET is

- **Wel**: een dunne laag die de bestaande agent-, optimizer- en
  validatorinfrastructuur van de hoofdapp aanroept via haar eigen,
  bevoegdheid-gecontroleerde services (`AgentCapabilityGrant`,
  `askAgent()`, `startResearchLoop()`, `proposeExperiment()`, enzovoort).
- **Niet**: een tweede roosterplatform, een kopie van de regels/validator/
  optimizer, of een weg om productie buiten de bestaande bevoegdhedenlaag om
  te wijzigen. Zie `docs/SAFETY-BOUNDARIES.md` voor de harde grenzen.

## v0.2 in het kort

Twee dingen zijn toegevoegd bovenop v0.1, in deze volgorde omdat de tweede op
de eerste voortbouwt:

1. **Proof-of-value** (`demo-room/src/proof/`): bewijst — vóór er ooit een
   lange autonome run wordt aanbevolen — dat de meet-wijzig-hermeet-lus zelf
   werkt: `production Lyra → PRE → sandboxvariant → POST (dezelfde bevroren
   set) → PRE-holdout → holdout → regressiecontrole → besluit`. Meet Lyra-
   agentkwaliteit (contextresolutie, multi-turn, machinistentaal, toolkeuze,
   false-premise correction, grounding, causale claims, onnodige
   verduidelijkingsvragen, latency) en roosteronderzoekskwaliteit apart —
   een beter antwoordmodel is niet hetzelfde als een beter rooster.
2. **Safe publish + rollback** (`demo-room/src/publish/`): een klein,
   herhaalbaar versiebeheer voor "Production Lyra" (`lyra-prod-YYYY-MM-DD-NN`),
   met een verplichte pijplijn (preflight → backup → toepassen → typecheck →
   smoke benchmark → grondingscontrole → succes/automatische rollback) en een
   losse, met een klik bevestigde "Herstel"-actie naar elke eerdere versie.
   Demo Room experimenteert en beveelt aan; **Jonathan publiceert.**

## v0.3 in het kort

Drie acceptatiepunten, bovenop v0.2:

3. **Proof-of-value volledig vanuit de UI**: knop "Bewijs verbeterlus" op
   Overzicht, met een live voortgangsstepper (PRE → sandboxvariant → POST →
   holdout → regressiecontrole → beslissing) op het tabblad Live run. CMD
   blijft de fallback/debug-weg (`npm run demo-room -- proof-of-value`).
4. **Rollback bewezen met een gecontroleerde failure-injectietest**
   (`tests/demo-room/safePublishRollback.test.ts`): een expres ongeldige
   testvariant wordt gepubliceerd naar een volledig geïsoleerde
   test-productionstate (`DEMO_ROOM_STATE_ROOT_OVERRIDE`, nooit de echte
   installatie), waarna programmatisch geverifieerd wordt dat de vorige
   versie weer actief is, de prompt exact hersteld is, de versiegeschiedenis
   intact blijft, en de mislukking + rollback in journaal/HANDOFF/logboek
   staan.
5. **Geen promotie op één toevallige modelrun**: minimaal twee onafhankelijke
   POST-runs (`--post-runs`, standaard 2) op dezelfde bevroren suite; winst
   wordt op het gemiddelde beoordeeld, regressies (vooral
   veiligheid/grounding) op de slechtste run — nooit cherry-picken in beide
   richtingen. Zie `proof/decision.ts`.
6. **Volledig append-only logboek** (`demo-room/logs/RUN-*.txt`/`.jsonl`, zie
   `docs/LOGBOOK.md`): elke operationele stap van een run, crash-safe
   weggeschreven, met centrale redactie van geheimen, en een eigen tabblad
   "Logboek" (zoeken/filteren, downloaden, kopiëren voor ChatGPT/Claude,
   deep-link vanuit een experimentdetail).

## Vereisten

- De hoofdapp draait lokaal met een echte database (`npm run db:up && npm run db:deploy && npm run db:seed`).
- Een lokaal taalmodel via Ollama of llama.cpp, bereikbaar op een
  OpenAI-compatibel eindpunt (`NS_LOCAL_LLM_URL`, `NS_LOCAL_LLM_MODEL` — zie
  de hoofdapp-documentatie in `docs/v1.0.5/lokale-ai/`).
- Een **admin-account** met personeelsnummer, actief in de database (voor
  spoor B — autonoom onderzoek — is `AGENT_EXPERIMENT_RUN` nodig, en dat recht
  is in de hoofdapp bewust alleen aan Admin gekoppeld).
- Een **AgentCapabilityGrant** voor de standplaats DDR die minstens
  `AUTONOMOUS`/`EXPERIMENT_PROPOSE`/`EXPERIMENT_RUN` aanzet — zet je via het
  bestaande scherm `/roostercommissie/agent` (niveaukiezer) of `/beheer`. De
  Demo Room kent zichzelf dit nooit toe (zie `SAFETY-BOUNDARIES.md`).

Zet in `.env` (naast wat de hoofdapp al nodig heeft):

```bash
DEMO_ROOM_ACTOR_EMPLOYEE_NUMBER=990001   # een actief ADMIN-account (bijv. de ontwikkelseed)
DEMO_ROOM_LOCATION_CODE=DDR              # standaard DDR
DEMO_ROOM_PORT=4173                      # dashboardpoort, optioneel

# Alleen als je een variant hebt gepubliceerd (zie docs/SAFE-PUBLISH.md) —
# safePublish.ts schrijft en beheert dit bestand zelf, jij hoeft alleen het
# PAD hier één keer te zetten:
NS_PRODUCTION_PROMPT_FILE=demo-room/data/lyra-versions/current-prompt.txt
```

## Starten — de eenvoudige weg (Windows, zo min mogelijk terminal)

Dubbelklik **`demo-room/Start Demo Room.bat`**. Dat script controleert Node,
`node_modules`, `.env`, de database en Ollama, en opent daarna automatisch
`http://localhost:4173` in je browser. Runs, publiceren en herstellen doe je
daarna volledig via het dashboard — de knoppen daar roepen exact dezelfde
commando's aan als hieronder.

## Starten — handmatig (LOCAL REQUIRED — dit kan niet vanuit de cloud-sessie worden gedraaid)

```bash
# 1. Ollama starten (apart, buiten dit project)
ollama serve

# 2. Hoofddatabase starten
npm run db:up
npm run db:deploy
npm run db:seed          # eenmalig, of als de database leeg is

# 3. Demo Room-dashboard starten (dit proces zelf heeft GEEN react-server nodig —
#    het spawnt de CLI voor elke actie, zie docs/ARCHITECTURE.md)
npm run demo-room:dashboard

# 4. Open http://localhost:4173
```

Alles is ook via de CLI te doen, zonder het dashboard:

```bash
# Beschikbare challenges tonen
npm run demo-room -- list-challenges

# Eén challenge draaien (spoor A: chatbot, of spoor B: onderzoeker — de CLI kiest zelf het juiste pad)
npm run demo-room -- run-challenge --id L1-nacht-vroeg-overgangen

# Benchmark: dev/holdout/hidden, met herhalingen voor run-variance (§17)
npm run demo-room -- benchmark --suite dev --runs 3

# PROOF OF VALUE — draai dit eerst, vóór een lange autonome run (zie hieronder)
npm run demo-room -- proof-of-value --variant variant-a-tool-hint

# Autonome onderzoeksrun: 10 / 30 / 60 minuten, of aangepast
npm run demo-room -- autonomous --minutes 60 --goal "Zoek de grootste kwaliteitsverbetering" --goals KEEP_GOOD_PARTS

# Versies bekijken, publiceren, herstellen (zie docs/SAFE-PUBLISH.md)
npm run demo-room -- versions
npm run demo-room -- publish --experiment-id <id> --confirm
npm run demo-room -- rollback --version-id <id> --confirm

# HANDOFF.md en het dashboard bijwerken op basis van alle vastgelegde experimenten
npm run demo-room -- report
```

Na een run staat het volledige verslag in:

- `demo-room/reports/latest.md` / `.json` — het meest recente journaal.
- `demo-room/reports/history/DR-*.md` — de permanente geschiedenis, nooit overschreven.
- `demo-room/reports/improvements/<experiment-id>-{jonathan,technisch,machine}.{md,json}` —
  automatisch bij elke `PROMOTION_CANDIDATE`, in drie leesniveaus.
- `demo-room/HANDOFF.md` — plak dit in een nieuwe Claude- of ChatGPT-chat.

## De acceptatietest, in deze volgorde (niet overslaan)

Dit is de exacte volgorde die Jonathan vroeg, en die moet lokaal
end-to-end bewezen worden vóór er sprake is van een langere run:

`Start Demo Room` → `UI opent` → `Bewijs verbeterlus` → `echte lokale
Qwen + echte DB` → `PRE` → `sandboxvariant` → `POST-runs` → `holdout` →
`resultaat in grafieken` → `tekstuele uitleg` → `journal/HANDOFF` →
`alleen bij aantoonbare verbetering PROMOTION CANDIDATE`.

Concreet:

1. Start Demo Room (`npm run demo-room -- dashboard` of het equivalente
   startscript) en open het dashboard in de browser.
2. Klik in het dashboard op **"Bewijs verbeterlus"** (Overzicht-tabblad).
   Dit start dezelfde proof-of-value-pipeline als
   `npm run demo-room -- proof-of-value`, nu vanuit de UI — CMD blijft
   alleen fallback/debug. Met echte lokale Qwen en echte database moet dit
   écht PRE → sandboxvariant → POST-runs (minimaal 2, onafhankelijk, zelfde
   bevroren suite) → holdout meten, met live voortgang in de stappenrij
   (PRE → sandboxvariant → POST → holdout → regressiecontrole →
   beslissing).
3. Bekijk het dashboard: grafieken tonen deze echte cijfers (geen
   dummydata), inclusief de variantie tussen de POST-runs — nooit alleen
   de beste run. Er is een tekstuele uitleg van het resultaat. Het
   journaal en `HANDOFF.md` zijn bijgewerkt. Het logboek
   (`docs/LOGBOOK.md`, tabblad "Logboek") bevat de volledige,
   ongefilterde procesgang van deze run.
4. Alleen bij aantoonbare verbetering — geen regressie op grounding/
   falsePremiseCorrection/causalClaims, geen holdout-regressie, verbetering
   op de overige dimensies over het gemiddelde van de POST-runs — volgt
   een `PROMOTION_CANDIDATE`. Geen verbetering aantonen is een geldige,
   informatieve uitkomst (`KEEP_TESTING`) en geen mislukking. Publiceren
   blijft altijd een expliciete, aparte handeling van Jonathan.
5. Pas ná deze end-to-end proof: een korte challenge (§ hierboven) en een
   korte autonome smoke-run (10 minuten).
6. Pas als die stabiel eindigt: een langere autonome run (30/60 min of
   meer).

**Geen 60-minutenrun totdat dit lokaal end-to-end bewezen is.** Dit is
bewust dezelfde volgorde als Jonathan expliciet vroeg.

## Tests

```bash
npm test -- demo-room     # draait alleen de Demo Room-tests (padfilter)
```

De tests raken bewust geen database — net als de rest van de hoofdapp-suite
(zie `vitest.config.mts`). Wat hier getoetst wordt: veiligheidsgrenzen,
duplicaatdetectie, budgetbewaking, Pareto-analyse, het promotiecriterium
(`decision.ts`), versienummering/-store, journaal-/HANDOFF-opmaak. De
end-to-end-paden (challenge draaien, autonome run, proof-of-value, publish
tegen een echt lokaal model) hebben een draaiende database en Ollama nodig en
zijn dus **LOCAL REQUIRED**. Het dashboard zélf (alle lees-schermen en de
run-besturing/spawn-mechaniek) is in deze sessie wél echt getest — zie het
eindrapport.

## Status — wat werkt, wat niet, en waarom

Zie `docs/ARCHITECTURE.md` §"Wat bewust niet is gebouwd" voor de eerlijke
lijst met v0.2-grenzen, en het eindrapport van deze sessie voor wat
daadwerkelijk in de cloud-sessie is uitgevoerd en geverifieerd (het
dashboard, inclusief de run-spawn-mechaniek, draaide en werd getest) versus
wat **LOCAL REQUIRED** blijft (alles wat een echt lokaal taalmodel of een
draaiende Postgres nodig heeft).
