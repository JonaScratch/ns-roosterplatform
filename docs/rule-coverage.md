# Regeldekking

Dit bestand wordt gegenereerd door `npm run docs:regeldekking`. Niet met de hand
bijwerken: een dekkingstabel die je zelf bijhoudt, is precies één keer waar.

Gemeten op 2026-09-06.

## Samenvatting

| Status | Betekenis | Aantal |
| --- | --- | --- |
| SOURCE_PRESENT | de bron is aangeleverd en leesbaar | 66 / 71 |
| TRANSCRIBED | de regel staat in het regelbestand | 71 / 71 |
| IMPLEMENTED | de engine kan deze regel laten afgaan | 71 / 71 |
| TESTED | een test noemt deze regel bij naam | 26 / 71 |
| FORMALLY_VALIDATED | NS heeft waarde en lezing bevestigd | 0 / 71 |

## Wat deze cijfers niet zeggen

`FORMALLY_VALIDATED` staat op nul en dat is geen tekortkoming van de bouw. Het
betekent dat niemand bij NS heeft bevestigd dat deze waarden de juiste zijn. Zolang
dat zo is, mag nergens in dit platform staan dat de regels compleet of juist zijn,
en blijft `Production-safe: NO` staan.

`IMPLEMENTED` betekent dat de regel-id in de code van de engine voorkomt — er is dus
iets dat hem kan laten afgaan. Het betekent niet dat de bijbehorende berekening
klopt. Daarvoor is `TESTED` nodig, en daar zit het gat.

45 van de 71 regels worden door geen enkele test bij naam genoemd. Die
regels kunnen stilletjes verkeerd rekenen zonder dat er iets rood wordt. Ze staan
hieronder met `nee` in de kolom Getest.

## De bronnen

| Bron | Staat er | Leesbaar | Gevolg |
| --- | --- | --- | --- |
| NS CAO 2024-2025.pdf | ja | ja | 175 artikelen; verwijzingen zijn te controleren |
| Roosterkaders Regio West 2026 ondertekend (1).pdf | ja | nee | scan zonder tekstlaag: `SOURCE_PRESENT_NOT_MACHINE_READABLE` |
| Arbeidstijdenwet | nee | — | `BLOCKED_BY_MISSING_SOURCE`; niet gereconstrueerd |
| Arbeidstijdenbesluit vervoer | nee | — | `BLOCKED_BY_MISSING_SOURCE`; niet gereconstrueerd |

## Per regel

De kolom **Waarde in artikel** zegt of het getal van de regel voorkomt in de tekst
van het artikel waar de regel naar verwijst. `nee` is geen bewijs dat de regel fout
is — het is een plek om te kijken. `ja` is evenmin bewijs dat hij goed is: het getal
staat er, meer niet.

| Regel | Laag | Artikel | Waarde | Bron | Overgenomen | Geïmplementeerd | Getest | Waarde in artikel | Formeel gevalideerd |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `RP_MAX_WORK_PER_DUTY`<br>Maximale arbeidstijd per dienst | CAO | 98<br>Dagelijkse arbeids- en rusttijd | 9 HOURS | ja | ja | ja | nee | ja | nee |
| `RP_MAX_WORK_INCL_OVERTIME`<br>Maximale arbeidstijd per dienst inclusief overwerk | CAO | 98<br>Dagelijkse arbeids- en rusttijd | 12 HOURS | ja | ja | ja | nee | ja | nee |
| `RP_MAX_WORK_START_0500_0600`<br>Maximale arbeidstijd bij start tussen 05:00 en 06:00 | CAO | 98<br>Dagelijkse arbeids- en rusttijd | 8 HOURS | ja | ja | ja | nee | ja | nee |
| `RP_STATION_BREAK_ADJUSTMENT`<br>Standplaatsafhankelijke verlaging bij werkonderbreking > 30 minuten | CAO | 98<br>Dagelijkse arbeids- en rusttijd | niet aangeleverd | ja | ja | ja | ja | — | nee |
| `MIN_WORK_PER_DUTY`<br>Minimale arbeidstijd per dienst | CAO | 98<br>Dagelijkse arbeids- en rusttijd | 4 HOURS | ja | ja | ja | nee | ja | nee |
| `RP_MAX_DUTY_DURATION`<br>Maximale dienstlengte rijdend personeel | CAO | 98<br>Dagelijkse arbeids- en rusttijd | 9.5 HOURS | ja | ja | ja | ja | ja | nee |
| `RP_MAX_DUTY_START_0400_0501`<br>Maximale dienstlengte bij start tussen 04:00 en 05:01 | CAO | 98<br>Dagelijkse arbeids- en rusttijd | 7 HOURS | ja | ja | ja | ja | ja | nee |
| `RP_MAX_DUTY_START_0500_0600`<br>Maximale dienstlengte bij start tussen 05:00 en 06:00 | CAO | 98<br>Dagelijkse arbeids- en rusttijd | 8.5 HOURS | ja | ja | ja | ja | ja | nee |
| `RP_MIN_DUTY_DURATION`<br>Minimale dienstlengte rijdend personeel | CAO | 98<br>Dagelijkse arbeids- en rusttijd | 6 HOURS | ja | ja | ja | nee | ja | nee |
| `RP_DAILY_REST_PLANNED`<br>Dagelijkse onafgebroken rust (gepland) | CAO | 98<br>Dagelijkse arbeids- en rusttijd | 12 HOURS | ja | ja | ja | ja | ja | nee |
| `DAILY_REST_REDUCED_NON_PLANNED`<br>Verkorte dagelijkse rust, niet planmatig | CAO | 98<br>Dagelijkse arbeids- en rusttijd | 8 HOURS | ja | ja | ja | ja | ja | nee |
| `BREAK_OVER_5H30`<br>Pauze bij meer dan 5,5 uur arbeidstijd | CAO | 98<br>Dagelijkse arbeids- en rusttijd | 30 MINUTES | ja | ja | ja | nee | ja | nee |
| `BREAK_OVER_10H`<br>Pauze bij meer dan 10 uur arbeidstijd | CAO | 98<br>Dagelijkse arbeids- en rusttijd | 45 MINUTES | ja | ja | ja | nee | nee | nee |
| `RP_LOCATION_WORK_INTERRUPTION`<br>Standplaatsafhankelijke werkonderbreking rijdend personeel | CAO | 98<br>Dagelijkse arbeids- en rusttijd | niet aangeleverd | ja | ja | ja | ja | — | nee |
| `MAX_WEEKLY_HOURS`<br>Maximale arbeidstijd per week | CAO | 99<br>Wekelijkse arbeids- en rusttijd | 60 HOURS | ja | ja | ja | ja | ja | nee |
| `AVG_WEEKLY_HOURS_4W`<br>Gemiddelde arbeidstijd over 4 weken | CAO | 99<br>Wekelijkse arbeids- en rusttijd | 55 HOURS | ja | ja | ja | nee | ja | nee |
| `AVG_WEEKLY_HOURS_16W`<br>Gemiddelde arbeidstijd over 16 weken | CAO | 99<br>Wekelijkse arbeids- en rusttijd | 48 HOURS | ja | ja | ja | nee | ja | nee |
| `AVG_WEEKLY_HOURS_16W_MANY_NIGHTS`<br>Gemiddelde arbeidstijd over 16 weken bij veel nachtdiensten | CAO | 101<br>Aanvullende regels bij nachtdienst | 40 HOURS | ja | ja | ja | nee | ja | nee |
| `MANY_NIGHTS_THRESHOLD`<br>Drempel 'veel nachtdiensten' | CAO | 101<br>Aanvullende regels bij nachtdienst | 16 COUNT | ja | ja | ja | nee | ja | nee |
| `WEEKLY_REST_36H_PER_7D`<br>Wekelijkse onafgebroken rust per 7×24 uur | CAO | 100<br>Maximum aantal diensten | 36 HOURS | ja | ja | ja | ja | nee | nee |
| `WEEKLY_REST_72H_PER_14D`<br>Wekelijkse onafgebroken rust per 14×24 uur | CAO | 100<br>Maximum aantal diensten | 72 HOURS | ja | ja | ja | ja | nee | nee |
| `WEEKLY_REST_SPLIT_MIN`<br>Minimale duur van een deel bij gesplitste wekelijkse rust | CAO | 100<br>Maximum aantal diensten | 32 HOURS | ja | ja | ja | nee | ja | nee |
| `RC_SHORTENED_WEEKLY_REST_MIN`<br>Verkorte wekelijkse rust op initiatief van de roostercommissie | CAO | 100<br>Maximum aantal diensten | 32 HOURS | ja | ja | ja | nee | ja | nee |
| `RC_SHORTENED_WEEKLY_REST_INTERVAL_WEEKS`<br>Interval voor verkorte wekelijkse rust | CAO | 100<br>Maximum aantal diensten | 5 COUNT | ja | ja | ja | nee | nee | nee |
| `R_DAY_ATTACHED_MIN`<br>Rustdag aansluitend op een dienst | CAO | 100<br>Maximum aantal diensten | 30 HOURS | ja | ja | ja | nee | ja | nee |
| `R_DAY_DETACHED_MIN`<br>Rustdag niet aansluitend op een dienst | CAO | 100<br>Maximum aantal diensten | 24 HOURS | ja | ja | ja | nee | ja | nee |
| `R_DAYS_PER_WEEK_AVG`<br>Geplande rusttijden van langere duur per week | CAO | 100<br>Maximum aantal diensten | 2 COUNT | ja | ja | ja | ja | ja | nee |
| `RT_PREFERRED_WINDOW_WEEKS`<br>Termijn voor het verlenen van een rustdag terug | CAO | 100<br>Maximum aantal diensten | 2 COUNT | ja | ja | ja | nee | ja | nee |
| `MAX_CONSECUTIVE_SERVICES`<br>Maximaal aantal aaneengesloten diensten | CAO | 100<br>Maximum aantal diensten | 7 COUNT | ja | ja | ja | ja | ja | nee |
| `MAX_CONSECUTIVE_IN_NIGHT_SEQUENCE`<br>Maximaal aantal diensten in een reeks met nachtdiensten | CAO | 101<br>Aanvullende regels bij nachtdienst | 7 COUNT | ja | ja | ja | nee | ja | nee |
| `NIGHT_REST_AFTER_0200`<br>Rust na een nachtdienst die eindigt na 02:00 | CAO | 101<br>Aanvullende regels bij nachtdienst | 14 HOURS | ja | ja | ja | ja | ja | nee |
| `NIGHT_SEQUENCE_RECOVERY`<br>Rust na een reeks van drie of meer nachtdiensten | CAO | 101<br>Aanvullende regels bij nachtdienst | 46 HOURS | ja | ja | ja | ja | ja | nee |
| `NIGHT_SEQUENCE_RECOVERY_THRESHOLD`<br>Reekslengte waarboven herstelrust geldt | CAO | 101<br>Aanvullende regels bij nachtdienst | 3 COUNT | ja | ja | ja | nee | ja | nee |
| `MAX_NIGHT_SERVICES_16W`<br>Maximaal aantal nachtdiensten per 16 weken | CAO | 101<br>Aanvullende regels bij nachtdienst | 36 COUNT | ja | ja | ja | nee | ja | nee |
| `NIGHT_MAX_WORK`<br>Maximale arbeidstijd nachtdienst | CAO | 101<br>Aanvullende regels bij nachtdienst | 8.5 HOURS | ja | ja | ja | nee | ja | nee |
| `NIGHT_MAX_WORK_INCL_OVERTIME`<br>Maximale arbeidstijd nachtdienst inclusief overwerk | CAO | 101<br>Aanvullende regels bij nachtdienst | 10 HOURS | ja | ja | ja | nee | ja | nee |
| `NIGHT_MAX_DUTY_DURATION`<br>Maximale dienstlengte nachtdienst | CAO | 101<br>Aanvullende regels bij nachtdienst | 9 HOURS | ja | ja | ja | ja | ja | nee |
| `RP_NIGHT_START_0400_0501_MAX_WORK`<br>Nachtdienst met start 04:00–05:01: maximale arbeidstijd | CAO | 101<br>Aanvullende regels bij nachtdienst | 6.5 HOURS | ja | ja | ja | nee | ja | nee |
| `RP_NIGHT_START_0400_0501_MAX_DUTY`<br>Nachtdienst met start 04:00–05:01: maximale dienstlengte | CAO | 101<br>Aanvullende regels bij nachtdienst | 7 HOURS | ja | ja | ja | nee | ja | nee |
| `RP_NIGHT_ACROSS_0230_MAX_WORK`<br>Dienst die start vóór 02:30 en eindigt na 02:30: maximale arbeidstijd | CAO | 101<br>Aanvullende regels bij nachtdienst | 8 HOURS | ja | ja | ja | nee | ja | nee |
| `RP_NIGHT_ACROSS_0230_MAX_DUTY`<br>Dienst die start vóór 02:30 en eindigt na 02:30: maximale dienstlengte | CAO | 101<br>Aanvullende regels bij nachtdienst | 8.5 HOURS | ja | ja | ja | nee | ja | nee |
| `RP_HARD_NIGHT_LATEST_END`<br>Harde nachtdienst mag niet na 07:00 eindigen | CAO | 101<br>Aanvullende regels bij nachtdienst | 420 MINUTES | ja | ja | ja | nee | ja | nee |
| `RP_MAX_EARLY_STARTS_0500_0600_PER_4W`<br>Maximaal aantal starts tussen 05:00 en 06:00 per 4 weken | CAO | 98<br>Dagelijkse arbeids- en rusttijd | 10 COUNT | ja | ja | ja | ja | ja | nee |
| `RP_MAX_LONG_DUTIES_PER_YEAR`<br>Maximaal aantal lange diensten per kalenderjaar | CAO | 98<br>Dagelijkse arbeids- en rusttijd | 12 COUNT | ja | ja | ja | nee | ja | nee |
| `RP_LONG_DUTY_THRESHOLD`<br>Drempel voor een lange dienst | CAO | 98<br>Dagelijkse arbeids- en rusttijd | 9 HOURS | ja | ja | ja | nee | ja | nee |
| `AGE55_VERY_EARLY_EXEMPTION`<br>Vrijstelling zeer vroege start vanaf 55 jaar | CAO | 98<br>Dagelijkse arbeids- en rusttijd | niet aangeleverd | ja | ja | ja | nee | — | nee |
| `AGE50_HARD_NIGHT_EXEMPTION`<br>Vrijstelling harde nachtdienst vanaf 50 jaar | CAO | 101<br>Aanvullende regels bij nachtdienst | 1 NONE | ja | ja | ja | nee | ja | nee |
| `INDIVIDUAL_SCHEDULING_RESTRICTION`<br>Individuele arbeidstijdbeperking | CAO | 98<br>Dagelijkse arbeids- en rusttijd | 1 NONE | ja | ja | ja | nee | ja | nee |
| `RED_WEEKEND_MIN_REST`<br>Driewekelijks vrij weekend (rood weekend) | CAO | 102<br>Zondagsarbeid | 60 HOURS | ja | ja | ja | ja | ja | nee |
| `RED_WEEKEND_INTERVAL_WEEKS`<br>Interval van het vrije weekend | CAO | 102<br>Zondagsarbeid | 3 COUNT | ja | ja | ja | ja | ja | nee |
| `MIN_FREE_SUNDAYS_52W`<br>Minimaal aantal vrije zondagen per 52 weken | CAO | 100<br>Maximum aantal diensten | 13 COUNT | ja | ja | ja | nee | nee | nee |
| `HOLIDAY_ATTACHED_MIN`<br>Vrije feestdag aansluitend op een dienst | CAO | 104<br>Bereikbaarheidsdienst | 30 HOURS | ja | ja | ja | nee | ja | nee |
| `HOLIDAY_DETACHED_MIN`<br>Vrije feestdag niet aansluitend op een dienst | CAO | 104<br>Bereikbaarheidsdienst | 24 HOURS | ja | ja | ja | nee | ja | nee |
| `RO_DVP_DETACHED_MIN`<br>Losstaande RO- of DvP-dag | CAO | 100<br>Maximum aantal diensten | 30 HOURS | ja | ja | ja | nee | ja | nee |
| `RO_DVP_COMBINED_MIN`<br>RO- of DvP-dag in combinatie met een andere vrijetijdsaanspraak | CAO | 100<br>Maximum aantal diensten | 24 HOURS | ja | ja | ja | nee | ja | nee |
| `PARTTIME_DASH_DAY_MIN`<br>Streepjesdag deeltijder | CAO | 100<br>Maximum aantal diensten | 30 HOURS | ja | ja | ja | nee | ja | nee |
| `WTV_DAY_LATEST_START`<br>Uiterste aanvang van een hele WTV-dag | CAO | 97<br>Algemene bepalingen | 120 MINUTES | ja | ja | ja | nee | ja | nee |
| `WTV_DAYS_PER_YEAR_36H`<br>WTV-dagen per jaar bij een 36-urige werkweek | CAO | 97<br>Algemene bepalingen | 26 COUNT | ja | ja | ja | nee | nee | nee |
| `WITHDRAWN_WTV_GRANT_WITHIN_DAYS`<br>Termijn voor het opnieuw verlenen van een ingetrokken WTV-dag | CAO | 97<br>Algemene bepalingen | 14 COUNT | ja | ja | ja | nee | nee | nee |
| `REGIO_WEST_WEEKEND_TARGET`<br>Weekendbalans Regio West | REGIONAL | Weekendbalans | niet aangeleverd | nee | ja | ja | nee | — | nee |
| `DORDRECHT_ROSTER_LINE_DIVISOR`<br>Aantal roosterlijnen deelbaar door | LOCAL | Roostergrootte | 2 COUNT | nee | ja | ja | ja | — | nee |
| `REGIO_WEST_WTV_INTERVAL_WEEKS`<br>WTV-dag gemiddeld eens per aantal weken | REGIONAL | WTV | 2 COUNT | nee | ja | ja | nee | — | nee |
| `NEW_DRIVER_PROTECTION_YEARS`<br>Beschermde periode nieuwe machinisten | REGIONAL | Nieuwe machinisten | 2 COUNT | nee | ja | ja | nee | — | nee |
| `PLAN_ROSTER_OVERFLOW_LIMIT`<br>Diensten die in een planrooster mogen belanden | REGIONAL | Planrooster | niet aangeleverd | nee | ja | ja | nee | — | nee |
| `ROSTER_ANCHOR_LOCKED`<br>Structureel anker vastgelegd bij een wijzigingsblad | PRODUCT_POLICY | Roosterstructuur | 1 NONE | ja | ja | ja | ja | — | nee |
| `RESERVE_BASE_WITHOUT_DUTIES`<br>Reservebasisrooster bevat geen dienstnummers | PRODUCT_POLICY | Reserverooster | 1 NONE | ja | ja | ja | ja | — | nee |
| `ROSTER_PROFILE_BOUNDS`<br>Grenzen van het roosterprofiel | PRODUCT_POLICY | Roosterprofielen | 1 NONE | ja | ja | ja | ja | — | nee |
| `DEPOT_MATCH`<br>Standplaats | PRODUCT_POLICY | Standplaats | 1 NONE | ja | ja | ja | ja | — | nee |
| `DAY_AVAILABLE`<br>Dag beschikbaar | PRODUCT_POLICY | Roosterposities | 1 NONE | ja | ja | ja | ja | — | nee |
| `QUALIFICATIONS_REQUIRED`<br>Vereiste bevoegdheden | PRODUCT_POLICY | Bevoegdheden | 1 NONE | ja | ja | ja | ja | — | nee |
| `MIX_PROFILE_SPECIAL_RULES`<br>Bijzondere regels Mix, 50+ Mix en BLM | PRODUCT_POLICY | Roosterprofielen | niet aangeleverd | ja | ja | ja | ja | — | nee |

## Regelpakketten die helemaal ontbreken

Deze staan niet als regel in de tabel hierboven, want er is niets om over te nemen.

### ATW_VALIDATED_RULESET

**Arbeidstijdenwet, gevalideerd regelpakket** — De aangeleverde bron is de CAO. De CAO bepaalt zelf dat een werktijdregeling ook aan de Arbeidstijdenwet moet voldoen. De actuele wettekst en de bijbehorende grenswaarden zijn niet aangeleverd en worden niet gereconstrueerd.

Hierdoor kan niet veilig worden vastgesteld:

- PUBLICATION
- PRODUCTION_MODE

### ATB_VALIDATED_RULESET

**Arbeidstijdenbesluit vervoer, gevalideerd regelpakket** — Voor spoorwegpersoneel gelden aanvullende bepalingen uit het Arbeidstijdenbesluit vervoer. Niet aangeleverd.

Hierdoor kan niet veilig worden vastgesteld:

- PUBLICATION
- PRODUCTION_MODE

### CAO_CURRENCY_CONFIRMATION

**Bevestiging welke CAO actueel is** — De aangeleverde CAO heet 2024–2025. Voor planning in 2026 moet NS bevestigen welke CAO, nawerking of nieuwe afspraken gelden.

Hierdoor kan niet veilig worden vastgesteld:

- PRODUCTION_MODE

### QUALIFICATION_MATRIX

**Kwalificatiematrix** — Welke baanvakken, materieelsoorten, bevoegdheden en lokale kennis een dienst vereist, en welke een medewerker heeft, komt uit een bronsysteem dat niet is aangesloten.

Hierdoor kan niet veilig worden vastgesteld:

- PUBLICATION
- PRODUCTION_MODE

### DORDRECHT_BREAK_PARAMETER

**Werkonderbreking en arbeidstijdcorrectie voor deze standplaats** — De CAO legt de duur van de werkonderbreking en de daaraan gekoppelde verlaging van de maximale arbeidstijd per standplaats vast. Die waarden zijn niet aangeleverd.

Hierdoor kan niet veilig worden vastgesteld:

- DUTY_WITH_LONG_BREAK

### REGIO_WEST_WEEKEND_TARGET_DEFINITION

**Definitie van de weekendmaatstaf Regio West** — Het kader noemt 'zoveel als mogelijk 50% weekenden' zonder wiskundige definitie.

Hierdoor kan niet veilig worden vastgesteld:

- WEEKEND_TARGET_OPTIMIZATION

### MIX_BLM_50PLUS_PROFILE_RULES

**Bijzondere regels Mix, BLM en 50+ Mix** — Niet formeel vastgelegd.

Hierdoor kan niet veilig worden vastgesteld:

- MIX_PROFILE_PLACEMENT

### INDIVIDUAL_RESTRICTIONS_SOURCE

**Bron voor individuele arbeidstijdbeperkingen** — Individuele beperkingen moeten uit een geautoriseerd HR-systeem komen. Er is geen koppeling; de engine kan daarom niet weten of een medewerker een beschermde beperking heeft.

Hierdoor kan niet veilig worden vastgesteld:

- PUBLICATION
- PRODUCTION_MODE

### EMPLOYEE_CONTRACT_HOURS

**Contractomvang per medewerker** — Urennormen zijn niet te berekenen zonder de individuele contractomvang. Er wordt geen 36 of 40 uur aangenomen.

Hierdoor kan niet veilig worden vastgesteld:

- WEEKLY_HOURS_VALIDATION

### WR_CO_DEFINITION

**Betekenis en regels van de roosterposities WR en CO** — Komen voor in bestaande roosters; hun regels zijn niet aangeleverd.

Hierdoor kan niet veilig worden vastgesteld:

- WR_CO_PLACEMENT

