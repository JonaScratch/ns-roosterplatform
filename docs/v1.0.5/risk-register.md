# Risicoregister v1.0.5

*Fase 0. Per risico: wat er kan misgaan, hoe waarschijnlijk en ernstig dat is, wat we
doen om het te voorkomen, en waaraan te zien is dat het tóch gebeurt. Bijgewerkt bij
elke fase.*

Ernst: **hoog** = schaadt vertrouwen in het systeem of levert een fout rooster op.

## Product en veiligheid

| # | Risico | Kans | Ernst | Wat we doen | Waarschuwingssignaal |
| --- | --- | --- | --- | --- | --- |
| R1 | De agent praat een ongeldige kandidaat goed omdat de voorkeursscore hoog is | laag | hoog | De validator staat na de agent en is niet te omzeilen; de agent kan alleen kandidaten voorstellen die de eindvalidatie zijn gepasseerd (test 6) | een voorstel met `validationState` anders dan geldig |
| R2 | Een agentvoorstel overschrijft stilzwijgend een goedgekeurd rooster | laag | hoog | Kandidaten zijn onveranderlijk; goedkeuren en publiceren blijven menselijke handelingen met eigen recht (test 7) | een gepubliceerde versie zonder menselijke goedkeuringsregel in de auditlog |
| R3 | Een gebruiker praat de agent via de chat een verboden handeling aan | midden | hoog | Rechten worden per toolaanroep aan de serverkant gecontroleerd, niet in de prompt; de chat kan geen capability toekennen (test 5) | een toolaanroep zonder bijbehorende grant in de auditlog |
| R4 | Persoonsgegevens lekken naar een extern AI-model | midden | hoog | Fase 1 bouwt provider-onafhankelijk met een lokale stub; niets gaat naar buiten tot de gebruiker beslist. Daarna: minimale velden, geen namen of personeelsnummers, expliciete lijst per tool | een modelaanroep met een veld dat niet op de toegestane lijst staat |
| R5 | Een individuele mening wordt een algemene voorkeur | midden | hoog | Kennis heeft scope, herkomst, bevestigingen en tegenvoorbeelden; activeren is een menselijke handeling (tests 8–12) | een `KnowledgeItem` met scope LOCATION en één bron zonder goedkeuring |
| R6 | Lokale voorkeur van Dordrecht wordt elders actief | laag | hoog | Scope-isolatie in de query én in de activering; overname is een voorstel (tests 9, 10) | een actieve voorkeur in standplaats B met herkomst uit A |

## Techniek

| # | Risico | Kans | Ernst | Wat we doen | Waarschuwingssignaal |
| --- | --- | --- | --- | --- | --- |
| R7 | Een autonome lus blijft doorrekenen na "stop" | midden | hoog | Stoppen zet agentjob én `GenerationRun` stop via het bestaande `cancelRequested`-pad; daarna mag de agent geen ronde meer starten (test 20) | solverproces actief terwijl de job CANCELLED is |
| R8 | Herstart levert dubbele opdrachten of een half goedgekeurd rooster | midden | hoog | Idempotente rondesleutels, persistente toestandsmachine, hartslag zoals nu (tests 17, 18) | twee `GenerationRun`-rijen met dezelfde rondesleutel |
| R9 | De agent legt de machine plat en niemand kan meer kijken | midden | midden | Eén actieve generatie per standplaats (bestaat al), budget per job, chatvragen mogen niet op een CP-SAT-run wachten | wachttijd op leesvragen boven enkele seconden |
| R10 | Het systeem leert zijn eigen score te maximaliseren | midden | hoog | Meerdere onafhankelijke maten, slechtste regel, eerlijkheid, poorten vooraf vastgelegd, menselijke beoordeling apart bewaard van modelscore | voorkeursscore stijgt terwijl menselijke afwijzingen toenemen |
| R11 | Kennis alleen in embeddings, niet terug te vinden of te corrigeren | laag | midden | Scope, status, herkomst en goedkeuring in kolommen; semantisch zoeken is hulpmiddel, geen opslag | een leeritem zonder herkomst of zonder scope |
| R12 | Testprocessen blijven achter en blokkeren poorten | hoog | laag | Bekend defect uit de vorige ronde (Postgres-18-`io_worker` na de crashproef), apart voorgesteld als taak; opruimen vóór elke batterij | een luisterende poort zonder levend proces |
| R13 | De agentlaag dupliceert bestaande logica (uren, regels, kwaliteit) | midden | midden | De toollaag roept bestaande diensten aan; codereview let hierop; geen tweede berekening van hetzelfde begrip | een nieuwe functie die uren of regels zelf uitrekent |

## Project en aanpak

| # | Risico | Kans | Ernst | Wat we doen | Waarschuwingssignaal |
| --- | --- | --- | --- | --- | --- |
| R14 | v1.0.4 raakt zoek onder v1.0.5 | hoog | hoog | Stand eerst vastleggen op een aparte, eerlijk gelabelde tak; meetbestanden en bevroren kopieën blijven staan; nieuwe ontwikkeling op een eigen tak | een meetbestand dat is overschreven |
| R15 | Een commit met het etiket v1.0.4 wordt aangezien voor de code van toen | hoog | midden | De commitboodschap en `baseline-manifest.json` zeggen expliciet dat dit een achteraf vastgelegde stand is | een rapport dat naar die commit verwijst als "de code van de meting" |
| R16 | Schijnautonomie: een vaste reeks stappen die op leren lijkt | midden | hoog | De keuze van de volgende ronde volgt uit de gemeten uitkomst en staat als gebeurtenis vastgelegd; tests op het afbreken en op "geen verbetering" (tests 14, 15) | rondes die altijd dezelfde strategie in dezelfde volgorde kiezen |
| R17 | Schijnzelflerend: mooie tekst zonder geheugenmutatie | midden | hoog | Voor elke leerfunctie moet aantoonbaar zijn wat er is opgeslagen, onder welke scope, en wat er verandert als je het uitzet (§46) | "ik heb geleerd" zonder nieuw of gewijzigd leeritem |
| R18 | Een fase wordt afgerond genoemd terwijl integratietests ontbreken | midden | midden | `progress.json` kent alleen ACCEPTED na het halen van de acceptatiecriteria; rapportage noemt expliciet wat nog niet is gedaan | een fase op ACCEPTED zonder testverwijzing |

## Openstaande besluiten (niet door mij te nemen)

1. **AI-provider en gegevensstroom.** Welke dienst, welke gegevens, onder welke
   afspraak. Tot dat besluit: lokale stub, niets verlaat de machine.
2. **Formele bronstatus van regels.** Het actieve regelbestand is "niet formeel
   bevestigd"; de operationele eisen zijn `USER_PROVIDED`. Wie bevestigt wat?
3. **NS-rollen en bevoegdheden.** Wie mag voorkeuren goedkeuren, wie mag publiceren,
   wie mag experimenten draaien? Nu configureerbaar gebouwd, niet hardgecodeerd.
4. **Bewaartermijnen en verwijdering** van feedback en leeritems.
