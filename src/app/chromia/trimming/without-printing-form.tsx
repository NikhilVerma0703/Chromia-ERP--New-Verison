'use client';

import { useActionState, useEffect, useState } from 'react';

import { Field, FormError } from '@/components/chromia/ui';
import { ComboInput } from '@/components/chromia/ui/combo';
import { field, FieldGrid, SectionCard, selectField } from '@/components/chromia/ui/form';
import { addTrimmingWithoutPrintingAction, type TrimmingFormState } from '@/lib/chromia/server/actions/trimming';

/**
 * Trimming Without Design Printing (7 Nov 2026) — a slab trimmed without
 * going on the Chromia line or having a design printed. Four fields and Save;
 * the record appears at the top of the Trimming table and opens the same slab
 * page as every other row.
 */
export function WithoutPrintingForm({ baseMaterials, batchNos }: { baseMaterials: string[]; batchNos: string[] }) {
  const [state, formAction, isPending] = useActionState<TrimmingFormState, FormData>(addTrimmingWithoutPrintingAction, {});
  const [round, setRound] = useState(0);
  const [baseMaterial, setBaseMaterial] = useState('');

  // A save empties the form for the next slab.
  useEffect(() => {
    if (!state.savedAt) return;
    setRound((n) => n + 1);
    setBaseMaterial('');
  }, [state.savedAt]);

  const errors = state.fieldErrors;
  return (
    <SectionCard title="Trimming Without Design Printing" accent="grade" padded>
      <form key={round} action={formAction} className="flex flex-col gap-4">
        <FieldGrid columns={3}>
          <Field label="Batch Number *" htmlFor="wp-batchNo" error={errors?.batchNo?.[0]}>
            <input id="wp-batchNo" name="batchNo" required list="wp-batches" className={`${field} font-mono`} />
            <datalist id="wp-batches">
              {batchNos.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </Field>
          <Field label="Slab Number *" htmlFor="wp-slabNo" error={errors?.slabNo?.[0]}>
            <input id="wp-slabNo" name="slabNo" required className={`${field} font-mono`} />
          </Field>
          <Field label="Base Material / Slab Name *" htmlFor="wp-baseMaterial" error={errors?.baseMaterial?.[0]}>
            <ComboInput id="wp-baseMaterial" name="baseMaterial" options={baseMaterials} value={baseMaterial} onChange={setBaseMaterial} required className={selectField} />
          </Field>
          <Field label="Thickness (cm)" htmlFor="wp-thicknessCm" error={errors?.thicknessCm?.[0]}>
            <input id="wp-thicknessCm" name="thicknessCm" inputMode="decimal" placeholder="2" className={field} />
          </Field>
        </FieldGrid>
        <FormError message={state.error} />
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="submit"
            disabled={isPending}
            className="bg-brand-600 hover:bg-brand-700 inline-flex h-11 items-center justify-center rounded-lg px-6 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(16,24,40,0.12)] transition-colors disabled:cursor-not-allowed disabled:opacity-55"
          >
            {isPending ? 'Saving…' : 'Save'}
          </button>
          {state.savedSlabNo && !isPending ? (
            <span role="status" className="text-status-done text-sm font-medium">Slab {state.savedSlabNo} saved — it is at the top of the table below.</span>
          ) : null}
        </div>
      </form>
    </SectionCard>
  );
}
