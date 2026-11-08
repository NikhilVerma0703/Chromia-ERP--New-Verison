'use client';

import { useActionState, useEffect, useState } from 'react';

import { ConfirmDialog } from '@/components/chromia/ui/confirm-dialog';
import { deleteTrimmingAction, type TrimmingFormState } from '@/lib/chromia/server/actions/trimming';

/**
 * The Action column's Delete (7 Nov 2026). Asks first, and says exactly what
 * goes: a slab without design printing that is not graded yet is removed from
 * Trimming; any other row keeps its slab and loses only its trimming details.
 */
export function DeleteTrimmingButton({ id, slabNo, removesRecord }: { id: string; slabNo: string; removesRecord: boolean }) {
  const [state, formAction, isPending] = useActionState<TrimmingFormState, FormData>(deleteTrimmingAction, {});
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (state.savedAt) setAsking(false);
  }, [state.savedAt]);

  return (
    <>
      <button
        type="button"
        onClick={() => setAsking(true)}
        aria-label={`Delete trimming of slab ${slabNo}`}
        className="border-line surface text-status-waste hover:border-status-waste inline-flex h-9 items-center justify-center rounded-lg border px-3 text-xs font-medium transition-colors hover:bg-[color-mix(in_srgb,var(--color-status-waste)_8%,transparent)]"
      >
        Delete
      </button>
      <ConfirmDialog
        open={asking}
        busy={isPending}
        title={removesRecord ? `Delete slab ${slabNo} permanently?` : `Clear the trimming details of slab ${slabNo}?`}
        detail={
          removesRecord
            ? `Slab ${slabNo} was entered without design printing and is not graded yet. Its record is deleted from the database. This cannot be undone.`
            : 'Its Trimmed From → To, Sent Date, Received Date and QC Report record are cleared. The slab itself, its grade and its thickness stay as they are; the clearing is kept in its history.'
        }
        error={state.error}
        onCancel={() => setAsking(false)}
      >
        <form action={formAction} className="contents">
          <input type="hidden" name="id" value={id} />
          <button
            type="submit"
            disabled={isPending}
            className="bg-status-waste inline-flex h-11 items-center justify-center rounded-lg px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {isPending ? 'Deleting…' : removesRecord ? 'Delete' : 'Clear details'}
          </button>
        </form>
      </ConfirmDialog>
    </>
  );
}
