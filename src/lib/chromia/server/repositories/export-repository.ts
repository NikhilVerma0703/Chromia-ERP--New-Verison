import { ChromiaDisposition as Disposition, ChromiaSlabStatus as SlabStatus, ChromiaStockOutcome as StockOutcome, type Prisma } from '@prisma/client';

import { prisma } from '@/lib/chromia/db';
import { currentStatusOf } from '@/lib/chromia/current-status';
import { buildReport, type BuiltReport, type ReportKind, type ReportRecord } from '@/lib/chromia/download-reports';
import { isWithinRangeDays, padRange, type DateRange } from '@/lib/chromia/exports';
import { boardRows } from '@/lib/chromia/recalibration-board';
import { statusLabel } from '@/lib/chromia/recalibration-flow';
import { manualRemark } from '@/lib/chromia/slab-remarks';
import { physicalSlabWhere } from '@/lib/chromia/server/repositories/physical-slabs';

/**
 * The Downloads reports (rebuilt 28 Oct 2026, change 12): which slabs each
 * holds, and its date. The columns, order and S.No. are buildReport's
 * (download-reports.ts), so the page's preview and the Excel file are built
 * from these very records.
 *
 * EACH REPORT IS THE PAGE IT NAMES, by the ERP's own rules:
 *
 *   Complete Production  every slab produced in the range — Slab Records'
 *                        rows, Current Status by its rule (currentStatusOf)
 *   In Stock             on the racks now (status IN_STOCK), by production date
 *   Dispatched           status DISPATCHED, by its Dispatch Date
 *   Approved             status APPROVED, by the date the Stockyard approved it
 *   Sample Cutting       status SAMPLE_CUT, by the date it was cut — at QC or
 *                        sent from the Stockyard
 *   Recalibration        the Recalibration page's rows (one per slab, on its
 *                        open or latest trip), by production date
 *
 * Each physical slab once (physical-slabs.ts): 14567 and 14567-A are one slab,
 * where its latest record is. The status reports read the slabs in that status
 * now — the same slabs their KPIs count — so a report never holds a slab that
 * has since moved on, and never misses one dispatched straight from QC.
 */

const SLAB_FIELDS = {
  id: true,
  slabNo: true,
  status: true,
  currentGrade: true,
  currentDisposition: true,
  receivedDate: true,
  createdAt: true,
  currentThicknessMm: true,
  remarks: true,
  batch: { select: { batchNo: true } },
  baseMaterial: { select: { name: true } },
  plannedDesign: { select: { name: true, fileName: true } },
  cycles: { orderBy: { cycleNumber: 'desc' }, take: 1, select: { inTime: true } },
  recalibrations: {
    orderBy: { attemptNumber: 'asc' },
    select: { attemptNumber: true, sentDate: true, receivedDate: true, restartedAt: true, reason: { select: { name: true } } },
  },
  dispatches: { orderBy: [{ dispatchDate: 'desc' }, { createdAt: 'desc' }], take: 1, select: { dispatchDate: true } },
  sampleCuttings: { orderBy: [{ cutDate: 'desc' }, { createdAt: 'desc' }], take: 1, select: { cutDate: true } },
  stockEntries: {
    where: { releaseOutcome: StockOutcome.APPROVED },
    orderBy: [{ releasedAt: 'desc' }, { updatedAt: 'desc' }],
    take: 1,
    select: { releasedAt: true },
  },
} satisfies Prisma.ChromiaSlabSelect;

type Slab = Prisma.ChromiaSlabGetPayload<{ select: typeof SLAB_FIELDS }>;

/** Which slabs a report reads — before its date range. */
const REPORT_WHERE: Record<ReportKind, Prisma.ChromiaSlabWhereInput> = {
  PRODUCTION: {},
  STOCK: { status: SlabStatus.IN_STOCK },
  DISPATCH: { status: SlabStatus.DISPATCHED },
  APPROVED: { status: SlabStatus.APPROVED },
  SAMPLE_CUTTING: { status: SlabStatus.SAMPLE_CUT },
  // The Recalibration page's board: sent to recalibration, or ever on a trip.
  RECALIBRATION: { OR: [{ currentDisposition: Disposition.RECALIBRATION }, { recalibrations: { some: {} } }] },
};

/** The report's own date for one slab — null when it has none (left out). */
function eventDateOf(kind: ReportKind, slab: Slab): Date | null {
  switch (kind) {
    case 'DISPATCH':
      return slab.dispatches[0]?.dispatchDate ?? null;
    case 'APPROVED':
      return slab.stockEntries[0]?.releasedAt ?? null;
    case 'SAMPLE_CUTTING':
      return slab.sampleCuttings[0]?.cutDate ?? null;
    default:
      return slab.receivedDate;
  }
}

function recordOf(kind: ReportKind, slab: Slab, eventDate: Date): ReportRecord {
  const trips = slab.recalibrations.map(({ reason: _reason, ...trip }) => trip);
  const base: ReportRecord = {
    eventDate,
    productionDate: slab.receivedDate,
    createdAt: slab.createdAt,
    batchNo: slab.batch.batchNo,
    slabNo: slab.slabNo,
    baseMaterial: slab.baseMaterial.name,
    design: slab.plannedDesign?.fileName ?? slab.plannedDesign?.name ?? null,
    thicknessCm: slab.currentThicknessMm === null ? null : Number(slab.currentThicknessMm) / 10,
    inTime: slab.cycles[0]?.inTime ?? null,
    grade: slab.currentGrade,
    disposition: slab.currentDisposition,
    // Slab Records shows the remark as saved; the status pages, without an
    // echo of the outcome (manualRemark).
    remarks: kind === 'PRODUCTION' ? slab.remarks : manualRemark(slab.remarks, slab.currentDisposition),
    currentStatus: currentStatusOf(slab, trips).label,
  };
  if (kind !== 'RECALIBRATION') return base;

  // The Recalibration page's row: the trip it is on (open or latest), and its reason.
  const state = { id: slab.id, disposition: slab.currentDisposition, writtenOff: slab.status === SlabStatus.WASTE, trips };
  const attemptNumber = boardRows([state], null)[0]?.attemptNumber ?? null;
  const trip = slab.recalibrations.find((t) => t.attemptNumber === attemptNumber) ?? null;
  return {
    ...base,
    currentStatus: statusLabel(state, slab.currentGrade),
    attemptNumber,
    sentDate: trip?.sentDate ?? null,
    receivedDate: trip?.receivedDate ?? null,
    reason: trip?.reason?.name ?? [...slab.recalibrations].reverse().find((t) => t.reason)?.reason?.name ?? null,
  };
}

/** One report over a date range, oldest first on its own date, numbered 1…n. */
export async function loadDownloadReport(kind: ReportKind, range: DateRange): Promise<BuiltReport> {
  // A typed production date can be narrowed in the query; the other dates
  // live on the outcome's record, so those reports filter after reading.
  const byProductionDate = kind === 'PRODUCTION' || kind === 'STOCK' || kind === 'RECALIBRATION';
  const slabs = await prisma.chromiaSlab.findMany({
    where: {
      AND: [await physicalSlabWhere(), REPORT_WHERE[kind], byProductionDate ? { receivedDate: padRange(range) } : {}],
    },
    select: SLAB_FIELDS,
  });

  const records: ReportRecord[] = [];
  for (const slab of slabs) {
    const date = eventDateOf(kind, slab);
    if (date && isWithinRangeDays(date, range)) records.push(recordOf(kind, slab, date));
  }
  return buildReport(kind, records);
}
