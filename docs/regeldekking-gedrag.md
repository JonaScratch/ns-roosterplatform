# Regeldekking op gedrag

Automatisch gemaakt door `npm run verify:rule-coverage`. Niet met de hand bijwerken:
dit bestand wordt bij elke meting overschreven.

Een regel telt hier pas als getoetst wanneer een test zijn gedrag vastlegt —
niet wanneer zijn naam ergens voorkomt. Twee richtingen:

- **gaat af**: er is een situatie die de regel hoort af te keuren, en die wordt afgekeurd.
- **gaat niet af**: er is een situatie die mag, en die wordt niet afgekeurd.

| Regel | Soort | Status | In engine | Gaat af | Gaat niet af | Bron |
| --- | --- | --- | --- | --- | --- | --- |
| `AGE50_HARD_NIGHT_EXEMPTION` | hard | actief | ja | ja | ja | art. 101 |
| `AGE55_VERY_EARLY_EXEMPTION` | hard | blokkeert | ja | — | — | art. 98 |
| `AVG_WEEKLY_HOURS_16W` | hard | actief | ja | ja | ja | art. 99 |
| `AVG_WEEKLY_HOURS_16W_MANY_NIGHTS` | hard | actief | ja | — | — | art. 101 |
| `AVG_WEEKLY_HOURS_4W` | hard | actief | ja | ja | ja | art. 99 |
| `BREAK_OVER_10H` | hard | actief | ja | ja | ja | art. 98 |
| `BREAK_OVER_5H30` | hard | actief | ja | ja | ja | art. 98 |
| `DAILY_REST_REDUCED_NON_PLANNED` | hard | actief | ja | — | ja | art. 98 |
| `DAY_AVAILABLE` | hard | actief | ja | ja | ja | art. Roosterposities |
| `DEPOT_MATCH` | hard | actief | ja | ja | ja | art. Standplaats |
| `DORDRECHT_ROSTER_LINE_DIVISOR` | hard | actief | — | — | — | art. Roostergrootte |
| `HOLIDAY_ATTACHED_MIN` | hard | actief | — | — | — | art. 104 |
| `HOLIDAY_DETACHED_MIN` | hard | actief | — | — | — | art. 104 |
| `INDIVIDUAL_SCHEDULING_RESTRICTION` | hard | actief | ja | ja | ja | art. 98 |
| `MANY_NIGHTS_THRESHOLD` | hard | actief | ja | — | — | art. 101 |
| `MAX_CONSECUTIVE_IN_NIGHT_SEQUENCE` | hard | actief | ja | ja | ja | art. 101 |
| `MAX_CONSECUTIVE_SERVICES` | hard | actief | ja | ja | ja | art. 100 |
| `MAX_NIGHT_SERVICES_16W` | hard | actief | ja | ja | ja | art. 101 |
| `MAX_WEEKLY_HOURS` | hard | actief | ja | ja | ja | art. 99 |
| `MIN_FREE_SUNDAYS_52W` | hard | actief | ja | ja | ja | art. 100 |
| `MIN_WORK_PER_DUTY` | hard | actief | ja | ja | ja | art. 98 |
| `MIX_PROFILE_SPECIAL_RULES` | hard | blokkeert | ja | ja | — | art. Roosterprofielen |
| `NEW_DRIVER_PROTECTION_YEARS` | zacht | actief | — | — | — | art. Nieuwe machinisten |
| `NIGHT_MAX_DUTY_DURATION` | hard | actief | ja | ja | ja | art. 101 |
| `NIGHT_MAX_WORK` | hard | actief | ja | ja | ja | art. 101 |
| `NIGHT_MAX_WORK_INCL_OVERTIME` | hard | actief | ja | ja | ja | art. 101 |
| `NIGHT_REST_AFTER_0200` | hard | actief | ja | ja | ja | art. 101 |
| `NIGHT_SEQUENCE_RECOVERY` | hard | actief | ja | ja | ja | art. 101 |
| `NIGHT_SEQUENCE_RECOVERY_THRESHOLD` | hard | actief | ja | — | — | art. 101 |
| `PARTTIME_DASH_DAY_MIN` | hard | actief | — | — | — | art. 100 |
| `PLAN_ROSTER_OVERFLOW_LIMIT` | zacht | blokkeert | — | — | — | art. Planrooster |
| `QUALIFICATIONS_REQUIRED` | hard | actief | ja | ja | ja | art. Bevoegdheden |
| `R_DAY_ATTACHED_MIN` | hard | actief | ja | ja | ja | art. 100 |
| `R_DAY_DETACHED_MIN` | hard | actief | ja | — | — | art. 100 |
| `R_DAYS_PER_WEEK_AVG` | hard | actief | ja | — | ja | art. 100 |
| `RC_SHORTENED_WEEKLY_REST_INTERVAL_WEEKS` | hard | actief | ja | — | — | art. 100 |
| `RC_SHORTENED_WEEKLY_REST_MIN` | hard | actief | ja | — | ja | art. 100 |
| `RED_WEEKEND_INTERVAL_WEEKS` | hard | actief | ja | — | ja | art. 102 |
| `RED_WEEKEND_MIN_REST` | hard | actief | ja | ja | ja | art. 102 |
| `REGIO_WEST_WEEKEND_TARGET` | doel | blokkeert | — | — | — | art. Weekendbalans |
| `REGIO_WEST_WTV_INTERVAL_WEEKS` | zacht | actief | — | — | — | art. WTV |
| `RESERVE_BASE_WITHOUT_DUTIES` | hard | actief | ja | ja | ja | art. Reserverooster |
| `RO_DVP_COMBINED_MIN` | hard | actief | — | — | — | art. 100 |
| `RO_DVP_DETACHED_MIN` | hard | actief | — | — | — | art. 100 |
| `ROSTER_ANCHOR_LOCKED` | hard | actief | ja | ja | ja | art. Roosterstructuur |
| `ROSTER_PROFILE_BOUNDS` | hard | actief | ja | ja | ja | art. Roosterprofielen |
| `RP_DAILY_REST_PLANNED` | hard | actief | ja | ja | ja | art. 98 |
| `RP_HARD_NIGHT_LATEST_END` | hard | actief | ja | ja | ja | art. 101 |
| `RP_LOCATION_WORK_INTERRUPTION` | hard | blokkeert | ja | ja | ja | art. 98 |
| `RP_LONG_DUTY_THRESHOLD` | hard | actief | ja | — | — | art. 98 |
| `RP_MAX_DUTY_DURATION` | hard | actief | ja | ja | ja | art. 98 |
| `RP_MAX_DUTY_START_0400_0501` | hard | actief | ja | ja | ja | art. 98 |
| `RP_MAX_DUTY_START_0500_0600` | hard | actief | ja | ja | ja | art. 98 |
| `RP_MAX_EARLY_STARTS_0500_0600_PER_4W` | hard | actief | ja | ja | ja | art. 98 |
| `RP_MAX_LONG_DUTIES_PER_YEAR` | hard | actief | ja | ja | ja | art. 98 |
| `RP_MAX_WORK_INCL_OVERTIME` | hard | actief | ja | ja | ja | art. 98 |
| `RP_MAX_WORK_PER_DUTY` | hard | actief | ja | ja | ja | art. 98 |
| `RP_MAX_WORK_START_0500_0600` | hard | actief | ja | ja | ja | art. 98 |
| `RP_MIN_DUTY_DURATION` | hard | actief | ja | ja | ja | art. 98 |
| `RP_NIGHT_ACROSS_0230_MAX_DUTY` | hard | actief | ja | ja | ja | art. 101 |
| `RP_NIGHT_ACROSS_0230_MAX_WORK` | hard | actief | ja | ja | ja | art. 101 |
| `RP_NIGHT_START_0400_0501_MAX_DUTY` | hard | actief | ja | ja | ja | art. 101 |
| `RP_NIGHT_START_0400_0501_MAX_WORK` | hard | actief | ja | ja | ja | art. 101 |
| `RP_STATION_BREAK_ADJUSTMENT` | hard | blokkeert | ja | ja | ja | art. 98 |
| `RT_PREFERRED_WINDOW_WEEKS` | hard | actief | — | — | — | art. 100 |
| `WEEKLY_REST_36H_PER_7D` | hard | actief | ja | ja | ja | art. 100 |
| `WEEKLY_REST_72H_PER_14D` | hard | actief | ja | — | ja | art. 100 |
| `WEEKLY_REST_SPLIT_MIN` | hard | actief | ja | — | — | art. 100 |
| `WITHDRAWN_WTV_GRANT_WITHIN_DAYS` | hard | actief | — | — | — | art. 97 |
| `WTV_DAY_LATEST_START` | hard | actief | — | — | — | art. 97 |
| `WTV_DAYS_PER_YEAR_36H` | zacht | actief | — | — | — | art. 97 |

## Wat hier niet in staat

Formele validatie door NS. Geen enkele regel is door de bevoegde partij bevestigd,
en een gedragstoets verandert daar niets aan: die laat zien dat de code doet wat er
in het regelbestand staat, niet dat wat er staat de juiste lezing van de bron is.
