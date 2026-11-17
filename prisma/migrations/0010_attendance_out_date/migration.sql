-- 0010 — Attendance: the date an Out-Time fell on (17 Nov 2026).
--
-- A shift may now run on past the next morning — an operator working
-- continuously for 35 hours — and 08:00 → 19:00 cannot say on its own whether
-- that was eleven hours or thirty-five. attendance_day.outDate records the
-- yyyy-mm-dd of the Out from now on.
--
-- Additive: one nullable column. No row is changed; a row without it is read
-- from its times exactly as before (an Out earlier than the In is the next
-- date). Guarded, so it is safe to run again by hand.

ALTER TABLE "attendance_day" ADD COLUMN IF NOT EXISTS "outDate" TEXT;
