import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A SLAB IS MOVED ON ONLY FROM THE STATE IT WAS READ IN — the code review of
 * 20 Oct 2026, CHR-1 and CHR-6, and the review of their fixes.
 *
 * CHR-6 made dispatch, stock, sample cutting and waste claim the slab's row
 * first (claimSlab in disposition-service.ts). Two other writes still checked
 * the slab and then overwrote it, so a dispatch pressed at the same moment
 * could be undone:
 *
 *   • the Edit path's QC reset (resetSlabQcForCorrection) — a slab sent from
 *     the Dispatch page while its Edit was saving went back in the queue with a
 *     dispatch row (CHR-1's symptom), ready to be sent twice (CHR-6's);
 *   • the Stockyard's "send for recalibration" (sendStockToRecalibration) — a
 *     slab dispatched from stock at the same moment ended up on the Dispatch
 *     sheet and waiting on the Recalibration page at once.
 *
 * Both now claim the slab first with the same guarded write. These tests run
 * the real services against a small in-memory stand-in for the database whose
 * transactions roll back on a throw, and let "another device" commit in the gap
 * between a service's read and its transaction — the race the review described.
 * An UPDATE … WHERE in Postgres re-checks the row as last committed, which is
 * what the stand-in's updateMany does.
 */

const db = vi.hoisted(() => {
  type Row = Record<string, any>;
  const TABLES = [
    'chromiaSlab',
    'chromiaProcessCycle',
    'chromiaGradeDecision',
    'chromiaDispatch',
    'chromiaStockEntry',
    'chromiaSampleCutting',
    'chromiaWasteRecord',
    'chromiaSlabEvent',
    'chromiaSlabMovement',
    'chromiaRecalibrationCycle',
    'chromiaLocation',
  ] as const;
  const tables: Record<string, Row[]> = Object.fromEntries(TABLES.map((t) => [t, []]));
  const state = {
    tables,
    /** Runs once, at the next transaction's start: another device's write, committed in the gap. */
    race: null as null | (() => Promise<unknown>),
    seq: 0,
  };

  const matches = (row: Row, where: Row = {}) =>
    Object.entries(where).every(([key, want]) => {
      if (want && typeof want === 'object' && !(want instanceof Date) && 'gte' in want) {
        return row[key] instanceof Date && row[key].getTime() >= want.gte.getTime();
      }
      return (row[key] ?? null) === (want ?? null);
    });

  const sortBy = (rows: Row[], orderBy?: Row) => {
    if (!orderBy) return rows;
    const [key, dir] = Object.entries(orderBy)[0] as [string, 'asc' | 'desc'];
    return [...rows].sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (dir === 'desc' ? -1 : 1));
  };

  const model = (name: string) => ({
    findFirst: async ({ where, orderBy }: { where?: Row; orderBy?: Row } = {}) => {
      const row = sortBy(tables[name].filter((r) => matches(r, where)), orderBy)[0];
      return row ? structuredClone(row) : null;
    },
    create: async ({ data }: { data: Row }) => {
      const row = { id: `${name}-${++state.seq}`, createdAt: new Date(), ...data };
      tables[name].push(row);
      return structuredClone(row);
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const row = tables[name].find((r) => matches(r, where));
      if (!row) throw new Error(`${name}.update: record to update not found`);
      Object.assign(row, data);
      return structuredClone(row);
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const rows = tables[name].filter((r) => matches(r, where));
      for (const row of rows) Object.assign(row, data);
      return { count: rows.length };
    },
    deleteMany: async ({ where }: { where: Row }) => {
      const keep = tables[name].filter((r) => !matches(r, where));
      const count = tables[name].length - keep.length;
      tables[name].splice(0, tables[name].length, ...keep);
      return { count };
    },
  });

  const client: Row = Object.fromEntries(TABLES.map((t) => [t, model(t)]));

  // A slab is read with its relations, as the services select them.
  const slabModel = client.chromiaSlab;
  client.chromiaSlab = {
    ...slabModel,
    findFirst: async (args: { where?: Row }) => {
      const slab = await slabModel.findFirst(args);
      if (!slab) return null;
      const of = (table: string) => tables[table].filter((r) => r.slabId === slab.id);
      return structuredClone({
        ...slab,
        cycles: sortBy(of('chromiaProcessCycle'), { cycleNumber: 'desc' }),
        dispatches: of('chromiaDispatch'),
        recalibrations: sortBy(of('chromiaRecalibrationCycle'), { attemptNumber: 'asc' }),
      });
    },
  };

  client.$transaction = async (work: (tx: Row) => Promise<unknown>) => {
    const race = state.race;
    state.race = null;
    if (race) await race();

    const before = structuredClone(tables);
    try {
      return await work(client);
    } catch (error) {
      for (const table of TABLES) tables[table].splice(0, tables[table].length, ...before[table]);
      throw error;
    }
  };

  const reset = () => {
    for (const table of TABLES) tables[table].length = 0;
    state.race = null;
    state.seq = 0;
  };

  return { prisma: client, state, tables, reset };
});

vi.mock('@/lib/chromia/db', () => ({
  prisma: db.prisma,
  withTransaction: (tx: unknown, work: (tx: unknown) => Promise<unknown>) =>
    tx ? work(tx) : db.prisma.$transaction(work),
}));
vi.mock('@/lib/chromia/logger', () => ({
  createLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }),
}));
vi.mock('@/lib/chromia/inventory-bridge', () => ({
  markSlabsChromia: vi.fn(),
  unmarkSlabsChromia: vi.fn(),
}));
vi.mock('@/lib/chromia/server/services/reference-service', () => ({
  resolveBaseMaterialId: vi.fn(),
  resolveDesignId: vi.fn(),
}));

import { recordDispatch } from '@/lib/chromia/server/services/disposition-service';
import { resetSlabQcForCorrection } from '@/lib/chromia/server/services/intake-outcome-service';
import { releaseFromStock, sendStockToRecalibration } from '@/lib/chromia/server/services/stockyard-service';

const SLAB = 'slab-154321';
const at = (iso: string) => new Date(`${iso}+05:30`);
const RACED = /Slab 154321 was recorded by someone else a moment ago\. Reload the page/;

const slab = () => db.tables.chromiaSlab.find((s) => s.id === SLAB)!;
const rows = (table: string) => db.tables[table].filter((r) => r.slabId === SLAB);
const events = (eventType: string) => rows('chromiaSlabEvent').filter((e) => e.eventType === eventType);

/** Graded at intake on the cycle opened on 2 Oct, as the QC save leaves it. */
function seedGraded(status: string, grade: string, disposition: string) {
  db.tables.chromiaSlab.push({
    id: SLAB,
    slabNo: '154321',
    status,
    currentGrade: grade,
    currentDisposition: disposition,
    currentLocationId: null,
    currentCycleNumber: 1,
    recalibrationCount: 0,
    deletedAt: null,
  });
  db.tables.chromiaProcessCycle.push({
    id: 'cycle-1',
    slabId: SLAB,
    cycleNumber: 1,
    createdAt: at('2026-10-02T09:00:00'),
    finalGrade: grade,
    disposition,
    status: 'COMPLETED',
    completedAt: at('2026-10-02T15:00:00'),
  });
  db.tables.chromiaGradeDecision.push({ id: 'decision-1', cycleId: 'cycle-1', slabId: SLAB, grade, disposition });
}

function seedStocked() {
  seedGraded('IN_STOCK', 'A', 'STOCK');
  db.tables.chromiaStockEntry.push({
    id: 'stock-1',
    slabId: SLAB,
    stockDate: at('2026-10-02T15:00:00'),
    createdAt: at('2026-10-02T15:00:00'),
    releasedAt: null,
  });
}

beforeEach(() => db.reset());

describe('correcting QC (the Edit path) while the slab is being dispatched', () => {
  it('a dispatch that commits first wins: the correction stops with a sentence and changes nothing', async () => {
    seedGraded('GRADED', 'A', 'DISPATCH');
    // The Edit save has read the slab — queued, no dispatch row, so correctable —
    // and the Dispatch page sends it before the reset's first write.
    db.state.race = () => recordDispatch({ slabId: SLAB, dispatchDate: at('2026-10-20T10:00:00') }, 'dispatch-desk');

    await expect(resetSlabQcForCorrection(SLAB, 'qc-incharge')).rejects.toThrow(RACED);

    // The slab has left and stays left: one dispatch, and the grade it left on.
    expect(slab()).toMatchObject({ status: 'DISPATCHED', currentGrade: 'A', currentDisposition: 'DISPATCH' });
    expect(rows('chromiaDispatch')).toHaveLength(1);
    expect(rows('chromiaGradeDecision')).toHaveLength(1);
    expect(db.tables.chromiaProcessCycle[0]).toMatchObject({ status: 'COMPLETED', disposition: 'DISPATCH' });
    expect(events('CORRECTION')).toHaveLength(0);

    // So it is not back in the queue for a second Send.
    await expect(recordDispatch({ slabId: SLAB }, 'dispatch-desk')).rejects.toThrow(/already dispatched/);
    expect(rows('chromiaDispatch')).toHaveLength(1);
  });

  it('a send from the rack that commits first wins the same way', async () => {
    seedStocked();
    db.state.race = () => sendStockToRecalibration({ slabId: SLAB }, 'stockyard');

    await expect(resetSlabQcForCorrection(SLAB, 'qc-incharge')).rejects.toThrow(RACED);

    expect(slab()).toMatchObject({ status: 'GRADED', currentDisposition: 'RECALIBRATION' });
    expect(rows('chromiaRecalibrationCycle')).toHaveLength(1);
    // The stock history the send closed is kept, not deleted by the reset.
    expect(rows('chromiaStockEntry')).toHaveLength(1);
    expect(events('CORRECTION')).toHaveLength(0);
  });

  it('with nobody else on the slab, the correction undoes this pass exactly as before', async () => {
    seedStocked();
    // Stocked on an earlier cycle too: that history is not this pass's and stays.
    db.tables.chromiaStockEntry.push({
      id: 'stock-0',
      slabId: SLAB,
      stockDate: at('2026-09-01T15:00:00'),
      createdAt: at('2026-09-01T15:00:00'),
      releasedAt: at('2026-09-10T15:00:00'),
    });

    await resetSlabQcForCorrection(SLAB, 'qc-incharge');

    expect(slab()).toMatchObject({
      status: 'IN_PROCESS',
      currentGrade: null,
      currentDisposition: null,
      updatedById: 'qc-incharge',
    });
    expect(rows('chromiaStockEntry').map((e) => e.id)).toEqual(['stock-0']);
    expect(rows('chromiaGradeDecision')).toHaveLength(0);
    expect(db.tables.chromiaProcessCycle[0]).toMatchObject({ status: 'ACTIVE', disposition: null, finalGrade: null });
    expect(events('CORRECTION')).toHaveLength(1);
    expect(events('CORRECTION')[0].note).toBe('QC reset for correction — was Grade A → Stock');
  });
});

describe("the Stockyard's two exits, pressed at the same moment", () => {
  it('a dispatch from stock that commits first wins: the send for recalibration writes nothing', async () => {
    seedStocked();
    db.state.race = () => releaseFromStock({ slabId: SLAB, dispatchDate: at('2026-10-20T00:00:00') }, 'dispatch-desk');

    await expect(sendStockToRecalibration({ slabId: SLAB }, 'stockyard')).rejects.toThrow(RACED);

    expect(slab()).toMatchObject({ status: 'DISPATCHED', currentDisposition: 'DISPATCH' });
    expect(rows('chromiaDispatch')).toHaveLength(1);
    // No waiting trip: it is not on the Recalibration page as well.
    expect(rows('chromiaRecalibrationCycle')).toHaveLength(0);
    expect(events('STATUS_CHANGED')).toHaveLength(0);
  });

  it('a send for recalibration that commits first wins: the dispatch from stock writes nothing', async () => {
    seedStocked();
    db.state.race = () => sendStockToRecalibration({ slabId: SLAB }, 'stockyard');

    await expect(
      releaseFromStock({ slabId: SLAB, dispatchDate: at('2026-10-20T00:00:00') }, 'dispatch-desk'),
    ).rejects.toThrow(RACED);

    expect(slab()).toMatchObject({ status: 'GRADED', currentDisposition: 'RECALIBRATION' });
    expect(rows('chromiaDispatch')).toHaveLength(0);
    expect(rows('chromiaRecalibrationCycle')).toHaveLength(1);
  });

  it('with nobody else on the slab, it leaves the rack and waits for recalibration, all in one commit', async () => {
    seedStocked();

    await expect(sendStockToRecalibration({ slabId: SLAB }, 'stockyard')).resolves.toEqual({
      id: SLAB,
      slabNo: '154321',
    });

    expect(slab()).toMatchObject({ status: 'GRADED', currentDisposition: 'RECALIBRATION', updatedById: 'stockyard' });
    // The waiting record QC would open: attempt 1, not sent yet.
    expect(rows('chromiaRecalibrationCycle')).toEqual([
      expect.objectContaining({ attemptNumber: 1, status: 'PENDING_DISPATCH', failedCycleId: 'cycle-1' }),
    ]);
    expect(rows('chromiaRecalibrationCycle')[0].sentDate ?? null).toBeNull();
    expect(rows('chromiaStockEntry')[0].releasedAt).toBeInstanceOf(Date);
    expect(events('STATUS_CHANGED')).toEqual([
      expect.objectContaining({ fromStatus: 'IN_STOCK', toStatus: 'GRADED', note: 'Marked for recalibration from stock' }),
    ]);
  });

  it('a slab whose last attempt was spent in the gap is refused, and nothing is written off behind the button', async () => {
    seedStocked();
    // Four trips sent: one attempt left when the Stockyard reads it…
    for (let n = 1; n <= 4; n += 1) {
      db.tables.chromiaRecalibrationCycle.push({
        id: `trip-${n}`,
        slabId: SLAB,
        attemptNumber: n,
        sentDate: at(`2026-0${n}-01T10:00:00`),
        receivedDate: at(`2026-0${n}-15T10:00:00`),
        restartedAt: at(`2026-0${n}-16T10:00:00`),
      });
    }
    // …and the fifth is recorded as sent before the send's transaction starts.
    db.state.race = async () => {
      db.tables.chromiaRecalibrationCycle.push({
        id: 'trip-5',
        slabId: SLAB,
        attemptNumber: 5,
        sentDate: at('2026-05-01T10:00:00'),
        receivedDate: null,
        restartedAt: null,
      });
    };

    await expect(sendStockToRecalibration({ slabId: SLAB }, 'stockyard')).rejects.toThrow(
      /has used all 5 recalibration attempts/,
    );

    // The write-off markAwaitingRecalibration made is rolled back with the rest:
    // the slab is still on the rack, not waste, and its stock holding is open.
    expect(slab()).toMatchObject({ status: 'IN_STOCK', currentDisposition: 'STOCK' });
    expect(rows('chromiaStockEntry')[0].releasedAt).toBeNull();
    expect(events('DECLARED_WASTE')).toHaveLength(0);
  });
});
