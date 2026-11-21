/**
 * Trimming board — what the Trimming page's Dashboard counts and lists
 * (21 Nov 2026). Pure, like recalibration-board.ts: the repository hands in
 * each Trimming record with every attempt it has made, and everything here is
 * arithmetic on them, so the KPIs, the card a user clicks and the rows under
 * it cannot disagree.
 *
 * WHICH RECORDS: the rows of Trimming Records — every slab graded C →
 * Trimming on Slab Entry, and every slab entered under Trimming Without
 * Design Printing. A record is its slab's LATEST trimming; an earlier one,
 * finished before the slab was sent to Trimming again, is kept as an attempt
 * (chromia_trimming_attempt, 0011). Attempts are numbered 1, 2, … in order.
 *
 * EIGHT KPIs IN TWO SECTIONS (the owner's definitions, 21 Nov 2026):
 *
 *   OVERALL STATUS — history: EVENTS, so a slab's repeat attempts count again,
 *   and a trimming stays counted after QC clears the slab (Grade A / B).
 *     Total Trimmed Slabs      every trimming attempt — each time a slab was
 *                              marked for Trimming, sent yet or not;
 *     Total Sent               every attempt with a Sent Date;
 *     Total Received           every attempt with a Received Date;
 *     Total Pending            Sent − Received: attempts still out (a Received
 *                              Date needs a Sent Date — tripDatesError).
 *
 *   CURRENT STATUS — now: SLABS, by their latest attempt, each slab once a card.
 *     Ready for Trimming       not sent yet (From → To chosen or not) —
 *                              Grade C → Trimming and Without Design Printing;
 *     Sent for Trimming        out at trimming, awaiting receipt;
 *     Received from Trimming   back from trimming (Received Date saved);
 *     Available after Trimming received, and not yet processed: no QC Report
 *                              after trimming saved, so not reprinted / graded
 *                              / sent on = (Received) − (already processed).
 */
import { isPlantDayKey, plantDayRange } from '@/lib/chromia/plant-time';
import type { RawSearchParams } from '@/lib/chromia/simple-filters';

/** OVERALL STATUS — events, from the beginning. */
export const TRIM_OVERALL_VIEWS = ['trimmed', 'sent', 'received', 'pending'] as const;
/** CURRENT STATUS — slabs, where they are now. */
export const TRIM_CURRENT_VIEWS = ['ready', 'out', 'returned', 'available'] as const;
export const TRIM_BOARD_VIEWS = [...TRIM_OVERALL_VIEWS, ...TRIM_CURRENT_VIEWS] as const;
export type TrimOverallView = (typeof TRIM_OVERALL_VIEWS)[number];
export type TrimCurrentView = (typeof TRIM_CURRENT_VIEWS)[number];
export type TrimBoardView = (typeof TRIM_BOARD_VIEWS)[number];

export const TRIM_VIEW_LABELS: Record<TrimBoardView, string> = {
  trimmed: 'Total Trimmed Slabs',
  sent: 'Total Slabs Sent for Trimming',
  received: 'Total Slabs Received from Trimming',
  pending: 'Total Pending Slabs from Trimming',
  ready: 'Ready for Trimming',
  out: 'Sent for Trimming',
  returned: 'Received from Trimming',
  available: 'Available Slabs after Trimming',
};

/** One trimming of a slab — an earlier attempt, or the record's own (the latest). */
export interface TrimAttempt {
  attemptNumber: number;
  sentDate: Date | string | null;
  receivedDate: Date | string | null;
  qcAt: Date | string | null;
}

export interface TrimBoardRecord {
  id: string;
  /** Every attempt, oldest first; the last is the record's own. */
  attempts: readonly TrimAttempt[];
}

export type TrimBoardKpis = Record<TrimBoardView, number>;

/** One table row: a record, and the attempt the row is about. */
export interface TrimBoardRow {
  recordId: string;
  attemptNumber: number;
}

const latest = (record: TrimBoardRecord): TrimAttempt | undefined => record.attempts[record.attempts.length - 1];

/** Is this record's slab in a Current Status card now? (By its latest attempt.) */
export function inCurrentView(record: TrimBoardRecord, view: TrimCurrentView): boolean {
  const now = latest(record);
  if (!now) return false;
  const sent = Boolean(now.sentDate);
  const back = sent && Boolean(now.receivedDate);
  switch (view) {
    case 'ready':
      return !sent;
    case 'out':
      return sent && !back;
    case 'returned':
      return back;
    case 'available':
      return back && !now.qcAt;
  }
}

/** Does this attempt belong in an OVERALL view? Each is one event. */
function inOverallView(attempt: TrimAttempt, view: TrimOverallView): boolean {
  const sent = Boolean(attempt.sentDate);
  const back = sent && Boolean(attempt.receivedDate);
  switch (view) {
    case 'trimmed':
      return true;
    case 'sent':
      return sent;
    case 'received':
      return back;
    case 'pending':
      return sent && !back;
  }
}

const isOverall = (view: TrimBoardView): view is TrimOverallView => (TRIM_OVERALL_VIEWS as readonly string[]).includes(view);

/** The rows for a view: a record per row (no view, or a Current card), an attempt per row (an Overall card), newest attempt first. */
export function trimBoardRows(records: readonly TrimBoardRecord[], view: TrimBoardView | null): TrimBoardRow[] {
  const rows: TrimBoardRow[] = [];
  for (const record of records) {
    const now = latest(record);
    if (!now) continue;
    if (view === null) {
      rows.push({ recordId: record.id, attemptNumber: now.attemptNumber });
    } else if (isOverall(view)) {
      for (const attempt of [...record.attempts].reverse()) {
        if (inOverallView(attempt, view)) rows.push({ recordId: record.id, attemptNumber: attempt.attemptNumber });
      }
    } else if (inCurrentView(record, view)) {
      rows.push({ recordId: record.id, attemptNumber: now.attemptNumber });
    }
  }
  return rows;
}

/** The eight KPIs — each the number of rows its card shows (trimBoardRows). */
export function trimBoardKpis(records: readonly TrimBoardRecord[]): TrimBoardKpis {
  return Object.fromEntries(TRIM_BOARD_VIEWS.map((view) => [view, trimBoardRows(records, view).length])) as TrimBoardKpis;
}

// ─────────────────────────────────────────────────────────── Find a Slab ───

export interface TrimFilters {
  productionDate: string;
  batchNo: string;
  slabNo: string;
  baseMaterial: string;
  fileName: string;
  view: TrimBoardView | null;
}

/** What Find a Slab reads of a Trimming record's row. */
export interface TrimFilterable {
  productionDate: Date | null;
  batchNo: string;
  slabNo: string;
  baseMaterial: string;
  fileName: string | null;
}

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return (value[0] ?? '').trim();
  return (value ?? '').trim();
}

export function parseTrimFilters(params: RawSearchParams): TrimFilters {
  const productionDate = first(params.productionDate);
  const view = first(params.view);
  return {
    productionDate: isPlantDayKey(productionDate) ? productionDate : '',
    batchNo: first(params.batchNo).slice(0, 80),
    slabNo: first(params.slabNo).slice(0, 80),
    baseMaterial: first(params.baseMaterial).slice(0, 120),
    fileName: first(params.fileName).slice(0, 120),
    view: (TRIM_BOARD_VIEWS as readonly string[]).includes(view) ? (view as TrimBoardView) : null,
  };
}

/** Any Find a Slab field set — the KPI card chosen is not a filter. */
export function hasTrimFilters(f: TrimFilters): boolean {
  return Boolean(f.productionDate || f.batchNo || f.slabNo || f.baseMaterial || f.fileName);
}

const has = (value: string | null | undefined, wanted: string) => !wanted || (value ?? '').toLowerCase().includes(wanted.toLowerCase());

/** Does a row match every Find a Slab field set? (Each a case-blind "contains"; the date its plant day.) */
export function matchesTrimFilters(row: TrimFilterable, f: TrimFilters): boolean {
  if (f.productionDate) {
    if (!row.productionDate) return false;
    const { from, to } = plantDayRange(f.productionDate, f.productionDate);
    const at = row.productionDate.getTime();
    if (at < from.getTime() || at > to.getTime()) return false;
  }
  return has(row.batchNo, f.batchNo) && has(row.slabNo, f.slabNo) && has(row.baseMaterial, f.baseMaterial) && has(row.fileName, f.fileName);
}

/** The type-ahead choices of Find a Slab — the values on the Trimming Records rows. */
export function trimFilterOptions(rows: readonly TrimFilterable[]) {
  const sorted = (values: (string | null | undefined)[]) =>
    [...new Set(values.filter((v): v is string => Boolean(v && v.trim())))].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
    );
  return {
    batchNos: sorted(rows.map((r) => r.batchNo)),
    slabNos: sorted(rows.map((r) => r.slabNo)),
    baseMaterials: sorted(rows.map((r) => r.baseMaterial)),
    fileNames: sorted(rows.map((r) => r.fileName)),
  };
}

/** The query string — `overrides` set (or clear, with '') single keys. */
export function buildTrimQuery(f: TrimFilters, overrides: Partial<Record<keyof TrimFilters, string>> = {}): string {
  const params = new URLSearchParams();
  const values: Record<string, string> = {
    productionDate: f.productionDate,
    batchNo: f.batchNo,
    slabNo: f.slabNo,
    baseMaterial: f.baseMaterial,
    fileName: f.fileName,
    view: f.view ?? '',
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
  return params.toString();
}
