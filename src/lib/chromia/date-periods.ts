/**
 * Slab Records → Find a Slab → Date Period (7 Nov 2026, change 9): the
 * choices, in the order offered. A module of its own, with no Prisma import,
 * so the form in the browser carries these few strings and nothing else.
 * slab-filters.ts turns the choice into production dates.
 */
export const DATE_PERIODS = ['ALL', 'TODAY', 'LAST_7', 'LAST_30', 'MONTH', 'CUSTOM'] as const;
export type DatePeriod = (typeof DATE_PERIODS)[number];

export const DATE_PERIOD_LABELS: Record<DatePeriod, string> = {
  ALL: 'All',
  TODAY: 'Today',
  LAST_7: 'Last 7 Days',
  LAST_30: 'Last 30 Days',
  MONTH: 'Month-wise',
  CUSTOM: 'Custom Date Range (From–To)',
};
