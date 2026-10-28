import Link from 'next/link';

/**
 * The Action column's Edit button (28 Oct 2026) — the same button on Slab
 * Records, Stockyard, Approved Slabs and Recalibration, each opening that
 * slab's own edit form. Dispatched is read-only and has none.
 */
export function EditLink({ href, slabNo }: { href: string; slabNo: string }) {
  return (
    <Link
      href={href}
      aria-label={`Edit slab ${slabNo}`}
      className="border-line surface hover:border-line-strong inline-flex h-9 items-center justify-center rounded-lg border px-3 text-xs font-medium transition-colors hover:bg-[var(--surface-muted)]"
    >
      Edit
    </Link>
  );
}
