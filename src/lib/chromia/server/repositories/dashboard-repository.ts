import { ChromiaStockOutcome as StockOutcome } from '@prisma/client';
import { prisma } from '@/lib/chromia/db';
import { plantDayRange, toPlantDateInput } from '@/lib/chromia/plant-time';
import {
  overallProduction,
  processingSlabs,
  todayProduction,
  type ProcessingView,
} from '@/lib/chromia/production-overview';

/**
 * The Main Production Dashboard (rebuilt 27 Oct 2026), in one round trip.
 *
 * Every figure is read from the live records — no roll-up, no snapshot. The
 * Overall Production KPIs and the palette are one count of one set of rows
 * (production-overview.ts), so a KPI and its colour in the palette cannot
 * disagree, and each place is the same status the Stockyard, Dispatched and
 * Approved pages count: Current Stock is the Stockyard's Current Stock
 * Available, Dispatched the Dispatched page's total, and so on.
 *
 * TODAY is today's date in IST. The day's Stockyard work is read by the date
 * the in-charge gave it: the Dispatch Date, the Stock Outcome date.
 */
export async function loadProductionDashboard(view: ProcessingView | null, now: Date = new Date()) {
  const today = toPlantDateInput(now);
  const { from, to } = plantDayRange(today, today);
  // A typed day is stored at midnight UTC — inside the IST day it names.
  const onToday = { gte: from, lte: to };

  const [slabs, dispatches, approvals, stockCuts] = await Promise.all([
    prisma.chromiaSlab.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        slabNo: true,
        status: true,
        currentDisposition: true,
        currentGrade: true,
        receivedDate: true,
        createdAt: true,
      },
    }),
    prisma.chromiaDispatch.findMany({
      where: { dispatchDate: onToday, slab: { deletedAt: null } },
      select: { slab: { select: { slabNo: true } } },
    }),
    prisma.chromiaStockEntry.findMany({
      where: { releaseOutcome: StockOutcome.APPROVED, releasedAt: onToday, slab: { deletedAt: null } },
      select: { slab: { select: { slabNo: true } } },
    }),
    // Sent to Sample Cutting from the Stockyard today: the stock entry says
    // it left for Sample Cutting, the cut says when.
    prisma.chromiaSampleCutting.findMany({
      where: {
        cutDate: onToday,
        slab: { deletedAt: null, stockEntries: { some: { releaseOutcome: StockOutcome.SAMPLE_CUTTING } } },
      },
      select: { slab: { select: { slabNo: true } } },
    }),
  ]);

  const slabNos = (rows: { slab: { slabNo: string } }[]) => rows.map((row) => row.slab.slabNo);

  return {
    today,
    overall: overallProduction(slabs),
    todays: todayProduction(
      {
        slabs,
        dispatchedToday: slabNos(dispatches),
        approvedToday: slabNos(approvals),
        sampleCutFromStockToday: slabNos(stockCuts),
      },
      today,
    ),
    processing: view ? await loadProcessingRows(processingSlabs(slabs, view, today).map((slab) => slab.id)) : null,
  };
}

/**
 * The In-Processing table: each slab's details as Slab Entry recorded them,
 * where it is on the line, and how far QC has got.
 */
async function loadProcessingRows(ids: string[]) {
  if (ids.length === 0) return [];
  const rows = await prisma.chromiaSlab.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      slabNo: true,
      receivedDate: true,
      status: true,
      currentGrade: true,
      currentDisposition: true,
      currentThicknessMm: true,
      batch: { select: { batchNo: true } },
      baseMaterial: { select: { name: true } },
      plannedDesign: { select: { name: true, fileName: true } },
      cycles: { orderBy: { cycleNumber: 'desc' }, take: 1, select: { inTime: true } },
      recalibrations: {
        where: { receivedDate: { not: null } },
        orderBy: { attemptNumber: 'desc' },
        take: 1,
        select: { attemptNumber: true },
      },
    },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids
    .map((id) => byId.get(id))
    .filter((row): row is (typeof rows)[number] => Boolean(row))
    .map(({ currentThicknessMm, cycles, recalibrations, plannedDesign, ...row }) => ({
      ...row,
      inTime: cycles[0]?.inTime ?? null,
      thicknessCm: currentThicknessMm === null ? null : Number(currentThicknessMm) / 10,
      designFileName: plannedDesign?.fileName ?? plannedDesign?.name ?? null,
      /** The last recalibration trip it came back from, or null if never sent. */
      afterAttempt: recalibrations[0]?.attemptNumber ?? null,
    }));
}

export type ProcessingRow = NonNullable<Awaited<ReturnType<typeof loadProductionDashboard>>['processing']>[number];
