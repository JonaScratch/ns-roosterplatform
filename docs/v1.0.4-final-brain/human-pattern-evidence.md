# Menselijke patronen — het bewijs

*Referentie: de zeven officiële Dordrechtse basisroosters, dienstenpakket
DDR-BDU-05-10-2026 (`HUMAN_ACCEPTED_REFERENCE`, `learnedFromBenchmark =
DDR_BDU_05_10_2026`). Eén steekproef: 7 basisroosters, 64 regels, 223 gewerkte
dagen. Het volledige verslag met tabellen per onderwerp staat in
`docs/human-roster-benchmark/human-roster-design-principles.md`; de ruwe
gegevens in `docs/human-roster-benchmark/`.*

Deze roosters worden gereden en door mensen gemaakt. Ze zijn hier de beste
beschikbare referentie voor **structuur** — niet een optimum, niet een
regelboek, en nergens letterlijk gekopieerd. Alles hieronder is een waarneming
in deze ene steekproef, gebruikt als zachte voorkeur.

## Wat de data objectief laat zien

| Waarneming | Getal | Bron |
| --- | --- | --- |
| Werkblokken met één dagdeel | 98 van 102 (96,1%; op dagen gewogen 97,8%) | `work-blocks.csv` |
| Nachtreeksen | 3, 5, 5, 6 — twee lopen over de regelgrens | `night-blocks.csv` |
| Losse nachten / reeksen van twee | 0 / 0 | idem |
| Na een nachtreeks | altijd 2–3 vrije dagen, dan laat | idem |
| Kortste herstel na een nachtreeks | 56 uur (de regel vraagt 46) | idem |
| Begintijdsprong binnen een dagdeel | gemiddeld 73 min, mediaan 60, p90 150, max 229 | `official-features.json` |
| Dagdeelwissels via rust | 82,8% (in V/L, L/N en Mix: allemaal) | `transition-matrix.csv` |
| Directe wissel terug op de klok (> 1 uur) | 0 | `docs/v1.0.4-final-brain/before.json` (officieel) |
| Wissels vooruit / terug (direct of over één dag) | 14 / 15 | idem |
| Rust boven de geplande 12 uur | per rooster gemiddeld 3,7–4,8 uur | `rest-distribution.csv` |
| Uren per rooster | 39:12 tot 39:59 per week (incl. pauze) | `official-features.json` |
| Uren per regel | ver uiteen, bv. Vroeg 26:51 tot 46:37 (excl. pauze) | idem |
| Weekenden | in elk rooster precies de helft van de regels vrij | idem |

## Hard tegenover zacht

Hard (niet uit deze roosters afgeleid; bestaande regels en structuur): volledige
dekking, profielgrenzen, geplande dagelijkse rust, maximaal 7 aaneengesloten
diensten en 7 in een reeks met nachten, herstelrust na 3+ nachten (46 uur,
bronstatus POTENTIAL), de vaste rust-, WR-, CO- en RES-dagen.

Zacht (uit deze roosters): één dagdeel per werkblok, wissels via rust, nachten
in reeksen van drie tot zes, na nachten eerst herstel en dan laat, begintijden
binnen een uur bij elkaar, rust ruimer dan het minimum, uren op roosterniveau
in plaats van per regel.

## Richting (werkopdracht §7)

Vooruit en terug op de klok komen even vaak voor (14 tegen 15). Het verschil zit
niet in de richting maar in de rust: een wissel terug gaat in de menselijke
roosters **altijd over rust**; direct (zonder vrije dag) en meer dan een uur
terug komt niet voor. Op twee voorbeelden in elke richting is geen drempel per
richting te bouwen (de enige directe etiketwissels zijn laat → vroeg van 19 en
41 minuten in 50+ Mix; vroeg → laat van 126 en 131 minuten). Het model meet
daarom de klokverschuiving en de rust, niet de richting: een wissel tot en met
een uur is alleen een ander etiket, daarboven een echte wissel die over rust
hoort te lopen.

## De cyclus is een cirkel

In de rotatie volgt maandag van regel N+1 op zondag van regel N, en regel 1 op
de laatste regel. De Laat/Nacht-reeks "3 + 3" is voor wie hem rijdt zes nachten
achter elkaar; de "losse nacht" op maandag van Mix regel 3 is het slot van een
reeks van vijf. Nachtreeksen, werkblokken, begintijdsprongen en rust worden
daarom over de regelgrens heen gemeten; een test legt vast dat een slechte
overgang over de grens precies zo telt als dezelfde overgang midden in de week.

## Karakter per profiel

| Profiel | Wat het menselijke rooster laat zien |
| --- | --- |
| Vroeg | Alleen vroeg, begintijden 04:23–09:27; blokken tot vier dagen |
| Laat | Alleen laat, begintijden 11:09–18:08 |
| Vroeg/Laat | Beide dagdelen, elk blok één familie; wissels altijd over 1–4 vrije dagen |
| Laat/Nacht | Laat plus één nachtreeks van zes over de regelgrens; daarna rust, rust, laat |
| Mix | Families per regel: vroeg, laat of nacht; twee reeksen van vijf nachten |
| BLM | Regels 1–3 vroeg, regel 4 laat → drie nachten, regels 5–6 laat |
| 50+ Mix | Daguren: vroeg én laat beginnen tussen 07:00 en 13:08; wisselt vaker van etiket, niet van klok |

Met één roosterperiode per profiel is een getal per profiel te dun om hard op
te sturen. Het profielkarakter wordt daarom vooral opgevangen door op de klok te
meten (50+ Mix) en door blokken van één dagdeel te waarderen (Vroeg/Laat, Mix,
BLM), en per basisrooster gerapporteerd.

## Wat deze roosters níet laten zien

- Of medewerkers deze patronen expliciet waarderen. Dat vraagt een menselijk
  oordeel over concrete kandidaten.
- Of het op andere standplaatsen of in andere roosterperiodes hetzelfde is.
- Een fysiologische onderbouwing. "Na nachten eerst herstel, dan laat" is hier
  een voorkeur in het roosterontwerp (*schedule-flow preference*), gemeten aan
  wat mensen maakten.
