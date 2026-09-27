# Migratierapport — plan, geen uitvoering (§99, LYRA MASTER PROGRAM)

Status: **PLAN, NIET UITGEVOERD.** Dit document beantwoordt de vraag "hoe zou de huidige
drie-modellen-situatie migreren richting het canonieke schema uit `knowledge-model.md`" —
veilig en auditeerbaar, nooit door bestaande logs/records te herschrijven alsof ze altijd
een andere waarde hadden, en nooit uitgevoerd vóórdat de bevroren BEFORE-meting bestaat
(§33/§34 van de opdracht). Er is in deze ronde **niets gemigreerd**: geen regel, geen
geheugenitem, geen operationele eis is verplaatst, hernoemd of gemuteerd. Dit rapport
beschrijft alleen wát er ooit zou gebeuren, in welke volgorde, en — minstens zo belangrijk —
wat er nooit zou gebeuren.

---

## 1. Uitgangspunt

`src/server/knowledge/canonical-status.ts` bestaat vandaag al, is additief en is nergens
aangesloten. Het bevat drie pure projectiefuncties (`fromRuleStatus()`,
`fromOperationalRequirementSource()`, `fromMemoryStatus()`) die elk van de drie bestaande
statusmodellen — `RuleStatus` op `RuleDefinition`, de ad-hoc string
`USER_PROVIDED_OPERATIONAL_DESIGN_REQUIREMENT` op `src/domain/operational-requirements.ts`,
en `MemoryStatus` op `prisma.AgentMemoryItem` (zie `inventory-rules-and-sources.md` §2-3
voor de volledige inventarisatie van de drie systemen) — vertaalt naar één gedeeld
vocabulaire (`CanonicalConfidence`). Het bestand zelf documenteert in zijn eigen
code-commentaar (regels 9-18) dat het geen van de drie bronsystemen vervangt of aanpast, en
dat "niets in `agent.ts`, de rules-engine of het leergeheugen" deze functies vandaag aanroept.

Dit is bevestigd met **13 slagende unit tests** in `tests/knowledge/canonical-status.test.ts`
(7 gevallen voor `fromRuleStatus`, 1 voor `fromOperationalRequirementSource`, 5 voor
`fromMemoryStatus` — elke enum-waarde uit alle drie bronsystemen gedekt, `it.each` in drie
`describe`-blokken).

**"Migratie" betekent in dit document nadrukkelijk niet**: `RuleStatus` of `MemoryStatus`
vervangen door een nieuw type. `knowledge-model.md` §0 en §4 stellen het ontwerpprincipe
expliciet vast: *"Ontwerpprincipe van dit document: toevoegen, niet vervangen. Elke
voorgestelde wijziging is een nieuw, optioneel veld of een aparte, additieve
projectielaag — nooit een breaking change aan `RuleDefinition`, `operational-requirements.ts`,
of `AgentMemoryItem`"* (`knowledge-model.md:21-23`). Dit migratierapport herbevestigt dat
principe onveranderd: er wordt nergens hieronder voorgesteld een van de drie bestaande
enums te verwijderen, te hernoemen of hun betekenis te wijzigen.

---

## 2. Wat WEL zou veranderen, ooit, als dit wordt uitgevoerd

Dit blijft ontwerp, geen uitvoering — onderstaande is nog niet toegepast op de code.

### 2.1 Twee optionele, additieve velden (nog niet toegevoegd)

`knowledge-model.md` §5 stelt twee optionele velden voor:

1. **`conflictsWith?: readonly string[]`** op `RuleDefinition` — een statisch,
   inspecteerbaar veld naast de bestaande impliciete conflictoplossing in `resolveRule()`
   (`ruleset/types.ts`). Vervangt `resolveRule()` niet; maakt alleen een periodiek
   conflict-rapport mogelijk zonder elke regelcombinatie te hoeven evalueren.
2. **`sourceExcerptHash?: string`** op `RuleSource` — sha256 van het specifiek
   getranscribeerde fragment (niet het hele document, dat heeft `sources/manifest.json` al
   op documentniveau). Laat zien of de transcriptie van een artikel nog exact overeenkomt
   met wat ooit is overgenomen.

**Geverifieerd door deze sessie dat ze nog niet bestaan:** een grep op
`src/server/rules-engine/ruleset/types.ts` naar `conflictsWith` en `sourceExcerptHash`
levert **geen treffers** op (`grep -n "conflictsWith\|sourceExcerptHash"
src/server/rules-engine/ruleset/types.ts` → exit-code 1, leeg). Beide velden zijn dus op
dit moment nog puur ontwerp in `knowledge-model.md`, niet iets dat al in de typedefinities
staat.

Omdat beide velden optioneel (`?:`) zouden zijn, breekt het toevoegen ervan geen bestaande
code die `RuleDefinition`/`RuleSource`-objecten construeert zonder ze — dat maakt de
*schemawijziging zelf* een niet-breaking, no-op stap (zie §4b hieronder). Het *vullen* van
`conflictsWith` met daadwerkelijke waarden is wél een inhoudelijke wijziging aan het
regelbestand en valt daarom onder de BEFORE-freeze-regel (§3 hieronder).

### 2.2 Een toekomstige Knowledge-UI / consistency-checker

`knowledge-model.md` §6-7 noemt twee toekomstige consumenten van de projectielaag, geen van
beide gebouwd:

- Een **consistency-checker** (opdracht §47) die `canonical-status.ts` gebruikt om drift
  tussen componenten te signaleren — zie `conflict-report.md` voor de tien conflicten die
  zo'n checker zou moeten kunnen vangen (met name conflict #1, de drie parallelle
  statusmodellen zelf, en conflict #4, het 46-uurs nachtherstel op drie plekken met drie
  bronstatussen).
- Een **Knowledge-UI-scherm** (opdracht §32) bovenop de projectielaag, dat één plek biedt om
  `CanonicalConfidence` te tonen voor een gegeven stuk kennis, ongeacht welk van de drie
  bronsystemen het daadwerkelijk bewaart.

Beide zijn vandaag **niet gebouwd** — enkel de read-only projectiefuncties die ze ooit
zouden voeden.

---

## 3. Wat NOOIT zou gebeuren, ook niet in een toekomstige uitvoering

Dit zijn geen aanbevelingen maar harde grenzen — enkele direct uit de opdracht, andere
uit precedent dat deze codebase zelf al heeft vastgelegd.

1. **Nooit een bestaand, onveranderlijk log/record herschrijven alsof het altijd een
   andere waarde had.** `run-before-local.ps1` (regels 32-33) belichaamt dit principe al
   concreet voor benchmarkmetingen: *"Elke replicaat krijgt een uniek 'meting'-pad (nooit
   overschreven, zelfs bij een herhaalde scriptrun)"* — een eerdere meting wordt bij een
   volgende run niet aangepast, alleen aangevuld met een nieuwe, apart genummerde meting.
   Dit migratierapport generaliseert dat principe naar kennisrecords: een `RuleDefinition`,
   `AgentMemoryItem` of `operational-requirements`-item dat ooit een bepaalde status of
   waarde droeg, wordt bij een schemawijziging nooit stilzwijgend herschreven om te
   suggereren dat het altijd de nieuwe waarde had — een correctie wordt een nieuwe,
   zichtbare vervolgstap (`supersededBy`, een nieuwe versie, een expliciet gemarkeerde
   correctie), niet een overschrijving in place.
2. **Nooit een lokale/Dordrecht-voorkeur stilzwijgend promoveren tot NS-breed.**
   `knowledge-gap-report.md` §8b constateert dat er vandaag geen scope-veld bestaat om
   Dordrecht-lokale kalibraties (nachtritme, klokdrempel, begintijdsprong,
   dagdienstgewichten) te onderscheiden van iets dat voor heel NS zou gelden — een
   toekomstige migratie mag dat gat niet dichten door de bestaande Dordrecht-kalibraties
   impliciet als NS-breed te behandelen; elke promotie naar een breder toepassingsgebied is
   een expliciete, aparte, mens-goedgekeurde stap, geen bijeffect van een schemawijziging.
3. **Nooit een audit-"fix" een waarde laten wijzigen zonder het als correctie vast te
   leggen.** Het model hiervoor is al in deze codebase aanwezig en wordt bewust niet
   overschreven: `rule-audit.md` §5 documenteert dat `WEEKLY_REST_72H_PER_14D` artikel 100
   noemt terwijl het getal (72 uur) alleen in artikel 99 is teruggevonden — en legt expliciet
   uit waarom dit *niet* is "gecorrigeerd": *"Zonder dat door een bevoegde lezer te laten
   bevestigen, zou een eigenhandige 'correctie' van het artikelnummer precies het soort
   ongefundeerde aanname zijn die deze hele auditronde probeert te voorkomen. Vandaar:
   gedocumenteerd als open vraag, niet als (mogelijk verkeerd geraden) fix"*
   (`rule-audit.md:225-229`), vastgelegd met de eigen statuswaarde
   `SOURCE_REFERENCE_REVIEW_REQUIRED`. Een toekomstige migratie die `conflictsWith` of een
   consistency-checker zou vullen, moet ditzelfde patroon volgen: een discrepantie wordt een
   zichtbaar record met een eigen review-status, nooit een stille waardewijziging.
4. **Nooit migreren vóórdat de BEFORE-benchmark bestaat.** §33/§34 van de opdracht eist een
   bevroren voor-meting vóór elke inhoudelijke wijziging. De actuele status van deze repo,
   vastgelegd in `current-state.md` ("Wat blijft LOCAL REQUIRED", regels 86-97): er is geen
   Ollama/qwen3:8b bereikbaar in deze cloud-omgeving (`which ollama` → leeg), dus Fase 1
   (immutable BEFORE-benchmark) is `LOCAL REQUIRED` en moet door de gebruiker zelf worden
   gedraaid via `run-before-local.ps1` op de bevroren commit `588c1e5`. Dat script draait
   pas als Ollama lokaal bereikbaar is en schrijft een `BEFORE-VERIFICATION.json` die pas
   daarna teruggestuurd wordt naar deze sessie. Een letterlijke gate-constante of -string
   met de naam `WAITING_FOR_LOCAL_BEFORE` is in deze repository **niet aangetroffen** (grep
   over de volledige checkout, buiten `node_modules`, levert geen treffers op) — dit rapport
   markeert dat expliciet als **niet vastgesteld** in plaats van een naam te verzinnen. De
   feitelijke gate bestaat wél, alleen procedureel: zolang er geen
   `docs/lyra-knowledge/benchmarks/before/<run>/BEFORE-VERIFICATION.json` met
   `status: "PASS"` is aangeleverd, is er geen bevroren voor-meting, en blokkeert dat elke
   inhoudelijke migratiestap hieronder (§4c-g).

---

## 4. Volgorde van uitvoering, als/wanneer dit ooit gebeurt (nog steeds hypothetisch)

Deze volgorde beschrijft een toekomstig traject. Geen van de stappen hieronder is gezet.

1. **(a) BEFORE bevriezen.** `run-before-local.ps1` lokaal draaien tegen commit `588c1e5`
   met een bereikbaar Ollama/qwen3:8b, stub expliciet uitgeschakeld
   (`NS_AGENT_FORCE_STUB` niet gezet), minimaal 3 replicaten (§29/§41 van de opdracht) — de
   uitkomst is een `BEFORE-VERIFICATION.json` met `status: "PASS"`. Zonder deze stap mag
   geen van de volgende stappen die de repository-inhoud raken worden gezet (§3, punt 4
   hierboven).
2. **(b) De twee optionele velden als no-op schemawijziging toevoegen.** `conflictsWith?`
   op `RuleDefinition` en `sourceExcerptHash?` op `RuleSource` toevoegen aan
   `ruleset/types.ts`, ongevuld (`undefined` voor elke bestaande regel). Omdat beide velden
   optioneel zijn en niets in de huidige codebase ze leest of schrijft — geverifieerd in §2.1
   hierboven dat ze nog niet bestaan, en in `knowledge-model.md` §4 bevestigd dat
   `canonical-status.ts`'s projectiefuncties "niets toe[voegen] aan `RuleDefinition`,
   `operational-requirements.ts` of `AgentMemoryItem` zelf — het leest ze alleen"
   (`knowledge-model.md:124-125`) — kan deze stap op zichzelf geen bestaand gedrag
   veranderen. Dit zou na (a) maar vóór enige inhoudelijke vulling mogen, als een apart,
   geïsoleerd te beoordelen commit.
3. **(c) `conflictsWith` backfillen voor de reeds gedocumenteerde conflicten.** Een
   data-invoerstap (geen codewijziging): voor de conflicten die `conflict-report.md` al
   concreet benoemt met regel-id's (bijv. conflict #4, de drie plekken met het getal 46 uur:
   `RULE.NIGHT_SEQUENCE_RECOVERY` in `cao-ns-2024-2025.ts:546-556`,
   `docs/human-roster-benchmark/human-roster-design-principles.md:26`, en
   `quality-model.ts:248-266`) zou `conflictsWith` de betrokken regel-id's kunnen noemen.
   **Uitdrukkelijk pas na menselijke review**, conform §50 van de opdracht: een
   geëxtraheerde of afgeleide regel wordt niet automatisch `ACTIVE HARD` — het invullen van
   `conflictsWith` is zelf een claim over de inhoud van het regelbestand en vereist dezelfde
   voorzichtigheid als elke andere contentwijziging, dus mens-in-de-lus-goedkeuring per
   ingevoerd conflict, niet een geautomatiseerde bulk-vulling.
4. **(d) De consistency-checker bouwen** (opdracht §47) — leest `canonical-status.ts`'s
   projecties plus het (dan gevulde) `conflictsWith`-veld, en rapporteert drift tussen
   componenten. Nog te ontwerpen in detail; `conflict-report.md`s tien items zijn het
   testmateriaal waartegen deze checker zou moeten worden gevalideerd.
5. **(e) De Knowledge-UI bouwen** (opdracht §32) — een scherm bovenop de projectielaag en de
   consistency-checker, geen apart dataopslagsysteem.
6. **(f) De AFTER-benchmark draaien** — hetzelfde `run-before-local.ps1`-harnas (of een
   AFTER-variant ervan), tegen de dan-nieuwe code, met dezelfde golden suite en hetzelfde
   aantal replicaten als de BEFORE-meting, zodat de vergelijking eerlijk is.
7. **(g) BEFORE en AFTER vergelijken** — itemniveau (welke golden-suite-items veranderden
   van uitkomst), niet alleen het totaalpercentage, conform hoe `run-before-local.ps1` nu al
   `itemAgreementRate` en instabiele items apart rapporteert.

Geen van deze zeven stappen is in deze ronde gezet. Stap (a) is op dit moment de enige
blokkerende stap: zonder haar mogen (c) t/m (g) niet beginnen, en zelfs (b) — hoewel een
no-op — zou pas na (a) als afzonderlijke, apart beoordeelbare wijziging worden voorgesteld,
puur om nooit twee soorten wijzigingen (schema-no-op en eerste contentvulling) in één
niet-uit-elkaar-te-trekken commit te laten samenvallen.

---

## 5. Wat dit rapport NIET is

Dit is geen verslag van een uitgevoerde migratie en geen claim dat er in deze ronde iets aan
de kennisbank is veranderd. **Er is in deze ronde niets gemigreerd. Dit document beschrijft
een plan, geen uitvoering.** `RuleStatus`, de ad-hoc operational-requirements-string en
`MemoryStatus` bestaan vandaag onveranderd naast elkaar, precies zoals vastgesteld in
`inventory-rules-and-sources.md` §2-3 en `conflict-report.md` §1. `canonical-status.ts` is
en blijft, tot iemand anders besluit het aan te sluiten, dode code in de zin dat niets hem
aanroept — additieve, geteste, maar ongebruikte infrastructuur. De twee optionele velden uit
§2.1 hierboven staan nog nergens in `ruleset/types.ts`. Er is geen BEFORE-benchmark
bevroren in deze checkout. Elke volgende stap uit §4 vereist een aparte, expliciete
beslissing — geen enkele ervan volgt automatisch uit het bestaan van dit rapport.
