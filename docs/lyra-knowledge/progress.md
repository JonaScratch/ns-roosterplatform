# Lyra Master Program — voortgang

Bijgewerkt: 2026-09-29 — UI/UX REBUILD-focusfase en de VISUAL FIDELITY CORRECTION-ronde **AFGEROND** (zie de betreffende secties hieronder). Daarna: de **BEFORE-freeze is bevestigd** (run `20260927-205217`, onafhankelijk herrekend uit de ruwe artifacts, zie "Master Program hervat: BEFORE-freeze bevestigd" hieronder) en het Master Program is zelfstandig verder opgepakt: Fase 1 nu COMPLETE, Fase 3 stap (b), Fase 7 (memoryProposal) en Fase 8 (claim-verificatie) gerepareerd/aangesloten, Fase 10 (consistency-checker) een eerste echte bouwsteen. Resterend: Fase 11/12-inzet blijven `BLOCKED (LOCAL REQUIRED)` (geen Ollama hier), Fase 13 blijft extern geblokkeerd (geen NS-platformtoegang) — zie de fasetracker voor de volledige, actuele status per fase. Zie `docs/lyra-knowledge/` voor alle output van eerdere ronden.

## UI/UX REBUILD — AFGEROND (tijdelijke focusfase, Master Program hervat hieronder)

De gebruiker vroeg een volledige informatiearchitectuur-/UX-rebuild van de Demo Room, met 6 aangeleverde referentiedesigns (Dashboard/Test Room/Development Runs/Candidates/Experimenten/Logboek) die inhoudelijk en visueel nauwkeurig nagebouwd moeten worden, gekoppeld aan echte backenddata — geen cosmetische restyle. Expliciete instructie: dit is een tijdelijke, exclusieve focusfase (geen andere Master Program-fasen ertussendoor, geen inhoudelijke Lyra-wijzigingen); na aantoonbare afronding (alle schermen, navigatie exact, oude dubbele UI verwijderd, alle knoppen/drilldowns werkend, echte data, alle states, screenshots) hervat het oorspronkelijke Master Program automatisch tot `MASTER_PROGRAM_COMPLETE`.

**Belangrijke, nog niet onafhankelijk geverifieerde claim**: de gebruiker meldde dat de lokale BEFORE-finalize (run `20260927-205217`) inmiddels `PASS` gaf via `-ResumeRun`, met concrete cijfers (mean ~79.8%, extension-resultaten, etc.). Ik heb het daadwerkelijke `BEFORE-VERIFICATION.json`/`manifest.json`/`aggregate.json` zelf nog niet gezien — dit is dus een gebruikersmelding, geen door mij geverifieerd artifact. Zodra de UI-focusfase is afgerond en het Master Program hervat, moet dit eerst uit de echte bestanden bevestigd worden (of de gebruiker moet ze pushen/delen) vóórdat er inhoudelijk op voortgebouwd wordt — precies de "verifieer uit de artifacts zelf"-regel die de hele sessie is gehanteerd.

**Aanpak**: de bestaande, werkende monolithische `demo-room/ui/index.html` (1 bestand, ~1300 regels, vanilla JS/CSS, handgerolde SVG-grafieken, geen framework/build-stap — bewust zo gehouden, zelfde filosofie) is opgesplitst in `styles.css` + `app.js` (schil: navigatie/routering/header/bevestigingsmodal) + `lib/shared.js` (gedeelde fetch/chart/icoon-helpers, vrijwel woordelijk hergebruikt) + `pages/<naam>.js` per scherm (ES-modules, `export function mount(container)`). `server.ts` kreeg een generieke, padtraversal-veilige statische-bestandenserver voor deze nieuwe modules. Navigatie is nu EXACT `Dashboard | Test Room | Development Runs | Candidates | Vergelijken | Versies | Logboek`, zoals foto 1 vereist — niet-gebouwde routes tonen een eerlijke "nog in aanbouw"-plaatsvervanger (nooit fictieve inhoud) totdat hun taak is afgerond.

**Vóór de UI zelf, eerst het ontbrekende backend-fundament gebouwd** (`demo-room/src/store/developmentRuns.ts`, nieuw): de vorige-ronde `runAutonomousDevelopmentRun()`/`runDevelopmentCycle()` gaven tot nu toe alleen in-memory resultaten terug — er bestond geen manier om een run terug te vinden nadat het CLI-proces stopte, en geen "candidates"-concept los van experimenten. Nu: `writeDevelopmentRunResult()` (aangeroepen door `autonomousDevelopmentRun.ts` zelf, zelfde patroon als `autonomyResults.ts`), `listDevelopmentRunResults()`, `getDevelopmentRunResult()`, en `listAllCandidates()` (elke cyclus uit elke bewaarde run, inclusief verworpen/in-test — niet alleen gepromoveerde — met een `validator: PASS|FAIL` afgeleid uit de echte regressiecontrole, geen verzonnen veld). Nieuw CLI-subcommando `development-run` (cli.ts), nieuwe endpoints `/api/development-runs(/detail)` en `/api/candidates(/detail)` (server.ts). Getest: 3 nieuwe tests (`tests/demo-room/developmentRuns.test.ts`).

**Dashboard (foto 1) volledig gebouwd en geverifieerd** — de belangrijkste pagina, "in enkele seconden antwoord": Actieve Lyra-kaart (canonieke `/api/versions/active`, geen hardcoding), Beste-kandidaat-kaart met een eerlijke lege status ("Nog geen kandidaat beschikbaar", nooit een verzonnen score), 1u/6u/24u/Aangepast-runlauncher met een echt bevestigingsmodal (nooit een onomkeerbare actie zonder klik erop), 5 KPI-kaarten, benchmarkgrafiek (alleen echt gemeten punten), zwakke-puntentabel (afgeleid uit echte gediagnosticeerde zwaktes over alle bewaarde runs, "Opgelost" vs. "In onderzoek" op basis van of die dimensie ooit tot een promotie leidde), laatste-ontwikkelrun-stepper (Diagnose→Experiment→Kandidaten→Benchmark→Validatie→Beslissing, afgeleid uit echte cyclusvelden, geen latere stap groen als een eerdere niet gehaald is), kandidaatvergelijkingstabel, bevindingen (max 5 regels, mensleesbaar), snelle acties.

**Echt geverifieerd, niet alleen beweerd**: dashboard-server lokaal gestart, met Playwright (globaal geïnstalleerd + de voorgeïnstalleerde Chromium-binary op dit systeem) echt gerenderd en gescreenshot — zowel de lege-status (niets gemeten) als een gefabriceerde, geïsoleerde fixture-staat (`DEMO_ROOM_STATE_ROOT_OVERRIDE` naar een tijdelijke map, nooit de echte `demo-room/data/`) met een geaccepteerde + een verworpen kandidaat, om te bevestigen dat echte data correct doorstroomt. Eén echte CSS-bug gevonden en gefixt tijdens dit verificatieproces (de stappen-stepper miste zijn `stepper`-klasse en rendercte als gestapelde blokken in plaats van een horizontale rij — nu gecorrigeerd en herbevestigd via een tweede screenshot). Interactietest bevestigt: duurkeuze werkt, startknop opent het bevestigingsmodal (annuleren sluit het zonder de run te starten), en een nog niet gebouwde route toont de eerlijke "in aanbouw"-plaatsvervanger. Nul console-/pagina-fouten (op de onschuldige, voorbestaande favicon-404 na). Volledige `tsc --noEmit` blijft op dezelfde 21 bekende foutregels; volledige `vitest run`: 1084/1111 groen (27 vooraf bestaande ortools-fouten, ongewijzigd).

**Alle resterende schermen zijn sindsdien gebouwd, getest en gepusht** (chronologisch, elk met een eigen commit, typecheck op de bekende 21 baseline-foutregels en de volledige `vitest`-suite groen):

- **Development Runs (foto 3)**: config bar (basisversie/doel/duur/altijd-aan benchmark-holdout-validator), live KPI-rij, onveranderlijk runconfiguratiepaneel, actieve-doelenlijst, live ontwikkellus-gebeurtenisstroom (uit het echte logboek), beste-kandidaat-nu-kaart, onafhankelijke gate-status (Benchmark/Validator/Holdout/Promotie — promotie nooit automatisch groen), kandidatentabel met verplichte redenkolom. Hiervoor eerst twee echte backend-gaten gedicht: `focusDimension`-override (met de echte auto-diagnose altijd nog gelogd) en een `inProgress`-tussentijdse-momentopname na elke cyclus (i.p.v. pas na de hele — mogelijk 24 uur durende — run).
- **Candidates (foto 4)**: filters, 5 KPI's, kandidatenlijst met echte benchmark/holdout-delta's en validator-PASS/FAIL, statusbadges (BESTE/PROMOTIEKLAAR/IN TEST/VERWORPEN, afgeleid uit besluit + rangorde, nooit verzonnen), beste-kandidaat-nu-paneel, per-kandidaat-drilldown (basis-vs-kandidaat-staafgrafiek per dimensie, belangrijkste wijzigingen, levenscyclus-stepper).
- **Experiment-detail (foto 5)**: bewust GEEN nieuw hoofdtabblad — alleen bereikbaar via drilldown vanuit Candidates/Development Runs (`app.js`'s `EXTRA_ROUTES`, geen navigatieknop). Filters, 5 KPI's, experimentenlijst, geselecteerd-experimentpaneel (hypothese/wijziging/verwachte winst/uitkomst — "verwachte winst" eerlijk als tekst i.p.v. een verzonnen getal, want dit systeem legt vooraf geen aparte winstverwachting vast), een eigen rond-nul-divergerende effect-per-type-weergave (bewust geen SVG-hergebruik: de gedeelde `groupedBarChart` kan geen negatieve/regressiewaarden eerlijk tonen), berekende inzichten, experimentflow-stepper. Herbruikt het bestaande `/api/experiments(/detail)` (het `ExperimentRecord`-geheugen van vóór deze ronde), geen nieuwe datastore.
- **Vergelijken**: compacte werkruimte (niet de oude, uitgebreide pagina) — basisversie/vergelijk-met/benchmarkset-selectors, per-dimensie-verschiltabel, statusoverzicht, relevante-wijzigingenpaneel. Eén cliëntzijdige patch nodig: `listVersions()` laat de synthetische baseline-rij weg zodra er ooit een echte versie bestaat, dus de actieve versie (vaak nog de baseline) viel anders uit de selector — opgevangen via een fallback op `/api/versions/active`.
- **Versies**: levenscyclusbeheer (ACTIEF/GEARCHIVEERD/TERUGGEDRAAID/MISLUKT), detaildrilldown, "Activeren" uitsluitend via het bestaande `/api/rollback/execute` (dezelfde canonieke `publish/versions.ts`-service als een echte rollback), gated door de server's eigen `activationEligibility()` — nooit een Demo-Room-only actieve status. Zelfde baseline-fallback-patch als Vergelijken.
- **Logboek (foto 6)**: filters (periode/type/status/zoeken), 4 KPI's, tijdlijn & runhistorie met detailpaneel, benchmarkontwikkeling-over-tijd, promotiegeschiedenis, berekende patronen — het volledige ruwe logboek blijft achter een "Bekijk volledig logboek"-drilldown (downloadt via het al bestaande `/api/logbook/download`), nooit de primaire weergave. **Bouwde deze pagina twee echte, pre-existing backend-fouten bloot, allebei geworteld en met regressietest gerepareerd**: (1) `runHistory()` las `endEvent.data?.summary?.outcome`, terwijl `logbook.endRun()` `summary` altijd op het toplevel van de RUN_END-regel schrijft — een mislukte/onderbroken run zag er hierdoor overal altijd uit als geslaagd; (2) er bestond geen manier om "toon alleen echte promotie/activatiemomenten" eerlijk te tonen, want `versionPerformanceSeries()` telt sinds deze ronde ook nooit-geactiveerde development-cycle-kandidaten mee — nieuwe `promotionHistory()` (leest uitsluitend echte `CHANGE_APPLIED`/`ROLLBACK`-logboekregels met een echte versietransitie) lost dit op.
- **Test Room (foto 2)**: een echt interactief gesprek, geen benchmarkscherm. Nieuw CLI-subcommando `chat` (dezelfde `askAgent()`-productieroute als overal elders, `demoRoomActor()`+`requireReadAccess()`, een `--version-id` bouwt een sandbox-`systemPromptOverride` uit de echte `promptOverrideText` van een opgeslagen versie/kandidaat — nooit een aparte, nagemaakte chat-implementatie). Nieuwe `runCliOnceAndCapture()` in `runControl.ts`: een synchrone spawn-en-wacht-variant die bewust NOOIT `current-run.json` aanraakt, zodat een gesprek een lopende Development Run niet blokkeert en omgekeerd. Versie/kandidaat-picker, standplaats-veld, de 4 vereiste snelle acties, en een structuurkaart per antwoord met een echte regel-/toolchecklist — uitsluitend tools die de agent daadwerkelijk aanriep, nooit een vaste hypothetische lijst. **Playwright bevestigde dat de bedrading echt is**: een snelle actie riep `/api/chat` aan, die via de echte `askAgent()`/Prisma-keten eerlijk "Can't reach database server" teruggaf (geen Postgres/Ollama in deze cloud-sandbox) — precies het verwachte, eerlijke `LOCAL REQUIRED`-gedrag, geen nepantwoord.
- **Volledige regressiepas**: alle 7 hoofdtabbladen + de Experiment-detail-subpagina stuk voor stuk (en daarna nog eens in snelle achtereenvolgende tabwisselingen, om een interval-/cleanup-lek uit te sluiten) met Playwright bezocht, tegen zowel een gefabriceerde fixture-staat als de echte lege staat: navigatie/actieve-tab-markering klopt overal, geen "nog in aanbouw"-plaatsvervanger meer op een van de 7 tabs, terug-navigeren vanuit een drilldown werkt, en nul console-/pagina-fouten buiten de onschuldige, voorbestaande favicon-404. Er was geen oude, monolithische UI meer om te verwijderen: die was al bij de start van deze focusfase (taak "static assets + shared design system") in dezelfde bestandslocatie herschreven tot de dunne schil — er hebben dus nooit twee implementaties naast elkaar bestaan.

## UI VISUAL FIDELITY CORRECTION — AFGEROND (tweede, kortere focusfase)

Na de functionele UI/UX REBUILD hierboven gaf de gebruiker een expliciete correctie: "FUNCTIONEEL IS NIET GENOEG" — de 7 pagina's werkten correct maar oogden nog te veel als een kaal intern admin-dashboard, in plaats van visueel overeen te komen met de 6 aangeleverde referentiescreenshots (layout, card-verdeling, iconografie, badges, density, hiërarchie). Expliciet: "geen nieuwe backend-architectuur", alle bestaande functionaliteit moest behouden blijven, en de sessie mocht pas stoppen zodra een nieuwe browser-screenshot naast elk referentiebeeld gelegd kon worden met duidelijk overeenkomende structuur/compositie/informatiedichtheid.

**Gedeeld ontwerpsysteem eerst uitgebreid** (`demo-room/ui/lib/shared.js` + `styles.css`): `ICONS`-map van 12 naar ~30 inline SVG's; nieuwe `titleIcon()`-helper (klein icoonblok voor card-`<h3>`-headers); `lineChart()` kreeg een area-fill-optie en een piek-waardelabel; `groupedBarChart()` kreeg afgeronde staven, waardelabels en gridlines; de stepper (`renderStepper()` + CSS) volledig herbouwd van platte, met pijltjes verbonden divs naar cirkelvormige genummerde/vinkje-nodes verbonden door horizontale lijnen — exact het patroon dat alle 4 referentiebeelden met een procesflow gebruiken. Nieuwe `.field-list`/`.field-row`-component (icoon-naast-label/waarde-rijen) verving losse `<p><b>Label</b><br/>waarde</p>`-blokken en kale statustabellen door consistente paneel-rijen.

**Eén echte CSS-bug gevonden en op de bron gefixt tijdens deze ronde**: `.card-title-icon`'s afmetingen waren gescoped als `.card h3 .card-title-icon` — zodra `titleIcon()` (bewust) werd hergebruikt in een niet-`<h3>`-element (Candidates' sub-sectiekopjes "Belangrijkste wijzigingen"/"Levenscyclus"), had de SVG geen breedte/hoogte-begrenzing meer en rendercte hij op zijn onbegrensde intrinsieke `viewBox`-grootte — een enorm icoon dat de hele pagina domineerde. Fix: de selector losgekoppeld van zijn `h3`-ouder (`.card-title-icon` + `.card-title-icon svg`, plus een nieuwe `.sm`-variant), zodat het icoon overal consistent klein blijft. Geverifieerd dat dit geen regressie gaf op Dashboard/Development Runs (opnieuw gescreenshot ná de fix).

**Per pagina, screenshot-geverifieerd tegen de bijbehorende referentiefoto** (fixture-staat via `DEMO_ROOM_STATE_ROOT_OVERRIDE`, plus een aparte lege-staat-controle per pagina, telkens nul console-/pagina-fouten op de onschuldige favicon-404 na):
- **Dashboard (foto 1)**: icoon-chips op alle KPI-kaarten en card-headers, cirkelvormige stepper met groene vinkjes voor "Laatste ontwikkelrun", `field-list`-rijen in de Beste-Kandidaat-kaart, area-fill-grafiek met pieklabel.
- **Development Runs (foto 3)**: live-voortgangsbalk + -percentage (echt berekend uit `--minutes N` in het opgeslagen CLI-commando en verstreken tijd, geen schatting), een nieuwe 6-staps live-stepper afgeleid uit de laatste cyclus se echte velden, een nieuwe benchmarkevolutie-grafiek per cyclus, per-gate-icoon in de gate-statuskaart.
- **Candidates (foto 4)**: 5 icoon-KPI's, sterretje bij de beste kandidaat in de tabel, een nieuwe echte Gate-status-kaart (herleid uit de cyclusdata van de geselecteerde kandidaat — dezelfde 4 gates als Development Runs, niet verzonnen), automatische selectie van de beste kandidaat bij het laden (i.p.v. een lege detailkaart tot een klik), de oude losse handgeschreven stepper-markup in `toonDetail()` vervangen door de gedeelde `renderStepper()`.
- **Test Room (foto 2)**: herbouwd van een gestapelde enkele kolom naar een echte 3-koloms werkruimte (links: versie/kandidaat-config + snelle acties; midden: chat; rechts: live sessiecontext + laatste-antwoordpaneel met de echte tool-/regelchecklist) — bewust GEEN nagemaakte roostertelling-panelen ("Huidig rooster: Vroeg/Laat/Nacht/Rust") zoals de referentie toont, want die cijfers bestaan niet in dit systeem; de rechterkolom toont in plaats daarvan alleen echte `contextUsed`/`toolCalls`-velden uit de laatste `askAgent()`-respons. Interactietest bevestigt opnieuw het eerlijke `LOCAL REQUIRED`-gedrag (geen Postgres/Ollama in deze cloud-sandbox).
- **Logboek (foto 6)**: icoon-KPI-rij inclusief een nieuw echt berekend "Gem. verbetering per promotie"-cijfer (gemiddelde van opeenvolgende promotiescore-delta's), status-kleurstip per tijdlijnrij, automatische selectie van de meest recente run, 3-koloms onderrij (grafiek/promotiegeschiedenis/patronen) i.p.v. een volle-breedte grafiekkaart boven een 2-koloms rij.
- **Experiment-detail (foto 5)**: Experimentenlijst en een altijd-zichtbaar "Geselecteerd experiment"-paneel naast elkaar (i.p.v. de detailkaart onderaan, pas zichtbaar na een klik), Effect-per-type en Inzichten als eigen rij, een volle-breedte Experimentflow-stepperkaart onderaan — bewust GEEN nieuw hoofdtabblad (blijft drilldown-only, zoals al eerder vastgelegd).
- **Vergelijken + Versies**: geen eigen referentiefoto, maar in dezelfde iconen-/`field-list`-huisstijl gebracht voor visuele consistentie met de andere 5 pagina's.

Volledige `vitest run tests/demo-room`: 104/104 groen. `tsc --noEmit`: dezelfde 21 vooraf bestaande foutregels in de hoofdapp (Next.js-gegenereerde `PageProps`/`LayoutProps`/`RouteContext`-types, buiten `demo-room/` — bevestigd ongewijzigd t.o.v. vóór deze ronde). Alles gecommit in 5 incrementele commits en gepusht naar `claude/admiring-edison-5y65j7`.

Dit document volgt §106 (werkwijze) en §108 (als de opdracht te groot is voor één uitvoering) van de opdracht. Status per fase: `NOT_STARTED` / `IN_PROGRESS` / `BLOCKED` / `TESTED` / `COMPLETE`.

**Master Program hervat vanaf hier** bij de eerstvolgende niet-`COMPLETE`/`TESTED` fase — zie de fasetracker hieronder. Vóór er inhoudelijk op de BEFORE-resultaten voortgebouwd wordt, moet eerst de hierboven genoemde, nog niet onafhankelijk geverifieerde `PASS`-claim van run `20260927-205217` uit de echte artifact-bestanden bevestigd worden.

## Master Program hervat: Fase 12-vervolg (tweede batch adversarial-items + grader)

Na de UI/UX REBUILD-focusfase hierboven is het Master Program hervat. Status-
check tegen de fasetracker: vrijwel elke resterende fase (regels/bronnen-
consolidatie, grounding-gatreparatie, claim-verificatie-aansluiting) is
expliciet gekoppeld aan de BEFORE-freeze (§33/§34: geen inhoudelijke wijziging
vóór die freeze bevestigd is) — en die `PASS`-claim (run `20260927-205217`) is
nog steeds niet onafhankelijk geverifieerd uit de echte artifact-bestanden
(die bestaan niet in dit repository/deze branch; ze staan alleen lokaal bij
de gebruiker). Zonder die bevestiging blijven die fases terecht geblokkeerd.

De ene fase die wél verder kon zonder BEFORE-bevestiging én zonder Ollama/DB:
**Fase 12 (adversarial holdout)**. Twee dingen toegevoegd, beide additief,
zonder de bestaande 6 items te wijzigen (zie `adversarial-holdout-design.md`
en `adversarial-holdout-design.json` voor de volledige inhoud/motivatie):

1. **Drie nieuwe adversarial-items** (de bij de eerste batch bewust
   uitgestelde, structureel haalbare categorieën): `S-WEEKENDNORM-VALSE-
   AUTORITEIT` (categorie 1+15 gecombineerd — een verzonnen autoriteitsclaim
   over de niet-wiskundig-gedefinieerde Regio West-weekendnorm),
   `T-DUTYINSTANCE-ONTBREKENDE-DUTYCODE` (categorie 12 — de tool `dutyInstance`
   vereist een `dutyCode` die in het gesprek nooit gegeven is), en
   `U-KANDIDAAT2-VERLENGD-SUBTIEL` (categorie 4 — dezelfde kandidaatwissel-
   verwarring als de bestaande r2-suite, nu over 5 beurten met een echte
   afleiding en een impliciete in plaats van letterlijke referentie).
2. **`scripts/v106/adversarial-grade.ts`** (nieuw): de grader die
   `adversarial-holdout-design.md` §2.2 als voorwaarde noemt vóór dit bestand
   van status kan veranderen. Zelfde architectuur als `golden-grade.ts` (een
   lookup per soort, GOED/FOUT/ONBEOORDEELD, puur tekst-/structuurpatroon,
   nooit LLM-zelfbeoordeling), hier gedispatcht op `expect.category`.
   **Eerlijkheidsgrens, met zoveel woorden in de code zelf**: deze
   heuristieken zijn nooit tegen een echt modelantwoord gekalibreerd — alleen
   tegen 11 zelfgeschreven GOED/FOUT-voorbeeldantwoorden
   (`tests/lyra-master/adversarial-grade.test.ts`, allemaal groen). Bij twijfel
   geeft elke functie `ONBEOORDEELD` terug, nooit een gok. Eén echte bug
   gevonden en gefixt tíjdens het testen: twee bijna-identieke maar
   uiteenlopende voorbehoud-regexen (één in `heeftVoorbehoud()`, een losse
   kopie binnen `onvoorwaardelijkBevestigd()`) waren uit elkaar gaan lopen —
   nu herleid tot één bron.
3. **Status blijft bewust `"DESIGNED_NOT_GRADED"`**: het bestaan van een
   grader verandert de freeze-statusregel uit §2.2 niet — dat vereist een
   echte meting tegen deze items, wat alleen LOCAL REQUIRED (Fase 12 zelf, de
   AFTER-meting) kan gebeuren.
4. **Getest**: `npx tsc --noEmit` blijft op exact dezelfde 21 vooraf bekende
   foutregels; volledige `npx vitest run`: 1099/1126 groen (dezelfde 27
   vooraf bestaande ortools-fouten als bij elke eerdere controle in deze
   sessie, plus deze 11 nieuwe tests, allemaal groen).

**Volgende stap voor een derde batch (niet in deze ronde)**: de resterende
2 structureel-haalbare-maar-nog-niet-aparte categorieën zijn al gedekt via
gecombineerde items (8 via R, 15 via S) — er blijven dus alleen de 4
expliciet `LOCAL REQUIRED` categorieën (5, 6, 7, 13) over, die pas verder
kunnen zodra een levend dienstenpakket beschikbaar is.

## Master Program hervat: BEFORE-freeze bevestigd, resterende fases losgemaakt

De hierboven genoemde blokkade is opgeheven. De gebruiker leverde de inhoud
van `BEFORE-VERIFICATION.json`, `manifest.json` en `aggregate.json` voor run
`20260927-205217` aan; deze sessie heeft ze — conform de eigen eis van
`run-before-local.ps1` zelf ("verifieer dit uit de artifacts zelf, neem het
niet op vertrouwen aan") — onafhankelijk herrekend uit de ruwe item-/
replicaatdata in plaats van het `status: "PASS"`-veld te vertrouwen: alle
43 items matchen `manifest.json`'s `goldenSuite.counts.perCategory` exact,
elke categorie-`perReplicaat`-array herleid uit de losse item-statussen komt
exact overeen met `aggregate.json`'s eigen cijfers, `itemAgreementRate`
(42/43 stabiele items) klopt tot volledige float-precisie, en
`overall.meanPct` (het gemiddelde van de drie replicaat-percentages) komt
exact uit. Baseline (`588c1e5`), model (`qwen3:8b`) en stub-uit kruisen
correct tussen de twee bestanden. De drie artifacts zijn gecommit in
`docs/lyra-knowledge/benchmarks/before/20260927-205217/`.

**Wat dit voor de fasetracker betekent**: Fase 1 is nu `COMPLETE`, niet meer
`BLOCKED`. De fases die letterlijk aan deze freeze gekoppeld waren (§33/§34)
zijn losgemaakt en zijn deze ronde voor zover verantwoord opgepakt — zie de
bijgewerkte fasetracker hierboven voor de volledige status per fase:

- **Fase 3 (migratie)**: stap (b) uit `migration-report.md` §4 uitgevoerd —
  de twee optionele, ongevulde schemavelden (`conflictsWith`, `sourceExcerptHash`)
  toegevoegd als eigen, geïsoleerde no-op-commit, precies zoals het rapport zelf
  voorschrijft. Stap (c) (daadwerkelijk vullen) blijft liggen: dat is een
  claim over regelinhoud en vereist mens-in-de-lus-goedkeuring per conflict.
- **Fase 7 (memoryProposal)** en **Fase 8 (claim-verificatie)**: allebei
  gerepareerd/aangesloten — zie de fasetracker voor het volledige mechanisme.
  Onderscheid dat hierbij bewust is aangehouden: Lyra-agent-plumbing (geen
  scheduling-domeinrisico) is zelfstandig gerepareerd; wijzigingen die het
  live NS Roosterplatform buiten Lyra raken (de MIX-weergavelabel, de
  60-minuten-drempel in `categoryOf()`) zijn dat bewust NIET — die blijven
  open, met naam benoemd, wachtend op een menselijke beslissing die niet aan
  deze sessie is.
- **Fase 10 (consistency-checker)**: eerste, echte bouwsteen gebouwd
  (`conflictsWithIssues()`), plus een regressietoets die aantoont dat het
  46-uurs-nachtherstelgetal (conflict-report.md #4) al single-source-of-truth
  is in code (`resolveRule()`, geen losse hardcoded kopie) — dat deel van het
  conflict is dus een documentatie-/bronvraag, geen code-drift-risico. Het
  CP-SAT-vs-kwaliteitsmodel-gewichtsverschil (conflict #5) blijft bewust
  ongemeten: een eerlijke ratio vereist optimizer-brede archeologie die
  buiten deze ronde valt.
- **Fase 11 (AFTER) en Fase 12-inzet (adversarial holdout tegen een echt
  model)** blijven `BLOCKED (LOCAL REQUIRED)`: beide vereisen een lokaal
  bereikbaar Ollama/qwen3:8b, niet aanwezig in deze cloud-omgeving. Dit is nu
  de enige resterende harde blokkade voor het grootste deel van het
  Master Program.
- **Fase 13 (promotion-compatibiliteitstest)** blijft geblokkeerd om een
  andere, externe reden: geen toegang tot het echte NS-platform om
  daadwerkelijk tegen te testen — geen LOCAL REQUIRED-vraag, een
  buiten-bereik-vraag.

Volledige `vitest run`: 1109/1136 groen (dezelfde 27 vooraf bestaande,
gedocumenteerde ortools-fouten, plus alle nieuwe tests van deze ronde groen).
`tsc --noEmit`: dezelfde vooraf bestaande baseline-foutregels, buiten
`demo-room/` en ongerelateerd aan deze wijzigingen.

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
| 1 | Immutable BEFORE-benchmark | **COMPLETE (bevestigd)** | Run `20260927-205217`, baseline `588c1e5`, model `qwen3:8b`, stub expliciet uit, 3 replicaten. Artifacts (`BEFORE-VERIFICATION.json`/`manifest.json`/`aggregate.json`) staan nu in `docs/lyra-knowledge/benchmarks/before/20260927-205217/` en zijn onafhankelijk herrekend uit de ruwe item-/replicaatdata (43/43 items, elke categorie-percentage, agreement rate, overall mean — allemaal exact herleid, niet alleen het `status: "PASS"`-veld vertrouwd). `raw/` zelf (de golden.json/golden-grade.json per replicaat) is niet aangeleverd — alleen de sha256-hashes ervan staan vast. |
| 2 | Kennis/bron-inventaris | **COMPLETE** | 4 fase-0-rapporten + source-coverage.md + rule-audit.md + preference-audit.md + human-pattern-audit.md. |
| 3 | Canonical model / migratie | **STAP (a)+(b) COMPLETE, (c)-(e) NOT_STARTED** | `knowledge-model.md` (ontwerp) + `canonical-status.ts` (13 tests). Na de bevestigde freeze: stap (b) uit `migration-report.md` §4 uitgevoerd als eigen, geïsoleerde wijziging — `conflictsWith?: readonly string[]` op `RuleDefinition` en `sourceExcerptHash?: string` op `RuleSource` toegevoegd aan `ruleset/types.ts`, optioneel en door niets gevuld of gelezen (bevestigd no-op: volledige testsuite ongewijzigd groen). Stap (c) — `conflictsWith` daadwerkelijk vullen — blijft bewust liggen: dat is een claim over de inhoud van het regelbestand en vereist mens-in-de-lus-goedkeuring per conflict (§4c), niet iets deze sessie zelf beslist. |
| 4 | Rules/source-consolidatie | **DEELS HERBEOORDEELD — 1 van 2 audit-risico's intern gerepareerd, rest blijft SOURCE_INPUT_REQUIRED** | De BEFORE-freeze-blokkade is opgeheven; zie Fase 5 hieronder voor wat dat voor de twee gepinde risico's concreet betekende. |
| 5 | Menselijke voorkeuren-consolidatie | **AUDIT COMPLETE, 1 van 2 risico's intern gerepareerd** | MIX-alias: de interne `DAY_DUTY_WEIGHTS.MIX`-bronvermelding (`profile-affinity.ts`, nooit gebruikersgericht) markeert de alias nu expliciet als onbevestigd. Het weergavelabel `rosterProfileLabel(MIX)` = "Mix (Vroeg-Laat-Nacht)" zelf blijft bewust ongewijzigd: echte productie-UI-tekst op 16+ pagina's van het live platform die machinisten dagelijks zien — een naamswijziging is een productbeslissing voor NS, niet iets dit sessie zelf mag beslissen op basis van één bron die de alias "niet kan bevestigen" (iets anders dan "weerlegt"). SOURCE_INPUT_REQUIRED, zie `tests/knowledge/known-gaps-pin.test.ts`. De 60-minuten-drempel in `categoryOf()` is NIET aangepast: dat is kern-roosterkwaliteitscode die het optimizer-/vergelijkingsgedrag van het hele platform raakt, geen Lyra-agent-only code — een expliciete menselijke beslissing nodig, geen unilaterale fix. |
| 6 | Officiële menselijke roosterpatronen-consolidatie | **COMPLETE (bevestigd, niet opnieuw gebouwd)** | 7 roosterbladen al volledig geparsed (223 diensten, 0 discrepanties), herbevestigd. |
| 7 | Agent retrieval/tool/grounding-integratie | **memoryProposal-gat GEREPAREERD** | `local.ts`'s `planInstructie()` beschrijft nu memoryProposal (net als proposal); nieuwe `memoryProposalUit()` (zelfde validatiediscipline als `voorstelUit()`) geeft het door vanuit `plan()`, gated op `agent:memory:write` — pariteit met stub.ts. Blijft een voorstel dat een mens moet goedkeuren, niets wordt autonoom. Verplaatst van de pin-suite naar `tests/agent/memory-proposal-lokaal-model.test.ts` (7 tests). |
| 8 | Claim-verificatie | **AANGESLOTEN OP agent.ts** | `ongedekteGezagsClaims()` draait nu na `model.compose()`, in dezelfde poort als grounding.ts (identiek voor stub/lokaal model): een gezagswoord ("bevestigd", "CAO-verplicht", "officieel") zonder `legalStatus: VALIDATED`-signaal in de toolresultaten van deze beurt wordt tegengehouden en vervangen door `claimVerificatieMelding()`, status `NIET_VAST_TE_STELLEN` — nooit stilzwijgend, oorspronkelijke tekst blijft in het activiteitenlog. Draait alleen op tekst die grounding ongemoeid liet. |
| 9 | Regressiesuite uitbreiden | **GEDEELTELIJK COMPLETE** | `jsonUit()`-test (commit `588c1e5`, 8 tests) + golden-suite-extensie (categorieën L, O, geschreven maar NOOIT gedraaid — DB ontbreekt hier) + pin-tests voor de resterende bekende gaten + nieuwe Fase 7/8/10-regressietests deze ronde. |
| 10 | Kennisconsistentie + broncoverage | **CHECKER-INFRA GEBOUWD (eerste, echte stap)** | Nieuw `src/server/knowledge/consistency-check.ts`: `conflictsWithIssues()` — valideert dat elke `conflictsWith`-verwijzing een bestaande regel-id noemt én wederkerig is vastgelegd (5 tests, `tests/knowledge/consistency-check.test.ts`); geeft vandaag `[]` terug (er is nog niets gevuld — verwacht, geen fout) maar is nu klaar zodra Fase 3-stap (c) ooit iets invult. Ook toegevoegd: een regressietoets die vastlegt dat `NIGHT_SEQUENCE_RECOVERY` (conflict-report.md #4) écht dynamisch via `resolveRule()` wordt gelezen door `quality-evaluation-service.ts` — géén losse hardcoded 46 op de kwaliteitsmodel-kant, dus dat deel van conflict #4 is een documentatie-/bronvraag, geen code-drift-risico. Het CP-SAT-vs-kwaliteitsmodel-gewichtsverschil (conflict #5, "~27× lichter") blijft bewust ONgemeten: een eerlijke ratio vereist optimizer-brede archeologie in de CP-SAT-kostenfunctie die buiten deze ronde valt — met naam benoemd, niet stilzwijgend weggelaten. Een Knowledge-UI-scherm (migratierapport §4e) is niet gebouwd. |
| 11 | AFTER-benchmark | **BLOCKED (LOCAL REQUIRED)** | Fase 1 is nu bevestigd; de AFTER-meting zelf vereist nog steeds een lokaal bereikbaar Ollama/qwen3:8b, niet aanwezig in deze cloud-omgeving. Zelfde `run-before-local.ps1`-harnas (of een AFTER-variant), tegen de huidige code, dezelfde golden suite, hetzelfde aantal replicaten — zie migratierapport §4f-g voor de vergelijkingsmethode (itemniveau, niet alleen het totaalpercentage). |
| 12 | Locked holdout/adversarial | **ONTWERP + 9 ITEMS + GRADER COMPLETE, INZET (LOCAL REQUIRED) NOT_STARTED** | `adversarial-holdout-design.md` (architectuur, vries-/auditregel, alle 15 §56-categorieën beoordeeld) + `benchmarks/adversarial-holdout-design.json` (9 volledig gegronde items na de tweede batch — 1+15-gecombineerd, 4-verlengd, 12 — status `DESIGNED_NOT_GRADED`) + `scripts/v106/adversarial-grade.ts` (nieuwe grader, 11 tests, tegen zelfgeschreven GOED/FOUT-voorbeelden — nooit tegen een echt modelantwoord gekalibreerd). Het daadwerkelijk als locked holdout inzetten (Fase 12 zelf, de AFTER-meting) is LOCAL REQUIRED vervolgwerk; 6 categorieën blijven ontwerp-only (4 ervan expliciet LOCAL REQUIRED). |
| 13 | Promotion-compatibiliteitstest | **CONTRACT COMPLETE, TEST NOT_STARTED** | `promotion-contract.md`: criteria + brain-manifest-ontwerp + cross-system-adapterontwerp. Een daadwerkelijke compatibiliteitstest tegen het echte NS-platform is buiten de zichtbaarheid van deze ronde (geen toegang tot dat platform) — **externe blokkade**, niet local-required. |
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

Zodra deze sessie moet stoppen vóór het einde van de opdracht: dit bestand bevat het exacte checkpoint. De BEFORE-freeze is bevestigd (Fase 1 COMPLETE). Vervolg begint bij de eerste fase die niet `COMPLETE`/`TESTED` is en niet LOCAL REQUIRED/extern geblokkeerd is — vandaag is dat Fase 3 stap (c) (conflictsWith vullen, mens-in-de-lus per conflict) of Fase 10's Knowledge-UI-scherm (migratierapport §4e). Fase 11 (AFTER) en Fase 12's daadwerkelijke inzet blijven `BLOCKED (LOCAL REQUIRED)` tot Ollama/qwen3:8b lokaal bereikbaar is; Fase 13 blijft extern geblokkeerd (geen NS-platformtoegang).
