import { PRODUCTION_PLACES, placeOf, type ProductionPlace } from './constants/production-places.ts';
import { addPlantDays, isPlantDayKey, toPlantDateInput } from './plant-time.ts';

/**
 * The Reports page's arithmetic (28 Oct 2026, change 11) — pure, so it runs
 * under test without a database; report-repository.ts reads the rows.
 *
 * Every chart counts PHYSICAL SLABS: the repository reads each one once
 * (physical-slabs.ts — 14567 and 14567-A are one slab, where its latest record
 * is), and each slab is in exactly one place (placeOf, the dashboard's rule).
 * So the designs add up to Total Produced, the donut's four slices are the
 * dashboard's Current Stock, Dispatched, Approved and Sample Cutting, and the
 * stacked bars' segments add up to the palette.
 */

export interface ReportSlab {
  receivedDate: Date;
  status: string;
  currentDisposition: string | null;
  /** File Name / Planned Design as the tables show it, or null if none was given. */
  design: string | null;
  /** Recalibration trips the slab has been sent on. */
  attemptsSent: number;
}

export const NO_DESIGN = 'No design recorded';

export interface DesignRow {
  design: string;
  total: number;
  places: Record<ProductionPlace, number>;
}

/** Slabs per File Name / Planned Design, with their places — most produced first. */
export function designBreakdown(slabs: readonly ReportSlab[]): DesignRow[] {
  const rows = new Map<string, DesignRow>();
  for (const slab of slabs) {
    const design = slab.design?.trim() || NO_DESIGN;
    let row = rows.get(design);
    if (!row) {
      row = { design, total: 0, places: Object.fromEntries(PRODUCTION_PLACES.map((p) => [p, 0])) as Record<ProductionPlace, number> };
      rows.set(design, row);
    }
    row.total += 1;
    row.places[placeOf(slab)] += 1;
  }
  return [...rows.values()].sort((a, b) => b.total - a.total || a.design.localeCompare(b.design, undefined, { numeric: true }));
}

/** The donut's four places — where the graded, placed slabs are. */
export const DISTRIBUTION_PLACES = ['STOCK', 'DISPATCHED', 'APPROVED', 'SAMPLE_CUTTING'] as const;

export function stockDistribution(slabs: readonly ReportSlab[]): { place: (typeof DISTRIBUTION_PLACES)[number]; count: number }[] {
  const counts = new Map<string, number>(DISTRIBUTION_PLACES.map((p) => [p, 0]));
  for (const slab of slabs) {
    const place = placeOf(slab);
    if (counts.has(place)) counts.set(place, (counts.get(place) ?? 0) + 1);
  }
  return DISTRIBUTION_PLACES.map((place) => ({ place, count: counts.get(place) ?? 0 }));
}

/**
 * Unique slabs by recalibration attempt: how many slabs were sent for a 1st,
 * 2nd … 5th attempt. A slab sent three times is one slab in each of the first
 * three bars — the way Recalibration Tracking counts its attempts.
 */
export function recalibrationAttempts(slabs: readonly ReportSlab[], max = 5): { attempt: number; slabs: number }[] {
  return Array.from({ length: max }, (_, i) => ({
    attempt: i + 1,
    slabs: slabs.filter((slab) => slab.attemptsSent >= i + 1).length,
  }));
}

// ───────────────────────────────────────────────────── the trend's range ───

export const TREND_RANGES = ['today', '7d', '30d', 'month', 'custom'] as const;
export type TrendRangeKind = (typeof TREND_RANGES)[number];

export const TREND_RANGE_LABELS: Record<TrendRangeKind, string> = {
  today: 'Today',
  '7d': 'Last 7 Days',
  '30d': 'Last 30 Days',
  month: 'Month-wise',
  custom: 'Custom Date Range',
};

export interface TrendRange {
  kind: TrendRangeKind;
  /** Plant days (IST), `yyyy-mm-dd`, both ends included. */
  fromDay: string;
  toDay: string;
  /** `yyyy-mm` for Month-wise. */
  month: string;
  /** Set when the request asked for something unreadable — the chart says so. */
  problem: string | null;
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? (value[0] ?? '') : (value ?? '')).trim();

/** `?range=` and its companions, read into plant days. Unknown or broken input falls back to Last 30 Days. */
export function parseTrendRange(params: Record<string, string | string[] | undefined>, now: Date = new Date()): TrendRange {
  const today = toPlantDateInput(now);
  const thisMonth = today.slice(0, 7);
  const kind = (TREND_RANGES as readonly string[]).includes(first(params.range)) ? (first(params.range) as TrendRangeKind) : '30d';
  const base = { kind, month: thisMonth, problem: null as string | null };

  switch (kind) {
    case 'today':
      return { ...base, fromDay: today, toDay: today };
    case '7d':
      return { ...base, fromDay: addPlantDays(today, -6), toDay: today };
    case 'month': {
      const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(first(params.month)) ? first(params.month) : thisMonth;
      const [y, m] = month.split('-').map(Number) as [number, number];
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const toDay = `${month}-${String(last).padStart(2, '0')}`;
      return { ...base, month, fromDay: `${month}-01`, toDay: toDay > today && month === thisMonth ? today : toDay };
    }
    case 'custom': {
      const from = first(params.from);
      const to = first(params.to);
      if (!isPlantDayKey(from) || !isPlantDayKey(to)) {
        return { ...base, fromDay: addPlantDays(today, -29), toDay: today, problem: 'Choose both dates of the custom range.' };
      }
      if (from > to) {
        return { ...base, fromDay: addPlantDays(today, -29), toDay: today, problem: 'The custom range ends before it starts.' };
      }
      if (daysBetween(from, to) > 366) {
        return { ...base, fromDay: addPlantDays(today, -29), toDay: today, problem: 'Choose a custom range of a year or less.' };
      }
      return { ...base, fromDay: from, toDay: to };
    }
    default:
      return { ...base, fromDay: addPlantDays(today, -29), toDay: today };
  }
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Unique slabs produced on each plant day of the range — every day present, a quiet one as 0. */
export function dailyProduction(slabs: readonly ReportSlab[], range: TrendRange): { day: string; slabs: number }[] {
  const counts = new Map<string, number>();
  for (let day = range.fromDay; day <= range.toDay; day = addPlantDays(day, 1)) counts.set(day, 0);
  for (const slab of slabs) {
    const day = toPlantDateInput(slab.receivedDate);
    if (counts.has(day)) counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return [...counts.entries()].map(([day, n]) => ({ day, slabs: n }));
}
