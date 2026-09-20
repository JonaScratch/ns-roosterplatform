# Migratieplan v1.0.5

*Fase 0. Van de huidige stand naar het beschreven eindbeeld, fase voor fase, met per
fase wat er wordt hergebruikt, wat nieuw is en waaraan de fase is afgerond. De
machineleesbare voortgang staat in `progress.json`.*

## 0. Vastleggen en scheiden (deze fase)

| Stap | Stand |
| --- | --- |
| Uitgangssituatie vastgesteld uit repository, database en meetbestanden | gedaan |
| `baseline-manifest.json` met vingerafdrukken per map en per kritiek bestand | gedaan |
| Meetbasis gecontroleerd tegen het BEFORE-manifest (data, regels, machine gelijk) | gedaan |
| Testbatterij opnieuw gemeten | `test-baseline.md` |
| Stand vastleggen op een aparte, eerlijk gelabelde tak | besluit gebruiker: ja |
| Ontwikkeltak `v1.0.5` vanaf die stand | na het vastleggen |

**Regel voor de hele ontwikkeling:** geen nieuwe meetreeks starten terwijl er één loopt,
geen engineconfiguratie wijzigen tijdens een meting, en A/B-metingen draaien uit een
bevroren kopie (CP-SAT herleest het Python-model per oplossing).

## 1. Agentfundament (niveau A)

**Hergebruik:** `requirePermission` + `locationScopeFor`, `roster-quality-service`,
`quality-evaluation-service`, `candidate-results-service`, `simulation-service`,
auditlog.
**Nieuw:** `src/server/agent/` met toollaag, modeladapter (stub), sessie- en
berichtmodel, capability-model en de eerste chatschermen.

Af wanneer: de agent beantwoordt vragen over een echt Dordrechts project met echte
cijfers uit de bestaande diensten; hij kan zonder toestemming geen opdracht starten;
elke toolaanroep staat in de auditlog; de tests van niveau A (1, 5, 6, 19) slagen.

## 2. Activiteitenpaneel

**Hergebruik:** het pollpatroon van het generatiescherm, `GenerationRun.progress`,
`searchJournal`.
**Nieuw:** `AgentEvent`, het paneel zelf, de veilige stopknop (die de onderliggende
generatie meestopt) en het herstelbeeld na een herstart.

Af wanneer: een lopende opdracht is live te volgen, stoppen werkt aantoonbaar
server-side, en na een herstart klopt het beeld (tests 17, 18, 20).

## 3. Niveau B

**Hergebruik:** `startGeneration`, `startRebuild` (doelen bestaan al),
`validateCandidate`, `compareCandidates`.
**Nieuw:** feedback → intent (getypeerd), doelformulering, voorstelbeeld met
pakketbrede impact.

Af wanneer: een commissielid kan in gewone taal een probleem aanwijzen, de agent laat
kandidaten berekenen, de validator keurt ze, en het vergelijkingspaneel toont de winst
én de prijs elders (tests 2, 7, 23).

## 4. Leergeheugen

**Nieuw:** `KnowledgeItem`, `KnowledgeEvidence`, `PreferenceActivation`, zoeken op
scope en context, correctiepad met versies.
**Hergebruik:** `HumanLineReview`, `HumanPairwisePreference`, `QuarterlyFeedback` als
bewijsbronnen; de bestaande redencodes.

Af wanneer: kennis is opslaan, terugvinden, corrigeren en intrekken zonder
auditinformatie te verliezen (tests 8, 13, 21, 25).

## 5. Menselijke feedbacklus

**Hergebruik:** het beoordelingsscherm en de bestaande modellen — die nu nog leeg zijn.
**Nieuw:** de lus sluiten: beoordeling → leeritem → voorstel → volgende generatie, met
zichtbare herkomst.

Af wanneer: een goedgekeurde lokale voorkeur wordt in een volgend project teruggevonden
en toegepast binnen de bevoegdheden; niet-goedgekeurde feedback doet niets (tests 8, 12).

## 6. Niveau C

**Nieuw:** de begrensde autonome lus met plan, uitvoering, evaluatie, keuze en
stopvoorwaarden; budgetbewaking; "geen verbetering gevonden" als geldige uitkomst.

Af wanneer: tests 3, 4, 14, 15, 20 slagen en het activiteitenpaneel de echte
beslissingen toont.

## 7. Lokaal en NS-breed leren

**Nieuw:** scope-isolatie tussen standplaatsen, voorstelpad voor gedeelde kennis,
tegenstrijdige feedback naast elkaar houden.
**Aandachtspunt uit fase 0:** de standplaatssleutel is niet uniform (`depot` tegenover
`locationCode`); dat wordt hier rechtgetrokken, met migratie.

Af wanneer: tests 9, 10, 11, 12 slagen op minstens twee standplaatsdatasets.

## 8. Technische ontwikkelagent

**Hergebruik:** het bevroren-kopiepatroon, de poortenmachinerie
(`scripts/machinist/gate.ts`), de vooraf vastgelegde beslisregels, de wisselkoersen.
**Nieuw:** `EngineExperiment`, hypothesevorming uit terugkerende problemen,
sandboxuitvoering, regressieanalyse, voorstel voor menselijke review.

Eerste onderzoeksvragen liggen klaar uit v1.0.4: het weegverschil tussen solver en
kwaliteitsmodel, de concentratie van populaire diensten bij een affiniteitsterm, en de
losse nachten in korte generaties.

Af wanneer: tests 16, 24 slagen en de agent een eerder afgewezen experiment met reden
kan terugvinden (test 13-achtig, maar voor techniek).

## 9. Geïntegreerde praktijktest

De vijftien stappen uit §42 van de werkopdracht op een echt Dordrechts project,
vastgelegd met bevindingen.

## 10. Acceptatie en oplevering

Volledige testbatterij, backward compatibility, reproduceerbaarheid, rapport. Alleen
promoveren wanneer de criteria uit §53 gehaald zijn; anders eerlijk melden als
gedeeltelijk voltooid.

## Volgorde en afhankelijkheden

```
0 ─► 1 ─► 2 ─► 3 ─► 4 ─► 5 ─► 6 ─► 7
               └────────► 8 (kan na 4 parallel, maar niet tijdens een meetreeks)
                                   └─► 9 ─► 10
```

Fase 8 gebruikt dezelfde rekenmachine als fase 6; ze draaien nooit tegelijk.
