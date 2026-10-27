'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { DISPOSITION_LABELS, GRADE_ALLOWED_DISPOSITIONS } from '@/lib/chromia/constants/process-stages';
import { prisma } from '@/lib/chromia/db';
import { combineDateAndTime } from '@/lib/chromia/operator-register';
import { stageOf } from '@/lib/chromia/recalibration-flow';
import { slabRecordEditSchema } from '@/lib/chromia/validation/slab-record';
import { intakeQcSchema } from '@/lib/chromia/validation/slab';
import { completeSlabAction } from '@/lib/chromia/server/actions/slab';
import { resolveRecalibrationReasonId } from '@/lib/chromia/server/services/reference-service';
import { updateSlabRecord } from '@/lib/chromia/server/services/slab-record-service';
import { requireActingUser } from '@/lib/chromia/current-user';
import { isAppError } from '@/lib/chromia/errors';
import {
  combineDayAndTime,
  recalibrationTripSchema,
  restartAfterRecalibrationSchema,
} from '@/lib/chromia/validation/recalibration-flow';
import { restartProduction, saveTrip, setTripReason } from '@/lib/chromia/server/services/recalibration-flow-service';

export interface RecalibrationFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

function text(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === 'string' ? value : undefined;
}

function toState(error: unknown): RecalibrationFormState {
  if (isAppError(error)) return { error: error.message };
  if (error instanceof Error) return { error: error.message };
  throw error;
}

function refresh() {
  revalidatePath(APP_ROUTES.recalibrations);
  revalidatePath(APP_ROUTES.slabs);
  revalidatePath(APP_ROUTES.dashboard);
}

/** Sent date, and later the received date, on one trip. */
export async function saveTripAction(
  _previousState: RecalibrationFormState,
  formData: FormData,
): Promise<RecalibrationFormState> {
  const parsed = recalibrationTripSchema.safeParse({
    slabId: text(formData, 'slabId'),
    sentDate: text(formData, 'sentDate'),
    receivedDate: text(formData, 'receivedDate'),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    const user = await requireActingUser();
    await saveTrip(
      parsed.data.slabId,
      { sentDate: parsed.data.sentDate, receivedDate: parsed.data.receivedDate },
      user.id,
    );
  } catch (error) {
    return toState(error);
  }

  refresh();
  redirect(APP_ROUTES.recalibrations);
}

/** The register entry that puts a returned slab back on the line. */
export async function restartProductionAction(
  _previousState: RecalibrationFormState,
  formData: FormData,
): Promise<RecalibrationFormState> {
  const parsed = restartAfterRecalibrationSchema.safeParse({
    slabId: text(formData, 'slabId'),
    receivedDate: text(formData, 'receivedDate'),
    batchNo: text(formData, 'batchNo'),
    slabNo: text(formData, 'slabNo'),
    baseMaterial: text(formData, 'baseMaterial'),
    fileName: text(formData, 'fileName'),
    thicknessCm: text(formData, 'thicknessCm'),
    inTime: text(formData, 'inTime'),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    const user = await requireActingUser();
    const { inTime, ...rest } = parsed.data;
    await restartProduction(
      { ...rest, inTime: combineDayAndTime(parsed.data.receivedDate, inTime) },
      user.id,
    );
  } catch (error) {
    return toState(error);
  }

  refresh();
  redirect(APP_ROUTES.recalibrations);
}

// ─────────────────────────────── The unified Recalibration form (27 Oct 2026) ───

export interface RecalibrationSlabFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /** Set once everything asked for is saved — the page returns to the list. */
  savedAt?: number;
  /** Which parts were saved, in order — said back to the user. */
  saved?: string[];
}

/** The slab-detail fields of part B, in the order they are compared. */
const DETAIL_KEYS = ['productionDate', 'batchNo', 'slabNo', 'baseMaterial', 'fileName', 'thicknessCm', 'inTime'] as const;

/** The stage a slab is at, read from its saved trips and QC outcome. */
async function stageNow(slabId: string) {
  const slab = await prisma.chromiaSlab.findFirst({
    where: { id: slabId, deletedAt: null },
    select: {
      slabNo: true,
      status: true,
      currentDisposition: true,
      recalibrations: {
        orderBy: { attemptNumber: 'asc' },
        select: { attemptNumber: true, sentDate: true, receivedDate: true, restartedAt: true },
      },
    },
  });
  if (!slab) return null;
  const state = { disposition: slab.currentDisposition, writtenOff: slab.status === 'WASTE', trips: slab.recalibrations };
  return { slab, state, stage: stageOf(state) };
}

/**
 * The single Update Slab button of the unified form: Send and Receive, Update
 * Slab Details and QC Report, each saved only if something in it was entered
 * or changed — so no part is required, and nothing unrelated is overwritten
 * or cleared. Built on the services that already did each step, in the order
 * the slab lives them:
 *
 *   A. Send and Receive → saveTrip. A Sent Date may be saved alone and the
 *      Received Date later; earlier trips are never touched.
 *   B. Update Slab Details → once the slab is back (Received),
 *      restartProduction: its next pass, a new process cycle, "In Processing —
 *      After Attempt N". At any other stage, the ordinary correction
 *      (updateSlabRecord).
 *   C. QC Report → for a slab on its new pass, the one-transaction QC save
 *      (completeSlabAction — CHR-5/6): A → Stock and B → Stock go to the
 *      Stockyard, B → Sample Cutting to sample cutting, C → Recalibration opens
 *      the next attempt (or writes the slab off after the fifth). Otherwise the
 *      Reason for Recalibration of the current trip (setTripReason) and the
 *      Slab Remarks, on their own.
 *
 * Everything is checked BEFORE anything is written, against the stage the
 * slab will be at when each part runs (receiving it in A makes B a restart;
 * restarting it in B makes C a grade). The same slab record is updated
 * throughout — no slab is ever created here.
 */
export async function updateRecalibrationSlabAction(
  _previous: RecalibrationSlabFormState,
  formData: FormData,
): Promise<RecalibrationSlabFormState> {
  await requireActingUser();
  const get = (key: string) => (text(formData, key) ?? '').trim();
  const slabId = get('slabId');

  const now = slabId ? await stageNow(slabId) : null;
  if (!now) return { error: 'This slab could not be found. Open it again from Recalibration.' };

  const errors: Record<string, string[] | undefined> = {};
  const fail = (key: string, message: string) => {
    errors[key] = [message];
  };

  // ── A: Send and Receive ────────────────────────────────────────────────
  const sent = get('sentDate');
  const received = get('receivedDate');
  const tripChanged = (sent !== get('initialSentDate') || received !== get('initialReceivedDate')) && (sent !== '' || received !== '');
  let trip: { sentDate: Date; receivedDate?: Date } | null = null;
  if (tripChanged) {
    if (now.stage !== 'AWAITING_SEND' && now.stage !== 'OUT') {
      fail('sentDate', 'This slab has no trip waiting or out — its dates are already saved.');
    } else if (!sent) {
      fail('sentDate', 'Enter the Sent Date before the Received Date.');
    } else {
      const parsed = recalibrationTripSchema.safeParse({ slabId, sentDate: sent, receivedDate: received || undefined });
      if (!parsed.success) Object.assign(errors, parsed.error.flatten().fieldErrors);
      else trip = { sentDate: parsed.data.sentDate, receivedDate: parsed.data.receivedDate };
    }
  }
  /** Back in the plant once A has run: already Received, or received now. */
  const back = now.stage === 'RETURNED' || trip?.receivedDate !== undefined;

  // ── C: QC Report ───────────────────────────────────────────────────────
  const grade = get('grade');
  const regrade = grade !== '' && (now.stage === 'IN_PRODUCTION' || back);
  const remarks = get('slabRemarks');
  const remarksChanged = remarks !== get('initialRemarks');
  const reason = get('recalibrationReason');
  const reasonChanged = reason !== get('initialReason');

  // ── B: Update Slab Details ─────────────────────────────────────────────
  const details = Object.fromEntries(DETAIL_KEYS.map((key) => [key, get(key)])) as Record<(typeof DETAIL_KEYS)[number], string>;
  const detailsChanged = DETAIL_KEYS.some((key) => details[key] !== get(`initial_${key}`));
  const restart = back && (detailsChanged || regrade);

  let restartInput: Parameters<typeof restartProduction>[0] | null = null;
  if (restart) {
    const parsed = restartAfterRecalibrationSchema.safeParse({ slabId, ...details, receivedDate: details.productionDate });
    if (!parsed.success) {
      const fe = parsed.error.flatten().fieldErrors as Record<string, string[] | undefined>;
      if (fe.receivedDate) fe.productionDate = fe.receivedDate;
      if (fe.inTime) fe.inTime = ['Enter the In-time of the slab’s new pass.'];
      Object.assign(errors, fe);
    } else {
      const { inTime, ...rest } = parsed.data;
      restartInput = { ...rest, inTime: combineDayAndTime(parsed.data.receivedDate, inTime) };
    }
  }

  let correction: Parameters<typeof updateSlabRecord>[0] | null = null;
  if (!restart && (detailsChanged || (remarksChanged && !regrade))) {
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

  let qc: FormData | null = null;
  if (grade !== '' && !regrade && grade !== get('initialGrade')) {
    fail('grade', 'The QC Report is graded on the slab’s new pass — save its Received Date and its details first.');
  }
  if (regrade) {
    const allowed = GRADE_ALLOWED_DISPOSITIONS[grade as keyof typeof GRADE_ALLOWED_DISPOSITIONS] ?? [];
    const disposition = allowed.length === 1 ? allowed[0] : get('disposition');
    const parsed = intakeQcSchema.safeParse({
      grade,
      disposition: disposition || undefined,
      slabRemarks: remarks || undefined,
      recalibrationReason: reason || undefined,
    });
    if (!parsed.success) Object.assign(errors, parsed.error.flatten().fieldErrors);
    else if (!(allowed as readonly string[]).includes(parsed.data.disposition)) {
      fail('disposition', `Grade ${grade} cannot go to ${DISPOSITION_LABELS[parsed.data.disposition]}`);
    } else {
      qc = new FormData();
      qc.set('slabId', slabId);
      qc.set('grade', parsed.data.grade);
      qc.set('disposition', parsed.data.disposition);
      qc.set('slabRemarks', remarks);
      if (parsed.data.recalibrationReason) qc.set('recalibrationReason', parsed.data.recalibrationReason);
    }
  }

  const reasonOnly = !qc && reasonChanged && !back && (now.stage === 'AWAITING_SEND' || now.stage === 'OUT');

  if (Object.keys(errors).length) return { fieldErrors: errors };
  if (!trip && !restartInput && !correction && !qc && !reasonOnly) {
    return { error: 'Nothing was changed — enter a date, a slab detail or a QC result, then Update Slab.' };
  }

  // ── The writes, in the order the slab lives them ───────────────────────
  const saved: string[] = [];
  const partly = (why: string): RecalibrationSlabFormState => ({
    error: saved.length ? `Saved: ${saved.join(', ')}. Not saved: ${why}` : why,
    saved,
  });

  try {
    const user = await requireActingUser();
    if (trip) {
      await saveTrip(slabId, trip, user.id);
      saved.push(trip.receivedDate ? 'Sent and Received dates' : 'Sent Date');
    }
    if (restartInput) {
      await restartProduction(restartInput, user.id);
      saved.push('slab details (its new pass)');
    }
    if (correction) {
      await updateSlabRecord(correction, user.id);
      saved.push(detailsChanged ? 'slab details' : 'Slab Remarks');
    }
    if (reasonOnly) {
      const reasonId = reason ? await resolveRecalibrationReasonId(reason) : null;
      await setTripReason(slabId, reasonId ?? null, user.id);
      saved.push('Reason for Recalibration');
    }
  } catch (error) {
    refresh();
    if (isAppError(error) || error instanceof Error) return partly((error as Error).message);
    throw error;
  }

  if (qc) {
    const graded = await completeSlabAction({}, qc);
    if (graded.error || graded.fieldErrors) {
      refresh();
      return partly(`the QC Report — ${graded.error ?? Object.values(graded.fieldErrors ?? {}).flat()[0] ?? 'it could not be saved'}`);
    }
    saved.push('QC Report');
  }

  refresh();
  revalidatePath(APP_ROUTES.recalibrationTracking);
  revalidatePath(APP_ROUTES.stockyard);
  revalidatePath(APP_ROUTES.operator);
  return { savedAt: Date.now(), saved };
}
