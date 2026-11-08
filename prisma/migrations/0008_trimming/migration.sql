-- 0008 — The Trimming section: one record per slab's trimming.
--
-- chromia_trimming holds, for each slab sent to Trimming, how much it is
-- trimmed (From → To, mm), when it went out and came back, and the QC Report
-- after it. Two sources share it:
--
--   PRODUCTION        graded C → Trimming on Slab Entry; points at its slab.
--   WITHOUT_PRINTING  entered on the Trimming page for a slab that never went
--                     on the line; holds its own details until its QC Report
--                     makes it a Chromia slab.
--
-- Additive: one enum, one table. The backfill at the end gives every slab
-- already graded C → Trimming (status GRADED, outcome TRIMMING) its record,
-- with every trimming field empty. Nothing else is changed.

-- CreateEnum
CREATE TYPE "chromia_trimming_source" AS ENUM ('PRODUCTION', 'WITHOUT_PRINTING');

-- CreateTable
CREATE TABLE "chromia_trimming" (
    "id" TEXT NOT NULL,
    "source" "chromia_trimming_source" NOT NULL,
    "slab_id" TEXT,
    "slab_no" TEXT,
    "batch_no" TEXT,
    "base_material" TEXT,
    "file_name" TEXT,
    "production_date" TIMESTAMP(3),
    "in_time" TEXT,
    "thickness_mm" DECIMAL(18,3),
    "remarks" TEXT,
    "trim_from_mm" DECIMAL(18,3),
    "trim_to_mm" DECIMAL(18,3),
    "sent_date" TIMESTAMP(3),
    "received_date" TIMESTAMP(3),
    "qc_grade" "chromia_slab_grade",
    "qc_disposition" "chromia_disposition",
    "qc_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chromia_trimming_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chromia_trimming_slab_id_key" ON "chromia_trimming"("slab_id");

-- CreateIndex
CREATE UNIQUE INDEX "chromia_trimming_slab_no_key" ON "chromia_trimming"("slab_no");

-- CreateIndex
CREATE INDEX "chromia_trimming_source_idx" ON "chromia_trimming"("source");

-- CreateIndex
CREATE INDEX "chromia_trimming_created_at_idx" ON "chromia_trimming"("created_at");

-- AddForeignKey
ALTER TABLE "chromia_trimming" ADD CONSTRAINT "chromia_trimming_slab_id_fkey" FOREIGN KEY ("slab_id") REFERENCES "chromia_slab"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: every slab already graded C → Trimming gets its (empty) record.
INSERT INTO "chromia_trimming" ("id", "source", "slab_id", "created_at", "updated_at")
SELECT gen_random_uuid()::text, 'PRODUCTION', s."id", s."updated_at", NOW()
FROM "chromia_slab" s
WHERE s."deleted_at" IS NULL
  AND s."status" = 'GRADED'
  AND s."current_disposition" = 'TRIMMING'
  AND NOT EXISTS (SELECT 1 FROM "chromia_trimming" t WHERE t."slab_id" = s."id");
