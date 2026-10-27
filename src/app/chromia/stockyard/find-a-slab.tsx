'use client';

import Link from 'next/link';

import { Field } from '@/components/chromia/ui';
import { ComboInput } from '@/components/chromia/ui/combo';
import { field, SectionCard, selectField } from '@/components/chromia/ui/form';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { STOCK_OUTCOMES, type StockOutcomeValue } from '@/lib/chromia/constants/stock-outcomes';

/** The words the filter uses for each outcome: where the slab went. */
const OUTCOME_FILTER_LABELS: Record<StockOutcomeValue, string> = {
  DISPATCH: 'Dispatched',
  APPROVED: 'Approved',
  SAMPLE_CUTTING: 'Sample Cutting',
};

export interface FindASlabValues {
  productionDate: string;
  batchNo: string;
  slabNo: string;
  baseMaterial: string;
  fileName: string;
  outcome: string;
}

export interface FindASlabOptions {
  batchNos: string[];
  slabNos: string[];
  baseMaterials: string[];
  fileNames: string[];
}

/**
 * Stockyard → Find a Slab (27 Oct 2026).
 *
 * A plain GET form, so a search is a URL: refresh, back and a shared link all
 * keep it. The text fields are type-ahead dropdowns over the values Slab Entry
 * recorded for slabs that have been in stock — typing "ta" offers "Tajvein" —
 * and a value need not be picked from the list to be searched for. Any field
 * alone, or any mix of them, narrows In Stock Records; a Stock Outcome turns it
 * to the slabs that left the rack that way. Clear Filters goes back to the page
 * with none.
 *
 * Keyed on the current query by the page: every field is uncontrolled, so a
 * remount is what puts Clear Filters' empty values into the inputs.
 */
export function FindASlab({ values, options }: { values: FindASlabValues; options: FindASlabOptions }) {
  return (
    <SectionCard title="Find a Slab" accent="active">
      <form method="get" action={APP_ROUTES.stockyard} className="flex flex-col gap-5">
        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Production Date" htmlFor="productionDate">
            <input
              id="productionDate"
              name="productionDate"
              type="date"
              defaultValue={values.productionDate}
              className={field}
            />
          </Field>

          <Field label="Batch Number" htmlFor="batchNo">
            <ComboInput
              id="batchNo"
              name="batchNo"
              options={options.batchNos}
              defaultValue={values.batchNo}
              placeholder="Type or pick a batch"
              className={`${field} font-mono`}
            />
          </Field>

          <Field label="Slab Number" htmlFor="slabNo">
            <ComboInput
              id="slabNo"
              name="slabNo"
              options={options.slabNos}
              defaultValue={values.slabNo}
              placeholder="Type or pick a slab"
              className={`${field} font-mono`}
            />
          </Field>

          <Field label="Base Material / Slab Name" htmlFor="baseMaterial">
            <ComboInput
              id="baseMaterial"
              name="baseMaterial"
              options={options.baseMaterials}
              defaultValue={values.baseMaterial}
              placeholder="Type or pick a material"
              className={field}
            />
          </Field>

          <Field label="File Name / Planned Design" htmlFor="fileName">
            <ComboInput
              id="fileName"
              name="fileName"
              options={options.fileNames}
              defaultValue={values.fileName}
              placeholder="Type or pick a design"
              className={field}
            />
          </Field>

          <Field label="Stock Outcome" htmlFor="outcome">
            <select id="outcome" name="outcome" defaultValue={values.outcome} className={selectField}>
              <option value="">In stock now</option>
              {STOCK_OUTCOMES.map((outcome) => (
                <option key={outcome} value={outcome}>
                  {OUTCOME_FILTER_LABELS[outcome]}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="border-line flex flex-wrap items-center justify-end gap-3 border-t pt-5">
          <Link
            href={APP_ROUTES.stockyard}
            className="border-line surface hover:border-line-strong inline-flex h-11 items-center justify-center rounded-lg border px-5 text-sm font-medium transition-colors hover:bg-[var(--surface-muted)]"
          >
            Clear Filters
          </Link>
          <button
            type="submit"
            className="bg-brand-600 hover:bg-brand-700 inline-flex h-11 items-center justify-center rounded-lg px-6 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(16,24,40,0.12)] transition-colors"
          >
            Search
          </button>
        </div>
      </form>
    </SectionCard>
  );
}
