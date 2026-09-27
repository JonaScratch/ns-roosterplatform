# Lyra Master Program — voortgang

Bijgewerkt: 2026-09-28. Zie `docs/lyra-knowledge/` voor alle output van deze ronde.

Dit document volgt §106 (werkwijze) en §108 (als de opdracht te groot is voor één uitvoering) van de opdracht. Status per fase: `NOT_STARTED` / `IN_PROGRESS` / `BLOCKED` / `TESTED` / `COMPLETE`.

## Uitgangssituatie (Fase 0, vastgesteld)

- **Branch**: `claude/admiring-edison-5y65j7`
- **HEAD bij start van deze ronde**: `6398e13` (Demo Room v0.9)
- **Working tree**: schoon bij start, geen dirty/untracked state.
- **Commits `2cd863e`, `4e489b7`, `6398e13` geverifieerd aanwezig**: JA.
- **Versienummering (v1.0.x)**: geverifieerd correct (pure stringtemplating, regressietest v1.0.9→v1.0.10 aanwezig sinds `6398e13`).

**BELANGRIJKSTE ONTDEKKING VAN FASE 0**: dit is geen "bouw het canonieke kennissysteem vanaf nul"-opdracht. Er bestaat al een zeer volwassen, goed gedocumenteerde infrastructuur — een 71-regel rules engine, een vier-lagen leergeheugen met mens-in-de-lus-promotie, een grondingscontrole, een 12-tools toolcontract, een human-roster-pattern-document dat vrijwel exact overeenkomt met §7-§27 van de opdracht, en een tweede, aantoonbaar rijpere benchmarklijn voor de roosterengine zelf (20 replicate-runs, mean/median/worst). De opdracht van deze ronde is dus vooral: **reconciliatie, het dichten van specifieke, nu concreet vastgestelde gaten, en één keer een eerlijke voor/na-meting** — niet "bouw dit allemaal opnieuw".

## Fasetracker

| Fase | Omschrijving | Status | Notities |
|---|---|---|---|
| 0 | Snapshot + inspectie | **TESTED** | Git-snapshot klaar. 4 inventarisatierapporten geschreven (zie hieronder), elk met file:line-citaten. Bronnen geverifieerd via bestaande `npm run verify:bronnen` (8/8 geslaagd, geen drift sinds 2026-09-05). |
| 1 | Immutable BEFORE-benchmark | **BLOCKED (LOCAL REQUIRED)** | Geen Ollama bereikbaar in deze cloud-omgeving (`curl localhost:11434` → niets, `which ollama` → niets). Het bestaande harnas (`scripts/v106/golden-bench.ts`) is klaar voor hergebruik zodra dit lokaal draait — zie "LOCAL REQUIRED" onderaan. |
| 2 | Kennis/bron-inventaris | **COMPLETE** | 4 rapporten: `inventory-rules-and-sources.md`, `inventory-quality-and-preferences.md`, `inventory-memory-grounding-tools.md`, `inventory-benchmark-infrastructure.md`. |
| 3 | Canonical model / migratie | NOT_STARTED | Bewust NIET blind gestart — de bestaande `RuleDefinition`/`RuleSource` (ruleset/types.ts) is al rijk; de opdracht is reconciliatie van 3 parallelle statusmodellen, geen nieuw schema vanaf nul (zie inventory-rules-and-sources.md §7 punt 1). |
| 4 | Rules/source-consolidatie | NOT_STARTED | |
| 5 | Menselijke voorkeuren-consolidatie | **GROTENDEELS AL AANWEZIG** | `docs/human-roster-benchmark/human-roster-design-principles.md` bestaat al en dekt vrijwel de volledige inhoud van opdracht §7-§27, met correcte OBSERVED/PREFERRED-scheiding en eerlijke bronstatus (46u-drempel al gemarkeerd POTENTIAL). Nog te doen: verifiëren dat dit document ook echt aan de agent/kwaliteitsmodel gekoppeld is (agent B, loopt nog). |
| 6 | Officiële menselijke roosterpatronen-consolidatie | **AL AANWEZIG (bevestigd, niet opnieuw gebouwd)** | De 7 roosterbladen zijn al volledig geparsed en drievoudig geteld (223 diensten, 0 discrepanties) in `docs/source-inventory-phase-o.md`, herbevestigd op 2026-09-28. Geen actie nodig — een tweede parseerpoging zou exact het soort dubbele systeem zijn dat de opdracht verbiedt. |
| 7 | Agent retrieval/tool/grounding-integratie | NOT_STARTED | Concreet gat al gevonden (zie hieronder): `memoryProposal` werkt alleen in de stub, niet in de echte lokale-modelroute. |
| 8 | Claim-verificatie | NOT_STARTED | Concreet gat al gevonden: geen controle op onbevestigde autoriteitstaal ("bevestigd"/"formeel"/"CAO" zonder brongegevens). |
| 9 | Regressiesuite uitbreiden | NOT_STARTED | Concrete, kleine eerste stappen al geïdentificeerd: unit-test voor `jsonUit()` (dubbele JSON-objecten), regressietest voor `domeinwoordenboek()` op de lokale-modelroute. |
| 10 | Kennisconsistentie + broncoverage | NOT_STARTED | |
| 11 | AFTER-benchmark | NOT_STARTED | Afhankelijk van Fase 1. |
| 12 | Locked holdout/adversarial | NOT_STARTED | Bestaat nog niet voor de agent-Q&A-lijn (wel losstaand voor het kwaliteitsmodel: `contrastive-check.json`). |
| 13 | Promotion-compatibiliteitstest | NOT_STARTED | |
| 14 | Eindrapport + commits | NOT_STARTED | |

## Concrete, al bevestigde bevindingen (geen aannames — elk met bronverwijzing in de volledige rapporten)

### Bronstatus (§5, §49) — gecorrigeerd t.o.v. mijn eerste, voorbarige aanname
- **De CAO is WEL aanwezig** (`tests/fixtures/dordrecht-bronnen/NS CAO 2024-2025.pdf`, 107 pagina's, machineleesbaar, 59 van de 71 regels erop gebaseerd) — mijn allereerste aanname dat de CAO ontbrak was fout en is gecorrigeerd.
- **Maar de aanwezige CAO is gedateerd 1 jan. 2024 – 1 maart 2025** — al meer dan anderhalf jaar verlopen voor de geauditeerde roosterperiode (okt–dec 2026). Dit wordt in de code zelf al als openstaand blokkerend punt behandeld (`CAO_CURRENCY_CONFIRMATION` in `MISSING_PACKAGES`, blokkeert `PRODUCTION_MODE`). **SOURCE_INPUT_REQUIRED: de daadwerkelijk geldige CAO/nawerkingsregeling voor 2026.**
- **Roosterkaders Regio West 2026** is een scan zonder tekstlaag — bewust nooit met OCR verwerkt door het platform zelf. Deze sessie heeft via beeld-gebaseerd lezen een VOORLOPIGE transcriptie gemaakt (`docs/lyra-knowledge/roosterkaders-regio-west-2026-DRAFT-TRANSCRIPTIE.md`) — nadrukkelijk `HUMAN_REVIEW_REQUIRED`, niet machinaal geverifieerd, dus niet zomaar `ACTIVE` te maken.
- **`BDU DDR Oktober 2026.docx`** bevat geen dienstgegevens (alleen omslagtekst + een foto) — al vastgesteld in fase O, herbevestigd.
- 9 volledig ontbrekende regelpakketten staan al expliciet genoemd in de code zelf (`MISSING_PACKAGES` in `regio-west-2026.ts`): ATW, ATB-vervoer, CAO-actualiteit, kwalificatiematrix, Dordrecht-werkonderbrekingsparameter, en meer.

### Rules engine (§3, §4)
- 71 regels (59 CAO, 5 REGIONAL, 7 PRODUCT_POLICY), reeds een 9-lagen `RuleLayer`-hiërarchie, `RuleStatus`-enum, `resolveRule()`-conflictoplossing.
- `FORMALLY_VALIDATED: 0/71` — nog geen enkele regel formeel door NS bevestigd. `IMPLEMENTED: 57/71` (niet 71/71 — 14 regels staan in het regelbestand maar worden nergens toegepast).
- **3 parallelle, elkaar niet kennende statusmodellen** gevonden: `RuleStatus` (rules engine), ad-hoc string bij `operational-requirements.ts`, `MemoryStatus` (agent-geheugen). Reconciliatie hiervan is de kern van Fase 3, niet een nieuw schema vanaf nul.
- **Onopgeloste, met naam benoemde technische drift**: CP-SAT-solver weegt een losse nacht ~27× lichter dan het kwaliteitsmodel (`docs/v1.0.5/architecture-current-state.md` §8.5) — exact het "objective alignment"-probleem uit opdracht §23.23.

### Memory/grounding/tools (§28, §29, §46)
- RET/rangeer-woordenboek: **structureel gefixt**, écht gedeeld tussen stub en lokaal model (`vocabulary.ts`) — maar geen regressietest die specifiek de lokale-modelroute dekt.
- **Nieuw, nog niet eerder gemeld defect, hetzelfde patroon als de historische RET-bug**: `memoryProposal` (de "onthoud dat..."-feedbackflow) werkt alleen in de stub (`model/stub.ts`), is volledig afwezig in de echte lokale-modelroute (`model/local.ts`) — geverifieerd met grep, geen treffers.
- JSON-dubbele-object-parser (`jsonUit()` in `local.ts`) — fix aanwezig en overtuigend, **maar nul regressietests**, ondanks dat het een pure, triviaal te testen functie is.
- Grondingscontrole onderscheidt al correct FABRICATED vs. EXISTS_BUT_NOT_RETRIEVED (met regressietest). **Controleert nog niet** op onbevestigde autoriteitstaal ("bevestigd", "formeel", "CAO", "verplicht", "officieel" zonder brongegevens) — een bestaande regressietest bevat zelfs het woord "bevestigd" in de testinvoer zonder dat op te merken.
- Geen automatische runtime-detector voor "instemmen met een foutieve gebruikersaanname" — alleen een benchmarkmetriek die op handmatige grading leunt.
- Geen contradictiedetectie tussen twee onafhankelijk voorgestelde geheugenitems binnen dezelfde scope.

### Benchmark-infrastructuur (§28.15, §28.16, §41)
- **Golden suite: bevestigd 43 items** (35 dev / 8 holdout), 100+ doel nooit gehaald — het bestand zegt dit zelf met zoveel woorden.
- **Documented, reproduceerbaar non-determinisme bij temperatuur 0**: twee identieke-code runs (n0b/n1) scoorden verschillend op 7 van de 43 items (16%) — weerlegt een eerdere v1.0.5-bevinding van volledige determinisme.
- Agent-Q&A-lijn heeft GEEN geautomatiseerd replicate-mechanisme; de losstaande optimizer-/roosterengine-benchmarklijn heeft dit al wél (20 runs/fase, mean/median/worst) — dat patroon bestaat, moet alleen worden overgenomen naar de agent-kant.
- Twee aparte, allebei onvolledige manifest-implementaties bestaan (`n0-manifest.json` agent-kant, `optimizer-benchmark manifest.json` engine-kant) — een nieuw voor-manifest voor deze ronde moet het beste van beide combineren.
- Geen bevroren, doelbewust-adversarial holdout-laag voor de Lyra-agent (wel voor het kwaliteitsmodel van roosters: `contrastive-check.json`).

### Menselijke voorkeuren / kwaliteitsmodel (§7-§27) — audit compleet (agent B)
`docs/human-roster-benchmark/human-roster-design-principles.md` bestaat al en vrijwel elk cijfer uit opdracht §7-§27 is **letterlijk in de code teruggevonden, met bronvermelding en regressietest**: profielaffiniteit (voorkeur=1,0/neutraal=0,6/minder=0,2, rangorde los van getal), dienstklassegrenzen (05:30/09:00/21:00/24:00), nachtritmecurve (1..7, exact), begintijdsprong-kalibratie (73/60/150/229 min), rangeer-als-populair-maar-eerlijk, vrij-weekend+vrijdageis-met-nachtuitzondering, 40:00-cyclusgemiddelde, tijdband-blootstelling correct als PROXY gelabeld (nooit als toeslagbedrag).

**Drie concrete, nieuw vastgestelde risico's (niet eerder ergens gemeld):**
1. **MIX="Vroeg-Laat-Nacht"-alias — code presenteert dit als vaststaand (`profile-affinity.ts:54`), terwijl dit project se eigen bronmanifest (`sources/manifest.json`) het expliciet "NIET bevestigd" noemt.** Een stille inconsistentie tussen code en de eigen sourcing-discipline van het project.
2. **60-minuten klok-vs-label-overgangsdrempel is correct geïmplementeerd in `rhythm-metrics.ts`/`quality-model.ts` (flow v1/v2), maar ONTBREEKT in `roster-quality.ts`'s `categoryOf()`, dat de nieuwere v3-voorkeurslaag voedt.** Voor BLM/50+Mix (precies de profielen waar labels en klok kunnen overlappen) telt de v3-voorkeursscore een 19-minuten-verschuiving dus nog steeds als volwaardige labelwissel, terwijl het oudere flow-onderdeel dat terecht niet doet — een reële drift tussen twee actieve onderdelen van hetzelfde rapport.
3. **46-uurs-hersteldrempel na nachten wordt op 3 plekken gebruikt (CAO-regel `SOURCE_TRANSCRIBED`/niet-gevalideerd, mensen-benchmark-document expliciet `POTENTIAL`, kwaliteitsmodel-drempel `MACHINIST_PREFERENCE`) zonder centrale koppeling** — als de actuele CAO-tekst ooit een andere waarde blijkt te hebben, moeten alle drie los worden bijgewerkt.

Geen van deze drie is in deze ronde al gerepareerd — per §33/§34 (immutable BEFORE-benchmark eerst) mag er geen inhoudelijke wijziging plaatsvinden vóórdat de voor-meting is bevroren. Ze zijn hier vastgelegd als concrete, geverifieerde kandidaten voor Fase 4/9.

## LOCAL REQUIRED (al bevestigd, niet pas aan het eind)

- **Geen Ollama/qwen3:8b bereikbaar in deze cloud-omgeving.** Elke stap die het ECHTE lokale model moet draaien (Fase 1 BEFORE-benchmark, Fase 11 AFTER-benchmark, elke test van `model/local.ts`-specifiek gedrag) is `LOCAL REQUIRED`. Het bestaande harnas (`scripts/v106/golden-bench.ts --meting <naam>`) is er klaar voor — dit is één commando zodra Ollama lokaal draait, geen nieuwe code nodig om te draaien (wel eerst nog het replicate-mechanisme toevoegen, zie Fase 9/11).

## Checkpoint-regel

Zodra deze sessie moet stoppen vóór het einde van de opdracht: dit bestand bevat het exacte checkpoint. Vervolg begint bij de eerste fase die niet `COMPLETE`/`TESTED` is.
