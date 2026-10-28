import { prisma } from '@/lib/chromia/db';
import { physicalSlabWhere } from '@/lib/chromia/server/repositories/physical-slabs';
import {
  dailyProduction,
  designBreakdown,
  recalibrationAttempts,
  stockDistribution,
  type ReportSlab,
  type TrendRange,
} from '@/lib/chromia/reports-charts';

/**
 * The Reports page (rebuilt 28 Oct 2026, change 11) — every chart from ONE
 * read of the live slabs, each physical slab once (physical-slabs.ts), so the
 * four sections count the very slabs the dashboard does: the designs add up to
 * Total Produced, the donut is Current Stock / Dispatched / Approved / Sample
 * Cutting, the stacked bars add up to the palette. reports-charts.ts says how
 * each is counted.
 *
 * It replaces the old Production Summary's cohort query: the page is charts
 * only now, and its period form, headline tiles and tables are gone.
 */
export async function loadReportCharts(range: TrendRange) {
  const rows = await prisma.chromiaSlab.findMany({
    where: await physicalSlabWhere(),
    select: {
      receivedDate: true,
      status: true,
      currentDisposition: true,
      plannedDesign: { select: { name: true, fileName: true } },
      // A trip counts as an attempt once the slab has left (attemptsUsed).
      _count: { select: { recalibrations: { where: { sentDate: { not: null } } } } },
    },
  });

  const slabs: ReportSlab[] = rows.map((row) => ({
    receivedDate: row.receivedDate,
    status: row.status,
    currentDisposition: row.currentDisposition,
    design: row.plannedDesign?.fileName ?? row.plannedDesign?.name ?? null,
    attemptsSent: row._count.recalibrations,
  }));

  return {
    total: slabs.length,
    designs: designBreakdown(slabs),
    distribution: stockDistribution(slabs),
    attempts: recalibrationAttempts(slabs),
    trend: dailyProduction(slabs, range),
  };
}

export type ReportCharts = Awaited<ReturnType<typeof loadReportCharts>>;
