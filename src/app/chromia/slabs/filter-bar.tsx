import Link from 'next/link';

import { Field } from '@/components/chromia/ui';
import { field, selectField, SectionCard } from '@/components/chromia/ui/form';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { DISPOSITION_LABELS } from '@/lib/chromia/constants/process-stages';
import { ChromiaDisposition as Disposition, ChromiaSlabGrade as SlabGrade } from '@prisma/client';
import { buildQuery, type SlabFilters } from '@/lib/chromia/slab-filters';

import { DatePeriodField } from './date-period-field';

interface Option {
  id: string;
  name: string;
}

/** The outcomes the QC section can actually record. */
const OUTCOME_CHOICES: readonly Disposition[] = [
  Disposition.DISPATCH,
  Disposition.STOCK,
  Disposition.SAMPLE_CUTTING,
  Disposition.RECALIBRATION,
  // Grade C → Trimming (7 Nov 2026).
  Disposition.TRIMMING,
];

/** Every grade QC can decide. */
const GRADE_CHOICES: readonly SlabGrade[] = [SlabGrade.A, SlabGrade.B, SlabGrade.C];

function toInputDate(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : '';
}

/**
 * Filter bar. A plain GET form — the whole filter state lives in the URL, so a
 * search is bookmarkable and shareable, and no client JavaScript is needed.
 *
 * Production Date is a single day for the common "what came in on Tuesday?";
 * Date Period is a span (Today … Custom). Both read the slab's production
 * date, and given together they narrow each other rather than one quietly
 * overriding the other. Every filter given narrows the search (AND).
 */
export function FilterBar({
  filters,
  baseMaterials,
  designs,
}: {
  filters: SlabFilters;
  baseMaterials: Option[];
  designs: Option[];
}) {
  return (
    <div className="mb-6">
      <SectionCard title="Find a slab" accent="active">
        {/*
         * The key is the current filter state.
         *
         * Every control here is uncontrolled — `defaultValue` applies when the
         * input mounts and never again. On a soft navigation React reuses the
         * existing DOM nodes, so clearing the filters re-rendered the page with
         * empty defaults while the select still showed the old choice. Keying
         * the form on the filters remounts the inputs whenever the filters
         * actually change, which is the only moment the defaults should be
         * re-read.
         */}
        <form
          key={buildQuery(filters)}
          method="get"
          action={APP_ROUTES.slabs}
          className="flex flex-col gap-5"
        >
          {/* The order asked for (7 Nov 2026, change 9): Production Date, Batch
              Number, Slab Number, Base Material, File Name, Grade, QC Outcome,
              Date Period. The Status filter is gone. */}
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Production Date" htmlFor="receivedOn">
              <input
                id="receivedOn"
                name="receivedOn"
                type="date"
                defaultValue={toInputDate(filters.receivedOn)}
                className={field}
              />
            </Field>

            <Field label="Batch Number" htmlFor="batchNo">
              <input
                id="batchNo"
                name="batchNo"
                defaultValue={filters.batchNo}
                placeholder="1245"
                className={`${field} font-mono`}
              />
            </Field>

            <Field label="Slab Number" htmlFor="slabNo">
              <input
                id="slabNo"
                name="slabNo"
                defaultValue={filters.slabNo}
                placeholder="85477"
                className={`${field} font-mono`}
              />
            </Field>

            <Field label="Base Material / Slab Name" htmlFor="baseMaterialId">
              <select
                id="baseMaterialId"
                name="baseMaterialId"
                defaultValue={filters.baseMaterialId ?? ''}
                className={selectField}
              >
                <option value="">Any</option>
                {baseMaterials.map((material) => (
                  <option key={material.id} value={material.id}>
                    {material.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="File Name / Planned Design" htmlFor="designId">
              <select
                id="designId"
                name="designId"
                defaultValue={filters.designId ?? ''}
                className={selectField}
              >
                <option value="">Any</option>
                {designs.map((design) => (
                  <option key={design.id} value={design.id}>
                    {design.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Grade" htmlFor="grade">
              <select
                id="grade"
                name="grade"
                defaultValue={filters.grade ?? ''}
                className={selectField}
              >
                <option value="">Any</option>
                {GRADE_CHOICES.map((grade) => (
                  <option key={grade} value={grade}>
                    Grade {grade}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="QC Outcome" htmlFor="disposition">
              <select
                id="disposition"
                name="disposition"
                defaultValue={filters.disposition ?? ''}
                className={selectField}
              >
                <option value="">Any</option>
                {OUTCOME_CHOICES.map((disposition) => (
                  <option key={disposition} value={disposition}>
                    {DISPOSITION_LABELS[disposition]}
                  </option>
                ))}
              </select>
            </Field>

            <DatePeriodField
              period={filters.period}
              month={filters.month}
              from={filters.period === 'CUSTOM' ? toInputDate(filters.receivedFrom) : ''}
              to={filters.period === 'CUSTOM' ? toInputDate(filters.receivedTo) : ''}
            />
          </div>

          <div className="border-line flex flex-wrap items-center justify-end gap-3 border-t pt-5">
            <Link
              href={APP_ROUTES.slabs}
              className="border-line surface hover:border-line-strong inline-flex h-11 items-center justify-center rounded-lg border px-5 text-sm font-medium transition-colors hover:bg-[var(--surface-muted)]"
            >
              Clear filters
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
    </div>
  );
}
