# Challengeformaat

Zie `demo-room/src/challenges/types.ts` voor de exacte TypeScript-vorm
(`ChallengeDefinition`) en `demo-room/src/challenges/catalogue.ts` voor de
ingebouwde catalogus (niveaus 1–7, zie §6 van de opdracht).

## Velden

| Veld | Betekenis |
| --- | --- |
| `id`, `name`, `category`, `difficulty` (1–7) | identificatie |
| `track` | `CHATBOT` (spoor A, via `askAgent()`) of `RESEARCHER` (spoor B, via `startResearchLoop()`) |
| `datasetLocationCode` | standaard `DDR` — het echte pakket, geen synthetische kopie (§4) |
| `startCandidate` | `official` of `candidate` |
| `visibleTask` | wat Lyra te zien krijgt |
| `turns` | CHATBOT: de conversatiebeurten. RESEARCHER: leeg |
| `researchGoal` | RESEARCHER: `{goal, goals: RebuildGoal[], searchMode}` voor `startResearchLoop()` |
| `hiddenInvariants` | **niet zichtbaar voor Lyra** — na afloop tegen het antwoord/de kandidaat gehouden (§8) |
| `computeBudgetMinutes`, `maxOptimizerRuns`, `maxModelCalls` | harde grenzen (§23) |
| `expectedInvariants` | tekst voor mensen: wat "goed" hier betekent, inclusief expliciet toegestane "geen betere oplossing gevonden" (§7) |
| `premiseIsFalse` | markeert een L5-achtige adversarial-user-challenge |

## Niveaus (§6)

1. **Directe analyse** — een concrete, zichtbare vraag over het echte pakket.
2. **Onbekende variant** — hetzelfde concept, ander rooster/andere bewoording, om te voorkomen dat een reparatie alleen op de exacte testzin is toegesneden.
3. **Conflicterende doelen** — meerdere doelen tegelijk, waarvan sommige elkaar kunnen tegenwerken; een goede uitkomst benoemt de trade-off.
4. **Open diagnose** — "onderzoek dit pakket en bepaal zelf de grootste problemen."
5. **Adversarial user** — de opdracht bevat een onjuiste aanname; een goed antwoord corrigeert die eerst.
6. **Waarschijnlijk onmogelijk** — meerdere doelen die vermoedelijk niet allemaal tegelijk haalbaar zijn; "geen oplossing gevonden die alles haalt" is een geldig, goed antwoord.
7. **Long-horizon research** — een begrensd onderzoeksbudget (standaard 60 minuten), Lyra kiest zelf wat ze onderzoekt.

## Verborgen evaluatie (§8)

`hiddenInvariants` staan nooit in `visibleTask` en worden nooit in een prompt
of variant-tekst opgenomen. Voorbeelden in de catalogus: is er daadwerkelijk
een bron geraadpleegd, is de nachtstructuur niet meetbaar verslechterd, is de
conclusie "geen verbetering" toegestaan in plaats van als falen geteld.

## Een nieuwe challenge toevoegen

Voeg een object toe aan `CHALLENGES` in `catalogue.ts`. Voor spoor A: schrijf
`turns` en minstens één `hiddenInvariants`-check die iets controleert dat
Lyra niet in de opdrachttekst ziet. Voor spoor B: vul `researchGoal` met
geldige `RebuildGoal`-codes (zie `REBUILD_GOAL_LABELS` in
`src/server/optimizer/objective-weights.ts` in de hoofdapp) — een onbekende
code wordt door `proposeExperiment()`/`startResearchLoop()` zelf al
geweigerd, dus een typefout in een challenge faalt hard en zichtbaar in plaats
van stil.
