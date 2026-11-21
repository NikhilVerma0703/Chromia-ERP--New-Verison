-- 0011 — Trimming: every attempt kept (21 Nov 2026).
--
-- A slab graded C → Trimming again after an earlier trimming was finished
-- had its chromia_trimming record cleared for the new one, so the earlier
-- trimming lived on only in the slab's history. The Trimming Dashboard counts
-- every attempt (as the Recalibration Dashboard does), so the finished one is
-- now kept here before the record is cleared.
--
-- Additive: one table. No row is changed. Guarded, so it is safe to run again.

CREATE TABLE IF NOT EXISTS "chromia_trimming_attempt" (
    "id" TEXT NOT NULL,
    "trimming_id" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "trim_from_mm" DECIMAL(18,3),
    "trim_to_mm" DECIMAL(18,3),
    "sent_date" TIMESTAMP(3),
    "received_date" TIMESTAMP(3),
    "qc_grade" "chromia_slab_grade",
    "qc_disposition" "chromia_disposition",
    "qc_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chromia_trimming_attempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "chromia_trimming_attempt_trimming_id_attempt_number_key" ON "chromia_trimming_attempt"("trimming_id", "attempt_number");

DO $$ BEGIN
  ALTER TABLE "chromia_trimming_attempt" ADD CONSTRAINT "chromia_trimming_attempt_trimming_id_fkey" FOREIGN KEY ("trimming_id") REFERENCES "chromia_trimming"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
