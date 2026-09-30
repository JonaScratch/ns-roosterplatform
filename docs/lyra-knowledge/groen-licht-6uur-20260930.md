# Groen licht 6-uurs Development Run — 20260930

Besluit na `adversarial-20260930-mn4-r1..r3` (commit `3d107db`, gemeten op
`f1f7b90`). `LYRA_DEMO_ROOM_AUTONOMOUS_PROGRAM_COMPLETE` blijft **niet gezet**
tot een echte lange run een `LONG-RUN-VERIFICATION.json` met `PASS` heeft.

## Gecontroleerd uit de drie `traces.json`

| | r1 | r2 | r3 |
|---|---|---|---|
| gemeten commit (omgeving) | f1f7b90 | f1f7b90 | f1f7b90 |
| release / agentniveau | NO_RELEASE / B | idem | idem |
| K N P Q R S T U | GOED, KENNISBEREIK = NVT | idem | idem |
| M | GOED, KENNISBEREIK = **APPEND** | idem | idem |

- **M via de bedoelde generieke route, niet door modeltoeval.** Plan: voorstel
  weg, ONDERZOEK_VOOR_OORDEEL → `knowledgeSearch`; compose-pad `model`. De
  modeltekst is in alle drie letterlijk de tekst die eerder ONBEOORDEELD was
  (de grens ontbreekt erin). Het oordeel GOED komt uit de door het platform
  toegevoegde zinnen (afwezigheid + standplaatsgrens), bewijs van de grader:
  "andere standplaats wordt hier niet".
- **Geen onterechte aanvulling.** K gebruikte óók `knowledgeSearch` (0 items)
  maar kreeg terecht niets: geen kennisvraag, geen andere standplaats genoemd.
  N, P–U deden geen kennisopzoeking.
- **Grader ongewijzigd**: `scripts/v106/adversarial-grade.ts` is sinds `3e68f06`
  (alleen bewijs-instrumentatie, oordelen aantoonbaar gelijk) niet aangeraakt;
  schema `ns-lyra-adversarial-grade/2`. Geen itemherkenning, geen benchmark-only
  pad in `kennis-bereik.ts`; holdout-lektest groen.
- **Kern/extensie-baseline**: door constructie onaangetast — geen enkel
  modelverzoek verandert, en in alle zes opgeslagen replicaten krijgt geen
  enkele kern- of extensiebeurt een bereikzin (toets); met de echte keten en
  een deterministisch nepmodel byte-gelijk vóór/na. Niet opnieuw gemeten met
  qwen3:8b na `f1f7b90`: bewezen, niet hermeten.
- Rest-nondeterminisme zichtbaar: U koos per run andere tools (steeds GOED).

## Stopvoorwaarden (masterprompt) — status

kern 43/43 ×3, strict/agreement 100 %, fabricatie 0/46 ×3, L 15/15, O 7/7
(laatste meting 021137, door constructie behouden); adversarial K M N P Q R S
T U 3/3 GOED (mn4). → groen licht voor de echte 6-uursrun.
