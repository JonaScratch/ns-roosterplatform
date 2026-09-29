# Architectuur

## Uitgangspunt: één bron van waarheid

De Demo Room bouwt geen tweede roosterplatform. Alle domeinkennis — regels,
kandidaten, optimizer, validator, geheugen — komt uit de bestaande hoofdapp
(`src/server/...`), via directe TypeScript-imports (`@/server/...`), precies
zoals de bestaande `scripts/*.ts` dat al doen. Er is geen HTTP-laag tussen de
Demo Room en de hoofdapp: het zijn dezelfde functies, in hetzelfde proces.

```
ns-roosterplatform/
├── src/                 ← hoofdapp: regels, optimizer, validator, agent, Prisma
├── python/               ← CP-SAT-optimizer (apart proces, geen DB-verbinding)
├── docs/v1.0.5/v1.0.6/   ← bestaande lokale-LLM-benchmarks (N0/N1/R2-PRE — zie hieronder)
└── demo-room/            ← dit laboratorium
    ├── src/
    │   ├── config.ts, safety.ts, actor.ts        ← grenzen en toegang
    │   ├── store/                                 ← journaal, HANDOFF, experimentgeheugen, benchmarkgeschiedenis
    │   ├── challenges/                             ← Challenge Engine (spoor A + B)
    │   ├── benchmark/                               ← dev/holdout/hidden, agent-/roosterkwaliteit, Pareto
    │   ├── variants/                                 ← sandbox-promptvarianten
    │   ├── research/                                  ← "run N minuten" (spoor B) + compute-budget
    │   ├── proof/                                      ← v0.2/v0.3: proof-of-value (PRE→variant→POST(≥2 runs)→holdout→besluit)
    │   ├── publish/                                     ← v0.2: versiestore + veilige publicatiepijplijn
    │   ├── promotion/                                    ← (v0.1) generieke promotion-proposaltekst
    │   ├── report/                                        ← mens-/technisch/machineleesbaar rapport
    │   ├── store/logbook.ts                                 ← v0.3: append-only audit-trail (zie docs/LOGBOOK.md)
    │   ├── runControl.ts                                   ← v0.2: spawnt cli.ts voor het dashboard, géén hoofdapp-import
    │   ├── cli.ts, server.ts                                ← de twee ingangen (server.ts: v0.3 "Bewijs verbeterlus"-knop + logboek-routes)
    └── ui/index.html                                         ← het dashboard (leest + start/stop/publiceer/herstel via runControl)
```

## Wat al bestond (Fase A-onderzoek — belangrijk voor wie dit doorontwikkelt)

Vóór er één regel Demo Room-code was geschreven, is de hoofdapp op branch
`demo-room-base` (commit `f029cef`) onderzocht. Drie dingen bleken al te
bestaan, ruim vóór verwacht:

1. **Een volledig experiment/promotion/research-systeem in `src/server/agent/`:**
   - `AgentExperiment` (Prisma-model): hypothese, variant, baseline/resultaat,
     vooraf vastgelegde poorten (`beoordeelExperiment()` in `experiments.ts`),
     status PROPOSED→RUNNING→MEASURED→PASSED/REJECTED, menselijke review.
   - `AgentResearchLoop`/`AgentResearchRound`: een echte autonome
     onderzoekslus (`startResearchLoop()` in `research.ts`) die per ronde de
     bevoegdheid, de noodrem én een stopverzoek herchecked, de echte CP-SAT-
     optimizer aanroept, en "geen verbetering gevonden" als geldige uitkomst
     behandelt.
   - `AgentMemoryItem` met `MemoryScope` (PROJECT/LOCATION/NATIONAL/TECHNICAL)
     en `MemoryStatus` (PROPOSED/APPROVED/REJECTED/WITHDRAWN/SUPERSEDED) — al
     precies het onderscheid formele regel/lokale voorkeur/nationaal besluit/
     technische hypothese dat de opdracht vraagt.
   - `RuleSourceCheck` — legt expliciet vast dat een gebruikerscontrole van
     een regelbron NOOIT een formele NS-bevestiging is.

   → De Demo Room hergebruikt deze functies rechtstreeks (`proposeExperiment`,
   `recordExperimentResult`, `startResearchLoop`) in plaats van een eigen
   experimentsysteem te bouwen. Zie `demo-room/src/research/autonomousRun.ts`.

2. **Een bestaande intelligentiebenchmark**: `src/server/agent/bench-adapter.ts`
   (`benchAnswer()`) stuurt een vraag door de echte `askAgent()`-keten
   (context, rechten, tools, grondingscontrole) en beoordeelt het antwoord
   automatisch (deterministisch/gedrag/geheugen-oordelen). De Demo Room
   hergebruikt dit één-op-één (`demo-room/src/benchmark/run.ts`) in plaats
   van een eigen scoringslogica te bouwen.

3. **Een bestaande PRE/POST-methodiek met dev/holdout-split**:
   `docs/v1.0.6/golden-suite.json` (43 items, 8 holdout) en
   `docs/v1.0.6/n0-n1-vergelijking.md` documenteren al een volwassen
   N0/N1-meetmethode (herhaalde runs, run-to-run-variantie expliciet
   gerapporteerd, een zero-fabricatiegate). Deze bestanden horen bij een
   **parallel lopend, lokaal ontwikkelspoor** (Ronde 2 / R2-PRE, zichtbaar in
   de laatste commit) en worden door de Demo Room met opzet **niet
   aangeraakt** — geen wijziging, geen import die ze zou kunnen laten
   herberekenen tegen een veranderde set. De Demo Room heeft daarom haar
   eigen, kleine dev/holdout/hidden-vragensets
   (`demo-room/src/benchmark/questions/*.json`), in hetzelfde
   `benchAnswer()`-formaat maar met een eigen naamgeving.

## De vier minimale, gecontroleerde koppelpunten in de hoofdapp

De opdracht staat toe de hoofdapp *minimaal* te wijzigen waar een
gecontroleerde koppeling nodig is. Dit zijn de enige vier wijzigingen, elk
additief en optioneel (geen enkele bestaande aanroep verandert van gedrag
zonder dat iets — Demo Room, of een gepubliceerd bestand — dat expliciet
aanvraagt):

1. **`src/server/agent/agent.ts`** — `askAgent()` krijgt een optioneel
   `modelOverride?: ChatModel`. Zonder dit veld (elke bestaande aanroep) is
   het gedrag identiek aan vandaag.
2. **`src/server/agent/model/local.ts`** — `LocalModelConfig` krijgt een
   optioneel `systemPromptOverride?: (basis, request) => string`. Zonder dit
   veld bouwt `localModel()` exact dezelfde systeeminstructie als vandaag.
3. **`src/server/agent/bench-adapter.ts`** — `benchAnswer(item, options?)`
   krijgt een optioneel tweede argument `{ modelOverride }`, doorgegeven aan
   `askAgent()`. Bestaande aanroepen (`scripts/v105/*.ts`) geven dit niet mee.
4. **(v0.2) `src/server/agent/model/local.ts`** — `localConfigFromEnv()` vult
   `systemPromptOverride` voortaan automatisch met
   `productionOverrideFromDisk()`, die de inhoud van het bestand achter
   `NS_PRODUCTION_PROMPT_FILE` bij elke aanvraag opnieuw leest. Staat de
   omgevingsvariabele niet (de standaardsituatie op elke installatie die nog
   nooit iets publiceerde via Demo Room), dan verandert er niets. Dit is het
   enige punt waar een Demo Room-publicatie ooit echte productie raakt — zie
   `docs/SAFE-PUBLISH.md`.

Punten 1-3 zijn wat `demo-room/src/variants/` gebruikt om een
sandbox-promptvariant *door exact dezelfde keten* te sturen als productie
(context, rechten, tools, grondingscontrole) — alleen de systeeminstructie
verschilt. Punt 4 is wat die sandboxvariant, ná een expliciete menselijke
publicatiebevestiging, daadwerkelijk productie laat worden. Zie
`demo-room/src/variants/promptVariants.ts` en `demo-room/src/publish/`.

## Wat in v0.1 bewust NIET is gebouwd

- **Tool-routing/contextbeleid/retrieval als losse, onafhankelijk testbare
  hooks.** Deze policies leven nu in dezelfde `systeeminstructie()`-tekst als
  het system-prompt-experiment hierboven, en zijn dus al gedeeltelijk
  testbaar via een promptvariant — maar een apart hook-punt per beleidslaag
  (bijvoorbeeld een eigen `contextResolverPolicy`) is nog niet gebouwd.
  Aanbevolen vervolgwerk, geen v0.1-blocker.
- **Pareto-rapportage als los dashboardonderdeel.** De rekenkern
  (`demo-room/src/benchmark/pareto.ts`) is gebouwd en getest; een
  visualisatie in het dashboard is nog niet gekoppeld.
- **Multi-worker-orkestratie (§26).** Het jobschema van de hoofdapp
  (`GenerationRun`, `AgentActivity`) is al niet single-worker-hardcoded, en
  `ComputeBudget.maxConcurrentWorkers` bestaat als veld — maar er is in v0.1
  geen code die daadwerkelijk N gelijktijdige onderzoekslussen start of
  vergelijkt.
- **`vindDuplicaat()` (§13) controleert nu alleen bij het STARTEN van een
  autonome run**, niet per ronde daarbinnen: `runResearchLoop()` (hoofdapp)
  kiest zelf per ronde wat ze doet, zonder een natuurlijketaal-hypothese naar
  buiten te geven om tussentijds te vergelijken. `startAutonomousRun()`
  vergelijkt het gevraagde doel wél vooraf tegen alle eerdere runs
  (`readAllExperiments()`) en meldt een mogelijke herhaling — zonder te
  blokkeren, want een bewuste herhaling na een reparatie is legitiem.
- **Item-niveau run-variance ("welke vragen wisselden").** `runSuiteWithVariance()`
  berekent nu min/max/gemiddelde/sd correct over de score, maar
  `flippedItemIds` is nog leeg — dat vergt item-niveau vergelijking tussen
  runs, wat pas zinvol te bouwen is met echte meetdata (LOCAL REQUIRED).

## Uitbreiding fasen G–R (2026-09-29)

| Laag | Bestand(en) | Kern |
|---|---|---|
| Feedback en concepten | `src/learning/*` | classificatie (voorkeur ≠ regel), toestandsmachine met menselijke activatie, generalisatiemeting op parafrasen/contrasten/holdout |
| Candidate Factory | `src/factory/manifest.ts`, `store.ts` | manifest per kandidaat vóór de meting (hash van tekst, criteria, holdout); lekdetectie |
| Rechter | `src/factory/judge.ts`, `paretoArchive.ts` | KEEP/REJECT/NEEDS_MORE_EVIDENCE met bevroren criteria; kan een promotie tegenhouden, nooit afdwingen |
| Arena | `src/factory/arena.ts` | Bradley–Terry over paarsgewijze uitslagen |
| Werkverdeling | `src/factory/workers.ts` | leases, idempotentie, hartslag, budgetreservering |
| Lange runs | `src/factory/longRun.ts` | checkpoint per cyclus, pauze/stop op cyclusgrens, alleen actieve tijd, crashherstel |
| Releasedienst | `../src/lib/lyra-release.ts` | de enige lees- en schrijfweg voor de actieve Lyra-versie (zie SAFE-PUBLISH.md) |
| UI | `ui/lib/panels.js` | panelen binnen bestaande pagina's; geen nieuwe hoofdtabbladen |

Eindrapport: `docs/lyra-knowledge/final-report-master-program.md`.

## Veiligheid

Zie `SAFETY-BOUNDARIES.md`.
