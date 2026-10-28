import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { PLACE_COLORS, PRODUCTION_PLACES, placeOf } from '@/lib/chromia/constants/production-places';
import {
  latestPerSlab,
  overallProduction,
  parseProcessingView,
  processingSlabs,
  sameSlabNo,
  todayProduction,
  type OverviewSlab,
} from '@/lib/chromia/production-overview';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const d = (day: string) => new Date(`${day}T00:00:00Z`);
let seq = 0;
const slab = (slabNo: string, status: string, over: Partial<OverviewSlab> = {}): OverviewSlab => ({
  id: `id-${slabNo}`,
  slabNo,
  status,
  currentDisposition: null,
  currentGrade: null,
  receivedDate: d('2026-10-27'),
  createdAt: new Date(Date.UTC(2026, 9, 1) + seq++ * 1000),
  ...over,
});

const TODAY = '2026-10-27';
const yard: OverviewSlab[] = [
  slab('100', 'IN_STOCK', { currentDisposition: 'STOCK', currentGrade: 'A' }),
  slab('101', 'DISPATCHED', { receivedDate: d('2026-10-20') }),
  slab('102', 'APPROVED', { receivedDate: d('2026-10-20') }),
  slab('103', 'SAMPLE_CUT', { currentDisposition: 'SAMPLE_CUTTING', currentGrade: 'B' }),
  slab('104', 'GRADED', { currentDisposition: 'RECALIBRATION', currentGrade: 'C' }),
  slab('105', 'OUT_FOR_RECALIBRATION', { currentDisposition: 'RECALIBRATION' }),
  slab('106', 'WASTE', { currentDisposition: 'RECALIBRATION', receivedDate: d('2026-09-01') }),
  slab('107', 'IN_PROCESS'),
  slab('108', 'RECEIVED', { receivedDate: d('2026-10-26') }),
  // Entered twice: 14567 first, 14567-A later — one slab, where -A is.
  slab('14567', 'SAMPLE_CUT', { currentDisposition: 'SAMPLE_CUTTING', currentGrade: 'B' }),
  slab('14567-A', 'IN_PROCESS'),
];

describe('one slab, however many times it was entered', () => {
  it('14567 and 14567-A are one slab; 14567-2 is another', () => {
    expect(sameSlabNo('14567-A')).toBe('14567');
    expect(sameSlabNo(' 14567-a ')).toBe('14567');
    expect(sameSlabNo('14567-2')).toBe('14567-2');
  });

  it('counts it once, where its latest record is', () => {
    const latest = latestPerSlab(yard);
    expect(latest).toHaveLength(10);
    expect(latest.find((s) => sameSlabNo(s.slabNo) === '14567')?.slabNo).toBe('14567-A');
  });
});

describe('Overall Production and the palette', () => {
  const overall = overallProduction(yard);

  it('the six KPIs', () => {
    expect(overall).toMatchObject({
      produced: 10,
      inProcessing: 3, // 107, 108, 14567-A
      currentStock: 1,
      dispatched: 1,
      approved: 1,
      sampleCutting: 1, // 14567 moved on to -A
    });
  });

  it('every slab is in exactly one place, so the palette adds up to Total Produced', () => {
    const sum = PRODUCTION_PLACES.reduce((n, place) => n + overall.places[place], 0);
    expect(sum).toBe(overall.produced);
    // Graded C not yet sent, out at recalibration, written off: all Recalibration.
    expect(overall.places.RECALIBRATION).toBe(3);
  });

  it('places by status, a GRADED slab by its outcome', () => {
    expect(placeOf({ status: 'GRADED', currentDisposition: 'RECALIBRATION' })).toBe('RECALIBRATION');
    expect(placeOf({ status: 'GRADED', currentDisposition: 'STOCK' })).toBe('IN_PROCESSING');
    expect(placeOf({ status: 'RECEIVED_FROM_RECALIBRATION', currentDisposition: 'RECALIBRATION' })).toBe('RECALIBRATION');
    expect(placeOf({ status: 'UNDER_INSPECTION', currentDisposition: null })).toBe('IN_PROCESSING');
  });
});

describe("Today's Production", () => {
  const today = todayProduction(
    {
      slabs: yard,
      dispatchedToday: ['101'],
      approvedToday: ['102'],
      // 103 was cut at QC today as well: still one slab.
      sampleCutFromStockToday: ['200', '103'],
    },
    TODAY,
  );

  it('follows today’s production to where it is now', () => {
    // Made today: 100, 103, 104, 105, 107, 14567 / 14567-A.
    expect(today.produced).toBe(6);
    expect(today.inProcessing).toBe(2);
    expect(today.stock).toBe(1);
  });

  it('counts the day’s Stockyard work whatever day the slab was made, each slab once', () => {
    expect(today.dispatched).toBe(1);
    expect(today.approved).toBe(1);
    expect(today.sampleCutting).toBe(2); // 103 (QC and stock), 200 (stock)
  });
});

describe('the clickable In-Processing KPIs', () => {
  it('each table lists exactly what its KPI counts', () => {
    expect(processingSlabs(yard, 'processing', TODAY)).toHaveLength(overallProduction(yard).inProcessing);
    expect(processingSlabs(yard, 'today-processing', TODAY).map((s) => s.slabNo).sort()).toEqual(['107', '14567-A']);
    expect(parseProcessingView('today-processing')).toBe('today-processing');
    expect(parseProcessingView('nonsense')).toBeNull();
  });

  it('the page: two headings, six and six KPIs, the In-Processing ones links', () => {
    const page = read('src/app/chromia/dashboard/page.tsx');
    expect([...page.matchAll(/<SectionHeading[^>]*>([^<]+)<\/SectionHeading>/g)].map((m) => m[1])).toEqual([
      'Overall Production',
      'Today&rsquo;s Production',
    ]);
    const labels = [...page.matchAll(/label="([^"]+)"/g)].map((m) => m[1]);
    expect(labels).toEqual([
      'Total Produced Slabs', 'Total In Processing Slabs', 'Total Current Stock Slabs',
      'Total Dispatched Slabs', 'Total Approved Slabs', 'Total Sample Cutting Slabs',
      'Today Produced', 'Today In-Processing', 'Today Stock', 'Today Dispatched', 'Today Approved', 'Today Sample Cutting',
    ]);
    expect(page).not.toMatch(/Where they are/);
    expect(page).toMatch(/<KpiLink view="processing"/);
    expect(page).toMatch(/<KpiLink view="today-processing"/);
  });
});

describe('one palette across the ERP', () => {
  it('six distinct colours', () => {
    expect(new Set(Object.values(PLACE_COLORS)).size).toBe(6);
  });

  it('the CSS tokens and Tailwind colours are the palette’s', () => {
    const css = read('src/app/globals.css');
    const tw = read('tailwind.config.ts');
    const token = { STOCK: 'stock', DISPATCHED: 'done', APPROVED: 'approved', SAMPLE_CUTTING: 'hold', RECALIBRATION: 'recalibration', IN_PROCESSING: 'processing' } as const;
    for (const place of PRODUCTION_PLACES) {
      expect(css).toContain(`--color-status-${token[place]}: ${PLACE_COLORS[place]};`);
      expect(tw).toMatch(new RegExp(`${token[place]}: "${PLACE_COLORS[place]}"`));
    }
  });

  it('Stockyard counts Dispatched, Approved and Sample Cutting by status, as the dashboard does', () => {
    const repo = read('src/lib/chromia/server/repositories/stockyard-repository.ts');
    expect(repo).toMatch(/at\(SlabStatus\.DISPATCHED\),\n\s+at\(SlabStatus\.APPROVED\),\n\s+at\(SlabStatus\.SAMPLE_CUT\),/);
  });
});
