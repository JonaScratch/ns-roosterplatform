# PHASE N — DORDRECHT FINALISATION REPORT

Datum: 4 september 2026
Status: **Production-safe: NO — simulatie/ontwikkeling.**

---

## Branding

| | |
| --- | --- |
| Official NS logo present | **NO — BLOCKED_BY_MISSING_SOURCE** |
| Visible on login | NO (neutrale terugval zichtbaar) |
| Visible employee | NO (idem) |
| Visible RC | NO (idem) |
| Visible DID | NO (idem) |
| Visible Admin | NO (idem) |
| Visible export | NO |
| Legacy BrandMark remaining | **NO** in schermen (vereist: NO) |

`npm run verify:branding` — 6 geslaagd, 0 mislukt, 2 geblokkeerd:

```
⊘ het officiële NS-logo is aanwezig — BLOCKED_BY_MISSING_SOURCE.
  Verwacht op een van: public/brand/ns-logo.svg, public/brand/ns-logo.png,
  public/brand/ns-logo-blauw.svg, public/brand/ns-logo-blauw.png.
  Aangetroffen in public/brand/: LEESMIJ.md
✓ er is één centraal logo-component
✓ het component leest het aangeleverde bestand uit public/brand
✓ de assetdetectie zoekt naar de verwachte bestandsnamen
✓ geen enkel scherm tekent nog rechtstreeks de oude vorm
✓ Aanmeldscherm gebruikt NsLogo
✓ Zijbalk en voettekst (alle vier de omgevingen) gebruikt NsLogo
⊘ het roosterblad toont het beeldmerk — kan niet zolang het bestand ontbreekt
```

Ook visueel gecontroleerd in de browser: op het aanmeldscherm en in de zijbalk
staat de neutrale vorm, niet het NS-beeldmerk. `BrandMark` bestaat alleen nog als
de gedocumenteerde terugval ín `NsLogo`; geen enkel scherm tekent hem zelf.

**Het logo is opnieuw niet als bestand aangetroffen.** Doorzocht: de repository,
`public/brand/`, `~/Downloads`, `~/Desktop` en de tijdelijke mappen. Het is als
afbeelding in het gesprek meegestuurd; daar zijn geen bytes uit te halen zonder
het beeld na te tekenen, en dat was verboden. Er is dus niets getekend en geen
alternatief gekozen.

---

## Employee roster membership

| | |
| --- | --- |
| Permanent placement | **PASS** |
| Anchor rotation | **PASS** |
| Wrap-around | **PASS** |
| 52-week projection | **PASS** |
| Week 53 | **PASS** |
| Historical reconstruction | **PASS** |
| Future projection | **PASS** |

Het model legt vast op welke regel iemand in wélke week stond
(`anchorRuleIndex` + `anchorWeek`). Elke andere week volgt uit:

```
regel = ((anker − 1 + verstrekenWeken) mod N) + 1
```

Er wordt **niets wekelijks bijgewerkt**. Dat is de kern: een veld dat elke week
wordt opgehoogd, is één vergeten of dubbel gedraaide taak verwijderd van een
getal waarvan niemand meer kan zeggen of het klopt.

Bewezen met twee onafhankelijke implementaties (`npm run verify:rotatie`,
14/14): de productieformule tegenover een script dat domweg week voor week
optelt en na de laatste regel bij 1 begint. **1560 weekposities over 30
plaatsingen komen exact overeen**, plus 120 servicebepalingen.

Het voorbeeld uit de opdracht staat als test vast
(`tests/domain/rotatie.test.ts`, 16 tests): rooster van 12 regels, anker regel 6
in 2026-W40 → W41=7 … W46=12, **W47=1**, W48=2. Week 53, de jaarwisseling en de
zomertijd hebben elk hun eigen test.

Op het scherm: 30 medewerkers gekoppeld, en het medewerkersdashboard toont
"DDR-V — Dordrecht Vroeg, regel 6 deze week, regel 1 volgende week" met zes
weken vooruit.

---

## Temporary placement

| | |
| --- | --- |
| Creation | **PASS** |
| Eligibility | **PASS** |
| Overlap protection | **PASS** |
| Notification | **PASS** |
| Automatic return | **PASS** |
| Permanent rotation continuity | **PASS** |

`npm run verify:tijdelijk` — 12/12 op echte gegevens:

- de tijdelijke plaatsing wordt vastgelegd zonder de permanente aan te raken;
- een tweede, overlappende tijdelijke plaatsing wordt geweigerd;
- een startregel die niet in het doelrooster bestaat, wordt geweigerd;
- tijdens de periode volgt de medewerker het andere rooster, gemarkeerd als
  tijdelijk;
- **de weken vóór en ná de plaatsing zijn onveranderd**;
- na afloop staat de medewerker op de regel waar de rotatie hem bracht — en die
  is aantoonbaar níet de regel waarop hij vertrok;
- de medewerker krijgt een melding;
- buiten de periode telt de permanente plaatsing weer.

---

## DID

| | |
| --- | --- |
| RES assignment | **PASS** (ongewijzigd sinds fase M) |
| Temporary roster transfer | **PASS** |
| Start-rule suitability | **PASS** |
| Concurrency | **PASS** |
| Audit | **PASS** |

`/dienstindeling/roosters` toont per medewerker het rooster, de regel van deze
en volgende week en het soort plaatsing. Op de detailpagina rekent het systeem
per startregel voor of hij kán (rules engine) en of hij aansluit
(geschiktheidslaag) — met de eerste dienst van die regel en de laatste dienst
vóór de overgang erbij. Een regel die niet mag, heeft geen knop.

Twee handelingen staan bewust apart en met uitleg: "een dienst op een reservedag
invullen" (openstaande diensten) tegenover "iemand weken in een ander rooster
plaatsen" (medewerkerroosters).

---

## Full Dordrecht data

| | |
| --- | --- |
| Expected duty source | **223** |
| Parsed | n.v.t. |
| Normalized | n.v.t. |
| Missing | het bronbestand zelf |
| Duplicates | n.v.t. |
| Duty conservation | **PASS** op het aanwezige pakket (22 diensten) |

**BLOCKED_BY_MISSING_SOURCE.** Het 223-diensten­pakket is opnieuw niet
aangetroffen. Er zijn geen diensten gereconstrueerd. De importstraat,
reconciliatie en conserveringscontrole draaien op `DDR-DR2026-V1` (22 diensten)
zonder verlies: `verify:import` meldt "Alles klopt", geen veldverschil, 6
nachtdiensten houden hun eindtijd voorbij middernacht.

---

## Optimizer

| | |
| --- | --- |
| Global | **PASS** — alle lijnen en profielen in één model |
| NEW_TIMETABLE structural generation | **NOT DONE** |
| AMENDMENT anchor locking | **PASS** |
| Scenario comparison | **PASS** — 5 scenario's |
| FinalValidator | **PASS** — 100 % van de toewijzingen |

De structurele herindeling bij een nieuwe dienstregeling (§49) is **niet**
gebouwd. De solver neemt de bestaande ankerstructuur als gegeven en kan die niet
verplaatsen. Dat is veilig maar onvolledig: een compleet nieuwe roosterstructuur
wordt nog met de hand bepaald.

---

## Notifications

| | |
| --- | --- |
| Swap | **PASS** |
| DID | **PASS** |
| Roster membership | **PASS** |
| Temporary transfer | **PASS** |
| Outbox | **PASS** |

Drie nieuwe typen: permanente plaatsing, tijdelijke plaatsing, beëindiging. Elke
melding gaat via de transactionele outbox met een idempotente sleutel;
`verify:meldingen` bewijst dat opnieuw verwerken één melding oplevert.

---

## Employee portal

| | |
| --- | --- |
| Own roster | **PASS** |
| Current rule | **PASS** |
| Next rule | **PASS** |
| RES overlay | **PASS** |
| Swaps | **PASS** |
| Notifications | **PASS** |
| Contact DID | **PASS** — `nsr.ddr-did-mcn@ns.nl` |

Gemeten met `npm run verify:schermen`: **17 van 17 schermen** renderen met de
juiste inhoud, en op het medewerkersdashboard staat géén mailadres van een
andere standplaats.

---

## Export

| | |
| --- | --- |
| Canonical NS template | **BLOCKED** |
| PDF | **BLOCKED** |
| Preview parity | **PASS** — één renderer |
| Official logo | **BLOCKED** |
| Simulation mark | **PASS** — drie plaatsen, niet uit te zetten |

---

## Open backlog from previous phases

| Onderdeel | Status |
| --- | --- |
| Heatmap | **NOT DONE** |
| Placement simulator | **NOT DONE** |
| Interest window (statusmachine) | **NOT DONE** — allocatie loopt via de roulatiequeue, geen first-click-wins |
| Structural NEW_TIMETABLE | **NOT DONE** |
| 223 duty import | **BLOCKED** |
| Canonical PDF | **BLOCKED** |

Deze fase is besteed aan de roosterkoppeling, de rotatie en de plaatsingen — de
onderdelen die de opdracht als prioriteit 2 tot en met 5 noemde. De vier
NOT DONE-punten hierboven zijn niet aangeraakt; ze staan hier als openstaand en
niet als "bijna af".

---

## Security

| | |
| --- | --- |
| Role isolation | **PASS** — 17 paden × 4 rollen |
| Location isolation | **PASS** — standplaats uit de sessie, ook bij plaatsingen |
| Object authorization | **PASS** — medewerker, melding, ruil, plaatsing |
| Concurrent writes | **PASS** |
| Tamper protection | **PASS** |
| Audit integrity | **PASS** — permanente en tijdelijke plaatsing, beëindiging |

Een medewerker van een andere standplaats wordt op `/dienstindeling/roosters/…`
niet gevonden in plaats van gevonden-en-geweigerd: de standplaats zit in de
zoekvoorwaarde.

---

## Verification

| Controle | Uitkomst |
| --- | --- |
| lint | schoon |
| tsc | schoon |
| build | slaagt |
| tests | **303**, 23 bestanden, alles groen |
| `verify:rules` | structureel in orde; production-safe NO |
| `verify:toegang` | alle rollen zoals verwacht |
| `verify:structuur` | 12/12 |
| `verify:import` | geen veldverschil |
| `verify:integriteit` | 18/19 — één bekende gegevensbevinding |
| `verify:meldingen` | 8/8 |
| `verify:ruilingen` | 7/7 |
| `verify:ruilflow` | 8/8 |
| `verify:branding` | 6/0/2 geblokkeerd |
| `verify:rotatie` | **14/14** — 1560 weekposities, twee implementaties |
| `verify:plaatsingen` | 10/10 |
| `verify:tijdelijk` | 12/12 |
| `verify:schermen` | **17/17** |

### Browser E2E

| Rol | Uitkomst |
| --- | --- |
| Employee | **PASS** — dashboard, basisrooster met regel, contact, meldingen, rooster, ruilen |
| RC | **PASS** — dienstenbak, dienstdetail, roosterviewer, simulatie, analyse |
| DID | **PASS** — openstaande diensten, medewerkerroosters, reserve |
| Admin | **PASS** — standplaatsen, detail, systeemstatus |

---

## Real defects found

1. **De projectie miste de cyclusweek van het rooster.** De eerste versie las
   `baseRoster.cycleWeeks` niet uit; daardoor zou elke roosterregel week 1 van de
   cyclus tonen. Gevonden door de typecontrole, niet door een test — de query
   selecteerde het veld simpelweg niet.

2. **Mijn eigen verificatiescript begon een week te laat.** De onafhankelijke
   telling startte bij de maandag van W51 terwijl de vergeleken reeks bij W50
   begon, wat als afwijking werd gerapporteerd. De productieformule had gelijk;
   het script niet. Precies het scenario waarvoor een tweede implementatie
   bedoeld is — alleen andersom dan verwacht.

3. **Een holle testregel.** In de scenariotest stond `toets("dat is niet
   automatisch de regel waarop hij vertrok", true)`. Altijd groen, dus
   waardeloos. Vervangen door een echte vergelijking tussen de vertrekregel en
   de terugkeerregel.

4. **De ontwikkeldatabase stond niet aan** bij het hervatten van het werk; de
   eerste scriptrun gaf een verbindingsfout in plaats van een leeg resultaat.
   Dat is het gewenste gedrag — het alternatief was een script dat "0
   plaatsingen, alles in orde" had gemeld.

5. Onveranderd sinds fase M: **440 dubbel bezette diensten** in de bestaande
   gegevens (22 dienstnummers over 30 roosterlijnen), en **geen ruil kan worden
   voltooid** omdat het basisrooster zelf al bevindingen draagt.

---

## Actual completion estimate

Op grond van wat er is gemeten, niet van optimisme:

| | |
| --- | --- |
| Dordrecht internal-demo readiness | **80 %** |
| Dordrecht functional completeness | **75 %** |
| Dordrecht technical quality | **90 %** |
| Pilot readiness | **45 %** |
| Production readiness | **0 %** |

**Waarom 80 % en geen 99 %.** De kern staat er en is gemeten: roosterkoppeling,
rotatie met dubbel bewijs, tijdelijke en permanente plaatsing, projectie,
meldingen, ruilingen, DID-toewijzing, optimizer, export als simulatie, security.
Wat ontbreekt is deels bron (logo, 223 diensten, exportsjabloon) en deels werk
dat niet is gedaan (heatmap, plaatsingssimulator, interessevenster, structurele
herindeling). Een demo op 22 in plaats van 223 diensten, zonder logo en zonder
NS-exportopmaak, is een werkende demo op onvolledige gegevens.

**Waarom pilotgereedheid laag blijft.** Een pilot betekent dat iemands echte
rooster hiermee wordt gemaakt. Daarvoor moet de juridische regelverzameling
formeel gevalideerd zijn, en dat is zij niet: 2 van 71 regels, 10 ontbrekende
pakketten.

---

## Remaining blockers

1. Het NS-logobestand op `public/brand/`.
2. Het volledige Dordrecht-dienstenpakket (223 diensten) als bestand.
3. De canonieke NS-roosterblad-PDF's.
4. Formele validatie van de juridische regelverzameling (ATW, ATB-vervoer, CAO,
   lokale kaders).
5. De bevoegdhedenmatrix.
6. De bijzondere regels voor 50+ Mix en BLM.
7. Beleid voor een plaatsing die midden in een week ingaat — nu `POLICY_PENDING`:
   plaatsingen gaan per week in, omdat de rotatie per week loopt en er geen bron
   is die iets anders vaststelt.

---

## Final status

| | |
| --- | --- |
| `DORDRECHT SOFTWARE COMPLETE` | **NO** |
| `INTERNAL NS DEMO READY` | **YES, met voorbehoud** — werkt end-to-end, op 22 diensten en zonder logo |
| `PILOT READY` | **NO** |
| `PRODUCTION SAFE` | **NO** |
