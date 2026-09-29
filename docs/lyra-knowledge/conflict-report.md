# Conflictrapport — Fase 0, LYRA MASTER PROGRAM

Opgemaakt 2026-09-27/28. Dit document verzamelt **alleen conflicten en
inconsistenties**: plekken waar twee of meer bronnen (code, documenten, of
code-tegen-document) elkaar tegenspreken of niet met elkaar overeenkomen. Een
conflict is dus altijd een tegenspraak tussen twee dingen — niet een
afwezigheid. Afwezigheden (dingen die missen) staan in
`docs/lyra-knowledge/knowledge-gap-report.md`.

**Wat dit document niet doet.** Conform §33/§34 van de LYRA MASTER PROGRAM-
opdracht (de BEFORE-benchmark moet bevroren zijn vóórdat er een inhoudelijke
wijziging plaatsvindt) stelt dit document **geen enkele oplossing, fix of
voorkeursrichting voor**. Elk item hieronder eindigt met alleen een
beschrijving van wat het concreet betekent — niet met een aanbeveling.

Alle citaten komen uit de vier Fase 0-inventarisdocumenten
(`inventory-rules-and-sources.md`, `inventory-quality-and-preferences.md`,
`inventory-memory-grounding-tools.md`, `inventory-benchmark-infrastructure.md`)
of, waar aangegeven, rechtstreeks geverifieerd tegen de broncode. Niets is
verzonnen; waar iets onduidelijk bleef staat "niet vastgesteld".

---

## 1. Drie parallelle, elkaar niet kennende status-/taxonomiemodellen

**Beschrijving.** Drie afzonderlijke delen van het systeem houden elk hun
eigen antwoord bij op de vraag "is dit nog geldig / bevestigd / vervangen?",
zonder dat één van de drie naar de andere verwijst:

1. `RuleStatus` op `RuleDefinition` (`src/server/rules-engine/ruleset/types.ts`):
   `VALIDATED` / `SOURCE_TRANSCRIBED` / `UNVALIDATED_LOCAL_PARAMETER` /
   `NEEDS_POLICY_VALIDATION` / `POLICY_PENDING` / `UNRESOLVED` / `NOT_SUPPLIED`.
2. Een ad-hoc bronstatus-string op `src/domain/operational-requirements.ts`:
   `USER_PROVIDED_OPERATIONAL_DESIGN_REQUIREMENT` — geen `RuleStatus`-waarde,
   een aparte, losse constante.
3. `MemoryStatus` op `prisma.AgentMemoryItem`:
   `PROPOSED` / `APPROVED` / `REJECTED` / `WITHDRAWN` / `SUPERSEDED`, met een
   eigen `supersedes`-relatie.

**Bewijs (file:line).**
`inventory-rules-and-sources.md:170-185` (§2, "Drie parallelle,
niet-uniforme 'rule-achtige' systemen gevonden") en herbevestigd in
`inventory-rules-and-sources.md:221-223` (§3, tabel `verificationStatus`/
`approvalStatus`). Onderliggende broncode: `src/server/rules-engine/ruleset/types.ts`
(`RuleStatus`), `src/domain/operational-requirements.ts` (regel 41 volgens
inventaris: `USER_PROVIDED_OPERATIONAL_DESIGN_REQUIREMENT`),
`prisma/schema.prisma:1892-1990` (`MemoryStatus`, bevestigd in
`inventory-memory-grounding-tools.md:19-20, 43`).

**Ernst.** **Hoog** — eigen inschatting van dit rapport; de bron kent hier
geen expliciet Hoog/Middel/Laag-label toe, maar noemt het zelf "precies het
soort drift dat Fase 0 van LYRA MASTER PROGRAM moet blootleggen vóór er een
canoniek schema wordt ontworpen" (`inventory-rules-and-sources.md:182-185`).
Dit raakt de kern van elk canoniek schema-ontwerp (Fase 3 van `progress.md`
wacht hierop).

**Wat betekent dit concreet.** Een wijziging aan de "geldigheidsstatus" van
één kennistype (bijvoorbeeld het intrekken van een regel) heeft geen enkel
automatisch effect op de andere twee typen, ook niet als ze inhoudelijk over
hetzelfde onderwerp gaan. Er bestaat vandaag geen enkele plek in de code die
alle drie tegelijk kan tonen of vergelijken; iemand die "is dit nog geldig"
wil weten voor een gegeven stuk kennis, moet weten in welk van de drie
systemen dat stuk zit voordat de vraag zelfs maar gesteld kan worden.

---

## 2. MIX = "Vroeg-Laat-Nacht"-alias: bevestigd in code, onbevestigd volgens eigen bronmanifest

**Beschrijving.** De code presenteert de displaynaam "Mix
(Vroeg-Laat-Nacht)" en de bronvermelding `"HUMAN_DOMAIN_INPUT
(Vroeg/Laat/Nacht)"` als vaststaand, terwijl het project se eigen
brondocument-manifest deze alias expliciet "NIET bevestigd" noemt.

**Bewijs (file:line).**
- Code: `src/domain/roster-profiles.ts:57` (`PROFILE_LABELS.MIX =
  "Mix (Vroeg-Laat-Nacht)"`) en `src/domain/profile-affinity.ts:54`
  (`MIX: { weight: 20, source: "HUMAN_DOMAIN_INPUT (Vroeg/Laat/Nacht)" }`),
  zoals geciteerd in `inventory-quality-and-preferences.md:59-62`.
- Tegenspraak: `docs/lyra-knowledge/sources/manifest.json:94` — *"de
  master-prompt-tekst noemt 'mogelijk historische displaynaam
  Vroeg-Laat-Nacht' voor dit profiel; op basis van dit brondocument alléén is
  die alias NIET bevestigd"*, geciteerd in
  `inventory-quality-and-preferences.md:63-66`.
- Ook genoemd als open vraag in `docs/lyra-knowledge/progress.md:39`
  (geciteerd in `inventory-quality-and-preferences.md:66-67`).

**Ernst.** **Hoog** — expliciet zo gegradeerd in de bron, samenvattingstabel
`inventory-quality-and-preferences.md:527` ("Hoog — stille inconsistentie
tussen code en eigen sourcing-discipline").

**Wat betekent dit concreet.** Elke gebruiker of tool die de displaynaam of
de `source`-string van het MIX-profiel leest, ziet een bevestigde alias
("Vroeg/Laat/Nacht") die het project zelf, in zijn eigen bronmanifest, nog
als onbevestigd bestempelt. De twee delen van hetzelfde project (code-laag en
bronmanifest-laag) spreken elkaar dus letterlijk tegen over dezelfde claim.

---

## 3. 60-minuten klok-vs-label-overgangsdrempel: aanwezig in v1/v2, afwezig in v3

**Beschrijving.** De correctie "een overgang telt alleen als een echte
klokverschuiving, niet als alleen een ander dagdeel-label wisselt" (drempel:
60 minuten) is aanwezig in de oudere `flow`-berekening, maar ontbreekt in de
nieuwere `categoryOf()`-functie die de v3-voorkeurslaag voedt.

**Bewijs (file:line).**
- Wél aanwezig: `src/domain/quality-model.ts:181-199`
  (`flow.parts.oscillation`/`flow.parts.penalty`, met
  `minClockSwingMinutes: 60` / `minClockShiftMinutes: 60`, commentaar "H09:
  was 180") en `src/domain/rhythm-metrics.ts:50`
  (`oscillationMinClockSwingMinutes`), geciteerd in
  `inventory-quality-and-preferences.md:330-341`.
- Afwezig: `src/domain/roster-quality.ts:176-186` (`categoryOf()`) —
  categoriseert een overgang **uitsluitend op `duty.kinds`** (het label
  VROEG/LAAT/NACHT), niet op klokoverlap, gebruikt door
  `machinist-preference.ts` en het v3-voorkeuronderdeel, geciteerd in
  `inventory-quality-and-preferences.md:343-353`.

**Ernst.** **Middel/Hoog** — expliciet zo gegradeerd in de bron,
samenvattingstabel `inventory-quality-and-preferences.md:531` ("inconsistentie
tussen twee actieve onderdelen van hetzelfde v3-rapport, specifiek relevant
voor BLM/50+ Mix").

**Wat betekent dit concreet.** Voor profielen waar dagdeel-labels kunnen
overlappen (BLM, 50+ Mix) telt de v3-voorkeursscore (via `roster-quality.ts`)
een overgang van bijvoorbeeld 19 minuten verschil nog steeds als een
volwaardige labelwissel, terwijl het oudere `flow`-onderdeel (v1/v2) diezelfde
overgang terecht als "geen wissel" zou zien. Twee actieve, gelijktijdig
gebruikte onderdelen van hetzelfde kwaliteitsmodel-v3-rapport beoordelen
dezelfde situatie dus verschillend.

---

## 4. 46-uurs nacht-hersteldrempel: drie plekken, drie bronstatussen, geen koppeling

**Beschrijving.** Het getal 46 uur (herstel na een reeks van drie of meer
nachtdiensten) komt voor op drie onafhankelijke plekken, elk met een eigen,
ándere bronstatus, zonder enige centrale koppeling tussen de drie:

1. **CAO-regel (hard, regelmotor).**
   `src/server/rules-engine/ruleset/cao-ns-2024-2025.ts:546-556`
   (`RULE.NIGHT_SEQUENCE_RECOVERY`, `value: 46`, `unit: "HOURS"`, status
   `SOURCE_TRANSCRIBED`, `validatedBy: null`), met bronverwijzing
   `cao("101", "Nachtarbeid")`.
2. **Menselijke-roosterwaarneming (zacht, designdocument).**
   `docs/human-roster-benchmark/human-roster-design-principles.md:26` —
   *"Herstelrust na 3+ nachten (46 uur, bronstatus **POTENTIAL**)"*, met
   §5 (regels 115-126) die vaststelt dat het kortste werkelijk waargenomen
   herstel in de zeven officiële roosters 56 uur is (dus ruim boven 46).
3. **Kwaliteitsmodel-drempel (zacht, score).**
   `src/domain/quality-model.ts:248-266` (`nights.parts.exit`,
   `belowRule`/`atLeastRule`/`afterEarlyAcceptable`, bronstatus
   `MACHINIST_PREFERENCE`).

**Bewijs (file:line).** Volledig uitgewerkt in
`inventory-quality-and-preferences.md:219-289` (§6). Aanvullend: het enige
op dit moment aangeleverde CAO-achtige brondocument voor deze periode is
"Roosterkaders Regio West 2026", expliciet gemarkeerd als *"GEEN
CAO-document"* (`inventory-quality-and-preferences.md:240-244`,
onderbouwd door `docs/lyra-knowledge/progress.md:38` en
`docs/lyra-knowledge/sources/manifest.json:141`) — de daadwerkelijke
CAO Spoor-tekst voor rij-/rusttijden die artikel 101 zou moeten onderbouwen,
ontbreekt dus als aangeleverd document.

**Ernst.** **Hoog** — expliciet zo gegradeerd in de bron,
samenvattingstabel `inventory-quality-and-preferences.md:530`.

**Wat betekent dit concreet.** Alle drie de plekken gebruiken vandaag
hetzelfde getal (46), maar dat is op dit moment toeval van consistente
overname, geen geborgde koppeling: er bestaat geen mechanisme dat, als de
werkelijke CAO-tekst ooit binnenkomt en een ander getal blijkt te bevatten,
alle drie de plekken tegelijk zou signaleren of bijwerken. Bovendien draagt
geen van de drie plekken vandaag een status die betekent "extern
geverifieerd": de regelmotor-versie is `SOURCE_TRANSCRIBED`/niet-gevalideerd,
de mensen-benchmark-versie is expliciet `POTENTIAL`, en de
kwaliteitsmodel-versie is `MACHINIST_PREFERENCE` (praktijkervaring, geen
CAO-citatie).

---

## 5. CP-SAT-solver weegt een losse nacht ~27× lichter dan het kwaliteitsmodel

**Beschrijving.** De kostenfunctie van de CP-SAT-optimizer en het
kwaliteitsmodel wegen dezelfde gebeurtenis (een "losse nacht", d.w.z. een
korte nachtreeks) met een factor ~27 verschil in relatief gewicht.

**Bewijs (file:line).** Genoemd in `inventory-rules-and-sources.md:196-199`
(§2) en herhaald in `inventory-rules-and-sources.md:324-328` (§6) en
`inventory-rules-and-sources.md:382-385` (§7, punt 8) — telkens onder
verwijzing naar de oorspronkelijke bronvondst: `docs/v1.0.5/
architecture-current-state.md` §8.5, letterlijk geciteerd: *"een losse nacht
weegt in CP-SAT ongeveer 27× lichter dan in het [kwaliteits]model"* —
expliciet daar aangeduid als *"de belangrijkste openstaande technische
vraag"*. Herbevestigd in `current-state.md:56-58` als "nog steeds
onopgelost".

**Ernst.** **Hoog** — gebaseerd op de eigen kwalificatie van de bron ("de
belangrijkste openstaande technische vraag"), geen los toegekend
Hoog/Middel/Laag-label maar functioneel gelijk daaraan.

**Wat betekent dit concreet.** De optimizer (die daadwerkelijk roosters
genereert) en het kwaliteitsmodel (dat roosters beoordeelt, o.a. gebruikt
door de agent en de rapportages) hanteren op dit specifieke punt een
wezenlijk andere onderlinge waardering van dezelfde gebeurtenis. Een rooster
dat de optimizer als "vrijwel net zo goed" beschouwt op dit punt, kan het
kwaliteitsmodel als aanzienlijk slechter beoordelen (of omgekeerd) — zonder
dat er vandaag een test of controle bestaat die dit verschil bij een
volgende wijziging zou signaleren (`inventory-rules-and-sources.md:329-335`:
er is "geen 'cross-drift'-script gevonden dat bijvoorbeeld nagaat of een in
de UI getoonde grenswaarde overeenkomt met de waarde in `ruleset/`").

---

## 6. TESTED-regeltelling: 26/71 versus 25/71 tussen twee documenten

**Beschrijving.** Twee machinaal gegenereerde documenten, één dag na elkaar
gemeten, geven een verschillend aantal "getest" (TESTED) regels van de
71 in het regelbestand.

**Bewijs (file:line).**
- `docs/rule-coverage.md` (gemeten 2026-09-06): `TESTED 26/71`, geciteerd in
  `inventory-rules-and-sources.md:17-18` (§1) en `inventory-rules-and-sources.md:255`
  (§4, tabelrij `TESTED`).
- `docs/source-inventory-phase-o.md` §5: `TESTED 25/71`, zelfde tabelrij
  `inventory-rules-and-sources.md:255`.
- Expliciet benoemd als open vraag in `inventory-rules-and-sources.md:386-389`
  (§7, punt 9): *"niet vastgesteld of dit een meetfout, een tussentijdse
  wijziging, of een afrondingsverschil is."*

**Ernst.** **Laag** — eigen inschatting van dit rapport (de bron kent geen
expliciet risiconiveau toe, en het gaat om een telverschil van 1 op een totaal
van 71, niet om een structureel of architecturaal probleem), maar wél
vermeldenswaardig omdat het aantoont dat zelfs machinaal gegenereerde
metingen op dit moment niet onderling zijn afgestemd.

**Wat betekent dit concreet.** Beide documenten claimen een exact,
machinaal-gemeten aantal, maar de aantallen komen niet overeen en geen van
beide bronnen bevat een verklaring voor het verschil (meetfout,
tussentijdse codewijziging tussen de twee meetmomenten, of een
afrondingsverschil zijn alle drie nog mogelijk). Wie één van beide
documenten als autoriteit citeert, citeert een getal dat het andere
document tegenspreekt.

---

## 7. Verouderde uitkomstterminologie in `docs/rules-engine-rapport.md`

**Beschrijving.** `docs/rules-engine-rapport.md` §2 gebruikt nog een oudere,
vijfvoudige naamgeving voor de evaluatie-uitkomsten (`VALID`,
`VALID_WITH_WARNINGS`, `REQUIRES_REVIEW`, `RULESET_INCOMPLETE`,
`HARD_VIOLATION`), terwijl de huidige code (`validation/result.ts`) een
zesvoudige, andere naamgeving hanteert (`VALID_WITHIN_VALIDATED_RULESET`,
`VALID_WITH_WARNINGS`, `CONTEXT_INCOMPLETE`, `RULESET_INCOMPLETE`,
`POTENTIAL_HARD_VIOLATION`, `CONFIRMED_HARD_VIOLATION`).

**Bewijs (file:line).** `inventory-rules-and-sources.md:152-160` (§2):
*"Let op: `docs/rules-engine-rapport.md` §2 noemt nog een oudere vijfvoudige
naamgeving (...) — dat rapport is op dit punt door de audit ingehaald en de
code volgt de audit-terminologie."* De code zelf staat in
`src/server/rules-engine/validation/result.ts`.

**Ernst.** **Laag** — de inventaris zelf constateert dat dit al is opgehelderd
(de code volgt aantoonbaar de nieuwere, audit-terminologie); dit item wordt
hier gedocumenteerd omdat `docs/rules-engine-rapport.md` als document zelf
niet is bijgewerkt en dus, gelezen op zichzelf, een andere naamgeving
suggereert dan wat vandaag in productie draait.

**Wat betekent dit concreet.** Iemand die alleen
`docs/rules-engine-rapport.md` leest (zonder de audit en de inventaris
ernaast te leggen) krijgt een terminologie te zien die niet meer overeenkomt
met `validation/result.ts`. Het document zelf bevat geen aantekening die dit
markeert als verouderd.

**Update (2026-09-29): geadresseerd.** `docs/rules-engine-rapport.md` §2
draagt nu, direct boven de betreffende tabel, een expliciete
"Verouderd"-aantekening die naar `validation/result.ts` verwijst als de
geldende bron. De tabel zelf is bewust ongewijzigd gelaten (punt-in-tijd-
record van dit rapport, zie het generaliseerbare principe in
`migration-report.md` §3.1) — alleen een zichtbare, niet-overschrijvende
correctie toegevoegd.

---

## 8. Bronverwijzing `WEEKLY_REST_72H_PER_14D`: artikel 100 genoemd, getal alleen in artikel 99 gevonden

**Beschrijving.** De regel `WEEKLY_REST_72H_PER_14D` verwijst in de code naar
CAO-artikel 100, terwijl volgens de Fase 0/Fase P-verificatie het getal (72
uur) alleen teruggevonden is in artikel 99.

**Bewijs (file:line).**
- Code: `src/server/rules-engine/ruleset/cao-ns-2024-2025.ts:379-387`
  (`RULE.WEEKLY_REST_72H_PER_14D`, `source: cao("100", "Wekelijkse rust")`,
  `value: 72`, `unit: "HOURS"`) — rechtstreeks in de broncode geverifieerd
  door deze sessie.
- Vaststelling van de mismatch: `inventory-rules-and-sources.md:273-277`
  (§4): *"Eén expliciet niet-gecorrigeerde bronverwijzing staat opgetekend:
  `WEEKLY_REST_72H_PER_14D` noemt artikel 100, terwijl het getal alleen in
  artikel 99 gevonden wordt (fase-o-rapport.md §5, herbevestigd in
  fase-p-rapport.md §F als `SOURCE_REFERENCE_REVIEW_REQUIRED`) — bewust niet
  aangepast, om geen gok als correctie te presenteren."*

**Ernst.** **Middel** — eigen inschatting van dit rapport: het betreft een
juridische bronverwijzing (artikelnummer) op een `HARD_CONSTRAINT`-regel, dus
relevant voor formele validatie, maar de waarde zelf (72 uur) wordt niet in
twijfel getrokken — alleen het artikelnummer.

**Wat betekent dit concreet.** De regel citeert een artikelnummer dat, bij
de laatst uitgevoerde verificatie, niet de plek bleek waar het getal 72
daadwerkelijk staat. Dit is bewust ongewijzigd gelaten (status
`SOURCE_REFERENCE_REVIEW_REQUIRED`) in plaats van stilzwijgend "gecorrigeerd"
naar artikel 99, omdat een ongeverifieerde correctie evenzeer een gok zou
zijn als de huidige verwijzing.

---

## 9. Schijnbare tegenspraak: "2 van de 71 gevalideerd" (fase-rapporten) versus "0/71 FORMALLY_VALIDATED" (rule-coverage.md)

**Beschrijving.** De fase-rapporten K, M en N noemen consequent "2 van de 71
regels gevalideerd", terwijl `docs/rule-coverage.md` als machinaal gegenereerd
getal `FORMALLY_VALIDATED: 0/71` toont. Beide cijfers zijn zoals aangeleverd
correct, maar meten niet hetzelfde begrip.

**Bewijs (file:line).** Volledig uitgewerkt in
`inventory-rules-and-sources.md:400-414` (slot van §7): de twee regels die de
fase-rapporten meetellen (`ROSTER_ANCHOR_LOCKED`, `RESERVE_BASE_WITHOUT_DUTIES`)
zijn `PRODUCT_POLICY`-regels onder de gedeelde constante `PRODUCT_VALIDATED`
in `ruleset/regio-west-2026.ts` — "waar per definitie omdat het platform ze
zelf stelt, niet omdat NS een CAO-lezing heeft bevestigd." De kolom
"Formeel gevalideerd" in `rule-coverage.md` meet specifiek NS-bevestiging van
een CAO/regionale bewering en telt deze twee product-eigen regels terecht
niet mee.

**Ernst.** **Laag** — de bron zelf stelt expliciet vast dat dit *"geen fout
in een van beide documenten"* is. Dit item wordt hier alleen gedocumenteerd
omdat het, gelezen zonder de uitleg erbij, een tegenstrijdigheid tussen twee
documenten lijkt, en omdat de bron het zelf aandraagt als *"een concreet
voorbeeld van waarom één woord ('gevalideerd') zonder scope-aanduiding al tot
verwarring leidt tussen documenten"*.

**Wat betekent dit concreet.** Wie de twee cijfers (2/71 en 0/71) naast
elkaar leest zonder de achterliggende scope-uitleg, ziet een tegenspraak die
er inhoudelijk niet is: het woord "gevalideerd" wordt in de twee documenten
met een verschillende reikwijdte gebruikt (platform-eigen productdefinitie
vs. NS-bevestigde CAO/regionale lezing), zonder dat één van beide documenten
dat scoreverschil zelf markeert.

---

## 10. Manifest-belofte versus manifest-inhoud: `n0-manifest.ts` noemt vier velden die `n0-manifest.json` niet bevat

**Beschrijving.** De code-commentaar in `scripts/v106/n0-manifest.ts` noemt
als eis (onder verwijzing naar §1 van de v1.0.6-opdracht) minimaal:
"commit, databaseversie, dienstenpakket-checksum, engineversie,
kwaliteitsmodelversie, regelsetversie". Het daadwerkelijk geschreven
`docs/v1.0.6/n0-manifest.json` bevat vier van deze velden niet:
databaseversie, engineversie, kwaliteitsmodelversie, regelsetversie.

**Bewijs (file:line).** `inventory-benchmark-infrastructure.md:213-234`
("Manifest/freeze-praktijk"): *"Wat hier NIET in staat, maar in het
`n0-manifest.ts`-doc-commentaar wel als eis wordt genoemd (...): van die
lijst ontbreken in het daadwerkelijk geschreven bestand: databaseversie,
engineversie, kwaliteitsmodelversie, regelsetversie. Dit is geen educated
guess maar een direct verschil tussen wat het bestandshoofd belooft te doen
en wat de uiteindelijke JSON-structuur bevat."*

**Ernst.** **Middel** — eigen inschatting van dit rapport: dit raakt direct
de betrouwbaarheid van het BEFORE-manifest dat §33/§34 van de opdracht
vereist vóór een eerlijke voor/na-meting.

**Wat betekent dit concreet.** Het bestand dat bedoeld is als het
volledige "voor"-moment-manifest van de agent-kant, documenteert zelf in zijn
eigen commentaar een eisenlijst die het daadwerkelijk gegenereerde
JSON-bestand niet volledig nakomt. De bouwstenen voor de ontbrekende velden
bestaan wel elders in de codebase (`QUALITY_MODEL_V1/V2/V3` in
`quality-model.ts`, `ruleset.version` in het optimizer-manifest) — zie
`inventory-benchmark-infrastructure.md:260-266` — maar zijn niet
samengevoegd in dit specifieke bestand.

**Update (2026-09-29): opgelost, niet in dit bestand maar in zijn opvolger.**
`scripts/lyra-master/before-manifest.ts` (gebouwd ná dit rapport, in dezelfde
Master Program-ronde) vermeldt exact dit gat expliciet in zijn eigen
doelomschrijving en levert alle vier de eerder ontbrekende velden —
`databaseVersion`, `engineVersion`, `qualityModelVersion`, `rulesetVersion`
— daadwerkelijk. Bevestigd tegen echte productie-uitvoer: het BEFORE-run-
manifest `docs/lyra-knowledge/benchmarks/before/20260927-205217/manifest.json`
bevat alle vier (`"databaseVersion": "20260925041247_technische_experimenten"`,
`"engineVersion": "1.0.3"`, `"qualityModelVersion": "quality-model-v3"`,
`"rulesetVersion": "2026.1-cao-2024-2025-transcribed"`). Het oorspronkelijke
`scripts/v106/n0-manifest.ts`/`docs/v1.0.6/n0-manifest.json`-paar blijft
zelf ongewijzigd staan — dat is een historisch, punt-in-tijd-record van de
v1.0.6-ronde, niet iets om met terugwerkende kracht te herschrijven — maar
het BEFORE-manifest dat §33/§34 daadwerkelijk vereist, gebruikt sindsdien
`before-manifest.ts`, niet `n0-manifest.ts`, en draagt het gat niet meer.

---

## Overzichtstabel

| # | Conflict | Bron (inventaris) | Ernst |
| --- | --- | --- | --- |
| 1 | Drie parallelle statusmodellen (RuleStatus / ad-hoc string / MemoryStatus) | inventory-rules-and-sources.md §2, §3 | Hoog (eigen inschatting) |
| 2 | MIX="Vroeg-Laat-Nacht"-alias: bevestigd in code, onbevestigd in eigen bronmanifest | inventory-quality-and-preferences.md §1 | Hoog (bronbeoordeling) |
| 3 | 60-min klok-vs-label-drempel: in v1/v2, niet in v3 (`roster-quality.ts`) | inventory-quality-and-preferences.md §8 | Middel/Hoog (bronbeoordeling) |
| 4 | 46-uurs nachtherstel: drie plekken, drie bronstatussen, geen koppeling | inventory-quality-and-preferences.md §6 | Hoog (bronbeoordeling) |
| 5 | CP-SAT weegt losse nacht ~27× lichter dan kwaliteitsmodel | inventory-rules-and-sources.md §2/§6/§7, cit. docs/v1.0.5/architecture-current-state.md §8.5 | Hoog (bronkwalificatie) |
| 6 | TESTED-telling 26/71 vs 25/71 | inventory-rules-and-sources.md §7 punt 9 | Laag (eigen inschatting) |
| 7 | Verouderde uitkomstterminologie in rules-engine-rapport.md | inventory-rules-and-sources.md §2 | Laag (al opgehelderd) |
| 8 | Artikelverwijzing 100 vs. 99 bij WEEKLY_REST_72H_PER_14D | inventory-rules-and-sources.md §4 | Middel (eigen inschatting) |
| 9 | Schijnbare tegenspraak "2/71 gevalideerd" vs. "0/71 FORMALLY_VALIDATED" | inventory-rules-and-sources.md §7 (slot) | Laag (bron: geen fout, wel verwarrend) |
| 10 | n0-manifest.ts belooft 4 velden die n0-manifest.json niet bevat | inventory-benchmark-infrastructure.md ("Manifest/freeze-praktijk") | Middel (eigen inschatting) |

**Totaal aantal gedocumenteerde conflicten: 10.**

Geen van bovenstaande items is in deze ronde opgelost, aangepast of van een
aanbevolen oplossing voorzien — dat is met opzet, conform §33/§34 van de
opdracht.
