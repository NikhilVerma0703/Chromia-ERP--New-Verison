-- 0005 — The old "Awaiting dispatch" queue goes into the Stockyard.
--
-- Until 27 Oct 2026 a Grade A slab could be sent at QC to Dispatch, where it
-- waited (status GRADED, outcome DISPATCH) for the Dispatch page to send it.
-- Since change 1 Grade A goes to Stock instead, and since change 4 the
-- Dispatch page is a read-only list of dispatched slabs — so a slab still
-- waiting in that queue would have no screen left to be dispatched from.
--
-- Each one is put on the rack, exactly as recordStock would have put it there
-- (the owner's choice), so it leaves the plant from the Stockyard like every
-- Grade A slab now:
--
--   * a stock entry, dated the day it was graded (its latest Dispatch grade
--     decision; failing that, its last update), on the first active stock rack;
--   * status IN_STOCK, outcome STOCK, location that rack;
--   * a STOCKED event in its history saying why it moved.
--
-- Its grade, its grade decision (A → Dispatch, as decided) and everything else
-- are untouched. A slab already dispatched is not in the queue and is not
-- touched. Run twice, it finds nothing the second time.

WITH queued AS (
  SELECT s."id",
         COALESCE(
           (SELECT MAX(g."decided_at") FROM "chromia_grade_decision" g
             WHERE g."slab_id" = s."id" AND g."disposition" = 'DISPATCH'),
           s."updated_at"
         ) AS graded_at
  FROM "chromia_slab" s
  WHERE s."deleted_at" IS NULL
    AND s."status" = 'GRADED'
    AND s."current_disposition" = 'DISPATCH'
),
rack AS (
  SELECT "id" FROM "chromia_location"
  WHERE "type" = 'STOCK_RACK' AND "is_active"
  ORDER BY "created_at", "id"
  LIMIT 1
),
entries AS (
  INSERT INTO "chromia_stock_entry" ("id", "stock_date", "slab_id", "location_id", "notes", "updated_at")
  SELECT gen_random_uuid()::text, q.graded_at, q."id", (SELECT "id" FROM rack),
         'Moved from the Dispatch queue to the Stockyard (migration 0005)', NOW()
  FROM queued q
  RETURNING "slab_id", "stock_date"
),
events AS (
  INSERT INTO "chromia_slab_event" ("id", "event_type", "slab_id", "from_status", "to_status", "location_id", "occurred_at", "note")
  SELECT gen_random_uuid()::text, 'STOCKED', e."slab_id", 'GRADED', 'IN_STOCK', (SELECT "id" FROM rack), NOW(),
         'Moved to the Stockyard: graded A → Dispatch before 27 Oct 2026, when Dispatch became a read-only list. Dispatch it from the Stockyard.'
  FROM entries e
  RETURNING "slab_id"
)
UPDATE "chromia_slab" AS s
SET "status" = 'IN_STOCK',
    "current_disposition" = 'STOCK',
    "current_location_id" = COALESCE((SELECT "id" FROM rack), s."current_location_id"),
    "updated_at" = NOW()
WHERE s."id" IN (SELECT "slab_id" FROM events);
