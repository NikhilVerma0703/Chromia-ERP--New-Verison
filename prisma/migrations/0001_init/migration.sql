-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "chromia_role" AS ENUM ('ADMIN', 'PRODUCTION_MANAGER', 'SUPERVISOR', 'OPERATOR', 'QUALITY_INSPECTOR', 'STORE_KEEPER', 'VIEWER');

-- CreateEnum
CREATE TYPE "chromia_user_status" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "chromia_process_stage" AS ENUM ('INCOMING', 'INCOMING_DETAILS', 'BASE_PRIMER', 'PRINTING', 'MOULDING', 'COOLING', 'POLISHING', 'UV_POLISHING', 'QUALITY_CHECK', 'GRADE_DECISION');

-- CreateEnum
CREATE TYPE "chromia_stage_status" AS ENUM ('PENDING', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "chromia_slab_status" AS ENUM ('RECEIVED', 'IN_PROCESS', 'UNDER_INSPECTION', 'GRADED', 'OUT_FOR_RECALIBRATION', 'RECEIVED_FROM_RECALIBRATION', 'IN_STOCK', 'SAMPLE_CUT', 'DISPATCHED', 'WASTE', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "chromia_cycle_status" AS ENUM ('ACTIVE', 'COMPLETED', 'ABORTED');

-- CreateEnum
CREATE TYPE "chromia_slab_grade" AS ENUM ('A', 'B', 'C');

-- CreateEnum
CREATE TYPE "chromia_disposition" AS ENUM ('DISPATCH', 'STOCK', 'SAMPLE_CUTTING', 'RECALIBRATION', 'WASTE');

-- CreateEnum
CREATE TYPE "chromia_print_result" AS ENUM ('FULLY_PRINTED', 'HALF_PRINT', 'BYPASSED');

-- CreateEnum
CREATE TYPE "chromia_qc_verdict" AS ENUM ('PASS', 'CONDITIONAL_PASS', 'FAIL');

-- CreateEnum
CREATE TYPE "chromia_qc_check_result" AS ENUM ('PASS', 'FAIL', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "chromia_defect_severity" AS ENUM ('MINOR', 'MAJOR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "chromia_recalibration_status" AS ENUM ('PENDING_DISPATCH', 'SENT', 'AT_FACILITY', 'RECEIVED', 'RESTARTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "chromia_location_type" AS ENUM ('YARD', 'RACK', 'MACHINE_BAY', 'COOLING_ZONE', 'QC_AREA', 'DISPATCH_BAY', 'STOCK_RACK', 'SAMPLE_AREA', 'EXTERNAL_FACILITY', 'WASTE_AREA');

-- CreateEnum
CREATE TYPE "chromia_machine_type" AS ENUM ('PRIMER_LINE', 'PRINTER', 'MOULDING_PRESS', 'COOLING_RACK', 'POLISHING_LINE', 'UV_LINE', 'OTHER');

-- CreateEnum
CREATE TYPE "chromia_movement_reason" AS ENUM ('INTAKE', 'STAGE_TRANSFER', 'QC_TRANSFER', 'RECALIBRATION_OUT', 'RECALIBRATION_IN', 'DISPATCH', 'STOCK_PUTAWAY', 'SAMPLE_CUTTING', 'WASTE_DISPOSAL', 'CORRECTION');

-- CreateEnum
CREATE TYPE "chromia_slab_event_type" AS ENUM ('SLAB_CREATED', 'STAGE_STARTED', 'STAGE_COMPLETED', 'STAGE_HELD', 'STAGE_RESUMED', 'CYCLE_STARTED', 'CYCLE_COMPLETED', 'QC_RECORDED', 'GRADE_ASSIGNED', 'RECALIBRATION_SENT', 'RECALIBRATION_RECEIVED', 'RECALIBRATION_RESTARTED', 'LOCATION_CHANGED', 'STATUS_CHANGED', 'DISPATCHED', 'STOCKED', 'SAMPLE_CUT', 'DECLARED_WASTE', 'CORRECTION');

-- CreateEnum
CREATE TYPE "chromia_import_status" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "chromia_audit_action" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'RESTORE', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT');

-- CreateEnum
CREATE TYPE "SlabStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'PACKED', 'DISPATCHED', 'RETURNED', 'CTS', 'CHROMIA');

-- CreateEnum
CREATE TYPE "SlabSource" AS ENUM ('QC_AUTOLINK', 'BULK_UPLOAD', 'MANUAL_ENTRY');

-- CreateTable
CREATE TABLE "chromia_user" (
    "id" TEXT NOT NULL,
    "employee_code" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT,
    "role" "chromia_role" NOT NULL DEFAULT 'OPERATOR',
    "status" "chromia_user_status" NOT NULL DEFAULT 'ACTIVE',
    "phone" TEXT,
    "shift" TEXT,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "chromia_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chromia_audit_log" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" "chromia_audit_action" NOT NULL,
    "user_id" TEXT,
    "changes" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chromia_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chromia_base_material" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "default_thickness_mm" DECIMAL(18,3),
    "min_usable_thickness_mm" DECIMAL(18,3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "chromia_base_material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chromia_design" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "version" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "chromia_design_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chromia_machine" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "chromia_machine_type" NOT NULL,
    "stage" "chromia_process_stage",
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "location_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "chromia_machine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chromia_location" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "chromia_location_type" NOT NULL,
    "capacity" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "parent_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "chromia_location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chromia_stage_definition" (
    "id" TEXT NOT NULL,
    "stage" "chromia_process_stage" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "expected_duration_minutes" INTEGER NOT NULL,
    "warn_after_minutes" INTEGER,
    "requires_machine" BOOLEAN NOT NULL DEFAULT false,
    "requires_operator" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chromia_stage_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chromia_defect_type" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "origin_stage" "chromia_process_stage",
    "default_severity" "chromia_defect_severity" NOT NULL DEFAULT 'MAJOR',
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "chromia_defect_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chromia_recalibration_reason" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "origin_stage" "chromia_process_stage",
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "chromia_recalibration_reason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chromia_supplier" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_person" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "chromia_supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chromia_customer" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_person" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "chromia_customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chromia_batch" (
    "id" TEXT NOT NULL,
    "batch_no" TEXT NOT NULL,
    "received_date" TIMESTAMP(3) NOT NULL,
    "total_slabs" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "base_material_id" TEXT NOT NULL,
    "supplier_id" TEXT,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "chromia_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chromia_slab" (
    "id" TEXT NOT NULL,
    "slab_no" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "base_material_id" TEXT NOT NULL,
    "planned_design_id" TEXT,
    "original_thickness_mm" DECIMAL(18,3),
    "current_thickness_mm" DECIMAL(18,3),
    "length_mm" DECIMAL(18,3),
    "width_mm" DECIMAL(18,3),
    "status" "chromia_slab_status" NOT NULL DEFAULT 'RECEIVED',
    "current_stage" "chromia_process_stage",
    "current_cycle_number" INTEGER NOT NULL DEFAULT 1,
    "current_location_id" TEXT,
    "current_grade" "chromia_slab_grade",
    "current_disposition" "chromia_disposition",
    "recalibration_count" INTEGER NOT NULL DEFAULT 0,
    "is_recalibration_out" BOOLEAN NOT NULL DEFAULT false,
    "received_date" TIMESTAMP(3) NOT NULL,
    "condition_on_arrival" TEXT,
    "remarks" TEXT,
    "legacy_source_file" TEXT,
    "legacy_sheet_name" TEXT,
    "legacy_source_row" INTEGER,
    "legacy_remark" TEXT,
    "import_batch_id" TEXT,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "chromia_slab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chromia_process_cycle" (
    "id" TEXT NOT NULL,
    "cycle_number" INTEGER NOT NULL,
    "status" "chromia_cycle_status" NOT NULL DEFAULT 'ACTIVE',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "slab_id" TEXT NOT NULL,
    "design_id" TEXT,
    "in_time" TIMESTAMP(3),
    "out_time" TIMESTAMP(3),
    "processing_minutes" INTEGER,
    "fully_printed_date" DATE,
    "print_result" "chromia_print_result",
    "final_grade" "chromia_slab_grade",
    "disposition" "chromia_disposition",
    "notes" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chromia_process_cycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chromia_stage_record" (
    "id" TEXT NOT NULL,
    "stage" "chromia_process_stage" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "chromia_stage_status" NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "duration_minutes" INTEGER,
    "hold_minutes" INTEGER,
    "is_overdue" BOOLEAN NOT NULL DEFAULT false,
    "cycle_id" TEXT NOT NULL,
    "slab_id" TEXT NOT NULL,
    "operator_id" TEXT,
    "machine_id" TEXT,
    "location_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chromia_stage_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chromia_slab_event" (
    "id" TEXT NOT NULL,
    "event_type" "chromia_slab_event_type" NOT NULL,
    "slab_id" TEXT NOT NULL,
    "cycle_id" TEXT,
    "stage" "chromia_process_stage",
    "from_stage" "chromia_process_stage",
    "to_stage" "chromia_process_stage",
    "from_status" "chromia_slab_status",
    "to_status" "chromia_slab_status",
    "location_id" TEXT,
    "user_id" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "payload" JSONB,

    CONSTRAINT "chromia_slab_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chromia_slab_movement" (
    "id" TEXT NOT NULL,
    "reason" "chromia_movement_reason" NOT NULL,
    "moved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "slab_id" TEXT NOT NULL,
    "from_location_id" TEXT,
    "to_location_id" TEXT NOT NULL,
    "moved_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chromia_slab_movement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chromia_incoming_detail" (
    "id" TEXT NOT NULL,
    "stage_record_id" TEXT NOT NULL,
    "confirmed_length_mm" DECIMAL(18,3),
    "confirmed_width_mm" DECIMAL(18,3),
    "confirmed_thickness_mm" DECIMAL(18,3),
    "material_grade" TEXT,
    "surface_condition" TEXT,
    "planned_production_date" TIMESTAMP(3),
    "planned_shift" TEXT,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chromia_incoming_detail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chromia_primer_detail" (
    "id" TEXT NOT NULL,
    "stage_record_id" TEXT NOT NULL,
    "primer_type" TEXT,
    "primer_batch_code" TEXT,
    "coating_thickness_micron" DECIMAL(18,3),
    "drying_minutes" INTEGER,
    "ambient_temp_c" DECIMAL(18,3),
    "humidity_percent" DECIMAL(18,3),
    "defects_observed" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chromia_primer_detail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chromia_printing_detail" (
    "id" TEXT NOT NULL,
    "stage_record_id" TEXT NOT NULL,
    "design_id" TEXT,
    "file_name" TEXT,
    "print_result" "chromia_print_result",
    "fully_printed_at" TIMESTAMP(3),
    "bypassed_at" TIMESTAMP(3),
    "pass_count" INTEGER,
    "ink_set" TEXT,
    "colour_profile" TEXT,
    "colour_deviation" TEXT,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chromia_printing_detail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chromia_moulding_detail" (
    "id" TEXT NOT NULL,
    "stage_record_id" TEXT NOT NULL,
    "mould_ref" TEXT,
    "temperature_c" DECIMAL(18,3),
    "pressure_bar" DECIMAL(18,3),
    "cycle_time_minutes" INTEGER,
    "defects_observed" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chromia_moulding_detail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chromia_cooling_detail" (
    "id" TEXT NOT NULL,
    "stage_record_id" TEXT NOT NULL,
    "required_minutes" INTEGER,
    "actual_minutes" INTEGER,
    "cooling_zone" TEXT,
    "ambient_temp_c" DECIMAL(18,3),
    "stress_cracks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chromia_cooling_detail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chromia_polishing_detail" (
    "id" TEXT NOT NULL,
    "stage_record_id" TEXT NOT NULL,
    "grit_sequence" TEXT,
    "pass_count" INTEGER,
    "gloss_achieved" DECIMAL(18,3),
    "defects_observed" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chromia_polishing_detail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chromia_uv_polishing_detail" (
    "id" TEXT NOT NULL,
    "stage_record_id" TEXT NOT NULL,
    "coat_type" TEXT,
    "coat_batch_code" TEXT,
    "coat_count" INTEGER,
    "lamp_intensity" DECIMAL(18,3),
    "line_speed" DECIMAL(18,3),
    "cure_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "final_gloss" DECIMAL(18,3),
    "defects_observed" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chromia_uv_polishing_detail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chromia_qc_record" (
    "id" TEXT NOT NULL,
    "inspected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verdict" "chromia_qc_verdict" NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "slab_id" TEXT NOT NULL,
    "inspector_id" TEXT,
    "print_quality_result" "chromia_qc_check_result" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "colour_match_result" "chromia_qc_check_result" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "surface_finish_result" "chromia_qc_check_result" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "gloss_result" "chromia_qc_check_result" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "dimensional_result" "chromia_qc_check_result" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "edge_condition_result" "chromia_qc_check_result" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "gloss_reading" DECIMAL(18,3),
    "colour_deviation" TEXT,
    "photo_urls" TEXT[],
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chromia_qc_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chromia_qc_defect" (
    "id" TEXT NOT NULL,
    "severity" "chromia_defect_severity" NOT NULL,
    "area_on_slab" TEXT,
    "description" TEXT,
    "photo_url" TEXT,
    "qc_record_id" TEXT NOT NULL,
    "defect_type_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chromia_qc_defect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chromia_grade_decision" (
    "id" TEXT NOT NULL,
    "grade" "chromia_slab_grade" NOT NULL,
    "disposition" "chromia_disposition" NOT NULL,
    "reason" TEXT,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remarks" TEXT,
    "cycle_id" TEXT NOT NULL,
    "slab_id" TEXT NOT NULL,
    "decided_by_id" TEXT,
    "target_location_id" TEXT,
    "attempt_number_at_decision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chromia_grade_decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chromia_recalibration_cycle" (
    "id" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "status" "chromia_recalibration_status" NOT NULL DEFAULT 'PENDING_DISPATCH',
    "slab_id" TEXT NOT NULL,
    "failed_cycle_id" TEXT,
    "restarted_cycle_id" TEXT,
    "reason_id" TEXT,
    "reason_notes" TEXT,
    "sent_date" TIMESTAMP(3),
    "expected_return_date" TIMESTAMP(3),
    "facility_name" TEXT,
    "gate_pass_no" TEXT,
    "transporter" TEXT,
    "vehicle_no" TEXT,
    "condition_on_send" TEXT,
    "issued_by_id" TEXT,
    "received_date" TIMESTAMP(3),
    "turnaround_days" INTEGER,
    "condition_on_return" TEXT,
    "work_accepted" BOOLEAN,
    "received_by_id" TEXT,
    "thickness_before_mm" DECIMAL(18,3),
    "thickness_after_mm" DECIMAL(18,3),
    "material_removed_mm" DECIMAL(18,3),
    "within_min_thickness" BOOLEAN,
    "photo_urls" TEXT[],
    "notes" TEXT,
    "restarted_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chromia_recalibration_cycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chromia_dispatch" (
    "id" TEXT NOT NULL,
    "dispatch_date" TIMESTAMP(3) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "order_no" TEXT,
    "invoice_no" TEXT,
    "vehicle_no" TEXT,
    "destination" TEXT,
    "notes" TEXT,
    "slab_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "dispatched_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chromia_dispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chromia_stock_entry" (
    "id" TEXT NOT NULL,
    "stock_date" TIMESTAMP(3) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "released_at" TIMESTAMP(3),
    "notes" TEXT,
    "slab_id" TEXT NOT NULL,
    "location_id" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chromia_stock_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chromia_sample_cutting" (
    "id" TEXT NOT NULL,
    "cut_date" TIMESTAMP(3) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "pieces_produced" INTEGER,
    "purpose" TEXT,
    "destination" TEXT,
    "notes" TEXT,
    "slab_id" TEXT NOT NULL,
    "done_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chromia_sample_cutting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chromia_waste_record" (
    "id" TEXT NOT NULL,
    "declared_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "slab_id" TEXT NOT NULL,
    "cycles_consumed" INTEGER NOT NULL DEFAULT 0,
    "recalibrations_attempted" INTEGER NOT NULL DEFAULT 0,
    "final_defect_type_id" TEXT,
    "root_cause" TEXT,
    "disposal_ref" TEXT,
    "notes" TEXT,
    "authorised_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chromia_waste_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chromia_import_batch" (
    "id" TEXT NOT NULL,
    "source_file" TEXT NOT NULL,
    "sheet_name" TEXT,
    "period_label" TEXT,
    "status" "chromia_import_status" NOT NULL DEFAULT 'PENDING',
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "imported_rows" INTEGER NOT NULL DEFAULT 0,
    "skipped_rows" INTEGER NOT NULL DEFAULT 0,
    "failed_rows" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "error_log" JSONB,
    "notes" TEXT,
    "imported_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chromia_import_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_operator" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "attendance_operator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_day" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "lines" TEXT NOT NULL DEFAULT '',
    "inTime" TEXT,
    "outTime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_day_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_leave" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "fromTime" TEXT,
    "toTime" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "leaveType" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "attendance_leave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entry_photo" (
    "id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "taken_by" TEXT,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entry_photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fg_finished_slab" (
    "id" TEXT NOT NULL,
    "slab_number" DOUBLE PRECISION NOT NULL,
    "design" TEXT,
    "grade" TEXT,
    "slab_mark" TEXT NOT NULL DEFAULT 'FULL_SLAB',
    "slab_thickness" TEXT,
    "quality_issue" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "polish_type" TEXT,
    "rw_status" TEXT,
    "repolish_status" TEXT,
    "batch_number" TEXT,
    "batch_key" TEXT,
    "barcode" TEXT,
    "qc_inspector" TEXT,
    "last_qc_at" TIMESTAMP(3),
    "length_in" DOUBLE PRECISION DEFAULT 137,
    "width_in" DOUBLE PRECISION DEFAULT 79,
    "bay_number" TEXT,
    "frame_number" TEXT,
    "status" "SlabStatus" NOT NULL DEFAULT 'AVAILABLE',
    "reserved_for_pi" TEXT,
    "customer" TEXT,
    "reserved_at" TIMESTAMP(3),
    "reservation_expires_at" TIMESTAMP(3),
    "notes" TEXT,
    "source" "SlabSource" NOT NULL DEFAULT 'QC_AUTOLINK',
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fg_finished_slab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fg_design_alias" (
    "id" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "canonical" TEXT NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fg_design_alias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_name" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "is_trial" BOOLEAN NOT NULL DEFAULT false,
    "filler_type" TEXT,
    "grit_type" TEXT,
    "filler_size" TEXT,
    "grit_size" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "design_name_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fg_slab_event" (
    "id" TEXT NOT NULL,
    "slab_number" DOUBLE PRECISION NOT NULL,
    "kind" TEXT NOT NULL,
    "field" TEXT,
    "old_value" TEXT,
    "new_value" TEXT,
    "changed_by" TEXT,
    "source" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fg_slab_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fg_sales_approved_batch" (
    "design" TEXT NOT NULL,
    "batch" TEXT NOT NULL DEFAULT '',
    "approved_by" TEXT,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fg_sales_approved_batch_pkey" PRIMARY KEY ("design","batch")
);

-- CreateTable
CREATE TABLE "fg_sales_hidden_design" (
    "design" TEXT NOT NULL,
    "hidden_by" TEXT,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "batch" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "fg_sales_hidden_design_pkey" PRIMARY KEY ("design","batch")
);

-- CreateTable
CREATE TABLE "commercial_design_code" (
    "design" TEXT NOT NULL,
    "code" TEXT,
    "shade" TEXT,
    "shade_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "colour_name" TEXT,
    "hex" TEXT,
    "lab_l" DECIMAL(6,2),
    "lab_a" DECIMAL(6,2),
    "lab_b" DECIMAL(6,2),
    "alternate_names" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commercial_design_code_pkey" PRIMARY KEY ("design")
);

-- CreateTable
CREATE TABLE "polish_qc" (
    "id" TEXT NOT NULL,
    "airtableId" TEXT NOT NULL,
    "slab_number" DOUBLE PRECISION,
    "batch_number" TEXT,
    "design" TEXT,
    "created_time" TIMESTAMP(3),
    "last_modified_by" JSONB,
    "rw_status" TEXT,
    "repolish_status" TEXT,
    "inspector" TEXT,
    "going_to_dispatch" TEXT,
    "rw_done_by" TEXT,
    "slab_thickness" TEXT,
    "quality_issue" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "quality_grade" TEXT,
    "quality_grade_before_cts" TEXT,
    "slab_mark" TEXT NOT NULL DEFAULT 'FULL_SLAB',
    "top_polish" BOOLEAN NOT NULL DEFAULT false,
    "bottom_polish" BOOLEAN NOT NULL DEFAULT false,
    "lamination" BOOLEAN NOT NULL DEFAULT false,
    "sku" TEXT,
    "bay" TEXT,
    "polish_type" TEXT,
    "dispatch_status" TEXT,
    "barcode" JSONB,
    "barcode_api_link" JSONB,
    "link" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "barcode_from_link" JSONB,
    "batch_number_from_link" JSONB,
    "main_body_l" DOUBLE PRECISION,
    "main_body_a" DOUBLE PRECISION,
    "main_body_b" DOUBLE PRECISION,
    "b_body_l" DOUBLE PRECISION,
    "b_body_a" DOUBLE PRECISION,
    "b_body_b" DOUBLE PRECISION,
    "f_3rd_body_l" DOUBLE PRECISION,
    "f_3rd_body_a" DOUBLE PRECISION,
    "f_3rd_body_b" DOUBLE PRECISION,
    "image" JSONB,
    "shed_4_to_5" BOOLEAN NOT NULL DEFAULT false,
    "sent_to_chromia" BOOLEAN NOT NULL DEFAULT false,
    "remarks" TEXT,
    "formula" JSONB,
    "printed" BOOLEAN NOT NULL DEFAULT false,
    "chromia_1" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "slab_summary" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "slab_segregation" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "chromia_1_copy" TEXT,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "synced_at" TIMESTAMP(3) NOT NULL,
    "batch_key" TEXT,
    "entered_by_user_id" TEXT,

    CONSTRAINT "polish_qc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "press" (
    "id" TEXT NOT NULL,
    "airtableId" TEXT NOT NULL,
    "batch" TEXT,
    "operator" TEXT,
    "design_name" TEXT,
    "slab_number" DOUBLE PRECISION,
    "created_time" TIMESTAMP(3),
    "date" TIMESTAMP(3),
    "in_time" DOUBLE PRECISION,
    "slab_weight" DOUBLE PRECISION,
    "temperature_in_degree_celsius_note_only_at_15_00_and_3_00" DOUBLE PRECISION,
    "no_of_vacuum_pumps" DOUBLE PRECISION,
    "no_of_stages" DOUBLE PRECISION,
    "vacuum_delay_in_seconds" DOUBLE PRECISION,
    "lowe_chamber_vacuum_in_mbar" DOUBLE PRECISION,
    "pinhole_cycle" TEXT,
    "pinhole_cycle_phase" TEXT,
    "pinhole_cycle_delay" DOUBLE PRECISION,
    "phase_1_rev" DOUBLE PRECISION,
    "phase_2_rev" DOUBLE PRECISION,
    "phase_3_rev" DOUBLE PRECISION,
    "phase_4_rev" DOUBLE PRECISION,
    "phase_5_rev" DOUBLE PRECISION,
    "phase_1_pressing_time" DOUBLE PRECISION,
    "phase_2_pressing_time" DOUBLE PRECISION,
    "phase_3_pressing_time" DOUBLE PRECISION,
    "phase_4_pressing_time" DOUBLE PRECISION,
    "phase_5_pressing_time" DOUBLE PRECISION,
    "phase_1_acceleration_time" DOUBLE PRECISION,
    "phase_2_acceleration_time" DOUBLE PRECISION,
    "phase_3_acceleration_time" DOUBLE PRECISION,
    "phase_4_acceleration_time" DOUBLE PRECISION,
    "phase_5_acceleration_time" DOUBLE PRECISION,
    "phase_1_pressure" DOUBLE PRECISION,
    "phase_2_pressure" DOUBLE PRECISION,
    "phase_3_pressure" DOUBLE PRECISION,
    "phase_4_pressure" DOUBLE PRECISION,
    "phase_5_pressure" DOUBLE PRECISION,
    "cycle_time_sec" DOUBLE PRECISION,
    "remarks" TEXT,
    "slab_summary" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "automation_log" TEXT,
    "batch_wastage" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "production_report" TEXT,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "synced_at" TIMESTAMP(3) NOT NULL,
    "batch_key" TEXT,
    "entered_by_user_id" TEXT,
    "vacuum_pumps" TEXT,

    CONSTRAINT "press_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jot" (
    "id" TEXT NOT NULL,
    "airtableId" TEXT NOT NULL,
    "batch" TEXT,
    "design_name" TEXT,
    "operator" TEXT,
    "slab_number" DOUBLE PRECISION,
    "date" TIMESTAMP(3),
    "created_time" TIMESTAMP(3),
    "shift" TEXT,
    "slab_weight" DOUBLE PRECISION,
    "thickness" TEXT,
    "thickness_at_1" DOUBLE PRECISION,
    "thickness_at_2" DOUBLE PRECISION,
    "thickness_at_3" DOUBLE PRECISION,
    "thickness_at_4" DOUBLE PRECISION,
    "thickness_at_5" DOUBLE PRECISION,
    "thickness_at_6" DOUBLE PRECISION,
    "thickness_at_7" DOUBLE PRECISION,
    "thickness_at_8" DOUBLE PRECISION,
    "bend_mm" DOUBLE PRECISION,
    "slab_defect" TEXT,
    "defect_photo" JSONB,
    "remarks" TEXT,
    "slab_summary" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "synced_at" TIMESTAMP(3) NOT NULL,
    "batch_key" TEXT,
    "entered_by_user_id" TEXT,

    CONSTRAINT "jot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chromia_user_employee_code_key" ON "chromia_user"("employee_code");

-- CreateIndex
CREATE UNIQUE INDEX "chromia_user_email_key" ON "chromia_user"("email");

-- CreateIndex
CREATE INDEX "chromia_user_role_status_idx" ON "chromia_user"("role", "status");

-- CreateIndex
CREATE INDEX "chromia_user_deleted_at_idx" ON "chromia_user"("deleted_at");

-- CreateIndex
CREATE INDEX "chromia_audit_log_entity_entity_id_idx" ON "chromia_audit_log"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "chromia_audit_log_user_id_idx" ON "chromia_audit_log"("user_id");

-- CreateIndex
CREATE INDEX "chromia_audit_log_occurred_at_idx" ON "chromia_audit_log"("occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "chromia_base_material_code_key" ON "chromia_base_material"("code");

-- CreateIndex
CREATE INDEX "chromia_base_material_is_active_idx" ON "chromia_base_material"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "chromia_design_code_key" ON "chromia_design"("code");

-- CreateIndex
CREATE INDEX "chromia_design_is_active_idx" ON "chromia_design"("is_active");

-- CreateIndex
CREATE INDEX "chromia_design_file_name_idx" ON "chromia_design"("file_name");

-- CreateIndex
CREATE UNIQUE INDEX "chromia_machine_code_key" ON "chromia_machine"("code");

-- CreateIndex
CREATE INDEX "chromia_machine_type_is_active_idx" ON "chromia_machine"("type", "is_active");

-- CreateIndex
CREATE INDEX "chromia_machine_stage_idx" ON "chromia_machine"("stage");

-- CreateIndex
CREATE UNIQUE INDEX "chromia_location_code_key" ON "chromia_location"("code");

-- CreateIndex
CREATE INDEX "chromia_location_type_is_active_idx" ON "chromia_location"("type", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "chromia_stage_definition_stage_key" ON "chromia_stage_definition"("stage");

-- CreateIndex
CREATE UNIQUE INDEX "chromia_stage_definition_sequence_key" ON "chromia_stage_definition"("sequence");

-- CreateIndex
CREATE UNIQUE INDEX "chromia_defect_type_code_key" ON "chromia_defect_type"("code");

-- CreateIndex
CREATE INDEX "chromia_defect_type_origin_stage_is_active_idx" ON "chromia_defect_type"("origin_stage", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "chromia_recalibration_reason_code_key" ON "chromia_recalibration_reason"("code");

-- CreateIndex
CREATE INDEX "chromia_recalibration_reason_is_active_idx" ON "chromia_recalibration_reason"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "chromia_supplier_code_key" ON "chromia_supplier"("code");

-- CreateIndex
CREATE UNIQUE INDEX "chromia_customer_code_key" ON "chromia_customer"("code");

-- CreateIndex
CREATE UNIQUE INDEX "chromia_batch_batch_no_key" ON "chromia_batch"("batch_no");

-- CreateIndex
CREATE INDEX "chromia_batch_received_date_idx" ON "chromia_batch"("received_date");

-- CreateIndex
CREATE INDEX "chromia_batch_base_material_id_idx" ON "chromia_batch"("base_material_id");

-- CreateIndex
CREATE UNIQUE INDEX "chromia_slab_slab_no_key" ON "chromia_slab"("slab_no");

-- CreateIndex
CREATE INDEX "chromia_slab_status_idx" ON "chromia_slab"("status");

-- CreateIndex
CREATE INDEX "chromia_slab_status_current_stage_idx" ON "chromia_slab"("status", "current_stage");

-- CreateIndex
CREATE INDEX "chromia_slab_current_stage_idx" ON "chromia_slab"("current_stage");

-- CreateIndex
CREATE INDEX "chromia_slab_batch_id_idx" ON "chromia_slab"("batch_id");

-- CreateIndex
CREATE INDEX "chromia_slab_current_location_id_idx" ON "chromia_slab"("current_location_id");

-- CreateIndex
CREATE INDEX "chromia_slab_is_recalibration_out_idx" ON "chromia_slab"("is_recalibration_out");

-- CreateIndex
CREATE INDEX "chromia_slab_received_date_idx" ON "chromia_slab"("received_date");

-- CreateIndex
CREATE INDEX "chromia_slab_deleted_at_idx" ON "chromia_slab"("deleted_at");

-- CreateIndex
CREATE INDEX "chromia_process_cycle_status_idx" ON "chromia_process_cycle"("status");

-- CreateIndex
CREATE INDEX "chromia_process_cycle_slab_id_idx" ON "chromia_process_cycle"("slab_id");

-- CreateIndex
CREATE INDEX "chromia_process_cycle_out_time_idx" ON "chromia_process_cycle"("out_time");

-- CreateIndex
CREATE UNIQUE INDEX "chromia_process_cycle_slab_id_cycle_number_key" ON "chromia_process_cycle"("slab_id", "cycle_number");

-- CreateIndex
CREATE INDEX "chromia_stage_record_slab_id_stage_idx" ON "chromia_stage_record"("slab_id", "stage");

-- CreateIndex
CREATE INDEX "chromia_stage_record_stage_status_idx" ON "chromia_stage_record"("stage", "status");

-- CreateIndex
CREATE INDEX "chromia_stage_record_status_started_at_idx" ON "chromia_stage_record"("status", "started_at");

-- CreateIndex
CREATE INDEX "chromia_stage_record_operator_id_idx" ON "chromia_stage_record"("operator_id");

-- CreateIndex
CREATE UNIQUE INDEX "chromia_stage_record_cycle_id_stage_key" ON "chromia_stage_record"("cycle_id", "stage");

-- CreateIndex
CREATE INDEX "chromia_slab_event_slab_id_occurred_at_idx" ON "chromia_slab_event"("slab_id", "occurred_at");

-- CreateIndex
CREATE INDEX "chromia_slab_event_event_type_occurred_at_idx" ON "chromia_slab_event"("event_type", "occurred_at");

-- CreateIndex
CREATE INDEX "chromia_slab_event_cycle_id_idx" ON "chromia_slab_event"("cycle_id");

-- CreateIndex
CREATE INDEX "chromia_slab_movement_slab_id_moved_at_idx" ON "chromia_slab_movement"("slab_id", "moved_at");

-- CreateIndex
CREATE INDEX "chromia_slab_movement_to_location_id_idx" ON "chromia_slab_movement"("to_location_id");

-- CreateIndex
CREATE UNIQUE INDEX "chromia_incoming_detail_stage_record_id_key" ON "chromia_incoming_detail"("stage_record_id");

-- CreateIndex
CREATE UNIQUE INDEX "chromia_primer_detail_stage_record_id_key" ON "chromia_primer_detail"("stage_record_id");

-- CreateIndex
CREATE UNIQUE INDEX "chromia_printing_detail_stage_record_id_key" ON "chromia_printing_detail"("stage_record_id");

-- CreateIndex
CREATE INDEX "chromia_printing_detail_print_result_idx" ON "chromia_printing_detail"("print_result");

-- CreateIndex
CREATE INDEX "chromia_printing_detail_design_id_idx" ON "chromia_printing_detail"("design_id");

-- CreateIndex
CREATE UNIQUE INDEX "chromia_moulding_detail_stage_record_id_key" ON "chromia_moulding_detail"("stage_record_id");

-- CreateIndex
CREATE UNIQUE INDEX "chromia_cooling_detail_stage_record_id_key" ON "chromia_cooling_detail"("stage_record_id");

-- CreateIndex
CREATE UNIQUE INDEX "chromia_polishing_detail_stage_record_id_key" ON "chromia_polishing_detail"("stage_record_id");

-- CreateIndex
CREATE UNIQUE INDEX "chromia_uv_polishing_detail_stage_record_id_key" ON "chromia_uv_polishing_detail"("stage_record_id");

-- CreateIndex
CREATE UNIQUE INDEX "chromia_qc_record_cycle_id_key" ON "chromia_qc_record"("cycle_id");

-- CreateIndex
CREATE INDEX "chromia_qc_record_slab_id_inspected_at_idx" ON "chromia_qc_record"("slab_id", "inspected_at");

-- CreateIndex
CREATE INDEX "chromia_qc_record_verdict_inspected_at_idx" ON "chromia_qc_record"("verdict", "inspected_at");

-- CreateIndex
CREATE INDEX "chromia_qc_record_inspector_id_idx" ON "chromia_qc_record"("inspector_id");

-- CreateIndex
CREATE INDEX "chromia_qc_defect_qc_record_id_idx" ON "chromia_qc_defect"("qc_record_id");

-- CreateIndex
CREATE INDEX "chromia_qc_defect_defect_type_id_idx" ON "chromia_qc_defect"("defect_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "chromia_grade_decision_cycle_id_key" ON "chromia_grade_decision"("cycle_id");

-- CreateIndex
CREATE INDEX "chromia_grade_decision_slab_id_decided_at_idx" ON "chromia_grade_decision"("slab_id", "decided_at");

-- CreateIndex
CREATE INDEX "chromia_grade_decision_grade_decided_at_idx" ON "chromia_grade_decision"("grade", "decided_at");

-- CreateIndex
CREATE INDEX "chromia_grade_decision_disposition_idx" ON "chromia_grade_decision"("disposition");

-- CreateIndex
CREATE UNIQUE INDEX "chromia_recalibration_cycle_failed_cycle_id_key" ON "chromia_recalibration_cycle"("failed_cycle_id");

-- CreateIndex
CREATE UNIQUE INDEX "chromia_recalibration_cycle_restarted_cycle_id_key" ON "chromia_recalibration_cycle"("restarted_cycle_id");

-- CreateIndex
CREATE INDEX "chromia_recalibration_cycle_status_sent_date_idx" ON "chromia_recalibration_cycle"("status", "sent_date");

-- CreateIndex
CREATE INDEX "chromia_recalibration_cycle_slab_id_idx" ON "chromia_recalibration_cycle"("slab_id");

-- CreateIndex
CREATE INDEX "chromia_recalibration_cycle_reason_id_idx" ON "chromia_recalibration_cycle"("reason_id");

-- CreateIndex
CREATE INDEX "chromia_recalibration_cycle_received_date_idx" ON "chromia_recalibration_cycle"("received_date");

-- CreateIndex
CREATE UNIQUE INDEX "chromia_recalibration_cycle_slab_id_attempt_number_key" ON "chromia_recalibration_cycle"("slab_id", "attempt_number");

-- CreateIndex
CREATE INDEX "chromia_dispatch_dispatch_date_idx" ON "chromia_dispatch"("dispatch_date");

-- CreateIndex
CREATE INDEX "chromia_dispatch_slab_id_idx" ON "chromia_dispatch"("slab_id");

-- CreateIndex
CREATE INDEX "chromia_stock_entry_stock_date_idx" ON "chromia_stock_entry"("stock_date");

-- CreateIndex
CREATE INDEX "chromia_stock_entry_slab_id_idx" ON "chromia_stock_entry"("slab_id");

-- CreateIndex
CREATE INDEX "chromia_sample_cutting_cut_date_idx" ON "chromia_sample_cutting"("cut_date");

-- CreateIndex
CREATE INDEX "chromia_sample_cutting_slab_id_idx" ON "chromia_sample_cutting"("slab_id");

-- CreateIndex
CREATE UNIQUE INDEX "chromia_waste_record_slab_id_key" ON "chromia_waste_record"("slab_id");

-- CreateIndex
CREATE INDEX "chromia_waste_record_declared_at_idx" ON "chromia_waste_record"("declared_at");

-- CreateIndex
CREATE INDEX "chromia_import_batch_status_idx" ON "chromia_import_batch"("status");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_operator_name_key" ON "attendance_operator"("name");

-- CreateIndex
CREATE INDEX "attendance_day_date_idx" ON "attendance_day"("date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_day_date_operatorId_key" ON "attendance_day"("date", "operatorId");

-- CreateIndex
CREATE INDEX "attendance_leave_date_idx" ON "attendance_leave"("date");

-- CreateIndex
CREATE INDEX "entry_photo_record" ON "entry_photo"("model", "record_id");

-- CreateIndex
CREATE UNIQUE INDEX "fg_finished_slab_slab_number_key" ON "fg_finished_slab"("slab_number");

-- CreateIndex
CREATE INDEX "fg_finished_slab_batch_key_idx" ON "fg_finished_slab"("batch_key");

-- CreateIndex
CREATE INDEX "fg_finished_slab_status_idx" ON "fg_finished_slab"("status");

-- CreateIndex
CREATE INDEX "fg_finished_slab_grade_idx" ON "fg_finished_slab"("grade");

-- CreateIndex
CREATE INDEX "fg_finished_slab_design_idx" ON "fg_finished_slab"("design");

-- CreateIndex
CREATE UNIQUE INDEX "fg_design_alias_variant_key" ON "fg_design_alias"("variant");

-- CreateIndex
CREATE INDEX "fg_design_alias_canonical_idx" ON "fg_design_alias"("canonical");

-- CreateIndex
CREATE UNIQUE INDEX "design_name_name_key_key" ON "design_name"("name_key");

-- CreateIndex
CREATE INDEX "fg_slab_event_slab_number_idx" ON "fg_slab_event"("slab_number");

-- CreateIndex
CREATE INDEX "fg_slab_event_at_idx" ON "fg_slab_event"("at");

-- CreateIndex
CREATE UNIQUE INDEX "commercial_design_code_code_key" ON "commercial_design_code"("code");

-- CreateIndex
CREATE UNIQUE INDEX "polish_qc_airtableId_key" ON "polish_qc"("airtableId");

-- CreateIndex
CREATE INDEX "polish_qc_batch_key_idx" ON "polish_qc"("batch_key");

-- CreateIndex
CREATE INDEX "polish_qc_slab_number_idx" ON "polish_qc"("slab_number");

-- CreateIndex
CREATE INDEX "polish_qc_imported_at_idx" ON "polish_qc"("imported_at");

-- CreateIndex
CREATE INDEX "polish_qc_created_time_idx" ON "polish_qc"("created_time");

-- CreateIndex
CREATE UNIQUE INDEX "press_airtableId_key" ON "press"("airtableId");

-- CreateIndex
CREATE INDEX "press_batch_key_idx" ON "press"("batch_key");

-- CreateIndex
CREATE INDEX "press_imported_at_idx" ON "press"("imported_at");

-- CreateIndex
CREATE INDEX "press_date_idx" ON "press"("date");

-- CreateIndex
CREATE INDEX "press_created_time_idx" ON "press"("created_time");

-- CreateIndex
CREATE UNIQUE INDEX "jot_airtableId_key" ON "jot"("airtableId");

-- CreateIndex
CREATE INDEX "jot_batch_key_idx" ON "jot"("batch_key");

-- CreateIndex
CREATE INDEX "jot_imported_at_idx" ON "jot"("imported_at");

-- CreateIndex
CREATE INDEX "jot_date_idx" ON "jot"("date");

-- CreateIndex
CREATE INDEX "jot_slab_number_idx" ON "jot"("slab_number");

-- AddForeignKey
ALTER TABLE "chromia_machine" ADD CONSTRAINT "chromia_machine_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "chromia_location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_location" ADD CONSTRAINT "chromia_location_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "chromia_location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_batch" ADD CONSTRAINT "chromia_batch_base_material_id_fkey" FOREIGN KEY ("base_material_id") REFERENCES "chromia_base_material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_batch" ADD CONSTRAINT "chromia_batch_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "chromia_supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_slab" ADD CONSTRAINT "chromia_slab_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "chromia_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_slab" ADD CONSTRAINT "chromia_slab_base_material_id_fkey" FOREIGN KEY ("base_material_id") REFERENCES "chromia_base_material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_slab" ADD CONSTRAINT "chromia_slab_planned_design_id_fkey" FOREIGN KEY ("planned_design_id") REFERENCES "chromia_design"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_slab" ADD CONSTRAINT "chromia_slab_current_location_id_fkey" FOREIGN KEY ("current_location_id") REFERENCES "chromia_location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_slab" ADD CONSTRAINT "chromia_slab_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "chromia_import_batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_process_cycle" ADD CONSTRAINT "chromia_process_cycle_slab_id_fkey" FOREIGN KEY ("slab_id") REFERENCES "chromia_slab"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_process_cycle" ADD CONSTRAINT "chromia_process_cycle_design_id_fkey" FOREIGN KEY ("design_id") REFERENCES "chromia_design"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_stage_record" ADD CONSTRAINT "chromia_stage_record_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "chromia_process_cycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_stage_record" ADD CONSTRAINT "chromia_stage_record_slab_id_fkey" FOREIGN KEY ("slab_id") REFERENCES "chromia_slab"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_stage_record" ADD CONSTRAINT "chromia_stage_record_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "chromia_machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_stage_record" ADD CONSTRAINT "chromia_stage_record_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "chromia_location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_slab_event" ADD CONSTRAINT "chromia_slab_event_slab_id_fkey" FOREIGN KEY ("slab_id") REFERENCES "chromia_slab"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_slab_event" ADD CONSTRAINT "chromia_slab_event_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "chromia_process_cycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_slab_event" ADD CONSTRAINT "chromia_slab_event_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "chromia_location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_slab_movement" ADD CONSTRAINT "chromia_slab_movement_slab_id_fkey" FOREIGN KEY ("slab_id") REFERENCES "chromia_slab"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_slab_movement" ADD CONSTRAINT "chromia_slab_movement_from_location_id_fkey" FOREIGN KEY ("from_location_id") REFERENCES "chromia_location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_slab_movement" ADD CONSTRAINT "chromia_slab_movement_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "chromia_location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_incoming_detail" ADD CONSTRAINT "chromia_incoming_detail_stage_record_id_fkey" FOREIGN KEY ("stage_record_id") REFERENCES "chromia_stage_record"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_primer_detail" ADD CONSTRAINT "chromia_primer_detail_stage_record_id_fkey" FOREIGN KEY ("stage_record_id") REFERENCES "chromia_stage_record"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_printing_detail" ADD CONSTRAINT "chromia_printing_detail_stage_record_id_fkey" FOREIGN KEY ("stage_record_id") REFERENCES "chromia_stage_record"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_printing_detail" ADD CONSTRAINT "chromia_printing_detail_design_id_fkey" FOREIGN KEY ("design_id") REFERENCES "chromia_design"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_moulding_detail" ADD CONSTRAINT "chromia_moulding_detail_stage_record_id_fkey" FOREIGN KEY ("stage_record_id") REFERENCES "chromia_stage_record"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_cooling_detail" ADD CONSTRAINT "chromia_cooling_detail_stage_record_id_fkey" FOREIGN KEY ("stage_record_id") REFERENCES "chromia_stage_record"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_polishing_detail" ADD CONSTRAINT "chromia_polishing_detail_stage_record_id_fkey" FOREIGN KEY ("stage_record_id") REFERENCES "chromia_stage_record"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_uv_polishing_detail" ADD CONSTRAINT "chromia_uv_polishing_detail_stage_record_id_fkey" FOREIGN KEY ("stage_record_id") REFERENCES "chromia_stage_record"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_qc_record" ADD CONSTRAINT "chromia_qc_record_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "chromia_process_cycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_qc_record" ADD CONSTRAINT "chromia_qc_record_slab_id_fkey" FOREIGN KEY ("slab_id") REFERENCES "chromia_slab"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_qc_defect" ADD CONSTRAINT "chromia_qc_defect_qc_record_id_fkey" FOREIGN KEY ("qc_record_id") REFERENCES "chromia_qc_record"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_qc_defect" ADD CONSTRAINT "chromia_qc_defect_defect_type_id_fkey" FOREIGN KEY ("defect_type_id") REFERENCES "chromia_defect_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_grade_decision" ADD CONSTRAINT "chromia_grade_decision_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "chromia_process_cycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_grade_decision" ADD CONSTRAINT "chromia_grade_decision_slab_id_fkey" FOREIGN KEY ("slab_id") REFERENCES "chromia_slab"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_grade_decision" ADD CONSTRAINT "chromia_grade_decision_target_location_id_fkey" FOREIGN KEY ("target_location_id") REFERENCES "chromia_location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_recalibration_cycle" ADD CONSTRAINT "chromia_recalibration_cycle_slab_id_fkey" FOREIGN KEY ("slab_id") REFERENCES "chromia_slab"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_recalibration_cycle" ADD CONSTRAINT "chromia_recalibration_cycle_failed_cycle_id_fkey" FOREIGN KEY ("failed_cycle_id") REFERENCES "chromia_process_cycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_recalibration_cycle" ADD CONSTRAINT "chromia_recalibration_cycle_restarted_cycle_id_fkey" FOREIGN KEY ("restarted_cycle_id") REFERENCES "chromia_process_cycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_recalibration_cycle" ADD CONSTRAINT "chromia_recalibration_cycle_reason_id_fkey" FOREIGN KEY ("reason_id") REFERENCES "chromia_recalibration_reason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_dispatch" ADD CONSTRAINT "chromia_dispatch_slab_id_fkey" FOREIGN KEY ("slab_id") REFERENCES "chromia_slab"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_dispatch" ADD CONSTRAINT "chromia_dispatch_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "chromia_customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_stock_entry" ADD CONSTRAINT "chromia_stock_entry_slab_id_fkey" FOREIGN KEY ("slab_id") REFERENCES "chromia_slab"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_stock_entry" ADD CONSTRAINT "chromia_stock_entry_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "chromia_location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_sample_cutting" ADD CONSTRAINT "chromia_sample_cutting_slab_id_fkey" FOREIGN KEY ("slab_id") REFERENCES "chromia_slab"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_waste_record" ADD CONSTRAINT "chromia_waste_record_slab_id_fkey" FOREIGN KEY ("slab_id") REFERENCES "chromia_slab"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chromia_waste_record" ADD CONSTRAINT "chromia_waste_record_final_defect_type_id_fkey" FOREIGN KEY ("final_defect_type_id") REFERENCES "chromia_defect_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_day" ADD CONSTRAINT "attendance_day_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "attendance_operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_leave" ADD CONSTRAINT "attendance_leave_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "attendance_operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fg_slab_event" ADD CONSTRAINT "fg_slab_event_slab_number_fkey" FOREIGN KEY ("slab_number") REFERENCES "fg_finished_slab"("slab_number") ON DELETE RESTRICT ON UPDATE CASCADE;

