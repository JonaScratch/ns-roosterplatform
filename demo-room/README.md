# Lyra Demo Room v0.1

Een apart, lokaal laboratorium naast het NS Roosterplatform, om de ingebouwde
roosteragent (in deze codebase "de agent" genoemd — er staat nergens de naam
"Lyra" in de hoofdapp; deze Demo Room gebruikt die naam zoals de opdracht die
gaf) hard te testen, te benchmarken en — alleen in sandbox, nooit automatisch
in productie — te verbeteren.

Zie ook: `docs/ARCHITECTURE.md`, `docs/SAFETY-BOUNDARIES.md`,
`docs/CHALLENGE-FORMAT.md`, `docs/BENCHMARK-FORMAT.md`.

## Wat dit WEL en NIET is

- **Wel**: een dunne laag die de bestaande agent-, optimizer- en
  validatorinfrastructuur van de hoofdapp aanroept via haar eigen,
  bevoegdheid-gecontroleerde services (`AgentCapabilityGrant`,
  `askAgent()`, `startResearchLoop()`, `proposeExperiment()`, enzovoort).
- **Niet**: een tweede roosterplatform, een kopie van de regels/validator/
  optimizer, of een weg om productie buiten de bestaande bevoegdhedenlaag om
  te wijzigen. Zie `docs/SAFETY-BOUNDARIES.md` voor de harde grenzen.

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
```

## Starten (LOCAL REQUIRED — dit kan niet vanuit de cloud-sessie worden gedraaid)

```bash
# 1. Ollama starten (apart, buiten dit project)
ollama serve

# 2. Hoofddatabase starten
npm run db:up
npm run db:deploy
npm run db:seed          # eenmalig, of als de database leeg is

# 3. Demo Room-dashboard starten
npx tsx --conditions=react-server demo-room/src/server.ts

# 4. Open http://localhost:4173
```

Challenges en runs start je via de CLI (het dashboard is bewust puur
lezend — zie `docs/SAFETY-BOUNDARIES.md` voor waarom):

```bash
# Beschikbare challenges tonen
npx tsx --conditions=react-server demo-room/src/cli.ts list-challenges

# Eén challenge draaien (spoor A: chatbot, of spoor B: onderzoeker — de CLI kiest zelf het juiste pad)
npx tsx --conditions=react-server demo-room/src/cli.ts run-challenge --id L1-nacht-vroeg-overgangen

# Benchmark: dev/holdout/hidden, met herhalingen voor run-variance (§17)
npx tsx --conditions=react-server demo-room/src/cli.ts benchmark --suite dev --runs 3

# Autonome onderzoeksrun: 10 / 30 / 60 minuten, of aangepast
npx tsx --conditions=react-server demo-room/src/cli.ts autonomous --minutes 60 --goal "Zoek de grootste kwaliteitsverbetering" --goals KEEP_GOOD_PARTS

# HANDOFF.md en het dashboard bijwerken op basis van alle vastgelegde experimenten
npx tsx --conditions=react-server demo-room/src/cli.ts report
```

Na een run staat het volledige verslag in:

- `demo-room/reports/latest.md` — het meest recente journaal, leesbaar.
- `demo-room/reports/latest.json` — dezelfde inhoud, machineleesbaar.
- `demo-room/reports/history/DR-*.md` — de permanente geschiedenis, nooit overschreven.
- `demo-room/HANDOFF.md` — plak dit in een nieuwe Claude- of ChatGPT-chat.

## Tests

```bash
npm test -- demo-room     # draait alleen de Demo Room-tests (vitest --testNamePattern of pad-filter)
```

De tests raken bewust geen database — net als de rest van de hoofdapp-suite
(zie `vitest.config.mts`). Wat hier getoetst wordt: veiligheidsgrenzen,
duplicaatdetectie, budgetbewaking, Pareto-analyse, journaal-/HANDOFF-opmaak.
De end-to-end-paden (challenge draaien, autonome run, benchmark tegen een echt
lokaal model) hebben een draaiende database en Ollama nodig en zijn dus
**LOCAL REQUIRED** — zie `docs/SAFETY-BOUNDARIES.md` en het eindrapport voor
de exacte commando's om ze lokaal te draaien.

## Status v0.1 — wat werkt, wat niet, en waarom

Zie het eindrapport dat bij de eerste oplevering hoort (in het antwoord van
deze sessie) voor een volledig overzicht: wat gebouwd is, wat hergebruikt is
uit de hoofdapp (er bleek al veel meer te bestaan dan verwacht — zie
`docs/ARCHITECTURE.md` §"Wat al bestond"), en wat expliciet **LOCAL
REQUIRED** blijft omdat deze cloud-sessie geen Postgres en geen Ollama heeft.
