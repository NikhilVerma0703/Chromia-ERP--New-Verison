import { PRODUCTION_PLACES, placeOf, type ProductionPlace } from './constants/production-places.ts';
import { toPlantDateInput } from './plant-time.ts';

/**
 * The Main Production Dashboard's arithmetic (27 Oct 2026) — pure, so it runs
 * under test without a database; dashboard-repository.ts reads the rows.
 *
 * ONE SLAB, HOWEVER MANY TIMES IT WAS ENTERED. A slab entered again carries a
 * letter: 14567, then 14567-A. Both are the same slab, so the dashboard counts
 * it once, and puts it where its LATEST record is (the owner's decision of
 * 27 Oct 2026). sameSlabNo strips the trailing "-letter(s)"; a number after
 * the hyphen (14567-2) is a different slab and is left alone.
 *
 * TODAY IS TODAY'S DATE IN IST (the owner's instruction for this dashboard),
 * and a stored date is on the IST day it names: Production, Dispatch and
 * Stock Outcome dates are typed days, so each is simply itself.
 */

/** The slab a slab number belongs to: 14567-A → 14567. */
export function sameSlabNo(slabNo: string): string {
  return slabNo.trim().replace(/-[A-Za-z]+$/, '').toUpperCase();
}

export interface OverviewSlab {
  id: string;
  slabNo: string;
  status: string;
  currentDisposition: string | null;
  currentGrade: string | null;
  receivedDate: Date;
  createdAt: Date;
}

/**
 * Each slab once — the latest of its records (the later entry; on a tie the
 * suffixed number, which can only have been entered after the plain one).
 */
export function latestPerSlab<T extends Pick<OverviewSlab, 'slabNo' | 'createdAt'>>(slabs: readonly T[]): T[] {
  const latest = new Map<string, T>();
  for (const slab of slabs) {
    const key = sameSlabNo(slab.slabNo);
    const held = latest.get(key);
    if (
      !held ||
      slab.createdAt.getTime() > held.createdAt.getTime() ||
      (slab.createdAt.getTime() === held.createdAt.getTime() && slab.slabNo.length > held.slabNo.length)
    ) {
      latest.set(key, slab);
    }
  }
  return [...latest.values()];
}

/**
 * The records that are NOT a slab's latest — the earlier entries of a slab
 * entered again — each with the latest record's id. Slab Records leaves these
 * out of its rows and its count (28 Oct 2026), so it lists exactly the slabs
 * Total Produced counts, and shows each one's earlier numbers on its row.
 */
export function earlierEntries<T extends Pick<OverviewSlab, 'id' | 'slabNo' | 'createdAt'>>(
  slabs: readonly T[],
): Map<string, { latestId: string; slabNo: string }> {
  const latest = new Map(latestPerSlab(slabs).map((slab) => [sameSlabNo(slab.slabNo), slab.id]));
  const earlier = new Map<string, { latestId: string; slabNo: string }>();
  for (const slab of slabs) {
    const latestId = latest.get(sameSlabNo(slab.slabNo));
    if (latestId && latestId !== slab.id) earlier.set(slab.id, { latestId, slabNo: slab.slabNo });
  }
  return earlier;
}

export type PlaceCounts = Record<ProductionPlace, number>;

export const emptyPlaceCounts = (): PlaceCounts =>
  Object.fromEntries(PRODUCTION_PLACES.map((place) => [place, 0])) as PlaceCounts;

/** How many slabs are in each place — every slab in exactly one. */
export function countPlaces(slabs: readonly OverviewSlab[]): PlaceCounts {
  const counts = emptyPlaceCounts();
  for (const slab of slabs) counts[placeOf(slab)] += 1;
  return counts;
}

export interface OverallProduction {
  produced: number;
  inProcessing: number;
  currentStock: number;
  dispatched: number;
  approved: number;
  sampleCutting: number;
  /** The palette: the six places, summing to `produced`. */
  places: PlaceCounts;
}

/** Overall Production, over every live slab record. */
export function overallProduction(slabs: readonly OverviewSlab[]): OverallProduction {
  const unique = latestPerSlab(slabs);
  const places = countPlaces(unique);
  return {
    produced: unique.length,
    inProcessing: places.IN_PROCESSING,
    currentStock: places.STOCK,
    dispatched: places.DISPATCHED,
    approved: places.APPROVED,
    sampleCutting: places.SAMPLE_CUTTING,
    places,
  };
}

/** True when a stored date is on this IST day. */
export const onDay = (date: Date | null | undefined, day: string): boolean =>
  Boolean(date) && toPlantDateInput(date as Date) === day;

export interface TodayInputs {
  /** Every live slab record (the same rows Overall Production reads). */
  slabs: readonly OverviewSlab[];
  /** Slab numbers with a dispatch dated today. */
  dispatchedToday: readonly string[];
  /** Slab numbers sent from the Stockyard as Approved today. */
  approvedToday: readonly string[];
  /** Slab numbers sent from the Stockyard to Sample Cutting today. */
  sampleCutFromStockToday: readonly string[];
}

export interface TodayProduction {
  produced: number;
  inProcessing: number;
  stock: number;
  dispatched: number;
  approved: number;
  sampleCutting: number;
}

/**
 * Today's Production. Produced, In-Processing and Stock follow today's
 * production (Production Date today) to where it is now — Stock includes a
 * slab cleared to Stock after a recalibration trip. Dispatched and Approved
 * are the day's Stockyard work, whatever day the slab was made. Sample
 * Cutting is both: today's production cut at QC (Grade B → Sample Cutting),
 * and any slab the Stockyard sent to Sample Cutting today — each slab once.
 */
export function todayProduction(input: TodayInputs, today: string): TodayProduction {
  const made = latestPerSlab(input.slabs.filter((slab) => onDay(slab.receivedDate, today)));
  const places = countPlaces(made);
  const slabs = (nos: readonly string[]) => new Set(nos.map(sameSlabNo));

  const cut = slabs(input.sampleCutFromStockToday);
  for (const slab of made) {
    if (placeOf(slab) === 'SAMPLE_CUTTING' && slab.currentGrade === 'B') cut.add(sameSlabNo(slab.slabNo));
  }

  return {
    produced: made.length,
    inProcessing: places.IN_PROCESSING,
    stock: places.STOCK,
    dispatched: slabs(input.dispatchedToday).size,
    approved: slabs(input.approvedToday).size,
    sampleCutting: cut.size,
  };
}

/** The In-Processing tables behind the two clickable KPIs. */
export const PROCESSING_VIEWS = ['processing', 'today-processing'] as const;
export type ProcessingView = (typeof PROCESSING_VIEWS)[number];

export function parseProcessingView(value: string | string[] | undefined): ProcessingView | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return (PROCESSING_VIEWS as readonly string[]).includes(raw ?? '') ? (raw as ProcessingView) : null;
}

/** The slabs each In-Processing KPI counts — exactly those, newest first. */
export function processingSlabs<T extends OverviewSlab>(slabs: readonly T[], view: ProcessingView, today: string): T[] {
  const pool = view === 'today-processing' ? slabs.filter((slab) => onDay(slab.receivedDate, today)) : slabs;
  return latestPerSlab(pool)
    .filter((slab) => placeOf(slab) === 'IN_PROCESSING')
    .sort((a, b) => b.receivedDate.getTime() - a.receivedDate.getTime() || b.createdAt.getTime() - a.createdAt.getTime());
}
