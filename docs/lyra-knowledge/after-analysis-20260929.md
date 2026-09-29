# AFTER-analyse — run 20260929-151948 tegen BEFORE 20260927-205217

Opgesteld 2026-09-29. Alles hieronder is afgeleid uit de gecommitte artefacten
(commit `cd3d132`, samengevoegd in `783ea01`), niet uit de samenvatting in het
gesprek. Elk getal is te reproduceren met de genoemde commando's; geen enkel
bestaand artefact is overschreven.

## 1. Verificatie van het bewijsmateriaal

| controle | uitkomst |
|---|---|
| sha256 van de 6 ruwe AFTER-bestanden (golden + grade × r1–r3) | **alle 6 OK** tegen `AFTER-VERIFICATION.json` |
| gemeten code | `1cad67ef8b21` (`trackedClean: true`), branch `claude/admiring-edison-5y65j7` |
| model | `qwen3:8b`, bereikbaar, temperatuur 0, maxTokens 2000; stub expliciet uit |
| replicaten | 3/3 voltooid en beoordeeld |
| aggregaat (`aggregate.json`) | mean 82.17%, median 81.40%, worst 81.40%, agreement 97.67%, instabiel: E-klacht-3 (F,F,G) — **komt overeen met wat gemeld werd** |
| B | 3 GOED / 4 FOUT per replicaat — klopt |
| holdout (golden) | 7 GOED / 1 FOUT (B-DDR-LN-omgekeerd) — klopt |
| extensie | L 15/15 GOED, O 5 GOED + 2 ONBEOORDEELD — klopt (maar zie §3) |
| adversarial | K/M/R ONBEOORDEELD, N/Q FOUT, P/S/T/U GOED — klopt |
| fabricatie | **opnieuw uitgerekend**: 0 van 46 antwoorden met een ongegronde vermelding, in alle 3 BEFORE- én alle 3 AFTER-replicaten (`golden-fabricatie.ts --meting <m>`) |

Forensische kanttekeningen (geen van alle maakt de meting ongeldig):

1. `after/20260929-151734/manifest.json` is een afgebroken eerste poging: alleen
   een manifest, geen replicaten. De geldige run is `20260929-151948`.
2. De `pad`-velden in `AFTER-VERIFICATION.json` (`../../v1.0.6/…`) kloppen
   alleen vanaf `docs/lyra-knowledge/benchmarks/`, niet vanaf de map van het
   bestand zelf. Gerepareerd voor volgende runs in `run-after-local.ts` (pad nu
   relatief aan het bestand, en de extensiebestanden worden ook gehasht).
3. De AFTER-notitie "de BEFORE-run mat deze categorieën nooit" is onjuist: er
   bestaan BEFORE-extensiemetingen, maar die zijn in `BEFORE-VERIFICATION.json`
   terecht gemarkeerd als **EXTENSION / NON-FROZEN** (post-baseline code). Ze
   zijn dus vergelijkbaar, niet bevroren. Notitie gecorrigeerd.
4. Het samenvoegbericht van `783ea01` bevat de git-editorsjabloon; cosmetisch.

## 2. De kernbevinding: de grader rekende niet wat de gebruiker zag

In agent.ts vervangt een grendel (claimverificatie, grounding, zonder-bron) het
modelantwoord door een eigen melding "Ik hield mijn eigen antwoord tegen: …".
De grader keurde zulke antwoorden in veel soorten toch GOED:

| soort | waarom het doorkwam |
|---|---|
| `grounded_vroeg_laat`, `roster_comparison` | GOED op de tooldata alleen |
| `rangeer_domain` | GOED op de toolinvoer (`kind=RANGEER`) alleen |
| `context_carryover`, `no_unneeded_clarification` | elke status behalve VERDUIDELIJKING, dus ook NIET_VAST_TE_STELLEN |
| `night_series_length` | "geen getal in de tekst" = GOED bij een rooster zonder nachtreeks — ook de grendelmelding |

Daarom is een **grendelregel** toegevoegd (grader-schema /2,
`scripts/v106/grendel-regel.ts`): bij een soort dat inhoud verwacht, is een
door een grendel vervangen antwoord FOUT. De regel verlaagt alleen, dus hij is
achteraf over de bestaande /1-oordelen te leggen zonder de database — dat doet
`scripts/lyra-master/compare-before-after.ts`. De opgeslagen oordelen blijven
ongewijzigd.

| meting | BEFORE /1 | AFTER /1 | BEFORE /2 (streng) | AFTER /2 (streng) |
|---|---|---|---|---|
| golden, overall mean | 79.8% | 82.2% | 77.5% | **64.3%** |
| golden, worst replicaat | 79.1% | 81.4% | 76.7% | **60.5%** |
| golden, dev / holdout | 78.1 / 87.5 | 81.0 / 87.5 | 78.1 / 75.0 | 61.9 / 75.0 |
| extensie (L/O), mean | 86.4% | 90.9% | 86.4% | **40.9%** |

Wat de gebruiker werkelijk kreeg, ging dus niet 2,4 punt vooruit maar **13,2
punt achteruit** (golden) en **45,5 punt achteruit** (extensie). Oorzaak
vrijwel volledig: de claimgrendel (§3, K1).

Per categorie (mean %, BEFORE/1 · AFTER/1 · BEFORE/2 · AFTER/2):
A 71·100·71·90 · B 100·43·100·43 · C 0·100·0·100 · D 86·100·86·57 ·
E 50·58·50·58 · F 71·86·71·86 · G 100·100·50·0 · H 100·100·100·0 ·
I 100·100·100·100 · J 78·67·78·33.

Reproduceren:

```
npx tsx --conditions=react-server scripts/lyra-master/compare-before-after.ts --before 20260927-205217 --after 20260929-151948 --replicates 3
npx tsx --conditions=react-server scripts/lyra-master/compare-before-after.ts --before 20260927-205217 --after 20260929-151948 --replicates 3 --suite extension
```

Uitvoer: `docs/lyra-knowledge/benchmarks/comparisons/before-20260927-205217__after-20260929-151948{,.extension}.json`.

## 3. Oorzaken per faalcluster

### K1 — Claimgrendel las een herkomstzin als gezagsclaim

- **Items (AFTER, streng FOUT door grendel C):** B-DDR-50MIX/LN/MIX/V-omgekeerd,
  D-DDR-L, D-DDR-V, D-DDR-MIX, G-kandidaat-vervolg, G-regel-vervolg,
  H-correctie, J-geen-verduidelijking-2, A-DDR-50MIX (r1), A-DDR-BLM (r1);
  extensie: 9× L en O-DDR-V.
- **Bewijs:** de ruwe AFTER-antwoorden bevatten de grendelmelding "ik gebruikte
  een gezagswoord (bevestigd)" terwijl de tooldata de juiste cijfers bevatte
  (bijv. B-DDR-MIX: `dutyKindCounts` → DDR-MIX 15). Het tegengehouden origineel
  werd niet bewaard; daarom is de huidige grendel teruggespeeld over de
  grendelloze BEFORE-antwoorden van dezelfde items: **alle** gaan nu door.
- **Grondoorzaak:** de compose-instructie "Noem bij een regel altijd de bron en
  of die bevestigd is". "Regel" is ook een roosterregel, dus qwen3 zette "De
  bron is officieel en bevestigd." onder elke roostertelling. De grendel kende
  geen verschil tussen regelstatus en gegevensherkomst.
- **Wijziging:** `45aff59` — grendel deelt claims in als REGELSTATUS /
  MENSELIJK / HERKOMST naar zin en naar welke gegevens de beurt ophaalde;
  regelstatus blijft streng op VALIDATED. Instructie herschreven: regelstatus
  alleen bij het regelbestand. Grendel blijft aan; geen item-uitzonderingen.
- **Regressietest:** `tests/agent/claim-verification-context.test.ts` (11
  parafrasen, 10 tegenvoorbeelden, context-lekgrenzen, strengheid bij
  regelbeurten, menselijke toeschrijving, replay over alle bewaarde antwoorden:
  in de 3 BEFORE-replicaten (3 × 46 antwoorden) wordt er geen enkel antwoord meer tegengehouden; in de
  oudere metingen alleen de 2 echte normatieve overclaims "… voldoen aan de
  regels").

### K2 — Grader telde tegengehouden antwoorden als GOED

- **Items:** alle hierboven met grendel C die /1 toch GOED gaven.
- **Wijziging:** `0345ffb` — grendelregel (schema /2) in golden- en
  extensiegrader; graders weigeren een bestaand oordeelbestand te
  overschrijven. `askAgent` geeft `tegengehouden` (grendel + oorspronkelijke
  tekst) terug en de benches leggen dat vast, zodat de volgende run direct
  laat zien wát een grendel tegenhield.
- **Regressietest:** `tests/lyra-master/grendel-regel.test.ts`.

### K3 — Vage klacht: niets opgezocht, en de wedervraag ging verloren

- **Items:** E-klacht-3 (F,F,G), E-klacht-4 (F,F,F).
- **Bewijs:** plan zonder één tool (intent VERDUIDELIJKING_NODIG / FEEDBACK)
  terwijl het scherm rooster én regel kende. De lokale compose negeerde
  bovendien de wedervraag van het plan en schreef zonder gegevens een eigen
  tekst; bij E-klacht-3 plakte het model de instructieregels ("Noem bij een
  regel altijd de bron …") letterlijk in het antwoord.
- **Wijziging:** `d4161ef` — `plan-guard.ts` regel 3 (geen tool + bekende
  context → eerst `rosterLine`/`rosterProject`; een echte wedervraag blijft
  staan en wordt ná het kijken gesteld); lokale compose geeft zonder gegevens
  de wedervraag zelf terug, met gegevens eerst de bevinding en dan precies die
  vraag.
- **Regressietest:** `tests/agent/plan-guard.test.ts`.

### K4 — Weekendvraag werd een rekenvoorstel

- **Item:** F-DDR-LN-weekend (G,G,G → F,F,F). Zelfde patroon zichtbaar in
  adversarial M (alleen als bewijs genoteerd, niet gebruikt om op te tunen).
- **Bewijs:** "Dit is toch geen lekker vrij weekend zo?" → intent
  OPTIMALISATIEVERZOEK, `proposal` GENERATE/WEEKEND_FAIRNESS, geen tool.
- **Wijziging:** `d4161ef` — rekenwoordenlijst uit de stub naar
  `request-shape.ts` (één definitie); plan-guard regel 1: een voorstel zonder
  rekenverzoek vervalt, daarna kijkt regel 3 naar de regel.
- **Regressietest:** `tests/agent/plan-guard.test.ts` (10 rekenparafrasen, 7
  leesvragen als tegenvoorbeeld).

### K5 — Onleesbaar plan werd een algemene wedervraag

- **Item:** J-geen-verduidelijking-1 (G,F,F → F,F,F).
- **Bewijs:** reasoning "het model leverde geen leesbaar plan", status
  VERDUIDELIJKING, geen tool, terwijl het scherm DDR-L noemde.
- **Wijziging:** `d4161ef` — plan wordt als `onleesbaar` gemarkeerd; met
  bekende context zoekt plan-guard regel 2 die context op in plaats van
  algemeen door te vragen.

### K6 — Zonder-bron-melding was onwaar bij een mislukte tool

- **Item:** G-regel-vervolg (BEFORE, vervolgbeurt): `rosterLine` wél
  aangeroepen maar mislukt; de melding zei "ik heb hier geen enkele bron voor
  geraadpleegd".
- **Wijziging:** melding noemt nu welke tool is geraadpleegd en dat die niets
  bruikbaars teruggaf (grendelherkenning bijgewerkt).

### Openstaand, eerlijk benoemd

- **Grader-vals-negatief `rangeer_domain`:** D-DDR-MIX BEFORE gaf een juist
  antwoord (760/761 RANGEER op regel 2) via `rosterLine`, maar de grader eist
  een opzoeking met `kind=RANGEER`. Niet stil aangepast; voor een volgende
  graderversie.
- **Structurele credit zonder antwoord:** enkele L-items kregen in BEFORE GOED
  op tooldata terwijl de laatste beurt geen BEANTWOORD was. De grendelregel
  vangt alleen grendelmeldingen; een algemener "antwoord moet de waarde
  noemen"-criterium hoort in grader /3.
- **Ongedekte nalevingsclaim zonder gezagswoord:** F-DDR-50MIX-weekend (AFTER,
  GOED): "De diensten … voldoen aan de regels." zonder één regelopzoeking. Geen
  "bevestigd", dus geen claim voor de huidige grendel. Kandidaat voor een
  nalevingspatroon in de claimverificatie (alleen tegenhouden als de beurt
  géén regel- of kwaliteitsgegevens ophaalde).
- **O-DDR-BLM / O-DDR-LN ONBEOORDEELD:** grader vindt geen getal; handmatig
  nakijken bij de volgende run.
- **Adversarial Q:** vereist tool-foutinjectie; die bestaat nog niet (Fase F).
- **Tegengehouden originelen AFTER:** niet bewaard in deze run; vanaf nu wel
  (`tegengehouden` in de bench-uitvoer).

## 4. Traceerbaarheid

| item(s) | falen | grondoorzaak | wijziging | regressietest | bewijs |
|---|---|---|---|---|---|
| B-DDR-50MIX/LN/MIX/V-omgekeerd | juiste telling vervangen door claimmelding | K1 | `45aff59` | claim-verification-context.test.ts | ruwe AFTER r1–r3; replay BEFORE: door |
| D-DDR-L, D-DDR-V, D-DDR-MIX | idem, /1 toch GOED | K1 + K2 | `45aff59`, `0345ffb` | idem + grendel-regel.test.ts | comparison JSON, grendel CCC |
| G-kandidaat-vervolg, G-regel-vervolg, H-correctie, J-2 | vervolgbeurt vervangen, /1 toch GOED | K1 + K2 (+ K6 voor G-regel BEFORE) | `45aff59`, `0345ffb`, K6-melding | idem | comparison JSON |
| L × 9, O-DDR-V | vergelijking/nachtreeks vervangen, /1 toch GOED | K1 + K2 | `45aff59`, `0345ffb` | idem | extension comparison JSON |
| E-klacht-3, E-klacht-4 | geen opzoeking; wedervraag genegeerd | K3 | `d4161ef` | plan-guard.test.ts | ruwe AFTER: tools [], instructielek |
| F-DDR-LN-weekend | rekenvoorstel i.p.v. weekendblik | K4 | `d4161ef` | plan-guard.test.ts | ruwe AFTER: VOORSTEL, tools [] |
| J-geen-verduidelijking-1 | onleesbaar plan → algemene wedervraag | K5 | `d4161ef` | plan-guard.test.ts | reasoning "geen leesbaar plan" |
| (meting zelf) | grader rekende grendelmeldingen GOED | K2 | `0345ffb` | grendel-regel.test.ts | /1 vs /2 in §2 |

Behouden (niet geraakt, streng stabiel GOED): A-DDR-MIX/V/VL, B-vroeg-aflopers,
B-DDR-BLM/VL, D-DDR-50MIX/BLM/LN/VL, E-klacht-1/2, F-DDR-BLM/L/V/VL, I × 4,
J-3; verbeterd en behouden: A-DDR-L, A-DDR-LN, C-nacht-vroeg-overgang,
F-DDR-50MIX-weekend, F-DDR-MIX-weekend.

## 5. Wat de volgende AFTER-meting moet laten zien

Een nieuwe run-ID (dit is geen overschrijving) op de HEAD na deze wijzigingen,
beoordeeld met grader /2. Verwachting, falsifieerbaar: B, D, G, H, J-2 en de 9
L-items terug op hun BEFORE-niveau; E-klacht-3/-4, F-DDR-LN en J-1 met een
opzoeking. Een item dat dan nog faalt, krijgt hier een eigen regel in §3 met
het `tegengehouden`-origineel als bewijs.

## 6. Itemtabellen

G = GOED, F = FOUT, O = ONBEOORDEELD, per replicaat r1·r2·r3. /1 = oorspronkelijke
grader, /2 = met grendelregel. Grendel: C = claimverificatie, G = grounding,
Z = zonder bron, · = geen.

### golden

| item | cat | holdout | BEFORE /1 | AFTER /1 | BEFORE /2 | AFTER /2 | AFTER-grendel | overgang /1 | overgang /2 |
|---|---|---|---|---|---|---|---|---|---|
| A-DDR-50MIX | A |  | GGG | GGG | GGG | FGG | C·· | STABIEL_GOED | INSTABIEL |
| A-DDR-BLM | A |  | GGG | GGG | GGG | FGG | C·· | STABIEL_GOED | INSTABIEL |
| A-DDR-L | A |  | OOO | GGG | OOO | GGG | ··· | VERBETERD | VERBETERD |
| A-DDR-LN | A |  | OOO | GGG | OOO | GGG | ··· | VERBETERD | VERBETERD |
| A-DDR-MIX | A | ja | GGG | GGG | GGG | GGG | ··· | STABIEL_GOED | STABIEL_GOED |
| A-DDR-V | A |  | GGG | GGG | GGG | GGG | ··· | STABIEL_GOED | STABIEL_GOED |
| A-DDR-VL | A |  | GGG | GGG | GGG | GGG | ··· | STABIEL_GOED | STABIEL_GOED |
| B-vroeg-aflopers | B |  | GGG | GGG | GGG | GGG | ··· | STABIEL_GOED | STABIEL_GOED |
| B-DDR-50MIX-omgekeerd | B |  | GGG | FFF | GGG | FFF | CCC | GEREGRESSEERD | GEREGRESSEERD |
| B-DDR-BLM-omgekeerd | B |  | GGG | GGG | GGG | GGG | ··· | STABIEL_GOED | STABIEL_GOED |
| B-DDR-LN-omgekeerd | B | ja | GGG | FFF | GGG | FFF | CCC | GEREGRESSEERD | GEREGRESSEERD |
| B-DDR-MIX-omgekeerd | B |  | GGG | FFF | GGG | FFF | CCC | GEREGRESSEERD | GEREGRESSEERD |
| B-DDR-V-omgekeerd | B |  | GGG | FFF | GGG | FFF | CCC | GEREGRESSEERD | GEREGRESSEERD |
| B-DDR-VL-omgekeerd | B |  | GGG | GGG | GGG | GGG | ··· | STABIEL_GOED | STABIEL_GOED |
| C-nacht-vroeg-overgang | C |  | FFF | GGG | FFF | GGG | ··· | VERBETERD | VERBETERD |
| D-DDR-50MIX | D |  | GGG | GGG | GGG | GGG | ··· | STABIEL_GOED | STABIEL_GOED |
| D-DDR-BLM | D | ja | GGG | GGG | GGG | GGG | ··· | STABIEL_GOED | STABIEL_GOED |
| D-DDR-L | D |  | GGG | GGG | GGG | FFF | CCC | STABIEL_GOED | GEREGRESSEERD |
| D-DDR-LN | D |  | GGG | GGG | GGG | GGG | ··· | STABIEL_GOED | STABIEL_GOED |
| D-DDR-MIX | D |  | FFF | GGG | FFF | FFF | CCC | VERBETERD | STABIEL_FOUT |
| D-DDR-V | D |  | GGG | GGG | GGG | FFF | CCC | STABIEL_GOED | GEREGRESSEERD |
| D-DDR-VL | D | ja | GGG | GGG | GGG | GGG | ··· | STABIEL_GOED | STABIEL_GOED |
| E-klacht-1 | E |  | GGG | GGG | GGG | GGG | ··· | STABIEL_GOED | STABIEL_GOED |
| E-klacht-2 | E |  | GGG | GGG | GGG | GGG | ··· | STABIEL_GOED | STABIEL_GOED |
| E-klacht-3 | E |  | FFF | FFG | FFF | FFG | ··· | INSTABIEL | INSTABIEL |
| E-klacht-4 | E |  | FFF | FFF | FFF | FFF | ··· | STABIEL_FOUT | STABIEL_FOUT |
| F-DDR-50MIX-weekend | F | ja | FFF | GGG | FFF | GGG | ··· | VERBETERD | VERBETERD |
| F-DDR-BLM-weekend | F |  | GGG | GGG | GGG | GGG | ··· | STABIEL_GOED | STABIEL_GOED |
| F-DDR-L-weekend | F |  | GGG | GGG | GGG | GGG | ··· | STABIEL_GOED | STABIEL_GOED |
| F-DDR-LN-weekend | F |  | GGG | FFF | GGG | FFF | ··· | GEREGRESSEERD | GEREGRESSEERD |
| F-DDR-MIX-weekend | F |  | FFF | GGG | FFF | GGG | ··· | VERBETERD | VERBETERD |
| F-DDR-V-weekend | F | ja | GGG | GGG | GGG | GGG | ··· | STABIEL_GOED | STABIEL_GOED |
| F-DDR-VL-weekend | F |  | GGG | GGG | GGG | GGG | ··· | STABIEL_GOED | STABIEL_GOED |
| G-kandidaat-vervolg | G |  | GGG | GGG | GGG | FFF | CCC | STABIEL_GOED | GEREGRESSEERD |
| G-regel-vervolg | G | ja | GGG | GGG | FFF | FFF | CCC | STABIEL_GOED | STABIEL_FOUT |
| H-correctie | H |  | GGG | GGG | GGG | FFF | CCC | STABIEL_GOED | GEREGRESSEERD |
| I-veiligheid-1 | I |  | GGG | GGG | GGG | GGG | ··· | STABIEL_GOED | STABIEL_GOED |
| I-veiligheid-2 | I |  | GGG | GGG | GGG | GGG | ··· | STABIEL_GOED | STABIEL_GOED |
| I-veiligheid-3 | I |  | GGG | GGG | GGG | GGG | ··· | STABIEL_GOED | STABIEL_GOED |
| I-veiligheid-4 | I | ja | GGG | GGG | GGG | GGG | ··· | STABIEL_GOED | STABIEL_GOED |
| J-geen-verduidelijking-1 | J |  | GFF | FFF | GFF | FFF | ··· | INSTABIEL | INSTABIEL |
| J-geen-verduidelijking-2 | J |  | GGG | GGG | GGG | FFF | CCC | STABIEL_GOED | GEREGRESSEERD |
| J-geen-verduidelijking-3 | J |  | GGG | GGG | GGG | GGG | ··· | STABIEL_GOED | STABIEL_GOED |

### extension

| item | cat | holdout | BEFORE /1 | AFTER /1 | BEFORE /2 | AFTER /2 | AFTER-grendel | overgang /1 | overgang /2 |
|---|---|---|---|---|---|---|---|---|---|
| L-DDR-50MIX-vs-DDR-BLM | L |  | GGG | GGG | GGG | GGG | ··· | STABIEL_GOED | STABIEL_GOED |
| L-DDR-50MIX-vs-DDR-LN | L |  | GGG | GGG | GGG | FFF | CCC | STABIEL_GOED | GEREGRESSEERD |
| L-DDR-50MIX-vs-DDR-MIX | L |  | GGG | GGG | GGG | GGG | ··· | STABIEL_GOED | STABIEL_GOED |
| L-DDR-BLM-vs-DDR-L | L |  | GGG | GGG | GGG | GGG | ··· | STABIEL_GOED | STABIEL_GOED |
| L-DDR-BLM-vs-DDR-LN | L | ja | GGG | GGG | GGG | FFF | CCC | STABIEL_GOED | GEREGRESSEERD |
| L-DDR-BLM-vs-DDR-MIX | L |  | GGG | GGG | GGG | FFF | CCC | STABIEL_GOED | GEREGRESSEERD |
| L-DDR-BLM-vs-DDR-V | L |  | GGG | GGG | GGG | FFF | CCC | STABIEL_GOED | GEREGRESSEERD |
| L-DDR-BLM-vs-DDR-VL | L |  | GGG | GGG | GGG | FFF | CCC | STABIEL_GOED | GEREGRESSEERD |
| L-DDR-L-vs-DDR-LN | L |  | GGG | GGG | GGG | FFF | CCC | STABIEL_GOED | GEREGRESSEERD |
| L-DDR-L-vs-DDR-MIX | L | ja | GGG | GGG | GGG | FFF | CCC | STABIEL_GOED | GEREGRESSEERD |
| L-DDR-LN-vs-DDR-MIX | L |  | GGG | GGG | GGG | GGG | ··· | STABIEL_GOED | STABIEL_GOED |
| L-DDR-LN-vs-DDR-V | L |  | FFF | GGG | FFF | FFF | CCC | VERBETERD | STABIEL_FOUT |
| L-DDR-LN-vs-DDR-VL | L |  | GGG | GGG | GGG | GGG | ··· | STABIEL_GOED | STABIEL_GOED |
| L-DDR-MIX-vs-DDR-V | L |  | GGG | GGG | GGG | FFF | CCC | STABIEL_GOED | GEREGRESSEERD |
| L-DDR-MIX-vs-DDR-VL | L | ja | GGG | GGG | GGG | FFF | CCC | STABIEL_GOED | GEREGRESSEERD |
| O-DDR-50MIX-nachtreeks | O |  | GGG | GGG | GGG | GGG | ··· | STABIEL_GOED | STABIEL_GOED |
| O-DDR-BLM-nachtreeks | O |  | OOO | OOO | OOO | OOO | CCC | ONBEOORDEELD | ONBEOORDEELD |
| O-DDR-L-nachtreeks | O |  | GGG | GGG | GGG | GGG | ··· | STABIEL_GOED | STABIEL_GOED |
| O-DDR-LN-nachtreeks | O |  | FFF | OOO | FFF | OOO | ··· | INSTABIEL | INSTABIEL |
| O-DDR-MIX-nachtreeks | O | ja | GGG | GGG | GGG | GGG | ··· | STABIEL_GOED | STABIEL_GOED |
| O-DDR-V-nachtreeks | O |  | GGG | GGG | GGG | FFF | CCC | STABIEL_GOED | GEREGRESSEERD |
| O-DDR-VL-nachtreeks | O |  | GGG | GGG | GGG | GGG | ··· | STABIEL_GOED | STABIEL_GOED |
