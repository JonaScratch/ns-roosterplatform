# Canoniek kennisschema — ontwerp (Fase 3)

Status: **ONTWERP, NIET UITGEVOERD.** Dit document beschrijft hoe de drie bestaande, elkaar niet
kennende statusmodellen (vastgesteld in `inventory-rules-and-sources.md` §2-3) kunnen worden
verzoend zonder ze te vervangen. Er is in deze fase geen enkele regel/geheugenitem/operationele
eis verplaatst, hernoemd of gemuteerd — dat zou een inhoudelijke wijziging zijn, en die mag pas
ná de bevroren BEFORE-meting (§33/§34 van de opdracht).

---

## 0. Waarom geen nieuw schema

`inventory-rules-and-sources.md` §3 concludeerde: *"de kern (bron, laag, geldigheid,
validatiestatus, scope) is verrassend volwassen en al doordacht op precies de valkuilen die het
gevraagde schema wil vermijden."* `RuleDefinition`/`RuleSource` (`src/server/rules-engine/ruleset/types.ts`)
dekt vrijwel het hele gevraagde veldenlijstje uit de opdracht al, inclusief een bewust rijker
`effectiveTo`-alternatief (`contractualEnd` + `renewalRule`) — met code-commentaar dat uitlegt
*waarom* een eerder, simpeler `effectiveUntil`-veld is afgeschaft na een echte productie-onveilige
bug. Een nieuw schema vanaf nul zou die geschiedenis wegvegen.

**Ontwerpprincipe van dit document: toevoegen, niet vervangen.** Elke voorgestelde wijziging is
een nieuw, optioneel veld of een aparte, additieve projectielaag — nooit een breaking change aan
`RuleDefinition`, `operational-requirements.ts`, of `AgentMemoryItem`.

---

## 1. De drie bestaande modellen, naast elkaar

| | `RuleDefinition.status` (regelmotor) | `operational-requirements.ts` (productbeleid) | `AgentMemoryItem.status` (leergeheugen) |
|---|---|---|---|
| Bestand | `src/server/rules-engine/ruleset/types.ts` | `src/domain/operational-requirements.ts` | `prisma/schema.prisma` (`MemoryStatus`) |
| Type | `RuleStatus` (echt enum) | vrije string-constante | `MemoryStatus` (echt enum) |
| Waarden | `VALIDATED / SOURCE_TRANSCRIBED / UNVALIDATED_LOCAL_PARAMETER / NEEDS_POLICY_VALIDATION / POLICY_PENDING / UNRESOLVED / NOT_SUPPLIED` | `USER_PROVIDED_OPERATIONAL_DESIGN_REQUIREMENT` (één waarde, geen levenscyclus) | `PROPOSED / APPROVED / REJECTED / WITHDRAWN / SUPERSEDED` |
| Opvolging | `RuleSource.supersededBy` (documentniveau) | geen | `supersedes`/`supersededBy` (self-relation, itemniveau) |
| Scope | `RuleScope { employeeGroups, companies, locations }` | impliciet product-breed | `MemoryScope` (`PROJECT/LOCATION/NATIONAL/TECHNICAL`) |
| Wie kent wie | — | — | — |

Geen van de drie verwijst naar een van de andere twee. Een regel en een geheugenitem kunnen
elkaar tegenspreken zonder dat één systeem dat ziet.

---

## 2. De gevraagde categorie-as (opdracht §4) tegenover wat al bestaat

De opdracht vraagt een expliciet onderscheid tussen (verkort): `FORMAL_LAW`, `FORMAL_CAO`,
`FORMAL_NS_RULE`, `NS_OPERATIONAL_RULE`, `REGIONAL_RULE`, `DEPOT_RULE`, `CONTRACT_RULE`,
`PROFILE_BOUNDARY`, `USER_PROVIDED_OPERATIONAL_REQUIREMENT`, `MACHINIST_PREFERENCE`,
`HUMAN_DOMAIN_INPUT`, `ROSTER_COMMITTEE_PREFERENCE`, `INFERRED_FROM_HUMAN_ROSTERS`,
`OBSERVED_PATTERN`, `EXPERIMENTAL_HYPOTHESIS`, `IMPLEMENTATION_CONSTRAINT`, `PRODUCT_POLICY`,
`POTENTIAL_RULE`, `UNKNOWN_SOURCE`.

`RuleLayer` (9 waarden: `LAW_ATW, LAW_ATB, CAO, CAO_COMPANY, REGIONAL, LOCAL, INDIVIDUAL,
EMPLOYEE_CHOICE, PRODUCT_POLICY`) dekt de "formeel/regionaal/lokaal/product"-as al vrijwel
volledig — zie de mapping hieronder. Wat ontbreekt: een menselijke-voorkeur-as en een
afgeleid/experimenteel-as. Die bestaan vandaag informeel elders (`AgentMemoryItem.kind`,
`EngineExperiment` in de v1.0.5-doelarchitectuur, `AgentResearchLoop` in het Prisma-schema).

### Mappingtabel (voorstel, geen wijziging aan bestaande enums)

| Opdracht-categorie | Bestaande drager | Actie |
|---|---|---|
| `FORMAL_LAW` (ATW/ATB) | `RuleLayer.LAW_ATW` / `LAW_ATB` | bestaat al als laag, nog nooit bezet (0 regels — zie `knowledge-gap-report.md`) |
| `FORMAL_CAO` | `RuleLayer.CAO` | bestaat, 59 regels |
| `FORMAL_NS_RULE` | `RuleLayer.CAO_COMPANY` | bestaat als laag, nog nooit bezet |
| `NS_OPERATIONAL_RULE` | `RuleLayer.PRODUCT_POLICY` (deels) | bestaat, 7 regels — let op: dit zijn platform-eigen definities, niet per se "door NS bevestigd"; zie de nuance in `inventory-rules-and-sources.md` §7 slot |
| `REGIONAL_RULE` | `RuleLayer.REGIONAL` | bestaat, 5 regels |
| `DEPOT_RULE` | `RuleLayer.LOCAL` | bestaat als laag, nog nooit bezet |
| `CONTRACT_RULE` | `RuleLayer.INDIVIDUAL` / `EMPLOYEE_CHOICE` | bestaat als laag, nog nooit bezet |
| `PROFILE_BOUNDARY` | `src/domain/roster-profiles.ts` (hard, buiten de rules-engine) | **geen** rule-engine-laag — dit is een apart, hard-coded systeem; zie §3 hieronder |
| `USER_PROVIDED_OPERATIONAL_REQUIREMENT` | `operational-requirements.ts`'s eigen ad-hoc string | **geen `RuleLayer`-waarde** — zie §4 hieronder (dit is precies de bron van parallel-systeem #2) |
| `MACHINIST_PREFERENCE` | `AgentMemoryItem.kind` (geheugen) + los, hardcoded als `source`-string in `profile-affinity.ts`/`night-rhythm.ts`/etc. | **twee dragers die niet naar elkaar verwijzen** — een quality-model-constante met `source: "MACHINIST_PREFERENCE"` en een `AgentMemoryItem` met `kind: PREFERENCE` zijn vandaag ongerelateerde systemen |
| `HUMAN_DOMAIN_INPUT` | idem, plus `DAY_DUTY_WEIGHTS`-bronstrings | idem |
| `ROSTER_COMMITTEE_PREFERENCE` | `AgentMemoryItem` met `proposedByUserId`/`approvedByUserId` | bestaat, via herkomstvelden, geen apart label |
| `INFERRED_FROM_HUMAN_ROSTERS` | `docs/human-roster-benchmark/` (documentatieconventie "Waarneming"), geen code-type | **ontbreekt als type** — zie `human-pattern-audit.md` |
| `OBSERVED_PATTERN` | idem | idem |
| `EXPERIMENTAL_HYPOTHESIS` | `AgentResearchLoop`/`EngineExperiment` (los systeem, ronde-gebonden) | bestaat als apart concept, niet als kennis-item-status |
| `IMPLEMENTATION_CONSTRAINT` | geen eigen drager gevonden | `niet vastgesteld` |
| `PRODUCT_POLICY` | `RuleLayer.PRODUCT_POLICY` | bestaat |
| `POTENTIAL_RULE` | `RuleStatus` heeft geen letterlijke `POTENTIAL`-waarde, maar `SOURCE_TRANSCRIBED`/`UNVALIDATED_LOCAL_PARAMETER` dekken de functie; validatie-uitkomsten kennen wél `POTENTIAL_HARD_VIOLATION` | gedeeltelijke overlap, andere naamruimte (regelstatus vs. bevindingstatus) |
| `UNKNOWN_SOURCE` | `RuleStatus.NOT_SUPPLIED` | bestaat |

**Conclusie**: er hoeft geen enkele bestaande enum-waarde te worden hernoemd. Het echte gat is
uitsluitend de menselijke-voorkeur-as en de afgeleid/experimenteel-as — en zelfs die bestaan al
informeel, alleen niet als `RuleLayer`-lid.

---

## 3. Waarom `PROFILE_BOUNDARY` bewust BUITEN dit schema blijft

`src/domain/roster-profiles.ts` (profielgeschiktheid: mag deze dienst in dit profiel?) is
expres géén onderdeel van de rules-engine of het leergeheugen — het is een derde, harde,
platform-eigen filterlaag (zie `inventory-quality-and-preferences.md` §0: "Beide staan hier
naast elkaar zodat de asymmetrie zichtbaar is en niemand per ongeluk een voorkeur als filter
gebruikt"). Dit canonieke schema laat die scheiding met opzet intact — het zou de asymmetrie
juist ongedaan maken als profielgeschiktheid als "zomaar een regel met een status" in hetzelfde
schema kwam.

---

## 4. De reconciliatie: één gedeelde, additieve projectielaag

**Niet**: één nieuwe tabel/enum die `RuleStatus`, de operational-requirements-string en
`MemoryStatus` vervangt. **Wel**: een klein, puur-functioneel, read-only module dat elk van de
drie naar een gedeeld vocabulaire *projecteert*, zonder de bronsystemen te veranderen.

```ts
// src/server/knowledge/canonical-status.ts (voorstel — hieronder als concept gebouwd, zie §6)

export type CanonicalConfidence =
  | "FORMALLY_CONFIRMED"       // NS/mens heeft de bewering expliciet bevestigd
  | "TRANSCRIBED_UNVALIDATED"  // overgenomen uit een bron, nog niet bevestigd
  | "LOCAL_UNVALIDATED"        // eigen productparameter, geen externe bron nodig/mogelijk
  | "PROPOSED"                 // voorgesteld, wacht op mens
  | "REJECTED"
  | "WITHDRAWN"
  | "SUPERSEDED"
  | "MISSING";                 // bron/regel ontbreekt volledig (NOT_SUPPLIED)

export function fromRuleStatus(status: RuleStatus): CanonicalConfidence { ... }
export function fromOperationalRequirementSource(source: "USER_PROVIDED_OPERATIONAL_DESIGN_REQUIREMENT"): CanonicalConfidence { ... }
export function fromMemoryStatus(status: MemoryStatus): CanonicalConfidence { ... }
```

Dit voegt **niets toe aan** `RuleDefinition`, `operational-requirements.ts` of
`AgentMemoryItem` zelf — het leest ze alleen. Een toekomstig knowledge-overzicht (§32 van de
opdracht, "Knowledge UI") kan hierop bouwen zonder dat de drie bronsystemen ooit hoeven te weten
dat de projectie bestaat. Geen enkel bestaand gedrag verandert: er is nergens een aanroeper die
deze functies al gebruikt.

---

## 5. Twee kleine, additieve veldvoorstellen (nog niet toegepast)

Beide zijn **optionele** velden — toevoegen breekt niets, want bestaande code die het object
zonder dit veld construeert blijft geldig TypeScript zolang het veld optioneel (`?:`) is.

1. **`conflictsWith?: readonly string[]`** op `RuleDefinition` — een statisch, inspecteerbaar
   veld naast de bestaande impliciete `resolveRule()`-oplossing. Vervangt die functie niet
   (die blijft de daadwerkelijke evaluatielogica); dit veld maakt alleen een periodiek
   conflict-rapport mogelijk zonder elke regelcombinatie te hoeven evalueren.
2. **`sourceExcerptHash?: string`** op `RuleSource` — sha256 van het specifieke, getranscribeerde
   fragment (niet het hele document — dat heeft `sources/manifest.json` al op documentniveau).
   Laat zien of de transcriptie van artikel X nog exact overeenkomt met wat ooit is overgenomen,
   los van of het hele PDF nog hetzelfde is.

**Niet voorgesteld, en waarom niet**: een numerieke `confidence`-schaal (0-1) naast `RuleStatus`.
De bestaande inventaris (`inventory-rules-and-sources.md` §7 punt 2) laat dit expliciet als open
vraag aan de opdrachtgever — een enum (`RuleStatus`) is al ondubbelzinniger dan een getal, en een
extra numerieke as zonder duidelijke betekenis zou zelf een nieuwe bron van drift worden (zoals
`AFFINITY_VALUE`'s 1,0/0,6/0,2 — een aanname bovenop een wel-gesourcete rangorde, zie
`preference-audit.md`). Aanbevolen: SOURCE_INPUT_REQUIRED (mens beslist) voordat dit gebouwd
wordt.

---

## 6. Wat in deze fase WEL is gebouwd (additief, geen gedragswijziging)

Zie `src/server/knowledge/canonical-status.ts` en `tests/knowledge/canonical-status.test.ts`
(apart gecommit) — de drie pure projectiefuncties hierboven, met volledige dekking van elke
enum-waarde uit alle drie bronsystemen. Niets in `agent.ts`, de rules-engine, of het
leergeheugen roept dit vandaag aan; het is puur beschikbare infrastructuur voor een latere
Knowledge-UI (§32) of consistency-checker (§47), te wijzigen zodra de canonieke architectuur
zelf (na de BEFORE-meting) wordt uitgerold.

---

## 7. Wat hierna nog moet gebeuren (niet in deze fase)

- Daadwerkelijk `conflictsWith` en `sourceExcerptHash` toevoegen aan de types (triviale,
  niet-breaking wijziging, maar wél een contentwijziging aan het regelbestand als hij ooit gevuld
  wordt — dus na de BEFORE-freeze).
- Een consistency-checker (§47) die de projectielaag gebruikt om drift tussen componenten te
  signaleren — ontworpen, nog niet gebouwd (zie `conflict-report.md` voor wat hij zou moeten
  vangen).
- Een Knowledge-UI-scherm (§32) bovenop de projectielaag.
- Menselijke beslissing over de numerieke confidence-vraag (§5 hierboven).
