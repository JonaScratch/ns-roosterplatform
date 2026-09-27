# Inventaris: leergeheugen, grondingscontrole en toollaag

Doel van dit document: vaststellen wat er al bestaat aan geheugen-, grondings-
en toolinfrastructuur, vóórdat een nieuwe "claim verification"-laag of een
nieuwe kennisretrieval wordt gebouwd. Uitgangspunt: niets bouwen wat al
bestaat. Alles hieronder is nagelezen in de code op de datum van dit
onderzoek (27-09-2026); waar iets niet is vastgesteld, staat dat er expliciet
bij.

---

## 1. Het leergeheugen (vier lagen)

**Bestanden:**
- `src/server/agent/memory.ts` (287 regels) — voorstellen, goedkeuren,
  intrekken, corrigeren, toepassingen loggen.
- `src/server/agent/promotion.ts` (149 regels) — promotie van lokaal naar
  NS-breed.
- `prisma/schema.prisma:1892-1990` — de datamodellen `AgentMemoryItem` en
  `AgentMemoryApplication`, plus de enums `MemoryScope`, `MemoryStatus`,
  `MemoryKind`.
- UI: `src/app/(app)/roostercommissie/agent/geheugenpaneel.tsx`.
- Regressietoets (los script, geen vitest): `scripts/verify-geheugen.ts`.
- Vitest-toets van de presentatielaag: `tests/agent/leergeheugen.test.ts`.

**De vier lagen** (`prisma/schema.prisma:1895-1904`, enum `MemoryScope`):
`PROJECT`, `LOCATION`, `NATIONAL`, `TECHNICAL`. Ze staan expliciet "náást
elkaar en niet in elkaar" (`memory.ts:11-17`).

**Velden van een geheugenitem** (`AgentMemoryItem`, `memory.ts:39-56` en
`schema.prisma:1935-1975`):

| Concept uit de opdracht | Bestaat het? | Onder welke naam |
|---|---|---|
| positief/negatief | **Niet als apart veld.** Polariteit zit alleen impliciet in de vrije tekst van `statement` (bijv. "liever niet"). Er is geen `polarity`/`sentiment`-veld. |
| scope | Ja | `scope: MemoryScope` (PROJECT/LOCATION/NATIONAL/TECHNICAL) |
| bron/herkomst | Ja | `proposedByAgent: boolean`, `proposedByUserId`, `approvedByUserId` |
| actor | Ja | `proposedByUserId` / `approvedByUserId` (verwijzing naar `UserAccount`, niet naar een los "actor"-blob) |
| datum | Ja | `createdAt`, `approvedAt`, `withdrawnAt`, `updatedAt` |
| context | Ja | `locationCode`, `dutyPackageId`, `rosterPeriodId`, plus het afgeleide veld `contextStillCurrent` in `recall()` (`memory.ts:54-56, 130-135`) |
| kandidaat/bewijs | Ja | `evidence: Json?` (vrije vorm; bij promotie gevuld met bron-items, `promotion.ts:106-110`) |
| uitleg | Ja | `rationale: String?` |
| goedkeuringsstatus | Ja | `status: MemoryStatus` (`PROPOSED`→`APPROVED`/`REJECTED`), plus `rejectedReason` |
| ingetrokken | Ja | `status: WITHDRAWN`, met `withdrawnAt` en `withdrawnReason` — het item blijft leesbaar, wordt niet verwijderd (`memory.ts:202-214`) |
| tegenspraak/contradictie | **Niet gevonden.** Zie hieronder. |
| optimalisatiedoel | Ja, apart veld `optimisationGoal: String?` — expliciet door een mens gezet, nooit door de agent afgeleid (`schema.prisma:1951-1954`) |
| toepassingsteller | Ja | apart model `AgentMemoryApplication`, geteld via `_count.applications` in `recall()` (`memory.ts:100, 130`) |

**Conflictdetectie tussen items:** niet gevonden. `proposeMemory()`
(`memory.ts:139-175`) voegt een nieuw item toe zonder te controleren of er al
een tegenstrijdig item bestaat binnen dezelfde scope/locatie. De enige vorm
van "conflict" die het systeem kent is `correctMemory()` (`memory.ts:223-268`),
en die werkt alleen als een mens expliciet hetzelfde `itemId` corrigeert — het
oude item wordt dan `SUPERSEDED`. Twee onafhankelijk voorgestelde items die
elkaar tegenspreken (bijv. "Dordrecht: liefst vijf nachten aaneen" naast een
later, ongerelateerd voorstel "Dordrecht: liefst korte nachtreeksen") worden
**niet** gemeld, gedetecteerd of naast elkaar gelegd. Ook `recall()` doet geen
semantische vergelijking, alleen een trefwoordfilter (`memory.ts:104-115`).
`scripts/verify-geheugen.ts` TEST 10 test wél dat een *andere standplaats*
(Rotterdam) een tegengestelde voorkeur mag hebben zonder dat die de
Dordrechtse overschrijft — maar dat is scope-isolatie, geen
contradictie-detectie binnen één scope.

**Dordrecht → NS-breed, kan dat stilzwijgend?** Nee, en dat is goed geborgd:

- `promotion.ts:42-75` (`promotieKandidaten`) merkt alleen iets op als
  **twee of meer** locaties een `APPROVED` item hebben met **hetzelfde,
  door een mens gezette** `optimisationGoal`. Nadrukkelijk *niet* op
  tekstgelijkenis (`promotion.ts:18-25`: "Twee zinnen die op elkaar lijken,
  betekenen niet hetzelfde").
- `stelLandelijkVoor()` (`promotion.ts:84-126`) zet een NS-breed item altijd
  als `status: "PROPOSED"` — nooit direct `APPROVED` — en vereist de
  bevoegdheid `PREFERENCE_PROPOSE`, die expliciet *niet* in de standaard
  niveaus A/B/C zit (bevestigd in `scripts/verify-geheugen.ts` TEST 11, regel
  257-261: "voorkeuren voorstellen is een aparte bevoegdheid... zit niet in
  niveau C").
- `recall()` en `geldendeGeheugenDoelen()` (`promotion.ts:135-148`) filteren
  altijd op `status: "APPROVED"`: een NS-breed voorstel dat nog niet is
  goedgekeurd door een mens telt nergens mee (TEST 12 in
  `scripts/verify-geheugen.ts`, regel 138-156 en 286-304 — expliciet twee keer
  getest: vóór en na goedkeuring).

**Status:** gedeeltelijk. De vier lagen, herkomst, intrekking en de
mens-in-de-lus voor NS-breed zijn stevig gebouwd en met een regressietoets
gedekt (`scripts/verify-geheugen.ts`, 8 scenario's: TEST 8, 9, 10, 11, 12, 13,
21, 25). Wel ontbreekt: (a) een polariteit/sentiment-veld op het item zelf,
en (b) elke vorm van automatische contradictiedetectie tussen twee
onafhankelijke, niet-gekoppelde items. Wie een "claim verification"-laag
bouwt die conflicten tussen geheugenitems moet zien, vindt hier geen
bestaande bouwsteen en moet die zelf toevoegen — maar dan wél bovenop dit
model, niet ernaast.

Kanttekening bij de regressiedekking: `scripts/verify-geheugen.ts` is geen
vitest-test maar een los script (`npm run verify:geheugen`) dat een echte
database en een actief `ROSTER_COMMITTEE`-account nodig heeft. Het draait
niet mee in `npm test` (dat is puur `vitest run`) en er is geen CI-workflow
gevonden (`.github/` bestaat niet in deze checkout) die het aanroept. De
dekking bestaat dus, maar is niet geautomatiseerd in de gebruikelijke
testrun.

---

## 2. Grondingscontrole / claim-verificatie

**Bestand:** `src/server/agent/grounding.ts` (143 regels), aangeroepen vanuit
`src/server/agent/agent.ts:250-315` (de vaste keten, buiten elke modeladapter
om — zie hieronder).

**Wat het controleert:** drie patronen, letterlijk in de antwoordtekst
gezocht (`grounding.ts:48-58`):
1. `regelidentificatie` — `[A-Z][A-Z0-9]+(_[A-Z0-9]+){1,5}` (regel-ID's zoals
   `RP_DAILY_REST_PLANNED`).
2. `dienstnummer` — drie cijfers.
3. `roostercode` — `[A-Z]{3}-[A-Z0-9]{1,4}` (met randvoorwaarden om
   "CAO-NS-2024-2025" niet als roostercode te lezen, `grounding.ts:54-57`).

Elke match wordt vergeleken met `gegevensTekst()` — de platte tekst van alle
toolresultaten, aangeroepen tools en bronnen (`grounding.ts:114-116`). Staat
de match daar niet in, dan is het "ongegrond".

**EXISTS_BUT_NOT_RETRIEVED vs FABRICATED:** ja, expliciet onderscheiden via
het veld `bestaatWel: boolean` op `Ongegrond` (`grounding.ts:33-46`).
`bestaatWel` wordt bepaald door de match op te zoeken in `BESTAANDE_REGELS`,
de complete set regel-ID's uit het regelbestand (`grounding.ts:83`,
`Object.values(RULE)`). Beide takken hebben een eigen, verschillende
gebruikersmelding in `grondingsMelding()` (`grounding.ts:125-143`): een
verzonnen ID heet "niet terug te vinden", een bestaand-maar-niet-opgezocht ID
heet "bestaat wel, maar is niet opgezocht ... mag ik niet uit mijn hoofd
citeren". Dit onderscheid is met een regressietoets gedekt in
`scripts/verify-agent.ts:639-654` — met de letterlijke tekst uit de
historische rooktest van qwen3:8b (`RESERVE_BASE_WITHOUT_DUTIES`, inclusief
het woord "bevestigd" in de testinvoer, zie hieronder).

**Onbevestigde autoriteitsclaims** ("bevestigd", "formeel", "CAO", "NS",
"verplicht", "officieel" zonder onderliggende metadata): **niet gevonden**.
`grounding.ts` matcht alleen op de drie identificatiepatronen hierboven: het
kijkt niet naar los tekstuele autoriteitswoorden. Sterker nog, de bestaande
regressietoets bevat een testzin die het woord "bevestigd" letterlijk
gebruikt (`scripts/verify-agent.ts:640`: *"...artikel 'Reserverooster',
bevestigd"*) en de toets controleert alleen of het regel-ID wordt
tegengehouden als "niet-opgezocht" — niet of het woord "bevestigd" zelf een
constatering vergt. Er bestaat wel een **losstaand** signaal met een andere
scope: `ruleLookup`/`ruleSearch` in `tools.ts:262-268, 361-368` geven altijd
een `legalStatus`/`verified`-veld en de tekstuele status uit
`STATUS_TEKST` (`knowledge.ts:259-267`, bijv. `VALIDATED: "door NS
bevestigd"` tegenover `SOURCE_TRANSCRIBED: "letterlijk overgenomen ... niet
formeel bevestigd"`). Dat geeft de *tool* een eerlijke, gegradeerde
autoriteitsstatus mee — maar er is geen controle die verifieert dat de
**modeltekst** die status ook overneemt in plaats van er zelf "bevestigd" of
"officieel" van te maken zonder die tool geraadpleegd te hebben. Dit is dus
een reëel gat: een taalmodel dat "dit is CAO-verplicht" schrijft zonder een
tool met `legalStatus: VALIDATED` te hebben aangeroepen, wordt door de
huidige grendel niet tegengehouden, tenzij het toevallig ook een
regel-ID/dienstnummer/roostercode noemt dat niet in de gegevens voorkomt.

**Feitelijke bewering zonder bron (breder dan de drie patronen):** wel
gedekt, maar via een aparte, aanvullende controle in `agent.ts:281-289`: een
antwoord met `status: "BEANTWOORD"` waarbij **geen enkele** toolaanroep is
gelukt (`gelukt.length === 0`) wordt hoe dan ook tegengehouden en omgezet
naar `NIET_VAST_TE_STELLEN`, met een eigen melding. Dit ving expliciet het
geval uit fase 9 waarin het model een feit uit een vorige beurt herhaalde
zonder nieuwe toolaanroep (`agent.ts:264-280`).

**Instemmen met een feitelijk onjuiste aanname van de gebruiker:** geen
runtime-grendel gevonden in `grounding.ts` of `agent.ts`. Wél bestaat er een
**meetdimensie** met precies die naam,
`falsePremiseCorrection`/`behaviour: "correct_false_premise"`, maar die zit
uitsluitend in de Demo Room-benchmarklaag
(`demo-room/src/benchmark/agentQuality.ts:192-195`), en die dimensie steunt
op een **handmatig of extern gegradeerd** `graded: "GOED"/"FOUT"`-veld per
benchmarkitem, niet op een automatische detector die de agent-tekst zelf
analyseert. Er is dus wel een benchmarkmetriek voor dit gedrag, maar geen
runtime-check die het tegenhoudt vóórdat het antwoord de gebruiker bereikt.
Ook de enige geautomatiseerde tekstheuristiek in die laag —
`causalClaimBreakdown` met de regex `CAUSALE_CLAIM_ZONDER_BRON`
(`agentQuality.ts:141, 209-212`) — is uitdrukkelijk gedocumenteerd als "een
eigen, kleinere heuristiek: dit vervangt de hoofdapp-grondingscontrole niet"
(`agentQuality.ts:202-208`). Het is dus een Demo Room-eigen signaal, geen
onderdeel van de productiegrendel in `src/server/agent/grounding.ts`.

**Waar de grendel in de keten zit:** buiten elke modeladapter, in
`agent.ts:250-315`, na `model.compose()` en vóór het antwoord wordt
opgeslagen/getoond. Dat betekent: de grendel geldt identiek voor `stubModel`
én `localModel` — een nieuw model dat later onder de agent wordt gehangen
gaat automatisch door dezelfde poort (expliciet zo bedoeld, `grounding.ts:14-16`).

**Status:** gedeeltelijk. Regel-ID/dienstnummer/roostercode-fabricatie mét
het EXISTS_BUT_NOT_RETRIEVED-onderscheid: opgelost met regressietest
(`scripts/verify-agent.ts:626-682`, wederom geen vitest maar een los,
DB-afhankelijk script zonder CI-koppeling). Onbevestigde autoriteitstaal
("bevestigd", "formeel", "CAO", "verplicht", "officieel" zonder
brongegevens) en het corrigeren van een foutieve aanname van de gebruiker:
nog open — er bestaat geen automatische runtime-detector voor beide, alleen
(voor het laatste) een benchmarkmetriek die op handmatige/externe grading
leunt.

---

## 3. Toolcontract / toolschema

**Bestand:** `src/server/agent/tools.ts` (592 regels), gedeeld type-contract
in `src/server/agent/model/types.ts` (167 regels).

**Aantal tools:** 12, in `AGENT_TOOLS` (`tools.ts:524`): `rosterProject`,
`rosterLine`, `dutyInstance`, `dutyKindCounts`, `dutyKindPerLine`,
`rosterHours`, `ruleLookup`, `ruleSearch`, `qualityReport`, `nightStructure`,
`knowledgeSearch`, `experimentHistory`.

**Vorm van een toolresultaat:** `ToolResult<T> = { data: T; sources:
readonly string[] }` (`tools.ts:62-66`). Elke tool levert dus altijd expliciet
zijn bronvermelding mee, naast de data.

**Zelfbeschrijvend scope/eenheid — bestaat dit, en consequent?** Ja, en dit is
precies de historisch gevonden fix. Voorbeelden, met bronregel:

- `dutyKindCounts` (`tools.ts:171-215`): geeft altijd een `note`-veld mee dat
  expliciet zegt of het gefilterd is (`"Gefilterd op kind=..."`) of niet
  (`"Geen 'kind' opgegeven: dit is het totaal van ALLE diensten... niet
  gefilterd..."`, `tools.ts:207-210`). Dit is letterlijk de fix voor de
  historische bug uit de N0-meting van v1.0.6 ("kind=ALL, count=44, note=...
  vs een kaal getal" uit de opdracht) — de code-commentaar noemt die meting
  met naam (`tools.ts:202-206`).
- `rosterHours` (`tools.ts:217-239`): geeft de norm mee als tekst
  (`"40:00 gemiddeld per basisrooster (USER_PROVIDED_OPERATIONAL_DESIGN_REQUIREMENT)"`,
  `tools.ts:235`) plus een `withinLimit`-boolean per rooster.
- `ruleLookup`/`ruleSearch` (`tools.ts:241-271, 345-370`): geven altijd
  `legalStatus`/`verified`/`statusText` mee, met een expliciete waarschuwing
  ("Een regel zonder bevestigde bron wordt als onbevestigd gepresenteerd",
  `tools.ts:267`; "Een waarde zonder bevestigde status is geen juridisch
  oordeel", `tools.ts:365`).
- `knowledgeSearch` (`tools.ts:443-486`): geeft per item `status`, `origin`
  ("voorgesteld door de agent" vs "van een mens") en `contextStillCurrent`
  mee, plus een note dat alleen goedgekeurde items meetellen.

Dit is dus geen losse uitzondering maar een consistente conventie over
(bijna) alle tools: data komt nooit als kaal getal, altijd met een
scope-/statusaanduiding erbij.

**Verplichte velden, afgeleid en niet met de hand bijgehouden:**
`verplichteVelden()` (`tools.ts:543-549`) leidt de lijst af uit het
Zod-schema van elke tool (`safeParse(undefined)`), en `toolCatalogue()`
(`tools.ts:551-559`) zet die lijst bij elke tool. Dit is expliciet de fix voor
de bug uit lokaal-4 waarbij het model `dutyInstance` zonder dienstnummer
aanriep (`tools.ts:533-537`) — gedekt door een regressietoets in
`scripts/verify-agent.ts:608-619` (TOOLCATALOGUS).

**Candidate-label/context-resolver — hoeft het model nooit een intern
database-ID te gokken?** Ja. `src/server/agent/context.ts:67-109`
(`vindKandidaatOpNaam`) zoekt een kandidaat op een mensentaal-verwijzing
("kandidaat 2", "de tweede kandidaat") op rangnummer in `scenarioLabel`, niet
op een geraden ID. Het model levert `candidateLabel` (vrije tekst), de server
zoekt het echte `candidateId` erbij op (`context.ts:33-42, 119-131`); vindt de
server niets, dan komt dat terug via `missing` — geen gok, geen wedervraag op
dit niveau (`context.ts:39-40`). Dit is expliciet de fix voor de bug uit de
N0-meting waarbij "en hoe zit dat in kandidaat 2?" geen enkele toolaanroep
opleverde (`context.ts:71-78`). `local.ts:220-224` instrueert het echte model
expliciet om dit veld te gebruiken in plaats van een ID te verzinnen.

**Toolaanroep-flow:** `callTool()` (`tools.ts:566-591`) controleert rechten,
valideert invoer met Zod, voert uit, en legt altijd een auditregel vast
(zowel bij weigering, ongeldige invoer, fout als succes). Een geweigerde tool
is een antwoord, geen exceptie — de agent kan uitleggen wát niet mocht
(`tools.ts:561-565`).

**Status:** opgelost met regressietest. De self-describing scope/units, de
afgeleide verplichte-veldenlijst en de candidate-label-resolver zijn alle
drie met naam gedekt in `scripts/verify-agent.ts` (respectievelijk impliciet
via het GRONDING/toolresultaten-blok, het TOOLCATALOGUS-blok
regels 608-619, en via de kandidaat-scenario's — niet expliciet nagelopen in
dit onderzoek onder dat scriptnummer, dus voor dat laatste specifieke stuk:
**niet volledig vastgesteld** of er ook een letterlijke regressietoets voor
`vindKandidaatOpNaam` zelf bestaat naast de aanwezigheid in de
systeeminstructie).

---

## 4. RET/rangeer-domeinwoordenboek: stub en echt model, één bron?

**Bestand:** `src/server/agent/vocabulary.ts` (135 regels) — het
canonieke domeinwoordenboek `VAKWOORDEN`, met per begrip: `termen`,
`betekenis`, `bron` (`GEBRUIKER`/`GEGEVENS`), `herkomst`, en `verwijst` (naar
een dienstsoort, roosterprofiel, positie of uitleg). RET staat hierin als
eerste item (`vocabulary.ts:46-54`): rangeerdienst, dienstnummers 701-761 in
het Dordrechtse pakket, bron `GEBRUIKER` ("opgegeven door Jonathan, 21
september 2026").

**Wordt dit door beide routes gebruikt?** Ja, bevestigd op codeniveau:
- `src/server/agent/model/stub.ts:8` importeert `begripIn` uit
  `../vocabulary`, gebruikt op regel 321.
- `src/server/agent/model/local.ts:6` importeert `begrippenIn` uit
  `../vocabulary`, gebruikt in `domeinwoordenboek()` (`local.ts:146-161`),
  die de gevonden begrippen in de systeeminstructie van het échte model zet
  — inclusief een expliciete tool-hint ("Gebruik kind=RANGEER bij
  dutyKindCounts of dutyKindPerLine", `local.ts:157`).

De code-commentaar in `local.ts:126-145` documenteert de historische bug met
naam: *"`vocabulary.ts` kent RET als rangeerdienst sinds de beslissing van 21
september 2026. De stub gebruikt dat woordenboek al die tijd al
(`begripIn()` in `model/stub.ts`). Het lokale model kreeg het nooit te zien
— geen enkele regel in deze systeeminstructie verwees ernaar."* — en meldt
dat dit bij de N0-meting van v1.0.6 aan het licht kwam (alle zeven
RET-vragen liepen via `ruleSearch` met de letterlijke term "RET" en vonden
niets).

**Is dit vandaag opgelost?** Op codeniveau ja — één bestand, twee importeurs,
geen tweede/parallelle woordenlijst gevonden (`grep -rn "VAKWOORDEN"` levert
alleen `vocabulary.ts` zelf op als definitie).

**Regressietoets:** `tests/agent/roosteragent.test.ts:96-104` test RET, maar
uitsluitend tegen `stubModel` ("behandelt RET als rangeerdienst en zoekt het
uit"). Er is **geen** test gevonden die de systeeminstructie of
`domeinwoordenboek()`-functie van `local.ts` zelf oproept en controleert dat
"RET" daadwerkelijk in de prompt van het échte model terechtkomt — geen
losse unit-test voor `domeinwoordenboek()`, en de enige scripts die
`model/local.ts` importeren (`scripts/v105/lokaal-rooktest.ts`,
`scripts/v105/lokaal-plan.ts`, `scripts/v106/golden-bench.ts`) zijn
eenmalige benchmarkscripts die een echte, bereikbare Ollama-server nodig
hebben en niet in `npm test` draaien. `scripts/verify-agent.ts`, dat wél
losstaand als regressietoets bedoeld is, zet expliciet
`NS_AGENT_FORCE_STUB=1` (regel 5) en test dus per definitie nooit de
lokale-modelroute.

**Status:** gedeeltelijk. De bug is op broncode-niveau structureel
onmogelijk gemaakt (één woordenboek, geen duplicaat), maar er is geen
geautomatiseerde regressietoets die specifiek verifieert dat de
lokale-modelroute (`local.ts`) het woordenboek ook werkelijk in zijn
systeeminstructie krijgt — alleen de stub-route is met een test gedekt. Een
toekomstige wijziging die `domeinwoordenboek()` per ongeluk breekt of
verwijdert uit `systeeminstructie()`, zou door geen enkele vitest-run worden
opgemerkt.

---

## 5. JSON-parsing robuustheid (dubbele JSON-objecten)

**Bestand:** `src/server/agent/model/local.ts:294-355`, functie `jsonUit()`.

**Het probleem, gedocumenteerd in de code** (`local.ts:305-312`): qwen3
leverde het plan soms als twee JSON-objecten achter elkaar (het
intentie-object, en na een komma een object met alleen `proposal`). Beide
op zichzelf geldig JSON. De oude lezing pakte alles van de eerste `{` tot de
laatste `}` en probeerde dat als één object te lezen, wat faalde.

**De huidige oplossing:** een expliciete depth-tellende scanner
(`local.ts:313-343`) die:
- string-inhoud correct overslaat (met escape-afhandeling, `inTekst`/
  `ontsnapt`, regels 320-325), zodat een `{` of `}` binnen een string niet
  meetelt voor de diepte;
- elk volledig, op zichzelf staand top-level object apart parseert met
  `JSON.parse` en negeert wat niet leesbaar is (regel 333-338);
- de gevonden objecten samenvoegt, waarbij een later object een leeg/`null`
  veld van een eerder object aanvult maar een al gevuld veld niet
  overschrijft (regel 344-353).

**Regressietoets:** **niet gevonden.** `grep -rn "jsonUit"` over de hele
repository (buiten `local.ts` zelf) levert niets op — geen vitest-test, geen
los verify-script roept deze functie met een crafted string ("twee
JSON-objecten achter elkaar") aan. De enige plekken die `model/local.ts`
importeren zijn de eenmalige, Ollama-afhankelijke benchmarkscripts
(`scripts/v105/*`, `scripts/v106/golden-bench.ts`) en `scripts/verify-agent.ts`
dwingt juist de stub af (`NS_AGENT_FORCE_STUB=1`), die deze functie nooit
aanroept (de stub genereert geen ruwe modeltekst om te parsen).

**Status: nog open.** De fix zelf is aanwezig en inhoudelijk overtuigend
(afhandeling van strings/escapes, samenvoegen in plaats van verwerpen), maar
er is geen enkele geautomatiseerde regressietest die het exacte historische
scenario (twee aaneengesloten JSON-objecten, met een komma ertussen, zoals
letterlijk beschreven in het codecommentaar) herhaalt. Dit is een pure
functie (`tekst: string → Record<string, unknown> | null`) zonder externe
afhankelijkheden — een unit-test zou triviaal te schrijven zijn en zou nul
DB- of netwerktoegang nodig hebben. Dit is de duidelijkste "snel te dichten"
regressie-hiaat uit deze inventarisatie.

---

## 6. Stub vs. echt lokaal model: is de routing uniform?

**Bestanden:** `src/server/agent/model/types.ts` (het gedeelde `ChatModel`-
contract), `src/server/agent/model/stub.ts` (839 regels),
`src/server/agent/model/local.ts` (598 regels), routing in
`src/server/agent/agent.ts:46-55` (`modelForRequest`).

**Architectuur:** beide modellen implementeren exact hetzelfde
`ChatModel`-interface (`plan()` + `compose()`, `model/types.ts:160-166`).
Alles wat níet modelspecifiek is — toolcontrole, rechten, grondingscontrole,
geheugen-ophaal, project-doelen, sessieopslag, auditlog — zit in `agent.ts`
en wordt voor beide modellen identiek doorlopen (`agent.ts:69-350`). Dat is
een sterk architectuurkenmerk: een grendel of toolregel die eenmaal in
`agent.ts` of `tools.ts` staat, geldt automatisch voor elk model dat later
onder `ChatModel` wordt gehangen (expliciet zo verwoord in
`grounding.ts:14-16` en `model/types.ts:6-11`).

**Eén concreet, geverifieerd stub-only gat: `memoryProposal` /
FEEDBACK-intentie.** De agent kan een uitgesproken voorkeur ("we willen
liever...", "onthoud dat...") aanbieden om vast te leggen in het
leergeheugen, via het veld `memoryProposal` op `AgentPlan`
(`model/types.ts:96-103`). Dit is **alleen geïmplementeerd in de stub**:

- `stub.ts:381-397`: patroonherkenning op vaste Nederlandse frasen
  ("we willen liever", "onthoud dat", ...) die, als er geen vraagteken in de
  tekst staat en de bevoegdheid `agent:memory:write` aanwezig is, een
  `memoryProposal`-object teruggeeft met `scope`, `kind`, `statement` en
  `locationCode`.
- `stub.ts:561-568` (in `compose()`): als `plan.memoryProposal` bestaat, komt
  het door naar `data.memoryProposal` in het antwoord.
- `local.ts`: **`memoryProposal` komt in geen enkele vorm voor** (geverifieerd
  met `grep -n "memoryProposal" local.ts` → geen treffers). De
  `planInstructie()` die het échte model instrueert (`local.ts:252-274`)
  vraagt uitsluitend om de velden `intent`, `toolCalls`, `clarification`,
  `cannotDetermine`, `refusal`, `reasoning` en (voor rekenverzoeken)
  `proposal` — nergens wordt het model verteld dát er een `memoryProposal`-
  veld bestaat of welke vorm het moet hebben. En zelfs als qwen3 uit
  zichzelf een `memoryProposal`-sleutel in zijn JSON zou zetten, wordt die
  niet overgenomen: de object-literal die `plan()` teruggeeft
  (`local.ts:496-508`) bevat geen `memoryProposal`-regel, dus het veld wordt
  stil weggelaten, in tegenstelling tot `proposal`, dat wél expliciet via
  `voorstelUit(plan.proposal ?? uitDeToelichting(plan), request)` wordt
  doorgezet (`local.ts:503`).
- `AgentIntent` bevat wel de waarde `"FEEDBACK"` (`model/types.ts:71`) en die
  staat ook in de JSON-schema-instructie van `local.ts:255` als toegestane
  intentie-waarde — het model mág dus `"intent":"FEEDBACK"` teruggeven, maar
  zonder een bijbehorend `memoryProposal`-object gebeurt er vervolgens niets:
  er is geen tool en geen automatische afleiding die van een kale
  FEEDBACK-intentie alsnog een voorstel maakt.

Dit is structureel dezelfde soort bug als de historische RET-bug (77f37f8):
een mogelijkheid die in de stub is gebouwd en getest, maar waarvan de
systeeminstructie/nabewerking van de echte-modelroute nooit is bijgewerkt om
hem te ondersteunen. Net als bij RET destijds, is er geen test die dit
zichtbaar maakt, omdat `tests/agent/leergeheugen.test.ts` uitsluitend
`stubModel` aanroept (regel 2, 24, 30, 41 e.v.) en `scripts/verify-geheugen.ts`
weliswaar via `askAgent()` gaat maar met `NS_AGENT_FORCE_STUB=1` (regel 5).

**Overige verschillen tussen stub en lokaal, ter volledigheid:**
- `DATA_SLEUTEL` (`model/types.ts:145-158`) normaliseert de veldnaam waaronder
  toolresultaten in het antwoord terechtkomen, ongeacht het model — dit werd
  juist wél gefixt na de N0-meting (code-commentaar `model/types.ts:136-144`)
  en geldt voor beide routes.
- `uitDeToelichting()` (`local.ts:392-415`) is een lokale-model-specifieke
  toegift: als het model een rekenverzoek wél in de toelichting noemt maar
  het `proposal`-veld leeg laat, wordt het er alsnog uit gehaald. De stub
  heeft dit probleem niet (die genereert het veld altijd correct), dus dit is
  geen gat maar een asymmetrische extra vangnet vóór de échte-modelroute.

**Status: nog open** voor het `memoryProposal`-gat. Dit is een verifieerbare,
user-facing functionaliteit (feedback vastleggen als geheugenvoorstel) die
vandaag alleen via de stub werkt en niet via de echte Ollama/qwen-route, en
er bestaat geen regressietest die dit zou opvangen als iemand de stub
zou uitschakelen.

---

## Samenvatting van de status per onderwerp

| # | Onderwerp | Status |
|---|---|---|
| 1 | Vier-lagen-geheugen, herkomst, intrekking, NS-breed-gate | gedeeltelijk (mens-in-de-lus stevig en getest; geen polariteitsveld, geen contradictiedetectie; test niet in CI) |
| 2 | Grondingscontrole (fabricatie vs. niet-opgezocht) | gedeeltelijk (identificatie-fabricatie opgelost met regressietest; autoriteitstaal en foutieve-aanname-correctie nog open) |
| 3 | Toolcontract (12 tools, self-describing, candidate-resolver) | opgelost met regressietest |
| 4 | RET/rangeer-woordenboek gedeeld tussen stub en echt model | gedeeltelijk (bug structureel gefixt; geen test die de lokale-modelroute zelf dekt) |
| 5 | JSON-parser voor dubbele modelobjecten | nog open (fix aanwezig, geen enkele regressietest) |
| 6 | Stub vs. echt model — functiepariteit | nog open (`memoryProposal`/FEEDBACK werkt alleen in de stub) |

## Belangrijkste aanbeveling voor de nieuwe architectuurronde

Bouw geen tweede grondings- of geheugensysteem. `grounding.ts` en
`memory.ts`/`promotion.ts` zijn de bestaande, centrale plekken en zitten al
buiten de modeladapters in de vaste keten (`agent.ts`) — een
claim-verificatielaag hoort daar bovenop of naast te worden gezet, met
dezelfde `ToolResult`-vorm (`data`+`sources`) als invoer, niet als
parallelle nieuwe retrieval. De twee concrete, met code-regelverwijzing
vastgestelde gaten die het meest direct om aandacht vragen zijn: (a) geen
enkele regressietest voor `jsonUit()` (§5), en (b) `memoryProposal` dat
alleen in de stub werkt (§6) — beide zijn met een gerichte, kleine wijziging
te dichten zonder iets bestaands te vervangen.
