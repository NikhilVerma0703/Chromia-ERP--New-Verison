import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/chromia/ui';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { requirePageUser } from '@/lib/pageUser';

import { loadSlabEditProps } from '../../edit-props';
import { StockyardSlabEditForm } from '../../slab-edit-form';

export const metadata: Metadata = { title: 'Edit Stockyard Slab' };
export const dynamic = 'force-dynamic';

/**
 * Stockyard → Edit (28 Oct 2026): one slab's New Entry, QC Report and Stock
 * Outcome with its date, pre-filled from the saved record and corrected in
 * place (slab-edit-form.tsx, updateStockyardSlabAction).
 */
export default async function StockyardEditPage({ params }: { params: Promise<{ slabId: string }> }) {
  await requirePageUser();
  const { slabId } = await params;
  const loaded = await loadSlabEditProps(slabId);
  if (!loaded) notFound();

  return (
    <>
      <PageHeader
        eyebrow="Stockyard"
        title={`Edit slab ${loaded.record.slabNo}`}
        description="Correct its entry, QC Report or Stock Outcome — the same slab record is updated"
        actions={
          <Link
            href={APP_ROUTES.stockyard}
            className="border-line surface hover:border-line-strong inline-flex h-11 items-center justify-center rounded-lg border px-4 text-sm font-medium transition-colors hover:bg-[var(--surface-muted)]"
          >
            Back to Stockyard
          </Link>
        }
      />
      <StockyardSlabEditForm key={loaded.record.id} form="stockyard" returnTo={APP_ROUTES.stockyard} {...loaded.props} />
    </>
  );
}
