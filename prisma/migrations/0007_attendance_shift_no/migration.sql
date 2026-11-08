-- 0007 — More than one shift for an operator on one date.
--
-- attendance_day held ONE row per (date, operator), so an operator called
-- back for a second shift the same day (a Sunday, say) could not be entered.
-- Each shift is now its own row, numbered within its date:
--
--   1. attendance_day.shiftNo — 1 for every row already there, 2 for the next
--      shift of that date, and so on;
--   2. the unique key moves from (date, operatorId) to
--      (date, operatorId, shiftNo), so no shift can be entered twice.
--
-- No row is changed or removed. Guarded, so it is safe to run again by hand.

ALTER TABLE "attendance_day" ADD COLUMN IF NOT EXISTS "shiftNo" INTEGER NOT NULL DEFAULT 1;

DROP INDEX IF EXISTS "attendance_day_date_operatorId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "attendance_day_date_operatorId_shiftNo_key"
  ON "attendance_day"("date", "operatorId", "shiftNo");
