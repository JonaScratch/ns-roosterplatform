# NS Roosterplatform — technische documentatie

Intern platform voor roosterbeheer met vier rollen: **Medewerker**, **Rooster
Commissie Planner**, **Dienstindeling** en **Admin**. Vier omgevingen, één
applicatie: dezelfde zijbalk, dezelfde kaarten, dezelfde tabellen.

> **Status en waarschuwing.** Dit is een ontwikkelversie. De grenswaarden voor
> rusttijden, reeksen en bezetting zijn werkbare uitgangswaarden en **niet
> juridisch geverifieerd** tegen de Arbeidstijdenwet, het Arbeidstijdenbesluit
> vervoer of de NS-cao. Voordat dit platform iemand daadwerkelijk inroostert,
> moet elke waarde in `src/server/rules-engine/parameters.ts` door de
> verantwoordelijke afdeling worden bevestigd. Zie ook
> [Nog aan te leveren door NS](#nog-aan-te-leveren-door-ns).

---

## Aan de slag

```bash
npm install
cp .env.example .env
```

Zet in `.env` een `SESSION_SECRET` van minimaal 32 tekens:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Daarna:

```bash
npm run db:up        # lokale PostgreSQL starten (blijft draaien na dit commando)
npm run db:deploy    # migraties toepassen
npm run db:seed      # voorbeelddata
npm run dev
```

Ontwikkelaccounts (wachtwoord `Ontwikkel!2026`, uitsluitend lokaal):

| Personeelsnummer | Rollen | Landt op |
| --- | --- | --- |
| `100001` | Medewerker (profiel Vroeg) | `/medewerker` |
| `100026` | Medewerker (profiel Mix) | `/medewerker` |
| `900001` | Medewerker + Rooster Commissie | `/roostercommissie` |
| `910001` | Medewerker + Dienstindeling | `/dienstindeling` |
| `990001` | Medewerker + Admin | `/beheer` |

Commando's:

```bash
npm run test              # 91 unittests — geen database nodig
npm run typecheck         # TypeScript
npm run verify:rooster    # toetst het rooster in de database aan de eigen harde regels
npm run verify:toegang    # toetst de vier rollen tegen de draaiende applicatie
npm run rotation:advance  # schuift de roulatielijsten één plaats op (wekelijkse taak)
npm run db:status         # draait de ontwikkeldatabase?
npm run db:down           # database stoppen
```

---

## De vier rollen

De rolstructuur ligt vast in `src/server/security/permissions.ts`.

| Rol | Waarvoor | Landt op |
| --- | --- | --- |
| `EMPLOYEE` | de standaardrol; **iedere nieuwe gebruiker krijgt alleen deze** | `/medewerker` |
| `ROSTER_COMMITTEE` | basisroosters samenstellen, analyseren en publiceren | `/roostercommissie` |
| `DUTY_ASSIGNMENT` | de dagelijkse operationele invulling | `/dienstindeling` |
| `ADMIN` | masterrol: alles, plus gebruikers-, rollen- en toezichtrechten | `/beheer` |

Een account kan meerdere rollen hebben; de rechten zijn de **vereniging**
daarvan. De medewerkersrol blijft altijd staan — een planner heeft immers ook
een eigen rooster, en die rol is in het beheerscherm niet uit te vinken.

### Rechten, niet rollen

Nergens in de applicatie staat `if (role === "ADMIN")`. Er staat welk **recht**
nodig is; de koppeling van rechten aan rollen gebeurt uitsluitend in één tabel.
Dat scheelt niet alleen herschrijfwerk als er een rol bijkomt — het maakt in één
oogopslag zichtbaar wie wat mag, en dat is bij een audit de vraag die gesteld
wordt.

De masterrol wordt **berekend** uit de andere rollen plus de beheerrechten, niet
handmatig opgesomd. Een nieuw recht dat aan één rol wordt toegekend, kan daardoor
niet per ongeluk buiten het bereik van de beheerder vallen; een test bewaakt dat.

### De scheiding die de rechtentabel afdwingt

| | Rooster Commissie | Dienstindeling |
| --- | --- | --- |
| Basisroosters wijzigen, genereren, publiceren | **ja** | nee |
| Dienstenpakket importeren | **ja** | nee |
| Geaggregeerde feedback lezen | **ja** | nee |
| Diensten toewijzen, reserve inzetten | nee | **ja** |
| Rooster van willekeurige medewerkers inzien | nee | **ja** |
| Persoonsgegevens inzien | nee | **ja** (gelogd) |

Dat is geen indeling van schermen maar van rechten. De Rooster Commissie kan
geen dienst toewijzen; Dienstindeling kan geen jaarrooster wijzigen. Beide
kanten worden apart getest.

---

## Architectuur

Next.js 16 (App Router, RSC) met TypeScript en Prisma op PostgreSQL. Eén regel:
**elke laag mag alleen naar beneden praten.**

```
src/
  app/
    (auth)/aanmelden        ← inloggen
    (app)/medewerker        ← afbeelding 1
    (app)/roostercommissie  ← afbeelding 2
    (app)/dienstindeling    ← afbeelding 3
    (app)/beheer            ← afbeelding 4
    (app)/regels            ← regelcatalogus, voor iedereen
  components/
    layout/                 ← AppShell, navigatie per omgeving, area-shells
    ui/                     ← StatCard, WidgetCard, tabel, iconen, knoppen
  domain/                   ← pure roosterlogica. Geen I/O, geen namen
  server/
    config/ auth/ security/ audit/
    rules-engine/           ← DE plek waar roosterregels wonen
    data/ services/ validation/
  proxy.ts                  ← beveiligingsheaders en een eerste, grove redirect
```

### Wat waar hoort

**`domain/` is puur.** Dienstclassificatie, roosterprofielen, rusttijdrekenen,
roulatie en ruilplanning zijn functies zonder database, zonder tijd en zonder
willekeur. Dat maakt ze los toetsbaar en de rules engine reproduceerbaar.

**`server/rules-engine/` is de enige plek met roosterregels.** Geen regel in een
component, een route handler of een query. Wie er daar een tegenkomt, heeft een
bug gevonden. Dat is de voorwaarde om de hele verzameling later in één keer naar
de centrale Rules Engine te verplaatsen.

**`server/services/` beslist over toegang.** Elke service begint met
`requirePermission(...)`. Route handlers en server actions valideren invoer en
geven door; zij bepalen niets zelf.

**`app/` toont alleen.** De navigatie wordt per recht gefilterd voor het gemak,
niet voor de veiligheid.

### Het design system

Eén set tokens in `src/app/globals.css`, één `AppShell`, drie vormen:
`StatCard` voor de kerncijfers bovenaan, `WidgetCard` + `WidgetRow` voor de
grote blokken, en een tabel. De vier dashboards zijn daar volledig uit
opgebouwd — dat is de reden dat ze als één applicatie lezen.

- **Zijbalk** 248 px, `#0a1e3d`, groepskoppen in kapitaal, actief item in
  `#1f5fd0`, onderin Instellingen/Uitloggen en het versienummer.
- **Kop** paginatitel 26 px bold, ondertitel, optionele contextkiezer
  (periode of datum), meldingen met telling, hulp, eigen naam en rol.
- **Accentkleuren** blauw voor Rooster Commissie, oranje voor Dienstindeling,
  groen voor status — uitsluitend in de ronde kaarticonen, zodat één blik
  volstaat om te zien waar iets over gaat.
- **Iconen** handgeschreven SVG in één stijl (`src/components/ui/icons.tsx`),
  geen externe bibliotheek.

Het beeldmerk is een eigen, abstracte vorm en niet het NS-logo: dat beeldmerk
wordt door de organisatie zelf aangeleverd. Vervangen is één component
(`BrandMark`).

---

## Database-opzet

Schema in `prisma/schema.prisma`.

### `employee_id` is de sleutel, namen nooit

`Employee` bevat personeelsnummer, roosterprofiel, standplaats, bevoegdheden en
voorkeuren — en **geen persoonsgegevens**. Naam en e-mailadres staan in
`EmployeeIdentity`, met één repository die als enige die tabel leest. Gevolgen:

1. de rooster-engine kán geen naam ontvangen: de `EMPLOYEE_SELECT` die de
   mappers gebruiken bevat het veld niet;
2. elke inzage in andermans persoonsgegevens is af te dwingen op recht en wordt
   vastgelegd;
3. "waar leest deze applicatie namen?" is te beantwoorden door één bestand te
   lezen.

De eigen naam van de ingelogde gebruiker is de uitzondering: die staat in de kop
en op het eigen dashboard, zonder recht en zonder auditregel. Het zijn zijn
eigen gegevens, en elke paginaweergave auditeren zou het logboek vullen met ruis.

### Dienstclassificatie: twee eigenschappen

Een dienst heeft een **dagdeel** (`period`) en een **werksoort** (`workType`),
apart opgeslagen:

| Bereik | period | workType |
| --- | --- | --- |
| 1–99 | `VROEG` | `RIJDEND` |
| 100–199 | `LAAT` | `RIJDEND` |
| 200–299 | `NACHT` | `RIJDEND` |
| 600-serie | `GEEN` | `RESERVE` |
| 700-serie | `GEEN` | `RANGEER` |
| **760, 761** | **`NACHT`** | **`RANGEER`** |

`kinds` is de afvlakking van die twee tot de etiketten waarmee de regels werken
en wordt altijd afgeleid. Met één veld zou je bij 760 moeten kiezen tussen nacht
en rangeer, en die keuze lekt door in rusttijdcontroles, profielgrenzen en de
verdeling van nachtwerk. De indeling staat in tabellen, niet in verspreide
if-statements: een nieuwe serie is een regel erbij.

**`RES` is een positie in het rooster**, niet een dienst uit de 600-serie. Een
RES-positie wordt later met een concrete dienst ingevuld; een 600-dienst ís een
dienst. `WR` en `CO` zijn eveneens roosterposities; hun betekenis en regels zijn
nog niet aangeleverd en worden daarom als code gedragen, niet als aanname
ingevuld.

### Roulatie per weekdag

Per weekdag en standplaats één lijst, met een **vaste basisvolgorde en een
verschuivende offset**:

```
positie = ((baseIndex + offset) mod aantal) + 1
```

Een medewerker heeft dus per weekdag een andere plaats — in de seed bijvoorbeeld
maandag 3, dinsdag 10, woensdag 17, donderdag 24, vrijdag 1. De volgorde had
elke week herschreven kunnen worden; dan is achteraf niet meer te reconstrueren
welke volgorde in week X gold, en dat is precies wat een medewerker die een
dienst misliep wil kunnen navragen. De rotatie is **idempotent**: `offsetWeek`
zorgt dat een tweede aanroep in dezelfde week niets doet.

### Auditlog

`AuditLogEntry` bevat wie (`actorEmployeeNumber`, `actorRoles`), wat (`action`),
waarop (`objectType`, `objectId`), wanneer, de oude en nieuwe waarde waar
relevant, het resultaat (`SUCCESS` / `DENIED` / `FAILED`), een `correlationId` en
een gepseudonimiseerde herkomst. `SecurityEvent` staat er los van: andere
bewaartermijn, ander publiek, andere vraag.

---

## Rooster Commissie

Uitsluitend voor het samenstellen en publiceren van **basisroosters** voor een
dienstregeling. Er staat hier niets over de dienst van morgen, over wie ziek is
of over een dienst die nog ingevuld moet worden — dat is Dienstindeling.

- roosterperiode en actief dienstenpakket in de kop
- basisroosters, roosterprofielen en het aantal lijnen per rooster
- dienstenpakket importeren (versiegewijs, met SHA-256 van het bronbestand)
- generatieopdracht samenstellen: **alle** basisroosters tegelijk
- roosteranalyse: verdeling vroeg/laat/nacht, rangeer, weekendbelasting
- harde overtredingen en zachte waarschuwingen per regel-id
- twee versies vergelijken per lijn, week en dag
- exporteren (CSV, personeelsnummers, geen namen)
- publiceren — geweigerd zolang er harde overtredingen zijn

Er is **geen knop om één rooster apart te genereren**. Eerst het profiel Vroeg
perfect vullen en de rest de restdiensten geven, benadeelt de andere roosters
aantoonbaar; een interface die dat aanbiedt ondermijnt het uitgangspunt van
gezamenlijke optimalisatie meteen.

---

## Dienstindeling

De dagelijkse invulling binnen de roosters die er al zijn.

- bezettingsgraad per dag, met de bezetting van de komende zeven dagen
- dagplanning: wie doet vandaag wat (personeelsnummers, geen namen)
- openstaande diensten met prioriteit en fase
- reserve-overzicht met automatische inzetvoorstellen **en de reden erbij**
- beschikbare diensten en de roulatielijsten
- ruilverzoeken (alleen lezen)
- export van de dagplanning

### De vaste volgorde bij een vrijgekomen dienst

**Fase 1** het reserve-rooster. **Fase 2** openstellen voor medewerkers. Die
volgorde staat in de statusovergangen (`RESERVE_PENDING` → `OPEN`), niet in de
goede bedoelingen van de aanroeper: een dienst die nog bij reserve ligt komt in
geen enkele medewerkerslijst voor, en openstellen wordt geweigerd zolang er geen
reservepoging is vastgelegd.

Reservevoorkeuren (vroeg / laat / vroeg-laat / vroeg-laat-nacht) zijn **zacht**.
Ze sturen de rangschikking en sluiten niemand uit; een geldige kandidaat kan
nooit onder een ongeldige zakken.

---

## Medewerker

- eigen rooster met roosterprofiel, lijn, weekstrook en herkomst per dag
- eerstvolgende diensten, maandbalans, RES/WR/CO
- beschikbare diensten — alleen wat roostertechnisch kan
- eigen roulatiepositie per weekdag
- diensten ruilen met een specifieke collega
- wachtlijsten voor een ander basisrooster
- kwartaalfeedback over het eigen rooster
- voorkeuren en reservevoorkeuren

### Ruilen

Een ruil is **twee** controles, niet één: A krijgt de dienst van B op de dag van
B zonder zijn eigen dienst, en omgekeerd. Dat de dienst vóór én na de ruildag bij
allebei wordt meegenomen, volgt uit het venster van drie weken dat elke controle
meekrijgt — het is geen extra stap die iemand kan overslaan. Alleen geldige
mogelijkheden worden getoond, en bij accepteren wordt opnieuw doorgerekend.

`src/domain/swap.ts` bepaalt welke roosterrijen veranderen. Bij een ruil over
twee verschillende dagen zijn dat er **vier**: beide medewerkers geven hun dag op
en werken de dag van de ander. Bij dezelfde dag vallen die vier samen tot twee.

### Beschikbare diensten

Niet wie het snelste klikt. Van de medewerkers die belangstelling tonen én
roostertechnisch geldig zijn, krijgt de hoogst geplaatste op de roulatielijst
van **die weekdag** de dienst. Wie geen belangstelling toont heeft geen invloed:
staat iemand op positie 1 en meldt hij zich niet, dan gaat de dienst naar de
eerstvolgende die dat wél deed. De volledige volgorde op het moment van
toewijzen wordt bewaard.

Kiezen kan tot **veertien dagen** vooruit. Daarna verloopt het buiten deze
module.

### Kwartaalfeedback

Maximaal één keer per kwartaal, over uitsluitend het eigen rooster. De
begrenzing staat niet alleen in de service maar ook als unieke sleutel in de
database — een service kan een fout hebben, een constraint niet.

De planner ziet uitsluitend geaggregeerde cijfers per roosterprofiel:

```
Vroeg/Laat — Te veel vroege diensten        63%
```

Onder de cohortdrempel (`PRIVACY_MIN_COHORT`, standaard 5) wordt een profiel
helemaal weggelaten, inclusief het aantal respondenten — ook dat is informatie.

---

## Admin

Geen vierde plannersomgeving maar een bedieningspaneel:

- kerncijfers: actieve medewerkers, regelconformiteit, bezettingsgraad,
  systeemstatus
- **Rollen & gebruikers**: aantallen per rol, zoeken op personeelsnummer, rollen
  toekennen en intrekken
- **Rooster Commissie** in het kort, met knop naar de volledige omgeving
- **Dienstindeling** in het kort, met knop naar de volledige omgeving
- systeemprestaties, auditlog en recente beheeracties

### Rollenbeheer

Drie eigenschappen die niet te omzeilen zijn:

1. **Server-side geautoriseerd.** Elke wijziging vereist `role:manage`. Het
   formulier stuurt een voorstel; de server beslist.
2. **Altijd auditbaar.** Eén auditregel met de oude én nieuwe rollenverzameling,
   plus wat er is toegekend en ingetrokken, plus een `ROLE_CHANGED`-gebeurtenis
   voor het toezicht.
3. **De laatste beheerder blijft staan.** De rol Admin kan niet worden
   ingetrokken en het account niet worden geblokkeerd als er daarna geen actieve
   beheerder meer over is. De poging wordt geweigerd én vastgelegd.

Wie rechten verliest, wordt uitgelogd — anders staat er een halfvolle interface
waarin de helft van de knoppen opeens foutmeldingen geeft.

Het beheerdersdashboard laadt **geen enkel persoonsgegeven**. Alles is een
aantal, een percentage of een status.

---

## De Rules Engine

Alle roosterbeslissingen lopen langs `RulesEngine`
(`src/server/rules-engine/types.ts`).

### Eén primitieve voor vier vraagstukken

Roosters genereren, een ruil toetsen, beschikbare diensten tonen en reserve
invullen lijken vier vraagstukken. Ze vragen alle vier of het houdbaar is dat
medewerker E op dag D dienst X rijdt, gegeven wat er direct voor en na staat. Die
vraag heet `AssignmentCheck`, en elke regel is een functie daarover.

### Drie soorten regels

| Categorie | Gedrag | Voorbeelden |
| --- | --- | --- |
| `HARD_CONSTRAINT` | blokkeert | roosterprofiel, bevoegdheden, standplaats, minimumrust, dag beschikbaar, max. opeenvolgende werkdagen / nachtdiensten / weekenden |
| `SOFT_CONSTRAINT` | waarschuwt en weegt mee | rustkwaliteit, reservevoorkeur, weekendbelasting, verdeling dagdelen, verdeling rangeer, dienstzwaarte |
| `OPTIMIZATION_OBJECTIVE` | stuurt de optimizer | rustkwaliteit, verdeling, weekendbelasting, dienstzwaarte, roosterkarakter, reservevoorkeur, medewerkerfeedback |

Alle regels zijn in de applicatie zelf te bekijken op `/regels` — die pagina
leest ze rechtstreeks uit de engine, dus er is geen handmatige lijst die uit de
pas kan lopen. Ook een medewerker kan hem inzien: juist wie een dienst misloopt,
moet kunnen nalezen waarom.

### Uitlegbaarheid

`src/server/rules-engine/explain.ts` maakt van een evaluatie één zin met een
uitkomst en de meest bepalende reden, en bewaart die bij de beslissing
(`RuleEvaluation.summary`). Voorbeelden zoals ze in de interface verschijnen:

```
geweigerd  — Rust vóór dienst 043 is 7 u 30 m; vereist is 11 u (onder de
             absolute ondergrens).
toegestaan — Beste geldige aansluiting binnen het rooster, past bij voorkeur laat.
```

### Waarborgen

**Een te smal venster is een fout, geen goedkeuring.** De engine weigert een
controle waarvan het venster niet minstens 21 dagen aan weerszijden beslaat:
zonder die eis levert te weinig informatie stilzwijgend een gunstig oordeel op.

**Elke evaluatie wordt vastgelegd** met engineversie en een SHA-256 van de
genormaliseerde invoer. Zonder die vingerafdruk is "het systeem stond het toe"
niet meer dan een bewering.

---

## Securitykeuzes

**Sessies aan de serverkant, geen JWT.** Een JWT blijft geldig tot hij verloopt,
ook na een intrekking. `currentActor()` controleert bij élk verzoek of het
account nog actief is; per verzoek gecachet, over verzoeken heen niet gedeeld.

**Alleen de HMAC van het sessietoken in de database.** Uit een databasekopie zijn
geen bruikbare sessiecookies te halen.

**Twee vervaltijden.** 30 minuten inactiviteit, 12 uur absoluut. Zonder die
tweede is een gestolen cookie een permanente sleutel.

**Autorisatie op drie lagen, waarvan er één telt.** De proxy kijkt alleen óf er
een cookie is; de layout stuurt door wie geen recht heeft; de **service** weigert
en legt vast. De eerste twee zijn gemak. Bewezen: als medewerker `/beheer`
intypen levert een 307 naar de eigen omgeving, en de API-route
`/dienstindeling/export` een 403 — met een `AUTHORIZATION_DENIED` in het
beveiligingslog.

**Geen onderscheid in inlogfouten.** Dezelfde melding voor elk falen; ook bij een
onbekend account wordt een bcrypt-hash vergeleken zodat het tijdsverschil geen
personeelsnummers verraadt.

**Twee lagen tegen raden.** Snelheidsbegrenzing per herkomst (10 pogingen per 5
minuten) en accountblokkade na 5 mislukte pogingen. Geen van beide vervangt de
ander.

**Content-Security-Policy met nonce per verzoek.** `script-src` gebruikt
`'nonce-…' 'strict-dynamic'`. `style-src` heeft bewust géén nonce: een nonce
schakelt daar `'unsafe-inline'` uit én kan nooit gelden voor een
`style="…"`-attribuut. Verder `X-Frame-Options: DENY`, `frame-ancestors 'none'`,
`nosniff`, `Referrer-Policy: same-origin`, restrictief `Permissions-Policy` en
`X-Robots-Tag: noindex`.

**Serverzijdige validatie op alles** met Zod, vóór er iets gebeurt. CSRF wordt
afgevangen door Next.js zelf (server actions accepteren alleen POST met geldige
oorsprong), met de `SameSite=Lax`-cookie eroverheen. Alle queries lopen via
Prisma; er wordt nergens SQL uit tekst samengesteld.

**Redactie vóór het auditlog.** Wachtwoorden, tokens, e-mailadressen en namen
worden uit elke waarde verwijderd voordat zij het logboek in gaat.

**Herkomst gepseudonimiseerd.** IP en user-agent worden nooit opgeslagen; wat in
de database staat is een HMAC.

### Privacy by design

- **Dataminimalisatie**: operationeel niet meer dan roosterprofiel,
  standplaats, bevoegdheden en voorkeuren.
- **Geen vrije tekst** bij voorkeuren en feedback. Vrije tekst bevat vrijwel
  altijd persoonlijke omstandigheden; die horen niet in een roostersysteem met
  een lange bewaartermijn.
- **Aggregatie met cohortdrempel** bij feedback.
- **Zoeken is smal.** Een medewerker zoekt een collega op vólledig
  personeelsnummer binnen de eigen standplaats, met één resultaat of niets. Een
  beheerder zoekt op personeelsnummer, niet op naam.
- **Exports bevatten personeelsnummers, geen namen.**
- **Geen namen naar de Rules Engine.** Geen enkel contexttype kent er een.

---

## Wat nog placeholder is

| Onderdeel | Stand | Waar |
| --- | --- | --- |
| **Rooster-optimizer** | niet gebouwd, met opzet. Het contract ligt volledig vast; `generateRoster` geeft `NOT_IMPLEMENTED` in plaats van een leeg rooster | `rules-engine/local-engine.ts` |
| **NS SSO / MFA** | klasse bestaat en implementeert het contract; het OIDC-gesprek ontbreekt | `auth/providers/ns-sso.ts` |
| **Centrale Rules Engine** | klasse bestaat, wordt door dezelfde configuratie gekozen; het HTTP-gesprek ontbreekt | `rules-engine/remote-engine.ts` |
| **Automatische reserve-taak** | de invulling werkt en is auditbaar, maar wordt handmatig gestart; er is nog geen achtergrondtaak | `services/reserve-service.ts` |
| **Snelheidsbegrenzing** | werkt, maar telt per proces. Met meerdere instanties hoort hier een gedeelde teller achter | `security/rate-limit.ts` |
| **Back-up, herstel, documentopslag** | niet ingericht; wordt als zodanig gerapporteerd en niet met een groen vinkje ingevuld | systeemstatus |
| **Organisatie- en integratiebeheer** | schermen bestaan en leggen uit wat ze gaan doen en waarom ze er nog niet zijn | `/beheer/organisatie`, `/beheer/integraties` |
| **Documenten (medewerker)** | idem; ontstaat pas bij publicatie van roosters | `/medewerker/documenten` |
| **Berichten** | afgeleid uit wat er feitelijk speelt; er is geen berichtenmodel | `employee-dashboard-service.ts` |
| **Verlof- en WTV-saldo** | komt uit de personeelsadministratie; wordt bewust niet geraden | medewerkerdashboard |

`RemoteRulesEngine` en `NsSsoProvider` **falen zichtbaar** in plaats van terug te
vallen op de lokale variant. Stil terugvallen zou betekenen dat het platform
andere regels of een andere identiteitsbron gebruikt dan de organisatie denkt.

---

## Nog aan te leveren door NS

Deze punten zijn **niet ingevuld en niet geraden**:

1. **Rusttijden en reeksen.** Minimumrust, absolute ondergrens, comfortabele
   rust, rust na een nachtreeks, maximum opeenvolgende werkdagen /
   nachtdiensten / weekenden. Nu voorlopige waarden in `parameters.ts`.
2. **Bezettingsdoel.** Nu 95% als voorlopige streefwaarde.
3. **De betekenis en regels van `WR` en `CO`** als roosterpositie.
4. **De bijzondere regels voor Mix, BLM en 50+ Mix.** De profielgrenzen voor
   Vroeg, Vroeg/Laat, Laat, Laat/Nacht en Mix zijn ingebouwd; de uitzonderingen
   niet. Ze horen in de regelconfiguratie, niet verspreid over componenten.
5. **Definitieve dienstnummerbereiken.** De huidige indeling is de voorlopige uit
   de opdracht.
6. **Gewenste verdelingsnormen** per roosterprofiel (aandeel vroeg/laat/nacht,
   rangeer, weekend). De analyse is nu beschrijvend en zonder streefwaarden — een
   norm die wij verzinnen wordt binnen een maand als norm gelezen.
7. **Bewaartermijnen** voor auditlog, beveiligingsgebeurtenissen en feedback.
8. **Het NS-beeldmerk** als bestand.

---

## Tests en verificatie

```bash
npm test                      # 287 unittests: domein, regels, geschiktheid, import, export, optimizer
npm run verify:rules          # het regelbestand op zichzelf
npm run verify:rooster        # de echte engine over het rooster in de database
npm run verify:structuur      # baseline, ankervergrendeling, tweelagenreserve
npm run verify:import         # reconciliatie van het dienstenpakket, heen en terug
npm run verify:integriteit    # dienstboekhouding, reserve, wijzigingsblad, verwijzingen
npm run verify:toegang        # de vier rollen tegen de draaiende applicatie
npm run verify:meldingen      # idempotentie en de uitgaande wachtrij
npm run verify:ruilingen      # invarianten van uitgevoerde ruilen
npm run verify:ruilflow       # de ruilworkflow van verzoek tot uitkomst
npm run verify:standplaatsen  # 41 geregistreerd, alleen DDR ingericht
npm run verify:schermen       # renderen de schermen, met de juiste inhoud
npm run verify:branding       # staat het officiële beeldmerk er, en overal
npm run verify:rotatie        # de weekrotatie, nagerekend door een tweede implementatie
npm run verify:plaatsingen    # roosterplaatsingen en de persoonlijke projectie
npm run verify:tijdelijk      # tijdelijke plaatsing, van begin tot terugkeer
npm run measure:optimizer     # solver en eindvalidatie op de volledige dataset
```

De unittests raken geen database. Zij toetsen waar een fout stil blijft: de
classificatie van 760/761 in dagdeel én werksoort, rusttijd over middernacht, de
ISO-weekgrens rond de jaarwisseling, de roulatie bij een negatieve offset, wat
een ruil precies met het rooster doet, de rechtenbeloften per rol, de
ankervergrendeling bij een wijzigingsblad, de importstraat inclusief
formule-injectie en middernacht, en de geschiktheidslaag.

`verify:toegang` maakt voor elke rol een echte sessie, doet echte
HTTP-verzoeken en kijkt wat er terugkomt — dezelfde weg die een aanvaller zou
nemen. Zeventien paden, vier rollen, plus twee proeven op de
standplaatsafbakening.

---

## Hoe het werkt: van dienstenpakket tot rooster

### 1. Import

Een levering doorloopt `UPLOADED → PARSED → NORMALIZED → VALIDATED →
REVIEW_REQUIRED → CONFIRMED → ACTIVE`. De eerste vier stappen raken de database
niet (`src/server/import/duty-import.ts`); pas na een menselijke bevestiging
wordt er iets vastgelegd, en activeren is daarna nog een aparte handeling.

Elke ingelezen dienst draagt zijn herkomst mee: bestandsnaam, SHA-256 van het
bronbestand, importversie, regelnummer en de letterlijke celwaarden. De vraag
"waar komt dienst 101 vandaan" is daardoor te beantwoorden — zie de dienstenbak.

### 2. Wijzigingsblad versus nieuwe dienstregeling

Bij `NEW_TIMETABLE` mag de structuur worden bepaald. Bij `AMENDMENT` liggen
rust, WTV/vrije dagen, compensatiedagen en reservedagen vast tegen een bevroren
baseline. Die vergrendeling zit in de rules engine
(`validation/checks/structure.ts`) én in het model van de optimizer: ankerdagen
komen daar niet eens als variabele in voor. Er is geen aanroep, ook niet voor een
beheerder, die haar omzeilt.

### 3. Reserve

Het basisreserverooster bevat alleen RES, R, WTV en CO. De dienstindeling vult
een reservedag operationeel in als **laag** erbovenop
(`OperationalAssignment`); `underlyingSlotType` bewaart wat eronder zat, dus
intrekken herstelt de reservedag.

### 4. De optimizer

`python/cpsat_roster.py` lost het hele vraagstuk in één model op: alle
roosterlijnen van alle profielen tegelijk. Hij draait als apart proces zonder
databaseverbinding — "de optimizer mag niets schrijven" is daarmee een
eigenschap van de omgeving en niet van een afspraak.

Hard (uitsluiting): profielgrenzen, weekdagen, één dienst per dag, een
dienstinstantie hooguit één keer, rusttijd tussen opeenvolgende dagen, maximum
aaneengesloten dienstdagen, structurele ankers. Kosten (afweegbaar): dekking,
minimale verandering, eerlijke verdeling binnen hetzelfde profiel,
draairichting. Er is geen kostenpost waarmee een harde grens is af te kopen.

Vijf scenario's verschillen uitsluitend in gewichten en zaadwaarde. Elke run
bewaart status, zaad, gewichten, rekentijd, modelgrootte en de volledige
dienstboekhouding, zodat hij te reproduceren is.


### Meldingen, ruilingen en contact

Elke wijziging die een medewerker raakt, schrijft haar gebeurtenis in dezelfde
transactie weg (`OutboxEvent`). Het omzetten naar meldingen gebeurt daarna en
mag falen: de gebeurtenis blijft staan en wordt opnieuw opgepakt. Elke melding
draagt de sleutel van het onderliggende feit, dus opnieuw verwerken levert nooit
een tweede melding op.

Een melding wijst altijd naar het onderwerp zelf — een ruilverzoek naar dát
verzoek, niet naar een algemeen overzicht.

Bij een ruil wordt op het moment van accepteren het rooster van beide
medewerkers opnieuw ingelezen en volledig hertoetst. Verandert er iets tussen
aanvraag en antwoord, dan eindigt het voorstel in `INVALIDATED` en blijft elk
rooster zoals het was.

`Contact Dienstindeling` opent een concept in Outlook (met `mailto:` als
terugval) op het adres van de eigen standplaats. Voor Dordrecht is dat
`nsr.ddr-did-mcn@ns.nl`. Het adres staat per standplaats vastgelegd; er is geen
terugval op een ander adres en geen afleiding uit de standplaatscode. De
applicatie verstuurt zelf niets.


### Roosterkoppeling en weekrotatie

Een medewerker hangt aan een rooster via `RosterMembership`. Daarin staat
niet zijn huidige regel maar een anker: op wélke regel hij stond in wélke
week. Elke andere week volgt uit

```
regel = ((anker − 1 + verstrekenWeken) mod N) + 1
```

Er wordt dus niets wekelijks bijgewerkt. Een veld dat elke week wordt
opgehoogd, is één vergeten of dubbel gedraaide taak verwijderd van een getal
waarvan niemand meer kan zeggen of het klopt; een anker blijft ook na een
storing kloppen, voor verleden én toekomst.

Drie soorten plaatsing blijven uit elkaar: **permanent** (één tegelijk),
**tijdelijk** (ligt erover heen, de permanente rotatie loopt eronder door) en
de **operationele invulling** van één dag (`OperationalAssignment`). Na een
tijdelijke plaatsing keert iemand terug op de regel waar de rotatie hem heeft
gebracht — niet op de regel waar hij vertrok.

`PersonalRosterProjectionService` voegt die lagen samen tot één dagbeeld,
met per dag de herkomst: basisrooster, tijdelijke plaatsing, operationele
invulling of ruil. Kan een dag niet worden bepaald, dan staat dat er — niet
"geen dienst".

### 5. De validator beslist

Een kandidaat wordt daarna onafhankelijk doorgerekend door
`FinalRosterValidator`, die de optimizer niet kent — een architectuurtest loopt
de importgraaf af en faalt zodra dat verandert. Zegt de solver `OPTIMAL` en de
validator "overtreding", dan heeft de validator gelijk.

### 6. Drie lagen bij een toewijzing

```
Rules Engine        mag deze plaatsing? — juridisch, hard, fail-closed
     ↓
Suitability         is dit verstandig gezien gisteren en morgen?
     ↓
Ranking             wie van de geschikte kandidaten komt als eerste?
```

De middelste laag (`SELF_SERVICE_PATTERN_COMPATIBILITY`) is **productbeleid en
geen CAO-regel**. Hij bepaalt wat een medewerker vanzelf krijgt voorgesteld; hij
verbiedt niets en kan een overtreding nooit goedmaken. De dienstindeling ziet
ook wat minder goed aansluit — mét de bezwaren erbij — maar kan niets inzetten
dat de rules engine afkeurt.

---

### Wat het meten opleverde### Wat het meten opleverde

**De KPI sprak de tabel eronder tegen.** Het Dienstindeling-dashboard meldde "0
openstaande diensten" boven een tabel met zes openstaande diensten: de teller
keek alleen naar vandaag, de tabel naar de hele werkvoorraad. De bezettingsgraad
gaat nu over de dag, de werkvoorraad over vandaag en verder.

**Geweigerde toegang gaf een foutpagina in plaats van een omleiding.** De pagina
haalde haar gegevens op vóórdat de shell eromheen kon omleiden, dus liep een
medewerker op `/beheer` tegen de weigering van de service aan. Functioneel veilig
— er werd niets prijsgegeven — maar het oogde als een storing. De controle staat
nu ook in een layout, die eerder draait: 500 werd 307.

**De ontwikkelserver draaide op een verouderde Prisma-client.** Na de
schemamigratie gaf élk verzoek een 500 met "Unknown field `roles`". De
toegangscontrole gaf toen negen keer "geweigerd" — technisch waar, en volstrekt
zonder betekenis. Zonder die run zou het als geslaagde beveiliging zijn gelezen.

**Twee taalfouten in de weergave** ("onderdeelen") en een kapotte reguliere
expressie in de initialen van de avatar (`/s+/` in plaats van `/\s+/`, waardoor
"Stijn Yilmaz" als "S" verscheen in plaats van "SY").

---

## Bekende aandachtspunten

- **`npm audit`** meldt kwetsbaarheden in `mysql2` en `deepmerge-ts`, beide
  transitieve afhankelijkheden van de Prisma-CLI (`devDependencies`). `mysql2`
  wordt niet gebruikt — de datasource is PostgreSQL.
- **De ontwikkeldatabase draait op poort 5434** (`DEV_PGPORT`); 5432 en 5433
  waren op de ontwikkelmachine bezet. `npm run db:up` weigert te starten wanneer
  de poort bezet is door iets anders dan het cluster van dit project.
- **Na een schemawijziging moet de ontwikkelserver herstarten.** Hij houdt de
  gegenereerde Prisma-client in geheugen; zonder herstart faalt élk verzoek.
- **`server-only`** gooit ook in een gewoon Node-proces. Scripts draaien daarom
  met `--conditions=react-server`; vitest gebruikt een stub.
- **De zijbalk verschijnt vanaf 1024 px.** Desktop is de primaire werkomgeving
  voor Rooster Commissie, Dienstindeling en Admin; daaronder valt de applicatie
  terug op één kolom zonder zijbalk.
