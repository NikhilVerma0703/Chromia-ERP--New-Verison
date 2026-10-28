'use server';

import { revalidatePath } from 'next/cache';

import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { stockyardToday } from '@/lib/chromia/constants/stock-outcomes';
import { requireActingUser } from '@/lib/chromia/current-user';
import { isAppError } from '@/lib/chromia/errors';
import { combineDateAndTime, registerDay } from '@/lib/chromia/operator-register';
import { slabRecordEditSchema } from '@/lib/chromia/validation/slab-record';
import { updateSlabRecord } from '@/lib/chromia/server/services/slab-record-service';
import {
  correctStockGrade,
  correctStockOutcome,
  loadStockyardPlace,
  type StockyardPlace,
} from '@/lib/chromia/server/services/stockyard-edit-service';

export interface StockyardEditFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /** Set once everything is saved — the page returns to its list. */
  savedAt?: number;
  saved?: string[];
}

/** The Slab Entry fields, in the order they are compared with what was saved. */
const DETAIL_KEYS = ['productionDate', 'batchNo', 'slabNo', 'baseMaterial', 'fileName', 'thicknessCm', 'inTime'] as const;

const PLACES: readonly StockyardPlace[] = ['IN_STOCK', 'DISPATCH', 'APPROVED', 'SAMPLE_CUTTING'];

/**
 * The Update Slab button of the Stockyard and Approved Slabs Edit forms
 * (28 Oct 2026). Three parts, each saved only if something in it changed:
 *
 *   Slab Entry     every New Entry field and the Slab Remarks: the same
 *                  correction Slab Records makes (updateSlabRecord);
 *   QC Report      the grade, A or B, corrected in place (correctStockGrade);
 *   Stock Outcome  Stockyard only: the outcome and its date, or Back in Stock
 *                  (correctStockOutcome).
 *
 * Everything is checked before anything is written. The same slab record is
 * corrected throughout; none is created, and its photo stays its own.
 */
export async function updateStockyardSlabAction(
  _previous: StockyardEditFormState,
  formData: FormData,
): Promise<StockyardEditFormState> {
  await requireActingUser();
  const get = (key: string) => {
    const value = formData.get(key);
    return typeof value === 'string' ? value.trim() : '';
  };
  const slabId = get('slabId');
  const withOutcome = get('form') === 'stockyard';

  let place: StockyardPlace | null;
  try {
    place = (await loadStockyardPlace(slabId)).place;
  } catch {
    return { error: 'This slab could not be found. Open it again from its list.' };
  }

  const errors: Record<string, string[] | undefined> = {};
  const fail = (key: string, message: string) => {
    errors[key] = [message];
  };

  // ── Slab Entry ─────────────────────────────────────────────────────────
  const details = Object.fromEntries(DETAIL_KEYS.map((key) => [key, get(key)])) as Record<(typeof DETAIL_KEYS)[number], string>;
  const remarks = get('slabRemarks');
  const entryChanged =
    DETAIL_KEYS.some((key) => details[key] !== get(`initial_${key}`)) || remarks !== get('initialRemarks');
  let correction: Parameters<typeof updateSlabRecord>[0] | null = null;
  if (entryChanged) {
    const parsed = slabRecordEditSchema.safeParse({
      slabId,
      receivedDate: details.productionDate,
      inTime: details.inTime || undefined,
      batchNo: details.batchNo,
      slabNo: details.slabNo,
      baseMaterial: details.baseMaterial,
      fileName: details.fileName,
      thicknessCm: details.thicknessCm,
      remarks,
    });
    if (!parsed.success) {
      const fe = parsed.error.flatten().fieldErrors as Record<string, string[] | undefined>;
      if (fe.receivedDate) fe.productionDate = fe.receivedDate;
      if (fe.remarks) fe.slabRemarks = fe.remarks;
      Object.assign(errors, fe);
    } else {
      const inTime = parsed.data.inTime ? combineDateAndTime(parsed.data.receivedDate, parsed.data.inTime) : null;
      if (parsed.data.inTime && !inTime) fail('inTime', 'Enter a valid in-time');
      else correction = { ...parsed.data, inTime };
    }
  }

  // ── QC Report ──────────────────────────────────────────────────────────
  const grade = get('grade');
  const gradeChanged = grade !== get('initialGrade');
  if (gradeChanged) {
    if (place === null) fail('grade', 'This slab is no longer the Stockyard’s — correct its QC on Slab Records.');
    else if (grade !== 'A' && grade !== 'B') fail('grade', 'Choose Grade A or B — both go to Stock. Grade C is a QC redo on Slab Records.');
  }

  // ── Stock Outcome ──────────────────────────────────────────────────────
  const outcome = get('outcome') as StockyardPlace;
  const outcomeDate = get('outcomeDate');
  const outcomeChanged =
    withOutcome && (outcome !== get('initialOutcome') || (outcome !== 'IN_STOCK' && outcomeDate !== get('initialOutcomeDate')));
  let date: Date | null = null;
  if (outcomeChanged) {
    if (place === null) fail('outcome', 'This slab is no longer the Stockyard’s, so its Stock Outcome cannot be changed here.');
    else if (!PLACES.includes(outcome)) fail('outcome', 'Choose Back in Stock, Dispatch, Approved or Sample Cutting');
    else if (outcome !== 'IN_STOCK') {
      date = /^\d{4}-\d{2}-\d{2}$/.test(outcomeDate) ? registerDay(outcomeDate) : null;
      if (!date) fail('outcomeDate', 'Enter the date of the Stock Outcome');
      else if (outcomeDate > stockyardToday()) fail('outcomeDate', 'The date cannot be in the future');
      else if (outcomeDate < get('stockedOn')) fail('outcomeDate', 'The date cannot be before the slab was stocked');
    }
  }

  if (Object.keys(errors).length) return { fieldErrors: errors };
  if (!correction && !gradeChanged && !outcomeChanged) {
    return { error: 'Nothing was changed — correct a field, then Update Slab.' };
  }

  const saved: string[] = [];
  try {
    const user = await requireActingUser();
    if (correction) {
      await updateSlabRecord(correction, user.id);
      saved.push('slab details');
    }
    if (gradeChanged) {
      await correctStockGrade(slabId, grade as 'A' | 'B', user.id);
      saved.push('QC grade');
    }
    if (outcomeChanged) {
      await correctStockOutcome({ slabId, outcome, date }, user.id);
      saved.push('Stock Outcome');
    }
  } catch (error) {
    refresh();
    const why = isAppError(error) || error instanceof Error ? (error as Error).message : null;
    if (why === null) throw error;
    return { error: saved.length ? `Saved: ${saved.join(', ')}. Not saved: ${why}` : why, saved };
  }

  refresh();
  return { savedAt: Date.now(), saved };
}

/** Every page a correction can show on. */
function refresh() {
  for (const path of [
    APP_ROUTES.stockyard,
    APP_ROUTES.approved,
    APP_ROUTES.dispatch,
    APP_ROUTES.slabs,
    APP_ROUTES.dashboard,
    APP_ROUTES.operator,
    APP_ROUTES.reports,
  ]) {
    revalidatePath(path);
  }
}
