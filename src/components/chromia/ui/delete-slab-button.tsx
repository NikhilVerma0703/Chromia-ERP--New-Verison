'use client';

import { useActionState, useEffect, useState } from 'react';

import { ConfirmDialog } from '@/components/chromia/ui/confirm-dialog';
import { EditLink as EditButton } from '@/components/chromia/ui/edit-link';
import { deleteSlabRecordAction, type SlabRecordFormState } from '@/lib/chromia/server/actions/slab-record';

/**
 * The Action column's Delete (7 Nov 2026, change 5) — the same button on
 * Slab Records, Stockyard, Dispatched, Approved Slabs, Trimming,
 * Recalibration and Recal. Tracking, beside Edit.
 *
 * It asks first, naming the slab, and then deletes the slab's record from the
 * database for good (deleteSlabRecordAction → deleteSlabRecord): the slab, its
 * earlier entries (14567 for 14567-A), and everything recorded against it —
 * so it leaves every page, KPI, report and download at once. A failure keeps
 * the dialog open with the reason on it.
 */
export function DeleteSlabButton({ slabId, slabNo }: { slabId: string; slabNo: string }) {
  const [state, formAction, isPending] = useActionState<SlabRecordFormState, FormData>(deleteSlabRecordAction, {});
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (state.savedAt) setAsking(false);
  }, [state.savedAt]);

  return (
    <>
      <button
        type="button"
        onClick={() => setAsking(true)}
        aria-label={`Delete slab ${slabNo}`}
        className="border-line surface text-status-waste hover:border-status-waste inline-flex h-9 items-center justify-center rounded-lg border px-3 text-xs font-medium transition-colors hover:bg-[color-mix(in_srgb,var(--color-status-waste)_8%,transparent)]"
      >
        Delete
      </button>
      <ConfirmDialog
        open={asking}
        busy={isPending}
        title={`Delete slab ${slabNo} permanently?`}
        detail={`Slab ${slabNo} and everything recorded against it — its QC, stock, dispatch, approval, recalibration and trimming records, photos and history — are deleted from the database, with any earlier entry of the same slab. It disappears from every page, count and report. This cannot be undone.`}
        error={state.error}
        onCancel={() => setAsking(false)}
      >
        <form action={formAction} className="contents">
          <input type="hidden" name="slabId" value={slabId} />
          <input type="hidden" name="slabNo" value={slabNo} />
          <button
            type="submit"
            disabled={isPending}
            className="bg-status-waste inline-flex h-11 items-center justify-center rounded-lg px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {isPending ? 'Deleting…' : `Delete slab ${slabNo}`}
          </button>
        </form>
      </ConfirmDialog>
    </>
  );
}

/** Edit and Delete, side by side — the Action column of every slab table. */
export function SlabActions({ editHref, slabId, slabNo }: { editHref: string; slabId: string; slabNo: string }) {
  return (
    <div className="flex justify-end gap-2">
      <EditButton href={editHref} slabNo={slabNo} />
      <DeleteSlabButton slabId={slabId} slabNo={slabNo} />
    </div>
  );
}
