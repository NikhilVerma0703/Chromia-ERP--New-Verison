import { ChromiaDisposition as Disposition, ChromiaSlabEventType as SlabEventType, ChromiaSlabStatus as SlabStatus, ChromiaStockOutcome as StockOutcome } from '@prisma/client';
import { prisma } from '@/lib/chromia/db';
import { BusinessRuleViolationError, NotFoundError } from '@/lib/chromia/errors';
import { createLogger } from '@/lib/chromia/logger';
import { isWriteOff, MAX_ATTEMPTS } from '@/lib/chromia/recalibration-flow';
import type { StockOutcomeInput, StockReleaseInput } from '@/lib/chromia/validation/stockyard';
import { claimSlab, recordDispatch, recordSampleCutting } from '@/lib/chromia/server/services/disposition-service';
import { markAwaitingRecalibration } from '@/lib/chromia/server/services/recalibration-flow-service';

const log = createLogger('stockyard');

/**
 * Stock → Dispatch.
 *
 * A slab that was stocked at QC often leaves the plant days later, and until
 * now there was nowhere to record that. This is that step, and only that step:
 * it refuses anything that is not currently on a rack, then hands over to
 * `recordDispatch`, which already knows how to close the stock holding, write
 * the Dispatch row, move the slab to the dispatch bay and stamp the event.
 *
 * Reusing that function rather than repeating it is the point — a stock release
 * and a QC dispatch land in the database identically, so every report, export
 * and dashboard figure counts them the same way with no changes at all.
 */
export async function releaseFromStock(input: StockReleaseInput, userId: string) {
  const slab = await prisma.chromiaSlab.findFirst({
    where: { id: input.slabId, deletedAt: null },
    select: { id: true, slabNo: true, status: true },
  });

  if (!slab) throw new NotFoundError('Slab');

  if (slab.status !== SlabStatus.IN_STOCK) {
    throw new BusinessRuleViolationError(
      `Slab ${slab.slabNo} is not in stock, so it cannot be dispatched from the stockyard`,
    );
  }

  await recordDispatch({ slabId: slab.id, dispatchDate: input.dispatchDate }, userId, {
    note: 'Dispatched from stock',
  });

  log.info({ slabNo: slab.slabNo, dispatchDate: input.dispatchDate }, 'Released from stock');

  return { id: slab.id, slabNo: slab.slabNo };
}

/**
 * Stock → Recalibration.
 *
 * The other exit from the rack. A stocked slab can be dispatched, or it can be
 * pulled off to go for recalibration — and this is that second path, kept
 * beside `releaseFromStock` and built the same way: refuse anything not on a
 * rack, then hand over to the code that already knows the recalibration
 * journey.
 *
 * `markAwaitingRecalibration` is exactly what QC calls when it condemns a slab,
 * so a stock-sent slab and a QC-condemned one land in the database identically
 * — same waiting record, same attempt bookkeeping, same appearance on the
 * Recalibration page.
 *
 * ── ONE TRANSACTION, CLAIMED FIRST (CHR-6 of the code review of 20 Oct 2026;
 *    the review of its fix) ─────────────────────────────────────────────────
 * This read the slab, opened the waiting record in a commit of its own, and
 * then overwrote the slab's status unconditionally in a second one. Dispatch
 * from stock claims the slab (IN_STOCK → DISPATCHED) since CHR-6, but this,
 * the rack's other exit, did not: one person pressed Dispatch on a stock slab
 * while another pressed Send for recalibration on it, the dispatch committed
 * with its dispatch row, and this then set the slab to GRADED → Recalibration
 * — on the Dispatch sheet and waiting on the Recalibration page at once, with
 * the dashboard counting it as recalibration and the QC correction refusing it.
 * Now the slab's row is claimed FIRST with claimSlab, from the IN_STOCK it was
 * read in, and the waiting record, the stock release and the event follow in
 * the SAME transaction. Whichever exit gets there second matches nothing and
 * stops with "recorded by someone else a moment ago"; a refusal here rolls the
 * waiting record back with it, so there is no half-moved slab to retry.
 *
 * A slab that has already used all its attempts is refused up front, and this
 * is the one place that matters: `markAwaitingRecalibration` would WRITE SUCH A
 * SLAB OFF as waste — that is QC's call to make when it condemns a slab a sixth
 * time, not something the stockyard should do behind a button that says "send
 * for recalibration". So the check happens here, before that call is reached.
 */
export async function sendStockToRecalibration(input: { slabId: string }, userId: string) {
  const slab = await prisma.chromiaSlab.findFirst({
    where: { id: input.slabId, deletedAt: null },
    select: {
      id: true,
      slabNo: true,
      status: true,
      // Read so the claim below moves the slab only from this exact state.
      currentDisposition: true,
      // The whole trip shape the recalibration rules read — isWriteOff counts
      // the sent ones, but its Trip type wants all four fields.
      recalibrations: {
        select: { attemptNumber: true, sentDate: true, receivedDate: true, restartedAt: true },
      },
    },
  });

  if (!slab) throw new NotFoundError('Slab');

  if (slab.status !== SlabStatus.IN_STOCK) {
    throw new BusinessRuleViolationError(
      `Slab ${slab.slabNo} is not in stock, so it cannot be sent for recalibration from the stockyard`,
    );
  }

  if (isWriteOff(slab.recalibrations)) {
    throw new BusinessRuleViolationError(
      `Slab ${slab.slabNo} has used all ${MAX_ATTEMPTS} recalibration attempts and cannot be sent again`,
    );
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    // Off the rack, but only from the IN_STOCK it was read in — a dispatch from
    // stock that got there first leaves this matching nothing (see the note).
    // GRADED with a RECALIBRATION outcome is the exact holding state QC leaves a
    // condemned slab in — see applyIntakeGrade — so the Recalibration page reads
    // it as "awaiting send" with no special-casing.
    await claimSlab(tx, slab, {
      status: SlabStatus.GRADED,
      currentDisposition: Disposition.RECALIBRATION,
      updatedById: userId,
    });

    // Opens the waiting recalibration record — the same call QC makes, in this
    // transaction. The guard above guarantees it takes the create path, never
    // the write-off one; the post-check is belt and braces for a trip that spent
    // the last attempt between the read and here. Throwing rolls everything
    // back — the write-off included — so a slab is never written off behind
    // this button, nor reported back as sent.
    const result = await markAwaitingRecalibration(slab.id, undefined, userId, tx);
    if (result.writtenOff) {
      throw new BusinessRuleViolationError(
        `Slab ${slab.slabNo} has used all ${MAX_ATTEMPTS} recalibration attempts and cannot be sent again`,
      );
    }

    // The slab has left the rack: close its open stock holding so Days in Stock
    // stops and it drops off the "In stock" list.
    await tx.chromiaStockEntry.updateMany({
      where: { slabId: slab.id, releasedAt: null },
      data: { releasedAt: now },
    });

    await tx.chromiaSlabEvent.create({
      data: {
        slabId: slab.id,
        eventType: SlabEventType.STATUS_CHANGED,
        fromStatus: SlabStatus.IN_STOCK,
        toStatus: SlabStatus.GRADED,
        userId,
        occurredAt: now,
        note: 'Marked for recalibration from stock',
      },
    });
  });

  log.info({ slabNo: slab.slabNo }, 'Sent from stock for recalibration');

  return { id: slab.id, slabNo: slab.slabNo };
}

/**
 * Stock Outcome — a stocked slab sent from the Stockyard (27 Oct 2026):
 * Dispatch, Approved or Sample Cutting, on the day it happened.
 *
 * Every outcome takes the slab OFF the rack for good: its status leaves
 * IN_STOCK (so the In Stock table, which lists IN_STOCK, no longer shows it)
 * and its open stock entry is closed with that date and the outcome. Each
 * write claims the slab against the status it was read with (CHR-6), so two
 * tablets sending the same slab cannot both succeed.
 *
 *   Dispatch       → recordDispatch, exactly as "Dispatched from stock" always
 *                    was: a chromia_dispatch row, status DISPATCHED.
 *   Sample Cutting → recordSampleCutting, which already accepts a slab from
 *                    stock: a chromia_sample_cutting row, status SAMPLE_CUT.
 *   Approved       → status APPROVED, here. It has no record of its own yet;
 *                    the closed stock entry (outcome APPROVED, released_at the
 *                    date) and the slab event are its record until the Approved
 *                    section is built.
 *
 * Nothing is deleted: the slab, its stock entry and its history stay, so the
 * slab's whole journey remains traceable.
 */
export async function sendFromStock(input: StockOutcomeInput, userId: string) {
  const slab = await prisma.chromiaSlab.findFirst({
    where: { id: input.slabId, deletedAt: null },
    select: { id: true, slabNo: true, status: true, currentDisposition: true },
  });

  if (!slab) throw new NotFoundError('Slab');

  if (slab.status !== SlabStatus.IN_STOCK) {
    throw new BusinessRuleViolationError(`Slab ${slab.slabNo} is not in stock any more, so it cannot be sent from the stockyard`);
  }

  switch (input.outcome) {
    case 'DISPATCH':
      await recordDispatch({ slabId: slab.id, dispatchDate: input.date }, userId, {
        note: 'Dispatched from stock',
      });
      break;

    case 'SAMPLE_CUTTING':
      await recordSampleCutting({ slabId: slab.id, cutDate: input.date }, userId);
      break;

    case 'APPROVED':
      await prisma.$transaction(async (tx) => {
        await claimSlab(tx, slab, { status: SlabStatus.APPROVED, updatedById: userId });

        await tx.chromiaStockEntry.updateMany({
          where: { slabId: slab.id, releasedAt: null },
          data: { releasedAt: input.date, releaseOutcome: StockOutcome.APPROVED },
        });

        await tx.chromiaSlabEvent.create({
          data: {
            slabId: slab.id,
            eventType: SlabEventType.STATUS_CHANGED,
            fromStatus: SlabStatus.IN_STOCK,
            toStatus: SlabStatus.APPROVED,
            userId,
            occurredAt: input.date,
            note: 'Approved from stock',
          },
        });
      });
      break;
  }

  log.info({ slabNo: slab.slabNo, outcome: input.outcome, date: input.date }, 'Sent from stock');

  return { id: slab.id, slabNo: slab.slabNo };
}
