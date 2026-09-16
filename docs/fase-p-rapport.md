# FASE P — FINAL FUNCTIONAL COMPLETION REPORT

**Standplaats:** Dordrecht (DDR)
**Datum:** 6 september 2026
**Regelbestand:** `2026.1-cao-2024-2025-transcribed`
**Production-safe:** **NO**

Alle getallen hieronder komen uit metingen die zijn gedraaid op de echte
Dordrechtse gegevens. Waar een bron ontbreekt, staat dat er — niet als
afgerond, en niet weggelaten.

---

## A. Roosteruren Dordrecht

Per rooster, over de volledige cyclus. Gemeten met `npm run verify:roster-hours`,
en met een tweede, onafhankelijke berekening rechtstreeks uit het aangeleverde
roosterblad ernaast gelegd.

| Rooster | Regels | Cyclusweken | Werkuren | WTV-dagen | WTV-uren | RES/WR/CO-uren | R-dagen | Rusturen | Totaal credit | Gem./week | Afwijking van 40:00 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| DDR-50MIX | 6 | 6 | 151:11 | 3 | 24:00 | 64:00 | 12 | 856:49 | 239:11 | 39:51 | −0:09 |
| DDR-BLM | 6 | 6 | 203:12 | 3 | 24:00 | 8:00 | 12 | 804:48 | 235:12 | 39:12 | −0:48 |
| DDR-L | 12 | 12 | 295:51 | 6 | 48:00 | 136:00 | 24 | 1720:09 | 479:51 | 39:59 | −0:01 |
| DDR-LN | 6 | 6 | 175:55 | 3 | 24:00 | 40:00 | 12 | 832:05 | 239:55 | 39:59 | −0:01 |
| DDR-MIX | 12 | 12 | 350:22 | 6 | 48:00 | 80:00 | 24 | 1665:38 | 478:22 | 39:51 | −0:09 |
| DDR-V | 12 | 12 | 324:59 | 6 | 48:00 | 104:00 | 24 | 1691:01 | 476:59 | 39:44 | −0:16 |
| DDR-VL | 10 | 10 | 271:14 | 5 | 40:00 | 88:00 | 20 | 1408:46 | 399:14 | 39:55 | −0:05 |

**Er staat hier met opzet geen gecombineerd gemiddelde.** Zeven roosters van
39:12 tot 39:59 leveren samen keurig 39:50 op, en dat getal verbergt precies de
enige afwijking die opvalt (DDR-BLM). De 40-uursnorm geldt per roosterprofiel,
en zo is hij hier ook gemeten.

**Hoe de uren zijn opgebouwd.** Werkuren zijn eind min begin per dienstinstantie;
voor alle 223 instanties is nagerekend dat die som klopt met de duur op het blad
(0 afwijkingen). WTV telt voor 8:00 per dag. RES, WR en CO tellen eveneens voor
8:00 — niet omdat dat een aanname is, maar omdat het aangeleverde blad die dagen
zelf als `08:00` afdrukt. R telt voor 0:00; het blad drukt daar niets af. De som
per rooster komt op de minuut overeen met de weeklengte die het blad zélf noemt.

---

## B. 40-uursbalans

| Rooster | Gem./week | Afwijking | Oordeel |
| --- | ---: | ---: | --- |
| DDR-L | 39:59 | −0:01 | PASS |
| DDR-LN | 39:59 | −0:01 | PASS |
| DDR-VL | 39:55 | −0:05 | PASS |
| DDR-50MIX | 39:51 | −0:09 | PASS |
| DDR-MIX | 39:51 | −0:09 | PASS |
| DDR-V | 39:44 | −0:16 | PASS |
| DDR-BLM | 39:12 | −0:48 | ATTENTION |

**Wat "PASS" hier betekent en niet betekent.** Er is geen aangeleverde bron die
zegt hoeveel afwijking van 40:00 aanvaardbaar is. PASS betekent dus: het
gemeten gemiddelde komt overeen met wat het aangeleverde blad zelf noemt, en de
afwijking blijft onder een uur per week. Het betekent niet dat NS deze
afwijking heeft goedgekeurd.

**DDR-BLM.** Dit rooster komt 48 minuten per week onder de 40:00 uit, ruim
vier keer zoveel als het eerstvolgende rooster. De oorzaak is zichtbaar in de
opbouw: DDR-BLM heeft 203:12 werkuren tegenover 151:11 bij DDR-50MIX, maar
slechts 8:00 aan RES/WR/CO tegenover 64:00. Er staat dus veel meer echt werk in
en veel minder gecrediteerde niet-dienst. Of dat klopt, is een vraag aan de
Rooster Commissie en niet aan dit platform: het blad zelf noemt 39:12, en die
39:12 is exact wat hier is teruggerekend.

---

## C. CAO-dagen

Gemeten met `npm run verify:cao-dagen`: **43 controles geslaagd, 0 mislukt,
0 geblokkeerd**. Elke controle maakt echte aanvragen aan tegen de echte database
en draait ze aan het eind terug.

| Eis | Uitkomst | Bewijs |
| --- | --- | --- |
| Termijn van 42 kalenderdagen | PASS | Dag 41 geweigerd, dag 42 aangenomen, via een rechtstreekse serviceaanroep zonder formulier |
| Geen twee opeenvolgende dagen | PASS | Maandag aangevraagd → dinsdag geweigerd; dinsdag aangevraagd → maandag geweigerd; met een dag ertussen wél toegestaan |
| Jaargrens 31 december / 1 januari | PASS | Beide richtingen geweigerd, en om de juiste reden (aaneengesloten, niet iets anders); 30 december wél toegestaan |
| Tegoed van 2 dagen | PASS | Derde aanvraag geweigerd, met de melding over het tegoed |
| Servervalidatie | PASS | Alle bovenstaande weigeringen komen uit de service, niet uit het scherm; het scherm gebruikt dezelfde functie om vakjes grijs te maken |
| Melding aan de dienstindeling | PASS | Gebeurtenis in dezelfde transactie in de outbox; de dienstindeling van déze standplaats krijgt bericht |
| Verwerken in het verlofboek | PASS | Status naar `REGISTERED_IN_LEAVE_BOOK`, wie het deed vastgelegd, medewerker krijgt precies één melding |
| Gelijktijdigheid | PASS | Twee gelijktijdige aanvragen voor aansluitende dagen: hoogstens één slaagt, één rij in de database. Bewezen met een grendel die van buitenaf wordt vastgehouden |
| Duurzaamheid | PASS | De aanvraag is meteen leesbaar over een tweede verbinding; succes verschijnt pas na de commit |

**Twee dingen die het meten aan het licht bracht.**

De eerste: de tegoedcontrole las de database *buiten* de transactie. Twee
gelijktijdige aanvragen konden daardoor allebei "nog één over" zien. Dat is
gesloten met een grendel per medewerker plus een hertoetsing binnen de
transactie.

De tweede: een uitkomstmeting die twee aanvragen tegelijk afvuurt en de
overlevenden telt, bewijst de grendel *niet*. Met de grendel eruit bleef die
meting drie keer op rij groen, omdat de twee aanroepen in de praktijk toch
achter elkaar liepen. De meting die het wél aantoont, houdt de grendel van
buitenaf vast en stelt vast dat de aanvraag wacht.

**Wat niet is bevestigd.** Het aantal van twee CAO-dagen komt uit de
productopdracht en niet uit een aangeleverd CAO-artikel. Dat staat als zodanig
in de code (`CAO_DAY_ALLOWANCE_SOURCE = PRODUCT_POLICY_NOT_SOURCE_CONFIRMED`)
en op het scherm bij de medewerker.

---

## D. Dienstenpakket-import

Gemeten met `npm run verify:pakketimport`: **16 controles geslaagd, 0 mislukt,
2 geblokkeerd**.

| Onderdeel | Uitkomst | Toelichting |
| --- | --- | --- |
| Excel-sjabloon downloaden | PASS | Gevuld met de diensten die er nu zijn; blad `Diensten` plus blad `Toelichting`; 46 dienstnummers in 46 rijen |
| Excel-sjabloon uploaden | PASS | Volledige straat: bestandscontrole → lezen → voorvertoning → validatie → verschil met de vorige versie → bevestiging → vastleggen |
| Vriendelijke celsyntaxis | PASS | `1 = 4:27-11:07` en dertien andere schrijfwijzen die hetzelfde betekenen; wat twee betekenissen kan hebben wordt gemeld en niet geraden |
| 223 diensten heen en terug | PASS | Alle 223 instanties komen terug op dezelfde weekdag met dezelfde tijden; 0 afwijkingen, 0 weggevallen |
| Weekdagafhankelijke tijden | PASS | 39 dienstnummers hebben per weekdag eigen tijden en houden die |
| Diensten over middernacht | PASS | 55 instanties lopen over middernacht en blijven dat |
| PDF-route | PARTIAL | Gebouwd en getoetst op weigeringen (geen tekstlaag, geen PDF, niets gevonden). Op een écht PDF-dienstenpakket niet gemeten: **BLOCKED_BY_MISSING_SOURCE** |
| DOC/DOCX-route | NOT BUILT | Niet gebouwd. Er is geen aangeleverd dienstenpakket in dat formaat, en een parser voor een formaat dat niemand heeft aangeleverd is een gok |
| Staging | PASS | Een levering komt binnen als `VALIDATED` of `REVIEW_REQUIRED`; nooit rechtstreeks `ACTIVE` |
| Reconcile | PASS | Verschil met de vorige versie wordt berekend en getoond: erbij, eruit, gewijzigd |
| Activeren | PASS | Aparte handeling op een pakket dat al is vastgelegd; drie bewuste stappen voor één levering |
| Beveiliging | PASS | Macro-onderdelen geweigerd, formules niet uitgevoerd maar gemeld, hernoemde PDF herkend aan de eerste bytes, SHA-256 per bestand |

**Blokkades, eerlijk gemeld:**

- **BLOCKED_BY_MISSING_SOURCE** — er is geen PDF-dienstenpakket aangeleverd. De
  route is gebouwd en weigert wat zij niet kan lezen, maar of zij een echt NS-
  document goed leest, is niet gemeten. Zet `VERIFY_PAKKET_PDF` op zo'n document
  en de meting draait vanzelf.
- **BLOCKED_BY_MISSING_DATA** — in de Dordrechtse gegevens staat geen
  dienstnummer met een voorloopnul. Dat de import die behoudt, is wel in de
  unittests vastgelegd, maar niet op de echte bron.

**Waarom Excel-lezen en -schrijven zonder bibliotheek is gebouwd.** Een xlsx is
een zip met XML erin. Een spreadsheetbibliotheek brengt daarnaast een uitvoerder
mee voor formules, macro's en gekoppelde werkmappen — precies wat hier niet mag
gebeuren. De geschreven werkmap is met de zip-lezer van .NET geopend om vast te
stellen dat hij geldig is en niet alleen door de eigen lezer wordt begrepen.

---

## E. RC-gebruikservaring

| Eis | Uitkomst | Toelichting |
| --- | --- | --- |
| Alle roosters zichtbaar | PASS | De profielenpagina toont alle zeven Dordrechtse roosters |
| Alle feedbackkaarten zichtbaar | PASS | Elk rooster krijgt een kaart, ook zonder respons: "Onvoldoende respons" of "Geen respons" in plaats van weglaten. De privacygrens blijft: onder de drempel geen cijfers, ook het aantal niet |
| Regels vereenvoudigd | PASS | Zes onderwerpcategorieën; technische code achter "Technische gegevens"; badge "Overgenomen uit bron" weg; "Bron laat meerdere lezingen toe" vervangen door **LET OP** met uitleg in gewone taal |
| Bronmetadata behouden | PASS | Niets verwijderd. Beheer heeft een eigen scherm `/beheer/regelbronnen` met laag, bronstatus (ook de ruwe waarde), artikel en wie bevestigde |
| Simulatiestatus compact | PASS | Eén statusregel bovenaan in plaats van een banner bij elke regel |
| Roosterjaarselector | PASS | Alleen een jaartal; de periode wordt berekend en getoond. Geen vrije datumvelden meer |
| Roosteruren zichtbaar | PASS | Roosteruren en gemiddelde per week per rooster op de profielenpagina, gekleurd naar afwijking |

**Verwijderd omdat het niets toevoegde:** de aparte waarschuwingen over de
diensten 760 en 761. Die zijn nu gewoon nachtdiensten; wat telt is het uur en
niet het nummer. Er staat nergens meer een `if dutyNumber === 760`.

---

## F. Regels

Gemeten met `npm run verify:rule-coverage`.

| Maat | Aantal |
| --- | ---: |
| Regels in het regelbestand | 71 |
| Waarvan hard | 66 |
| Harde regels die kunnen afgaan | 62 |
| Harde regels die blokkeren (geen bruikbare waarde) | 4 |
| Regels die in de tóépassende code voorkomen | 57 van 71 |
| Positief én negatief op gedrag getoetst | 41 |
| Gedekt via de regel die zij voeden (parameters en varianten) | 11 |
| Blokkade getoetst | 1 |
| **Harde regels zonder gedragstoets** | **0** |
| Formeel gevalideerd door NS | 0 van 71 |

**Wat het meten van de dekking zelf aan het licht bracht.** De vorige meting
telde een regel als geïmplementeerd zodra zijn naam ergens in de map
`rules-engine` voorkwam — inclusief het regelbestand zelf. Daardoor stond er
"71 van de 71 geïmplementeerd", en dat was onzin: er staan per definitie 71
regelnamen in het regelbestand. Sinds de meting alleen naar de toepassende code
kijkt, kwamen er **14 regels boven die nergens worden toegepast**.

**IMPLEMENTATION_GAP — wel in het regelbestand, niet in de code:**

| Regel | Soort | Waarom nog niet gebouwd |
| --- | --- | --- |
| `RT_PREFERRED_WINDOW_WEEKS` | hard | Gaat over het verlenen van een rustdag terug; er is geen verlofmodule |
| `HOLIDAY_ATTACHED_MIN` | hard | Feestdagen; er is geen feestdagenkalender aangeleverd |
| `HOLIDAY_DETACHED_MIN` | hard | Idem |
| `RO_DVP_DETACHED_MIN` | hard | RO- en DvP-dagen; die aanspraken worden nergens bijgehouden |
| `RO_DVP_COMBINED_MIN` | hard | Idem |
| `PARTTIME_DASH_DAY_MIN` | hard | Streepjesdagen voor deeltijders; niet in het gegevensmodel |
| `WTV_DAY_LATEST_START` | hard | WTV-verlening is geen handeling in dit platform |
| `WITHDRAWN_WTV_GRANT_WITHIN_DAYS` | hard | Idem |
| `WTV_DAYS_PER_YEAR_36H` | zacht | Idem |
| `DORDRECHT_ROSTER_LINE_DIVISOR` | hard | Gaat over roosterstructuur; wordt bij het genereren niet afgedwongen |
| `REGIO_WEST_WEEKEND_TARGET` | doel | Optimalisatiedoel; de optimizer weegt hem niet mee |
| `REGIO_WEST_WTV_INTERVAL_WEEKS` | zacht | Idem |
| `NEW_DRIVER_PROTECTION_YEARS` | zacht | Er is geen bron voor de indiensttredingsdatum |
| `PLAN_ROSTER_OVERFLOW_LIMIT` | zacht | Bron laat meerdere lezingen toe; blokkeert daarom sowieso |

Twee regels zijn in deze fase alsnog **wel** gebouwd omdat hun waarde er is en
zij over de beoordeelde dienst zelf gaan: `BREAK_OVER_5H30` (30 minuten pauze
boven 5,5 uur arbeidstijd) en `BREAK_OVER_10H` (45 minuten boven 10 uur).
Beide zijn nu in twee richtingen getoetst.

**ATW en ATB.** Niet aangeleverd. Er is niets verzonnen, niets afgeleid en
niets "voor de zekerheid" ingevuld. Tien regelpakketten ontbreken, en elke
beslissing die er een nodig heeft, wordt geblokkeerd. Daarom blijft
production-safe NO.

**SOURCE_REFERENCE_REVIEW_REQUIRED — `WEEKLY_REST_72H_PER_14D`.**
De inhoud is teruggevonden in de aangeleverde CAO: op bladzijde 31 staat
letterlijk "72 uur in een periode van 14 x 24 uur", met de splitsing in perioden
van minimaal 32 uur en de verkorting op initiatief van de roostercommissie, eens
per vijf weken. Het artikelnummer (100) is **niet** te bevestigen: de CAO nummert
deze bepalingen als "Lid" binnen een tabel, en bij het uitlezen leveren 100 en
101 dezelfde tekst op. Het nummer is niet gecorrigeerd — dat zou een gok zijn —
maar gemarkeerd als te controleren door NS. De markering staat in het
regelbestand en verschijnt op het scherm.

---

## G. Afgewezen optimizerscenario's uit Fase O

Vijf scenario's, alle vijf REJECTED. Gemeten met `npm run measure:optimizer`.
Sinds deze fase drukt die meting ook de redenen af, zodat er geen afwijzing
zonder uitleg overblijft.

| Scenario | Bevestigd hard | Mogelijk | Regels ontbreken | Historie ontbreekt | Ongetoetst | Beoordeeld |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A — beste totale balans | 0 | 944 | 2194 | 1210 | 2 | 2194 |
| B — beste rustkwaliteit | 0 | 610 | 2178 | 1212 | 2 | 2188 |
| C — eerlijkste lastenverdeling | 0 | 750 | 2138 | 1182 | 5 | 2150 |
| D — minste verschil met nu | 0 | 110 | 2164 | 1192 | 3 | 2176 |
| E — maximale plaatsing | 0 | 1138 | 2196 | 1222 | 0 | 2206 |

**Verklaring per oorzaak. Er blijft geen afwijzing onverklaard.**

| Oorzaak | Scenario's | Classificatie | Toelichting |
| --- | --- | --- | --- |
| Regelbestand heeft status `LEGAL_RULESET_NOT_CURRENTLY_VERIFIED` | A t/m E | `SOURCE_CONTEXT_MISSING` | De aangeleverde CAO heet 2024–2025 en is niet bevestigd als actueel. Zolang dat zo is, is publicatie uitgesloten — ongeacht de inhoud van de kandidaat |
| Tien regelpakketten ontbreken, waaronder ATW en ATB | A t/m E | `SOURCE_CONTEXT_MISSING` | Niet aangeleverd. Elke toewijzing die zo'n pakket nodig heeft, kan niet worden beoordeeld |
| 2138–2196 toewijzingen niet te beoordelen: regel of parameter ontbreekt | A t/m E | `SOURCE_CONTEXT_MISSING` | Dit is bijna elke dienstdag. Het gevolg van de vorige twee regels, niet een aparte fout |
| 110–1138 berekende overschrijdingen waarvan bron of toepasselijkheid niet vaststaat | A t/m E | `RULE_INTERPRETATION_PENDING` | De engine kán ze berekenen maar niet vaststellen of ze van toepassing zijn. Ze blokkeren en gelden uitdrukkelijk niet als bewijs |
| 1182–1222 toewijzingen misten de vereiste roosterhistorie | A t/m E | `HISTORICAL_SOURCE_ROSTER` | Vensters van 16 en 52 weken reiken terug tot vóór het begin van de geseede periode. Geen fout: er ís geen historie van vóór de bron |
| 3–5 toewijzingen met een onmogelijke cyclusdag of een dienstdag zonder dienstnummer | C, D | `IMPLEMENTATION_DEFECT` | Bijvoorbeeld `DDR-L/lijn 9/week 1/dag 7` en `DDR-LN/lijn 2/week 1/dag 7`: de kandidaat zet daar een dienstdag neer zonder dienstnummer. Dat hoort niet te kunnen en is een defect in de generatie, geen brongebrek |
| **`REAL_HARD_VIOLATION`** | geen | — | **In geen enkel scenario is één bevestigde harde overtreding gevonden.** De afwijzingen komen zonder uitzondering doordat er niet genoeg is om op te oordelen, niet doordat er iets fout is |

**Openstaand defect:** de dienstdagen zonder dienstnummer in scenario C en D.
Drie tot vijf van ruim tweeduizend, maar het is een echte fout en staat in
sectie L.

---

## H. Crashbestendigheid

Gemeten met `npm run verify:crash-recovery`: **19 controles geslaagd, 0 mislukt**.
Er worden hier echte processen hard gedood — de client midden in een transactie,
en de database zelf zonder waarschuwing.

| Eis | Uitkomst | Bewijs |
| --- | --- | --- |
| Bevestigde wijziging overleeft | PASS | Proces schrijft, bevestigt, wordt met `taskkill /F` gedood; de rij staat er nog |
| Halve transactie draait terug | PASS | Proces schrijft binnen een transactie, wordt gedood vóór de commit; er staat niets |
| Uitgaande wachtrij hervat | PASS | Gebeurtenis blijft op `PENDING` staan en wordt bij de volgende verwerking alsnog een melding |
| Import blijft consistent | PASS | Afgebroken import laat geen half pakket en geen losse dienst achter; een bevestigd pakket blijft in zijn eigen fase en wordt niet vanzelf actief |
| Draagbare database na vuile stop | PASS | Postmaster hard gedood met openstaande buffers; bij de herstart herstelt PostgreSQL zichzelf uit het transactielogboek (staat zo in het serverlog) en staat de bevestigde wijziging er nog |
| Duurzaamheidsinstellingen | PASS | `fsync=on`, `full_page_writes=on`, `synchronous_commit=on` — gecontroleerd op zowel de ontwikkel- als de draagbare database |

**Wat hiermee niet is aangetoond.** Dat een defecte schijf geen gegevens kan
kwijtraken. Dat kan geen enkele software garanderen, en dit rapport doet niet
alsof. Wat is aangetoond: wat bevestigd is, overleeft een harde stop, en de
instellingen waar die belofte op rust staan werkelijk aan.

**De keten die elke bevestigde mutatie doorloopt** — autorisatie, huidige
toestand, validatie, transactie, duurzame commit, audit, outbox, pas dan succes
naar de gebruiker — is voor CAO-dagen aantoonbaar gemeten (sectie C) en voor
ruilingen, plaatsingen en dienstindeling in hun eigen metingen.

---

## I. Draagbare versie

Gemeten met `npm run verify:portable`: **45 controles geslaagd, 0 mislukt,
0 geblokkeerd**. De bundel wordt daarvoor naar een verse kopie gezet, met
`subst` op een tweede schijfletter gehangen en in een map met spaties in de
naam gestart.

| Eis | Uitkomst | Bewijs |
| --- | --- | --- |
| `build:portable` | PASS | 646 MB: applicatie 106 MB, Node 88 MB, PostgreSQL 104 MB, Python met ortools 346 MB, demonstratiegegevens 2,4 MB (23 tabellen, 7428 rijen) |
| `verify:portable` | PASS | 45 controles |
| Zonder installaties op de computer | PASS | Startbestanden verwijzen uitsluitend naar `runtime\`; geen schijfletter en geen pad van de bouwmachine in enig startbestand |
| Andere schijfletter | PASS | Gestart vanaf `X:` |
| Spaties in het pad | PASS | `X:\proef met spaties\...`; elk pad in het `.bat`-bestand staat tussen aanhalingstekens en rekent vanaf `%~dp0` |
| Offline | PASS (naar aard) | Er wordt bij het starten niets opgehaald: geen npm, geen pip, geen download. De runtimes zitten in de bundel |
| Herstart | PASS | Afsluiten, opnieuw starten, de wijziging van vóór het afsluiten staat er nog en de demonstratiegegevens worden niet opnieuw ingeladen |
| Alleen localhost | PASS | Applicatie en database niet bereikbaar op het netwerkadres van de machine (192.168.178.226); alleen 127.0.0.1 |
| Eén exemplaar tegelijk | PASS | Een tweede start weigert met "het platform draait al"; het eerste draait door |
| Nette stop | PASS | Alleen het eigen procesnummer uit de eigen grendel; nooit "alle node-processen" |
| Schrijfbaarheidscontrole | PASS | Onderdeel van de start |
| Duidelijke startfouten | PASS | Poort bezet, logbestand vergrendeld, ontbrekende applicatie: elk met een eigen melding in gewone taal |
| Back-up en herstel | PASS (beschreven) | In `LEESMIJ.txt`: kopieer `database\` na het afsluiten. De meting controleert dat die uitleg er staat, niet dat iemand hem uitvoert |
| Privacywaarschuwing | PASS | In `LEESMIJ.txt` en bij elke start op het scherm: geen echte persoonsgegevens, de gegevens zijn niet versleuteld |

**Wat deze meting niet kan bewijzen:** dat er op de proefmachine geen Node
staat — die staat er, het meetscript draait erop. Wat wél is gemeten, is dat de
bundel niets van buiten zichzelf aanroept. Een proef op een werkelijk schone
Windows-machine blijft open en hoort in de volgende fase.

**Zeven defecten die alleen een echte start aan het licht bracht:**

1. De startmap werd één niveau te hoog berekend; het script zocht de applicatie
   naast de bundel in plaats van erin.
2. `pg_ctl` met opgevangen uitvoer keert nooit terug: de server erft de pijpen en
   sluit ze niet. Het starten bleef hangen zonder melding. (Dit stond al zo
   gedocumenteerd in `pg-tools.ts` en is daar niet gelezen.)
3. Het logboek werd gebufferd weggeschreven, dus bij een vastloper stond er
   niets in — precies wanneer je het nodig hebt. Nu per regel.
4. `initdb` bleef hangen met een open pijp op stdin, en opnieuw op een datamap
   die al bestond. Beide opgelost.
5. Een migratie die een enum-waarde toevoegt én gebruikt, kan niet in één
   transactie; die draaien nu statement voor statement, net als bij de
   Prisma-CLI.
6. Een JSON-kolom met een lijst erin werd als PostgreSQL-array weggeschreven en
   was daarmee geen geldige JSON meer.
7. De Prisma-runtime werd niet meegetraceerd: de bundel startte en gaf bij de
   eerste pagina een 500.

En één die niets met draagbaarheid te maken had maar wel opviel: de bundel
groeide bij elke bouw met honderden megabytes (739 → 1315 → 1892 MB) doordat
`next build` de vórige bundel meenam. Nu uitgesloten; de bundel is stabiel
646 MB.

---

## J. Export

| Eis | Uitkomst | Toelichting |
| --- | --- | --- |
| Canoniek NS-sjabloon | PASS | De geometrie is opgemeten uit het aangeleverde `50+ mix 1.pdf` en positie voor positie nagerekend: koppen, kolommen, lijnen, samenvatting, voettekst |
| Juist logo | PASS | De aangeleverde SVG, als vector omgezet naar PDF-tekenopdrachten — niet nagetekend, niet gerasterd. `verify:branding` 15 controles |
| Dienstnummer met tijd | PASS | Elke dienstcel toont nummer, duur en begin–eindtijd in NS-stijl |
| Weekdagafhankelijke instanties | PASS | De cel wordt opgezocht op `dienstcode|weekdag`; dienst 101 krijgt per dag zijn eigen tijden |
| Urensamenvatting | PASS | De Fase-P-uren staan in de linkerkolom, binnen het bestaande sjabloon |
| Voorvertoning = PDF | PASS | Structureel: één opmaakfunctie, twee tekenaars (PDF en SVG). Ze kúnnen niet uiteenlopen |
| Roosters van 6, 10 en 12 regels | PASS | Alle zeven Dordrechtse roosters zijn opgemaakt; de paginering volgt uit de gemeten regelhoogte |
| Levering via de webserver | PASS | `verify:schermen` haalt het roosterblad echt op: `application/pdf`, `%PDF-` aan het begin, `%%EOF` aan het eind |

---

## K. Verificatie — exacte aantallen

| Soort | Aantal | Uitkomst |
| --- | ---: | --- |
| Unittests (`vitest`) | 653 in 35 bestanden | alle geslaagd |
| — waarvan rules-engine gedragstests | 135 | alle geslaagd |
| Typecheck (`tsc --noEmit`) | — | schoon |
| Lint (`eslint`) | — | 0 fouten, 0 waarschuwingen |
| Productiebuild (`next build`) | — | slaagt; standalone-uitvoer |
| Schermcontrole (`verify:schermen`) | 32 schermen + 105 interne verwijzingen | alle in orde |
| Toegang per rol (`verify:toegang`) | 4 rollen | alle rollen gedragen zich zoals verwacht |
| Integriteit (`verify:integriteit`) | 19 | alle geslaagd |
| Roosteruren (`verify:roster-hours`) | 4 | alle geslaagd |
| Roosterjaar (`verify:rooster-year`) | 22 (9135 dagen nagerekend) | alle geslaagd |
| CAO-dagen (`verify:cao-dagen`) | 43 | alle geslaagd |
| Pakketimport (`verify:pakketimport`) | 16 | alle geslaagd, 2 geblokkeerd |
| Regeldekking (`verify:rule-coverage`) | 71 regels | 0 harde regels zonder gedragstoets |
| Beeldmerk (`verify:branding`) | 15 | alle geslaagd |
| Ruilingen (`verify:ruilflow`) | 8 | alle geslaagd |
| Plaatsingen (`verify:tijdelijk`) | 12 | alle geslaagd |
| Rotatie (`verify:rotatie`) | 14 | alle geslaagd |
| Meldingen (`verify:meldingen`) | 8 | alle geslaagd |
| Draagbaar (`verify:portable`) | 45 | alle geslaagd |
| Crashherstel (`verify:crash-recovery`) | 19 | alle geslaagd |
| **Volledige doorloop (`verify:e2e`)** | **15 metingen, 259 controles** | **0 mislukt, 3 geblokkeerd; 50 van 50 gevraagde scenario's afgedekt** |
| Mutatietoetsen (handmatig, deze fase) | 8 | alle mutanten gevangen behalve twee die aantoonbaar niets veranderden — zie hieronder |

**Mutatietoetsen die iets leerden.** Acht keer is een regel of controle bewust
kapotgemaakt om te zien of de meting hem vangt:

- CAO-termijn `<` naar `<=`: gevangen (10 tests).
- Reservedag telt niet als werkdag: gevangen.
- Aaneengesloten dagen alleen vooruit kijken: gevangen (10 controles).
- Aaneengesloten dagen binnen dezelfde maand vergelijken: gevangen door precies
  de vijf jaargrenscontroles en drie unittests — de bedoelde discriminatie.
- Grendel weg bij het verwerken van een CAO-dag: **niet** gevangen door de
  uitkomstmeting, wél door de deterministische grendelproef.
- Tweede zondag naar eerste zondag: gevangen.
- Roosterjaargrens aan de verkeerde kant: gevangen.
- Middernachtdoorloop weg bij het lezen van een dienstcel: gevangen (3
  controles, waaronder de telling van 55 nachtdiensten).

---

## L. Openstaande defecten

Volledig. Niets weggelaten.

1. **Dienstdagen zonder dienstnummer in gegenereerde kandidaten.** In scenario C
   (5 gevallen) en D (3 gevallen) zet de generatie een dienstdag neer zonder
   dienstnummer, bijvoorbeeld `DDR-L/lijn 9/week 1/dag 7`. De eindvalidatie
   vangt het en wijst af, maar het hoort niet te kunnen ontstaan.
   `IMPLEMENTATION_DEFECT`.
2. **Veertien regels staan in het regelbestand en worden nergens toegepast.**
   Zie sectie F. Voor tien daarvan bestaat de module niet waarin zij zouden
   gelden (verlof, feestdagen, RO/DvP, WTV-verlening); vier zijn zacht of doel
   en worden door de optimizer niet gewogen.
3. **Artikelverwijzing `WEEKLY_REST_72H_PER_14D` niet te bevestigen.**
   `SOURCE_REFERENCE_REVIEW_REQUIRED`, zie sectie F.
4. **PDF-route voor dienstenpakketten niet op een echt document gemeten.**
   `BLOCKED_BY_MISSING_SOURCE`.
5. **DOC/DOCX-route niet gebouwd.** Geen aangeleverd voorbeeld.
6. **De geseede roosterperiode loopt van 6 augustus tot 4 november 2026.** De
   CAO-dagenkalender toont drie maanden vanaf de eerste geldige dag, en de derde
   maand valt daarmee buiten de gegevens: die staat volledig op "geen rooster
   bekend". Geen codefout, wel een demonstratie die leger oogt dan nodig.
7. **Vensters van 16 en 52 weken reiken vóór het begin van de bron.**
   1182–1222 toewijzingen per scenario missen daardoor historie. Inherent aan
   een geseede periode; verdwijnt met een langere gegevensreeks.
8. **De optimizer bewijst optimaliteit niet binnen 30 seconden** voor de
   scenario's A, B, C en E; hij levert een geldige oplossing (`FEASIBLE`) maar
   geen bewijs. Alleen scenario D haalt bewezen optimaliteit.
9. **Op deze ontwikkelmachine blijft na een hard gedode PostgreSQL een
   verweesd proces achter** dat een poort en een logbestand vasthoudt tot een
   herstart. De metingen werken daar nu omheen met verse mappen en vrije
   poorten; het is een eigenschap van Windows, geen defect van het platform,
   maar het staat hier omdat het twee proefdraaien heeft stilgelegd.
10. **Geen enkele regel is formeel door NS gevalideerd.** 0 van 71.

---

## M. Voltooiingsscore

| Maat | Score | Waarop dit berust |
| --- | ---: | --- |
| Functionele volledigheid Dordrecht | **88 %** | De gevraagde functies zijn gebouwd en gemeten op de echte 223 diensten, 64 roosterlijnen en 67 accounts. Eraf: de niet-gebouwde verlof-, feestdag- en WTV-bepalingen, de DOC-route, en de dienstdagen zonder dienstnummer |
| Technische volledigheid | **85 %** | Typecheck, lint en 653 tests schoon; 259 controles in de doorloop; draagbaar en crashbestendig aangetoond. Eraf: 14 regels zonder implementatie, de optimizer die optimaliteit niet bewijst, en de openstaande generatiefout |
| Gereed voor interne demonstratie | **92 %** | De draagbare bundel start op een vreemde machine, met demonstratiegegevens, alleen op localhost, met een privacywaarschuwing. Eraf: de lege derde maand in de kalender en de proef op een werkelijk schone machine |
| Gereed voor pilot | **45 %** | Alles wat een pilot met echte mensen vraagt — geldige juridische bron, formele validatie, beveiligingsbeoordeling, echte historie — ontbreekt. De techniek is er; de grondslag niet |
| Gereed voor productie | **15 %** | Zie hieronder |

**Waarom productie op 15 % staat en niet hoger.** Niet omdat er weinig werkt —
er werkt veel, en het is gemeten. Maar productie betekent dat een uitkomst van
dit platform bepaalt wanneer iemand moet rijden. Daarvoor is nodig: een
bevestigd actueel regelbestand, de Arbeidstijdenwet en het
Arbeidstijdenbesluit vervoer, formele validatie van elke regel door NS, een
beveiligingsbeoordeling, en governance over wie wat mag wijzigen. Daarvan is
niets aanwezig. Wat er staat is een systeem dat correct weigert zolang het niet
zeker weet — en dat is precies wat het op dit moment hoort te doen.

**PRODUCTION SAFE: NO.**

Automatische live roostergeneratie: uitgeschakeld. Elk gegenereerd scenario
komt uit de eindvalidatie als `REJECTED` met `publiceerbaar: false`.

---

## N. Wat hierna komt

Deze fase is afgerond. Er is niets nieuws begonnen, geen volgende standplaats
aangeraakt en geen zelfbedachte fase toegevoegd.

De volgende fase is uitsluitend **FINAL ACCEPTANCE / BREAK-IT / POLISH**.

Wat daarvoor nodig is en niet door bouwen op te lossen valt:

- De actuele CAO, bevestigd als geldend.
- De Arbeidstijdenwet en het Arbeidstijdenbesluit vervoer.
- Formele validatie per regel door NS, inclusief de artikelverwijzing die in
  sectie F is gemarkeerd.
- Een dienstenpakket in PDF en, als dat formaat gebruikt wordt, in DOC/DOCX.
- Een beveiligings- en privacybeoordeling vóór er ook maar één echt
  personeelsnummer in gaat.
