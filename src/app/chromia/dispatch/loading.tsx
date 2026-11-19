import { PageHeader } from '@/components/chromia/ui';

/**
 * Dispatched, while it loads (19 Nov 2026, the navigation fix).
 *
 * A click on Dispatched in the sidebar used to leave the previous page on
 * screen until the whole of Dispatched had been built on the server, so on a
 * slow connection it looked as if the click had done nothing. With this file
 * Next.js moves to Dispatched at once and shows this until the page is ready;
 * it is also what the sidebar link prefetches, so the move is immediate.
 */
export default function DispatchedLoading() {
  return (
    <div data-loading-skeleton aria-busy="true">
      <PageHeader title="Dispatched" description="Loading dispatched slabs…" />
      <div className="mb-6 grid animate-pulse gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="border-line surface h-24 rounded-xl border" />
        ))}
      </div>
      <div className="border-line surface mb-6 h-40 animate-pulse rounded-xl border" />
      <div className="border-line surface h-72 animate-pulse rounded-xl border" />
    </div>
  );
}
