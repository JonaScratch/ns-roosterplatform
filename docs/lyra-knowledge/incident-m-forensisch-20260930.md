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

## 9. Diagnose `diagnose-20260930-m` — analyse volgens de beslisregel

Meetomgeving (uit `traces.json`): commit `3e68f06` (de geïnstrumenteerde code),
geen releasemap ingesteld, integriteit `NO_RELEASE`, geen activaties; Ollama
0.34.4, qwen3:8b (modelfile-standaard temperature 0.6 / top_k 20 / top_p 0.95,
per verzoek overschreven met temperature 0); agentniveau B met
`agent:memory:write`.

### Directe waarnemingen

| stap | verzoek (hash) | uitvoer |
|---|---|---|
| plan, herhaling 0 | `4d81c8b3702c` | het model plant zelf `knowledgeSearch` (dit is het 234655-gedrag) |
| plan, herhaling 1 en 2 | `4d81c8b3702c` (**zelfde bytes**) | rekenvoorstel + geheugenvoorstel, geen tools (het latere gedrag) |
| compose, herhaling 0–2 (in de keten, na het planverzoek) | `9afa905a643c` | tekst A (= mn3), 3/3 |
| compose-replay "identiek" (na een compose-verzoek) | `9afa905a643c` (**zelfde bytes**) | tekst B, 5/5; 0/5 gelijk aan A |

Tekst B noemt: "De tool bevat alleen goedgekeurde afspraken voor standplaats
DDR, geen voorkeuren van andere standplaatsen zoals [X]." De grader (bewijs:
geen van de vier grenspatronen raakt) geeft ONBEOORDEELD. Grader ongewijzigd.

### Toepassing van de beslisregel

- **H7 (release/omgeving): weerlegd.** Geen actieve Lyra-toevoeging; de
  variant `zonder-release` was niet van toepassing. De omslag in het plan na
  234655 is hier *zonder* omgevingswijziging gereproduceerd (herhaling 0 vs 1).
- **H8 (niet reproduceerbaar): bevestigd, rechtstreeks.** Byte-gelijke
  verzoeken gaven verschillende uitvoer — bij het plan (twee plannen) én bij de
  compose (A in de keten, B bij replay). Letterlijk zei de regel "replay
  identiek geeft verschillende teksten"; binnen de vijf replays was de tekst
  gelijk, maar afwijkend van dezelfde bytes in de keten. Het patroon wijst op
  afhankelijkheid van het *voorafgaande* verzoek (servertoestand /
  promptcache): na het planverzoek steeds A, na een compose-verzoek steeds B,
  het eerste plan (na iets anders) anders dan de volgende twee. Dat mechanisme
  is aannemelijk maar nog niet bewezen — zie v2 hieronder.
- **H9 (presentatie): niet onderscheiden — fout in mijn diagnose.** De variant
  `notities-apart` zocht het anker `"\n\nGebruik uitsluitend"`, maar de compose
  filtert lege regels weg (`.filter(Boolean)`), dus dat anker bestaat niet. De
  variant stuurde ongemerkt het originele verzoek (identieke uitvoer bevestigt
  dat). Gerepareerd: juist anker, `null` (= overgeslagen) als het anker
  ontbreekt, verzoekhash per variant, en een toets die de variant tegen een
  echt compose-verzoek controleert (`tests/lyra-master/diagnose-varianten.test.ts`).

Gevolg: H7 weerlegd, H8 bevestigd, H9 open. Volgens de afspraak (geen fix vóór
H7/H8/H9 onderscheiden) is er **nog geen reparatie** gedaan.

### Gevolg voor de meetmethode (zonder de stopvoorwaarden te wijzigen)

Als de uitvoer afhangt van het voorafgaande verzoek, zijn drie replicaten met
dezelfde volgorde van verzoeken geen onafhankelijke steekproeven: mn2-r1..r3 en
mn3-r1..r3 waren elk onderling letterlijk gelijk. Een wijziging elders (een
ander item, een andere tool-uitkomst) kan een item omzetten zonder dat aan dat
item iets veranderde — dat past bij de omslag van M na 234655. Dit wordt hier
alleen gemeld; de afgesproken stopvoorwaarden blijven ongewijzigd.

### Diagnose v2 — vooraf vastgelegde voorspellingen

Nieuwe varianten (elk met verzoek- en uitvoerhash in `volgorde`):
`na-plan` (eerst het planverzoek, dan het compose-verzoek — de volgorde in de
keten), `na-herladen` (model eerst uit Ollama gehaald), en `notities-apart`
(gerepareerd, óók na het planverzoek, zodat alleen de presentatie verschilt
van `na-plan`).

- `na-plan` levert tekst A → mechanisme van H8 bewezen: de uitvoer hangt af van
  het voorafgaande verzoek.
- `notities-apart` noemt de grens waar `na-plan` dat niet doet (zelfde
  voorafgaand verzoek) → H9 bevestigd; anders H9 weerlegd.
- Reparatiekeuze (vooraf vastgelegd): omdat H8 bevestigd is, kan een
  presentatiewijziging alleen de uitkomst niet stabiel maken — die blijft van
  servertoestand afhangen. De reparatie wordt daarom dat het platform een door
  de tool vastgesteld bereikfeit bij een kennisopzoeking zonder resultaat zelf,
  deterministisch, in het antwoord zet (generiek, niet per vraag). De uitkomst
  van H9 bepaalt alleen of daarnaast de presentatie van toolnotities verandert.
  Openheid: zo'n vaste zin gebruikt woorden die de grader herkent; dat is geen
  graderwijziging, maar wel precies waarom daarna drie échte replicaten nodig
  zijn.

### Incident tijdens deze analyse

Bij het opruimen van een nep-rookproef verwijderde ik per ongeluk de hele map
`benchmarks/diagnose/`, inclusief `diagnose-20260930-m`. Direct hersteld uit
git (`git checkout --`), byte-gelijk geverifieerd (sha256 van beide bestanden
gelijk aan HEAD); de verwijdering is nooit gecommit of gepusht.

## 10. Diagnose v2 (`diagnose-20260930-m2`) en de reparatie

### Toetsing aan de vooraf vastgelegde regel

Omgeving: commit `4cb22a9`, `NO_RELEASE`, geen activaties, Ollama 0.34.4,
agentniveau B. Compose-verzoek in beide ketenherhalingen byte-gelijk
(`8a5ccec7b7c13317`); alle vier varianten stuurden, behalve `notities-apart`,
exact dat verzoek (`gelijkAanOrigineelVerzoek: true`).

| variant | voorafgaand verzoek | uitvoer (4×) | oordeel |
|---|---|---|---|
| keten, herhaling 0 en 1 | planverzoek | A | ONBEOORDEELD |
| `identiek` | compose-verzoek | B | 4× ONBEOORDEELD |
| `na-plan` | planverzoek | **A** (4/4 gelijk aan de keten) | 4× ONBEOORDEELD |
| `na-herladen` | model herladen | C: "Voor andere standplaatsen, zoals [X], zijn geen voorkeuren opgenomen…" | 4× GOED |
| `notities-apart` | planverzoek | D: "…andere standplaatsen zijn geen afspraken vastgelegd, dus deze voorkeur wordt niet…" | 4× GOED |

- **H7 weerlegd** (blijft): geen releasetoevoeging.
- **H8 bevestigd, mechanisme bewezen**: `na-plan` reproduceert de ketentekst
  4/4; dezelfde bytes geven na een ander voorafgaand verzoek B, na herladen C.
  De uitvoer is deterministisch *gegeven de servertoestand*, en die toestand
  wordt door het vorige verzoek bepaald.
- **H9 bevestigd — voor één toestand**: met hetzelfde voorafgaande verzoek
  noemt de aparte notitiepresentatie de grens 4/4, de standaardpresentatie 0/4.

### Gekozen reparatie (zoals vooraf vastgelegd voor H8)

`src/server/agent/kennis-bereik.ts`, toegepast in `agent.ts` ná alle poorten
(`verankerKennisBereik`, poort `KENNISBEREIK` in de trace). Het platform zet
onder het antwoord wat een geslaagde `knowledgeSearch` aantoonbaar vaststelt:

- **afwezigheid** — de opzoeking vond niets én de vraag vraagt naar vastgelegde
  voorkeuren/afspraken/werkwijzen (bestaand signaal `vraagtNaarKennis`);
- **grens** — de vraag noemt een andere bekende standplaats (op naam, uit
  `STATIONS`; geen codes) dan waarvoor de kennis geldt. Structureel waar voor
  élke opzoeking: `recall` (memory.ts) haalt alleen items van deze standplaats
  plus NS-brede op.

Nooit zonder geslaagde `knowledgeSearch` met `scopeLocationCode`; niet bij een
weigering, fout of voorstel. Geen modelverzoek verandert: de toevoeging komt
ná de compose. Grader ongewijzigd; geen itemherkenning, geen holdouttekst.
Openheid: de grenszin volgt de bestaande toolnotitie en gebruikt woorden die
de grader herkent — daarom zijn drie echte replicaten nodig.

### Presentatie van toolnotities (H9): bewust nog niet algemeen doorgevoerd

De regel zei "H9 bepaalt of daarnaast de presentatie verandert". Ik wijk hier
bewust en zichtbaar van af, om twee redenen uit de meting zelf:

1. H9 is bevestigd in één toestand, voor één item. "Betrouwbaarder" vraagt
   meerdere toestanden; onder H8 kan een andere volgorde het omdraaien.
2. Een generieke presentatiewijziging verandert het compose-verzoek van 17 van
   de 46 kernbeurten en 15 van de 22 extensiebeurten (alle met `note` in de
   toolgegevens), en — onder H8 — via de promptcache ook de beurten daarna.
   Non-regressie op 43/43 ×3, L 15/15 en O 7/7 is dan zonder model niet te
   bewijzen. De verankering maakt de juistheid van het bereik al onafhankelijk
   van presentatie én toestand.

Voorstel: presentatie als aparte wijziging, pas na een volledige kern- en
extensiemeting ×3 met die wijziging. Niet in deze ronde.

### Non-regressie

- **Geen enkel modelverzoek verandert**: toets met een nepmodel met toestand
  (compose-uitvoer afhankelijk van het vorige verzoek: plan / compose /
  herladen): de verzoeken zijn in alle drie toestanden byte-gelijk, de
  modeltekst verschilt, de bereikzinnen zijn identiek en staan in elk
  eindantwoord (`tests/agent/kennis-bereik.test.ts`, 23 toetsen, incl.
  standaard- en aparte presentatie, lokale scope uit de tool, en
  tegenvoorbeelden zonder onterechte bereikzin).
- **Kern en extensie**: in alle zes opgeslagen replicaten (234655, 021137;
  408 beurten) krijgt geen enkele beurt een bereikzin
  (`tests/agent/mn-non-regressie.test.ts`). Omdat ook geen modelverzoek
  verandert, blijft de volledige verzoekreeks — en daarmee elke uitkomst —
  gelijk: 43/43 ×3, strict/agreement, fabricatie 0/46, L 15/15, O 7/7.
- **Adversarial** (replay over alle metingen sinds 234655): alleen M wordt
  aangevuld; K en N–U nooit. mn3-r1..r3: M ONBEOORDEELD → GOED; 234655 blijft
  GOED; beide diagnoses: alle ketenherhalingen GOED. M is één beurt en de
  laatste van zijn sessie, dus de aanvulling bereikt geen later verzoek; N en
  verder krijgen dezelfde servertoestand als voorheen.
- **Echte keten** (askAgent, Postgres, geseede data, deterministisch
  nepmodel): kern 43 items en adversarial 9 items vóór (`4cb22a9`) en ná de
  reparatie: alles byte-gelijk behalve M, en M alleen door de toegevoegde
  zinnen achter een ongewijzigde modeltekst.
- tsc: alleen de bekende basisfouten. Volledige suite: 1445 geslaagd; alleen de
  27 bekende OR-Tools-fouten. Holdout-lektest groen.
