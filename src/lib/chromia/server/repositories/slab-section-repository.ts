import { ChromiaTrimmingSource as TrimmingSource } from '@prisma/client';

import { prisma } from '@/lib/chromia/db';
import { sameSlab, slabSection, type SlabSection } from '@/lib/chromia/slab-section';
import { sameSlabNo } from '@/lib/chromia/production-overview';

/**
 * Which section a typed slab number is already in (21 Nov 2026) — read from
 * the database, so every operator sees every other operator's slabs. The
 * candidates are found by the number's start, then held to the same physical
 * slab exactly (sameSlab): 14567 finds 14567 and 14567-A, never 145670.
 *
 * `exceptId` leaves out the slab being corrected on Slab Records Edit.
 */
export async function findSlabSection(slabNo: string, exceptId?: string): Promise<SlabSection | null> {
  const base = sameSlabNo(slabNo);
  if (base === '') return null;
  const [slabs, trimming] = await Promise.all([
    prisma.chromiaSlab.findMany({
      where: { deletedAt: null, slabNo: { startsWith: base, mode: 'insensitive' }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
      select: {
        id: true,
        slabNo: true,
        status: true,
        currentDisposition: true,
        createdAt: true,
        recalibrations: { select: { attemptNumber: true, sentDate: true, receivedDate: true, restartedAt: true } },
      },
    }),
    // Trimming Without Design Printing, not yet graded: a number with no slab yet.
    prisma.chromiaTrimming.findMany({
      where: { source: TrimmingSource.WITHOUT_PRINTING, slabId: null, slabNo: { startsWith: base, mode: 'insensitive' } },
      select: { slabNo: true },
    }),
  ]);
  return slabSection(
    sameSlab(slabNo, slabs.map((s) => ({ ...s, trips: s.recalibrations }))),
    sameSlab(slabNo, trimming.map((t) => ({ slabNo: t.slabNo ?? '' }))),
  );
}

/** Is this exact number a Trimming Without Design Printing record not yet graded? */
export async function isUngradedTrimmingNo(slabNo: string): Promise<boolean> {
  const found = await prisma.chromiaTrimming.findFirst({
    where: { source: TrimmingSource.WITHOUT_PRINTING, slabId: null, slabNo: { equals: slabNo.trim(), mode: 'insensitive' } },
    select: { id: true },
  });
  return Boolean(found);
}
