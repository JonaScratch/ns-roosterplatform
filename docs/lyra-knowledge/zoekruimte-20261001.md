# Dynamische zoekruimte voor lange runs — 20261001

Oplossing van de ene blocker uit `eindcontrole-20260930.md`. De echte
6-uursrun `DR-UI-20260930165141-d5a8` stopte na **131,5 van 360** actieve
minuten met `DONE · ALLES_GEPROBEERD`. De oorzaak: de vaste startruimte
(3 strategieën × 6 gemeten zwaktes) was op, en die ruimte werd niet verbreed.
De verifier controleerde bovendien niet of het budget benut was.

Masterprompt: "done when the system continually executes meaningful
learning/development cycles **for the budgeted period**", en §55 bij
uitputting/stagnatie: "changing strategy; widening hypothesis search;
generating new unseen tests; switching specialist; stopping that branch;
escalating to Claude/human if a new capability is required".

## Wat er veranderd is

**Uitputting is een overgang, geen einde** (`demo-room/src/factory/longRun.ts`).
Twee momenten leiden tot een nieuwe golf van de regisseur:

- **POOL_UITGEPUT**: een cyclus meldt `UITGEPUT`.
- **STAGNATIE**: `stagnatieVenster` gemeten cycli op rij zonder KEEP, promotie
  of meer-bewijs ("no improvement for N cycles").

Een golf wordt vóór de volgende cyclus in het checkpoint vastgelegd. Een golf
met nieuwe hypothesen geeft elke zwakte een vers lokaal budget. Zwaktes die
alleen door het lokale vangnet dicht zaten maar nog open hypothesen hebben,
worden heropend. `ALLES_GEPROBEERD` wordt niet meer gegeven; het blijft alleen
om oude checkpoints te lezen.

**De regisseur** (`demo-room/src/develop/zoekruimte.ts`) is zuiver: geen
bestanden, geen model, geen klok. Per golf doet hij vijf dingen.

1. **Analyse.** Per zwakte uit de lessen:
   - faalwijzen: geen effect, bijwerking (welke dimensie), holdout- of
     adversarialdaling, onbeslist, validator;
   - de beste deelwinst op het doel;
   - of de meting de hypothesen onderscheidt. Dat doet hij niet als de
     dimensie nooit beweegt, of alleen in stappen van ≥ 25pp (een handvol
     items).
2. **Aanpak** ("specialist"). Vier aanpakken: zwakste eerst, hefboom,
   bijwerkingen eerst, robuustheid. Leverde de vorige golf niets op, of was er
   stagnatie, dan wisselt de aanpak. Altijd eerst verkennen, dan verdiepen: een
   gemeten zwakte zonder enige poging krijgt haar startruimte vóór een al
   geprobeerde zwakte een nieuwe golf krijgt. Dit is gevonden in de proef op de
   echte keten: zonder die regel verdiepte de regisseur eindeloos dezelfde twee
   zwaktes.
3. **Voorstellen**: samenstellingen van generieke interventies
   (`demo-room/src/develop/interventies.ts`):
   - **operatoren**: ZELFCONTROLE, WAAROM, STAPPEN, VOORRANG, AFBAKENING,
     TWIJFEL, PRINCIPE, plus vormoperator NADRUK;
   - **bescherming** `BESCHERM:<dimensie>` = de eis van een andere dimensie
     erbij.

   De soorten voorstellen, in deze volgorde:
   - COMPOSITIE: deelwinst met bijwerking → dezelfde aanpak mét bescherming;
   - GERICHT: operatoren die op de gevonden faalwijze aangrijpen;
   - MUTATIE: de laatste verworpen aanpak + nadruk. Die moet geweigerd
     worden;
   - VERBREDING: ongeprobeerde klassen, dan paren, dan drietallen.

   Elke aanvaarde hypothese draagt **herkomst**: soort, reden, faalwijze,
   lessen, en het verschil met de dichtstbijzijnde verworpen aanpak.
4. **Nieuwheid.** De regisseur weigert, met reden in het checkpoint:
   - `DUPLICAAT`: staat al in de ruimte;
   - `AL_VERWORPEN`;
   - `HERVERPAKT`: zelfde semantische sleutel, dus alleen de vorm verschilt;
   - `TEKST_TE_GELIJK`: ≥ 90% drietal-overlap met een verworpen tekst;
   - `TE_LANG`: boven de validatorgrens.

   Het leergeheugen (`lessons.ts`, `stand`) en de herhalingsdetectie van de
   motor werken nu ook semantisch.
5. **Tests.** Waar de meting niet onderscheidt, maakt de regisseur nieuwe
   diagnostische tests (`demo-room/src/develop/diagnostischeTests.ts`).
   - Ze hebben het dev-formaat en worden beoordeeld door de bestaande graders.
   - De grondwaarheid volgt uit platformeigenschappen, niet uit verzonnen
     gegevens: geen tool voor meningen of motieven, geen ziektegegevens,
     feedback maakt geen CAO-regel, een voorkeur geldt per standplaats.
   - Een test die op de holdout lijkt, wordt aan de meetkant geweigerd. De
     regisseur ziet de holdout nooit.
   - Contextdimensies en toolChoice hebben geen grammatica. Dat staat eerlijk
     als `testGaten` in de golf.
   - De tests gaan alleen aan de dev-kant de meting in (`proofOfValue.ts`
     `extraItems`), voor basis en kandidaat gelijk. De bevroren set krijgt een
     eigen id. Holdout, adversarial en judge/2 zijn ongewijzigd.

**Begrensd** (`verkenningVoor`, per profiel, in het checkpoint):

| profiel | max golven | hypothesen/golf | tests/golf | tests totaal | stagnatievenster |
|---|---|---|---|---|---|
| 1h | 6 | 4 | 2 | 4 | 4 |
| 6h | 24 | 6 | 4 | 8 | 6 |
| 24h | 80 | 8 | 4 | 16 | 8 |
| handmatig | 60 | 8 | 4 | 16 | 8 |
| aangepast | min/15 (3…100) | 6 | 4 | min/45 (2…16) | 6 |

Het budget in actieve minuten blijft leidend. Cycli lopen nog steeds één voor
één via de wachtrij en de BudgetManager. Een golf kost geen modeltijd.

**Echte capaciteitsgrens = blocker.** `CAPACITEIT_BLOKKADE` (STOPPED, fase
idem, UI "Capaciteitsgrens — escalatie nodig") komt in drie gevallen:
- de regisseur kan geen enkele nieuwe hypothese meer maken;
- de zoekgrens (max golven) is bereikt;
- elke zwakte wacht op een menselijk besluit.

De tekst zegt wat er nodig is, met een escalatie naar Claude of een mens. Het
is nooit voltooiing.

**Verifier** (`scripts/lyra-master/verify-long-run.ts`). Nieuw voor PASS:
- **actief budget benut**: actieve minuten ≥ budget, stopreden `BUDGET_OP`, en
  overschrijding ≤ de langste cyclus + 1 min. Een handmatige stop, blocker,
  capaciteitsgrens, uitputting vóór het budget of een profiel zonder budget is
  een eerlijke runstatus, geen voltooiing;
- **betekenisvolle cycli**: ≥ 80% van de actieve tijd in volledig gemeten
  cycli;
- uitputting en stagnatie leidden tot verbreding, niet tot het einde;
- nieuwe hypothesen zijn aantoonbaar nieuw: herkomst, les, en geen semantisch
  duplicaat of herverpakte verworpen aanpak;
- geen verworpen aanpak semantisch herhaald in de gemeten cycli;
- de lessen van golf N sturen golf N+1.

Op de echte run `DR-UI-20260930165141-d5a8` geeft de nieuwe verifier **FAIL**:
"131.5 van 360 actieve min … gestopt vóór het budget op was". Het bestaande
`LONG-RUN-VERIFICATION.json` (PASS) is bewijs van destijds en is niet
overschreven. De graders zijn ongewijzigd.

**UI.** Nieuwe fasen "Zoekruimte verbreed / Aanpak gewisseld — nieuwe golf" en
"Capaciteitsgrens — escalatie nodig". Het paneel Lange runs toont golf,
aanpak, hypothesen, tests en of de run voltooid is. Development Runs heeft een
KPI "Zoekruimte" en "niet voltooid" onder Actief/budget. De oude labels heten
"Oud: … — niet voltooid".

## Tests

Nieuw: `tests/demo-room/zoekruimte.test.ts` (14). Bijgewerkt:
`verify-long-run.test.ts`, `longRun-canoniek.test.ts`,
`autonomousDevelopmentRun.test.ts`, `factory.test.ts`,
`lessons-validator.test.ts`, en proef 11 in `e2e-proofs.ts`. Gevraagde gevallen:

- startruimte 3×6 op na cyclus 19, 6h-budget niet → golf 2 (POOL_UITGEPUT) en
  door tot `BUDGET_OP`, verifier PASS;
- nieuwe golf: echt nieuwe hypothesen, met herkomst en verschil t.o.v. de
  dichtstbijzijnde verworpen aanpak, geen semantische duplicaten over golven;
- semantische duplicaten geweigerd (DUPLICAAT, AL_VERWORPEN, HERVERPAKT,
  vastgelegd); NADRUK+X ≡ X in leergeheugen en motor (HERHALING_GEBLOKKEERD,
  boven de tolerantie blocker);
- nieuwe tests na onvoldoende onderscheidend bewijs, en de cycli daarna meten
  ze; holdout-lijkende test aan de meetkant geweigerd;
- aanpak- en familiewissel; verkennen vóór verdiepen;
- les van golf N → samenstelling in golf N+1 (herkomst = die les) → KEEP;
- verifier FAIL op 131,5/360 ondanks geldige uitputting; PASS alleen bij benut
  budget (cyclusgrens mag, 200 min te ver niet; handmatig/blocker/
  capaciteitsgrens/max cycli nooit);
- pauze na golf 2 → hervatten behoudt golven, hypothesen, tests, lessen;
  crash midden in een cyclus na golf 2 → hervatten met hetzelfde id, cyclus
  niet dubbel;
- canoniek checkpoint bevat golven (met weigeringen, analyse, lessen),
  hypothesen (met herkomst), tests en budget, en is gelijk aan het werkcheckpoint;
- productie onaangeroerd (lyra-prod-baseline, generatie 0; geen activatie).

## Proeven

**A. Versneld, in proces** (`scripts/lyra-master/proef-zoekruimte.ts` →
`proofs/zoekruimte-proof-20261001.json`, **NEPWERELD**). 6h-profiel, 9 actieve
minuten per cyclus. Echt zijn motor, regisseur, cyclus, validator, judge/2,
leergeheugen, checkpoint en verifier. De metingen komen uit een vaste nepwereld
naar het patroon van de echte run.

- **Scenario "na de echte run".** Het leergeheugen begint met de 16
  verwerpingen van `DR-UI-20260930165141-d5a8`, zoals de volgende echte run.
  - De startruimte is op bij cyclus 3, dan golf 2 (POOL_UITGEPUT).
  - Daarna golven 3–7 na stagnatie, met wisselende aanpak, en golf 8 na
    uitputting bij cyclus 40.
  - Resultaat: **DONE · BUDGET_OP na 360/360 min**, 38 gemeten cycli, 42 nieuwe
    hypothesen, 8 gegenereerde tests.
- **Scenario "leeg geheugen".** BUDGET_OP na 360/360 min, 40 gemeten cycli,
  6 golven.
- In beide scenario's zijn alle verifiercontroles OK behalve "echt taalmodel".
  Die faalt hier terecht, want het modellogboek wordt niet vervalst.

**B. Versneld, op de echte keten** (`proofs/zoekruimte-echte-keten-proof-20261001.json`,
**NEPMODEL**: deterministisch eindpunt `ollama nep-0.0`, 1,2 s per antwoord,
geen qwen3:8b). Gemeten op commit `baf43df`. De keten:
- dashboardserver → `POST /api/runs/start` (kaartje "1 uur") → CLI → motor →
  echte `runDevelopmentCycle`, met proof-of-value plus gegenereerde tests,
  holdout, adversarial en judge/2, op een geseede Postgres;
- leergeheugen bij de start: dezelfde 16 verwerpingen, dus 2 van 18 startparen
  open.

Verloop van run `DR-UI-20261001002157-c676`:
- cyclus 3 `UITGEPUT` → golf 2 (POOL_UITGEPUT, aanpak hefboom). Die bevat
  samenstellingen uit de echte lessen, zoals
  `toolChoice/ZELFCONTROLE+BESCHERM:falsePremiseCorrection`, en 2 gegenereerde
  grounding-tests. Die tests zijn daarna echt gemeten (`GEN-G2-…` in het
  runlogboek, beoordeeld door de bestaande grader);
- crash met `kill -9` van het CLI-proces midden in cyclus 4, daarna hervat via
  `/api/long-runs/resume` (segment 2, zelfde id);
- golven 3–6 na stagnatie, met wisselende aanpak; alle zes zwaktes kregen
  nieuwe hypothesen;
- **DONE · BUDGET_OP na 60,2 van 60 actieve minuten**, 19 volledig gemeten
  cycli, 20 nieuwe hypothesen, 44 voorstellen geweigerd als niet nieuw.
  Productie onaangeroerd.

Verifier: **PASS, 15/15**. De controle "echt taalmodel" slaagt hier omdat er
lokaal een eindpunt antwoordde. Het detail noemt de build
(`ollama nep-0.0 (nepdigest)`), zodat een mens ziet dat dit geen qwen3:8b was.
De canonieke kopie staat daarom niet onder `long-runs/`.

Onderweg gevonden en opgelost: zonder "verkennen vóór verdiepen" bleef de
regisseur dezelfde twee zwaktes verdiepen. De omgevingsstoring tijdens de
eerste poging (Postgres verloor de rechten op zijn datamap in de scratchmap)
was geen productfout; de proef is daarna opnieuw gedraaid.

## Groen licht voor een nieuwe echte 6-uursrun (qwen3:8b)

Ja, op commit `baf43df` of later. Start lokaal op het kaartje "6 uur" (of
`npm run demo-room -- development-run --minutes 360`). Na afloop:

    npx tsx --conditions=react-server scripts/lyra-master/verify-long-run.ts --run <runId>

Voltooid is alleen: `DONE · BUDGET_OP` met ≥ 360 actieve minuten (hooguit één
cyclus overschrijding) en verifier PASS op alle controles. Daar horen bij:
- het echte eindpunt (`ollama 0.34.4`, qwen3:8b) in het detail;
- verbreding na uitputting en stagnatie;
- nieuwe hypothesen, zonder semantische herhaling, op lessen gebouwd;
- judge/2 en alle 11 stappen;
- productie onaangeroerd.

Een eerdere stop is een eerlijke runstatus, geen voltooiing: handmatig, crash
(hervat dan met hetzelfde id), blocker of `CAPACITEIT_BLOKKADE` (escalatie).

`LYRA_DEMO_ROOM_AUTONOMOUS_PROGRAM_COMPLETE` blijft niet gezet tot die run er is.
