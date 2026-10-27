'use client';

import { useActionState } from 'react';

import { field, selectField } from '@/components/chromia/ui/form';
import { sendFromStockAction, type StockyardFormState } from '@/lib/chromia/server/actions/stockyard';
import { STOCK_OUTCOME_LABELS, STOCK_OUTCOMES } from '@/lib/chromia/constants/stock-outcomes';

const INITIAL_STATE: StockyardFormState = {};

/**
 * One row's Stock Outcome — its own form, like the release form it replaced:
 * a form per row cannot pair one row's outcome with another row's date.
 *
 * Exactly three outcomes, Dispatch, Approved and Sample Cutting, and the day
 * it happened. The calendar stops at `today` — today in IST, computed on the
 * server — so 28 October cannot be picked on the 27th; the action refuses a
 * future date again for any request that did not come through the picker.
 * Once sent, the slab is no longer IN_STOCK and the page drops its row.
 *
 * The calendar also starts at `stockedOn`, the plant day the slab went into
 * stock: it cannot leave the rack before it was put there. The action refuses
 * an earlier date too.
 */
export function StockOutcomeForm({
  slabId,
  slabNo,
  today,
  stockedOn,
}: {
  slabId: string;
  slabNo: string;
  today: string;
  /** `yyyy-mm-dd` (IST) the slab was stocked, or null when unknown. */
  stockedOn: string | null;
}) {
  const [state, formAction, isPending] = useActionState(sendFromStockAction, INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-wrap items-center justify-end gap-2">
      <input type="hidden" name="slabId" value={slabId} />
      <select
        aria-label={`Stock outcome for slab ${slabNo}`}
        name="outcome"
        required
        defaultValue=""
        className={`${selectField} w-[10.5rem]`}
      >
        <option value="" disabled>
          Select outcome
        </option>
        {STOCK_OUTCOMES.map((outcome) => (
          <option key={outcome} value={outcome}>
            {STOCK_OUTCOME_LABELS[outcome]}
          </option>
        ))}
      </select>
      <input
        aria-label={`Date for slab ${slabNo}`}
        name="date"
        type="date"
        required
        max={today}
        min={stockedOn ?? undefined}
        defaultValue={today}
        className={`${field} w-[10.5rem]`}
      />
      <button
        type="submit"
        disabled={isPending}
        className="bg-brand-600 hover:bg-brand-700 inline-flex h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold whitespace-nowrap text-white shadow-[0_1px_2px_rgba(16,24,40,0.12)] transition-colors disabled:cursor-not-allowed disabled:opacity-55"
      >
        {isPending ? 'Saving…' : 'Send'}
      </button>
      {state.error ? (
        <span className="text-status-waste w-full text-right text-xs font-medium">{state.error}</span>
      ) : null}
    </form>
  );
}
