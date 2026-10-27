import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState, PageHeader } from '@/components/chromia/ui';
import { dataTable, SectionCard } from '@/components/chromia/ui/form';
import { DispositionBadge, GradeBadge } from '@/components/chromia/ui/status';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { parsePage, RECALIBRATION_PAGE_SIZE } from '@/lib/chromia/list-limits';
import { PLANT_TIME_ZONE } from '@/lib/chromia/plant-time';
import {
  BOARD_VIEW_LABELS,
  BOARD_VIEWS,
  buildBoardQuery,
  hasBoardFilters,
  parseBoardFilters,
  type BoardView,
} from '@/lib/chromia/recalibration-board';
import { ordinal, stageOf, statusLabel } from '@/lib/chromia/recalibration-flow';
import type { RawSearchParams } from '@/lib/chromia/simple-filters';
import { manualRemark } from '@/lib/chromia/slab-remarks';
import { boardFilterOptions, loadRecalibrationBoard } from '@/lib/chromia/server/repositories/recalibration-flow-repository';
import { requirePageUser } from '@/lib/pageUser';

import { RecalibrationFindASlab } from './find-a-slab';

export const metadata: Metadata = { title: 'Recalibration' };
export const dynamic = 'force-dynamic';

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric', timeZone: PLANT_TIME_ZONE, });

const { th, td, tdMuted, tdNum } = dataTable;

const STAGE_CLASS: Record<string, string> = {
  AWAITING_SEND: 'text-status-recalibration font-semibold',
  OUT: 'text-status-hold font-semibold',
  RETURNED: 'text-status-active font-semibold',
  IN_PRODUCTION: 'text-status-active font-medium',
  CLEARED: 'text-status-done font-medium',
  WRITTEN_OFF: 'text-status-waste font-semibold',
};

const CARD_TONE: Record<BoardView, string> = {
  ready: 'bg-status-recalibration',
  sent: 'bg-status-hold',
  received: 'bg-status-active',
  pending: 'bg-status-waste',
};

/**
 * Recalibration (rebuilt 27 Oct 2026) — every slab QC sent to recalibration
 * (Grade C → Recalibration), with every trip it has made.
 *
 * EXACTLY THREE SECTIONS, IN THIS ORDER:
 *
 *   Dashboard            Ready for Recalibration (slabs) · Sent · Received ·
 *                        Pending = Sent − Received (trips) — every card a link
 *                        that turns the table to its own slabs or trips
 *                        (lib/chromia/recalibration-board.ts says how it counts);
 *   Find a Slab          Production Date, Batch, Slab, Material, Design;
 *   Recalibration Records  the fourteen columns, a page at a time (CHR-10).
 *
 * The Slab No. is bold and highlighted: it is what the in-charge clicks, over
 * and over, to open the slab's one form — Send and Receive, Update Slab
 * Details, QC Report — at /chromia/recalibrations/<slab>.
 *
 * Current Status is statusLabel, derived from the saved trips and QC result.
 */
export default async function RecalibrationsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  await requirePageUser();
  const params = await searchParams;
  const filters = parseBoardFilters(params);
  const filtered = hasBoardFilters(filters);

  const [board, options] = await Promise.all([
    loadRecalibrationBoard(filters, { page: parsePage(params.page), pageSize: RECALIBRATION_PAGE_SIZE }),
    boardFilterOptions(),
  ]);
  const { kpis, rows } = board;

  const cardHref = (view: BoardView) =>
    `${APP_ROUTES.recalibrations}?${buildBoardQuery(filters, { view: filters.view === view ? '' : view })}`;
  const pageHref = (page: number) => `${APP_ROUTES.recalibrations}?${buildBoardQuery(filters, { page: String(page) })}`;
  const shown = filters.view ? BOARD_VIEW_LABELS[filters.view] : 'All recalibration slabs';

  return (
    <>
      <PageHeader
        title="Recalibration"
        description={`${kpis.ready} ready to send · ${kpis.pending} out at recalibration`}
      />

      {/* ------------------------------------------------------ Dashboard --- */}
      <div className="mb-6">
        <SectionCard title="Dashboard" accent="brand" padded>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {BOARD_VIEWS.map((view) => {
              const active = filters.view === view;
              return (
                <Link
                  key={view}
                  href={cardHref(view)}
                  aria-current={active ? 'true' : undefined}
                  data-kpi={view}
                  title={active ? 'Showing these — click again to show every slab' : `Show ${BOARD_VIEW_LABELS[view].toLowerCase()} in the table`}
                  className={`surface block h-full rounded-xl border p-5 shadow-[0_1px_3px_rgba(16,24,40,0.06)] transition-colors hover:border-brand-400 ${
                    active ? 'border-brand-600 ring-brand-600 ring-2' : 'border-line'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className={`mt-[6px] inline-block size-1.5 shrink-0 rounded-full ${CARD_TONE[view]}`} />
                    <span className="text-muted text-[11px] leading-[1.35] font-semibold tracking-[0.1em] uppercase">{BOARD_VIEW_LABELS[view]}</span>
                  </div>
                  <p className="mt-3 text-[30px] leading-none font-semibold tracking-tight tabular-nums">{kpis[view]}</p>
                  <p className="text-muted mt-2 text-xs">
                    {view === 'ready' ? 'slabs not yet sent' : view === 'pending' ? 'trips sent, not yet back (Sent − Received)' : 'trips'}
                    {active ? ' · shown below' : ''}
                  </p>
                </Link>
              );
            })}
          </div>
        </SectionCard>
      </div>

      {/* ---------------------------------------------------- Find a Slab --- */}
      <div className="mb-6">
        <RecalibrationFindASlab
          key={buildBoardQuery(filters)}
          options={options}
          values={{
            productionDate: filters.productionDate,
            batchNo: filters.batchNo,
            slabNo: filters.slabNo,
            baseMaterial: filters.baseMaterial,
            fileName: filters.fileName,
            view: filters.view ?? '',
          }}
        />
      </div>

      {/* ------------------------------------------ Recalibration Records --- */}
      <SectionCard
        title="Recalibration Records"
        accent="grade"
        padded={rows.length === 0}
        actions={
          <span className="border-line surface text-muted rounded-full border px-3 py-1 text-xs font-medium">
            {shown}: <span className="text-foreground font-semibold tabular-nums">{board.total}</span>
            {filtered ? ' · filtered' : ''}
          </span>
        }
      >
        {rows.length === 0 ? (
          <EmptyState>{filtered || filters.view ? 'No slab matches.' : 'No slab has been sent to recalibration yet.'}</EmptyState>
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
                    <th className={th}>Slab Outcome</th>
                    <th className={th}>Reason for Recalibration</th>
                    <th className={th}>Slab Remarks</th>
                    <th className={`${th} text-right`}>Attempt Number</th>
                    <th className={th}>Sent Date</th>
                    <th className={th}>Received Date</th>
                    <th className={th}>Current Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key} className={dataTable.row}>
                      <td className={`${td} whitespace-nowrap`}>{dateFmt.format(row.receivedDate)}</td>
                      <td className={`${tdMuted} font-mono`}>{row.batchNo}</td>
                      <td className={td}>
                        <Link
                          href={`${APP_ROUTES.recalibrations}/${row.slabId}`}
                          title="Open this slab — send, receive, update and grade it"
                          className="bg-brand-50 text-brand-800 hover:bg-brand-100 border-brand-200 inline-flex rounded-md border px-2 py-1 font-mono text-[15px] font-bold underline-offset-4 hover:underline"
                        >
                          {row.slabNo}
                        </Link>
                      </td>
                      <td className={td}>{row.baseMaterial}</td>
                      <td className={tdMuted}>{row.designFileName ?? '—'}</td>
                      <td className={`${tdNum} text-right`}>{row.thicknessCm === null ? '—' : row.thicknessCm}</td>
                      <td className={td}>{row.grade ? <GradeBadge grade={row.grade as never} /> : <span className="text-muted">—</span>}</td>
                      <td className={td}>
                        {row.disposition ? <DispositionBadge disposition={row.disposition as never} /> : <span className="text-muted">In Processing</span>}
                      </td>
                      <td className={td}>{row.reason ?? <span className="text-muted">—</span>}</td>
                      <td className={`${td} max-w-[14rem]`}>{manualRemark(row.remarks, row.disposition) ?? <span className="text-muted">—</span>}</td>
                      <td className={`${tdNum} text-right`}>{row.attemptNumber ? ordinal(row.attemptNumber) : '—'}</td>
                      <td className={`${tdMuted} whitespace-nowrap`}>{row.sentDate ? dateFmt.format(row.sentDate) : '—'}</td>
                      <td className={`${tdMuted} whitespace-nowrap`}>{row.tripReceivedDate ? dateFmt.format(row.tripReceivedDate) : '—'}</td>
                      <td className={`${td} whitespace-nowrap`}>
                        <span className={STAGE_CLASS[stageOf(row.state)] ?? ''}>{statusLabel(row.state, row.grade)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {board.pages > 1 ? <PageNav page={board.page} pages={board.pages} href={pageHref} /> : null}
          </>
        )}
      </SectionCard>
    </>
  );
}

const pageButton =
  'border-line surface hover:border-line-strong inline-flex h-11 items-center justify-center rounded-lg border px-4 text-sm font-medium transition-colors hover:bg-[var(--surface-muted)]';

/** Previous / Next under the list — the same control Slab Records pages with. */
function PageNav({ page, pages, href }: { page: number; pages: number; href: (page: number) => string }) {
  return (
    <nav className="border-line surface-muted flex items-center justify-between border-t px-5 py-3.5 text-sm">
      <span className="text-muted">
        Page <span className="text-foreground font-medium">{page}</span> of {pages}
      </span>
      <span className="flex gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className={pageButton}>
            Previous
          </Link>
        ) : null}
        {page < pages ? (
          <Link href={href(page + 1)} className={pageButton}>
            Next
          </Link>
        ) : null}
      </span>
    </nav>
  );
}
