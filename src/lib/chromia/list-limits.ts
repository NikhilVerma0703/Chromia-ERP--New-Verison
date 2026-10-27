/**
 * How much of a growing list one page may load.
 *
 * Pure and alias-free so `node --test` can reach it. The code review of
 * 20 Oct 2026 (CHR-10): Slab Records dropped paging for ANY filter — choosing
 * Grade A, or Status Dispatched, loaded every matching slab ever recorded in
 * one render, each row with its own dialog — and the Recalibration and
 * Recalibration Tracking pages loaded every slab that has ever had a trip, with
 * all its trips. All three grow by thousands of rows a year, on pages rendered
 * fresh on every visit, and would in time stop loading at all.
 */

// ---------------------------------------------------------------- slab records ---

/**
 * The longest received-date window Slab Records shows whole, on one page.
 *
 * Kept on purpose: an in-charge working through February's register wants the
 * whole month in front of them, not twelve pages of it — that is why the list
 * stopped paging filtered searches in the first place. A month is at most 31
 * days, and a month of this line is a few hundred slabs. Any other filter — a
 * grade, a status, a batch, a slab number, an open-ended date — pages, the way
 * browsing the whole register always has.
 */
export const WHOLE_RANGE_MAX_DAYS = 31;

/**
 * A ceiling even on a month shown whole. Far above any month the line has
 * made; past it the page says so and asks for a narrower window, instead of
 * trying to draw it.
 */
export const WHOLE_RANGE_ROW_CAP = 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Does this filter bound the received date to a window short enough to show
 * whole? One exact day does; so does a From and a To no more than
 * WHOLE_RANGE_MAX_DAYS apart, both days counted. A From or a To on its own is
 * open-ended and does not.
 */
export function isWholeRangeFilter(filters: {
  receivedFrom: Date | null;
  receivedTo: Date | null;
  receivedOn: Date | null;
}): boolean {
  if (filters.receivedOn) return true;
  if (!filters.receivedFrom || !filters.receivedTo) return false;
  const days = Math.round((filters.receivedTo.getTime() - filters.receivedFrom.getTime()) / DAY_MS) + 1;
  return days >= 1 && days <= WHOLE_RANGE_MAX_DAYS;
}

// ------------------------------------------------------------ recalibration ---

/** Rows a page of the Recalibration and Recalibration Tracking lists shows. */
export const RECALIBRATION_PAGE_SIZE = 100;

/** A `page` search param as a page number: a whole number from 1, else 1. */
export function parsePage(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const page = Number.parseInt(value ?? '', 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

/**
 * The slice of `total` rows one page shows: the page asked for, held inside
 * the pages there are (a link from a longer list lands on the last page, not
 * on an empty one), with the skip and take that cut it.
 */
export function pageWindow(
  total: number,
  page: number,
  pageSize: number,
): { page: number; pages: number; skip: number; take: number; from: number; to: number } {
  const pages = Math.max(1, Math.ceil(Math.max(0, total) / pageSize));
  const current = Math.min(Math.max(1, Math.floor(page)), pages);
  const skip = (current - 1) * pageSize;
  return {
    page: current,
    pages,
    skip,
    take: pageSize,
    from: total === 0 ? 0 : skip + 1,
    to: Math.min(skip + pageSize, total),
  };
}
