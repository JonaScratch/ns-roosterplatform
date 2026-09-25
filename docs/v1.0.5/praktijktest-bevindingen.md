# Fase 9 — de doorloop, en wat eruit kwam

*25 september 2026. Opzet: `praktijktest-opzet.md`. Doorlopen op het echte Dordrechtse
project in de draaiende applicatie, met **het lokale taalmodel actief** (`qwen3:8b`) en
niet met de stub.*

## Waarom dat laatste ertoe doet

Alle scenariotoetsen en alle benchmarkmomenten draaien met `NS_AGENT_FORCE_STUB=1`. Dat is
een bewuste keuze — ze meten de keten en niet het taalmodel — maar het betekent dat geen
enkele geautomatiseerde toets ooit het pad heeft belopen dat een gebruiker beloopt.

Die doorloop legde **zes defecten** bloot. Vijf ervan waren onzichtbaar voor elke test,
en drie waren fouten in mijn eigen code en niet in het model.

## De zwaarste: niveau B bestond niet voor een taalmodel

`AgentPlan` heeft een veld `proposal` — een voorgestelde rekenopdracht, waar het scherm
een bevestigingsknop aan hangt. De stub vult dat veld. **De lokale modeladapter niet.**
Het stond er niet in de instructie, het werd niet uit het antwoord gelezen, en het werd
in de antwoordstap niet gerenderd.

Het gevolg: met een taalmodel actief kon de agent nooit een berekening voorstellen. Op
"laat uitrekenen of de nachten beter geclusterd kunnen worden" gaf hij een keurig
beschouwend antwoord en verder niets. Hetzelfde geldt voor een voorgestelde
geheugenregel en voor een onderzoekslus: het hele *initiatief* van niveau B en C was
stubwerk.

Elke toets was groen. De scenariotoetsen dwingen de stub af, de benchmark dwingt de stub
af, en de stub kon het wél.

**Hersteld**, in vier stappen die elk een eigen fout blootlegden:

1. **De instructie.** Het model weet nu dat een rekenverzoek geen toolvraag is maar een
   voorstel, met de toegestane doelcodes erbij. Wat het mag invullen is bewust smal: soort
   opdracht, doelen, rekenmodus, één zin toelichting. Strategie, roosterjaar en kandidaat
   komen van het platform — een model dat die invult, vult ze vroeg of laat verkeerd in.
2. **Het lezen.** Het model leverde *twee* JSON-objecten achter elkaar: het
   intentie-object en, na een komma, een object met alleen `proposal`. Allebei geldig. Mijn
   lezer pakte alles van de eerste accolade tot de laatste en las dat als één object — wat
   mislukte, waarna de agent meldde "het model leverde geen leesbaar plan". Het model had
   zich keurig uitgedrukt; ik las het verkeerd. De lezer haalt nu elk object op het
   buitenste niveau apart op en voegt ze samen.
3. **Het tonen.** Het voorstel werd in de plannende stap wél gemaakt en in de antwoordende
   stap weggegooid: de tekst van een voorstel stond alleen in de stub. Die tekst staat nu
   één keer, in `voorstel-tekst.ts`, en beide adapters gebruiken hem.
4. **De bevoegdheid.** Het model stelde op niveau B een `RESEARCH` voor — een
   onderzoekslus, en dat is niveau C. Dat was niet onveilig (`startResearchLoop` weigert
   het), maar de gebruiker zou pas ná het bevestigen te horen krijgen dat het niet mag. Een
   voorstel dat de bevoegdheid te buiten gaat, wordt nu teruggebracht tot wat wél mag.

Sindsdien: "Laat uitrekenen of de rangeerdiensten eerlijker verdeeld kunnen worden" levert
in het scherm een voorstel op met strategie, rekentijd, wat er níet gebeurt, en de zin dat
de uitkomst ook "niets beters" kan zijn.

## Een antwoord dat nergens op steunde

Op de vraag of de nachten van DDR-MIX beter geclusterd konden worden, riep het model
**geen enkele tool aan** en antwoordde het dat dit rooster geen nachten heeft. Een minuut
eerder had het over hetzelfde rooster nog twee nachtblokken van vijf opgesomd. Het feit
kwam uit een eerdere beurt, over een ánder rooster (DDR-50MIX), en werd doorgegeven alsof
het over dit rooster ging.

De grondingscontrole ving dat niet: die kijkt of genoemde identificaties in de gegevens
staan, en hier stónden er geen gegevens om mee te vergelijken.

**Hersteld.** Een antwoord met status "beantwoord" waarvoor geen enkele bron is
geraadpleegd, gaat niet door. Een weigering, een wedervraag, een voorstel of een eerlijk
"ik weet het niet" heeft geen bron nodig — die beweren ook niets over het rooster.

Dit is de tweede grendel van dit soort, en ze vullen elkaar aan: de eerste vangt een
antwoord dat íets te veel noemt, de tweede een antwoord dat nergens op staat.

## Het scherm vertelde dat werkende functies niet bestonden

Onderaan het agentscherm stond: *"Het permanente activiteitenpaneel, het leergeheugen en
het laten rekenen van kandidaten komen in de volgende fasen."* Die drie bestaan sinds fase
2, 4 en 3. De tekst stond er nog uit fase 1.

Geen technisch defect, wel een onware mededeling aan de gebruiker — en precies het soort
dat niemand opmerkt, omdat hij naar waarheid klonk toen hij werd geschreven. Vervangen
door wat er werkelijk niet gebeurt: publiceren, goedkeuren en regels wijzigen.

## Het model hangt gezag aan zijn antwoorden

Twee keer eindigde een antwoord met een zin als *"De gegevens komen uit het officiële
rooster DDR-50MIX en zijn bevestigd."* De tijden kwamen uit het dienstenpakket, niet uit
dat rooster, en niets in de gegevens zei "bevestigd".

**Niet hersteld**, en bewust niet. Het is een echte zwakte van het model en hij hoort
zichtbaar te blijven tot er een controle is die hem afvangt. De grondingscontrole kijkt
naar identificaties; een gezagsclaim als "bevestigd" is iets anders, en een grendel
daarvoor zou moeten weten wanneer zo'n woord wél terecht is. Dat is de volgende ronde
waard, niet een haastige regexp nu. Staat op de lijst.

## Mijn eigen statusregel is te gretig

Op "hoe laat eindigt dienst 107?" gaf de agent een volledig en juist antwoord — alle zeven
weekdagen met hun eindtijd — en zette er de status **"niet vast te stellen"** boven. Reden:
het antwoord bevat de zin "een dienstnummer zonder weekdag kan niet worden opgezocht", en
mijn regel die de status uit de tekst afleidt herkent die zin.

De afleiding zelf is goed (een scherm dat "beantwoord" meldt boven een tekst die zegt van
niet, liegt), maar ze kijkt naar één zin in plaats van naar de strekking.
**Niet hersteld**: het is een schoonheidsfout die de kant van de voorzichtigheid op valt,
en een slimmere regel raakt makkelijk het geval dat hij moest afvangen. Staat op de lijst.

## Twee dingen die géén defect bleken

Allebei het vermelden waard, want ik had ze bijna als bevinding opgeschreven.

- **"Enter verstuurt" leek niet te werken.** De tekst bleef staan. Een handmatig
  afgevuurde toetsaanslag werkt wél — het was de automatisering die de toets niet
  aanleverde zoals een mens dat doet. Geen defect.
- **"Het gesprek verdwijnt bij herladen."** Er blijkt een gesprekkenlijst te zijn, met
  datum en aantal beurten, en het activiteitenpaneel toont bovendien het hele spoor van
  elke vraag: plan, tools, tijden en antwoord. Geen defect.

## Wat de doorloop bevestigde

- De schermcontext komt aan: DDR-L regel 4 levert 112 (woensdag) en 107 (donderdag), met
  de juiste tijden.
- De regelvraag levert waarde, artikel, bron én de mededeling dat de bron niet formeel
  bevestigd is.
- Een verboden verzoek wordt in een fractie van een seconde geweigerd, zonder het model
  aan te roepen, met de tekst uit `refusals.ts`.
- Het activiteitenpaneel toont per vraag het volledige spoor.

## Wat niet is doorlopen

Deel 3 en 4 van de opzet — geheugen vastleggen en intrekken, de onderzoekslus met de
noodrem, en een experiment met poorten — zijn niet in het scherm doorlopen. Ze zijn wel
tegen de echte database gemeten (`verify:geheugen` 30/30, `verify:onderzoek` 6/6,
`verify:experimenten` 27/27), maar dat is niet hetzelfde als iemand die het doet. Wat deze
doorloop heeft laten zien, is juist dat dat verschil defecten oplevert. Het staat als
openstaand punt in het eindrapport.
