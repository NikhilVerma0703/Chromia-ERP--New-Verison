/**
 * THE SIX PLACES A CHROMIA SLAB CAN BE, AND THE ONE COLOUR EACH WEARS
 * (27 Oct 2026, the Main Production Dashboard).
 *
 * Every slab produced is in exactly one of these, read from its status:
 *
 *   Current Stock    on the rack now (IN_STOCK) — the Stockyard's Current
 *                    Stock Available
 *   Dispatched       sent out (DISPATCHED), from QC or from the Stockyard
 *   Approved         marked Approved in the Stockyard (APPROVED)
 *   Sample Cutting   cut (SAMPLE_CUT), from QC (Grade B) or from the Stockyard
 *   Recalibration    graded C and not yet cleared, out or back, and the slabs
 *                    written off after their last attempt (the owner's
 *                    decision of 27 Oct 2026)
 *   In-Processing    everything else: QC not done yet, or back on the line
 *                    after a recalibration trip
 *
 * The colours are the ERP's: the dashboard palette, the QC Outcome badges, the
 * status badges, the KPI dots, the charts and the Downloads choices all read
 * them from here (or from the CSS tokens of the same value in globals.css and
 * tailwind.config.ts, which tests/chromia/production-places.test.ts holds to
 * these), so Stock is the same blue on every page.
 *
 * Plain TypeScript with no Prisma import: the node:test suites and the client
 * bundle both read it.
 */

export const PRODUCTION_PLACES = [
  'STOCK',
  'DISPATCHED',
  'APPROVED',
  'SAMPLE_CUTTING',
  'RECALIBRATION',
  'IN_PROCESSING',
] as const;

export type ProductionPlace = (typeof PRODUCTION_PLACES)[number];

export const PLACE_LABELS: Record<ProductionPlace, string> = {
  STOCK: 'Current Stock',
  DISPATCHED: 'Dispatched',
  APPROVED: 'Approved',
  SAMPLE_CUTTING: 'Sample Cutting',
  RECALIBRATION: 'Recalibration',
  IN_PROCESSING: 'In-Processing',
};

/** The six colours — distinct in hue and in lightness, readable on white and dark. */
export const PLACE_COLORS: Record<ProductionPlace, string> = {
  STOCK: '#327dff', // blue
  DISPATCHED: '#16a34a', // green
  APPROVED: '#0891b2', // cyan (was deep teal #0f766e — too close to Dispatched green, and too grey: change 11's palette check)
  SAMPLE_CUTTING: '#d97706', // amber
  RECALIBRATION: '#9333ea', // violet
  IN_PROCESSING: '#64748b', // slate
};

type Status =
  | 'RECEIVED'
  | 'IN_PROCESS'
  | 'UNDER_INSPECTION'
  | 'GRADED'
  | 'OUT_FOR_RECALIBRATION'
  | 'RECEIVED_FROM_RECALIBRATION'
  | 'IN_STOCK'
  | 'SAMPLE_CUT'
  | 'DISPATCHED'
  | 'WASTE'
  | 'ON_HOLD'
  | 'APPROVED';

/**
 * Where one slab is. The status says it for every place but one: a slab QC
 * graded C is GRADED until it is sent, and that is Recalibration, not
 * In-Processing. A GRADED slab with any other outcome has not been placed yet
 * — it is still the line's.
 */
export function placeOf(slab: { status: Status | string; currentDisposition: string | null }): ProductionPlace {
  switch (slab.status) {
    case 'IN_STOCK':
      return 'STOCK';
    case 'DISPATCHED':
      return 'DISPATCHED';
    case 'APPROVED':
      return 'APPROVED';
    case 'SAMPLE_CUT':
      return 'SAMPLE_CUTTING';
    case 'OUT_FOR_RECALIBRATION':
    case 'RECEIVED_FROM_RECALIBRATION':
    case 'WASTE':
      return 'RECALIBRATION';
    case 'GRADED':
      return slab.currentDisposition === 'RECALIBRATION' ? 'RECALIBRATION' : 'IN_PROCESSING';
    default:
      return 'IN_PROCESSING';
  }
}
