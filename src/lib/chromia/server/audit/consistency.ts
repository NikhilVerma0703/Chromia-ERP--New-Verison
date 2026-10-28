import { ChromiaSlabStatus as SlabStatus, ChromiaStockOutcome as StockOutcome } from '@prisma/client';

import { prisma } from '@/lib/chromia/db';
import { PRODUCTION_PLACES } from '@/lib/chromia/constants/production-places';
import { parseApprovedFilters } from '@/lib/chromia/approved-filters';
import { parseDispatchedFilters } from '@/lib/chromia/dispatched-filters';
import { boardRows, parseBoardFilters } from '@/lib/chromia/recalibration-board';
import { buildTrackingKpis } from '@/lib/chromia/recalibration-kpis';
import { parseSlabFilters } from '@/lib/chromia/slab-filters';
import { parseStockyardFilters } from '@/lib/chromia/stockyard-filters';
import { approvedKpi, listApprovedSlabs } from '@/lib/chromia/server/repositories/approved-repository';
import { loadProductionDashboard } from '@/lib/chromia/server/repositories/dashboard-repository';
import { dispatchedKpis, listDispatchedSlabs } from '@/lib/chromia/server/repositories/dispatch-repository';
import {
  loadRecalibrationBoard,
  searchRecalibrationStates,
} from '@/lib/chromia/server/repositories/recalibration-flow-repository';
import { searchSlabs } from '@/lib/chromia/server/repositories/slab-repository';
import { loadReportCharts } from '@/lib/chromia/server/repositories/report-repository';
import { parseTrendRange } from '@/lib/chromia/reports-charts';
import {
  listStockedSlabs,
  listStockOutcomeRecords,
  stockyardKpis,
} from '@/lib/chromia/server/repositories/stockyard-repository';
import { physicalSlabWhere } from '@/lib/chromia/server/repositories/physical-slabs';

/**
 * THE CHROMIA CONSISTENCY AUDIT (28 Oct 2026, change 10).
 *
 * Reads the database through the very functions the pages render from — the
 * dashboard, Slab Records, Stockyard, Dispatched, Approved Slabs, Recalibration
 * and Recalibration Tracking — and checks that every KPI equals the number of
 * unique slabs in the list it stands for, that the pages agree with each
 * other, and that every slab's status agrees with the records behind it (a
 * dispatched slab has its dispatch, a slab in stock its open stock entry…).
 *
 * Read-only: it writes nothing, so it can be run against any database
 * (scripts/chromia-audit.ts), and the workflow test runs it after every step.
 */

export interface AuditCheck {
  check: string;
  expected: number | string;
  actual: number | string;
  ok: boolean;
}

export async function auditConsistency(now: Date = new Date()): Promise<AuditCheck[]> {
  const checks: AuditCheck[] = [];
  const same = (check: string, expected: number | string, actual: number | string) =>
    checks.push({ check, expected, actual, ok: expected === actual });
  const none = (check: string, offenders: string[]) =>
    checks.push({ check, expected: 'none', actual: offenders.length ? offenders.slice(0, 10).join(', ') : 'none', ok: offenders.length === 0 });

  const [dashboard, yard, inStock, sentDispatch, sentApproved, sentCut, dispatched, dispatchedList, approved, approvedList, records, board, tracking] =
    await Promise.all([
      loadProductionDashboard(null, now),
      stockyardKpis(),
      listStockedSlabs(),
      listStockOutcomeRecords('DISPATCH', parseStockyardFilters({ outcome: 'DISPATCH' })),
      listStockOutcomeRecords('APPROVED', parseStockyardFilters({ outcome: 'APPROVED' })),
      listStockOutcomeRecords('SAMPLE_CUTTING', parseStockyardFilters({ outcome: 'SAMPLE_CUTTING' })),
      dispatchedKpis(now),
      listDispatchedSlabs(parseDispatchedFilters({}), now),
      approvedKpi(),
      listApprovedSlabs(parseApprovedFilters({})),
      searchSlabs(parseSlabFilters({}), { wholeRange: false }),
      loadRecalibrationBoard(parseBoardFilters({}), { page: 1, pageSize: 100_000 }),
      searchRecalibrationStates({ productionDate: null, batchNo: '', slabNo: '', baseMaterial: '', fileName: '' } as never),
    ]);
  const { overall } = dashboard;
  const unique = (ids: string[]) => new Set(ids).size;

  // ── Produced ──────────────────────────────────────────────────────────
  same('Slab Records total = Dashboard Total Produced', overall.produced, records.total);
  same('Palette sums to Total Produced', overall.produced, PRODUCTION_PLACES.reduce((n, p) => n + overall.places[p], 0));

  // ── Reports (change 11) ───────────────────────────────────────────────
  const reports = await loadReportCharts(parseTrendRange({ range: '30d' }, now));
  const slice = (place: string) => reports.distribution.find((s) => s.place === place)?.count ?? -1;
  same('Reports designs add up to Total Produced', overall.produced, reports.designs.reduce((n, d) => n + d.total, 0));
  same('Reports design-wise segments add up to Total Produced', overall.produced, reports.designs.reduce((n, d) => n + PRODUCTION_PLACES.reduce((m, p) => m + d.places[p], 0), 0));
  same('Reports donut Current Stock = Dashboard', overall.currentStock, slice('STOCK'));
  same('Reports donut Dispatched = Dashboard', overall.dispatched, slice('DISPATCHED'));
  same('Reports donut Approved = Dashboard', overall.approved, slice('APPROVED'));
  same('Reports donut Sample Cutting = Dashboard', overall.sampleCutting, slice('SAMPLE_CUTTING'));
  for (const place of PRODUCTION_PLACES) {
    same(`Reports design-wise ${place} = Dashboard palette`, overall.places[place], reports.designs.reduce((n, d) => n + d.places[place], 0));
  }

  // ── Current Stock ─────────────────────────────────────────────────────
  same('Stockyard Current Stock = In Stock Records rows', yard.currentStock, inStock.length);
  same('In Stock Records rows are unique slabs', inStock.length, unique(inStock.map((s) => s.id)));
  same('Dashboard Current Stock = Stockyard Current Stock', overall.currentStock, yard.currentStock);

  // ── Dispatched ────────────────────────────────────────────────────────
  same('Dispatched page KPI = Dispatched records', dispatched.total, dispatchedList.length);
  same('Dispatched records are unique slabs', dispatchedList.length, unique(dispatchedList.map((s) => s.slabId)));
  same('Stockyard Dispatched = Dispatched page', yard.dispatched, dispatched.total);
  same('Stockyard Dispatched = its Stock Outcome list', yard.dispatched, sentDispatch.length);
  same('Dashboard Dispatched = Dispatched page', overall.dispatched, dispatched.total);

  // ── Approved ──────────────────────────────────────────────────────────
  same('Approved Slabs KPI = Approved records', approved, approvedList.length);
  same('Approved records are unique slabs', approvedList.length, unique(approvedList.map((s) => s.slabId)));
  same('Stockyard Approved = Approved Slabs', yard.approved, approved);
  same('Stockyard Approved = its Stock Outcome list', yard.approved, sentApproved.length);
  same('Dashboard Approved = Approved Slabs', overall.approved, approved);

  // ── Sample Cutting ────────────────────────────────────────────────────
  same('Stockyard Sample Cutting = its Stock Outcome list', yard.sampleCutting, sentCut.length);
  same('Dashboard Sample Cutting = Stockyard', overall.sampleCutting, yard.sampleCutting);

  // ── Recalibration ─────────────────────────────────────────────────────
  for (const view of ['ready', 'sent', 'received', 'pending'] as const) {
    same(`Recalibration ${view} KPI = its rows`, board.kpis[view], boardRows(board.states, view).length);
  }
  same('Recalibration Pending = Sent − Received', board.kpis.sent - board.kpis.received, board.kpis.pending);
  const trackingKpis = buildTrackingKpis(tracking);
  same('Tracking waiting = Recalibration Ready', board.kpis.ready, trackingKpis.waiting);
  same('Tracking out = Recalibration Pending', board.kpis.pending, trackingKpis.out);

  // ── Every slab's status agrees with its records ───────────────────────
  const slabs = await prisma.chromiaSlab.findMany({
    where: await physicalSlabWhere(),
    select: {
      slabNo: true,
      status: true,
      currentDisposition: true,
      currentGrade: true,
      dispatches: { select: { id: true } },
      sampleCuttings: { select: { id: true } },
      stockEntries: { select: { releasedAt: true, releaseOutcome: true } },
      recalibrations: { select: { sentDate: true, receivedDate: true } },
    },
  });
  const open = (s: (typeof slabs)[number]) => s.stockEntries.filter((e) => e.releasedAt === null).length;
  none('A slab in stock has exactly one open stock entry', slabs.filter((s) => s.status === SlabStatus.IN_STOCK && open(s) !== 1).map((s) => s.slabNo));
  none('A slab not in stock has no open stock entry', slabs.filter((s) => s.status !== SlabStatus.IN_STOCK && open(s) > 0).map((s) => s.slabNo));
  none('A dispatched slab has its dispatch record', slabs.filter((s) => s.status === SlabStatus.DISPATCHED && s.dispatches.length === 0).map((s) => s.slabNo));
  none('A slab with a dispatch record is dispatched', slabs.filter((s) => s.dispatches.length > 0 && s.status !== SlabStatus.DISPATCHED).map((s) => s.slabNo));
  none('A dispatched slab was dispatched once', slabs.filter((s) => s.dispatches.length > 1).map((s) => s.slabNo));
  none('A sample-cut slab has its cut record', slabs.filter((s) => s.status === SlabStatus.SAMPLE_CUT && s.sampleCuttings.length === 0).map((s) => s.slabNo));
  none(
    'An approved slab was approved from stock',
    slabs.filter((s) => s.status === SlabStatus.APPROVED && !s.stockEntries.some((e) => e.releaseOutcome === StockOutcome.APPROVED)).map((s) => s.slabNo),
  );
  none(
    'A stock entry released as Approved belongs to an approved slab',
    slabs.filter((s) => s.status !== SlabStatus.APPROVED && s.stockEntries.some((e) => e.releaseOutcome === StockOutcome.APPROVED)).map((s) => s.slabNo),
  );
  none(
    'A slab out at recalibration has exactly one trip out',
    slabs.filter((s) => s.status === SlabStatus.OUT_FOR_RECALIBRATION && s.recalibrations.filter((t) => t.sentDate && !t.receivedDate).length !== 1).map((s) => s.slabNo),
  );
  none(
    'A slab with a trip out is out at recalibration',
    slabs.filter((s) => s.recalibrations.some((t) => t.sentDate && !t.receivedDate) && s.status !== SlabStatus.OUT_FOR_RECALIBRATION).map((s) => s.slabNo),
  );
  none('A graded slab has a grade', slabs.filter((s) => s.currentDisposition !== null && s.currentGrade === null).map((s) => s.slabNo));

  return checks;
}
