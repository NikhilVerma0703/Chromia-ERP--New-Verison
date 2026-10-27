/**
 * The Attendance Downloads filter — which records the page lists and the
 * spreadsheet then contains.
 *
 * Pure and alias-free so `node --test` can reach it. The SAME function decides
 * both, which is the point: the sheet is the table you were just looking at,
 * never a second query that could answer differently.
 *
 * Dates are yyyy-mm-dd strings throughout and the arithmetic is done in whole
 * days since the epoch, in UTC — so "last week" is seven calendar days and
 * nothing shifts across a timezone.
 */

export const RECORD_TYPES = ["ATTENDANCE", "LEAVE"] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

export const RECORD_TYPE_LABELS: Record<RecordType, string> = {
  ATTENDANCE: "Attendance",
  LEAVE: "Leave",
};

/**
 * How the period is chosen. They are modes, not separate filters: a date and a
 * month cannot both be in force, and offering them as independent boxes is how
 * a screen ends up with a filter the reader cannot explain.
 */
export const PERIOD_MODES = ["DATE", "LAST_WEEK", "MONTH", "RANGE", "ALL"] as const;
export type PeriodMode = (typeof PERIOD_MODES)[number];

export const PERIOD_LABELS: Record<PeriodMode, string> = {
  DATE: "A single date",
  LAST_WEEK: "Last week",
  MONTH: "Month-wise",
  RANGE: "Custom date range",
  ALL: "All records",
};

export interface AttendanceFilter {
  type: RecordType;
  /** One operator's id, or "" for every operator. */
  operatorId: string;
  period: PeriodMode;
  /** PERIOD "DATE". */
  date?: string;
  /** PERIOD "RANGE". Either end may be left empty, which leaves it open. */
  from?: string;
  to?: string;
  /** PERIOD "MONTH", as yyyy-mm. */
  month?: string;
}

/** Whole days since the epoch for a yyyy-mm-dd, or null. UTC, so no timezone
 *  moves the day. */
export function dayNum(d: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((d ?? "").trim());
  if (!m) return null;
  const n = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(n) ? Math.floor(n / 86_400_000) : null;
}

/** The inverse. */
export function dateFromDayNum(dn: number): string {
  return new Date(dn * 86_400_000).toISOString().slice(0, 10);
}

/** The last day of a yyyy-mm month: the day before the first of the next. */
function lastOfMonth(year: number, month1: number): string {
  const firstOfNext = Date.UTC(month1 === 12 ? year + 1 : year, month1 === 12 ? 0 : month1, 1);
  return dateFromDayNum(Math.floor(firstOfNext / 86_400_000) - 1);
}

/** How many days "last week" covers, today included. */
export const LAST_WEEK_DAYS = 7;

/**
 * The inclusive yyyy-mm-dd bounds the filter covers. A null bound is open —
 * "All records" is open at both ends, and a half-filled custom range is open
 * at the end left blank rather than silently becoming today.
 *
 * `today` is passed in rather than read from the clock, so the same filter
 * always gives the same window in a test and the server and the page cannot
 * disagree about what day it is.
 */
export function periodBounds(f: AttendanceFilter, today: string): { from: string | null; to: string | null } {
  switch (f.period) {
    case "DATE": {
      const d = dayNum(f.date) === null ? null : (f.date as string);
      return { from: d, to: d };
    }
    case "LAST_WEEK": {
      const t = dayNum(today);
      if (t === null) return { from: null, to: null };
      return { from: dateFromDayNum(t - (LAST_WEEK_DAYS - 1)), to: today };
    }
    case "MONTH": {
      const m = /^(\d{4})-(\d{2})$/.exec((f.month ?? "").trim());
      if (!m) return { from: null, to: null };
      const year = Number(m[1]);
      const month1 = Number(m[2]);
      if (month1 < 1 || month1 > 12) return { from: null, to: null };
      return { from: `${m[1]}-${m[2]}-01`, to: lastOfMonth(year, month1) };
    }
    case "RANGE": {
      const a = dayNum(f.from) === null ? null : (f.from as string);
      const b = dayNum(f.to) === null ? null : (f.to as string);
      // Typed the wrong way round reads as the range they meant, not as empty.
      if (a !== null && b !== null && a > b) return { from: b, to: a };
      return { from: a, to: b };
    }
    default:
      return { from: null, to: null };
  }
}

/** A row of either register, as far as filtering cares. */
export interface FilterableRow {
  date: string;
  operatorId: string;
}

/** Does this row pass the filter? Operator and period are ANDed — picking an
 *  operator AND a month gives that operator's rows in that month, which is
 *  what both of them being set has to mean. */
export function matchesFilter(row: FilterableRow, f: AttendanceFilter, today: string): boolean {
  if (f.operatorId && row.operatorId !== f.operatorId) return false;
  const { from, to } = periodBounds(f, today);
  // yyyy-mm-dd compares as text exactly as it compares as a date.
  if (from !== null && row.date < from) return false;
  if (to !== null && row.date > to) return false;
  return true;
}

/** A yyyy-mm-dd as the screen shows a date, dd/mm/yyyy — the ERP's dmy()
 *  (components/commercial/invoices/ui.ts), written out here so this file stays
 *  alias-free for node --test. */
const onScreen = (d: string) => d.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$3/$2/$1");

/** The filter in words, for the line above the results on screen:
 *  "Attendance · Praveen Kumar.S · 01/10/2026 → 31/10/2026". Dates read
 *  dd/mm/yyyy, as the table under it does; only the file name and the sheet
 *  keep the sortable yyyy-mm-dd. */
export function describeFilter(f: AttendanceFilter, today: string, operatorName: string): string {
  const parts: string[] = [RECORD_TYPE_LABELS[f.type]];
  parts.push(f.operatorId ? operatorName || "Operator" : "All operators");
  const { from, to } = periodBounds(f, today);
  if (from === null && to === null) parts.push("All dates");
  else if (from === to) parts.push(onScreen(String(from)));
  // A half-filled range is open at the blank end (periodBounds), not "today":
  // leave is asked in advance, so rows after today are in it too.
  else if (to === null) parts.push(`from ${onScreen(String(from))}`);
  else if (from === null) parts.push(`up to ${onScreen(to)}`);
  else parts.push(`${onScreen(from)} → ${onScreen(to)}`);
  return parts.join(" · ");
}

/** The download's file name — the filter, so two downloads never collide in a
 *  Downloads folder. */
export function filterFileName(f: AttendanceFilter, today: string, operatorName: string): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "all";
  const { from, to } = periodBounds(f, today);
  const span = from === null && to === null ? "all" : from === to ? String(from) : `${from ?? "start"}_${to ?? today}`;
  const who = f.operatorId ? safe(operatorName) : "all-operators";
  return `${RECORD_TYPE_LABELS[f.type]}_${who}_${span}.xlsx`;
}

/* ── The sheets ────────────────────────────────────────────────────── */

/** The Attendance sheet's columns, in the order the register shows them. */
export const ATTENDANCE_COLUMNS = [
  "Date", "Operator Name", "Line", "In-Time", "Out-Time", "Total Working Hours",
] as const;
export const ATTENDANCE_WIDTHS = [13, 24, 24, 10, 10, 20];

/** The Leave sheet's, likewise. Leave Type sits immediately after the operator,
 *  where it does on screen, so the sheet reads in the register's own order. */
export const LEAVE_COLUMNS = [
  "Date", "S.No.", "Operator Name", "Leave Type", "Leave Time", "Leave Reason", "Remarks",
] as const;
export const LEAVE_WIDTHS = [13, 7, 24, 18, 16, 32, 32];

export function columnsFor(type: RecordType): readonly string[] {
  return type === "LEAVE" ? LEAVE_COLUMNS : ATTENDANCE_COLUMNS;
}

export function widthsFor(type: RecordType): number[] {
  return type === "LEAVE" ? LEAVE_WIDTHS : ATTENDANCE_WIDTHS;
}
