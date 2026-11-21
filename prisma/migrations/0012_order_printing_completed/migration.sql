-- 0012 — Orders: Printing Completed? (21 Nov 2026).
--
-- A Yes / No on the Order Entry form, shown as Printing Status in Recent
-- Orders: true for Yes, false for No, NULL where nobody has chosen yet.
--
-- Additive: one nullable column. No row is changed (every existing order
-- reads "—" until someone chooses). Guarded, so it is safe to run again.

ALTER TABLE "chromia_order" ADD COLUMN IF NOT EXISTS "printing_completed" BOOLEAN;
