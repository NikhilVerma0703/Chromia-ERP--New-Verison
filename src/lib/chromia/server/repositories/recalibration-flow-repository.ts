import { ChromiaDisposition as Disposition, type Prisma } from '@prisma/client';
import { prisma } from '@/lib/chromia/db';
import { pageWindow } from '@/lib/chromia/list-limits';
import type { TrackedSlab } from '@/lib/chromia/recalibration-kpis';
import {
  boardKpis,
  boardRows,
  boardSlabWhere,
  type BoardFilters,
  type BoardKpis,
  type BoardSlab,
} from '@/lib/chromia/recalibration-board';

/**
 * Everything the Recalibration page reads.
 *
 * The list is deliberately wider than "outcome = Recalibration". A slab that
 * has come back and gone down the line again has no outcome at all for a few
 * hours — the next pass has not been graded yet — and that is precisely the
 * moment the in-charge needs to find it, to record the new QC. Filtering on the
 * outcome alone would make the slab vanish mid-journey and reappear later,
 * which is the sort of thing that gets a slab lost. So: anything currently
 * condemned, plus anything that has ever been sent.
 */

const SLAB_FIELDS = {
  id: true,
  slabNo: true,
  status: true,
  currentGrade: true,
  currentDisposition: true,
  currentThicknessMm: true,
  receivedDate: true,
  remarks: true,
  batch: { select: { batchNo: true } },
  baseMaterial: { select: { name: true } },
  plannedDesign: { select: { name: true, fileName: true } },
  cycles: {
    orderBy: { cycleNumber: 'desc' },
    take: 1,
    select: { inTime: true, outTime: true, fullyPrintedDate: true },
  },
  recalibrations: {
    orderBy: { attemptNumber: 'asc' },
    select: {
      id: true,
      attemptNumber: true,
      sentDate: true,
      receivedDate: true,
      restartedAt: true,
      createdAt: true,
      reason: { select: { name: true } },
    },
  },
} as const;

function shape<
  T extends {
    currentThicknessMm: unknown;
    cycles: { inTime: Date | null; outTime: Date | null; fullyPrintedDate: Date | null }[];
    recalibrations: {
      attemptNumber: number;
      sentDate: Date | null;
      receivedDate: Date | null;
      restartedAt: Date | null;
      createdAt: Date;
      reason: { name: string } | null;
    }[];
  },
>(slab: T) {
  const { cycles, currentThicknessMm, ...rest } = slab;
  const trips = slab.recalibrations;
  const latest = trips[trips.length - 1];

  return {
    ...rest,
    // Decimal does not cross the server/client boundary, and the register works
    // in centimetres while the database stores millimetres.
    thicknessCm: currentThicknessMm === null ? null : Number(currentThicknessMm) / 10,
    inTime: cycles[0]?.inTime ?? null,
    fullyPrintedDate: cycles[0]?.fullyPrintedDate ?? null,
    trips: trips.map(({ reason: _reason, createdAt: _createdAt, ...trip }) => trip),
    /** The reason QC gave, carried from the newest record that has one. */
    reason: [...trips].reverse().find((trip) => trip.reason)?.reason?.name ?? null,
    /** When QC condemned the slab — where the waiting clock starts. */
    condemnedAt: latest?.createdAt ?? null,
    sentDate: latest?.sentDate ?? null,
    returnedDate: latest?.receivedDate ?? null,
  };
}

/** The search both recalibration lists run. */
export interface RecalibrationSearch {
  batchNo: string;
  slabNo: string;
  baseMaterialId: string | null;
  designId: string | null;
  receivedFrom: Date | null;
  receivedTo: Date | null;
}

/** What the rules (recalibration-flow, recalibration-kpis) read of one slab, and its id. */
export interface RecalibrationState extends TrackedSlab {
  id: string;
}

function recalibrationWhere(filters: RecalibrationSearch) {
  return {
    deletedAt: null,
    OR: [{ currentDisposition: Disposition.RECALIBRATION }, { recalibrations: { some: {} } }],
    ...(filters.slabNo
      ? { slabNo: { contains: filters.slabNo, mode: 'insensitive' as const } }
      : {}),
    ...(filters.batchNo
      ? { batch: { batchNo: { contains: filters.batchNo, mode: 'insensitive' as const } } }
      : {}),
    ...(filters.baseMaterialId ? { baseMaterialId: filters.baseMaterialId } : {}),
    ...(filters.designId ? { plannedDesignId: filters.designId } : {}),
    ...(filters.receivedFrom || filters.receivedTo
      ? {
          receivedDate: {
            ...(filters.receivedFrom ? { gte: filters.receivedFrom } : {}),
            ...(filters.receivedTo ? { lte: filters.receivedTo } : {}),
          },
        }
      : {}),
  };
}

/**
 * The STATE of every slab the filters match — its outcome, whether it was
 * written off, and its trips; nothing else — newest activity first.
 *
 * Thin on purpose (the code review of 20 Oct 2026, CHR-10): every count on the
 * two recalibration pages and the main dashboard covers everything the filters
 * match, and this is all those counts and the tracking page's attempt filter
 * read. The full rows are read for one page at a time (searchRecalibrationPage).
 */
export async function searchRecalibrationStates(filters: RecalibrationSearch): Promise<RecalibrationState[]> {
  const matches = await prisma.chromiaSlab.findMany({
    where: recalibrationWhere(filters),
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    select: {
      id: true,
      currentDisposition: true,
      status: true,
      recalibrations: {
        orderBy: { attemptNumber: 'asc' },
        select: { attemptNumber: true, sentDate: true, receivedDate: true, restartedAt: true },
      },
    },
  });

  return matches.map((slab) => ({
    id: slab.id,
    disposition: slab.currentDisposition,
    writtenOff: slab.status === 'WASTE',
    trips: slab.recalibrations,
  }));
}

/**
 * One page of the recalibration records, narrowed by the filters — and the
 * state of every match, which the page's counts are read from.
 *
 * Batch, slab, material, design and the date range are pushed into the query;
 * `keep` is applied afterwards — the tracking page's attempt filter, because
 * "attempts used" is derived from the trips rather than stored, and the page
 * and the filter must agree on one definition of it.
 *
 * PAGED (CHR-10). Both lists loaded every slab that had ever had a trip, with
 * its batch, material, design, cycle and every trip — the whole history of the
 * loop, on every visit, growing for ever. Now the thin states of every match
 * (searchRecalibrationStates) and the full rows for the one page shown, in the
 * same order.
 */
export async function searchRecalibrationPage(
  filters: RecalibrationSearch,
  options: { page: number; pageSize: number; keep?: (state: RecalibrationState) => boolean },
) {
  const all = await searchRecalibrationStates(filters);
  const states = options.keep ? all.filter(options.keep) : all;

  const cut = pageWindow(states.length, options.page, options.pageSize);
  const ids = states.slice(cut.skip, cut.skip + cut.take).map((state) => state.id);

  const rows = await prisma.chromiaSlab.findMany({ where: { id: { in: ids } }, select: SLAB_FIELDS });
  const byId = new Map(rows.map((slab) => [slab.id, shape(slab)]));

  return {
    /** Every match's state, for the counts. */
    states,
    /** The page shown, in the list's order. */
    records: ids.flatMap((id) => {
      const record = byId.get(id);
      return record ? [record] : [];
    }),
    ...cut,
    total: states.length,
  };
}

export async function findRecalibrationRecord(slabId: string) {
  const slab = await prisma.chromiaSlab.findFirst({
    where: { id: slabId, deletedAt: null },
    select: SLAB_FIELDS,
  });

  return slab ? shape(slab) : null;
}

// ─────────────────────────────────────── Recalibration board (27 Oct 2026) ───

/** The slabs QC sent to recalibration — the same rule recalibrationWhere uses. */
const ON_THE_BOARD: Prisma.ChromiaSlabWhereInput = {
  deletedAt: null,
  OR: [{ currentDisposition: Disposition.RECALIBRATION }, { recalibrations: { some: {} } }],
};

async function boardStates(where: Record<string, unknown>): Promise<BoardSlab[]> {
  const slabs = await prisma.chromiaSlab.findMany({
    where: { AND: [ON_THE_BOARD, where as Prisma.ChromiaSlabWhereInput] },
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    select: {
      id: true,
      currentDisposition: true,
      status: true,
      recalibrations: {
        orderBy: { attemptNumber: 'asc' },
        select: { attemptNumber: true, sentDate: true, receivedDate: true, restartedAt: true },
      },
    },
  });
  return slabs.map((slab) => ({
    id: slab.id,
    disposition: slab.currentDisposition,
    writtenOff: slab.status === 'WASTE',
    trips: slab.recalibrations,
  }));
}

/**
 * The Recalibration page, once: the four KPIs for every slab on the board
 * (never filtered), and the rows of the chosen KPI card narrowed by Find a
 * Slab, a page at a time (CHR-10 — the board grows by thousands a year).
 * Each row carries its slab, its trip's attempt / dates / reason, and the
 * slab's whole state for the Current Status.
 */
export async function loadRecalibrationBoard(
  filters: BoardFilters,
  options: { page: number; pageSize: number },
): Promise<{
  kpis: BoardKpis;
  rows: BoardRecord[];
  total: number;
  page: number;
  pages: number;
}> {
  const [everything, matching] = await Promise.all([boardStates({}), boardStates(boardSlabWhere(filters))]);
  const kpis = boardKpis(everything);
  const all = boardRows(matching, filters.view);
  const cut = pageWindow(all.length, options.page, options.pageSize);
  const shown = all.slice(cut.skip, cut.skip + cut.take);

  const ids = [...new Set(shown.map((row) => row.slabId))];
  const slabs = await prisma.chromiaSlab.findMany({ where: { id: { in: ids } }, select: SLAB_FIELDS });
  const byId = new Map(slabs.map((slab) => [slab.id, slab]));
  const stateById = new Map(matching.map((state) => [state.id, state]));

  const rows = shown.flatMap((row): BoardRecord[] => {
    const slab = byId.get(row.slabId);
    const state = stateById.get(row.slabId);
    if (!slab || !state) return [];
    const trip = slab.recalibrations.find((t) => t.attemptNumber === row.attemptNumber) ?? null;
    return [
      {
        key: `${slab.id}:${row.attemptNumber ?? 0}`,
        slabId: slab.id,
        slabNo: slab.slabNo,
        receivedDate: slab.receivedDate,
        batchNo: slab.batch.batchNo,
        baseMaterial: slab.baseMaterial.name,
        designFileName: slab.plannedDesign?.fileName ?? slab.plannedDesign?.name ?? null,
        thicknessCm: slab.currentThicknessMm === null ? null : Number(slab.currentThicknessMm) / 10,
        grade: slab.currentGrade,
        disposition: slab.currentDisposition,
        remarks: slab.remarks,
        attemptNumber: row.attemptNumber,
        sentDate: trip?.sentDate ?? null,
        tripReceivedDate: trip?.receivedDate ?? null,
        // The trip's own reason, else the newest one QC gave this slab.
        reason: trip?.reason?.name ?? [...slab.recalibrations].reverse().find((t) => t.reason)?.reason?.name ?? null,
        state,
      },
    ];
  });

  return { kpis, rows, total: all.length, page: cut.page, pages: cut.pages };
}

export interface BoardRecord {
  key: string;
  slabId: string;
  slabNo: string;
  receivedDate: Date;
  batchNo: string;
  baseMaterial: string;
  designFileName: string | null;
  thicknessCm: number | null;
  grade: string | null;
  disposition: string | null;
  remarks: string | null;
  attemptNumber: number | null;
  sentDate: Date | null;
  tripReceivedDate: Date | null;
  reason: string | null;
  state: BoardSlab;
}

/** Find a Slab's dropdowns: the values of slabs on the board. */
export async function boardFilterOptions() {
  const slabs = await prisma.chromiaSlab.findMany({
    where: ON_THE_BOARD,
    select: {
      slabNo: true,
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
    slabNos: sorted(slabs.map((s) => s.slabNo)),
    baseMaterials: sorted(slabs.map((s) => s.baseMaterial.name)),
    fileNames: sorted(slabs.map((s) => s.plannedDesign?.fileName ?? s.plannedDesign?.name)),
  };
}

/** Every trip of one slab, oldest first, each with the reason it went with — the unified form. */
export async function loadSlabTrips(slabId: string) {
  return prisma.chromiaRecalibrationCycle.findMany({
    where: { slabId },
    orderBy: { attemptNumber: 'asc' },
    select: {
      attemptNumber: true,
      sentDate: true,
      receivedDate: true,
      restartedAt: true,
      reason: { select: { name: true } },
    },
  });
}
