'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { allowedDispositions, DISPOSITION_LABELS } from '@/lib/chromia/constants/process-stages';
import { requireActingUser } from '@/lib/chromia/current-user';
import { isAppError } from '@/lib/chromia/errors';
import { combineDateAndTime } from '@/lib/chromia/operator-register';
import { toPlantDateInput } from '@/lib/chromia/plant-time';
import { DUPLICATE_SLAB_NO_MESSAGE } from '@/lib/chromia/slab-record';
import { TRIM_OTHER, TRIM_PRESETS, toMillimetres, trimError, tripDatesError, type ThicknessUnit } from '@/lib/chromia/trimming';
import { normaliseClockTime, CLOCK_TIME_MESSAGE } from '@/lib/chromia/clock-time';
import { slabRecordEditSchema } from '@/lib/chromia/validation/slab-record';
import { intakeQcSchema } from '@/lib/chromia/validation/slab';
import { loadTrimmingRecord } from '@/lib/chromia/server/repositories/trimming-repository';
import { resolveRecalibrationReasonId } from '@/lib/chromia/server/services/reference-service';
import { updateSlabRecord } from '@/lib/chromia/server/services/slab-record-service';
import {
  addTrimmingWithoutPrinting,
  deleteTrimming,
  gradeTrimming,
  setTrimmingDates,
  setTrimmingRemarks,
  setTrim,
  updateTrimmingDetails,
} from '@/lib/chromia/server/services/trimming-service';

export interface TrimmingFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  savedAt?: number;
  /** Which parts were saved, in order — said back to the user. */
  saved?: string[];
  savedSlabNo?: string;
}

/** Every page a Trimming save can change. */
function refresh() {
  for (const path of [APP_ROUTES.trimming, APP_ROUTES.dashboard, APP_ROUTES.slabs, APP_ROUTES.stockyard, APP_ROUTES.recalibrations, APP_ROUTES.recalibrationTracking, APP_ROUTES.reports, APP_ROUTES.operator]) {
    revalidatePath(path);
  }
}

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
};

/** A cm thickness as typed: '' is none; anything else must be a positive number. */
const thicknessField = z
  .string()
  .trim()
  .refine((v) => v === '' || toMillimetres(v, 'cm') !== null, 'Enter the thickness in cm, e.g. 2 or 1.2');

/* ── Trimming Without Design Printing ──────────────────────────────────── */

const withoutPrintingSchema = z.object({
  batchNo: z.string().trim().min(1, 'Batch number is required').max(60, 'Batch number is too long'),
  slabNo: z.string().trim().min(1, 'Slab number is required').max(60, 'Slab number is too long'),
  baseMaterial: z.string().trim().min(1, 'Select a base material / slab name').max(120, 'Base material is too long'),
  thicknessCm: thicknessField,
});

export async function addTrimmingWithoutPrintingAction(_previous: TrimmingFormState, formData: FormData): Promise<TrimmingFormState> {
  const parsed = withoutPrintingSchema.safeParse({
    batchNo: text(formData, 'batchNo'),
    slabNo: text(formData, 'slabNo'),
    baseMaterial: text(formData, 'baseMaterial'),
    thicknessCm: text(formData, 'thicknessCm'),
  });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  try {
    const user = await requireActingUser();
    await addTrimmingWithoutPrinting({ ...parsed.data, thicknessMm: toMillimetres(parsed.data.thicknessCm, 'cm') }, user.id);
  } catch (error) {
    if (isAppError(error)) {
      if (error.message === DUPLICATE_SLAB_NO_MESSAGE) return { fieldErrors: { slabNo: [error.message] } };
      return { error: error.message };
    }
    throw error;
  }
  refresh();
  return { savedAt: Date.now(), savedSlabNo: parsed.data.slabNo };
}

/* ── One slab's Trimming form: A, B, C and D ───────────────────────────── */

const DETAIL_KEYS = ['productionDate', 'batchNo', 'slabNo', 'baseMaterial', 'fileName', 'thicknessCm', 'inTime'] as const;

/**
 * The single Update Slab button of a slab's Trimming page. Each part is saved
 * only if something in it was entered or changed (compared with the hidden
 * initial_* values), so any one can be saved alone — the Sent Date today, the
 * Received Date next week, From → To whenever — and nothing already saved is
 * touched or cleared. Everything is checked before anything is written; the
 * writes then go in the order the slab lives them: A, B, C, then D.
 *
 *   A  Trimmed From → To: a preset, or Others with From and To typed.
 *   B  Sent Date and Received Date. The first Received Date sets the slab's
 *      thickness to the To value.
 *   C  Update Slab Details: the slab's own record (as Slab Records → Edit);
 *      for a slab without design printing not yet graded, the record's own.
 *   D  QC Report, once the slab is back (Received Date saved or entered now):
 *      A → Stock, B → Stock or Sample Cutting, C → Recalibration.
 */
export async function updateTrimmingSlabAction(_previous: TrimmingFormState, formData: FormData): Promise<TrimmingFormState> {
  await requireActingUser();
  const get = (key: string) => text(formData, key);
  const record = await loadTrimmingRecord(get('id'));
  if (!record) return { error: 'This Trimming record could not be found. Open it again from Trimming.' };

  const errors: Record<string, string[] | undefined> = {};
  const fail = (key: string, message: string) => {
    errors[key] = [message];
  };
  const today = toPlantDateInput(new Date());

  // ── A: Trimmed From → To ─────────────────────────────────────────────
  const choice = get('trimChoice');
  let trim: { fromMm: number; toMm: number } | null = null;
  if (choice) {
    const preset = TRIM_PRESETS.find((p) => p.value === choice);
    const unit = (get('trimUnit') === 'mm' ? 'mm' : 'cm') as ThicknessUnit;
    const fromMm = preset ? preset.fromMm : choice === TRIM_OTHER ? toMillimetres(get('trimFrom'), unit) : null;
    const toMm = preset ? preset.toMm : choice === TRIM_OTHER ? toMillimetres(get('trimTo'), unit) : null;
    const changed = String(fromMm ?? '') !== get('initialTrimFromMm') || String(toMm ?? '') !== get('initialTrimToMm');
    if (changed) {
      const refused = trimError(fromMm, toMm);
      if (refused) fail('trimFrom', refused);
      else trim = { fromMm: fromMm as number, toMm: toMm as number };
    }
  }

  // ── B: Send & Receive ────────────────────────────────────────────────
  const sent = get('sentDate');
  const received = get('receivedDate');
  let dates: { sent: Date | null; received: Date | null } | null = null;
  if (sent !== get('initialSentDate') || received !== get('initialReceivedDate')) {
    const refused = tripDatesError(sent, received, today);
    if (refused) fail(received && !sent ? 'sentDate' : 'receivedDate', refused);
    else dates = { sent: sent ? dayDate(sent) : null, received: received ? dayDate(received) : null };
  }
  const back = Boolean(received) && !errors.receivedDate && !errors.sentDate;

  // ── C: Update Slab Details ───────────────────────────────────────────
  const details = Object.fromEntries(DETAIL_KEYS.map((key) => [key, get(key)])) as Record<(typeof DETAIL_KEYS)[number], string>;
  const detailsChanged = DETAIL_KEYS.some((key) => details[key] !== get(`initial_${key}`));
  const remarks = get('slabRemarks');
  const remarksChanged = remarks !== get('initialRemarks');
  const grade = get('grade');

  let slabCorrection: Parameters<typeof updateSlabRecord>[0] | null = null;
  let ownDetails: Parameters<typeof updateTrimmingDetails>[1] | null = null;
  if (detailsChanged || (remarksChanged && !grade)) {
    if (record.slabId) {
      const parsed = slabRecordEditSchema.safeParse({
        slabId: record.slabId,
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
        else slabCorrection = { ...parsed.data, inTime };
      }
    } else if (detailsChanged) {
      if (!details.batchNo) fail('batchNo', 'Batch number is required');
      if (!details.slabNo) fail('slabNo', 'Slab number is required');
      if (!details.baseMaterial) fail('baseMaterial', 'Select a base material / slab name');
      if (details.productionDate && !/^\d{4}-\d{2}-\d{2}$/.test(details.productionDate)) fail('productionDate', 'Enter a valid date');
      if (details.thicknessCm && toMillimetres(details.thicknessCm, 'cm') === null) fail('thicknessCm', 'Enter the thickness in cm, e.g. 2 or 1.2');
      const inTime = details.inTime ? normaliseClockTime(details.inTime) : '';
      if (details.inTime && !inTime) fail('inTime', CLOCK_TIME_MESSAGE);
      ownDetails = { ...details, inTime: inTime || '', thicknessMm: toMillimetres(details.thicknessCm, 'cm') };
    }
  }

  // ── D: QC Report ─────────────────────────────────────────────────────
  let qc: { grade: 'A' | 'B' | 'C'; disposition: 'STOCK' | 'SAMPLE_CUTTING' | 'RECALIBRATION'; slabRemarks?: string; reason?: string } | null = null;
  if (grade) {
    if (!(back || record.receivedDate)) {
      fail('grade', 'The slab is graded once it is back from trimming — enter its Received Date first.');
    } else if (record.qcGrade) {
      fail('grade', 'Its QC Report after trimming is already saved.');
    } else {
      const allowed = allowedDispositions(grade, { trimming: false });
      const disposition = allowed.length === 1 ? allowed[0] : get('disposition');
      const parsed = intakeQcSchema.safeParse({
        grade,
        disposition: disposition || undefined,
        slabRemarks: remarks || undefined,
        recalibrationReason: get('recalibrationReason') || undefined,
      });
      if (!parsed.success) Object.assign(errors, parsed.error.flatten().fieldErrors);
      else if (!(allowed as readonly string[]).includes(parsed.data.disposition)) {
        fail('disposition', `Grade ${grade} cannot go to ${DISPOSITION_LABELS[parsed.data.disposition]}`);
      } else {
        qc = {
          grade: parsed.data.grade,
          disposition: parsed.data.disposition as 'STOCK' | 'SAMPLE_CUTTING' | 'RECALIBRATION',
          slabRemarks: parsed.data.slabRemarks,
          reason: parsed.data.recalibrationReason,
        };
      }
    }
  }
  const remarksOnly = !qc && !slabCorrection && remarksChanged && !record.slabId;

  if (Object.keys(errors).length) return { fieldErrors: errors };
  if (!trim && !dates && !slabCorrection && !ownDetails && !qc && !remarksOnly) {
    return { error: 'Nothing was changed — enter a From → To, a date, a slab detail or a QC result, then Update Slab.' };
  }

  // ── The writes, in the order the slab lives them ───────────────────────
  const saved: string[] = [];
  try {
    const user = await requireActingUser();
    if (trim) {
      await setTrim(record.id, trim.fromMm, trim.toMm, user.id);
      saved.push('Trimmed From → To');
    }
    if (dates) {
      await setTrimmingDates(record.id, dates.sent, dates.received, user.id);
      saved.push(dates.received ? 'Sent and Received dates' : 'Sent Date');
    }
    if (slabCorrection) {
      await updateSlabRecord(slabCorrection, user.id);
      saved.push(detailsChanged ? 'slab details' : 'Slab Remarks');
    }
    if (ownDetails) {
      await updateTrimmingDetails(record.id, ownDetails, user.id);
      saved.push('slab details');
    }
    if (remarksOnly) {
      await setTrimmingRemarks(record.id, remarks, user.id);
      saved.push('Slab Remarks');
    }
    if (qc) {
      const reasonId = qc.disposition === 'RECALIBRATION' && qc.reason ? await resolveRecalibrationReasonId(qc.reason) : undefined;
      await gradeTrimming(record.id, { grade: qc.grade, disposition: qc.disposition, slabRemarks: qc.slabRemarks, reasonId }, user.id, today);
      saved.push('QC Report');
    }
  } catch (error) {
    refresh();
    if (isAppError(error) || error instanceof Error) {
      const why = (error as Error).message;
      if (why === DUPLICATE_SLAB_NO_MESSAGE) return { fieldErrors: { slabNo: [why] }, saved };
      return { error: saved.length ? `Saved: ${saved.join(', ')}. Not saved: ${why}` : why, saved };
    }
    throw error;
  }

  refresh();
  return { savedAt: Date.now(), saved };
}

/** yyyy-mm-dd → the stored day (midnight, as every typed day is stored). */
function dayDate(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y as number, (m as number) - 1, d as number);
}

/* ── Delete ────────────────────────────────────────────────────────────── */

export async function deleteTrimmingAction(_previous: TrimmingFormState, formData: FormData): Promise<TrimmingFormState> {
  const id = text(formData, 'id');
  if (!id) return { error: 'This record could not be identified. Reload Trimming and try again.' };
  try {
    const user = await requireActingUser();
    const done = await deleteTrimming(id, user.id);
    refresh();
    return { savedAt: Date.now(), saved: [done] };
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }
}
