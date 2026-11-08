-- 0006 — Grade C → Trimming, a second QC Outcome beside Recalibration.
--
-- Slab Entry's QC Report now offers Grade C two outcomes: Recalibration (as
-- before) and Trimming. A slab graded C → Trimming keeps status GRADED with
-- current_disposition TRIMMING, and is listed on the Trimming page.
--
-- Additive: one enum value. No row is changed. Guarded, so it is safe to run
-- again by hand.

ALTER TYPE "chromia_disposition" ADD VALUE IF NOT EXISTS 'TRIMMING';
