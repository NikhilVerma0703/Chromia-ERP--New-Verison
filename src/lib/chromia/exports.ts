/**
 * Export sheet definitions — pure, so the date maths is unit-testable.
 *
 * Four sheets, one per outcome the in-charge is asked for: Dispatch, Stock,
 * Sample Cutting and Recalibration. Each is filtered on *its own* date — a
 * dispatch sheet ranges over dispatch dates, a stock sheet over stock dates —
 * because "everything dispatched last week" is the question, not "everything
 * received last week".
 *
 * Recalibration is filtered on the day QC condemned the slab rather than the
 * day it was sent out, because most of the slabs on that sheet have not been
 * sent yet: they are lying in the plant waiting for a load, which is exactly
 * the list somebody asks for.
 *
 * Every day here is a PLANT day (the owner's decision of 20 Oct 2026 on CHR-8
 * of the code review of that day): the presets count from the production day
 * running now, 06:00 to 06:00, and a row is filed under toPlantReportDay — its
 * own day when it is a stored day, the production day it happened in when it
 * is an instant — in the filter AND in the date the sheet prints. They used to
 * be the server's day, which is UTC, so a C-shift stock entry made at 01:30 on
 * 1 Nov sat on October's sheet printed as 1 Nov and was missing from November's.
 * See plant-time.ts.
 */

import {
  addPlantDays,
  isPlantDayKey,
  plantDayRange,
  plantToday,
  toPlantDateInput,
  toPlantReportDay,
} from './plant-time.ts';

/**
 * The By Slab Status reports (28 Oct 2026, change 12): their columns, rows,
 * dates and S.No. are lib/chromia/download-reports.ts. In Stock is the
 * slabs on the racks now; the other four, the slabs in that status.
 */
export const EXPORT_KINDS = ['STOCK', 'DISPATCH', 'APPROVED', 'SAMPLE_CUTTING', 'RECALIBRATION'] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export const EXPORT_KIND_LABELS: Record<ExportKind, string> = {
  STOCK: 'In Stock (Current Stock)',
  DISPATCH: 'Dispatched',
  APPROVED: 'Approved',
  SAMPLE_CUTTING: 'Sample Cutting',
  RECALIBRATION: 'Recalibration',
};

export const RANGE_PRESETS = ['TODAY', 'LAST_WEEK', 'LAST_MONTH', 'MONTH', 'CUSTOM'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const RANGE_PRESET_LABELS: Record<RangePreset, string> = {
  TODAY: 'Today',
  LAST_WEEK: 'Last week (7 days)',
  LAST_MONTH: 'Last month (30 days)',
  MONTH: 'Month wise',
  CUSTOM: 'Date selected (from – to)',
};

export interface DateRange {
  /** Inclusive, at 00:00:00.000 plant time on the first day. */
  from: Date;
  /** Inclusive, at 23:59:59.999 plant time on the last day. */
  to: Date;
}

export interface ExportQuery {
  kind: ExportKind;
  preset: RangePreset;
  /** `yyyy-mm` when the preset is MONTH. */
  month: string;
  /** `yyyy-mm-dd` when the preset is CUSTOM. */
  from: string;
  to: string;
}

export function isExportKind(value: string): value is ExportKind {
  return (EXPORT_KINDS as readonly string[]).includes(value);
}

export function isRangePreset(value: string): value is RangePreset {
  return (RANGE_PRESETS as readonly string[]).includes(value);
}

/** `yyyy-mm-dd` of an instant's plant calendar day — never the server's. */
export function toDateInput(date: Date): string {
  return toPlantDateInput(date);
}

/** `yyyy-mm` of an instant's plant calendar month. */
export function toMonthInput(date: Date): string {
  return toPlantDateInput(date).slice(0, 7);
}

/** The two plant days a range covers, as `yyyy-mm-dd` — what the filter compares against. */
export function rangeDays(range: DateRange): { from: string; to: string } {
  return { from: toPlantDateInput(range.from), to: toPlantDateInput(range.to) };
}

/**
 * Turn the chosen preset into an inclusive range of plant days.
 *
 * "Last week" means the current date back seven days, and "last month" the
 * current date back thirty — counted from today, not from calendar boundaries,
 * which is how the in-charge asks for it. "Today" is the production day running
 * now: at 01:30 on 1 Nov the night shift is still on 31 Oct, and so is Today.
 */
export function resolveRange(query: RangeQuery, now: Date = new Date()): DateRange {
  const today = plantToday(now);

  switch (query.preset) {
    case 'TODAY':
      return plantDayRange(today, today);

    case 'LAST_WEEK':
      return plantDayRange(addPlantDays(today, -7), today);

    case 'LAST_MONTH':
      return plantDayRange(addPlantDays(today, -30), today);

    case 'MONTH': {
      const match = /^(\d{4})-(\d{2})$/.exec(query.month);
      if (!match || !isPlantDayKey(`${query.month}-01`)) return plantDayRange(today, today);

      const year = Number(match[1]);
      const month = Number(match[2]);
      // Day 0 of the next month is the last day of this one.
      const lastDay = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
      return plantDayRange(`${query.month}-01`, lastDay);
    }

    case 'CUSTOM': {
      const from = isPlantDayKey(query.from) ? query.from : today;
      const to = isPlantDayKey(query.to) ? query.to : today;
      // A backwards range is a typo, not an empty result — swap it.
      return from <= to ? plantDayRange(from, to) : plantDayRange(to, from);
    }
  }
}

export interface MonthOption {
  /** `yyyy-mm` */
  value: string;
  /** "July 2026" */
  label: string;
}

/** The last `count` months, newest first, from the production day running now — feeds the month-wise dropdown. */
export function recentMonths(count = 24, now: Date = new Date()): MonthOption[] {
  // Built and named in UTC on purpose: a month label is a label, and pinning
  // both ends to one zone keeps it the same on any host.
  const formatter = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const [year, month] = plantToday(now).split('-').map(Number);

  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1 - index, 1));
    return { value: date.toISOString().slice(0, 7), label: formatter.format(date) };
  });
}

/** `chromia-dispatch_2026-07-01_to_2026-07-31.xlsx` */
export function exportFileName(kind: ExportKind, range: DateRange): string {
  const slug = kind.toLowerCase().replace(/_/g, '-');
  const days = rangeDays(range);
  return `chromia-${slug}_${days.from}_to_${days.to}.xlsx`;
}

/** Read an export query out of raw search params, falling back to sane defaults. */
export function parseExportQuery(
  params: Record<string, string | string[] | undefined>,
  now: Date = new Date(),
): ExportQuery {
  const first = (value: string | string[] | undefined) =>
    (Array.isArray(value) ? (value[0] ?? '') : (value ?? '')).trim();

  const kindRaw = first(params.kind);
  const presetRaw = first(params.preset);
  const today = plantToday(now);

  return {
    kind: isExportKind(kindRaw) ? kindRaw : 'DISPATCH',
    preset: isRangePreset(presetRaw) ? presetRaw : 'TODAY',
    month: /^\d{4}-\d{2}$/.test(first(params.month)) ? first(params.month) : today.slice(0, 7),
    from: /^\d{4}-\d{2}-\d{2}$/.test(first(params.from)) ? first(params.from) : today,
    to: /^\d{4}-\d{2}-\d{2}$/.test(first(params.to)) ? first(params.to) : today,
  };
}

/** Rebuild the query string for links and the download URL. */
export function buildExportQuery(query: ExportQuery): string {
  const params = new URLSearchParams({ kind: query.kind, preset: query.preset });
  if (query.preset === 'MONTH') params.set('month', query.month);
  if (query.preset === 'CUSTOM') {
    params.set('from', query.from);
    params.set('to', query.to);
  }
  return params.toString();
}

// ---------------------------------------------------------------- columns ---

/**
 * Column groups.
 *
 * Colour is applied per group rather than per column: identity, product,
 * timing, state and the outcome's own fields. Ten unrelated colours would be a
 * fruit salad; five meaningful bands let the eye jump to the right part of a
 * wide sheet.
 */
export type ColumnGroup = 'identity' | 'product' | 'timing' | 'state' | 'outcome';

export interface GroupPalette {
  /** Header fill, solid, with white text. */
  header: string;
  /** Body fill — a wash of the same hue. */
  body: string;
}

/** Excel fills, as RGB hex without the leading '#'. */
export const GROUP_COLORS: Record<ColumnGroup, GroupPalette> = {
  identity: { header: '1B5CF5', body: 'EAF1FE' }, // blue
  product: { header: '0E9384', body: 'E6F6F4' }, // teal
  timing: { header: 'B54708', body: 'FDF3E7' }, // amber
  state: { header: '6941C6', body: 'F1EBFB' }, // violet
  outcome: { header: '087443', body: 'E7F5EE' }, // green
};

/** The same bands as Tailwind classes, for the on-screen preview header. */
export const GROUP_CLASSES: Record<ColumnGroup, string> = {
  identity: 'bg-[#1B5CF5] text-white',
  product: 'bg-[#0E9384] text-white',
  timing: 'bg-[#B54708] text-white',
  state: 'bg-[#6941C6] text-white',
  outcome: 'bg-[#087443] text-white',
};

export interface ExportColumn {
  label: string;
  group: ColumnGroup;
  width: number;
}

/**
 * The period part of an export query, without the sheet kind.
 *
 * The complete-production sheet has no kind — it is everything — so it reuses
 * the same five presets through this narrower shape. `resolveRange` only ever
 * needed these four fields.
 */
export type RangeQuery = Omit<ExportQuery, 'kind'>;

/**
 * Read a period out of prefixed search params.
 *
 * The Downloads page carries two independent forms on one URL, so the complete
 * production picker namespaces its params (`pPreset`, `pMonth`, `pFrom`, `pTo`).
 * Without the prefix the two forms would overwrite each other's period every
 * time either one was applied.
 */
export function parseRangeQuery(
  params: Record<string, string | string[] | undefined>,
  prefix = '',
  now: Date = new Date(),
): RangeQuery {
  const first = (value: string | string[] | undefined) =>
    (Array.isArray(value) ? (value[0] ?? '') : (value ?? '')).trim();

  const key = (name: string) =>
    prefix ? `${prefix}${name[0]?.toUpperCase()}${name.slice(1)}` : name;

  const presetRaw = first(params[key('preset')]);
  const month = first(params[key('month')]);
  const from = first(params[key('from')]);
  const to = first(params[key('to')]);
  const today = plantToday(now);

  return {
    preset: isRangePreset(presetRaw) ? presetRaw : 'TODAY',
    month: /^\d{4}-\d{2}$/.test(month) ? month : today.slice(0, 7),
    from: /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : today,
    to: /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : today,
  };
}

/** Query string for the complete-production download link. */
export function buildRangeQuery(query: RangeQuery): string {
  const params = new URLSearchParams({ preset: query.preset });
  if (query.preset === 'MONTH') params.set('month', query.month);
  if (query.preset === 'CUSTOM') {
    params.set('from', query.from);
    params.set('to', query.to);
  }
  return params.toString();
}

/** `chromia-production_2026-05-01_to_2026-05-31.xlsx` */
export function productionFileName(range: DateRange): string {
  const days = rangeDays(range);
  return `chromia-production_${days.from}_to_${days.to}.xlsx`;
}

/**
 * Widen a range by a day at each end, for the database query only.
 *
 * Dates that mean "a calendar day" are stored as midnight, and an instant
 * belongs to the production day it happened in, which runs to 06:00 the next
 * morning — neither sits neatly inside the two instants that bound the range.
 * So the query casts a wider net and `isWithinRangeDays` then decides
 * precisely, by comparing plant days rather than instants. Costs at most two
 * extra days of rows; removes a whole class of silent, whole-month-disappears
 * bugs.
 */
export function padRange(range: DateRange, days = 1): { gte: Date; lte: Date } {
  const DAY_MS = 24 * 60 * 60 * 1000;
  return {
    gte: new Date(range.from.getTime() - days * DAY_MS),
    lte: new Date(range.to.getTime() + days * DAY_MS),
  };
}

/** True when a stored date files under a plant day inside the range — toPlantReportDay, see plant-time.ts. */
export function isWithinRangeDays(date: Date | null, range: DateRange): boolean {
  if (!date) return false;
  const day = toPlantReportDay(date);
  const { from, to } = rangeDays(range);
  return day >= from && day <= to;
}
