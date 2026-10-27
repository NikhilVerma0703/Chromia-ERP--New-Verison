import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { addPlantDays } from '@/lib/chromia/plant-time';
import { STOCK_OUTCOMES, stockOutcomeSchema, stockyardToday } from '@/lib/chromia/validation/stockyard';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const SLAB = '3badc34f-9f80-46f0-b350-202305b94839';
const parse = (outcome: string, date: string) => stockOutcomeSchema.safeParse({ slabId: SLAB, outcome, date });

describe('Stockyard → Stock Outcome (27 Oct 2026)', () => {
  it('offers exactly Dispatch, Approved and Sample Cutting', () => {
    expect(STOCK_OUTCOMES).toEqual(['DISPATCH', 'APPROVED', 'SAMPLE_CUTTING']);
    expect(parse('RECALIBRATION', stockyardToday()).success).toBe(false);
    expect(parse('', stockyardToday()).success).toBe(false);
  });

  it('accepts today and earlier in IST, and refuses tomorrow', () => {
    const today = stockyardToday();
    for (const outcome of STOCK_OUTCOMES) {
      expect(parse(outcome, today).success).toBe(true);
      expect(parse(outcome, addPlantDays(today, -30)).success).toBe(true);
      const tomorrow = parse(outcome, addPlantDays(today, 1));
      expect(tomorrow.success).toBe(false);
      expect(tomorrow.error?.issues[0]?.message).toBe('The date cannot be in the future');
    }
  });

  it("judges 'today' on the plant's calendar, not the server's", () => {
    // 20:00 UTC on the 27th is 01:30 on the 28th in IST: the 28th is today.
    expect(stockyardToday(new Date('2026-10-27T20:00:00Z'))).toBe('2026-10-28');
    expect(stockyardToday(new Date('2026-10-27T18:00:00Z'))).toBe('2026-10-27');
  });

  it('refuses a day that does not exist', () => {
    expect(parse('DISPATCH', '2026-02-31').success).toBe(false);
  });

  it('lists the columns in the order asked for, Actions renamed Stock Outcome', () => {
    const page = read('src/app/chromia/stockyard/page.tsx');
    const head = page.slice(page.indexOf('<th className={th}>Production Date</th>'), page.indexOf('Stock Outcome</th>') + 20);
    const labels = [...head.matchAll(/>([^<>]+)<\/th>/g)].map((m) => m[1]);
    expect(labels).toEqual([
      'Production Date',
      'Batch Number',
      'Slab Number',
      'Base Material / Slab Name',
      'File Name / Planned Design',
      'Thickness (cm)',
      'Grade',
      'Slab Remarks',
      'Days in Stock',
      'Stock Outcome',
    ]);
    expect(page).not.toMatch(/>Actions<\/th>|<RecalibrateButton/);
  });

  it('caps the row calendar at today in IST', () => {
    const form = read('src/app/chromia/stockyard/stock-outcome-form.tsx');
    expect(form).toMatch(/type="date"\n\s+required\n\s+max=\{today\}/);
    expect(read('src/app/chromia/stockyard/page.tsx')).toMatch(/const today = stockyardToday\(now\);/);
  });

  it('takes the slab off the rack for every outcome, claiming it, and keeps its history', () => {
    const service = read('src/lib/chromia/server/services/stockyard-service.ts');
    const send = service.slice(service.indexOf('export async function sendFromStock('));
    expect(send).toMatch(/if \(slab\.status !== SlabStatus\.IN_STOCK\)/);
    expect(send).toMatch(/recordDispatch\(\{ slabId: slab\.id, dispatchDate: input\.date \}/);
    expect(send).toMatch(/recordSampleCutting\(\{ slabId: slab\.id, cutDate: input\.date \}/);
    expect(send).toMatch(/await claimSlab\(tx, slab, \{ status: SlabStatus\.APPROVED, updatedById: userId \}\);/);
    expect(send).toMatch(/data: \{ releasedAt: input\.date, releaseOutcome: StockOutcome\.APPROVED \}/);
    expect(send).not.toMatch(/\.delete(Many)?\(/);
    const disposition = read('src/lib/chromia/server/services/disposition-service.ts');
    expect(disposition).toMatch(/data: \{ releasedAt: dispatchDate, releaseOutcome: StockOutcome\.DISPATCH \}/);
    expect(disposition).toMatch(/data: \{ releasedAt: cutDate, releaseOutcome: StockOutcome\.SAMPLE_CUTTING \}/);
  });
});
