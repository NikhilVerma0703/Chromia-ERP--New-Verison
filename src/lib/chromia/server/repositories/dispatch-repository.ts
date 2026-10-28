import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/chromia/db';
import { physicalSlabWhere } from '@/lib/chromia/server/repositories/physical-slabs';
import {
  addMonths,
  dispatchDateWhere,
  dispatchedSlabWhere,
  monthDays,
  type DispatchedFilters,
} from '@/lib/chromia/dispatched-filters';
import { plantDayRange, toPlantDateInput } from '@/lib/chromia/plant-time';

/**
 * Dispatched — data access (27 Oct 2026).
 *
 * The page is a read-only record of every slab that has left the plant by
 * dispatch: sent from the Stockyard with the Dispatch outcome, and the older
 * ones dispatched straight from QC or brought in by a register import (the
 * owner's choice). Each has a chromia_dispatch row whose dispatch_date is the
 * date chosen when it was sent — the Dispatch Date shown and filtered on,
 * never the production date or the day it was stocked.
 *
 * ONE SLAB, ONE ROW, ONE COUNT. Every figure and the table read the same
 * dispatches through the same condition and keep each slab's latest dispatch
 * (DISTINCT ON the slab), so a slab is counted exactly once and, with no filter
 * set, Total Dispatched Slabs is the table's row count.
 */

/** A dispatch of a slab that still exists — the only kind this page counts. */
const LIVE = { slab: { deletedAt: null } } as const;

/** How many distinct slabs have a dispatch matching `where`. */
async function countDispatchedSlabs(where: Record<string, unknown>): Promise<number> {
  const slabs = await prisma.chromiaDispatch.findMany({
    // Each physical slab once (physical-slabs.ts, change 10).
    where: { ...LIVE, ...where, slab: await physicalSlabWhere() },
    distinct: ['slabId'],
    select: { slabId: true },
  });
  return slabs.length;
}

export interface DispatchedKpis {
  total: number;
  currentMonth: number;
  previousMonth: number;
}

/**
 * The Dashboard, by DISPATCH date on the plant calendar: all to date, the
 * current calendar month so far, and the whole previous calendar month.
 * Never filtered.
 */
export async function dispatchedKpis(now: Date = new Date()): Promise<DispatchedKpis> {
  const thisMonth = toPlantDateInput(now).slice(0, 7);
  const inMonth = (month: string) => {
    const { fromDay, toDay } = monthDays(month);
    const { from, to } = plantDayRange(fromDay, toDay);
    return { dispatchDate: { gte: from, lte: to } };
  };
  const [total, currentMonth, previousMonth] = await Promise.all([
    countDispatchedSlabs({}),
    countDispatchedSlabs(inMonth(thisMonth)),
    countDispatchedSlabs(inMonth(addMonths(thisMonth, -1))),
  ]);
  return { total, currentMonth, previousMonth };
}

/** Dispatched slabs, newest dispatch first, narrowed by any of the filters. */
export async function listDispatchedSlabs(filters: DispatchedFilters, now: Date = new Date()) {
  const dispatches = await prisma.chromiaDispatch.findMany({
    where: {
      slab: { AND: [await physicalSlabWhere(), dispatchedSlabWhere(filters) as Prisma.ChromiaSlabWhereInput] },
      ...dispatchDateWhere(filters, now),
    },
    distinct: ['slabId'],
    orderBy: [{ slabId: 'asc' }, { dispatchDate: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      dispatchDate: true,
      slab: {
        select: {
          id: true,
          slabNo: true,
          receivedDate: true,
          currentThicknessMm: true,
          currentGrade: true,
          currentDisposition: true,
          remarks: true,
          batch: { select: { batchNo: true } },
          baseMaterial: { select: { name: true } },
          plannedDesign: { select: { name: true, fileName: true } },
        },
      },
    },
  });

  return dispatches
    .map((dispatch) => ({
      id: dispatch.id,
      dispatchDate: dispatch.dispatchDate,
      slabId: dispatch.slab.id,
      slabNo: dispatch.slab.slabNo,
      receivedDate: dispatch.slab.receivedDate,
      batchNo: dispatch.slab.batch.batchNo,
      baseMaterial: dispatch.slab.baseMaterial.name,
      designFileName: dispatch.slab.plannedDesign?.fileName ?? dispatch.slab.plannedDesign?.name ?? null,
      thicknessCm:
        dispatch.slab.currentThicknessMm === null ? null : Number(dispatch.slab.currentThicknessMm) / 10,
      grade: dispatch.slab.currentGrade,
      disposition: dispatch.slab.currentDisposition,
      remarks: dispatch.slab.remarks,
    }))
    // Newest Production Date first (28 Oct 2026), then the latest dispatch.
    .sort(
      (a, b) =>
        b.receivedDate.getTime() - a.receivedDate.getTime() ||
        b.dispatchDate.getTime() - a.dispatchDate.getTime() ||
        a.slabNo.localeCompare(b.slabNo, undefined, { numeric: true }),
    );
}

export interface DispatchedFilterOptions {
  batchNos: string[];
  baseMaterials: string[];
  fileNames: string[];
}

/** What the searchable dropdowns offer: the values of slabs that have been dispatched. */
export async function dispatchedFilterOptions(): Promise<DispatchedFilterOptions> {
  const slabs = await prisma.chromiaSlab.findMany({
    where: { deletedAt: null, dispatches: { some: {} } },
    select: {
      batch: { select: { batchNo: true } },
      baseMaterial: { select: { name: true } },
      plannedDesign: { select: { name: true, fileName: true } },
    },
  });
  const sorted = (values: (string | null | undefined)[]) =>
    [...new Set(values.filter((v): v is string => Boolean(v && v.trim())))].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
    );
  return {
    batchNos: sorted(slabs.map((s) => s.batch.batchNo)),
    baseMaterials: sorted(slabs.map((s) => s.baseMaterial.name)),
    fileNames: sorted(slabs.map((s) => s.plannedDesign?.fileName ?? s.plannedDesign?.name)),
  };
}
