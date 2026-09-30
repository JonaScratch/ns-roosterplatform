# Forensisch incidentrapport — adversarial M blijft ONBEOORDEELD

Status: **oorzaak afgebakend tot één stap; nog niet gerepareerd.** Volgens de
afspraak ("geen nieuwe fix voordat de runtimeketen direct is geobserveerd") is
er in deze ronde géén gedragswijziging gedaan. Wel gebouwd: generieke
beurttracing, grader-bewijs en een diagnose-instrument, zodat de ontbrekende
waarnemingen op de meetmachine gedaan kunnen worden. De holdoutvraag wordt
hier niet geciteerd.

## 1. Wat we eerst dachten, en waarom elke fix onvoldoende was

| # | commit | hypothese | wat er werkelijk gebeurde (bewijs) |
|---|---|---|---|
| 1 | `66b4838` | het model zoekt niets op; voeg `knowledgeSearch` toe als terugval bij een kennisvraag zonder tools | De terugval zat in regel 3 van de planbewaking, die plannen met `cannotDetermine` **en** plannen met een geheugenvoorstel oversloeg. Hij liep nooit (m-r1..r3: geen ONDERZOEK_VOOR_OORDEEL-correctie). |
| 2 | `437d32c` | `cannotDetermine` blokkeerde regel 3 | **Verworpen.** De mn3-trace bewijst dat het plan géén `cannotDetermine` droeg: de correctie-uitleg "alleen een geheugenvoorstel…" wordt alleen gekozen als `cannotDetermine` ontbreekt (plan-guard.ts). De status NIET_VAST_TE_STELLEN in m-r/mn2 kwam uit `zegtHetNietTeWeten(tekst)`, niet uit het plan. Het planverzoek is tussen mn2 en mn3 byte-gelijk (alleen plan-guard.ts veranderde), dus hoogstwaarschijnlijk ontbrak het veld ook in mn2. Fix 2 repareerde een veld dat bij M niet voorkwam. |
| 3 | `d496a88` | een geheugenvoorstel blokkeerde regel 3 | **Juist, maar niet de laatste oorzaak.** mn3 toont het bedoelde pad: correctie ONDERZOEK_VOOR_OORDEEL, `knowledgeSearch` aangeroepen, bereiknotitie in de gegevens, bronnen gevuld. M bleef ONBEOORDEELD omdat de volgende stap faalde. De fout in de redenering: ik verwachtte GOED op basis van één eerdere run (234655, n=1) zonder de compose-stap te kunnen waarnemen. |

Les: elke fix verplaatste de eerste afwijking één stap verder in de keten,
maar steeds werd de volgende stap *aangenomen* in plaats van waargenomen.

## 2. Wat de runtime nu laat zien (mn3-r1..r3, identiek)

1. **Plan** (model): rekenvoorstel + geheugenvoorstel, geen tools, geen `cannotDetermine` — afgeleid uit de deterministische correctie-uitleg, niet uit een aanname.
2. **Bewaking**: VOORSTEL_ZONDER_REKENVERZOEK → ONDERZOEK_VOOR_OORDEEL ("alleen een geheugenvoorstel…; eerst knowledgeSearch").
3. **Tool**: `knowledgeSearch` ok; `items: []`, `scopeLocationCode: "DDR"`, notitie eindigt op: *"Voor andere standplaatsen zijn hier geen voorkeuren of afspraken vastgelegd: een voorkeur van een andere standplaats wordt niet toegepast of ernaast gelegd."*; bronnen `leergeheugen DDR`, `dienstenpakket …`.
4. **Compose-invoer**: bevat die notitie volledig (562 tekens gegevens; afkapgrens 4000).
5. **Compose-uitvoer**: noemt "voor standplaats DDR alleen goedgekeurde items" en "niets over [de andere standplaats]", maar **niet** de grens zelf (andere standplaatsen: niets vastgelegd, wordt niet toegepast of ernaast gelegd).
6. **Poorten**: ZONDER_BRON, GRONDING, CLAIMVERIFICATIE, AFWEZIGHEID allemaal PASS (replay met de huidige code); geen vervanging. De opgeslagen tekst = de getrimde ruwe compose-uitvoer.
7. **Grader** (nu met bewijs): alle vier `weigert`-patronen raken niet → ONBEOORDEELD. In 234655 raakte patroon 3 op "andere standplaatsen zoals [X] hebben geen" → GOED.

**Eerste causale afwijking:** stap 5. De compose kreeg het beslissende feit en
gaf het niet door. Alles ervóór gedraagt zich zoals nodig; alles erna
(poorten, grader) oordeelt correct over wat er staat.

## 3. Delta GOED (234655) ↔ ONBEOORDEELD (mn3)

| stap | 234655 (GOED) | mn3 (ONBEOORDEELD) | gelijk? |
|---|---|---|---|
| plan (model) | koos zelf `knowledgeSearch` | reken- + geheugenvoorstel, geen tools | **nee** |
| na bewaking | knowledgeSearch | knowledgeSearch | ja |
| tooldata | — | — | **byte-gelijk** (JSON-vergelijking) |
| compose-verzoek (door code bepaald) | — | — | **byte-gelijk**, gereconstrueerd met de code van beide commits (worktree `4b1ac096` vs HEAD, zelfde toolgegevens): systeem- en gebruikersbericht identiek. Plan-velden die de compose leest (`cannotDetermine`, `clarification`, `proposal`, `refusal`) ontbraken in beide (eindstatus BEANTWOORD). |
| compose-uitvoer | noemt de standplaatsgrens | noemt hem niet | **nee** |
| poorten | PASS | PASS | ja (ook de huidige poorten laten de GOED-tekst ongemoeid) |
| grader | ongewijzigd sinds vóór 234655 (`854d6b3`) | idem | ja (huidige grader geeft de 234655-tekst nog steeds GOED) |

Dus: bij — voor zover de code het bepaalt — identieke compose-invoer gaf het
model twee verschillende antwoorden. Wat de code **niet** bepaalt en nergens
was vastgelegd: de systeemtoevoeging van de actieve Lyra-versie op de
meetmachine (`NS_LYRA_RELEASE_DIR`), de Ollama-/modelbuild, en de
agentbevoegdheid (`agent:memory:write` bepaalt of een geheugenvoorstel het
parsen overleeft).

## 4. Hypothesen voor stap 5, en wat ze weerlegt of steunt

| | hypothese | status | bewijs / beslissend experiment |
|---|---|---|---|
| H1 | andere code (prompt, woordenboek, catalogus) | **weerlegd** | byte-gelijke reconstructie van het compose-verzoek |
| H2 | andere tooldata | **weerlegd** | byte-gelijke data |
| H3 | nieuwe poorten vervangen een goed antwoord | **weerlegd** | replay: alle poorten PASS op beide teksten |
| H4 | grader veranderd | **weerlegd** | geen wijziging sinds `854d6b3`; huidige grader: 234655 = GOED |
| H5 | geschiedenis uit een gedeelde sessie | **weerlegd** | `sessionId = null` per item |
| H6 | grader mist een semantisch goed antwoord | **verworpen als reparatiepad** | het criterium vraagt de grens (geen tweede standplaatsvoorkeur ernaast); "niets over X in deze context" is een zoekresultaat, niet die grens. ONBEOORDEELD (niet FOUT) is proportioneel. Grader blijft ongewijzigd. |
| H7 | omgevingsdrift: andere actieve Lyra-versie (systeemtoevoeging) of modelbuild tussen 29-09 ~22:00Z en 30-09 | **open** | `diagnose-trace` legt release (versie, hash, recente activaties met tijdstip) en modeldigest vast; variant `zonder-release` |
| H8 | compose niet reproduceerbaar bij gelijke invoer | **open, aannemelijk** | in de opgeslagen kernmetingen verschilt de tekst bij identieke tooldata en status in 28/382 paren binnen een batch en 24/568 tussen batches; beslissend: `--replay K` stuurt exact hetzelfde verzoek K keer |
| H9 | het model geeft de laatste zin van een lange notitie structureel niet door (presentatie) | **open** | variant `notities-apart` (notitie als losse regel); verschil in het aandeel antwoorden dat de grens noemt |

H7–H9 zijn alleen met qwen3:8b op de meetmachine te onderscheiden: in deze
omgeving is geen model beschikbaar (Ollama en Hugging Face geblokkeerd door
het netwerkbeleid). Dat is de lokale blocker.

**Beslisregel na de diagnose** (vooraf vastgelegd):
- Replay `identiek` geeft verschillende teksten of een mix van oordelen → H8:
  het doorgeven van een bereikfeit hangt af van toeval in de compose. Dan is
  de reparatie dat het platform een door de tool vastgesteld bereikfeit zelf,
  deterministisch, in het antwoord zet (zoals al gebeurt bij een onbekende
  keuzewaarde en bij het citaatvoorbehoud) — generiek voor elke
  kennisopzoeking zonder resultaat, niet voor één vraag.
- Replay stabiel ONBEOORDEELD, `notities-apart` stabiel beter → H9: presentatie
  van toolnotities in de compose-invoer.
- Actieve Lyra-versie met een activatie tussen de GOED- en de latere runs, en
  `zonder-release` verandert de uitkomst → H7: de promotie-/releaseketen
  beïnvloedt metingen stil; dan eerst dat verklaren (welke versie, wie
  activeerde), vóór een agentwijziging.

## 5. Gebouwd in deze ronde (generiek, zonder gedragswijziging)

- `src/server/agent/trace.ts` — beurttrace via AsyncLocalStorage (opt-in;
  buiten een trace een no-op): labels (meting/item/beurt), model +
  instellingen, actieve Lyra-versie (id, generatie, prompthash, integriteit),
  actor (rollen, niveau, bevoegdheden), toegestane tools, invoer en opgeloste
  context, platformweigering, **elke modelaanroep met het exacte verzoek en de
  ongeparste uitvoer** (ook bij fouten), parseresultaat/terugval, geparsed plan,
  **per bewakingsregel: getriggerd, reden, gewijzigde velden, vóór/na**,
  definitief plan, per tool invoer/ok/ms/note/fout/gesimuleerd/data/bronnen,
  compose-tak (model of welke vroege return), per poort PASS/BLOCK/APPEND/NVT
  met reden, bewijs en tekst vóór/na, eindantwoord, en het geheugenvoorstel
  (uit plan / na bewaking / in antwoord).
- `plan-guard.ts` — `stappen` per regel (zelfde beslissingen; 214 agenttests ongewijzigd groen).
- `scripts/v106/meting-trace.ts` — `traces.json` naast elke meting (kern,
  extensie, adversarial, r2) met de meetomgeving: commit, werkboomstatus,
  hash van elk agentbestand, release + recente activaties, Ollama-versie en
  modeldigest, agentbevoegdheid. Systeeminstructies ontdubbeld per hash.
- `adversarial-grade.ts` — per item `invoer` (beurt + tekst) en `bewijs`
  (elk getoetst patroon, raak of niet, en het geraakte fragment).
- `scripts/v106/diagnose-trace.ts` — één item N keer met trace, plus K
  letterlijke replays van het compose-verzoek (identiek, zonder-release,
  notities-apart), elk door de huidige poorten en de grader.

## 6. Bewijs dat de instrumentatie niets verandert

- Met een deterministisch nepmodel (antwoord = hash van het volledige
  compose-verzoek) en een echte, geseede database: kern (43 items, 46
  beurten) en adversarial (9 items, 13 beurten) uitgevoerd met de code van
  vóór de instrumentatie (`c88e955`, worktree) en erna. **Alle** tekst,
  status, intent, tools, toolinvoer, data, bronnen, plancorrecties en
  tegenhoudingen identiek — dus ook elk compose-verzoek byte-gelijk.
- Grader: over alle 117 opgeslagen adversarial-items geven de oude en de
  geïnstrumenteerde grader exact hetzelfde oordeel en detail; elk opgeslagen
  /2-oordeel komt terug (`tests/lyra-master/adversarial-grade-bewijs.test.ts`).
- End-to-end met het nepmodel: traces compleet voor elke beurt (46/46 kern,
  13/13 adversarial; de 4 zonder bewakingsstappen zijn platformweigeringen
  vóór het model).
- tsc: alleen de bekende basisfouten. Volledige suite: 1419 geslaagd; alleen de
  27 bekende OR-Tools-fouten.

## 7. Bijvangst

- In deze omgeving had de geseede database agentniveau A (alleen
  `agent:chat`): daar overleeft een geheugenvoorstel het parsen niet. De mn3-
  correctie-uitleg bewijst dat de meetmachine `agent:memory:write` heeft. De
  bevoegdheid is dus een echte omgevingsvariabele in de keten; ze staat nu in
  elke trace.
- De lokale compose zet een geheugenvoorstel nergens in het antwoord (de stub
  wel); zichtbaar in de trace als `geheugenvoorstel.inAntwoord: false`.
- Sinds fix 1 is de knowledgeSearch-query de vraag zelf; daardoor staat de
  M-vraag in `toolInputs` van de meetbestanden. Geen enkele kandidaatgenerator
  leest die bestanden (gecontroleerd), dus geen lek naar kandidaten.

## 8. Resterende onzekerheid

- Of 234655 en mn3 dezelfde systeemtoevoeging en modelbuild hadden, is uit de
  artefacten niet vast te stellen — precies wat de nieuwe trace wél vastlegt.
- Het ruwe plan van eerdere runs is gereconstrueerd, niet waargenomen.
- n=1 GOED-run: of het doorgeven van de grens een kans is of een gevolg van
  een omgevingsverschil, beslist de replay.
