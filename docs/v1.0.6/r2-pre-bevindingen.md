# R2-PRE — de nulmeting van Ronde 2, vóór enige functionele wijziging

*25 september 2026. Commit `963c800`. Model `qwen3:8b`, temperatuur 0, dezelfde machine
als N0/n0b/N1. Set: `docs/v1.0.6/r2-suite.json`, 15 items (5 holdout), gebouwd uit een
echte, met de hand gevoerde praktijksessie na N1. Ruwe uitkomst: `benchmarks/r2-pre/r2.json`.
Deze meting en de bijbehorende suite zijn bevroren zodra dit document is geschreven — ze
worden niet meer aangepast, alleen exact herhaald als R2-POST/N2.*

## Score

**12 GOED / 3 FOUT van de 15 (80%).** Fabricatie: 0 van 30 antwoorden.
Latency: p50 12.529 ms · p95 24.408 ms · gemiddeld 13.291 ms.

| Casus | GOED | FOUT |
| --- | --- | --- |
| A — ongefundeerde profielconclusie | 2 | 0 |
| B — contextbehoud bij kandidaatwissel | 7 | 1 |
| C — causale claim over het roosterbrein | 1 | 1 |
| D — vergelijkende claim ("sowieso beter") | 2 | 0 |
| E — het volledige praktijkgesprek (6 beurten) | 0 | 1 |

## De meetlat is één keer gecorrigeerd, en dat staat hier met de reden

De eerste beoordeling gaf 8/15. Bij het met de hand nalezen van elk "FOUT"-transcript
(niet alleen de cijfers) bleek een deel van de patroonherkenning te smal:

- **Onzekerheid herkennen (casus C).** v1 zocht naar "kan ik niet vaststellen". C1's
  antwoord — "zonder specifieke toolresultaten kan ik niet **uitleggen** waarom..." — is
  inhoudelijk exact het gevraagde gedrag en werd toch afgekeurd. v2 herkent ook
  "uitleggen/verklaren" en de lijdende vorm ("kan niet worden vastgesteld").
- **Criterium/criteria (casus D).** v1 eiste het enkelvoud "criterium" letterlijk. Beide
  antwoorden zeiden "criteria" (meervoud) — v2 herkent het stamwoord.
- **Zelfcorrectie herkennen (casus A).** v1 zocht "niet vastgesteld"; de antwoorden zeiden
  "niet bevestigd" en "geen basis voor conclusies" — v2 herkent ook die formulering, en
  telt `knowledgeSearch` mee als een echte controlepoging naast de (toen nog
  niet-bestaande) profieltool.

Tegelijk is één patroon **toegevoegd, niet verruimd**: een gehedgede rationalisatie
("waarschijnlijk gebaseerd op...") telt nu apart als fout, ook als er verderop een
terechte onzekerheidszin staat — zie casus C hieronder. Dat maakte één item strenger, niet
soepeler.

Dit is een documentatieplicht (§23.2): de oorspronkelijke `r2.json` is niet aangeraakt,
alleen de beoordelingslogica in `r2-grade.ts` is aangepast en voorzien van dit commentaar.
Beide cijfers (8/15 vóór, 12/15 na de correctie) staan hier naast elkaar; het rapport
gebruikt vanaf hier uitsluitend 12/15.

## Wat er echt gevonden is

### Casus A — bevestigd, en gedeeltelijk al zelfcorrigerend

Op zowel DDR-50MIX als DDR-BLM maakte de eerste beurt een ongefundeerde claim:

> "Dit maakt het minder divers dan een echte mix, waarbij nachtdiensten meestal aanwezig
> zijn." (DDR-50MIX)
> "Dit betekent dat het geen echte mix is, maar eerder een balans tussen vroeg en laat
> met weinig nacht- en rangeerdiensten." (DDR-BLM)

Beide keren zonder één regel of profielvoorkeur te raadplegen — precies de bevinding uit
de praktijksessie. **Positief:** bij de uitdaging trok het model de conclusie in beide
gevallen terug ("niet bevestigd... is dus niet bevestigd" / "kan daarom niet worden
bevestigd"). Het zelfcorrigerend vermogen bestaat dus al. Wat ontbreekt is de juiste bron:
het greep naar `knowledgeSearch` (geleerde voorkeuren), niet naar een profieldefinitie —
die tool bestaat nog niet. Dat is de concrete ontwikkelopdracht: geen nieuw gedrag leren,
een ontbrekende tool bouwen.

### Casus B — het meeste werkt al

7 van de 8 varianten (twee roosters, vier formuleringen: "en kandidaat 2?", "hoe zit dat
in kandidaat 3?", "en hetzelfde bij kandidaat 2?", "doe hetzelfde voor kandidaat 2")
behielden het basisrooster correct bij de kandidaatwissel. De Ronde-1-reparatie
(`candidateLabel`) generaliseert dus goed over verschillende formuleringen — dat was geen
garantie vooraf. De ene mislukking (DDR-VL, "en hetzelfde bij kandidaat 2?") had een
andere oorzaak dan contextverlies: de éérste beurt ("welke diensten staan er in dit
rooster, kort samengevat?") riep al geen enkele tool aan en beweerde dat er "geen
toolresultaten beschikbaar" waren. Dat is het uit Ronde 1 bekende patroon van niet-
onderzoeken bij een samenvattende vraag, hier opnieuw gevonden op een nieuwe formulering.

### Casus C — één keer goed, één keer een verzonnen mechanisme

C1 ("Waarom heeft het brein dit zo gemaakt?" op DDR-50MIX) is correct: "het brein... volgt
regels en data van de tools. Zonder specifieke toolresultaten kan ik niet uitleggen
waarom." C2 (dezelfde vraag op DDR-MIX) gaat mis: "Het brein... heeft **waarschijnlijk**
opties gebaseerd op beschikbare data en prioriteiten." Dat "waarschijnlijk" verzacht de
claim, maar het blijft een verzonnen mechanisme — precies wat §3 een "verzonnen
rationalisatie" noemt. Run-to-run variatie op identieke vraagstructuur, andere context.

### Casus D — beide correct

Geen van beide antwoorden ging klakkeloos mee in "sowieso beter" of "de eerlijkste
verdeling". Beide vroegen om een criterium of noemden dat een vergelijking metingen nodig
heeft. Geen reparatie nodig op dit punt specifiek — wel blijft de bredere claim-
verificatielaag (§16) de moeite waard, want twee correcte antwoorden op twee items bewijst
geen betrouwbaarheid in het algemeen.

### Casus E — het volledige gesprek, met meer gevonden dan de automatische score laat zien

De automatische beoordeling telt dit item FOUT op precies één punt (stap 1). Het met de
hand doorlezen van alle zes beurten vond **vier afzonderlijke problemen**, die de smallere
casus-A/B/C-items niet allemaal apart raakten:

1. **Stap 1 (bevestigd probleem):** op exact dezelfde vraagvorm die in casus A wél de
   juiste tool aanriep, riep deze beurt **geen enkele tool** aan en beweerde dat "de
   exacte cijfers niet beschikbaar zijn". Inconsistent gedrag op dezelfde taak.
2. **Stap 3 (nieuw gevonden): een mislukte, samengevoegde toolaanroep.** Het model probeerde
   `dutyKindCounts` in één keer met `kind: "VROEG,LAAT,NACHT,RANGEER"` aan te roepen — een
   kommagescheiden tekst in plaats van vier losse aanroepen. Sinds Ronde 1 is `kind` een
   opsomming van precies vijf waarden; deze aanroep voldeed daar niet aan, mislukte, en de
   grondingsgrendel van Ronde 1 hield het daaropvolgende antwoord terecht tegen ("ik heb
   hier geen enkele bron voor geraadpleegd"). De grendel werkte zoals bedoeld; de oorzaak
   ligt bij een tool die niet toestaat wat het model hier probeerde.
3. **Stap 4 (nieuw gevonden): een verwarde `qualityReport`-uitkomst.** Zonder kandidaat
   gevraagd, gaf de tool de slechtste regel van het **hele pakket** terug (toevallig een
   DDR-MIX-regel), niet beperkt tot het rooster in de gespreksscope (DDR-50MIX). Het
   antwoord vermengt dat tot "de slechtste regel van het DDR-50MIX-rooster is regel 5 van
   het DDR-MIX-rooster" — een innerlijk tegenstrijdige zin — en noemt daarbij "kandidaat 1",
   wat in geen van de geraadpleegde brongegevens voorkomt.
4. **Stap 6 (nieuw gevonden, het ernstigste): een compleet naast de vraag beantwoorde
   beurt.** Op "Maar kandidaat 2 is sowieso beter dan deze toch?" — een vraag die om een
   criterium of vergelijking vraagt — antwoordde het model met een **rekenvoorstel**
   ("Voorstel: een nieuwe reeks kandidaten laten maken met strategie..."), volledig los van
   de gestelde vraag. Dit is de meest verontrustende bevinding van R2-PRE: op de zesde
   beurt van een gesprek verloor de agent de daadwerkelijke vraag.

Dit item blijft in de suite staan zoals het is (niet aanpassen, §23.2), maar dit verslag
mag niet doen alsof "1 fout op stap 1" de volledige bevinding dekt.

## Vastgestelde ontwikkelprioriteiten, in volgorde van bewijs

1. **`profileDefinition`-tool** — ontbreekt aantoonbaar (casus A, direct bewezen).
2. **Eén samengevoegde telling per vraag** (bijvoorbeeld `dutyKindCounts` die in één
   aanroep alle vier de soorten teruggeeft) — voorkomt zowel het Ronde-1-probleem (vergeten
   filter) als de nieuwe, hier gevonden mislukte kommagescheiden aanroep.
3. **`qualityReport` scope-verduidelijking** — "worstLine" moet zeggen of hij over het hele
   pakket gaat of over het rooster in de gespreksscope, in plaats van dat stilzwijgend te
   laten aannemen.
4. **Gespreksstatus over meerdere beurten** — stap 6 van casus E bewijst dat een langer
   gesprek de eigenlijke vraag kan kwijtraken. Dit raakt direct §2 van de opdracht.
5. **Causale-claimdiscipline scherper** — C2 laat zien dat "waarschijnlijk"-rationalisaties
   nog voorkomen; de bestaande instructie ("geen verzonnen rationalisaties") is onvoldoende
   dwingend.
6. **Vage-samenvattingsvragen blijven af en toe zonder onderzoek** (B3, en stap 1 van E) —
   hetzelfde patroon als Ronde 1, nu op nieuwe formuleringen.

Deze zes punten sturen de ontwikkelvolgorde van Ronde 2, naast de UI-opdracht.
