/**
 * Recalibration board — what the Recalibration page counts and lists
 * (27 Oct 2026). Pure: the repository hands in each slab's saved trips and
 * QC outcome, and everything here is arithmetic on them, so the KPIs, the
 * card a user clicks and the rows under it cannot disagree.
 *
 * WHICH SLABS: those QC sent to recalibration — Grade C → Recalibration at
 * Slab Entry (or again after a pass) — with every trip they have made.
 *
 * HOW IT COUNTS (the owner's choice): Ready for Recalibration counts SLABS
 * waiting to be sent; Sent, Received and Pending count TRIPS, so a slab sent
 * twice is two in Sent, and Pending = Sent − Received is exactly the trips
 * still out (a trip cannot be received before it is sent — saveTrip refuses).
 *
 * A KPI card is a view of the table: Ready lists those slabs; Sent, Received
 * and Pending list one row per trip of that kind, with its attempt number and
 * dates. With no card chosen, each slab is one row, on its latest trip.
 */
import { attemptsUsed, openTrip, stageOf, type Trip } from '@/lib/chromia/recalibration-flow';
import { isPlantDayKey, plantDayRange } from '@/lib/chromia/plant-time';
import type { RawSearchParams } from '@/lib/chromia/simple-filters';

export const BOARD_VIEWS = ['ready', 'sent', 'received', 'pending'] as const;
export type BoardView = (typeof BOARD_VIEWS)[number];

export const BOARD_VIEW_LABELS: Record<BoardView, string> = {
  ready: 'Ready for Recalibration',
  sent: 'Sent for Recalibration',
  received: 'Received from Calibration',
  pending: 'Pending from Recalibration',
};

export interface BoardSlab {
  id: string;
  disposition: string | null;
  writtenOff: boolean;
  trips: readonly Trip[];
}

export interface BoardKpis {
  ready: number;
  sent: number;
  received: number;
  pending: number;
}

/** One table row: a slab, and the trip the row is about (null: none yet). */
export interface BoardRow {
  slabId: string;
  attemptNumber: number | null;
}

export function boardKpis(slabs: readonly BoardSlab[]): BoardKpis {
  let ready = 0;
  let sent = 0;
  let received = 0;
  for (const slab of slabs) {
    if (stageOf(slab) === 'AWAITING_SEND') ready += 1;
    for (const trip of slab.trips) {
      if (trip.sentDate) sent += 1;
      if (trip.sentDate && trip.receivedDate) received += 1;
    }
  }
  return { ready, sent, received, pending: sent - received };
}

const byAttemptDesc = (a: Trip, b: Trip) => b.attemptNumber - a.attemptNumber;

/** The trip a slab's own row shows: the open one, else the latest. */
function rowTrip(slab: BoardSlab): Trip | undefined {
  return openTrip(slab.trips) ?? [...slab.trips].sort(byAttemptDesc)[0];
}

/**
 * The rows for a view, in the order the list is read: a slab per row (no
 * view, or Ready), or a trip per row (Sent, Received, Pending), newest attempt
 * of each slab first. Rows of one slab stay together.
 */
export function boardRows(slabs: readonly BoardSlab[], view: BoardView | null): BoardRow[] {
  const rows: BoardRow[] = [];
  for (const slab of slabs) {
    switch (view) {
      case null:
        rows.push({ slabId: slab.id, attemptNumber: rowTrip(slab)?.attemptNumber ?? null });
        break;
      case 'ready':
        if (stageOf(slab) === 'AWAITING_SEND') {
          rows.push({ slabId: slab.id, attemptNumber: rowTrip(slab)?.attemptNumber ?? attemptsUsed(slab.trips) + 1 });
        }
        break;
      default:
        for (const trip of [...slab.trips].sort(byAttemptDesc)) {
          const sent = Boolean(trip.sentDate);
          const back = sent && Boolean(trip.receivedDate);
          if ((view === 'sent' && sent) || (view === 'received' && back) || (view === 'pending' && sent && !back)) {
            rows.push({ slabId: slab.id, attemptNumber: trip.attemptNumber });
          }
        }
    }
  }
  return rows;
}

// ─────────────────────────────────────────────────────────── Find a Slab ───

export interface BoardFilters {
  productionDate: string;
  batchNo: string;
  slabNo: string;
  baseMaterial: string;
  fileName: string;
  view: BoardView | null;
}

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return (value ?? '').trim();
}

export function parseBoardFilters(params: RawSearchParams): BoardFilters {
  const productionDate = first(params.productionDate);
  const view = first(params.view);
  return {
    productionDate: isPlantDayKey(productionDate) ? productionDate : '',
    batchNo: first(params.batchNo).slice(0, 80),
    slabNo: first(params.slabNo).slice(0, 80),
    baseMaterial: first(params.baseMaterial).slice(0, 120),
    fileName: first(params.fileName).slice(0, 120),
    view: (BOARD_VIEWS as readonly string[]).includes(view) ? (view as BoardView) : null,
  };
}

/** Any Find a Slab field set — the KPI card chosen is not a filter. */
export function hasBoardFilters(f: BoardFilters): boolean {
  return Boolean(f.productionDate || f.batchNo || f.slabNo || f.baseMaterial || f.fileName);
}

/** Prisma condition on the slab for the Find a Slab fields. */
export function boardSlabWhere(f: BoardFilters): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (f.productionDate) {
    const { from, to } = plantDayRange(f.productionDate, f.productionDate);
    where.receivedDate = { gte: from, lte: to };
  }
  if (f.slabNo) where.slabNo = { contains: f.slabNo, mode: 'insensitive' };
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

/** The query string — `overrides` set (or clear, with '') single keys. */
export function buildBoardQuery(f: BoardFilters, overrides: Partial<Record<keyof BoardFilters | 'page', string>> = {}): string {
  const params = new URLSearchParams();
  const values: Record<string, string> = {
    productionDate: f.productionDate,
    batchNo: f.batchNo,
    slabNo: f.slabNo,
    baseMaterial: f.baseMaterial,
    fileName: f.fileName,
    view: f.view ?? '',
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
  return params.toString();
}
