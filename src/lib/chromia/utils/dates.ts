/** Pure date helpers — safe to import from anywhere, including tests. */

const MS_PER_DAY = 86_400_000;

/** Whole days between two instants. Never negative. */
export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY));
}

/**
 * A calendar day on its way into a `DATE` column.
 *
 * The rest of the app builds dates at local midnight, which is the only way a
 * "day" can be compared or displayed correctly. PostgreSQL, though, casts an
 * instant to `DATE` in UTC — so local midnight in India (18:30 the previous
 * day, in UTC) would be filed under yesterday. Rebuilding the same year, month
 * and day at UTC midnight makes the stored day the day that was typed.
 */
export function toDateColumn(date: Date): Date;
export function toDateColumn(date: Date | null | undefined): Date | null;
export function toDateColumn(date: Date | null | undefined): Date | null {
  if (!date) return null;
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}
