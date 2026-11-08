import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/chromia/ui';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { requirePageUser } from '@/lib/pageUser';

import { loadSlabEditProps } from '../../../stockyard/edit-props';
import { StockyardSlabEditForm } from '../../../stockyard/slab-edit-form';

export const metadata: Metadata = { title: 'Edit Dispatched Slab' };
export const dynamic = 'force-dynamic';

/**
 * Dispatched → Edit (change 12, 8 Nov 2026): one dispatched slab's New Entry
 * and QC Report, pre-filled from the saved record and corrected in place, and
 * Alter From Dispatched — In Stock or Recalibration, and the date — saved by
 * the same Update Slab (updateStockyardSlabAction → alterFromDispatched).
 */
export default async function DispatchedEditPage({ params }: { params: Promise<{ slabId: string }> }) {
  await requirePageUser();
  const { slabId } = await params;
  const loaded = await loadSlabEditProps(slabId);
  if (!loaded) notFound();

  return (
    <>
      <PageHeader
        eyebrow="Dispatched"
        title={`Edit slab ${loaded.record.slabNo}`}
        description="Correct its entry or QC Report, or move it from Dispatched — the same slab record is updated"
        actions={
          <Link
            href={APP_ROUTES.dispatch}
            className="border-line surface hover:border-line-strong inline-flex h-11 items-center justify-center rounded-lg border px-4 text-sm font-medium transition-colors hover:bg-[var(--surface-muted)]"
          >
            Back to Dispatched
          </Link>
        }
      />
      <StockyardSlabEditForm key={loaded.record.id} form="dispatched" returnTo={APP_ROUTES.dispatch} {...loaded.props} />
    </>
  );
}
