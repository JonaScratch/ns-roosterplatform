# Doelarchitectuur v1.0.5 — roosterbrein plus roosteragent

*Fase 0. Ontworpen op de bestaande architectuur (zie `architecture-current-state.md`),
met als uitgangspunt: hergebruiken wat werkt, niets dubbel bouwen, en de mens altijd
tussen voorstel en gevolg.*

## 1. Uitgangspunten

1. **De zoekmachine blijft de zoekmachine.** De agent bedenkt geen diensttoewijzingen;
   hij formuleert doelen en laat de bestaande optimizer rekenen.
2. **De validator blijft onafhankelijk.** Geen enkele agentbeslissing kan een harde
   overtreding goedpraten; de agent kan de eindvalidatie niet overslaan.
3. **Eén bron van waarheid per begrip.** Uren, profielgrenzen, kwaliteitsmaten en
   regels blijven waar ze staan. De agent leest ze; hij herimplementeert ze niet.
4. **Geen zwarte doos.** Elke agenthandeling is een gebeurtenis in de database, met
   herkomst, en elke uitleg verwijst naar vastgelegde feiten.
5. **Geen model-afhankelijke kern.** Het geheugen, de regels en de kandidaten staan in
   de eigen database. Valt het AI-model weg, dan blijft het platform werken.
6. **Provider-onafhankelijk bouwen** (besluit gebruiker, 20-09-2026): fase 1 levert een
   modeladapter met een lokale, deterministische stub. Er gaan geen gegevens naar een
   externe dienst tot de gebruiker daarover beslist; wat daarvoor nodig is, staat in
   `risk-register.md`.

## 2. Lagen

```
  UI (Next.js server components + server actions)
   │   chat · activiteitenpaneel · bevoegdhedenpaneel · vergelijken · beoordelen
   ▼
  Agentlaag  src/server/agent/
   │   orchestrator (toestandsmachine)   tools (getypeerd, met recht + scope)
   │   interpreter (feedback → intent)   explainer (uitleg uit vastgelegde feiten)
   │   memory (kennislagen)              experiments (afgeschermd)
   │   model/ (adapter: stub | extern)
   ▼
  Bestaande diensten  src/server/services/*, generation/, optimizer/, rules-engine/
   ▼
  Database (Prisma) · CP-SAT (python) · meetbestanden (docs/)
```

De agentlaag praat **alleen** via de toollaag met de rest. Geen vrije SQL, geen shell,
geen bestandsschrijven in productiepaden (§26 van de werkopdracht).

## 3. Bevoegdheden: capabilities, niveaus zijn presets

Het platform heeft al een rechtenmodel (`src/server/security/permissions.ts`). Daar komen
agentrechten bij, in dezelfde stijl:

| Capability | Betekenis |
| --- | --- |
| `agent:chat` | analyseren, uitleggen, vergelijken (niveau A, altijd aan) |
| `agent:job:create` | een generatie- of herbouwopdracht laten uitvoeren (niveau B) |
| `agent:autonomous` | meerdere rondes binnen een budget (niveau C) |
| `agent:memory:write` | feedback vastleggen in het projectgeheugen |
| `agent:preference:apply` | goedgekeurde lokale voorkeuren toepassen |
| `agent:preference:propose` | nieuwe voorkeuren ter goedkeuring voorstellen |
| `agent:crosslocation:read` | kennis van andere standplaatsen raadplegen |
| `agent:crosslocation:propose` | die kennis hier voorstellen |
| `agent:experiment:propose` | technische hypothese opstellen |
| `agent:experiment:run` | afgeschermd experiment draaien |

Niveau A/B/C zijn **presets** die een set capabilities aanzetten; elke capability blijft
los aan of uit te zetten (§5 van de werkopdracht). Publiceren en definitief goedkeuren
zijn géén agentcapability — die blijven bij `roster:publish` van een mens.

Per project legt `AgentCapabilityGrant` vast: welke capabilities, door wie verleend,
met welke grenzen (maximaal aantal rondes, rekentijdbudget, toegestane strategieën,
welke roosters/regels met rust gelaten moeten worden). De agent kan die grenzen niet
zelf verruimen: de orchestrator leest ze bij elke stap opnieuw uit de database.

## 4. Nieuwe gegevensmodellen

Naast de bestaande (`GenerationRun`, `CandidateRoster`, `HumanLineReview`,
`HumanPairwisePreference`, `RosterCommitteeAdjustment`, `AuditLogEntry`):

| Model | Waarvoor |
| --- | --- |
| `AgentSession` / `AgentMessage` | het gesprek per project, met de UI-context waarop het slaat |
| `AgentJob` | één opdracht: doel, toestand, ronde, budget, momentopname van de capabilities, stopreden |
| `AgentJobRound` | per ronde: hypothese, gekozen strategie, gestarte `GenerationRun`, uitkomst, oordeel |
| `AgentEvent` | de activiteitenlog die het paneel toont (de auditlog blijft het formele spoor) |
| `KnowledgeItem` | één leeritem: type, scope, status, herkomst, bewijs, bevestigingen, tegenvoorbeelden, geldigheid, versie, opvolger |
| `KnowledgeEvidence` | koppeling van een leeritem aan kandidaten, beoordelingen, runs of experimenten |
| `PreferenceActivation` | welke kennis actief is voor welk project/standplaats, door wie goedgekeurd |
| `EngineExperiment` | onderzoeksvraag, hypothese, vooraf vastgelegde acceptatiecriteria, configuratie, uitkomst, oordeel |

**Scope** van een `KnowledgeItem`: `PROJECT` · `LOCATION` · `NETWORK` (NS-breed) ·
`ENGINE` (technisch). **Status**: `HYPOTHESIS` → `PROPOSED` → `APPROVED_LOCAL` →
`APPROVED_NETWORK`, met zijpaden `DISPUTED`, `SUPERSEDED`, `WITHDRAWN`. Statusovergangen
zijn handelingen van een bevoegd mens, geen berekening van de agent.

**Toepasbaarheid** wordt expliciet gecontroleerd: een leeritem draagt de
dienstpakketversie, de profielstructuur en de roosterperiode waarin het ontstond. Wijkt
de nieuwe situatie af, dan verschijnt het als *mogelijk relevant*, niet als actief.

## 5. De toollaag

Getypeerde functies (zod-contract), elk met: vereiste capability, standplaatsscope,
validatie, auditregel, en een expliciet effect. Eerste set:

*Lezen:* `getRosterProject`, `getBaseRoster`, `getRosterLine`, `getDutyInstance`,
`getCandidate`, `compareCandidates`, `getQualityReport`, `getRuleSet`,
`getApprovedPreferences`, `searchKnowledge`, `getOptimizationStatus`.

*Schrijven (met capability):* `recordFeedback`, `proposeKnowledgeItem`,
`createOptimizationJob`, `cancelOptimizationJob`, `submitCandidateForReview`,
`proposeEngineExperiment`, `runEngineExperiment` (alleen in de sandbox).

De tools leveren **gestructureerde objecten**, geen tekst: de agent krijgt dienstinstanties
met echte kloktijden per weekdag, nooit een dienstnummer als categorie.

## 6. De orchestrator

Toestandsmachine, persistent per `AgentJob`, precies de stappen uit §25 van de
werkopdracht. Eigenschappen:

- **Idempotent**: elke ronde heeft een sleutel; herstart voert niets dubbel uit.
- **Herstelbaar**: bij herstart is te zien welke ronde liep en of doorgaan veilig is;
  een halve ronde levert nooit een goedgekeurde kandidaat.
- **Begrensd**: rondes, rekentijd en toegestane strategieën komen uit de grant.
- **Stopbaar**: stoppen zet zowel de agentjob als de onderliggende `GenerationRun` stop
  (bestaande `cancelGeneration`), en de agent mag daarna geen nieuwe ronde starten.
- **Eerlijk**: "geen betere kandidaat gevonden" is een geldige uitkomst.

## 7. Uitleg zonder verzinsels

De explainer bouwt uitleg uit vastgelegde feiten: het kwaliteitsrapport (per onderdeel
en per regel), het zoekjournaal van de `GenerationRun`, de solverstatistiek, de
validatorbevindingen, het verschil tussen twee kandidaten en de geraadpleegde
leeritems. Het taalmodel formuleert; het verzint geen oorzaak. Kan een oorzaak niet uit
de gegevens worden afgeleid, dan zegt de agent dat met zoveel woorden.

## 8. De experimenteeromgeving

Hergebruik van wat in de vorige rondes werkte: een **bevroren codekopie** met eigen
benchmarkmap (zoals `ns-roosterplatform-mp2`), gestart als apart proces. Daar bovenop:

- `EngineExperiment` legt vóór uitvoering de acceptatiecriteria vast (zoals
  `decision-rules.json` in de vorige rondes) en na afloop de uitkomst;
- de vergelijking draait op dezelfde datasets en dezelfde poorten als de baseline;
- promotie naar productie is een aparte menselijke handeling; de agent kan het alleen
  voorstellen.

## 9. Wat bewust niet wordt gebouwd

- Geen tweede urenberekening, tweede validator of tweede optimizer.
- Geen vrije databasetoegang of shell voor de agent.
- Geen geheugen dat alleen uit embeddings bestaat; zoeken mag semantisch zijn, maar
  scope, status en goedkeuring staan in kolommen.
- Geen automatische promotie van kennis naar NS-breed, en geen automatische overname
  tussen standplaatsen.
- Geen individuele persoonsgegevens in het leergeheugen zonder functionele noodzaak.
