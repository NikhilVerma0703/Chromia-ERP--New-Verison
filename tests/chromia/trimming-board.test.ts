import { describe, expect, it } from 'vitest';

import {
  inCurrentView,
  trimBoardKpis,
  trimBoardRows,
  TRIM_BOARD_VIEWS,
  TRIM_CURRENT_VIEWS,
  TRIM_OVERALL_VIEWS,
  TRIM_VIEW_LABELS,
  type TrimBoardRecord,
} from '@/lib/chromia/trimming-board';

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
