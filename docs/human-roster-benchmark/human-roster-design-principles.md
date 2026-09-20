# Menselijke roosterprincipes — Dordrecht

*Afgeleid uit de zeven officiële basisroosters van dienstenpakket
DDR-BDU-05-10-2026 (`learnedFromBenchmark = DDR_BDU_05_10_2026`).*

Deze roosters zijn door mensen gemaakt en worden in de praktijk gereden door
collega's die er in grote lijnen tevreden mee zijn. Ze zijn hier gebruikt als
**goede referentie**, niet als mathematisch optimum en niet als regelboek. Alles
hieronder is één steekproef: 7 basisroosters, 64 regels, 223 gewerkte dagen.
Geen van deze principes is een wet; het zijn waarnemingen die als zachte
voorkeur mogen meewegen.

De ruwe gegevens staan naast dit document: `official-roster-lines.json` (elke
dag van elke regel, met tijden), `official-features.json`, en de CSV-bestanden
per onderwerp. Elk getal hieronder is daar na te rekenen met
`npm run human-benchmark:extract`.

---

## Wat hard is en wat zacht

| Hard (regel of structuur, nooit onderhandelbaar) | Zacht (menselijke voorkeur, meewegen) |
| --- | --- |
| Dekking: elke dienst precies één keer | Dagdelen clusteren in blokken |
| Profielgrens: geen vroege dienst in Laat/Nacht | Dagdeelwissels over rust heen laten lopen |
| Geplande dagelijkse rust (12 uur) | Nachten in reeksen van drie tot zes |
| Maximaal 7 aaneengesloten diensten | Na nachten eerst rust, dan laat — niet vroeg |
| Maximaal 7 diensten in een reeks met nachten | Ruim herstel na een nachtreeks |
| Herstelrust na 3+ nachten (46 uur, bronstatus POTENTIAL) | Begintijden binnen een dagdeel niet te ver laten springen |
| Rust-, WR-, CO- en RES-dagen liggen vast in de structuur | Geen regel opofferen voor het gemiddelde |

Alles in de rechterkolom komt uit deze roosters. Niets uit de linkerkolom is uit
deze roosters afgeleid: dat zijn regels uit de CAO, de Roosterkaders en de
roosterstructuur, en die bestaan al in het platform.

---

## 1. Een werkblok heeft één dagdeel

**Waarneming.** Van de 102 werkblokken (aaneengesloten gewerkte dagen) hebben er
98 één en hetzelfde dagdeel. In Vroeg, Vroeg/Laat, Laat, Laat/Nacht en Mix is
dat 100%. De vier uitzonderingen zitten in BLM (één overgang laat → nacht) en in
50+ Mix.

**Principe.** *Cluster gelijksoortige diensten.* Een regel in Vroeg/Laat of Mix
mag beide dagdelen bevatten, maar niet door elkaar: eerst een blok vroeg, dan
rust, dan een blok laat.

## 2. Dagdeelwissels lopen over rust heen

**Waarneming.** In Vroeg/Laat, Laat/Nacht en Mix gebeurt elke wissel van dagdeel
na minstens één vrije dag, meestal na twee tot vier:

| Wissel | na 0 vrij | na 1 | na 2 | na 3 | na 4 |
| --- | ---: | ---: | ---: | ---: | ---: |
| laat → vroeg | 2* | 2 | 2 | 4 | 1 |
| nacht → laat | | | 3 | 1 | |
| laat → nacht | 1** | | 1 | 1 | |
| vroeg → nacht | | 1 | | | |

\* beide in 50+ Mix, met begintijden die 19 en 41 minuten verschillen.
\*\* in BLM: laat → nacht met 22,5 uur rust, een rotatie vooruit.

**Principe.** *Gebruik rust als scheiding tussen dagdeelfamilies.* Hoe groter de
sprong op de klok, hoe meer vrije dagen ertussen.

## 3. Geen heen-en-weer — op de klok, niet op het etiket

**Waarneming.** Vroeg → laat → vroeg komt in zes van de zeven roosters niet voor.
In 50+ Mix staat het er wel, drie keer — maar daar overlappen vroeg en laat qua
tijd: vroege diensten beginnen tussen 07:00 en 11:06, late tussen 09:54 en 13:08.
Het etiket wisselt, de lichaamsklok nauwelijks.

**Principe.** *Vermijd heen-en-weer van de lichaamsklok.* Meet een wissel aan
de begintijd, niet alleen aan de naam van het dagdeel. Een "laat" die 40 minuten
later begint dan de "vroeg" ervoor, is iets anders dan een die negen uur later
begint.

**Gevolg voor het platform.** De kwaliteitsmaat noemde twee regels van het
officiële 50+ Mix-rooster "zware overgang" (laat → vroeg), terwijl de begintijd
er 19 en 41 minuten verschoof bij 16 en 14,6 uur rust. Dat was een fout in de
maat, niet in het rooster.

**Waar de grens ligt.** Een wissel telt als alleen een ander etiket als de
begintijd hooguit een uur verschuift — de vrije begintijdsprong uit principe 6.
Een eerste versie legde de grens op drie uur. De zoekmachine vond dat gat: in
BLM liet hij een "laat" van 09:47 direct volgen door een "vroeg" van 07:22
(13 uur rust), iets wat in geen van de zeven roosters voorkomt. De enige
directe etiketwissels in de officiële roosters verschuiven 19 en 41 minuten
(ontwikkellog H09).

## 4. Nachten komen in reeksen van drie tot zes

**Waarneming.** Vier nachtreeksen in het hele pakket, met lengtes 3, 5, 5 en 6.
Geen enkele losse nacht, geen enkele reeks van twee.

| Rooster | Reeks | Hoe hij in de rotatie ligt |
| --- | --- | --- |
| Laat/Nacht | 6 | regel 2 vr–zo (3) + regel 3 ma–wo (3) |
| Mix | 5 | regel 8 ma–vr |
| Mix | 5 | regel 2 do–zo (4) + regel 3 ma (1) |
| BLM | 3 | regel 4 di–do |

**Let op.** Per regel gelezen lijkt Laat/Nacht twee blokken van drie te hebben.
In de rotatie volgt maandag van regel 3 direct op zondag van regel 2: wie het
rooster rijdt, werkt zes nachten achter elkaar. Hetzelfde geldt voor Mix
regel 2 → 3: de losse nacht op maandag van regel 3 is het slot van een reeks
van vijf. Een rooster moet dus als cirkel worden beoordeeld, niet regel voor
regel.

**Principe.** *Bouw nachten als blok*, bij voorkeur van vijf of zes, nooit los,
liefst niet met twee. Nooit langer dan de regels toestaan (7 diensten in een
reeks met nachten).

## 5. Na nachten: eerst rust, dan laat

**Waarneming.** Alle vier de nachtreeksen worden gevolgd door twee of drie vrije
dagen en daarna een **late** dienst (`RRL`, `RRL`, `RRL`, `RRRL`). Nooit een
vroege. Het kortste herstel tussen het einde van de laatste nacht en de volgende
dienst is 56 uur; de regel eist 46.

**Principe.** *Na een nachtreeks: echte herstelruimte, en daarna niet meteen
vroeg.* In die volgorde: eerst het herstel, dan de richting. Nacht, één vrije
dag, laat (ongeveer 32 uur) is geen menselijke uitgang, ook al volgt er laat;
een meting die hem boven nacht, twee vrije dagen, vroeg (48 uur) zet, laat de
zoekmachine rust inleveren (ontwikkellog H04 en H09).

## 6. Begintijden springen, maar niet ver

**Waarneming.** Tussen twee opeenvolgende diensten met hetzelfde dagdeel
verschuift de begintijd gemiddeld 73 minuten (mediaan 60, p90 150, maximum 229).
Een op de vijf sprongen is groter dan twee uur.

**Principe.** *Houd begintijden binnen een blok redelijk bij elkaar* — maar
mensen accepteren een uur verschil zonder problemen. Een maat die elke minuut
straft, noemt deze roosters ten onrechte slecht; alleen grote sprongen (boven
een uur, volledig fout boven vier uur) tellen.

## 7. Rust is ruimer dan het minimum

**Waarneming.** Tussen twee opeenvolgende diensten zit per rooster gemiddeld 3,7
tot 4,8 uur méér rust dan de geplande 12 uur. Minder dan een uur extra komt voor
in 6 van de 121 gevallen; het krapste is 12:29.

**Principe.** *Rust boven het minimum heeft waarde.* Krappe rust mag, maar is de
uitzondering.

## 8. Blokken zijn kort, vrije dagen staan in paren

**Waarneming.** Werkblokken zijn gemiddeld 2,2 dagen lang: 40 van de 102 zijn één
dag, omdat reservedagen (RES) de reeks onderbreken. Vrije dagen staan het vaakst
in paren: 41 blokken van twee, tegen 26 losse vrije dagen, 15 van drie en 4 van
vier.

**Gevolg.** De lengte van een werkblok ligt grotendeels vast in de
roosterstructuur (waar de RES-, R- en WR-dagen staan). De oude maat beloonde
lange blokken en gaf daarmee elk menselijk rooster een lage score op iets wat
de zoekmachine niet kan veranderen. Die maat is vervangen door één die kijkt
naar wat er binnen een blok gebeurt.

## 9. Weekenden: de helft van de regels heeft een vrij weekend

**Waarneming.** In elk van de zeven roosters heeft precies de helft van de
regels een volledig vrij weekend (6/12, 5/10, 6/12, 3/6, 6/12, 3/6, 3/6).

**Gevolg.** Dit ligt vast in de structuur: zaterdag en zondag zijn in die regels
rust- of WR-dagen. De zoekmachine vult alleen dienstdagen en kan dit niet
veranderen. Het wordt gemeten, niet geoptimaliseerd.

## 10. Eén regel hoeft niet op 40:00 te staan

**Waarneming.** Regels lopen per rooster ver uiteen, bijvoorbeeld in Vroeg van
26:51 tot 46:37 (exclusief pauze), terwijl het rooster als geheel uitkomt op
39:44 inclusief pauze. Laat komt uit op 39:59, Vroeg/Laat op 39:55.

**Principe.** *Stuur het rooster als geheel naar het contractgemiddelde, niet
elke regel.* Een regel forceren naar 40:00 maakt de menselijke structuur kapot.
Alleen buitensporige uitschieters verdienen aandacht.

## 11. De regelgrens is een gewone dag

**Waarneming.** Rond zondag → maandag staan vooral vrije dagen (vrij → vrij 10×,
vrij → laat 10×, vrij → vroeg 8×). Waar beide dagen gewerkt worden, is het
bijna altijd hetzelfde dagdeel (vroeg → vroeg 6×, laat → laat 4×,
nacht → nacht 2×), één keer vroeg → laat.

**Principe.** *Beoordeel de volledige cyclische rotatie.* De overgang van
zondag naar de volgende maandag weegt even zwaar als elke andere.

## 12. Elk profiel heeft een eigen karakter

| Profiel | Wat het menselijke rooster laat zien |
| --- | --- |
| Vroeg | Alleen vroeg, begintijden 04:23–09:27; blokken tot vier dagen |
| Laat | Alleen laat, begintijden 11:09–18:08 |
| Vroeg/Laat | Beide dagdelen, maar elk blok één familie; wissels altijd over 1–4 vrije dagen |
| Laat/Nacht | Laat plus één nachtreeks van zes over de regelgrens; daarna RRL |
| Mix | Families per regel: vroeg, laat of nacht; twee reeksen van vijf nachten |
| BLM | Regels 1–3 vroeg, regel 4 laat → drie nachten, regels 5–6 laat |
| 50+ Mix | Daguren: vroeg én laat tussen 07:00 en 13:08 beginnen; geen nachten; wisselt vaker van etiket, niet van klok |

**Principe.** *Gebruik profielkenmerken als zachte verwachting, niet als
sjabloon.* Met één roosterperiode per profiel is een getal per profiel te dun
om hard op te sturen; de profielverschillen worden daarom vooral opgevangen
door klokbewust te meten (zie principe 3), en per profiel gerapporteerd.

---

## Wat deze roosters níet laten zien

- Of medewerkers een van deze patronen expliciet waarderen. Dat vraagt een
  menselijk oordeel over concrete kandidaten — daarvoor is de beoordelingsmodus
  gebouwd.
- Of dit op andere standplaatsen of in andere roosterperiodes hetzelfde is.
- Een fysiologische onderbouwing. "Na nachten liever laat dan vroeg" is hier een
  **voorkeur in het roosterontwerp**, gemeten aan wat mensen maakten, geen
  medische claim.
