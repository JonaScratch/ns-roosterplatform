# Lyra Demo Room — eindrapport Master Program (fasen A–T)

Stand: 2026-09-29, branch `claude/admiring-edison-5y65j7`, HEAD na `19e5b14`.
Dit rapport noemt per fase wat er gebouwd is, hoe het getoetst is, en wat
**niet** bewezen is. Waar een cijfer staat, komt het uit een artefact of een
testuitvoer; waar iets alleen lokaal (met Ollama + database) te meten is,
staat dat er als LOCAL REQUIRED bij.

## Samenvatting

- **Kernsuite**: 43/43 in alle 3 replicaten van AFTER-run `20260929-193436`
  (ook bij de strenge grader /2), fabricatie 0/46 opnieuw uitgerekend. De
  formele FAIL van die run was een telfout in mijn eigen statusscript
  (`after-status.ts`), niet in de metingen; herverificatie zonder
  overschrijven: `AFTER-REVERIFICATION.json`, 12/12 hashes, PASS.
- **Alle fasen A–R gebouwd en getest in deze omgeving.** Volledige suite:
  1339 geslaagd, 1 overgeslagen, 27 gefaald. Die 27 zitten in de 3 bekende
  ortools-bestanden (geen OR-Tools in de cloud) en zijn ongewijzigd sinds de
  baseline. Typecheck: alleen de bekende baselinefouten.
- **Tien end-to-end bewijzen**: 10/10 (`docs/lyra-knowledge/proofs/e2e-20260929-195446.json`),
  met per bewijs vermeld wat synthetisch is.
- **Niet bewezen (LOCAL REQUIRED)**: dat de reparaties voor O-nachtreeks en
  adversarial M/N/P het modelgedrag echt verbeteren. Dat meet alleen een
  nieuwe lokale AFTER-run. De falsifieerbare verwachting staat in §4 van
  `after-analysis-20260929-193436.md`.

## A — Live UI-runtime (Phase A/D)
Ongestylede UI bleek een oude server op poort 4173 zonder routes voor de
opgesplitste assets. Gerepareerd met een asset-contract (`uiAssets.ts`) dat
de server bij het opstarten controleert en een test afdwingt (`0032356`).

## B — AFTER-artefacten geïmporteerd en geverifieerd
Run `20260929-151948`: 6/6 hashes, cijfers herrekend
(`after-analysis-20260929.md`). Kernbevinding: de oude grader telde
antwoorden die door een grendel waren vervangen toch als GOED. Grader /2
past de grendelregel toe (`0345ffb`).

## C — Claimgrendel, klachtonderzoek, verduidelijkingsdiscipline
- De claimgrendel onderscheidt de status van een regel van de herkomst van
  de data (`45aff59`). De grendel is niet uitgezet.
- Plancontrole (`d4161ef`, later uitgebreid in `854d6b3`):
  - geen voorstel zonder rekenverzoek;
  - eerst de bekende context opzoeken;
  - de onderwerptool (nachtreeks → `nightStructure`) wordt aangevuld;
  - een onleesbaar plan leidt niet tot een algemene wedervraag.

## D — Runtime-diagnose
Zie A. Daarnaast: een run waarvan het proces weg is, telt als FAILED en
blokkeert niets meer (`c687790`).

## E — Visuele verificatie in de echte runtime
Alle pagina's zijn tegen de referenties gelegd. De browsertests per
toestand draaien tegen de echte server (`062bbcb`, `ef3f74b`).

## F — Oorspronkelijk Master Program (Fase 9–14)
- Fase 11 (AFTER-launcher met automatische BEFORE→AFTER-vergelijking):
  gebouwd.
- Fase 12 (adversarial holdout met echte toolfoutinjectie): gebouwd.
- Run `20260929-193436` is geanalyseerd:
  - de formele FAIL is verklaard;
  - O-MIX/LN had de verkeerde toolroute;
  - M: een afwijzing werd als toepassing gerekend;
  - N/P: de grader kende het antwoordpatroon niet.

  Alles is generiek gerepareerd, zonder item-id-logica en zonder
  holdouttekst in de generator (`854d6b3`).

## G — Feedbackleren (`demo-room/src/learning/feedback.ts`)
Classificatie naar scope, aard en gezagsclaim.
- Een machinist, planner of ontwikkelaar kan nooit een CAO-regel of formele
  NS-regel maken (`mayBecomeLegalRule`).
- Alleen `NS_FORMEEL` mét een formele verwijzing reikt zo ver.

## H — Conceptgeheugen (`concepts.ts`, `store.ts`)
Toestandsmachine PROPOSED → TESTING → VALIDATED → ACTIVE, plus REJECTED,
CONFLICTED en SUPERSEDED.
- VALIDATED vereist een meting boven de drempel.
- ACTIVE vereist Roostercommissie of NS én geen open conflict.
- De feedback zelf is append-only.

## I — Generalisatie (`generalization.ts`)
Elk concept wordt gemeten op eigen parafrasen, contrasten en een
andere-standplaatsnegatief, met een aparte holdoutsplit. Een te kleine suite
geeft `SuiteTeKlein` in plaats van een schijnzeker cijfer.

## J — Uitdagingsgenerator en onhaalbaarheid
- `challengeGenerator.ts` maakt adversarial uitdagingen uit concepten:
  - een voorkeur die als regel wordt gepresenteerd;
  - een conflict;
  - een onhaalbare wens.
- `infeasibility.ts` verklaart met tellingen waarom een roostereis niet kan.

## K — Candidate Factory (`demo-room/src/factory/manifest.ts`, `store.ts`)
- Elke kandidaat krijgt een manifest vóór de meting, met daarin:
  - de hash van de tekst;
  - de hash van de beoordelingscriteria;
  - de hash van de locked holdout.
- Manifesten worden nooit overschreven.
- De sandboxmap staat per kandidaat.
- Lekdetectie gebruikt 8-grams tegen de holdout.

## L — Onafhankelijke rechter en Pareto-archief (`judge.ts`, `paretoArchive.ts`)
Oordeel: KEEP, REJECT of NEEDS_MORE_EVIDENCE, met bevroren criteria. De
marges zijn dezelfde als in `proof/decision.ts`.
- **REJECT, ongeacht de scores:**
  - een gewijzigde meetlat, gewijzigde holdout, gewijzigde tekst of een
    holdoutlek;
  - elke daling op een veiligheidsdimensie;
  - een regressie boven de marge;
  - een holdoutdaling boven de marge.
- **NEEDS_MORE_EVIDENCE:**
  - de doeldimensie is niet gemeten;
  - minder dan 2 replicaten;
  - de holdout is niet gemeten;
  - de winst valt binnen de ruis.

In de ontwikkelcyclus kan de rechter een positieve proof tegenhouden, maar
nooit een promotie afdwingen. Alleen KEEP's komen in het Pareto-archief;
gedomineerde kandidaten blijven gemarkeerd bewaard.

## M — Roster Arena (`arena.ts`)
Bradley–Terry over paarsgewijze uitslagen per opgave, met een gelijkmarge
voor meetruis. Een ontbrekende opgave telt niet als verlies. Het aantal
beslissende vergelijkingen staat erbij.

## N — Werkverdeling (`workers.ts`)
- **JobQueue:** leases, idempotentiesleutels en een pogingenteller. Een
  worker zonder hartslag verliest zijn job; na het maximum aantal pogingen
  wordt de job FAILED, met reden.
- **Workerregistry:** capaciteiten per worker.
- **BudgetManager:** reserveert budget vóór het werk en rekent daarna af op
  het werkelijke verbruik.

## O — Hervatbare lange runs (`longRun.ts`)
- **Profielen:** 1h, 6h, 24h en handmatig.
- **Checkpoints:** na elke cyclus, atomisch.
- **Pauze en stop:** op de cyclusgrens. Een stop tijdens een pauze werkt
  meteen.
- **Tijdsbudget:** alleen actieve tijd telt.
- **Crashherstel:** de lopende cyclus wordt één keer opnieuw ingepland,
  niet dubbel.
- **Bediening:** CLI `long-run` / `long-run-control`, API `/api/long-runs/*`.

## P — UI-integratie (geen nieuwe hoofdtabbladen)
De navigatie blijft Dashboard / Test Room / Development Runs / Candidates /
Vergelijken / Versies / Logboek. Nieuwe panelen (`ui/lib/panels.js`):

| Pagina | Nieuw paneel |
|---|---|
| Test Room | feedback en concepten |
| Development Runs | lange runs (start, pauze, hervat, stop) |
| Candidates | rechter, Pareto-front en arena |
| Versies | releasegeschiedenis en integriteit, plus goedkeuringsvelden (naam, rol, reden) |

Browsercontrole van alle 7 pagina's: geen paginafouten, geen mislukte
verzoeken. De favicon-404 is opgelost.

## Q — Canonieke Lyra-versiedienst voor het NS Roosterplatform (`src/lib/lyra-release.ts`)
**Lezen:** `getActiveLyraVersion()` en `getLyraVersion()`. Het platform leest
via deze dienst (`src/server/agent/model/local.ts`), bij elke aanvraag
opnieuw.

**Schrijven:** alleen via `commitRelease()`, in deze volgorde:
1. de prompttekst inhoud-geadresseerd opslaan;
2. één atomische wijzerwissel, met hash en generatie.

**Garanties:**
- Een crash tussen stap 1 en 2 laat de oude versie volledig actief.
- Een tekst waarvan de hash niet klopt, wordt niet gebruikt; dan geldt de
  standaardinstructie.
- Gelijktijdige activatie geeft een `ReleaseConflict` (optimistische
  vergrendeling).
- Elke activatie, handmatig of automatisch herstel vereist een benoemde mens
  (id en rol) en een reden, en komt in een append-only activatielogboek.
- De oude opstelling (alleen `NS_PRODUCTION_PROMPT_FILE`) werkt ongewijzigd.

**Live geverifieerd in de browser:** Versies → Activeren weigert zonder naam.
Mét naam, rol en reden activeert het via de gespawnde CLI, en het paneel
toont generatie 1, goedgekeurd door de genoemde persoon, met geverifieerde
hash.

## R — Tien end-to-end bewijzen (`scripts/lyra-master/e2e-proofs.ts`)
In een geïsoleerde tijdelijke staat, met de echte modules aan elkaar
geketend:
1. feedbackgovernance;
2. ontwikkelcyclus → manifest → KEEP → niet-actieve versie;
3. gewijzigde tekst → REJECT;
4. holdoutlek → REJECT ondanks een positieve proof;
5. lange run pauze/hervat/stop (10 uur pauze telt niet);
6. crashherstel;
7. activatie op naam, waarna het platform exact die tekst leest;
8. crash tijdens activatie;
9. gemanipuleerde tekst → standaardinstructie;
10. gelijktijdige activatie → conflict, daarna terugdraaien.

Uitslag: 10/10. Synthetisch is alleen de PRE/POST-meting (die vraagt een
lokaal model). Deze bewijzen tonen dus dat de machinerie en de grenzen
werken, niet dat Lyra inhoudelijk beter is geworden.

## S — Regressie
- **Suite:** 97 testbestanden. Alles groen buiten de 27 bekende
  ortools-tests.
- **Nieuw deze ronde:**
  - `tests/demo-room/factory.test.ts` (32);
  - `tests/lib/lyra-release.test.ts` (13);
  - `tests/lyra-master/e2e-proofs.test.ts`;
  - uitbreidingen van de ontwikkelcyclus-, publish-, versie- en API-tests.
- **Twee tests schreven in de echte `demo-room/data`:** `versions.test.ts`
  en de nieuwe factory-test. Beide zijn nu geïsoleerd, en alleen de
  bestanden die deze sessie zelf had aangemaakt zijn verwijderd.

## T — Documentatie
Dit rapport, plus `progress.md`, `after-analysis-20260929-193436.md` en de
bewijsrapporten onder `docs/lyra-knowledge/proofs/`. Het eerdere rapport
`e2e-20260929-195316.json` blijft staan als bewijs van die run. Het is
gemaakt vóór de correctie ACTIVATE/ROLLBACK in bewijs 10.

## Veiligheidsgrenzen — nagelopen
- Productie-activatie is altijd op naam, met reden en bevestiging. Geen
  enkel autonoom pad (ontwikkelcyclus, lange run, rechter) activeert een
  versie.
- Een kandidaat kan de rechtercriteria of de holdout niet wijzigen zonder
  REJECT (de hashes staan in het manifest).
- Generatoren zien de holdout niet. Alleen de rechter leest de holdout, voor
  lekdetectie.
- Feedback maakt geen CAO-regel.
- Benchmarkartefacten zijn niet overschreven:
  - een nieuw rapport krijgt een nieuwe run-ID;
  - `wx`- en no-overwrite-controles blijven staan;
  - herverificatie komt in een apart bestand.
- Geen destructieve git-operaties, geen force-push, geen geheimen of lokale
  databasegegevens gecommit.

## Na AFTER-run 20260929-234655 (vervolgronde)

### Verificatie

De kernbaseline is opnieuw nagerekend:
- 12/12 hashes kloppen;
- 43/43 in alle drie replicaten;
- agreement 1,0;
- strict 0 regressies;
- fabricatie 0/46.

### O/P/K

De oorzaken zijn generiek gerepareerd (`3ee83aa`, analyse in
`after-analysis-20260929-234655.md`):

| Item | Oorzaak | Reparatie |
|---|---|---|
| O-MIX | graderfout: "regel 8" werd als reekslengte gelezen | grader leest plekken en tijden niet meer als lengte |
| O-LN | de grondwaarheid telde per regel, tegen haar eigen contract en `roster-flow.ts` in | één cirkel over het hele rooster |
| P | bronstatus ontbrak in de tooldata; een afwezigheid van het document werd verzonnen | bronstatus per document, plus grendel AFWEZIGHEID |
| K | het woordenboek matchte binnen een langere dagdeelsamenstelling; de grendel rekende de door het platform aangereikte context als verzonnen; de melding gooide "niets gevonden" weg | woordenboek, grendel en melding gerepareerd |

Verder:
- Een holdoutlek in eigen testcode is gedicht en wordt nu afgedwongen door
  `holdout-lek.test.ts`.
- De replay zonder model over 854 beurten: de nieuwe grendel raakt alleen P,
  en geen enkele kernvraag verandert.

### De autonome leercyclus

`develop/developmentCycle.ts` doorloopt en registreert nu elf stappen, elk met
bewijs:

1. diagnose
2. hypothese
3. kandidaat
4. validator
5. experiment
6. benchmark
7. holdout
8. adversarial
9. onafhankelijke rechter (judge/2)
10. besluit
11. leren

Nieuwe bouwstenen:
- **Leergeheugen** (`develop/lessons.ts`), append-only en over runs heen:
  - een verworpen strategie komt voor die dimensie niet terug;
  - "meer bewijs nodig" betekent dezelfde hypothese met meer replicaten, en
    geldt na twee keer onbeslist als geprobeerd;
  - een uitgeputte dimensie wordt overgeslagen;
  - staat alles vast, dan stopt de run eerlijk met `ALLES_GEPROBEERD`.
- **Drie strategieën per zwakte** (REGEL, ZELFCONTROLE, WAAROM). Ze voegen
  allemaal alleen tekst toe, zoals publicatie dat ook doet.
- **Validator vóór de meting** (`develop/validator.ts`). Hij controleert:
  publiceerbaar, begrensd, geen holdoutlek, geen gezagsclaim, geen vastgezet
  feit.
- **Adversarial holdout** voor productie en kandidaat
  (`proof/adversarialStage.ts`), beoordeeld met dezelfde grader als de lokale
  AFTER-run.
- **judge/2:** elke adversarial daling is REJECT; zonder adversarial meting is
  het oordeel NEEDS_MORE_EVIDENCE.
- **Lange runs** leggen per cyclus de stappen, de les en de productiestand
  vast.
- **`scripts/lyra-master/verify-long-run.ts`** controleert een echte run op
  alle stopvoorwaarden en schrijft `LONG-RUN-VERIFICATION.json`. Het
  overschrijft nooit.

**Bewijs 11** (`proofs/e2e-20260929-230756.json`, 11/11) volgt 8 cycli, met
een synthetische meting:
1. op toolChoice worden drie verschillende strategieën verworpen;
2. de diagnose kiest daarna zelf grounding, en daar werkt de eerste strategie
   (KEEP);
3. op machinistTaal worden drie strategieën verworpen;
4. de run stopt zelfstandig met `ALLES_GEPROBEERD`.

`verify-long-run` geeft op alles OK, behalve (terecht) "echt taalmodel". Die
controle kan alleen een lokale run halen.

**Wiring in de cloud** (zonder model en database): de CLI-run stopt eerlijk
met `GEEN_DIAGNOSE`, en de verificatie geeft FAIL. Een run die niets mat,
bewijst dus niets.

## Stopvoorwaarden voor `LYRA_DEMO_ROOM_AUTONOMOUS_PROGRAM_COMPLETE`

Het merk wordt pas gezet als beide punten aantoonbaar zijn, uit gepushte
artefacten:

1. Een nieuwe AFTER-run op de huidige HEAD, met:
   - kern 43/43 ×3, agreement 1,0, strict 0 regressies, fabricatie 0/46;
   - M en N GOED;
   - O 7/7;
   - P GOED;
   - K niet FOUT.
2. `LONG-RUN-VERIFICATION.json` met status PASS voor een echte lange run
   (echt model, minstens twee volledige cycli, aantoonbaar lerend, productie
   onaangeroerd).

## Openstaand — LOCAL REQUIRED

**BLOCKER:** deze cloudomgeving heeft geen Ollama/qwen3:8b en geen
ontwikkeldatabase. De drie stappen hieronder kunnen alleen lokaal.

**COMMAND** (op de eigen pc, in de repo, in deze volgorde; niet tegelijk,
want ze delen het model):
```powershell
git pull

# A — O herbeoordelen zonder model (alleen de database): bestaande ruwe antwoorden, nieuwe grader en grondwaarheid
npx tsx --conditions=react-server scripts/v106/golden-grade-extension.ts --meting after-20260929-234655-r1 --uitvoer golden-grade-extension-v3.json
npx tsx --conditions=react-server scripts/v106/golden-grade-extension.ts --meting after-20260929-234655-r2 --uitvoer golden-grade-extension-v3.json
npx tsx --conditions=react-server scripts/v106/golden-grade-extension.ts --meting after-20260929-234655-r3 --uitvoer golden-grade-extension-v3.json

# B — nieuwe AFTER-run op de nieuwe HEAD
.\run-after-local.ps1 -PreflightOnly
.\run-after-local.ps1

# C — echte autonome lange Development Run (of: Development Runs → Lange runs → 6 uur → Start)
npm run demo-room -- long-run --profiel 6h
# daarna, met het run-ID dat de run noemt:
npx tsx --conditions=react-server scripts/lyra-master/verify-long-run.ts --run <runId>
```

**RETURN:** push de volgende nieuwe bestanden:
- `docs/v1.0.6/benchmarks/after-20260929-234655-r{1,2,3}/golden-grade-extension-v3.json`;
- de nieuwe map `docs/lyra-knowledge/benchmarks/after/<run-id>/` met
  adversarial en vergelijkingen;
- `docs/lyra-knowledge/long-runs/<runId>/`, met daarin
  `LONG-RUN-VERIFICATION.json` en een kopie van het checkpoint.

**NEXT:**
1. De artefacten verifiëren tegen de stopvoorwaarden hierboven en de
   verwachting in §8 van `after-analysis-20260929-234655.md`.
2. Bij een afwijking de oorzaak generiek repareren.
3. Pas als beide stopvoorwaarden bewezen zijn:
   `LYRA_DEMO_ROOM_AUTONOMOUS_PROGRAM_COMPLETE`.
