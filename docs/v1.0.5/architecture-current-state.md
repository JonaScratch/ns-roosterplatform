# Huidige stand van het platform — uitgangspunt voor v1.0.5

*Fase 0 van de v1.0.5-werkopdracht. Vastgesteld op 20 september 2026 door de repository,
de database en de meetbestanden te lezen — niet door eerdere rapporten over te nemen.
Machineleesbaar: `baseline-manifest.json` in deze map (opnieuw te maken met
`npx tsx --conditions=react-server scripts/v105/baseline-manifest.ts`).*

## 1. Versie en vastlegging

| Wat | Stand op 20-09-2026 |
| --- | --- |
| Laatste commit | `e2b2091` "Benchmarkharnas voor de optimizer en de werkelijke zaadwaarde in de solverstatistiek" |
| Tags | `v1.0.2`, `v1.0.3` |
| `package.json` | 1.0.3 |
| Niet vastgelegd in Git | 86 paden (v1.0.4, menselijke ijking, Final Brain, machinistenronde) |
| Zoekmachine in de code | `adaptive-1.0.4-machinist` |

**Dit is de belangrijkste bevinding van fase 0.** De code van v1.0.4 en van alle
ontwikkelrondes daarna bestaat alleen in de werkmap. Er is dus geen commit die de code
bevat *zoals die was tijdens de metingen*. Een commit die vandaag "v1.0.4" heet, zou de
code van vandaag zijn. De werkopdracht waarschuwt daar expliciet voor (§2.2); dit
document en `baseline-manifest.json` leggen daarom vast wat er nú staat, met
vingerafdrukken per map en per kritiek bestand.

Wat wél reproduceerbaar is: de **meetbasis**. Een vandaag gemaakt manifest komt exact
overeen met het BEFORE-manifest van 17 september: zelfde dienstpakket, zelfde
profielconfiguratie, zelfde regelbestand, zelfde machine, zelfde Python (3.11.1) en
OR-Tools (9.15.6755). Alleen `git.dirty` verschilt.

## 2. De drie bestaande intelligenties

### 2.1 De roosterengine

- **CP-SAT-model** in `python/cpsat_roster.py`, per oplossing opnieuw gelezen door
  `src/server/optimizer/cpsat-solver.ts`. Harde eisen als uitsluiting (één dienst per
  dienstdag, dienstinstantie hooguit één keer, rust, aaneengesloten diensten,
  profielgrens, de operationele eisen van de gebruiker), de rest als kostenpost.
- **Adaptieve zoekmachine** in `src/server/generation/adaptive/`: meerdere starts,
  gerichte reparatie, diversificatie, bijschaven met ruildiensten
  (`src/domain/roster-polish.ts`), rangschikking op het kwaliteitsmodel.
- **Profielen** (`variant.ts`, omschakelbaar met `NS_ENGINE_PROFILE` /
  `NS_ENGINE_VARIANT`):
  - `machinist` — standaard sinds de machinistenronde: ritmeprofiel plus de harde
    operationele eisen (roostergemiddelde ≤ 40:00, vrijdag vóór een vrij weekend);
  - `rhythm` — de Final-Brain-stand, vastgepind op kwaliteitsmodel v2;
  - `frozen-1.0.4` — exact v1.0.4 (model v1, geen ritmetabel, geen slechtste geval).
- **Kwaliteitsmodellen**: v1 (bevroren), v2 (menselijke ijking, waarop de zoekmachine
  rangschikt), v3 (voorkeurslaag + operationele eisen als harde geldigheid). Alle drie
  staan als afdruk in `configs/`.

### 2.2 De onafhankelijke validator

`src/server/rules-engine/` met `final-validator.ts` als eindpoort. Regels hebben een
bron en een juridische status (`SourceLegalStatus`); het actieve regelbestand is
`2026.1-cao-2024-2025-transcribed` met status "niet formeel bevestigd". De validator
draait ná de zoekmachine en is niet te omzeilen: een kandidaat die hij afwijst, wordt
niet bewaard. De operationele eisen van de gebruiker staan bewust **niet** in de
regelmotor maar in `src/domain/operational-requirements.ts`, met eigen bronstatus
`USER_PROVIDED_OPERATIONAL_DESIGN_REQUIREMENT`.

### 2.3 De mens

Er is nog geen AI-laag. De roostercommissie stuurt de zoekmachine via het scherm
*Genereren* (strategie, rekentijdmodus) en via *Herbouw* met doelen
(`RosterCommitteeAdjustment.goals`). Beoordelen gebeurt op het simulatiescherm.

## 3. Hoe een opdracht nu loopt

```
scherm → server action (acties.ts) → service (requirePermission + locationScope)
       → GenerationRun in de database  → runGenerationJob (achtergrond)
       → adaptieve pipeline → CP-SAT (python) → evaluator → bijschaven
       → eindvalidatie (rules-engine) → kandidaten opgeslagen
       → scherm pollt (router.refresh) → voortgang uit GenerationRun.progress
```

Eigenschappen die v1.0.5 kan hergebruiken:

- **Achtergrondopdracht met hartslag**: `GenerationRun` houdt status, stage,
  stageMessage, progress, log, searchJournal, counters bij.
- **Server-side stoppen**: `cancelGeneration` zet `cancelRequested`; de job pollt dat en
  breekt af via een `AbortController`. Geen schijnknop.
- **Onderbroken opdrachten**: opdrachten zonder hartslag worden gemarkeerd als
  onderbroken (`generation-service.ts`).
- **Eén actieve opdracht per standplaats**: `ActiveGenerationError`.
- **Herkomst per kandidaat**: `CandidateRoster` bewaart hash, solverRun, provenance,
  validatiestatus en het gebruikte model.

## 4. Rechten en standplaatsen

- Rollen: `EMPLOYEE`, `ROSTER_COMMITTEE`, `DUTY_ASSIGNMENT`, `ADMIN`.
- Daaronder ligt al een **capability-model**: `src/server/security/permissions.ts` kent
  losse rechten (`roster:generate`, `roster:publish`, `roster:compare`, `audit:read`, …)
  die per rol worden toegekend, met `requirePermission()` aan de serverkant.
- **Standplaatsen bestaan al in de gegevens**: 41 `StationLocation`-rijen, waarvan
  Dordrecht de enige is met `planningEnabled` en `optimizerMode = SIMULATION`; Rotterdam
  bestaat (regio WEST) maar staat uit. `locationScopeFor()` begrenst elke handeling.
- **Aandachtspunt**: de koppeling aan een standplaats is niet overal hetzelfde.
  `BaseRoster` heeft een `depot`-tekst, `DutyPackage` heeft `depot` én `locationId`,
  `GenerationRun` en `CandidateRoster` hebben `locationCode`. Voor het scheiden van
  geheugen per standplaats is één sleutel nodig.

## 5. Gegevens die er zijn

| Object | Aantal |
| --- | --- |
| Standplaatsen | 41 (Dordrecht actief) |
| Basisroosters Dordrecht | 7, samen 64 regels, alle ACTIVE |
| Dienstpakket | `DDR-BDU-05-10-2026-V1`, 223 diensten, ACTIVE |
| Roosterperioden | 1 |
| Kandidaten | 28 |
| Generatieopdrachten | 17 (12 COMPLETED, 5 CANCELLED) |
| Kwartaalfeedback | 16 |
| Regeloordelen (`HumanLineReview`) | **0** |
| Paarvergelijkingen (`HumanPairwisePreference`) | **0** |
| Gebruikers | 67 |

De modellen voor menselijke beoordeling bestaan dus al — mét redencodes, notitie,
beoordelaar en de gebruikte modelversies — maar er staat nog geen enkele echte
beoordeling in. De menselijke-ijkingsronde is met scripts gedaan, niet via het scherm.
Dat is precies de leegte die v1.0.5 moet vullen.

## 6. Meetbestanden en reproduceerbaarheid

- 20 benchmarkfasen in `docs/optimizer-benchmark/` (before, after, human, human-dev1,
  zeven ablaties, brain-after, mp-m1, mp-m2, mp-after, mp-x13, …), elk met runbestanden
  die manifest-hash, engineversie en variant dragen.
- `docs/v1.0.4-final-brain/` en `.../machinist-preferences/` bevatten de beslisregels
  (vooraf vastgelegd), de metingen per fase, de poorten en de rapporten.
- Drie bevroren codekopieën met vingerafdruk (`-ablatie`, `-mp`, `-mp2`) waaruit de
  A/B-metingen zijn gedraaid, omdat CP-SAT het Python-model per oplossing herleest.

## 7. Wat op dit moment rood staat

| Onderwerp | Stand |
| --- | --- |
| Final-Brain-poorten | 12 van 16 — geen reviewpakketten |
| Machinistenpoorten | 18 van 19 — eerlijkheid −0,55 tegen marge 0,5, geen reviewpakketten |
| Voorkeurswinst | Niet aangetoond: beide voorkeursmechanismen vielen af op hun vooraf vastgelegde marges |
| Testbatterij | Zie `test-baseline.md` (opnieuw gemeten in fase 0) |
| Losse nachten | Een door de applicatie gegenereerde kandidaat had er één; in de AFTER 0,23 per kandidaat tegen 0,13 in de baseline (niet significant, wel de verkeerde kant op) |
| Crashproef | Laat soms `io_worker`-processen van Postgres 18 achter die de poort bezet houden; apart voorgesteld als taak |

## 8. Technische schuld die v1.0.5 raakt

1. **Geen versiebeheer over de metingen heen** (§1). Wordt in fase 0 opgelost door de
   stand vast te leggen op een aparte, eerlijk gelabelde tak.
2. **Geen API-laag**: alles loopt via server actions. Een agent heeft een expliciete,
   aanroepbare toollaag nodig; die moet naast de bestaande services komen, niet eroverheen.
3. **Standplaatssleutel niet uniform** (§4).
4. **Menselijke beoordeling ongebruikt** (§5): de modellen bestaan, de schermen deels,
   maar er is geen werkende lus van beoordeling naar volgende generatie.
5. **Solver en kwaliteitsmodel wegen verschillend** (Final Brain, hoofdstuk 12 en 34 van
   het rapport): een losse nacht weegt in CP-SAT ongeveer 27× lichter dan in het model.
   Dit is de belangrijkste openstaande technische vraag die de agent in fase 8 mag
   onderzoeken.
6. **Testproces laat processen achter** (crashproef, zie §7).
7. **Eén actieve generatie per standplaats**: een autonome lus moet daar rekening mee
   houden; parallelle analyse mag, parallel genereren niet.
