'use client';

import { useState } from 'react';

import { Field } from '@/components/chromia/ui';
import { field, selectField } from '@/components/chromia/ui/form';
import { DATE_PERIOD_LABELS, DATE_PERIODS, type DatePeriod } from '@/lib/chromia/date-periods';

/**
 * Find a Slab's Date Period (7 Nov 2026, change 9) — All, Today, Last 7 Days,
 * Last 30 Days, Month-wise or Custom (From–To). Month-wise asks for its month
 * and Custom for its two dates, shown only when chosen. Every period filters
 * on the slab's Production Date (slab-filters.ts).
 */
export function DatePeriodField({ period, month, from, to }: { period: DatePeriod; month: string; from: string; to: string }) {
  const [chosen, setChosen] = useState<DatePeriod>(period);
  return (
    <>
      <Field label="Date Period" htmlFor="period">
        <select id="period" name="period" value={chosen} onChange={(e) => setChosen(e.target.value as DatePeriod)} className={selectField}>
          {DATE_PERIODS.map((value) => (
            <option key={value} value={value}>
              {DATE_PERIOD_LABELS[value]}
            </option>
          ))}
        </select>
      </Field>
      {chosen === 'MONTH' ? (
        <Field label="Month" htmlFor="month">
          <input id="month" name="month" type="month" defaultValue={month} className={field} />
        </Field>
      ) : null}
      {chosen === 'CUSTOM' ? (
        <>
          <Field label="From" htmlFor="receivedFrom">
            <input id="receivedFrom" name="receivedFrom" type="date" defaultValue={from} className={field} />
          </Field>
          <Field label="To" htmlFor="receivedTo">
            <input id="receivedTo" name="receivedTo" type="date" defaultValue={to} className={field} />
          </Field>
        </>
      ) : null}
    </>
  );
}
