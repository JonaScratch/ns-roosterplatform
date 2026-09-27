# Inventaris regels en bronstatus — Fase 0 LYRA MASTER PROGRAM

Opgemaakt op 27 september 2026, als lees-onderzoek naar de bestaande
infrastructuur, vóór er iets nieuws wordt gebouwd. Niets hieronder is
verzonnen: elk getal komt uit een gegenereerd rapport, uit de broncode zelf, of
is expliciet gemarkeerd als "niet vastgesteld".

---

## 1. Bestaande documentatie (per bestand)

### `docs/rule-coverage.md`
Machinaal gegenereerd door `npm run docs:regeldekking` (script:
`scripts/rule-coverage.ts`), laatst gemeten 2026-09-06. Volledige tabel van
alle 71 regels met laag, artikel, waarde, en vijf statuskolommen
(overgenomen/geïmplementeerd/getest/waarde-in-artikel/formeel gevalideerd).
Kernfeit: `SOURCE_PRESENT` 66/71, `TRANSCRIBED` 71/71, `IMPLEMENTED` 71/71,
`TESTED` 26/71, `FORMALLY_VALIDATED` 0/71. Bevat ook negen expliciet benoemde
ontbrekende regelpakketten (o.a. ATW, ATB-vervoer, kwalificatiematrix,
WR/CO-definitie).

### `docs/rule-interpretation-audit.md`
Audit vóór fase J: van de ooit gemelde "933 harde overtredingen" is er **nul**
bevestigd. Documenteert zeven gevonden defecten (verzonnen contractuele
einddatum, overlappende startbanden op 05:00, rood weekend zonder
toepasselijkheidstoets, ontbrekende eerste vier roosterweken, dubbele telling,
verzonnen contracturen, verkeerd artikelnummer) en de huidige
uitkomstclassificatie (`VALID_WITHIN_VALIDATED_RULESET` t/m
`CONFIRMED_HARD_VIOLATION`). Bevat het model voor `RuleSource`/`currentLegalStatus`
zoals dat nu in de code staat. **Production-safe: NO.**

### `docs/rules-engine-rapport.md`
Bouwrapport van de rules engine (fase 3). Beschrijft `evaluateAssignment()` als
enige ingang, het regelbestand (69 regels op het meetmoment; inmiddels 71),
de vijf-uitkomstenlogica (in oudere terminologie dan de audit — zie §3
hieronder) en de metingen op het bestaande rooster (933 harde bevindingen,
inmiddels herclassificeerd, zie audit). Bevat de lijst met wat nodig is voordat
`Production-safe: YES` mag.

### `docs/source-inventory-phase-o.md`
Volledige, herhaalbare inventaris van de elf aangeleverde brondocumenten met
sha256, "werkelijk type" en status. Kernvondsten: `ns-logo.svg` is in
werkelijkheid een PNG; `BDU DDR Oktober 2026.docx` bevat geen dienstgegevens
(alleen een omslagtekst en een foto); `Roosterkaders Regio West 2026
ondertekend (1).pdf` is een scan zonder tekstlaag
(`SOURCE_PRESENT_NOT_MACHINE_READABLE`), bewust niet met OCR bewerkt. Ook: hoe
de CAO-PDF (InDesign, subset-fonts) technisch leesbaar is gemaakt.

### `docs/regeldekking-gedrag.md`
Machinaal gegenereerd door `npm run verify:rule-coverage`. Per regel: gaat hij
af in de engine, gaat hij niet af waar dat moet, en is dat met een test
vastgelegd (onderscheiden van "naam komt voor in de map"). Sluit af met: "Wat
hier niet in staat: formele validatie door NS" — een gedragstoets bewijst dat
de code doet wat het regelbestand zegt, niet dat het regelbestand de juiste
lezing van de bron is.

### `docs/fase-k-rapport.md` t/m `docs/fase-p-rapport.md`
Opeenvolgende bouwfases (3–6 september 2026), elk met eigen meetscripts en een
eerlijke "wat is er niet gedaan"-sectie:
- **Fase K**: organisatorische infrastructuur — standplaatsen, workflows
  NEW_TIMETABLE/AMENDMENT, reserverooster in twee lagen, importstraat,
  publicatiestatusmachine. Regelbestand: 2 van 71 gevalideerd.
- **Fase L**: operationele planning Dordrecht — CP-SAT-optimizer (OR-Tools),
  onafhankelijke eindvalidator, geschiktheidslaag, wijzigingsblad. 223
  diensten nog niet aangetroffen als bestand (22 aanwezig).
- **Fase M**: notificaties, ruilingen, reserve/DID — ruilworkflow kan op de
  toenmalige data geen enkele ruil voltooien (basisrooster zelf draagt al
  bevindingen).
- **Fase N**: roosterkoppeling, rotatie (dubbel geverifieerd, 1560
  weekposities), tijdelijke plaatsing. Productiegereedheid geschat op 0%.
- **Fase O**: volledige 223-dienstenimport gelukt (drie onafhankelijke
  tellingen), branding opgelost, echte PDF-export gebouwd, twee ernstige
  eindvalidatiedefecten gevonden en gerepareerd (weekindex vanaf 0 i.p.v. 1;
  validator rolde één regel uit i.p.v. de echte rotatie). **Alle vijf
  optimizer-scenario's nog steeds REJECTED, 0 bevestigde harde overtredingen.**
- **Fase P**: CAO-dagen, roosteruren-balans (40-uursnorm), pakketimport via
  Excel, volledig NS-exportsjabloon. Score: functionele volledigheid 88%,
  productiegereedheid **15%**, pilotgereedheid 45%.

### `docs/v1.0.4-final-brain/` en `docs/v1.0.4-optimizer-changelog.md`
Optimizer-ontwikkelronde ("adaptieve roosterzoekmachine"): kwaliteitsevaluator
losstaand van solver en regelmotor, adaptieve zoekmachine met elitepool,
bijschaven met ruildiensten, vier rekentijdmodi. Expliciet vermeld: "de harde
regels, de profielgrenzen, de onafhankelijke eindvalidatie, de publicatiepoort
en de juridische status van het regelbestand" zijn **niet** veranderd. Map
bevat ruwe meetbestanden (ablations, before/after, gates, human-pattern-evidence)
en `machinist-preferences/` (voorkeursintelligentie, apart geijkt).

### `docs/v1.0.5/`
Fase 0 van de v1.0.5-werkopdracht ("roosterbrein plus roosteragent" — de
voorloper van de huidige Lyra-agent). `architecture-current-state.md` is een
zeer directe voorloper van dit inventarisatiedocument: legt vast wat er al is
(drie intelligenties: CP-SAT, adaptieve zoekmachine, mens) en wat rood staat.
`architecture-target-state.md` ontwerpt de agentlaag met een `KnowledgeItem`-
model (scope PROJECT/LOCATION/NETWORK/ENGINE, status
HYPOTHESIS→PROPOSED→APPROVED_LOCAL→APPROVED_NETWORK) — **dit model is in de
huidige code niet zo gebouwd**; zie §3. Overige bestanden: benchmarks (m0–m3,
lokaal 1–8), praktijktest-opzet/bevindingen, risk-register, migration-plan.

### `docs/v1.0.6/`
Volgende ontwikkelronde van de Lyra-agent zelf (chatgedrag, tools,
gespreksgeheugen) — niet primair over de rules-engine. `golden-suite.json` en
`n0-manifest.json` zijn testsuites/momentopnamen voor het beoordelen van
agentantwoorden. `n0-n1-vergelijking.md` vergelijkt twee metingen.
`r2-pre-bevindingen.md` is een **bevroren nulmeting** (25 sept. 2026, commit
`963c800`, model `qwen3:8b`): 12/15 goed (80%), 0 fabricaties op 30 antwoorden,
en expliciet: "Deze meting en de bijbehorende suite zijn bevroren zodra dit
document is geschreven — ze worden niet meer aangepast, alleen exact herhaald
als R2-POST/N2." Belangrijkste bevinding: een ontbrekende `profileDefinition`-
tool leidt tot ongefundeerde profielconclusies, en op de zesde beurt van een
langer gesprek verloor de agent de gestelde vraag volledig (antwoordde met een
rekenvoorstel op een vergelijkingsvraag).

### `docs/lyra-knowledge/` (nieuw, niet in Git)
Bij aanvang van dit onderzoek bleek deze map al te bestaan (aangemaakt vlak
vóór dit onderzoek, `git status` toont hem als `??`, dus nog niet vastgelegd).
Bevat `sources/official-rosters-dordrecht-2026/` (de zeven roosterblad-PDF's)
en `sources/regional-rules/Roosterkaders_Regio_West_2026_ondertekend.pdf`.
**Belangrijk voor Phase 0:** dit zijn kale kopieën — sha256 van de
Roosterkaders-PDF is identiek aan het bestand in
`tests/fixtures/dordrecht-bronnen/`, er is geen OCR of bewerking op toegepast.
Er is geen index-, metadata- of README-bestand naast de PDF's. Dit is dus een
begin van een canonieke bronmap, geen werkend systeem.

---

## 2. Rules engine — huidige implementatie

Locatie: `src/server/rules-engine/`. Eén ingang: `evaluateAssignment()`
(`assignment.ts`), gebruikt door roostercommissie, dienstindeling,
reserve-invulling, beschikbare diensten, ruilingen én de optimizer-eindvalidatie
(`final-validator.ts`). Regelbestand in `ruleset/`:

| Bestand | Inhoud |
| --- | --- |
| `ruleset/types.ts` | Typedefinities: `RuleDefinition`, `RuleSource`, `RuleLayer`, `RuleStatus`, `RuleScope`, `RuleContext`, plus `resolveRule()` (conflictoplossing) en `currentLegalStatus()` |
| `ruleset/rule-ids.ts` | 71 regel-id's als constanten (`RULE.XXX`) |
| `ruleset/cao-ns-2024-2025.ts` | 59 regels, laag `CAO` (935 regels code) |
| `ruleset/regio-west-2026.ts` | 5 regels laag `REGIONAL` + 7 regels laag `PRODUCT_POLICY` + `MISSING_PACKAGES` (9 ontbrekende pakketten) |
| `ruleset/index.ts` | `activeRuleset()` — samenstelling, modus (`SOURCE_RULESET_SIMULATION`/`PRODUCTION`), `isReleasedForProduction()`, `rulesetBanner()` |

**Regels zijn TypeScript-literals in de repository, geen database-rijen en geen
los JSON-bestand.** Er is dus geen CMS, geen los te muteren opslag en geen
database-audit-trail per regelwijziging (wel git-historie van deze bestanden).
Actieve versie: `"2026.1-cao-2024-2025-transcribed"`.

**Controles** (`validation/checks/*.ts`): eligibility, duty-limits, daily-rest,
sequences, weekly-hours, weekly-rest, counters, weekend, quality, structure,
location. Elk levert bevindingen (`Finding`) op die door `result.ts` worden
samengevat tot één uitkomst per plaatsing.

**Uitkomsten (huidig, bevestigd in code `validation/result.ts`):**
`VALID_WITHIN_VALIDATED_RULESET` 🟢, `VALID_WITH_WARNINGS` 🟡,
`CONTEXT_INCOMPLETE` 🟠, `RULESET_INCOMPLETE` ⚫, `POTENTIAL_HARD_VIOLATION` 🟤,
`CONFIRMED_HARD_VIOLATION` 🔴. **Let op:** `docs/rules-engine-rapport.md` §2
noemt nog een oudere vijfvoudige naamgeving (`VALID`, `VALID_WITH_WARNINGS`,
`REQUIRES_REVIEW`, `RULESET_INCOMPLETE`, `HARD_VIOLATION`) — dat rapport is op
dit punt door de audit ingehaald en de code volgt de audit-terminologie. Een
bevinding is pas `CONFIRMED` als drie dingen tegelijk kloppen: regelstatus
`VALIDATED`, bron `IN_ORIGINAL_TERM`, en geen open toepasselijkheidsvraag.

**Conflictoplossing tussen regels** bestaat al, in `resolveRule()`
(`ruleset/types.ts`): bij meerdere treffers wint (1) de meest specifieke
reikwijdte, dan (2) de hoogste bronlaag (`layerRank`), dan (3) de meest recente
ingangsdatum. Dit is impliciete conflictoplossing via ordening — er is **geen**
los `conflictsWith`-veld dat twee regels expliciet als tegenstrijdig markeert;
een conflict wordt alleen zichtbaar via de uitkomst van `resolveRule`, niet als
apart gerapporteerd fenomeen.

**Drie parallelle, niet-uniforme "rule-achtige" systemen gevonden:**
1. `src/server/rules-engine/ruleset/` — juridische regels (`RuleDefinition`), zoals hierboven.
2. `src/domain/operational-requirements.ts` — harde **product**eisen uit een
   gebruikersbesluit van 19-09-2026 (roostergemiddelde ≤ 40:00/week,
   vrijdageis vóór een vrij weekend), met een eigen, ad-hoc bronstatus-string
   `USER_PROVIDED_OPERATIONAL_DESIGN_REQUIREMENT` — géén `RuleStatus`-waarde uit
   `ruleset/types.ts`, een aparte enum-achtige constante.
3. `prisma.AgentMemoryItem` — het agent-leergeheugen (zie §3): voorkeuren,
   feiten, besluiten, lessen, met eigen `MemoryStatus`
   (PROPOSED/APPROVED/REJECTED/WITHDRAWN/SUPERSEDED) en eigen `supersedes`-
   relatie.

Deze drie kennen elk hun eigen taxonomie voor "is dit nog geldig / bevestigd /
vervangen", en geen daarvan verwijst naar de andere. Dat is precies het soort
drift dat Fase 0 van LYRA MASTER PROGRAM moet blootleggen vóór er een canoniek
schema wordt ontworpen.

Eerder al genezen drift (dus niet meer aanwezig, maar leerzaam): tot vóór fase
K/L bestond een tweede parameterbestand (`parameters.ts`) met eigen
grenswaarden (11 uur minimumrust tegen 12 in de CAO-transcriptie, 6
opeenvolgende werkdagen tegen 7) die naast de rules-engine werd gebruikt. Dit
is verwijderd; `parameters.ts` bevat nu uitsluitend niet-juridische
productinstellingen (zie het bestand zelf, met een expliciete toelichting
waarom). Er is dus precedent voor precies het soort defect dat een canoniek
schema moet voorkomen.

Ook genoemd, niet opgelost: in `docs/v1.0.5/architecture-current-state.md` §8.5
staat een **niet-opgeloste drift tussen solver en kwaliteitsmodel**: "een losse
nacht weegt in CP-SAT ongeveer 27× lichter dan in het [kwaliteits]model" —
expliciet benoemd als "de belangrijkste openstaande technische vraag".

---

## 3. Rule record schema — huidig vs. gewenst

Vergelijking van het gevraagde canonieke veldenlijstje tegen `RuleDefinition`
(`ruleset/types.ts`) en de aanpalende modellen:

| Gevraagd veld | Bestaat vandaag? | Onder welke naam / opmerking |
| --- | --- | --- |
| `knowledgeId` | Gedeeltelijk | `RuleDefinition.id` (string, bv. `RP_MAX_WORK_PER_DUTY`) — functioneert als identifier, maar is tegelijk de "leesbare" code; geen apart intern vs. extern id |
| `canonicalName` | Nee, apart | `title` bestaat (mensleesbare titel), maar geen genormaliseerde canonieke naam los van de vrije titeltekst |
| `statement` | Ja, gedeeltelijk | Geen los `statement`-veld op `RuleDefinition`; de "bewering" zit impliciet in `title` + `rationale` + `value`/`unit`. `AgentMemoryItem.statement` bestaat wél, maar dat is het agent-geheugen, niet de rules-engine |
| `category` | Ja | `RuleCategory`: `HARD_CONSTRAINT` \| `SOFT_CONSTRAINT` \| `OPTIMIZATION_OBJECTIVE` — drie waarden, geen fijnmaziger indeling (zie §4 voor de gevraagde "wet/CAO vs. lokaal vs. voorkeur vs. afgeleid vs. experimenteel"-as, die hier ontbreekt) |
| `scope` | Ja | `RuleScope { employeeGroups, companies, locations }` |
| `hardness` | Deels via `category` | Geen apart `hardness`-veld; `HARD_CONSTRAINT`/`SOFT_CONSTRAINT` doet dienst als hardheidsas, samengevouwen met "is dit een optimalisatiedoel" |
| `sourceType` | Ja, als `layer` + `legalAuthority` | `RuleLayer` (9 waarden, zie §4) en `RuleSource.legalAuthority` (`WET`/`CAO`/`BEDRIJF`/`REGIO`/`LOKAAL`/`INDIVIDUEEL`/`PRODUCT`) — twee assen die gedeeltelijk overlappen |
| `sourceReference` | Ja | `RuleSource.document` + `documentTitle` + `article` + `paragraph` |
| `sourceHash` | Nee, niet op regelniveau | Bronbestanden hebben wél een sha256 (zie `source-inventory-phase-o.md`), maar dat hasht het hele PDF, niet de specifieke passage die een regel onderbouwt. Geen regel-naar-hash-koppeling |
| `effectiveFrom` / `effectiveTo` | Ja / deels | `RuleSource.effectiveFrom` bestaat. Geen `effectiveTo`: in plaats daarvan `contractualEnd` + `renewalRule` (`ENDS_ON_CONTRACTUAL_END` / `TACIT_RENEWAL` / `OPEN_ENDED`) — bewust rijker dan een simpele einddatum, zie de audit (§1.1) over waarom een los `effectiveUntil`-veld is afgeschaft |
| `confidence` | Nee | Geen numerieke of categorische confidence-score op een regel. Wel een `RuleStatus` (zie hieronder) die functioneel iets vergelijkbaars uitdrukt, maar niet als schaal |
| `verificationStatus` | Ja | `RuleStatus`: `VALIDATED` / `SOURCE_TRANSCRIBED` / `UNVALIDATED_LOCAL_PARAMETER` / `NEEDS_POLICY_VALIDATION` / `POLICY_PENDING` / `UNRESOLVED` / `NOT_SUPPLIED`, plus `validatedBy` / `validatedAt` |
| `approvalStatus` | Nee, apart | Er is geen tweede, gescheiden goedkeuringsstatus naast `RuleStatus`; `VALIDATED` + `validatedBy`/`validatedAt` doet in de praktijk dienst als "goedgekeurd". Bij `AgentMemoryItem` bestaat wél een aparte `MemoryStatus` met `PROPOSED`/`APPROVED`/`REJECTED` — dus twee verschillende statusmodellen in twee verschillende delen van het systeem |
| `supersedes` / `supersededBy` | Deels | `RuleSource.supersededBy` bestaat (documentniveau, "welke bron heeft deze vervangen"), maar geen `supersedes`/`supersededBy` op regelniveau zelf. `AgentMemoryItem` heeft wél een volwaardige `supersedes`/`supersededBy`-relatie (self-relation in Prisma) |
| `conflictsWith` | Nee | Niet aanwezig als expliciet veld. Conflicten tussen regels met hetzelfde id worden impliciet opgelost door `resolveRule()` (specificiteit → laag → datum); een conflict tussen regels met *verschillende* id's (bijv. twee regels die elkaar tegenspreken zonder hetzelfde id te delen) wordt nergens automatisch gedetecteerd |

**Samenvattend:** de kern (bron, laag, geldigheid, validatiestatus, scope) is
verrassend volwassen en al doordacht op precies de valkuilen die het gevraagde
schema wil vermijden (zie de code-commentaren in `types.ts`, die expliciet
uitleggen *waarom* elk veld bestaat). Wat ontbreekt is vooral: een losse
numerieke confidence-as, een sourceHash tot op passage-niveau, een expliciet
`conflictsWith`, en één uniforme naamruimte voor "canonieke naam"/"statement"
die niet noodzakelijk samenvalt met de vrije `title`-tekst. Bovendien bestaan
er, zoals in §2 beschreven, twee tot drie *parallelle* statusmodellen
(`RuleStatus` op regels, de ad-hoc string bij operational-requirements,
`MemoryStatus` op `AgentMemoryItem`) die elkaar niet kennen.

---

## 4. Bronstatus vandaag (aantallen, categorieën)

Bevestigd via broncode (`ruleset/rule-ids.ts`: 71 entries; 59 in
`cao-ns-2024-2025.ts` + 5 REGIONAL + 7 PRODUCT_POLICY in
`regio-west-2026.ts` = 71) en via `docs/rule-coverage.md` (gemeten
2026-09-06, zelfde totaal):

| Maat | Aantal | Bron |
| --- | --- | --- |
| Regels totaal | 71 | code + rule-coverage.md |
| Waarvan laag CAO | 59 | code |
| Waarvan laag REGIONAL | 5 | code |
| Waarvan laag PRODUCT_POLICY | 7 | code |
| `SOURCE_PRESENT` (bron aangeleverd én leesbaar) | 66 / 71 | rule-coverage.md |
| `TRANSCRIBED` (overgenomen in regelbestand) | 71 / 71 | rule-coverage.md |
| `IMPLEMENTED` (regel-id komt voor in toepassende code) | **57 / 71**, niet 71/71 | fase-p-rapport.md §F corrigeert een eerdere meetfout: "71 van de 71" telde ook het regelbestand zelf mee. 14 `IMPLEMENTATION_GAP`-regels staan wél in het regelbestand maar worden nergens toegepast (bv. `HOLIDAY_ATTACHED_MIN`, `RT_PREFERRED_WINDOW_WEEKS`, `WTV_DAY_LATEST_START`) |
| `TESTED` (test noemt regel bij naam) | 26 / 71 (rule-coverage.md) resp. 25/71 (source-inventory §5) | twee documenten, één dag verschil, klein afrondingsverschil — niet nader verklaard in de bronnen zelf |
| `FORMALLY_VALIDATED` door NS | **0 / 71** | unaniem in alle gelezen documenten |
| Regelpakketten die volledig ontbreken | 9 (`MISSING_PACKAGES`) | o.a. ATW, ATB-vervoer, kwalificatiematrix, CAO-actualiteitsbevestiging, Dordrecht-werkonderbrekingsparameter, Regio-West-weekenddefinitie, Mix/BLM/50+Mix-regels, individuele-beperkingenbron, WR/CO-definitie |

**Categorie-/lagensysteem:** `RULE_LAYERS` (`ruleset/types.ts`) kent negen
waarden, van hoog naar laag: `LAW_ATW`, `LAW_ATB`, `CAO`, `CAO_COMPANY`,
`REGIONAL`, `LOCAL`, `INDIVIDUAL`, `EMPLOYEE_CHOICE`, `PRODUCT_POLICY`. In de
praktijk zijn vandaag alleen `CAO`, `REGIONAL` en `PRODUCT_POLICY` daadwerkelijk
bezet; `LAW_ATW`, `LAW_ATB`, `CAO_COMPANY`, `LOCAL`, `INDIVIDUAL` en
`EMPLOYEE_CHOICE` bestaan als plek in het model maar hebben nog geen enkele
regel. Dit is dus al een negenlagen-hiërarchie die ruimte laat voor precies het
soort onderscheid dat de opdracht vraagt (wet/CAO vs. regionaal vs. lokaal vs.
individueel vs. productbeleid) — maar met **geen aparte laag voor "menselijke
voorkeur"** (die zit apart in `AgentMemoryItem.kind = PREFERENCE`, niet in
`RuleLayer`) en **geen laag voor "afgeleid uit data" of "experimenteel"** (dat
begrip bestaat wel elders — zie `EngineExperiment` in de v1.0.5-doelarchitectuur
en `AgentResearchLoop` in het Prisma-schema — maar niet als `RuleLayer`-waarde).

Eén expliciet niet-gecorrigeerde bronverwijzing staat opgetekend:
`WEEKLY_REST_72H_PER_14D` noemt artikel 100, terwijl het getal alleen in artikel
99 gevonden wordt (fase-o-rapport.md §5, herbevestigd in fase-p-rapport.md §F
als `SOURCE_REFERENCE_REVIEW_REQUIRED`) — bewust niet aangepast, om geen gok
als correctie te presenteren.

---

## 5. CAO/Roosterkaders — wat is al aanwezig

- **NS CAO 2024-2025.pdf** — aanwezig, machineleesbaar (107 pagina's, ~338.000
  tekens), sha256 vastgelegd in `source-inventory-phase-o.md`. Ook aanwezig als
  fixture: `tests/fixtures/dordrecht-bronnen/NS CAO 2024-2025.pdf`. **Niet**
  bevestigd als de voor 2026 geldende versie (`CAO_CURRENCY_CONFIRMATION`
  ontbreekt; audit-document beschrijft uitgebreid de contractuele-status-logica
  hiervoor).
- **Roosterkaders Regio West 2026 ondertekend (1).pdf** — aanwezig op twee
  plekken (`tests/fixtures/dordrecht-bronnen/` en, sinds kort,
  `docs/lyra-knowledge/sources/regional-rules/`, identieke sha256). **Geen
  tekstlaag** — 10 pagina's, 11 afbeeldingen, nul lettertypen. Status
  `SOURCE_PRESENT_NOT_MACHINE_READABLE`. Bewust geen OCR toegepast (expliciete
  motivatie in `source-inventory-phase-o.md`: "een raadslag over wat er in een
  ondertekend regionaal kader staat, is precies het soort bron dat later
  niemand meer als raadslag herkent"). Vier regels in het regelbestand
  (`REGIO_WEST_WEEKEND_TARGET`, `DORDRECHT_ROSTER_LINE_DIVISOR`,
  `REGIO_WEST_WTV_INTERVAL_WEEKS`, `NEW_DRIVER_PROTECTION_YEARS`) staan al in
  de code met `sourceApplies` op `false`/`nee` voor "overgenomen" en blijven
  daarmee blokkerend of ongebruikt.
- **Convenant** (los begrip) — geen apart convenant-document aangetroffen; het
  woord komt in de gelezen documentatie niet voor als eigen brontype naast CAO
  en Roosterkaders.
- **BDU DDR Oktober 2026.docx** — aanwezig maar bevat geen dienstgegevens
  (alleen omslagtekst + een foto van een trein). Niet als regelbron te
  gebruiken.

---

## 6. Conflict-/drift-detectie — bestaat dit al

**Binnen de rules-engine zelf:** ja, gedeeltelijk. `resolveRule()` lost
conflicten tussen regels met hetzelfde id op via specificiteit → laag →
datum (zie §2). Er is geen los rapport of test die *expliciet* opsomt welke
regel-paren met elkaar conflicteren; het conflict wordt alleen zichtbaar als
uitkomst van een concrete evaluatie, niet als statisch overzicht.

**Tussen validator/optimizer/agent/UI (drift over componenten heen):**
- Eén al genezen geval is uitvoerig gedocumenteerd: het losse
  `parameters.ts`-bestand met eigen grenswaarden naast de rules-engine (11 uur
  vs. 12 uur minimumrust, 6 vs. 7 opeenvolgende werkdagen) — verwijderd, met
  een expliciete toelichting in de code over waarom "twee regelboeken" erger is
  dan één onvolledig regelboek.
- Eén nog **open** en met zoveel woorden benoemd geval:
  `docs/v1.0.5/architecture-current-state.md` §8.5 — de kostenfunctie van de
  CP-SAT-solver en het kwaliteitsmodel wegen een losse nacht ongeveer 27×
  verschillend. Expliciet gemarkeerd als openstaande technische vraag, niet
  opgelost in de gelezen documentatie.
- Verder is er geen automatische test gevonden die de rules-engine-drempels,
  de optimizer-kostgewichten (`DEFAULT_OBJECTIVE_WEIGHTS` in `parameters.ts`)
  en enige UI-weergave van dezelfde drempel tegen elkaar controleert. De
  bestaande `verify:*`-scripts toetsen elk hun eigen domein (regels,
  roosterdata, structuur, import, toegang) maar er is geen
  "cross-drift"-script gevonden dat bijvoorbeeld nagaat of een in de UI
  getoonde grenswaarde overeenkomt met de waarde in `ruleset/`.
- `NEEDS_POLICY_VALIDATION` blokkeerde ooit niet correct (fase-3-rapport §6,
  defect 3) — inmiddels opgelost door het toe te voegen aan
  `BLOCKING_STATUSES`, en die lijst is precies de plek waar een volgende
  vergelijkbare drift zou moeten worden gevangen.

**Conclusie:** er bestaat een cultuur en precedent van drift-detectie via
onafhankelijke herimplementatie ("tweede, onafhankelijke implementatie
geschreven", zie audit §4 over `scripts/audit-rood-weekend.ts`, en fase-o §10
over de validator-vs-fixture-drift), maar geen generiek, geautomatiseerd,
doorlopend mechanisme dat alle drempelwaarden op alle plekken met elkaar
vergelijkt. Dat blijft mensenwerk per keer dat iemand het opmerkt.

---

## 7. Open vragen / SOURCE_INPUT_REQUIRED-kandidaten

Voor Fase 0 van LYRA MASTER PROGRAM, in volgorde van gewicht:

1. **Welke van de drie parallelle statusmodellen (`RuleStatus` op
   `RuleDefinition`, de ad-hoc string bij `operational-requirements.ts`,
   `MemoryStatus` op `AgentMemoryItem`) wordt de basis van het canonieke
   schema, en hoe worden de andere twee erop afgebeeld zonder informatie te
   verliezen?**
2. **`confidence` en `sourceHash` (op passage-niveau) bestaan nog nergens.**
   Vraag aan de opdrachtgever: is een numerieke confidence-schaal gewenst naast
   (of in plaats van) de bestaande `RuleStatus`-enum, en tot welk detailniveau
   moet een `sourceHash` reiken (heel document, pagina, artikel)?
3. **`conflictsWith` als los, statisch veld**: is dit gewenst naast de
   bestaande impliciete resolutie via `resolveRule()`, of vervangt het die?
   Een expliciet veld zou een periodiek te draaien conflict-rapport mogelijk
   maken; de huidige opzet levert conflicten alleen op het moment van
   evaluatie.
4. **CAO-actualiteit 2026**: welke CAO, nawerking of nieuwe afspraken gelden nu
   — dit blokkeert niet alleen `PRODUCTION_MODE` maar ook elk voorstel om een
   canoniek schema te vullen met "actuele" waarden.
5. **Roosterkaders Regio West**: is een menselijke overtypactie (geen OCR)
   gepland, en door wie? Zonder tekst blijven vier regels vast op hun huidige
   status.
6. **ATW / Arbeidstijdenbesluit vervoer**: volledig `NOT_SUPPLIED`. Elk
   canoniek schema dat op deze twee wettelijke pakketten moet kunnen wijzen,
   heeft ze nog niet om naar te wijzen.
7. **Wat gebeurt er met `docs/lyra-knowledge/sources/`?** De map bestaat al
   (ongecommit), met kale PDF-kopieën zonder metadata-bestand. Voordat Fase 0
   verder gaat: is dit bedoeld als het canonieke opslagpunt voor bronnen, en zo
   ja, welk metadataformaat (sourceHash, ontleedstatus, aanleverdatum) hoort
   ernaast?
8. **De drift tussen CP-SAT-kostenfunctie en kwaliteitsmodel (27×)** — expliciet
   benoemd als "de belangrijkste openstaande technische vraag" in
   `architecture-current-state.md`, maar niet vastgesteld of dit binnen de
   scope van het rule-schema valt of een apart optimizer-vraagstuk is.
9. **Aantal getest (`TESTED`) regels wijkt tussen twee documenten**
   (26/71 in `rule-coverage.md` vs. 25/71 in `source-inventory-phase-o.md` §5,
   één dag verschil) — niet vastgesteld of dit een meetfout, een tussentijdse
   wijziging, of een afrondingsverschil is.
10. **`RuleLayer` kent negen waarden, waarvan zes nog nooit gebruikt**
    (`LAW_ATW`, `LAW_ATB`, `CAO_COMPANY`, `LOCAL`, `INDIVIDUAL`,
    `EMPLOYEE_CHOICE`). Vraag: zijn dit precies de juiste zes, of moet het
    canonieke schema hier "voorkeur" en "afgeleid-uit-data"/"experimenteel"
    aan toevoegen (zie ook `AgentMemoryItem.kind` en `AgentResearchLoop` in
    het Prisma-schema, die een deel van dat onderscheid al informeel dragen)?

Niet vastgesteld en met opzet niet geraden: het exacte aantal regels waarvoor
NS al informeel (buiten dit systeem om) een uitspraak heeft gedaan.

**Toelichting bij een schijnbare tegenspraak tussen documenten.** De
fase-rapporten (K, M, N) noemen steeds "2 van de 71 regels gevalideerd",
terwijl `docs/rule-coverage.md` als gegenereerd getal `FORMALLY_VALIDATED: 0 /
71` toont. Dit is nagetrokken in de code en is **geen fout in een van beide
documenten**: er bestaat een gedeelde constante `PRODUCT_VALIDATED` in
`ruleset/regio-west-2026.ts`, gebruikt door precies twee regels
(`ROSTER_ANCHOR_LOCKED`, `RESERVE_BASE_WITHOUT_DUTIES`) — beide
`PRODUCT_POLICY`-regels die per definitie waar zijn omdat het platform ze zelf
stelt, niet omdat NS een CAO-lezing heeft bevestigd. `rule-coverage.md`s kolom
"Formeel gevalideerd" meet specifiek NS-bevestiging van een CAO/regionale
bewering, en telt deze twee product-eigen regels terecht niet mee. Dit is een
concreet voorbeeld van waarom één woord ("gevalideerd") zonder scope-aanduiding
al tot verwarring leidt tussen documenten — en dus een sterk argument vóór een
canoniek schema met een expliciet onderscheid tussen "door NS bevestigd" en
"door het platform zelf als definitie gesteld".
