import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState, PageHeader, Stat } from '@/components/chromia/ui';
import { dataTable, SectionCard } from '@/components/chromia/ui/form';
import { GradeBadge } from '@/components/chromia/ui/status';
import { attemptOf, buildTrackingKpis } from '@/lib/chromia/recalibration-kpis';
import { daysOut, formatDaysOut, stageOf, statusLabel } from '@/lib/chromia/recalibration-flow';
import {
  buildQuery,
  hasActiveFilters,
  parseTrackingFilters,
  endOfDay,
  type RawSearchParams,
} from '@/lib/chromia/recalibration-tracking-filters';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { parsePage, RECALIBRATION_PAGE_SIZE } from '@/lib/chromia/list-limits';
import { searchRecalibrationPage } from '@/lib/chromia/server/repositories/recalibration-flow-repository';
import { loadFilterOptions } from '@/lib/chromia/server/repositories/slab-repository';
import { PLANT_TIME_ZONE } from '@/lib/chromia/plant-time';
import { requirePageUser } from '@/lib/pageUser';

import { FilterBar } from './filter-bar';

export const metadata: Metadata = { title: 'Recalibration Tracking' };
export const dynamic = 'force-dynamic';

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric', timeZone: PLANT_TIME_ZONE, });

const { th, td, tdMuted, tdNum } = dataTable;

const pageButton =
  'border-line surface hover:border-line-strong inline-flex h-11 items-center justify-center rounded-lg border px-4 text-sm font-medium transition-colors hover:bg-[var(--surface-muted)]';

const STAGE_CLASS: Record<string, string> = {
  AWAITING_SEND: 'text-status-recalibration font-semibold',
  OUT: 'text-status-hold font-semibold',
  RETURNED: 'text-status-active font-semibold',
  IN_PRODUCTION: 'text-status-active font-medium',
  CLEARED: 'text-status-done font-medium',
  WRITTEN_OFF: 'text-status-waste font-semibold',
};

/**
 * Recalibration Tracking.
 *
 * The Recalibration page is where the work is recorded. This one only watches:
 * how many slabs are in the recovery loop, how far down it they have gone, and
 * how many the plant actually saved on each pass. Nothing here writes anything,
 * which is why the slab numbers are plain text — there is exactly one place to
 * record each step, and it is not this screen.
 *
 * Every figure is derived from the slab's own trips on each read, so the page
 * can never disagree with the Recalibration page about what has happened.
 */
export default async function RecalibrationTrackingPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  // Signed in, or no further, on every visit: the module layout's gate is
  // not run again when the browser moves between this module's pages
  // (requirePageUser in lib/pageUser.ts says why).
  await requirePageUser();
  const params = await searchParams;
  const filters = parseTrackingFilters(params);

  /*
   * A hundred rows to a page (the code review of 20 Oct 2026, CHR-10): the
   * list loaded every slab that had ever had a trip, with all its trips. The
   * figures above it still cover every match — they are built from the states
   * of all of them — and the attempt filter, counted from the trips rather
   * than stored, is applied to those states before the page is cut, on exactly
   * the number the table shows.
   */
  const [result, [baseMaterials, designs]] = await Promise.all([
    searchRecalibrationPage(
      {
        batchNo: filters.batchNo,
        slabNo: filters.slabNo,
        baseMaterialId: filters.baseMaterialId,
        designId: filters.designId,
        receivedFrom: filters.receivedFrom,
        receivedTo: filters.receivedTo ? endOfDay(filters.receivedTo) : null,
      },
      {
        page: parsePage(params.page),
        pageSize: RECALIBRATION_PAGE_SIZE,
        keep: filters.attempt === null ? undefined : (state) => attemptOf(state) === filters.attempt,
      },
    ),
    loadFilterOptions(),
  ]);

  const rows = result.records.map((record) => ({
    record,
    state: {
      disposition: record.currentDisposition,
      writtenOff: record.status === 'WASTE',
      trips: record.trips,
    },
  }));

  const kpis = buildTrackingKpis(result.states);
  const filtered = hasActiveFilters(filters);
  const now = new Date();
  const pageHref = (page: number) => {
    const query = buildQuery(filters);
    return `${APP_ROUTES.recalibrationTracking}?${query ? `${query}&` : ''}page=${page}`;
  };

  return (
    <>
      <PageHeader eyebrow="Monitoring" title="Recalibration tracking" />

      {/* ------------------------------------------------------------ KPIs --- */}
      <section className="mb-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/*
           * The figures follow the search rather than ignoring it: filter to
           * one material and the cards tell you how that material behaves,
           * which is the question worth asking. The hint says so out loud, so
           * a number that has changed is never mistaken for the plant total.
           */}
          <Stat
            label="Total Recalibration Slabs"
            value={kpis.total}
            tone="recalibration"
            hint={filtered ? 'Matching the current filters' : undefined}
          />
          <Stat
            label="Waiting In Plant"
            value={kpis.waiting}
            tone="hold"
            hint="Condemned by QC, not yet sent"
          />
          <Stat label="Out For Recalibration" value={kpis.out} tone="active" />
          <Stat
            label="Cleared After Recalibration"
            value={kpis.cleared}
            tone="done"
            hint="Passed QC on a later pass"
          />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {kpis.completed.map((bucket) => (
            <Stat
              key={bucket.attempt}
              label={bucket.label}
              value={bucket.count}
              tone={bucket.attempt >= 4 ? 'waste' : 'neutral'}
            />
          ))}
          <Stat label="Written Off / Waste" value={kpis.writtenOff} tone="waste" />
        </div>
      </section>

      <FilterBar filters={filters} baseMaterials={baseMaterials} designs={designs} />

      {/* --------------------------------------------------------- results --- */}
      <SectionCard
        title="Tracking"
        accent="grade"
        padded={rows.length === 0}
        actions={
          <span className="border-line surface text-muted rounded-full border px-3 py-1 text-xs font-medium">
            {result.pages > 1 ? (
              <>
                <span className="text-foreground font-semibold tabular-nums">
                  {result.from}–{result.to}
                </span>{' '}
                of{' '}
              </>
            ) : null}
            <span className="text-foreground font-semibold tabular-nums">{result.total}</span>{' '}
            {result.total === 1 ? 'slab' : 'slabs'}
            {filtered ? ' matching' : ''}
          </span>
        }
      >
        {rows.length === 0 ? (
          <EmptyState>
            {filtered
              ? 'Nothing found. Try widening the filters.'
              : 'No slab has been marked for recalibration yet.'}
          </EmptyState>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className={dataTable.root}>
                <thead className={dataTable.head}>
                  <tr>
                    <th className={th}>Production Date</th>
                    <th className={th}>Batch No.</th>
                    <th className={th}>Slab No.</th>
                    <th className={th}>Base Material / Slab Name</th>
                    <th className={th}>File Name / Planned Design</th>
                    <th className={`${th} text-right`}>Thickness (cm)</th>
                    <th className={th}>Grade</th>
                    <th className={th}>Reason</th>
                    <th className={`${th} text-right`}>Attempt</th>
                    <th className={th}>Sent Date</th>
                    <th className={th}>Received Date</th>
                    <th className={th}>Status</th>
                    <th className={th}>Days out</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ record, state }) => {
                    const ageing = daysOut(state, record.condemnedAt, now);

                    return (
                      <tr key={record.id} className={dataTable.row}>
                        <td className={`${td} font-medium whitespace-nowrap`}>
                          {dateFmt.format(record.receivedDate)}
                        </td>
                        <td className={`${tdMuted} font-mono`}>{record.batch.batchNo}</td>
                        <td className={`${td} font-mono`}>{record.slabNo}</td>
                        <td className={td}>{record.baseMaterial.name}</td>
                        <td className={tdMuted}>
                          {record.plannedDesign?.fileName ?? record.plannedDesign?.name ?? '—'}
                        </td>
                        <td className={`${tdNum} text-right`}>
                          {record.thicknessCm === null ? '—' : record.thicknessCm}
                        </td>
                        <td className={td}>
                          <GradeBadge grade={record.currentGrade} />
                        </td>
                        <td className={td}>{record.reason ?? '—'}</td>
                        <td className={`${tdNum} text-right font-semibold`}>{attemptOf(state)}</td>
                        <td className={`${tdMuted} whitespace-nowrap`}>
                          {record.sentDate ? dateFmt.format(record.sentDate) : '—'}
                        </td>
                        <td className={`${tdMuted} whitespace-nowrap`}>
                          {record.returnedDate ? dateFmt.format(record.returnedDate) : '—'}
                        </td>
                        <td className={`${td} whitespace-nowrap`}>
                          <span className={STAGE_CLASS[stageOf(state)] ?? ''}>
                            {statusLabel(state, record.currentGrade)}
                          </span>
                        </td>
                        <td
                          className={`${tdNum} whitespace-nowrap ${
                            ageing.overdue ? 'text-status-waste font-medium' : 'text-muted'
                          }`}
                        >
                          {formatDaysOut(ageing)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {result.pages > 1 ? (
              <nav className="border-line surface-muted flex items-center justify-between border-t px-5 py-3.5 text-sm">
                <span className="text-muted">
                  Page <span className="text-foreground font-medium">{result.page}</span> of{' '}
                  {result.pages}
                </span>
                <span className="flex gap-2">
                  {result.page > 1 ? (
                    <Link href={pageHref(result.page - 1)} className={pageButton}>
                      Previous
                    </Link>
                  ) : null}
                  {result.page < result.pages ? (
                    <Link href={pageHref(result.page + 1)} className={pageButton}>
                      Next
                    </Link>
                  ) : null}
                </span>
              </nav>
            ) : null}
          </>
        )}
      </SectionCard>
    </>
  );
}
