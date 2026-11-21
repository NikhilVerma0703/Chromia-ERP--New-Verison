/**
 * Duplicate Slab Detection on Slab Entry (21 Nov 2026) — which section a slab
 * number is already in. Pure: the repository hands in what the database holds
 * for the number, and this decides the section and the sentence, so Slab
 * Entry's warning and the save's refusal say the same thing.
 *
 * A slab number is a PHYSICAL slab, as everywhere in the module (sameSlabNo):
 * 14567-A is the same slab as 14567, and the slab is where its latest record
 * is. So typing 14567-A while 14567 is in Recalibration warns too.
 *
 *   TRIMMING       a slab graded C → Trimming and still there, or a slab entered
 *                  under Trimming Without Design Printing and not yet graded
 *                  (it is a Trimming record only, not yet a Chromia slab);
 *   RECALIBRATION  a slab on its recalibration journey: waiting to be sent,
 *                  out, back, or back on the line awaiting its QC after a trip.
 *
 * A slab that has left both (cleared to Stock, dispatched …) is in neither.
 */
import { sameSlabNo } from '@/lib/chromia/production-overview';
import { stageOf, type Trip } from '@/lib/chromia/recalibration-flow';

export type SlabSection = 'RECALIBRATION' | 'TRIMMING';

export const SLAB_SECTION_MESSAGES: Record<SlabSection, string> = {
  RECALIBRATION: 'This slab is already present in the RECALIBRATION SECTION.',
  TRIMMING: 'This slab is already present in the TRIMMING SECTION.',
};

/** One live Chromia slab record of the number typed (or of the same physical slab). */
export interface SectionSlab {
  id: string;
  slabNo: string;
  status: string;
  currentDisposition: string | null;
  createdAt: Date;
  trips: readonly Trip[];
}

/** A Trimming Without Design Printing record, not yet graded (no slab yet). */
export interface SectionTrimmingRecord {
  slabNo: string;
}

/** The records that share the typed number's physical slab. */
export function sameSlab<T extends { slabNo: string }>(typed: string, records: readonly T[]): T[] {
  const key = sameSlabNo(typed);
  return key === '' ? [] : records.filter((r) => sameSlabNo(r.slabNo) === key);
}

/** Where a slab record is now, as a section — or null for neither. */
export function sectionOfSlab(slab: SectionSlab): SlabSection | null {
  if (slab.status === 'GRADED' && slab.currentDisposition === 'TRIMMING') return 'TRIMMING';
  const stage = stageOf({ disposition: slab.currentDisposition, writtenOff: slab.status === 'WASTE', trips: slab.trips });
  if (stage === 'AWAITING_SEND' || stage === 'OUT' || stage === 'RETURNED') return 'RECALIBRATION';
  // Back on the line after a trip, its QC not yet given: still the Recalibration page's.
  if (stage === 'IN_PRODUCTION' && slab.trips.length > 0) return 'RECALIBRATION';
  return null;
}

/**
 * The section the typed slab number is already in. `slabs` and `trimming`
 * are the records of the same physical slab; the latest slab record decides
 * (it is where the slab is). An ungraded Without Design Printing record is
 * in Trimming whatever else there is.
 */
export function slabSection(slabs: readonly SectionSlab[], trimming: readonly SectionTrimmingRecord[]): SlabSection | null {
  if (trimming.length > 0) return 'TRIMMING';
  const latest = [...slabs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  return latest ? sectionOfSlab(latest) : null;
}
