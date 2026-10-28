import type { Tone } from '@/components/chromia/ui';
import { placeOf, type ProductionPlace } from '@/lib/chromia/constants/production-places';
import { stageOf, statusLabel, type Trip } from '@/lib/chromia/recalibration-flow';

/**
 * A slab's Current Status on Slab Records (28 Oct 2026) — derived, never
 * stored, from the two rules the rest of the ERP already reads, so no page
 * can say something else:
 *
 *   on its recalibration journey (Grade C → Recalibration, or back on the line
 *   after a trip): the Recalibration page's own words — statusLabel: Ready for
 *   Recalibration, Sent for 1st Time Recalibration, Need 2nd Time
 *   Recalibration, In Processing — After Attempt 1, Written Off / Waste …
 *
 *   anywhere else, including a slab cleared from recalibration: where it is —
 *   placeOf, the dashboard's six places:
 *     In Stock · Dispatch · Approved · Sample Cutting · In-Processing
 *
 * The tone is the place's colour (constants/production-places.ts).
 */

const PLACE_STATUS: Record<ProductionPlace, string> = {
  STOCK: 'In Stock',
  DISPATCHED: 'Dispatch',
  APPROVED: 'Approved',
  SAMPLE_CUTTING: 'Sample Cutting',
  RECALIBRATION: 'Recalibration',
  IN_PROCESSING: 'In-Processing',
};

export const PLACE_TONE: Record<ProductionPlace, Tone> = {
  STOCK: 'stock',
  DISPATCHED: 'done',
  APPROVED: 'approved',
  SAMPLE_CUTTING: 'hold',
  RECALIBRATION: 'recalibration',
  IN_PROCESSING: 'processing',
};

export interface CurrentStatus {
  label: string;
  tone: Tone;
}

export function currentStatusOf(
  slab: { status: string; currentDisposition: string | null; currentGrade: string | null },
  trips: readonly Trip[],
): CurrentStatus {
  const place = placeOf(slab);

  if (trips.length > 0 || slab.currentDisposition === 'RECALIBRATION') {
    const state = { disposition: slab.currentDisposition, writtenOff: slab.status === 'WASTE', trips: [...trips] };
    if (stageOf(state) !== 'CLEARED') {
      return {
        label: statusLabel(state, slab.currentGrade),
        tone: slab.status === 'WASTE' ? 'waste' : PLACE_TONE[place],
      };
    }
  }

  return { label: PLACE_STATUS[place], tone: PLACE_TONE[place] };
}
