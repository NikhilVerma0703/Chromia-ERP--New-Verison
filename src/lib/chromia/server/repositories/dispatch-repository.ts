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

/*
 * ONE SCAN PER PAGE LOAD (19 Nov 2026, the Dispatched navigation fix). Which
 * slabs are physical (physicalSlabWhere: each re-entered slab once) is worked
 * out by reading every live slab. The page asked it four times per load — once
 * for each of the three KPIs and once for the table — and fetched every row
 * of every dispatch three times over for the KPIs alone. Now it is asked once
 * and passed in, the three KPIs are counted from ONE read of the dispatch
 * dates, and the table reads its full details only for the rows it draws.
 * Every figure and row is the same as before.
 */
type PhysicalWhere = Prisma.ChromiaSlabWhereInput;

export interface DispatchedKpis {
  total: number;
  currentMonth: number;
  previousMonth: number;
}

/** A plant calendar month as the instants that bound it, both ends included. */
function monthBounds(month: string) {
  const { fromDay, toDay } = monthDays(month);
  return plantDayRange(fromDay, toDay);
}

/**
 * The three KPIs from one read of every dispatch of a physical slab: each
 * counts DISTINCT SLABS — all of them, those with a dispatch dated in the
 * current plant month, and those with one in the previous month — exactly the
 * three counts the page made separately before.
 */
async function kpisFrom(physical: PhysicalWhere, now: Date): Promise<DispatchedKpis> {
  const dispatches = await prisma.chromiaDispatch.findMany({
    where: { slab: physical },
    select: { slabId: true, dispatchDate: true },
  });
  const thisMonth = toPlantDateInput(now).slice(0, 7);
  const slabsIn = ({ from, to }: { from: Date; to: Date }) =>
    new Set(dispatches.filter((d) => d.dispatchDate >= from && d.dispatchDate <= to).map((d) => d.slabId)).size;
  return {
    total: new Set(dispatches.map((d) => d.slabId)).size,
    currentMonth: slabsIn(monthBounds(thisMonth)),
    previousMonth: slabsIn(monthBounds(addMonths(thisMonth, -1))),
  };
}

/**
 * The Dashboard, by DISPATCH date on the plant calendar: all to date, the
 * current calendar month so far, and the whole previous calendar month.
 * Never filtered.
 */
export async function dispatchedKpis(now: Date = new Date()): Promise<DispatchedKpis> {
  return kpisFrom(await physicalSlabWhere(), now);
}

/** One table row's place: its slab, that slab's latest matching dispatch, and the sort keys. */
interface RowKey {
  id: string;
  dispatchDate: Date;
  slabId: string;
  slabNo: string;
  receivedDate: Date;
}

/**
 * The table's rows in table order, light: each slab once with its LATEST
 * matching dispatch (what DISTINCT ON the slab kept), then newest Production
 * Date first (28 Oct 2026), then the latest dispatch, then the slab number.
 */
async function rowKeys(filters: DispatchedFilters, now: Date, physical: PhysicalWhere): Promise<RowKey[]> {
  const dispatches = await prisma.chromiaDispatch.findMany({
    where: {
      slab: { AND: [physical, dispatchedSlabWhere(filters) as Prisma.ChromiaSlabWhereInput] },
      ...dispatchDateWhere(filters, now),
    },
    orderBy: [{ slabId: 'asc' }, { dispatchDate: 'desc' }, { createdAt: 'desc' }],
    select: { id: true, dispatchDate: true, slabId: true, slab: { select: { slabNo: true, receivedDate: true } } },
  });
  const seen = new Set<string>();
  const keys: RowKey[] = [];
  for (const d of dispatches) {
    if (seen.has(d.slabId)) continue; // an older dispatch of a slab already kept
    seen.add(d.slabId);
    keys.push({ id: d.id, dispatchDate: d.dispatchDate, slabId: d.slabId, slabNo: d.slab.slabNo, receivedDate: d.slab.receivedDate });
  }
  return keys.sort(
    (a, b) =>
      b.receivedDate.getTime() - a.receivedDate.getTime() ||
      b.dispatchDate.getTime() - a.dispatchDate.getTime() ||
      a.slabNo.localeCompare(b.slabNo, undefined, { numeric: true }),
  );
}

/** The full details of these rows, in the same order. */
async function rowsFor(keys: RowKey[]) {
  if (keys.length === 0) return [];
  const slabs = await prisma.chromiaSlab.findMany({
    where: { id: { in: keys.map((k) => k.slabId) } },
    select: {
      id: true,
      currentThicknessMm: true,
      currentGrade: true,
      currentDisposition: true,
      remarks: true,
      batch: { select: { batchNo: true } },
      baseMaterial: { select: { name: true } },
      plannedDesign: { select: { name: true, fileName: true } },
    },
  });
  const byId = new Map(slabs.map((s) => [s.id, s]));
  return keys.flatMap((key) => {
    const slab = byId.get(key.slabId);
    if (!slab) return []; // deleted between the two reads
    return [
      {
        id: key.id,
        dispatchDate: key.dispatchDate,
        slabId: key.slabId,
        slabNo: key.slabNo,
        receivedDate: key.receivedDate,
        batchNo: slab.batch.batchNo,
        baseMaterial: slab.baseMaterial.name,
        designFileName: slab.plannedDesign?.fileName ?? slab.plannedDesign?.name ?? null,
        thicknessCm: slab.currentThicknessMm === null ? null : Number(slab.currentThicknessMm) / 10,
        grade: slab.currentGrade,
        disposition: slab.currentDisposition,
        remarks: slab.remarks,
      },
    ];
  });
}

/** Dispatched slabs, every one, in table order, narrowed by any of the filters. */
export async function listDispatchedSlabs(filters: DispatchedFilters, now: Date = new Date()) {
  return rowsFor(await rowKeys(filters, now, await physicalSlabWhere()));
}

/**
 * Everything the Dispatched page draws, in one load (19 Nov 2026): the KPIs,
 * the dropdowns' values, and ONE PAGE of the table (`pageSize` rows) with the
 * count of every matching slab. The table had no pages and drew every slab
 * ever dispatched — each with its own Alter From Dispatched form — so the page
 * grew with every dispatch, to megabytes per click, and a click from the
 * sidebar waited for all of it (the navigation fault). A page past the last is
 * read as the last.
 */
export async function loadDispatchedPage(filters: DispatchedFilters, pageSize: number, now: Date = new Date()) {
  const physical = await physicalSlabWhere();
  const [kpis, options, keys] = await Promise.all([
    kpisFrom(physical, now),
    dispatchedFilterOptions(),
    rowKeys(filters, now, physical),
  ]);
  const total = keys.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, filters.page), pages);
  const slabs = await rowsFor(keys.slice((page - 1) * pageSize, page * pageSize));
  return { kpis, options, slabs, total, page, pages, from: total === 0 ? 0 : (page - 1) * pageSize + 1 };
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
