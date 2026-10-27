import type { Metadata } from 'next';

import { GroupedBars } from '@/components/chromia/charts/grouped-bars';
import { TrendBars } from '@/components/chromia/charts/trend-bars';
import { PieShare } from '@/components/chromia/charts/pie-share';
import { EmptyState, Field, PageHeader, Stat } from '@/components/chromia/ui';
import { dataTable, field as fieldClass, SectionCard } from '@/components/chromia/ui/form';
import { parseRange } from '@/lib/chromia/reports';
import { loadProductionSummary } from '@/lib/chromia/server/repositories/report-repository';
import { formatPlantDay, isPlantDayKey, PLANT_TIME_ZONE, toPlantDateInput } from '@/lib/chromia/plant-time';
import { requirePageUser } from '@/lib/pageUser';

export const metadata: Metadata = { title: 'Production Summary' };
export const dynamic = 'force-dynamic';

const { th, td, tdNum } = dataTable;

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric', timeZone: PLANT_TIME_ZONE, });

/**
 * The plant day an end of the range names, for the date inputs. The range is
 * built from plant days (CHR-8, the code review of 20 Oct 2026), so its first
 * instant is 00:00 plant time — the day before, in UTC, which is what
 * `toISOString` used to print here.
 */
function iso(date: Date): string {
  return toPlantDateInput(date);
}

/** A diary row's plant day, "03 May 2026". */
function longDay(day: string): string {
  return isPlantDayKey(day) ? formatPlantDay(day) : day;
}

/**
 * Production summary.
 *
 * One page, one question: how did the plant do over this period? Headline
 * figures, a daily trend, the outcome mix, the recalibration funnel, and two
 * tables — the day-by-day diary and the per-material breakdown. Nothing here
 * repeats what Slabs, Downloads or Recalibration Tracking already answer at
 * row level; this page never names a slab.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Signed in, or no further, on every visit: the module layout's gate is
  // not run again when the browser moves between this module's pages
  // (requirePageUser in lib/pageUser.ts says why).
  await requirePageUser();
  const params = await searchParams;
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? (value[0] ?? '') : (value ?? '');

  const range = parseRange(first(params.from), first(params.to));
  const summary = await loadProductionSummary(range);
  const { headline } = summary;

  const empty = headline.received === 0;

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Production summary"
        description={`${dateFmt.format(range.from)} – ${dateFmt.format(range.to)}`}
      />

      {/* --------------------------------------------------------- period --- */}
      <SectionCard title="Period" accent="active" padded={false}>
        <form method="get" className="flex flex-wrap items-end gap-4 px-7 py-5">
          <Field label="Date From" htmlFor="from" className="w-44">
            <input
              id="from"
              name="from"
              type="date"
              defaultValue={iso(range.from)}
              className={fieldClass}
            />
          </Field>
          <Field label="Date To" htmlFor="to" className="w-44">
            <input
              id="to"
              name="to"
              type="date"
              defaultValue={iso(range.to)}
              className={fieldClass}
            />
          </Field>
          <button
            type="submit"
            className="bg-brand-600 hover:bg-brand-700 inline-flex h-11 items-center justify-center rounded-lg px-6 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(16,24,40,0.12)] transition-colors"
          >
            Apply
          </button>
        </form>
      </SectionCard>

      {empty ? (
        <div className="mt-6">
          <EmptyState>No slabs were received in this period.</EmptyState>
        </div>
      ) : (
        <>
          {/* ----------------------------------------------------- headline --- */}
          <section className="mt-8 mb-8">
            <h2 className="text-muted mb-3 text-[11px] font-semibold tracking-[0.14em] uppercase">
              Headline
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Stat label="Slabs produced" value={headline.received} tone="active" />
              <Stat label="Still in process" value={headline.inProcess} tone="neutral" />
              <Stat label="Dispatched" value={headline.dispatched} tone="done" />
              <Stat label="Stock" value={headline.stocked} tone="active" />
              <Stat label="Sample cutting" value={headline.sampleCut} tone="hold" />
              <Stat label="Recalibration" value={headline.recalibrated} tone="recalibration" />
            </div>
          </section>

          {/* --------------------------------------------- outcome mix --- */}
          <div className="mb-6">
            <SectionCard title="Where the slabs went" accent="active">
              <PieShare segments={summary.outcomes} />
            </SectionCard>
          </div>

          {/* ------------------------------------------ chart 1: trend --- */}
          <div className="mt-8 mb-6">
            <SectionCard title="Production Trend" accent="active">
              <TrendBars days={summary.daily} />
            </SectionCard>
          </div>

          {/* ---------------------------------------------- table 1: daily --- */}
          <div className="mb-6">
            <SectionCard title="Day by day" padded={false}>
              <div className="overflow-x-auto">
                <table className={dataTable.root}>
                  <thead className={dataTable.head}>
                    <tr>
                      <th className={th}>Date</th>
                      <th className={`${th} text-right`}>Received</th>
                      <th className={`${th} text-right`}>Processing done</th>
                      <th className={`${th} text-right`}>Dispatched</th>
                      <th className={`${th} text-right`}>Stock</th>
                      <th className={`${th} text-right`}>Sample cutting</th>
                      <th className={`${th} text-right`}>Recalibration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.daily.map((row) => (
                      <tr key={row.day} className={dataTable.row}>
                        <td className={`${td} font-medium whitespace-nowrap`}>
                          {longDay(row.day)}
                        </td>
                        <td className={`${tdNum} text-right`}>{row.received}</td>
                        <td className={`${tdNum} text-right`}>{row.processingDone}</td>
                        <td className={`${tdNum} text-right`}>{row.dispatched}</td>
                        <td className={`${tdNum} text-right`}>{row.stocked}</td>
                        <td className={`${tdNum} text-right`}>{row.sampleCut}</td>
                        <td className={`${tdNum} text-right`}>{row.recalibration}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-line-strong surface-muted border-t font-semibold">
                    <tr>
                      <td className={td}>Total</td>
                      <td className={`${tdNum} text-right`}>{summary.dailyTotal.received}</td>
                      <td className={`${tdNum} text-right`}>{summary.dailyTotal.processingDone}</td>
                      <td className={`${tdNum} text-right`}>{summary.dailyTotal.dispatched}</td>
                      <td className={`${tdNum} text-right`}>{summary.dailyTotal.stocked}</td>
                      <td className={`${tdNum} text-right`}>{summary.dailyTotal.sampleCut}</td>
                      <td className={`${tdNum} text-right`}>{summary.dailyTotal.recalibration}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </SectionCard>
          </div>

          {/* -------------------------------- chart 2: base material --- */}
          <div className="mb-6">
            <SectionCard title="Base Material Performance" accent="grade">
              <GroupedBars materials={summary.materials} />
            </SectionCard>
          </div>

          {/* ------------------------------------------- table 2: material --- */}
          <SectionCard title="By base material" accent="grade" padded={false}>
            <div className="overflow-x-auto">
              <table className={dataTable.root}>
                <thead className={dataTable.head}>
                  <tr>
                    <th className={th}>Base Material</th>
                    <th className={`${th} text-right`}>Received</th>
                    <th className={`${th} text-right`}>Dispatched</th>
                    <th className={`${th} text-right`}>Stocked</th>
                    <th className={`${th} text-right`}>Sample cut</th>
                    <th className={`${th} text-right`}>Recalibrated</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.materials.map((row) => (
                    <tr key={row.name} className={dataTable.row}>
                      <td className={`${td} font-medium`}>{row.name}</td>
                      <td className={`${tdNum} text-right`}>{row.received}</td>
                      <td className={`${tdNum} text-right`}>{row.dispatched}</td>
                      <td className={`${tdNum} text-right`}>{row.stocked}</td>
                      <td className={`${tdNum} text-right`}>{row.sampleCut}</td>
                      <td className={`${tdNum} text-right`}>{row.recalibrated}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-line-strong surface-muted border-t font-semibold">
                  <tr>
                    <td className={td}>{summary.materialTotal.name}</td>
                    <td className={`${tdNum} text-right`}>{summary.materialTotal.received}</td>
                    <td className={`${tdNum} text-right`}>{summary.materialTotal.dispatched}</td>
                    <td className={`${tdNum} text-right`}>{summary.materialTotal.stocked}</td>
                    <td className={`${tdNum} text-right`}>{summary.materialTotal.sampleCut}</td>
                    <td className={`${tdNum} text-right`}>{summary.materialTotal.recalibrated}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </SectionCard>
        </>
      )}
    </>
  );
}
