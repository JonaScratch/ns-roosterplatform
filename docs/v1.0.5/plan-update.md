# Planbijwerking v1.0.5 — na de aangescherpte werkopdracht

*21 september 2026. De opzet uit `migration-plan.md` blijft staan; hieronder wat erbij
komt, wat verschuift en wat is gecontroleerd.*

## 1. Gecontroleerde uitgangssituatie

| Bewering uit de opdracht | Bevinding |
| --- | --- |
| v1.0.4 veilig vastgelegd op `stand/v1.0.4-machinist`, commit `cf8a0e3` | klopt |
| v1.0.5 op een eigen tak | klopt (`v1.0.5`, commit `a042ef6`) |
| Fase-0-documentatie en baseline-manifest vastgelegd | klopt |
| Testbatterij 18 van 19 | klopt (de rode suite is een dekkingsgat: geen PDF-dienstenpakket aangeleverd) |
| Zeven basisroosters, 64 regels, 223 diensten | klopt |
| Modellen voor beoordelingen, opdrachten, voortgang, annuleren, auditlog bestaan | klopt |
| **"De ontwikkeling van fase 1, het agentfundament, is begonnen"** | **klopt niet.** Er is geen `src/server/agent`. De vorige sessie eindigde met de mededeling dat fase 1 zou starten; er is geen agentcode geschreven. M0 legt die stand vast. |

## 2. Wat erbij komt ten opzichte van het oorspronkelijke plan

1. **Benchmarkprogramma M0–M3** met vooraf vastgelegde methodiek en acceptatiecriteria
   (`benchmark-methodology.md`, `acceptance-criteria.json`). M0 is uitgevoerd.
2. **Intelligentiebenchmark** als eigen, versieerbare testset met tien categorieën en
   negen holdout-tests (`intelligence-testset.json`, runner `scripts/v105/intelligence-bench.ts`).
3. **Regelkennisbank**: regels met bron, document, artikel, geldigheid en verificatiestatus
   koppelbaar aan een concrete roosterberekening (fase 3 van het bijgewerkte plan).
4. **Interfacewerk** dat eerder niet in het plan stond:
   - de vier strategietegels uit de primaire generatiepagina halen en vervangen door één
     intelligente standaardgeneratie (strategieën blijven bestaan voor onderzoek);
   - alle roosterregels standaard onder elkaar tonen;
   - *Scenario's vergelijken* wordt de AI-werkruimte met chat, context en vergelijking;
   - een uitklapbaar Layer-2-paneel voor aanvullende optimalisatiedoelen, dat dezelfde
     diensten gebruikt als de chat;
   - de zichtbare demonaam wordt "Rooster Commissie Demo" (alleen de weergegeven naam).
5. **Praktijkscenario's 1–12** als integratietests, met scenario 1 (RET in Laat) als
   hoofdscenario.
6. **Langdurig onderzoek**: persistente onderzoeksopdrachten die een herstart overleven,
   met herstelpunten en een compacte overdracht per sessie.

## 3. Wat dit betekent voor de fasering

De oorspronkelijke fasen blijven, met de meetmomenten ertussen:

```
fase 0  ──────────────────────────────────►  M0   (gedaan)
fase 1  agentfundament, toollaag, stub
fase 2  activiteitenpaneel
fase 3  niveau B + regelkennisbank + UI-werk  ──►  M1
fase 4  leergeheugen
fase 5  menselijke feedbacklus               ──►  M2
fase 6  niveau C (autonome lus)
fase 7  lokaal en NS-breed leren
fase 8  technische ontwikkelagent            ──►  M3
fase 9  praktijktest (scenario's 1–12)
fase 10 acceptatie, eindrapport
```

Het UI-werk schuift naar fase 3 omdat het pas zin heeft als de agent echte antwoorden
geeft; de demonaam is een losse, kleine wijziging die eerder kan.

## 4. Openstaande vraag die de opdracht blokkeert op één punt

**Wat betekent RET in dit dienstenpakket?** Het komt niet voor in dienstcodes,
omschrijvingen of dienstsoorten (VROEG, LAAT, NACHT, RANGEER, RESERVE). Zonder uitleg
kan scenario 1 alleen als *verduidelijkingsvraag* worden getest, niet als feitelijke
verklaring. De testset legt dat nu zo vast; zodra de betekenis bekend is, wordt het item
aangevuld met de feitelijke controle.

## 5. Wat onveranderd blijft

- De validator blijft onafhankelijk en niet te omzeilen.
- De agent krijgt geen vrije database- of shelltoegang.
- Publiceren en goedkeuren blijven menselijke handelingen.
- Experimentele enginecode gaat nooit automatisch naar productie.
- Geen gegevens naar een extern AI-model tot de gebruiker daarover beslist; tot dan een
  lokale, deterministische stub, en de stub telt niet als bewijs van taalvaardigheid.
