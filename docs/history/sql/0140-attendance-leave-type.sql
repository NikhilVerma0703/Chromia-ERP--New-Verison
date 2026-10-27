-- 0140: attendance_leave."leaveType" — informed, or not. One new column on one
-- existing table. No row is created, none is deleted, and no other table is
-- touched.
--
-- NUMBER. Raised as 0138 (PR #37) and renumbered on merge, 26 Oct 2026: PR #35's
-- accounts scripts took 0137 and 0138. Same script; run it once.
--
-- WHY. The owner, 20 Oct 2026: rename Request Leave to Leave Taken and "Add a
-- new field named 'Leave Type' immediately after Operator Name, with a
-- dropdown containing: Informed Leave — Dark Green, Uninformed Leave — Dark
-- Red". It is the one thing a supervisor reads the leave register for, so it
-- is a field and not a note in Remarks: "told us" and "did not turn up" are
-- different facts about the same absence, and only one of them is a problem.
--
-- WHAT.
--   attendance_leave."leaveType"  TEXT NOT NULL DEFAULT ''
--     The CODE, 'INFORMED' or 'UNINFORMED' — never the words. The labels on
--     screen can be reworded later without rewriting anybody's history, and
--     the colours hang off the code too (lib/attendance/attendance.ts
--     LEAVE_TYPE_LABELS, LEAVE_TYPE_HUES). The model is
--     AttendanceLeave.leaveType, declared LAST because ADD COLUMN appends;
--     tests/roboShiftAttendance0123.test.ts holds the two orders together.
--
-- DEFAULT '' AND NO BACK-FILL, and that is deliberate rather than lazy: ''
-- means "written before the field existed", which the register shows as "-" in
-- the ordinary ink. Guessing INFORMED for an old row would assert that
-- somebody was excused when nobody recorded it. Every NEW record must carry a
-- type — the API refuses one that does not (lib/attendance/server.ts, POST and
-- PATCH on leave), so '' can only ever mean "from before".
--
-- NO CHECK CONSTRAINT. Prisma does not write one for a plain String, and the
-- repo's rule is that a hand-written script matches the DDL Prisma would write
-- so `prisma migrate diff` stays clean. The two values are enforced in the
-- application, at the one door both ERPs use.
--
-- ALREADY ON NEON. The column was added out-of-band on 20 Oct 2026 while this
-- change was being written, when the leave register held no rows at all. IF
-- NOT EXISTS therefore finds it in place and adds nothing: this file is the
-- record of what was done, and the thing a fresh database runs. Either way a
-- second run is a no-op.
--
-- ORDER. Before the code that reads the column is deployed. Until it runs, the
-- leave register's read names a column that is not there and fails; after it
-- runs, the old code is unaffected (it never names it).
--
-- Applied with:
--   npx prisma db execute --schema prisma/schema.prisma --file scripts/0140-attendance-leave-type.sql

BEGIN;

-- Never queue the live ERP behind this script; if a lock it needs is held,
-- give up after 5 s and roll back whole rather than wait. Run it again later.
SET LOCAL lock_timeout = '5s';

-- The precondition: 0123's table is there. Checked before anything is changed,
-- so a refusal leaves the database exactly as it was.
DO $$ BEGIN
  IF to_regclass('attendance_leave') IS NULL THEN
    RAISE EXCEPTION '0140: attendance_leave does not exist — run scripts/0123-robo-shift-attendance.sql first. Nothing was changed.';
  END IF;
END $$;

-- What this run adds, read from the catalogue BEFORE adding it, for the log at
-- the end. A second run finds it in place, adds nothing and logs nothing.
CREATE TEMP TABLE added (what text) ON COMMIT DROP;
INSERT INTO added
SELECT 'attendance_leave."leaveType"'
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_name = 'attendance_leave' AND column_name = 'leaveType'
);

-- ─────────────────────────────── the column ─────────────────────────────────
ALTER TABLE attendance_leave
  ADD COLUMN IF NOT EXISTS "leaveType" TEXT NOT NULL DEFAULT '';

-- ─────────────────────────────── the record ─────────────────────────────────
INSERT INTO action_log (id, actor, kind, model, summary, payload)
SELECT gen_random_uuid()::text, 'schema change (scripts/0140)', 'edit', 'AttendanceLeave',
       'Leave Taken (scripts/0140): attendance_leave."leaveType" added — a leave record says whether the operator told anyone first.',
       jsonb_build_object('action', '0140-attendance-leave-type', 'added', (SELECT jsonb_agg(what) FROM added))
WHERE EXISTS (SELECT 1 FROM added);

COMMIT;
