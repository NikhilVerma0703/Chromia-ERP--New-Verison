import { ChromiaSlabEventType as SlabEventType, ChromiaSlabStatus as SlabStatus } from '@prisma/client';
import { prisma, withTransaction, type ChromiaTx } from '@/lib/chromia/db';
import { ConflictError, NotFoundError } from '@/lib/chromia/errors';
import { createLogger } from '@/lib/chromia/logger';
import { needsIntakeQc } from '@/lib/chromia/slab-links';

const log = createLogger('slab-intake');

/**
 * Finish a slab that is already on the line.
 *
 * The operator enters the slab's identity and an in-time on the register. The
 * in-charge later opens that slab in the register and grades it. That is this
 * function: it stamps the out-time and hands the slab to `applyIntakeGrade` for
 * the QC decision.
 *
 * The out-time is the moment the QC section is saved — that is when the
 * in-charge confirms the slab is off the line. A slab that already carries an
 * out-time keeps it.
 *
 * It used to also record a "fully printed date" typed on a separate page. That
 * page is gone and so is the field — see the note in validation/slab.ts. The
 * column is still filled by the register importer, which has it per slab.
 *
 * `inTx` is the QC save's transaction (CHR-5 of the code review of 20 Oct
 * 2026): the out-time and UNDER_INSPECTION land with the grade, or not at all.
 */
export async function completeSlabIntake(slabId: string, userId: string, inTx?: ChromiaTx) {
  const slab = await (inTx ?? prisma).chromiaSlab.findFirst({
    where: { id: slabId, deletedAt: null },
    select: {
      id: true,
      slabNo: true,
      status: true,
      cycles: {
        orderBy: { cycleNumber: 'desc' },
        take: 1,
        select: { id: true, inTime: true, outTime: true },
      },
    },
  });

  if (!slab) throw new NotFoundError('Slab');

  if (!needsIntakeQc(slab.status)) {
    throw new ConflictError(`Slab "${slab.slabNo}" has already been graded`);
  }

  const cycle = slab.cycles[0];
  if (!cycle) throw new NotFoundError('Process cycle');

  const now = new Date();
  const outTime = cycle.outTime ?? now;
  const inTime = cycle.inTime;

  await withTransaction(inTx, async (tx) => {
    // Only from the status just read. Two Saves of one slab — a double tap,
    // two devices — both read it ungraded; the second waits on this row, then
    // finds it moved on and stops here with a sentence, instead of running on
    // into the grade decision's unique key and failing with a database error.
    const claimed = await tx.chromiaSlab.updateMany({
      where: { id: slab.id, status: slab.status, deletedAt: null },
      data: { status: SlabStatus.UNDER_INSPECTION, updatedById: userId },
    });
    if (claimed.count === 0) {
      throw new ConflictError(`Slab "${slab.slabNo}" has already been graded`);
    }

    await tx.chromiaProcessCycle.update({
      where: { id: cycle.id },
      data: {
        outTime,
        processingMinutes:
          inTime && outTime > inTime
            ? Math.round((outTime.getTime() - inTime.getTime()) / 60_000)
            : null,
      },
    });

    await tx.chromiaSlabEvent.create({
      data: {
        slabId: slab.id,
        cycleId: cycle.id,
        eventType: SlabEventType.CYCLE_COMPLETED,
        toStatus: SlabStatus.UNDER_INSPECTION,
        userId,
        occurredAt: now,
        note: `Slab ${slab.slabNo} came off the line`,
      },
    });
  });

  log.info({ slabId: slab.id, slabNo: slab.slabNo }, 'Slab intake completed');

  return { id: slab.id };
}
