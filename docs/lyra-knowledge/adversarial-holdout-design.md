# Adversarial holdout — ontwerp voor de Lyra-agent-Q&A-benchmark

Opgemaakt 2026-09-27, uitgebreid 2026-09-28 (tweede batch: 3 extra items + de
grader, ná de UI/UX REBUILD-focusfase, zie `progress.md`) (LYRA MASTER
PROGRAM, §37 en §56). Dit document ontwerpt de
derde, doelbewust-adversarial holdoutlaag voor de agent-Q&A-benchmark die
`docs/lyra-knowledge/knowledge-gap-report.md` §10 en
`docs/lyra-knowledge/inventory-benchmark-infrastructure.md` (hoofdstuk
"DEV/HOLDOUT-scheiding") als open gat vaststellen. Het bouwt NIET blind iets
nieuws: het inspecteert eerst wat er al bestaat (§1), hergebruikt een bestaand
patroon in plaats van een nieuw te verzinnen (§1), en beperkt zich verder tot
ontwerp + een klein, expliciet ongegradeerd startbestand (§3-§4). Er is in deze
sessie geen database beschikbaar (bevestigd, zie
`docs/lyra-knowledge/current-state.md`, "Wat blijft LOCAL REQUIRED"); niets
hieronder vereist dat er wél een was, behalve waar met zoveel woorden vermeld.

Bijbehorend databestand:
`docs/lyra-knowledge/benchmarks/adversarial-holdout-design.json` (9 items na
de tweede batch, `status: "DESIGNED_NOT_GRADED"`), en sinds de tweede batch
ook een grader: `scripts/v106/adversarial-grade.ts` (zie hieronder,
"Grader gebouwd").

---

## 1. Wat al bestaat, en wat NIET wordt herbouwd

**Twee bestaande mechanismen, voor twee verschillende dingen — beide blijven
ongewijzigd.**

### 1.1 De gewone dev/holdout-verdeling (golden-suite.json / r2-suite.json) — géén adversarial ontwerp, blijft zo

- `docs/v1.0.6/golden-suite.json`: **43 items, 35 dev / 8 holdout**
  (`counts.total: 43`, `counts.dev: 35`, `counts.holdout: 8`), verdeeld over
  10 categorieën A–J. De holdout-toewijzing is een gewone, per-categorie
  geteld-op-de-5e-steekproef (`holdoutTeller % 5 === 0`, beschreven in
  `docs/lyra-knowledge/inventory-benchmark-infrastructure.md:85-90`) — **geen
  doelbewuste adversarial constructie**, gewoon een representatieve
  steekproef die "niet gebruikt wordt om te sturen"
  (`inventory-benchmark-infrastructure.md:88-89`, citerend `golden-suite.ts`).
- `docs/v1.0.6/r2-suite.json`: **15 items, 5 holdout**, eigen, onafhankelijke
  holdout-markering over 5 "casussen" A–E
  (`inventory-benchmark-infrastructure.md:70-74`).
- `scripts/v106/golden-suite-extension.ts` (deze sessie eerder toegevoegd,
  ongewijzigd gelaten): breidt de suite additief uit met categorieën L
  (roostervergelijking) en O (nachtreeksen), **beide honderd procent gegrond
  op reeds bestaande `waarheid.ts`-functies**, en schrijft naar een NIEUW
  bestand (`golden-suite-extension.json`), niet naar de bevroren 43-item
  basis. Nooit uitgevoerd in deze cloud-omgeving (geen database) — het
  script zelf documenteert dat expliciet (`golden-suite-extension.ts:34-46`).

**Dit document stelt niet voor deze twee bestanden te vervangen, samen te
voegen of hun dev/holdout-verdeling te herzien.** Ze blijven precies wat ze
zijn: de gewone regressiebasis. Het `groei()`-mechanisme in `golden-suite.ts`
(nooit uitgevoerd, `inventory-benchmark-infrastructure.md:67-68`) blijft het
juiste pad naar 100+ **representatieve** items — een apart, al bekend gat
(`knowledge-gap-report.md` §9), niet dit document se onderwerp.

### 1.2 Het bestaande adversarial-patroon — `contrastive-check.json` (kwaliteitsmodel, NIET de agent)

Volledig gelezen: `docs/human-roster-benchmark/contrastive-check.json`
(schema `ns-contrastive-check/1`, gemeten 2026-09-18). Structuur:

- Een `adversarial`-array van vier toetsen (`versnipperde-nachten`,
  `vroeg-na-nachten`, `heen-en-weer`, `springende-begintijden`), elk met:
  een **principe** (bv. "Nachten in reeksen van drie tot zes"), een aantal
  **doelbewuste ruilen** die een goed menselijk rooster muteren naar een
  slechter rooster, en per kwaliteitsmodelversie (v1/v2) een resultaat:
  `hardValid`, `onderdeelMens` vs. `onderdeelNegatief` (score vóór/na
  mutatie), **`ziet: true/false`** (detecteerde het model de verslechtering
  überhaupt?), en `menselijkHoger` (scoorde het gemuteerde rooster
  terecht lager?).
- Een los `historical`-blok met werkelijke solver-runs, niet onderdeel van
  het adversarial-mechanisme zelf.

**De architectuur die hier wordt hergebruikt** (niet de inhoud — dit test het
kwaliteitsmodel van roosters, niet Lyra):

1. Begin bij een **bekend-goed, geverifieerd geval** (hier: een echt
   menselijk rooster; bij de agent: een bestaand, al-bevroren
   grondwaarheid-feit of -scenario).
2. Pas een **doelbewuste, specifiek benoemde mutatie** toe langs precies één
   faaldimensie (hier: nachten versnipperen; bij de agent: een specifieke
   valkuil injecteren — een onbevestigde claim, een tegenstrijdige
   standplaats, een tool die faalt, enz.).
3. Registreer een **boolean detectiesignaal** (`ziet`) plus een vergelijkende
   maat (`menselijkHoger`) — bij de agent: het analoge paar is
   `expect.kind` + een nog-te-schrijven grader die "ziet de agent de val, of
   trapt hij erin" als boolean teruggeeft.

**Wat dit document NIET doet: een nieuw mechanisme verzinnen.** Het
her-target exact deze architectuur van "kwaliteitsmodel-van-roosters" naar
"Lyra-agent-antwoordgedrag", en van "muteer een rooster" naar "muteer de
vraag/context met een specifieke, benoemde valkuil". Zie §3 voor de
concrete toepassing per categorie.

---

## 2. Drie lagen, expliciet onderscheiden (§37)

| Laag | Bestand | Aantal | Doel | Wanneer gebruikt |
| --- | --- | ---: | --- | --- |
| **DEV** | `docs/v1.0.6/golden-suite.json` (`holdout: false`) | 35 | Ontwikkelen, prompts/instructies bijsturen | Doorlopend, Fase 3-10 |
| **HOLDOUT** (gewoon) | `docs/v1.0.6/golden-suite.json` (`holdout: true`) | 8 | Representatieve steekproef, controleren zonder te sturen | Elke meting (BEFORE/AFTER), nooit om op te sturen |
| **ADVERSARIAL HOLDOUT** (nieuw) | `docs/lyra-knowledge/benchmarks/adversarial-holdout-design.json` | 6 (ontworpen; 9 categorieën nog niet geauteerd, zie §3) | Doelbewust ontworpen faalscenario's, NOOIT gezien vóór de AFTER-meting | **Uitsluitend** de locked-holdout-evaluatiestap van Fase 12 |

De eerste twee lagen bestaan al en werken (§1.1). De derde is nieuw en is
precies waar §37 ("Holdout wordt NIET gebruikt om te sturen") het strengst
moet worden toegepast — strenger dan de gewone holdout, want het hele nut van
een adversarial laag is dat hij nooit, ook niet per ongeluk tijdens het
debuggen, is gezien vóórdat de AFTER-meting plaatsvindt. Zodra een
ontwikkelaar ook maar één item leest tijdens Fase 3-10, is de laag
gecontamineerd — subtieler dan "erop trainen", maar met hetzelfde effect
(onbewust op de valkuil voorsorteren).

### 2.1 Opslaglocatie — waarom niet in `docs/v1.0.6/`

`docs/lyra-knowledge/benchmarks/adversarial-holdout-design.json` staat
bewust **buiten** `docs/v1.0.6/`, waar `golden-suite.json` en `r2-suite.json`
staan. Reden: die map bevat uitsluitend bestanden die al zijn *gemeten*
(bevroren metingen, zie §4). Dit nieuwe bestand is expliciet
**`DESIGNED_NOT_GRADED`** — er bestaat nog geen grader, dus er kan nog geen
meting mee gedaan worden. Het in `docs/v1.0.6/` zetten zou het risico
vergroten dat een toekomstig script dat die map naïef doorloopt (bv.
`run-before-local.ps1`, dat vandaag al specifiek `golden-suite.json`
aanroept — `golden-suite-extension.ts:16`) dit bestand per ongeluk meeneemt
vóór Fase 12. Zodra Fase 8 een grader heeft en Fase 12 aanbreekt, wordt dit
bestand (of een kopie ervan) verplaatst naar een `docs/v1.0.6/`-achtige
locatie als onderdeel van het daadwerkelijke freeze-moment (§2.2, stap 3).

### 2.2 Vries-/auditmechanisme — hoe "nooit tijdens ontwikkeling gebruikt" afdwingbaar wordt

Ontwerp (nog niet uitgevoerd — dit zijn de stappen die bij Fase 8/12 gezet
moeten worden, niet in deze sessie):

1. **Eigen bestand, eigen status-veld.** Dit bestand draagt vanaf het begin
   `"status": "DESIGNED_NOT_GRADED"`. Zodra een grader bestaat maar de
   AFTER-meting nog niet is gestart, wordt dit `"GRADED_AWAITING_FREEZE"`.
   Pas op het moment dat Fase 12 begint, wordt het `"FROZEN"` — een
   expliciete, git-zichtbare statuswijziging, geen stille aanname.
2. **Eigen sha256, vastgelegd in een manifest** — zelfde patroon als al
   twee keer in dit project bestaat:
   - `docs/v1.0.6/n0-manifest.json`: `dutyPackage.sourceChecksum` (één
     hash voor het hele dienstenpakket).
   - `docs/optimizer-benchmark/manifest.json`: `hashes.profileConfig`,
     `hashes.ruleset`, `hashes.optimizerConfig`, `hashes.solverScript` (vier
     losse sha256-hashes per configuratiebestand), berekend met de
     bestaande `sha256`-hulpfunctie in `scripts/benchmark/io.ts`
     (`inventory-benchmark-infrastructure.md:170-171, 239-245`).

   Voor deze laag: op het moment dat het bestand overgaat naar `"FROZEN"`
   (stap 1), wordt zijn sha256 (met dezelfde `sha256`-hulpfunctie uit
   `scripts/benchmark/io.ts`, niet een nieuwe) vastgelegd in een nieuw
   manifestveld — bijvoorbeeld `adversarialHoldout.sha256` in het
   gecombineerde voor-manifest dat `inventory-benchmark-infrastructure.md`
   (hoofdstuk "Manifest/freeze-praktijk") al aanbeveelt voor een volgende
   BEFORE/AFTER-ronde. Een latere AFTER-run die dit bestand inleest,
   controleert de hash eerst (zelfde garantie-principe als de
   optimizer-benchmark, die weigert te starten bij afwijkende brondata —
   `inventory-benchmark-infrastructure.md:167-169`).
3. **Geschreven leesregel (procedureel, niet — nog — technisch
   afgedwongen).** Vastgelegd hier, met zoveel woorden: *dit bestand mag
   uitsluitend worden GELEZEN tijdens de locked-holdout-evaluatiestap van
   Fase 12 (de AFTER-meting). Het mag niet worden gelezen, laat staan
   gedraaid, tijdens Fase 3 t/m 10 — ook niet "even ter inspiratie", ook niet
   door een ontwikkelaar die claimt niet te zullen sturen op de inhoud.* Dit
   is strenger dan de bestaande regel voor de gewone holdout
   ("Holdoutitems worden nooit gebruikt om prompts of instructies bij te
   sturen", `inventory-benchmark-infrastructure.md:87-89`) — die staat een
   ontwikkelaar toe het item te *zien* zolang hij het resultaat niet
   gebruikt om te sturen; hier is zelfs het zien zelf de contaminatie,
   precies omdat een adversarial val zijn waarde verliest zodra iemand hem
   kent vóór de meting.
4. **Auditspoor = git-geschiedenis.** Net als `n0-manifest.json` al
   `git.headCommit`/`git.uncommittedPaths` vastlegt als bewijs van de
   uitgangssituatie (`inventory-benchmark-infrastructure.md:220`), is de
   commit die dit bestand naar `"FROZEN"` zet zelf het bewijs: `git log -p`
   op dit pad na die commit hoort **niets** te laten zien behalve
   toevoegingen van nieuwe items (zie §4, append-only) — nooit een
   aanpassing van een bestaand item se `expect`-veld. Een diff die dat wél
   laat zien, is een geschonden freeze, zichtbaar en onweerlegbaar in de
   geschiedenis.
5. **Nog niet technisch afgedwongen — expliciet genoemd als vervolgwerk.**
   Er bestaat vandaag geen CI-hook of lint-regel die een `import`/read van
   dit bestand vanuit `scripts/v106/*.ts` tijdens Fase 3-10 zou blokkeren.
   Aanbeveling voor Fase 9/11 (niet in deze sessie gebouwd, buiten scope van
   een schrijfopdracht): een eenvoudige CI-check die faalt zodra een
   niet-Fase-12-gemarkeerd script dit pad aanraakt vóór een
   `fase12-unlock`-markeerbestand bestaat. Dit is een aanbeveling, geen
   claim dat het al bestaat.

---

## 3. De ~15 categorieën uit §56 — wat elk toetst, waarom adversarial, en of nu al een echt item mogelijk is

| # | Categorie (§56) | Wat het toetst | Waarom adversarial (kruisverwijzing) | Structureel/tekstueel of levend dienstenpakket nodig | Nu geauteerd? |
| --- | --- | --- | --- | --- | --- |
| 1 | Valse bronclaim | Beweert de agent dat iets "bevestigd"/"officieel" is zonder een tool met `legalStatus: VALIDATED`? | Rechtstreeks het gat uit `current-state.md:60-62` / `knowledge-gap-report.md` §7: "geen automatische controle op onbevestigde autoriteitstaal" — §29 (claim-verificatie). | **Structureel.** Kan met bestaande `MISSING_PACKAGES`-bronstatussen (bv. `CAO_CURRENCY_CONFIRMATION`) worden gebouwd, geen DB nodig. | **Ja (tweede batch) — item `S-WEEKENDNORM-VALSE-AUTORITEIT`**, gecombineerd met categorie 15 (zie hieronder). |
| 2 | Oude ingetrokken regel | Presenteert de agent een regel als onvoorwaardelijk geldig terwijl de bron ervan is verlopen/onbevestigd? | §56 zelf; dichtstbijzijnde échte codevoorbeeld is de CAO-actualiteitskwestie (zie item R). | **Structureel** — maar met een eerlijkheidskanttekening: er bestaat GEEN letterlijke `RuleStatus`-waarde "WITHDRAWN" in dit project (geverifieerd: `src/server/rules-engine/ruleset/types.ts:58-72`). | **Ja — item `R-NIGHT-RECOVERY-CAO-ACTUEEL`** (dekt tegelijk categorie 8, zie hieronder). |
| 3 | Twee lokale standplaatsen, tegenstrijdige voorkeur | Verzint de agent een tweede-standplaats-voorkeur die niet bestaat? | `knowledge-gap-report.md` §8(b): geen Dordrecht-lokaal-vs-NS-breed scope-veld bestaat. | **Structureel** — het ontbreken van het scope-mechanisme is een statisch codefeit. | **Ja — item `M-ROTTERDAM-VS-DORDRECHT`.** |
| 4 | "Kandidaat 2" na langdurig multi-turn-gesprek | Behoudt de agent de juiste kandidaat-referentie over veel beurten heen? | Zelfde patroon als bestaande categorie G (golden-suite.json) en casus B_contextbehoud (r2-suite.json, 8 items) — hier expliciet verlengd/adversarial gemaakt (meer beurten, subtielere afleiding). | **Structureel** — kan volledig met al-bevroren, bekende roostercijfers (golden-suite.json) worden opgebouwd, geen nieuwe DB-query nodig. | **Ja (tweede batch) — item `U-KANDIDAAT2-VERLENGD-SUBTIEL`** (5 beurten, een echte onderwerpsafleiding, impliciete i.p.v. letterlijke kandidaatverwijzing). |
| 5 | Zelfde dienstnummer, andere weekdag/tijd | Onderscheidt de agent correct dat één dienstnummer op verschillende weekdagen andere tijden kan hebben? | Cross-referentie met de historische BLM-casus die in `waarheid.ts:11-17` al NIET in het huidige pakket bleek te bestaan ("dienst 760 22:00–06:00 ... bestaat niet in het huidige pakket") — precies het risico van hardcoding dat §37 verbiedt. | **Levend dienstenpakket nodig** (`loadEvaluationContextCore`, DB). | Nee — expliciet LOCAL REQUIRED; geen cijfer hier verzonnen. |
| 6 | Cross-cycle-nachtreeks (exacte rusturen) | Telt de agent een nachtreeks correct door over de cyclusgrens heen, met de juiste rust in uren? | `scripts/v106/golden-suite-extension.ts` categorie O (nachtreeksen) is al gebouwd op `nachtreeksLengtePerRooster`, maar nooit gedraaid (geen DB). | **Levend dienstenpakket nodig** — generator bestaat al (`waarheid.ts` + `golden-suite-extension.ts`), alleen uitvoeren ontbreekt. | Nee — generator is al het juiste artefact; hier alleen als behoefte benoemd, niet opnieuw gebouwd. |
| 7 | BLM-labeloverlap (klok vs. label) | Scoort/beschrijft de agent een dienst rond de 60-minutengrens consistent met de klok, niet alleen met het label? | Defect #4 in `current-state.md`: de 60-minuten-drempel zit in `rhythm-metrics.ts`/`quality-model.ts` maar ontbreekt in `roster-quality.ts`'s `categoryOf()` — een reële drift tussen twee actieve onderdelen. | **Levend dienstenpakket nodig** voor een geloofwaardig conversatie-item (een echte dienst met een starttijd vlak bij de grens); de onderliggende code-drift zelf is al met een unit-test op de functie te vangen (aanbevolen in `progress.md` Fase 4/9), maar dat is geen golden-suite-achtig item. | Nee. |
| 8 | Oude CAO vs. nieuwe CAO | Behandelt de agent de 2024-2025-CAO-tekst als vanzelfsprekend nog actueel voor okt-dec 2026? | `knowledge-gap-report.md` §2: CAO verlopen (t/m 1 mrt. 2025), `CAO_CURRENCY_CONFIRMATION` blokkerend. | **Structureel** — CAO-tekst is aanwezig en machineleesbaar (107 pag., sha256 vastgelegd), alleen de actualiteitsvraag zelf is onbevestigd; geen DB nodig. | Al gedekt door item **R** (zelfde grondwaarheid als categorie 2 hierboven — bewust niet dubbel geauteerd, zie item R se note). |
| 9 | Profielalias | Presenteert de agent de MIX="Vroeg-Laat-Nacht"-alias als bevestigd? | `inventory-quality-and-preferences.md:59-68`, `progress.md:71` (risico 1, "Hoog") — dit sessies eigen vondst. | **Structureel** — volledig uit broncode + brondocument-manifest. | **Ja — item `K-MIX-ALIAS`.** |
| 10 | Ontbrekende bron | Citeert de agent een bron die niet machineleesbaar/niet geverifieerd is alsof hij die wél kent? | `knowledge-gap-report.md` §3: Roosterkaders Regio West 2026, scan zonder tekstlaag, `HUMAN_REVIEW_REQUIRED`. | **Structureel** — bronstatus is een vaststaand, gelezen document-feit. | **Ja — item `P-REGIO-WEST-KADERS-CITAAT`.** |
| 11 | Tool-falen | Verzint de agent een antwoord wanneer een toolaanroep zelf faalt (niet: leeg resultaat, maar een fout)? | Mogelijk gat naast de bestaande FABRICATED/EXISTS_BUT_NOT_RETRIEVED-tweedeling in `grounding.ts` (`knowledge-gap-report.md` §7-achtig, hier: een DERDE toestand, TOOL_ERROR — of die al apart bestaat is in deze sessie **niet vastgesteld**). | **Structureel voor het item-ontwerp zelf** (bekende roostercijfers, bekende toolnaam); het daadwerkelijk *verifiëren* dat `model/local.ts` een tool-fout anders afhandelt dan een lege respons is LOCAL REQUIRED. | **Ja (ontwerp) — item `Q-DDR-BLM-NIGHTSTRUCTURE-TOOLFOUT`**, met expliciete "niet vastgesteld"-kanttekening. |
| 12 | Ontbrekende afhankelijkheid | Wat doet de agent als een tool een ándere tool/veld vereist die niet is aangeleverd (bv. `dutyInstance` vereist `dutyCode` die niet bekend is)? | Nauw verwant aan categorie 11 (tool-falen), zelfde toolCatalogue (`n0-manifest.json`, `requires`-velden). | **Structureel** — `requires`-velden zijn statische code. | **Ja (tweede batch) — item `T-DUTYINSTANCE-ONTBREKENDE-DUTYCODE`** (grondwaarheid: `dutyInstance`-tool, tools.ts:148, verplicht `dutyCode`-veld). |
| 13 | Database-leesfout | Hoe reageert de agent als een DB-afhankelijke opvraging faalt? | Zelfde familie als 11/12, maar op infrastructuurniveau in plaats van tool-niveau. | **Levend systeem nodig** om een echte DB-leesfout te simuleren (er is hier geen DB — kan sowieso niet worden getest in deze omgeving). | Nee. |
| 14 | Onbekende dienstsoort | Verzint de agent een aantal/uitleg voor een dienstsoort-term die niet in het domeinwoordenboek voorkomt? | Zelfde patroon als de historische RET-bug (`current-state.md` defecttabel, `progress.md:53`). | **Structureel** — de kinds-enum (VROEG/LAAT/NACHT/RANGEER/RESERVE, `waarheid.ts:48-52`) is statische code; gebruikt roostercode is al bevroren bekend. | **Ja — item `N-DDR-50MIX-OMLOOP`.** |
| 15 | Foutieve gebruikersaanname | Corrigeert de agent een feitelijk onjuiste aanname van de gebruiker, ook onder druk van autoriteitstaal of een lang gesprek? | Overlapt met bestaande golden-suite-categorie B (7 items, `corrects_false_premise`) en r2-suite casus A_ongefundeerde_conclusie. | **Structureel**, maar redundant met bestaande dekking — een adversarial variant zou de moeilijkheid moeten VERHOGEN (bv. combineren met categorie 1 of 4), niet hetzelfde nogmaals toetsen. | **Ja (tweede batch), gecombineerd met categorie 1 — item `S-WEEKENDNORM-VALSE-AUTORITEIT`** (een verzonnen autoriteitsverwijzing, "de planner heeft dit bevestigd", bovenop een onbevestigd cijfer — precies de hier aanbevolen combinatie, niet apart geauteerd). |

**Resultaat na de tweede batch (vervolgronde, Master Program hervat): 9 van de
15 categorieën nu als echt item geauteerd** (1+15-gecombineerd, 2, 3,
8-gedeeld-met-2, 4-verlengd, 9, 10, 11, 12, 14 — 9 items dekken 10
categorienummers, want categorie 8 wordt gedeeld door item R en categorie 2,
en categorie 15 wordt gedeeld door het nieuwe item S en categorie 1, precies
zoals dit document zelf voor categorie 15 aanbeval: "combineren met categorie
1 of 4"). Nieuw geauteerd in de tweede batch:

- **Item `S-WEEKENDNORM-VALSE-AUTORITEIT`** (categorie 1, valse bronclaim —
  gecombineerd met categorie 15, foutieve gebruikersaanname onder
  autoriteitsdruk): grondwaarheid `REGIO_WEST_WEEKEND_TARGET_DEFINITION`
  (regio-west-2026.ts, regels 91-99 en 385-391).
- **Item `T-DUTYINSTANCE-ONTBREKENDE-DUTYCODE`** (categorie 12, ontbrekende
  afhankelijkheid): grondwaarheid de verplichte `dutyCode`-parameter van de
  `dutyInstance`-tool (tools.ts, regel 148 — geen `.nullish()`/`.default()`).
- **Item `U-KANDIDAAT2-VERLENGD-SUBTIEL`** (categorie 4, kandidaat-2-verwarring
  verzwaard): 5 beurten in plaats van de bestaande 2, met een echte
  onderwerpsafleiding en een impliciete in plaats van letterlijke
  kandidaatverwijzing — bouwt voort op golden-suite.json (A-DDR-50MIX) en
  r2-suite.json (casus B_contextbehoud) zonder die te wijzigen.

**Nu nog 6 categorieën ontwerp-only, waarvan 4 expliciet `LOCAL REQUIRED`**
(5, 6, 7, 13) en 2 bewust nog niet apart geauteerd omdat ze al gedekt zijn
door een gecombineerd item (8 via R, 15 via S).

## Grader gebouwd (vervolgronde) — `scripts/v106/adversarial-grade.ts`

Zelfde architectuur als `golden-grade.ts` (een `switch`/lookup per soort,
GOED/FOUT/ONBEOORDEELD, puur tekst-/structuurpatroon — nooit LLM-
zelfbeoordeling), hier gedispatcht op `expect.category` in plaats van
`expect.kind`, met één beoordelingsfunctie per hierboven geauteerde
categorie. **Belangrijke eerlijkheidsgrens, ook in de code zelf vastgelegd**:
deze heuristieken zijn nooit tegen een echte modeltranscriptie gekalibreerd
(geen Ollama in deze omgeving) — alleen tegen 11 zelfgeschreven, realistische
GOED/FOUT-voorbeeldantwoorden per categorie
(`tests/lyra-master/adversarial-grade.test.ts`, allemaal groen). Bij twijfel
geeft elke functie `ONBEOORDEELD` terug in plaats van te gokken. Dit
verandert de statusregel uit §2.2 hierboven NIET: dit bestand mag pas naar
`"GRADED_AWAITING_FREEZE"` zodra de grader tegen een echte meting is
gedraaid, en dat kan alleen LOCAL REQUIRED (Fase 12, de AFTER-meting). Het
`status`-veld in `adversarial-holdout-design.json` blijft daarom bewust
`"DESIGNED_NOT_GRADED"`.

---

## 4. Freeze/audit-regel: append-only zodra items zijn gegradeerd en gecommit

Zodra een grader voor `adversarial_TBD`-achtige `expect.kind`-waarden bestaat
(Fase 8) en dit bestand (of de dan geldende versie ervan) na de AFTER-meting
daadwerkelijk is gebruikt, geldt vanaf dat moment dezelfde regel die dit
project al op twee andere plekken toepast:

- `docs/v1.0.6/r2-pre-bevindingen.md:6`: *"Deze meting en de bijbehorende
  suite zijn bevroren zodra dit document is geschreven"*.
- `docs/v1.0.6/r2-suite.json:5` (`purpose`-veld): *"Bevroren zodra R2-PRE is
  gemeten; niet wijzigen tussen R2-PRE en R2-POST/N2."*

Toegepast op dit bestand: **na de freeze-commit (§2.2, stap 1: status
`"FROZEN"`) mag een bestaand item se `expect`-veld, `turns`, `context` of
`note` nooit meer worden aangepast.** Nieuwe adversarial cases mogen wél
worden toegevoegd (append-only, nieuwe `id`'s, met een eigen
`generatedAt`/versie-aantekening) — precies zoals `golden-suite.ts`'s
`groei()`-mechanisme additief is bedoeld voor de gewone suite
(`inventory-benchmark-infrastructure.md:67-68`) en zoals
`golden-suite-extension.ts` expliciet "telt op, vervangt niets"
(`golden-suite-extension.ts:126`: `"extendsBaseSuite": "... ONGEWIJZIGD —
dit bestand vervangt niets, telt op"`). Blijkt een item achteraf fout
gegrond (bv. een aanname die niet klopte), dan wordt dat vastgelegd als een
zichtbare, gedateerde correctie-aantekening naast het oude item — nooit als
een stille overschrijving — exact het principe dat
`docs/lyra-knowledge/migration-report.md:115-126` voorschrijft: *"Nooit een
audit-'fix' een waarde laten wijzigen zonder het als correctie vast te
leggen... een zichtbaar record met een eigen review-status, nooit een stille
waardewijziging."*

**Vandaag (2026-09-27) is dit bestand nog niet bevroren** —
`status: "DESIGNED_NOT_GRADED"` in
`docs/lyra-knowledge/benchmarks/adversarial-holdout-design.json` markeert
precies dat het nog in de ontwerpfase zit; de append-only-regel hierboven
gaat pas in zodra Fase 8 een grader oplevert én Fase 12 dit bestand
daadwerkelijk als locked holdout in gebruik neemt.
