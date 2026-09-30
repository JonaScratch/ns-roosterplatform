# Incident DR-UI-202609301449 — "6 uur" stopte na twee experimenten

**Bron.** De incidentbundel (`docs/lyra-knowledge/long-run-incidents/DR-UI-202609301449/`)
stond bij deze analyse **niet** op de branch: `origin/claude/admiring-edison-5y65j7`
stond op `86de65e`, en `git ls-remote` toonde alleen deze branch en `demo-room-base`.
De analyse steunt daarom op de code en op de door de gebruiker gemelde feiten
(profiel 6 uur / 360 min, gestopt na ±18:54, 2 experimenten, 0 bewaard,
`NO_PROGRESS_ON_SAME_WEAKNESS`). Die feiten volgen precies uit één codepad
(hieronder). Wat alleen de bundel kan tonen, staat onder "Open".

## Blocker 1 — waarom de run na twee rejects stopte

**Terminal condition.** `demo-room/src/develop/autonomousDevelopmentRun.ts` (oud):

```ts
const maxAttempts = options.maxAttemptsPerDimensionWithoutPromotion ?? 2;
…
const teller = (attemptsPerDimension.get(dimensie) ?? 0) + 1;
if (teller >= maxAttempts) { stopReason = "NO_PROGRESS_ON_SAME_WEAKNESS"; break; }
```

Het kaartje "6 uur" (Dashboard en Development Runs) → `POST /api/runs/start
{type:"development-run", minutes:360}` → `cli.ts development-run` →
`runAutonomousDevelopmentRun`. Die controller telde verwerpingen per zwakte
en stopte bij 2 — ongeacht het tijdbudget en ongeacht het leergeheugen.

**Waarom twee genoeg waren.** De teller stond los van `lessons.ts`. De cyclus
zelf (`runDevelopmentCycle`) kiest via `kiesStrategie` na een REJECT een
andere strategie (REGEL → ZELFCONTROLE → WAAROM), en via `kiesDoel` na de
laatste strategie een andere zwakte; pas als geen enkele gemeten zwakte nog
een strategie heeft, meldt de cyclus `UITGEPUT`. De oude controller brak de
lus af vóór de cyclus die derde stap kon zetten.

**Lessen na cyclus 1 en 2 (uit de code; exacte waarden in de bundel).** Elke
cyclus met een rechteroordeel schrijft één les `(dimensie, strategie, verdict)`
naar `DATA_DIR/learning/lessons.jsonl` (append-only, over runs heen). Na twee
REJECTs op contextResolution: REGEL en ZELFCONTROLE verworpen; WAAROM open.
Kreeg cyclus 1 `NEEDS_MORE_EVIDENCE`, dan was cyclus 2 dezelfde strategie met
meer replicaten (MAX_ONBESLIST = 2) — ook dan was de zwakte niet uitgeput.

**Had cyclus 3 iets anders gekozen?** Ja: de derde strategie (WAAROM) op
dezelfde zwakte, en daarna de volgende zwakste open dimensie. Dat bewijst
de nieuwe proef (hieronder) op de echte keten.

**Waarom geen zwaktewissel.** De wissel zit in `kiesDoel` en gebeurt pas als
een zwakte uitgeput is (alle strategieën verworpen). Na twee rejects was dat
nog niet zo; de controller stopte eerder.

**Verhouding tot `ALLES_GEPROBEERD`.** Die logica bestond al in de ándere
motor, `factory/longRun.ts` (paneel "Lange runs"), met checkpoint en
hervatten, en met `maxPogingenPerDimensie = 7` als vangnet (→ `GEEN_VOORTGANG`).
Twee motoren achter hetzelfde woord "6 uur".

## Blocker 2 — UI-run en canonieke run niet gekoppeld

| | kaartje "6 uur" (oud) | paneel "Lange runs" |
|---|---|---|
| route | `/api/runs/start` type `development-run` | `/api/long-runs/start` |
| motor | `runAutonomousDevelopmentRun` (eigen lus) | `draaiLongRun` + `runDevelopmentCycle` |
| run-id | `DR-UI-<minuut>` | `DR-LONG-<minuut>` |
| checkpoint / hervatten | nee | ja, `DATA_DIR/long-runs/<id>/checkpoint.json` |
| stopreden | `NO_PROGRESS_ON_SAME_WEAKNESS` na 2 | `GEEN_VOORTGANG` na 7, `ALLES_GEPROBEERD`, … |
| verifier | geen checkpoint → niets te verifiëren | wel |

Daarnaast gevonden tijdens de proef: run-id's tot op de minuut — twee starts in
dezelfde minuut kregen hetzelfde id en de tweede gaf stil de al afgeronde run terug.

## Reparatie

**Eén motor.** `runAutonomousDevelopmentRun` is nu een dunne laag over
`draaiLongRun`; `cli.ts` `development-run` én `long-run` gaan door dezelfde
`draaiCanoniekeRun`. Zelfde run-id van UI tot verifier; minuten 60/360/1440
worden de profielen 1h/6h/24h, iets anders "aangepast", ∞ "handmatig".

**Verkenningsbudget per profiel** (`verkenningVoor`, `factory/longRun.ts`):

| profiel | pogingen per zwakte | herhalingstolerantie | maxCycli |
|---|---|---|---|
| 1h | 6 | 2 | 24 |
| 6h | 6 | 3 | 144 |
| 24h | 6 | 5 | 576 |
| handmatig | 6 | 5 | 500 |
| aangepast | 6 | 3 | minuten/2,5 (4…1000) |

- 6 = strategieën × MAX_ONBESLIST: meer kan het leergeheugen nooit vragen.
- Een zwakte die dat haalt, wordt in déze run **lokaal uitgeput** verklaard
  (`uitgeslotenDimensies`) en de run gaat door met een andere — nooit meer een
  globale stop.
- Elk verworpen paar zwakte/strategie wordt in de run geblokkeerd
  (`geblokkeerdeParen`) en gaat mee naar de volgende cyclus (`runUitsluitingen`
  → `kiesDoel`/`kiesStrategie`); komt het tóch terug (les genegeerd), dan telt
  het als herhaling, en boven de tolerantie is dat een **echte blocker**.
- Stoppen alleen bij: budget (actieve minuten), `ALLES_GEPROBEERD` (alleen als
  de cyclus zelf `UITGEPUT` meldt), `MAX_CYCLI`, handmatig, of een echte fout.
  `GEEN_VOORTGANG` en `NO_PROGRESS_ON_SAME_WEAKNESS` worden niet meer gegeven.

**Canoniek checkpoint.** Na elk checkpoint een levende kopie in
`docs/lyra-knowledge/long-runs/<runId>/checkpoint.json`; per segment een
omgevingsvingerafdruk (commit, agentcode-hashes, release, Ollama-versie en
digest, bevoegdheid, open verkenningsruimte); per cyclus de 11 stadia,
strategie, familie, overgeslagen zwaktes en overgangen; fase; productie bij
start en laatst. Hervatten na pauze én na crash (checkpoint RUNNING zonder
proces) met hetzelfde id; de stopknop stopt een lange run netjes op een
cyclusgrens. Run-id's tot op de seconde plus willekeurig achtervoegsel; een
nieuwe start op een afgerond id wordt geweigerd.

**Verifier.** Werkt direct op elk run-id (werkcheckpoint, anders de canonieke
kopie). Nieuwe controles: `ALLES_GEPROBEERD` alleen met bewezen globale
uitputting; canoniek checkpoint (budget + vingerafdruk); lokale uitputting
beëindigde de run niet; het modeleindpunt uit de vingerafdruk staat in het
detail en elk segment moet een lokaal model hebben gehad.

**UI.** Eén labelbron (`ui/lib/fase.js`): actief onderzoeken, nieuwe hypothese,
meer bewijs, strategie / kandidaatfamilie / zwakte gewisseld, lokaal uitgeput
(gaat door), gepauzeerd, globaal uitgeput, tijd/budget, maximum cycli,
handmatig gestopt, echte fout/blocker. Development Runs toont Fase en
Actief/budget; het paneel Lange runs toont fase, canoniek pad, lokaal
uitgeputte zwaktes en "Hervat na crash".

## Bewijs

Tests (nieuw of herschreven): `tests/demo-room/longRun-canoniek.test.ts`,
`tests/demo-room/autonomousDevelopmentRun.test.ts`, `tests/demo-room/factory.test.ts`,
`tests/lyra-master/verify-long-run.test.ts`. Volledige suite: 1458 geslaagd;
alleen de 27 bekende OR-Tools-fouten.

Proef op de echte keten (`docs/lyra-knowledge/proofs/long-run-canoniek-proof-20260930.json`):
dashboardserver → `POST /api/runs/start` (kaartje) → CLI → canonieke motor →
echte `runDevelopmentCycle` (proof-of-value, holdout, adversarial, judge/2)
op een geseede Postgres. **Model: een deterministisch nep-eindpunt, geen
qwen3:8b** — dit bewijst de keten en het controllergedrag, niet modelkwaliteit.

- 18 verworpen kandidaten overleefd; na elke verwerping een andere strategie;
  zwaktewissel bij cyclus 4, 7, 10, 13, 16; cyclus 19 meldt `UITGEPUT` →
  `ALLES_GEPROBEERD`; verifier PASS (alle controles), met in het detail
  "eindpunt: qwen3:8b @ ollama nep-0.0".
- Pauze → hervat (segment 2, tweede vingerafdruk) → stop (HANDMATIG_GESTOPT).
- Crash (`kill -9` van het CLI-proces) → hervat met hetzelfde id, verder waar
  hij was.
- Productie in elke run onaangeroerd (lyra-prod-baseline, generatie 0).

## Open / risico

- De bundel zelf (development-run.json, run-events.jsonl, cycle reports) is
  niet geanalyseerd: niet op de branch.
- Het leergeheugen geldt over runs heen. Met ±9,5 min per echte cyclus en
  ±24 paren zwakte×strategie is `ALLES_GEPROBEERD` binnen 6 uur mogelijk als
  alles verworpen wordt — dat is een geldige, bewezen globale uitputting, geen
  voortijdige stop. Hoeveel ruimte er bij de start nog open is, staat nu in
  logboek en vingerafdruk ("open verkenningsruimte").
