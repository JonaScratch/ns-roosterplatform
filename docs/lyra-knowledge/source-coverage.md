# Broncoverage-rapport — LYRA MASTER PROGRAM (§48)

Opgemaakt 2026-09-28 als onderdeel van de Fase 0-vervolgronde. Dit is een
**samenvattend rapport over bestaande, machinaal gegenereerde metingen** — geen
nieuwe telling, geen nieuwe interpretatie. Elk getal hieronder komt uit een van
drie bronnen, met citaat:

1. `docs/rule-coverage.md` (gegenereerd door `npm run docs:regeldekking`,
   script `scripts/rule-coverage.ts`);
2. `docs/regeldekking-gedrag.md` (gegenereerd door `npm run verify:rule-coverage`,
   script `scripts/verify-rule-coverage.ts`);
3. `src/server/rules-engine/ruleset/regio-west-2026.ts`, export `MISSING_PACKAGES`
   (broncode zelf, geen rapport).

Waar een getal niet uit een van deze drie bronnen (of de Fase 0-inventaris,
`docs/lyra-knowledge/inventory-rules-and-sources.md` en `current-state.md`) kon
worden gehaald, staat hier letterlijk **"niet vastgesteld"** — er is niets
geraden of afgeleid.

**Belangrijke bevinding tijdens het opstellen van dit rapport (verificatiestap
§99/§3):** `docs/rule-coverage.md` staat gedateerd "Gemeten op 2026-09-06" en
was op dat punt stale. Om te controleren of de cijfers zijn gedreven, is
`npm run docs:regeldekking` en `npm run verify:rule-coverage` opnieuw gedraaid
in een schone werkboom (bevestigd met `git status` vóór en ná). Resultaat: de
kolom **`TESTED` is gestegen van 26/71 naar 57/71** (14 regels zonder test in
plaats van 45) — de rest van de tabel (SOURCE_PRESENT, TRANSCRIBED, IMPLEMENTED,
FORMALLY_VALIDATED, en de lijst van 9 ontbrekende pakketten) was **ongewijzigd**.
`docs/regeldekking-gedrag.md` (de gedragslaag) was **byte-voor-byte identiek**
vóór en na regeneratie — de daar gerapporteerde 14 `IMPLEMENTATION_GAP`-regels
zijn dus actueel en niet gedreven. Na deze verificatie is de her-gegenereerde
`docs/rule-coverage.md` teruggezet naar de gecommitte versie (`git checkout --`)
omdat deze ronde uitsluitend de twee hier gevraagde documenten mag schrijven;
**de aanbeveling is dat iemand met schrijfrecht op het regelbestand
`npm run docs:regeldekking` opnieuw draait en het resultaat commit**, zodat de
26/71-vermelding in de tabel hieronder (die uit het gecommitte bestand komt)
niet langer afwijkt van de werkelijke 57/71. Beide waarden staan hieronder
genoemd, met bron.

---

## Samenvattende tabel

| Categorie | Aantal | Bron | Toelichting |
| --- | --- | --- | --- |
| **TOTAL_RULES** | 71 | `docs/rule-coverage.md` §Samenvatting; bevestigd in code (`ruleset/rule-ids.ts`, 59 CAO + 5 REGIONAL + 7 PRODUCT_POLICY) | Regels zijn TypeScript-literals, geen database-rijen |
| **FORMAL_SOURCE_ATTACHED** (= `SOURCE_PRESENT`) | 66 / 71 | `docs/rule-coverage.md` §Samenvatting | Bron aangeleverd én leesbaar. De overige 5 hebben `niet aangeleverd` als brondocument in de per-regeltabel (o.a. `RP_STATION_BREAK_ADJUSTMENT`, `RP_LOCATION_WORK_INTERRUPTION`, `AGE55_VERY_EARLY_EXEMPTION`, `REGIO_WEST_WEEKEND_TARGET`, `MIX_PROFILE_SPECIAL_RULES`) |
| **CURRENT_EFFECTIVITY_CONFIRMED** | **0 / 71** | Afgeleid uit `docs/rule-interpretation-audit.md` §1.1 + `docs/lyra-knowledge/current-state.md` §Bronstatus + `MISSING_PACKAGES` (`CAO_CURRENCY_CONFIRMATION`) | De aangeleverde CAO (2024–2025) is voor de geauditeerde roosterperiode (okt–dec 2026) contractueel verlopen sinds 28-2-2025 (`contractualEnd`), met `TACIT_RENEWAL` en `terminationKnown: "UNKNOWN"`; `currentLegalStatus()` levert voor 2026 `CURRENT_LEGAL_STATUS_NOT_VERIFIED` op — expliciet géén bevestigde actualiteit. De Roosterkaders Regio West 2026 is bovendien een scan zonder tekstlaag (`SOURCE_PRESENT_NOT_MACHINE_READABLE`, `docs/source-inventory-phase-o.md`), dus zelfs de regionale regels die er wél op zouden moeten steunen hebben geen bevestigde, leesbare actuele bron. Er bestaat geen rapportkolom die dit getal direct als "0" afdrukt; het volgt logisch uit `FORMALLY_VALIDATED = 0/71` (zie hieronder) gecombineerd met het feit dat de audit dit expliciet als open punt aanmerkt — dit is dus een **afgeleid**, geen letterlijk overgenomen getal, maar het kan op basis van de gelezen bronnen niet hoger dan 0 liggen |
| **HUMAN_INPUT** | Niet vastgesteld als apart getal | — | Geen van de gelezen rapporten kent een aparte kolom "HUMAN_INPUT" op regelniveau. Er is wél een voorlopige, mens-geïnitieerde beeld-transcriptie van de Roosterkaders (`docs/lyra-knowledge/roosterkaders-regio-west-2026-DRAFT-TRANSCRIPTIE.md`, `HUMAN_REVIEW_REQUIRED`), maar die is niet naar regelniveau vertaald in `rule-coverage.md` |
| **LOCAL_RULE** | 4 (laag `LOCAL`) genoemd in de code, maar in de tabel getypeerd als `REGIONAL`/`LOCAL` gemengd | `docs/rule-coverage.md`, regels `DORDRECHT_ROSTER_LINE_DIVISOR` (laag LOCAL) en de vier `REGIONAL`-regels uit `regio-west-2026.ts` | Zie §4 van `inventory-rules-and-sources.md`: laag `LOCAL` in het negenlagenmodel (`RULE_LAYERS`) is in de praktijk vrijwel niet bezet — `DORDRECHT_ROSTER_LINE_DIVISOR` is het enige regel-exemplaar met laag `LOCAL` dat in de tabel voorkomt; de overige "regionale" regels zitten in laag `REGIONAL`, niet `LOCAL`. Een scherp onderscheid tussen beide lagen op regelniveau is dus: 1 regel `LOCAL`, 4 regels `REGIONAL`, geen enkele in `INDIVIDUAL`/`EMPLOYEE_CHOICE` |
| **POTENTIAL** | Niet vastgesteld als apart getal per regel | — | `POTENTIAL_HARD_VIOLATION` is een **uitkomstclassificatie per bevinding op een concreet rooster** (`validation/result.ts`), geen bronstatus per regel. Zie het aparte cijfer in `docs/rule-interpretation-audit.md` §7: 1139 dienstdagen (68%) kregen bij de laatst gemeten doorrekening de classificatie `POTENTIAL_HARD_VIOLATION`/mogelijke overtreding — dat is een uitkomst-, geen brondekkingsgetal, en dus niet één-op-één inzetbaar in deze tabel zonder het te verwarren met bronstatus |
| **SOURCE_MISSING** | **10** (`MISSING_PACKAGES`) | `src/server/rules-engine/ruleset/regio-west-2026.ts` r. 340–421 | Zie volledige lijst met exacte bewoording hieronder. **Let op:** `docs/lyra-knowledge/inventory-rules-and-sources.md` (§1, §4) noemt hier "negen"; bij het letterlijk natellen van de array in de broncode (`grep -c '^\s*id:'` binnen de array-grenzen) zijn het er **tien** — `WR_CO_DEFINITION` is het tiende, laatste element en stond kennelijk niet meegeteld in de Fase 0-samenvatting. Dit is hier gecorrigeerd op basis van directe telling in de broncode, niet aangenomen |
| **CONFLICTING** | Zie `conflict-report.md` — **10** conflictitems in totaal, waarvan minimaal **5** rechtstreeks de rules-engine/regelbestand raken | `docs/lyra-knowledge/conflict-report.md` (tijdens het schrijven van dit rapport in een parallelle sessie verschenen; §1–§10) | `conflict-report.md` was bij de start van deze schrijfronde nog niet aanwezig; het is tegen het einde van dit werk verschenen (parallelle sessie) en is hier ter volledigheid gecontroleerd. Tien conflictitems in totaal; regel-gerelateerd zijn met name §1 (drie parallelle statusmodellen), §6 (TESTED 26/71 vs. 25/71), §7 (verouderde vijfvoudige uitkomstterminologie in `rules-engine-rapport.md`), §8 (`WEEKLY_REST_72H_PER_14D`-artikelverwijzing, zie ook `rule-audit.md` §5), §9 (schijnbare tegenspraak "2/71 gevalideerd" vs. "0/71 FORMALLY_VALIDATED"). Dit rapport doet geen eigen, aanvullende telling — voor het volledige, eerlijke beeld per item: zie `conflict-report.md` zelf. Onafhankelijk daarvan, uit de rules-engine-inventaris zelf: er is geen los, statisch `conflictsWith`-veld op regelniveau — conflicten tussen regels met hetzelfde id worden impliciet opgelost door `resolveRule()` (specificiteit → laag → datum, `ruleset/types.ts`); een conflict tussen regels met verschillende id's wordt nergens automatisch gedetecteerd (`inventory-rules-and-sources.md` §6) |
| **NOT_USED** (= `IMPLEMENTATION_GAP`) | **14 / 71** | `docs/regeldekking-gedrag.md` (kolom "In engine" = `—`), bevestigd door herregeneratie (§verificatie hierboven, ongewijzigd 14) | Exacte lijst: `RT_PREFERRED_WINDOW_WEEKS`, `HOLIDAY_ATTACHED_MIN`, `HOLIDAY_DETACHED_MIN`, `RO_DVP_DETACHED_MIN`, `RO_DVP_COMBINED_MIN`, `PARTTIME_DASH_DAY_MIN`, `WTV_DAY_LATEST_START`, `WTV_DAYS_PER_YEAR_36H`, `WITHDRAWN_WTV_GRANT_WITHIN_DAYS`, `REGIO_WEST_WEEKEND_TARGET`, `DORDRECHT_ROSTER_LINE_DIVISOR`, `REGIO_WEST_WTV_INTERVAL_WEEKS`, `NEW_DRIVER_PROTECTION_YEARS`, `PLAN_ROSTER_OVERFLOW_LIMIT`. Deze staan wél in het regelbestand (`TRANSCRIBED`) maar worden nergens door toepassende code aangeroepen — er is dus niets dat voor deze regels kan afgaan of niet afgaan |
| **USED_BY_VALIDATOR** | Niet vastgesteld (als apart, per-component getal) | — | `evaluateAssignment()` (`assignment.ts`) is de ene ingang die door roostercommissie, dienstindeling, reserve-invulling, beschikbare diensten, ruilingen én de optimizer-eindvalidator (`final-validator.ts`) wordt gebruikt (`inventory-rules-and-sources.md` §2). Geen van de gelezen rapporten telt per regel uit óf, en zo ja door welke van deze componenten specifiek, hij wordt geraadpleegd — de 57/71 "in engine"-teller is component-onafhankelijk |
| **USED_BY_OPTIMIZER** | Niet vastgesteld | — | Idem. Bekend is dát de CP-SAT-optimizer via `final-validator.ts` dezelfde `evaluateAssignment()`-ingang gebruikt, maar niet welke subset van de 71 regels specifiek als optimizer-doelfunctieterm (in plaats van alleen als validatiecontrole) is opgenomen |
| **USED_BY_AGENT** | Niet vastgesteld | — | Geen van de gelezen rapporten kent een regel-naar-agent-tool-koppeling. De Lyra-agent heeft een eigen 12-tools toolcontract (`inventory-memory-grounding-tools.md`), maar een expliciete telling "regel X wordt door agent-tool Y geraadpleegd" is niet aangetroffen |
| **USED_BY_QUALITY_MODEL** | Niet vastgesteld | — | Het kwaliteitsmodel (`quality-model.ts`/`roster-quality.ts`) is een apart, van de rules-engine losstaand systeem (`inventory-quality-and-preferences.md`); een expliciete regel-naar-kwaliteitsmodel-koppeling per regel-id is in de gelezen bronnen niet gerapporteerd |

---

## SOURCE_MISSING — de 10 regelpakketten, letterlijk

Bron: `src/server/rules-engine/ruleset/regio-west-2026.ts`, export
`MISSING_PACKAGES` (regels 340–421). Dit is een blokkeerlijst, geen
wensenlijst — het bestand zelf zegt: *"Dit is geen lijst met wensen maar een
blokkeerlijst: zolang een pakket ontbreekt, kan elke beslissing die ervan
afhangt niet veilig worden genomen."*

1. **`ATW_VALIDATED_RULESET`** — Arbeidstijdenwet, gevalideerd regelpakket.
   *"De aangeleverde bron is de CAO. De CAO bepaalt zelf dat een
   werktijdregeling ook aan de Arbeidstijdenwet moet voldoen. De actuele
   wettekst en de bijbehorende grenswaarden zijn niet aangeleverd en worden
   niet gereconstrueerd."* Blokkeert: `PUBLICATION`, `PRODUCTION_MODE`.
2. **`ATB_VALIDATED_RULESET`** — Arbeidstijdenbesluit vervoer, gevalideerd
   regelpakket. *"Voor spoorwegpersoneel gelden aanvullende bepalingen uit het
   Arbeidstijdenbesluit vervoer. Niet aangeleverd."* Blokkeert: `PUBLICATION`,
   `PRODUCTION_MODE`.
3. **`CAO_CURRENCY_CONFIRMATION`** — Bevestiging welke CAO actueel is. *"De
   aangeleverde CAO heet 2024–2025. Voor planning in 2026 moet NS bevestigen
   welke CAO, nawerking of nieuwe afspraken gelden."* Blokkeert:
   `PRODUCTION_MODE`.
4. **`QUALIFICATION_MATRIX`** — Kwalificatiematrix. *"Welke baanvakken,
   materieelsoorten, bevoegdheden en lokale kennis een dienst vereist, en welke
   een medewerker heeft, komt uit een bronsysteem dat niet is aangesloten."*
   Blokkeert: `PUBLICATION`, `PRODUCTION_MODE`.
5. **`DORDRECHT_BREAK_PARAMETER`** — Werkonderbreking en arbeidstijdcorrectie
   voor deze standplaats. *"De CAO legt de duur van de werkonderbreking en de
   daaraan gekoppelde verlaging van de maximale arbeidstijd per standplaats
   vast. Die waarden zijn niet aangeleverd."* Blokkeert: `DUTY_WITH_LONG_BREAK`.
6. **`REGIO_WEST_WEEKEND_TARGET_DEFINITION`** — Definitie van de
   weekendmaatstaf Regio West. *"Het kader noemt 'zoveel als mogelijk 50%
   weekenden' zonder wiskundige definitie."* Blokkeert:
   `WEEKEND_TARGET_OPTIMIZATION`.
7. **`MIX_BLM_50PLUS_PROFILE_RULES`** — Bijzondere regels Mix, BLM en 50+ Mix.
   *"Niet formeel vastgelegd."* Blokkeert: `MIX_PROFILE_PLACEMENT`.
8. **`INDIVIDUAL_RESTRICTIONS_SOURCE`** — Bron voor individuele
   arbeidstijdbeperkingen. *"Individuele beperkingen moeten uit een
   geautoriseerd HR-systeem komen. Er is geen koppeling; de engine kan daarom
   niet weten of een medewerker een beschermde beperking heeft."* Blokkeert:
   `PUBLICATION`, `PRODUCTION_MODE`.
9. **`EMPLOYEE_CONTRACT_HOURS`** — Contractomvang per medewerker.
   *"Urennormen zijn niet te berekenen zonder de individuele contractomvang. Er
   wordt geen 36 of 40 uur aangenomen."* Blokkeert: `WEEKLY_HOURS_VALIDATION`.
10. **`WR_CO_DEFINITION`** — Betekenis en regels van de roosterposities WR en
    CO. *"Komen voor in bestaande roosters; hun regels zijn niet
    aangeleverd."* Blokkeert: `WR_CO_PLACEMENT`.

**Getalscontrole:** letterlijk natellen van de array in
`src/server/rules-engine/ruleset/regio-west-2026.ts` (regels 340–421, elke
`id:`-sleutel binnen de array-grenzen geteld) levert precies **10** objecten
op, niet 9. `docs/rule-coverage.md` §"Regelpakketten die helemaal ontbreken"
toont dezelfde tien, in dezelfde volgorde en bewoording, dus dit is geen
verschil tussen code en gegenereerd rapport — alleen de Fase 0-samenvatting
(`inventory-rules-and-sources.md`) noemt hier "negen", wat bij directe telling
niet klopt. Hier gecorrigeerd op basis van de broncode zelf.

---

## Wat dit rapport niet doet

Dit rapport hertelt geen van de 71 regels afzonderlijk — die tabel bestaat al,
is regenereerbaar (`npm run docs:regeldekking`) en staat in `docs/rule-coverage.md`.
Dit rapport is een **samenvattende doorsnede** langs de categorieën die §48 van
de opdracht vraagt, met expliciete markering van wat wel en niet uit bestaande
metingen kon worden gehaald. Geen getal in dit document is geschat of
afgerond zonder bronvermelding; waar een categorie niet met een bestaand
rapport te onderbouwen was, staat "niet vastgesteld".
