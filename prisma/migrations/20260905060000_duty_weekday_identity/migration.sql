-- Dienstidentiteit wordt dienstnummer + weekdag.
--
-- Aanleiding: in de aangeleverde Dordrechtse bron heeft 39 van de 46
-- dienstnummers per weekdag andere tijden. Dienst 101 begint op maandag om
-- 18:08 en op donderdag om 16:27. Zolang het nummer alleen de sleutel is,
-- passen die 223 diensten in 46 rijen en verdwijnen er 177 zonder foutmelding.
--
-- Waarom hier gegevens worden verwijderd
--
-- Vóór deze migratie stond een rij in "Duty" voor een dienstNUMMER; erna staat
-- zij voor een dienstINSTANTIE op een bepaalde weekdag. Er is geen waarheid die
-- de oude rijen in de nieuwe vorm giet: hun bron noemde geen weekdag. Een
-- weekdag invullen zou betekenen dat de database iets beweert wat nergens
-- vandaan komt. De bestaande rijen worden daarom verwijderd en opnieuw uit de
-- aangeleverde bladen ingelezen (`npm run db:seed`), waar de weekdag wél in
-- staat.
--
-- Dit raakt uitsluitend ontwikkel- en simulatiegegevens. Er heeft nooit een
-- vastgesteld rooster in deze tabellen gestaan; het platform staat op
-- Production-safe: NO.

-- De rijen die naar een dienst wijzen, gaan mee. Zij verwijzen naar een
-- dienstbegrip dat na deze migratie niet meer bestaat.
DELETE FROM "OperationalAssignment";
DELETE FROM "AvailableDuty";
DELETE FROM "ScheduledDuty";
DELETE FROM "Duty";

-- DropIndex
DROP INDEX "Duty_packageId_code_key";

-- AlterTable
ALTER TABLE "Duty" DROP COLUMN "weekdays",
ADD COLUMN     "weekday" INTEGER NOT NULL;

-- CreateIndex
CREATE INDEX "Duty_depot_weekday_idx" ON "Duty"("depot", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "Duty_packageId_code_weekday_key" ON "Duty"("packageId", "code", "weekday");

-- De weekdag is 1 (maandag) tot en met 7 (zondag). De database bewaakt dat
-- zelf: een 0 of een 8 hoort nergens te kunnen ontstaan, ook niet via een
-- script dat de applicatielaag overslaat.
ALTER TABLE "Duty" ADD CONSTRAINT "Duty_weekday_bereik" CHECK ("weekday" BETWEEN 1 AND 7);
