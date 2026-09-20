# Wisselkoersen van het roosterbrein

*Gegenereerd door `npm run final-brain:exchange-rates` uit `objective-weights.ts`, de overgangstabellen en kwaliteitsmodel v2. Niets hieronder is met de hand ingevuld.*

## De munt

De CP-SAT-solver betaalt per minuut afwijking van het urengemiddelde van een basisrooster. Omgerekend naar **één minuut per week in één rooster** kost dat `hoursBalance × 60` = **900** (Evenwichtig), onafhankelijk van de cycluslengte; het slechtste rooster kost daarbovenop 40 per minuut per week. Alle koersen hieronder zijn die munt: hoeveel minuten per week urenbalans in één rooster de solver opgeeft om een gebeurtenis te vermijden — of andersom, hoeveel urenwinst hem een gebeurtenis waard is.

De doelfunctie is lineair, dus deze koersen zijn exact de marginale kosten, geen schatting.

## CP-SAT, strategie BALANCED (1 min/week = 900)

| Gebeurtenis | Herstel | v1.0.4 bevroren (klassieke tabel) | menselijk ritme, schaal 1 (H05) | menselijk ritme, nachtrij × 5 (huidig) |
| --- | --- | ---: | ---: | ---: |
| Losse nacht |  | 900 = 1,0 min/week | 900 = 1,0 min/week | 900 = 1,0 min/week |
| Reeks van twee nachten |  | 700 = 47 s/week | 700 = 47 s/week | 700 = 47 s/week |
| Nachtreeks → 1 vrije dag → laat | ± 32 u | 40 = 3 s/week | 120 = 8 s/week | 600 = 40 s/week |
| Nachtreeks → 1 vrije dag → vroeg | ± 24 u | 120 = 8 s/week | 160 = 11 s/week | 800 = 53 s/week |
| Nachtreeks → 2 vrije dagen → vroeg | ± 48 u (boven de regel) | 0 = 0 s/week | 80 = 5 s/week | 400 = 27 s/week |
| Nachtreeks → 2 vrije dagen → laat (menselijk) | ± 56 u | 0 = 0 s/week | 0 = 0 s/week | 0 = 0 s/week |
| Laat direct gevolgd door vroeg |  | 160 = 11 s/week | 160 = 11 s/week | 160 = 11 s/week |
| Heen-en-weer vroeg → laat → vroeg (direct) |  | 200 = 13 s/week | 200 = 13 s/week | 200 = 13 s/week |
| Nacht → dag → nacht (direct, laat ertussen) |  | 160 = 11 s/week | 240 = 16 s/week | 1.040 = 1,2 min/week |
| Vroeg → nacht → vroeg (direct) |  | 360 = 24 s/week | 360 = 24 s/week | 1.320 = 1,5 min/week |
| Eén minuut minder dan comfortabele rust |  | 1 = 0 s/week | 1 = 0 s/week | 1 = 0 s/week |
| Eén minuut begintijdsprong boven het vrije uur |  | 0 = 0 s/week | 0 = 0 s/week | 0 = 0 s/week |

## CP-SAT, strategie REST_QUALITY (1 min/week = 600)

| Gebeurtenis | Herstel | v1.0.4 bevroren (klassieke tabel) | menselijk ritme, schaal 1 (H05) | menselijk ritme, nachtrij × 5 (huidig) |
| --- | --- | ---: | ---: | ---: |
| Losse nacht |  | 1.100 = 1,8 min/week | 1.100 = 1,8 min/week | 1.100 = 1,8 min/week |
| Reeks van twee nachten |  | 900 = 1,5 min/week | 900 = 1,5 min/week | 900 = 1,5 min/week |
| Nachtreeks → 1 vrije dag → laat | ± 32 u | 100 = 10 s/week | 300 = 30 s/week | 1.500 = 2,5 min/week |
| Nachtreeks → 1 vrije dag → vroeg | ± 24 u | 300 = 30 s/week | 400 = 40 s/week | 2.000 = 3,3 min/week |
| Nachtreeks → 2 vrije dagen → vroeg | ± 48 u (boven de regel) | 0 = 0 s/week | 200 = 20 s/week | 1.000 = 1,7 min/week |
| Nachtreeks → 2 vrije dagen → laat (menselijk) | ± 56 u | 0 = 0 s/week | 0 = 0 s/week | 0 = 0 s/week |
| Laat direct gevolgd door vroeg |  | 400 = 40 s/week | 400 = 40 s/week | 400 = 40 s/week |
| Heen-en-weer vroeg → laat → vroeg (direct) |  | 500 = 50 s/week | 500 = 50 s/week | 500 = 50 s/week |
| Nacht → dag → nacht (direct, laat ertussen) |  | 400 = 40 s/week | 600 = 1,0 min/week | 2.600 = 4,3 min/week |
| Vroeg → nacht → vroeg (direct) |  | 900 = 1,5 min/week | 900 = 1,5 min/week | 3.300 = 5,5 min/week |
| Eén minuut minder dan comfortabele rust |  | 3 = 0 s/week | 3 = 0 s/week | 3 = 0 s/week |
| Eén minuut begintijdsprong boven het vrije uur |  | 0 = 0 s/week | 0 = 0 s/week | 0 = 0 s/week |

## CP-SAT, strategie FAIR_BURDEN (1 min/week = 900)

| Gebeurtenis | Herstel | v1.0.4 bevroren (klassieke tabel) | menselijk ritme, schaal 1 (H05) | menselijk ritme, nachtrij × 5 (huidig) |
| --- | --- | ---: | ---: | ---: |
| Losse nacht |  | 900 = 1,0 min/week | 900 = 1,0 min/week | 900 = 1,0 min/week |
| Reeks van twee nachten |  | 700 = 47 s/week | 700 = 47 s/week | 700 = 47 s/week |
| Nachtreeks → 1 vrije dag → laat | ± 32 u | 25 = 2 s/week | 75 = 5 s/week | 375 = 25 s/week |
| Nachtreeks → 1 vrije dag → vroeg | ± 24 u | 75 = 5 s/week | 100 = 7 s/week | 500 = 33 s/week |
| Nachtreeks → 2 vrije dagen → vroeg | ± 48 u (boven de regel) | 0 = 0 s/week | 50 = 3 s/week | 250 = 17 s/week |
| Nachtreeks → 2 vrije dagen → laat (menselijk) | ± 56 u | 0 = 0 s/week | 0 = 0 s/week | 0 = 0 s/week |
| Laat direct gevolgd door vroeg |  | 100 = 7 s/week | 100 = 7 s/week | 100 = 7 s/week |
| Heen-en-weer vroeg → laat → vroeg (direct) |  | 125 = 8 s/week | 125 = 8 s/week | 125 = 8 s/week |
| Nacht → dag → nacht (direct, laat ertussen) |  | 100 = 7 s/week | 150 = 10 s/week | 650 = 43 s/week |
| Vroeg → nacht → vroeg (direct) |  | 225 = 15 s/week | 225 = 15 s/week | 825 = 55 s/week |
| Eén minuut minder dan comfortabele rust |  | 1 = 0 s/week | 1 = 0 s/week | 1 = 0 s/week |
| Eén minuut begintijdsprong boven het vrije uur |  | 0 = 0 s/week | 0 = 0 s/week | 0 = 0 s/week |

## Wat het brein feitelijk ruilt (Evenwichtig)

- CP-SAT accepteert één **losse nacht** als dat ongeveer **1,0 min/week** urenbalans in één rooster oplevert.
- Een **reeks van twee nachten**: 47 s/week.
- Een **nachtuitgang onder 46 uur** (nacht → vrij → laat): 3 s/week in v1.0.4, 8 s/week met de menselijke tabel, 40 s/week nu (menselijk ritme, nachtrij × 5 (huidig)).
- **Laat direct gevolgd door vroeg**: 11 s/week.
- **Heen-en-weer vroeg → laat → vroeg**: 13 s/week.

Ter vergelijking: de zeven menselijke roosters wijken per rooster 1 tot 48 minuten per week af van 40:00 (BLM 39:12). De solver behandelt elke minuut daarvan als duurder dan de meeste ritmegebeurtenissen.

## Het kwaliteitsmodel (bijschaven en rangschikking)

Marginale effecten op de robuuste score, analytisch, op de grootte van het Dordrechtse pakket (7 roosters, 19 nachten in 4 reeksen, 223 gewerkte dagen). Effecten op de slechtste regel komen erbovenop.

| Gebeurtenis | Robuust | In urenmunt | Formule |
| --- | ---: | ---: | --- |
| Eén minuut/week uren in één rooster | -0,030 | 1 min/week | 0,85 × w_uren × 0,75 × (100/60) / aantal roosters |
| Losse nacht (4 → 3 + 1) | -0,69 | 23 min/week | 0,85 × w_nachten × 0,7 × 100 × (0,9·3 + 0·1 − 0,95·4) / nachten |
| Reeks van twee (5 → 3 + 2) | -0,94 | 31 min/week | 0,85 × w_nachten × 0,7 × 100 × (0,9·3 + 0,4·2 − 1·5) / nachten |
| Nachtuitgang onder de herstelregel | -1,75 | 58 min/week | 0,85 × (w_nachten × 0,3 × 100 + w_rust × 0,25 × 100 × 0,6) / nachtreeksen |
| … en het is de slechtste van het pakket | -3,25 | 107 min/week | idem, plus 1,5 als het de slechtste uitgang van het pakket is (slechtste geval, H10) |
| Laat direct gevolgd door vroeg | -0,29 | 9,7 min/week | 0,85 × (w_regelmaat × 0,2 × 100 × (4/gewerkte dagen)/0,5 + w_rust × 0,15 × 100 × (100/gewerkte dagen)/5) |
| Heen-en-weer op de klok | -0,55 | 18 min/week | 0,85 × w_regelmaat × (0,15 × 100 × (100/gewerkt)/5 + 0,2 × 100 × (5/gewerkt)/0,5) + zware overgang in rust |

## Wat dat betekent

De twee helften van het brein ruilen tegen koersen die ordes van grootte uiteenlopen. Voor een nachtuitgang onder de regel rekent het kwaliteitsmodel ongeveer 58 min/week urenbalans; de solver in v1.0.4 3 s/week — een factor 1.299. Het bijschaven kan zo'n uitgang niet herstellen: rustdagen liggen vast in de structuur, en een nachtreeks verplaatsen kan niet met losse ruilen zonder hem onderweg te breken. Wie waar de nachtreeksen legt, beslist de solver — tegen zijn eigen koers.

