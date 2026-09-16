# NS Roosterplatform — Handleiding

*Versie bij oplevering: 6 september 2026 · Standplaats Dordrecht (DDR) · Simulatieomgeving*

## A. Wat is dit platform?

Het NS Roosterplatform is een roosterapplicatie voor de dagelijkse en jaarlijkse
planning van machinisten op standplaats Dordrecht. Het platform brengt vier
rollen samen op één plek: de **Rooster Commissie** die de basisroosters
samenstelt, **Dienstindeling** die de dagelijkse bezetting regelt, de
**medewerker** die zijn eigen rooster inziet en CAO-dagen aanvraagt, en
**Beheer** dat gebruikers, regels en systeemstatus bewaakt.

Het is opgezet als draagbare demonstratie- en beoordelingsomgeving: alles werkt
op echte Dordrechtse roosterdata (223 diensten, 67 medewerkers, 7
basisroosters), zonder dat er iets op een NS-server hoeft te draaien. De
volledige applicatie — inclusief database en rekenmotor — past op een
USB-stick.

## B. Wat kan het?

- **Basisroosters beheren** — roosterlijnen, bezetting, wachtlijsten en
  roosterversies per standplaats.
- **Roosterstructuur vastleggen** — regelaantallen per basisrooster instellen
  voor een nieuwe dienstregelingronde, met directe herberekening van de
  gevolgen.
- **Dienstenpakketten importeren** — een Excel-sjabloon downloaden, invullen en
  terugsturen; het systeem controleert, laat zien wat er verandert, en legt pas
  na bevestiging iets vast.
- **Genereren & simuleren** — de constraint-solver (CP-SAT) laat een compleet
  basisrooster doorrekenen op vijf scenario's, met een onafhankelijke
  eindvalidatie die elk voorstel nog eens langs de regels legt vóórdat het als
  roosterversie wordt vastgelegd.
- **Medewerkerroosters bekijken** — een echte maandagenda per medewerker,
  opgebouwd uit basisrooster, rotatie, tijdelijke plaatsing en operationele
  wijzigingen samen — niet een aanname, maar de werkelijke projectie.
- **CAO-dagen aanvragen** — met de echte regels: maximaal twee per jaar,
  minimaal zes weken vooruit, nooit twee aaneengesloten dagen.
- **Dienstindeling-overzichten** — bezetting per dag, openstaande diensten,
  reservevoorstellen met uitleg waarom een kandidaat wordt voorgesteld.
- **Exports** — een dagplanning als overzichtelijk Excel-bestand, en het
  officiële NS-roosterblad als PDF, in de bestaande NS-opmaak.
- **Regels & kaders** — een volledig overzicht van elke CAO- en beleidsregel,
  waar hij vandaan komt, en of NS hem al formeel heeft bevestigd.
- **Portable demonstratie** — start, gebruik en sluit af vanaf een USB-stick,
  zonder installatie op de ontvangende computer.

## C. Wat kan elke rol?

### Medewerker

**Ziet:** eigen rooster, eerstvolgende diensten, beschikbare diensten om te
ruilen of over te nemen, meldingen, CAO-dagen, kwartaalfeedback,
reservevoorkeur (alleen voor wie op een reserverooster staat), en de
regelcatalogus.

**Kan:** een dienst overnemen of ruilen, CAO-dagen aanvragen en intrekken,
kwartaalfeedback geven, reservevoorkeur opgeven.

**Bewust buiten bereik:** roosters van collega's inzien, iets aan de
roosterstructuur wijzigen, een dienst toewijzen aan zichzelf zonder de
reguliere procedure.

### Dienstindeling

**Ziet:** dagelijkse bezetting (per dag, niet alleen een totaal), openstaande
diensten, medewerkerroosters van de eigen standplaats, reservevoorstellen met
score en toelichting, ruilverzoeken ter informatie.

**Kan:** een openstaande dienst bij reserve laten proberen en pas daarna
openstellen voor medewerkers, een medewerker tijdelijk in een ander rooster
plaatsen (de permanente plaatsing blijft daaronder doorlopen), de dagplanning
exporteren.

**Bewust buiten bereik:** de structuur van een basisrooster wijzigen, een
rooster genereren of publiceren — dat is werk van de Rooster Commissie, en
Dienstindeling heeft daar geen recht toe.

### Rooster Commissie

**Ziet:** alle basisroosters en hun bezetting, dienstenpakketten,
roosterprofielen, gegenereerde scenario's met kwaliteitsscore en
validatie-oordeel, feedback geaggregeerd per profiel.

**Kan:** een dienstenpakket importeren (Excel of PDF) en na controle
activeren, regelaantallen per basisrooster voorstellen voor een nieuwe
dienstregelingronde, een roosteropdracht laten genereren en het resultaat laten
valideren, een goedgekeurde versie publiceren, het roosterblad exporteren.

**Bewust buiten bereik:** publiceren zolang het regelbestand niet formeel door
NS is bevestigd — die knop bestaat in deze fase niet, juist om te voorkomen dat
hij ooit per ongeluk wordt ingedrukt.

### Beheer

**Ziet:** gebruikers en rollen, organisatiestructuur (standplaatsen),
systeemstatus, volledige technische regelbronnen (per regel: laag, bron,
status, wie hem bevestigd heeft), auditlog van gevoelige handelingen.

**Kan:** rollen toekennen, standplaatsen in- of uitschakelen, de technische
staat van het regelbestand inzien en filteren.

**Bewust buiten bereik:** roosterinhoud wijzigen — Beheer bestuurt wie toegang
heeft en bewaakt de regelbronnen, maar plant niet zelf.

## D. Stap voor stap

1. **Aanmelden** — met personeelsnummer en wachtwoord op het aanmeldscherm.
2. **Uw rol herkennen** — de zijbalk en het dashboard tonen automatisch de
   omgeving die bij uw rol hoort.
3. **Een dienstenpakket gebruiken of uploaden** *(Rooster Commissie)* — onder
   Dienstenpakketten het sjabloon downloaden, invullen (kolommen Dag,
   Dienstnummer, Diensttijd) en terugsturen; eerst wordt alleen gecontroleerd,
   pas na bevestiging wordt het vastgelegd.
4. **Roosters bekijken of structuur aanpassen** — Basisroosters toont elke
   roosterlijn en bezetting; onder Regelaantallen voorstellen kan de Rooster
   Commissie voor een nieuwe dienstregelingronde een ander aantal regels
   doorrekenen.
5. **Genereren & simuleren** *(Rooster Commissie)* — kies een scenario en een
   roosterjaar, en start de opdracht. Het resultaat is altijd een van vier
   eerlijke uitkomsten: gegenereerd, afgewezen (met de exacte reden),
   geblokkeerd, of een technische fout — nooit een placeholder.
6. **Medewerkerroosters of dagplanning bekijken** *(Dienstindeling)* — een
   medewerker kiezen toont direct de echte agenda; de bezettingskaarten per dag
   linken door naar de openstaande diensten van die specifieke dag.
7. **Exporteren** — een dagplanning als Excel (primair) of CSV (technisch), of
   het roosterblad als PDF.
8. **Portable gebruiken** — zie hoofdstuk G hieronder.

## E. Waarom dit waardevol is

Roosterlogica die nu verspreid zit over Excel-bladen, mondelinge afspraken en
losse documenten, staat hier op één plek: controleerbaar, herleidbaar naar de
regel waar hij vandaan komt, en reproduceerbaar — dezelfde invoer levert altijd
dezelfde uitkomst op. Elke beslissing van de rekenmotor wordt onafhankelijk
nagerekend vóórdat hij zichtbaar wordt, en elke afwijzing komt met de precieze
reden, nooit met een kaal "kan niet". Dat maakt het platform bruikbaar voor een
demonstratie, voor beoordeling door de Rooster Commissie en Dienstindeling zelf,
en voor de volgende, formele stap richting NS.

## F. Eerlijke afbakening

**Softwarematig gereed:** alle bovenstaande functies werken end-to-end op
echte Dordrechtse data en zijn met geautomatiseerde en handmatige controles
bewezen (668 geautomatiseerde tests, ruim 250 losse praktijkcontroles, een
draagbare bundel die start, herstart en een harde stop overleeft).

**Afhankelijk van formele NS-validatie:**
- 0 van de 71 regels is formeel door NS bevestigd; alles wat in deze omgeving
  gebeurt, is een simulatie, zichtbaar gemarkeerd, en niet bindend.
- Voor 10 regelpakketten ontbreekt nog de formele bevestiging, waaronder de
  Arbeidstijdenwet en het Arbeidstijdenbesluit vervoer.

**Bewust niet gebouwd:**
- Een knop om een roosterversie te publiceren zolang het regelbestand niet is
  bevestigd — die bestaat expres niet.
- Een medewerker-herverdelingsbeleid voor het direct doorvoeren van een nieuwe
  roosterstructuur op een lopend rooster — dat is een beleidskeuze voor de
  Rooster Commissie, niet iets wat de software mag aannemen.

**Blocked by missing source:**
- Import van het dienstenpakket als Word-document (DOCX): de aangeleverde
  bron ontbreekt op dit moment.
- Enkele CAO-bepalingen (bijvoorbeeld de feestdagenregeling) wachten op een
  aangeleverde feestdagenkalender of een verlofmodule die nog niet bestaat.

**Governance, geen softwaretaak:** beveiligingsbeoordeling, een DPIA, en
aansluiting op NS-inlogvoorzieningen (SSO) horen bij het vervolgtraject en zijn
geen onderdeel van deze oplevering.

## G. Portable — starten vanaf een USB-stick

Zie `dist/NS-Roosterplatform-Portable/LEESMIJ.txt` voor de volledige,
zelfstandige instructies die met de bundel meegaan. Kort samengevat:

1. **Kopiëren** — zet de map `NS-Roosterplatform-Portable` op de USB-stick of
   een andere computer. De hele map, inclusief alle submappen.
2. **Starten** — dubbelklik op `Start NS Roosterplatform.bat`. De eerste keer
   duurt dit ongeveer een minuut: de database wordt aangemaakt en gevuld met
   demonstratiegegevens.
3. **Gebruiken** — de browser opent vanzelf op `http://127.0.0.1:3300`. Meld u
   aan met een van de testaccounts (zie `LEESMIJ.txt`).
4. **Veilig afsluiten** — sluit het venster of dubbelklik op
   `Stop NS Roosterplatform.bat`. Dit zorgt dat de database netjes wordt
   afgesloten vóórdat u de stick verwijdert.
5. **Opnieuw starten** — dubbelklik gewoon opnieuw op het startbestand. Alle
   wijzigingen van de vorige keer staan er nog; de demonstratiegegevens worden
   niet opnieuw ingeladen.
6. **Meenemen** — de hele map is zelfstandig: geen installatie, geen
   internetverbinding, geen software die al op de ontvangende computer moet
   staan. Alleen bereikbaar vanaf die computer zelf (niet over het netwerk).

Let op: dit is een demonstratieomgeving. Zet er geen echte persoonsgegevens in
zolang de beveiliging niet formeel is beoordeeld — de gegevens staan
onversleuteld op de schijf en gaan mee met de stick.
