-- 0003 — Stockyard → Stock Outcome: Dispatch, Approved or Sample Cutting.
--
-- A stocked slab now leaves the rack by one of three outcomes, each with the
-- date it happened. Dispatch and Sample Cutting already had records of their
-- own (chromia_dispatch, chromia_sample_cutting) and slab statuses
-- (DISPATCHED, SAMPLE_CUT); Approved had neither, so:
--
--   1. chromia_slab_status gains APPROVED — the status a slab sent from the
--      Stockyard as Approved carries until its own section exists;
--   2. chromia_stock_outcome is the new list of the three outcomes;
--   3. chromia_stock_entry.release_outcome records which of them closed the
--      entry, beside released_at, which already held the date.
--
-- Additive: one enum value, one enum type, one nullable column. No row is
-- changed — entries released before this keep a null outcome. Each step is
-- guarded, so the script is safe to run again by hand.

-- 1. The status ---------------------------------------------------------------
ALTER TYPE "chromia_slab_status" ADD VALUE IF NOT EXISTS 'APPROVED';

-- 2. The outcomes -------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'chromia_stock_outcome') THEN
    CREATE TYPE "chromia_stock_outcome" AS ENUM ('DISPATCH', 'APPROVED', 'SAMPLE_CUTTING');
  END IF;
END
$$;

-- 3. Which outcome closed the stock entry --------------------------------------
ALTER TABLE "chromia_stock_entry" ADD COLUMN IF NOT EXISTS "release_outcome" "chromia_stock_outcome";
