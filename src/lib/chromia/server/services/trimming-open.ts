import { ChromiaSlabEventType as SlabEventType, ChromiaTrimmingSource as TrimmingSource } from '@prisma/client';

import type { ChromiaTx } from '@/lib/chromia/db';
import { formatTrim } from '@/lib/chromia/trimming';

const numOrNull = (value: unknown) => (value === null || value === undefined ? null : Number(value));

/**
 * Into Trimming from Slab Entry (7 Nov 2026). A slab graded C → Trimming gets
 * its Trimming record in the QC save's own transaction (applyIntakeGrade), so
 * it is in the Trimming table the moment it is graded — nobody adds it.
 *
 * One record per slab. Graded C → Trimming again before anything was done to
 * it (a QC correction there and back), it keeps what was saved. Graded so
 * again AFTER an earlier trimming was finished, that trimming is kept as a
 * chromia_trimming_attempt (21 Nov 2026), the record's fields are cleared for
 * the new trimming, and the slab's history says what the earlier one was.
 *
 * A module of its own so the QC save can call it without importing the rest
 * of the Trimming service (which itself grades through applyIntakeGrade).
 */
export async function openTrimmingRecord(tx: ChromiaTx, slabId: string, userId: string) {
  const existing = await tx.chromiaTrimming.findUnique({ where: { slabId } });
  if (!existing) {
    await tx.chromiaTrimming.create({ data: { source: TrimmingSource.PRODUCTION, slabId, createdById: userId, updatedById: userId } });
    return;
  }
  if (!existing.qcAt) return;
  // The finished trimming is kept as an attempt of its own (21 Nov 2026), so
  // the Trimming Dashboard counts it — the record is the new attempt.
  const earlier = await tx.chromiaTrimmingAttempt.count({ where: { trimmingId: existing.id } });
  await tx.chromiaTrimmingAttempt.create({
    data: {
      trimmingId: existing.id,
      attemptNumber: earlier + 1,
      trimFromMm: existing.trimFromMm,
      trimToMm: existing.trimToMm,
      sentDate: existing.sentDate,
      receivedDate: existing.receivedDate,
      qcGrade: existing.qcGrade,
      qcDisposition: existing.qcDisposition,
      qcAt: existing.qcAt,
    },
  });
  await tx.chromiaTrimming.update({
    where: { id: existing.id },
    data: { trimFromMm: null, trimToMm: null, sentDate: null, receivedDate: null, qcGrade: null, qcDisposition: null, qcAt: null, updatedById: userId },
  });
  await tx.chromiaSlabEvent.create({
    data: {
      slabId,
      eventType: SlabEventType.CORRECTION,
      userId,
      note: `Sent to Trimming again — the earlier trimming (${formatTrim(numOrNull(existing.trimFromMm), numOrNull(existing.trimToMm)) || 'no From → To'}, Grade ${existing.qcGrade}) is kept in this history`,
    },
  });
}
