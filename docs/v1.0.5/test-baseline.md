# Testbasis bij de start van v1.0.5

*Fase 0. Opnieuw gemeten op 20 september 2026, niet overgenomen uit een eerder rapport.
Ruwe uitslag: `test-baseline.json` en `test-baseline.log`; de losse metingen van de
doorloop staan in `e2e-logs/`.*

## Uitslag

**18 van de 19 suites groen.** Eén suite is rood, en om een reden die geen defect is
(zie hieronder).

| Suite | Uitslag | Tijd |
| --- | --- | --- |
| Typecontrole, Codestijl, Eenheidstests (890 tests), Mutatietests | groen | 2 s / 32 s / 13 s / 87 s |
| Regels, Regeldekking, Roosteruren | groen | < 2 s |
| Kwaliteitsmodel, Roosterkwaliteit | groen (na hermeting, zie voetnoot 1) | 1 s |
| Profielen, Menselijke beoordeling, Scenario's, Structuurgeneratie | groen | 5 s / 1 s / 15 s / 1 s |
| Toegang per rol, Schermen | groen (na hermeting, zie voetnoot 2) | 20 s / 12 s |
| **Doorloop (e2e)** | **rood** — 377 controles geslaagd, 0 mislukt, 2 geblokkeerd | 760 s |
| Crashherstel | groen | 40 s |
| Productiebouw, Draagbare bundel | groen | 139 s / 33 s |

### De rode suite

De doorloop telt 71 gevraagde onderdelen; 69 zijn aangetoond. De twee die overblijven
zijn niet mislukt maar **niet te meten met het beschikbare materiaal**:

- *een dienstnummer met voorloopnul* — `BLOCKED_BY_MISSING_DATA`: zulke nummers zitten
  niet in het Dordrechtse pakket;
- *een echt PDF-dienstenpakket inlezen* — `BLOCKED_BY_MISSING_SOURCE`: er is nooit een
  PDF-dienstenpakket aangeleverd. Met `VERIFY_PAKKET_PDF` op het pad van zo'n document
  meet de route zichzelf.

De suite rekent "niet aangetoond" als rood, en dat blijft zo staan: het is een
dekkingsgat dat alleen NS kan sluiten door bronmateriaal aan te leveren.

### Voetnoot 1 — Kwaliteitsmodel en Roosterkwaliteit

Deze twee toetsen de nieuwste generatieopdracht in de database. Bij de eerste meting was
dat nog de opdracht van de doorloop van 19 september, met één losse nacht in kandidaat 2;
beide suites vielen daarop. Na de doorloop van vandaag staat er een nieuwe opdracht in de
database zonder losse nacht en zijn ze groen. Dat is geen herstelde fout maar een andere
meting: losse nachten zijn een zacht doel, en de toets is strenger dan het contract van
de zoekmachine. In de AFTER van de machinistenronde lag het aantal losse nachten op 0,23
per kandidaat tegen 0,13 in de baseline — niet significant, wel de verkeerde kant op. Dit
blijft een aandachtspunt voor v1.0.5, geen afgesloten zaak.

### Voetnoot 2 — Toegang per rol en Schermen

Beide hebben een draaiende ontwikkelserver op poort 3300 nodig. Die was er bij de eerste
meting niet (de server van de vorige sessie was gestopt), waardoor ze binnen een seconde
faalden. Met de server erbij zijn ze groen. De batterij markeert deze suites wel als
`server: true`, maar start zelf geen server; dat is een bruikbaarheidsgat in het
testharnas, geen productdefect.

## Wat hier verder uit blijkt

1. **De basis is gezond.** 890 eenheidstests, mutatietests, regelcontroles, productiebouw
   en de draagbare bundel zijn groen; de doorloop bewijst 377 controles op een echte
   omgeving inclusief crashherstel.
2. **Het testharnas heeft twee ruwe randen**: het start geen server voor suites die er een
   nodig hebben, en de crashproef laat soms Postgres-`io_worker`-processen achter die een
   poort bezet houden (apart voorgesteld als taak; vandaag geen last van gehad).
3. **Twee toetsen hangen aan databasestand**, niet aan code. Voor v1.0.5 is dat een
   aandachtspunt: een agent die zelf opdrachten start, verandert die stand.

## Wat dit betekent voor v1.0.5

- Elke fase eindigt met de volledige batterij **met draaiende server**, en met de
  e2e-dekking erbij.
- Nieuwe agenttests komen als eigen suite erbij; de bestaande 890 eenheidstests zijn de
  regressiebodem.
- De twee geblokkeerde routes blijven zichtbaar rood tot NS bronmateriaal levert.
