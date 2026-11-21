import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState, PageHeader } from '@/components/chromia/ui';
import { EditLink } from '@/components/chromia/ui/edit-link';
import { SlabActions } from '@/components/chromia/ui/delete-slab-button';
import { dataTable, SectionCard } from '@/components/chromia/ui/form';
import { DispositionBadge, GradeBadge } from '@/components/chromia/ui/status';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { PLANT_TIME_ZONE } from '@/lib/chromia/plant-time';
import { ordinal } from '@/lib/chromia/recalibration-flow';
import type { RawSearchParams } from '@/lib/chromia/simple-filters';
import { formatThickness, formatTrim, type TrimmingStage } from '@/lib/chromia/trimming';
import {
  buildTrimQuery,
  hasTrimFilters,
  parseTrimFilters,
  TRIM_CURRENT_VIEWS,
  TRIM_OVERALL_VIEWS,
  TRIM_VIEW_LABELS,
  type TrimBoardView,
} from '@/lib/chromia/trimming-board';
import { loadTrimmingBoard } from '@/lib/chromia/server/repositories/trimming-repository';
import { loadBaseMaterialNames, loadRecentBatchNos } from '@/lib/chromia/server/services/operator-service';
import { requirePageUser } from '@/lib/pageUser';

import { DeleteTrimmingButton } from './delete-trimming-button';
import { TrimmingFindASlab } from './find-a-slab';
import { TrimmingSlabLink } from './trimming-slab-link';
import { WithoutPrintingForm } from './without-printing-form';
import { chromiaCanDeleteSlab } from '@/lib/chromia/access';

export const metadata: Metadata = { title: 'Trimming' };
export const dynamic = 'force-dynamic';

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: PLANT_TIME_ZONE,
});

const { th, td, tdMuted } = dataTable;

/** Each stage of a slab's trimming in its own ink. */
const STAGE_CLASS: Record<TrimmingStage, string> = {
  READY: 'text-status-trimming font-medium',
  PLANNED: 'text-status-trimming font-medium',
  SENT: 'text-status-hold font-medium',
  RECEIVED: 'text-status-active font-medium',
  DONE: 'text-status-done font-medium',
};

const CARD_TONE: Record<TrimBoardView, string> = {
  trimmed: 'bg-status-trimming',
  sent: 'bg-status-hold',
  received: 'bg-status-active',
  pending: 'bg-status-waste',
  ready: 'bg-status-trimming',
  out: 'bg-status-hold',
  returned: 'bg-status-active',
  available: 'bg-status-done',
};

/** What each card counts, under its number. */
const CARD_HINT: Record<TrimBoardView, string> = {
  trimmed: 'every trimming, repeat attempts and cleared slabs included',
  sent: 'every send, repeat attempts included',
  received: 'every receipt, repeat attempts included',
  pending: 'sends not yet received (Sent − Received)',
  ready: 'slabs marked for Trimming, not yet sent',
  out: 'slabs out now, awaiting receipt',
  returned: 'slabs back from trimming',
  available: 'slabs back, not yet reprinted / processed',
};

/**
 * Trimming (7 Nov 2026) — in RECALIBRATION & TRIMMING, first.
 *
 * FOUR SECTIONS, IN THIS ORDER (21 Nov 2026):
 *
 *   Dashboard                          OVERALL STATUS — four counts of trimming
 *                                      events, repeat attempts included;
 *                                      CURRENT STATUS — four counts of slabs
 *                                      where they are now. Every card a link
 *                                      that turns Trimming Records to exactly
 *                                      its own rows (lib/chromia/trimming-board.ts);
 *   Trimming Without Design Printing   a slab trimmed without going on the
 *                                      line: Batch, Slab, Material, Thickness;
 *   Find a Slab                        Production Date, Batch, Slab, Material,
 *                                      Design — narrows Trimming Records;
 *   Trimming Records                   every slab graded C → Trimming on Slab
 *                                      Entry, and every one entered above,
 *                                      the latest first.
 *
 * The Slab No. opens the slab's Trimming page — A. Trimmed From → To,
 * B. Send & Receive, C. Update Slab Details, D. QC Report — as Edit does.
 */
export default async function TrimmingPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const user = await requirePageUser();
  // Delete is every Chromia login's but the Chromia Operator's (the owner,
  // 19 Nov 2026); the delete action asks the same rule (requireChromiaDeleter).
  const canDelete = chromiaCanDeleteSlab(user);
  const filters = parseTrimFilters(await searchParams);
  const filtered = hasTrimFilters(filters);
  const [board, baseMaterials, batchNos] = await Promise.all([loadTrimmingBoard(filters), loadBaseMaterialNames(), loadRecentBatchNos()]);
  const { kpis, rows } = board;

  // The card's rows, in Trimming Records below — a second click shows every slab again.
  const cardHref = (view: TrimBoardView) =>
    `${APP_ROUTES.trimming}?${buildTrimQuery(filters, { view: filters.view === view ? '' : view })}${filters.view === view ? '' : '#records'}`;
  const shown = filters.view ? TRIM_VIEW_LABELS[filters.view] : 'All trimming slabs';

  return (
    <>
      <PageHeader
        title="Trimming"
        description={`${board.records} ${board.records === 1 ? 'slab' : 'slabs'} in Trimming · ${kpis.ready} ready to send · ${kpis.out} out at trimming`}
      />

      {/* ------------------------------------------------------ Dashboard --- */}
      <div className="mb-6">
        <SectionCard title="Dashboard" accent="brand" padded>
          {(
            [
              ['OVERALL STATUS', 'All trimming activity from the beginning — a slab trimmed twice counts twice, and stays counted after QC clears it.', TRIM_OVERALL_VIEWS],
              ['CURRENT STATUS', 'Where each slab is now — by its latest trimming.', TRIM_CURRENT_VIEWS],
            ] as const
          ).map(([heading, about, views], i) => (
            <section key={heading} aria-labelledby={`trim-${i}`} className={i === 0 ? 'mb-6' : ''}>
              <h3 id={`trim-${i}`} className="text-foreground text-xs font-semibold tracking-[0.14em]">
                {heading}
              </h3>
              <p className="text-muted mt-1 mb-3 text-xs">{about}</p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {views.map((view) => {
                  const active = filters.view === view;
                  const slabs = (TRIM_CURRENT_VIEWS as readonly string[]).includes(view);
                  return (
                    <Link
                      key={view}
                      href={cardHref(view)}
                      aria-current={active ? 'true' : undefined}
                      data-kpi={view}
                      title={active ? 'Showing these — click again to show every slab' : `Show ${TRIM_VIEW_LABELS[view].toLowerCase()} in the table`}
                      className={`surface block h-full rounded-xl border p-5 shadow-[0_1px_3px_rgba(16,24,40,0.06)] transition-colors hover:border-brand-400 ${
                        active ? 'border-brand-600 ring-brand-600 ring-2' : 'border-line'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span className={`mt-[6px] inline-block size-1.5 shrink-0 rounded-full ${CARD_TONE[view]}`} />
                        <span className="text-muted text-[11px] leading-[1.35] font-semibold tracking-[0.1em] uppercase">{TRIM_VIEW_LABELS[view]}</span>
                      </div>
                      <p className="mt-3 text-[30px] leading-none font-semibold tracking-tight tabular-nums">{kpis[view]}</p>
                      <p className="text-muted mt-2 text-xs">{CARD_HINT[view]}</p>
                      <p className="text-brand-700 mt-2 text-xs font-semibold">
                        {active ? 'Shown below · click to show all' : slabs ? 'Click to View Slabs' : 'Click to view'}
                      </p>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </SectionCard>
      </div>

      <div className="mb-6">
        <WithoutPrintingForm baseMaterials={baseMaterials} batchNos={batchNos} />
      </div>

      {/* ---------------------------------------------------- Find a Slab --- */}
      <div className="mb-6">
        <TrimmingFindASlab
          key={buildTrimQuery(filters)}
          options={board.options}
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

      {/* ----------------------------------------------- Trimming Records --- */}
      <div id="records" className="scroll-mt-6">
        <SectionCard
          title="Trimming Records"
          accent="active"
          padded={rows.length === 0}
          actions={
            <span className="border-line surface text-muted rounded-full border px-3 py-1 text-xs font-medium">
              {shown}: <span className="text-foreground font-semibold tabular-nums">{rows.length}</span>
              {filtered ? ' · filtered' : ''}
            </span>
          }
        >
          {rows.length === 0 ? (
            <EmptyState>{filtered || filters.view ? 'No slab matches.' : 'No slab has been sent to Trimming yet.'}</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className={dataTable.root}>
                <thead className={dataTable.head}>
                  <tr>
                    <th className={th}>Production Date</th>
                    <th className={th}>Batch Number</th>
                    <th className={th}>Slab Number</th>
                    <th className={th}>Base Material / Slab Name</th>
                    <th className={th}>File Name / Planned Design</th>
                    <th className={th}>Thickness</th>
                    <th className={th}>Grade</th>
                    <th className={th}>Slab Outcome</th>
                    <th className={th}>Trimmed From → To</th>
                    <th className={th}>Sent Date</th>
                    <th className={th}>Received Date</th>
                    <th className={th}>Current Status</th>
                    <th className={`${th} text-right`}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`${row.id}:${row.attemptNumber}`} className={dataTable.row} data-source={row.source}>
                      <td className={`${td} whitespace-nowrap`}>{row.productionDate ? dateFmt.format(row.productionDate) : '—'}</td>
                      <td className={`${tdMuted} font-mono`}>{row.batchNo || '—'}</td>
                      <td className={td}>
                        <TrimmingSlabLink id={row.id} slabNo={row.slabNo} />
                      </td>
                      <td className={td}>{row.baseMaterial || '—'}</td>
                      <td className={tdMuted}>{row.fileName ?? '—'}</td>
                      <td className={`${td} whitespace-nowrap tabular-nums`}>{formatThickness(row.thicknessMm)}</td>
                      <td className={td}>
                        <GradeBadge grade="C" />
                      </td>
                      <td className={td}>
                        <DispositionBadge disposition="TRIMMING" />
                      </td>
                      <td className={`${td} whitespace-nowrap tabular-nums`}>{formatTrim(row.trimFromMm, row.trimToMm) || <span className="text-muted">—</span>}</td>
                      <td className={`${tdMuted} whitespace-nowrap`}>{row.sentDate ? dateFmt.format(row.sentDate) : '—'}</td>
                      <td className={`${tdMuted} whitespace-nowrap`}>{row.receivedDate ? dateFmt.format(row.receivedDate) : '—'}</td>
                      <td className={`${td} whitespace-nowrap`}>
                        <span className={STAGE_CLASS[row.stage]}>{row.status}</span>
                        {/* A slab trimmed again: which trimming this row is (21 Nov 2026). */}
                        {row.attempts.length > 1 ? <span className="text-muted ml-1.5 text-xs">· {ordinal(row.attemptNumber)} trimming</span> : null}
                      </td>
                      <td className={`${td} text-right`}>
                        {/* Delete (change 5): a Chromia slab is deleted for good, as on every
                            table; a slab without design printing not yet graded has no slab
                            record — its Trimming record is what is deleted. */}
                        {row.slabId ? (
                          <SlabActions editHref={`${APP_ROUTES.trimming}/${row.id}`} slabId={row.slabId} slabNo={row.slabNo} canDelete={canDelete} />
                        ) : (
                          <div className="flex justify-end gap-2">
                            <EditLink href={`${APP_ROUTES.trimming}/${row.id}`} slabNo={row.slabNo} />
                            {canDelete && <DeleteTrimmingButton id={row.id} slabNo={row.slabNo} removesRecord />}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>
    </>
  );
}
