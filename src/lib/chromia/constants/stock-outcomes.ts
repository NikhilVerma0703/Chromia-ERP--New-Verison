import { toPlantDateInput } from '@/lib/chromia/plant-time';

/**
 * The three ways a slab leaves the Stockyard — its Stock Outcome (27 Oct 2026).
 * Kept apart from the validation schema so the row form in the browser carries
 * these few strings and not the whole of zod.
 */
export const STOCK_OUTCOMES = ['DISPATCH', 'APPROVED', 'SAMPLE_CUTTING'] as const;
export type StockOutcomeValue = (typeof STOCK_OUTCOMES)[number];

export const STOCK_OUTCOME_LABELS: Record<StockOutcomeValue, string> = {
  DISPATCH: 'Dispatch',
  APPROVED: 'Approved',
  SAMPLE_CUTTING: 'Sample Cutting',
};

/** Today in the plant (IST), `yyyy-mm-dd` — the latest date the yard may record. */
export function stockyardToday(now: Date = new Date()): string {
  return toPlantDateInput(now);
}
