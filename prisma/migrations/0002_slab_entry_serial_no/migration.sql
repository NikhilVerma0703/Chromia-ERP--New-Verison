-- 0002 — S.No. on every slab, numbered by the database.
--
-- Slab Entry's S.No. is the slab's number within its own production date, as
-- the paper register numbers it: seven slabs already entered for 23 October,
-- and two more entered for 23 October on the 27th, are 8 and 9. Until now it
-- was counted afresh on every page load. It is a stored column now, so it
-- stays what it was when the row was written.
--
-- WHAT THIS DOES, IN ORDER
--   1. adds chromia_slab.entry_serial_no;
--   2. numbers the slabs already there, per production date, in the order
--      they were entered — exactly the numbers the screen counted before, so
--      no row's S.No. changes on the day this runs (soft-deleted rows were
--      never counted and are left unnumbered);
--   3. makes (received_date, entry_serial_no) unique, so no date can ever hold
--      the same number twice, whoever writes it;
--   4. adds the trigger that numbers every new slab, and every slab whose
--      production date changes, as the next number on that date.
--
-- THE TRIGGER IS THE ONLY NUMBERER. Slabs are written by four paths — Slab
-- Entry, the register import, the Slab Records correction and the restart
-- after recalibration (the last two can change the date) — and none of them
-- computes a number. The trigger takes a transaction-scoped advisory lock on
-- the date before reading its highest number, so two saves for the same date
-- at the same moment queue for it instead of both taking N+1; the unique index
-- is the backstop behind the lock.
--
-- A slab whose date is corrected takes the next number on its new date and
-- leaves a gap on the old one. A deleted slab leaves a gap too (unless it was
-- the last on its date, whose number the next slab then takes): the numbers
-- after it do not move, which is the point of storing them.
--
-- Additive: one nullable column, one index, one function, one trigger. No row
-- is deleted and no existing column is changed. Idempotent, so it is safe to
-- run once more by hand on a database that already has it.

-- 1. The column ---------------------------------------------------------------
ALTER TABLE "chromia_slab" ADD COLUMN IF NOT EXISTS "entry_serial_no" INTEGER;

-- 2. Number what is already there ---------------------------------------------
WITH numbered AS (
  SELECT "id",
         ROW_NUMBER() OVER (PARTITION BY "received_date" ORDER BY "created_at", "id") AS n
  FROM "chromia_slab"
  WHERE "deleted_at" IS NULL
)
UPDATE "chromia_slab" AS s
SET "entry_serial_no" = numbered.n
FROM numbered
WHERE s."id" = numbered."id"
  AND s."entry_serial_no" IS NULL;

-- 3. One number per date, ever ------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "chromia_slab_received_date_entry_serial_no_key"
  ON "chromia_slab"("received_date", "entry_serial_no");

-- 4. The numberer ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION chromia_slab_entry_serial() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."entry_serial_no" IS NOT NULL THEN
      RETURN NEW; -- a number given explicitly is kept; the unique index judges it
    END IF;
  ELSIF NEW."received_date" IS NOT DISTINCT FROM OLD."received_date" THEN
    RETURN NEW; -- same date, same number
  END IF;

  -- One writer per date at a time, until this transaction ends.
  PERFORM pg_advisory_xact_lock(
    hashtext('chromia_slab.entry_serial_no'),
    hashtext(NEW."received_date"::text)
  );

  SELECT COALESCE(MAX("entry_serial_no"), 0) + 1
    INTO NEW."entry_serial_no"
    FROM "chromia_slab"
   WHERE "received_date" = NEW."received_date"
     AND "id" <> NEW."id";

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chromia_slab_entry_serial ON "chromia_slab";
CREATE TRIGGER chromia_slab_entry_serial
  BEFORE INSERT OR UPDATE OF "received_date" ON "chromia_slab"
  FOR EACH ROW EXECUTE FUNCTION chromia_slab_entry_serial();
