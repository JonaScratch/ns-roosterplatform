# Fase 9 — opzet van de geïntegreerde praktijktest

*25 september 2026.*

## Een gat in de vastlegging, eerst benoemd

Het migratieplan zegt: *"De vijftien stappen uit §42 van de werkopdracht op een echt
Dordrechts project, vastgelegd met bevindingen."* Die vijftien stappen staan **niet in de
repository**. §42 verwijst naar de oorspronkelijke werkopdracht van v1.0.5, en daarvan is
alleen de fasering en de testset bewaard, niet de volledige tekst.

Ze verzinnen zou een lijst opleveren die precies past bij wat er gebouwd is, en dat is
het tegenovergestelde van een praktijktest. Deze opzet is daarom gereconstrueerd uit wat
wél is vastgelegd — de fasering in `plan-update.md`, de 25 testscenario's en de
acceptatiecriteria — en dat staat hier zodat de lezer het verschil ziet tussen wat
gevraagd was en wat is uitgevoerd.

## Wat de praktijktest is

Eén doorlopende sessie door de draaiende applicatie, op het echte Dordrechtse project, in
de volgorde waarin een commissielid het zou doen. Niet per scenario een script, maar een
werkdag nabootsen en opschrijven wat er misgaat.

Dat onderscheid doet ertoe. Elke ronde tot nu toe leverde defecten op die de tests niet
zagen en het doorlopen wél: de rekenopdracht die niet werd herkend, het ontbrekende recht
dat als storing werd gepresenteerd, de opdrachtbewaking zonder hartslag, het lege
opsommingszinnetje. Geen daarvan kwam uit een unittest.

## De route

**Deel 1 — lezen en begrijpen (niveau A)**

1. Inloggen als commissielid, standplaats Dordrecht, het agentscherm openen.
2. Een basisrooster en een regel kiezen; vragen wat daar staat, en controleren dat het
   antwoord bij de kiezer past.
3. Een vraag stellen over een dienstnummer zonder weekdag, en nagaan dat de agent de
   weekdag erbij noemt in plaats van één tijd te kiezen.
4. Een regelvraag stellen en controleren dat bron én bevestigingsstatus meekomen.
5. Een vraag stellen die niet uit de gegevens volgt, en nagaan dat de agent dat zegt.

**Deel 2 — laten rekenen (niveau B)**

6. Niveau op B zetten en een optimalisatie laten voorstellen; het voorstel lezen op wat
   het belooft en wat het niet belooft.
7. De opdracht starten en het activiteitenpaneel volgen, inclusief het sluiten en
   heropenen van het tabblad.
8. Tijdens de opdracht een vraag stellen en nagaan dat de opdracht daar niet door
   verandert.
9. Om publicatie vragen en de weigering lezen.

**Deel 3 — geheugen**

10. Een voorkeur uitspreken, het voorstel goedkeuren, en nagaan dat het item herkomst,
    status en bereik draagt.
11. Een volgende opdracht laten voorstellen en controleren dat het goedgekeurde item
    zichtbaar meetelt — en dat de toepassing geteld wordt, niet geschat.
12. Een item intrekken en vragen het alsnog toe te passen.

**Deel 4 — zelfstandig en technisch (niveau C, fase 7 en 8)**

13. Niveau op C zetten, een onderzoekslus voorstellen, en het rondebudget controleren.
14. De noodrem gebruiken tijdens een lopende lus.
15. Een experiment laten voorstellen, de uitkomst tegen de poorten houden, en daarna
    dezelfde vraag nog eens stellen om te zien of de eerdere afwijzing wordt
    teruggevonden met de reden van toen.

## Hoe bevindingen worden vastgelegd

Per bevinding: wat er gebeurde, wat er had moeten gebeuren, of het een defect is of een
ontwerpkeuze, en of het is hersteld. Bevindingen die niet zijn hersteld blijven staan met
de reden — een lijst waarop alles is afgevinkt, is verdacht.

## Wat deze test niet is

Geen acceptatie door NS. Geen oordeel over of de gegenereerde roosters goed zijn. Geen
belastingtest. En geen vervanging van de scenariotoetsen: die draaien apart en meten de
database, niet het scherm.
