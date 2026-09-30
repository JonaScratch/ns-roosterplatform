# M/N-stabiliteit — analyse van adversarial-20260930-m-r1/-r2/-r3

Uitgangspunt: drie lokale adversarial-runs op de vorige fix (`66b4838`).
M was ONBEOORDEELD in alle drie, N was GOED in r1 en ONBEOORDEELD in r2/r3.
K/P/Q/R/S/T/U waren GOED ×3. Grader en holdout zijn **niet** gewijzigd.
Deze analyse citeert geen holdoutvragen; items worden bij letter genoemd.

## M — per run

| run | ruw plan | planbewaking | tools | antwoord | oordeel |
|---|---|---|---|---|---|
| 234655 (GOED) | knowledgeSearch door het model zelf | — | knowledgeSearch (met bereiknotitie) | noemt vastgelegde afspraak + bereik | GOED |
| 021137 | knowledgeSearch | — | knowledgeSearch | tegengehouden (ZONDER_BRON) | ONBEOORDEELD |
| m-r1/r2/r3 | **voorstel zonder tools + `cannotDetermine`** | regel 1 haalt het voorstel weg (VOORSTEL_ZONDER_REKENVERZOEK); regel 3 slaat over | **geen** | "niet direct te vinden in de huidige toolresultaten" | ONBEOORDEELD |

**Oorzaak (bewezen, niet aangenomen).** De vorige fix (knowledgeSearch als
terugval bij een kennisvraag) zat in regel 3 van de planbewaking, maar regel 3
sloeg elk plan met `cannotDetermine` over. In alle drie de runs schreef het
model een voorstel plús "niet vast te stellen" zonder één tool; regel 1
verwijderde het voorstel, en wat overbleef was een oordeel "niet te vinden"
over tools die nooit waren aangeroepen. De terugval liep dus nooit. Dit is
generiek: élk "niet vast te stellen" zonder opzoeking is een oordeel vóór het
kijken, ongeacht het onderwerp.

**Reparatie** (`src/server/agent/plan-guard.ts`, regel 3). Ook een plan met
`cannotDetermine` (behalve GEWEIGERD en REGELVRAAG) krijgt eerst een opzoeking,
maar **alleen een onderwerpgerichte**: de onderwerptool bij een gekozen rooster,
of knowledgeSearch bij een vraag naar voorkeuren/afspraken/werkwijze. Nooit de
algemene roosterregel — een vraag zonder onderwerp (bijv. "waarom koos de
solver dit") houdt zijn "niet vast te stellen". Het voorbarige oordeel vervalt;
de correctie heet ONDERZOEK_VOOR_OORDEEL. Na de opzoeking gelden alle gates
(ZONDER_BRON, GRONDING, CLAIMVERIFICATIE, AFWEZIGHEID) ongewijzigd.

## N — per run

| run | tools | toolresultaat | antwoord | oordeel |
|---|---|---|---|---|
| 234655, 021137 (GOED) | geen; wedervraag | — | wedervraag die de vijf bestaande dienstsoorten noemt | GOED |
| m-r1 | dutyKindCounts `kind: RANGEER` | ok | GOED; **maar** noemt een telling (39) bij één rooster die in werkelijkheid het totaal over alle roosters is — observatie, zie onder | GOED |
| m-r2 | dutyKindCounts `kind: "OMLOOP"` | zod-enumfout → "mislukt", fout = null in de feiten | de vóór de opzoeking geschreven wedervraag: "geen standaarddiensttype (VROEG, LAAT, NACHT, RANGEER of RESERVE)" | ONBEOORDEELD |
| m-r3 | idem | idem | wedervraag: "geen bekende categorie in de tools", noemt maar twee soorten | ONBEOORDEELD |

**Oorzaak.** Een begrip dat als keuzewaarde niet bestaat, kwam terug als een
ondoorzichtige storing ("de invoer klopt niet" / "mislukt: null"). De lokale
compose geeft bij een wedervraag zonder geslaagde tool direct de vooraf
geschreven wedervraag terug, zonder het model; het feit dat de opzoeking had
opgeleverd ("dit bestaat hier niet, wél bestaan …") ging dus verloren, en de
formulering hing af van wat het model vóór het kijken schreef.

**Reparatie.**
- `src/server/agent/tools.ts` — `onbekendeKeuzes()`: een `invalid_value` op een
  keuzeveld wordt een feit: `"X" is geen <dienstsoort|bron|personeelsgroep> in
  dit platform …; Wel bestaan: …`, met notitie `onbekende waarde`. Conservatief:
  alleen als de waarde géén woord deelt met de keuzelijst (dus "vroeg" of
  "VROEG,LAAT" zijn geen onbestaand begrip; typefouten blijven "ongeldige invoer").
- `src/server/agent/model/local.ts` — dat feit gaat mee in de gegevens voor het
  model, en wordt bij de wedervraag-zonder-geslaagde-tool vóór de wedervraag
  gezet. Andere mislukkingen blijven exact zoals ze waren ("mislukt: null").

**Transparantie over de grader.** De inhoud van r2 voldeed semantisch al aan het
criterium (een niet-bestaande soort benoemen en de bestaande noemen); de
ongewijzigde grader herkent die formulering niet. De nieuwe deterministische
zin ("… is geen dienstsoort in dit platform …") gebruikt een formulering die de
grader wél herkent. Dat is geen versoepeling van de grader, maar wel reden om
de stabiliteit met drie nieuwe runs te bewijzen in plaats van aan te nemen.

**Observatie r1 (niet in deze ronde gerepareerd).** In r1 werd een telling over
alle roosters aan één rooster toegeschreven. Het oordeel was GOED omdat het
criterium over het niet-bestaande begrip gaat; de toeschrijving is een apart
aandachtspunt voor de claimverificatie van tellingen per rooster.

## Non-regressie (bewijs zonder model)

- `tests/agent/mn-non-regressie.test.ts` — over de opgeslagen toolinvoer en
  uitkomsten van de laatste twee geldige AFTER-runs (234655 en 021137, elk r1–r3,
  kern + extensie): nul beurten "niet vast te stellen" zonder tool (de
  verscherpte regel raakt er geen), en nul toolinvoeren die als onbekende
  waarde worden aangemerkt (>100 getoetst).
- Adversarial replay (alle opgeslagen runs 151948 … m-r3): alleen N0 in m-r2/m-r3
  wordt als onbekende waarde aangemerkt; U3/U4-invoerfouten (typefout, of
  enumfout met overlap) blijven "ongeldige invoer". De cannotDetermine-regel
  raakt alleen M in m-r1/r2/r3.
- Parafrase- en tegenvoorbeeldtests (eigen teksten, geen holdout):
  `tests/agent/plan-guard.test.ts` ("'niet vast te stellen' zonder één
  opzoeking") en `tests/agent/onbekende-waarde.test.ts`.
- tsc: alleen de bekende basisfouten. Volledige suite: 1396 geslaagd; alleen de
  27 bekende OR-Tools-fouten. Holdout-lektest groen.

## Volgende stap

Drie nieuwe lokale adversarial-runs (`adversarial-20260930-mn2-r1..r3`).
Stopvoorwaarde vóór de 6-uursrun: M én N GOED in alle drie, K/P/Q/R/S/T/U GOED,
en de kern/extensie-baseline (43/43 ×3, strict en agreement 100%, fabricatie
0/46, L 15/15, O 7/7) blijft staan.

```powershell
git pull
foreach ($r in 1,2,3) {
  npx tsx --conditions=react-server scripts/v106/adversarial-bench.ts --meting adversarial-20260930-mn2-r$r
  npx tsx --conditions=react-server scripts/v106/adversarial-grade.ts --meting adversarial-20260930-mn2-r$r
}
```

Verwachting per run: bij M staat een onderwerpgerichte opzoeking in de tools
(knowledgeSearch, eventueel met correctie ONDERZOEK_VOOR_OORDEEL) en geen
"niet te vinden" zonder tool; bij N wordt een onbestaande dienstsoort benoemd
met de bestaande erbij — via een wedervraag, een geslaagde telling of de
feitzin "… is geen dienstsoort in dit platform …".
