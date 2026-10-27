'use client';

import { useActionState, useEffect, useState } from 'react';

import { ConfirmDialog } from '@/components/chromia/ui/confirm-dialog';
import { deleteImportDetail } from '@/lib/chromia/import/undo';
import { deleteImportAction, type DeleteImportState } from '@/lib/chromia/server/actions/import';

const INITIAL_STATE: DeleteImportState = {};

/**
 * Delete one imported file, and the slabs it brought in that nobody has worked
 * on since.
 *
 * Asks first, and the question names the file and the real figures: an import
 * can carry a whole month, so removing one is as consequential as a register
 * delete and confirms the same way. `slabCount` is how many of its slabs are
 * still in the ERP and `removableCount` how many of those would go — counted
 * by the page with the rule the delete applies (the code review of 20 Oct 2026,
 * CHR-2: the dialog used to say hand-graded slabs were untouched while the
 * delete removed them, and named the import's own counter, which a run cut off
 * part-way left at 0). A failure keeps the dialog open with the reason on it;
 * a success removes the row from the list.
 */
export function DeleteImportButton({
  importBatchId,
  fileName,
  slabCount,
  removableCount,
}: {
  importBatchId: string;
  fileName: string;
  slabCount: number;
  removableCount: number;
}) {
  const [state, formAction, isPending] = useActionState(deleteImportAction, INITIAL_STATE);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (state.deleted !== undefined) setAsking(false);
  }, [state.deleted]);

  return (
    <>
      <button
        type="button"
        onClick={() => setAsking(true)}
        aria-label={`Delete imported file ${fileName}`}
        className="border-line surface text-status-waste hover:border-status-waste inline-flex h-9 items-center justify-center rounded-lg border px-3 text-xs font-medium transition-colors hover:bg-[color-mix(in_srgb,var(--color-status-waste)_8%,transparent)]"
      >
        Delete
      </button>

      <ConfirmDialog
        open={asking}
        busy={isPending}
        title="Delete this imported file?"
        detail={deleteImportDetail(fileName, slabCount, removableCount)}
        error={state.error}
        onCancel={() => setAsking(false)}
      >
        <form action={formAction} className="contents">
          <input type="hidden" name="importBatchId" value={importBatchId} />
          <button
            type="submit"
            disabled={isPending}
            className="bg-status-waste inline-flex h-11 items-center justify-center rounded-lg px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {isPending ? 'Deleting…' : 'Delete imported file'}
          </button>
        </form>
      </ConfirmDialog>
    </>
  );
}
