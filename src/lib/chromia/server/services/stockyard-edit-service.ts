import { ChromiaDisposition as Disposition, ChromiaSlabEventType as SlabEventType, ChromiaSlabStatus as SlabStatus } from '@prisma/client';
import { prisma } from '@/lib/chromia/db';
import { BusinessRuleViolationError, NotFoundError } from '@/lib/chromia/errors';
import { stockedOnDay, type StockOutcomeValue } from '@/lib/chromia/constants/stock-outcomes';
import { createLogger } from '@/lib/chromia/logger';
import { formatPlantDay, toPlantDateInput } from '@/lib/chromia/plant-time';
import { claimSlab } from '@/lib/chromia/server/services/disposition-service';
import { sendFromStock } from '@/lib/chromia/server/services/stockyard-service';

const log = createLogger('stockyard-edit');

/**
 * Corrections made from the Stockyard and Approved Slabs Edit forms (28 Oct
 * 2026). The slab's entry details are corrected by updateSlabRecord, as on
 * Slab Records; what is the Stockyard's own is corrected here: its Stock
 * Outcome and date, and its grade in place.
 */

/** Where the Stockyard Edit form can put a slab: back on the rack, or one of the three outcomes. */
export type StockyardPlace = 'IN_STOCK' | StockOutcomeValue;

const PLACE_OF_STATUS: Partial<Record<SlabStatus, StockyardPlace>> = {
  [SlabStatus.IN_STOCK]: 'IN_STOCK',
  [SlabStatus.DISPATCHED]: 'DISPATCH',
  [SlabStatus.APPROVED]: 'APPROVED',
  [SlabStatus.SAMPLE_CUT]: 'SAMPLE_CUTTING',
};

/** The slab, its latest stock entry, and where the Stockyard has it now (null: not the Stockyard's). */
export async function loadStockyardPlace(slabId: string) {
  const slab = await prisma.chromiaSlab.findFirst({
    where: { id: slabId, deletedAt: null },
    select: {
      id: true,
      slabNo: true,
      status: true,
      currentDisposition: true,
      currentLocationId: true,
      stockEntries: {
        orderBy: [{ stockDate: 'desc' }, { createdAt: 'desc' }],
        take: 1,
        select: { id: true, stockDate: true, releasedAt: true, releaseOutcome: true, locationId: true },
      },
    },
  });
  if (!slab) throw new NotFoundError('Slab');
  const entry = slab.stockEntries[0] ?? null;
  const place = PLACE_OF_STATUS[slab.status] ?? null;
  // The Stockyard's to correct only while its own stock entry is what put the
  // slab where it is: on the rack, or released from it by that very outcome.
  const ours =
    entry !== null &&
    place !== null &&
    (place === 'IN_STOCK' ? entry.releasedAt === null : entry.releaseOutcome === place);
  return { slab, entry, place: ours ? place : null };
}

/**
 * Correct a slab's Stock Outcome or its date.
 *
 *   same outcome, new date  the date is moved on every record that carries it:
 *                           the stock entry, and the dispatch or the cut;
 *   another outcome         the one recorded is undone (its dispatch or cut
 *                           removed, the stock entry reopened, the slab back on
 *                           the rack), then the new one is recorded by
 *                           sendFromStock exactly as a first release is;
 *   Back in Stock           the undo alone (the owner's decision of 28 Oct 2026).
 *
 * The date is checked first (not before the slab was stocked, not in the
 * future), so a correction is refused whole rather than half-done. The slab
 * keeps its identity, its stock entry and its history; events record the
 * correction.
 */
export async function correctStockOutcome(
  input: { slabId: string; outcome: StockyardPlace; date: Date | null },
  userId: string,
) {
  const { slab, entry, place } = await loadStockyardPlace(input.slabId);
  if (!entry || place === null) {
    throw new BusinessRuleViolationError(
      `Slab ${slab.slabNo} is not in the Stockyard's records any more, so its Stock Outcome cannot be corrected here`,
    );
  }

  if (input.outcome !== 'IN_STOCK') {
    if (!input.date) throw new BusinessRuleViolationError('Enter the date of the Stock Outcome');
    const on = toPlantDateInput(input.date);
    const stockedOn = stockedOnDay(entry.stockDate);
    if (stockedOn && on < stockedOn) {
      throw new BusinessRuleViolationError(`The date cannot be before slab ${slab.slabNo} was stocked (${formatPlantDay(stockedOn)})`);
    }
    if (on > toPlantDateInput(new Date())) throw new BusinessRuleViolationError('The date cannot be in the future');
  }

  if (input.outcome === place) {
    if (place === 'IN_STOCK') return { changed: false };
    const date = input.date as Date;
    if (entry.releasedAt && toPlantDateInput(entry.releasedAt) === toPlantDateInput(date)) return { changed: false };

    await prisma.$transaction(async (tx) => {
      await tx.chromiaStockEntry.update({ where: { id: entry.id }, data: { releasedAt: date } });
      if (place === 'DISPATCH') {
        const last = await tx.chromiaDispatch.findFirst({
          where: { slabId: slab.id },
          orderBy: [{ dispatchDate: 'desc' }, { createdAt: 'desc' }],
          select: { id: true },
        });
        if (last) await tx.chromiaDispatch.update({ where: { id: last.id }, data: { dispatchDate: date } });
      }
      if (place === 'SAMPLE_CUTTING') {
        const last = await tx.chromiaSampleCutting.findFirst({
          where: { slabId: slab.id },
          orderBy: [{ cutDate: 'desc' }, { createdAt: 'desc' }],
          select: { id: true },
        });
        if (last) await tx.chromiaSampleCutting.update({ where: { id: last.id }, data: { cutDate: date } });
      }
      await tx.chromiaSlabEvent.create({
        data: {
          slabId: slab.id,
          eventType: SlabEventType.STATUS_CHANGED,
          fromStatus: slab.status,
          toStatus: slab.status,
          userId,
          occurredAt: new Date(),
          note: `Stock Outcome date corrected to ${formatPlantDay(toPlantDateInput(date))}`,
        },
      });
    });
    log.info({ slabNo: slab.slabNo, outcome: place }, 'Stock Outcome date corrected');
    return { changed: true };
  }

  // Undo what was recorded: the slab goes back on the rack.
  if (place !== 'IN_STOCK') {
    await prisma.$transaction(async (tx) => {
      await claimSlab(tx, slab, {
        status: SlabStatus.IN_STOCK,
        currentDisposition: Disposition.STOCK,
        currentLocationId: entry.locationId ?? slab.currentLocationId,
        updatedById: userId,
      });
      await tx.chromiaStockEntry.update({ where: { id: entry.id }, data: { releasedAt: null, releaseOutcome: null } });
      if (place === 'DISPATCH') {
        const last = await tx.chromiaDispatch.findFirst({
          where: { slabId: slab.id },
          orderBy: [{ dispatchDate: 'desc' }, { createdAt: 'desc' }],
          select: { id: true },
        });
        if (last) await tx.chromiaDispatch.delete({ where: { id: last.id } });
      }
      if (place === 'SAMPLE_CUTTING') {
        const last = await tx.chromiaSampleCutting.findFirst({
          where: { slabId: slab.id },
          orderBy: [{ cutDate: 'desc' }, { createdAt: 'desc' }],
          select: { id: true },
        });
        if (last) await tx.chromiaSampleCutting.delete({ where: { id: last.id } });
      }
      await tx.chromiaSlabEvent.create({
        data: {
          slabId: slab.id,
          eventType: SlabEventType.STATUS_CHANGED,
          fromStatus: slab.status,
          toStatus: SlabStatus.IN_STOCK,
          userId,
          occurredAt: new Date(),
          note: 'Stock Outcome undone on correction — back in stock',
        },
      });
    });
  }

  if (input.outcome !== 'IN_STOCK') {
    await sendFromStock({ slabId: slab.id, outcome: input.outcome, date: input.date as Date }, userId);
  }

  log.info({ slabNo: slab.slabNo, from: place, to: input.outcome }, 'Stock Outcome corrected');
  return { changed: true };
}

/**
 * Correct the grade of a Stock-path slab in place: A or B, both of which go to
 * Stock, so the slab stays exactly where it is (the owner's decision of 28 Oct
 * 2026). The grade is put right on the slab, its latest QC decision and its
 * latest pass, so every page and export reads the same grade. Grade C, which
 * sends a slab to Recalibration, is a full QC redo and stays on Slab Records.
 */
export async function correctStockGrade(slabId: string, grade: 'A' | 'B', userId: string) {
  const slab = await prisma.chromiaSlab.findFirst({
    where: { id: slabId, deletedAt: null },
    select: { id: true, slabNo: true, currentGrade: true },
  });
  if (!slab) throw new NotFoundError('Slab');
  if (slab.currentGrade === grade) return { changed: false };

  await prisma.$transaction(async (tx) => {
    await tx.chromiaSlab.update({ where: { id: slab.id }, data: { currentGrade: grade, updatedById: userId } });
    const decision = await tx.chromiaGradeDecision.findFirst({
      where: { slabId: slab.id },
      orderBy: { decidedAt: 'desc' },
      select: { id: true },
    });
    if (decision) await tx.chromiaGradeDecision.update({ where: { id: decision.id }, data: { grade } });
    const cycle = await tx.chromiaProcessCycle.findFirst({
      where: { slabId: slab.id },
      orderBy: { cycleNumber: 'desc' },
      select: { id: true },
    });
    if (cycle) await tx.chromiaProcessCycle.update({ where: { id: cycle.id }, data: { finalGrade: grade } });
    await tx.chromiaSlabEvent.create({
      data: {
        slabId: slab.id,
        eventType: SlabEventType.STATUS_CHANGED,
        userId,
        occurredAt: new Date(),
        note: `Grade corrected from ${slab.currentGrade ?? '—'} to ${grade}`,
      },
    });
  });
  log.info({ slabNo: slab.slabNo, grade }, 'Grade corrected in place');
  return { changed: true };
}
