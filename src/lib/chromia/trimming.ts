/**
 * Trimming — the rules worth being certain about (7 Nov 2026). Pure, so they
 * run under test without a database; trimming-service.ts writes, and the
 * Trimming page and its slab form read, through these.
 *
 * THICKNESS IS STORED IN MILLIMETRES, as everywhere in the module (the slab's
 * own thickness is millimetres too). It is shown in both units — "3 cm
 * (30 mm)" — and may be entered in either.
 */

/** The two trims the line does most, and "Others" for the rest. */
export const TRIM_PRESETS = [
  { value: '30-20', fromMm: 30, toMm: 20, label: '3 cm to 2 cm (30 mm to 20 mm)' },
  { value: '20-12', fromMm: 20, toMm: 12, label: '2 cm to 1.2 cm (20 mm to 12 mm)' },
] as const;
export const TRIM_OTHER = 'OTHER';

/** Which choice a saved From → To is: a preset's value, OTHER, or '' when none is saved. */
export function trimChoiceOf(fromMm: number | null, toMm: number | null): string {
  if (fromMm === null || toMm === null) return '';
  return TRIM_PRESETS.find((p) => p.fromMm === fromMm && p.toMm === toMm)?.value ?? TRIM_OTHER;
}

/** A number without trailing zeros: 12, 1.2, 0.85. */
const num = (n: number) => String(Number(n.toFixed(3)));

/** "3 cm (30 mm)" — or "—" when there is no thickness. */
export function formatThickness(mm: number | null | undefined): string {
  if (mm === null || mm === undefined || !Number.isFinite(mm)) return '—';
  return `${num(mm / 10)} cm (${num(mm)} mm)`;
}

/** "3 cm → 2 cm (30 mm → 20 mm)" — or "" when From → To is not set. */
export function formatTrim(fromMm: number | null | undefined, toMm: number | null | undefined): string {
  if (fromMm === null || fromMm === undefined || toMm === null || toMm === undefined) return '';
  return `${num(fromMm / 10)} cm → ${num(toMm / 10)} cm (${num(fromMm)} mm → ${num(toMm)} mm)`;
}

export type ThicknessUnit = 'cm' | 'mm';

/** A typed thickness in millimetres, or null when it is not a positive number. */
export function toMillimetres(value: string | number | null | undefined, unit: ThicknessUnit): number | null {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim().replace(',', '.'));
  if (String(value ?? '').trim() === '' || !Number.isFinite(n) || n <= 0) return null;
  return Number((unit === 'cm' ? n * 10 : n).toFixed(3));
}

/** Why a From → To cannot be a trim, or null when it can. */
export function trimError(fromMm: number | null, toMm: number | null): string | null {
  if (fromMm === null || toMm === null) return 'Enter both the From and the To thickness.';
  if (toMm >= fromMm) return 'A trim makes the slab thinner — the To thickness must be less than the From thickness.';
  return null;
}

/** What a Trimming record holds, as the status reads it. */
export interface TrimmingState {
  trimFromMm: number | null;
  trimToMm: number | null;
  sentDate: Date | string | null;
  receivedDate: Date | string | null;
  qcGrade: string | null;
  qcDisposition: string | null;
}

export type TrimmingStage = 'READY' | 'PLANNED' | 'SENT' | 'RECEIVED' | 'DONE';

const OUTCOME_LABEL: Record<string, string> = {
  STOCK: 'Stock',
  SAMPLE_CUTTING: 'Sample Cutting',
  RECALIBRATION: 'Recalibration',
  DISPATCH: 'Dispatch',
};

/** How far a slab's trimming has got — from what is actually saved. */
export function trimmingStage(state: TrimmingState): TrimmingStage {
  if (state.qcGrade) return 'DONE';
  if (state.receivedDate) return 'RECEIVED';
  if (state.sentDate) return 'SENT';
  if (state.trimFromMm !== null && state.trimToMm !== null) return 'PLANNED';
  return 'READY';
}

/**
 * The Current Status column — derived, never stored, so it always says what
 * the record holds:
 *
 *   Ready for Trimming                         nothing saved yet
 *   Ready for Trimming — 3 cm → 2 cm           From → To chosen, not sent
 *   Sent for Trimming                          Sent Date saved
 *   Received from Trimming — Awaiting QC       Received Date saved
 *   Trimmed — Grade A: Stock                   QC Report saved after trimming
 */
export function trimmingStatus(state: TrimmingState): string {
  const trim = state.trimFromMm !== null && state.trimToMm !== null
    ? `${num(state.trimFromMm / 10)} cm → ${num(state.trimToMm / 10)} cm`
    : '';
  switch (trimmingStage(state)) {
    case 'DONE': {
      const outcome = state.qcDisposition ? OUTCOME_LABEL[state.qcDisposition] : undefined;
      return `Trimmed — Grade ${state.qcGrade}${outcome ? `: ${outcome}` : ''}`;
    }
    case 'RECEIVED':
      return trim ? `Received from Trimming (${trim}) — Awaiting QC` : 'Received from Trimming — Awaiting QC';
    case 'SENT':
      return trim ? `Sent for Trimming (${trim})` : 'Sent for Trimming';
    case 'PLANNED':
      return `Ready for Trimming — ${trim}`;
    default:
      return 'Ready for Trimming';
  }
}

/**
 * Why these Send & Receive dates cannot be saved, or null. Both are days
 * (yyyy-mm-dd): a Received Date needs a Sent Date, comes no earlier than it,
 * and neither is in the future (`today` is the plant's).
 */
export function tripDatesError(sent: string, received: string, today: string): string | null {
  if (received && !sent) return 'Enter the Sent Date before the Received Date.';
  if (sent && sent > today) return 'The Sent Date cannot be in the future.';
  if (received && received > today) return 'The Received Date cannot be in the future.';
  if (sent && received && received < sent) return 'The Received Date cannot be earlier than the Sent Date.';
  return null;
}
