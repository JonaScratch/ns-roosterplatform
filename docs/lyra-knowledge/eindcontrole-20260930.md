# Eindcontrole masterprompt — 20260930

Run `DR-UI-20260930165141-d5a8`: profiel 6h (360 actieve min), gestopt na
**131,5 actieve minuten** met `DONE · ALLES_GEPROBEERD`; 16 gemeten cycli
(alle 11 stappen, judge/2, echt qwen3:8b, 16× REJECT), productie onaangeroerd,
`LONG-RUN-VERIFICATION.json = PASS`. Dit is **geen** zes uur autonome werking.

## Wat de masterprompt vraagt (letterlijk)

- "24h run is not done when: a timer runs for 24 hours. It is done when: the
  system continually executes meaningful learning/development cycles **for the
  budgeted period** and persists the evidence."
- §55 Prevent looping / local optima — bij "same hypothesis repeatedly
  failing", "no improvement for N cycles", "candidate diversity collapsing":
  "Respond by: changing strategy; widening hypothesis search; generating new
  unseen tests; switching specialist; stopping that branch; escalating to
  Claude/human if a new capability is required."

De masterprompt eist dus geen zes klokuren, maar wel dat het gebudgetteerde
tijdvak met betekenisvolle leercycli gevuld wordt. Een vroege stop wegens
uitputting staat er niet in als voltooiing; het voorgeschreven antwoord op
uitputting is de zoekruimte verbreden (of escaleren), niet de run beëindigen.
`ALLES_GEPROBEERD` als geldige eindstatus is een ontwerpkeuze van de
implementatie en een criterium van `verify-long-run.ts` — niet van de
masterprompt. De verifier controleert niet of het budget benut is.

## Conclusie

**Eén blocker; eindmarker niet gezet.** De lange run vulde 131,5 van 360
minuten, omdat de hypotheseruimte vast is (3 strategieën × 6 gemeten
zwaktes = 16 open paren bij de start) en de run die ruimte bij uitputting niet
verbreedt (§55) maar stopt. Geen lokale blocker: een capaciteit in de code
(uitputting → verbreden: nieuwe kandidaatfamilies/hypothesen, nieuw
gegenereerde tests), plus een verifiercontrole op benutting van het
budget. Niet gestart: buiten de gevraagde formele afronding.

Overige eindvoorwaarden gecontroleerd en in orde: graders ongewijzigd sinds
`3e68f06`; holdout-lektest groen; kern/extensie-non-regressie, grader-bewijs,
kennisbereik, lange-run- en verifiertests groen (50/50); run op ongewijzigde
src/scripts; geen versie aangemaakt of geactiveerd.
