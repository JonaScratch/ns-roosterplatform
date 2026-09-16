# PHASE M — NS OPERATIONAL COMPLETION REPORT

Datum: 4 september 2026
Status: **Production-safe: NO — simulatie/ontwikkeling.**

---

## Earlier backlog

| Onderdeel | Status |
| --- | --- |
| Official NS logo | **BLOCKED_BY_MISSING_SOURCE** |
| Full 223-duty reconciliation | **BLOCKED_BY_MISSING_SOURCE** |
| Canonical NS PDF | **BLOCKED_BY_MISSING_SOURCE** |

### Wat er precies ontbreekt

**1. Het logobestand.** Verwacht op een van deze paden:

```
public/brand/ns-logo.svg
public/brand/ns-logo.png
public/brand/ns-logo-wit.svg   (variant voor donkere achtergronden)
```

Aangetroffen in `public/brand/`: alleen `LEESMIJ.md`. Ook doorzocht:
de repository, `~/Downloads`, `~/Desktop` en de tijdelijke mappen — geen
NS-logobestand.

Het logo is wél als **afbeelding in het gesprek** meegestuurd. Dat is geen
bestand: de bytes zijn er niet uit te halen zonder het beeld na te tekenen, en
natekenen was uitdrukkelijk verboden. Er is dus **niets getekend, niets
gegenereerd en geen alternatief gekozen**. De centrale `NsLogo`-component en de
detectie in `src/server/branding/assets.ts` staan klaar; zodra het bestand op een
van bovenstaande paden staat, verschijnt het in login, zijbalk, alle vier de
omgevingen en het roosterblad, met behoud van de beeldverhouding.

**2. Het volledige Dordrecht-dienstenpakket** (223 diensten:
34/36/34/35/33/26/25). Niet aangetroffen als bestand. Er zijn géén 223 diensten
gereconstrueerd of benaderd. De importstraat, de reconciliatie en de
conserveringscontrole zijn wel gebouwd en draaien op het aanwezige pakket van 22
diensten (`DDR-DR2026-V1`) zonder verlies.

**3. De canonieke NS-roosterblad-PDF's.** Zonder dat sjabloon is een
PDF-generator geen reproductie maar een eigen ontwerp met een NS-jasje. De
bestaande printbare HTML blijft daarom staan; de renderer is dezelfde voor
voorbeeld en export.

---

## Locations

| | |
| --- | --- |
| Registered | **41** standplaatsen + 6 planeenheden |
| Operational | **DDR only: YES** |
| DDR fallback naar andere locaties | **NO** (vereist: NO) |

Gemeten met `npm run verify:standplaatsen`:

- alle 41 standplaatsen geregistreerd;
- exact één functioneel ingericht, en dat is DDR;
- geen andere standplaats heeft diensten of roosters;
- geen enkele standplaats erft de inrichting van Dordrecht;
- `LOCAL_RULESET_NOT_CONFIGURED` blijft de uitkomst voor elke andere standplaats.

`LocationConfig` is uitgebreid met `rosterProfilesConfigured`,
`qualificationsConfigured` en `didContactEmail`.

---

## Dordrecht contact

| | |
| --- | --- |
| Configured DID email | `nsr.ddr-did-mcn@ns.nl` |
| Outlook compose | **PASS** |
| Fallback (`mailto:`) | **PASS** |

Het adres staat per standplaats vastgelegd en wordt **niet** afgeleid uit de
code. Voor de overige 40 standplaatsen is geen adres ingevuld; daar verschijnt
"Contactgegevens Dienstindeling voor deze standplaats zijn nog niet ingericht."
Er is geen terugval op het Dordrechtse adres.

De standplaats komt uit de sessie, niet uit een zoekparameter:
`?standplaats=RTD` verandert het mailadres niet. De applicatie verstuurt zelf
niets — er opent een concept met een leeg sjabloon (naam, personeelsnummer,
datum, betreft), dat de medewerker zelf aanpast en verzendt.

Gemeten met `npm run verify:schermen`: op `/medewerker` staat het adres
`nsr.ddr-did-mcn@ns.nl`, en er staat géén adres van een andere standplaats.

---

## Notifications

| | |
| --- | --- |
| Database backed | **YES** — `Notification` + `OutboxEvent` |
| Unread badge | **YES** — echte telling, één index |
| Swap notifications | **YES** |
| DID assignment notifications | **YES** |
| Available duty notifications | **YES** |
| Outbox / idempotency | **YES** |

Elke wijziging schrijft haar gebeurtenis in **dezelfde transactie**
(`publishInTransaction`). Het omzetten naar meldingen gebeurt daarna en mag
falen: de gebeurtenis blijft staan met de fout erbij en wordt opnieuw opgepakt.
Elke melding draagt een `eventKey`; `@@unique([recipientUserId, eventKey])` maakt
opnieuw verwerken onschadelijk.

Ondersteunde types: ruilverzoek ontvangen/geaccepteerd/afgewezen/ingetrokken/
ongeldig geworden, beschikbare dienst belangstelling/toegewezen/niet toegewezen,
reservedag ingevuld/gewijzigd/ingetrokken, roosterwijziging, systeemmelding.

Gemeten met `npm run verify:meldingen` — 8 van 8:

- dezelfde gebeurtenis twee keer verwerken levert **één** melding;
- elke melding heeft een bestaande ontvanger en een doorklikpad;
- geen ontvanger heeft dezelfde melding twee keer;
- een onbekende gebeurtenis wordt als `FAILED` bewaard mét fouttekst en houdt de
  rest niet tegen.

Een melding wijst altijd naar het onderwerp zelf (`/medewerker/ruilen/<id>`),
nooit naar een algemeen overzicht.

---

## Swaps

| | |
| --- | --- |
| Request | **PASS** |
| Accept | **PASS** (zie kanttekening) |
| Reject | **PASS** |
| Cancel | **PASS** — `cancelSwap`, alleen door de aanvrager, alleen zolang open |
| Revalidation | **PASS** |
| Concurrency | **PASS** |
| Notification integration | **PASS** |

Gemeten met `npm run verify:ruilflow`, dat de échte servicelaag aanroept
(`respondToSwapCore`) op echte medewerkers en roosterdagen — 8 van 8:

- afwijzen verandert **geen enkele roosterdag**, status wordt `REJECTED`, de
  aanvrager krijgt een melding;
- een voorstel waarvan het rooster inmiddels is gewijzigd, wordt **niet**
  uitgevoerd;
- een geweigerde ruil eindigt in `INVALIDATED` mét bewaarde hertoetsing en laat
  beide roosters ongemoeid.

En `npm run verify:ruilingen` (invarianten) — 7 van 7: geen uitgevoerde ruil
zonder bewaarde eindtoetsing, geen half uitgevoerde ruil, geen voorstel op een
structureel anker, geen roosterdag in twee openstaande voorstellen, geen ruil
tussen standplaatsen.

**Kanttekening bij "accept".** In de meting kon geen ruil daadwerkelijk worden
uitgevoerd, en dat ligt niet aan de ruilworkflow: het bestaande basisrooster
draagt zélf al bevindingen (0 rustdagen in de week, dienst 046 boven de maximale
dienstlengte). De hertoetsing bij accepteren beoordeelt het rooster zoals het ná
de ruil zou zijn, en dat erft die bevindingen. Zolang het basisrooster niet
schoon door de validator komt, kan geen enkele ruil worden geaccepteerd. Dat is
het bedoelde fail-closed gedrag — en het betekent dat een demonstratie van een
geslaagde ruil een rooster vergt dat zelf door de regels komt.

---

## Reserve / DID

| | |
| --- | --- |
| Base reserve normal duties | **NO** (vereist: NO) |
| Operational assignment layer | **PASS** |
| Suitability | **PASS** |
| Matching | **PASS** |
| Final revalidation | **PASS** |

`verify:structuur` (12/12) bewijst opnieuw: invullen zet de dienst erop, het
RES-slot blijft eronder bewaard, intrekken herstelt de reservedag en ruimt de
laag op.

Na een operationele toewijzing krijgt de medewerker een melding met datum,
dienstnummer en tijden, en een link naar het eigen rooster. Bij intrekken volgt
een tweede melding — geen stille operationele wijziging.

---

## Optimizer

| | |
| --- | --- |
| CP-SAT | **YES** — OR-Tools, apart Python-proces zonder databaseverbinding |
| Global | **YES** — alle lijnen en profielen in één model |
| Scenario count | **5** |
| Duty conservation | **PASS** — 78 in, 78 verantwoord |
| Final validator | **PASS** — 100 % van de toewijzingen |

Ongewijzigd sinds fase L en opnieuw gemeten: alle vijf scenario's `OPTIMAL`,
8 924 variabelen, 15 231 constraints, 1,4–3,8 s.

---

## Rules

| | |
| --- | --- |
| Central rule catalog only | **YES** |
| Hard bypass | **NO** (vereist: NO) |
| Current legal status | `LEGAL_RULESET_NOT_CURRENTLY_VERIFIED` |
| Policy pending | 50+ Mix, BLM, weekend-50 %-definitie, lokale kaders buiten DDR |

`verify:rules`: 71 regels, waarvan 2 gevalideerd; 10 regelpakketten ontbreken.
Structureel in orde, production-safe NO.

---

## Export

| | |
| --- | --- |
| Canonical template | **NO** — sjabloon niet aangeleverd |
| Preview parity | **PASS** — één renderer |
| PDF | **NO** — printbare HTML |
| Official logo | **NO** — bestand ontbreekt |
| Simulation watermark | **PASS** — drie plaatsen, niet uit te zetten |

---

## Security

| | |
| --- | --- |
| Role isolation | **PASS** — 17 paden × 4 rollen |
| Location isolation | **PASS** — server bepaalt de standplaats |
| Object authorization | **PASS** — melding, ruil en toewijzing horen bij de eigenaar |
| Concurrency | **PASS** — voorwaardelijke claim binnen transactie |
| Tamper protection | **PASS** — kandidaathash, stale-state, sessies |
| Audit | **PASS** — import, activering, generatie, toewijzing, ruil, export, status |

Een melding van een andere gebruiker levert geen fout maar "niet gevonden", plus
een `AUTHORIZATION_DENIED` in het beveiligingslog.

---

## Reliability

| | |
| --- | --- |
| Import atomic | **PASS** — staging buiten de database, pas na bevestiging vastgelegd |
| Assignment atomic | **PASS** |
| Outbox | **PASS** — bewezen met een retry |
| Crash recovery | **PASS** — solver is een apart proces |
| Stale state | **PASS** — regelbestand-, invoer- en roosterversie |

---

## Verification

| Controle | Uitkomst |
| --- | --- |
| `tsc --noEmit` | schoon |
| `eslint` | schoon |
| `npm test` | **287** tests, 22 bestanden, alles groen |
| `npm run build` | slaagt |
| `verify:rules` | structureel in orde; production-safe NO |
| `verify:toegang` | 17 paden × 4 rollen zoals verwacht |
| `verify:import` | 22/22 diensten, geen veldverschil |
| `verify:structuur` | 12/12 |
| `verify:integriteit` | 18/19 — de ene bevinding staat hieronder |
| `verify:meldingen` | 8/8 |
| `verify:ruilingen` | 7/7 |
| `verify:ruilflow` | 8/8 |
| `verify:standplaatsen` | 6/6 |
| `verify:dienstindeling` | 3/3 |
| `verify:schermen` | **15/15** |

### Browser / scherm-E2E

| Rol | Uitkomst |
| --- | --- |
| Employee | **PASS** — dashboard met contactkaart, meldingen, rooster, diensten, ruilen |
| RC | **PASS** — dienstenbak, dienstdetail met herkomst, roosterviewer, simulatie, analyse |
| DID | **PASS** — openstaande diensten, kandidaten, reserve |
| Admin | **PASS** — standplaatsen, standplaatsdetail, systeemstatus |

---

## Real defects discovered

1. **Alle medewerkerschermen gaven een 500 na de meldingenmigratie.** De
   draaiende ontwikkelserver hield een verouderde Prisma-client in geheugen en
   kende `prisma.notification` niet. Zonder de schermcontrole zou dit pas bij de
   demo zijn opgevallen; met alleen `verify:toegang` zou het als "geweigerd" en
   dus als correcte beveiliging zijn gelezen. Opgelost door de server te
   herstarten; de val staat in de README.

2. **De bel toonde het aantal ruilverzoeken, niet het aantal meldingen.**
   `messages: swaps` in `nav-counts.ts` was een plaatsvervanger uit een eerdere
   fase. Nu een echte telling van ongelezen meldingen.

3. **De ruilworkflow kan op de huidige gegevens geen enkele ruil voltooien.**
   Niet door een fout in de workflow, maar doordat het basisrooster zelf al
   bevindingen draagt die de hertoetsing na de ruil opnieuw vindt. Fail-closed
   werkt; het legt wel bloot dat een geslaagde-ruil-demo een rooster vergt dat
   door de validator komt.

4. **Het eerste ruilpaar in de meting leverde een profielconflict op**
   (nachtdienst naar een Vroeg/Laat-medewerker). Daarmee mat het script de
   weigering in plaats van de ruil. De keuze zoekt nu een paar met hetzelfde
   profiel én hetzelfde dagdeel — een testfixture die "iets" pakt, meet iets
   anders dan bedoeld.

5. **440 dubbel bezette diensten** in de bestaande gegevens (22 dienstnummers
   over 30 roosterlijnen). Onveranderd sinds fase L, en de reden dat de
   CP-SAT-oplosser 752 van de 830 dienstdagen leeg laat: hij weigert een dienst
   twee keer te gebruiken.

---

## Remaining missing NS sources

1. Het NS-logobestand op `public/brand/`.
2. Het volledige Dordrecht-dienstenpakket (223 diensten) als bestand.
3. De canonieke NS-roosterblad-PDF's.
4. De bevoegdhedenmatrix (materieel, baanvak, certificaten, geldigheid).
5. De bijzondere regels voor 50+ Mix en BLM.
6. Het lokale regelkader per standplaats die live moet.
7. De dienstregelingdatums voor de eerstvolgende Dordrechtronde.
8. De betekenis van de planeenheden 1 en 2 (ASD, RTD, UT).
9. Formele validatie van de juridische regelverzameling (ATW, ATB-vervoer, CAO,
   lokale kaders) — dit blokkeert productie.

---

## Wat in deze fase níet af is gekomen

Eerlijk, zonder omweg:

- **Echte PDF-export** — geblokkeerd op het sjabloon (§7–§8).
- **Heatmap** en de **plaatsingssimulator** "wat als ik dienst 101 hier zet"
  (§94–§96): de roosterviewer toont wel per cel de dienst, de vorige en
  volgende dienst, rust ervoor en erna, ritme en ankersoort.
- **Het interessevenster met allocatiefasen** (§97): de toewijzing loopt nog via
  de bestaande roulatiequeue per weekdag — géén first-click-wins, maar de
  expliciete statusmachine `OPEN → INTEREST → ALLOCATION_PENDING → ALLOCATED →
  CLOSED` is niet gemodelleerd.
- **De structurele herindeling bij een nieuwe dienstregeling** (§66): de solver
  neemt de bestaande ankerstructuur als gegeven.
- **Ruilen vanuit de melding met knoppen in de melding zelf** (§26): de melding
  linkt naar de ruilpagina waar accepteren en afwijzen staan; er zitten geen
  actieknoppen in het meldingenoverzicht.

---

## Status

| | |
| --- | --- |
| Dordrecht end-to-end internal demo ready | **PARTIAL** |
| Simulation ready | **YES** |
| Production-safe | **NO** |

**Production blocker:** de actuele en formeel gevalideerde juridische, lokale en
operationele regels, plus de expliciet ontbrekende NS-bronnen hierboven.

**Waarom "partial" en niet "yes":** alle workflows werken en zijn gemeten, maar
de demo draait op 22 in plaats van 223 diensten, zonder officieel logo en zonder
NS-exportsjabloon. Met die drie bestanden erbij is de demo compleet; zonder is
het een werkend platform op onvolledige brongegevens.
