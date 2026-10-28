import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/chromia/db';
import { earlierEntries } from '@/lib/chromia/production-overview';

/**
 * ONE PHYSICAL SLAB, ONE COUNT — the single rule every Chromia list and KPI
 * counts slabs by (28 Oct 2026, change 10).
 *
 * A slab entered again carries a letter: 14567, then 14567-A. Both are the
 * same physical slab, and it is where its LATEST record is
 * (production-overview: sameSlabNo, latestPerSlab). The earlier records are
 * left out of every slab-level list and count — Dashboard, Slab Records,
 * Stockyard, Dispatched, Approved Slabs, Recalibration and its Tracking — so
 * no page counts a slab twice, and every page counts the same slabs. Nothing
 * is deleted: the earlier records keep their details and their history.
 */

/** The ids of the live records that are a slab's earlier entries. */
export async function earlierEntryIds(): Promise<string[]> {
  const live = await prisma.chromiaSlab.findMany({
    where: { deletedAt: null },
    select: { id: true, slabNo: true, createdAt: true },
  });
  return [...earlierEntries(live).keys()];
}

/** Live slabs, each physical slab once — AND it onto any slab query. */
export async function physicalSlabWhere(): Promise<Prisma.ChromiaSlabWhereInput> {
  const earlier = await earlierEntryIds();
  return earlier.length === 0 ? { deletedAt: null } : { deletedAt: null, id: { notIn: earlier } };
}
