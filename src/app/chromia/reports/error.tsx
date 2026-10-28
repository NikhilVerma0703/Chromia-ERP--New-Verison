'use client';

/** Reports could not be read (the database unreachable, say): say so, and offer to try again. */
export default function ReportsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="border-status-waste/40 surface mx-auto mt-10 max-w-lg rounded-xl border p-6 text-center">
      <h2 className="text-lg font-bold">The reports could not be loaded</h2>
      <p className="text-muted mt-2 text-sm">
        The charts are read live from the database, and that read failed. Nothing was changed. Check the database is running, then try again.
      </p>
      <button
        type="button"
        onClick={reset}
        className="bg-brand-600 hover:bg-brand-700 mt-5 inline-flex h-10 items-center justify-center rounded-lg px-5 text-sm font-semibold text-white transition-colors"
      >
        Try again
      </button>
    </div>
  );
}
