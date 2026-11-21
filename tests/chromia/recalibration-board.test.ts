import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  BOARD_VIEW_LABELS,
  BOARD_VIEWS,
  boardKpis,
  boardRows,
  CURRENT_VIEWS,
  currentPositionOf,
  OVERALL_VIEWS,
  boardSlabWhere,
  buildBoardQuery,
  hasBoardFilters,
  parseBoardFilters,
  type BoardSlab,
} from '@/lib/chromia/recalibration-board';
import { statusLabel } from '@/lib/chromia/recalibration-flow';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const d = (day: string) => new Date(`${day}T00:00:00Z`);
const trip = (attemptNumber: number, sent?: string, received?: string, restarted?: string) => ({
  attemptNumber,
  sentDate: sent ? d(sent) : null,
  receivedDate: received ? d(received) : null,
  restartedAt: restarted ? d(restarted) : null,
});

// A small board, one slab at each point of the journey.
const board: BoardSlab[] = [
  { id: 'ready', disposition: 'RECALIBRATION', writtenOff: false, trips: [trip(1)] },
  { id: 'out1', disposition: 'RECALIBRATION', writtenOff: false, trips: [trip(1, '2026-10-01')] },
  { id: 'back1', disposition: 'RECALIBRATION', writtenOff: false, trips: [trip(1, '2026-09-20', '2026-10-02')] },
  { id: 'inprod', disposition: null, writtenOff: false, trips: [trip(1, '2026-09-10', '2026-09-20', '2026-09-21')] },
  { id: 'need2', disposition: 'RECALIBRATION', writtenOff: false, trips: [trip(1, '2026-09-01', '2026-09-05', '2026-09-06'), trip(2)] },
  { id: 'out2', disposition: 'RECALIBRATION', writtenOff: false, trips: [trip(1, '2026-08-01', '2026-08-05', '2026-08-06'), trip(2, '2026-10-10')] },
  { id: 'clearedA', disposition: 'STOCK', writtenOff: false, trips: [trip(1, '2026-08-10', '2026-08-15', '2026-08-16')] },
];

describe('Recalibration Dashboard — the eight KPIs (19 Nov 2026)', () => {
  it('has OVERALL STATUS and CURRENT STATUS, four cards each, named as asked', () => {
    expect(OVERALL_VIEWS.map((v) => BOARD_VIEW_LABELS[v])).toEqual([
      'Total Recalibrated Slabs',
      'Total Slabs Sent for Recalibration',
      'Total Slabs Received from Recalibration',
      'Total Pending Slabs from Recalibration',
    ]);
    expect(CURRENT_VIEWS.map((v) => BOARD_VIEW_LABELS[v])).toEqual([
      'Ready for Recalibration',
      'Sent for Recalibration',
      'Received from Recalibration',
      'Available Slabs after Recalibration',
    ]);
  });

  it('OVERALL STATUS counts every event, repeat attempts included; Pending = Sent − Received', () => {
    const kpis = boardKpis(board);
    // records: ready 1, out1 1, back1 1, inprod 1, need2 2, out2 2, clearedA 1 = 9.
    expect(kpis.recalibrated).toBe(9);
    // sent: out1, back1, inprod, need2#1, out2#1, out2#2, clearedA = 7.
    expect(kpis.sent).toBe(7);
    // received: back1, inprod, need2#1, out2#1, clearedA = 5.
    expect(kpis.received).toBe(5);
    expect(kpis.pending).toBe(2);
    expect(kpis.pending).toBe(kpis.sent - kpis.received);
  });

  it('CURRENT STATUS counts slabs where they are now, each once', () => {
    const kpis = boardKpis(board);
    // Ready: never sent — 'ready' only; 'need2' waits for its 2nd send and is in no card.
    expect(kpis.ready).toBe(1);
    // Sent now: out1 (1st attempt) and out2 (2nd attempt).
    expect(kpis.out).toBe(2);
    // Received, not yet reprinted: back1.
    expect(kpis.returned).toBe(1);
    // Received and not yet reprinted, any attempt (21 Nov 2026): back1 — every other receipt was reprinted.
    expect(kpis.available).toBe(1);
    expect(Object.fromEntries(board.map((s) => [s.id, currentPositionOf(s)]))).toEqual({
      ready: 'ready', out1: 'out', back1: 'returned', inprod: null, need2: null, out2: 'out', clearedA: null,
    });
    // No slab in two of Ready, Sent and Received (Available counts receipts).
    const ids = CURRENT_VIEWS.filter((v) => v !== 'available').flatMap((v) => boardRows(board, v).map((r) => r.slabId));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the owner\'s examples: 11 first attempts + 5 repeats = 16; 3 sent, 2 received, 1 reprinted → Available 1 (the one not reprinted)', () => {
    const many: BoardSlab[] = [
      ...Array.from({ length: 6 }, (_, i) => ({ id: `once${i}`, disposition: 'STOCK', writtenOff: false, trips: [trip(1, '2026-09-01', '2026-09-05', '2026-09-06')] })),
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `twice${i}`, disposition: 'STOCK', writtenOff: false,
        trips: [trip(1, '2026-09-01', '2026-09-05', '2026-09-06'), trip(2, '2026-09-10', '2026-09-15', '2026-09-16')],
      })),
    ];
    expect(boardKpis(many).recalibrated).toBe(16);
    expect(boardKpis(many).sent).toBe(16);

    const three: BoardSlab[] = [
      { id: 'still-out', disposition: 'RECALIBRATION', writtenOff: false, trips: [trip(1, '2026-11-01')] },
      { id: 'back', disposition: 'RECALIBRATION', writtenOff: false, trips: [trip(1, '2026-11-01', '2026-11-05')] },
      { id: 'reprinted', disposition: null, writtenOff: false, trips: [trip(1, '2026-11-01', '2026-11-05', '2026-11-06')] },
    ];
    const k = boardKpis(three);
    expect([k.sent, k.received, k.out, k.returned, k.available]).toEqual([3, 2, 1, 1, 1]);
    // Available (21 Nov 2026) = Total Received (2) − already reprinted (1): 'back'.
    expect(boardRows(three, 'available')).toEqual([{ slabId: 'back', attemptNumber: 1 }]);
  });

  it('Available counts receipts of EVERY attempt not yet reprinted, and leaves out written-off slabs (21 Nov 2026)', () => {
    const slabs: BoardSlab[] = [
      // A: 1st receipt reprinted, 2nd received and waiting.
      { id: 'A', disposition: 'RECALIBRATION', writtenOff: false, trips: [trip(1, '2026-10-01', '2026-10-03', '2026-10-04'), trip(2, '2026-10-10', '2026-10-12')] },
      // B: received once and reprinted.
      { id: 'B', disposition: null, writtenOff: false, trips: [trip(1, '2026-10-01', '2026-10-03', '2026-10-04')] },
      // C: received once, waiting.
      { id: 'C', disposition: 'RECALIBRATION', writtenOff: false, trips: [trip(1, '2026-10-01', '2026-10-03')] },
      // D: a 1st receipt never reprinted, on a slab out again (as data may hold).
      { id: 'D', disposition: 'RECALIBRATION', writtenOff: false, trips: [trip(1, '2026-09-01', '2026-09-03'), trip(2, '2026-10-20')] },
      // W: written off — never reprinted, so not available.
      { id: 'W', disposition: 'RECALIBRATION', writtenOff: true, trips: [trip(1, '2026-09-01', '2026-09-03')] },
    ];
    const k = boardKpis(slabs);
    expect(k.received).toBe(6);
    expect(k.available).toBe(3);
    expect(boardRows(slabs, 'available')).toEqual([
      { slabId: 'A', attemptNumber: 2 },
      { slabId: 'C', attemptNumber: 1 },
      { slabId: 'D', attemptNumber: 1 },
    ]);
  });

  it('each card lists exactly what it counts — all eight', () => {
    const kpis = boardKpis(board);
    for (const view of BOARD_VIEWS) expect(boardRows(board, view), view).toHaveLength(kpis[view]);
    expect(boardRows(board, 'pending')).toEqual([
      { slabId: 'out1', attemptNumber: 1 },
      { slabId: 'out2', attemptNumber: 2 },
    ]);
  });

  it('with no card chosen, every slab is one row, on its open or latest trip', () => {
    const rows = boardRows(board, null);
    expect(rows).toHaveLength(board.length);
    expect(rows.find((r) => r.slabId === 'out2')).toEqual({ slabId: 'out2', attemptNumber: 2 });
    expect(rows.find((r) => r.slabId === 'need2')).toEqual({ slabId: 'need2', attemptNumber: 2 });
  });

  it('a slab sent twice is two Sent trips, not a duplicate slab row', () => {
    expect(boardRows(board, 'sent').filter((r) => r.slabId === 'out2')).toEqual([
      { slabId: 'out2', attemptNumber: 2 },
      { slabId: 'out2', attemptNumber: 1 },
    ]);
    expect(boardRows(board, null).filter((r) => r.slabId === 'out2')).toHaveLength(1);
  });
});

describe('Recalibration board — the statuses, derived from the saved dates and QC', () => {
  const label = (id: string, grade?: string) => {
    const slab = board.find((s) => s.id === id)!;
    return statusLabel(slab, grade);
  };
  it('walks the journey in the words asked for', () => {
    expect(label('ready')).toBe('Ready for Recalibration');
    expect(label('out1')).toBe('Sent for 1st Time Recalibration');
    expect(label('back1')).toBe('Received from the 1st Time Recalibration');
    expect(label('inprod')).toBe('In Processing — After Attempt 1');
    expect(label('need2')).toBe('Need 2nd Time Recalibration');
    expect(label('out2')).toBe('Sent for 2nd Time Recalibration');
    expect(label('clearedA', 'A')).toBe('Cleared — Grade A: Stock');
  });
});

describe('Recalibration → Find a Slab', () => {
  it('reads the five fields and the KPI card; the card is not a filter', () => {
    const f = parseBoardFilters({ productionDate: '2026-10-20', batchNo: '13', slabNo: '9001', baseMaterial: 'astral', fileName: 'taj', view: 'sent' });
    expect(f.view).toBe('sent');
    expect(hasBoardFilters(f)).toBe(true);
    expect(hasBoardFilters(parseBoardFilters({ view: 'ready' }))).toBe(false);
    expect(parseBoardFilters({ view: 'nonsense' }).view).toBeNull();
    const where = boardSlabWhere(f);
    expect(where.slabNo).toEqual({ contains: '9001', mode: 'insensitive' });
    expect(where.baseMaterial).toEqual({ name: { contains: 'astral', mode: 'insensitive' } });
    expect(where).toHaveProperty('receivedDate');
  });

  it('keeps the card through a search, and a card click toggles it', () => {
    const f = parseBoardFilters({ batchNo: '13', view: 'sent' });
    expect(new URLSearchParams(buildBoardQuery(f)).get('view')).toBe('sent');
    expect(new URLSearchParams(buildBoardQuery(f, { view: '' })).get('view')).toBeNull();
    expect(new URLSearchParams(buildBoardQuery(f, { page: '2' })).get('page')).toBe('2');
  });
});

describe('Recalibration page and the unified form', () => {
  const page = read('src/app/chromia/recalibrations/page.tsx');
  const form = read('src/app/chromia/recalibrations/[slabId]/slab-form.tsx');
  const action = read('src/lib/chromia/server/actions/recalibration-flow.ts');

  it('is Dashboard, Find a Slab, Recalibration Records — each KPI card a link', () => {
    const titles = [...page.matchAll(/<SectionCard\s+title="([^"]+)"/g)].map((m) => m[1]);
    expect(titles).toEqual(['Dashboard', 'Recalibration Records']);
    expect(page.indexOf('<RecalibrationFindASlab')).toBeGreaterThan(page.indexOf('title="Dashboard"'));
    expect(page.indexOf('title="Recalibration Records"')).toBeGreaterThan(page.indexOf('<RecalibrationFindASlab'));
    // Two sections of four cards, every card a link to its own rows (19 Nov 2026).
    expect(page).toMatch(/\['OVERALL STATUS', [^\n]+, OVERALL_VIEWS\],\n\s+\['CURRENT STATUS', [^\n]+, CURRENT_VIEWS\],/);
    expect(page).toMatch(/views\.map\(\(view\) => \{[\s\S]{0,300}<Link\s+key=\{view\}\s+href=\{cardHref\(view\)\}/);
    expect(page).toMatch(/slabs \? 'Click to View Slabs' : 'Click to view'/);
    expect(page).toMatch(/<div id="records" className="scroll-mt-6">/);
  });

  it('lists the fourteen columns in exactly the order asked for, the Slab No. bold, then Action (28 Oct 2026)', () => {
    const head = page.slice(page.indexOf('<thead'), page.indexOf('</thead>'));
    expect([...head.matchAll(/>([^<>]+)<\/th>/g)].map((m) => m[1])).toEqual([
      'Production Date', 'Batch No.', 'Slab No.', 'Base Material / Slab Name', 'File Name / Planned Design',
      'Thickness (cm)', 'Grade', 'Slab Outcome', 'Reason for Recalibration', 'Slab Remarks',
      'Attempt Number', 'Sent Date', 'Received Date', 'Current Status', 'Action',
    ]);
    expect(page).toMatch(/href=\{`\$\{APP_ROUTES\.recalibrations\}\/\$\{row\.slabId\}`\}[\s\S]{0,400}font-bold/);
  });

  it('opens one form with all three parts and one Update Slab button', () => {
    const order = ['title="A. Send and Receive"', 'title="B. Update Slab Details"', 'title="C. QC Report"', "'Update Slab'"];
    const at = order.map((s) => form.indexOf(s));
    expect(at.every((i, n) => i > 0 && (n === 0 || i > at[n - 1]))).toBe(true);
    expect((form.match(/type="submit"/g) ?? []).length).toBe(1);
    expect(form).toMatch(/hint="Leave empty until the slab comes back — save the Sent Date alone"/);
  });

  it('saves only what changed, checks everything first, then writes in the slab’s own order', () => {
    const save = action.slice(action.indexOf('export async function updateRecalibrationSlabAction('));
    const checked = save.indexOf('if (Object.keys(errors).length) return { fieldErrors: errors };');
    const order = ['await saveTrip(slabId, trip, user.id);', 'await restartProduction(restartInput, user.id);', 'await updateSlabRecord(correction, user.id);', 'await setTripReason(', 'await completeSlabAction({}, qc);'];
    const at = order.map((s) => save.indexOf(s));
    expect(checked).toBeGreaterThan(0);
    expect(at.every((i, n) => i > checked && (n === 0 || i > at[n - 1]))).toBe(true);
    // No slab is created here.
    expect(save).not.toMatch(/chromiaSlab\.create|recordOperatorEntry/);
    // The grade's outcome is the server's to set for A and C.
    expect(save).toMatch(/const disposition = allowed\.length === 1 \? allowed\[0\] : get\('disposition'\);/);
  });
});

describe('Slab Entry QC Report — Reason for Recalibration', () => {
  it('sits directly above Slab Remarks, apart from it, for Grade C', () => {
    const qc = read('src/app/chromia/slabs/new/qc-section.tsx');
    const reason = qc.indexOf('label="Reason for Recalibration"');
    const remarks = qc.indexOf('label="Slab Remarks"');
    expect(reason).toBeGreaterThan(0);
    expect(remarks).toBeGreaterThan(reason);
    expect(qc).toMatch(/\{disposition === Disposition\.RECALIBRATION \? \(\n\s+<FieldGrid>\n\s+<Field\n\s+label="Reason for Recalibration"/);
  });
});
