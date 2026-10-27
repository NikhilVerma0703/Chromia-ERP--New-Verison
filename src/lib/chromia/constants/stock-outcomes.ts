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

/**
 * The plant day (IST, `yyyy-mm-dd`) a slab went into stock — the EARLIEST
 * date its Stock Outcome may carry: a slab cannot leave the rack before it was
 * put there. Null when the slab has no open stock entry to date it by.
 */
export function stockedOnDay(stockDate: Date | null | undefined): string | null {
  return stockDate ? toPlantDateInput(stockDate) : null;
}
