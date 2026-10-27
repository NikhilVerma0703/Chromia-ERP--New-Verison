import { ChromiaDisposition as Disposition, ChromiaSlabStatus as SlabStatus } from '@prisma/client';
import type { ChromiaDisposition as DispositionType } from '@prisma/client';

import { toPlantReportDay } from './plant-time.ts';

/**
 * Where the plant's slabs are, right now.
 *
 * Pure, so it can be unit-tested without a database: the repository fetches
 * rows, this file decides what they mean. The dashboard answers four questions
 * and nothing else — how the plant stands overall, where its slabs are, what
 * happened today, and what QC just said. Anything that needs filtering,
 * ranking or a date range belongs in its own section, not on a screen meant to
 * be read in ten seconds.
 */

// ---------------------------------------------------------- where they went ---

/**
 * The five places a slab ends up, plus the ones still deciding.
 *
 * Grouped by the outcome the in-charge recorded, read against where the slab
 * actually is. A slab with no decision yet is still in processing — that is
 * the honest name for it, not a missing value.
 *
 * TWO DECISIONS ARE NOT YET FACTS (the code review of 20 Oct 2026, CHR-3):
 *   • A → Dispatch at QC only puts a slab in the Dispatch page's queue; it is
 *     dispatched the day somebody sends it. Twenty slabs graded A → Dispatch
 *     today and still in the queue were counted as dispatched — in the tile,
 *     and taken off "in the plant" — while the Summary, which counts status
 *     DISPATCHED, disagreed by the size of the queue. They are "Awaiting
 *     dispatch" now: still in the plant, still on the bar.
 *   • A slab written off after its fifth attempt keeps the outcome
 *     Recalibration (writeOff sets only its status), so it was counted in
 *     recalibration. It is waste.
 *
 * Waste keeps a slot even though the Chromia line rarely uses it; an empty
 * group is dropped from the bar, so it only ever appears if it happened.
 */
export const OUTCOME_GROUPS = [
  { key: Disposition.DISPATCH, label: 'Dispatched', color: '#16a34a' },
  { key: 'AWAITING_DISPATCH' as const, label: 'Awaiting dispatch', color: '#86efac' },
  { key: Disposition.STOCK, label: 'Stock', color: '#327dff' },
  { key: Disposition.SAMPLE_CUTTING, label: 'Sample cutting', color: '#d97706' },
  { key: Disposition.RECALIBRATION, label: 'Recalibration', color: '#9333ea' },
  { key: 'IN_PROCESSING' as const, label: 'In processing', color: '#94a3b8' },
  { key: Disposition.WASTE, label: 'Waste', color: '#dc2626' },
] as const;

export type OutcomeKey = DispositionType | 'IN_PROCESSING' | 'AWAITING_DISPATCH';

/**
 * Which group one slab is counted in — the one rule the tiles and the bar
 * both read, so they still cannot disagree.
 *
 *   status WASTE                         → Waste, whatever QC last decided
 *   status DISPATCHED                    → Dispatched
 *   outcome Dispatch, not yet dispatched → Awaiting dispatch
 *   anything else                        → its outcome, or In processing
 */
export function outcomeKeyOf(slab: {
  currentDisposition: DispositionType | null;
  status: string;
}): OutcomeKey {
  if (slab.status === SlabStatus.WASTE) return Disposition.WASTE;
  if (slab.status === SlabStatus.DISPATCHED) return Disposition.DISPATCH;
  if (slab.currentDisposition === Disposition.DISPATCH) return 'AWAITING_DISPATCH';
  return slab.currentDisposition ?? 'IN_PROCESSING';
}

/**
 * The rows dated on today's plant day or later — the dashboard's "today".
 *
 * Today is the production day running now, 06:00 to 06:00 (the owner's
 * decision of 20 Oct 2026 on CHR-8), and each date is filed by the rule every
 * Chromia report uses: a typed day as itself, a stamped instant on the
 * production day it happened in (toPlantReportDay). "Or later" keeps what the
 * figures always counted — everything from the start of today on, so a slab
 * entered with tomorrow's date by mistake is still seen, not lost.
 */
export function fromDay<T>(rows: readonly T[], at: (row: T) => Date | null, today: string): T[] {
  return rows.filter((row) => {
    const date = at(row);
    return date !== null && toPlantReportDay(date) >= today;
  });
}

/** fromDay, for a plain list of dates. */
export function countFromDay(dates: readonly (Date | null)[], today: string): number {
  return fromDay(dates, (date) => date, today).length;
}

export interface OutcomeSlice {
  key: OutcomeKey;
  label: string;
  count: number;
  percent: number;
  color: string;
}

/**
 * Build the outcome bar.
 *
 * `counts` is keyed by outcomeKeyOf: the slab's outcome read against where it
 * is, with `IN_PROCESSING` holding everything not yet decided.
 */
export function buildOutcomeSplit(counts: Partial<Record<OutcomeKey, number>>): OutcomeSlice[] {
  const total = OUTCOME_GROUPS.reduce((sum, group) => sum + (counts[group.key] ?? 0), 0);

  return OUTCOME_GROUPS.map((group) => ({
    key: group.key as OutcomeKey,
    label: group.label,
    count: counts[group.key] ?? 0,
    percent: total === 0 ? 0 : Math.round(((counts[group.key] ?? 0) / total) * 100),
    color: group.color,
  })).filter((slice) => slice.count > 0);
}

