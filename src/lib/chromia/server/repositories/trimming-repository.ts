import { ChromiaDisposition as Disposition, ChromiaSlabStatus as SlabStatus, ChromiaTrimmingSource as TrimmingSource, type Prisma } from '@prisma/client';

import { prisma } from '@/lib/chromia/db';
import { physicalSlabWhere } from '@/lib/chromia/server/repositories/physical-slabs';
import { trimmingStage, trimmingStatus, type TrimmingStage } from '@/lib/chromia/trimming';

/**
 * Trimming — data access (7 Nov 2026; the records, 0008).
 *
 * Every row of the Trimming table is a chromia_trimming record:
 *   PRODUCTION        a slab graded C → Trimming on Slab Entry — opened by
 *                     the QC save itself (applyIntakeGrade), so a slab graded
 *                     so is in this table without anybody adding it;
 *   WITHOUT_PRINTING  entered on the Trimming page, for a slab that never
 *                     went on the line.
 *
 * A PRODUCTION row is shown while its slab is graded C → Trimming, and for
 * good once its QC Report after trimming is saved (it then reads Trimmed —
 * Grade A: Stock …, wherever the slab went). A slab whose QC was corrected
 * away from Trimming before anything was trimmed leaves the table.
 */

const SLAB_FIELDS = {
  id: true,
  slabNo: true,
  status: true,
  receivedDate: true,
  currentThicknessMm: true,
  currentGrade: true,
  currentDisposition: true,
  remarks: true,
  deletedAt: true,
  batch: { select: { batchNo: true } },
  baseMaterial: { select: { name: true } },
  plannedDesign: { select: { name: true, fileName: true } },
  cycles: {
    orderBy: { cycleNumber: 'desc' },
    take: 1,
    select: { inTime: true, design: { select: { fileName: true } } },
  },
} as const;

const RECORD_FIELDS = {
  id: true,
  source: true,
  slabId: true,
  slabNo: true,
  batchNo: true,
  baseMaterial: true,
  fileName: true,
  productionDate: true,
  inTime: true,
  thicknessMm: true,
  remarks: true,
  trimFromMm: true,
  trimToMm: true,
  sentDate: true,
  receivedDate: true,
  qcGrade: true,
  qcDisposition: true,
  qcAt: true,
  createdAt: true,
  slab: { select: SLAB_FIELDS },
} satisfies Prisma.ChromiaTrimmingSelect;

type StoredRecord = Prisma.ChromiaTrimmingGetPayload<{ select: typeof RECORD_FIELDS }>;

const mm = (value: Prisma.Decimal | null | undefined) => (value === null || value === undefined ? null : Number(value));

/** The Trimming table: production rows still in Trimming or trimmed, and every without-printing row. */
const VISIBLE: Prisma.ChromiaTrimmingWhereInput = {
  OR: [
    { source: TrimmingSource.WITHOUT_PRINTING },
    { slab: { deletedAt: null, status: SlabStatus.GRADED, currentDisposition: Disposition.TRIMMING } },
    { qcAt: { not: null }, slab: { deletedAt: null } },
  ],
};

export interface TrimmingRow {
  id: string;
  source: TrimmingSource;
  /** The Chromia slab, once there is one (always for PRODUCTION). */
  slabId: string | null;
  productionDate: Date | null;
  batchNo: string;
  slabNo: string;
  baseMaterial: string;
  fileName: string | null;
  thicknessMm: number | null;
  /** The slab's own In-time, "HH:MM" (a production slab's latest pass). */
  inTime: Date | string | null;
  remarks: string | null;
  trimFromMm: number | null;
  trimToMm: number | null;
  sentDate: Date | null;
  receivedDate: Date | null;
  qcGrade: string | null;
  qcDisposition: string | null;
  /** Where the slab is now — the slab's own status, for one already graded. */
  slabStatus: SlabStatus | null;
  slabDisposition: string | null;
  stage: TrimmingStage;
  status: string;
  createdAt: Date;
}

function shape(record: StoredRecord): TrimmingRow {
  const slab = record.slab && !record.slab.deletedAt ? record.slab : null;
  const cycle = slab?.cycles[0];
  const state = {
    trimFromMm: mm(record.trimFromMm),
    trimToMm: mm(record.trimToMm),
    sentDate: record.sentDate,
    receivedDate: record.receivedDate,
    qcGrade: record.qcGrade,
    qcDisposition: record.qcDisposition,
  };
  return {
    id: record.id,
    source: record.source,
    slabId: slab?.id ?? null,
    // Once there is a slab, its own record is the truth; until then, the row's.
    productionDate: slab ? slab.receivedDate : record.productionDate,
    batchNo: slab ? slab.batch.batchNo : (record.batchNo ?? ''),
    slabNo: slab ? slab.slabNo : (record.slabNo ?? ''),
    baseMaterial: slab ? slab.baseMaterial.name : (record.baseMaterial ?? ''),
    fileName: slab ? (cycle?.design?.fileName ?? slab.plannedDesign?.fileName ?? slab.plannedDesign?.name ?? null) : record.fileName,
    thicknessMm: slab ? mm(slab.currentThicknessMm) : mm(record.thicknessMm),
    inTime: slab ? (cycle?.inTime ?? null) : record.inTime,
    remarks: slab ? slab.remarks : record.remarks,
    ...state,
    slabStatus: slab?.status ?? null,
    slabDisposition: slab?.currentDisposition ?? null,
    stage: trimmingStage(state),
    status: trimmingStatus(state),
    createdAt: record.createdAt,
  };
}

/** Every row of the Trimming table, the latest entries first. */
export async function listTrimmingRecords(): Promise<TrimmingRow[]> {
  const records = await prisma.chromiaTrimming.findMany({
    where: VISIBLE,
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    select: RECORD_FIELDS,
  });
  return records.map(shape);
}

/** One Trimming record, for its slab page — null when it is not in the table. */
export async function loadTrimmingRecord(id: string): Promise<TrimmingRow | null> {
  const record = await prisma.chromiaTrimming.findFirst({ where: { AND: [{ id }, VISIBLE] }, select: RECORD_FIELDS });
  return record ? shape(record) : null;
}

/**
 * The production slabs in Trimming right now — the Dashboard's Trimming place
 * (GRADED, outcome TRIMMING). The audit holds the two to one another.
 */
export async function trimmingPlaceSlabIds(): Promise<string[]> {
  // Each physical slab once (physical-slabs.ts), as the Dashboard counts it —
  // and as the Downloads Trimming Slabs KPI shows it (change 8).
  const rows = await prisma.chromiaTrimming.findMany({
    where: {
      source: TrimmingSource.PRODUCTION,
      slab: { AND: [await physicalSlabWhere(), { status: SlabStatus.GRADED, currentDisposition: Disposition.TRIMMING }] },
    },
    select: { slabId: true },
  });
  return rows.map((row) => row.slabId as string);
}
