import { DISPOSITION_LABELS } from '@/lib/chromia/constants/process-stages';

/**
 * A remark worth a Slab Remarks column: one somebody wrote.
 *
 * Until 27 Oct 2026 the QC section filled the remark with the chosen outcome
 * ("Stock", "Dispatch"), which only repeats QC Outcome. Such a remark, on a
 * slab graded before the change, is not shown as if it had been typed. Shared
 * by every table with a Slab Remarks column, so they agree.
 */
export function manualRemark(remarks: string | null | undefined, disposition: string | null | undefined): string | null {
  const value = remarks?.trim();
  if (!value) return null;
  const label = disposition ? DISPOSITION_LABELS[disposition as keyof typeof DISPOSITION_LABELS] : undefined;
  if (label && value.toLowerCase() === label.toLowerCase()) return null;
  return value;
}
