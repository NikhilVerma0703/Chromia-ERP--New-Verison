import { ChromiaCycleStatus as CycleStatus, ChromiaDisposition as Disposition, ChromiaRecalibrationStatus as RecalibrationStatus, ChromiaSlabEventType as SlabEventType, ChromiaSlabStatus as SlabStatus } from '@prisma/client';
import { prisma, withTransaction, type ChromiaDb, type ChromiaTx } from '@/lib/chromia/db';
import { BusinessRuleViolationError, ConflictError, NotFoundError } from '@/lib/chromia/errors';
import { markSlabsChromia, unmarkSlabsChromia } from '@/lib/chromia/inventory-bridge';
import { createLogger } from '@/lib/chromia/logger';
import { DUPLICATE_SLAB_NO_MESSAGE } from '@/lib/chromia/slab-record';
import { attemptsUsed, isWriteOff, MAX_ATTEMPTS, ordinal } from '@/lib/chromia/recalibration-flow';
import { daysBetween } from '@/lib/chromia/utils/dates';
import type { RestartAfterRecalibrationInput } from '@/lib/chromia/validation/recalibration-flow';
import { resolveBaseMaterialId, resolveDesignId } from '@/lib/chromia/server/services/reference-service';

const log = createLogger('recalibration-flow');

/**
 * The recalibration journey, written the way the plant runs it.
 *
 * The old service treated "graded C" and "sent away" as one event. They are
 * weeks apart: QC condemns the slab, the slab is put down inside the plant,
 * and only when there is a load worth moving does the in-charge send it. Every
 * function here is one of those physical events, and nothing overwrites what
 * came before — each trip is its own row, each pass down the line its own
 * cycle.
 */

/** Trips are read in attempt order everywhere, so the newest is last. */
const TRIP_FIELDS = {
  id: true,
  attemptNumber: true,
  sentDate: true,
  receivedDate: true,
  restartedAt: true,
} as const;

async function loadSlab(slabId: string, db: ChromiaDb = prisma) {
  const slab = await db.chromiaSlab.findFirst({
    where: { id: slabId, deletedAt: null },
    select: {
      id: true,
      slabNo: true,
      status: true,
      currentDisposition: true,
      currentCycleNumber: true,
      currentThicknessMm: true,
      currentLocationId: true,
      plannedDesignId: true,
      recalibrationCount: true,
      recalibrations: { orderBy: { attemptNumber: 'asc' }, select: TRIP_FIELDS },
    },
  });

  if (!slab) throw new NotFoundError('Slab');
  return slab;
}

// ------------------------------------------------- condemned by QC ---

/**
 * QC has failed the slab. It goes nowhere yet.
 *
 * This opens the waiting record — the row that makes the slab appear on the
 * Recalibration page with an attempt count that has deliberately not moved.
 * The reason travels with it, because the in-charge sending a load out next
 * week needs to know why each slab is in it.
 *
 * Called from the QC save. It never touches the grade, the outcome or the
 * cycle: those are QC's, and they are already written by the time we get here
 * — in the same transaction, which the QC save passes as `inTx` (the code
 * review of 20 Oct 2026, CHR-5), so a grade with no waiting record can no
 * longer be committed. The stockyard calls it with none, on its own, as before.
 */
export async function markAwaitingRecalibration(
  slabId: string,
  reasonId: string | undefined,
  userId: string,
  inTx?: ChromiaTx,
) {
  const db = inTx ?? prisma;
  const slab = await loadSlab(slabId, db);
  const used = attemptsUsed(slab.recalibrations);

  // Five trips and condemned again: the slab is finished. The write-off lives
  // here rather than in the QC screen, because QC's job is to judge the slab,
  // not to know how many times it has already been away.
  if (isWriteOff(slab.recalibrations)) {
    await writeOff(slab.id, slab.slabNo, slab.status, userId, inTx);
    return { writtenOff: true as const, attemptsUsed: used };
  }

  const waiting = slab.recalibrations.find((trip) => trip.sentDate === null);

  if (waiting) {
    // Condemned again before the previous waiting record was ever sent —
    // update the reason rather than opening a second row for one wait.
    if (reasonId) {
      await db.chromiaRecalibrationCycle.update({
        where: { id: waiting.id },
        data: { reasonId },
      });
    }
    return { writtenOff: false as const, attemptsUsed: used };
  }

  await openWaitingTrip(slab.id, slab.slabNo, used, reasonId, userId, db);

  return { writtenOff: false as const, attemptsUsed: used };
}

/**
 * The waiting record itself: the attempt it will become once the slab is
 * sent, tied to the pass that failed. Shared by the QC save (above) and by
 * saveTrip's repair of a slab that was left without one.
 */
async function openWaitingTrip(
  slabId: string,
  slabNo: string,
  used: number,
  reasonId: string | undefined,
  userId: string,
  db: ChromiaDb = prisma,
) {
  const failedCycle = await db.chromiaProcessCycle.findFirst({
    where: { slabId },
    orderBy: { cycleNumber: 'desc' },
    select: { id: true },
  });

  const trip = await db.chromiaRecalibrationCycle.create({
    data: {
      slabId,
      // The attempt this record *will* become once the slab is sent.
      attemptNumber: used + 1,
      status: RecalibrationStatus.PENDING_DISPATCH,
      failedCycleId: failedCycle?.id ?? null,
      reasonId: reasonId ?? null,
      createdById: userId,
    },
    select: TRIP_FIELDS,
  });

  log.info({ slabNo, waitingFor: used + 1 }, 'Awaiting recalibration');

  return trip;
}

async function writeOff(
  slabId: string,
  slabNo: string,
  from: SlabStatus,
  userId: string,
  inTx?: ChromiaTx,
) {
  await withTransaction(inTx, async (tx) => {
    await tx.chromiaSlab.update({
      where: { id: slabId },
      data: { status: SlabStatus.WASTE, updatedById: userId },
    });

    await tx.chromiaSlabEvent.create({
      data: {
        slabId,
        eventType: SlabEventType.DECLARED_WASTE,
        fromStatus: from,
        toStatus: SlabStatus.WASTE,
        userId,
        occurredAt: new Date(),
        note: `Written off — failed QC after all ${MAX_ATTEMPTS} recalibration attempts`,
      },
    });
  });

  log.info({ slabNo }, 'Written off after the final recalibration attempt');
}

// --------------------------------------------------------- the trip ---

/**
 * The slab leaves the plant, and later comes back.
 *
 * One screen writes both, because in-charges fill them in on two separate days
 * and there is no sense in two forms. A sent date on its own opens the trip and
 * is the only thing that moves the attempt counter. Adding the received date
 * later closes it.
 */
export async function saveTrip(
  slabId: string,
  input: { sentDate?: Date; receivedDate?: Date },
  userId: string,
) {
  const slab = await loadSlab(slabId);

  const found =
    slab.recalibrations.find((t) => t.sentDate !== null && t.receivedDate === null) ??
    slab.recalibrations.find((t) => t.sentDate === null);

  /*
   * A SLAB CONDEMNED WITH NO WAITING RECORD IS REPAIRED, NOT REFUSED (the code
   * review of 20 Oct 2026, CHR-5). Before the QC save became one transaction,
   * a save could commit the grade (GRADED, outcome Recalibration) and fail
   * before markAwaitingRecalibration opened the waiting record. The
   * Recalibration page lists such a slab as needing its trip — and this
   * refused it, Edit refused it as in recalibration, and a new QC as already
   * graded. The QC save can no longer leave one behind, but any already left
   * stay stuck without this: so a slab that is exactly that — condemned,
   * waiting, no open trip — gets its waiting record here, the one the QC save
   * would have opened, and the trip goes ahead on it. A slab with every
   * attempt used is not repaired — a sixth condemnation is a write-off, QC's
   * call, not a trip — and is refused below exactly as before.
   */
  const repairable =
    !found &&
    slab.status === SlabStatus.GRADED &&
    slab.currentDisposition === Disposition.RECALIBRATION &&
    !isWriteOff(slab.recalibrations);

  const trip = repairable
    ? await openWaitingTrip(slab.id, slab.slabNo, attemptsUsed(slab.recalibrations), undefined, userId)
    : found;

  if (!trip) {
    throw new BusinessRuleViolationError(
      `Slab ${slab.slabNo} is not waiting for recalibration right now`,
    );
  }

  const sentDate = input.sentDate ?? trip.sentDate;
  const receivedDate = input.receivedDate ?? trip.receivedDate;

  if (!sentDate && receivedDate) {
    throw new BusinessRuleViolationError('Enter the sent date before the received date');
  }

  if (!sentDate) {
    throw new BusinessRuleViolationError('Enter the date the slab was sent');
  }

  if (receivedDate && receivedDate < sentDate) {
    throw new BusinessRuleViolationError('The received date cannot be earlier than the sent date');
  }

  const isFirstSend = trip.sentDate === null;

  if (isFirstSend && attemptsUsed(slab.recalibrations) >= MAX_ATTEMPTS) {
    throw new BusinessRuleViolationError(
      `Slab ${slab.slabNo} has used all ${MAX_ATTEMPTS} recalibration attempts`,
    );
  }

  const returning = receivedDate !== null && receivedDate !== undefined;

  await prisma.$transaction(async (tx) => {
    await tx.chromiaRecalibrationCycle.update({
      where: { id: trip.id },
      data: {
        sentDate,
        receivedDate: receivedDate ?? null,
        status: returning ? RecalibrationStatus.RECEIVED : RecalibrationStatus.SENT,
        turnaroundDays: returning ? daysBetween(sentDate, receivedDate) : null,
        issuedById: trip.sentDate === null ? userId : undefined,
        receivedById: returning ? userId : null,
      },
    });

    await tx.chromiaSlab.update({
      where: { id: slab.id },
      data: {
        status: returning
          ? SlabStatus.RECEIVED_FROM_RECALIBRATION
          : SlabStatus.OUT_FOR_RECALIBRATION,
        isRecalibrationOut: !returning,
        // The counter moves here and nowhere else.
        ...(isFirstSend ? { recalibrationCount: trip.attemptNumber } : {}),
        updatedById: userId,
      },
    });

    if (isFirstSend) {
      await tx.chromiaSlabEvent.create({
        data: {
          slabId: slab.id,
          eventType: SlabEventType.RECALIBRATION_SENT,
          fromStatus: slab.status,
          toStatus: SlabStatus.OUT_FOR_RECALIBRATION,
          userId,
          occurredAt: sentDate,
          note: `Sent for recalibration — ${ordinal(trip.attemptNumber)} attempt of ${MAX_ATTEMPTS}`,
        },
      });
    }

    if (returning) {
      await tx.chromiaSlabEvent.create({
        data: {
          slabId: slab.id,
          eventType: SlabEventType.RECALIBRATION_RECEIVED,
          fromStatus: SlabStatus.OUT_FOR_RECALIBRATION,
          toStatus: SlabStatus.RECEIVED_FROM_RECALIBRATION,
          userId,
          occurredAt: receivedDate,
          note: `Received from recalibration — ${daysBetween(sentDate, receivedDate)} days out (${ordinal(
            trip.attemptNumber,
          )} attempt)`,
        },
      });
    }
  });

  log.info(
    { slabNo: slab.slabNo, attempt: trip.attemptNumber, returning },
    'Recalibration trip saved',
  );

  return { attemptNumber: trip.attemptNumber, returning };
}

// ------------------------------------------------ restart production ---

/**
 * The slab starts the whole Chromia process again.
 *
 * A brand-new `ProcessCycle`, exactly as if the operator had entered it on the
 * register — because that is what has happened. The previous cycle keeps its
 * own in-time, out-time, grade and QC record for ever; this is the next one,
 * not a correction of the last.
 *
 * The register fields are editable on the way through: after a trip to the
 * recalibration department the thickness has genuinely changed, and the design
 * is sometimes reassigned.
 */
export async function restartProduction(input: RestartAfterRecalibrationInput, userId: string) {
  const slab = await loadSlab(input.slabId);

  const trip = [...slab.recalibrations]
    .reverse()
    .find((t) => t.receivedDate !== null && t.restartedAt === null);

  if (!trip) {
    throw new BusinessRuleViolationError(
      `Slab ${slab.slabNo} has no completed recalibration trip waiting to restart`,
    );
  }

  if (input.slabNo !== slab.slabNo) {
    const clash = await prisma.chromiaSlab.findUnique({
      where: { slabNo: input.slabNo },
      select: { id: true },
    });
    if (clash && clash.id !== slab.id) {
      throw new ConflictError(DUPLICATE_SLAB_NO_MESSAGE);
    }
  }

  const baseMaterialId = await resolveBaseMaterialId(input.baseMaterial);
  const designId = await resolveDesignId(input.fileName);
  const thicknessMm = input.thicknessCm === undefined ? null : input.thicknessCm * 10;

  const nextCycleNumber = slab.currentCycleNumber + 1;

  await prisma.$transaction(async (tx) => {
    let batch = await tx.chromiaBatch.findUnique({ where: { batchNo: input.batchNo } });

    if (!batch) {
      batch = await tx.chromiaBatch.create({
        data: {
          batchNo: input.batchNo,
          baseMaterialId,
          receivedDate: input.receivedDate,
          createdById: userId,
        },
      });
    }

    // Close the failed pass for good before opening the next one.
    await tx.chromiaProcessCycle.updateMany({
      where: { slabId: slab.id, cycleNumber: slab.currentCycleNumber },
      data: { status: CycleStatus.COMPLETED },
    });

    const cycle = await tx.chromiaProcessCycle.create({
      data: {
        slabId: slab.id,
        cycleNumber: nextCycleNumber,
        designId,
        inTime: input.inTime,
        createdById: userId,
      },
    });

    await tx.chromiaRecalibrationCycle.update({
      where: { id: trip.id },
      data: {
        status: RecalibrationStatus.RESTARTED,
        restartedAt: input.inTime,
        restartedCycleId: cycle.id,
        thicknessAfterMm: thicknessMm ?? undefined,
      },
    });

    await tx.chromiaSlab.update({
      where: { id: slab.id },
      data: {
        slabNo: input.slabNo,
        batchId: batch.id,
        baseMaterialId,
        plannedDesignId: designId,
        ...(thicknessMm === null ? {} : { currentThicknessMm: thicknessMm }),
        receivedDate: input.receivedDate,
        status: SlabStatus.IN_PROCESS,
        currentCycleNumber: nextCycleNumber,
        // The next pass earns its own grade and outcome.
        currentGrade: null,
        currentDisposition: null,
        isRecalibrationOut: false,
        updatedById: userId,
      },
    });

    await tx.chromiaSlabEvent.create({
      data: {
        slabId: slab.id,
        cycleId: cycle.id,
        eventType: SlabEventType.RECALIBRATION_RESTARTED,
        fromStatus: SlabStatus.RECEIVED_FROM_RECALIBRATION,
        toStatus: SlabStatus.IN_PROCESS,
        userId,
        occurredAt: input.inTime,
        note: `Production restarted — cycle ${nextCycleNumber}, after recalibration attempt ${trip.attemptNumber}`,
      },
    });
  });

  // THE MARK FOLLOWS THE RECORD (the code review of 20 Oct 2026, CHR-9). The
  // restart form can correct the slab number (154321 → 154312), and the record
  // above is renamed — but finished goods kept 154321 at CHROMIA and never
  // marked 154312, the slab actually back on the line. The same two calls the
  // Slab Records correction makes (updateSlabRecord): unmark the old number —
  // guarded, it moves only a slab that IS CHROMIA — and mark the new one, which
  // is IN_PROCESS at Chromia from this moment. After the transaction, and the
  // bridge never throws, so neither can fail the restart.
  if (input.slabNo !== slab.slabNo) {
    await unmarkSlabsChromia([slab.slabNo], null);
    await markSlabsChromia([input.slabNo], null);
  }

  log.info(
    { slabNo: input.slabNo, cycle: nextCycleNumber, attempt: trip.attemptNumber },
    'Production restarted after recalibration',
  );

  return { attemptNumber: trip.attemptNumber };
}
