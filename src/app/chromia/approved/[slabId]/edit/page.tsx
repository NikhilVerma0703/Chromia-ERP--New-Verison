import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { EmptyState, PageHeader } from '@/components/chromia/ui';
import { SectionCard } from '@/components/chromia/ui/form';
import { API_ROUTES, APP_ROUTES } from '@/lib/chromia/constants/app';
import { PLANT_TIME_ZONE } from '@/lib/chromia/plant-time';
import { latestSlabPhotos, loadApproval } from '@/lib/chromia/server/repositories/approved-repository';
import { requirePageUser } from '@/lib/pageUser';

import { loadSlabEditProps } from '../../../stockyard/edit-props';
import { StockyardSlabEditForm } from '../../../stockyard/slab-edit-form';
import { PhotoCapture } from '../photo-capture';

export const metadata: Metadata = { title: 'Edit Approved Slab' };
export const dynamic = 'force-dynamic';

const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: PLANT_TIME_ZONE,
});

/**
 * Approved Slabs → Edit (28 Oct 2026): the slab's New Entry and QC Report,
 * pre-filled and corrected in place (slab-edit-form.tsx), and its photo — the
 * one saved is shown and kept unless a new one is saved over it with the
 * camera / upload below (photo-capture.tsx, its own Save Changes).
 */
export default async function ApprovedEditPage({ params }: { params: Promise<{ slabId: string }> }) {
  await requirePageUser();
  const { slabId } = await params;
  const [loaded, approval] = await Promise.all([loadSlabEditProps(slabId), loadApproval(slabId)]);
  if (!loaded) notFound();
  const { record } = loaded;

  const back = (
    <Link
      href={APP_ROUTES.approved}
      className="border-line surface hover:border-line-strong inline-flex h-11 items-center justify-center rounded-lg border px-4 text-sm font-medium transition-colors hover:bg-[var(--surface-muted)]"
    >
      Back to Approved Slabs
    </Link>
  );

  if (!approval) {
    return (
      <>
        <PageHeader title={`Slab ${record.slabNo}`} description="Not an approved slab" actions={back} />
        <EmptyState>Slab {record.slabNo} is not marked as Approved in the Stockyard, so it is not edited here.</EmptyState>
      </>
    );
  }

  const photo = (await latestSlabPhotos([record.id])).get(record.id) ?? null;

  return (
    <>
      <PageHeader
        eyebrow="Approved Slabs"
        title={`Edit slab ${record.slabNo}`}
        description="Correct its entry or QC Report, and keep or replace its photo"
        actions={back}
      />

      <div className="mb-6">
        <StockyardSlabEditForm key={record.id} form="approved" returnTo={APP_ROUTES.approved} {...loaded.props} />
      </div>

      <div className="mb-6">
        <SectionCard title="Current Photo" accent="brand" padded>
          {photo ? (
            <div className="flex flex-col items-start gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- a stored photo, served as-is */}
              <img
                src={`${API_ROUTES.slabPhoto}/${encodeURIComponent(photo.id)}`}
                alt={`Slab ${record.slabNo}`}
                className="max-h-[40vh] max-w-full rounded-lg border"
              />
              <span className="text-muted text-xs">Saved {dateTimeFmt.format(photo.at)} — kept unless you save a new one below</span>
            </div>
          ) : (
            <p className="text-muted text-sm">No photo yet — take or upload one below.</p>
          )}
        </SectionCard>
      </div>

      <PhotoCapture slabId={record.id} slabNo={record.slabNo} hasPhoto={Boolean(photo)} />
    </>
  );
}
