'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Field } from '@/components/chromia/ui';
import { ComboInput } from '@/components/chromia/ui/combo';
import { field, SectionCard, selectField } from '@/components/chromia/ui/form';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { DISPATCH_RANGE_LABELS, DISPATCH_RANGES, type DispatchRange } from '@/lib/chromia/dispatched-filters';

export interface DispatchedFormValues {
  dispatchDate: string;
  range: string;
  month: string;
  from: string;
  to: string;
  batchNo: string;
  baseMaterial: string;
  fileName: string;
}

export interface DispatchedFormOptions {
  batchNos: string[];
  baseMaterials: string[];
  fileNames: string[];
  /** `{ value: 'yyyy-mm', label: 'October 2026' }`, January 2026 to now, newest first. */
  months: { value: string; label: string }[];
  /** Today in IST — no calendar here goes past it. */
  today: string;
}

/** The two date filters stand out: bigger, bolder labels on a tinted band. */
const prominentLabel = 'text-[15px] font-semibold text-foreground';

/**
 * Dispatched → Find a Slab (27 Oct 2026).
 *
 * A GET form, so a search is a URL that survives refresh and can be shared.
 * Dispatch Date and Dispatch Date Range lead, on their own highlighted row;
 * the range asks for a month (Month-wise) or a From and To (Custom) only when
 * that kind is chosen. Batch, material and design are type-ahead dropdowns of
 * the values dispatched slabs carry. Apply Filters runs any one of them or
 * any mix; Clear Filters returns to every dispatched slab.
 *
 * The page keys this on the current query, so Clear remounts it empty.
 */
export function DispatchedFindASlab({ values, options }: { values: DispatchedFormValues; options: DispatchedFormOptions }) {
  const [range, setRange] = useState(values.range);

  return (
    <SectionCard title="Find a Slab" accent="active">
      <form method="get" action={APP_ROUTES.dispatch} className="flex flex-col gap-5">
        <div className="border-brand-200 rounded-xl border bg-[var(--surface-muted)] p-4">
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="dispatchDate" className={prominentLabel}>
                Dispatch Date
              </label>
              <input
                id="dispatchDate"
                name="dispatchDate"
                type="date"
                max={options.today}
                defaultValue={values.dispatchDate}
                className={`${field} font-semibold`}
              />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="range" className={prominentLabel}>
                Dispatch Date Range
              </label>
              <select
                id="range"
                name="range"
                value={range}
                onChange={(event) => setRange(event.target.value)}
                className={`${selectField} font-semibold`}
              >
                <option value="">Any date</option>
                {DISPATCH_RANGES.map((value: DispatchRange) => (
                  <option key={value} value={value}>
                    {DISPATCH_RANGE_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>

            {range === 'MONTH' ? (
              <div className="flex flex-col gap-2">
                <label htmlFor="month" className={prominentLabel}>
                  Month
                </label>
                <select
                  id="month"
                  name="month"
                  required
                  defaultValue={values.month || options.months[0]?.value}
                  className={`${selectField} font-semibold`}
                >
                  {options.months.map((month) => (
                    <option key={month.value} value={month.value}>
                      {month.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {range === 'CUSTOM' ? (
              <>
                <div className="flex flex-col gap-2">
                  <label htmlFor="from" className={prominentLabel}>
                    From
                  </label>
                  <input
                    id="from"
                    name="from"
                    type="date"
                    max={options.today}
                    defaultValue={values.from}
                    className={`${field} font-semibold`}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label htmlFor="to" className={prominentLabel}>
                    To
                  </label>
                  <input
                    id="to"
                    name="to"
                    type="date"
                    max={options.today}
                    defaultValue={values.to}
                    className={`${field} font-semibold`}
                  />
                </div>
              </>
            ) : null}
          </div>
        </div>

        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
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
            href={APP_ROUTES.dispatch}
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
