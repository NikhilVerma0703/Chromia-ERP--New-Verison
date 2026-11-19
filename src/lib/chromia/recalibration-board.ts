/**
 * Recalibration board — what the Recalibration page counts and lists
 * (27 Oct 2026). Pure: the repository hands in each slab's saved trips and
 * QC outcome, and everything here is arithmetic on them, so the KPIs, the
 * card a user clicks and the rows under it cannot disagree.
 *
 * WHICH SLABS: those QC sent to recalibration — Grade C → Recalibration at
 * Slab Entry (or again after a pass) — with every trip they have made.
 *
 * EIGHT KPIs IN TWO SECTIONS (19 Nov 2026, the owner's definitions):
 *
 *   OVERALL STATUS — history: EVENTS, so a slab's repeat attempts count again.
 *     Total Recalibrated Slabs   every recalibration record — each time QC sent
 *                                a slab to recalibration, sent yet or not;
 *     Total Sent                 every record with a sent date;
 *     Total Received             every record with a received date;
 *     Total Pending              Sent − Received: the attempts still out (a
 *                                trip cannot be received before it is sent —
 *                                saveTrip refuses).
 *
 *   CURRENT STATUS — now: SLABS, each in at most one card (currentPositionOf).
 *     Ready for Recalibration    awaiting its FIRST send ("Ready for
 *                                Recalibration"); a slab waiting for a 2nd or
 *                                later send is in no card (the owner's choice);
 *     Sent for Recalibration     out at recalibration now, on any attempt;
 *     Received from Recalibration back, not yet reprinted (back on the line);
 *     Available after Recal.     reprinted after its latest attempt, awaiting
 *                                QC = (received in this cycle) − (still waiting
 *                                for reprinting). It leaves the card when QC
 *                                clears it or sends it back.
 *
 * Every card is a view of the table: the Overall cards list one row per event
 * (with its attempt number and dates), the Current cards one row per slab.
 * The count on a card is its rows, always — the same function makes both.
 * With no card chosen, each slab is one row, on its latest trip.
 */
import { attemptsUsed, openTrip, stageOf, type Trip } from '@/lib/chromia/recalibration-flow';
import { isPlantDayKey, plantDayRange } from '@/lib/chromia/plant-time';
import type { RawSearchParams } from '@/lib/chromia/simple-filters';

/** OVERALL STATUS — events, from the beginning. */
export const OVERALL_VIEWS = ['recalibrated', 'sent', 'received', 'pending'] as const;
/** CURRENT STATUS — slabs, where they are now. */
export const CURRENT_VIEWS = ['ready', 'out', 'returned', 'available'] as const;
export const BOARD_VIEWS = [...OVERALL_VIEWS, ...CURRENT_VIEWS] as const;
export type OverallView = (typeof OVERALL_VIEWS)[number];
export type CurrentView = (typeof CURRENT_VIEWS)[number];
export type BoardView = (typeof BOARD_VIEWS)[number];

export const BOARD_VIEW_LABELS: Record<BoardView, string> = {
  recalibrated: 'Total Recalibrated Slabs',
  sent: 'Total Slabs Sent for Recalibration',
  received: 'Total Slabs Received from Recalibration',
  pending: 'Total Pending Slabs from Recalibration',
  ready: 'Ready for Recalibration',
  out: 'Sent for Recalibration',
  returned: 'Received from Recalibration',
  available: 'Available Slabs after Recalibration',
};

export interface BoardSlab {
  id: string;
  disposition: string | null;
  writtenOff: boolean;
  trips: readonly Trip[];
}

export type BoardKpis = Record<BoardView, number>;

/** One table row: a slab, and the trip the row is about (null: none yet). */
export interface BoardRow {
  slabId: string;
  attemptNumber: number | null;
}

const byAttemptDesc = (a: Trip, b: Trip) => b.attemptNumber - a.attemptNumber;

/**
 * Where a slab is NOW, as one Current Status card — or null for none
 * (cleared, written off, waiting for a 2nd or later send, or on the line with
 * no recalibration behind it). Each slab is in at most one card, so the four
 * never count a slab twice between them.
 */
export function currentPositionOf(slab: BoardSlab): CurrentView | null {
  const stage = stageOf(slab);
  switch (stage) {
    case 'AWAITING_SEND':
      // First time only: never sent ("Ready for Recalibration").
      return attemptsUsed(slab.trips) === 0 ? 'ready' : null;
    case 'OUT':
      return 'out';
    case 'RETURNED':
      return 'returned';
    case 'IN_PRODUCTION': {
      // Reprinted: its latest attempt came back and it went back on the line.
      const latest = [...slab.trips].sort(byAttemptDesc)[0];
      return latest?.sentDate && latest.receivedDate && latest.restartedAt ? 'available' : null;
    }
    default:
      return null;
  }
}

/** Does this trip belong in an OVERALL view? Each is one event, counted by its own record. */
function inOverallView(trip: Trip, view: OverallView): boolean {
  const sent = Boolean(trip.sentDate);
  const back = sent && Boolean(trip.receivedDate);
  switch (view) {
    case 'recalibrated':
      return true;
    case 'sent':
      return sent;
    case 'received':
      return back;
    case 'pending':
      return sent && !back;
  }
}

const isOverall = (view: BoardView): view is OverallView => (OVERALL_VIEWS as readonly string[]).includes(view);

/** The eight KPIs — each the number of rows its card shows (boardRows). */
export function boardKpis(slabs: readonly BoardSlab[]): BoardKpis {
  const kpis = Object.fromEntries(BOARD_VIEWS.map((v) => [v, 0])) as BoardKpis;
  for (const slab of slabs) {
    for (const trip of slab.trips) for (const view of OVERALL_VIEWS) if (inOverallView(trip, view)) kpis[view] += 1;
    const position = currentPositionOf(slab);
    if (position) kpis[position] += 1;
  }
  return kpis;
}

/** The trip a slab's own row shows: the open one, else the latest. */
function rowTrip(slab: BoardSlab): Trip | undefined {
  return openTrip(slab.trips) ?? [...slab.trips].sort(byAttemptDesc)[0];
}

/**
 * The rows for a view, in the order the list is read: a slab per row (no
 * view, or a Current Status card), or an event per row (an Overall Status
 * card), newest attempt of each slab first. Rows of one slab stay together.
 */
export function boardRows(slabs: readonly BoardSlab[], view: BoardView | null): BoardRow[] {
  const rows: BoardRow[] = [];
  for (const slab of slabs) {
    if (view === null) {
      rows.push({ slabId: slab.id, attemptNumber: rowTrip(slab)?.attemptNumber ?? null });
    } else if (isOverall(view)) {
      for (const trip of [...slab.trips].sort(byAttemptDesc)) {
        if (inOverallView(trip, view)) rows.push({ slabId: slab.id, attemptNumber: trip.attemptNumber });
      }
    } else if (currentPositionOf(slab) === view) {
      rows.push({ slabId: slab.id, attemptNumber: rowTrip(slab)?.attemptNumber ?? attemptsUsed(slab.trips) + 1 });
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
