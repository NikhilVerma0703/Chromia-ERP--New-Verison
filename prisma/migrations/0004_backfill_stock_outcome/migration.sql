-- 0004 — Give earlier stock releases the outcome they actually had.
--
-- 0003 added chromia_stock_entry.release_outcome, filled from then on. A slab
-- that left stock BEFORE it — "Dispatched from stock", or cut for samples from
-- stock — has a closed entry with no outcome, so the Stockyard Dashboard would
-- leave it out of Total Dispatched / Total Sample Cutting while still counting
-- it in Total Stock. This names those outcomes from the slab's own records:
--
--   DISPATCH        the entry was closed on the day of one of the slab's
--                   dispatches (recordDispatch closes it with that date);
--   SAMPLE_CUTTING  the entry was closed on the day of one of its sample
--                   cuttings (recordSampleCutting does the same).
--
-- Matched on the date the entry was closed, so an entry closed for any other
-- reason (sent for recalibration from stock, which 0003's Stockyard no longer
-- offers) keeps a null outcome: it left stock, but not by one of the three.
--
-- Only rows with no outcome yet are touched, so it is safe to run again.

UPDATE "chromia_stock_entry" AS e
SET "release_outcome" = 'DISPATCH'
WHERE e."release_outcome" IS NULL
  AND e."released_at" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "chromia_dispatch" d
    WHERE d."slab_id" = e."slab_id" AND d."dispatch_date" = e."released_at"
  );

UPDATE "chromia_stock_entry" AS e
SET "release_outcome" = 'SAMPLE_CUTTING'
WHERE e."release_outcome" IS NULL
  AND e."released_at" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "chromia_sample_cutting" c
    WHERE c."slab_id" = e."slab_id" AND c."cut_date" = e."released_at"
  );
