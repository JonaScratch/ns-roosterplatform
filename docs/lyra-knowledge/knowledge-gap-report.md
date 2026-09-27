# Kennishiaten-rapport — Fase 0, LYRA MASTER PROGRAM

Opgemaakt 2026-09-27/28. Dit document verzamelt **alleen hiaten**: dingen die
ontbreken (een afwezigheid), niet twee dingen die met elkaar in tegenspraak
zijn. Tegenspraken staan in `docs/lyra-knowledge/conflict-report.md`.

Elk item hieronder heeft: wat er mist, waarom dat ertoe doet, en of het
**SOURCE_INPUT_REQUIRED** is (iets dat alleen een mens/NS kan aanleveren) of
een **interne technische hiaat** die dit project zelf kan dichten. Net als in
het conflictrapport: dit document stelt geen fix voor en verandert geen
gedrag — het documenteert de stand van zaken zoals aangetroffen in de vier
Fase 0-inventarisdocumenten, aangevuld met eigen verificatie van de
broncode waar aangegeven. Waar iets onduidelijk bleef staat "niet
vastgesteld".

---

## 1. De 9 MISSING_PACKAGES in `regio-west-2026.ts`

**Wat mist.** Negen volledig ontbrekende regelpakketten, letterlijk zo
benoemd in de rules-engine-code zelf
(`src/server/rules-engine/ruleset/regio-west-2026.ts:340-420`,
`export const MISSING_PACKAGES`). Hieronder elk pakket met zijn exacte,
huidige `reason`-tekst uit het bestand (geverifieerd door deze sessie
rechtstreeks in de broncode):

1. **`ATW_VALIDATED_RULESET`** — "Arbeidstijdenwet, gevalideerd regelpakket"
   — *"De aangeleverde bron is de CAO. De CAO bepaalt zelf dat een
   werktijdregeling ook aan de Arbeidstijdenwet moet voldoen. De actuele
   wettekst en de bijbehorende grenswaarden zijn niet aangeleverd en worden
   niet gereconstrueerd."* (blokkeert `PUBLICATION`, `PRODUCTION_MODE`)
2. **`ATB_VALIDATED_RULESET`** — "Arbeidstijdenbesluit vervoer, gevalideerd
   regelpakket" — *"Voor spoorwegpersoneel gelden aanvullende bepalingen uit
   het Arbeidstijdenbesluit vervoer. Niet aangeleverd."* (blokkeert
   `PUBLICATION`, `PRODUCTION_MODE`)
3. **`CAO_CURRENCY_CONFIRMATION`** — "Bevestiging welke CAO actueel is" —
   *"De aangeleverde CAO heet 2024–2025. Voor planning in 2026 moet NS
   bevestigen welke CAO, nawerking of nieuwe afspraken gelden."* (blokkeert
   `PRODUCTION_MODE`)
4. **`QUALIFICATION_MATRIX`** — "Kwalificatiematrix" — *"Welke baanvakken,
   materieelsoorten, bevoegdheden en lokale kennis een dienst vereist, en
   welke een medewerker heeft, komt uit een bronsysteem dat niet is
   aangesloten."* (blokkeert `PUBLICATION`, `PRODUCTION_MODE`)
5. **`DORDRECHT_BREAK_PARAMETER`** — "Werkonderbreking en
   arbeidstijdcorrectie voor deze standplaats" — *"De CAO legt de duur van
   de werkonderbreking en de daaraan gekoppelde verlaging van de maximale
   arbeidstijd per standplaats vast. Die waarden zijn niet aangeleverd."*
   (blokkeert `DUTY_WITH_LONG_BREAK`)
6. **`REGIO_WEST_WEEKEND_TARGET_DEFINITION`** — "Definitie van de
   weekendmaatstaf Regio West" — *"Het kader noemt 'zoveel als mogelijk 50%
   weekenden' zonder wiskundige definitie."* (blokkeert
   `WEEKEND_TARGET_OPTIMIZATION`)
7. **`MIX_BLM_50PLUS_PROFILE_RULES`** — "Bijzondere regels Mix, BLM en 50+
   Mix" — *"Niet formeel vastgelegd."* (blokkeert `MIX_PROFILE_PLACEMENT`)
8. **`INDIVIDUAL_RESTRICTIONS_SOURCE`** — "Bron voor individuele
   arbeidstijdbeperkingen" — *"Individuele beperkingen moeten uit een
   geautoriseerd HR-systeem komen. Er is geen koppeling; de engine kan
   daarom niet weten of een medewerker een beschermde beperking heeft."*
   (blokkeert `PUBLICATION`, `PRODUCTION_MODE`)
9. **`EMPLOYEE_CONTRACT_HOURS`** — "Contractomvang per medewerker" —
   *"Urennormen zijn niet te berekenen zonder de individuele
   contractomvang. Er wordt geen 36 of 40 uur aangenomen."* (blokkeert
   `WEEKLY_HOURS_VALIDATION`)

Het bestand bevat daarnaast nog een tiende item,
**`WR_CO_DEFINITION`** ("Betekenis en regels van de roosterposities WR en
CO" — *"Komen voor in bestaande roosters; hun regels zijn niet
aangeleverd."*, blokkeert `WR_CO_PLACEMENT`) — de inventaris
(`inventory-rules-and-sources.md:19-20, 257`) noemt dit pakket ook expliciet
bij naam in de opsomming van de negen. Bij rechtstreekse telling in de
broncode (`regio-west-2026.ts:340-420`) staan er **tien** entries in de
array, niet negen; dit rapport citeert ze daarom alle tien hierboven en
markeert het aantal-verschil (9 genoemd in `docs/rule-coverage.md`/de
inventaris versus 10 aangetroffen bij directe telling) hier expliciet als
**niet nader verklaard** — mogelijk is één pakket na de meting van
`rule-coverage.md` (2026-09-06) toegevoegd. Dit zelf is dus ook een kleine,
hier gemelde discrepantie, geen aanname.

**Waarom dit ertoe doet.** Elk van deze pakketten blokkeert expliciet
`PUBLICATION` en/of `PRODUCTION_MODE` (of een specifiekere functie). Zolang
ze ontbreken, kan geen enkele beslissing die op deze pakketten leunt
"veilig worden genomen" — letterlijk het eigen doel van deze lijst
("Dit is geen lijst met wensen maar een blokkeerlijst",
`regio-west-2026.ts:335-338`).

**SOURCE_INPUT_REQUIRED of interne hiaat?** Overwegend
**SOURCE_INPUT_REQUIRED** (1, 2, 3, 4, 5, 6, 7, 8, 9 vereisen allemaal een
extern brondocument, NS-bevestiging of gekoppeld bronsysteem). Pakket
10 (WR/CO-definitie) is eveneens SOURCE_INPUT_REQUIRED (regels "niet
aangeleverd").

---

## 2. CAO-actualiteit: de enige aanwezige CAO (2024-2025) is verlopen voor okt-dec 2026

**Wat mist.** Bevestiging van welke CAO, nawerkingsregeling of nieuwe
afspraken daadwerkelijk gelden voor de roosterperiode oktober-december
2026. De enige aanwezige CAO-tekst (`NS CAO 2024-2025.pdf`, 107 pagina's,
machineleesbaar, sha256 vastgelegd) is geldig tot 1 maart 2025.

**Bewijs.** `inventory-rules-and-sources.md:283-288` (§5),
`current-state.md:73` (tabel: *"Verlopen voor de geauditeerde periode
(geldig t/m 1 mrt. 2025; roosters lopen okt-dec 2026) —
`HISTORICAL_SOURCE`, `CAO_CURRENCY_CONFIRMATION` staat al als blokkerend
punt in de code"*), en pakket 3 hierboven
(`CAO_CURRENCY_CONFIRMATION` in §1 van dit document).

**Waarom dit ertoe doet.** 59 van de 71 regels in het regelbestand zijn
gebaseerd op deze CAO-tekst. Als de daadwerkelijk geldende CAO voor 2026
ook maar één afwijkende waarde bevat, zijn die regels formeel niet meer
correct — en dat kan vandaag niet worden vastgesteld omdat de juiste
bron nog niet is aangeleverd.

**SOURCE_INPUT_REQUIRED.** Dit kan dit project niet zelf oplossen: het
vereist dat NS aangeeft welke CAO, nawerking of nieuwe afspraken voor de
geauditeerde periode gelden.

---

## 3. Roosterkaders Regio West 2026: scan zonder tekstlaag, alleen een concept-transcriptie

**Wat mist.** Een menselijk geverifieerde, machineleesbare tekst van
"Roosterkaders Regio West 2026 ondertekend (1).pdf". Het aangeleverde
bestand is een scan zonder tekstlaag (10 pagina's, 11 afbeeldingen, nul
lettertypen), bewust nooit met OCR bewerkt.

**Bewijs.** `inventory-rules-and-sources.md:289-300` (§5), status
`SOURCE_PRESENT_NOT_MACHINE_READABLE`, met de expliciete motivatie uit
`docs/source-inventory-phase-o.md`: *"een raadslag over wat er in een
ondertekend regionaal kader staat, is precies het soort bron dat later
niemand meer als raadslag herkent"*. Er bestaat een voorlopige,
beeld-gebaseerde conceptvertaling van deze sessie:
`docs/lyra-knowledge/roosterkaders-regio-west-2026-DRAFT-TRANSCRIPTIE.md`
— nadrukkelijk `HUMAN_REVIEW_REQUIRED`, niet machinaal geverifieerd
(`current-state.md:74, 80`).

**Waarom dit ertoe doet.** Vier regels in het regelbestand
(`REGIO_WEST_WEEKEND_TARGET`, `DORDRECHT_ROSTER_LINE_DIVISOR`,
`REGIO_WEST_WTV_INTERVAL_WEEKS`, `NEW_DRIVER_PROTECTION_YEARS`) staan al in
de code met `sourceApplies` op `false`/`nee`, en blijven daarmee
blokkerend of ongebruikt totdat een geverifieerde tekst beschikbaar is
(`inventory-rules-and-sources.md:296-300`).

**SOURCE_INPUT_REQUIRED.** Vereist een menselijke overtypactie/verificatie
van het ondertekende document — de conceptvertaling van deze sessie is een
startpunt, geen vervanging (`current-state.md:80`).

---

## 4. De 14 IMPLEMENTATION_GAP-regels: in het regelbestand, nergens toegepast

**Wat mist.** Veertien regels staan wel in het regelbestand (`ruleset/`)
maar worden nergens in de toepassende code (`validation/checks/*.ts`)
daadwerkelijk gebruikt. `IMPLEMENTED` is dus 57/71, niet 71/71 — een
eerdere meting die 71/71 rapporteerde, telde per ongeluk het regelbestand
zelf mee als "implementatie" (`inventory-rules-and-sources.md:254`,
citerend `fase-p-rapport.md` §F).

**Drie met naam genoemde voorbeelden** (uit de opdracht en bevestigd in de
inventaris, `inventory-rules-and-sources.md:254`):
- `HOLIDAY_ATTACHED_MIN`
- `RT_PREFERRED_WINDOW_WEEKS`
- `WTV_DAY_LATEST_START`

Het volledige aantal is **14**; de overige elf zijn in de inventaris niet
één voor één met naam opgesomd (alleen het totaal en de drie voorbeelden
worden gegeven) — welke overige elf dit precies zijn is hier dus **niet
vastgesteld** op basis van de gelezen bronnen.

**Waarom dit ertoe doet.** Een regel die in het regelbestand staat maar
nergens wordt toegepast, wekt de indruk dat hij actief gecontroleerd wordt
(hij staat immers in `TRANSCRIBED: 71/71`), terwijl in werkelijkheid geen
enkele plaatsing er ooit tegen wordt getoetst.

**Interne hiaat** (geen SOURCE_INPUT_REQUIRED) — dit is een kwestie van
deze veertien regels daadwerkelijk aan te sluiten op de bestaande
`validation/checks/*.ts`-controles, geen ontbrekend extern brondocument.

---

## 5. `memoryProposal` ontbreekt volledig in de echte lokale-modelroute (`model/local.ts`)

**Wat mist.** Het veld `memoryProposal` op `AgentPlan` — waarmee de agent
een uitgesproken voorkeur ("we willen liever...", "onthoud dat...") kan
aanbieden om in het leergeheugen vast te leggen — is alleen geïmplementeerd
in de stub (`model/stub.ts:381-397, 561-568`). In `model/local.ts` komt
`memoryProposal` in geen enkele vorm voor (geverifieerd met `grep -n
"memoryProposal" local.ts` → geen treffers). De systeeminstructie die het
echte model instrueert (`local.ts:252-274`) vraagt er niet naar, en zelfs
als het model uit zichzelf zo'n veld in zijn JSON zou zetten, wordt het
door de object-literal in `local.ts:496-508` stilzwijgend weggelaten.

**Bewijs.** `inventory-memory-grounding-tools.md:393-425` (§6), expliciet
vergeleken met de eerdere, structureel gelijksoortige RET-bug (77f37f8):
*"een mogelijkheid die in de stub is gebouwd en getest, maar waarvan de
systeeminstructie/nabewerking van de echte-modelroute nooit is bijgewerkt
om hem te ondersteunen."*

**Waarom dit ertoe doet.** Feedback vastleggen als geheugenvoorstel is
user-facing functionaliteit die vandaag alleen werkt zolang de stub
actief is. Zodra de echte Ollama/qwen-route wordt gebruikt (zoals bedoeld
voor productie), verdwijnt deze mogelijkheid zonder dat er een test is die
dit zou opvangen (`tests/agent/leergeheugen.test.ts` roept uitsluitend
`stubModel` aan).

**Interne hiaat** (geen SOURCE_INPUT_REQUIRED) — dit is een gat in de
lokale-modelroute van dit project zelf, geen ontbrekend extern gegeven.

---

## 6. `jsonUit()`-regressietest: GESLOTEN (niet meer open)

**Oorspronkelijke bevinding uit de inventaris.**
`inventory-memory-grounding-tools.md:334-372` (§5) constateerde dat
`jsonUit()` (`src/server/agent/model/local.ts:294-355`, de
depth-tellende scanner die twee aaneengesloten JSON-objecten van het
lokale model samenvoegt) **nul regressietests** had — *"de duidelijkste
'snel te dichten' regressie-hiaat uit deze inventarisatie."*

**Verificatie door deze sessie (2026-09-28).** Het bestand
`tests/agent/json-uit-lokaal-model.test.ts` bestaat inmiddels wél, en
test `jsonUit()` rechtstreeks: een gewoon object, een ```json-codeblok, en
— het historische scenario — twee losse geldige JSON-objecten achter
elkaar die worden samengevoegd zonder een al gevuld veld te overschrijven.
Het bestand citeert de inventarisbevinding letterlijk in zijn eigen
docstring: *"Regressietoets voor `jsonUit()` (§ LYRA MASTER PROGRAM, fase
0-inventarisatie: 'JSON-parser voor dubbele modelobjecten — fix aanwezig,
geen enkele regressietest')."* Commit: `588c1e5` (dezelfde commit als de
Fase 0-inventarisatie zelf, blijkend uit `git log --
tests/agent/json-uit-lokaal-model.test.ts`).

**Status: GESLOTEN.** Dit hiaat wordt hier niet als nog-open gerapporteerd
— het is na de oorspronkelijke inventarisatie al gedicht, met
bestandsverwijzing `tests/agent/json-uit-lokaal-model.test.ts` en commit
`588c1e5`.

---

## 7. Geen automatische runtime-detector voor onbevestigde autoriteitstaal in `grounding.ts`

**Wat mist.** `src/server/agent/grounding.ts` matcht alleen op drie
identificatiepatronen (regel-ID, dienstnummer, roostercode) om fabricatie
te detecteren. Er is **geen** controle die woorden als "bevestigd",
"formeel", "CAO", "verplicht" of "officieel" in de modeltekst signaleert
wanneer die niet gedekt zijn door onderliggende metadata (een tool die
`legalStatus: VALIDATED` teruggaf).

**Bewijs.** `inventory-memory-grounding-tools.md:134-155` (§2): *"Sterker
nog, de bestaande regressietoets bevat een testzin die het woord
'bevestigd' letterlijk gebruikt (`scripts/verify-agent.ts:640`) en de
toets controleert alleen of het regel-ID wordt tegengehouden als
'niet-opgezocht' — niet of het woord 'bevestigd' zelf een constatering
vergt."* Er bestaat wel een gegradeerd `legalStatus`/`STATUS_TEKST`-signaal
in de tools zelf (`tools.ts:262-268, 361-368`; `knowledge.ts:259-267`),
maar niets dat verifieert dat de **modeltekst** die status ook overneemt.

**Waarom dit ertoe doet.** Een taalmodel dat "dit is CAO-verplicht"
schrijft zonder een tool met `legalStatus: VALIDATED` te hebben
aangeroepen, wordt door de huidige grendel niet tegengehouden — tenzij het
toevallig ook een regel-ID/dienstnummer/roostercode noemt dat niet in de
gegevens voorkomt. Dit is precies het type controle dat de LYRA
MASTER PROGRAM-opdracht als nieuwe claim-verificatielaag vraagt
(bevestigd in `current-state.md:60-62`: *"dit is precies wat opdracht §29
(claim-verificatie) als nieuwe grendel vraagt, en het is bevestigd dat dit
nu structureel ontbreekt, niet alleen ongetest is"*).

**Interne hiaat** (geen SOURCE_INPUT_REQUIRED) — dit vereist een nieuwe
tekstcontrole in `grounding.ts` zelf, geen extern gegeven.

---

## 8. Geen centrale OBSERVED/PREFERRED/REQUIRED-taxonomie en geen Dordrecht-lokaal-vs-NS-breed scope-veld

**Wat mist (twee samenhangende hiaten).**

**(a) OBSERVED/PREFERRED/REQUIRED.** Er bestaat geen letterlijk,
uniform drieledig kennisniveau-model. Wat wél bestaat, functioneel
overlappend maar niet samengevoegd: losse bronstatus-strings
(`MACHINIST_PREFERENCE`, `HUMAN_DOMAIN_INPUT`,
`USER_PROVIDED_OPERATIONAL_DESIGN_REQUIREMENT`, `SOURCE_TRANSCRIBED`), de
`"CONFIRMED"`/`"POTENTIAL"`-enum in `validation/result.ts:79`, en een
documentopmaakconventie (Waarneming → Principe → Gevolg) in
`docs/human-roster-benchmark/human-roster-design-principles.md` — inhoudelijk
dicht bij OBSERVED→PREFERRED, maar zonder REQUIRED-laag en zonder dat het
een data-model in code is. Bewijs:
`inventory-quality-and-preferences.md:471-499` (§14).

**(b) Dordrecht-lokaal vs. NS-breed.** Brede grep op "Dordrecht-lokaal",
"NS-breed/NS-wide" en vergelijkbare termen in `src/domain/` levert niets
op. Alle Dordrecht-geleerde kalibraties (nachtritme, klokdrempel,
begintijdsprong, dagdienstgewichten) worden toegepast zonder een
mechanisme om ze per standplaats te differentiëren — er is wel een manier
om een kalibratie te *vervangen* (`RHYTHM_CALIBRATION`), maar niet om
meerdere scopes *tegelijk* te laten bestaan. Bewijs:
`inventory-quality-and-preferences.md:503-519` (§15).

**Waarom dit ertoe doet.** Zonder (a) is er geen herbruikbare, centrale
manier om aan te geven of een gegeven stuk kennis een waargenomen feit, een
zachte voorkeur, of een harde eis is — dat onderscheid bestaat nu impliciet
en verspreid. Zonder (b) kan het platform geen tweede standplaats of
steekproef naast Dordrecht laten bestaan zonder de bestaande kalibraties te
overschrijven.

**Interne hiaat** (geen SOURCE_INPUT_REQUIRED) voor beide — dit is een
ontwerpvraagstuk over het eigen datamodel, geen ontbrekend extern
document.

---

## 9. Golden suite: was 43 items bij Fase 0, 100+ doel niet gehaald

**Wat mist.** `docs/v1.0.6/golden-suite.json` telt (op het moment van de
Fase 0-inventarisatie) 43 items (35 dev / 8 holdout), verdeeld over 10
categorieën (A–J). Het bestand erkent zelf: *"Minder dan de 100 items die
§3 als minimum noemt (...) groei() (...) beschrijft hoe hij (...) wordt
aangevuld (...) — nog niet uitgevoerd."*

**Bewijs.** `inventory-benchmark-infrastructure.md:40-77`. Herbevestigd in
`docs/v1.0.6/n0-n1-vergelijking.md` §"Wat nog niet klopt".

**Was 43 als van Fase 0 — zie `docs/v1.0.6/` voor de bevroren suite en
elk nieuwer uitbreidingsbestand voor groei sindsdien.** Deze sessie heeft
niet geverifieerd of er, ná de Fase 0-inventarisatie (mogelijk in parallel
lopend werk), al een uitbreiding is doorgevoerd — dat blijft **niet
vastgesteld** en moet bij een volgende meting opnieuw tegen
`docs/v1.0.6/golden-suite.json` (of een eventuele opvolger) worden
gecontroleerd.

**Waarom dit ertoe doet.** De golden suite is de belangrijkste
regressiebasis voor elke BEFORE/AFTER-meting van het gespreksgedrag van de
Lyra-agent. Een suite van 43 items dekt aantoonbaar minder scenario's dan
het gevraagde minimum van 100.

**Interne hiaat** (geen SOURCE_INPUT_REQUIRED) — het generatorpatroon
(`scripts/v106/golden-suite.ts`, met een beschreven maar nooit uitgevoerde
`groei()`-functie) bestaat al en kan worden hergebruikt.

---

## 10. Geen bevroren, doelbewust-adversarial holdout-laag voor de agent-Q&A-benchmark

**Wat mist.** Er bestaat een gewone dev/holdout-verdeling voor de golden
suite (steekproefsgewijs, niet adversarial ontworpen). Er bestaat **geen**
derde, specifiek adversarial-ontworpen holdoutlaag voor de Lyra-agent zelf
— d.w.z. een set die doelbewust is opgezet om het systeem te laten falen,
apart van een gewone representatieve steekproef.

**Wat er wél bestaat, in een andere context.**
`docs/human-roster-benchmark/contrastive-check.json` — vier adversarial
toetsen (`versnipperde-nachten`, `vroeg-na-nachten`, `heen-en-weer`,
`springende-begintijden`) die een goed menselijk rooster doelbewust
muteren naar een slechter rooster en controleren of het **kwaliteitsmodel**
dat ziet. Dit test het kwaliteitsmodel van roosters, niet de Lyra-agent, en
is geen dev/holdout-structuur.

**Bewijs.** `inventory-benchmark-infrastructure.md:81-109` ("DEV/HOLDOUT-
scheiding — bestaat dit al"), met expliciete conclusie: *"Niet vastgesteld
dat die [adversarial holdout] ooit is gebouwd."*

**Waarom dit ertoe doet.** Een gewone steekproef test representatief
gedrag; een adversarial holdout test doelbewust de zwakste plekken. Zonder
die laag is niet bekend hoe robuust de agent is tegen scenario's die
specifiek zijn ontworpen om hem te laten falen.

**Interne hiaat** (geen SOURCE_INPUT_REQUIRED) — het bestaande
contrastive-check-patroon (voor het kwaliteitsmodel) kan als
architectuurvoorbeeld dienen voor een vergelijkbare laag bij de agent-Q&A-
suite.

---

## 11. ATW/ATB-vervoer: volledig NOT_SUPPLIED

**Wat mist.** De Arbeidstijdenwet (ATW) en het Arbeidstijdenbesluit vervoer
(ATB-vervoer) zijn beide volledig niet aangeleverd als brondocument. Zie
ook §1, pakketten 1 en 2 hierboven (`ATW_VALIDATED_RULESET`,
`ATB_VALIDATED_RULESET`).

**Bewijs.** `inventory-rules-and-sources.md:374-375` (§7, punt 6):
*"ATW/Arbeidstijdenbesluit vervoer: volledig `NOT_SUPPLIED`. Elk canoniek
schema dat op deze twee wettelijke pakketten moet kunnen wijzen, heeft ze
nog niet om naar te wijzen."* Herbevestigd in `current-state.md:78-81`
(SOURCE_INPUT_REQUIRED-lijst, punt 3).

**Waarom dit ertoe doet.** Dit zijn wettelijke (niet CAO-) regelpakketten
die de CAO zelf als aanvullend verplicht noemt
(`regio-west-2026.ts`-reason-tekst, zie §1 hierboven). Zonder deze twee
pakketten kan geen enkele plaatsing formeel getoetst worden aan de volledige
wettelijke kader, alleen aan het CAO-deel.

**SOURCE_INPUT_REQUIRED.** Dit zijn wettelijke brondocumenten die dit
project niet zelf kan reconstrueren of aannemen.

---

## 12. Kwalificatiematrix niet aangesloten

**Wat mist.** De koppeling tussen baanvak, materieelsoort, bevoegdheid en
lokale kennis (wat een dienst vereist) enerzijds, en wat een medewerker
daadwerkelijk heeft anderzijds — moet uit een extern bronsysteem komen dat
vandaag niet is aangesloten. Zie ook §1, pakket 4
(`QUALIFICATION_MATRIX`).

**Bewijs.** `inventory-rules-and-sources.md:20` (§1, `rule-coverage.md`-
samenvatting noemt dit als één van de negen ontbrekende regelpakketten) en
`current-state.md:78-83` (SOURCE_INPUT_REQUIRED-lijst, punt 4:
*"Kwalificatiematrix (baanvak/materieel/bevoegdheid-koppeling) — niet
aangesloten bronsysteem."*).

**Waarom dit ertoe doet.** Zonder deze koppeling kan de engine niet
verifiëren of een medewerker daadwerkelijk bevoegd is voor een dienst
waarop hij/zij geplaatst wordt — dit blokkeert zowel `PUBLICATION` als
`PRODUCTION_MODE` (zie pakket 4 in §1).

**SOURCE_INPUT_REQUIRED.** Vereist aansluiting op een extern HR-/
bevoegdhedensysteem, niet iets dat dit project zelf kan construeren.

---

## Aanvullende, kleinere interne hiaten (gevonden bij het doorzoeken van de vier inventarisdocumenten)

Deze staan niet in de kernvereisten hierboven maar zijn expliciet als
hiaat (afwezigheid, geen conflict) benoemd in de inventarisdocumenten en
worden hier voor volledigheid meegenomen:

- **Geen contradictiedetectie tussen twee onafhankelijk voorgestelde
  geheugenitems binnen dezelfde scope** (`AgentMemoryItem`). `proposeMemory()`
  voegt een nieuw item toe zonder te controleren of een tegenstrijdig item al
  bestaat. Bewijs: `inventory-memory-grounding-tools.md:49-58` (§1). Interne
  hiaat.
- **Geen polariteit-/sentimentveld op `AgentMemoryItem`** — positief/negatief
  zit alleen impliciet in de vrije tekst van `statement`. Bewijs:
  `inventory-memory-grounding-tools.md:35` (§1, tabel). Interne hiaat.
- **Geen runtime-grendel voor het instemmen met een feitelijk onjuiste
  aanname van de gebruiker** — er bestaat wel een benchmarkmetriek
  (`falsePremiseCorrection` in de Demo Room-laag), maar die steunt op
  handmatige/externe grading, niet op een automatische tekstdetector. Bewijs:
  `inventory-memory-grounding-tools.md:164-179` (§2). Interne hiaat.
- **Geen regressietest voor `domeinwoordenboek()` op de lokale-modelroute**
  (`local.ts`) — het RET/rangeer-woordenboek is structureel gedeeld tussen
  stub en echt model, maar alleen de stub-route is met een test gedekt.
  Bewijs: `inventory-memory-grounding-tools.md:309-330` (§4). Interne hiaat.
- **Geen geautomatiseerd replicate-mechanisme (`--replicates N`) voor de
  agent-Q&A-benchmark** — de optimizer-lijn heeft dit al (20 runs/fase,
  mean/median/worst), de agent-lijn (golden-bench.ts/r2-bench.ts) draait
  vandaag altijd precies één run per meting, ondanks aangetoond
  non-determinisme bij temperatuur 0 (7/43 items anders tussen twee
  identieke runs). Bewijs: `inventory-benchmark-infrastructure.md:113-143,
  297-305`. Interne hiaat.
- **Geen vitest-regressietest voor de `DAY_DUTY_WEIGHTS.VROEG`-aanname** —
  het getal (10, gemarkeerd `AANNAME`) heeft alleen een los
  gevoeligheidsanalyse-script (`assumption-sensitivity.json`), geen
  geautomatiseerde test die een toekomstige, ongemerkte wijziging zou
  opvangen. Bewijs: `inventory-quality-and-preferences.md:175-179` (§4).
  Interne hiaat.
- **Geen CI-koppeling voor `scripts/verify-geheugen.ts` en
  `scripts/verify-agent.ts`** — beide zijn losse, DB-afhankelijke scripts
  die niet meedraaien in `npm test` (puur `vitest run`), en er is geen
  `.github/`-CI-workflow gevonden in deze checkout die ze aanroept. Bewijs:
  `inventory-memory-grounding-tools.md:93-99` (§1). Interne hiaat.

---

## Overzichtstabel

| # | Hiaat | Bron | SOURCE_INPUT_REQUIRED / interne hiaat |
| --- | --- | --- | --- |
| 1 | 9-10 MISSING_PACKAGES in regio-west-2026.ts | inventory-rules-and-sources.md §1/§4 + broncode | Overwegend SOURCE_INPUT_REQUIRED |
| 2 | CAO 2024-2025 verlopen voor okt-dec 2026 | inventory-rules-and-sources.md §5; current-state.md | SOURCE_INPUT_REQUIRED |
| 3 | Roosterkaders Regio West 2026 zonder tekstlaag, alleen concept-transcriptie | inventory-rules-and-sources.md §5; current-state.md | SOURCE_INPUT_REQUIRED |
| 4 | 14 IMPLEMENTATION_GAP-regels nergens toegepast | inventory-rules-and-sources.md §4 (§7 in bron: fase-p-rapport.md §F) | Interne hiaat |
| 5 | memoryProposal ontbreekt in model/local.ts | inventory-memory-grounding-tools.md §6 | Interne hiaat |
| 6 | jsonUit() zonder regressietest | inventory-memory-grounding-tools.md §5 | **GESLOTEN** — tests/agent/json-uit-lokaal-model.test.ts, commit 588c1e5 |
| 7 | Geen detector voor onbevestigde autoriteitstaal in grounding.ts | inventory-memory-grounding-tools.md §2 | Interne hiaat |
| 8 | Geen OBSERVED/PREFERRED/REQUIRED-taxonomie, geen Dordrecht/NS-breed scope-veld | inventory-quality-and-preferences.md §14-15 | Interne hiaat |
| 9 | Golden suite 43 items, 100+ niet gehaald | inventory-benchmark-infrastructure.md | Interne hiaat |
| 10 | Geen adversarial-holdoutlaag voor agent-Q&A | inventory-benchmark-infrastructure.md | Interne hiaat |
| 11 | ATW/ATB-vervoer volledig NOT_SUPPLIED | inventory-rules-and-sources.md §7; current-state.md | SOURCE_INPUT_REQUIRED |
| 12 | Kwalificatiematrix niet aangesloten | inventory-rules-and-sources.md §1; current-state.md | SOURCE_INPUT_REQUIRED |

**Totaal aantal hiaten in dit rapport: 12 kernitems + 7 aanvullende kleinere
interne hiaten = 19, waarvan er 1 (jsonUit()) inmiddels GESLOTEN is en dus
niet meer als open hiaat telt (18 open).**

Geen van bovenstaande hiaten is in deze ronde gedicht (behalve het reeds
apart vermelde, elders al gesloten `jsonUit()`-item) — conform §33/§34 van
de opdracht wordt vóór de BEFORE-benchmark geen inhoudelijke wijziging
doorgevoerd.
