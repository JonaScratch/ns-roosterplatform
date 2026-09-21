# M0 — de nulmeting

*Gemeten 21 september 2026, vóór enige ontwikkeling aan de intelligentiefuncties.
Methodiek en acceptatiecriteria zijn vastgelegd in `../../benchmark-methodology.md` en
`../../acceptance-criteria.json`, vóór deze meting. Ruwe uitkomsten: `engine.json` en
`intelligence.json`.*

## Spoor A — het roosterbrein

Gemeten op de fase `mp-after`: twintig runs (10 Evenwichtig, 5 Rust & regelmaat,
5 Eerlijke lasten) met de zoekmachine `adaptive-1.0.4-machinist`, het profiel dat nu
standaard draait. Die runs zijn van 19 september; de enginecode is sindsdien niet
gewijzigd, wat de vingerafdrukken in `baseline-manifest.json` aantonen. Twintig
identieke runs opnieuw draaien zou twee uur rekenen zijn voor dezelfde uitkomst. Zodra
de engine verandert, wordt er wél opnieuw gedraaid — dat is wat M1 tot en met M3 doen.

**Hard, per kandidaat:**

| Maat | Uitkomst |
| --- | --- |
| Hard geldig | 60 van 60 |
| Volledige dekking (223 diensten) | 60 van 60 |
| Geen profielbreuk | 60 van 60 |
| Operationele eisen (40:00, vrijdag) | 60 van 60 |

**Zoekinspanning:** 277 s per run (waarvan 154 s solver), 118 zoekpogingen in totaal,
23 aangenomen reparaties tegen 19 afgewezen, en 29 verschillende structuurfamilies over
60 kandidaten — dus de kandidaten zijn niet louter varianten van hetzelfde rooster.

**Kwaliteit (gemiddelde over 60 kandidaten, officieel rooster ter vergelijking):**

| Maat | M0 | Officieel |
| --- | --- | --- |
| Robuust (model v2) | 84,4 | 83,5 |
| Robuust (model v3) | 81,4 | 82,4 |
| Voorkeur (v3) | 73,9 | 81,4 |
| — affiniteit | 65,4 | 68,6 |
| — geen restbak | 72,5 | 81,8 |
| — dagdiensten volgens verhouding | 55,3 | 78,7 |
| — populair eerlijk | 92,1 | 94,3 |
| — weekendbegin | 92,9 | 93,1 |
| Nachten (v2) | 90,0 | 98,9 |
| Rust | 82,7 | 79,4 |
| Uren | 89,6 | 83,9 |
| Eerlijkheid | 85,0 | 66,9 |
| Regelmaat | 95,5 | 88,7 |
| Slechtste regel (v2) | 80,4 | 68,2 |
| Losse nachten per kandidaat | 0,23 | 0 |
| Slechtste nachtuitgang | 45,0 | 100 |
| Kortste herstel na nachten | 48,0 u | 56,0 u |
| Rangeerspreiding (CV, lager = gelijker) | 0,07 | 0,52 |

Het beeld is hetzelfde als aan het eind van v1.0.4: de zoekmachine wint op uren,
eerlijkheid, regelmaat en de slechtste regel; het menselijke rooster wint op nachten,
voorkeur en de verdeling van dagdiensten. Dat verschil is het werkterrein van v1.0.5.

## Spoor B — de AI-agent

**Er is nog geen agent.** De testset telt 32 opdrachten in tien categorieën (A tot en
met J), waarvan negen als *holdout* zijn gemarkeerd: die worden tijdens de ontwikkeling
niet gebruikt om bij te sturen. Alle 32 staan op `NIET_GEIMPLEMENTEERD` — geen nul, geen
fout, maar "hier is nog niets".

| Categorie | Tests | M0 |
| --- | --- | --- |
| A Roostercontext | 4 | niet geïmplementeerd |
| B Uitleg van diensttoewijzingen | 3 | niet geïmplementeerd |
| C Regelkennis | 4 | niet geïmplementeerd |
| D Machinistentaal | 4 | niet geïmplementeerd |
| E Geheugen | 3 | niet geïmplementeerd |
| F Optimalisatiebegrip | 3 | niet geïmplementeerd |
| G Technisch inzicht | 2 | niet geïmplementeerd |
| H Zelfstandig onderzoeken | 2 | niet geïmplementeerd |
| I Veiligheid | 4 | niet geïmplementeerd |
| J Gesprekskwaliteit | 3 | niet geïmplementeerd |

Wat wél al werkt en de meetlat betrouwbaar maakt: van de acht deterministisch
controleerbare tests kon de verwachting voor alle acht uit de database worden berekend.
De agent zal dus tegen echte gegevens worden afgerekend, niet tegen ingetypte
antwoorden. Voorbeelden van die verwachtingen:

- Laat, regel 4: maandag reserve, dinsdag rust, woensdag dienst 112 (11:57–18:41),
  donderdag dienst 107 (13:43–22:28), vrijdag WR, weekend rust.
- Rangeerdiensten per rooster: Mix 11, BLM 7, Laat/Nacht 6, Laat 5, Vroeg 5,
  Vroeg/Laat 3, 50+ Mix 2.
- Dagelijkse rust: 12 uur, bron CAO NS 2024–2025, juridische status **niet bevestigd**.
- Herstel na nachtreeks: 46 uur, zelfde bron en status.

## Wat M0 blootlegt

1. **Het hoofdscenario van de werkopdracht kan feitelijk niet worden beantwoord.** "RET"
   komt in dit dienstenpakket nergens voor: niet in dienstcodes, niet in omschrijvingen,
   en niet als dienstsoort (die zijn VROEG, LAAT, NACHT, RANGEER, RESERVE). Correct
   gedrag van de agent is dus een gerichte verduidelijkingsvraag. De testset legt dat zo
   vast (item B2). Zonder uitleg van de gebruiker kan er geen feitelijk antwoord komen.
2. **De regelkennis bestaat al als gegevens, maar niet als vaardigheid.** Regels hebben
   bron, document, artikel en juridische status; er is alleen nog niets dat ze op een
   menselijke vraag kan toepassen.
3. **Er zijn geen menselijke oordelen.** Nul regeloordelen, nul paarvergelijkingen. De
   derde kwaliteitssoort uit de methodiek — werkelijke menselijke beoordeling — is
   daarmee bij M0 leeg, en dat blijft zo tot de commissie het scherm gebruikt.
4. **De engine haalt de operationele eisen nu overal**, maar de voorkeurslaag staat nog
   ver van het menselijke rooster (73,9 tegen 81,4), vooral op dagdiensten (55 tegen 79).
