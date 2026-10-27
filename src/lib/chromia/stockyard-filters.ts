/**
 * Stockyard → Find a Slab (27 Oct 2026).
 *
 * The three filters every slab list shares (production date, batch, slab —
 * lib/chromia/simple-filters.ts, unchanged) plus the three this page adds:
 * base material, file name / planned design, and the Stock Outcome a slab left
 * the rack by. Any one, or any combination, narrows the In Stock Records table.
 *
 * WHICH SLABS: with no Stock Outcome chosen, the ones still in stock; with one
 * chosen, the ones that left stock that way — so a search reaches the whole
 * history of the yard, and Clear Filters returns to the full In Stock list.
 *
 * Text filters match anywhere in the value, ignoring case, the same way the
 * type-ahead suggests: "ta" finds "Tajvein", and so does picking it.
 */
import {
  hasSimpleFilters,
  parseSimpleFilters,
  simpleSlabWhere,
  type RawSearchParams,
  type SimpleFilters,
} from '@/lib/chromia/simple-filters';
import { STOCK_OUTCOMES, type StockOutcomeValue } from '@/lib/chromia/constants/stock-outcomes';

export interface StockyardFilters extends SimpleFilters {
  baseMaterial: string;
  fileName: string;
  /** Null: still in stock. Otherwise the outcome the slab left by. */
  outcome: StockOutcomeValue | null;
}

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export function parseStockyardFilters(params: RawSearchParams): StockyardFilters {
  const outcome = first(params.outcome).trim();
  return {
    ...parseSimpleFilters(params),
    baseMaterial: first(params.baseMaterial).trim().slice(0, 120),
    fileName: first(params.fileName).trim().slice(0, 120),
    outcome: (STOCK_OUTCOMES as readonly string[]).includes(outcome) ? (outcome as StockOutcomeValue) : null,
  };
}

export function hasStockyardFilters(filters: StockyardFilters): boolean {
  return hasSimpleFilters(filters) || Boolean(filters.baseMaterial || filters.fileName || filters.outcome);
}

/** The slab-level conditions — everything but the outcome, which picks the table. */
export function stockyardSlabWhere(filters: StockyardFilters): Record<string, unknown> {
  const where: Record<string, unknown> = { ...simpleSlabWhere(filters) };
  if (filters.baseMaterial) {
    where.baseMaterial = { name: { contains: filters.baseMaterial, mode: 'insensitive' } };
  }
  if (filters.fileName) {
    // The table shows the planned design's file name, or its name when it has none.
    where.plannedDesign = {
      OR: [
        { fileName: { contains: filters.fileName, mode: 'insensitive' } },
        { name: { contains: filters.fileName, mode: 'insensitive' } },
      ],
    };
  }
  return where;
}

/** The query string for a set of filters — used to key the form so Clear resets it. */
export function buildStockyardQuery(filters: StockyardFilters): string {
  const params = new URLSearchParams();
  const values: Record<string, string> = {
    productionDate: filters.productionDate ? filters.productionDate.toISOString().slice(0, 10) : '',
    batchNo: filters.batchNo,
    slabNo: filters.slabNo,
    baseMaterial: filters.baseMaterial,
    fileName: filters.fileName,
    outcome: filters.outcome ?? '',
  };
  for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
  return params.toString();
}
