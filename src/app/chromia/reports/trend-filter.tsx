'use client';

import { useRef, useState } from 'react';

import { field, selectField } from '@/components/chromia/ui/form';
import { TREND_RANGE_LABELS, TREND_RANGES, type TrendRangeKind } from '@/lib/chromia/reports-charts';

/**
 * The Daily Production Trend's range, in one row above the chart: Today, Last
 * 7 Days, Last 30 Days, Month-wise or a Custom Date Range. A preset applies
 * at once; Month-wise and Custom show their own inputs and an Apply. It is a
 * GET form, so the range is in the URL — it survives a refresh, Back, and a
 * shared link.
 */
export function TrendFilter({
  kind,
  month,
  from,
  to,
  today,
}: {
  kind: TrendRangeKind;
  month: string;
  from: string;
  to: string;
  today: string;
}) {
  const [range, setRange] = useState<TrendRangeKind>(kind);
  const form = useRef<HTMLFormElement>(null);
  const needsInput = range === 'month' || range === 'custom';

  return (
    <form ref={form} method="get" className="flex flex-wrap items-end gap-3" aria-label="Trend range">
      <label className="flex flex-col gap-1 text-xs font-medium">
        Range
        <select
          name="range"
          value={range}
          onChange={(e) => {
            const next = e.target.value as TrendRangeKind;
            setRange(next);
            if (next !== 'month' && next !== 'custom') queueMicrotask(() => form.current?.requestSubmit());
          }}
          className={`${selectField} h-10 w-48`}
        >
          {TREND_RANGES.map((value) => (
            <option key={value} value={value}>
              {TREND_RANGE_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      {range === 'month' ? (
        <label className="flex flex-col gap-1 text-xs font-medium">
          Month
          <input type="month" name="month" defaultValue={month} max={today.slice(0, 7)} required className={`${field} h-10 w-44`} />
        </label>
      ) : null}
      {range === 'custom' ? (
        <>
          <label className="flex flex-col gap-1 text-xs font-medium">
            From
            <input type="date" name="from" defaultValue={from} max={today} required className={`${field} h-10 w-44`} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            To
            <input type="date" name="to" defaultValue={to} max={today} required className={`${field} h-10 w-44`} />
          </label>
        </>
      ) : null}
      {needsInput ? (
        <button
          type="submit"
          className="bg-brand-600 hover:bg-brand-700 inline-flex h-10 items-center justify-center rounded-lg px-5 text-sm font-semibold text-white transition-colors"
        >
          Apply
        </button>
      ) : null}
    </form>
  );
}
