# Beeldmerk

Zet het door NS aangeleverde logobestand hier neer. De applicatie pakt het
daarna vanzelf op — sidebar, aanmeldscherm, alle vier de omgevingen en de
printsjablonen gebruiken hetzelfde component (`src/components/ui/ns-logo.tsx`).

| Bestandsnaam | Gebruikt op |
|---|---|
| `ns-logo.svg` (of `.png`) | lichte achtergronden: aanmeldscherm, kaarten, export |
| `ns-logo-wit.svg` (of `.png`) | donkere achtergronden: de blauwe zijbalk |

Staat de witte variant er niet, dan wordt de gewone gebruikt.

## Wat er niet gebeurt

Het bestand wordt niet bijgesneden, omgekleurd of vervormd. De hoogte wordt
gezet, de breedte volgt uit de verhoudingen van het bestand zelf.

Zolang hier niets staat, toont de applicatie een neutrale vorm die
uitdrukkelijk geen NS-beeldmerk is, en meldt het beheerscherm dat de asset
ontbreekt. Er wordt nooit een logo nagetekend: iets dat op het echte lijkt en
het niet is, is in een roosterexport het verkeerde antwoord.
