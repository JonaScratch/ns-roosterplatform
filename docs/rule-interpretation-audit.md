# Rule Interpretation Audit Report

Audit van de regelinterpretatie vóór fase J. Aanleiding: 933 dienstdagen werden
gemeld als harde overtreding. Een validator die streng maar onjuist is, is
gevaarlijker dan een die niets doet.

**Uitkomst: van die 933 is er nul bevestigd.** Niet omdat de berekeningen fout
zijn — twee onafhankelijke implementaties komen op de belangrijkste regel exact
hetzelfde uit — maar omdat geen enkele regel gevalideerd is, geen bron
aantoonbaar actueel, en de toepasselijkheidsbronnen ontbreken. Fase J is niet
gestart.

---

## 1. Wat er is veranderd, per regel

### 1.1 Geldigheidsperiode van de CAO

| | |
|---|---|
| **Oorspronkelijke implementatie** | `RuleSource.effectiveUntil = "2025-12-31"`. Na die datum leverde `resolveRule` `OUT_OF_PERIOD`, wat de regel blokkeerde (productie) of "buiten geldigheid toegepast" markeerde (simulatie). |
| **Probleem** | De datum 31-12-2025 komt in de bron niet voor. Zij was afgeleid uit de naam "CAO 2024–2025" en lag negen maanden náást de werkelijke contractuele einddatum. Erger dan de datum was het model: één veld `effectiveUntil` dwingt de keuze tussen "vervallen" en "onbeperkt geldig", terwijl de bron een derde toestand kent. |
| **Broninterpretatie (art. 3)** | Oorspronkelijke looptijd 1 januari 2024 tot 1 maart 2025. Behoudens opzegging telkens met één jaar verlengd. Eindigt de overeenkomst door opzegging, dan blijven de bepalingen gelden totdat een nieuwe in werking treedt. Er is dus geen datum waarop de bepalingen vanzelf vervallen. |
| **Nieuwe implementatie** | `RuleSource` bevat nu `effectiveFrom`, `contractualEnd`, `renewalRule`, `terminationKnown` en `supersededBy`. `currentLegalStatus(source, datum)` levert `NOT_YET_IN_FORCE`, `IN_ORIGINAL_TERM`, `CURRENT_LEGAL_STATUS_NOT_VERIFIED` of `SUPERSEDED`. De CAO staat op `contractualEnd: "2025-02-28"`, `TACIT_RENEWAL` van 12 maanden met nawerking, `terminationKnown: "UNKNOWN"`. Voor 2026 is de status `CURRENT_LEGAL_STATUS_NOT_VERIFIED`: in simulatiemodus wordt doorgerekend met vermelding van de bronstatus, in productiemodus blijft verificatie vereist en blokkeert de regel. Elke bevinding op zo'n regel krijgt een `SOURCE_STATUS`-punt en kan daardoor nooit bevestigd zijn. |
| **Grenstests** | Datum binnen de oorspronkelijke looptijd (2025-02-10) → geen onbevestigde bronstatus. Datum erna (2026-03-10) → regel toegepast, gemarkeerd, bevinding `POTENTIAL`. Productiemodus op dezelfde datum → `RULESET_INCOMPLETE` met `CAO_CURRENCY_CONFIRMATION` en de contractuele einddatum 2025-02-28 in de tekst. |
| **Regressie** | 36 van de 40 doorgerekende regels dragen nu `CURRENT_LEGAL_STATUS_NOT_VERIFIED`. Voorheen heette dat "toegepast buiten de geldigheidsperiode" — feitelijk onjuist. |

Alle zelfverzonnen einddatums zijn verwijderd; `effectiveUntil` bestaat niet meer
als veld.

### 1.2 RP_MAX_DUTY_START_0400_0501 en RP_MAX_DUTY_START_0500_0600

| | |
|---|---|
| **Oorspronkelijke implementatie** | Band 1: `[04:00, 05:01)`. Band 2: `[05:00, 06:00)`. |
| **Probleem** | De banden overlapten op 05:00. Elke dienst die om precies 05:00 begint viel onder beide bepalingen. De strengste won, dus de uitkomst was toevallig juist — maar elke uitspraak over de grens tussen 05:00 en 05:01 was onbetrouwbaar, en het vorige rapport noemde dit ten onrechte een bronambiguïteit. Het was een implementatiefout. |
| **Broninterpretatie** | "start >= 04:00 en < 05:01 → maximaal 7 uur" en "start > 05:00 en < 06:00 → maximaal 8,5 uur". Bij minuutprecisie sluiten die aan zonder overlap: 04:00 t/m 05:00 hoort bij de eerste band, 05:01 t/m 05:59 bij de tweede. |
| **Nieuwe implementatie** | `VERY_EARLY = [04:00, 05:01)` en `EARLY = [05:01, 06:00)` als benoemde constanten in `checks/metrics.ts`, met `startBandOf()` voor de uitleg. |
| **Grenstests** | 03:59, 04:00, 04:59, 05:00, 05:01, 05:59, 06:00, elk met een dienst van acht uur — te lang voor de eerste band, ruim binnen de tweede. Plus twee expliciete tests: 05:00 met negen uur dienstlengte laat alléén de 7-uursregel afgaan, 05:01 met negen uur alléén de 8,5-uursregel. Twaalf tests in `tests/rules-engine/startbanden.test.ts`. |
| **Regressie** | Ongewijzigd 234 unieke bevindingen. Dat de correctie het aantal niet verandert, is zelf een bevinding: de overlap zat niet in de uitkomst maar in de redenering. |

**Precisie van de brondata.** `Duty.startMinute` en `Duty.endMinute` zijn gehele
minuten. Er wordt nergens een seconde weggerond, want er zijn geen seconden.
Zou een bronsysteem ooit seconden aanleveren, dan is de vraag hoe die zich tot
"vóór 05:01" verhouden een bron- en beleidsvraag; er is bewust geen stille
afronding ingebouwd. Vastgelegd als test.

### 1.3 RED_WEEKEND_MIN_REST

| | |
|---|---|
| **Oorspronkelijke implementatie** | Per zaterdag: is er een dienst in het venster? Zo nee, hoe lang is de rust eromheen? Bron opgegeven als art. 119. Eén bevinding per beoordeelde roosterdag. Geen uitleg over wélke eis faalde. |
| **Probleem** | Vier dingen. (a) Verkeerd artikel. (b) De twee eisen — 60 uur én het venster zaterdag 00:00 t/m maandag 04:00 omvatten — waren niet als twee eisen zichtbaar, waardoor een bevinding niet uitlegde wat er misging. (c) De toepasselijkheidsvragen (individuele vrijwillige afwijking, collectieve OR-afwijking, Bijlage IV) werden niet gesteld, waardoor een berekening als bewijs werd gepresenteerd. (d) 698 bevindingen voor een veel kleiner aantal werkelijke feiten. |
| **Broninterpretatie (art. 102 lid 3)** | Eenmaal per drie weken een aaneengesloten rustperiode van minimaal 60 uur die de periode zaterdag 00:00 tot en met maandag 04:00 omvat. Twee eisen aan één en dezelfde rustperiode. Niets over gewerkte zaterdagen of zondagen. |
| **Nieuwe implementatie** | `assessWeekend()` rekent uitsluitend op tijdstempels: het vereiste venster als instants, de rustintervallen tussen diensten in werkelijk verstreken tijd. Per weekend worden `requiredRestWindow`, `actualContinuousRest`, `actualRestWindow`, `Saturday00Included`, `Monday04Included`, `meetsMinimumRest`, `qualifies` en `undetermined` vastgelegd; die velden staan letterlijk in elke bevinding, samen met `threeWeekWindowStart/End`, `waiverPresent` en `source`. Onvoldoende gegevens leveren `undetermined` op — niet "geen vrij weekend". |
| **Grenstests** | Tien tests in `tests/rules-engine/rood-weekend.test.ts`, waaronder de drie die de twee eisen scheiden: een dienstvrij weekend met 55 u 30 rust (venster wél omvat, lengte niet), een rust van ruim 78 uur die maandag 02:00 wordt afgekapt (lengte wél, venster niet), en een weekend dat beide haalt. Plus: onbekend bij ontbrekende gegevens, en de ontdubbeling. |
| **Regressie** | 133 unieke reeksen van drie weekenden, over 30 medewerkers, uit 1375 ruwe bevindingen. Alle 133 zijn `POTENTIAL`. |

### 1.4 RP_MAX_EARLY_STARTS_0500_0600_PER_4W

| | |
|---|---|
| **Probleem** | De teller gebruikte `[05:00, 06:00)`, dezelfde grens als de foutieve band uit 1.2. Anders dan bij de dienstlengteregels zegt de bron hier alleen "tussen 05:00 en 06:00", zonder "vóór" of "ná". |
| **Broninterpretatie** | Onbeslist. Of een start om precies 05:00 meetelt, staat er niet. |
| **Nieuwe implementatie** | Er wordt geteld met de ruimste lezing (05:00 telt mee), omdat die de bescherming niet verzwakt. Elke bevinding draagt een `APPLICABILITY`-punt dat de bandgrens als openstaande bronvraag benoemt. |
| **Regressie** | 208 unieke bevindingen, ongewijzigd. |

---

## 2. Herclassificatie

De uitkomsten heten nu:

| | Uitkomst | Betekenis |
|---|---|---|
| 🟢 | `VALID_WITHIN_VALIDATED_RULESET` | Alles wat voor deze beslissing aanwezig én gevalideerd is, klopt |
| 🟡 | `VALID_WITH_WARNINGS` | Idem, met zachte signalen |
| 🟠 | `CONTEXT_INCOMPLETE` | Onvoldoende roosterhistorie |
| ⚫ | `RULESET_INCOMPLETE` | Vereiste regel of parameter ontbreekt |
| 🟤 | `POTENTIAL_HARD_VIOLATION` | Berekening wijst op overschrijding; bron of toepasselijkheid onbevestigd |
| 🔴 | `CONFIRMED_HARD_VIOLATION` | Bron en toepasselijkheid volledig bewezen |

Een bevinding is pas `CONFIRMED` wanneer alle drie kloppen: de regel heeft status
`VALIDATED`, de bron is `IN_ORIGINAL_TERM`, en de controle heeft geen
toepasselijkheidsvraag opengelaten. Dat oordeel wordt centraal in `violate()`
geveld en niet per controle — één vergeten vlag kan een bewering dus niet te
sterk maken.

Elke `POTENTIAL`-bevinding draagt de lijst met wat er ontbreekt: precies het
lijstje dat iemand moet afwerken om haar bevestigd te krijgen.

---

## 3. Geen dubbele telling

Elke bevinding draagt een `occurrenceKey` die het onderliggende feit benoemt —
een reeks weekenden, een venster van vier weken, een rustinterval, een plaatsing
— en niet de dag waarop de validatie toevallig plaatsvond.

| Maat | Waarde | Betekenis |
|---|---|---|
| `rawRuleEvaluations` | 1888 | bevindingen tijdens het toetsen |
| `uniqueViolations` | 599 | onderliggende feiten |
| `affectedAssignments` | 1139 | (medewerker, dag) met ten minste één bevinding |
| `affectedEmployees` | 30 | betrokken medewerkers |
| `affectedWindows` | 357 | feiten die een periode betreffen |

Bij het rode weekend is het verschil het grootst: 1375 ruwe bevindingen voor 133
werkelijke feiten. Dashboard en rapport tonen `uniqueViolations`.

---

## 4. Handmatige verificatie van de steekproef

Voor `RED_WEEKEND_MIN_REST` is een tweede, onafhankelijke implementatie
geschreven (`scripts/audit-rood-weekend.ts`). Die leest de roosterrijen
rechtstreeks uit de database en beantwoordt de twee vragen van art. 102 lid 3
met een eigen, opzettelijk simpele berekening — geen gedeelde code met de engine
behalve de tijdzoneprimitieve.

```
Beoordeelde reeksen van drie weekenden   294
  met ten minste één voldoend weekend    161
  zonder enig voldoend weekend           133
    waarvan zonder dienst in de reeks      0

Vergelijking met de engine:
  reeksen gemeld door de engine          133
  reeksen gemeld door deze natelling     133
  in beide                               133
  alleen door de natelling                 0
  alleen door de engine                    0
```

De eerste twintig gevallen zijn uitgeschreven met per weekend de reden. Ze
hebben alle dezelfde vorm; het eerste, medewerker 100001:

```
weekenden 2026-08-29, 2026-09-05, 2026-09-12
  2026-08-29  dienst in het venster: 2026-08-29 044  → geen rood weekend
  2026-09-05  dienst in het venster: 2026-09-05 045, 2026-09-06 046
  2026-09-12  dienst in het venster: 2026-09-12 046  → geen rood weekend
```

Deze gevallen berusten niet op een subtiele rustberekening: in alle drie de
weekenden staat een dienst ín het vereiste venster. Dat is met de hand na te
gaan op het roosterblad. De rekenkundige bewering klopt dus. Of het ook een
overtreding ís, hangt af van de individuele vrijwillige afwijking, de collectieve
OR-afwijking en Bijlage IV — geen van die drie bronnen is aangeleverd, en daarom
blijft de classificatie `POTENTIAL`.

### 4.1 Wat die vergelijking aan het licht bracht

De twee implementaties kwamen aanvankelijk **niet** op hetzelfde uit: 116 tegen
133. Het verschil zat volledig in de eerste vier roosterweken. De engine eiste
vóór deze regel een contextvenster van vier weken historie en sloeg de hele
toets over zodra die er niet was — ook voor reeksen die vóór de beoordeelde dag
uit liggen en helemaal geen historie nodig hebben.

Dat is nu precies gemaakt: de dekking wordt vastgelegd maar poort niet meer, en
`assessWeekend` bepaalt per weekend of er genoeg gegevens zijn. Viel er over geen
enkele reeks iets te zeggen, dan wordt dát als hiaat gemeld. Na de correctie
komen beide implementaties op 133 uit, zonder verschil in beide richtingen.

Zonder de onafhankelijke natelling was deze 13% blinde vlek onzichtbaar
gebleven: de engine meldde niets, en niets is precies hoe een overgeslagen toets
eruitziet.

---

## 5. Contracturen

De eerdere seed vulde 32 of 36 uur naar een willekeurig patroon. Dat was
verzonnen. De Dordrechtse basisroosters zijn aangeleverd als 40-uursroosters; die
omvang is nu overgenomen in seed en bestaande database, met een expliciete
opmerking dat contractomvang nooit uit gemiddeld werkelijk gewerkte uren mag
worden afgeleid — dan verheft een te vol rooster zichzelf tot norm.

---

## 6. Contextdekking

Per regel en venster wordt nu vastgelegd wat er nodig was en wat er was, óók
wanneer het venster wel volledig was.

| Regel | Venster | Nodig | Dekking | Bewijsbaar op |
|---|---|---|---|---|
| `RP_MAX_LONG_DUTIES_PER_YEAR` | CALENDAR_YEAR | 366+366d | 12% | 0 / 2 dienstdagen |
| `MIN_FREE_SUNDAYS_52W` | WEEKS_52 | 364+0d | 2–25% | 0 / 120 |
| `MAX_NIGHT_SERVICES_16W` | WEEKS_16 | 112+0d | 0–79% | 0 / 175 |
| `AVG_WEEKLY_HOURS_16W` | WEEKS_16 | 112+0d | 0–80% | 0 / 1678 |
| `AVG_WEEKLY_HOURS_4W` | WEEKS_4 | 28+0d | 0–100% | 1162 / 1678 |
| `DAY_AVAILABLE` | ADJACENT_DUTIES | 3+3d | 50–100% | 1561 / 1678 |
| `MAX_CONSECUTIVE_SERVICES` | DAYS_14 | 14+14d | 50–100% | 1162 / 1678 |

De database bevat 91 dagen. Een 52-wekenregel kan daarmee op geen enkele
dienstdag een bevestigde uitkomst opleveren — ook geen bevestigd "geldig". Dat
is nu af te lezen in plaats van af te leiden.

---

## 7. Regressie: oud versus nieuw

| | Vóór de audit | Na de audit |
|---|---|---|
| Bevestigde overtredingen | — (933 heetten "harde overtreding") | **0** |
| Mogelijke overtredingen (dienstdagen) | — | 1139 (68%) |
| Unieke feiten | niet geteld | 599 |
| Onvoldoende roosterhistorie | 345 (21%) | 221 (13%) |
| Regelbestand onvolledig | 400 (24%) | 318 (19%) |
| `RED_WEEKEND_MIN_REST` ruw | 698 | 1375 |
| `RED_WEEKEND_MIN_REST` uniek | niet geteld | 133 |
| Doorgerekende regels | 40 | 40 |
| Tests | 133 | 157 |

Het aantal geraakte dienstdagen steeg van 933 naar 1139 doordat de
rood-weekendtoets nu ook de eerste vier roosterweken beoordeelt (§4.1). Het
aantal `CONTEXT_INCOMPLETE`- en `RULESET_INCOMPLETE`-dagen daalde navenant: die
dagen hadden al een bevinding, maar de zwaarste uitkomst bepaalt de
classificatie.

De belangrijkste verandering staat in de eerste regel van de tabel. Er is geen
enkele bevestigde overtreding, en dat blijft zo tot NS regels valideert en de
ontbrekende bronnen aanlevert.

---

## 8. Defecten gevonden tijdens deze audit

1. **Verzonnen contractuele einddatum.** `2025-12-31` kwam niet uit de bron en
   lag negen maanden naast de werkelijke datum. Het achterliggende model kende
   bovendien geen toestand voor "loopt door, actualiteit niet vastgesteld".
2. **Overlappende startbanden.** 05:00 viel in beide bepalingen. Het vorige
   rapport presenteerde dit als een openstaande bronvraag; het was een fout in
   de code.
3. **Rood weekend zonder toepasselijkheidstoets.** Een berekening werd als
   overtreding gepresenteerd terwijl drie afwijkingsbronnen niet zijn
   aangesloten.
4. **Rood weekend overgeslagen in de eerste vier roosterweken.** Gevonden door
   het verschil met een onafhankelijke natelling (116 tegen 133).
5. **Hoogstens één weekendreeks per dag gemeld.** Een dag kan in meer dan één
   reeks van drie weekenden vallen; alleen de eerste werd gerapporteerd.
6. **Verzonnen contracturen** (32/36) in plaats van de aangeleverde 40.
7. **Verkeerd artikelnummer** bij het rode weekend: 119 in plaats van 102 lid 3.

---

## 9. Verificatie

| Controle | Uitkomst |
|---|---|
| `npx eslint` | 0 problemen |
| `npx tsc --noEmit` | 0 fouten |
| `npx vitest run` | 157 tests, 11 bestanden, alles groen |
| `npm run build` | geslaagd |
| `npm run verify:rules` | regelbestand structureel in orde |
| `npm run verify:rooster` | 1678 dienstdagen, zie §7 |
| `scripts/audit-rood-weekend.ts` | twee implementaties, 133 = 133, geen verschil |

---

## 10. Fase J

Niet gestart, en niet te starten voordat dit is afgewerkt:

1. NS valideert de regels die de regressie raakt — minimaal `RED_WEEKEND_MIN_REST`,
   `RP_MAX_DUTY_START_0400_0501`, `RP_MAX_EARLY_STARTS_0500_0600_PER_4W`,
   `WEEKLY_REST_36H_PER_7D`.
2. Bevestiging welke CAO actueel is (opzegging, opvolger).
3. Bronnen voor individuele en collectieve afwijkingen van het rode weekend,
   plus Bijlage IV.
4. De bandgrens van de vroege-startenteller op 05:00.
5. Roosterhistorie van ten minste 52 weken, zodat de lange vensters bewijsbaar
   worden.

Zolang `CONFIRMED_HARD_VIOLATION` nul is omdat er niets te bevestigen valt,
zou een optimizer duizenden kandidaten toetsen aan regels waarvan niemand heeft
vastgesteld dat ze juist zijn. Dat maakt de fout alleen sneller en
systematischer.

**Production-safe: NO — simulation/development only**
