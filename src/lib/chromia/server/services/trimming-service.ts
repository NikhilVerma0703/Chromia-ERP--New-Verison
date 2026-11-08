import {
  ChromiaCycleStatus as CycleStatus,
  ChromiaDisposition as Disposition,
  ChromiaSlabEventType as SlabEventType,
  ChromiaSlabStatus as SlabStatus,
  ChromiaTrimmingSource as TrimmingSource,
  type ChromiaSlabGrade as SlabGrade,
} from '@prisma/client';

import { allowedDispositions, DISPOSITION_LABELS } from '@/lib/chromia/constants/process-stages';
import { prisma, type ChromiaTx } from '@/lib/chromia/db';
import { BusinessRuleViolationError, ConflictError, NotFoundError, ValidationError } from '@/lib/chromia/errors';
import { markSlabsChromia } from '@/lib/chromia/inventory-bridge';
import { createLogger } from '@/lib/chromia/logger';
import { combineDateAndTime, registerDay } from '@/lib/chromia/operator-register';
import { formatTrim, trimError } from '@/lib/chromia/trimming';
import { DUPLICATE_SLAB_NO_MESSAGE } from '@/lib/chromia/slab-record';
import { claimSlab, recordSampleCutting, recordStock } from '@/lib/chromia/server/services/disposition-service';
import { applyIntakeGrade } from '@/lib/chromia/server/services/intake-outcome-service';
import { markAwaitingRecalibration } from '@/lib/chromia/server/services/recalibration-flow-service';
import { resolveBaseMaterialId, resolveDesignId } from '@/lib/chromia/server/services/reference-service';
import { completeSlabIntake } from '@/lib/chromia/server/services/slab-intake-service';

const log = createLogger('trimming');

/** The QC save's room (as Slab Entry's): a dozen statements in one transaction. */
const TRIM_QC_TX = { maxWait: 10_000, timeout: 20_000 } as const;

const numOrNull = (value: unknown) => (value === null || value === undefined ? null : Number(value));

/* ── Trimming without design printing ──────────────────────────────────── */

export interface WithoutPrintingInput {
  batchNo: string;
  slabNo: string;
  baseMaterial: string;
  thicknessMm: number | null;
}

/** Is this slab number already a Chromia slab, or a Trimming record of its own? */
async function slabNoInUse(slabNo: string, exceptRecordId?: string): Promise<boolean> {
  const [slab, record] = await Promise.all([
    prisma.chromiaSlab.findUnique({ where: { slabNo }, select: { id: true } }),
    prisma.chromiaTrimming.findFirst({ where: { slabNo, ...(exceptRecordId ? { NOT: { id: exceptRecordId } } : {}) }, select: { id: true } }),
  ]);
  return Boolean(slab || record);
}

/**
 * A slab trimmed without going on the line or having a design printed. It is
 * a Trimming record only — not a Chromia slab, so it is in no production
 * count — until its QC Report is saved (gradeTrimming).
 */
export async function addTrimmingWithoutPrinting(input: WithoutPrintingInput, userId: string) {
  if (await slabNoInUse(input.slabNo)) throw new ConflictError(DUPLICATE_SLAB_NO_MESSAGE);
  const record = await prisma.chromiaTrimming.create({
    data: {
      source: TrimmingSource.WITHOUT_PRINTING,
      slabNo: input.slabNo,
      batchNo: input.batchNo,
      baseMaterial: input.baseMaterial,
      thicknessMm: input.thicknessMm,
      createdById: userId,
      updatedById: userId,
    },
  });
  log.info({ slabNo: input.slabNo }, 'Trimming without design printing added');
  return record;
}

/* ── A. Trimmed From → To ──────────────────────────────────────────────── */

export async function setTrim(id: string, fromMm: number, toMm: number, userId: string) {
  const refused = trimError(fromMm, toMm);
  if (refused) throw new ValidationError(refused);
  const record = await prisma.chromiaTrimming.update({ where: { id }, data: { trimFromMm: fromMm, trimToMm: toMm, updatedById: userId } });
  if (record.slabId) {
    await prisma.chromiaSlabEvent.create({
      data: { slabId: record.slabId, eventType: SlabEventType.CORRECTION, userId, note: `Trimming: ${formatTrim(fromMm, toMm)}` },
    });
  }
}

/* ── B. Send & Receive ─────────────────────────────────────────────────── */

/**
 * The Sent and Received dates. On the first save of a Received Date with a
 * From → To set, the slab's thickness becomes the To value (the owner's
 * choice, 7 Nov 2026) — the slab's own current thickness, or the record's for
 * a slab without design printing; the original stays in the From value and in
 * the slab's history.
 */
export async function setTrimmingDates(id: string, sent: Date | null, received: Date | null, userId: string) {
  const record = await prisma.chromiaTrimming.findUniqueOrThrow({ where: { id } });
  const receivedNow = received !== null && record.receivedDate === null;
  const toMm = numOrNull(record.trimToMm);
  await prisma.$transaction(async (tx) => {
    await tx.chromiaTrimming.update({
      where: { id },
      data: {
        sentDate: sent,
        receivedDate: received,
        ...(receivedNow && toMm !== null && !record.slabId ? { thicknessMm: toMm } : {}),
        updatedById: userId,
      },
    });
    if (!record.slabId) return;
    const slab = await tx.chromiaSlab.findUniqueOrThrow({ where: { id: record.slabId }, select: { currentThicknessMm: true } });
    if (receivedNow && toMm !== null) {
      await tx.chromiaSlab.update({ where: { id: record.slabId }, data: { currentThicknessMm: toMm, updatedById: userId } });
    }
    const said = [
      sent && !record.sentDate ? 'sent for trimming' : '',
      receivedNow ? 'received from trimming' : '',
      receivedNow && toMm !== null ? `thickness ${numOrNull(slab.currentThicknessMm) ?? '—'} mm → ${toMm} mm` : '',
    ].filter(Boolean);
    await tx.chromiaSlabEvent.create({
      data: {
        slabId: record.slabId,
        eventType: SlabEventType.CORRECTION,
        userId,
        note: `Trimming: ${said.length ? said.join('; ') : 'Sent / Received dates corrected'}`,
      },
    });
  });
}

/* ── C. Update Slab Details (a slab without design printing, not yet graded) ── */

export interface TrimmingDetailsInput {
  productionDate: string;
  batchNo: string;
  slabNo: string;
  baseMaterial: string;
  fileName: string;
  thicknessMm: number | null;
  inTime: string;
}

/** The record's own details — for a slab without design printing, until it is graded. */
export async function updateTrimmingDetails(id: string, input: TrimmingDetailsInput, userId: string) {
  if (await slabNoInUse(input.slabNo, id)) throw new ConflictError(DUPLICATE_SLAB_NO_MESSAGE);
  const productionDate = input.productionDate ? registerDay(input.productionDate) : null;
  if (input.productionDate && !productionDate) throw new ValidationError('Enter a valid production date');
  await prisma.chromiaTrimming.update({
    where: { id },
    data: {
      productionDate,
      batchNo: input.batchNo,
      slabNo: input.slabNo,
      baseMaterial: input.baseMaterial,
      fileName: input.fileName || null,
      thicknessMm: input.thicknessMm,
      inTime: input.inTime || null,
      updatedById: userId,
    },
  });
}

/** The Slab Remarks of a slab without design printing, until it is graded. */
export async function setTrimmingRemarks(id: string, remarks: string, userId: string) {
  await prisma.chromiaTrimming.update({ where: { id }, data: { remarks: remarks || null, updatedById: userId } });
}

/* ── D. QC Report after trimming ───────────────────────────────────────── */

export interface TrimmingQcInput {
  grade: SlabGrade;
  disposition: Disposition;
  slabRemarks?: string;
  /** Already resolved to a reason record, for C → Recalibration. */
  reasonId?: string;
}

/**
 * The slab is graded again after trimming, and goes where the grade sends it
 * (the owner's choice, 7 Nov 2026) — exactly as the Recalibration page grades
 * a slab back from its trip: A → Stock, B → Stock or Sample Cutting,
 * C → Recalibration. The Trimming record keeps the grade and the outcome, so
 * its row reads "Trimmed — Grade A: Stock" wherever the slab goes after.
 *
 *   PRODUCTION        the slab's next pass is opened (a new process cycle,
 *                     as a restart after recalibration does) and graded on it
 *                     — every earlier grade stays in its history.
 *   WITHOUT_PRINTING  the record becomes a Chromia slab here (the owner's
 *                     choice): a slab is created from its details on its
 *                     production date (today, when none was entered), and
 *                     graded. From then on it counts as produced.
 *
 * One transaction (as the QC save's, CHR-5): the pass, the grade, the outcome
 * record and the Trimming record land together, or nothing does.
 */
export async function gradeTrimming(id: string, qc: TrimmingQcInput, userId: string, today: string) {
  const allowed = allowedDispositions(qc.grade, { trimming: false });
  if (!allowed.includes(qc.disposition)) {
    throw new BusinessRuleViolationError(`Grade ${qc.grade} cannot go to ${DISPOSITION_LABELS[qc.disposition]}`);
  }

  const record = await prisma.chromiaTrimming.findUniqueOrThrow({ where: { id } });
  if (record.qcAt) throw new BusinessRuleViolationError('This slab’s QC Report after trimming is already saved.');
  if (!record.receivedDate) throw new BusinessRuleViolationError('Save the Received Date first — the slab is graded once it is back from trimming.');

  // Master data, outside the transaction (as Slab Entry resolves it).
  let created: { baseMaterialId: string; designId: string | null; receivedDate: Date; inTime: Date | null } | null = null;
  if (!record.slabId) {
    const slabNo = record.slabNo ?? '';
    if (await prisma.chromiaSlab.findUnique({ where: { slabNo }, select: { id: true } })) throw new ConflictError(DUPLICATE_SLAB_NO_MESSAGE);
    const day = record.productionDate ? toDay(record.productionDate) : today;
    const receivedDate = registerDay(day);
    if (!receivedDate) throw new ValidationError('Enter a valid production date');
    created = {
      baseMaterialId: await resolveBaseMaterialId(record.baseMaterial ?? ''),
      designId: record.fileName ? await resolveDesignId(record.fileName) : null,
      receivedDate,
      inTime: record.inTime ? combineDateAndTime(day, record.inTime) : null,
    };
  }

  const slabId = await prisma.$transaction(async (tx) => {
    const target = record.slabId
      ? await openPassAfterTrimming(tx, record.slabId, userId)
      : await createSlabFromTrimming(tx, record, created!, userId);

    await completeSlabIntake(target, userId, tx);
    await applyIntakeGrade(target, { grade: qc.grade, disposition: qc.disposition, slabRemarks: qc.slabRemarks }, userId, tx);
    if (qc.disposition === Disposition.STOCK) await recordStock({ slabId: target }, userId, tx);
    if (qc.disposition === Disposition.SAMPLE_CUTTING) await recordSampleCutting({ slabId: target }, userId, tx);
    if (qc.disposition === Disposition.RECALIBRATION) await markAwaitingRecalibration(target, qc.reasonId, userId, tx);

    await tx.chromiaTrimming.update({
      where: { id },
      data: { slabId: target, qcGrade: qc.grade, qcDisposition: qc.disposition, qcAt: new Date(), updatedById: userId },
    });
    return target;
  }, TRIM_QC_TX);

  if (!record.slabId) await markSlabsChromia([record.slabNo], null);
  log.info({ id, slabId, grade: qc.grade, disposition: qc.disposition }, 'Graded after trimming');
}

const toDay = (date: Date) => date.toISOString().slice(0, 10);

/** The slab's next pass, after trimming: claimed from Trimming, a new cycle, back In-Processing. */
async function openPassAfterTrimming(tx: ChromiaTx, slabId: string, userId: string): Promise<string> {
  const slab = await tx.chromiaSlab.findFirst({
    where: { id: slabId, deletedAt: null },
    select: { id: true, slabNo: true, status: true, currentDisposition: true, currentCycleNumber: true, plannedDesignId: true },
  });
  if (!slab) throw new NotFoundError('Slab');
  if (slab.status !== SlabStatus.GRADED || slab.currentDisposition !== Disposition.TRIMMING) {
    throw new BusinessRuleViolationError(`Slab ${slab.slabNo} is not in Trimming any more — it was graded elsewhere. Reload the page.`);
  }
  const next = slab.currentCycleNumber + 1;
  await claimSlab(tx, slab, {
    status: SlabStatus.IN_PROCESS,
    currentGrade: null,
    currentDisposition: null,
    currentCycleNumber: next,
    updatedById: userId,
  });
  await tx.chromiaProcessCycle.updateMany({
    where: { slabId: slab.id, cycleNumber: slab.currentCycleNumber },
    data: { status: CycleStatus.COMPLETED },
  });
  const cycle = await tx.chromiaProcessCycle.create({
    data: { slabId: slab.id, cycleNumber: next, designId: slab.plannedDesignId, createdById: userId },
  });
  await tx.chromiaSlabEvent.create({
    data: {
      slabId: slab.id,
      cycleId: cycle.id,
      eventType: SlabEventType.CYCLE_STARTED,
      fromStatus: SlabStatus.GRADED,
      toStatus: SlabStatus.IN_PROCESS,
      userId,
      note: `Back from trimming — QC on cycle ${next}`,
    },
  });
  return slab.id;
}

/** A slab without design printing becomes a Chromia slab, on its first QC Report. */
async function createSlabFromTrimming(
  tx: ChromiaTx,
  record: { id: string; slabNo: string | null; batchNo: string | null; thicknessMm: unknown; remarks: string | null },
  resolved: { baseMaterialId: string; designId: string | null; receivedDate: Date; inTime: Date | null },
  userId: string,
): Promise<string> {
  const batchNo = record.batchNo ?? '';
  const batch =
    (await tx.chromiaBatch.findUnique({ where: { batchNo } })) ??
    (await tx.chromiaBatch.create({ data: { batchNo, baseMaterialId: resolved.baseMaterialId, receivedDate: resolved.receivedDate, createdById: userId } }));
  const thicknessMm = numOrNull(record.thicknessMm);
  const slab = await tx.chromiaSlab.create({
    data: {
      slabNo: record.slabNo ?? '',
      batchId: batch.id,
      baseMaterialId: resolved.baseMaterialId,
      plannedDesignId: resolved.designId,
      originalThicknessMm: thicknessMm,
      currentThicknessMm: thicknessMm,
      status: SlabStatus.IN_PROCESS,
      currentCycleNumber: 1,
      receivedDate: resolved.receivedDate,
      remarks: record.remarks,
      createdById: userId,
      updatedById: userId,
    },
  });
  await tx.chromiaBatch.update({ where: { id: batch.id }, data: { totalSlabs: { increment: 1 } } });
  const cycle = await tx.chromiaProcessCycle.create({
    data: { slabId: slab.id, cycleNumber: 1, designId: resolved.designId, inTime: resolved.inTime, createdById: userId },
  });
  await tx.chromiaSlabEvent.create({
    data: {
      slabId: slab.id,
      cycleId: cycle.id,
      eventType: SlabEventType.SLAB_CREATED,
      toStatus: SlabStatus.IN_PROCESS,
      userId,
      occurredAt: resolved.inTime ?? resolved.receivedDate,
      note: `Trimming without design printing — slab ${slab.slabNo} recorded at its QC Report (batch ${batch.batchNo})`,
    },
  });
  return slab.id;
}

/* ── Delete ────────────────────────────────────────────────────────────── */

/**
 * The Action column's Delete (the owner's choice, 7 Nov 2026):
 *   a slab without design printing, not graded yet → the record is deleted;
 *   any other → only its trimming details (From → To, Sent, Received, and the
 *   QC Report's record) are cleared. The slab itself, its grade and wherever
 *   it went stay as they are; a production slab still in Trimming reads Ready
 *   for Trimming again. The slab's history keeps what was cleared.
 */
export async function deleteTrimming(id: string, userId: string): Promise<'deleted' | 'cleared'> {
  const record = await prisma.chromiaTrimming.findUnique({ where: { id } });
  if (!record) throw new NotFoundError('Trimming record');
  if (!record.slabId) {
    await prisma.chromiaTrimming.delete({ where: { id } });
    log.warn({ slabNo: record.slabNo }, 'Trimming without design printing deleted');
    return 'deleted';
  }
  await prisma.$transaction(async (tx) => {
    await tx.chromiaTrimming.update({
      where: { id },
      data: { trimFromMm: null, trimToMm: null, sentDate: null, receivedDate: null, qcGrade: null, qcDisposition: null, qcAt: null, updatedById: userId },
    });
    await tx.chromiaSlabEvent.create({
      data: {
        slabId: record.slabId as string,
        eventType: SlabEventType.CORRECTION,
        userId,
        note: `Trimming details cleared — were ${formatTrim(numOrNull(record.trimFromMm), numOrNull(record.trimToMm)) || 'no From → To'}, sent ${record.sentDate ? toDay(record.sentDate) : '—'}, received ${record.receivedDate ? toDay(record.receivedDate) : '—'}${record.qcGrade ? `, QC Grade ${record.qcGrade}` : ''}`,
      },
    });
  });
  log.info({ id }, 'Trimming details cleared');
  return 'cleared';
}
