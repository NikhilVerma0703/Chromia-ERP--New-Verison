'use client';

import { useActionState } from 'react';

import { field, selectField } from '@/components/chromia/ui/form';
import { ALTER_DESTINATION_LABELS, ALTER_DESTINATIONS } from '@/lib/chromia/constants/alter-destinations';
import { alterFromDispatchedAction, type AlterFromDispatchedState } from '@/lib/chromia/server/actions/dispatched-alter';

const INITIAL_STATE: AlterFromDispatchedState = {};

/**
 * One row's Alter From Dispatched (change 12, 8 Nov 2026): Select — In Stock
 * or Recalibration — and the Date the slab moved, then Move. Its own form per
 * row, as the Stockyard's Stock Outcome is, so one row's choice can never be
 * paired with another row's date. The calendar runs from the dispatch date to
 * today in the plant (IST); the server checks both again.
 */
export function AlterFromDispatchedForm({
  slabId,
  slabNo,
  today,
  dispatchedOn,
}: {
  slabId: string;
  slabNo: string;
  today: string;
  /** `yyyy-mm-dd` (IST) the slab was dispatched — the earliest date. */
  dispatchedOn: string;
}) {
  const [state, formAction, isPending] = useActionState(alterFromDispatchedAction, INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="slabId" value={slabId} />
      <select
        aria-label={`Alter slab ${slabNo} from Dispatched to`}
        name="destination"
        required
        defaultValue=""
        className={`${selectField} w-[9.5rem]`}
      >
        <option value="" disabled>
          Select
        </option>
        {ALTER_DESTINATIONS.map((value) => (
          <option key={value} value={value}>
            {ALTER_DESTINATION_LABELS[value]}
          </option>
        ))}
      </select>
      <input
        aria-label={`Date slab ${slabNo} moved from Dispatched`}
        name="date"
        type="date"
        required
        min={dispatchedOn}
        max={today}
        defaultValue={today}
        className={`${field} w-[10.5rem]`}
      />
      <button
        type="submit"
        disabled={isPending}
        className="bg-brand-600 hover:bg-brand-700 inline-flex h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold whitespace-nowrap text-white shadow-[0_1px_2px_rgba(16,24,40,0.12)] transition-colors disabled:cursor-not-allowed disabled:opacity-55"
      >
        {isPending ? 'Saving…' : 'Move'}
      </button>
      {state.error ? <span className="text-status-waste w-full text-xs font-medium">{state.error}</span> : null}
    </form>
  );
}
