import { ChromiaSlabStatus as SlabStatus, type Prisma } from '@prisma/client';
import { prisma } from '@/lib/chromia/db';
import { physicalSlabWhere } from '@/lib/chromia/server/repositories/physical-slabs';
import type { StockOutcomeValue } from '@/lib/chromia/constants/stock-outcomes';
import { simpleSlabWhere, type SimpleFilters } from '@/lib/chromia/simple-filters';
import { stockyardSlabWhere, type StockyardFilters } from '@/lib/chromia/stockyard-filters';

/**
 * Stockyard data access.
 *
 * What is on the racks, what has left them and how, and the yard's totals.
 */

/**
 * What "in stock" means, once: on the rack now. The In Stock Records table and
 * the Dashboard's Current Stock Available both ask exactly this, so with no
 * filter set the KPI and the table's row count are the same number.
 */
const IN_STOCK_NOW = { deletedAt: null, status: SlabStatus.IN_STOCK } as const;

/**
 * Every slab whose current outcome is Stock, newest Production Date first
 * (28 Oct 2026; it was oldest holding first).
 *
 * The optional filters narrow the rack list by production date, batch and slab
 * number — the same three the Recalibration page takes — AND-ed onto the "in
 * stock" condition. No filters means the whole rack, exactly as before.
 */
export async function listStockedSlabs(filters?: SimpleFilters | StockyardFilters) {
  const slabs = await prisma.chromiaSlab.findMany({
    where: {
      AND: [
        await physicalSlabWhere(),
        IN_STOCK_NOW,
        (filters ? ('outcome' in filters ? stockyardSlabWhere(filters) : simpleSlabWhere(filters)) : {}) as Prisma.ChromiaSlabWhereInput,
      ],
    },
    orderBy: [{ receivedDate: 'desc' }, { createdAt: 'desc' }],
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
      stockEntries: {
        where: { releasedAt: null },
        orderBy: { stockDate: 'desc' },
        take: 1,
        select: { stockDate: true },
      },
    },
  });

  return slabs.map(({ stockEntries, currentThicknessMm, ...slab }) => ({
    ...slab,
    thicknessCm: currentThicknessMm === null ? null : Number(currentThicknessMm) / 10,
    stockDate: stockEntries[0]?.stockDate ?? null,
  }));
}

// ─────────────────────────────────────────────── Stockyard (27 Oct 2026) ───

export interface StockyardKpis {
  /** Every slab that has ever entered stock — still there, or sent on. */
  totalStock: number;
  /** On the rack now: the In Stock Records table's own count. */
  currentStock: number;
  dispatched: number;
  approved: number;
  sampleCutting: number;
}

/**
 * The Stockyard Dashboard — always the whole yard, never the filters. Each
 * figure counts SLABS (a slab stocked twice is one slab).
 *
 * Total Stock and Current Stock are the yard's own: every slab that has ever
 * entered stock, and those on the racks now. Dispatched, Approved and Sample
 * Cutting count every slab there, by its status, however it got there — from
 * the rack or straight from QC (the owner's decision of 27 Oct 2026, with the
 * Main Production Dashboard): the same figures the Dashboard, Dispatched and
 * Approved Slabs pages show.
 */
export async function stockyardKpis(): Promise<StockyardKpis> {
  // Each physical slab once (physical-slabs.ts, change 10).
  const physical = await physicalSlabWhere();
  const at = (status: SlabStatus) => prisma.chromiaSlab.count({ where: { AND: [physical, { status }] } });
  const [totalStock, currentStock, dispatched, approved, sampleCutting] = await Promise.all([
    prisma.chromiaSlab.count({ where: { AND: [physical, { stockEntries: { some: {} } }] } }),
    prisma.chromiaSlab.count({ where: { AND: [physical, IN_STOCK_NOW] } }),
    at(SlabStatus.DISPATCHED),
    at(SlabStatus.APPROVED),
    at(SlabStatus.SAMPLE_CUT),
  ]);
  return { totalStock, currentStock, dispatched, approved, sampleCutting };
}

export interface StockyardFilterOptions {
  batchNos: string[];
  slabNos: string[];
  baseMaterials: string[];
  fileNames: string[];
}

/**
 * The values Find a Slab's dropdowns offer: those of every slab that has ever
 * entered stock, as Slab Entry recorded them — so each suggestion finds
 * something, in stock or in the yard's history.
 */
export async function stockyardFilterOptions(): Promise<StockyardFilterOptions> {
  const slabs = await prisma.chromiaSlab.findMany({
    where: { deletedAt: null, stockEntries: { some: {} } },
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

/** The slab status each Stock Outcome leaves a slab in. */
const OUTCOME_STATUS: Record<StockOutcomeValue, SlabStatus> = {
  DISPATCH: SlabStatus.DISPATCHED,
  APPROVED: SlabStatus.APPROVED,
  SAMPLE_CUTTING: SlabStatus.SAMPLE_CUT,
};

/**
 * The slabs counted by a Stock Outcome KPI, newest Production Date first,
 * narrowed by the rest of the filters — the In Stock Records table when a
 * Stock Outcome is chosen. Read-only: the slab has gone, and the row says
 * where and when.
 *
 * READ BY STATUS, AS ITS KPI COUNTS (28 Oct 2026, change 10). The list read
 * the stock entries released by that outcome, and the KPI the slabs in that
 * status (change 7: from the rack or straight from QC), so a slab dispatched
 * at QC was in Total Dispatched Slabs and missing from the list under it. Now
 * both read the same slabs, each physical slab once. The date is the
 * outcome's own record: the dispatch, the cut, or the approval.
 */
export async function listStockOutcomeRecords(outcome: StockOutcomeValue, filters: StockyardFilters) {
  const slabs = await prisma.chromiaSlab.findMany({
    where: {
      AND: [await physicalSlabWhere(), { status: OUTCOME_STATUS[outcome] }, stockyardSlabWhere(filters) as Prisma.ChromiaSlabWhereInput],
    },
    orderBy: [{ receivedDate: 'desc' }, { createdAt: 'desc' }],
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
      stockEntries: {
        orderBy: [{ stockDate: 'desc' }, { createdAt: 'desc' }],
        take: 1,
        select: { id: true, stockDate: true, releasedAt: true },
      },
      dispatches: { orderBy: [{ dispatchDate: 'desc' }, { createdAt: 'desc' }], take: 1, select: { dispatchDate: true } },
      sampleCuttings: { orderBy: [{ cutDate: 'desc' }, { createdAt: 'desc' }], take: 1, select: { cutDate: true } },
    },
  });

  return slabs.map(({ stockEntries, dispatches, sampleCuttings, currentThicknessMm, ...slab }) => {
    const entry = stockEntries[0] ?? null;
    const releasedAt =
      outcome === 'DISPATCH'
        ? (dispatches[0]?.dispatchDate ?? null)
        : outcome === 'SAMPLE_CUTTING'
          ? (sampleCuttings[0]?.cutDate ?? null)
          : (entry?.releasedAt ?? null);
    return {
      id: slab.id,
      stockDate: entry?.stockDate ?? null,
      releasedAt,
      releaseOutcome: outcome,
      slabId: slab.id,
      slabNo: slab.slabNo,
      receivedDate: slab.receivedDate,
      thicknessCm: currentThicknessMm === null ? null : Number(currentThicknessMm) / 10,
      currentGrade: slab.currentGrade,
      currentDisposition: slab.currentDisposition,
      remarks: slab.remarks,
      batch: slab.batch,
      baseMaterial: slab.baseMaterial,
      plannedDesign: slab.plannedDesign,
    };
  });
}
