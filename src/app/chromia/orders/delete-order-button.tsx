'use client';

import { useActionState, useEffect, useState } from 'react';

import { ConfirmDialog } from '@/components/chromia/ui/confirm-dialog';
import { deleteOrderAction, type OrderDeleteState } from '@/lib/chromia/server/actions/orders';

/**
 * An order's Delete (19 Nov 2026) — drawn only for the roles that may delete
 * orders; deleteOrderAction refuses everyone else whatever the request. It
 * asks first, naming the order, as the slab Delete does.
 */
export function DeleteOrderButton({ id, name }: { id: string; name: string }) {
  const [state, formAction, isPending] = useActionState<OrderDeleteState, FormData>(deleteOrderAction, {});
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (state.deletedAt) setAsking(false);
  }, [state.deletedAt]);

  return (
    <>
      <button
        type="button"
        onClick={() => setAsking(true)}
        aria-label={`Delete the order ${name}`}
        className="border-line surface text-status-waste hover:border-status-waste inline-flex h-9 items-center justify-center rounded-lg border px-3 text-xs font-medium transition-colors hover:bg-[color-mix(in_srgb,var(--color-status-waste)_8%,transparent)]"
      >
        Delete
      </button>
      <ConfirmDialog
        open={asking}
        busy={isPending}
        title={`Delete the order ${name} permanently?`}
        detail="The order and its Reference Photo are deleted from the database. It disappears from Recent Orders, the search, the Pending and Completed counts and their downloads. This cannot be undone."
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
            {isPending ? 'Deleting…' : 'Delete order'}
          </button>
        </form>
      </ConfirmDialog>
    </>
  );
}
