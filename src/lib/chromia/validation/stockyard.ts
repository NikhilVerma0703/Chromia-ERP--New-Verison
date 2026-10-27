import { z } from 'zod';

import { STOCK_OUTCOMES, stockyardToday } from '@/lib/chromia/constants/stock-outcomes';
import { registerDay } from '@/lib/chromia/operator-register';

export { STOCK_OUTCOME_LABELS, STOCK_OUTCOMES, stockyardToday, type StockOutcomeValue } from '@/lib/chromia/constants/stock-outcomes';

/**
 * Stock Outcome — a stocked slab sent from the Stockyard (27 Oct 2026):
 * Dispatch, Approved or Sample Cutting, and the day it happened.
 *
 * NO FUTURE DATES. The yard records what has already happened, so the date is
 * today or earlier, judged against today in IST — the calendar the page's
 * date picker is capped to, and the same check here so a typed or edited
 * request cannot get past it. A yyyy-mm-dd string compares as a date.
 */
export const stockOutcomeSchema = z.object({
  slabId: z.string().uuid('Pick a slab from the list'),
  outcome: z.enum(STOCK_OUTCOMES, { message: 'Choose Dispatch, Approved or Sample Cutting' }),
  date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the date')
    .refine((value) => registerDay(value) !== null, 'Enter a real date')
    .refine((value) => value <= stockyardToday(), 'The date cannot be in the future')
    .transform((value) => registerDay(value) as Date),
});

export type StockOutcomeInput = z.infer<typeof stockOutcomeSchema>;

/**
 * Stockyard release — a stocked slab leaving the plant.
 *
 * Deliberately its own schema rather than a reuse of `dispatchSchema`: there
 * the date is optional and blank means today, because the in-charge is deciding
 * the outcome at the moment of QC. Here the slab has been sitting on a rack for
 * days and somebody is recording an event that already happened, so the date is
 * the whole point of the form and is required.
 */
export const stockReleaseSchema = z.object({
  slabId: z.string().uuid('Pick a slab from the list'),
  dispatchDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the dispatch date')
    // Split and rebuilt in local time: "2026-08-08" read as UTC is 05:30 in
    // India and the previous day in the Americas.
    .transform((value) => {
      const [year, month, day] = value.split('-').map(Number);
      return new Date(year as number, (month as number) - 1, day as number);
    }),
});

export type StockReleaseInput = z.infer<typeof stockReleaseSchema>;

/**
 * Stock → Recalibration — a stocked slab pulled off the rack to be sent for
 * recalibration.
 *
 * No date, unlike a dispatch: marking a slab for recalibration only opens the
 * waiting record, and the day it physically leaves is recorded later on the
 * Recalibration page's trip form. So the slab is all this needs.
 */
export const stockRecalibrationSchema = z.object({
  slabId: z.string().uuid('Pick a slab from the list'),
});
