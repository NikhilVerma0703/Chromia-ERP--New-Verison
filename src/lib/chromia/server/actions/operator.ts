'use server';

import { revalidatePath } from 'next/cache';

import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { DISPOSITION_LABELS, GRADE_ALLOWED_DISPOSITIONS } from '@/lib/chromia/constants/process-stages';
import { requireActingUser } from '@/lib/chromia/current-user';
import { isAppError } from '@/lib/chromia/errors';
import { DUPLICATE_SLAB_NO_MESSAGE } from '@/lib/chromia/slab-record';
import { operatorEntrySchema } from '@/lib/chromia/validation/operator';
import { intakeQcSchema } from '@/lib/chromia/validation/slab';
import { recordOperatorEntry } from '@/lib/chromia/server/services/operator-service';
import { completeSlabAction, editSlabQcAction } from '@/lib/chromia/server/actions/slab';
import { updateSlabRecordAction } from '@/lib/chromia/server/actions/slab-record';

export interface OperatorFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /** Set on success — the client uses it to reset the row and re-focus. */
  savedSlabNo?: string;
  /** The slab the save wrote — set on success, and when only the QC failed. */
  savedSlabId?: string;
  /** Bumped on every save so the client can react to two saves in a row. */
  savedAt?: number;
  /** The entry was saved but its QC Report was not: the slab is In-Processing. */
  qcFailed?: boolean;
}

export async function recordOperatorEntryAction(
  _previousState: OperatorFormState,
  formData: FormData,
): Promise<OperatorFormState> {
  const parsed = operatorEntrySchema.safeParse({
    entryDate: formData.get('entryDate'),
    inTime: formData.get('inTime'),
    batchNo: formData.get('batchNo'),
    slabNo: formData.get('slabNo'),
    baseMaterial: formData.get('baseMaterial'),
    fileName: formData.get('fileName'),
    thicknessCm: formData.get('thicknessCm'),
    remarks: formData.get('remarks') ?? undefined,
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  let savedSlabId: string;
  try {
    const user = await requireActingUser();
    const slab = await recordOperatorEntry(parsed.data, user.id);
    savedSlabId = slab.id;
  } catch (error) {
    if (isAppError(error)) {
      // A duplicate belongs under the field that caused it.
      if (error.message === DUPLICATE_SLAB_NO_MESSAGE) {
        return { fieldErrors: { slabNo: [error.message] } };
      }
      return { error: error.message };
    }
    if (error instanceof Error && error.message.includes('db:seed')) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(APP_ROUTES.operator);
  revalidatePath(APP_ROUTES.slabs);
  revalidatePath(APP_ROUTES.dashboard);

  return { savedSlabNo: parsed.data.slabNo, savedSlabId, savedAt: Date.now() };
}

/** Read a form field as text — `FormData.get` is null for a field not sent. */
function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Slab Entry's one Save Entry button — the entry and its QC Report together
 * (the owner's change of 27 Oct 2026).
 *
 * The QC Report used to be a second form with its own button, under the entry;
 * now it is part of the entry form and this is the single action behind it.
 * It is built from the two saves that already existed rather than a new copy
 * of either, so their rules and their safety are exactly what they were:
 *
 *   1. the ENTRY — recordOperatorEntryAction for a new row, updateSlabRecordAction
 *      for a slab opened from the table (the same correction Slab Records makes);
 *   2. the QC REPORT, only when a grade was chosen — completeSlabAction to grade
 *      a slab waiting for QC, editSlabQcAction on the Edit path. Each runs its
 *      whole QC save in ONE transaction (CHR-5) and claims the slab (CHR-6).
 *
 * No grade chosen is not an error: the slab is saved In-Processing, and its
 * QC Report is finished later by opening it from Recent Slabs Entry.
 *
 * THE QC REPORT IS CHECKED BEFORE ANYTHING IS WRITTEN. A missing outcome for
 * Grade B, or a grade the rules refuse, comes back under its field with
 * nothing saved, so the operator fixes it and presses Save again on the same
 * form. Only a failure inside the QC save itself — the slab graded on another
 * tablet a moment earlier, say — can leave the entry saved without its QC;
 * that is reported as exactly that (qcFailed), and the page re-opens the slab,
 * In-Processing, for the QC to be finished.
 *
 * The outcome of a grade with one outcome is the SERVER's to set: Grade A is
 * Stock and Grade C is Recalibration whatever the page sent, so an edited
 * request cannot send Grade A to Dispatch. applyIntakeGrade refuses against
 * the same table on the way in.
 */
export async function saveSlabEntryAction(
  previousState: OperatorFormState,
  formData: FormData,
): Promise<OperatorFormState> {
  await requireActingUser();

  const slabId = text(formData, 'slabId');
  // 'grade' — the slab is waiting for QC; 'correct' — the Edit path may redo
  // it; 'none' — its QC is settled, only the entry and the remark are saved.
  const qcMode = text(formData, 'qcMode') || (slabId ? 'none' : 'grade');
  const grade = text(formData, 'grade');
  const remarks = text(formData, 'slabRemarks');

  // ── 1. The QC Report, judged first ──────────────────────────────────────
  let qc: FormData | null = null;
  if (qcMode !== 'none' && grade !== '') {
    const allowed = GRADE_ALLOWED_DISPOSITIONS[grade as keyof typeof GRADE_ALLOWED_DISPOSITIONS] ?? [];
    const chosen = text(formData, 'disposition');
    const disposition = allowed.length === 1 ? allowed[0] : chosen;

    const parsed = intakeQcSchema.safeParse({
      grade,
      disposition: disposition || undefined,
      slabRemarks: remarks || undefined,
      recalibrationReason: text(formData, 'recalibrationReason') || undefined,
    });
    if (!parsed.success) {
      return { fieldErrors: parsed.error.flatten().fieldErrors };
    }
    if (!(allowed as readonly string[]).includes(parsed.data.disposition)) {
      return {
        fieldErrors: {
          disposition: [`Grade ${grade} cannot go to ${DISPOSITION_LABELS[parsed.data.disposition]}`],
        },
      };
    }

    // On the Edit path an unchanged grade and outcome is not a regrade: the
    // QC (and the stock or sample-cutting record it opened) is left alone, and
    // only the entry fields and the remark are saved.
    const unchanged =
      qcMode === 'correct' &&
      grade === text(formData, 'initialGrade') &&
      parsed.data.disposition === text(formData, 'initialDisposition') &&
      !parsed.data.recalibrationReason;

    if (!unchanged) {
      qc = new FormData();
      qc.set('grade', parsed.data.grade);
      qc.set('disposition', parsed.data.disposition);
      qc.set('slabRemarks', remarks);
      if (parsed.data.recalibrationReason) qc.set('recalibrationReason', parsed.data.recalibrationReason);
    }
  }

  // ── 2. The entry ────────────────────────────────────────────────────────
  const entry = new FormData();
  for (const key of ['entryDate', 'receivedDate', 'inTime', 'batchNo', 'slabNo', 'baseMaterial', 'fileName', 'thicknessCm']) {
    const value = formData.get(key);
    if (typeof value === 'string') entry.set(key, value);
  }
  entry.set('remarks', remarks);
  if (slabId) entry.set('slabId', slabId);

  const saved = slabId
    ? await updateSlabRecordAction({}, entry)
    : await recordOperatorEntryAction(previousState, entry);
  if (saved.error || saved.fieldErrors) {
    return { error: saved.error, fieldErrors: saved.fieldErrors };
  }

  const savedSlabId = slabId || (saved as OperatorFormState).savedSlabId;
  const savedSlabNo = saved.savedSlabNo ?? text(formData, 'slabNo');
  if (!qc || !savedSlabId) {
    return { savedSlabNo, savedSlabId, savedAt: Date.now() };
  }

  // ── 3. The QC Report ────────────────────────────────────────────────────
  qc.set('slabId', savedSlabId);
  const graded = qcMode === 'correct' ? await editSlabQcAction({}, qc) : await completeSlabAction({}, qc);
  if (graded.error || graded.fieldErrors) {
    const why = graded.error ?? Object.values(graded.fieldErrors ?? {}).flat()[0] ?? 'it could not be saved';
    return {
      error: `Slab ${savedSlabNo} was saved, but its QC Report was not: ${why}. It is In-Processing — finish its QC Report below.`,
      savedSlabNo,
      savedSlabId,
      qcFailed: true,
    };
  }

  return { savedSlabNo, savedSlabId, savedAt: Date.now() };
}
