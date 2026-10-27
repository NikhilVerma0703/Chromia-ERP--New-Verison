/**
 * Approved Slabs → Find a Slab (27 Oct 2026).
 *
 * Approved Date — the day the slab was sent from the Stockyard as Approved,
 * on the plant calendar (IST) — and batch, material and design, matching
 * anywhere in the value and ignoring case, as the type-ahead suggests. Any one
 * or any mix narrows the same table.
 */
import { isPlantDayKey, plantDayRange } from '@/lib/chromia/plant-time';
import type { RawSearchParams } from '@/lib/chromia/simple-filters';

export interface ApprovedFilters {
  approvedDate: string;
  batchNo: string;
  baseMaterial: string;
  fileName: string;
}

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return (value ?? '').trim();
}

export function parseApprovedFilters(params: RawSearchParams): ApprovedFilters {
  const approvedDate = first(params.approvedDate);
  return {
    approvedDate: isPlantDayKey(approvedDate) ? approvedDate : '',
    batchNo: first(params.batchNo).slice(0, 80),
    baseMaterial: first(params.baseMaterial).slice(0, 120),
    fileName: first(params.fileName).slice(0, 120),
  };
}

export function hasApprovedFilters(f: ApprovedFilters): boolean {
  return Boolean(f.approvedDate || f.batchNo || f.baseMaterial || f.fileName);
}

/** Prisma condition on the approving stock entry's date (released_at). */
export function approvedDateWhere(f: ApprovedFilters): Record<string, unknown> {
  if (!f.approvedDate) return {};
  const { from, to } = plantDayRange(f.approvedDate, f.approvedDate);
  return { releasedAt: { gte: from, lte: to } };
}

/** Prisma condition on the approved slab for batch, material and design. */
export function approvedSlabWhere(f: ApprovedFilters): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (f.batchNo) where.batch = { batchNo: { contains: f.batchNo, mode: 'insensitive' } };
  if (f.baseMaterial) where.baseMaterial = { name: { contains: f.baseMaterial, mode: 'insensitive' } };
  if (f.fileName) {
    where.plannedDesign = {
      OR: [
        { fileName: { contains: f.fileName, mode: 'insensitive' } },
        { name: { contains: f.fileName, mode: 'insensitive' } },
      ],
    };
  }
  return where;
}

export function buildApprovedQuery(f: ApprovedFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(f)) if (value) params.set(key, value);
  return params.toString();
}
