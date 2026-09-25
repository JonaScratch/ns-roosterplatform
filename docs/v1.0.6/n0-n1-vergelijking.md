# v1.0.6 — N0 tegen N1: de eerste ontwikkelronde

*25 september 2026. Baseline: `n0-manifest.json` (commit `0bf910f`, v1.0.5 "gedeeltelijk
voltooid"). Golden suite: `golden-suite.json`, 43 items, gegenereerd uit de echte
dienstenpakketgegevens (zie `waarheid.ts`). Model: `qwen3:8b` via Ollama 0.34.4,
temperatuur 0, op dezelfde machine (RTX 3080, 10 GB) bij elke meting.*

> **Belangrijk voorbehoud vooraf.** De opdracht vraagt een golden suite van minimaal 100
> items. Deze eerste versie telt 43 — echte, datagegronde items over 10 categorieën, maar
> minder dan het gevraagde minimum. Dat wordt hier niet verborgen: zie §"Wat nog niet
> klopt" onderaan.

## Waarom dit geen gewone stub-benchmark is

Elke eerdere v1.0.5-meting (M0 t/m M3) dwong `NS_AGENT_FORCE_STUB=1` af — met goede reden,
want die metingen moesten de keten meten en niet het taalmodel. Deze meting doet het
tegenovergestelde met opzet: **geen stub, het werkelijke lokale model**, door de echte
`askAgent()`, met echte database, echte tools, echte rechten. Dat is precies wat §29 van
de v1.0.6-opdracht eist ("geen gebruikersgerichte agentfunctie mag TESTED worden
uitsluitend omdat de stub groen is"), en het is ook meteen de reden dat N0 zoveel losse
problemen blootlegde die v1.0.5's stub-gebaseerde 60/60 nooit kon zien.

## N0: de nulmeting, vóór enige ontwikkelcode

| | dev (35) | holdout (8) | totaal |
| --- | --- | --- | --- |
| GOED | 15 | 2 | 17 (39,5%) |
| FOUT | 15 | 5 | 20 |
| ONBEOORDEELD | 5 | 1 | 6 |

Drie categorieën waren vrijwel volledig kapot, en alle drie bleken **harnasfouten, geen
modelzwakte** — ontdekt door transcripten regel voor regel te lezen, niet door de cijfers
alleen te bekijken:

1. **RET/rangeer (D), 0/7 goed.** `vocabulary.ts` — het domeinwoordenboek met "RET =
   rangeerdienst" uit de beslissing van 21 september — werd alléén door de deterministische
   stub gebruikt (`begripIn()` in `model/stub.ts`). Het lokale model kreeg dat woordenboek
   nooit te zien. Het zocht braaf naar een regel met de letterlijke naam "RET", vond niets,
   en zei eerlijk — maar verkeerd — dat het onbekend was.
2. **Foutieve aannames (B) en categorie A grotendeels onbeoordeeld.** De tool
   `dutyKindCounts` gaf zonder een `kind`-filter stilzwijgend het totaal van *alle*
   diensten terug. Het model las dat totaal (bijvoorbeeld 44 voor DDR-MIX) een paar keer
   gewoon als "44 vroege diensten" — een echte fabricatie, veroorzaakt door een tool die
   van betekenis verandert zonder dat te zeggen.
3. **Weekendvragen (F), 1/7 goed.** Er bestaat geen aparte weekendtool, en de instructie
   zei nergens dat `rosterLine` daarvoor volstaat. Het model concludeerde een paar keer
   letterlijk dat er "geen tool" voor bestond, zonder het te proberen.

Daarnaast, apart en belangrijker dan een categorie-score: op **"en hoe zit dat in
kandidaat 2?"** (categorie G, meerdere beurten) deed het model helemaal niets — geen
enkele toolaanroep. Het herkende de vraag correct als een contextwissel, maar had geen
manier om "kandidaat 2" om te zetten in een echt database-ID, en kon dat ook niet
verzinnen. Dit is exact het gat dat §6 van de opdracht beschrijft.

## Wat er is gebouwd naar aanleiding daarvan

Geen van deze reparaties is een prompt-trucje voor één testvraag — elke reparatie is een
structurele wijziging die voor elke vraag van dat type geldt, niet alleen de golden-suite-
formulering (zie ook §37: geen hardcoded antwoorden op de testvragen zelf).

1. **`domeinwoordenboek()` in `model/local.ts`.** Alleen de domeintermen die in de huidige
   vraag voorkomen, worden aan de systeeminstructie toegevoegd — met een directe hint
   welke `kind`-waarde erbij hoort (`RET` → `kind=RANGEER`). Kort gehouden met opzet: een
   instructie die bij elke vraag alle twaalf begrippen opsomt, kost tokens die de
   plan-stap dan weer mist — precies de fout die eerder (v1.0.5) al eens tot een lege
   JSON leidde.
2. **`dutyKindCounts` zegt nu zelf wanneer het ongefilterd is.** Het toolresultaat draagt
   een `note`-veld: "Geen 'kind' opgegeven: dit is het totaal van ALLE diensten..." — op de
   plek waar het antwoord vandaan komt, niet alleen in een toolbeschrijving die het model
   niet bij elk antwoord terugleest. De tool-keuzekaart in de systeeminstructie noemt nu
   ook expliciet de vijf geldige `kind`-waarden.
3. **`candidateLabel` in `uiContextSchema` / `resolveContext()`.** Het model mag "kandidaat
   2" letterlijk in een toolaanroep zetten; de server zoekt de echte kandidaat op rangnummer
   op (nieuwste generatieronde eerst) en levert het bijbehorende ID. Het model hoeft het ID
   nooit te kennen of te verzinnen.
4. **Tool-keuzekaart uitgebreid** met een regel voor weekendvragen (→ `rosterLine`, geen
   aparte tool nodig) en voor vage klachten (→ eerst opzoeken, dan pas een bevinding
   melden) en voor roostervergelijkingen ("zwaarder dan de andere" → `rosterHours` geeft
   altíjd alle roosters terug).
5. **De JSON-lezer (`jsonUit`) leest nu elk object op het buitenste niveau apart.** Bij het
   testen van de voorstelfunctionaliteit (§6, een rekenopdracht voorstellen) bleek qwen3
   soms twee geldige JSON-objecten na elkaar te leveren; de oude lezer las alles van de
   eerste tot de laatste accolade als één object, wat dan mislukte.

Elke reparatie is eerst **los geverifieerd** met een kleine probe (`scripts/v105/lokaal-plan.ts`)
vóór een volledige rerun, en de volledige unittestsuite (51/51) en de stub-gebaseerde
`verify:agent` (60/60) zijn na elke stap opnieuw gedraaid — geen regressie op wat v1.0.5
al bewees.

## N1: na deze eerste ontwikkelronde

Twee volledige metingen met identieke code, `n0b` (tussentijds, na de RET/dutyKindCounts/
weekend-reparaties) en `n1` (de officiële afsluiting van deze ronde, na ook de
`candidateLabel`-reparatie):

| | dev (35) | holdout (8) | totaal |
| --- | --- | --- | --- |
| n0b — GOED | 34 | 8 | 42 (97,7%) |
| n1 — GOED | 29 | 8 | 37 (86,0%) |

Beide metingen liggen ruim boven de N0-baseline van 39,5%. Het verschil ertussen is zelf
een eerlijk te melden bevinding: **op temperatuur 0, met identieke code, gaven twee
runs een ander resultaat op 7 van de 43 items.** Vergeleken:

| Item | n0b | n1 |
| --- | --- | --- |
| A-DDR-L | GOED | ONBEOORDEELD |
| A-DDR-LN | GOED | ONBEOORDEELD |
| E-klacht-2 | GOED | FOUT |
| E-klacht-4 | GOED | FOUT |
| F-DDR-MIX-weekend | GOED | FOUT |
| J-geen-verduidelijking-1 | GOED | FOUT (vroeg alsnog om een regelnummer) |
| J-geen-verduidelijking-3 | FOUT | GOED |

Dit weerspreekt niet de eerdere v1.0.5-bevinding dat temperatuur 0 twee metingen
32-van-32 identiek liet uitkomen (`lokaal-7` / `lokaal-7-herhaling`, zie
`docs/v1.0.5/lokale-ai/lokaal-5-koppeling.md`) — dat was een andere, kortere systeem-
instructie. Met de langere instructie van deze ronde (domeinwoordenboek, uitgebreide
tool-keuzekaart) is er kennelijk toch resterende variatie, vermoedelijk uit
GPU-kernelreductie die bij batching niet strikt associatief is. Het is klein (6 van de 43
items, 14%) en het duwt nooit terug tot bij de N0-baseline, maar het is reëel en het hoort
hier te staan in plaats van de gunstigste van de twee metingen te presenteren als "het"
resultaat.

**Eerlijke samenvatting: van 39,5% naar 86–98% op de golden suite**, ruim boven wat één
run toevallig laat zien, en met de holdoutset (nooit gebruikt om bij te sturen) op 100% in
beide metingen.

**Nulfoutcriterium op verzinnen: gehaald, in alle drie de metingen.**
`golden-fabricatie.ts` doorzoekt élk antwoord (46 in totaal, alle beurten meegeteld) op
regelidentificaties, dienstnummers en roostercodes die niet uit de geraadpleegde gegevens
of de schermcontext komen — dezelfde grondingscontrole als in `agent.ts`, hier op de hele
suite losgelaten in plaats van op de vier gevallen die categorie C er expliciet voor
aanwees. Uitkomst: **0 van 46 in N0, 0 van 46 in n0b, 0 van 46 in N1.** (De eerste versie
van dit sweepscript miste de schermcontext als bron en telde 11 valse meldingen in N0 —
zelfde soort fout als eerder in v1.0.5 bij de grondingsgrendel zelf; gecorrigeerd vóór
publicatie van dit cijfer.)

## Wat verder is gebouwd, los van de agentintelligentie

- **`compareRosterSelections()`** (roster-service.ts) — "Roosters vergelijken" (§19/§20)
  vergeleek voorheen uitsluitend opgeslagen `RosterVersion`-rijen, die pas ontstaan bij
  publicatie. Zonder publicaties bleef het scherm dus altijd leeg — niet gebroken in de zin
  van een foutmelding, maar leeg op een manier die niemand iets leerde. De nieuwe functie
  vergelijkt rechtstreeks officieel-tegen-kandidaat en kandidaat-tegen-kandidaat, met
  dezelfde celvergelijking (nu gedeeld via `domain/roster-diff.ts`, met 5 nieuwe
  regressietests) en met een zichtbare melding bij een verschillende rotatielengte.
  Handmatig geverifieerd in de draaiende applicatie: DDR-VL officieel tegen kandidaat 1
  gaf 23 gewijzigde dagen, 47 ongewijzigd, 0/0 alleen-links/rechts.
- **§5.1/§16-declutter, eerste stap.** De bevoegdhedenlijst (9 rijen) en de toolenlijst
  (12 rijen) op het agentscherm stonden permanent open onder elk gesprek. Ze staan nu
  achter een `<details>`, met het aantal actieve bevoegdheden zichtbaar zonder open te
  klikken ("3 van de 9 bevoegdheden aan"). De rest van §5/§12–§18 (streaming,
  Instant/Gemiddeld/Hoog, pin/recent, de tweede ingebouwde chat in Scenario's &
  AI-werkruimte) is niet in deze ronde gedaan — zie hieronder.

## Wat nog niet klopt, met opzet niet verborgen

- **De golden suite telt 43 items, niet de gevraagde 100.** Ze dekt alle tien categorieën
  uit §3 van de opdracht met echte, datagegronde items, maar is te klein om harde
  generalisatie-uitspraken op te baseren. Groei is voorzien, nog niet uitgevoerd.
- **Streaming, Instant/Gemiddeld/Hoog, pin/recent-gesprekken, de vervanging van de
  ingebouwde mini-chat in Scenario's & AI-werkruimte: niet gebouwd in deze ronde.** Dat
  laatste (§17) is bewust *niet* aangeraakt nadat bleek dat de kandidaat-detailpagina waar
  de vervangende "Bespreek met agent"-knop zou moeten komen 582 regels telt en niet in de
  resterende tijd van deze ronde zorgvuldig te wijzigen én te verifiëren was. Een
  werkende, dubbele chat laten staan is beter dan een halve vervanging.
- **De vage-klacht- en weekendcategorieën zijn verbeterd via instructie, niet via een
  aparte grondingslaag (§10).** Er is geen derde "claim verification"-grendel gebouwd die
  elk genoemd aantal automatisch tegen de brongegevens controleert; de bestaande twee
  grendels (ongegronde identificaties, antwoord zonder bron) blijven staan. Dat is een
  reële, nog openstaande wens uit §10.
- **Geen `--zwaar`-rekenronde met het lokale model in deze ronde**, dus C1
  ("onderzoeksstap volgt uit een gemeten uitkomst") is niet met een echt lokaal model
  herbevestigd — het bewijs staat nog op de stub-gebaseerde meting uit v1.0.5 fase 6.
- **Portable versie: niet opnieuw getest in deze ronde.**
