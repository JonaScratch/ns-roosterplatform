# Machinistenvoorkeur — ontwerp (stap 5)

*Geschreven ná de metingen van stap 1–4 (`human-vs-preference.md`, `measure-before.json`)
en vóór enige A/B. De beslisregels staan in `decision-rules.json` en zijn vastgelegd
vóór de eerste uitslag.*

## Drie lagen, nooit door elkaar

| Laag | Vraag | Waar | Bronstatus |
| --- | --- | --- | --- |
| Profielgeschiktheid | Mag deze dienst in dit profiel? | `roster-profiles.ts`, hard in CP-SAT, bijschaven en evaluator (ongewijzigd) | platform |
| Profielaffiniteit | Hoe goed past een toegestane dienst bij dit profiel? | `profile-affinity.ts`, zacht | `MACHINIST_PREFERENCE` / `HUMAN_DOMAIN_INPUT` |
| Pakketeerlijkheid | Is de verdeling van populaire, zware en toeslagrijke diensten eerlijk? | kwaliteitsmodel v3, onderdeel *voorkeur* en *eerlijkheid* | `MACHINIST_PREFERENCE` |

Daarnaast, apart: de **operationele ontwerpeisen** van de gebruiker
(`USER_PROVIDED_OPERATIONAL_DESIGN_REQUIREMENT`, `operational-requirements.ts`).

## Harde laag (gebouwd, getest)

1. **Roostergemiddelde ≤ 40:00.** Platformsemantiek (`rosterHours`, roosterblad):
   dienstduur einde − begin (pauze inbegrepen, zoals de bladen), + 8:00 per RES,
   WR (WTV) en CO, R = 0; weekgemiddelde in hele minuten naar beneden afgerond.
   Dus: totaal < 2401 × cyclusweken. Een losse regel mag erboven. Hard in CP-SAT
   (lineaire bovengrens per basisrooster), bij elke ruil van het bijschaven
   (bijgehouden roostercredit) en in de harde geldigheid van model v3.
2. **Vrijdag vóór een vrij weekend uiterlijk 23:59 klaar**, behalve een
   nachtdienst (besluit gebruiker 19-09-2026). Vrij weekend = zaterdag én
   zondag zonder dienst en zonder reserve. In CP-SAT wordt zo'n combinatie niet
   eens als variabele aangemaakt (net als een profielbreuk).
3. **Vrij weekend = RUST + RUST.** Ligt vast in de structuur; gecontroleerd en
   gemeld, geen afwijzing (Dordrecht: 32 van 32).

Toetsen: `tests/domain/operationele-eisen.test.ts` (16),
`tests/optimizer/operationele-eisen-solver.test.ts` (10; drie daarvan tonen dat de
oplosser zónder de eis de andere kant op gaat).

Gemeten vóór het ontwerp: het officiële rooster voldoet volledig (0 overtredingen).
Van de 60 baseline-kandidaten voldoen er 4; van v1.0.4 geen enkele.

## Zachte laag: kwaliteitsmodel v3

Versie 2 blijft ongewijzigd (Final-Brain-metingen moeten na te rekenen blijven).
Versie 3 = versie 2 plus:

### Nieuw onderdeel *voorkeur* (gewicht 0,15; totaal genormaliseerd)

`weighted()` deelt door de som van de gewichten; v1 en v2 hebben dit onderdeel
niet (score null) en rekenen dus exact als voorheen.

| Deel | Gewicht | Maat |
| --- | --- | --- |
| affiniteit | 0,30 | gemiddelde dienstaffiniteit (voorkeur 1, neutraal 0,6, minder 0,2) |
| restdiensten | 0,15 | 1 − het grootste aandeel "minder passend" in één rooster: geen rooster als restbak |
| dagdiensten | 0,20 | 1 − totale-variatieafstand tussen werkelijke en beoogde verdeling van dagachtige diensten |
| populair eerlijk | 0,20 | krijgt elk geschikt rooster minstens de helft van het gemiddelde per regel aan aflopers en extreem vroege diensten? |
| weekendbegin | 0,15 | eindtijd van de vrijdagdienst vóór een vrij weekend, met afnemende meeropbrengst |

**Dagdiensten** (dagachtig vroeg: begin ≥ 09:00; vroege late: einde < 21:00).
Relatieve gewichten van de gebruiker: Laat 10, Vroeg/Laat/Nacht 20, Vroeg/Laat 20,
BLM 20, Laat/Nacht 10, 50+ Mix 40. *Geen percentages*: per concrete dienst
genormaliseerd over de **profielen** die hem mogen rijden: rooster r krijgt verwacht
`w_r / Σ w` van die dienst.

*Correctie tijdens het ontwerp.* De eerste versie van dit stuk koos "per regel"
(gewicht × aantal regels) en schreef dat beide normaliseringen even ver van het
menselijke rooster liggen (0,20 tegen 0,22). Dat getal was niet op alle dagachtige
diensten berekend. Gemeten (`assumption-sensitivity.json`): per profiel 0,213, per
regel 0,246 — per profiel ligt dichter bij het menselijke rooster, en het is de
letterlijke opdracht. Daarom per profiel.

Aanname, zichtbaar gemaakt: *Vroeg ontbreekt* in de opgave. Aanname: 10, gelijk aan
Laat — Vroeg kiest voor vroeg beginnen én vroeg eindigen, een dienst vanaf 09:00 is
daar het spiegelbeeld van de vroege late voor Laat. Gevoeligheid: 0 en 20.

De affiniteitstabel volgt dezelfde volgorde (verhouding tot het hoogste gewicht:
1 = voorkeur, ½ = neutraal, ¼ = minder). Gewijzigd t.o.v. de eerste tabel:
Vroeg/Laat en Mix vroege late → neutraal (was voorkeur), Laat/Nacht vroege late →
minder, Vroeg dagachtig vroeg → minder.

**Populair eerlijk.** "Geschikt" = het profiel mag de dienst rijden én de
affiniteit is niet "minder". Daardoor telt 50+ Mix niet mee voor aflopers en
extreem vroeg (het menselijke rooster geeft 50+ Mix er nul van; dat is de enige
bron). De vloer "de helft van het gemiddelde" is een ontwerpkeuze; gevoeligheid
0,33 en 0,67 wordt gerapporteerd.

**Weekendbegin.** `1 − 0,3 × ((einde − 17:00) / 6 u)^1,5` tussen 17:00 en 24:00;
vóór 17:00 = 1; geen dienst op vrijdag = 1; een nachtdienst (uitgezonderd) krijgt
de waarde van 23:59 — de nachtreeks zelf wordt bij *nachten* beoordeeld. 17:00 tegen
23:00: 0,30 verschil; 21:45 tegen 22:00: 0,017.

### Nachten: ritme min belasting

`nights.blocks` rekent met `nightBlockWorth` (`night-rhythm.ts`): 1 → 0, 2 → 0,35,
3 → 0,70, 4 → 0,85, 5 → 0,95, 6 → 0,95, 7 → 0,70. Versie 2 gaf drie nachten 0,90;
de machinisteninvoer zegt "vaak net niet lekker". Het officiële rooster heeft één
reeks van drie en verliest daardoor iets; dat wordt gerapporteerd.

### Regelscore

Versie 3 telt de gemiddelde affiniteit van een regel mee (gewicht 0,15 naast uren,
regelmaat, rust en nachten): een regel vol restdiensten is een slechte regel.

### Wat bewust níet in de score gaat

- **Werkreeksen van 4–5 dagen en aaneengesloten rust**: liggen vast in de structuur
  (R, WR, CO, RES). De zoekmachine kan ze niet veranderen; een score erop verschuift
  alle kandidaten evenveel. Gemeten en gerapporteerd.
- **Toeslagen**: geen ORT-regels in het platform. Blootstelling (CAO-nachtvenster,
  weekendminuten) alleen als proxy in de diagnostiek, nooit als bedrag.
- **Extreem-vroeg-stap**: eerst als diagnose; alleen in de score als de A/B toont dat
  het nodig is (de vorige ronde verwierp een richtingsafhankelijke drempel op twee
  voorbeelden).

## CP-SAT

Pas ná de wisselkoersen (uitbreiding van `objective-exchange-rates`):
- `profileAffinity`: kosten per plaatsing `(1 − affiniteit) × 10 × gewicht`;
- `dayDutyTarget`: afwijking van de verwachte aantallen per rooster;
- eventueel `nightTriple` (reeks van drie).
Gewicht via pariteit met het model; A/B met vijf zaden (zoals R1).

## A/B-volgorde

1. **M1** = profiel `rhythm` + harde laag (model v2 in de rangschikking). Kosten van de eisen.
2. **M2** = M1 + model v3 in rangschikking en bijschaven.
3. **M3** = M2 + CP-SAT-termen (gewicht uit de solver-A/B).
4. AFTER: 20 runs (10 Evenwichtig, 5 Rust & regelmaat, 5 Eerlijke lasten), zelfde
   benchmark en zaden als de baseline (`brain-after`).
