import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  buildTrimQuery,
  hasTrimFilters,
  inCurrentView,
  matchesTrimFilters,
  parseTrimFilters,
  trimBoardKpis,
  trimBoardRows,
  trimFilterOptions,
  TRIM_BOARD_VIEWS,
  TRIM_CURRENT_VIEWS,
  TRIM_OVERALL_VIEWS,
  TRIM_VIEW_LABELS,
  type TrimBoardRecord,
} from '@/lib/chromia/trimming-board';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const d = (day: string) => new Date(`${day}T00:00:00Z`);
const attempt = (attemptNumber: number, sent?: string, received?: string, qc?: string) => ({
  attemptNumber,
  sentDate: sent ? d(sent) : null,
  receivedDate: received ? d(received) : null,
  qcAt: qc ? d(qc) : null,
});

// One record at each point of the journey, and one trimmed twice.
const board: TrimBoardRecord[] = [
  { id: 'ready', attempts: [attempt(1)] },
  { id: 'out', attempts: [attempt(1, '2026-11-01')] },
  { id: 'back', attempts: [attempt(1, '2026-11-01', '2026-11-03')] },
  { id: 'clearedA', attempts: [attempt(1, '2026-10-01', '2026-10-03', '2026-10-04')] },
  // Trimmed, cleared, graded C → Trimming again, and out on its 2nd trimming.
  { id: 'twice', attempts: [attempt(1, '2026-09-01', '2026-09-03', '2026-09-04'), attempt(2, '2026-11-10')] },
];

describe('Trimming Dashboard — eight KPIs (21 Nov 2026)', () => {
  it('has the owner’s eight cards, four Overall and four Current, in order', () => {
    expect(TRIM_OVERALL_VIEWS.map((v) => TRIM_VIEW_LABELS[v])).toEqual([
      'Total Trimmed Slabs',
      'Total Slabs Sent for Trimming',
      'Total Slabs Received from Trimming',
      'Total Pending Slabs from Trimming',
    ]);
    expect(TRIM_CURRENT_VIEWS.map((v) => TRIM_VIEW_LABELS[v])).toEqual([
      'Ready for Trimming',
      'Sent for Trimming',
      'Received from Trimming',
      'Available Slabs after Trimming',
    ]);
  });

  it('Overall counts every attempt — repeat trimmings and QC-cleared slabs included', () => {
    const k = trimBoardKpis(board);
    expect(k.trimmed).toBe(6); // 5 records + the earlier trimming of "twice"
    expect(k.sent).toBe(5);
    expect(k.received).toBe(3);
    expect(k.pending).toBe(k.sent - k.received);
    expect(k.pending).toBe(2);
  });

  it('Current counts each slab by its latest trimming', () => {
    const k = trimBoardKpis(board);
    expect(k.ready).toBe(1);
    expect(k.out).toBe(2); // "out" and "twice" (its 2nd trimming)
    expect(k.returned).toBe(2); // "back" and "clearedA"
    expect(k.available).toBe(1); // "back" — received, no QC Report after trimming yet
    expect(inCurrentView(board[3], 'available')).toBe(false);
  });

  it('every card’s count is exactly the rows it shows', () => {
    const k = trimBoardKpis(board);
    for (const view of TRIM_BOARD_VIEWS) expect(trimBoardRows(board, view).length).toBe(k[view]);
  });

  it('an Overall card lists each attempt; a Current card each slab once', () => {
    expect(trimBoardRows(board, 'sent').filter((r) => r.recordId === 'twice').map((r) => r.attemptNumber)).toEqual([2, 1]);
    expect(trimBoardRows(board, 'out').map((r) => r.recordId)).toEqual(['out', 'twice']);
    expect(trimBoardRows(board, null)).toHaveLength(board.length);
    expect(trimBoardRows(board, null).find((r) => r.recordId === 'twice')?.attemptNumber).toBe(2);
  });
});

describe('Trimming → Find a Slab', () => {
  const row = {
    productionDate: new Date('2026-11-20T18:30:00Z'), // 21 Nov, plant day start
    batchNo: 'B-117',
    slabNo: 'S-2045',
    baseMaterial: 'Statuario',
    fileName: 'Calacatta Gold.tif',
  };

  it('reads the five fields and a card, and ignores junk', () => {
    const f = parseTrimFilters({ productionDate: 'nope', batchNo: ' B-117 ', slabNo: '2045', view: 'bogus' });
    expect(f.productionDate).toBe('');
    expect(f.batchNo).toBe('B-117');
    expect(f.view).toBeNull();
    expect(hasTrimFilters(f)).toBe(true);
    expect(hasTrimFilters(parseTrimFilters({ view: 'out' }))).toBe(false);
  });

  it('all five fields work together, each a case-blind contains', () => {
    const all = parseTrimFilters({ productionDate: '2026-11-21', batchNo: 'b-117', slabNo: '2045', baseMaterial: 'statu', fileName: 'gold' });
    expect(matchesTrimFilters(row, all)).toBe(true);
    expect(matchesTrimFilters(row, { ...all, productionDate: '2026-11-20' })).toBe(false);
    expect(matchesTrimFilters(row, { ...all, slabNo: '9999' })).toBe(false);
    expect(matchesTrimFilters({ ...row, fileName: null }, { ...all, fileName: 'gold' })).toBe(false);
    expect(matchesTrimFilters({ ...row, productionDate: null }, parseTrimFilters({}))).toBe(true);
  });

  it('offers the values on the rows, and keeps the card through a search', () => {
    expect(trimFilterOptions([row, { ...row, slabNo: 'S-10' }]).slabNos).toEqual(['S-10', 'S-2045']);
    const f = parseTrimFilters({ slabNo: 'S-1', view: 'ready' });
    expect(buildTrimQuery(f)).toBe('slabNo=S-1&view=ready');
    expect(buildTrimQuery(f, { view: '' })).toBe('slabNo=S-1');
  });
});

describe('Trimming page — four sections, in the owner’s order', () => {
  const page = read('src/app/chromia/trimming/page.tsx');

  it('Dashboard, Trimming Without Design Printing, Find a Slab, Trimming Records', () => {
    const at = ['title="Dashboard"', '<WithoutPrintingForm', '<TrimmingFindASlab', 'title="Trimming Records"'].map((s) => page.indexOf(s));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('Find a Slab narrows the one Trimming Records table — no second table', () => {
    expect(page.match(/<table/g)).toHaveLength(1);
    const form = read('src/app/chromia/trimming/find-a-slab.tsx');
    for (const name of ['productionDate', 'batchNo', 'slabNo', 'baseMaterial', 'fileName']) expect(form).toContain(`name="${name}"`);
    expect(form).toContain('Clear Filters');
    expect(form).toContain('Apply Filters');
    expect(form).toContain('action={APP_ROUTES.trimming}');
  });
});
