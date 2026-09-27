# Promotiecontract — LYRA MASTER PROGRAM (§35, §57-§64)

Opgemaakt 2026-09-28/29, tegen HEAD zoals gelezen in deze sessie (nagenoeg gelijk aan het
bevroren BEFORE-punt `588c1e5` — zie `scripts/lyra-master/before-manifest.ts`'s eigen
commit-check). Dit document is **ontwerp en voorgedeclareerde regelset, geen uitgevoerde
promotie**. Het bouwt uitsluitend voort op wat al bestaat (zie
`docs/lyra-knowledge/inventory-benchmark-infrastructure.md` en de directe verificatie in
deze sessie van `demo-room/`) en verandert geen bestaande code. Conform §33/§34 is er in deze
ronde nog geen AFTER-meting — dus conform §58 mogen de hieronder vastgelegde
promotiecriteria niet meer stilzwijgend wijzigen zodra die er wel is.

---

## 1. Cross-system adapters (ontwerp, niet gebouwd)

### 1.1 De kernbevinding: twee benchmarklijnen, hetzelfde onderliggende agent-endpoint

`inventory-benchmark-infrastructure.md` beschrijft twee gescheiden benchmark-*lijnen*
(agent-Q&A onder `scripts/v106/`, en de roosterengine/optimizer-lijn onder
`scripts/optimizer-benchmark.ts`), en houdt `demo-room/` expliciet buiten die inventarisatie
("De Demo Room-submap (...) is buiten dit onderzoek gehouden, zoals gevraagd").

Voor dit document is dat onderscheid direct geverifieerd door zelf in `demo-room/src/` te
kijken, omdat §35 precies vraagt of Demo Room en het echte platform hetzelfde onderliggende
motorcode gebruiken. Het antwoord is: **ja, aantoonbaar, voor de agent-Q&A-lijn**:

| Aanroeper | Bestand:regel | Roept aan |
|---|---|---|
| Hoofdapp-benchmark (BEFORE/AFTER-harnas van deze ronde) | `scripts/v106/golden-bench.ts:10` | `import { askAgent } from "@/server/agent/agent"` |
| Demo Room — kwaliteitsscore | `demo-room/src/benchmark/agentQuality.ts:2-3` | `import { askAgent } from "@/server/agent/agent"` + `import { benchAnswer } from "@/server/agent/bench-adapter"` |
| Demo Room — runner (dev/holdout/hidden) | `demo-room/src/benchmark/run.ts:4` | `import { benchAnswer } from "@/server/agent/bench-adapter"` — met het eigen commentaar: *"het oordeel (...) komt uit `bench-adapter.ts`, dezelfde plek die de hoofdapp zelf gebruikt"* |
| Demo Room — challenge-engine | `demo-room/src/challenges/engine.ts:3` | `import { askAgent } from "@/server/agent/agent"` |
| Demo Room — promptvarianten (sandbox) | `demo-room/src/variants/promptVariants.ts:11-14` | eigen commentaar: *"De hoofdapp heeft nu één gecontroleerde koppeling voor experimenten: `LocalModelConfig.systemPromptOverride` (`src/server/agent/model/local.ts`) en `askAgent({ modelOverride })` (`src/server/agent/agent.ts`). Beide zijn additief en productiecode zet ze nooit."* |

**Concreet**: `askAgent()` in `src/server/agent/agent.ts` en `benchAnswer()` in
`src/server/agent/bench-adapter.ts` zijn niet twee gelijkende implementaties — het zijn
**letterlijk dezelfde functies, uit dezelfde bestanden**, aangeroepen door zowel de
"hoofdapp"-meting (`golden-bench.ts`, deze ronde's BEFORE/AFTER-harnas) als door Demo Room's
eigen benchmark (`agentQuality.ts`, `run.ts`, `challenges/engine.ts`). Het enige verschil
tussen een Demo Room-run en een golden-bench-run is:
- de **itemset** (Demo Room heeft zijn eigen `demo-room/src/benchmark/questions/{dev,holdout,hidden}.json`, los van `docs/v1.0.6/golden-suite.json`);
- optioneel een `modelOverride`/`systemPromptOverride` (alléén als een sandbox-variant expliciet is gekozen — `CONTROL` levert per ontwerp de ongewijzigde productie-instructie terug, zie `promptVariants.ts`).

Voor de roosterengine-kant is hetzelfde patroon aanwezig maar minder diep geverifieerd in
deze sessie: `demo-room/src/research/autonomousRun.ts:4-6` importeert
`@/server/optimizer/objective-weights` en `@/server/agent/research`, dezelfde modules als
`scripts/optimizer-benchmark.ts` (via `@/server/generation/generation-job`,
`@/server/optimizer/objective-weights`). **Niet vastgesteld** of dit voor élk onderdeel van
de optimizer-lijn net zo volledig samenvalt als voor de agent-Q&A-lijn hierboven — dat
zou een eigen, aparte verificatie vragen die buiten deze ronde valt.

### 1.2 Wat dit betekent voor een "systeem A vs. systeem B"-vergelijking

Zodra een vergelijking ooit "Lyra Demo Room" tegenover "het echte platform" (of tegenover
zichzelf via `golden-bench.ts`) zet, is de kans reëel dat beide kanten via `askAgent()`/
`bench-adapter.ts` op **exact dezelfde motorcode** draaien, met alleen een andere itemset of
een expliciet gekozen sandbox-variant. Een vergelijking die dat niet herkent, zou een schijnbaar
"onafhankelijke systeem B wint"-uitkomst kunnen rapporteren terwijl in werkelijkheid maar één
motor is gemeten, twee keer, met andere test-items. Dat is precies het risico dat §35 benoemt.

Wat wél echt onafhankelijk zou zijn: **het echte, huidige NS-roosterplatform buiten deze
codebase** (het bestaande productiesysteem dat roostercommissies vandaag gebruiken, voor zover
dat niet dezelfde `askAgent()`/rules-engine-code draait) — `niet vastgesteld` in deze ronde of
en hoe dat systeem is gekoppeld, want dat valt buiten de inventarisatie van dit onderzoek
(zie citaat hierboven: Demo Room-submap "buiten dit onderzoek gehouden").

### 1.3 Voorgesteld ontwerp: `LegacyPlatformAdapter` / `LyraAdapter`

Onderstaand is **illustratief ontwerp in een codeblok binnen dit document** — er is
bewust géén los `.ts`-bestand van gemaakt. Niets hiervan is gebouwd, geïmporteerd of
aangesloten op enige bestaande module; het dient uitsluitend om de vorm van een toekomstige
oplossing concreet te maken.

```ts
// ILLUSTRATIEF ONTWERP — niet gebouwd, niet gewired, geen bestand in de repo.
// Doel: een vergelijkingsharnas kan twee "systemen" aanroepen via eenzelfde
// interface, en moet expliciet kunnen vaststellen of ze dezelfde motorcode delen
// vóórdat het een winnaar aanwijst.

interface EngineFingerprint {
  /** bv. "src/server/agent/agent.ts" — het bestand dat de daadwerkelijke logica bevat. */
  readonly modulePath: string;
  /** bv. "askAgent" — de aangeroepen export. */
  readonly exportName: string;
  /** sha256 van de modulebron op het moment van de run (reproduceerbaarheidsgarantie,
   *  zelfde patroon als `hashes.ruleset`/`hashes.toolCatalogue` in
   *  `scripts/lyra-master/before-manifest.ts`). */
  readonly sourceHash: string;
}

interface BenchmarkItem { readonly id: string; readonly prompt: string; /* … */ }
interface SystemAnswer { readonly text: string; readonly sources: readonly string[]; /* … */ }

/** Een van de twee kanten van een cross-system-vergelijking. */
interface SystemAdapter {
  readonly systemId: string; // bv. "LYRA_DEMO_ROOM" | "LYRA_GOLDEN_BENCH" | "REAL_NS_PLATFORM"
  readonly engineFingerprint: EngineFingerprint;
  askQuestion(item: BenchmarkItem): Promise<SystemAnswer>;
}

/** Specialisatie: Lyra-kant (Demo Room of hoofdapp), optioneel met sandbox-override. */
interface LyraAdapter extends SystemAdapter {
  readonly modelOverride?: unknown; // ChatModel | undefined — alleen bij expliciete sandbox-variant
}

/** Specialisatie: het echte, huidige NS-platform (buiten deze codebase). */
interface LegacyPlatformAdapter extends SystemAdapter {
  readonly platformVersion: string;
}

type ComparisonVerdict =
  | { readonly kind: "INDEPENDENT_COMPARISON"; readonly winner: "A" | "B" | "TIE" }
  | {
      readonly kind: "SAME_UNDERLYING_ENGINE";
      readonly reason: string;
      readonly sharedFingerprint: EngineFingerprint;
    };

/** Vergelijkt twee systemen — weigert een winnaar te noemen als ze dezelfde motor delen. */
function compareSystems(a: SystemAdapter, b: SystemAdapter /*, resultsA, resultsB */): ComparisonVerdict {
  const zelfdeMotor =
    a.engineFingerprint.modulePath === b.engineFingerprint.modulePath &&
    a.engineFingerprint.exportName === b.engineFingerprint.exportName &&
    a.engineFingerprint.sourceHash === b.engineFingerprint.sourceHash;

  if (zelfdeMotor) {
    return {
      kind: "SAME_UNDERLYING_ENGINE",
      reason:
        `${a.systemId} en ${b.systemId} roepen beide ${a.engineFingerprint.modulePath}:` +
        `${a.engineFingerprint.exportName} aan — dit is één motor, twee itemsets, geen ` +
        `onafhankelijke systeem-A-vs-systeem-B-vergelijking.`,
      sharedFingerprint: a.engineFingerprint,
    };
  }
  // Hier zou de echte, inhoudelijke vergelijking komen — niet uitgewerkt in dit ontwerp.
  return { kind: "INDEPENDENT_COMPARISON", winner: "TIE" };
}
```

Concreet, tegen de bevindingen uit §1.1: een harnas dat `golden-bench.ts` (via `askAgent`,
`src/server/agent/agent.ts`) en `demo-room/src/benchmark/agentQuality.ts` (ook via `askAgent`,
zelfde bestand) als "systeem A" en "systeem B" zou opvoeren, moet met dit ontwerp
`SAME_UNDERLYING_ENGINE` teruggeven — nooit een independent-win-verhaal. Alleen een
vergelijking tegen het echte, huidige NS-platform (buiten deze codebase, `niet vastgesteld`
in deze ronde) zou potentieel `INDEPENDENT_COMPARISON` mogen zijn, en zelfs dan alleen na
verificatie dat dat platform niet óók via gedeelde code loopt.

---

## 2. Voorgedeclareerde promotiecriteria (§57)

**Vastgelegd nu, vóórdat er enige AFTER-meting bestaat.** Dit is de volledige lijst; er is op
het moment van schrijven geen AFTER-resultaat om naar te kijken — de BEFORE-benchmark zelf is
nog `LOCAL REQUIRED` (`current-state.md`: geen Ollama bereikbaar in deze cloud-omgeving).

Een variant/wijziging is een **PROMOTION_CANDIDATE** dan en slechts dan als **alle** onderstaande
criteria tegelijk gelden:

1. **Geen nieuwe bevestigde harde overtredingen.** Geen item dat in de BEFORE-meting
   `VALID_WITHIN_VALIDATED_RULESET` of `VALID_WITH_WARNINGS` scoorde, mag in de AFTER-meting
   `CONFIRMED_HARD_VIOLATION` scoren (terminologie: `src/server/rules-engine/validation/result.ts`,
   zie `conflict-report.md` item 7 voor de historie van deze naamgeving).
2. **Geen profielgrens-regressie.** `src/domain/roster-profiles.ts`'s harde
   profielgeschiktheidsfilter mag door de wijziging niet worden omzeild of verzacht — dit
   systeem is met opzet los van voorkeuren gehouden (`knowledge-model.md` §3) en die scheiding
   mag een promotie niet ongedaan maken.
3. **Geen dekkingsregressie.** Het aandeel `IMPLEMENTED`/`TESTED` regels (vandaag 57/71
   resp. 26/71 of 25/71 — zie `conflict-report.md` item 6 voor het onopgeloste telverschil)
   mag niet dalen ten opzichte van de BEFORE-meting.
4. **Geen grondingsregressie.** `golden-fabricatie.ts`'s ongegronde-vermeldingen-telling
   (regel-ID/dienstnummer/roostercode niet uit brondata) mag in de AFTER-meting niet hoger
   zijn dan in de BEFORE-meting, op zowel dev- als holdout-subset.
5. **Geen veiligheids-/weigeringsregressie.** Categorie I (veiligheid/verboden handelingen,
   4 items in `golden-suite.json`) moet in de AFTER-meting minimaal even goed scoren als in de
   BEFORE-meting — dit is, net als in Demo Room's eigen
   `VEILIGHEIDSDIMENSIES = ["grounding", "falsePremiseCorrection", "causalClaims"]`
   (`demo-room/src/proof/decision.ts:37`), een dimensie die **niet** mag verslechteren, ook
   niet marginaal.
6. **Geen bronautoriteit-regressie.** Geen nieuwe onbevestigde autoriteitstaal
   ("bevestigd"/"formeel"/"CAO"/"verplicht"/"officieel" zonder onderliggende
   `legalStatus: VALIDATED`-tool-data) mag door de AFTER-meting heen komen — dit is exact het
   gat dat `knowledge-gap-report.md` item 7 vaststelt als structureel ontbrekend in
   `src/server/agent/grounding.ts`; zolang dit gat niet gedicht is, kan dit criterium alleen
   handmatig (niet automatisch) worden gecontroleerd, en dat moet dan ook expliciet zo worden
   vermeld in het regressierapport.
7. **Holdout-verbetering moet écht gemeten zijn, niet alleen dev-verbetering.**
   `golden-suite.json` en `demo-room/src/benchmark/questions/holdout.json` scheiden dev/holdout
   al (`inventory-benchmark-infrastructure.md`, "DEV/HOLDOUT-scheiding"); een promotie mag zich
   nooit alleen op een dev-winst beroepen. Holdout-items mogen nooit zijn gebruikt om prompts
   of instructies bij te sturen (letterlijke eis, geciteerd in
   `inventory-benchmark-infrastructure.md:88-90`, uit `golden-suite.ts`'s eigen commentaar).
8. **De eigen beweerde dimensie van de variant moet niet-null zijn.** Elke variant claimt één
   primaire dimensie (`PRIMAIRE_DIMENSIE_PER_CATEGORIE` in
   `demo-room/src/proof/decision.ts:59-62`, bv. `TOOL_ROUTING` → `toolChoice`,
   `CONTEXT_POLICY` → `contextResolution`). Een promotie mag niet worden voorgesteld op basis
   van een *andere* dimensie dan die de variant zelf claimt te verbeteren. **Reden, met naam
   genoemd**: het historische `toolChoice=null`-probleem — *"Een eerste echte run promoveerde
   `variant-a-tool-hint` (categorie `TOOL_ROUTING`) puur op een groundingwinst, terwijl
   `toolChoice` `null` bleef omdat geen enkel benchmarkitem een `expectedTools`-veld had — de
   variant bewees dus nooit dat tool-routing zelf verbeterde"* (letterlijk citaat,
   `demo-room/src/proof/decision.ts:51-54`). Dit criterium bestaat specifiek om die fout niet
   te herhalen.
9. **Run-stabiliteit niet wezenlijk slechter.** Gegeven het bevestigde non-determinisme bij
   temperatuur 0 (7/43 items anders tussen n0b/n1, `inventory-benchmark-infrastructure.md`
   §"Replicates/variantie"), moet een AFTER-meting minimaal `MIN_POST_RUNS` (`= 2`,
   `demo-room/src/proof/decision.ts:45`) onafhankelijke runs gebruiken, en de spreiding tussen
   die runs mag niet substantieel groter zijn dan bij de BEFORE-meting. Voor de roosterengine-
   kant geldt het reeds bestaande 20-replicate-patroon (`scripts/optimizer-benchmark.ts`) als
   ondergrens, niet 1 run.
10. **Componentvloeren op kwaliteitsdimensies.** Geen enkel kwaliteitsmodel-onderdeel
    (`hours`/`flow`/`rest`/`nights`/`fairness`/`stability`/`preference`,
    `COMPONENT_KEYS` in `src/domain/quality-model.ts:373`) mag zakken onder zijn BEFORE-waarde
    min een vooraf vastgestelde tolerantie — exact getal `niet vastgesteld` in deze ronde
    (vereist een BEFORE-meting om een reële tolerantie op te baseren; wordt vastgesteld zodra
    de BEFORE-benchmark draait, niet achteraf op basis van de AFTER-uitkomst).
11. **Rollback beschikbaar.** Er moet, vóór activatie, een werkende terugvalroute bestaan naar
    de vorige actieve toestand (zie hoofdstuk 4, stap "rollback beschikbaar").

**Bevriezing.** Zodra dit bestand wordt gecommit, is bovenstaande lijst de **vastgestelde
beslisregel voor deze ronde**. Wijziging is alleen toegestaan via een nieuwe, gedateerde
commit die expliciet vermeldt wát verandert en waarom — nooit een stille bewerking van dit
bestand nadat een AFTER-resultaat bekend is. Dit is de expliciete uitvoering van §58
("geen post-hoc criteria").

---

## 3. Brain manifest (§60-61) — ontwerp, geen gebouwd artefact

`scripts/lyra-master/before-manifest.ts` (zie citaten hierboven) implementeert al een
belangrijke deelverzameling hiervan **specifiek voor de BEFORE-benchmark van deze ronde**:
git-commit, `databaseVersion` (nieuwste Prisma-migratiemap, vandaag
`20260925041247_technische_experimenten` — zelf via `readdirSync`+`sort()` bepaald, dus
altijd actueel, niet hier hardgecodeerd als aanname voor toekomstig gebruik),
`engineVersion` (= `package.json.version`, vandaag `1.0.3`), `qualityModelVersion` (=
`QUALITY_MODEL_V3.version`, letterlijk `"quality-model-v3"` — zie `src/domain/
quality-model.ts:328-336`), `rulesetVersion` (= `activeRuleset().version`, letterlijk
`"2026.1-cao-2024-2025-transcribed"`, `src/server/rules-engine/ruleset/index.ts:30,57`),
plus hashes van ruleset/toolCatalogue/goldenSuite.

**Het hier ontworpen "brain manifest" is breder**: `before-manifest.ts` dekt één
benchmarkmeting; een brain manifest zou moeten dekken **welke componenten samen zouden
moeten bewegen als een Lyra-verbetering ooit naar het echte platform wordt gepromoveerd** —
dus ook componenten die `before-manifest.ts` niet raakt (systeeminstructie-hash,
toolcontract-hash als los, versioned object, geheugen-/voorkeursregisterversie,
claim-verifierversie, engine-compatibiliteit).

```json
{
  "schema": "ns-lyra-brain-manifest/1",
  "_status": "ONTWERP — nog geen enkel veld hieronder is als apart, gebouwd artefact geverifieerd; velden met een concrete waarde citeren een bestaande bron, velden zonder concrete waarde zijn 'niet vastgesteld'.",

  "lyraAgentVersion": "niet vastgesteld — geen los versienummer voor de agent zelf gevonden; package.json.version (1.0.3) dekt de hele repo, niet specifiek de agent",
  "modelAdapter": "local | stub — zie src/server/agent/model/{local,stub}.ts",
  "modelName": "niet vastgesteld op manifestniveau — komt uit runtime-config (NS_LOCAL_LLM_MODEL), zie localConfigFromEnv() in scripts/lyra-master/before-manifest.ts",

  "systemInstructionVersion": "niet vastgesteld — geen los versieveld op systeeminstructie() in src/server/agent/model/local.ts vandaag",
  "systemInstructionHash": "niet vastgesteld — before-manifest.ts hasht ruleset/toolCatalogue/goldenSuite, NIET de systeeminstructie-tekst zelf; dit is een concreet gat t.o.v. wat een brain manifest zou moeten vastleggen",

  "toolContractVersion": "niet vastgesteld — geen los versienummer op toolCatalogue() (src/server/agent/tools.ts)",
  "toolContractHash": "sha256(toolCatalogue) bestaat al als patroon in before-manifest.ts (hashes.toolCatalogue) — herbruikbaar, niet apart voor dit doel opnieuw gebouwd",

  "knowledgeRegistryVersion": "niet vastgesteld — er bestaat geen apart 'knowledge registry'-versienummer; het dichtstbijzijnde is rulesetVersion (zie hieronder) plus de projectielaag in knowledge-model.md §4 (src/server/knowledge/canonical-status.ts), die zelf geen versieveld heeft",
  "knowledgeRegistryHash": "niet vastgesteld",

  "preferenceRegistryVersion": "niet vastgesteld — voorkeuren (MACHINIST_PREFERENCE/HUMAN_DOMAIN_INPUT) leven verspreid in quality-model.ts/profile-affinity.ts/night-rhythm.ts zonder eigen registerversie; QUALITY_MODEL_V3 is het dichtstbijzijnde bestaande versienummer en dekt dit gedeeltelijk (zie qualityModelVersion)",
  "preferenceRegistryHash": "niet vastgesteld",

  "qualityModelVersion": "quality-model-v3 — QUALITY_MODEL_V3.version, src/domain/quality-model.ts:328-336; let op: CURRENT_QUALITY_MODEL (het model dat nieuwe kandidaten daadwerkelijk beoordeelt) wijst vandaag naar QUALITY_MODEL_V2, niet V3 (quality-model.ts, regel bij CURRENT_QUALITY_MODEL) — een brain manifest moet dit onderscheid (nieuwste versie vs. actief-in-gebruik-versie) expliciet apart vastleggen, wat before-manifest.ts vandaag niet doet",

  "rulesetVersion": "2026.1-cao-2024-2025-transcribed — activeRuleset().version, src/server/rules-engine/ruleset/index.ts:30,57",

  "memorySchemaVersion": "niet vastgesteld — geen los versieveld op prisma.AgentMemoryItem/MemoryStatus gevonden; het dichtstbijzijnde is de Prisma-migratienaam (zie compatibleDbSchemaVersion)",

  "claimVerifierVersion": "niet vastgesteld — bestaat vandaag niet als los component: knowledge-gap-report.md item 7 stelt vast dat een automatische claim-/autoriteitstaal-verifier structureel ontbreekt in grounding.ts; zodra hij gebouwd wordt, hoort hij hier een eigen versienummer te krijgen",

  "benchmarkVersion": "golden-suite.json version-veld (docs/v1.0.6/golden-suite.json) plus, indien van toepassing, demo-room's eigen dev/holdout/hidden-bestandsversies — before-manifest.ts legt vandaag alleen itemCount+counts vast, geen los versienummer van de suite zelf buiten wat golden-suite.json intern al heeft",

  "sourceCoverageStatus": "zie docs/source-coverage.md en npm run verify:bronnen (8/8 geslaagd op 2026-09-05, current-state.md) — dit manifest zou het resultaat van die verificatie moeten overnemen, niet opnieuw berekenen",

  "compatibleEngineVersion": "1.0.3 — package.json.version, zoals ook gebruikt als 'engineVersion' in before-manifest.ts; een brain manifest voor productie-promotie moet dit expliciet interpreteren als 'minimaal vereiste platformversie', niet als 'huidige versie'",

  "compatibleDbSchemaVersion": "20260925041247_technische_experimenten — nieuwste map in prisma/migrations/, zelfde databaseVersion()-logica als before-manifest.ts (readdirSync + sort, altijd het nieuwste; expliciet geen los, apart bijgehouden versienummer omdat dat niet bestaat)",

  "createdAt": "wordt gevuld op het moment van genereren — new Date().toISOString(), zelfde patroon als before-manifest.ts se 'recordedAt'"
}
```

**Status**: dit is een **ontwerp**, geen gebouwd artefact. `before-manifest.ts` is het enige
vandaag daadwerkelijk draaiende manifest-script, en dekt een subset van bovenstaande (git,
databaseVersion, engineVersion, qualityModelVersion, rulesetVersion, plus drie hashes). De
velden die hierboven "niet vastgesteld" zijn, zijn precies de velden die zouden moeten worden
toegevoegd als dit ooit van "BEFORE-benchmarkmanifest" naar "brain manifest voor
productiepromotie" groeit — vooral `systemInstructionHash` (vandaag niet gehasht, alleen
ruleset/toolCatalogue/goldenSuite) is een concreet gat: een systeeminstructie-wijziging zou
vandaag geen manifestverschil opleveren.

---

## 4. Veilige promotieflow (§62-64)

| # | Stap | Wat al bestaat | Wat nog ontbreekt / plan |
|---|---|---|---|
| 1 | **Sandbox-kandidaat** | `demo-room/src/variants/promptVariants.ts` — een `PromptVariant` is een pure tekstfunctie `(basis, request) → nieuwe instructie`; `CONTROL` is bewijsbaar identiek aan productie. Additief via `askAgent({ modelOverride })`/`LocalModelConfig.systemPromptOverride`, **productiecode zet dit nooit**. | — |
| 2 | **Tests** | `demo-room/src/publish/safePublish.ts`'s `echteTypecheck()` (`npx tsc --noEmit`) is al onderdeel van de bestaande safe-publish-pijplijn. Los daarvan: `tests/optimizer/*.test.ts`, `tests/agent/*.test.ts`, `tests/knowledge/canonical-status.test.ts`. | Geen CI-koppeling voor `scripts/verify-geheugen.ts`/`scripts/verify-agent.ts` (`knowledge-gap-report.md`, aanvullende hiaten) — losse, niet in `npm test` meelopende scripts. |
| 3 | **DEV-benchmark** | `golden-bench.ts`/`golden-grade.ts` op de 35 dev-items van `golden-suite.json`; Demo Room's `runSuite("dev", …)` (`demo-room/src/benchmark/run.ts`) op zijn eigen `questions/dev.json`; `echteSmokeBenchmark()` in `safePublish.ts` (3 vaste smoke-items) als kleinste variant hiervan. | Geautomatiseerd replicate-mechanisme (`--replicates N`) ontbreekt nog voor de agent-Q&A-lijn (bestaat al voor de optimizer-lijn, 20 runs/fase). |
| 4 | **Locked holdout** | `golden-suite.json`'s 8 holdout-items, `r2-suite.json`'s eigen 5, Demo Room's `questions/holdout.json` — alle drie met de expliciete regel "nooit gebruikt om prompts bij te sturen". | Geen doelbewust-adversarial holdoutlaag voor de agent zelf (wél voor het kwaliteitsmodel: `docs/human-roster-benchmark/contrastive-check.json`) — `knowledge-gap-report.md` item 10. |
| 5 | **Regressieanalyse** | `golden-grade.ts` (her-grade, dev/holdout apart), `scripts/benchmark/evaluate.ts`/`analyse.ts` (mean/median/worst-verdict, optimizer-kant), `demo-room/src/proof/decision.ts` (`VEILIGHEIDSDIMENSIES`, `PRIMAIRE_DIMENSIE_PER_CATEGORIE`, `MIN_POST_RUNS`). | Eén gecombineerde regressieanalyse die beide lijnen (agent + engine) én de criteria uit hoofdstuk 2 hierboven in één rapport samenbrengt — bestaat vandaag niet, alleen los per lijn. |
| 6 | **PROMOTION_CANDIDATE-status** | Geen letterlijke status met deze naam gevonden. `demo-room/src/publish/versions.ts`'s `LyraVersionStatus` kent vandaag alleen `"ACTIVE" \| "SUPERSEDED" \| "ROLLED_BACK" \| "FAILED"` (`demo-room/src/types.ts:212`) — geen `PROMOTION_CANDIDATE`-waarde. | Toevoegen van deze status (en de bijbehorende voorwaarde: hoofdstuk 2 volledig doorstaan) is nog te bouwen, additief (breidt een bestaand union-type uit, geen breaking change). |
| 7 | **Human review** | `safePublish.ts`'s eigen docstring: *"Wordt uitsluitend aangeroepen ná een expliciete `Publiceren`-bevestiging van een mens (UI/CLI) — nooit door de Demo Room op eigen initiatief"* (`demo-room/src/publish/safePublish.ts:41-44`), zie ook `demo-room/docs/SAFETY-BOUNDARIES.md` (**niet zelf gelezen in deze sessie — verwijzing overgenomen uit code-commentaar, inhoud van dat bestand `niet vastgesteld`**). | — |
| 8 | **Staging/preflight in het echte NS-platform** | **Niet vastgesteld.** `safePublish.ts` schrijft naar `NS_PRODUCTION_PROMPT_FILE` (genoemd in `promptVariants.ts`-commentaar) binnen déze codebase/omgeving — of dat overeenkomt met een apart, echt NS-staging-platform buiten deze repo is niet onderzocht in deze ronde (Demo Room-submap is, zoals hierboven geciteerd, bewust buiten de Fase 0-inventarisatie gehouden; deze sessie heeft wel direct in `demo-room/src` gekeken voor §1, maar niet de bredere NS-infrastructuur errond geverifieerd). | Vaststellen of "staging" hier "een aparte omgeving" betekent of "dezelfde omgeving, `NS_PRODUCTION_PROMPT_FILE` nog niet actief" is nog te doen. |
| 9 | **Human activate** | `demo-room/src/publish/versions.ts`'s `activateVersion(versionId)` (regel 112) — expliciet gescheiden van `createVersion()`: *"Legt een nieuwe, nog niet actieve versie vast. `activateVersion()` maakt hem pas live."* (code-commentaar, regel 96). | — |
| 10 | **Canary** | **Niet vastgesteld.** Geen percentage-gebaseerde geleidelijke uitrol-mechanisme gevonden in `demo-room/src/publish/` — `activateVersion()` lijkt een volledige, directe overstap, geen canary-fractie. | Canary-mechanisme (bv. X% van gesprekken op nieuwe versie) is nog te ontwerpen en bouwen. |
| 11 | **Production** | Buiten scope van deze ronde (het echte NS-platform, niet deze codebase) — **niet vastgesteld**. | — |
| 12 | **Rollback beschikbaar** | `demo-room/src/publish/safePublish.ts`: automatische rollback bij een falende stap (regels rond 215-229, `outcome: "ROLLBACK_FAILED"` als zelfs dat mislukt) én een handmatige `rollbackTo(versionId)`-functie (regel 308) voor gecontroleerd herstel via dashboard/CLI (`npm run demo-room -- rollback --version-id <id>`, geciteerd in code-commentaar). | — dit is al goed gedekt; geen actie nodig. |

**Kernconclusie van dit hoofdstuk**: stappen 1, 2, 5 (deels), 7, 9 en 12 hebben al een
werkende, geverifieerde tegenhanger in `demo-room/src/publish/`. Stappen 3-4 hebben een
werkende tegenhanger die nog een replicate-/adversarial-uitbreiding mist (al elders in dit
project als bekend gat gedocumenteerd, zie `knowledge-gap-report.md` items 9-10). Stap 6
(een letterlijke `PROMOTION_CANDIDATE`-status) bestaat nog niet, maar is een kleine,
additieve uitbreiding van een bestaand type. Stappen 8, 10 en 11 raken het echte NS-platform
buiten deze codebase en zijn in deze ronde **niet vastgesteld** — nooit geraden, altijd zo
gelabeld.

**Nooit automatische productie-push.** Geen van bovenstaande bestaande mechanismen
(`activateVersion()`, `rollbackTo()`) wordt ooit door Demo Room op eigen initiatief
aangeroepen — beide vereisen een expliciete menselijke aanroep (UI/CLI-bevestiging). Dit
document wijzigt dat uitgangspunt niet en stelt nergens een geautomatiseerde
productie-activatie voor.

---

## 5. Slotverklaring

Er is in deze ronde geen enkele promotie uitgevoerd of voorbereid buiten dit ontwerp. Dit
contract is voorgedeclareerd vóór enige AFTER-meting bestaat, exact zoals §58 van de opdracht
vereist.
