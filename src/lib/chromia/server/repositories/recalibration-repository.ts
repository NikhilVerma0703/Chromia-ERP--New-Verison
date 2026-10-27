import { prisma } from '@/lib/chromia/db';

/** Active recalibration reasons for the send form. */
export function listRecalibrationReasons() {
  return prisma.chromiaRecalibrationReason.findMany({
    where: { isActive: true, deletedAt: null },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
}
