# Preference-audit: voorkeurs-/affiniteitmodel

*Vereist deliverable §99 van de LYRA MASTER PROGRAM-opdracht. Dit document is geen nieuw
onderzoek: het organiseert de reeds afgeronde Fase 0-inventaris
(`docs/lyra-knowledge/inventory-quality-and-preferences.md`) opnieuw, met als focus
uitsluitend de **preference/affinity**-kant van het kwaliteitsmodel — profielnamen,
profiel-affiniteit, dienstklassen, dagdienstgewichten, rangeer/RET-eerlijkheid, vrij-weekend,
40-uursgemiddelde en tijdband-blootstelling. De aanvullende synthese in
`docs/lyra-knowledge/current-state.md` is gebruikt om risiconiveaus te bevestigen. Getallen en
citaten zijn overgenomen, niet herberekend; waar de bron "niet vastgesteld" zegt, staat dat ook
hier zo.*

---

## 1. Profielen: canonieke namen en aliassen

**Canonieke namen** (`src/lib/generated/prisma/enums.ts`, gebruikt door
`src/domain/roster-profiles.ts:30-39,52-61`):

```
VROEG, VROEG_LAAT, LAAT, LAAT_NACHT, MIX, MIX_50PLUS, BLM, RESERVE
```

**Weergavenamen** (`PROFILE_LABELS`, `roster-profiles.ts:52-61`):

| Enum | Label in code |
| --- | --- |
| VROEG | "Vroeg" |
| VROEG_LAAT | "Vroeg/Laat" |
| LAAT | "Laat" |
| LAAT_NACHT | "Laat/Nacht" |
| MIX | **"Mix (Vroeg-Laat-Nacht)"** |
| MIX_50PLUS | "50+ Mix" |
| BLM | "BLM" |
| RESERVE | "Reserve" |

**Risico — MIX-alias "Vroeg-Laat-Nacht" is minder zeker dan de code suggereert.** De code
presenteert "Vroeg-Laat-Nacht" als vast onderdeel van het MIX-label (`roster-profiles.ts:57`) én
als bronvermelding bij het dagdienstgewicht (`profile-affinity.ts:54`:
`MIX: { weight: 20, source: "HUMAN_DOMAIN_INPUT (Vroeg/Laat/Nacht)" }`). Dat suggereert een
bevestigde 1-op-1 alias. Maar `docs/lyra-knowledge/sources/manifest.json` (regel 94, over
brondocument `Mix_1_A.pdf`) zegt uitdrukkelijk: *"de master-prompt-tekst noemt 'mogelijk
historische displaynaam Vroeg-Laat-Nacht' voor dit profiel; op basis van dit brondocument alléén
is die alias NIET bevestigd."* `docs/lyra-knowledge/progress.md:39` noemt dit expliciet als open
vraag die tegen de platformcode geaudit moet worden.

**Conclusie van deze audit, gesteld zoals gevraagd (plain and clear):** de code behandelt de
alias stilzwijgend als vaststaand, terwijl de eigen brondocumentatie van dit project hem als
onbevestigd bestempelt. Dit is een reële inconsistentie tussen de sourcing-discipline die elders
in dezelfde bestanden zeer consequent wordt toegepast (zie §4 en §10 hieronder) en dit ene label.
Dit is ook het **enige risico dat `current-state.md`'s samenvattingstabel als "hoog" labelt** op
deze kant van het model.

**BLM** — geen voluit-geschreven naam gevonden in code of documentatie: **niet vastgesteld** wat
de afkorting betekent.

**Status:** gap (alias-claim onbevestigd, presentatie in code te stellig).
**Citaat:** `roster-profiles.ts:57`, `profile-affinity.ts:54`, `sources/manifest.json:94`,
`progress.md:39`; overgenomen uit inventaris §1.
**Regressietest:** `tests/domain/profielaffiniteit.test.ts`,
`tests/domain/machinistenvoorkeur.test.ts` en e2e-log
`docs/v1.0.4-final-brain/e2e-logs/verify-profielen.ts.log` dekken profielgrenzen af, **maar niet
specifiek de "Vroeg/Laat/Nacht"-aliasclaim** — dat is zelf ook een gat.

---

## 2. Profiel-affiniteitmodel: 7 dienstklassen × 3 niveaus, kwalitatief los van numeriek

**Status: solide — volledig geïmplementeerd, met het gevraagde onderscheid expliciet aanwezig.**

Zeven dienstklassen, `src/domain/duty-class.ts:33,46-55`:

```
EXTREME_EARLY, EARLY, DAYLIKE_EARLY, EARLY_LATE, LATE, PREMIUM_LATE, NIGHT (+ OTHER)
```

Drie affiniteitsniveaus met numerieke mapping, `src/domain/profile-affinity.ts:30-37`:

```ts
export type AffinityLevel = "PREFERRED" | "NEUTRAL" | "LESS";
export const AFFINITY_VALUE: Readonly<Record<AffinityLevel, number>> = { PREFERRED: 1, NEUTRAL: 0.6, LESS: 0.2 };
```

**De expliciete scheiding tussen kwalitatieve rangorde en numerieke waarde** die de opdracht
vraagt, zit al in de typen zelf: elke cel in `PROFILE_AFFINITY` (`profile-affinity.ts:74-119`)
heeft een `level` (de rangorde, met bronvermelding per cel) en pas
`affinityValue()`/`AFFINITY_VALUE` (regel 122-124) vertaalt dat naar het getal. De
module-docstring (regels 14-22) zegt dit met zoveel woorden: *"Alleen de richting heeft een
bron (...). De afstand tussen de niveaus is een aanname."* — dus de afstand (1,0/0,6/0,2 in
plaats van bijvoorbeeld 1,0/0,7/0,3) wordt zelf niet als bevestigd feit gepresenteerd, ook al
staat het getal hard in de code.

**Bron per cel is zichtbaar in de data**, bijvoorbeeld `MIX_50PLUS.EXTREME_EARLY`
(`profile-affinity.ts:109`): `"menselijk rooster: 0 van 26 extreem vroege diensten in 50+ Mix"` —
een empirische bron, geen verzonnen aanname.

**Citaat:** `duty-class.ts:33,46-55`, `profile-affinity.ts:30-37,74-124`.
**Regressietest:** `tests/domain/profielaffiniteit.test.ts` ("tegenvoorbeeld 1 (§36)": extreem
vroeg naar Vroeg, geen monopolie voor Vroeg/Laat en Mix — regel 107).

---

## 3. Dienstklasse-grenzen

**Status: solide — exact overeenkomend met het referentieblok, met bronverwijzing per grens.**

`src/domain/duty-class.ts:35-44`:

```ts
export const DUTY_CLASS_BOUNDS = {
  extremeEarlyBefore: 5 * 60 + 30,   // < 05:30 → extreem vroeg
  daylikeEarlyFrom: 9 * 60,          // vanaf 09:00 → dagachtig vroeg
  earlyLateEndBefore: 21 * 60,       // einde < 21:00 → vroege late
  premiumLateEndAfter: 24 * 60,      // einde na 24:00 → echte afloper
} as const;
```

Empirische onderbouwing (module-docstring, regels 14-31) uit het Dordrechtse pakket: 17 diensten
tussen 05:30-06:00 tegen 26 ervoor, 7 van de 80 dagachtige diensten vanaf 09:00, 25 van de 92
late diensten vroege late, 31 van de 92 echte aflopers (101/102/103 tussen 00:24-01:42).

**Citaat:** `duty-class.ts:14-31,35-44`.
**Regressietest:** `tests/domain/profielaffiniteit.test.ts:27-33` ("dienstklassen op de klok"),
inclusief het expliciete voorbeeld dat dienstnummer 115 op donderdag EARLY_LATE en op dinsdag
PREMIUM_LATE is (zelfde nummer, twee klassen — bewust getest).

---

## 4. Dagdienst-relatieve gewichten, inclusief de ontbrekende "Vroeg"

**Status: solide qua labeling, gap qua regressiedekking.** `src/domain/profile-affinity.ts:52-61`:

```ts
export const DAY_DUTY_WEIGHTS = {
  LAAT:        { weight: 10, source: "HUMAN_DOMAIN_INPUT" },
  MIX:         { weight: 20, source: "HUMAN_DOMAIN_INPUT (Vroeg/Laat/Nacht)" },
  VROEG_LAAT:  { weight: 20, source: "HUMAN_DOMAIN_INPUT" },
  BLM:         { weight: 20, source: "HUMAN_DOMAIN_INPUT" },
  LAAT_NACHT:  { weight: 10, source: "HUMAN_DOMAIN_INPUT" },
  MIX_50PLUS:  { weight: 40, source: "HUMAN_DOMAIN_INPUT" },
  VROEG:       { weight: 10, source: "AANNAME: niet opgegeven; gelijk aan Laat (spiegelbeeld)" },
  RESERVE:     { weight: 20, source: "AANNAME: niet opgegeven; midden van de opgave" },
};
```

Dit is letterlijk de tabel uit het referentieblok, inclusief het feit dat "Vroeg" ontbrak in de
oorspronkelijke opgave. **De waarde 10 voor Vroeg staat expliciet gemarkeerd als `AANNAME`
(assumption), niet als `HUMAN_DOMAIN_INPUT`** — dat onderscheid moet correct blijven staan zoals
de opdracht vraagt, en het staat zo in de code. Dat onderscheid is ook zichtbaar in de output van
`dutyAffinity()`/`dag()` (regels 66-71), die de bronstring letterlijk doorgeeft. Het ontwerp
(`docs/v1.0.4-final-brain/machinist-preferences/design.md:71-73`) noemt bovendien expliciet de
gevoeligheidsanalyse: 0 en 20 als alternatieve waarden zijn doorgerekend
(`assumption-sensitivity.json`).

Nog steeds als open vraag genoteerd: `docs/lyra-knowledge/progress.md:40` herhaalt dit expliciet
als iets dat in `HUMAN_REVIEW_REQUIRED` moet blijven — een statuslabel dat overigens **niet**
letterlijk in de broncode voorkomt.

**Citaat:** `profile-affinity.ts:52-71`, `design.md:71-73`, `progress.md:40`.
**Regressietest:** geen losse test gevonden die specifiek "wat als Vroeg=0 of Vroeg=20" checkt in
de test-suite zelf; de gevoeligheidsmeting bestaat als los script/resultaat
(`docs/v1.0.4-final-brain/machinist-preferences/assumption-sensitivity.json`), niet als
`vitest`-regressietest. Dat is een gat: een toekomstige wijziging aan `DAY_DUTY_WEIGHTS.VROEG`
zou niet automatisch falen (bevestigd, `current-state.md` beveelt dit expliciet aan als "veilig
toe te voegen" regressietoets).

---

## 5. Rangeer/RET: aantrekkelijk, niet straf — wel eerlijk verdelen

**Status: solide — geen open vraag.**

`src/domain/roster-quality.ts:607-614` definieert `shuntingFairness` ("Eerlijke
rangeerverdeling") als eerlijkheidsmaat tussen roosters (variatiecoëfficiënt van
rangeerdiensten per regel), niet als strafcomponent. `src/domain/machinist-preference.ts` en
`profile-affinity.ts` kennen rangeerdiensten geen aparte (lagere) affiniteit toe — ze worden bij
de affiniteitsberekening genegeerd (`profileAllowsDuty`: reine rangeer- of reservediensten zijn
voor elk profiel toegestaan en tellen niet mee als "minder passend").

**Bevestiging in tests en rapportagescripts:**
- `tests/domain/machinistenvoorkeur.test.ts:182`: `describe("test 6 — rangeer is populair, dus eerlijk verdelen")`, met assertie (regels 199-201) dat concentratie de eerlijkheidsscore verlaagt terwijl de affiniteitsscore in beide gevallen gelijk blijft.
- `scripts/report/machinist-chapters.ts:260`: `"Rangeer is populair: geen strafdienst, wel eerlijk spreiden"` — letterlijk terug te vinden in `docs/NS-Roosterplatform-v1.0.4-Final-Brain-Report.html` (Hoofdstuk 29).
- `docs/v1.0.4-final-brain/machinist-preferences/human-vs-preference.md` punt 2: mensen concentreren rangeer in Mix (11 van de 39, variatiecoëfficiënt 0,56), de zoekmachine spreidt bijna gelijk (0,06) — genoteerd als plek waar de zoekmachine dichter bij de opgegeven eerlijkheidswens zit dan het menselijke rooster zelf.

**Citaat:** `roster-quality.ts:607-614`, `machinistenvoorkeur.test.ts:182,199-201`,
`machinist-chapters.ts:260`, `human-vs-preference.md` punt 2.
**Regressietest:** aanwezig en met de bedoeling letterlijk in de testnaam — geen gat.

---

## 6. Vrij weekend: RUST+RUST, vrijdageis met nachtuitzondering

**Status: solide — exact overeenkomend, met een expliciet gedateerd gebruikersbesluit.**

`src/domain/operational-requirements.ts:43-68` (`OPERATIONAL_REQUIREMENTS_V1`):

```ts
freeWeekendFriday: { latestEndMinute: 23*60+59, exemptKinds: ["NACHT"] },
freeWeekend:       { freeTypes: ["RUST","WR","CO"], requiredTypes: ["RUST","RUST"], structural: true },
```

De uitzondering voor nachtdiensten wordt letterlijk toegeschreven aan *"besluit van de gebruiker,
19 september 2026: 'de vrijdageis geldt niet voor nachten'"* (regels 16-19). Bronstatus:
`USER_PROVIDED_OPERATIONAL_DESIGN_REQUIREMENT` (regel 41), expliciet niet CAO/ATW/ATB (regel 11).
`fridayDutyAllowed()` (regels 78-84) implementeert precies deze uitzondering.

**Citaat:** `operational-requirements.ts:11,16-19,41,43-68,78-84`.
**Regressietest:** `tests/domain/operationele-eisen.test.ts` (16 tests, genoemd in
`design.md:33`) en `tests/optimizer/operationele-eisen-solver.test.ts` (10 tests, waarvan drie
tonen dat de oplosser zónder deze eis de andere kant op gaat — `design.md:34-35`).

---

## 7. Weekgemiddelde ≤ 40:00 (cyclusgemiddelde, niet elke week)

**Status: solide — exact overeenkomend.** `src/domain/operational-requirements.ts:47-51`:

```ts
rosterAverageHours: {
  maxAverageWeeklyMinutes: 40 * 60,
  semantics: "floor(roostercredit / cyclusweken) ≤ max; ... een losse regel mag erboven",
}
```

De module-docstring (regels 13-14) zegt het met zoveel woorden: *"het gemiddelde van een
basisrooster over al zijn regels is hoogstens 40:00 per week (...); een losse regel mag
erboven."* `maxTotalCreditMinutes()` (regel 73-75) berekent de harde bovengrens per cyclus
(`(2400+1) × cyclusweken − 1`, dus 40:00 mag, 40:01 niet). Bronstatus ook hier
`USER_PROVIDED_OPERATIONAL_DESIGN_REQUIREMENT`, niet CAO.

**Citaat:** `operational-requirements.ts:13-14,47-51,73-75`.
**Regressietest:** zelfde testbestanden als §6 (`tests/domain/operationele-eisen.test.ts`,
`tests/optimizer/operationele-eisen-solver.test.ts`).

---

## 8. Tijdband-blootstelling als proxy (geen ORT/toeslag)

**Status: solide — nergens verward met een echt geldbedrag.**

`src/domain/duty-class.ts:73-77` (`nightWindowExposure`) en `profile-affinity.ts:152-160`
(`AffinityMetrics.perRoster[...].nightWindowMinutesPerWeek`, `weekendMinutesPerWeek`, met de
inline aantekening *"Proxy voor toeslagblootstelling, per week: GEEN toeslag"*).
`docs/v1.0.4-final-brain/machinist-preferences/human-vs-preference.md:12-14`: *"Toeslagen: er
staan geen ORT-regels in het platform. Blootstelling is gemeten als proxy (...), niet in geld."*
`design.md:108-109` herhaalt dit letterlijk.

**Citaat:** `duty-class.ts:73-77`, `profile-affinity.ts:152-160`, `human-vs-preference.md:12-14`,
`design.md:108-109`.
**Regressietest:** niet apart genoemd in de inventaris buiten de affiniteitstests van §2; geen
losse toeslag-regressie nodig zolang het proxy-label consequent blijft (bevestigd correct in elk
bestand waar het getal voorkomt).

---

## Samenvatting (alleen preference/affinity-kant)

| # | Onderwerp | Status | Risiconiveau |
| --- | --- | --- | --- |
| 1 | MIX = "Vroeg-Laat-Nacht" alias | Code presenteert het als vast label/bron; eigen bronmanifest zegt "NIET bevestigd" | **Hoog** |
| 2 | Profiel-affiniteit (7 klassen × 3 niveaus) | Volledig geïmplementeerd, kwalitatief/numeriek correct gescheiden | Geen |
| 3 | Dienstklasse-grenzen | Exact + gebrond + getest | Geen |
| 4 | `DAY_DUTY_WEIGHTS.VROEG = 10` | Correct gelabeld `AANNAME`, maar geen vitest-regressie | Laag (label correct, dekking ontbreekt) |
| 5 | Rangeer/RET-eerlijkheid | Consistent, in testnamen en rapporten expliciet | Geen |
| 6 | Vrij weekend + vrijdageis/nachtuitzondering | Exact, gedateerd besluit, getest | Geen |
| 7 | 40:00-cyclusgemiddelde | Exact, getest | Geen |
| 8 | Tijdband-blootstelling als proxy | Consequent proxy-label, nooit als bedrag | Geen |

**Belangrijkste risico op deze kant van het model:** de MIX="Vroeg-Laat-Nacht"-aliasclaim (§1) —
stilzwijgend als vaststaand gepresenteerd in code terwijl het eigen bronmanifest van dit project
hem uitdrukkelijk "NIET bevestigd" noemt, en zonder regressietest die dat verschil bewaakt.

*Bron van alle bovenstaande citaten en bevindingen:
`docs/lyra-knowledge/inventory-quality-and-preferences.md` §1-4, §10-13 (dit document herschikt,
het herderived niet). Risiconiveaus overgenomen uit dezelfde inventaris se samenvattingstabel en
bevestigd in `docs/lyra-knowledge/current-state.md`.*
