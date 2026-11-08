import type { Metadata } from 'next';

import { EmptyState, PageHeader } from '@/components/chromia/ui';
import { EditLink } from '@/components/chromia/ui/edit-link';
import { SlabActions } from '@/components/chromia/ui/delete-slab-button';
import { dataTable, SectionCard } from '@/components/chromia/ui/form';
import { DispositionBadge, GradeBadge } from '@/components/chromia/ui/status';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { PLANT_TIME_ZONE } from '@/lib/chromia/plant-time';
import { formatThickness, formatTrim, type TrimmingStage } from '@/lib/chromia/trimming';
import { listTrimmingRecords } from '@/lib/chromia/server/repositories/trimming-repository';
import { loadBaseMaterialNames, loadRecentBatchNos } from '@/lib/chromia/server/services/operator-service';
import { requirePageUser } from '@/lib/pageUser';

import { DeleteTrimmingButton } from './delete-trimming-button';
import { TrimmingSlabLink } from './trimming-slab-link';
import { WithoutPrintingForm } from './without-printing-form';

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

/**
 * Trimming (7 Nov 2026) — in RECALIBRATION & TRIMMING, first.
 *
 *   Trimming Without Design Printing   a slab trimmed without going on the
 *                                      line: Batch, Slab, Material, Thickness;
 *   Trimming Records                   every slab graded C → Trimming on Slab
 *                                      Entry, and every one entered above,
 *                                      the latest first.
 *
 * The Slab No. opens the slab's Trimming page — A. Trimmed From → To,
 * B. Send & Receive, C. Update Slab Details, D. QC Report — as Edit does.
 */
export default async function TrimmingPage() {
  await requirePageUser();
  const [rows, baseMaterials, batchNos] = await Promise.all([listTrimmingRecords(), loadBaseMaterialNames(), loadRecentBatchNos()]);

  return (
    <>
      <PageHeader title="Trimming" description={`${rows.length} ${rows.length === 1 ? 'slab' : 'slabs'} in Trimming`} />

      <div className="mb-6">
        <WithoutPrintingForm baseMaterials={baseMaterials} batchNos={batchNos} />
      </div>

      <SectionCard
        title="Trimming Records"
        accent="active"
        padded={rows.length === 0}
        actions={
          <span className="border-line surface text-muted rounded-full border px-3 py-1 text-xs font-medium">
            <span className="text-foreground font-semibold tabular-nums">{rows.length}</span> {rows.length === 1 ? 'slab' : 'slabs'}
          </span>
        }
      >
        {rows.length === 0 ? (
          <EmptyState>No slab has been sent to Trimming yet.</EmptyState>
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
                  <tr key={row.id} className={dataTable.row} data-source={row.source}>
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
                    </td>
                    <td className={`${td} text-right`}>
                      {/* Delete (change 5): a Chromia slab is deleted for good, as on every
                          table; a slab without design printing not yet graded has no slab
                          record — its Trimming record is what is deleted. */}
                      {row.slabId ? (
                        <SlabActions editHref={`${APP_ROUTES.trimming}/${row.id}`} slabId={row.slabId} slabNo={row.slabNo} />
                      ) : (
                        <div className="flex justify-end gap-2">
                          <EditLink href={`${APP_ROUTES.trimming}/${row.id}`} slabNo={row.slabNo} />
                          <DeleteTrimmingButton id={row.id} slabNo={row.slabNo} removesRecord />
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
    </>
  );
}
