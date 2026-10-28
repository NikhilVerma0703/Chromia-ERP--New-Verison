import type { Metadata } from 'next';
import Link from 'next/link';

import { PlacePalette } from '@/components/chromia/charts/place-palette';
import { EmptyState, PageHeader, Stat } from '@/components/chromia/ui';
import { dataTable, SectionCard } from '@/components/chromia/ui/form';
import { GradeBadge, StatusBadge } from '@/components/chromia/ui/status';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { PLANT_TIME_ZONE, formatPlantDay } from '@/lib/chromia/plant-time';
import { parseProcessingView, type ProcessingView } from '@/lib/chromia/production-overview';
import { ordinal } from '@/lib/chromia/recalibration-flow';
import type { RawSearchParams } from '@/lib/chromia/simple-filters';
import { loadProductionDashboard, type ProcessingRow } from '@/lib/chromia/server/repositories/dashboard-repository';
import { requirePageUser } from '@/lib/pageUser';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: PLANT_TIME_ZONE });
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: PLANT_TIME_ZONE });

const { th, td, tdMuted, tdNum } = dataTable;

/** A section's heading: centred, bold, larger, on a highlighted band. */
function SectionHeading({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="bg-brand-50 border-brand-200 mb-4 rounded-xl border px-5 py-3 text-center">
      <h2 className="text-brand-800 text-[22px] leading-tight font-bold tracking-tight">{children}</h2>
      {hint ? <p className="text-brand-700 mt-0.5 text-xs font-medium">{hint}</p> : null}
    </div>
  );
}

const PROCESSING_TITLE: Record<ProcessingView, string> = {
  processing: 'Total In Processing Slabs',
  'today-processing': 'Today In-Processing Slabs',
};

/**
 * Main Production Dashboard (rebuilt 27 Oct 2026).
 *
 *   Overall Production   six KPIs: Produced · In Processing · Current Stock ·
 *                        Dispatched · Approved · Sample Cutting;
 *                        the palette — every produced slab in one of six
 *                        places, each in its own colour;
 *   Today's Production   the same six, for today (IST).
 *
 * Every figure is a count of unique slabs (14567 and 14567-A are one), read
 * live; production-overview.ts says how each is counted. The two In-Processing
 * KPIs are links, as on the Recalibration page: each opens the table of the
 * slabs it counts, and a second click closes it.
 */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  await requirePageUser();
  const params = await searchParams;
  const view = parseProcessingView(params.view);
  const { today, overall, todays, processing } = await loadProductionDashboard(view);

  return (
    <>
      <PageHeader title="Production dashboard" size="lg" />

      {/* ------------------------------------------ 1 · overall production --- */}
      <section className="mb-8">
        <SectionHeading>Overall Production</SectionHeading>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Stat label="Total Produced Slabs" value={overall.produced} tone="active" />
          <KpiLink view="processing" current={view} label="Total In Processing Slabs" value={overall.inProcessing} />
          <Stat label="Total Current Stock Slabs" value={overall.currentStock} tone="stock" />
          <Stat label="Total Dispatched Slabs" value={overall.dispatched} tone="done" />
          <Stat label="Total Approved Slabs" value={overall.approved} tone="approved" />
          <Stat label="Total Sample Cutting Slabs" value={overall.sampleCutting} tone="hold" />
        </div>
        {view === 'processing' ? <ProcessingTable view={view} rows={processing ?? []} /> : null}
      </section>

      {/* ------------------------- 2 · the palette: where they are, untitled --- */}
      <section className="border-line surface mb-8 rounded-xl border p-5 shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
        <PlacePalette counts={overall.places} />
      </section>

      {/* ------------------------------------------- 3 · today's production --- */}
      <section className="mb-8">
        <SectionHeading hint={formatPlantDay(today)}>Today&rsquo;s Production</SectionHeading>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Stat label="Today Produced" value={todays.produced} tone="active" />
          <KpiLink view="today-processing" current={view} label="Today In-Processing" value={todays.inProcessing} />
          <Stat label="Today Stock" value={todays.stock} tone="stock" />
          <Stat label="Today Dispatched" value={todays.dispatched} tone="done" />
          <Stat label="Today Approved" value={todays.approved} tone="approved" />
          <Stat label="Today Sample Cutting" value={todays.sampleCutting} tone="hold" />
        </div>
        {view === 'today-processing' ? <ProcessingTable view={view} rows={processing ?? []} /> : null}
      </section>
    </>
  );
}

/** An In-Processing KPI: a card that opens (and closes) its own table. */
function KpiLink({
  view,
  current,
  label,
  value,
}: {
  view: ProcessingView;
  current: ProcessingView | null;
  label: string;
  value: number;
}) {
  const active = current === view;
  return (
    <Link
      href={active ? APP_ROUTES.dashboard : `${APP_ROUTES.dashboard}?view=${view}`}
      scroll={false}
      aria-current={active ? 'true' : undefined}
      data-kpi={view}
      title={active ? 'Showing these — click again to close the table' : 'Show these slabs in a table'}
      className={`surface block h-full rounded-xl border p-5 shadow-[0_1px_3px_rgba(16,24,40,0.06)] transition-colors hover:border-brand-400 ${
        active ? 'border-brand-600 ring-brand-600 ring-2' : 'border-line'
      }`}
    >
      <div className="flex items-start gap-2">
        <span className={`mt-[6px] inline-block size-1.5 shrink-0 rounded-full bg-status-processing`} />
        <span className="text-muted text-[11px] leading-[1.35] font-semibold tracking-[0.1em] uppercase">{label}</span>
      </div>
      <p className="mt-3 text-[30px] leading-none font-semibold tracking-tight tabular-nums">{value}</p>
      <p className="text-brand-700 mt-2 text-xs font-medium">{active ? 'Shown below · click to close' : 'Click to see the slabs'}</p>
    </Link>
  );
}

/** Where QC has got with a slab still on the line. */
function qcStatus(row: ProcessingRow): string {
  if (row.status === 'GRADED' || row.status === 'ON_HOLD') return 'QC recorded — not yet placed';
  return row.afterAttempt ? `Awaiting QC — after ${ordinal(row.afterAttempt)} recalibration` : 'Awaiting QC Report';
}

function ProcessingTable({ view, rows }: { view: ProcessingView; rows: ProcessingRow[] }) {
  return (
    <div className="mt-5">
      <SectionCard
        title={PROCESSING_TITLE[view]}
        accent="active"
        padded={rows.length === 0}
        actions={
          <span className="border-line surface text-muted rounded-full border px-3 py-1 text-xs font-medium">
            Slabs: <span className="text-foreground font-semibold tabular-nums">{rows.length}</span>
          </span>
        }
      >
        {rows.length === 0 ? (
          <EmptyState>No slab is in processing{view === 'today-processing' ? ' from today’s production' : ''}.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className={dataTable.root}>
              <thead className={dataTable.head}>
                <tr>
                  <th className={`${th} text-right`}>S.No</th>
                  <th className={th}>Production Date</th>
                  <th className={th}>Batch No.</th>
                  <th className={th}>Slab No.</th>
                  <th className={th}>Base Material</th>
                  <th className={th}>File Name</th>
                  <th className={`${th} text-right`}>Thickness (cm)</th>
                  <th className={th}>In-time</th>
                  <th className={th}>Grade</th>
                  <th className={th}>Processing Status</th>
                  <th className={th}>QC Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.id} className={dataTable.row}>
                    <td className={`${tdNum} text-muted text-right`}>{index + 1}</td>
                    <td className={`${td} whitespace-nowrap`}>{dateFmt.format(row.receivedDate)}</td>
                    <td className={`${tdMuted} font-mono`}>{row.batch.batchNo}</td>
                    <td className={td}>
                      <Link
                        href={row.afterAttempt ? `${APP_ROUTES.recalibrations}/${row.id}` : `${APP_ROUTES.operator}?slab=${row.id}`}
                        title={row.afterAttempt ? 'Open this slab on Recalibration' : 'Open this slab on Slab Entry to finish its QC Report'}
                        className="text-status-processing font-mono font-semibold underline decoration-dotted underline-offset-4"
                      >
                        {row.slabNo}
                      </Link>
                    </td>
                    <td className={td}>{row.baseMaterial.name}</td>
                    <td className={tdMuted}>{row.designFileName ?? '—'}</td>
                    <td className={`${tdNum} text-right`}>{row.thicknessCm === null ? '—' : row.thicknessCm}</td>
                    <td className={`${tdNum} whitespace-nowrap`}>{row.inTime ? timeFmt.format(row.inTime) : '—'}</td>
                    <td className={td}>{row.currentGrade ? <GradeBadge grade={row.currentGrade} /> : <span className="text-muted">—</span>}</td>
                    <td className={td}>
                      <StatusBadge status={row.status} disposition={row.currentDisposition} />
                    </td>
                    <td className={`${td} text-status-processing font-medium whitespace-nowrap`}>{qcStatus(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
