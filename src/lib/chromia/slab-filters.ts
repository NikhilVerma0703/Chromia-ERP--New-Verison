import { ChromiaDisposition as Disposition, ChromiaSlabGrade as SlabGrade } from '@prisma/client';
import { PAGINATION } from '@/lib/chromia/constants/app';
import { addPlantDays, isPlantDayKey, toPlantDateInput } from '@/lib/chromia/plant-time';

/**
 * Slab search & filter state.
 *
 * Parsing and where-building live here (a pure module) rather than in the
 * repository, so the rules are unit-testable without a database.
 *
 * FIND A SLAB (7 Nov 2026, change 9): Production Date, Batch Number, Slab
 * Number, Base Material, File Name, Grade, QC Outcome and Date Period. The
 * Status filter is gone. Date Period is All, Today, Last 7 Days, Last 30
 * Days, Month-wise or a Custom From–To — and every one of them reads the
 * slab's PRODUCTION DATE and nothing else.
 */

import { DATE_PERIODS, type DatePeriod } from '@/lib/chromia/date-periods';

export { DATE_PERIOD_LABELS, DATE_PERIODS, type DatePeriod } from '@/lib/chromia/date-periods';

export interface SlabFilters {
  slabNo: string;
  batchNo: string;
  grade: SlabGrade | null;
  disposition: Disposition | null;
  baseMaterialId: string | null;
  designId: string | null;
  outForRecalibration: boolean;
  /** Date Period, and its month (`yyyy-mm`) when Month-wise. */
  period: DatePeriod;
  month: string;
  /**
   * The production-date bounds the Date Period comes to — typed for Custom,
   * worked out (on the plant's calendar) for Today, Last 7 / 30 Days and
   * Month-wise. Null for All.
   */
  receivedFrom: Date | null;
  receivedTo: Date | null;
  /** Production Date: one exact day, narrowing whatever period is set. */
  receivedOn: Date | null;
  page: number;
  pageSize: number;
}

export type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function asEnum<T extends string>(value: string, allowed: readonly T[]): T | null {
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function asDate(value: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** A production day key (`yyyy-mm-dd`) as the stored production date: that day at midnight. */
const dayDate = (day: string) => new Date(`${day}T00:00:00.000Z`);

/**
 * The production days a Date Period covers, on the plant's calendar (IST),
 * both ends included — or null for All, and for a Custom range with neither
 * end typed. Today is the plant's today; Last 7 Days is today and the six
 * before it; Last 30 Days, today and the twenty-nine before; Month-wise, the
 * whole month asked for.
 */
export function datePeriodDays(
  period: DatePeriod,
  month: string,
  now: Date = new Date(),
): { from: string; to: string } | null {
  const today = toPlantDateInput(now);
  switch (period) {
    case 'TODAY':
      return { from: today, to: today };
    case 'LAST_7':
      return { from: addPlantDays(today, -6), to: today };
    case 'LAST_30':
      return { from: addPlantDays(today, -29), to: today };
    case 'MONTH': {
      const ym = /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : today.slice(0, 7);
      const [y, m] = ym.split('-').map(Number) as [number, number];
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
    }
    default:
      return null;
  }
}

export function parseSlabFilters(params: RawSearchParams, now: Date = new Date()): SlabFilters {
  const pageRaw = Number.parseInt(first(params.page), 10);
  const sizeRaw = Number.parseInt(first(params.pageSize), 10);

  const pageSize =
    Number.isFinite(sizeRaw) && sizeRaw > 0
      ? Math.min(sizeRaw, PAGINATION.maxPageSize)
      : PAGINATION.defaultPageSize;

  // A From or a To with no period named is a Custom range — the link a
  // search made before Date Period existed still finds the same slabs.
  const typedFrom = isPlantDayKey(first(params.receivedFrom)) ? first(params.receivedFrom) : '';
  const typedTo = isPlantDayKey(first(params.receivedTo)) ? first(params.receivedTo) : '';
  const period = asEnum(first(params.period), DATE_PERIODS) ?? (typedFrom || typedTo ? 'CUSTOM' : 'ALL');
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(first(params.month)) ? first(params.month) : toPlantDateInput(now).slice(0, 7);
  const days = datePeriodDays(period, month, now);

  return {
    slabNo: first(params.slabNo).trim().slice(0, 80),
    batchNo: first(params.batchNo).trim().slice(0, 80),
    grade: asEnum(first(params.grade), Object.values(SlabGrade)),
    disposition: asEnum(first(params.disposition), Object.values(Disposition)),
    baseMaterialId: first(params.baseMaterialId) || null,
    designId: first(params.designId) || null,
    outForRecalibration: first(params.out) === '1',
    period,
    month,
    receivedFrom: days ? dayDate(days.from) : period === 'CUSTOM' && typedFrom ? dayDate(typedFrom) : null,
    receivedTo: days ? dayDate(days.to) : period === 'CUSTOM' && typedTo ? dayDate(typedTo) : null,
    receivedOn: asDate(first(params.receivedOn)),
    page: Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1,
    pageSize,
  };
}

/** True when anything beyond paging is set — drives the "clear" affordance. */
export function hasActiveFilters(filters: SlabFilters): boolean {
  return Boolean(
    filters.slabNo ||
    filters.batchNo ||
    filters.period !== 'ALL' ||
    filters.grade ||
    filters.disposition ||
    filters.baseMaterialId ||
    filters.designId ||
    filters.outForRecalibration ||
    filters.receivedFrom ||
    filters.receivedTo ||
    filters.receivedOn,
  );
}

/**
 * Prisma `where` for the slab list.
 *
 * Slab number and batch number are separate filters, and both match partially
 * and case-insensitively — operators type "8547" and expect 85477 back. Given
 * together they narrow (AND), so "batch 1245, slab ending 20" is one search.
 */
export function buildSlabWhere(filters: SlabFilters) {
  const where: Record<string, unknown> = { deletedAt: null };

  if (filters.slabNo) {
    where.slabNo = { contains: filters.slabNo, mode: 'insensitive' };
  }

  if (filters.batchNo) {
    where.batch = { batchNo: { contains: filters.batchNo, mode: 'insensitive' } };
  }

  if (filters.grade) where.currentGrade = filters.grade;
  if (filters.disposition) where.currentDisposition = filters.disposition;
  if (filters.baseMaterialId) where.baseMaterialId = filters.baseMaterialId;
  if (filters.designId) where.plannedDesignId = filters.designId;
  if (filters.outForRecalibration) where.isRecalibrationOut = true;

  /*
   * All three date filters read the same Received Date column, so they are
   * merged into one bound rather than written three times over — the last one
   * would otherwise silently win. A single day and a range given together
   * narrow each other, which is what someone who sets both means.
   */
  const startOfDay = (date: Date) => {
    const copy = new Date(date);
    copy.setHours(0, 0, 0, 0);
    return copy;
  };

  const endOfDay = (date: Date) => {
    const copy = new Date(date);
    copy.setHours(23, 59, 59, 999);
    return copy;
  };

  const lowerBounds = [filters.receivedFrom, filters.receivedOn].filter(
    (value): value is Date => value !== null,
  );
  const upperBounds = [filters.receivedTo, filters.receivedOn].filter(
    (value): value is Date => value !== null,
  );

  if (lowerBounds.length > 0 || upperBounds.length > 0) {
    const receivedDate: Record<string, Date> = {};

    if (lowerBounds.length > 0) {
      // The latest lower bound wins: both must hold.
      receivedDate.gte = new Date(
        Math.max(...lowerBounds.map((value) => startOfDay(value).getTime())),
      );
    }

    if (upperBounds.length > 0) {
      // Inclusive of the whole end day.
      receivedDate.lte = new Date(
        Math.min(...upperBounds.map((value) => endOfDay(value).getTime())),
      );
    }

    where.receivedDate = receivedDate;
  }

  return where;
}

/** Rebuild the query string, dropping empties and resetting the page. */
export function buildQuery(
  filters: SlabFilters,
  overrides: Partial<Record<string, string | number>> = {},
): string {
  const params = new URLSearchParams();

  const base: Record<string, string> = {
    slabNo: filters.slabNo,
    batchNo: filters.batchNo,
    grade: filters.grade ?? '',
    disposition: filters.disposition ?? '',
    baseMaterialId: filters.baseMaterialId ?? '',
    designId: filters.designId ?? '',
    out: filters.outForRecalibration ? '1' : '',
    // The period by name; its days are worked out again when the link is
    // opened, so "Today" stays today. Only a Custom range carries its dates.
    period: filters.period === 'ALL' ? '' : filters.period,
    month: filters.period === 'MONTH' ? filters.month : '',
    receivedFrom: filters.period === 'CUSTOM' && filters.receivedFrom ? filters.receivedFrom.toISOString().slice(0, 10) : '',
    receivedTo: filters.period === 'CUSTOM' && filters.receivedTo ? filters.receivedTo.toISOString().slice(0, 10) : '',
    receivedOn: filters.receivedOn ? filters.receivedOn.toISOString().slice(0, 10) : '',
    page: String(filters.page),
    pageSize: String(filters.pageSize),
  };

  for (const [key, value] of Object.entries({ ...base, ...overrides })) {
    const asString = String(value ?? '');
    if (asString && asString !== '0') params.set(key, asString);
  }

  return params.toString();
}

export function pageCount(total: number, pageSize: number): number {
  if (total <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}
