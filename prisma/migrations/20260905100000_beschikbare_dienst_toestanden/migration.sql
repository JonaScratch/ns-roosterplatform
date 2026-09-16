-- De toestanden van een vrijgekomen dienst compleet maken.
--
-- Twee dingen waren niet in orde:
--
--  1. `EXPIRED` en `WITHDRAWN` stonden in de opsomming maar werden nergens
--     gezet. Een dienst waarvan de inschrijving gesloten was, bleef daardoor
--     eeuwig `OPEN` heten: verdwenen uit de lijst van de medewerker (die filtert
--     op de sluitingstijd) maar nog openstaand bij de dienstindeling. Twee
--     schermen die iets anders zeggen over dezelfde dienst.
--
--  2. Er was geen toestand voor "het venster is dicht en er moet nog worden
--     toegewezen". Zonder die toestand is dat moment niet van "de inschrijving
--     loopt nog" te onderscheiden.
--
-- De namen volgen de opdracht. `INTEREST_PERIOD` uit de opdracht is hier `OPEN`:
-- dat is dezelfde toestand, en er twee namen voor hebben zou een verschil
-- suggereren dat er niet is.

ALTER TYPE "AvailableDutyStatus" RENAME VALUE 'AWARDED' TO 'ALLOCATED';
ALTER TYPE "AvailableDutyStatus" RENAME VALUE 'EXPIRED' TO 'CLOSED';
ALTER TYPE "AvailableDutyStatus" RENAME VALUE 'WITHDRAWN' TO 'CANCELLED';
ALTER TYPE "AvailableDutyStatus" ADD VALUE 'ALLOCATION_PENDING';
