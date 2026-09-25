# Benchmarkformaat

## Vragensets

`demo-room/src/benchmark/questions/{dev,holdout,hidden}.json`, in het formaat
dat `benchAnswer()` (hoofdapp, `src/server/agent/bench-adapter.ts`) al
beoordeelt:

```json
{
  "id": "DR-DEV-01",
  "prompt": "beurt 1|beurt 2 (met | gescheiden bij meerdere beurten)",
  "context": { "source": "official" | "candidate", "rosterCode": "...", "actorRole": "EMPLOYEE" (optioneel) },
  "expect": { "kind": "deterministic" | "behaviour" | "memory_recall", "behaviour": "..." },
  "note": "menselijke toelichting/grondwaarheid"
}
```

`kind: "deterministic"` vergt een `expected`-waarde en een `check`-type
(`line_duties`, `duty_times`, `night_lines`, `rangeer_counts`,
`hours_average`, `rule_value`) die tegen echte databasewaarden wordt
gehouden — zie `beoordeelDeterministisch()` in de hoofdapp. De Demo Room
gebruikt dit type in v0.1 nog niet: dat vergt ground truth die alleen tegen
een draaiende lokale database te verifiëren is (LOCAL REQUIRED), en een
verzonnen verwachte waarde zou §33 van de opdracht schenden ("nooit fictieve
resultaten"). **Aanbevolen vervolgstap voor Jonathan/Lyra lokaal:** voeg
`deterministic`-items toe nadat de echte waarden zijn nagekeken (bijvoorbeeld
via `npx tsx --conditions=react-server scripts/verify-rooster.ts` of een
directe Prisma-query), en breid de sets uit.

`kind: "behaviour"` (wat de v0.1-sets nu gebruiken) heeft geen
databasewaarden nodig — het toetst gedrag: doorvragen, weigeren, een valse
aanname corrigeren, een ontbrekende bron toegeven. Zie
`beoordeelGedrag()` in de hoofdapp voor de volledige lijst geldige
`behaviour`-waarden.

## Waarom drie sets, en waarom dev/holdout/hidden apart blijven van de golden suite

`docs/v1.0.6/golden-suite.json` (43 items) is de meetlat van het lopende,
parallelle N0/N1/R2-ontwikkelspoor van de hoofdapp zelf en blijft
onaangeroerd (zie `ARCHITECTURE.md`). De Demo Room-sets zijn nieuw en klein
(v0.1), met een eigen naamgeving (`DR-DEV-*`, `DR-HOLD-*`, `DR-HIDDEN-*`):

- **dev**: gebruikt tijdens het ontwikkelen/vergelijken van een variant.
- **holdout**: nooit tijdens het ontwikkelen gebruikt — alleen om te
  bevestigen dat een verbetering ook buiten de dev-vragen werkt (§15).
- **hidden**: nog kleiner, expres niet als voorbeeld in een systeeminstructie
  of variant-tekst geciteerd — voorkomt dat alleen de zichtbare opdracht
  wordt geoptimaliseerd (§8/§15). Groei dit lokaal, buiten deze repo's
  geschiedenis als het gevoelig wordt (bijvoorbeeld door het los te houden
  van commits die de variant zelf beschrijven).

## PRE/POST en run-variance (§16/§17)

`demo-room/src/benchmark/run.ts`: `runSuite()` voor één meting,
`runSuiteWithVariance()` voor N herhalingen met min/max/gemiddelde/
standaardafwijking — nooit de beste run cherry-picken. `flippedItemIds` is in
v0.1 nog leeg (zie `ARCHITECTURE.md`, "wat bewust niet is gebouwd").

## Pareto-analyse (§11)

`demo-room/src/benchmark/pareto.ts`: `paretoFront()` neemt kandidaten met
metrics en een `higherIsBetter`-richting per metric (`true`/`false`/`null`
voor "telt niet mee in dominantie"). Een kandidaat domineert een andere alleen
als hij op **alle** metrics minstens gelijk is én op minstens één strikt
beter — twee kandidaten die elk op iets anders winnen, staan allebei op het
front. Voor echte roosterkwaliteit: gebruik de `higherIsBetter`-richtingen uit
`METRICS` in de hoofdapp (`scripts/benchmark/evaluate.ts`) in plaats van ze
te verzinnen.
