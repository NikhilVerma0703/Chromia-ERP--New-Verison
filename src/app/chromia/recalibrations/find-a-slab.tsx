'use client';

import Link from 'next/link';

import { Field } from '@/components/chromia/ui';
import { ComboInput } from '@/components/chromia/ui/combo';
import { field, SectionCard } from '@/components/chromia/ui/form';
import { APP_ROUTES } from '@/lib/chromia/constants/app';

export interface BoardFormValues {
  productionDate: string;
  batchNo: string;
  slabNo: string;
  baseMaterial: string;
  fileName: string;
  /** The KPI card the table is on, carried through a search. */
  view: string;
}

export interface BoardFormOptions {
  batchNos: string[];
  slabNos: string[];
  baseMaterials: string[];
  fileNames: string[];
}

/**
 * Recalibration → Find a Slab (27 Oct 2026). A GET form, so a search is a URL.
 * Production Date, Batch Number, Slab Number, Base Material and File Name —
 * type-ahead dropdowns over the slabs on the Recalibration board — alone or
 * together. A KPI card chosen above stays chosen through a search; Clear
 * Filters returns to the whole board. Keyed on the query by the page.
 */
export function RecalibrationFindASlab({ values, options }: { values: BoardFormValues; options: BoardFormOptions }) {
  return (
    <SectionCard title="Find a Slab" accent="active">
      <form method="get" action={APP_ROUTES.recalibrations} className="flex flex-col gap-5">
        {values.view ? <input type="hidden" name="view" value={values.view} /> : null}
        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Production Date" htmlFor="productionDate">
            <input id="productionDate" name="productionDate" type="date" defaultValue={values.productionDate} className={field} />
          </Field>
          <Field label="Batch Number" htmlFor="batchNo">
            <ComboInput id="batchNo" name="batchNo" options={options.batchNos} defaultValue={values.batchNo} placeholder="Type or pick a batch" className={`${field} font-mono`} />
          </Field>
          <Field label="Slab Number" htmlFor="slabNo">
            <ComboInput id="slabNo" name="slabNo" options={options.slabNos} defaultValue={values.slabNo} placeholder="Type or pick a slab" className={`${field} font-mono`} />
          </Field>
          <Field label="Base Material / Slab Name" htmlFor="baseMaterial">
            <ComboInput id="baseMaterial" name="baseMaterial" options={options.baseMaterials} defaultValue={values.baseMaterial} placeholder="Type or pick a material" className={field} />
          </Field>
          <Field label="File Name / Planned Design" htmlFor="fileName">
            <ComboInput id="fileName" name="fileName" options={options.fileNames} defaultValue={values.fileName} placeholder="Type or pick a design" className={field} />
          </Field>
        </div>

        <div className="border-line flex flex-wrap items-center justify-end gap-3 border-t pt-5">
          <Link
            href={APP_ROUTES.recalibrations}
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
