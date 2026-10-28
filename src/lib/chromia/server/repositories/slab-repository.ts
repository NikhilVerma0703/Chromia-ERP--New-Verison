import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/chromia/db';
import { WHOLE_RANGE_ROW_CAP } from '@/lib/chromia/list-limits';
import { earlierEntries } from '@/lib/chromia/production-overview';
import { buildSlabWhere, type SlabFilters } from '@/lib/chromia/slab-filters';

/**
 * Filtered, paged slab search — the traceability lookup.
 * Returns the page of rows plus the total, so the UI can page accurately.
 *
 * `wholeRange` returns the matching rows from the first, on one page, up to
 * WHOLE_RANGE_ROW_CAP. Slab Records asks for it only when the filter bounds
 * the received date to a month or less (isWholeRangeFilter): an in-charge
 * processing old records wants that month in front of them, not a screen of
 * it at a time. It used to be `unpaged`, asked for by ANY filter and with no
 * ceiling, so Grade A loaded every Grade A slab ever recorded (the code review
 * of 20 Oct 2026, CHR-10). Everything else pages.
 */
export async function searchSlabs(filters: SlabFilters, options: { wholeRange?: boolean } = {}) {
  /*
   * ONE ROW PER PHYSICAL SLAB (28 Oct 2026). A slab entered again carries a
   * letter — 14567, then 14567-A — and both were rows, so Slab Records counted
   * more slabs than were made. The earlier entries are left out of the rows
   * and the count by the rule the dashboard's Total Produced counts with
   * (production-overview: sameSlabNo, latest record wins), so the unfiltered
   * total IS Total Produced. Nothing is deleted: each row names its earlier
   * numbers, and their records and history stay as they were.
   */
  const live = await prisma.chromiaSlab.findMany({
    where: { deletedAt: null },
    select: { id: true, slabNo: true, createdAt: true },
  });
  const earlier = earlierEntries(live);
  const filterWhere = buildSlabWhere(filters) as Prisma.ChromiaSlabWhereInput;
  const where: Prisma.ChromiaSlabWhereInput =
    earlier.size === 0 ? filterWhere : { AND: [filterWhere, { id: { notIn: [...earlier.keys()] } }] };
  const earlierNos = new Map<string, string[]>();
  for (const { latestId, slabNo } of earlier.values()) {
    earlierNos.set(latestId, [...(earlierNos.get(latestId) ?? []), slabNo]);
  }

  const pageArgs: { skip?: number; take: number } = options.wholeRange
    ? { take: WHOLE_RANGE_ROW_CAP }
    : { skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize };

  const [rows, total] = await Promise.all([
    prisma.chromiaSlab.findMany({
      where,
      orderBy: [{ receivedDate: 'desc' }, { createdAt: 'desc' }],
      ...pageArgs,
      select: {
        id: true,
        slabNo: true,
        status: true,
        currentCycleNumber: true,
        currentGrade: true,
        currentDisposition: true,
        currentThicknessMm: true,
        recalibrationCount: true,
        isRecalibrationOut: true,
        receivedDate: true,
        remarks: true,
        batch: { select: { batchNo: true } },
        baseMaterial: { select: { name: true } },
        plannedDesign: { select: { name: true, fileName: true } },
        currentLocation: { select: { name: true } },
        cycles: {
          orderBy: { cycleNumber: 'desc' },
          take: 1,
          select: { inTime: true, outTime: true, fullyPrintedDate: true },
        },
        // Its trips, for the Current Status the Recalibration page would give it.
        recalibrations: {
          orderBy: { attemptNumber: 'asc' },
          select: { attemptNumber: true, sentDate: true, receivedDate: true, restartedAt: true },
        },
      },
    }),
    prisma.chromiaSlab.count({ where }),
  ]);

  return {
    total,
    rows: rows.map(({ cycles, currentThicknessMm, ...slab }) => ({
      ...slab,
      // Decimal is not serialisable across the server/client boundary, and the
      // register works in centimetres while the database stores millimetres.
      thicknessCm: currentThicknessMm === null ? null : Number(currentThicknessMm) / 10,
      inTime: cycles[0]?.inTime ?? null,
      outTime: cycles[0]?.outTime ?? null,
      fullyPrintedDate: cycles[0]?.fullyPrintedDate ?? null,
      /** The slab's earlier entries (14567 for 14567-A), oldest number first. */
      earlierSlabNos: (earlierNos.get(slab.id) ?? []).sort((a, b) => a.length - b.length || a.localeCompare(b)),
    })),
  };
}

/** Options for the slab list filter bar. */
export function loadFilterOptions() {
  return Promise.all([
    prisma.chromiaBaseMaterial.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.chromiaDesign.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);
}
