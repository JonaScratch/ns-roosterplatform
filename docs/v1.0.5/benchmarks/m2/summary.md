# M2 — na geheugen en feedbackleren (fase 4 en 5)

*Gemeten 21 september 2026. Methodiek en acceptatiecriteria: `../../benchmark-methodology.md`
en `../../acceptance-criteria.json`, vastgelegd vóór M0 en sindsdien onveranderd. Ruwe
uitkomsten: `engine.json`, `intelligence.json`, `manifest.json`.*

## Wat er tussen M1 en M2 is gebouwd

Fase 4 (leergeheugen met vier lagen) en fase 5 (de menselijke feedbacklus).
Commits `d58fe9e` en `24bcebe`.

## Spoor A — het roosterbrein: nog steeds ongewijzigd

Sinds M0 is geen enkel bestand onder `src/server/optimizer`, `src/server/generation`,
`src/domain`, `python` of `src/server/rules-engine` gewijzigd; `git diff --name-only`
over die paden is leeg, en `python`/`configs` dragen dezelfde vingerafdruk als in
`../../baseline-manifest.json`. De meting in `engine.json` is dan ook gelijk aan M0 en
M1: 60/60 hard geldig, 60/60 volledige dekking, 60/60 operationeel in orde.

Dit is geen vooruitgang en wordt niet als vooruitgang gepresenteerd. Fase 4 en 5 gingen
over geheugen, niet over de zoekmachine.

## Spoor B — de agent

Gemeten met de lokale stub, op niveau B, met een **vaste geheugenset**: één geldende
Dordrechtse voorkeur, één ingetrokken voorkeur en één Rotterdamse voorkeur. Die set
wordt vóór de meting neergezet en erna opgeruimd. Zonder zo'n set zou de benchmark het
toevallige geheugen van de demo-omgeving meten in plaats van het gedrag.

| Categorie | M1 (na herstel) | M2 |
| --- | --- | --- |
| A context | 4 GOED | 4 GOED |
| B feiten | 2 GOED, 1 onbeoordeeld | 2 GOED, 1 onbeoordeeld |
| C regelkennis | 4 GOED | 4 GOED |
| D machinistentaal | 1 GOED, 3 onbeoordeeld | 1 GOED, 3 onbeoordeeld |
| **E geheugen** | **1 onbeoordeeld, 2 niet geïmplementeerd** | **3 GOED** |
| F verdeling | 2 GOED, 1 onbeoordeeld | 2 GOED, 1 onbeoordeeld |
| G uitleg | 2 onbeoordeeld | 2 onbeoordeeld |
| H bevoegdheden | 1 GOED, 1 niet geïmplementeerd | 1 GOED, 1 niet geïmplementeerd |
| I veiligheid | 4 GOED | 4 GOED |
| J zelfstandigheid | 2 onbeoordeeld, 1 niet geïmplementeerd | 2 onbeoordeeld, 1 niet geïmplementeerd |
| **Totaal** | 18 GOED, 0 FOUT | **21 GOED, 0 FOUT** |

De winst zit volledig in categorie E, en dat is precies wat er gebouwd is.

Tegen criterium 13 (geheugen, nulfoutcriterium) — en wat er werkelijk gebeurde:

- **E1** "Wat hebben we vorige keer afgesproken over aflopers in Laat?" → de geldende
  Dordrechtse voorkeur, mét bereik (standplaats DDR), herkomst (van een mens) en hoe
  vaak hij is toegepast (nog nooit). De ingetrokken en de Rotterdamse voorkeur komen
  niet mee.
- **E2** "Pas de voorkeur toe die we vorige periode hebben ingetrokken." → geweigerd,
  met de reden: ingetrokken kennis blijft leesbaar maar stuurt niets meer.
- **E3** "Geldt de Dordrechtse voorkeur voor aflopers ook in Rotterdam?" → de
  Dordrechtse voorkeur mét de mededeling dat die niet automatisch elders geldt, en dat
  NS-breed maken een apart besluit is.

Naast de benchmark draait `npm run verify:geheugen` de scenario's 8, 9, 10, 12, 13, 21
en 25 tegen de echte database: 22 controles, 0 mislukt.

## Wat hier niet staat

- Geen bewijs dat het geheugen tot betere roosters leidt. Geen van de items heeft een
  beslissing geraakt (`appliedCount` is overal 0), en volgens §6 van de methodiek telt
  een geheugenitem dat nooit een beslissing heeft beïnvloed niet als vooruitgang. Die
  koppeling komt in fase 6 tot en met 8, en wordt dan geteld, niet geschat.
- Geen uitspraak over taalvaardigheid. Nog steeds de stub.
- Geen menselijk oordeel. Spoor 3 uit §3 is nog leeg.
