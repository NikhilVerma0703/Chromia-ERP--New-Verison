import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState, PageHeader, Stat } from '@/components/chromia/ui';
import { dataTable, SectionCard } from '@/components/chromia/ui/form';
import { GradeBadge } from '@/components/chromia/ui/status';
import { buildApprovedQuery, hasApprovedFilters, parseApprovedFilters } from '@/lib/chromia/approved-filters';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { PLANT_TIME_ZONE, toPlantDateInput } from '@/lib/chromia/plant-time';
import type { RawSearchParams } from '@/lib/chromia/simple-filters';
import { manualRemark } from '@/lib/chromia/slab-remarks';
import { link } from '@/lib/chromia/ui';
import { approvedFilterOptions, approvedKpi, listApprovedSlabs } from '@/lib/chromia/server/repositories/approved-repository';
import { requirePageUser } from '@/lib/pageUser';

import { ApprovedFindASlab } from './find-a-slab';
import { TakePhotoLink, ViewPhotoButton } from './photo-buttons';

export const metadata: Metadata = { title: 'Approved Slabs' };
export const dynamic = 'force-dynamic';

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric', timeZone: PLANT_TIME_ZONE, });

const { th, td, tdMuted, tdNum } = dataTable;

/**
 * Approved Slabs (new, 27 Oct 2026) — directly below Dispatched.
 *
 * Every slab sent from the Stockyard with the Approved outcome, all of them
 * until a filter narrows the list. The page views approved slabs and keeps
 * their photos; it changes nothing else about them.
 *
 *   Dashboard        Total Approved Slabs — never filtered, and the table's
 *                    row count when no filter is set (approved-repository);
 *   Find a Slab      Approved Date, Batch, Material and Design, alone or together;
 *   Approved Slabs   Approved Date (the date chosen in the Stockyard) first, the
 *                    slab's own details after it, and View: "Click Picture of
 *                    Slab" until a photo is saved, then the eye (View Photo).
 *
 * The slab number and the camera button both open the slab's form
 * (approved/[slabId]) — its entry and QC Report as recorded, marked as
 * Approved, with the camera, upload and crop underneath.
 */
export default async function ApprovedSlabsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  await requirePageUser();
  const filters = parseApprovedFilters(await searchParams);
  const filtered = hasApprovedFilters(filters);

  const [total, options, slabs] = await Promise.all([approvedKpi(), approvedFilterOptions(), listApprovedSlabs(filters)]);

  return (
    <>
      <PageHeader title="Approved Slabs" description={`${total} ${total === 1 ? 'slab' : 'slabs'} approved in the Stockyard`} />

      {/* ------------------------------------------------------ Dashboard --- */}
      <div className="mb-6">
        <SectionCard title="Dashboard" accent="brand" padded>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Total Approved Slabs" value={total} hint="Marked as Approved in the Stockyard" tone="done" />
          </div>
        </SectionCard>
      </div>

      {/* ---------------------------------------------------- Find a Slab --- */}
      <div className="mb-6">
        <ApprovedFindASlab
          key={buildApprovedQuery(filters)}
          values={filters}
          options={{ ...options, today: toPlantDateInput(new Date()) }}
        />
      </div>

      {/* ------------------------------------------------- Approved Slabs --- */}
      <SectionCard
        title="Approved Slabs"
        accent="active"
        padded={slabs.length === 0}
        actions={
          <span className="border-line surface text-muted rounded-full border px-3 py-1 text-xs font-medium">
            <span className="text-foreground font-semibold tabular-nums">{slabs.length}</span> {slabs.length === 1 ? 'slab' : 'slabs'}
            {filtered ? ' · filtered' : ''}
          </span>
        }
      >
        {slabs.length === 0 ? (
          <EmptyState>{filtered ? 'No approved slab matches these filters.' : 'No slab has been approved yet.'}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className={dataTable.root}>
              <thead className={dataTable.head}>
                <tr>
                  <th className={th}>Approved Date</th>
                  <th className={th}>Production Date</th>
                  <th className={th}>Batch No.</th>
                  <th className={th}>Slab No.</th>
                  <th className={th}>Base Material / Slab Name</th>
                  <th className={th}>File Name / Planned Design</th>
                  <th className={`${th} text-right`}>Thickness (cm)</th>
                  <th className={th}>Grade</th>
                  <th className={th}>Slab Remarks</th>
                  <th className={`${th} text-right`}>View</th>
                </tr>
              </thead>
              <tbody>
                {slabs.map((slab) => {
                  const open = `${APP_ROUTES.approved}/${slab.slabId}`;
                  return (
                    <tr key={slab.id} className={dataTable.row}>
                      <td className={`${td} font-medium whitespace-nowrap`}>{slab.approvedDate ? dateFmt.format(slab.approvedDate) : '—'}</td>
                      <td className={`${tdMuted} whitespace-nowrap`}>{dateFmt.format(slab.receivedDate)}</td>
                      <td className={`${tdMuted} font-mono`}>{slab.batchNo}</td>
                      <td className={td}>
                        <Link href={open} className={`${link} font-mono`} title="Open this slab — its details and photo">
                          {slab.slabNo}
                        </Link>
                      </td>
                      <td className={td}>{slab.baseMaterial}</td>
                      <td className={tdMuted}>{slab.designFileName ?? '—'}</td>
                      <td className={`${tdNum} text-right`}>{slab.thicknessCm === null ? '—' : slab.thicknessCm}</td>
                      <td className={td}>
                        <GradeBadge grade={slab.grade} />
                      </td>
                      <td className={`${td} max-w-[16rem]`}>
                        {manualRemark(slab.remarks, slab.disposition) ?? <span className="text-muted">—</span>}
                      </td>
                      <td className={`${td} text-right`}>
                        {slab.photo ? <ViewPhotoButton photoId={slab.photo.id} slabNo={slab.slabNo} /> : <TakePhotoLink href={open} slabNo={slab.slabNo} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </>
  );
}
