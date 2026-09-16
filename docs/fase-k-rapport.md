# Fase K — organisatorische en functionele infrastructuur

Datum: 3 september 2026
Status: **Production-safe: NO — simulatie/ontwikkeling.** Dat is geen fout maar
het bedoelde gedrag: publiceren blijft uitgesloten zolang de juridische
regelverzameling niet als actueel is bevestigd.

---

## 1. Het NS-logo — niet uitgevoerd, en waarom niet

Het aangeleverde logobestand is **nergens aangetroffen**: niet in de repository,
niet in `public/`, niet in `~/Downloads` of `~/Desktop`, en er zat geen bijlage
bij de opdracht.

Wat er wél is gedaan:

- `src/components/ui/ns-logo.tsx` — één component dat overal wordt gebruikt:
  zijbalk, aanmeldscherm, alle vier de omgevingen en de printsjablonen.
- `src/server/branding/assets.ts` — kijkt in `public/brand/` naar
  `ns-logo.svg|png` (en een witte variant voor donkere achtergronden).
- `public/brand/LEESMIJ.md` — waar het bestand moet komen te staan.

Zodra het bestand daar staat, verschijnt het overal tegelijk, met behoud van de
beeldverhouding (`width: auto`, alleen de hoogte wordt gezet, dus geen
vervorming, geen crop, geen recolor).

Tot die tijd staat er de bestaande neutrale vorm. Er is **geen NS-logo
nagetekend en geen "NS-achtig" alternatief gemaakt.** Dat was een uitdrukkelijke
eis en het is ook de veiligere keuze: op een exportblad dat op een NS-roosterblad
moet lijken, is "lijkt erop" precies het verkeerde antwoord.

---

## 2. Standplaatsen

- 41 standplaatsen als masterdata (`src/domain/locations.ts`, tabel
  `StationLocation`), plus 6 planeenheden (ASD 1/2, RTD 1/2, UT 1/2) als
  `PlanningUnit` onder hun standplaats.
- Bij de planeenheden staat vastgelegd dat **niet bekend is** wat het
  organisatorische verschil tussen 1 en 2 is; dat is niet ingevuld met een
  aanname.
- Regio's: alleen `WEST` waar de aangeleverde stukken dat vaststellen; alle
  overige standplaatsen staan in een uitdrukkelijke regio `ONBEPAALD`.
- Alleen **DDR Dordrecht** is functioneel ingericht. De andere veertig tonen
  "Deze standplaats is geregistreerd maar nog niet ingericht." — geen fictieve
  diensten, geen overgenomen Dordrechtroosters.

### Beheerscherm

`/beheer/organisatie` toont per standplaats afzonderlijk of er diensten,
roosters, lokale regels en een exportsjabloon zijn. `/beheer/organisatie/[code]`
toont per standplaats de zes gereedheidspunten en de dienstenpakketten.
`planningEnabled` kan niet met de hand aan: `setPlanningEnabled` weigert zolang
`readinessOf` punten mist, en die functie heeft geen bypass-parameter.

---

## 3. Standplaatsafbakening (server-side)

`src/server/security/location-scope.ts` beantwoordt de vraag "welke standplaats"
uit de sessie, niet uit het scherm. De keuzelijst
(`src/components/layout/location-selector.tsx`) is een suggestie; de server
beslist opnieuw.

- Medewerkers zijn vastgezet op hun eigen standplaats. Een verzoek om een andere
  levert **de eigen gegevens** op, plus een `AUTHORIZATION_DENIED` in het
  beveiligingslog — geen foutmelding die bevestigt dat die standplaats bestaat.
- Beheer, roostercommissie en dienstindeling mogen wisselen. Dat een lid van de
  roostercommissie landelijk of standplaatsgebonden werkt, staat niet in de
  aangeleverde stukken; de huidige keuze is vastgelegd in het bestand zelf en
  wordt geaudit.
- Afgebakend: `listBaseRosters`, `profileQuality`, `requestGeneration`,
  `listDutyPackages`, `buildOptimizerInput`, `scheduleVersion`,
  `inputDataVersion`, `listCandidates`, `dutyCoverage`, `buildRosterDocument`.
- `CandidateRoster` draagt nu een `locationCode`, zodat een kandidaat van
  Dordrecht niet met een Rotterdams rooster wordt vergeleken.

Gemeten met `npm run verify:toegang`: alle 13 paden gedragen zich per rol zoals
verwacht, en beide standplaatsproeven leveren eigen gegevens op zonder gegevens
van een andere standplaats in het antwoord.

---

## 4. Twee workflows in het domeinmodel

`NEW_TIMETABLE` en `AMENDMENT` zitten in de **Rules Engine**, niet in het scherm.

- `src/domain/roster-structure.ts` — `STRUCTURAL_ANCHORS` (R, RES, WR, CO),
  `assessStructuralChange()` als enige vergelijking.
- `src/server/rules-engine/validation/checks/structure.ts` — de ankervergrendeling
  bij elke dienstplaatsing.
- `src/server/rules-engine/structure-change.ts` — dezelfde regel voor een
  slotwijziging zonder dienst (WR → RES en dergelijke), via hetzelfde
  regelbestand en dezelfde `Evaluation`.

Twee eigenschappen zijn met opzet zo gebouwd:

1. **Geen uitzondering.** `ROSTER_ANCHOR_LOCKED` leest geen
   `AuthorisedException`. Er is geen aanroep waarmee een beheerder een anker kan
   verplaatsen; de weg is een nieuwe dienstregelingronde. Er is een test die dit
   afdwingt met een verleende uitzondering in de invoer.
2. **Geen baseline betekent blokkeren.** Een wijzigingsblad zonder vastgelegde
   structuur levert `RULESET_INCOMPLETE` op en geen goedkeuring.

WTV: de opdracht noemt WTV als apart ankertype. In dit datamodel wordt de
WTV-dag gedragen door positie `WR`; er is géén nieuw positietype verzonnen. Dit
is een naamgevingsvraag aan NS, vastgelegd in de code.

### Roosterperiode en baseline

`RosterPeriod` + `RosterStructureBaselineSlot` (`roster-period-service.ts`):
periodes met versie en label, een bevroren afdruk van de structuur, en
`STRUCTURE_EDITABLE` / `STRUCTURE_LOCKED`. Geen enkele datum is hardcoded; de
periode komt uit de invoer. Er is **geen functie** om een vastgelegde baseline te
wijzigen of te ontgrendelen.

Gemeten met `npm run verify:structuur` tegen de echte database: 840 slots uit 5
roosters vastgelegd, waarvan 324 structurele ankers; 12 van de 12 controles
geslaagd, waaronder "alle 25 bekeken ankerdagen blokkeren een dienst" en "alle 25
bekeken dienstdagen laten een ander dienstnummer toe".

---

## 5. Het reserverooster in twee lagen

- Regel `RESERVE_BASE_WITHOUT_DUTIES`: in de basisgeneratie van een
  reserverooster hoort geen dienstnummer.
- `src/server/services/operational-assignment-service.ts`: de dienstindeling
  vult een RES-dag in als **laag** erbovenop. `underlyingSlotType` bewaart wat
  eronder zat; intrekken zet dat terug.
- `attemptReserveFill` loopt nu via die laag. Dat is bewust geen losse
  voorziening gebleven: een laag die niemand aanroept, is dode code met een goed
  verhaal.

Gemeten tegen echte gegevens: een RES-dag ingevuld (de dag toont de dienst, het
RES-slot is bewaard) en weer ingetrokken (de reservedag staat er weer, de laag is
opgeruimd).

Nog niet aanwezig: er is voor Dordrecht **nog geen reserverooster** in de
gegevens. De regels staan klaar, er is nog niets om ze op toe te passen.

---

## 6. De importstraat

`UPLOADED → PARSED → NORMALIZED → VALIDATED → REVIEW_REQUIRED → CONFIRMED → ACTIVE`

- `src/server/import/duty-import.ts` raakt de database niet: hij leest, telt en
  oordeelt. De service eromheen schrijft weg.
- Standaard is een import een **controle**. Er wordt pas iets vastgelegd wanneer
  de planner het bevestigingsvinkje zet, en zelfs dan is het pakket nog niet in
  gebruik: bevestigen en activeren zijn twee aparte handelingen met een eigen
  auditregel.
- Versielabels: `DDR-DR2027-V1`, `-V2`, …
- SHA-256 over het bronbestand: "Dit bestand is eerder geïmporteerd als … op …".
- Verschil met de vorige versie per dienstnummer en per veld (erbij, eruit,
  gewijzigd, ongewijzigd).

### Importbeveiliging

`src/server/import/file-safety.ts`:

| Risico | Maatregel |
| --- | --- |
| Uitvoeren van het bestand | Alleen als tekst gelezen; geen `eval`, geen dynamische import, geen spreadsheetbibliotheek |
| Formule-injectie (`=cmd\|…`) | Cellen die met `= + - @ tab CR` beginnen worden **geweigerd** bij import en geneutraliseerd bij export |
| Pad- en bestandsnaamtrucs | `safeFilename()` houdt alleen de basisnaam over, zonder stuurtekens; de naam wordt nergens gebruikt om een pad mee te bouwen |
| Onverwacht bestandstype | Alleen `.csv` en `.txt` |
| Grootte | 5 MB |
| Nulbytes | Geweigerd |
| Dubbele records | Geweigerd, met dienstnummer |
| Verkeerde standplaats | Geweigerd |
| Middernacht | 23:00 → 07:00 wordt 8 uur, niet min 16; apart geteld en gemeld |

### Metingen

- `tests/import/dienstenpakket.test.ts` — 22 tests, waaronder middernacht,
  idempotentie, BOM/CRLF, formule-injectie, padtrucs en het verschil tussen
  versies.
- `npm run verify:import` — reconciliatie tegen de **echte** Dordrechtgegevens:
  22 diensten teruggeschreven naar het aanleverformaat en opnieuw ingelezen;
  geen enkel veld verandert onderweg, 6 nachtdiensten houden hun eindtijd
  voorbij middernacht, twee keer lezen geeft hetzelfde resultaat.

---

## 7. Lokale regellagen per standplaats

`src/server/rules-engine/validation/checks/location.ts`. Voor een standplaats
zonder aangeleverd lokaal kader is de uitkomst `LOCAL_RULESET_NOT_CONFIGURED`:
blokkerend, zichtbaar, en op te lossen door aanlevering.

Twee voor de hand liggende uitwegen zijn uitdrukkelijk **niet** genomen:

- *"Dan gelden alleen de CAO-regels"* — dat verklaart dat er geen lokale
  beperkingen zijn, en dat heeft niemand gezegd.
- *"Neem dan de regels van Dordrecht"* — dan rijdt Rotterdam op andermans
  afspraken zonder dat iemand het ziet.

`tests/rules/standplaats.test.ts` toetst dat een Rotterdamse plaatsing blokkeert,
dat de Dordrechtregel daar niet in de bevindingen voorkomt, en dat DDR de enige
ingerichte standplaats is.

---

## 8. Dienstverdeling na simulatie

`src/domain/duty-placement.ts` + `duty-coverage-service.ts` delen elke dienst uit
het actieve pakket in vier categorieën in, met uitleg per dienst en zonder
restcategorie. Zichtbaar op `/roostercommissie/analyse`.

Huidige stand voor Dordrecht: 22 diensten uit `DDR-DR2026-V1` — 16 in een vast
rooster, 6 in de reservevoorraad, 0 niet te plaatsen, 0 uitgesloten.

De telling begint bij het **dienstenpakket** en niet bij de optimizer. Een
optimizer die zijn eigen dekkingsrapport schrijft, rapporteert wat hij van plan
was; een dienst die hij nooit heeft overwogen, komt dan in geen enkele categorie
voor.

---

## 9. Export

`src/server/export/roster-document.ts` is de **enige** renderer; voorvertoning en
export gebruiken letterlijk dezelfde functie. Route:
`/roostercommissie/roosterblad/[code]`.

Het blad draagt een metagegevensblok: standplaats, rooster, profiel,
dienstregeling, periode, soort ronde, structuurstatus, dienstenpakket,
regelbestandversie en -modus, juridische status, opsteller (personeelsnummer,
geen naam) en tijdstip.

**De export liegt niet.** Zolang het regelbestand niet in productie draait én
geverifieerd is, staat `SIMULATIE — GEEN VASTGESTELD ROOSTER` op drie plaatsen:
in de kop, in de metagegevens en als watermerk over de pagina. De voettekst zegt
met zoveel woorden dat er geen rechten aan kunnen worden ontleend. Die bewering
komt uit de stand van het regelbestand en niet uit een instelling die iemand kan
omzetten.

`tests/export/roosterblad.test.ts` — 14 tests, waaronder het aantal
simulatiestempels, het wegvallen ervan zodra het rooster wél is vastgesteld, het
volledige raster, en dat inhoud uit de database wordt ge-escaped.

**Niet gedaan: een PDF-bibliotheek.** Het blad is printbare HTML met een
A4-liggend printprofiel; "opslaan als PDF" geeft dezelfde opmaak. Twee redenen:
de officiële NS-opmaak is niet aangeleverd, en een eigen PDF-opmaak zou alleen
maar overtuigender liegen over hoe officieel hij is. Dit is een openstaand punt,
geen vergissing.

---

## 10. Publicatiestatus — gebouwd, niet aangezet

`PERIOD_STATUS_ORDER`: CONCEPT → SIMULATION → RULE_VALIDATION_PENDING → REVIEWED
→ OR_APPROVAL_REQUIRED → APPROVED → PUBLISHED.

`advancePeriodStatus` laat alleen één stap vooruit toe (stappen overslaan slaat
een beoordeling over) en **weigert PUBLISHED** zolang het regelbestand niet in
productiemodus draait met geverifieerde status. De weigering komt in het
auditlog.

---

## 11. Wat er is gemeten

| Meting | Uitkomst |
| --- | --- |
| `npx tsc --noEmit` | schoon |
| `npx eslint src tests scripts` | schoon |
| `npm test` (vitest) | 262 tests, 20 bestanden, alles groen |
| `npm run build` | slaagt |
| `npm run verify:rules` | regelbestand structureel in orde; 2 van 71 regels gevalideerd; production-safe NO |
| `npm run verify:rooster` | 1678 dienstdagen; 0 bevestigde overtredingen; 599 unieke mogelijke; ongewijzigd t.o.v. de audit |
| `npm run verify:structuur` | 12/12 — baseline, ankervergrendeling, tweelagenreserve |
| `npm run verify:import` | reconciliatie op 22 echte diensten zonder verschil |
| `npm run verify:toegang` | 13 paden × 4 rollen zoals verwacht; standplaatsafbakening dicht |
| Browsercontrole | pakketten, analyse, roosterblad, medewerkerpagina's renderen; geen serverfouten |

---

## 12. Wat dit **niet** is

- **Geen NS-logo.** Het bestand ontbreekt; er is niets nagetekend.
- **Geen echte PDF-generator.** Printbare HTML met dezelfde opmaak.
- **Geen roosterperiode voor Dordrecht.** Die vergt echte
  dienstregelingdatums; er is er geen verzonnen. Het roosterblad zegt daarom
  "geen roosterperiode vastgelegd".
- **Geen reserverooster voor Dordrecht.** De regels staan klaar, de gegevens
  ontbreken.
- **Geen invulling van de planeenheden.** ASD 1/2, RTD 1/2 en UT 1/2 zijn
  geregistreerd; wat ze organisatorisch onderscheidt, staat niet in de bron.
- **Geen bijzondere regels voor Mix, 50+ Mix en BLM.** Die profielen bestaan nu
  in het model; hun aanvullende regels staan op `POLICY_PENDING` en houden elke
  plaatsing in die profielen onbeoordeelbaar.
- **Geen OCR** en geen productieoptimizer, conform de opdracht.

---

## 13. Wat er nodig is om verder te komen

1. Het NS-logobestand in `public/brand/`.
2. De officiële NS-roosterbladopmaak (dan pas is een PDF-generator zinvol).
3. De dienstregelingdatums voor de eerstvolgende Dordrechtronde.
4. Het lokale regelkader per standplaats die live moet.
5. De bijzondere regels voor Mix, 50+ Mix en BLM.
6. De betekenis van de planeenheden 1 en 2.
7. Het echte aanleverformaat van een dienstenpakket, als dat afwijkt van het
   puntkomma-formaat dat nu wordt gelezen.
