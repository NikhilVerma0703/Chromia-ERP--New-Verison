import { ChromiaDisposition as Disposition, ChromiaSlabStatus as SlabStatus } from '@prisma/client';
import { prisma } from '@/lib/chromia/db';
import { buildOutcomeSplit, countFromDay, fromDay, outcomeKeyOf, type OutcomeKey } from '@/lib/chromia/dashboard-live';
import { buildOverallTiles, type OverallCounts } from '@/lib/chromia/dashboard-totals';
import { plantDayStart, plantToday } from '@/lib/chromia/plant-time';

/**
 * Everything the live dashboard needs, in one round trip.
 *
 * Four questions, four groups of queries: how the plant stands overall, where
 * its slabs are, what has happened today, and what QC just decided. Every
 * figure is read from live transactional data — no nightly roll-up and no
 * cached snapshot, so the screen cannot drift from the shop floor.
 *
 * The overall figures and the distribution bar are deliberately read from the
 * same grouping (dashboard-live.outcomeKeyOf), so a tile and the bar beneath
 * it can never disagree about how many slabs are in stock.
 *
 * TODAY is the plant's production day, 06:00 to 06:00 (the owner's decision of
 * 20 Oct 2026 on CHR-8 of the code review of that day). It was midnight on the
 * server's clock, which is UTC — 05:30 in the plant, half an hour before A
 * shift. Each figure reads its rows from 00:00 plant time on that day, the
 * earliest anything filed under it can be stored, and fromDay then files
 * each one by the rule every Chromia report uses.
 */
export async function loadLiveDashboard() {
  const today = plantToday();
  const since = plantDayStart(today);

  const [
    slabGroups,
    receivedSince,
    completedSince,
    decidedSince,
    dispatchedSince,
    latestQc,
  ] = await Promise.all([
    // ONE GROUPING OF THE LIVE SLABS answers four figures (four reads until
    // 2026-10-01, each a pass over chromia_slab and a round trip):
    //   where every slab is, by outcomeKeyOf — the outcome that was recorded,
    //     read against the status (CHR-3) — slabs with no outcome yet are the
    //     ones still on the line;
    //   received — every live slab;
    //   written off — a slab leaves the plant in exactly two ways: dispatched,
    //     or written off (status WASTE) after its final recalibration attempt;
    //   QC done — a grade has been decided, whatever it turned out to be.
    prisma.chromiaSlab.groupBy({
      by: ['currentDisposition', 'status', 'currentGrade'],
      where: { deletedAt: null },
      _count: { _all: true },
    }),

    // Received today, and of those, still on the line: a cycle that has not
    // been stamped out yet. The exact complement of "processing completed" for
    // today's intake — a slab is in one or the other, never both.
    prisma.chromiaSlab.findMany({
      where: { deletedAt: null, receivedDate: { gte: since } },
      select: {
        receivedDate: true,
        cycles: { where: { outTime: null }, select: { id: true }, take: 1 },
      },
    }),

    prisma.chromiaProcessCycle.findMany({
      where: { outTime: { gte: since } },
      select: { outTime: true },
    }),

    // Today's decisions by disposition; QC done today is all of them (the
    // disposition is required, so no decision falls outside a group).
    prisma.chromiaGradeDecision.findMany({
      where: { decidedAt: { gte: since } },
      select: { disposition: true, decidedAt: true },
    }),

    // DISPATCHED TODAY IS A DISPATCH RECORD DATED TODAY (CHR-3). It was today's
    // A → Dispatch decisions, which only join the Dispatch page's queue: a slab
    // graded today and still waiting counted as dispatched, and a slab graded
    // last week and sent today did not count at all.
    prisma.chromiaDispatch.findMany({
      where: { dispatchDate: { gte: since }, slab: { deletedAt: null } },
      select: { dispatchDate: true },
    }),

    prisma.chromiaGradeDecision.findMany({
      orderBy: { decidedAt: 'desc' },
      take: 8,
      select: {
        id: true,
        grade: true,
        disposition: true,
        decidedAt: true,
        slab: { select: { id: true, slabNo: true, batch: { select: { batchNo: true } } } },
      },
    }),
  ]);

  const outcomes: Partial<Record<OutcomeKey, number>> = {};
  let received = 0;
  let writtenOff = 0;
  let qcDone = 0;
  for (const row of slabGroups) {
    const key = outcomeKeyOf(row);
    outcomes[key] = (outcomes[key] ?? 0) + row._count._all;
    received += row._count._all;
    if (row.status === SlabStatus.WASTE) writtenOff += row._count._all;
    if (row.currentGrade != null) qcDone += row._count._all;
  }

  const receivedToday = fromDay(receivedSince, (slab) => slab.receivedDate, today);
  const leftPlant = fromDay(decidedSince, (decision) => decision.decidedAt, today);
  const qcDoneToday = leftPlant.length;

  const byOutcome = (key: OutcomeKey) => outcomes[key] ?? 0;

  const overall: OverallCounts = {
    received,
    dispatched: byOutcome(Disposition.DISPATCH),
    writtenOff,
    inProcessing: byOutcome('IN_PROCESSING'),
    qcDone,
    stocked: byOutcome(Disposition.STOCK),
    sampleCut: byOutcome(Disposition.SAMPLE_CUTTING),
    recalibration: byOutcome(Disposition.RECALIBRATION),
  };

  const dispositionToday = (key: string) =>
    leftPlant.filter((row) => row.disposition === key).length;

  return {
    overall: buildOverallTiles(overall),
    outcomes: buildOutcomeSplit(outcomes),
    today: {
      received: receivedToday.length,
      inProcessing: receivedToday.filter((slab) => slab.cycles.length > 0).length,
      processingDone: countFromDay(completedSince.map((cycle) => cycle.outTime), today),
      qcDone: qcDoneToday,
      dispatched: countFromDay(dispatchedSince.map((dispatch) => dispatch.dispatchDate), today),
      stocked: dispositionToday('STOCK'),
      sampleCut: dispositionToday('SAMPLE_CUTTING'),
      sentForRecalibration: dispositionToday('RECALIBRATION'),
    },
    latestQc,
  };
}
