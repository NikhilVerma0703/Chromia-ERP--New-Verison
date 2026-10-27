import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/chromia/db';
import { WHOLE_RANGE_ROW_CAP } from '@/lib/chromia/list-limits';
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
  const where = buildSlabWhere(filters) as Prisma.ChromiaSlabWhereInput;

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
