# Rule-audit — narratief (§99, LYRA MASTER PROGRAM)

Opgemaakt 2026-09-28. **Dit document herhaalt niet de 71-regelige tabel** die
al bestaat en machinaal regenereerbaar is (`docs/rule-coverage.md`, via
`npm run docs:regeldekking`). Dat zou precies het soort dubbele, met de hand
bijgehouden waarheid zijn dat deze codebase elders expliciet afwijst — zie het
commentaar bovenaan `docs/rule-coverage.md` zelf: *"Niet met de hand
bijwerken: een dekkingstabel die je zelf bijhoudt, is precies één keer waar."*
In plaats daarvan beschrijft dit document **het auditproces zelf**: hoe de drie
onderliggende rapporten worden gemaakt, wat ze precies meten, de
headline-cijfers, de zeven concreet gevonden en gerepareerde defecten, de ene
bewust ongecorrigeerde bronvraag, en wat "geauditeerd" hier wel en niet
betekent.

---

## 1. Het auditproces: drie gegenereerde rapporten, drie vragen

Er zijn drie afzonderlijke, machinaal gegenereerde documenten, die elk een
andere vraag beantwoorden. Ze zijn met opzet niet samengevoegd tot één
rapport, omdat ze conceptueel verschillende dingen meten.

### 1.1 `docs/rule-coverage.md` — is de regel er, en is hij overgenomen?

- **Commando:** `npm run docs:regeldekking`
- **Script:** `scripts/rule-coverage.ts`
- **Vraag:** voor elke regel in het regelbestand (`ruleset/`): is de bron
  aangeleverd en leesbaar (`SOURCE_PRESENT`)? Staat de regel in het
  regelbestand (`TRANSCRIBED`)? Kan de engine hem laten afgaan
  (`IMPLEMENTED`)? Noemt een test hem bij naam (`TESTED`)? Heeft NS waarde en
  lezing bevestigd (`FORMALLY_VALIDATED`)?
- **Regenereren:** het script leest de broncode direct (regelbestand +
  toepassende validatiecode + testbestanden) en schrijft de tabel opnieuw; er
  wordt niets met de hand overgenomen.

### 1.2 `docs/regeldekking-gedrag.md` — doet de code wat het regelbestand zegt?

- **Commando:** `npm run verify:rule-coverage`
- **Script:** `scripts/verify-rule-coverage.ts`
- **Vraag:** anders dan §1.1 ("komt de regelnaam voor in een test") kijkt dit
  naar *gedrag*, in twee richtingen: is er een situatie die de regel hoort af
  te keuren, en wordt die afgekeurd ("gaat af")? Is er een situatie die mag, en
  blijft die goedgekeurd ("gaat niet af")? Een regel telt hier pas als
  getoetst wanneer beide (of, waar van toepassing, één) kant met een test is
  vastgelegd — niet wanneer de naam toevallig ergens in een testbestand
  voorkomt.
- **Regenereren:** zelfde principe, leest direct de testresultaten uit; het
  bestand zelf zegt: *"Niet met de hand bijwerken: dit bestand wordt bij elke
  meting overschreven."*

### 1.3 `docs/rule-interpretation-audit.md` — is de interpretatie zelf correct?

- **Niet een `npm run`-commando maar een audit-verslag** van een eerdere ronde
  (vóór "fase J"), aangevuld met een eigen, tweede en onafhankelijke
  implementatie voor de steekproef (`scripts/audit-rood-weekend.ts`), die
  losstaat van de productiecode en dezelfde vraag met een eigen, opzettelijk
  simpele berekening beantwoordt.
- **Vraag:** niet "staat de regel er en wordt hij getest", maar "is de
  *interpretatie* achter de regel — het artikelnummer, de grensbanden, de
  toepasselijkheidsvoorwaarden — aantoonbaar juist, en zo niet, wat is er mis
  en hoe is het gerepareerd?"
- **Regenereren:** dit is geen doorlopend regenereerbaar rapport maar een
  eenmalig audit-verslag van een afgeronde ronde; een volgende, vergelijkbare
  audit-ronde zou een nieuw, apart verslag zijn — het overschrijft dit
  bestand niet.

**Samenhang:** §1.1 zegt of een regel bestaat en is aangeraakt door een test;
§1.2 zegt of die test het juiste gedrag bewijst; §1.3 zegt of het regelbestand
zelf de bron correct leest. Alledrie zijn nodig — geen enkele vervangt een
andere.

---

## 2. Headline-cijfers (uit de gegenereerde rapporten, met bron)

| Cijfer | Waarde | Bron |
| --- | --- | --- |
| Regels totaal | 71 | `docs/rule-coverage.md` §Samenvatting; code (`ruleset/rule-ids.ts`) |
| `SOURCE_PRESENT` | 66 / 71 | `docs/rule-coverage.md` §Samenvatting |
| `TRANSCRIBED` | 71 / 71 | `docs/rule-coverage.md` §Samenvatting |
| `IMPLEMENTED` (regel-id komt voor in toepassende code) | 57 / 71 (14 `IMPLEMENTATION_GAP`) | `docs/regeldekking-gedrag.md`, kolom "In engine" |
| `TESTED` | 26 / 71 in het gecommitte `docs/rule-coverage.md` (gemeten 2026-09-06); **57 / 71 bij herregeneratie op 2026-09-27** in het kader van dit auditwerk | zie §3 hieronder — dit cijfer was aantoonbaar stale |
| `FORMALLY_VALIDATED` door NS | **0 / 71** | unaniem in alle drie de gegenereerde rapporten |
| Bevestigde harde overtredingen op het gemeten rooster | **0**, van oorspronkelijk gemeld 933 | `docs/rule-interpretation-audit.md` §7 |
| Mogelijke overtredingen (`POTENTIAL_HARD_VIOLATION`, dienstdagen) | 1139 (68%) | `docs/rule-interpretation-audit.md` §7 |
| Unieke onderliggende feiten (`uniqueViolations`) | 599 | `docs/rule-interpretation-audit.md` §3 |
| Tests in de audit-regressie | 133 vóór → 157 ná | `docs/rule-interpretation-audit.md` §7, §9 |

### 3. Verificatie tijdens deze ronde: is `docs/rule-coverage.md` nog actueel?

`docs/rule-coverage.md` draagt de vermelding "Gemeten op 2026-09-06". Om na te
gaan of dat nog klopt, is `npm run docs:regeldekking` opnieuw gedraaid in een
schone werkboom (`git status` vóór en ná gecontroleerd). Uitkomst: het getal
`TESTED` bleek gestegen van **26/71 naar 57/71** — 14 in plaats van 45 regels
zonder test bij naam. Alle overige kolommen (`SOURCE_PRESENT`, `TRANSCRIBED`,
`IMPLEMENTED`, `FORMALLY_VALIDATED`, de 10 ontbrekende pakketten) waren
ongewijzigd. `npm run verify:rule-coverage` is ter controle ook opnieuw
gedraaid: `docs/regeldekking-gedrag.md` kwam **byte-voor-byte identiek** terug
— de daarin genoemde 14 `IMPLEMENTATION_GAP`-regels en de 57/71
"in engine"-teller zijn dus actueel, niet gedreven.

Na deze verificatie is de her-gegenereerde `docs/rule-coverage.md`
teruggezet naar de gecommitte versie (`git checkout --`), omdat deze
schrijfronde uitsluitend `source-coverage.md` en dit bestand mag opleveren.
**Aanbeveling:** iemand met schrijfrecht op het regelbestand draait
`npm run docs:regeldekking` opnieuw en committeert het resultaat, zodat de
gepubliceerde `TESTED`-kolom (26/71) niet langer een stale meting toont
naast een werkelijkheid van 57/71.

### Waarom "2 van de 71 gevalideerd" én "0/71 FORMALLY_VALIDATED" allebei kloppen

Fase-rapporten K/M/N noemen "2 van de 71 regels gevalideerd", terwijl
`rule-coverage.md` `FORMALLY_VALIDATED: 0/71` toont. Beide zijn correct: er
bestaat een `PRODUCT_VALIDATED`-constante in `ruleset/regio-west-2026.ts`,
gebruikt door precies twee `PRODUCT_POLICY`-regels
(`ROSTER_ANCHOR_LOCKED`, `RESERVE_BASE_WITHOUT_DUTIES`) die per definitie waar
zijn omdat het platform ze zelf stelt — niet omdat NS een CAO-lezing heeft
bevestigd. `FORMALLY_VALIDATED` meet specifiek NS-bevestiging van een
CAO/regionale bewering en telt deze twee product-eigen regels terecht niet
mee (`docs/lyra-knowledge/inventory-rules-and-sources.md` §7, slotparagraaf).

---

## 4. De zeven gevonden en gerepareerde defecten

Alle zeven zijn gedocumenteerd in `docs/rule-interpretation-audit.md` §8, met
detail per defect in §1 en §4. Ze zijn hier samengevat, in dezelfde volgorde
als het bronrapport:

1. **Verzonnen contractuele einddatum.** De oorspronkelijke implementatie
   gebruikte `effectiveUntil = "2025-12-31"`. Die datum komt in de bron niet
   voor — hij was afgeleid uit de naam "CAO 2024–2025" en lag negen maanden
   naast de werkelijke contractuele einddatum (art. 3: looptijd 1 jan. 2024
   – 1 maart 2025, stilzwijgend verlengd, met nawerking bij opzegging). Het
   probleem zat dieper dan de datum: één `effectiveUntil`-veld dwingt de keuze
   tussen "vervallen" en "onbeperkt geldig", terwijl de bron een derde
   toestand kent (doorlopend met onzekere actualiteit). Gerepareerd door
   `effectiveFrom`/`contractualEnd`/`renewalRule`/`terminationKnown`/
   `supersededBy` plus een functie `currentLegalStatus()` die
   `NOT_YET_IN_FORCE`/`IN_ORIGINAL_TERM`/`CURRENT_LEGAL_STATUS_NOT_VERIFIED`/
   `SUPERSEDED` teruggeeft. Het veld `effectiveUntil` bestaat niet meer.

2. **Overlappende startbanden op 05:00.** `RP_MAX_DUTY_START_0400_0501`
   ([04:00, 05:01)) en `RP_MAX_DUTY_START_0500_0600` ([05:00, 06:00))
   overlapten precies op 05:00: elke dienst die om 05:00 begon viel onder
   beide bepalingen. De strengste regel won toevallig, dus de uitkomst was
   toevallig juist, maar elke uitspraak over de grens tussen 05:00 en 05:01
   was onbetrouwbaar. Een eerder rapport noemde dit ten onrechte een
   bronambiguïteit — het was een implementatiefout. Gerepareerd met benoemde
   constanten `VERY_EARLY = [04:00, 05:01)` en `EARLY = [05:01, 06:00)` in
   `checks/metrics.ts`, met twaalf grenstests
   (`tests/rules-engine/startbanden.test.ts`). Het aantal bevindingen bleef
   ongewijzigd (234) — de fout zat in de redenering, niet in de uitkomst.

3. **Rood weekend zonder toepasselijkheidstoets.** De oorspronkelijke
   `RED_WEEKEND_MIN_REST`-controle presenteerde een rekenkundige uitkomst als
   bewijs van een overtreding, zonder te vragen of een individuele
   vrijwillige afwijking, een collectieve OR-afwijking, of Bijlage IV van
   toepassing was. Bovendien noemde de regel het verkeerde artikel (zie
   defect 7) en maakte hij de twee eisen van art. 102 lid 3 (venster
   zaterdag 00:00–maandag 04:00 én minimaal 60 uur aaneengesloten rust) niet
   als twee aparte, navolgbare eisen zichtbaar. Gerepareerd door
   `assessWeekend()` expliciet elk van de velden (`requiredRestWindow`,
   `actualContinuousRest`, `meetsMinimumRest`, `waiverPresent`, `source`, …)
   in de bevinding te laten meesturen, en door de classificatie nooit hoger
   dan `POTENTIAL` te laten uitkomen zolang de drie afwijkingsbronnen niet
   zijn aangeleverd.

4. **Ontbrekende eerste vier roosterweken.** De engine eiste vóór de
   rood-weekendtoets een contextvenster van vier weken historie en sloeg de
   hele toets over als dat ontbrak — ook voor reeksen die geen historie nodig
   hadden. Dit gat (13% van de gevallen) werd zichtbaar doordat een tweede,
   onafhankelijke implementatie (`scripts/audit-rood-weekend.ts`) aanvankelijk
   op 116 in plaats van 133 uitkwam. Gerepareerd: dekking wordt vastgelegd
   maar poort niet meer de toets af; na de correctie kwamen beide
   implementaties exact op 133 uit.

5. **Dubbele telling.** Eén dag kan in meer dan één reeks van drie weekenden
   vallen; oorspronkelijk werd alleen de eerste reeks gerapporteerd. Elke
   bevinding kreeg een `occurrenceKey` die het onderliggende feit benoemt
   (een weekendreeks, een venster, een rustinterval) in plaats van de dag
   waarop toevallig werd getoetst. Effect zichtbaar in §3 van
   `rule-interpretation-audit.md`: 1888 ruwe bevindingen versus 599 unieke
   onderliggende feiten; bij het rode weekend alleen al 1375 ruw tegen 133
   uniek.

6. **Verzonnen contracturen.** De oorspronkelijke seed vulde 32 of 36 uur naar
   een willekeurig patroon in. De Dordrechtse basisroosters zijn echter
   aangeleverd als 40-uursroosters; die omvang is overgenomen in seed en
   database, met een expliciete waarschuwing in de code dat contractomvang
   nooit uit gemiddeld werkelijk gewerkte uren mag worden afgeleid — anders
   verheft een te vol rooster zichzelf tot norm.

7. **Verkeerd artikelnummer.** Het rode weekend verwees naar art. 119 in
   plaats van het juiste art. 102 lid 3. Gecorrigeerd naar het juiste artikel,
   mét de twee eisen die daar expliciet in staan.

**Effect van de zeven correcties samen** (`docs/rule-interpretation-audit.md`
§7): bevestigde overtredingen daalden van "933 gemelde harde overtredingen"
naar **0 bevestigd**; het aantal geraakte dienstdagen steeg juist van 933 naar
1139 (68%) — omdat de rood-weekendtoets nu ook de eerste vier weken meeneemt
(defect 4) — maar geen daarvan is nog als `CONFIRMED_HARD_VIOLATION`
geclassificeerd, want geen enkele regel is `VALIDATED` én bronactueel
(§1.1 hierboven).

---

## 5. De ene, bewust NIET gecorrigeerde bronvraag

Anders dan de zeven defecten hierboven is er één discrepantie die met opzet
**niet stilzwijgend is rechtgezet**:

> `WEEKLY_REST_72H_PER_14D` noemt in de code artikel 100, terwijl het getal
> (72 uur per 14×24 uur) alleen wordt teruggevonden in de tekst van artikel 99.

Dit staat vastgelegd in `docs/source-inventory-phase-o.md` §5 en herbevestigd
in `docs/fase-p-rapport.md` §F, gemarkeerd als `SOURCE_REFERENCE_REVIEW_REQUIRED`
— dus expliciet met een eigen statuswaarde, niet als stille `nee`/`ja` in een
kolom. Het onderscheid met de zeven defecten in §4 is welbewust: bij die zeven
was buiten twijfel wát de bron zegt en wát er faalde in de implementatie
(overlappende banden, verkeerd artikelnummer bij het rode weekend, een niet
uit de bron afgeleide datum). Bij `WEEKLY_REST_72H_PER_14D` is dat niet zo
scherp: mogelijk is het artikelnummer een tikfout, mogelijk staat de waarde
ook impliciet in artikel 100 via een verwijzing die niet is meegenomen, of
mogelijk hoort de regel eigenlijk bij artikel 99. Zonder dat door een bevoegde
lezer te laten bevestigen, zou een eigenhandige "correctie" van het
artikelnummer precies het soort ongefundeerde aanname zijn die deze hele
auditronde probeert te voorkomen. Vandaar: gedocumenteerd als open vraag,
niet als (mogelijk verkeerd geraden) fix.

---

## 6. Wat "geauditeerd" hier betekent — en wat niet

`docs/regeldekking-gedrag.md` sluit af met een zin die de kern van deze hele
audit-inspanning samenvat, en die hier letterlijk wordt geciteerd:

> "Formele validatie door NS: 0 van de 71. Een test bewijst dat de code doet
> wat er staat; niet dat wat er staat juridisch klopt. Zolang de
> Arbeidstijdenwet en het Arbeidstijdenbesluit vervoer niet zijn aangeleverd,
> blijft dat onderscheid staan."

En `docs/rule-coverage.md`, in dezelfde geest:

> "`FORMALLY_VALIDATED` staat op nul en dat is geen tekortkoming van de bouw.
> Het betekent dat niemand bij NS heeft bevestigd dat deze waarden de juiste
> zijn. Zolang dat zo is, mag nergens in dit platform staan dat de regels
> compleet of juist zijn, en blijft `Production-safe: NO` staan."

**Wat "geauditeerd" hier dus wél betekent:**

- Een behavioral test (`docs/regeldekking-gedrag.md`) bewijst dat de code een
  situatie die de regel hoort af te keuren, ook daadwerkelijk afkeurt, en een
  situatie die mag, ook daadwerkelijk toestaat.
- De interpretatie-audit (`docs/rule-interpretation-audit.md`) bewijst, met
  een tweede, onafhankelijke implementatie als steekproefcontrole, dat de
  *redenering* achter minstens de gecontroleerde regels (met name het rode
  weekend en de startbanden) intern consistent is en geen dubbele telling of
  contextgaten bevat.
- Zeven concrete defecten in die redenering zijn gevonden en gerepareerd
  (§4), en één blijvend onzekere bronverwijzing is als zodanig gemarkeerd in
  plaats van stilzwijgend "gecorrigeerd" (§5).

**Wat "geauditeerd" hier nadrukkelijk NIET betekent:**

- Het betekent niet dat NS heeft bevestigd dat het regelbestand de juiste
  lezing van de CAO, de Roosterkaders Regio West, of enige andere bron is.
  `FORMALLY_VALIDATED` staat op 0/71 in alle drie de gegenereerde rapporten,
  zonder uitzondering.
- Het betekent niet dat de aangeleverde CAO-tekst (2024–2025) actueel is voor
  de roosterperiode die wordt beoordeeld (okt–dec 2026): de contractuele
  einddatum is 28 februari 2025, met stilzwijgende verlenging waarvan de
  actuele status `CURRENT_LEGAL_STATUS_NOT_VERIFIED` is
  (`CAO_CURRENCY_CONFIRMATION` in `MISSING_PACKAGES`, blokkeert
  `PRODUCTION_MODE`).
- Het betekent niet dat de wettelijke basiskaders (Arbeidstijdenwet,
  Arbeidstijdenbesluit vervoer) zijn meegewogen: beide zijn volledig
  `NOT_SUPPLIED` en worden niet gereconstrueerd.
- Het betekent niet dat elke regel getest is: 14 van de 71 regels
  (`IMPLEMENTATION_GAP`, zie §2) worden nergens door toepassende code
  aangeroepen en kunnen dus per definitie niet op gedrag zijn getoetst.
- Het betekent niet dat er geen bevestigde harde overtredingen kúnnen bestaan
  — het betekent dat er, gegeven de huidige validatie- en bronstatus, geen
  enkele bevinding het predicaat `CONFIRMED_HARD_VIOLATION` mag dragen, omdat
  daarvoor drie dingen tegelijk moeten kloppen (regelstatus `VALIDATED`, bron
  `IN_ORIGINAL_TERM`, geen open toepasselijkheidsvraag) en dat op dit moment
  voor geen enkele regel het geval is.

Kortom: deze audit toont aan dat de **code doet wat het regelbestand zegt**.
Zij toont niet aan, en claimt nergens te tonen, dat **het regelbestand zegt
wat NS bedoelt**. Dat onderscheid is de reden dat `Production-safe: NO` aan
het eind van `docs/rule-interpretation-audit.md` blijft staan, en waarom dit
document dat oordeel bevestigt in plaats van het te herzien.
