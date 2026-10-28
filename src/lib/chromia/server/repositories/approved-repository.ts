import { ChromiaSlabStatus as SlabStatus, ChromiaStockOutcome as StockOutcome, type Prisma } from '@prisma/client';

import { approvedDateWhere, approvedSlabWhere, type ApprovedFilters } from '@/lib/chromia/approved-filters';
import { prisma } from '@/lib/chromia/db';
import { physicalSlabWhere } from '@/lib/chromia/server/repositories/physical-slabs';

/**
 * Approved Slabs — data access (27 Oct 2026).
 *
 * A slab is approved when it left the Stockyard with the Approved outcome: its
 * stock entry was closed with release_outcome APPROVED, and released_at holds
 * the date chosen then — the Approved Date shown and filtered on.
 *
 * ONE SLAB, ONE ROW, ONE COUNT. The KPI and the table read the same entries
 * through the same condition and keep one per slab (its latest approval), so
 * with no filter Total Approved Slabs is the table's row count — and the same
 * figure as the Stockyard Dashboard's Total Approved Slabs.
 *
 * Photos live in entry_photo, the ERP's existing photo store (Slab Intake's
 * defect photos are there too), as model 'ChromiaSlab' against the slab's id.
 * A new photo is added, never written over the old one; the slab shows its
 * latest.
 */

/** entry_photo.model for a Chromia slab's own photo. */
export const SLAB_PHOTO_MODEL = 'ChromiaSlab';

const APPROVED = { releaseOutcome: StockOutcome.APPROVED, slab: { deletedAt: null } } as const;

/** Total Approved Slabs — never filtered. */
export async function approvedKpi(): Promise<number> {
  // Approved now (its status) and from the rack (its entry), each physical slab once (change 10).
  const slabs = await prisma.chromiaStockEntry.findMany({
    where: { releaseOutcome: StockOutcome.APPROVED, slab: { AND: [await physicalSlabWhere(), { status: SlabStatus.APPROVED }] } },
    distinct: ['slabId'],
    select: { slabId: true },
  });
  return slabs.length;
}

/** The latest saved photo of each of these slabs, by slab id. */
export async function latestSlabPhotos(slabIds: string[]): Promise<Map<string, { id: string; at: Date }>> {
  if (slabIds.length === 0) return new Map();
  const photos = await prisma.entryPhoto.findMany({
    where: { model: SLAB_PHOTO_MODEL, recordId: { in: slabIds } },
    orderBy: { at: 'desc' },
    select: { id: true, recordId: true, at: true },
  });
  const latest = new Map<string, { id: string; at: Date }>();
  for (const photo of photos) if (!latest.has(photo.recordId)) latest.set(photo.recordId, { id: photo.id, at: photo.at });
  return latest;
}

/** Approved slabs, newest approval first, narrowed by any of the filters. */
export async function listApprovedSlabs(filters: ApprovedFilters) {
  const entries = await prisma.chromiaStockEntry.findMany({
    where: {
      releaseOutcome: StockOutcome.APPROVED,
      slab: { AND: [await physicalSlabWhere(), { status: SlabStatus.APPROVED }, approvedSlabWhere(filters) as Prisma.ChromiaSlabWhereInput] },
      ...approvedDateWhere(filters),
    },
    distinct: ['slabId'],
    orderBy: [{ slabId: 'asc' }, { releasedAt: 'desc' }, { updatedAt: 'desc' }],
    select: {
      id: true,
      releasedAt: true,
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

  const photos = await latestSlabPhotos(entries.map((entry) => entry.slab.id));

  return entries
    .map(({ slab, ...entry }) => ({
      id: entry.id,
      approvedDate: entry.releasedAt,
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
      photo: photos.get(slab.id) ?? null,
    }))
    // Newest Production Date first (28 Oct 2026), then the latest approval.
    .sort(
      (a, b) =>
        b.receivedDate.getTime() - a.receivedDate.getTime() ||
        (b.approvedDate?.getTime() ?? 0) - (a.approvedDate?.getTime() ?? 0) ||
        a.slabNo.localeCompare(b.slabNo, undefined, { numeric: true }),
    );
}

export interface ApprovedFilterOptions {
  batchNos: string[];
  baseMaterials: string[];
  fileNames: string[];
}

/** What the searchable dropdowns offer: the values approved slabs carry. */
export async function approvedFilterOptions(): Promise<ApprovedFilterOptions> {
  const slabs = await prisma.chromiaSlab.findMany({
    where: { deletedAt: null, stockEntries: { some: { releaseOutcome: StockOutcome.APPROVED } } },
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

/** The approval of one slab — its date — or null when the slab is not approved. */
export async function loadApproval(slabId: string): Promise<{ approvedDate: Date | null } | null> {
  const entry = await prisma.chromiaStockEntry.findFirst({
    where: { slabId, ...APPROVED },
    orderBy: { releasedAt: 'desc' },
    select: { releasedAt: true },
  });
  return entry ? { approvedDate: entry.releasedAt } : null;
}

/** One saved slab photo, bytes and all — only a Chromia slab photo. */
export async function loadSlabPhoto(photoId: string) {
  return prisma.entryPhoto.findFirst({
    where: { id: photoId, model: SLAB_PHOTO_MODEL },
    select: { id: true, recordId: true, filename: true, mime: true, data: true, at: true },
  });
}
