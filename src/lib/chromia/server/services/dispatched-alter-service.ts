import {
  ChromiaDisposition as Disposition,
  ChromiaMovementReason as MovementReason,
  ChromiaSlabEventType as SlabEventType,
  ChromiaSlabStatus as SlabStatus,
} from '@prisma/client';
import { prisma } from '@/lib/chromia/db';
import { ALTER_DESTINATION_LABELS, ALTER_DESTINATIONS, type AlterDestination } from '@/lib/chromia/constants/alter-destinations';
import { BusinessRuleViolationError, NotFoundError } from '@/lib/chromia/errors';
import { createLogger } from '@/lib/chromia/logger';
import { formatPlantDay, toPlantDateInput } from '@/lib/chromia/plant-time';
import { isWriteOff, MAX_ATTEMPTS } from '@/lib/chromia/recalibration-flow';
import { claimSlab } from '@/lib/chromia/server/services/disposition-service';
import { markAwaitingRecalibration } from '@/lib/chromia/server/services/recalibration-flow-service';

const log = createLogger('dispatched-alter');


/**
 * Alter From Dispatched (change 12, 8 Nov 2026): a dispatched slab comes back
 * — onto the rack, or to Recalibration — on the day chosen.
 *
 * ONE MOVE, ONE TRANSACTION. The slab is claimed from DISPATCHED (CHR-6), so
 * two people moving the same slab cannot both succeed and nothing is
 * duplicated. Its dispatch record is removed, so it leaves the Dispatched
 * table and every dispatched count (which read dispatch records), exactly as
 * the Stockyard's own correction of a dispatch does (correctStockOutcome).
 *
 *   In Stock       status IN_STOCK, outcome Stock, a new stock entry dated
 *                  the day chosen on the stock rack — the In Stock Records
 *                  table, Current Stock and Days in Stock all read it;
 *   Recalibration  status GRADED, outcome Recalibration, and the waiting
 *                  recalibration record QC and the Stockyard open
 *                  (markAwaitingRecalibration): Ready for Recalibration.
 *                  A slab that has used every attempt is refused, never
 *                  written off behind this button.
 *
 * TRACEABILITY. The slab keeps its identity, production details, QC, earlier
 * stock entries and history; the event written here says where it went, on
 * which day, and the dispatch date it came back from.
 *
 * The date cannot be in the future, nor before the slab was dispatched.
 */
export async function alterFromDispatched(
  input: { slabId: string; destination: AlterDestination; date: Date },
  userId: string,
) {
  const slab = await prisma.chromiaSlab.findFirst({
    where: { id: input.slabId, deletedAt: null },
    select: {
      id: true,
      slabNo: true,
      status: true,
      currentDisposition: true,
      currentLocationId: true,
      dispatches: { orderBy: [{ dispatchDate: 'desc' }, { createdAt: 'desc' }], select: { id: true, dispatchDate: true } },
      recalibrations: { select: { attemptNumber: true, sentDate: true, receivedDate: true, restartedAt: true } },
    },
  });
  if (!slab) throw new NotFoundError('Slab');

  if (slab.status !== SlabStatus.DISPATCHED) {
    throw new BusinessRuleViolationError(`Slab ${slab.slabNo} is not dispatched any more, so it cannot be moved from Dispatched`);
  }
  if (!ALTER_DESTINATIONS.includes(input.destination)) {
    throw new BusinessRuleViolationError('Choose In Stock or Recalibration');
  }

  const on = toPlantDateInput(input.date);
  const dispatchedOn = slab.dispatches[0] ? toPlantDateInput(slab.dispatches[0].dispatchDate) : null;
  if (on > toPlantDateInput(new Date())) throw new BusinessRuleViolationError('The date cannot be in the future');
  if (dispatchedOn && on < dispatchedOn) {
    throw new BusinessRuleViolationError(`The date cannot be before slab ${slab.slabNo} was dispatched (${formatPlantDay(dispatchedOn)})`);
  }
  if (input.destination === 'RECALIBRATION' && isWriteOff(slab.recalibrations)) {
    throw new BusinessRuleViolationError(
      `Slab ${slab.slabNo} has used all ${MAX_ATTEMPTS} recalibration attempts and cannot be sent again`,
    );
  }

  const label = ALTER_DESTINATION_LABELS[input.destination];
  const from = dispatchedOn ? ` (dispatched ${formatPlantDay(dispatchedOn)})` : '';

  await prisma.$transaction(async (tx) => {
    if (input.destination === 'IN_STOCK') {
      const rack = await tx.chromiaLocation.findFirst({ where: { type: 'STOCK_RACK', isActive: true }, select: { id: true } });
      const locationId = rack?.id ?? slab.currentLocationId ?? null;

      await claimSlab(tx, slab, {
        status: SlabStatus.IN_STOCK,
        currentDisposition: Disposition.STOCK,
        currentLocationId: locationId,
        updatedById: userId,
      });
      await tx.chromiaDispatch.deleteMany({ where: { slabId: slab.id } });
      await tx.chromiaStockEntry.create({
        data: { slabId: slab.id, stockDate: input.date, locationId, notes: 'Altered from Dispatched', createdById: userId },
      });
      await tx.chromiaSlabEvent.create({
        data: {
          slabId: slab.id,
          eventType: SlabEventType.STOCKED,
          fromStatus: SlabStatus.DISPATCHED,
          toStatus: SlabStatus.IN_STOCK,
          locationId,
          userId,
          occurredAt: input.date,
          note: `Altered from Dispatched${from} to In Stock`,
        },
      });
      if (locationId && locationId !== slab.currentLocationId) {
        await tx.chromiaSlabMovement.create({
          data: {
            slabId: slab.id,
            fromLocationId: slab.currentLocationId,
            toLocationId: locationId,
            reason: MovementReason.STOCK_PUTAWAY,
            movedById: userId,
            movedAt: input.date,
          },
        });
      }
    } else {
      // GRADED → Recalibration is the holding state QC leaves a condemned
      // slab in, so the Recalibration page reads it as Ready with no
      // special case (as sendStockToRecalibration does).
      await claimSlab(tx, slab, {
        status: SlabStatus.GRADED,
        currentDisposition: Disposition.RECALIBRATION,
        updatedById: userId,
      });
      await tx.chromiaDispatch.deleteMany({ where: { slabId: slab.id } });
      const result = await markAwaitingRecalibration(slab.id, undefined, userId, tx);
      if (result.writtenOff) {
        throw new BusinessRuleViolationError(
          `Slab ${slab.slabNo} has used all ${MAX_ATTEMPTS} recalibration attempts and cannot be sent again`,
        );
      }
      await tx.chromiaSlabEvent.create({
        data: {
          slabId: slab.id,
          eventType: SlabEventType.STATUS_CHANGED,
          fromStatus: SlabStatus.DISPATCHED,
          toStatus: SlabStatus.GRADED,
          userId,
          occurredAt: input.date,
          note: `Altered from Dispatched${from} to Recalibration`,
        },
      });
    }
  });

  log.info({ slabNo: slab.slabNo, to: input.destination, date: input.date }, 'Altered from Dispatched');
  return { id: slab.id, slabNo: slab.slabNo, destination: input.destination, label };
}
