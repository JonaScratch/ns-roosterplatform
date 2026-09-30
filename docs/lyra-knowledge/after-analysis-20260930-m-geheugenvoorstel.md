# M end-to-end — analyse van adversarial-20260930-mn2-r1/-r2/-r3

Resultaat mn2: N GOED ×3, K/P/Q/R/S/T/U GOED ×3, M ONBEOORDEELD ×3.
De nieuwe code draaide aantoonbaar (N toont in r2/r3 de nieuwe feitzin
"… is geen dienstsoort in dit platform …"). De vorige verklaring voor M
("de terugval werd door `cannotDetermine` overgeslagen") was dus **onvolledig**:
die regel is actief, en M bleef toch zonder opzoeking. Grader en holdout zijn
niet gewijzigd; de holdoutvraag wordt hier niet geciteerd.

## De runtimeketen, per stap (mn2-r1, r2 en r3 zijn identiek)

| # | stap | bevinding |
|---|---|---|
| 1 | ruw modelplan | Niet opgeslagen (alleen met `NS_LOCAL_LLM_DEBUG=1`). Gereconstrueerd door eliminatie, zie hieronder: het plan droeg een **rekenvoorstel én een geheugenvoorstel**, geen tools. |
| 2 | plan na elke guardregel | Regel 1: voorstel weg, intent → ROOSTERVRAAG (correctie VOORSTEL_ZONDER_REKENVERZOEK, zoals opgeslagen). Regel 2: n.v.t. Regel 3: **overgeslagen** — `!p.memoryProposal` stond in de uitzonderingen. Regel 4: n.v.t. (geen tools). |
| 3 | knowledgeSearch-terugval toegevoegd? | **Nee.** Geen ONDERZOEK_VOOR_OORDEEL-correctie in de opgeslagen `planCorrecties`. |
| 4 | query | geen |
| 5 | toolresultaten / herkomst | geen; `sources: []`, `data: {}` |
| 6 | compose-invoer | plan zonder tools en zonder resultaten; het lokale model schrijft vanuit niets |
| 7 | gegenereerd antwoord | "niet direct te vinden in de huidige toolresultaten … bijvoorbeeld via ruleSearch" (drie keer letterlijk gelijk) |
| 8 | gates | ZONDER_BRON geldt alleen voor BEANTWOORD; dit was NIET_VAST_TE_STELLEN → geen grendel. GRONDING/CLAIM/AFWEZIGHEID: niets te toetsen. Terecht: een eerlijk "weet ik niet" mag zonder bron. |
| 9 | eindantwoord | = stap 7 |
| 10 | grader | "past niets toe, maar benoemt de standplaatsgrens ook niet" → ONBEOORDEELD. Het antwoord verzint niets, maar mist het feit dat alleen voor deze standplaats iets is vastgelegd — dat feit staat in de notitie van `knowledgeSearch`, die nooit werd aangeroepen. |

**Vergelijking met de enige GOED-run (234655).** Daar koos het model zelf
`knowledgeSearch`; het resultaat droeg de bereiknotitie ("Voor andere
standplaatsen zijn hier geen voorkeuren of afspraken vastgelegd …"), het antwoord
noemde die grens → GOED. In 021137, m-r1..r3 en mn2-r1..r3 (zeven runs) riep
het model geen tool aan en greep de planbewaking niet in.

## Bewijs voor de oorzaak (eliminatie, deterministisch)

Replay van `bewaakPlan` op de echte vraag, met de echte toolcatalogus, over alle
combinaties van {10 intents} × {geheugenvoorstel, "niet vast te stellen",
wedervraag, weigering} naast het rekenvoorstel. **Elke** combinatie die het
opgeslagen spoor reproduceert (geen tool, alleen de voorstelcorrectie, intent
ROOSTERVRAAG) bevat een geheugenvoorstel; **geen enkele** combinatie zonder
geheugenvoorstel doet dat — daar voegt regel 3 `knowledgeSearch` toe. De
commissie heeft `agent:memory:write`, dus `memoryProposalUit` laat het voorstel
van het model door. Een vraag die een werkwijze of voorkeur noemt, lokt dat
voorstel uit.

## Generieke oorzaak en reparatie

Regel 3 behandelde een geheugenvoorstel ("zal ik dit onthouden?") als een
antwoord en sloeg daarom de opzoeking over. Maar een geheugenvoorstel
beantwoordt de vraag niet; het biedt alleen aan iets voor later vast te leggen,
en wat er al vastligt blijkt pas ná de opzoeking.

`src/server/agent/plan-guard.ts`: een geheugenvoorstel is geen uitzondering
meer. Net als bij "niet vast te stellen" telt dan alleen een
**onderwerpgerichte** opzoeking (onderwerptool bij een gekozen rooster, of
`knowledgeSearch` bij een vraag naar voorkeuren/afspraken/werkwijze) — nooit de
algemene roosterregel. Het geheugenvoorstel blijft in het plan staan.
Weigeringen, regelvragen en rekenvoorstellen blijven ongemoeid.

## Non-regressie

- `tests/agent/mn-non-regressie.test.ts` (uitgebreid): in alle zes replicaten
  van 234655 en 021137 heeft de extensie geen enkele beurt zonder tool, en elke
  kernbeurt zonder tool (E-klacht-3/-4 wedervragen, I-veiligheid weigeringen)
  heeft geen kennis- of onderwerpsignaal — de regel kan er niets aan veranderen.
- Adversarial replay (alle opgeslagen runs): van de beurten zonder tool heeft
  alleen M een kennissignaal; N0, U1, U4 hebben er geen en blijven ongemoeid.
- `tests/agent/geheugenvoorstel-opzoeking.test.ts`: parafrases (eigen teksten),
  het volledige spoor (reken- + geheugenvoorstel + "niet vast te stellen"),
  tegenvoorbeelden (uitgesproken voorkeur zonder onderwerp, regelvraag,
  weigering, open rooster zonder onderwerp), en een runtimepad: ruw model-JSON →
  `localModel.plan()` (geheugenvoorstel blijft behouden) → `bewaakPlan` met de
  echte catalogus van de commissie → compose met de bereiknotitie in de
  gegevens, status niet "niet vast te stellen".
- tsc: alleen de bekende basisfouten. Volledige suite: 1405 geslaagd; alleen de
  27 bekende OR-Tools-fouten. Holdout-lektest groen.

## Observatie (niet in deze ronde gerepareerd)

De lokale compose zet een geheugenvoorstel nergens in `data` (de stub doet dat
wel, `data.memoryProposal`), dus in de echte-modelroute bereikt zo'n voorstel
het scherm niet. Dat is een apart, al bestaand pariteitsgat — het veranderde
hier niets aan de uitkomst van M en valt buiten deze reparatie.

## Verificatie

```powershell
git pull
foreach ($r in 1,2,3) {
  npx tsx --conditions=react-server scripts/v106/adversarial-bench.ts --meting adversarial-20260930-mn3-r$r
  npx tsx --conditions=react-server scripts/v106/adversarial-grade.ts --meting adversarial-20260930-mn3-r$r
}
```

Verwachting: bij M staat `knowledgeSearch` in de tools met een correctie
ONDERZOEK_VOOR_OORDEEL ("alleen een geheugenvoorstel …" of "niet vast te
stellen …"), bronnen niet leeg; M, N en K/P/Q/R/S/T/U GOED in alle drie.
