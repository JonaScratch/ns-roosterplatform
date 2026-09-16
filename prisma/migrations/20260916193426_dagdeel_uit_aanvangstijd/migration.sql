-- Dagdeel voor reserve- en rangeerdiensten, afgeleid uit de aanvangstijd.
--
-- Dezelfde afleiding als `resolveDayparts` in src/domain/duty-classification.ts,
-- voor diensten die al in de database staan. Nieuwe leveringen krijgen hem in de
-- importstraat; deze migratie brengt bestaande pakketten — ook in een draagbare
-- installatie die wordt bijgewerkt — op dezelfde indeling.
--
-- Per pakket: het venster (vroegste en laatste aanvangstijd) en de mediane
-- aanvangstijd van de diensten die op nummer een dagdeel hebben. Een dienst
-- zonder dagdeel krijgt het dagdeel waarvan het venster het dichtstbij ligt
-- (0 = erbinnen); bij gelijke afstand beslist de mediaan; blijft het gelijk, dan
-- blijft de dienst GEEN. Afstanden gaan om de klok heen.
--
-- `verify:profielen` controleert dat de database na deze migratie precies
-- oplevert wat de TypeScript-functie oplevert.

WITH starts AS (
  SELECT "packageId", "period", (("startMinute" % 1440) + 1440) % 1440 AS s
  FROM "Duty"
  WHERE "period" IN ('VROEG', 'LAAT', 'NACHT')
),
vensters AS (
  SELECT
    "packageId",
    "period",
    MIN(s) AS lo,
    MAX(s) AS hi,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY s) AS mediaan
  FROM starts
  GROUP BY "packageId", "period"
),
zonder AS (
  SELECT "id", "packageId", (("startMinute" % 1440) + 1440) % 1440 AS m
  FROM "Duty"
  WHERE "period" = 'GEEN'
),
kandidaten AS (
  SELECT
    z."id",
    v."period",
    CASE
      WHEN z.m BETWEEN v.lo AND v.hi THEN 0
      ELSE LEAST(
        LEAST(ABS(z.m - v.lo), 1440 - ABS(z.m - v.lo)),
        LEAST(ABS(z.m - v.hi), 1440 - ABS(z.m - v.hi))
      )
    END AS afstand,
    LEAST(ABS(z.m - v.mediaan), 1440 - ABS(z.m - v.mediaan)) AS tot_mediaan
  FROM zonder z
  JOIN vensters v ON v."packageId" = z."packageId"
),
gerangschikt AS (
  SELECT
    "id",
    "period",
    ROW_NUMBER() OVER (PARTITION BY "id" ORDER BY afstand, tot_mediaan) AS rang,
    COUNT(*) OVER (PARTITION BY "id", afstand, tot_mediaan) AS gelijk
  FROM kandidaten
)
UPDATE "Duty" d
SET
  "period" = g."period"::"DutyPeriod",
  "kinds" = array_remove(
    ARRAY[
      g."period"::text,
      CASE d."workType"::text
        WHEN 'RANGEER' THEN 'RANGEER'
        WHEN 'RESERVE' THEN 'RESERVE'
      END
    ],
    NULL
  )::"DutyKind"[]
FROM gerangschikt g
WHERE g."id" = d."id"
  AND g.rang = 1
  AND g.gelijk = 1;
