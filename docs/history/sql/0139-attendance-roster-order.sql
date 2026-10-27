-- 0139: attendance_operator."sortOrder" — the register's own order. One new
-- column on one existing table. No row is created, none is deleted, and no
-- other table is touched.
--
-- NUMBER. Raised as 0137 (PR #37) and renumbered on merge, 26 Oct 2026: PR #35's
-- accounts scripts took 0137 and 0138. Same script; run it once.
--
-- WHY. The owner, 20 Oct 2026, giving the twelve operators by name: "Add these
-- 12 operators in exactly the following order. Do not sort them
-- alphabetically." The register sorted alphabetically, in the application
-- (lib/attendance/attendance.ts compareOperatorNames, now deleted). The floor's
-- list is not alphabetical — it is the order the line is called in, which
-- begins Jagadeesh, Rajesh, Saravanan .L, Kiran — so the position had to stop
-- being derived from the name and become data. This is that column.
--
-- WHAT.
--   attendance_operator."sortOrder"  INTEGER NOT NULL DEFAULT 0
--     Where the name sits in the register, and the only thing any reader
--     orders by (lib/attendance/server.ts listOperators, and the downloads
--     query within a date). A new operator is appended, max + 1, so adding one
--     never moves another. The model is AttendanceOperator.sortOrder, declared
--     LAST because ADD COLUMN appends and the two orders are held together by
--     tests/roboShiftAttendance0123.test.ts.
--
-- DEFAULT 0 AND NO BACK-FILL. Every row already there keeps 0 and they tie on
-- it, which `id` then breaks, so the list can never come back shuffled. The
-- roster's actual numbering is DATA, not schema: prisma/seed-attendance.ts
-- holds the owner's twelve and numbers them 1..12 (`npm run db:seed:attendance`,
-- idempotent). This script does not write it, because a schema script that
-- seeded a particular plant's people could not be run anywhere else.
--
-- ALREADY ON NEON. The column was added out-of-band on 20 Oct 2026, with the
-- twelve numbered 1..12, while this change was being written. IF NOT EXISTS
-- therefore finds it in place and adds nothing: this file is the record of
-- what was done, and the thing a fresh database runs. Either way a second run
-- is a no-op.
--
-- ORDER. Before the code that reads the column is deployed. Until it runs,
-- listOperators' ORDER BY names a column that is not there and the register
-- fails to read; after it runs, the old code is unaffected (it never names it).
--
-- Applied with:
--   npx prisma db execute --schema prisma/schema.prisma --file scripts/0139-attendance-roster-order.sql

BEGIN;

-- Never queue the live ERP behind this script; if a lock it needs is held,
-- give up after 5 s and roll back whole rather than wait. Run it again later.
SET LOCAL lock_timeout = '5s';

-- The precondition: 0123's table is there. Checked before anything is changed,
-- so a refusal leaves the database exactly as it was.
DO $$ BEGIN
  IF to_regclass('attendance_operator') IS NULL THEN
    RAISE EXCEPTION '0139: attendance_operator does not exist — run scripts/0123-robo-shift-attendance.sql first. Nothing was changed.';
  END IF;
END $$;

-- What this run adds, read from the catalogue BEFORE adding it, for the log at
-- the end. A second run finds it in place, adds nothing and logs nothing.
CREATE TEMP TABLE added (what text) ON COMMIT DROP;
INSERT INTO added
SELECT 'attendance_operator."sortOrder"'
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_name = 'attendance_operator' AND column_name = 'sortOrder'
);

-- ─────────────────────────────── the column ─────────────────────────────────
ALTER TABLE attendance_operator
  ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- ─────────────────────────────── the record ─────────────────────────────────
-- One action_log row, and only when this run actually added the column, so a
-- re-run leaves no second entry. The shape the other scripts here use.
INSERT INTO action_log (id, actor, kind, model, summary, payload)
SELECT gen_random_uuid()::text, 'schema change (scripts/0139)', 'edit', 'AttendanceOperator',
       'Attendance roster order (scripts/0139): attendance_operator."sortOrder" added — the register keeps the owner''s order and is no longer sorted by name.',
       jsonb_build_object('action', '0139-attendance-roster-order', 'added', (SELECT jsonb_agg(what) FROM added))
WHERE EXISTS (SELECT 1 FROM added);

COMMIT;
