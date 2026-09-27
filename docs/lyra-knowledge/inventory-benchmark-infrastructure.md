# Inventaris bestaande benchmark-/meetinfrastructuur (vóór een nieuwe BEFORE/AFTER-ronde)

*Onderzoek uitgevoerd op 2026-09-27, tegen HEAD `6398e13` (Demo Room v0.9). Het meest recente
bevroren "voor"-punt vóór de Demo Room-lijn is commit `f029cef` — "v1.0.6 Ronde 2 — R2-PRE:
nulmeting vóór ontwikkeling, bevroren". De Demo Room-submap (`demo-room/`, commits `67267d1`
t/m `6398e13`) is buiten dit onderzoek gehouden, zoals gevraagd. Alles hieronder gaat over
bestaande infrastructuur BUITEN `demo-room/`.*

---

## Bestaande harness-componenten (herbruikbaar)

Twee volledig gescheiden benchmark-lijnen bestaan vandaag, voor twee verschillende dingen:

### A. Agent-Q&A-benchmark (gespreksgedrag van Lyra) — `scripts/v106/*.ts`

| Bestand | Doel | Herbruikbaar harnasonderdeel, of eenmalig rondescript? |
| --- | --- | --- |
| `scripts/v106/waarheid.ts` | Berekent grondwaarheid (vroeg/laat/nacht/rangeer-tellingen per rooster, nacht→vroeg-overgangen, rangeerlocaties) rechtstreeks uit het actuele dienstenpakket via `loadEvaluationContextCore`. Nooit hardgecodeerde cijfers — voorkomt dat de suite tegen verouderde feiten toetst. | **Herbruikbaar.** Generiek: werkt tegen elk actueel dienstenpakket. Kern van "geen hardcoding" (§37). |
| `scripts/v106/golden-suite.ts` | Genereert `golden-suite.json` (43 items, 10 categorieën A–J) met een ingebouwde dev/holdout-verdeling (~80/20, per categorie apart geteld). Gebruikt `waarheid.ts` voor de grondwaarheid per item. | **Herbruikbaar als generator-patroon**, maar de 43 concrete items zijn rondegebonden (specifieke categorieën/vraagformuleringen uit de v1.0.6-opdracht). Een volgende ronde kan dezelfde generatorstructuur (dev/holdout-teller, categorie-per-categorie) hergebruiken om nieuwe items toe te voegen; de bestaande 43 blijven bevroren als regressiebasis. |
| `scripts/v106/golden-bench.ts` | Draait de golden suite tegen het ECHTE lokale model via `askAgent()` (geen stub — expliciet vermeld als opzet, §29). Schrijft ruwe transcripten (`benchmarks/<meting>/golden.json`) inclusief tools, toolinputs, data, sources, latency (p50/p95). Ruimt na afloop testgesprekken/activiteiten op. | **Herbruikbaar, generiek.** Neemt alleen `--meting <naam>` als parameter; niets in het script is rondegebonden. Dit is het stuk dat je direct kunt hergebruiken voor een nieuwe BEFORE/AFTER-meting. |
| `scripts/v106/golden-grade.ts` | Beoordeelt een reeds gedraaide meting (`golden.json`) op basis van 9 `expect.kind`-types (grounded_vroeg_laat, corrects_false_premise, context_carryover, rangeer_domain, investigates_vague_complaint, weekend_quality, safety_refuse, no_fabrication, no_unneeded_clarification). Herberekent grondwaarheid live (niet uit de bevroren suite) zodat een terechte verbetering niet ten onrechte als fout scoort. Rapporteert per categorie én per dev/holdout-bucket. | **Herbruikbaar architectuurpatroon** (scheiding meten/beoordelen, her-grade zonder opnieuw te draaien), maar de 9 `kind`-beoordelaars zelf zijn inhoudelijk aan de 43 huidige items gekoppeld — nieuwe itemcategorieën vragen nieuwe `case`-takken. |
| `scripts/v106/golden-fabricatie.ts` | Doorzoekt ALLE antwoorden van een meting (niet alleen categorie C) op ongegronde vermeldingen (regel/dienstnummer/roostercode niet uit brondata of schermcontext), via `ongegrondeVermeldingen()` uit `server/agent/grounding`. | **Herbruikbaar, generiek.** Los inzetbaar bovenop elke meting; gebruikt dezelfde grondingslogica als de agent zelf. |
| `scripts/v106/n0-manifest.ts` | Legt de uitgangssituatie vast vóór ontwikkelcode: git-commit/branch/dirty-paden, dienstenpakket (checksum + volledige duties-array), lokaal modelconfiguratie + bereikbaarheid, Ollama-versie, GPU, capability-grants, toolcatalogus, chatimplementatie-bestanden, en een verwijzing naar bestaande benchmarkassets (inclusief de OUDERE v1.0.5-agentbenchmark: `docs/v1.0.5/intelligence-testset.json`, `scripts/v105/lokale-ai-bench.ts`). | **Herbruikbaar patroon, eenmalig script.** Het `n0-manifest.ts`-bestand zelf is aan v1.0.6 gebonden (paden, referentie naar v105-baseline), maar het is precies het soort "voor-manifest" dat een nieuwe ronde nodig heeft — zie hoofdstuk "Manifest/freeze-praktijk" hieronder voor het gat tussen wat dit vastlegt en wat het NIET vastlegt. |
| `scripts/v106/r2-suite.ts` / `r2-bench.ts` / `r2-grade.ts` | Een tweede, kleinere suite (15 items, 5 casussen A–E, eigen holdout-verdeling) gebouwd uit een concrete, met de hand gevoerde praktijksessie ná N1 — bedoeld als scherpe regressietest voor specifiek gevonden problemen (ongefundeerde profielconclusies, contextbehoud bij kandidaatwissel, causale claims, vergelijkende claims, een compleet 6-beurten-gesprek). `r2-bench.ts` meet bovendien latency PER BEURT (niet alleen per item — een verbetering t.o.v. `golden-bench.ts`). | **Herbruikbaar patroon** ("praktijksessie → bevroren regressieset, gemeten vóór én na"), en het `r2-bench.ts`-latencymodel (per beurt) is een concrete verbetering die golden-bench.ts nog niet heeft. De 15 items zelf zijn casus-specifiek en rondegebonden. |

**Kernobservatie architectuur:** de agent-Q&A-lijn scheidt consequent *meten* (bench, schrijft ruwe
transcripten) van *beoordelen* (grade, herberekent grondwaarheid en oordeel apart) — dit is precies
het patroon dat ook bij de optimizer-benchmark wordt gebruikt (zie hieronder) en is daarmee het
meest overdraagbare architectuurprincipe van de hele inventaris.

### B. Optimizer-/roosterengine-benchmark — `scripts/optimizer-benchmark.ts` + `scripts/benchmark/*.ts`

Zie apart hoofdstuk "Roosterengine/optimizer-eigen benchmark" verderop — dit is een volledig
andere, aantoonbaar rijpere lijn (git-hash + config-hashes in het manifest, 20 replicate-runs
per fase, aparte tabellen, mean/median/worst-verdicts).

---

## Golden suite — huidige omvang en categorieën

**Bevestigd door het bestand zelf te lezen (`docs/v1.0.6/golden-suite.json`):**

- **Huidig aantal items: 43.** (`counts.total: 43`)
- Verdeling: **35 dev / 8 holdout** (`counts.dev: 35`, `counts.holdout: 8`).
- Categorieverdeling (`counts.perCategory`):

  | Categorie | Aantal | Betekenis |
  | --- | ---: | --- |
  | A | 7 | volledige roosteranalyse zonder regelnummer |
  | B | 7 | foutieve gebruikersaanname |
  | C | 1 | nacht→vroeg-overgang (BLM-achtige casus) |
  | D | 7 | RET/rangeerdiensten (domeinwoordenboek) |
  | E | 4 | vage menselijke klacht |
  | F | 7 | weekendvragen |
  | G | 2 | meerbeurten-context (kandidaatwissel/regelwissel) |
  | H | 1 | correctie van een eerdere interpretatie |
  | I | 4 | veiligheid (verboden handelingen) |
  | J | 3 | geen onnodige verduidelijkingsvraag |

- **Het doel van 100+ items is NIET gehaald.** Het bestand zelf zegt dit met zoveel woorden
  (`note`-veld): *"Minder dan de 100 items die §3 als minimum noemt. Dit is de eerste, echt-
  datagegronde versie; groei() (in dit bestand) beschrijft hoe hij tijdens ontwikkeling wordt
  aangevuld (...) — nog niet uitgevoerd."* Dit wordt herbevestigd in
  `docs/v1.0.6/n0-n1-vergelijking.md` §"Wat nog niet klopt": *"De golden suite telt 43 items, niet
  de gevraagde 100 (...) Groei is voorzien, nog niet uitgevoerd."*
- Er bestaat een `groei()`-functie/beschrijving in `golden-suite.ts` die het uitbreidingsmechanisme
  beschrijft, maar die is niet uitgevoerd — het bestand telt vandaag nog steeds 43, niet meer.

**R2-suite (aparte, kleinere set):** `docs/v1.0.6/r2-suite.json` telt **15 items, 5 holdout**,
verdeeld over 5 "casussen" (geen categorieën A–J maar A–E): A_ongefundeerde_conclusie (2),
B_contextbehoud (8), C_causale_claim (2), D_vergelijkende_claim (2), E_volledig_gesprek (1). Dit
is een aparte, bewust kleine regressieset gebouwd uit één praktijksessie — geen vervanging of
uitbreiding van de 43-item golden suite, en niet bedoeld om ooit naar 100 te groeien.

**Conclusie:** twee actieve suites bestaan naast elkaar (golden-suite.json = 43, r2-suite.json =
15), geen van beide heeft ooit de 100-drempel gehaald.

---

## DEV/HOLDOUT-scheiding — bestaat dit al

**Ja, al aanwezig — maar alleen in de agent-Q&A-lijn, niet in de optimizer-lijn.**

- `golden-suite.json`: elk item draagt een `holdout: boolean`-veld. De generator
  (`golden-suite.ts`) telt per categorie een holdout-item op elke 5e (`holdoutTeller % 5 === 0`),
  zodat de verdeling niet toevallig scheef per categorie uitpakt. Het bestand zelf bevestigt:
  *"Holdoutitems worden nooit gebruikt om prompts of instructies op bij te sturen"* (commentaar in
  `golden-suite.ts`, §4 van de v1.0.6-opdracht). `golden-grade.ts` rapporteert apart `byHoldout:
  { dev: {...}, holdout: {...} }`.
- `r2-suite.json`: heeft zijn eigen, onafhankelijke holdout-markering (5 van de 15 items), niet
  gekoppeld aan de dev/holdout-indeling van de 43-item suite.
- **Geen "bevroren adversarial holdout"-concept in de zin die de opdracht van deze ronde lijkt te
  bedoelen** (een set die specifiek is opgezet om het systeem tegen te laten falen / adversarieel
  te testen, apart van een gewone representatieve steekproef). Wat er wél is, in de
  optimizer-/kwaliteitsmodel-lijn (dus NIET in de agent-Q&A-lijn): `docs/human-roster-benchmark/
  contrastive-check.json`, een set van vier "adversarial"-toetsen (`versnipperde-nachten`,
  `vroeg-na-nachten`, `heen-en-weer`, `springende-begintijden`) die een goed menselijk rooster
  doelbewust muteren naar een slechter rooster en controleren of het kwaliteitsmodel dat ook ziet
  (`ziet: true/false`, `menselijkHoger`). Dit is adversarial testing van het KWALITEITSMODEL, niet
  van de Lyra-agent, en niet gestructureerd als een DEV/HOLDOUT-tweedeling maar als losse
  contrastieve toetsen.
- Grep op "holdout" door heel `docs/` en `scripts/` levert uitsluitend hits op in de v1.0.6-agent-
  Q&A-bestanden (golden-suite/r2-suite en hun bench/grade-scripts) en oudere v1.0.5-documenten die
  ernaar verwijzen. Geen hits in `docs/optimizer-benchmark/` of `docs/human-roster-benchmark/`.

**Conclusie:** dev/holdout bestaat al, en werkt, voor de agent-Q&A-suite. Een aparte, bevroren
"adversarial holdout" (in de zin van een derde, nog strengere laag) is niet vastgesteld —
niet vastgesteld dat die ooit is gebouwd.

---

## Replicates/variantie — bestaat dit al

**Gemengd beeld: JA voor de optimizer-lijn, NEE (als geautomatiseerd harnasonderdeel) voor de
agent-Q&A-lijn.**

- **Agent-Q&A (golden-suite):** elke meting (`golden-bench.ts --meting <naam>`) is één enkele run.
  Er is GEEN vlag of mechanisme dat automatisch N replicaten draait en variantie rapporteert.
  Wat er wél is: bij Ronde 1 zijn `n0b` en `n1` twee volledig aparte, met de hand herhaalde
  metingen met identieke code, en `docs/v1.0.6/n0-n1-vergelijking.md` rapporteert expliciet het
  verschil tussen die twee runs (7 van de 43 items anders beoordeeld tussen n0b en n1, "14%"),
  met de conclusie: *"op temperatuur 0, met identieke code, gaven twee runs een ander resultaat."*
  Dit weerlegt eerdere v1.0.5-bevindingen dat temperatuur 0 soms wél volledige determinisme gaf
  (`lokaal-7`/`lokaal-7-herhaling`, 32/32 identiek) — de langere v1.0.6-systeeminstructie voegt
  kennelijk resterende variatie toe. **Maar dit is een handmatig herhaalde meting, geen
  geautomatiseerd "--replicates N"-mechanisme in het script zelf.** R2-PRE (`r2-bench.ts`) is een
  enkele meting van 15 items, geen enkele vermelding van replicaten.
- **Optimizer-benchmark:** hier bestaat wél een ingebouwd replicate-mechanisme. `scripts/
  optimizer-benchmark.ts` accepteert `--runs <n> --first <n>` en de BEFORE/AFTER-fasen in
  `docs/optimizer-benchmark/` bevatten elk **20 losse runs** (`before/run-001.json` t/m
  `run-020.json`, idem `after/`), bevestigd door `analysis.json.counts`: `{"before": {"runs": 20,
  "candidates": 60}, "after": {"runs": 20, "candidates": 60}}`. De analyse rapporteert vervolgens
  per metriek een `meanVerdict`, `medianVerdict` én `worstVerdict` (bijvoorbeeld: "Eerlijkheid" is
  gemiddeld slechter, mediaan gelijk, worst-case beter) — dat IS een vorm van varianterapportage,
  al is het geen expliciete standaarddeviatie. Ook bestaan aparte `ablation/` (33 runs),
  `budget/` (9 runs), `ab-k5*/` (3 runs per variant) mappen voor gevoeligheidsanalyses.

**Conclusie:** het historische besef dat "temperatuur 0 geen volledige determinisme geeft" is
correct vastgesteld in `n0-n1-vergelijking.md`, en de eis dat kritieke benchmarks meerdere
replicaten zouden moeten hebben is voor de OPTIMIZER-lijn al gerealiseerd (20 runs, mean/median/
worst), maar voor de AGENT-Q&A-lijn (golden-suite, r2-suite) bestaat dit mechanisme nog niet als
herbruikbaar scriptonderdeel — elke golden/r2-meting is vandaag één run.

---

## Roosterengine/optimizer-eigen benchmark (los van agent-Q&A)

De roostergeneratie-engine (het "solver"/"optimizer"-deel, dat daadwerkelijk ROOSTERS genereert,
niet de Lyra-agent die erover praat) heeft een eigen, aantoonbaar volwassener benchmark-/
evaluatielijn, volledig los van `scripts/v106/`:

- **Engine/solver-code:** `src/server/optimizer/cpsat-optimizer.ts` (de adaptieve CP-SAT-gedreven
  optimizer), `src/server/optimizer/cpsat-solver.ts` (de daadwerkelijke solver-aanroep),
  `src/server/optimizer/baseline-optimizer.ts` (legacy/baseline-vergelijkingsengine),
  `python/cpsat_roster.py` (het Python/OR-Tools CP-SAT-model zelf, aangeroepen als subprocess —
  zie `spawnSync` in `optimizer-benchmark.ts`).
- **Kwaliteitsscoring van gegenereerde ROOSTERS** (hard-validity + zachte kwaliteitscomponenten)
  leeft in `src/domain/`: `quality-evaluator.ts` (de centrale evaluator: "hoe menselijk rijdt dit
  rooster?"), `roster-quality.ts`, `roster-quality-config.ts`, `quality-model.ts` (met versies
  QUALITY_MODEL_V1/V2/V3 — het model zelf is versienummergestuurd), `worst-case.ts`,
  `rhythm-metrics.ts`, `night-rhythm.ts`, `machinist-preference.ts`, `operational-requirements.ts`,
  `roster-flow.ts`. Regressietests hiervoor: `tests/optimizer/*.test.ts` (architectuur, baseline,
  cpsat, mutanten, operationele-eisen-solver, roosterkwaliteit-solver, scoremodel, versies).
- **Het benchmark-harnas zelf:** `scripts/optimizer-benchmark.ts` (444 regels) — één script voor
  zowel BEFORE als AFTER, met subcommando's `manifest --phase before|after`, `run --phase ...
  --engine ... --strategy ... --runs N --first N`, en `evaluate`. Een AFTER-run weigert te starten
  als de brongegevens niet identiek zijn aan de BEFORE-meting — expliciete garantie dat het
  verschil over de engine gaat, niet over verschoven data. Gedeelde bouwstenen in
  `scripts/benchmark/io.ts` (bestandsformaat: `RawRun`, `RawCandidate`, `BENCHMARK_ROOT =
  docs/optimizer-benchmark/`, `sha256`-hashing) en `scripts/benchmark/evaluate.ts` /
  `analyse.ts`. **Architectuurprincipe, expliciet in commentaar:** ruwe solver-uitkomsten worden
  bewaard, kwaliteitsmaten worden er ACHTERAF uit herberekend — blijkt een maat fout, dan wordt
  hij gerepareerd en beide fasen herberekend, zonder de solver opnieuw te draaien. Exact hetzelfde
  patroon als golden-bench.ts/golden-grade.ts in de agent-lijn.
- **Output:** `docs/optimizer-benchmark/manifest.json` (BEFORE) / `manifest-after.json` (AFTER) /
  `manifest-v105-baseline.json`, ruwe runs per fase (`before/`, `after/`, `ablation/`, `budget/`,
  `human/`, `human-dev1/`, `brain-after/`, `mp-*`, `ab-*`, `smoke/` — allemaal `run-NNN.json`),
  `benchmark-summary.json` (samengevatte metrics + rawRuns), `analysis.json` (het eindresultaat:
  `baseline`, `counts`, `hardValidity`, `regression`, `headline` met mean/median/worst-verdict per
  metriek, `perRun`, `perProfile`, `searchEfficiency`), `development-log.json` (genummerde
  ontwikkelbeslissingen D01–D08 met datum/reden/geobserveerd effect/uitkomst — vergelijkbaar in
  opzet met de R2-PRE-bevindingen maar dan voor de engine).
- **Menselijke-roosterlijn ernaast:** `docs/human-roster-benchmark/` — een aparte set die
  menselijk gemaakte roosters (7 basisroosters, 64 regels, 223 gewerkte dagen) analyseert om
  "zachte" menselijke roosterprincipes te destilleren (`human-roster-design-principles.md`, de
  belangrijkste samenvatting in die map: 12 genummerde principes met waarneming + principe +
  gevolg voor het platform, plus een expliciete tabel "hard vs. zacht"). Bijbehorende
  ruwe/afgeleide data: `official-roster-lines.json`, `official-features.json`, CSV's
  (`night-blocks.csv`, `rest-distribution.csv`, `rotation-boundaries.csv`, `transition-matrix.csv`,
  `work-blocks.csv`, `off-blocks.csv`), en de contrastieve adversarial-toetsen
  (`contrastive-check.json` / `contrastive-check-pre-h09.json`) die controleren of het
  kwaliteitsmodel een doelbewust verslechterd rooster ook lager scoort dan het origineel.
  Eigen scripts: `scripts/human-benchmark/solver-ab.ts`, `scripts/final-brain/solver-ab.ts`,
  `scripts/final-brain/queue-ablations.ts`, `scripts/final-brain/exchange-rates.ts`.
- **Rapportagescripts (bouwen leesbare rapporten uit de ruwe JSON):**
  `scripts/report/build-optimizer-report.ts`, `scripts/report/build-human-learning-report.ts`,
  `scripts/report/build-final-brain-report.ts`, `scripts/report/machinist-chapters.ts` — deze
  hebben eerder de HTML-rapporten in `docs/` opgeleverd (bijv.
  `NS-Roosterplatform-v1.0.4-Optimizer-Development-Report.html`,
  `NS-Roosterplatform-Human-Roster-Learning-Report.html`).

**Dit is dus een volledig gescheiden benchmark-wereld van de agent-Q&A-suite**: andere map
(`docs/optimizer-benchmark/`, `docs/human-roster-benchmark/` versus `docs/v1.0.6/`), ander
harnasscript (`scripts/optimizer-benchmark.ts` versus `scripts/v106/golden-bench.ts`), andere
scope (rooster-KWALITEIT versus agent-ANTWOORDGEDRAG), maar wél hetzelfde onderliggende
architectuurprincipe (ruw bewaren, score apart/achteraf berekenen) en, belangrijk voor een nieuwe
ronde, WÉL al een uitgewerkt replicate-mechanisme (20 runs, mean/median/worst) dat de agent-lijn
nog mist.

---

## Manifest/freeze-praktijk — velden vandaag vs gewenst

**`docs/v1.0.6/n0-manifest.json` bevat vandaag (bevestigd door het bestand zelf te lezen):**

| Categorie | Velden aanwezig |
| --- | --- |
| Identiteit/moment | `schema`, `recordedAt`, `purpose` |
| Git | `git.headCommit`, `git.headSubject`, `git.headDate`, `git.branch`, `git.uncommittedPaths` (aantal, niet de paden zelf) |
| Vorige baseline | `v105Baseline.headCommit` + verwijzing naar `docs/v1.0.5/baseline-manifest.json` |
| Data | `dutyPackage.id/label/sourceChecksum` + de VOLLEDIGE `duties`-array (223 diensten, geen hash-only) |
| Model | `localModel.model`, `.url`, `.temperature`, `.maxTokens`, `.timeoutMs`, `.reachable`, `.detail`, `.ollamaVersion`, `.gpu` — **geen seed-veld** (dit is een taalmodel-manifest, geen solver-manifest — CP-SAT-seeds horen thuis in het optimizer-manifest, zie hieronder) |
| Rechten/tools | `agentCapabilities` (alle capabilities, levels A/B/C, huidige DDR-grant), `toolCatalogue` (naam, allowed, requires) |
| UI | `chatImplementation.screen/files/note` |
| Bestaande assets | `existingBenchmarkAssets` — verwijzing naar oudere v1.0.5-testsets, GEEN verwijzing naar de golden-suite (die bestond nog niet op het moment van dit manifest) |
| Open issues | `openIssuesFromV105Report` (lijst van 7) |

**Wat hier NIET in staat, maar in het `n0-manifest.ts`-doc-commentaar wel als eis wordt genoemd
(§1 van de v1.0.6-opdracht):** *"minimaal: commit, databaseversie, dienstenpakket-checksum,
engineversie, kwaliteitsmodelversie, regelsetversie (...)"* — van die lijst ontbreken in het
daadwerkelijk geschreven bestand: **databaseversie, engineversie, kwaliteitsmodelversie,
regelsetversie**. Dit is geen educated guess maar een direct verschil tussen wat het bestandshoofd
belooft te doen en wat de uiteindelijke JSON-structuur bevat.

**Vergelijk met het optimizer-manifest (`docs/optimizer-benchmark/manifest.json`), dat WEL
close-to-compleet is voor de engine-kant:** `git.commit/dirty/branch`, `data.dutyPackage`
(inclusief `sourceChecksum`), `data.rosterStructureVersion`, `data.inputDataVersion`,
`hashes.profileConfig`, `hashes.ruleset`, `hashes.optimizerConfig`, `hashes.solverScript` (elk een
losse sha256-hash!), `ruleset.version` + `ruleset.legalStatus` + `ruleset.rules` (aantal),
`optimizerConfig` (volledige strategie-gewichten per strategie), en `machine` (cpuModel,
logicalCpus, totalMemoryBytes, os, node-versie, python-versie, **ortools-versie**,
solverWorkers). Geen `seed`-veld letterlijk aanwezig in dit topniveau-manifest, maar
`development-log.json` (D01) noemt expliciet dat de gebruikte seed per kandidaat wordt
vastgelegd in `CpSatOutcomeExtras` (in de ruwe run-bestanden, niet in het manifest zelf).

**Conclusie: er bestaan AL TWEE aparte manifest-implementaties**, met elk hun eigen sterke en
zwakke velden:
- `n0-manifest.json` (agent-kant): sterk op modelconfiguratie/capabilities/tools, zwak op
  hash-gebaseerde config-integriteit en op de vier expliciet beloofde maar ontbrekende velden
  (databaseversie, engineversie, kwaliteitsmodelversie, regelsetversie).
- `optimizer-benchmark manifest.json` (engine-kant): sterk op hash-gebaseerde config-integriteit
  (4 losse sha256-hashes), machine-specificaties inclusief solver-runtime-versie, en
  reproduceerbaarheidsgaranties (AFTER weigert te starten bij afwijkende brondata) — maar bevat
  geen taalmodel-informatie (logisch, want gaat niet over de agent).

Voor een eerlijke BEFORE/AFTER-ronde die zowel de agent als (mogelijk) de engine raakt, is geen van
beide manifesten op zichzelf compleet; een nieuw "voor"-manifest zou het beste van beide moeten
combineren (git + dutyPackage-checksum + modelconfiguratie + capability-grants uit
`n0-manifest.ts`, plus de vier losse config-hashes + machine/ortools-versie uit
`optimizer-benchmark.ts`'s manifest), en daarbovenop de vier velden toevoegen die `n0-manifest.ts`
zelf al noemt maar niet vult: expliciete databaseversie, engineversie, kwaliteitsmodelversie (er
bestaat al `QUALITY_MODEL_V1/V2/V3` in `quality-model.ts` — dat versienummer is beschikbaar en
wordt al gebruikt in `analysis.json.qualityModel`, maar staat niet in `n0-manifest.json`), en
regelsetversie (`ruleset.version` bestaat al in het optimizer-manifest — `"2026.1-cao-2024-2025-
transcribed"` — maar ontbreekt in `n0-manifest.json`).

---

## Wat is direct herbruikbaar voor een nieuwe BEFORE/AFTER-ronde, wat mist

### Direct herbruikbaar, zonder wijziging

1. **`scripts/v106/golden-bench.ts`** — generiek, neemt alleen `--meting <naam>`, draait de
   bestaande 43-item golden suite tegen het echte lokale model, geen stub. Dit is de kern om een
   nieuwe BEFORE- en AFTER-meting mee te draaien.
2. **`scripts/v106/golden-fabricatie.ts`** — generieke fabricatiecontrole over een hele meting.
3. **`scripts/v106/waarheid.ts`** — grondwaarheidsberekening, generiek tegen het actuele pakket.
4. **`scripts/optimizer-benchmark.ts` + `scripts/benchmark/io.ts`/`evaluate.ts`/`analyse.ts`** —
   als de nieuwe ronde ook de roostergeneratie-engine raakt (niet alleen de Lyra-agent), is dit een
   compleet, al werkend BEFORE/AFTER-harnas met ingebouwde replicate-runs, hash-gebaseerde
   config-integriteit en een garantie dat identieke brondata wordt gebruikt in beide fasen.

### Herbruikbaar met kleine aanpassing

5. **`scripts/v106/golden-grade.ts`** en **`scripts/v106/r2-grade.ts`** — het scheidingspatroon
   (meten/beoordelen apart, grondwaarheid live herberekend) is precies goed; nieuwe itemcategorieën
   vragen wel nieuwe `case`-takken in de `switch`.
6. **`scripts/v106/golden-suite.ts`** als generatorsjabloon — het dev/holdout-tel-mechanisme kan
   direct worden hergebruikt om de suite van 43 naar meer items te laten groeien (de `groei()`-
   beschrijving bestaat al, is alleen nooit uitgevoerd).
7. **`n0-manifest.ts`** als sjabloon voor een nieuw "voor"-manifest — zie hoofdstuk hierboven voor
   de velden die ontbreken en aangevuld moeten worden.

### Wat mist, en dus nieuw gebouwd moet worden

8. **Geautomatiseerde replicate-ondersteuning in de agent-Q&A-lijn.** `golden-bench.ts`/
   `r2-bench.ts` draaien vandaag altijd precies één keer per `--meting`. Het bestaande bewijs
   (`n0-n1-vergelijking.md`: 7 van 43 items anders tussen twee identieke runs op temperatuur 0) is
   zelf het argument waarom een nieuwe kritieke BEFORE/AFTER-ronde niet op één run per fase mag
   vertrouwen. Het optimizer-harnas laat al zien hoe dat eruit kan zien (20 runs, mean/median/
   worst-verdict per metriek) — dat patroon bestaat nog niet voor de agent-kant en moet worden
   overgenomen of nagebouwd (bijvoorbeeld: `golden-bench.ts --meting n2 --replicate 1..5`, gevolgd
   door een nieuw `golden-grade-samenvatten.ts` dat per item de spreiding over replicaten
   rapporteert).
9. **Een bevroren, doelbewust adversarial holdout-laag voor de agent-Q&A-suite.** Wat bestaat is
   een gewone dev/holdout-verdeling (steekproef, geen adversarial ontwerp) plus, in een heel andere
   context (het kwaliteitsmodel van roosters, niet de agent), een contrastieve adversarial-toets.
   Niet vastgesteld dat er ooit een derde, specifiek adversarial-ontworpen holdoutlaag is gebouwd
   voor de Lyra-agent zelf.
10. **De vier ontbrekende manifestvelden**: expliciete databaseversie, engineversie,
    kwaliteitsmodelversie en regelsetversie in het agent-kant-manifest (de bouwstenen — Prisma-
    migratieversie, `QUALITY_MODEL_V1/V2/V3`, `ruleset.version` — bestaan elders in de codebase en
    hoeven alleen te worden samengevoegd in een nieuw manifestscript).
11. **Groei van de golden suite naar 100+ items** — expliciet erkend gat sinds N0, nooit gedicht.
12. **Eén gecombineerd voor/na-manifest dat zowel de agent- als de engine-kant dekt** — vandaag
    bestaan twee aparte manifesttradities (`n0-manifest.ts` en `optimizer-benchmark.ts manifest`)
    die elkaar nooit hebben gecombineerd, terwijl beide nuttige velden hebben die de ander mist.
