import Link from 'next/link';

import { APP_ROUTES } from '@/lib/chromia/constants/app';

/**
 * A Trimming slab number — the Recalibration table's clickable badge, in the
 * Trimming colour with a scissors icon, opening the slab's Trimming page.
 */
export function TrimmingSlabLink({ id, slabNo }: { id: string; slabNo: string }) {
  return (
    <Link
      href={`${APP_ROUTES.trimming}/${id}`}
      title="Open this slab — trim, send, receive, update and grade it"
      className="text-status-trimming inline-flex items-center gap-1.5 rounded-md border border-[color-mix(in_srgb,var(--color-status-trimming)_35%,white)] bg-[color-mix(in_srgb,var(--color-status-trimming)_8%,white)] px-2 py-1 font-mono text-[15px] font-bold underline-offset-4 hover:bg-[color-mix(in_srgb,var(--color-status-trimming)_14%,white)] hover:underline"
    >
      <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M6 3a3 3 0 110 6 3 3 0 010-6zm12 12a3 3 0 110 6 3 3 0 010-6zM5.2 5.2l13.6 13.6M18.8 5.2 9.4 14.6" />
      </svg>
      {slabNo}
    </Link>
  );
}
