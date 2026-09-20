# Menselijke roosters tegenover de opgegeven machinistenvoorkeur

*Stap 2 en 3 van de vervolgopdracht: eerst meten, dan pas ontwerpen. Bronnen:
`measure-before.json`, `early-distribution.csv`, `late-distribution.csv`,
`rangeer-distribution.csv`, `weekend-quality.csv`, `workblock-distribution.csv`,
`roster-average-hours.csv` (`npm run machinist:measure`). "Baseline" is de stand
na de Final-Brain-ronde (60 kandidaten), "v1.0.4" de bevroren versie.*

Bronstatus: de voorkeuren zijn `MACHINIST_PREFERENCE`; de weekend- en
urengrens zijn `USER_PROVIDED_OPERATIONAL_DESIGN_REQUIREMENT`. Geen van beide is
hier als CAO, ATW of wet gepresenteerd. Toeslagen: er staan geen ORT-regels in
het platform; blootstelling is gemeten als proxy (CAO-nachtvenster 00:00–06:00
en weekendminuten), niet in geld.

## Waar mens en voorkeur overeenkomen

| Voorkeur | Menselijk rooster | Baseline |
| --- | --- | --- |
| Laat krijgt relatief meer echte aflopers (na middernacht klaar) | Laat 18 van de 36 (lift 2,5) | Laat 14,5 — minder dan de mens |
| Vroeg krijgt de meeste extreem vroege diensten | Vroeg 8, Vroeg/Laat 9, Mix 6, BLM 3 | Vroeg 9,4 — hoogste |
| 50+ Mix: daguren, geen extreme randen | 0 extreem vroeg, 0 aflopers, 0 nachten | 2,8 extreem vroeg, 1,2 aflopers — wijkt af |
| Vrij weekend als RUST + RUST | 32 van de 32 vrije weekenden | ligt vast in de structuur (32/32) |
| Roostergemiddelde ≤ 40:00 | 7 van de 7 (39:12–39:59) | 59 van de 60 kandidaten; één rooster enkele minuten erboven |
| Nachtreeksen niet lineair; 3–6 | 3, 5, 5, 6 | zie Final-Brain-rapport |

## Waar ze afwijken — niet weggepoetst

1. **Extreem vroeg: Vroeg/Laat krijgt bij mensen relatief méér dan Vroeg.**
   Lift Vroeg/Laat 1,67 tegen Vroeg 1,23 (9 van de 26 extreem vroege diensten
   in een rooster van 10 regels). De opgegeven voorkeur zegt: de hoogste
   concentratie hoort bij Vroeg. Mogelijke verklaring: dekking (Vroeg heeft maar
   41 dienstdagen, waarvan 31 gematigd vroeg), of een bewuste verdeling van
   toeslagrijke vroegen. Het model volgt de opgegeven voorkeur; hoe ver dat van
   de menselijke verdeling afwijkt, wordt per rooster gerapporteerd.
2. **Rangeer: mensen concentreren, de zoekmachine spreidt.** Mix heeft 11 van de
   39 rangeerdiensten (variatiecoëfficiënt per regel 0,56); v1.0.4 en de baseline
   spreiden bijna gelijk (0,06). Hier staat de zoekmachine dichter bij de
   opgegeven eerlijkheidswens dan het menselijke rooster.
3. **Vrijdag vóór middernacht klaar: één menselijke uitzondering, en die botste met
   een andere voorkeur.** Mix regel 8 eindigt een nachtreeks van vijf op
   vrijdagnacht (klaar zaterdag 06:00), dan RUST, RUST, laat — precies de
   nachtuitgang die de menselijke roosters en de nachtvoorkeur willen. De
   letterlijke weekendeis verbood een nachtreeks die op vrijdag eindigt vóór een
   vrij weekend. **Besluit van de gebruiker (19 september 2026): de vrijdageis
   geldt niet voor nachtdiensten.** Dag- en late diensten (ook aflopers tot 01:00)
   moeten vóór 24:00 klaar zijn; een nachtreeks mag op vrijdagnacht eindigen.
4. **Vroeg/Laat voelt bij de zoekmachine niet als een gemengd rooster.** Mens: 19
   vroege en 15 late diensten. Baseline: 5 vroege en 29 late. De mens voldoet hier
   aan de voorkeur ("een gebalanceerd gemengd rooster"); de zoekmachine niet.
5. **Laat krijgt bij de zoekmachine meer vroege late diensten dan bij mensen**
   (9,6 tegen 6) en minder aflopers (14,5 tegen 18).
6. **Werkreeksen van 4–5 dagen:** bij mensen zijn de meeste werkreeksen 3 of 4
   dagen (door vaste RES-, WR-, CO- en R-dagen), zes dagen komt twee keer voor.
   De zoekmachine vult alleen dienstdagen en kan dit niet veranderen; het wordt
   gemeten en gerapporteerd, niet geoptimaliseerd.

## Wat de zoekmachine kan en niet kan veranderen

De rust-, WR-, CO- en RES-dagen liggen vast in de roosterstructuur. Daarmee
liggen ook vast: de lengte van werk- en rustreeksen, en of een vrij weekend
RUST + RUST is. De zoekmachine beslist wél welke dienst op welke dienstdag komt:
dus de klasse van elke dienst per profiel, de eindtijd van de vrijdagdienst vóór
een vrij weekend, en de uren per rooster.
