import { prisma } from '@/lib/chromia/db';
import type { DateRange } from '@/lib/chromia/reports';
import { isWithinRangeDays, padRange } from '@/lib/chromia/exports';
import {
  buildDailyActivity,
  buildHeadline,
  buildMaterialSummary,
  buildOutcomeMix,
  buildRecalibrationFunnel,
  totalDailyRow,
  totalMaterialRow,
  type SummarySlab,
} from '@/lib/chromia/production-summary';

/**
 * Production summary — one cohort, four views.
 *
 * The cohort is every slab **received inside the window**. Headline figures,
 * outcome mix, funnel and the material table all measure that same set, so a
 * percentage on one card can be compared with a percentage on another. The
 * daily trend is separate by design: it is a diary of activity, not a cohort.
 */
export async function loadProductionSummary(range: DateRange) {
  // Padded for the query, filtered exactly by calendar day afterwards — a
  // received date is a calendar day stored as an instant, so comparing
  // instants alone drops rows that sit exactly on a boundary.
  const within = padRange(range);
  const onDay = (date: Date | null) => isWithinRangeDays(date, range);

  const [cohort, completed, dispatched, stocked, sampleCut, sentForRecalibration] =
    await Promise.all([
      prisma.chromiaSlab.findMany({
        where: { deletedAt: null, receivedDate: within },
        select: {
          status: true,
          currentDisposition: true,
          recalibrationCount: true,
          receivedDate: true,
          baseMaterial: { select: { name: true } },
          recalibrations: { select: { receivedDate: true } },
        },
      }),

      prisma.chromiaProcessCycle.findMany({ where: { outTime: within }, select: { outTime: true } }),
      prisma.chromiaDispatch.findMany({ where: { dispatchDate: within }, select: { dispatchDate: true } }),
      prisma.chromiaStockEntry.findMany({ where: { stockDate: within }, select: { stockDate: true } }),
      prisma.chromiaSampleCutting.findMany({ where: { cutDate: within }, select: { cutDate: true } }),
      prisma.chromiaRecalibrationCycle.findMany({
        where: { sentDate: within },
        select: { sentDate: true },
      }),
    ]);

  const inCohort = cohort.filter((slab) => onDay(slab.receivedDate));

  const slabs: SummarySlab[] = inCohort.map((slab) => ({
    status: slab.status,
    disposition: slab.currentDisposition,
    recalibrationCount: slab.recalibrationCount,
    returnedFromRecalibration: slab.recalibrations.some((trip) => trip.receivedDate !== null),
    materialName: slab.baseMaterial.name,
  }));

  const onlyDays = (dates: (Date | null)[]) => dates.filter((date): date is Date => onDay(date));

  const daily = buildDailyActivity({
    received: inCohort.map((slab) => slab.receivedDate),
    processingDone: onlyDays(completed.map((row) => row.outTime)),
    dispatched: onlyDays(dispatched.map((row) => row.dispatchDate)),
    stocked: onlyDays(stocked.map((row) => row.stockDate)),
    sampleCut: onlyDays(sampleCut.map((row) => row.cutDate)),
    recalibration: onlyDays(sentForRecalibration.map((row) => row.sentDate)),
  });

  const materials = buildMaterialSummary(slabs);

  return {
    range,
    headline: buildHeadline(slabs),
    outcomes: buildOutcomeMix(slabs),
    funnel: buildRecalibrationFunnel(slabs),
    daily,
    dailyTotal: totalDailyRow(daily),
    materials,
    materialTotal: totalMaterialRow(materials),
  };
}
