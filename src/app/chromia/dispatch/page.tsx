import type { Metadata } from 'next';

import { EmptyState, PageHeader, Stat } from '@/components/chromia/ui';
import { dataTable, SectionCard } from '@/components/chromia/ui/form';
import { GradeBadge } from '@/components/chromia/ui/status';
import {
  buildDispatchedQuery,
  dispatchMonthOptions,
  hasDispatchedFilters,
  monthLabel,
  parseDispatchedFilters,
} from '@/lib/chromia/dispatched-filters';
import { PLANT_TIME_ZONE, toPlantDateInput } from '@/lib/chromia/plant-time';
import type { RawSearchParams } from '@/lib/chromia/simple-filters';
import { manualRemark } from '@/lib/chromia/slab-remarks';
import {
  dispatchedFilterOptions,
  dispatchedKpis,
  listDispatchedSlabs,
} from '@/lib/chromia/server/repositories/dispatch-repository';
import { requirePageUser } from '@/lib/pageUser';

import { DispatchedFindASlab } from './find-a-slab';

export const metadata: Metadata = { title: 'Dispatched' };
export const dynamic = 'force-dynamic';

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric', timeZone: PLANT_TIME_ZONE, });

const { th, td, tdMuted, tdNum } = dataTable;

/**
 * Dispatched (was Dispatch; renamed 27 Oct 2026).
 *
 * A record of every slab that has left the plant by dispatch — read-only:
 * nothing here edits, deletes or dispatches. Slabs are dispatched from the
 * Stockyard (Stock Outcome → Dispatch); the old Awaiting dispatch queue went
 * into the Stockyard with migration 0005.
 *
 * THREE SECTIONS, IN THIS ORDER:
 *
 *   Dashboard        Total Dispatched Slabs, Current Month and Previous Month,
 *                    by DISPATCH date on the plant calendar — never filtered;
 *   Find a Slab      Dispatch Date and Dispatch Date Range, Batch, Material and
 *                    Design, alone or together (lib/chromia/dispatched-filters);
 *   Dispatched Slabs every dispatched slab, newest dispatch first — all of them
 *                    until a filter narrows it, so its count with no filter is
 *                    Total Dispatched Slabs (dispatch-repository counts both).
 *
 * Dispatch Date is the dispatch record's own date: the one chosen when the
 * slab was sent. The Production Date beside it is the slab's, unchanged.
 */
export default async function DispatchedPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requirePageUser();
  const filters = parseDispatchedFilters(await searchParams);
  const filtered = hasDispatchedFilters(filters);
  const now = new Date();

  const [kpis, options, slabs] = await Promise.all([
    dispatchedKpis(now),
    dispatchedFilterOptions(),
    listDispatchedSlabs(filters, now),
  ]);

  const thisMonth = toPlantDateInput(now).slice(0, 7);
  const months = dispatchMonthOptions(now);

  return (
    <>
      <PageHeader
        title="Dispatched"
        description={`${kpis.total} ${kpis.total === 1 ? 'slab' : 'slabs'} dispatched to date`}
      />

      {/* ------------------------------------------------------ Dashboard --- */}
      <div className="mb-6">
        <SectionCard title="Dashboard" accent="brand" padded>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Total Dispatched Slabs" value={kpis.total} hint="All dispatched to date" tone="done" />
            <Stat
              label="Current Month Dispatched Slabs"
              value={kpis.currentMonth}
              hint={monthLabel(thisMonth)}
              tone="active"
            />
            <Stat
              label="Previous Month Dispatched Slabs"
              value={kpis.previousMonth}
              hint={monthLabel(months[1] ?? thisMonth)}
              tone="neutral"
            />
          </div>
        </SectionCard>
      </div>

      {/* ---------------------------------------------------- Find a Slab --- */}
      <div className="mb-6">
        <DispatchedFindASlab
          key={buildDispatchedQuery(filters)}
          values={{
            dispatchDate: filters.dispatchDate,
            range: filters.range ?? '',
            month: filters.month,
            from: filters.from,
            to: filters.to,
            batchNo: filters.batchNo,
            baseMaterial: filters.baseMaterial,
            fileName: filters.fileName,
          }}
          options={{
            ...options,
            months: months.map((value) => ({ value, label: monthLabel(value) })),
            today: toPlantDateInput(now),
          }}
        />
      </div>

      {/* ----------------------------------------------- Dispatched Slabs --- */}
      <SectionCard
        title="Dispatched Slabs"
        accent="active"
        padded={slabs.length === 0}
        actions={
          <span className="border-line surface text-muted rounded-full border px-3 py-1 text-xs font-medium">
            <span className="text-foreground font-semibold tabular-nums">{slabs.length}</span>{' '}
            {slabs.length === 1 ? 'slab' : 'slabs'}
            {filtered ? ' · filtered' : ''}
          </span>
        }
      >
        {slabs.length === 0 ? (
          <EmptyState>
            {filtered ? 'No dispatched slab matches these filters.' : 'No slab has been dispatched yet.'}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className={dataTable.root}>
              <thead className={dataTable.head}>
                <tr>
                  <th className={th}>Dispatch Date</th>
                  <th className={th}>Production Date</th>
                  <th className={th}>Batch No.</th>
                  <th className={th}>Slab No.</th>
                  <th className={th}>Base Material / Slab Name</th>
                  <th className={th}>File Name / Planned Design</th>
                  <th className={`${th} text-right`}>Thickness (cm)</th>
                  <th className={th}>Grade</th>
                  <th className={th}>Slab Remarks</th>
                </tr>
              </thead>
              <tbody>
                {slabs.map((slab) => (
                  <tr key={slab.id} className={dataTable.row}>
                    <td className={`${td} font-medium whitespace-nowrap`}>{dateFmt.format(slab.dispatchDate)}</td>
                    <td className={`${tdMuted} whitespace-nowrap`}>{dateFmt.format(slab.receivedDate)}</td>
                    <td className={`${tdMuted} font-mono`}>{slab.batchNo}</td>
                    <td className={`${td} font-mono`}>{slab.slabNo}</td>
                    <td className={td}>{slab.baseMaterial}</td>
                    <td className={tdMuted}>{slab.designFileName ?? '—'}</td>
                    <td className={`${tdNum} text-right`}>{slab.thicknessCm === null ? '—' : slab.thicknessCm}</td>
                    <td className={td}>
                      <GradeBadge grade={slab.grade} />
                    </td>
                    <td className={`${td} max-w-[16rem]`}>
                      {manualRemark(slab.remarks, slab.disposition) ?? <span className="text-muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </>
  );
}
