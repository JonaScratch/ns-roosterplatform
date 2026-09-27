# Current state — Fase 0 synthese (LYRA MASTER PROGRAM)

Opgemaakt 2026-09-28, tegen HEAD `6398e13`, branch `claude/admiring-edison-5y65j7`. Dit document
vat de vier volledige inventarisatierapporten samen tot één beeld van "wat is er al" — vereist
door §3 van de opdracht ("Inspecteer eerst wat al bestaat. Maak NIET blind een tweede
kennisbank."). De vier volledige rapporten (elk met file:line-citaten) staan naast dit bestand:

- `inventory-rules-and-sources.md` — regelmotor, bronstatus, 71 regels, conflictoplossing
- `inventory-quality-and-preferences.md` — kwaliteitsmodel, voorkeursmodel, menselijke patronen
- `inventory-memory-grounding-tools.md` — leergeheugen, grondingscontrole, toolcontract
- `inventory-benchmark-infrastructure.md` — bestaande meetharnassen, golden suite, replicates

Bronmanifest: `sources/manifest.json`. Voorlopige (mens-te-bevestigen) transcriptie van het
enige niet-machineleesbare brondocument: `roosterkaders-regio-west-2026-DRAFT-TRANSCRIPTIE.md`.

---

## De kernconclusie van Fase 0

Dit is **geen greenfield-opdracht**. Er bestaat al:

- een 71-regel rules engine met een 9-lagen bronhiërarchie en een `RuleStatus`-levenscyclus die
  op de meeste punten rijker is dan wat de opdracht als canoniek schema vraagt;
- een vier-lagen leergeheugen (PROJECT/LOCATION/NATIONAL/TECHNICAL) met mens-in-de-lus-promotie
  naar NS-breed, herkomst, intrekking — stevig getest;
- een grondingscontrole die fabricatie van niet-opgezocht onderscheidt;
- een 12-tools toolcontract dat consequent scope/eenheid meegeeft (nooit een kaal getal);
- een gedeeld RET/rangeer-domeinwoordenboek tussen stub en echt model (de historische bug is
  hier al structureel gerepareerd);
- een menselijke-roosterpatronen-document dat vrijwel letterlijk overeenkomt met opdracht §7-§27,
  met correcte OBSERVED/PREFERRED-scheiding en eerlijke, per-getal bronstatus;
- een volledig gescheiden, aantoonbaar rijpere benchmarklijn voor de roosterengine zelf (CP-SAT),
  met 20-replicate-runs en mean/median/worst-rapportage — een architectuurpatroon dat de
  agent-Q&A-lijn nog mist.

**De opdracht van deze ronde is dus vooral: reconciliatie van wat al bestaat, het dichten van
specifieke, nu concreet vastgestelde gaten, en één eerlijke voor/na-meting — niet "bouw dit
allemaal opnieuw".** Zie `docs/rules-engine-rapport.md`, `docs/v1.0.5/architecture-target-state.md`
en de vier inventarisatierapporten voor het bewijs hierachter.

---

## Concreet vastgestelde, nog niet eerder als zodanig benoemde defecten/risico's

Deze ronde heeft, puur door goed te lezen wat er al staat, vier concrete problemen blootgelegd
die niet eerder samen op één plek stonden. Geen van deze is deze sessie al gerepareerd —
§33/§34 van de opdracht eist een bevroren BEFORE-meting vóórdat er iets inhoudelijks verandert.

| # | Defect | Bewijs | Zelfde patroon als |
|---|---|---|---|
| 1 | `memoryProposal` ("onthoud dat...") werkt alleen in de stub, ontbreekt volledig in de echte lokale-modelroute (`model/local.ts`) | `inventory-memory-grounding-tools.md` §6 | Historische RET-bug (77f37f8) — een stub-only capability |
| 2 | JSON-dubbele-object-parser (`jsonUit()`) heeft nul regressietests, ondanks een pure, triviaal testbare functie | `inventory-memory-grounding-tools.md` §5 | — |
| 3 | MIX="Vroeg-Laat-Nacht"-alias wordt in code als bevestigd gepresenteerd, terwijl het eigen bronmanifest van dit project het "NIET bevestigd" noemt | `inventory-quality-and-preferences.md` §1 | — |
| 4 | 60-minuten klok-vs-label-drempel zit in `rhythm-metrics.ts`/`quality-model.ts` (flow v1/v2) maar ontbreekt in `roster-quality.ts`'s `categoryOf()` (v3-voorkeurslaag) — BLM/50+Mix scoren inconsistent tussen twee actieve onderdelen van hetzelfde rapport | `inventory-quality-and-preferences.md` §8 | — |

Daarnaast, niet nieuw maar herbevestigd als nog open: de CP-SAT-solver weegt een losse nacht
~27× lichter dan het kwaliteitsmodel (`docs/v1.0.5/architecture-current-state.md` §8.5) — expliciet
"de belangrijkste openstaande technische vraag", nog steeds onopgelost.

Geen automatische controle op onbevestigde autoriteitstaal ("bevestigd"/"formeel"/"CAO" zonder
brongegevens) — dit is precies wat opdracht §29 (claim-verificatie) als nieuwe grendel vraagt, en
het is bevestigd dat dit nu structureel ontbreekt, niet alleen ongetest is.

---

## Bronstatus — het echte beeld (niet de eerste, voorbarige aanname van deze sessie)

Deze sessie nam eerst aan dat de CAO-tekst ontbrak. Dat was fout. Het echte beeld, na verificatie
met het bestaande `npm run verify:bronnen`-script (8/8 controles geslaagd):

| Document | Aanwezig? | Machineleesbaar? | Status |
|---|---|---|---|
| NS CAO 2024-2025.pdf | Ja | Ja (107 pag., 337.841 tekens) | **Verlopen voor de geauditeerde periode** (geldig t/m 1 mrt. 2025; roosters lopen okt-dec 2026) — `HISTORICAL_SOURCE`, `CAO_CURRENCY_CONFIRMATION` staat al als blokkerend punt in de code |
| Roosterkaders Regio West 2026 (ondertekend) | Ja | **Nee** — scan zonder tekstlaag | `SOURCE_PRESENT_NOT_MACHINE_READABLE`; deze sessie maakte een voorlopige beeld-transcriptie, uitdrukkelijk `HUMAN_REVIEW_REQUIRED` |
| BDU DDR Oktober 2026.docx | Ja | Ja, maar leeg | Bevat geen dienstgegevens (alleen omslagtekst + foto) |
| 7 officiële Dordrecht-roosterbladen | Ja | Ja | Volledig geparsed, drievoudig geteld (223 diensten, 0 discrepanties), al jaren stabiel gebruikt als kalibratiebron |

**SOURCE_INPUT_REQUIRED (van de gebruiker/NS, niet zelf te construeren):**
1. De daadwerkelijk voor okt-dec 2026 geldende CAO (of bevestiging van doorlopende geldigheid van de 2024-2025-tekst).
2. Bevestiging/menselijke overtyping van de Roosterkaders Regio West-scan (deze sessie's beeld-transcriptie is een startpunt, geen vervanging).
3. ATW (Arbeidstijdenwet) en ATB-vervoer (Arbeidstijdenbesluit vervoer) — volledig `NOT_SUPPLIED`, al zo benoemd in de code zelf.
4. Kwalificatiematrix (baanvak/materieel/bevoegdheid-koppeling) — niet aangesloten bronsysteem.

---

## Wat blijft LOCAL REQUIRED

Geen Ollama/qwen3:8b bereikbaar in deze cloud-omgeving (`which ollama` → leeg, `curl
localhost:11434` → geen respons). Elke stap die het échte lokale model moet draaien is dus
`LOCAL REQUIRED`:

- Fase 1 (immutable BEFORE-benchmark) en Fase 11 (AFTER-benchmark) met het echte model.
- Elke test die specifiek `model/local.ts`-gedrag verifieert (bijv. of `domeinwoordenboek()`
  daadwerkelijk RET in de systeeminstructie van het echte model krijgt).

Het bestaande harnas (`scripts/v106/golden-bench.ts --meting <naam>`) is er wél klaar voor —
dit is, zodra Ollama lokaal draait, één commando, geen nieuwe code om te draaien.

---

## Aanbevolen vervolg (nog niet uitgevoerd in deze sessie)

In volgorde, per de fasetracker in `progress.md`:

1. **Vier veilige, niet-gedrag-veranderende regressietoetsen toevoegen** (mag vóór de BEFORE-freeze,
   want ze veranderen geen bestaand gedrag, alleen dekking): unit-test voor `jsonUit()` met het
   letterlijke historische dubbele-object-scenario; regressietest voor `domeinwoordenboek()` op de
   lokale-modelroute; regressietest voor `DAY_DUTY_WEIGHTS.VROEG`-assumptie; regressietest voor de
   MIX-alias-brontekst-claim.
2. **Eén gecombineerd voor-manifest schrijven** (best-of-both van `n0-manifest.ts` en het
   optimizer-manifest, plus de 4 expliciet beloofde-maar-ontbrekende velden: databaseversie,
   engineversie, kwaliteitsmodelversie, regelsetversie) — kan hier al worden voorbereid, uitvoeren
   (met een echt model) is LOCAL REQUIRED.
3. **BEFORE-benchmark bevriezen** — LOCAL REQUIRED, met het bestaande `golden-bench.ts`-harnas.
4. Pas daarna: Fase 3-10 (canoniek schema/reconciliatie, de 4 gevonden defecten repareren, claim-
   verificatie uitbreiden, regressiesuite groeien) — nooit vóór de freeze.
