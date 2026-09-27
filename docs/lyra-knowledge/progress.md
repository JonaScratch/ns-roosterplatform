# Lyra Master Program — voortgang

Bijgewerkt: 2026-09-28 (ronde: "LOCAL BEFORE BUG #5 — self-copy crash na succesvolle 3×43-meting, + SCOPE CORRECTION naar Lyra Development Sandbox"). Zie `docs/lyra-knowledge/` voor alle output van deze ronde.

Dit document volgt §106 (werkwijze) en §108 (als de opdracht te groot is voor één uitvoering) van de opdracht. Status per fase: `NOT_STARTED` / `IN_PROGRESS` / `BLOCKED` / `TESTED` / `COMPLETE`.

## Uitgangssituatie (Fase 0, vastgesteld)

- **Branch**: `claude/admiring-edison-5y65j7`
- **HEAD bij start van Fase 0**: `6398e13` (Demo Room v0.9)
- **Bevroren BEFORE-codebaseline**: commit `588c1e5` ("Lyra Master Program — Fase 0: volledige inventaris bestaande kennisarchitectuur") — vastgelegd door de gebruiker als het punt waartegen de lokale BEFORE-run moet draaien. Alle latere commits in dit document (Stap 1-3 hieronder) zijn documentatie/tooling/pin-tests die het BEFORE-agentgedrag niet veranderen (zie per commit hieronder de expliciete "geen gedragswijziging"-motivatie).
- **Commits `2cd863e`, `4e489b7`, `6398e13` geverifieerd aanwezig**: JA.
- **Versienummering (v1.0.x)**: geverifieerd correct (pure stringtemplating, regressietest v1.0.9→v1.0.10 aanwezig sinds `6398e13`).

**BELANGRIJKSTE ONTDEKKING VAN FASE 0**: dit is geen "bouw het canonieke kennissysteem vanaf nul"-opdracht. Er bestaat al een zeer volwassen, goed gedocumenteerde infrastructuur. De opdracht van deze ronde is dus vooral: **reconciliatie, het dichten van specifieke, nu concreet vastgestelde gaten, en één keer een eerlijke voor/na-meting** — niet "bouw dit allemaal opnieuw".

## KRITIEKE REPARATIE: de lokale BEFORE-launcher (na een echte Windows-testrun van de gebruiker)

De gebruiker draaide `run-before-local.ps1` daadwerkelijk op Windows 11 (Windows PowerShell, niet pwsh) en kreeg een echte parser-fout ("Missing closing '}'"). **Root cause**: het bestand bevatte niet-ASCII tekens (em-streepjes, §-tekens) zonder byte-order-mark; Windows PowerShell 5.1 kan zo'n bestand onder de systeem-ANSI-codepage inlezen in plaats van UTF-8, wat een string-literal kan corrumperen en in een cascade van valse accolade-fouten kan eindigen — de eerdere validatie met de PowerShell-taalparser (via `pwsh`/Linux) controleerde alleen de AST van al-correct-gedecodeerde tekst en miste dit dus per definitie.

**Tweede, architectonische fout** die de gebruiker zelf blootlegde: de oude launcher deed `git checkout 588c1e5` op de **eigen ontwikkelbranch** van de gebruiker, en riep daarna orchestratiebestanden aan (`before-manifest.ts`, `golden-suite-extension.ts`) die pas ná die commit zijn toegevoegd — die bestonden dus niet meer zodra de branch daadwerkelijk op `588c1e5` stond. Fout op twee manieren: methodologisch (de BEFORE-meting moet de bevroren agentcode gebruiken, niet ontbrekende nieuwere code) én destructief (de branch van de gebruiker werd gedetacheerd).

**Reparatie — volledig herbouwd, architectonisch, niet cosmetisch:**
- `scripts/lyra-master/run-before-local.ts` is nu de echte orchestrator (TypeScript, cross-platform, typegecontroleerd).
- `run-before-local.ps1` is nu een zeer dunne, PUUR-ASCII, PowerShell-5.1-compatibele wrapper (met een expliciete UTF-8-BOM als extra bescherming) die uitsluitend `npx tsx ... run-before-local.ts` aanroept.
- `run-before-local.cmd` toegevoegd als alternatief, ook puur ASCII.
- **CONTROL/SUBJECT-scheiding**: de eigen branch van de gebruiker (CONTROL) wordt NOOIT gecheckout/gereset/gestash — er wordt alleen uit gelezen. Een aparte, gedetacheerde `git worktree` (SUBJECT) op exact `588c1e5` bevat de bevroren agentcode/golden-suite/tools; alle metingen tegen de bevroren 43-item suite draaien daarbinnen. De golden-suite-extensie (categorieën L/O) draait bewust vanuit CONTROL en heet overal expliciet "EXTENSION / NON-FROZEN" — nooit vermengd met de officiële BEFORE-vergelijking.
- `node_modules` in de subject-worktree: een junction (geen Administrator nodig, geen herinstallatie) — pas nadat is geverifieerd dat `package.json`/`package-lock.json` ongewijzigd zijn sinds de baseline.
- `.env` wordt veilig gekopieerd (inhoud nooit gelogd).
- Een `--preflight-only`-vlag draait alle controles zonder één benchmarkitem te draaien en print exact `PRECHECK PASS` / `FROZEN SUBJECT: ...` / `MODEL: ...` / `STUB: OFF` / `REPLICATES: ...`.
- `BEFORE-VERIFICATION.json` is pas `PASS` als daadwerkelijk bewezen is: subject-commit klopt, echt model gebruikt, stub uit, alle replicaten voltooid, grading voltooid, ruwe bestanden + sha256-hashes aanwezig.
- **Echt getest in deze omgeving** (niet alleen syntax-gevalideerd): een volledige `git worktree add`-cyclus tegen een pad MET een spatie (zoals de daadwerkelijke repository-locatie van de gebruiker), inclusief hergebruik bij een tweede run (idempotent), inclusief een schone, duidelijke `[PRECHECK FAIL]`-melding bij de ontbrekende ontwikkeldatabase — en bevestigd dat de eigen CONTROL-branch/HEAD van deze sessie voor, tijdens en na de test volledig ongewijzigd bleef.
- De twee bestaande, niet-getrackte bestanden van de gebruiker (`demo-room/reports/history/DR-*.md`) worden door dit ontwerp automatisch nooit geraakt: er wordt nergens meer `git checkout`/`git stash` op CONTROL uitgevoerd.

## LOCAL BEFORE BUG #3: frozen subject miste de gegenereerde Prisma-client + Windows worktree-pad-bug

Na de architectonische herbouw hierboven kwam de gebruiker's echte run door alle preflightchecks heen (dus die reparatie werkte), maar crashte daarna alsnog, nu bij de manifestgeneratie: `Cannot find module '@/lib/generated/prisma/enums'`.

**Root cause**: `prisma/schema.prisma` genereert naar `../src/lib/generated/prisma`, en die map staat in `.gitignore` (`/src/lib/generated`). Een verse `git worktree` bevat dus **terecht** geen gegenereerde Prisma-client — de `node_modules`-junction lost dit niet op, want `src/lib/generated` staat niet onder `node_modules`. Elke import van baseline-appcode die uiteindelijk bij `@/lib/generated/prisma/enums` of `.../client` uitkomt (bv. `src/server/audit/log.ts`, via `src/server/agent/capabilities.ts`, via `src/server/agent/agent.ts` — precies de keten die `golden-bench.ts`/`before-manifest.ts` importeren) faalde daardoor pas op het moment dat de eerste échte benchmarkstap draaide, ná de dure opstap.

**Reparatie** (`scripts/lyra-master/run-before-local.ts` + nieuw `scripts/lyra-master/subject-worktree.ts`):
- Nieuwe stap `zorgVoorFrozenPrismaClient()`, vóór elke import van baseline-appcode: controleert of `src/lib/generated/prisma/client.ts` + `enums.ts` bestaan in de SUBJECT-worktree; zo niet, draait `npx prisma generate --schema prisma/schema.prisma` **in de subject-worktree**, met het bevroren schema van commit `588c1e5` zelf (nooit het schema uit CONTROL, nooit gegenereerde bestanden uit CONTROL gekopieerd — de generated output van de subject-worktree ontstaat volledig uit zijn eigen bevroren schema + node_modules-junction). Faalt de generatie, of ontbreken de bestanden alsnog erna, dan is dat een `[PRECHECK FAIL]`.
- Nieuwe stap `voerSmokeImportUit()`, direct daarna: schrijft een klein, niet-getrackt `smoke-import.ts` in de subject-worktree dat `@/server/agent/agent` importeert (dezelfde module die `golden-bench.ts` importeert) en `SMOKE_IMPORT_OK` print. Dit resolveert de volledige keten (agent.ts → capabilities.ts → audit/log.ts → gegenereerde Prisma-enums/client) zonder ook maar één benchmarkitem te draaien of data aan te raken. Deze stap draait ook mee onder `--preflight-only`, dus `PRECHECK PASS` betekent nu "de bevroren subject is echt uitvoerbaar", niet alleen "de bestanden staan er".
- Windows worktree-pad-normalisatiebug (apart gevonden tijdens het repareren hiervan): `git worktree list --porcelain` geeft paden altijd met `/`, ook op Windows, terwijl `path.resolve(...)` daar `\` gebruikt — een kale string-`includes`-vergelijking vond een al-bestaande subject-worktree (bv. na een eerdere `-PreflightOnly`-run) daardoor nooit, en probeerde hem dan opnieuw aan te maken op een pad dat al bestond → faalde. Gefixt via `genormaliseerdWorktreePad()`/`isWorktreeGeregistreerd()` in `subject-worktree.ts`, die schuine strepen normaliseren en op `win32` ook lowercasen (niet-hoofdlettergevoelig bestandssysteem).
- `subject-worktree.ts` is bewust een apart bestand zonder eigen `main()`-aanroep, zodat het zonder bijwerkingen importeerbaar is voor unit tests.

**Getest**:
- `tests/lyra-master/subject-worktree.test.ts` (11 tests, allemaal groen): porcelain-parsing, pad-normalisatie (incl. het letterlijke, gerapporteerde backslash-versus-forward-slash-scenario, met een gesimuleerde `win32`-platformwaarde zodat dit ook op een niet-Windows CI-machine test), en `prismaClientAanwezig()` (afwezig in een verse map / gedeeltelijk aanwezig / volledig aanwezig na "generate" / een control-map telt nooit als substituut voor het subject-pad).
- **Echt uitgevoerd in deze sandbox** (niet alleen unit-getest): een verse `git worktree add --detach` op `588c1e5` op een pad MET een spatie, bevestigd dat `src/lib/generated/prisma` daar aanvankelijk ontbreekt (reproduceert de bug), `node_modules`-junction, daarna echte `npx prisma generate --schema prisma/schema.prisma` — slaagt, genereert de verwachte bestanden — daarna een echte `npx tsx --conditions=react-server` van `@/server/agent/agent` — slaagt (`SMOKE_IMPORT_OK`). Vervolgens de volledige orchestrator (`--preflight-only`) end-to-end gedraaid tegen dezelfde worktree: alle stappen tot en met de smoke-import slagen, en het script stopt daarna weer — als enige, verwachte stap — bij de in deze cloud-omgeving ontbrekende ontwikkeldatabase. Een tweede aanroep met hetzelfde `--subject-path` bevestigde hergebruik (geen her-generatie, geen her-junction). `git status`/`git rev-parse` op CONTROL bevestigden voor en na: branch/HEAD ongewijzigd, geen tracked bestand geraakt door de gegenereerde Prisma-output (`src/lib/generated` blijft `!!` genegeerd in de subject-worktree). De worktree en scratchmap zijn na de test weer volledig verwijderd.
- Volledige `npx tsc --noEmit` (geen nieuwe fouten t.o.v. de bekende, vooraf bestaande Next.js-`PageProps`/`LayoutProps`/`RouteContext`-ruis) en volledige `npx vitest run`: 1054/1081 groen — dezelfde 27 vooraf bestaande ortools-gerelateerde fouten als bij elke eerdere controle in deze sessie, plus de 11 nieuwe tests, allemaal groen.
- **Niet hier na te bootsen (LOCAL REQUIRED)**: de echte Windows-PowerShell-5.1-padvergelijking zelf (backslash-paden, hoofdlettergevoeligheid van NTFS) — de normalisatiefunctie is puur en met een expliciete `win32`-parameter unit-getest, maar een echte Windows-machine is de enige plek die dit definitief bevestigt.

## LOCAL BEFORE BUG #4: orchestrator maakte de frozen subject zelf dirty, en weigerde hem daarna

Na de BUG #3-reparatie kwam de gebruiker's preflight volledig door (bewijs dat die reparatie werkte), maar de echte run crashte daarna alsnog, nu bij `before-manifest.ts`: `HEAD 588c1e5a0d5b (NIET SCHOON)` / `[FOUT] Werkmap is niet schoon.`

**Root cause**: `before-manifest.ts`'s oude check was letterlijk `git status --porcelain` moet leeg zijn. Maar de orchestrator zet zelf, vóór dat script draait, drie bestanden in de subject-worktree neer die niet op commit `588c1e5` bestaan (dus terecht "untracked" zijn): een gekopieerde `before-manifest.ts`, een gekopieerde `subject-worktree.ts` (nieuw in déze ronde: nodig omdat `before-manifest.ts` er intern van importeert), en een gegenereerde `smoke-import.ts`. De runner maakte de bevroren worktree dus letterlijk zelf "dirty" en weigerde vervolgens zijn eigen artefacten — precies zoals de gebruiker het root-caused had.

**Reparatie — methodologisch, niet door de check simpelweg uit te zetten:**
- Nieuwe classifier in `subject-worktree.ts`: `classificeerPorcelainRegel()`/`beoordeelWerkmapSchoonheid()` verdeelt elke `git status --porcelain`-regel in vier categorieën: **getrackte-baseline-wijziging** (elke niet-`??`-statuscode — een gewijzigd/verwijderd/toegevoegd getrackt bestand; dit is de ENIGE categorie die een echte integriteitsschending is en blokkeert), **orchestrator-eigen helperbestand** (exact een van de drie whitelisted paden in `ORCHESTRATOR_OWNED_PATHS`; getolereerd), **eerdere/huidige benchmark-uitvoer** (een pad onder `docs/lyra-knowledge/benchmarks/` of `docs/v1.0.6/benchmarks/`; getolereerd, lost ook expliciet vereiste 6 op: latere replicaat-uitvoer in een hergebruikte worktree blokkeert een volgende cleanliness-check niet), en **onverwacht** (al het overige niet-getrackte; blokkeert nog steeds). Gitignored runtime-artifacts (`node_modules`, `.env`, `src/lib/generated`) verschijnen sowieso al niet in `git status --porcelain` zonder `--ignored`, dus die hoeven niet apart getolereerd te worden — wel apart, puur informatief, vastgelegd in het manifest (`generatedIgnoredArtifacts`, via `--ignored=matching`).
- De echte garantie is nu expliciet: **HEAD == 588c1e5 (`headMatchtBaseline()`) EN de getrackte inhoud van die commit is ongewijzigd (`trackedBaselineClean`)** — niet "de map is helemaal leeg". `before-manifest.ts`'s manifest legt dit nu apart vast: `git.baselineHead`, `git.headMatchesBaseline`, `git.trackedBaselineClean`, `git.trackedModifiedPaths`, `git.orchestratorArtifacts`, `git.benchmarkOutputPaths`, `git.generatedIgnoredArtifacts`, `git.unexpectedUntrackedPaths` — zodat achteraf aantoonbaar is dat de gemeten agentcode exact bevroren was, zonder te doen alsof orchestratiecode onderdeel van 588c1e5 was.
- **Nieuwe, vroege stap** in `run-before-local.ts`: `controleerSubjectIntegriteitVoorOrchestratie()` draait direct na het aanmaken/hergebruiken van de subject-worktree, VÓÓR node_modules/.env/Prisma/smoke-import — dus vóór de orchestrator ook maar iets zelf schrijft — en gebruikt dezelfde classifier. Een echte schending (een gewijzigd getrackt bestand, of een echt onverwacht bestand) wordt zo gevonden vóórdat de orchestrator zijn eigen onschuldige artefacten toevoegt, met een aparte, duidelijke foutmelding per categorie.
- **Opruimen in plaats van laten liggen** (vereiste 4, "nog beter"): `run-before-local.ts` heeft nu één exitpunt onderaan `main()` (via een `exitCode`-variabele in plaats van losse `process.exit()`-aanroepen middenin de `try`), zodat een `finally`-blok altijd draait — ook bij `--preflight-only`, bij een vroege `[PRECHECK FAIL]`, en bij een afgeronde run. Dat `finally`-blok (`ruimOrchestratorArtefactenOp()`) verwijdert na elke aanroep exact de drie whitelisted orchestrator-bestanden uit de subject-worktree (nooit een brede `rm -rf`), zodat ze niet permanent blijven staan en een volgende run steeds met een minimale set begint.
- **Tijdens het echt testen ontdekt en ook gerepareerd**: `scripts/lyra-master/` bestaat niet op de bevroren baseline, dus toont `git status --porcelain` (zonder extra vlag) zo'n volledig-nieuwe map als ÉÉN verzamelregel (`?? scripts/lyra-master/`) in plaats van elk bestand apart — de classifier zou die regel dan nooit met een los whitelisted pad matchen en het geheel ten onrechte als "onverwacht" zien. Beide plekken die nu `git status --porcelain` aanroepen (`run-before-local.ts` en `before-manifest.ts`) gebruiken daarom `--untracked-files=all`. Dit was NIET voorzien door de unit tests (die met met-de-hand-geschreven, al-per-bestand-uitgesplitste porcelain-regels werkten) en is pas gevonden door de reparatie echt tegen een echte git-worktree te draaien — vandaar ook een aparte regressietest die dit exacte scenario vastlegt.

**Getest**:
- `tests/lyra-master/subject-worktree.test.ts` uitgebreid naar 24 tests (van 11): pristiene worktree → alles leeg; `smoke-import.ts`/`before-manifest.ts`/`subject-worktree.ts` afzonderlijk → orchestrator-artifact, nooit onverwacht; elk pad in `ORCHESTRATOR_OWNED_PATHS` herkend; eerdere/huidige benchmark-outputpaden onder beide bekende prefixen → getolereerd; een gewijzigd getrackt bestand (` M`) en een toegevoegd/verwijderd getrackt bestand (`A `/`D `) → `trackedModifiedPaths` (FAIL); een echt vreemd bestand → `unexpectedUntrackedPaths` (FAIL); een mix van alle vier categorieën tegelijk → correct uit elkaar gehouden, niets gemaskeerd; `headMatchtBaseline()` met de juiste/verkeerde commit; en de specifieke, tijdens sandbox-testen ontdekte map-verzamelregel-regressie.
- **Echt uitgevoerd in deze sandbox** (niet alleen unit-getest): een verse `git worktree` op `588c1e5` (pad met spatie) → node_modules-junction, `.env`, echte `prisma generate`, echte smoke-import (allemaal hergebruikt uit de vorige ronde) → de drie orchestrator-helperbestanden erbij gezet zoals de echte orchestrator dat doet → **echte** `git status --porcelain --untracked-files=all` gevoed aan de **echte** `beoordeelWerkmapSchoonheid()`/`headMatchtBaseline()`: `trackedBaselineClean=true`, alle drie helpers herkend, nul onverwacht. Daarna `before-manifest.ts` zelf écht gedraaid: geen enkele "Werkmap is niet schoon"-melding meer — het script komt nu voorbij de integriteitscheck en faalt pas (verwacht, apart, al gedocumenteerd gat) op de ontbrekende ontwikkeldatabase (`Can't reach database server`). Daarna `scripts/v106/golden-bench.ts` (de bevroren benchmark-runner zelf) rechtstreeks gedraaid: laadt volledig, geen enkele module-fout, en stopt netjes bij het ontbrekende lokale model — "start van minimaal de frozen benchmark runner" is dus aantoonbaar bereikt. Vervolgens de volledige orchestrator (`--preflight-only`) tweemaal na elkaar gedraaid tegen dezelfde, nu deels-vervuilde (met leftover benchmark-output) worktree: de integriteitscheck tolereert alles terecht, de opruimstap verwijdert na elke aanroep precies de drie helperbestanden (bevestigd via `git status` erna), en een derde hergebruik-poging werkt nog steeds. Controlebranch/HEAD bevestigd ongewijzigd vóór en na elke stap; geen enkel getrackt bestand geraakt (`git diff --stat` leeg). Worktree en scratchmap na afloop volledig opgeruimd.
- Volledige `npx tsc --noEmit` (geen nieuwe fouten) en volledige `npx vitest run`: 1067/1094 groen — dezelfde 27 vooraf bestaande ortools-fouten als bij elke eerdere controle, plus 13 nieuwe tests, allemaal groen.
- **Bevestigd, vereiste 8**: een reeds bestaande frozen subject-worktree op de Windows-pc van de gebruiker blijft na `git pull` gewoon bruikbaar — de reparatie verandert niets aan hoe een bestaande worktree wordt herkend/hergebruikt (behalve de al eerder gefixte padnormalisatie), voegt alleen een classificatiestap toe vóórdat er iets bijgeschreven wordt, en ruimt aan het einde exact zijn eigen drie bestanden op. De twee bestaande runtime/geschiedenisbestanden van de gebruiker in hun normale CONTROL-checkout (`demo-room/reports/history/DR-*.md`) worden hier nergens door geraakt: dit hele mechanisme werkt uitsluitend binnen de SUBJECT-worktree.

## LOCAL BEFORE BUG #5: self-copy crash NA een succesvolle 3×43-meting — en het eerste echte BEFORE-bewijs

De gebruiker draaide `run-before-local.ps1` opnieuw na de BUG #4-fix. Alle preflightchecks, manifestgeneratie en **alle 3 replicaten van de volledige bevroren 43-item-suite** liepen dit keer daadwerkelijk door tot en met de aggregatie:

```
3 replicaten · item-agreement 97.7% · 1 instabiele items
totaal: mean 79.8% · mediaan 79.1% · worst 79.1%
```

Meteen daarna crashte het script alsnog, ditmaal bij het kopiëren van de aggregatie terug naar het uitvoerpad:

```
Error: src and dest cannot be the same ...docs\lyra-knowledge\benchmarks\before\20260927-205217
    at cpSyncFn (node:internal/fs/cp/cp-sync:56:13)
    at main (...\run-before-local.ts:506:42)
```

**Root cause**: `outDir` (het uitvoerpad, bepaald vóór de replicaten draaiden) en `controlAggregateDir` (waar `aggregate-replicates.ts` `aggregate.json` al rechtstreeks in schreef) zijn in het normale, niet-collisiegeval **letterlijk hetzelfde pad** (`docs/lyra-knowledge/benchmarks/before/<runId>`). De code deed daarna alsnog `cpSync(controlAggregateDir, outDir, {recursive:true})` — een map naar zichzelf kopiëren, wat Node's `fs.cpSync` met `ERR_FS_CP_EINVAL` weigert. Dit was een puur administratieve nacontrole-stap; de echte meetdata (manifest, alle 3 replicaten se `golden.json`/`golden-grade.json`, `aggregate.json`) stond op dat moment al veilig en correct op schijf.

**Reparatie**:
1. **De crash zelf**: de kopieerstap slaat nu over wanneer `controlAggregateDir` en `outDir` naar hetzelfde pad resolven (`path.resolve(...) !== path.resolve(...)`-guard) — geen kopie nodig, de data staat er al.
2. **`--resume-run <runId>`** (nieuw, in `run-before-local.ts` + `-ResumeRun` op de `.ps1`-wrapper): finaliseert een reeds (grotendeels) uitgevoerde run **zonder het bevroren 43-item-benchmark opnieuw te draaien** — precies wat vereist was ("De reeds uitgevoerde benchmarkresultaten mogen NIET opnieuw gegenereerd, overschreven of achteraf aangepast worden"). Leest `manifest.json` (baseline/model/stub, zoals destijds ÍN de subject-worktree zelf vastgelegd — niet opnieuw live bevraagd, want de worktree kan intussen zijn hergebruikt), verifieert dat alle verwachte ruwe replicaatbestanden bestaan en hasht ze (sha256, read-only), hergebruikt `aggregate.json` als het al bestaat (herberekent het alléén als het echt ontbreekt — een deterministische samenvatting van bestaande grades, geen nieuwe meting), draait de EXTENSION/NON-FROZEN-suite alsnog (puur additief), en schrijft dan pas `BEFORE-VERIFICATION.json` — met een harde weigering als dat bestand al bestaat (nooit stilzwijgend overschrijven van een reeds gefinaliseerde run).
3. **Getest**: de zelf-copy-crash is (met de oude foutieve code, ter bevestiging van de root cause) exact gereproduceerd door `nieuweUitvoerDirectory()`/`aggregate-replicates.ts`-pad-logica na te bootsen; met de fix verdwijnt hij. `--resume-run` zelf is end-to-end getest tegen een gefabriceerd, realistisch fixture-scenario (manifest.json + aggregate.json + 3×2 ruwe replicaatbestanden, precies zoals de crash ze achterliet) in deze sandbox: levert een correcte `BEFORE-VERIFICATION.json` met `status: "PASS"`, draait het bevroren benchmark niet opnieuw (geen `golden-bench.ts`-aanroep), hergebruikt het bestaande `aggregate.json` ongewijzigd, en weigert daarna correct een tweede finalize-poging op dezelfde run (`BEFORE-VERIFICATION.json bestaat al`). Volledige `tsc --noEmit` en de 24 `subject-worktree`-tests blijven schoon.

**Dit is het eerste run met een (aantoonbaar te finaliseren) frozen BEFORE-meting**: run `20260927-205217`, baseline `588c1e5`, model `qwen3:8b`, stub OFF, 3 replicaten, 43-item bevroren suite. Structurele fouten zichtbaar in alle 3 replicaten: `C-nacht-vroeg-overgang`, `D-DDR-MIX`, `E-klacht-3`, `E-klacht-4`, `F-DDR-50MIX-weekend`, `F-DDR-MIX-weekend`; instabiel over replicaten: `J-geen-verduidelijking-1` (GOED/FOUT/FOUT). Deze bevindingen zijn **bewaard als toekomstige testdata voor de Development Sandbox** (zie hieronder) — expliciet NIET nu al één-voor-één handmatig gerepareerd in de actieve Lyra, per de scope-correctie hieronder.

## SCOPE CORRECTION: Lyra Development Sandbox bouwen, niet nu al Lyra optimaliseren

De gebruiker corrigeerde de koers van het Master Program expliciet: het doel van deze fase is **niet** om de gevonden BEFORE-fouten nu handmatig te repareren, maar om eerst het **Demo Room / Sandbox Development System** af te bouwen waarmee Lyra later herhaaldelijk en autonoom ontwikkeld, getest, vergeleken, geversioneerd en — na menselijke goedkeuring — geactiveerd kan worden. Run `20260927-205217` is dus een validatie van de meet-/benchmarkinfrastructuur, geen startsein voor inhoudelijke Lyra-fixes. De BEFORE-fouten worden bewaard als testdata voor de sandbox, niet nu opgelost.

Vereiste sandbox-cyclus: `ACTIVE/BASELINE LYRA → immutable clone → EXPERIMENT → CANDIDATE VERSION → benchmark+regressie+validator → verwerpen/bewaren → volgende experiment → BEST CANDIDATE → holdout+adversarial+promotion gates → HUMAN APPROVAL → ACTIVATE → rollback blijft mogelijk`, plus infrastructuur voor tijdgebonden autonome ontwikkelruns (1u/6u/24u/onbeperkt). Voor technische validatie van de sandbox zelf mogen disposable/synthetic kandidaten gebruikt worden — de actieve Lyra mag daarbij niet inhoudelijk veranderen. Zie hieronder voor de inventarisatie van wat van deze cyclus al bestaat (Demo Room v0.2-v0.4 bouwde al een proof-of-value-pipeline, versiebeheer, safe-publish/rollback en een audit-logboek) versus wat nog ontbreekt.

## Development Sandbox: bewezen end-to-end ontwikkelcyclus (SCOPE CORRECTION AANVULLING)

Een Explore-agent inventariseerde eerst grondig wat er in `demo-room/` al bestaat tegen de 12-punts-checklist uit de scope-correctie (immutable versies, isolatie, benchmark-runner, BEFORE/candidate/active-vergelijking, experimentlogboek, holdout-scheiding, hard-rule-validator, promotion candidate, echte activatie, rollback, N-uurs-loop, overfitting-bescherming). Belangrijkste conclusie: **veruit het meeste bestaat al en is al getest** (v0.2-v0.4): `publish/versions.ts` (immutabele versies + `activateVersion()`), `publish/safePublish.ts` (volledige publish-pijplijn + geteste rollback), `proof/proofOfValue.ts`+`proof/decision.ts` (PRE→variant→POST(≥2)→holdout→regressiecontrole→besluit, met asymmetrische winst/regressie-beoordeling en holdout-marge), `store/journal.ts`+`store/logbook.ts` (twee-laags audit trail), `src/server/agent/model/local.ts`'s `productionOverrideFromDisk()` (een ECHTE runtime-koppeling: de hoofdapp leest de actieve prompt-versie live van schijf, geen Demo-Room-only label). De twee concrete, bevestigde gaten: (1) kandidaten kwamen alleen uit een vaste lijst van 2 hand-geschreven varianten — geen echte generatie; (2) een geaccepteerde kandidaat werd nooit als versie vastgelegd (`createVersion()` werd nergens vanuit de meetpijplijn aangeroepen, alleen vanuit de mensgekeurde publish-flow).

Na de gebruiker's expliciete aanvulling ("de Sandbox-fase is niet compleet zonder minimaal één bewezen end-to-end cyclus op een disposable candidate") zijn precies deze twee gaten gedicht, additief, zonder iets bestaands te vervangen:

- **`demo-room/src/develop/generateCandidate.ts`** (nieuw): `generateCandidateFromWeakness()` — bouwt een ECHTE, NIEUWE `PromptVariant` uit een gemeten zwakte (dimensie + score), via een deterministisch sjabloon per dimensie (8 sjablonen, elk gemotiveerd door een concreet, al waargenomen faalpatroon uit run `20260927-205217`: bv. "onderzoekt niets, geeft direct een oordeel" → `unnecessaryClarifications`-sjabloon dat eerst onderzoek eist). Regelgebaseerd, niet een losse LLM-aanroep — bewust, zodat het hele mechanisme deterministisch test- en reproduceerbaar is, ook zonder Ollama; een toekomstige LLM-authored generator is een losse vervolgstap, geen vervanging.
- **`demo-room/src/proof/proofOfValue.ts`** (additief uitgebreid): `RunProofOfValueOptions` accepteert nu ook een kant-en-klaar `variant`-object (naast het bestaande `variantId`, dat alleen in de vaste lijst zoekt) — zodat een autonoom gegenereerde, niet-geregistreerde kandidaat door dezelfde, ongewijzigde PRE/POST/holdout/regressiepijplijn kan. `flatten()` geëxporteerd (hergebruikt voor `LyraVersion.benchmarkReference`). Journal/rapport-code die eerder `findPromptVariant(result.variantId)` deed (en dus stil leeg terugviel voor een gegenereerde kandidaat) leest nu het echte, meegegeven variant-object.
- **`demo-room/src/develop/developmentCycle.ts`** (nieuw): `runDevelopmentCycle()` — orkestreert de volledige cyclus: diagnose (hergebruikt `identifyWeakness()` uit de Zelfstandigheidstest, dezelfde echte PRE-meting) → `generateCandidateFromWeakness()` → `runProofOfValue({variant})` → bij `PROMOTION_CANDIDATE`: **één nieuwe aanroep naar `createVersion()`** (legt de kandidaat onveranderlijk vast als NIET-actieve versie; `activateVersion()` wordt hier nergens aangeroepen — dat blijft een aparte, mensgekeurde stap). Volledig dependency-injected (zelfde patroon als `AutonomyTestDependencies`/`PublishSteps`), dus zonder Ollama/database te testen.
- **`tests/demo-room/developmentCycle.test.ts`** (3 tests) + **`tests/demo-room/generateCandidate.test.ts`** (6 tests): bewijzen de drie uitkomsten van de cyclus met een ECHTE generator en ECHTE `createVersion()`/logboek (alleen de PRE/POST-meting zelf is gecontroleerd/synthetisch, zoals expliciet toegestaan voor technische validatie):
  - **ACCEPT**: een echt-gegenereerde, in `PROMPT_VARIANTS` NIET-voorkomende kandidaat → `PROMOTION_CANDIDATE` → een echte, nieuwe, NIET-actieve `LyraVersion` verschijnt in `listVersions()`, met correcte `variantId`/`reasonForPromotion`/`benchmarkReference` — en de actieve productieversie (`currentVersionId()`) blijft bewijsbaar ongewijzigd.
  - **REJECT**: een kandidaat met een veiligheidsregressie → `REJECTED` → `createVersion()` wordt aantoonbaar NOOIT aangeroepen, geen nieuwe versie, actieve versie ongewijzigd.
  - **NOT_EXECUTED**: geen echte diagnose mogelijk → geen kandidaat gegenereerd, geen meting, geen versie — een eerlijk resultaat, geen gok.
- **Getest**: `npx tsc --noEmit` blijft op exact dezelfde 21 vooraf bestaande, bekende foutregels (geen nieuwe); volledige `npx vitest run`: 1076/1103 groen, dezelfde 27 vooraf bestaande ortools-fouten als bij elke eerdere controle in deze sessie, plus deze 9 nieuwe tests, allemaal groen.

Dit bewijst — met code die echt draait, niet alleen ontworpen is — precies de door de gebruiker geëiste keten: *baseline candidate → diagnose → agent maakt experimentele wijziging → nieuwe candidate → benchmark/validator → objectieve vergelijking → keep/reject → versie/history correct opgeslagen*, op een geïsoleerde, niet-productie candidate, zonder de actieve Lyra aan te raken.

## Development Sandbox, vervolg: tijdgebonden autonome ontwikkellus (N-uurs)

Direct aansluitend gebouwd: **`demo-room/src/develop/autonomousDevelopmentRun.ts`** — `runAutonomousDevelopmentRun()` herhaalt `runDevelopmentCycle()` binnen een verplicht, expliciet wandklokbudget (`maxMinutes` — geen verborgen default; dit is precies de infrastructuur die de scope-correctie vroeg voor "Develop Lyra for: 1 hour / 6 hours / 24 hours / unlimited"). Drie eerlijke stopredenen, nooit een gok:
- `MAX_MINUTES_REACHED(_BEFORE_FIRST_CYCLE)`: het budget is op.
- `NOT_EXECUTED`: geen echte diagnose mogelijk (LOCAL REQUIRED) — de run stopt meteen in plaats van door te gokken.
- `NO_PROGRESS_ON_SAME_WEAKNESS` (nieuw, direct een eerste, lichte invulling van het §12-"overfitting"-gat uit de inventarisatie): `identifyWeakness()` meet altijd tegen PRODUCTIE, dus een niet-gepromoveerde kandidaat verandert niets aan de volgende diagnose — zonder grens zou de lus voor altijd dezelfde dimensie blijven aanvallen. Een per-dimensie teller stopt de run zodra dezelfde zwakste dimensie `maxAttemptsPerDimensionWithoutPromotion` keer (standaard 2) áchtereen zonder promotie verworpen is; een promotie op die dimensie reset zijn eigen teller.

Het resultaat bevat `startVersionId`/`endVersionId` (moeten ALTIJD gelijk zijn — geen enkele cyclus activeert ooit een versie, `activateVersion()` wordt nergens in dit pad aangeroepen), `cycles` (elke losse `DevelopmentCycleResult`), `acceptedCount`/`rejectedCount`, `bestCandidateVersionId` (de laatste promotie, niet automatisch "de beste"), en een `timeline` (mensleesbare gebeurtenissen in volgorde) — samen precies de eindrapportvelden die de scope-correctie vroeg (startversie, eindkandidaat, aantal experimenten, accepted/rejected, tijdlijn).

**Getest** (`tests/demo-room/autonomousDevelopmentRun.test.ts`, 5 tests, allemaal deterministisch — geen enkele test hangt af van de echte klok voor zijn pass/fail-uitkomst, op de bewust klok-onafhankelijke `maxMinutes: 0`-edge-case na): budget-validatie (0 geldig, negatief/`NaN` gooit); budget-al-op-vóór-eerste-cyclus (0 cycli); eerlijke stop zonder diagnose; de GEEN-VOORTGANG-grens stopt na exact 2 verworpen pogingen op dezelfde dimensie ondanks een ruim budget (bewijst dat de stop van de grens komt, niet van de klok); en een gemengd accept→reject→reject-scenario dat bewijst dat een promotie de teller voor die dimensie echt reset, dat de actieve versie ondanks een echte promotie volstrekt onaangeraakt blijft, en dat de opgeslagen kandidaatversie nooit `ACTIVE` wordt. Volledige `tsc --noEmit` blijft op dezelfde 21 bekende foutregels; volledige `vitest run`: 1081/1108 groen (dezelfde 27 pre-existing ortools-fouten, plus deze 5 nieuwe tests).

**Nog open (uit de Explore-inventarisatie, prioriteit voor vervolgwerk)**: een vollediger overfitting-/holdout-discipline-bewaker (de huidige per-dimensie-teller is een eerste, lichte versie — telt niet over meerdere runs heen, en dwingt geen periodieke verplichte holdout-only-check af); het afronden van de adversarial-holdout-laag (grader + freeze-mechanisme, 6/15 categorieën ontworpen); het verenigen van de twee golden-suite-lijnen (`scripts/v106/` 43-item vs. `demo-room/src/benchmark/questions/` 6/3-item); een LLM-authored (in plaats van regelgebaseerde) kandidaatgenerator als v2 van `generateCandidate.ts`.

## Commits deze ronde (chronologisch)

| Commit | Inhoud |
|---|---|
| `588c1e5` | Fase 0: volledige inventaris (4 rapporten) — **de bevroren BEFORE-baseline** |
| `798ffba` | Stap 1: `run-before-local.ps1` + `scripts/lyra-master/before-manifest.ts` + `aggregate-replicates.ts` |
| `44b61bb` | Fase 2/3/9: source-coverage, rule-audit, preference-audit, human-pattern-audit, conflict-report, knowledge-gap-report, migration-report, knowledge-model.md + `canonical-status.ts`, golden-suite-extensie (categorieën L, O) |
| `aa1f59f` | Fase 8/9/13-voorbereiding: `claim-verification.ts` + tests, `known-gaps-pin.test.ts` (3 gaten gepind), `promotion-contract.md` |
| `de54ab6` | Voortgang bijgewerkt na Stap 1-3 |
| `a1cef08` | Fase 12-voorbereiding deel 1: 6 adversarial-holdout-items (JSON) |
| `50861f7` | Fase 12-voorbereiding deel 2: adversarial-holdout-ontwerpdocument |

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
| 12 | Locked holdout/adversarial | **ONTWERP + 6 ITEMS COMPLETE** | `adversarial-holdout-design.md` (architectuur, vries-/auditregel, alle 15 §56-categorieën beoordeeld) + `benchmarks/adversarial-holdout-design.json` (6 volledig gegronde items, status `DESIGNED_NOT_GRADED`). Grader (Fase 8) en het daadwerkelijk als locked holdout inzetten (na AFTER) zijn vervolgwerk. |
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

**Wat al klaar staat**: `run-before-local.ps1`/`.cmd` (dunne wrappers) → `scripts/lyra-master/run-before-local.ts` (echte orchestrator) — zet een aparte, gedetacheerde `git worktree` op exact `588c1e5` (de eigen branch van de gebruiker blijft onaangeroerd), controleert database/Ollama/model/stub, draait de bevroren 43-item suite N keer binnen die worktree, draait de EXTENSION/NON-FROZEN-suite (categorieën L/O) apart vanuit de huidige branch, beoordeelt en aggregeert, schrijft één `BEFORE-VERIFICATION.json`. Zie "KRITIEKE REPARATIE" hierboven voor waarom de eerdere versie niet werkte en wat er structureel is veranderd.

**Eerst een snelle controle (seconden, geen benchmark)**:
```powershell
cd "C:\Users\Jonathan Schram\ClaudeCode\ns-roosterplatform-demo-room"
.\run-before-local.ps1 -PreflightOnly
```

**Daarna de echte run**:
```powershell
cd "C:\Users\Jonathan Schram\ClaudeCode\ns-roosterplatform-demo-room"
.\run-before-local.ps1
```

## Checkpoint-regel

Zodra deze sessie moet stoppen vóór het einde van de opdracht: dit bestand bevat het exacte checkpoint. Vervolg begint bij de eerste fase die niet `COMPLETE`/`TESTED` is — vandaag is dat Fase 12 (adversarial-holdout-ontwerp, loopt) en, zodra de gebruiker het lokale commando heeft gedraaid, Fase 1/11 (BEFORE/AFTER).
