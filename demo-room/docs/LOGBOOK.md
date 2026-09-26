# Het Demo Room-logboek

Zie `demo-room/src/store/logbook.ts`. Zie ook `README.md` voor de scheiding
tussen logboek/journaal/rapport/HANDOFF.

## Bestanden

Per run: `demo-room/logs/<runId>.txt` (menselijk, downloadbaar, kopieerbaar)
en `demo-room/logs/<runId>.jsonl` (machineleesbaar, één event per regel).
Beide staan lokaal (net als `demo-room/data/`, zie `.gitignore`) — hoog
volume, per installatie, niet in de broncode-geschiedenis.

## Wanneer een regel geschreven wordt

Elke "echte run" via de CLI (`run-challenge`, `autonomous`, `proof-of-value`,
`benchmark`, `publish`, `rollback` — zie `cli.ts`'s `withRunLogbook()`)
schrijft automatisch:

1. Een `RUN_START`-header (production-versie, sandbox-parent, model/config,
   challenge/doel) — vóórdat er iets anders gebeurt.
2. Eén regel per betekenisvolle stap, geschreven door de module die de stap
   zelf uitvoert (`proof/proofOfValue.ts`, `publish/safePublish.ts`,
   `research/autonomousRun.ts`, `challenges/engine.ts`) — inclusief
   afwijzingen, overgeslagen experimenten, bereikte budgetten, ongeldige
   kandidaten en fouten. Nooit stil.
3. Een afsluitend `RUN_COMPLETED`/`RUN_FAILED`/`RUN_INTERRUPTED`-blok, ook bij
   een Stop-klik (SIGINT/SIGTERM, zie `withRunLogbook()`) of een crash
   (elke regel wordt synchroon weggeschreven — zie hieronder).

`--run-id <id>` (CLI) laat het logboek van een losse terminal-aanroep
aansluiten bij een run die al door het dashboard is gestart — zonder dit
genereert elk commando er zelf één.

## Crash-safe

`logbook.log()` is een synchrone `appendFileSync` per aanroep: geen buffer,
geen batch. Een crash na 47 minuten kost hooguit de laatst onvoltooide regel.

## Redactie

`redact()` filtert wachtwoorden, tokens, API-keys en connection strings vóór
er iets naar schijf gaat — centraal, niet per aanroepplek. Geen ruwe
modelredenering (chain-of-thought) wordt gelogd; wel een korte operationele
hypothese ("Hypothese: candidateLabel overschrijft ten onrechte
baseRoster.").

## Flight-recorder-granulariteit (per benchmarkitem)

`scoreSuiteItems()` (`benchmark/agentQuality.ts`) logt, wanneer een caller een
`BenchmarkLogContext` meegeeft (proof-of-value doet dit altijd), per item de
volledige keten: `BENCHMARK_ITEM_START` (prompt, verwacht gedrag) →
`CONTEXT_BEFORE` (input-context, verwachte tools) → `AGENT_EXECUTION_START`
(model, aantal beurten) → `TOOL_DECISION` → per aanroep `TOOL_CALL`/
`TOOL_RESULT` (tool, input, ok/ms) → `AGENT_RESPONSE` (antwoord, bronnen) →
`BENCHMARK_ITEM_GRADE` (verwacht vs. gegradeerd, reden) → `BENCHMARK_ITEM_END`.
`runContextResolutionCheck()` logt zo per beurt een `CONTEXT_TURN`-event. Geen
enkel item slaat hierdoor nog stil over — een log mag hierdoor groot worden
(tienduizenden regels bij een lange run); er is bewust geen kunstmatige
grootte- of aantal-limiet op `.txt`/`.jsonl` (alleen de losse `tailOutput` in
`runControl.ts`'s procesbuffer is begrensd, dát is UI-weergave, niet het log
zelf).

Nooit een kaal percentage: elke dimensie in `BENCHMARK_RESULT` toont ook
`pass/total` en de item-ID's die de score bepalen
(`computeAgentQualityBreakdown()`), zodat "grounding 50%" nooit verhult dat
daar bijvoorbeeld maar twee items achter zitten.

Aan het eind van een run: `--- VOLLEDIGE RUN ACCOUNTING ---` met echte,
apart geteld per bron (`benchAnswer()`-aanroepen, directe `askAgent()`-
aanroepen, model-inferentiebeurten, toolaanroepen, retries, mislukkingen) —
"niet gemeten" in plaats van een geraden getal wanneer een run geen
granulaire events had (bijvoorbeeld een publish/rollback-run). En
`--- KNOWN WEAKNESSES AFTER RUN ---`: dimensies die ondanks een `PROMOTION_
CANDIDATE` zwak blijven (< 50%) — een verbetering elders mag dat nooit
verbergen (zie `proof/decision.ts`'s `bepaalBekendeZwaktes()`).

## In het dashboard

Tabblad **Logboek**: vorige runs met zoeken/filteren, het volledige log van
de geselecteerde run, downloadknoppen (`.txt`/`.jsonl`) en een kopieerknop.
Tabblad **Live run** toont bij een proof-of-value-run de stappenrij (PRE →
sandboxvariant → POST → holdout → regressiecontrole → beslissing),
rechtstreeks afgeleid uit dezelfde logboekregels — geen aparte
voortgangsberekening. Vanuit een experimentdetail springt "Bekijk in
logboek" naar het bijbehorende run-logboek.
