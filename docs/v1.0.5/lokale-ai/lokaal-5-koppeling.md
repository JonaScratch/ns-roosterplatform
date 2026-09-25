# LOKAAL-5 — de koppeling repareren, en ontdekken dat de meetlat zelf krom was

*25 september 2026. Vervolg op `lokaal-3-rooktest.md`. Ruwe uitkomsten:
`../benchmarks/lokaal-2/` tot en met `../benchmarks/lokaal-5/`.*

> **Twee nummeringen, en dat is verwarrend.** `LOKAAL-1` tot en met `LOKAAL-6` zijn de
> stappen van het lokale-AI-spoor uit de beslissingen van 21 september. `lokaal-0` tot en
> met `lokaal-5` zijn metingen in `../benchmarks/`. Ze lopen niet gelijk op: dit document
> hoort bij stap LOKAAL-5 en behandelt de metingen lokaal-2 tot en met lokaal-5.

## Waar dit over gaat

Bij de rooktest deed `qwen3:8b` drie dingen fout die niets met taalvaardigheid te maken
hadden. Het gaf de schermcontext niet mee aan de tools, koos de verkeerde tool, en
citeerde één keer een regel die niet bestond. De vraag van deze ronde: hoeveel van de
zwakke uitslag was het model, en hoeveel was de koppeling eromheen?

Het antwoord is ongemakkelijker dan verwacht. Een deel was de koppeling. Een ander deel
was mijn eigen meetlat.

## Wat er aan de koppeling is veranderd

**1. De schermcontext gaat server-side mee in elke toolaanroep.** Het scherm weet welk
basisrooster en welke regel open staan. Dat van het model laten afhangen was een
ontwerpfout: het model vergat het, kreeg een leeg resultaat, en legde vervolgens uit
waarom de regel leeg was. Wat het model zelf invult wint nog steeds — het mag een ánder
rooster noemen dan de kiezer.

**2. De systeeminstructie kreeg een kaart van vraagsoort naar tool,** en later ook per
tool wat die nodig heeft. Dat tweede kwam uit lokaal-4: het model riep `dutyInstance` aan
zonder dienstnummer en `dutyKindPerLine` zonder dienstsoort, kreeg beide keren "ongeldige
invoer", en schreef daarna dat er geen dienst was. De catalogus noemde alleen naam en
omschrijving; nergens stond wát een tool nodig heeft. Die lijst wordt nu uit het schema
afgeleid, zodat hij niet uit de pas kan lopen.

**3. Een grondingsgrendel in de keten, buiten het model.** Noemt een antwoord een
regelidentificatie, dienstnummer of roostercode die niet in de geraadpleegde gegevens
staat, dan gaat het antwoord niet door. In plaats daarvan staat er wat er niet te
herleiden was. Een bestaande regel die niet is opgezocht wordt apart benoemd van een
verzonnen regel: het eerste is gokken uit het geheugen van het model, het tweede is
fantasie, en allebei horen ze tegengehouden te worden.

**4. De gemelde status volgt het antwoord.** Het model schreef "de exacte regelgeving
staat niet in de database" terwijl de status BEANTWOORD bleef. Het scherm zette daar een
groene balk boven. De compose-stap levert nu een status mee in JSON; komt die niet, dan
valt hij terug op wat de tekst zelf zegt.

## Wat er aan de meetlat veranderde, en waarom dat erger was

Drie poorten in de benchmark keken naar de veldnaam van één tool in plaats van naar het
feit:

| Poort | Las alleen | Miste daardoor |
| --- | --- | --- |
| `rule_value` | `rules` (van `ruleLookup`) | `hits` (van `ruleSearch`) |
| `night_lines` | `nightStructure` | `dutyKindPerLine` met soort NACHT |
| `duty_times` | `rosterLine` | `dutyInstance` |

De eerste is de ernstigste. C1 vroeg naar de minimale rust tussen twee diensten. Het
model vond `RP_DAILY_REST_PLANNED`, 12 uur, CAO NS 2024–2025 artikel 98, en meldde er
netjes bij dat de bron niet formeel bevestigd is. Dat is een goed antwoord. Het kwam
binnen als **FOUT — regel niet opgezocht**, omdat het via `ruleSearch` was gevonden en de
poort alleen `ruleLookup` kende.

Erger nog: mijn eigen tool-keuzekaart duwde het model naar `ruleSearch`. De verbetering
verergerde dus precies de fout die ze moest meten. Zonder het antwoord regel voor regel
na te lezen, was dit doorgegaan als "het lokale model kan geen regels opzoeken".

**De grondingsgrendel sloeg zeven keer vals alarm.** Hij hield antwoorden tegen die
"DDR-L" noemden terwijl de kiezer op DDR-L stond. De schermcontext is een gegeven, geen
bewering; die telt nu mee als bron, in de grendel én in het analysescript.

### De meetlat verschoof, dus zijn de oude cijfers herberekend

`npm run bench:herbeoordeel -- --meting <naam>` scoort een bewaarde meting opnieuw met de
meetlat van vandaag. Zonder die stap zou de verbetering groter lijken dan ze is. Van
lokaal-2 verandert er geen enkel item; van lokaal-3 één (C1: FOUT → GOED). De oude
bestanden worden niet overschreven.

Gedrags- en geheugenitems kunnen niet worden herbeoordeeld: hun oordeel hangt af van de
antwoordstatus, en die is bij het wegschrijven overschreven door het oordeel zelf. Dat
staat ook zo in de uitvoer, en het is een gebrek in het ruwe formaat.

## De metingen

Alle vier op `qwen3:8b`, 32 tests, dezelfde testset, dezelfde machine, op de meetlat van
vandaag.

| Meting | GOED | FOUT | ONBEOORDEELD | NIET_GEIMPLEMENTEERD | Wat erbij kwam |
| --- | --- | --- | --- | --- | --- |
| lokaal-2 | 5 | 16 | 9 | 2 | de eerlijke uitgangsmeting |
| lokaal-3 | 8 | 13 | 9 | 2 | schermcontext, toolkaart, grendel |
| lokaal-4 | 9 | 14 | 9 | 0 | grendel gecorrigeerd, poorten gerepareerd |

Tussen lokaal-3 en lokaal-4 bleven 29 van de 32 items gelijk. Eén werd beter (E1:
geheugen met herkomst, status en bereik). Twee gingen van NIET_GEIMPLEMENTEERD naar FOUT,
en dat is geen achteruitgang maar zichtbaarheid: er bestond geen poort voor
"mag eerlijk concluderen dat er niets beters is" (H2) en voor het weerspreken van een
onjuiste aanname (J3). Die poorten zijn er nu, en het model zakt erdoor.

### En nu het cijfer dat niet meebeweegt

§6 van de methodiek noemt als niet-vooruitgang: *winst die alleen op de niet-holdout
testvragen zichtbaar is*. Dat moet dus geteld worden, ook — juist — als het ongelegen
komt.

| Meting | holdout GOED | holdout FOUT | holdout onbeoordeeld |
| --- | --- | --- | --- |
| lokaal-2 | 3 | 1 | 2 (+1 niet geïmplementeerd) |
| lokaal-3 | 3 | 1 | 2 (+1 niet geïmplementeerd) |
| lokaal-4 | 3 | 2 | 2 |

**De winst staat volledig buiten de holdout.** Op de zeven holdoutvragen (A4, C4, D4, F3,
G2, I4, J3) blijft het aantal goede antwoorden op drie staan, van de eerste meting tot de
laatste.

Twee lezingen zijn mogelijk en ik kan er nu niet tussen kiezen. Óf de verbeteringen
werken alleen op vragen die ik tijdens het sleutelen heb gezien — dan is het geen echte
vooruitgang. Óf de holdout is met vijf beoordeelbare items simpelweg te klein om een
verschuiving van drie items te laten zien. Beide zijn waar te maken met dezelfde cijfers,
en dat is precies waarom de conclusie hier niet verder mag gaan dan: **de vooruitgang is
niet bevestigd op onafhankelijke vragen.**

Wat het wél betekent voor de volgende ronde: de holdout moet groter voordat een
verbetering van deze omvang er iets over kan zeggen.

De negen ONBEOORDEELDE items zijn rubrieken en taalvragen. Die horen door een mens te
worden gelezen en worden hier niet als score meegeteld.

## Wat het model zelf laat zien

**Geen verzonnen identificaties.** Over lokaal-2, lokaal-3 én lokaal-4 geteld, met de
schermcontext meegerekend: 0 ongegronde vermeldingen, telkens in 32 antwoorden. De fabricatie
(`RESERVE_BASE_WITHOUT_DUTIES`, "bevestigd") kwam uit de rooktest van vier vragen, niet
uit de benchmark. Ze rechtvaardigt de grendel — regelkennis is een nulfoutcriterium en
één zo'n antwoord is er één te veel — maar het zou onjuist zijn te schrijven dat de
benchmark fabricatie liet zien. Die verzonnen regel staat nu wél letterlijk in
`verify:agent` als regressietest.

**De zwakte zit in het redeneren, niet in het Nederlands.** Waar het model faalt, faalt
het op: een vereist argument vergeten, een vraag over een roosterregel met de
dienst-tool te lijf gaan, meegaan met een onjuiste aanname van de gebruiker (J3), en een
opdracht met tegenstrijdige voorwaarden beantwoorden met "geen gegevens" in plaats van
met de eerlijke uitkomst (H2). Het Nederlands is steeds goed leesbaar.

**Snelheid is geen probleem.** p50 rond 7,2 s, p95 rond 14,5 s, 6,4 van 10,2 GB VRAM. Voor
een gesprek is dat werkbaar.

## Wat dit niet zegt

Dit zegt niets over de vraag of `qwen3:8b` het juiste model is. Het zegt dat de keten
eromheen nu meet wat ze pretendeert te meten, en dat de uitgangsmeting eerlijk is. De
vergelijking met de stub blijft ongelijk: de stub is geschreven naast deze testset en
kan per definitie niet verrassen. Dat de stub op M2 21 van de 21 beoordeelbare items goed
had en dit model 9 van de 23, is dan ook geen uitspraak over intelligentie maar over hoe
ver een 8B-model met deze koppeling komt.
