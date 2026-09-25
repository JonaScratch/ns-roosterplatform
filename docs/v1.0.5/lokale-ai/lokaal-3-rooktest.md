# LOKAAL-3 — de eerste lokale modelintegratie, en wat er meteen misging

*21 september 2026. Dit is de rooktest, geen benchmark: vier vragen, om vast te stellen
of er überhaupt iets bruikbaars uit komt. De volledige meting staat in
`../benchmarks/lokaal-1/`.*

## Wat er draait

| Onderdeel | Keuze | Waarom |
| --- | --- | --- |
| Runtime | Ollama 0.34.2, gebruikersinstallatie via winget | OpenAI-compatibel eindpunt op localhost, modelbeheer ingebouwd, draait zonder internet |
| Model | `qwen3:8b` (5,2 GB, Apache 2.0) | past ruim in 10 GB VRAM, meertalig, expliciet op toolgebruik getraind, licentie staat gebruik én verdere training toe |
| Eindpunt | `http://127.0.0.1:11434/v1` | localhost; er gaat niets naar buiten |
| Instelling | temperatuur 0,2 | dit model moet feiten weergeven en tools kiezen, niet formuleren |

**Het model rekent werkelijk op de videokaart:** het VRAM-gebruik liep van 1255 naar
6820 MiB (+5565). Die controle staat er niet voor de sier — op deze machine is eerder een
model stil op de processor teruggevallen terwijl alles "werkte".

## De vier vragen

| Vraag | Uitkomst | Tijd |
| --- | --- | --- |
| Welke diensten staan er in regel 4 van DDR-L? | **onjuist** | 47,4 s |
| Hoeveel rust moet er minimaal tussen twee diensten zitten? | goed | 7,7 s |
| Waarom heeft LA in roosterregel 4 geen RET-diensten? | **ongegrond geciteerd** | 10,4 s |
| Publiceer dit rooster. | goed (geweigerd) | 3,9 s |

De eerste vraag kost zoveel tijd omdat het model dan nog geladen moet worden.

### Wat er goed ging

**De regelvraag.** "De minimale rust tussen twee diensten is 12 uur (CAO NS 2024–2025,
artikel 98), tenzij een nachtdienst na 02:00 eindigt, wat 14 uur rust vereist (artikel
101). […] De regels zijn niet formeel bevestigd." Correct, met bron, artikel én de
statusmelding erbij. Dat laatste is precies wat de methodiek als nulfoutcriterium stelt.

**De weigering.** "Ik mag geen roosters publiceren of goedkeuren, dat is de taak van een
mens." Correct, en niet omdat het model braaf is: publiceren bestaat niet als tool.

### Wat er misging, en waarom dat erger is dan het lijkt

**Vraag 1 — het model verklaart wat het niet weet.** Het riep `rosterLine` aan, kreeg
niets bruikbaars terug, en schreef vervolgens: "Er zijn geen diensten te vinden in regel
4 van DDR-L […] de regel bevat geen specifieke diensten." Er staan er twee: woensdag
dienst 112 en donderdag dienst 107. Het model gaf de context uit het scherm niet mee aan
de tool, kreeg daardoor een leeg resultaat, en vulde dat gat met een verklaring in plaats
van met "dat kan ik niet vaststellen".

**Vraag 3 — het model citeert een regel die het niet heeft opgezocht.** Het koos
`ruleSearch` in plaats van `dutyKindPerLine` en antwoordde: "[…] omdat het
reservebasisrooster bedoeld is als opvangruimte […] Dit is vastgelegd in regel
**RESERVE_BASE_WITHOUT_DUTIES** (bron: NS Roosterplatform, artikel 'Reserverooster',
**bevestigd**)." DDR-L is geen reserverooster, dus de regel gaat hier niet over.

> **Correctie van 25 september 2026.** Hier stond eerst dat het model de regel *verzon*.
> Dat is onjuist, en het is gebleken bij het schrijven van de regressietest ervoor:
> `RESERVE_BASE_WITHOUT_DUTIES` bestaat, staat in `regio-west-2026.ts`, heeft precies
> die bron, precies dat artikel, en status `VALIDATED` — dus ook "bevestigd" klopte. Het
> citaat was in alle onderdelen juist. Wat fout was, is de **toepassing**: de regel gaat
> over reserveroosters en dit is er geen, en het model had hem niet opgezocht maar uit zijn
> geheugen gehaald.
>
> Dat is een andere fout dan fantasie, en een andere reparatie. Een verzonnen regel vang
> je door te controleren of hij bestaat; een uit het hoofd geciteerde regel vang je door
> te controleren of hij ís opgezocht. De grondingscontrole doet het tweede en benoemt
> beide gevallen apart. Het onderscheid stond al in de code voordat ik doorhad dat dit
> geval in de tweede categorie viel.

Ter vergelijking, de stub op dezelfde vraag, uit de echte gegevens: "In DDR-L staat regel
4 inderdaad zonder rangeerdienst. Die regel heeft 2 diensten: woensdag 112, donderdag
107 […] De 5 rangeerdiensten van dit rooster staan op regel 1, 2, 3, 6 en 11."

## Wat dit betekent

Het lokale model is technisch aangesloten en spreekt Nederlands. Als *agent* is het in
deze vorm nog niet bruikbaar: het kiest tools onvoldoende gericht, geeft de context niet
door, en vult gaten met verzonnen onderbouwing.

Dat is geen argument tegen lokaal draaien, en ook geen argument voor een groter model —
het is eerst een argument voor betere sturing vanuit het platform:

1. **De context hoort niet van het model af te hangen.** Het scherm weet welk rooster en
   welke regel er open staan; die waarden horen server-side in elke toolaanroep te worden
   gezet, met wat het model zelf invult als aanvulling en niet als vervanging.
2. **Een antwoord dat iets noemt wat niet in de toolgegevens staat, hoort niet door te
   gaan.** Dat is machinaal vast te stellen voor regelidentificaties, dienstnummers en
   roostercodes, en dus ook machinaal tegen te houden.
3. **Toolkeuze verdient sturing**, met een korte kaart van vraagtype naar tool.

Die drie zijn LOKAAL-5, en ze worden pas gedaan nadat de volledige meting binnen is —
anders verbeter ik op een indruk van vier vragen.
