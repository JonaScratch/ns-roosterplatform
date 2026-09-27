# Lyra Master Program — voortgang

Bijgewerkt: 2026-09-28 (vervolgronde: "VERVOLG MASTER PROGRAM — NIET AFRONDEN NA FASE 0"). Zie `docs/lyra-knowledge/` voor alle output van deze ronde.

Dit document volgt §106 (werkwijze) en §108 (als de opdracht te groot is voor één uitvoering) van de opdracht. Status per fase: `NOT_STARTED` / `IN_PROGRESS` / `BLOCKED` / `TESTED` / `COMPLETE`.

## Uitgangssituatie (Fase 0, vastgesteld)

- **Branch**: `claude/admiring-edison-5y65j7`
- **HEAD bij start van Fase 0**: `6398e13` (Demo Room v0.9)
- **Bevroren BEFORE-codebaseline**: commit `588c1e5` ("Lyra Master Program — Fase 0: volledige inventaris bestaande kennisarchitectuur") — vastgelegd door de gebruiker als het punt waartegen de lokale BEFORE-run moet draaien. Alle latere commits in dit document (Stap 1-3 hieronder) zijn documentatie/tooling/pin-tests die het BEFORE-agentgedrag niet veranderen (zie per commit hieronder de expliciete "geen gedragswijziging"-motivatie).
- **Commits `2cd863e`, `4e489b7`, `6398e13` geverifieerd aanwezig**: JA.
- **Versienummering (v1.0.x)**: geverifieerd correct (pure stringtemplating, regressietest v1.0.9→v1.0.10 aanwezig sinds `6398e13`).

**BELANGRIJKSTE ONTDEKKING VAN FASE 0**: dit is geen "bouw het canonieke kennissysteem vanaf nul"-opdracht. Er bestaat al een zeer volwassen, goed gedocumenteerde infrastructuur. De opdracht van deze ronde is dus vooral: **reconciliatie, het dichten van specifieke, nu concreet vastgestelde gaten, en één keer een eerlijke voor/na-meting** — niet "bouw dit allemaal opnieuw".

## Commits deze ronde (chronologisch)

| Commit | Inhoud |
|---|---|
| `588c1e5` | Fase 0: volledige inventaris (4 rapporten) — **de bevroren BEFORE-baseline** |
| `798ffba` | Stap 1: `run-before-local.ps1` + `scripts/lyra-master/before-manifest.ts` + `aggregate-replicates.ts` |
| `44b61bb` | Fase 2/3/9: source-coverage, rule-audit, preference-audit, human-pattern-audit, conflict-report, knowledge-gap-report, migration-report, knowledge-model.md + `canonical-status.ts`, golden-suite-extensie (categorieën L, O) |
| `aa1f59f` | Fase 8/9/13-voorbereiding: `claim-verification.ts` + tests, `known-gaps-pin.test.ts` (3 gaten gepind), `promotion-contract.md` |
| *(volgt)* | Fase 12-voorbereiding: `adversarial-holdout-design.md` (loopt, achtergrondagent) |

Elke commit hierboven is getypecheckt en getest (volledige vitest-suite) vóór commit — zie de individuele commitberichten voor exacte cijfers.

## Fasetracker

| Fase | Omschrijving | Status | Notities |
|---|---|---|---|
| 0 | Snapshot + inspectie | **COMPLETE** | 4 inventarisatierapporten, bronverificatie (`npm run verify:bronnen`, 8/8). |
| 1 | Immutable BEFORE-benchmark | **BLOCKED (LOCAL REQUIRED)** — tooling COMPLETE | Geen Ollama in deze cloud-omgeving. `run-before-local.ps1` + `before-manifest.ts` + `aggregate-replicates.ts` volledig gebouwd, getypecheckt, syntax-gevalideerd (PowerShell-parser) — nooit end-to-end uitgevoerd (LOCAL REQUIRED). Zie onderaan voor het exacte commando. |
| 2 | Kennis/bron-inventaris | **COMPLETE** | 4 fase-0-rapporten + source-coverage.md + rule-audit.md + preference-audit.md + human-pattern-audit.md. |
| 3 | Canonical model / migratie | **ONTWERP COMPLETE, UITVOERING NOT_STARTED** | `knowledge-model.md` (ontwerp) + `src/server/knowledge/canonical-status.ts` (additieve projectielaag, 13 tests) gebouwd. `migration-report.md`: expliciet een plan, niets gemigreerd. |
| 4 | Rules/source-consolidatie | **NOT_STARTED (bewust)** | Elke inhoudelijke regelwijziging wacht op de BEFORE-freeze (§33/§34). Kandidaten al concreet vastgelegd in `conflict-report.md`/`knowledge-gap-report.md`. |
| 5 | Menselijke voorkeuren-consolidatie | **AUDIT COMPLETE** | `preference-audit.md` + `human-pattern-audit.md`: vrijwel alles uit §7-§27 al correct geïmplementeerd en gesourced; 2 concrete risico's gevonden (MIX-alias, 60-min-drempel) — zie hieronder. |
| 6 | Officiële menselijke roosterpatronen-consolidatie | **COMPLETE (bevestigd, niet opnieuw gebouwd)** | 7 roosterbladen al volledig geparsed (223 diensten, 0 discrepanties), herbevestigd. |
| 7 | Agent retrieval/tool/grounding-integratie | **GAT GEPIND, REPARATIE NOT_STARTED** | `memoryProposal`-gat aangetoond en gepind (`tests/knowledge/known-gaps-pin.test.ts`) — niet gerepareerd (wacht op BEFORE-freeze). |
| 8 | Claim-verificatie | **DETECTOR COMPLETE, NIET AANGESLOTEN** | `claim-verification.ts` + 15 tests gebouwd — bewust NIET aangeroepen vanuit `agent.ts` (zou BEFORE-gedrag veranderen). |
| 9 | Regressiesuite uitbreiden | **GEDEELTELIJK COMPLETE** | `jsonUit()`-test (commit `588c1e5`, 8 tests) + golden-suite-extensie (categorieën L, O, geschreven maar NOOIT gedraaid — DB ontbreekt hier) + 3 pin-tests voor bekende gaten. |
| 10 | Kennisconsistentie + broncoverage | **DEELS COMPLETE** | `source-coverage.md` bestaat. Een geautomatiseerde, doorlopende cross-component-consistency-checker (§47) is ONTWERP-only (zie conflict-report.md) — niet gebouwd. |
| 11 | AFTER-benchmark | **BLOCKED (LOCAL REQUIRED)** | Afhankelijk van Fase 1 — kan pas na de lokale BEFORE-run. |
| 12 | Locked holdout/adversarial | **IN_PROGRESS** | `adversarial-holdout-design.md` wordt geschreven (achtergrondagent, loopt bij het schrijven van dit document). |
| 13 | Promotion-compatibiliteitstest | **CONTRACT COMPLETE, TEST NOT_STARTED** | `promotion-contract.md`: criteria + brain-manifest-ontwerp + cross-system-adapterontwerp. Een daadwerkelijke compatibiliteitstest tegen het echte NS-platform is buiten de zichtbaarheid van deze ronde (geen toegang tot dat platform). |
| 14 | Eindrapport + commits | **IN_PROGRESS** | Dit document + het antwoord aan het einde van deze beurt zijn het tussentijdse eindrapport; commits lopen door zolang er onafhankelijk werk is. |

## Concrete, al bevestigde bevindingen

### Bronstatus (§5, §49)
- **CAO 2024-2025 aanwezig, machineleesbaar, maar verlopen** voor de geauditeerde periode (okt-dec 2026) — `CAO_CURRENCY_CONFIRMATION` staat al als blokkerend punt in de code. **SOURCE_INPUT_REQUIRED.**
- **Roosterkaders Regio West 2026**: scan zonder tekstlaag; deze sessie maakte een VOORLOPIGE beeld-transcriptie (`roosterkaders-regio-west-2026-DRAFT-TRANSCRIPTIE.md`) — `HUMAN_REVIEW_REQUIRED`, niet machinaal geverifieerd.
- **`BDU DDR Oktober 2026.docx`** bevat geen dienstgegevens.
- **MISSING_PACKAGES: 10 regelpakketten** (gecorrigeerd — Fase-0 zei eerst 9; directe telling in `regio-west-2026.ts` door de source-coverage-agent gaf 10). Zie `knowledge-gap-report.md` voor alle 10 met hun exacte `reason`-tekst.

### Rules engine (§3, §4)
- 71 regels, 9-lagen `RuleLayer`-hiërarchie, `RuleStatus`-enum, `resolveRule()`-conflictoplossing.
- `FORMALLY_VALIDATED: 0/71`. `IMPLEMENTED: 57/71` (14 `IMPLEMENTATION_GAP`-regels). **`TESTED`: gecorrigeerd naar 57/71 bij hertelling** (het gecommitte `docs/rule-coverage.md` was verouderd met 26/71 — het verschil is vastgelegd, het bestand zelf niet stilzwijgend overschreven, zie `rule-audit.md`/`source-coverage.md`).
- **3 parallelle, elkaar niet kennende statusmodellen** — nu verzoend via een additieve projectielaag (`canonical-status.ts`), NIET vervangen.
- **Onopgelost, met naam benoemd**: CP-SAT weegt een losse nacht ~27× lichter dan het kwaliteitsmodel.

### Memory/grounding/tools (§28, §29, §46)
- RET/rangeer-woordenboek: structureel gefixt, gedeeld tussen stub en lokaal model.
- **`memoryProposal` werkt alleen in de stub** — GEPIND (`known-gaps-pin.test.ts`, incl. een gemockte end-to-end-aantoning dat `plan()` het veld laat vallen ook als het model het zelf teruggeeft). Nog niet gerepareerd.
- **`jsonUit()`**: was ongetest, nu gedekt (8 tests, commit `588c1e5`).
- **Onbevestigde autoriteitstaal**: was ongecontroleerd, nu een losse, niet-aangesloten detector (`claim-verification.ts`, 15 tests) — aansluiten op `agent.ts` is Fase-8-vervolgwerk NA de BEFORE-freeze.
- Geen automatische detector voor "instemmen met foutieve gebruikersaanname"; geen contradictiedetectie tussen geheugenitems — beide nog open (`knowledge-gap-report.md`).

### Benchmark-infrastructuur (§28.15, §28.16, §41)
- Golden suite: 43 items (35 dev/8 holdout), bevroren, ongewijzigd.
- **Golden-suite-extensie gebouwd** (categorieën L "roostervergelijking", O "nachtreeksen"), volledig gegrond op `waarheid.ts` (incl. een nieuwe, additieve `nachtreeksLengtePerRooster()`-export) — **NOOIT uitgevoerd**: vereist een levende ontwikkeldatabase, die in deze cloud-omgeving niet beschikbaar is (zie "Omgevingsblokkade" hieronder). Draait automatisch mee in `run-before-local.ps1` (stap 5) zodra de gebruiker die lokaal draait.
- Replicate-mechanisme voor de agent-Q&A-lijn: gebouwd (`run-before-local.ps1` draait N replicaten, `aggregate-replicates.ts` telt item-agreement en mean/median/worst) — nog nooit uitgevoerd (LOCAL REQUIRED).
- Geen bevroren adversarial-holdout-laag voor de agent — ONTWERP loopt (`adversarial-holdout-design.md`, Fase 12, achtergrondagent).

### Menselijke voorkeuren / kwaliteitsmodel (§7-§27)
Vrijwel elk cijfer uit §7-§27 letterlijk teruggevonden in code, met bronvermelding en regressietest. Twee concrete risico's, GEPIND (niet gerepareerd):
1. **MIX="Vroeg-Laat-Nacht"-alias** — presenteert zich in code als vaststaand terwijl het eigen bronmanifest "NIET bevestigd" zegt.
2. **60-minuten klok-vs-label-drempel ontbreekt in `categoryOf()`** (v3-voorkeurslaag) — BLM/50+Mix scoren inconsistent tussen twee actieve onderdelen van hetzelfde rapport.
3. (Niet gepind, wel gedocumenteerd) 46-uurs-hersteldrempel op 3 losse plekken zonder centrale koppeling.

## Omgevingsblokkade — precies vastgelegd

Bij het proberen op te lossen van "geen Ollama hier" is óók geprobeerd een lokale ontwikkeldatabase (`embedded-postgres`, al een dependency van dit project) in deze cloud-omgeving op te zetten, om in elk geval de golden-suite-extensie met echte cijfers te kunnen vullen zonder op Ollama te hoeven wachten. `initdb` weigert als root te draaien (een ingebouwde PostgreSQL-veiligheidsgrens), en de omgeving zelf weigerde een `chown`/gebruikerswissel om dat op te lossen ("Security Weaken"/"Irreversible Local Destruction" — een terechte grens, niet omzeild). Op de eigen Windows-pc van de gebruiker (gewone, niet-root-gebruiker) bestaat dit specifieke obstakel niet.

## LOCAL REQUIRED — samengevat, met het exacte commando

**Wat**: de immutable BEFORE-benchmark (Fase 1) tegen het echte lokale model, en daarmee ook Fase 11 (AFTER) en elke test die specifiek `model/local.ts`-gedrag via een echte Ollama-aanroep verifieert.

**Waarom hier niet uitvoerbaar**: geen Ollama bereikbaar in deze cloud-omgeving; geen levende ontwikkeldatabase (zie hierboven).

**Wat al klaar staat**: `run-before-local.ps1` (repository-root) — controleert commit `588c1e5`, Ollama, database, stub-uitschakeling; regenereert de golden-suite-extensie met echte cijfers; genereert een gecombineerd voor-manifest; draait de bevroren 43-item suite (en de extensie) N keer; beoordeelt en aggregeert; schrijft één `BEFORE-VERIFICATION.json`.

**Het ene commando**:
```powershell
cd "C:\Users\Jonathan Schram\ClaudeCode\ns-roosterplatform-demo-room"
.\run-before-local.ps1
```

## Checkpoint-regel

Zodra deze sessie moet stoppen vóór het einde van de opdracht: dit bestand bevat het exacte checkpoint. Vervolg begint bij de eerste fase die niet `COMPLETE`/`TESTED` is — vandaag is dat Fase 12 (adversarial-holdout-ontwerp, loopt) en, zodra de gebruiker het lokale commando heeft gedraaid, Fase 1/11 (BEFORE/AFTER).
