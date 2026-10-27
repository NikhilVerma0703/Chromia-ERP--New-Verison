'use client';

import Link from 'next/link';

import { Field } from '@/components/chromia/ui';
import { ComboInput } from '@/components/chromia/ui/combo';
import { field, SectionCard } from '@/components/chromia/ui/form';
import { APP_ROUTES } from '@/lib/chromia/constants/app';

export interface ApprovedFormValues {
  approvedDate: string;
  batchNo: string;
  baseMaterial: string;
  fileName: string;
}

export interface ApprovedFormOptions {
  batchNos: string[];
  baseMaterials: string[];
  fileNames: string[];
  /** Today in IST — the Approved Date calendar stops there. */
  today: string;
}

/**
 * Approved Slabs → Find a Slab (27 Oct 2026). A GET form, so a search is a URL.
 * Approved Date is the day the slab was approved in the Stockyard; batch,
 * material and design are type-ahead dropdowns of the values approved slabs
 * carry. Any one or any mix; Apply Filters runs them, Clear Filters returns to
 * every approved slab. Keyed on the query by the page, so Clear remounts it.
 */
export function ApprovedFindASlab({ values, options }: { values: ApprovedFormValues; options: ApprovedFormOptions }) {
  return (
    <SectionCard title="Find a Slab" accent="active">
      <form method="get" action={APP_ROUTES.approved} className="flex flex-col gap-5">
        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Approved Date" htmlFor="approvedDate">
            <input
              id="approvedDate"
              name="approvedDate"
              type="date"
              max={options.today}
              defaultValue={values.approvedDate}
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
        </div>

        <div className="border-line flex flex-wrap items-center justify-end gap-3 border-t pt-5">
          <Link
            href={APP_ROUTES.approved}
            className="border-line surface hover:border-line-strong inline-flex h-11 items-center justify-center rounded-lg border px-5 text-sm font-medium transition-colors hover:bg-[var(--surface-muted)]"
          >
            Clear Filters
          </Link>
          <button
            type="submit"
            className="bg-brand-600 hover:bg-brand-700 inline-flex h-11 items-center justify-center rounded-lg px-6 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(16,24,40,0.12)] transition-colors"
          >
            Apply Filters
          </button>
        </div>
      </form>
    </SectionCard>
  );
}
