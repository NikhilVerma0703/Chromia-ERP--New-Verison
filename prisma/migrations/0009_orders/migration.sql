-- 0009 — Orders: a standalone record of customer orders (17 Nov 2026).
--
-- One new table. It has no foreign key to any slab table, and no production
-- count, KPI or report reads it. Its Reference Photo is stored in entry_photo
-- (model 'ChromiaOrder'), as the original and as annotated, by id.
--
-- Additive: no existing table or row is changed.

-- CreateTable
CREATE TABLE "chromia_order" (
    "id" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "requested_by" TEXT,
    "design_name" TEXT,
    "base_material_name" TEXT,
    "printing_file_name" TEXT,
    "quantity" INTEGER,
    "thickness_mm" DECIMAL(18,3),
    "finishing_type" TEXT,
    "requested_delivery_date" TIMESTAMP(3),
    "actual_delivery_date" TIMESTAMP(3),
    "person_in_charge" TEXT,
    "remarks" TEXT,
    "photo_original_id" TEXT,
    "photo_edited_id" TEXT,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chromia_order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chromia_order_created_at_idx" ON "chromia_order"("created_at");

-- CreateIndex
CREATE INDEX "chromia_order_actual_delivery_date_idx" ON "chromia_order"("actual_delivery_date");
