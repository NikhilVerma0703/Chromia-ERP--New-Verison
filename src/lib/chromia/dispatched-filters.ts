/**
 * Dispatched → Find a Slab (27 Oct 2026).
 *
 * Every date here is a DISPATCH date, read on the plant's calendar (IST) — the
 * day the slab was sent, never its production date or the day it was stocked:
 *
 *   Dispatch Date        one day;
 *   Dispatch Date Range  Last Week   — the 7 days ending today,
 *                        Last Month  — the 30 days ending today,
 *                        Month-wise  — one calendar month, January 2026 to now,
 *                        Custom      — From and To, both included.
 *
 * With both a Dispatch Date and a range, a slab must satisfy both. Batch,
 * material and design match anywhere in the value, ignoring case, as the
 * type-ahead suggests. Any one filter, or any mix, narrows the same list.
 */
import { addPlantDays, isPlantDayKey, plantDayRange, toPlantDateInput } from '@/lib/chromia/plant-time';
import type { RawSearchParams } from '@/lib/chromia/simple-filters';

export const DISPATCH_RANGES = ['LAST_WEEK', 'LAST_MONTH', 'MONTH', 'CUSTOM'] as const;
export type DispatchRange = (typeof DISPATCH_RANGES)[number];

export const DISPATCH_RANGE_LABELS: Record<DispatchRange, string> = {
  LAST_WEEK: 'Last Week (last 7 days)',
  LAST_MONTH: 'Last Month (last 30 days)',
  MONTH: 'Month-wise',
  CUSTOM: 'Custom Date Range',
};

/** The first month the Month-wise list offers. */
export const FIRST_DISPATCH_MONTH = '2026-01';

export interface DispatchedFilters {
  dispatchDate: string;
  range: DispatchRange | null;
  /** `yyyy-mm` — for range MONTH. */
  month: string;
  /** `yyyy-mm-dd` — for range CUSTOM. */
  from: string;
  to: string;
  batchNo: string;
  baseMaterial: string;
  fileName: string;
}

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return (value ?? '').trim();
}

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;
const day = (value: string) => (isPlantDayKey(value) ? value : '');

export function parseDispatchedFilters(params: RawSearchParams): DispatchedFilters {
  const range = first(params.range);
  const month = first(params.month);
  return {
    dispatchDate: day(first(params.dispatchDate)),
    range: (DISPATCH_RANGES as readonly string[]).includes(range) ? (range as DispatchRange) : null,
    month: MONTH_KEY.test(month) ? month : '',
    from: day(first(params.from)),
    to: day(first(params.to)),
    batchNo: first(params.batchNo).slice(0, 80),
    baseMaterial: first(params.baseMaterial).slice(0, 120),
    fileName: first(params.fileName).slice(0, 120),
  };
}

export function hasDispatchedFilters(f: DispatchedFilters): boolean {
  return Boolean(f.dispatchDate || f.range || f.batchNo || f.baseMaterial || f.fileName);
}

/** The last day of a `yyyy-mm`. */
function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
}

/** A calendar month as plant days, first to last. */
export function monthDays(month: string): { fromDay: string; toDay: string } {
  return { fromDay: `${month}-01`, toDay: monthEnd(month) };
}

/** The plant month `n` months from `month` (`yyyy-mm`). */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1 + n, 1)).toISOString().slice(0, 7);
}

/** Month-wise choices, January 2026 to the current plant month, newest first. */
export function dispatchMonthOptions(now: Date = new Date()): string[] {
  const current = toPlantDateInput(now).slice(0, 7);
  const months: string[] = [];
  for (let m = current; m >= FIRST_DISPATCH_MONTH; m = addMonths(m, -1)) months.push(m);
  return months;
}

/** "October 2026" for `2026-10`. */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y!, m! - 1, 15)),
  );
}

/**
 * The plant-day windows the date filters ask for — each one a dispatch must
 * fall in. Empty when no date filter is set. A range missing its month or its
 * From/To is left out rather than guessed at.
 */
export function dispatchWindows(f: DispatchedFilters, now: Date = new Date()): { fromDay: string; toDay: string }[] {
  const today = toPlantDateInput(now);
  const windows: { fromDay: string; toDay: string }[] = [];
  if (f.dispatchDate) windows.push({ fromDay: f.dispatchDate, toDay: f.dispatchDate });
  switch (f.range) {
    case 'LAST_WEEK':
      windows.push({ fromDay: addPlantDays(today, -6), toDay: today });
      break;
    case 'LAST_MONTH':
      windows.push({ fromDay: addPlantDays(today, -29), toDay: today });
      break;
    case 'MONTH':
      if (f.month) windows.push(monthDays(f.month));
      break;
    case 'CUSTOM':
      if (f.from || f.to) {
        const fromDay = f.from || FIRST_DISPATCH_MONTH + '-01';
        const toDay = f.to || today;
        windows.push(fromDay <= toDay ? { fromDay, toDay } : { fromDay: toDay, toDay: fromDay });
      }
      break;
  }
  return windows;
}

/** Prisma condition on a dispatch for those windows — all must hold. */
export function dispatchDateWhere(f: DispatchedFilters, now: Date = new Date()): Record<string, unknown> {
  const windows = dispatchWindows(f, now);
  if (windows.length === 0) return {};
  return {
    AND: windows.map(({ fromDay, toDay }) => {
      const { from, to } = plantDayRange(fromDay, toDay);
      return { dispatchDate: { gte: from, lte: to } };
    }),
  };
}

/** Prisma condition on the dispatched slab for batch, material and design. */
export function dispatchedSlabWhere(f: DispatchedFilters): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (f.batchNo) where.batch = { batchNo: { contains: f.batchNo, mode: 'insensitive' } };
  if (f.baseMaterial) where.baseMaterial = { name: { contains: f.baseMaterial, mode: 'insensitive' } };
  if (f.fileName) {
    where.plannedDesign = {
      OR: [
        { fileName: { contains: f.fileName, mode: 'insensitive' } },
        { name: { contains: f.fileName, mode: 'insensitive' } },
      ],
    };
  }
  return where;
}

/** The query string for a set of filters — keys the form so Clear resets it. */
export function buildDispatchedQuery(f: DispatchedFilters): string {
  const params = new URLSearchParams();
  const values: Record<string, string> = {
    dispatchDate: f.dispatchDate,
    range: f.range ?? '',
    month: f.range === 'MONTH' ? f.month : '',
    from: f.range === 'CUSTOM' ? f.from : '',
    to: f.range === 'CUSTOM' ? f.to : '',
    batchNo: f.batchNo,
    baseMaterial: f.baseMaterial,
    fileName: f.fileName,
  };
  for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
  return params.toString();
}
