-- 0123: the Shift on every Robo slab, and the one attendance register the
-- Robo line and the Chromia line share. One nullable column on the existing
-- "RoboProductionRecord", and three new attendance_* tables, created empty.
-- The Prisma side is RoboProductionRecord.productionShift and the ATTENDANCE
-- MODULE block of prisma/schema.prisma (between the LAB and ACCOUNTS
-- blocks); tests/roboShiftAttendance0123.test.ts reads both and holds them to
-- one another, column for column, key for key.
--
-- WHY. Two requests from the owner, built on feat/robo-chromia-2026-10-18:
--   * Shift on every slab. The operator picks A (06:00-14:00), B
--     (14:00-22:00) or C (22:00-06:00) on the entry form; Slab Records,
--     Complete Details, both Excel sheets and the hourly chart show it. It is
--     NOT RoboShift.shiftNumber, which is one row per DAY stamped from the
--     wall clock (see src/lib/robo/productionShift.ts), so it needs a column
--     of its own on the slab.
--   * One attendance register for the two lines. The same operators work the
--     Robo line and the Chromia line, so there is one roster, one row per
--     operator per date and one list of leave, read and written from both
--     modules (/robo/attendance and /chromia/attendance, one handler in
--     src/lib/attendance/server.ts). The unique key on (date, operator) is
--     what makes the same day saved from both tablets one row.
-- The branch ships the schema change and no script; this is that script.
--
-- WHAT.
--   "RoboProductionRecord"."productionShift" TEXT, nullable, no default, and
--     NOT back-filled. Every slab saved before it, and every imported one,
--     stays NULL; the code then reads the shift off the slab's own In Time
--     (productionShiftOf). The API writes 'A', 'B', 'C' or NULL, never ''
--     (parseShiftCode is the only way in).
--   attendance_operator   the roster, shared by both lines; a name is unique.
--     Deliberately not "RoboOperator" (Robo-named, dormant, read nowhere).
--   attendance_day        one operator's attendance for one date: the lines
--     worked ('ROBO', 'CHROMIA', 'ROBO,CHROMIA' or ''), one In, one Out.
--     Unique on (date, operator).
--   attendance_leave      leave asked for, apart from the day row: leave is
--     asked in advance and may never become a day worked.
-- Nothing is seeded: the roster starts empty and is filled from either
-- screen's "+ Add Operator".
--
-- CONVENTIONS.
--   * The DDL Prisma would write for these models, so `prisma migrate diff`
--     against the schema stays clean. The attendance models map their
--     tables (@@map) but not their fields, so the tables are snake_case and
--     the columns are the field names as written, camelCase and quoted
--     ("operatorId", "inTime", "createdAt"), the way the Robo tables' own
--     columns are. ids TEXT PRIMARY KEY (the app's cuid()); index and key
--     names as Prisma names them (<table>_<columns>_key / _idx / _fkey); a
--     moment is TIMESTAMP(3), as Prisma maps DateTime; "updatedAt" has no
--     DEFAULT (Prisma's @updatedAt stamps it; a row written by hand in SQL
--     names it).
--   * The two foreign keys are Prisma's default for a required relation: ON
--     DELETE RESTRICT ON UPDATE CASCADE. RESTRICT is load-bearing: an
--     operator with attendance or leave on record cannot be deleted, so the
--     API takes them off the roster instead and their history stays.
--   * NO CHECK and NO ENUM. The schema declares none: dates are yyyy-mm-dd
--     and times HH:MM text, validated by the API, as the Robo module stores
--     them. A CHECK on productionShift or attendance_day.lines can be added
--     by a later script if it is ever wanted.
--   * Nothing points outside the module but nothing needs to: no column here
--     names a users.id.
--
-- Applied with:
--   npx prisma db execute --schema prisma/schema.prisma --file scripts/0123-robo-shift-attendance.sql
--   npx prisma generate
-- (NOT `prisma db push`.)
--
-- WHEN: BEFORE the merge of feat/robo-chromia-2026-10-18 reaches production,
-- with the owner's go-ahead (rehearse on a throwaway Neon branch, take a
-- pre-0123 backup branch, count, run, count again, migrate diff). Order
-- matters here, unlike a new module's tables:
--   * the new Prisma client names "productionShift" in every read of a Robo
--     slab that does not pick its own columns, so on the new code the Robo
--     entry form, Slab Records, Complete Details, Reports and both downloads
--     fail (P2022, column does not exist) until the column is there;
--   * /robo/attendance and /chromia/attendance fail (P2021, table does not
--     exist) until the three tables are there.
-- Running it FIRST is safe: the code live today names neither the column nor
-- the tables, and a nullable column with no default is added without
-- rewriting "RoboProductionRecord".
--
-- ADDITIVE AND IDEMPOTENT. One column, three tables, four indexes and two
-- foreign keys, nothing else. ADD COLUMN / CREATE TABLE / CREATE INDEX IF NOT
-- EXISTS, foreign keys added only when missing (duplicate_object), COMMENT ON
-- a plain overwrite on the new tables only. No DROP, no ALTER of an existing
-- column, no UPDATE, no DELETE. One transaction: all of it or none. Safe to
-- run twice; the second run adds nothing and logs nothing.
--
-- REFUSES, changing nothing, when (checked before anything is added):
--   * "RoboProductionRecord" is not there (the wrong database);
--   * "productionShift" is already there but is not a nullable TEXT with no
--     default;
--   * an attendance_* table is already there (made by hand, or out-of-band)
--     but is not exactly the table the schema declares: a column missing, of
--     another type (timestamp(3) included), nullability or default, or one
--     the schema does not declare; the primary key not on "id" or not named
--     <table>_pkey; an index under one of this script's names that is not a
--     btree on those columns, unique as declared; a foreign key under one of
--     its names that does not run "operatorId" -> attendance_operator("id")
--     ON DELETE RESTRICT ON UPDATE CASCADE; or any other index or constraint.
--     Otherwise IF NOT EXISTS and duplicate_object, which match by name
--     alone, would pass over a different shape and log it as in place;
--   * an existing attendance_operator holds a name twice, or an existing
--     attendance_day holds an operator twice on one date, which the unique
--     index would refuse; the duplicates are counted and named, never deleted;
--   * an existing attendance_day or attendance_leave row names an operator
--     that is not on the roster, which the foreign key would refuse.
--
-- Logged: one action_log row on the first run, naming what it added; later
-- runs log only if they add something (a database where part of this was made
-- by hand), as 0116, 0117 and 0121 log.
--
-- CHECK (after):
--   SELECT data_type, is_nullable, column_default FROM information_schema.columns
--    WHERE table_name = 'RoboProductionRecord' AND column_name = 'productionShift';
--     -- one row: text | YES | NULL
--   SELECT count(*) FROM "RoboProductionRecord" WHERE "productionShift" IS NOT NULL;
--     -- 0: nothing back-filled
--   SELECT table_name, count(*) FROM information_schema.columns
--    WHERE table_name LIKE 'attendance\_%' GROUP BY table_name ORDER BY table_name;
--     -- three rows: attendance_day 8, attendance_leave 9, attendance_operator 5
--   SELECT count(*) FROM pg_indexes WHERE tablename LIKE 'attendance\_%';
--     -- 7: the four below and the three primary keys
--   SELECT conname, confdeltype, confupdtype FROM pg_constraint
--    WHERE conname LIKE 'attendance\_%' AND contype = 'f' ORDER BY conname;
--     -- two: attendance_day_operatorId_fkey r c, attendance_leave_operatorId_fkey r c
--   SELECT count(*) FROM attendance_operator;
--     -- 0: the roster starts empty
BEGIN;

-- Never queue the live ERP behind this script. Adding the column takes a
-- brief lock on "RoboProductionRecord", which the Robo tablet writes all
-- shift; if a long query or an idle transaction holds it, give up after 5 s
-- and roll back whole rather than make the tablet wait. Run it again once it
-- is free.
SET LOCAL lock_timeout = '5s';

-- ───────────────────────────── the preconditions ──────────────────────────────
-- Read before anything is added. Each refusal says what it found and that
-- nothing was changed; the transaction then rolls back whole.
DO $$
DECLARE
  hit text;
BEGIN
  IF to_regclass('"RoboProductionRecord"') IS NULL THEN
    RAISE EXCEPTION '0123 refused: table "RoboProductionRecord" is not here, so this is not the ERP database. Nothing was changed.';
  END IF;

  SELECT format('%s, nullable %s, default %s', data_type, is_nullable, coalesce(column_default, 'none')) INTO hit
    FROM information_schema.columns
   WHERE table_schema = current_schema() AND table_name = 'RoboProductionRecord' AND column_name = 'productionShift'
     AND NOT (data_type = 'text' AND is_nullable = 'YES' AND column_default IS NULL);
  IF hit IS NOT NULL THEN
    RAISE EXCEPTION '0123 refused: "RoboProductionRecord"."productionShift" is already here as % — the schema declares a nullable TEXT with no default. Nothing was changed.', hit;
  END IF;

  -- A table already here (made by hand, or out-of-band from Prisma's own DDL)
  -- must already be EXACTLY the table the schema declares. Otherwise CREATE
  -- TABLE / CREATE INDEX IF NOT EXISTS and the duplicate_object guards below
  -- pass over it in silence, match by name alone, and the log calls a
  -- different shape "already in place". So, for every attendance_* table that
  -- is here, before anything is added:
  --   1. every column: its type (a moment is timestamp(3), not the bare
  --      timestamp(6)), nullability and default; and no column the schema
  --      does not declare (an extra NOT NULL one would refuse every insert);
  --   2. the primary key: on "id" alone, under Prisma's name <table>_pkey;
  --   3. an index already under one of this script's names: a btree on that
  --      table, unique or not as declared, on exactly those columns in that
  --      order, with no predicate and no expression;
  --   4. a foreign key already under one of this script's names: from
  --      "operatorId" to attendance_operator("id"), on delete restrict, on
  --      update cascade;
  --   5. no other index or constraint on the three tables.
  -- Defaults are compared as Postgres keeps them: true, ''::text and
  -- CURRENT_TIMESTAMP (now() is the same default; Prisma reads both as now()).

  -- 1. The columns.
  SELECT string_agg(what, '; ' ORDER BY what) INTO hit FROM (
    WITH e(tbl, col, typ, nullable, def) AS (VALUES
      ('attendance_operator', 'id',         'text',         'NO',  NULL),
      ('attendance_operator', 'name',       'text',         'NO',  NULL),
      ('attendance_operator', 'isActive',   'boolean',      'NO',  'true'),
      ('attendance_operator', 'createdAt',  'timestamp(3)', 'NO',  'CURRENT_TIMESTAMP'),
      ('attendance_operator', 'updatedAt',  'timestamp(3)', 'NO',  NULL),
      ('attendance_day',      'id',         'text',         'NO',  NULL),
      ('attendance_day',      'date',       'text',         'NO',  NULL),
      ('attendance_day',      'operatorId', 'text',         'NO',  NULL),
      ('attendance_day',      'lines',      'text',         'NO',  '''''::text'),
      ('attendance_day',      'inTime',     'text',         'YES', NULL),
      ('attendance_day',      'outTime',    'text',         'YES', NULL),
      ('attendance_day',      'createdAt',  'timestamp(3)', 'NO',  'CURRENT_TIMESTAMP'),
      ('attendance_day',      'updatedAt',  'timestamp(3)', 'NO',  NULL),
      ('attendance_leave',    'id',         'text',         'NO',  NULL),
      ('attendance_leave',    'date',       'text',         'NO',  NULL),
      ('attendance_leave',    'operatorId', 'text',         'NO',  NULL),
      ('attendance_leave',    'fromTime',   'text',         'YES', NULL),
      ('attendance_leave',    'toTime',     'text',         'YES', NULL),
      ('attendance_leave',    'reason',     'text',         'NO',  '''''::text'),
      ('attendance_leave',    'remarks',    'text',         'YES', NULL),
      ('attendance_leave',    'createdAt',  'timestamp(3)', 'NO',  'CURRENT_TIMESTAMP'),
      ('attendance_leave',    'updatedAt',  'timestamp(3)', 'NO',  NULL)
    ),
    h AS (
      SELECT c.table_name AS tbl, c.column_name AS col, c.is_nullable AS nullable,
             CASE WHEN c.data_type = 'timestamp without time zone' THEN format('timestamp(%s)', c.datetime_precision)
                  ELSE c.data_type END AS typ,
             CASE WHEN c.column_default = 'now()' THEN 'CURRENT_TIMESTAMP' ELSE c.column_default END AS def
        FROM information_schema.columns c
       WHERE c.table_schema = current_schema() AND c.table_name IN ('attendance_operator', 'attendance_day', 'attendance_leave')
    )
    SELECT format('%s."%s" (want %s, nullable %s, default %s)', e.tbl, e.col, e.typ, e.nullable, coalesce(e.def, 'none')) AS what
      FROM e LEFT JOIN h ON h.tbl = e.tbl AND h.col = e.col
     WHERE to_regclass(e.tbl) IS NOT NULL
       AND (h.col IS NULL OR h.typ <> e.typ OR h.nullable <> e.nullable OR h.def IS DISTINCT FROM e.def)
    UNION ALL
    SELECT format('%s."%s" (a column the schema does not declare)', h.tbl, h.col)
      FROM h LEFT JOIN e ON e.tbl = h.tbl AND e.col = h.col
     WHERE e.col IS NULL
  ) d;
  IF hit IS NOT NULL THEN
    RAISE EXCEPTION '0123 refused: an attendance table is already here but its columns are not as the schema declares them (missing, different or extra): %. Nothing was changed; model what is there before going on.', hit;
  END IF;

  -- 2. The primary keys.
  SELECT string_agg(format('%s (want PRIMARY KEY ("id") named %s_pkey)', t.tbl, t.tbl), '; ' ORDER BY t.tbl) INTO hit
    FROM (VALUES ('attendance_operator'), ('attendance_day'), ('attendance_leave')) AS t(tbl)
   WHERE to_regclass(t.tbl) IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint k
                      WHERE k.conrelid = to_regclass(t.tbl) AND k.contype = 'p' AND k.conname = t.tbl || '_pkey'
                        AND k.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = k.conrelid AND a.attname = 'id')]);
  IF hit IS NOT NULL THEN
    RAISE EXCEPTION '0123 refused: an attendance table is already here without the primary key the schema declares: %. Nothing was changed; model what is there before going on.', hit;
  END IF;

  -- 3. An index already under one of this script's names. Its columns are
  -- read in key order (indkey is numbered from 0).
  SELECT string_agg(format('%s (want %s on %s (%s))', w.idx,
                           CASE WHEN w.uniq THEN 'a unique btree index' ELSE 'a btree index' END, w.tbl, w.cols),
                    '; ' ORDER BY w.idx) INTO hit
    FROM (VALUES
      ('attendance_operator_name_key',       'attendance_operator', true,  'name'),
      ('attendance_day_date_operatorId_key', 'attendance_day',      true,  'date,operatorId'),
      ('attendance_day_date_idx',            'attendance_day',      false, 'date'),
      ('attendance_leave_date_idx',          'attendance_leave',    false, 'date')
    ) AS w(idx, tbl, uniq, cols)
   WHERE to_regclass(format('%I', w.idx)) IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_index i
         JOIN pg_class x ON x.oid = i.indexrelid
         JOIN pg_am m ON m.oid = x.relam
        WHERE i.indexrelid = to_regclass(format('%I', w.idx))
          AND i.indrelid = to_regclass(w.tbl)
          AND i.indisunique = w.uniq AND m.amname = 'btree'
          AND i.indpred IS NULL AND i.indexprs IS NULL
          AND (SELECT string_agg(a.attname, ',' ORDER BY k)
                 FROM generate_series(0, i.indnatts - 1) AS k
                 JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[k]) = w.cols);
  IF hit IS NOT NULL THEN
    RAISE EXCEPTION '0123 refused: an index is already here under a name this script gives, but it does not cover what the schema declares: %. Nothing was changed; model what is there before going on.', hit;
  END IF;

  -- 4. A foreign key already under one of this script's names.
  SELECT string_agg(format('%s on %s (want "operatorId" -> attendance_operator("id"), on delete restrict, on update cascade)', w.fk, w.tbl),
                    '; ' ORDER BY w.fk) INTO hit
    FROM (VALUES
      ('attendance_day_operatorId_fkey',   'attendance_day'),
      ('attendance_leave_operatorId_fkey', 'attendance_leave')
    ) AS w(fk, tbl)
    JOIN pg_constraint k ON k.conname = w.fk AND k.conrelid = to_regclass(w.tbl)
   WHERE NOT coalesce(
           k.contype = 'f'
           AND k.confrelid = to_regclass('attendance_operator')
           AND k.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = k.conrelid AND a.attname = 'operatorId')]
           AND k.confkey = ARRAY[(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = k.confrelid AND a.attname = 'id')]
           AND k.confdeltype = 'r' AND k.confupdtype = 'c',
         false);
  IF hit IS NOT NULL THEN
    RAISE EXCEPTION '0123 refused: a foreign key is already here under a name this script gives, but it is not the one the schema declares: %. Nothing was changed; model what is there before going on.', hit;
  END IF;

  -- 5. Nothing else on the three tables. A NOT NULL belongs to its column
  -- (step 1), whichever catalogue keeps it; a unique key may be a constraint
  -- over the index of the same name, whose shape step 3 has read.
  SELECT string_agg(what, '; ' ORDER BY what) INTO hit FROM (
    SELECT format('index %s on %s', x.relname, i.indrelid::regclass) AS what
      FROM pg_index i JOIN pg_class x ON x.oid = i.indexrelid
     WHERE i.indrelid IN (to_regclass('attendance_operator'), to_regclass('attendance_day'), to_regclass('attendance_leave'))
       AND x.relname NOT IN ('attendance_operator_pkey', 'attendance_day_pkey', 'attendance_leave_pkey',
                             'attendance_operator_name_key', 'attendance_day_date_operatorId_key',
                             'attendance_day_date_idx', 'attendance_leave_date_idx')
    UNION ALL
    SELECT format('constraint %s on %s', k.conname, k.conrelid::regclass)
      FROM pg_constraint k
     WHERE k.conrelid IN (to_regclass('attendance_operator'), to_regclass('attendance_day'), to_regclass('attendance_leave'))
       AND k.contype <> 'n'
       AND k.conname NOT IN ('attendance_operator_pkey', 'attendance_day_pkey', 'attendance_leave_pkey',
                             'attendance_day_operatorId_fkey', 'attendance_leave_operatorId_fkey')
       AND NOT (k.contype = 'u' AND k.conname IN ('attendance_operator_name_key', 'attendance_day_date_operatorId_key'))
  ) d;
  IF hit IS NOT NULL THEN
    RAISE EXCEPTION '0123 refused: an attendance table already carries an index or constraint the schema does not declare: %. Nothing was changed; model what is there before going on.', hit;
  END IF;

  -- Rows already here that the new unique indexes or foreign keys would
  -- refuse. Counted and named, never deleted: a person decides which to keep.
  IF to_regclass('attendance_operator') IS NOT NULL AND to_regclass('attendance_operator_name_key') IS NULL THEN
    SELECT string_agg(format('%s (%s rows)', name, n), ', ' ORDER BY name) INTO hit
      FROM (SELECT "name" AS name, count(*) AS n FROM attendance_operator GROUP BY "name" HAVING count(*) > 1) d;
    IF hit IS NOT NULL THEN
      RAISE EXCEPTION '0123 refused: attendance_operator holds a name more than once, which the unique index on "name" would refuse: %. Nothing was changed.', hit;
    END IF;
  END IF;
  IF to_regclass('attendance_day') IS NOT NULL AND to_regclass('"attendance_day_date_operatorId_key"') IS NULL THEN
    SELECT string_agg(format('%s / %s (%s rows)', dt, op, n), ', ' ORDER BY dt, op) INTO hit
      FROM (SELECT "date" AS dt, "operatorId" AS op, count(*) AS n FROM attendance_day
             GROUP BY "date", "operatorId" HAVING count(*) > 1) d;
    IF hit IS NOT NULL THEN
      RAISE EXCEPTION '0123 refused: attendance_day holds the same operator twice on one date, which the unique index on (date, operatorId) would refuse: %. Nothing was changed.', hit;
    END IF;
  END IF;
  IF to_regclass('attendance_day') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_day_operatorId_fkey') THEN
    IF to_regclass('attendance_operator') IS NULL THEN
      SELECT format('%s row(s)', count(*)) INTO hit FROM attendance_day HAVING count(*) > 0;
    ELSE
      SELECT format('%s row(s)', count(*)) INTO hit FROM attendance_day d
       WHERE NOT EXISTS (SELECT 1 FROM attendance_operator o WHERE o."id" = d."operatorId") HAVING count(*) > 0;
    END IF;
    IF hit IS NOT NULL THEN
      RAISE EXCEPTION '0123 refused: attendance_day has % naming an operator not on attendance_operator, which the foreign key would refuse. Nothing was changed.', hit;
    END IF;
  END IF;
  IF to_regclass('attendance_leave') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_leave_operatorId_fkey') THEN
    IF to_regclass('attendance_operator') IS NULL THEN
      SELECT format('%s row(s)', count(*)) INTO hit FROM attendance_leave HAVING count(*) > 0;
    ELSE
      SELECT format('%s row(s)', count(*)) INTO hit FROM attendance_leave l
       WHERE NOT EXISTS (SELECT 1 FROM attendance_operator o WHERE o."id" = l."operatorId") HAVING count(*) > 0;
    END IF;
    IF hit IS NOT NULL THEN
      RAISE EXCEPTION '0123 refused: attendance_leave has % naming an operator not on attendance_operator, which the foreign key would refuse. Nothing was changed.', hit;
    END IF;
  END IF;
END $$;

-- What this run adds, read from the catalogue before anything is added, for
-- the log at the end (0121 keeps its list the same way). A second run finds
-- all of it in place, adds nothing and logs nothing.
CREATE TEMP TABLE added (what text, kind text) ON COMMIT DROP;
INSERT INTO added
SELECT 'RoboProductionRecord.productionShift', 'column'
WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = current_schema() AND table_name = 'RoboProductionRecord' AND column_name = 'productionShift');
INSERT INTO added
SELECT what, kind FROM (VALUES
  ('attendance_operator', 'table'),
  ('attendance_day', 'table'),
  ('attendance_leave', 'table'),
  ('attendance_operator_name_key', 'index'),
  ('attendance_day_date_operatorId_key', 'index'),
  ('attendance_day_date_idx', 'index'),
  ('attendance_leave_date_idx', 'index')
) AS t(what, kind)
WHERE to_regclass(format('%I', what)) IS NULL;
INSERT INTO added
SELECT what, 'constraint' FROM (VALUES
  ('attendance_day_operatorId_fkey'),
  ('attendance_leave_operatorId_fkey')
) AS c(what)
WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.what);

-- ═══════════════════════════ THE SHIFT ON EVERY SLAB ═══════════════════════════
-- Nullable, no default, no back-fill: a slab saved before this reads its shift
-- off its own In Time (src/lib/robo/productionShift.ts productionShiftOf), and
-- nothing is written back.
ALTER TABLE "RoboProductionRecord" ADD COLUMN IF NOT EXISTS "productionShift" TEXT;

-- ═══════════════════════════ THE ATTENDANCE REGISTER ═══════════════════════════

-- ───────────────────────────────── the roster ──────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance_operator (
  "id"        TEXT PRIMARY KEY,
  "name"      TEXT NOT NULL,                                   -- unique: one person, one line on the register
  "isActive"  BOOLEAN NOT NULL DEFAULT true,                   -- false = off the roster, history kept
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_operator_name_key ON attendance_operator ("name");
COMMENT ON TABLE attendance_operator IS
  'Attendance register (scripts/0123): the operators of the Robo and Chromia lines, one roster for both. An operator with attendance or leave on record is taken off the roster (isActive false), never deleted.';

-- ──────────────────────────────── the day's row ────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance_day (
  "id"         TEXT PRIMARY KEY,
  "date"       TEXT NOT NULL,                                  -- yyyy-mm-dd
  "operatorId" TEXT NOT NULL,                                  -- -> attendance_operator.id
  "lines"      TEXT NOT NULL DEFAULT '',                       -- 'ROBO' | 'CHROMIA' | 'ROBO,CHROMIA' | ''
  "inTime"     TEXT,                                           -- HH:MM
  "outTime"    TEXT,                                           -- HH:MM
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "attendance_day_date_operatorId_key" ON attendance_day ("date", "operatorId");
CREATE INDEX IF NOT EXISTS attendance_day_date_idx ON attendance_day ("date");
DO $$ BEGIN
  ALTER TABLE attendance_day ADD CONSTRAINT "attendance_day_operatorId_fkey"
    FOREIGN KEY ("operatorId") REFERENCES attendance_operator("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON TABLE attendance_day IS
  'Attendance register (scripts/0123): one operator''s attendance for one date, whichever line or lines they worked. Unique on (date, operatorId), so the same day saved from the Robo and the Chromia screens is one row.';

-- ─────────────────────────────────── leave ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance_leave (
  "id"         TEXT PRIMARY KEY,
  "date"       TEXT NOT NULL,                                  -- yyyy-mm-dd, the date the leave is for
  "operatorId" TEXT NOT NULL,                                  -- -> attendance_operator.id
  "fromTime"   TEXT,                                           -- HH:MM; both empty = the whole day
  "toTime"     TEXT,                                           -- HH:MM
  "reason"     TEXT NOT NULL DEFAULT '',
  "remarks"    TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS attendance_leave_date_idx ON attendance_leave ("date");
DO $$ BEGIN
  ALTER TABLE attendance_leave ADD CONSTRAINT "attendance_leave_operatorId_fkey"
    FOREIGN KEY ("operatorId") REFERENCES attendance_operator("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON TABLE attendance_leave IS
  'Attendance register (scripts/0123): leave asked for by an operator, kept apart from attendance_day because leave is asked in advance and may never become a day worked.';

-- ─────────────────────────────────── the log ────────────────────────────────────
INSERT INTO action_log (id, actor, kind, model, summary, payload)
SELECT gen_random_uuid()::text, 'schema change (scripts/0123)', 'edit', 'AttendanceDay',
       format('The Robo slab''s Shift and the shared attendance register (scripts/0123): %s.',
              CASE WHEN count(*) = 0 THEN 'all of it already in place'
                   ELSE format('added %s of 1 column, %s of 3 tables, %s of 4 indexes and %s of 2 constraints',
                               count(*) FILTER (WHERE kind = 'column'),
                               count(*) FILTER (WHERE kind = 'table'),
                               count(*) FILTER (WHERE kind = 'index'),
                               count(*) FILTER (WHERE kind = 'constraint')) END),
       jsonb_build_object('action', '0123-robo-shift-attendance',
                          'added', COALESCE(jsonb_agg(what ORDER BY what), '[]'::jsonb))
FROM added
HAVING count(*) > 0
    OR NOT EXISTS (SELECT 1 FROM action_log WHERE payload->>'action' = '0123-robo-shift-attendance');

COMMIT;

-- ───────────────────────────────── UNDO ─────────────────────────────────────────
-- By hand, and only after the code that reads these is rolled back: the new
-- Prisma client fails every Robo slab read without the column. It throws away
-- every Shift picked on a slab since (those slabs then read the shift off
-- their In Time again) and every operator, day and leave on the register —
-- read them out first. Children before parents.
--
-- BEGIN;
-- DROP TABLE IF EXISTS attendance_leave;
-- DROP TABLE IF EXISTS attendance_day;
-- DROP TABLE IF EXISTS attendance_operator;
-- ALTER TABLE "RoboProductionRecord" DROP COLUMN IF EXISTS "productionShift";
-- COMMIT;
