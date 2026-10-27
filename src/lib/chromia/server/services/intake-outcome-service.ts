import { DISPOSITION_LABELS, GRADE_ALLOWED_DISPOSITIONS } from '@/lib/chromia/constants/process-stages';
import { ChromiaCycleStatus as CycleStatus, ChromiaDisposition as Disposition, ChromiaSlabEventType as SlabEventType, type ChromiaSlabGrade as SlabGrade, ChromiaSlabStatus as SlabStatus } from '@prisma/client';
import { prisma, withTransaction, type ChromiaTx } from '@/lib/chromia/db';
import { BusinessRuleViolationError, NotFoundError } from '@/lib/chromia/errors';
import { createLogger } from '@/lib/chromia/logger';
import { qcCorrectionRefusal } from '@/lib/chromia/qc-correction';
import { claimSlab } from '@/lib/chromia/server/services/disposition-service';
import type { IntakeQcInput } from '@/lib/chromia/validation/slab';

const log = createLogger('intake-qc');

/**
 * The QC decision taken on the intake page.
 *
 * This is the light-weight sibling of `recordQualityCheck`: the in-charge
 * decides a grade and an outcome without filling in the six-point inspection
 * sheet, which is how the paper register works. It writes the GradeDecision so
 * the audit trail is identical either way, then hands over to the disposition
 * services for the outcome-specific record.
 *
 * Recalibration is the one outcome that is NOT completed here — the slab is
 * left graded and awaiting despatch to the facility, and the caller sends the
 * user to the Recalibration page to record the reason and dates.
 *
 * `inTx` is the QC save's transaction (see ChromiaTx in lib/chromia/db.ts —
 * CHR-5 of the code review of 20 Oct 2026): the grade then commits with the
 * rest of the save or not at all.
 */
export async function applyIntakeGrade(
  slabId: string,
  input: IntakeQcInput,
  userId: string,
  inTx?: ChromiaTx,
) {
  const grade = input.grade as SlabGrade;
  const disposition = input.disposition as Disposition;

  const allowed = GRADE_ALLOWED_DISPOSITIONS[grade];
  if (!allowed.includes(disposition)) {
    throw new BusinessRuleViolationError(
      `Grade ${grade} cannot go to ${DISPOSITION_LABELS[disposition]}`,
    );
  }

  const slab = await (inTx ?? prisma).chromiaSlab.findFirst({
    where: { id: slabId, deletedAt: null },
    select: {
      id: true,
      slabNo: true,
      recalibrationCount: true,
      cycles: { orderBy: { cycleNumber: 'desc' }, take: 1, select: { id: true } },
    },
  });

  if (!slab) throw new NotFoundError('Slab');

  const cycleId = slab.cycles[0]?.id;
  if (!cycleId) throw new NotFoundError('Process cycle');

  const now = new Date();
  const isRecalibration = disposition === Disposition.RECALIBRATION;

  await withTransaction(inTx, async (tx) => {
    await tx.chromiaGradeDecision.create({
      data: {
        cycleId,
        slabId: slab.id,
        grade,
        disposition,
        reason: 'Graded at intake',
        remarks: input.slabRemarks ?? null,
        decidedById: userId,
        decidedAt: now,
        attemptNumberAtDecision: slab.recalibrationCount + 1,
      },
    });

    await tx.chromiaProcessCycle.update({
      where: { id: cycleId },
      data: {
        finalGrade: grade,
        disposition,
        // A slab heading for recalibration has not finished its cycle — the
        // recalibration service closes it when the slab is sent out.
        ...(isRecalibration ? {} : { status: CycleStatus.COMPLETED, completedAt: now }),
      },
    });

    await tx.chromiaSlab.update({
      where: { id: slab.id },
      data: {
        status: SlabStatus.GRADED,
        currentGrade: grade,
        currentDisposition: disposition,
        remarks: input.slabRemarks ?? null,
        updatedById: userId,
      },
    });

    await tx.chromiaSlabEvent.create({
      data: {
        slabId: slab.id,
        cycleId,
        eventType: SlabEventType.GRADE_ASSIGNED,
        toStatus: SlabStatus.GRADED,
        userId,
        occurredAt: now,
        note: `Grade ${grade} → ${DISPOSITION_LABELS[disposition]} (decided at intake)`,
      },
    });
  });

  log.info({ slabNo: slab.slabNo, grade, disposition }, 'Intake grade recorded');
}

/**
 * Undo a slab's QC so it can be graded again — the Edit / correction path.
 *
 * Operators are catching up historical production and sometimes put the wrong
 * grade or outcome on a slab. This lets the Edit screen re-open the QC section
 * on an already-decided slab: it clears the current decision — the grade
 * decision and whichever stock, sample-cutting or waste record it produced —
 * and returns the slab to IN_PROCESS on its current cycle, so the ordinary
 * grading path (`applyIntakeGrade` + the disposition services) can decide it
 * afresh, onto the SAME record. No duplicate slab is ever made.
 *
 * History is appended, never erased: the slab's events stay as they were and a
 * CORRECTION event records the reset, so the story still reads true.
 *
 * ── A SLAB THAT HAS LEFT STAYS LEFT (the code review of 20 Oct 2026, CHR-1) ──
 * This used to refuse only a slab in recalibration, then delete EVERY dispatch,
 * stock, sample-cutting and waste row the slab had ever had. So a slab sent
 * from the Dispatch page on 5 Oct, opened on 20 Oct to fix its thickness with
 * the pre-filled A → Dispatch saved unchanged, lost its real dispatch and went
 * back in the queue; a stocked slab later dispatched from the Stockyard went
 * back on the rack; and a slab stocked on cycle 1, sent for recalibration from
 * the rack and stocked again on cycle 2 lost cycle 1's stock history. Now:
 *
 *   • qcCorrectionRefusal (lib/chromia/qc-correction.ts) refuses a slab that
 *     has been dispatched (by status or any dispatch row), written off, is in
 *     recalibration, or was cut for samples after its QC — with a sentence that
 *     says why. The Edit screen asks the same rule, so it does not offer a QC
 *     section the save would refuse.
 *   • What is cleared is only what THIS pass's QC produced: rows written since
 *     the current cycle was opened. A dispatch is never among them — any
 *     dispatch is refused above — so no dispatch row is deleted here at all.
 *
 * ── NOR IS IT PULLED BACK MID-SAVE (CHR-1 and CHR-6; the review of this fix) ─
 * The refusal above reads the slab, and the reset then wrote it back
 * unconditionally. In the few round trips between the two, the Dispatch page
 * could send the same queued slab: its claim (GRADED → DISPATCHED) committed
 * with a dispatch row, then this reset set the slab back to IN_PROCESS and the
 * regrade put it in the Dispatch queue again — a slab that had left, back in
 * the queue with a dispatch row (CHR-1), and a second Send would dispatch it
 * twice (CHR-6). So the slab's row is now claimed FIRST, with claimSlab, from
 * the status and outcome the refusal was decided on, before any stock,
 * sample-cutting or grade row is touched. A dispatch, a stockyard move or a
 * second Edit that got there first leaves the claim matching nothing, and the
 * save stops with "recorded by someone else a moment ago" and nothing changed.
 * One that comes second waits on the row until this save commits and then
 * finds the slab as the correction left it.
 *
 * `inTx` is the QC save's transaction (CHR-5): if the regrade that follows
 * fails, this reset is rolled back with it instead of committing on its own.
 */
export async function resetSlabQcForCorrection(
  slabId: string,
  userId: string,
  inTx?: ChromiaTx,
) {
  const slab = await (inTx ?? prisma).chromiaSlab.findFirst({
    where: { id: slabId, deletedAt: null },
    select: {
      id: true,
      slabNo: true,
      status: true,
      currentGrade: true,
      currentDisposition: true,
      cycles: {
        orderBy: { cycleNumber: 'desc' },
        take: 1,
        select: { id: true, createdAt: true, disposition: true },
      },
      // One row is enough to know the slab has been dispatched.
      dispatches: { select: { id: true }, take: 1 },
    },
  });
  if (!slab) throw new NotFoundError('Slab');

  const cycle = slab.cycles[0] ?? null;

  const refusal = qcCorrectionRefusal({
    slabNo: slab.slabNo,
    status: slab.status,
    currentDisposition: slab.currentDisposition,
    decidedDisposition: cycle?.disposition ?? null,
    hasDispatch: slab.dispatches.length > 0,
  });
  if (refusal) throw new BusinessRuleViolationError(refusal.message);

  // Nothing decided yet: "editing" an ungraded slab's QC is simply grading it,
  // and the ordinary grading path does exactly that. There is nothing to undo.
  if (slab.currentGrade === null && slab.currentDisposition === null) return;

  // Every slab has a cycle from the moment it is entered or imported, and the
  // regrade that follows needs it too (applyIntakeGrade refuses without one).
  // Without it there is no way to tell this pass's records from older ones, so
  // nothing is cleared.
  if (!cycle) throw new NotFoundError('Process cycle');

  const cycleId = cycle.id;
  const priorGrade = slab.currentGrade;
  const priorDisposition = slab.currentDisposition;

  // This pass's records: written since the current cycle was opened. A cycle
  // row is created before anything is recorded against it — at entry, in the
  // import's own transaction, at a restart after recalibration — so the
  // outcome the current QC produced is on or after it, and every earlier
  // cycle's stock holding is before it and stays.
  const thisPass = { slabId: slab.id, createdAt: { gte: cycle.createdAt } };

  await withTransaction(inTx, async (tx) => {
    // Claimed before anything is cleared, from the state the refusal above was
    // decided on — see "nor is it pulled back mid-save" in the note above.
    await claimSlab(tx, slab, {
      status: SlabStatus.IN_PROCESS,
      currentGrade: null,
      currentDisposition: null,
      updatedById: userId,
    });

    await tx.chromiaStockEntry.deleteMany({ where: thisPass });
    await tx.chromiaSampleCutting.deleteMany({ where: thisPass });
    await tx.chromiaWasteRecord.deleteMany({ where: thisPass });

    await tx.chromiaGradeDecision.deleteMany({ where: { cycleId } });
    await tx.chromiaProcessCycle.update({
      where: { id: cycleId },
      data: {
        finalGrade: null,
        disposition: null,
        status: CycleStatus.ACTIVE,
        completedAt: null,
      },
    });

    await tx.chromiaSlabEvent.create({
      data: {
        slabId: slab.id,
        cycleId,
        eventType: SlabEventType.CORRECTION,
        userId,
        note: `QC reset for correction — was Grade ${priorGrade ?? '—'} → ${
          priorDisposition ? DISPOSITION_LABELS[priorDisposition] : '—'
        }`,
      },
    });
  });

  log.info({ slabNo: slab.slabNo }, 'QC reset for correction');
}
