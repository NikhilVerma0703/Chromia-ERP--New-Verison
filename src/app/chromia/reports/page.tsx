import type { Metadata } from 'next';

import { HorizontalBars, PlaceDonut, PlaceLegend, StackedPlaceBars } from '@/components/chromia/charts/report-charts';
import { TrendLine } from '@/components/chromia/charts/trend-line';
import { EmptyState, PageHeader } from '@/components/chromia/ui';
import { PLACE_COLORS } from '@/lib/chromia/constants/production-places';
import { formatPlantDay, toPlantDateInput } from '@/lib/chromia/plant-time';
import { parseTrendRange, TREND_RANGE_LABELS } from '@/lib/chromia/reports-charts';
import { loadReportCharts } from '@/lib/chromia/server/repositories/report-repository';
import { requirePageUser } from '@/lib/pageUser';

import { TrendFilter } from './trend-filter';

export const metadata: Metadata = { title: 'Reports' };
export const dynamic = 'force-dynamic';

/** The brand teal: one series, one colour — a design has no colour of its own. */
const SERIES = '#0f4c5c'; // --color-brand-600

/** A chart panel: title and a line saying what it counts, as in the reference. */
function Panel({ title, note, actions, children }: { title: string; note: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-line surface rounded-xl border p-5 shadow-[0_1px_3px_rgba(16,24,40,0.06)] sm:p-6" aria-label={title}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-[17px] font-bold tracking-tight">{title}</h2>
          <p className="text-muted mt-0.5 text-xs">{note}</p>
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/**
 * Reports (was Production Summary; rebuilt 28 Oct 2026, change 11) — charts
 * only, every one from the live records (report-repository.ts):
 *
 *   1  Most Produced Designs                slabs per File Name / Planned Design
 *   2  Stock Distribution · Recalibration   the four placed outcomes · slabs by attempt
 *   3  Design-Wise Stock & Outcome          each design split by its six places
 *   4  Daily Production Trend               slabs produced per day, over a chosen range
 *
 * Every count is of physical slabs, as the dashboard counts them, so the
 * charts' totals are its KPIs. loading.tsx and error.tsx are the page's
 * loading and error states; each chart has its own empty state.
 */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageUser();
  const range = parseTrendRange(await searchParams);
  const charts = await loadReportCharts(range);
  const today = toPlantDateInput(new Date());
  const placed = charts.distribution.reduce((n, s) => n + s.count, 0);
  const everSent = charts.attempts[0]?.slabs ?? 0;
  const producedInRange = charts.trend.reduce((n, p) => n + p.slabs, 0);
  const rangeText =
    range.fromDay === range.toDay ? formatPlantDay(range.fromDay) : `${formatPlantDay(range.fromDay)} – ${formatPlantDay(range.toDay)}`;

  return (
    <>
      <PageHeader title="Reports" description={`${charts.total} slabs produced in all · every chart counts each physical slab once`} />

      <div className="flex flex-col gap-6">
        {/* ------------------------------------------ 1 · most produced designs --- */}
        <Panel title="Most Produced Designs" note="Slabs produced per File Name / Planned Design, most first">
          {charts.designs.length === 0 ? (
            <EmptyState>No slabs produced yet.</EmptyState>
          ) : (
            <HorizontalBars rows={charts.designs.map((d) => ({ label: d.design, value: d.total }))} color={SERIES} total={charts.total} />
          )}
        </Panel>

        {/* ------------------------- 2 · stock distribution & recalibration --- */}
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Stock Distribution" note="Where the placed slabs are now: Current Stock, Dispatched, Approved, Sample Cutting">
            {placed === 0 ? <EmptyState>No slab has been placed yet.</EmptyState> : <PlaceDonut slices={charts.distribution} />}
          </Panel>
          <Panel title="Recalibration Attempts" note="Unique slabs sent for each attempt — a slab sent twice is in the 1st and the 2nd">
            {everSent === 0 ? (
              <EmptyState>No slab has been sent for recalibration yet.</EmptyState>
            ) : (
              <HorizontalBars
                rows={charts.attempts.map((a) => ({ label: `${['1st', '2nd', '3rd', '4th', '5th'][a.attempt - 1]} Attempt`, value: a.slabs }))}
                color={PLACE_COLORS.RECALIBRATION}
                total={everSent}
                compact
              />
            )}
          </Panel>
        </div>

        {/* ------------------------- 3 · design-wise stock & outcome analysis --- */}
        <Panel title="Design-Wise Stock & Outcome Analysis" note="Each design's slabs by where they are now, most produced first">
          {charts.designs.length === 0 ? (
            <EmptyState>No slabs produced yet.</EmptyState>
          ) : (
            <div className="flex flex-col gap-5">
              <PlaceLegend />
              <StackedPlaceBars rows={charts.designs.map((d) => ({ label: d.design, total: d.total, places: d.places }))} />
            </div>
          )}
        </Panel>

        {/* ----------------------------------------- 4 · daily production trend --- */}
        <Panel
          title="Daily Production Trend"
          note={`${TREND_RANGE_LABELS[range.kind]} · ${rangeText} · ${producedInRange} ${producedInRange === 1 ? 'slab' : 'slabs'} produced`}
          actions={<TrendFilter kind={range.kind} month={range.month} from={range.fromDay} to={range.toDay} today={today} />}
        >
          {range.problem ? <p className="text-status-waste mb-3 text-sm font-medium">{range.problem} Showing the Last 30 Days.</p> : null}
          {producedInRange === 0 ? (
            <EmptyState>No slabs were produced in this range.</EmptyState>
          ) : (
            <TrendLine points={charts.trend} color={SERIES} />
          )}
        </Panel>
      </div>
    </>
  );
}
