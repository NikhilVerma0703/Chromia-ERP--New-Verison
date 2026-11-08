import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { PRODUCTION_PLACES } from '@/lib/chromia/constants/production-places';
import { overallProduction } from '@/lib/chromia/production-overview';
import {
  dailyProduction,
  designBreakdown,
  NO_DESIGN,
  OTHERS,
  parseTrendRange,
  recalibrationAttempts,
  stockDistribution,
  TOP_DESIGNS,
  topDesigns,
  topDesignsWithOthers,
  type ReportSlab,
} from '@/lib/chromia/reports-charts';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const d = (day: string) => new Date(`${day}T00:00:00Z`);
const NOW = new Date('2026-10-28T06:30:00Z'); // 12:00 IST, 28 Oct

const slab = (status: string, design: string | null, day = '2026-10-28', attemptsSent = 0, currentDisposition: string | null = null): ReportSlab => ({
  receivedDate: d(day),
  status,
  currentDisposition,
  design,
  attemptsSent,
});

const yard: ReportSlab[] = [
  slab('IN_STOCK', 'Taj Vein', '2026-10-28', 0, 'STOCK'),
  slab('IN_STOCK', 'Taj Vein', '2026-10-27', 1, 'STOCK'),
  slab('DISPATCHED', 'Taj Vein', '2026-10-20', 0, 'DISPATCH'),
  slab('APPROVED', 'Cristallo', '2026-10-20', 0, 'STOCK'),
  slab('SAMPLE_CUT', 'Cristallo', '2026-10-01', 0, 'SAMPLE_CUTTING'),
  slab('OUT_FOR_RECALIBRATION', 'Cristallo', '2026-10-26', 3, 'RECALIBRATION'),
  slab('IN_PROCESS', null, '2026-10-28', 2),
];

describe('Reports — the four sections (change 11)', () => {
  it('Most Produced Designs: per design, highest first, adding up to every slab', () => {
    const rows = designBreakdown(yard);
    expect(rows.map((r) => [r.design, r.total])).toEqual([
      ['Cristallo', 3],
      ['Taj Vein', 3],
      [NO_DESIGN, 1],
    ]);
    expect(rows.reduce((n, r) => n + r.total, 0)).toBe(yard.length);
  });

  it('Design-wise: each design split into the six places, summing to its total', () => {
    for (const row of designBreakdown(yard)) {
      expect(PRODUCTION_PLACES.reduce((n, p) => n + row.places[p], 0)).toBe(row.total);
    }
    const taj = designBreakdown(yard).find((r) => r.design === 'Taj Vein')!;
    expect(taj.places).toMatchObject({ STOCK: 2, DISPATCHED: 1, APPROVED: 0 });
  });

  it('Stock Distribution: the dashboard’s Current Stock, Dispatched, Approved and Sample Cutting', () => {
    const asDashboard = overallProduction(
      yard.map((s, i) => ({ ...s, id: String(i), slabNo: String(i), currentGrade: null, createdAt: s.receivedDate })),
    );
    expect(stockDistribution(yard)).toEqual([
      { place: 'STOCK', count: asDashboard.currentStock },
      { place: 'DISPATCHED', count: asDashboard.dispatched },
      { place: 'APPROVED', count: asDashboard.approved },
      { place: 'SAMPLE_CUTTING', count: asDashboard.sampleCutting },
    ]);
  });

  it('Recalibration attempts: unique slabs sent for each attempt', () => {
    expect(recalibrationAttempts(yard)).toEqual([
      { attempt: 1, slabs: 3 },
      { attempt: 2, slabs: 2 },
      { attempt: 3, slabs: 1 },
      { attempt: 4, slabs: 0 },
      { attempt: 5, slabs: 0 },
    ]);
  });

  it('Daily trend: every day of the range, a quiet day at 0', () => {
    const week = dailyProduction(yard, parseTrendRange({ range: '7d' }, NOW));
    expect(week.map((p) => p.day)).toEqual(['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28']);
    expect(week.map((p) => p.slabs)).toEqual([0, 0, 0, 0, 1, 1, 2]);
  });
});

describe('Reports — the trend’s range', () => {
  it('reads Today, Last 7 / 30 Days, Month-wise and Custom, in IST', () => {
    expect(parseTrendRange({ range: 'today' }, NOW)).toMatchObject({ fromDay: '2026-10-28', toDay: '2026-10-28' });
    expect(parseTrendRange({}, NOW)).toMatchObject({ kind: '30d', fromDay: '2026-09-29', toDay: '2026-10-28' });
    expect(parseTrendRange({ range: 'month', month: '2026-09' }, NOW)).toMatchObject({ fromDay: '2026-09-01', toDay: '2026-09-30' });
    // The month running now ends today.
    expect(parseTrendRange({ range: 'month', month: '2026-10' }, NOW)).toMatchObject({ fromDay: '2026-10-01', toDay: '2026-10-28' });
    expect(parseTrendRange({ range: 'custom', from: '2026-10-05', to: '2026-10-09' }, NOW)).toMatchObject({ fromDay: '2026-10-05', toDay: '2026-10-09', problem: null });
  });

  it('says what is wrong with a broken custom range, and falls back to Last 30 Days', () => {
    expect(parseTrendRange({ range: 'custom', from: '2026-10-09', to: '2026-10-05' }, NOW).problem).toMatch(/ends before it starts/);
    expect(parseTrendRange({ range: 'custom', from: '', to: '' }, NOW).problem).toMatch(/both dates/);
    expect(parseTrendRange({ range: 'custom', from: '2024-01-01', to: '2026-10-01' }, NOW).problem).toMatch(/a year or less/);
  });
});

describe('Reports — the page', () => {
  const page = read('src/app/chromia/reports/page.tsx');

  it('is charts only, in the four sections asked for', () => {
    const titles = [...page.matchAll(/<Panel\s+title="([^"]+)"/g)].map((m) => m[1]);
    expect(titles).toEqual([
      'Most Produced Designs',
      'Stock Distribution',
      'Recalibration Attempts',
      'Design-Wise Stock & Outcome Analysis',
      'Daily Production Trend',
    ]);
    expect(page).not.toMatch(/<table|<Stat /);
  });

  it('has its loading and error states, and an empty state per chart', () => {
    expect(read('src/app/chromia/reports/loading.tsx')).toMatch(/aria-busy="true"/);
    expect(read('src/app/chromia/reports/error.tsx')).toMatch(/onClick=\{reset\}/);
    expect((page.match(/<EmptyState>/g) ?? []).length).toBe(5);
  });

  it('is named Reports in the navigation', () => {
    expect(read('src/lib/chromia/config/navigation.ts')).toMatch(/\{ title: 'Reports', href: '\/chromia\/reports'/);
    expect(read('src/lib/navModel.ts')).toMatch(/href: "\/chromia\/reports",\s+icon: I\.ceo,\s+label: "Reports"/);
  });
});

describe('Reports — Top 10 designs and Others (change 6, 7 Nov 2026)', () => {
  // Fourteen designs: D1 has 14 slabs, D2 13 … D14 1 — 105 slabs, plus one Trimming slab of D1.
  const many: ReportSlab[] = Array.from({ length: 14 }, (_, i) =>
    Array.from({ length: 14 - i }, () => slab('IN_STOCK', `D${i + 1}`, '2026-10-28', 0, 'STOCK')),
  ).flat();
  many.push(slab('GRADED', 'D1', '2026-10-28', 0, 'TRIMMING'));
  const rows = designBreakdown(many);

  it('Most Produced Designs: the Top 10 by slabs produced, then Others with every remaining design', () => {
    const bars = topDesignsWithOthers(rows);
    expect(bars).toHaveLength(TOP_DESIGNS + 1);
    expect(bars.slice(0, 10).map((b) => b.label)).toEqual(['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10']);
    expect(bars.map((b) => b.value).slice(0, 10)).toEqual([15, 13, 12, 11, 10, 9, 8, 7, 6, 5]);
    expect(bars[10]).toEqual({ label: OTHERS, value: 4 + 3 + 2 + 1, designs: 4 });
    // Every slab is in exactly one bar, so the shares are of the whole and add up to 100%.
    expect(bars.reduce((n, b) => n + b.value, 0)).toBe(many.length);
  });

  it('sorted by volume, not alphabetically: D10 (5) is above D11 … and D2 (13) above D10', () => {
    const labels = topDesignsWithOthers(rows).map((b) => b.label);
    expect(labels.indexOf('D2')).toBeLessThan(labels.indexOf('D10'));
    expect(labels).not.toContain('D11');
  });

  it('no Others bar when there are ten designs or fewer', () => {
    expect(topDesignsWithOthers(designBreakdown(yard)).map((b) => b.label)).not.toContain(OTHERS);
  });

  it('Design-Wise: only the Top 10, each in the seven places — Trimming counted on its own', () => {
    const top = topDesigns(rows);
    expect(top.map((r) => r.design)).toEqual(['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10']);
    expect(PRODUCTION_PLACES).toEqual(['STOCK', 'DISPATCHED', 'APPROVED', 'SAMPLE_CUTTING', 'RECALIBRATION', 'TRIMMING', 'IN_PROCESSING']);
    const d1 = top[0]!;
    expect(d1.places).toMatchObject({ STOCK: 14, TRIMMING: 1, IN_PROCESSING: 0 });
    for (const row of top) expect(PRODUCTION_PLACES.reduce((n, p) => n + row.places[p], 0)).toBe(row.total);
  });

  it('the page draws the Top 10 (with Others) and the Top 10 design-wise', () => {
    const page = read('src/app/chromia/reports/page.tsx');
    expect(page).toMatch(/topDesignsWithOthers\(charts\.designs\)/);
    expect(page).toMatch(/<StackedPlaceBars rows=\{topDesigns\(charts\.designs\)/);
  });
});
