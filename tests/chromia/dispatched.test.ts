import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  buildDispatchedQuery,
  dispatchDateWhere,
  dispatchMonthOptions,
  dispatchWindows,
  hasDispatchedFilters,
  monthLabel,
  parseDispatchedFilters,
} from '@/lib/chromia/dispatched-filters';
import { plantDayRange } from '@/lib/chromia/plant-time';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// 10:00 IST on 27 Oct 2026.
const NOW = new Date('2026-10-27T04:30:00Z');
const windows = (params: Record<string, string>) => dispatchWindows(parseDispatchedFilters(params), NOW);

describe('Dispatched → Find a Slab: dispatch-date filters (27 Oct 2026)', () => {
  it('no filter means every dispatched slab', () => {
    const none = parseDispatchedFilters({});
    expect(hasDispatchedFilters(none)).toBe(false);
    expect(dispatchDateWhere(none, NOW)).toEqual({});
  });

  it('Dispatch Date is that one plant day', () => {
    expect(windows({ dispatchDate: '2026-10-20' })).toEqual([{ fromDay: '2026-10-20', toDay: '2026-10-20' }]);
    expect(parseDispatchedFilters({ dispatchDate: '2026-02-31' }).dispatchDate).toBe('');
  });

  it('Last Week is the 7 days ending today, Last Month the 30', () => {
    expect(windows({ range: 'LAST_WEEK' })).toEqual([{ fromDay: '2026-10-21', toDay: '2026-10-27' }]);
    expect(windows({ range: 'LAST_MONTH' })).toEqual([{ fromDay: '2026-09-28', toDay: '2026-10-27' }]);
  });

  it('Month-wise is one whole calendar month', () => {
    expect(windows({ range: 'MONTH', month: '2026-02' })).toEqual([{ fromDay: '2026-02-01', toDay: '2026-02-28' }]);
    expect(windows({ range: 'MONTH', month: '2026-10' })).toEqual([{ fromDay: '2026-10-01', toDay: '2026-10-31' }]);
    // A month-wise range with no month asks for nothing rather than a guess.
    expect(windows({ range: 'MONTH' })).toEqual([]);
  });

  it('Custom is From–To, both days included, either way round', () => {
    expect(windows({ range: 'CUSTOM', from: '2026-10-01', to: '2026-10-15' })).toEqual([{ fromDay: '2026-10-01', toDay: '2026-10-15' }]);
    expect(windows({ range: 'CUSTOM', from: '2026-10-15', to: '2026-10-01' })).toEqual([{ fromDay: '2026-10-01', toDay: '2026-10-15' }]);
    expect(windows({ range: 'CUSTOM', from: '2026-10-10' })).toEqual([{ fromDay: '2026-10-10', toDay: '2026-10-27' }]);
  });

  it('a Dispatch Date and a range together must both hold', () => {
    const where = dispatchDateWhere(parseDispatchedFilters({ dispatchDate: '2026-10-25', range: 'LAST_WEEK' }), NOW);
    expect((where.AND as unknown[]).length).toBe(2);
  });

  it('reads days on the plant calendar: 00:00 to 23:59:59.999 IST', () => {
    const where = dispatchDateWhere(parseDispatchedFilters({ dispatchDate: '2026-10-25' }), NOW) as {
      AND: { dispatchDate: { gte: Date; lte: Date } }[];
    };
    const { from, to } = plantDayRange('2026-10-25', '2026-10-25');
    expect(where.AND[0].dispatchDate).toEqual({ gte: from, lte: to });
    // A Stockyard dispatch stored as 25 Oct 00:00 UTC is inside 25 Oct IST.
    const stored = new Date('2026-10-25T00:00:00Z');
    expect(stored >= from && stored <= to).toBe(true);
  });

  it('offers January 2026 to the current month, newest first, and grows as months begin', () => {
    const october = dispatchMonthOptions(NOW);
    expect(october[0]).toBe('2026-10');
    expect(october.at(-1)).toBe('2026-01');
    expect(october).toHaveLength(10);
    const nextYear = dispatchMonthOptions(new Date('2027-02-03T04:30:00Z'));
    expect(nextYear[0]).toBe('2027-02');
    expect(nextYear).toHaveLength(14);
    expect(monthLabel('2026-10')).toBe('October 2026');
  });

  it('matches batch, material and design anywhere, and round-trips its query', () => {
    const f = parseDispatchedFilters({ baseMaterial: 'Super White', fileName: 'ta', range: 'MONTH', month: '2026-09' });
    const q = new URLSearchParams(buildDispatchedQuery(f));
    expect(q.get('baseMaterial')).toBe('Super White');
    expect(q.get('month')).toBe('2026-09');
    expect(q.get('from')).toBeNull();
  });
});

describe('Dispatched page (27 Oct 2026)', () => {
  const page = read('src/app/chromia/dispatch/page.tsx');
  const form = read('src/app/chromia/dispatch/find-a-slab.tsx');
  const repo = read('src/lib/chromia/server/repositories/dispatch-repository.ts');

  it('is Dashboard, Find a Slab, Dispatched Slabs — and nothing else', () => {
    const titles = [...page.matchAll(/<SectionCard\s+title="([^"]+)"/g)].map((m) => m[1]);
    expect(titles).toEqual(['Dashboard', 'Dispatched Slabs']);
    expect(page.indexOf('<DispatchedFindASlab')).toBeGreaterThan(page.indexOf('title="Dashboard"'));
    expect(page.indexOf('title="Dispatched Slabs"')).toBeGreaterThan(page.indexOf('<DispatchedFindASlab'));
    expect(form).toMatch(/<SectionCard title="Find a Slab"/);
    expect(page).toMatch(/title="Dispatched"/);
  });

  it('shows the three KPIs', () => {
    expect([...page.matchAll(/label="([^"]+Slabs)"/g)].map((m) => m[1])).toEqual([
      'Total Dispatched Slabs',
      'Current Month Dispatched Slabs',
      'Previous Month Dispatched Slabs',
    ]);
  });

  it('lists the columns in exactly the order asked for', () => {
    const head = page.slice(page.indexOf('<thead'), page.indexOf('</thead>'));
    expect([...head.matchAll(/>([^<>]+)<\/th>/g)].map((m) => m[1])).toEqual([
      'Dispatch Date',
      'Production Date',
      'Batch No.',
      'Slab No.',
      'Base Material / Slab Name',
      'File Name / Planned Design',
      'Thickness (cm)',
      'Grade',
      'Slab Remarks',
    ]);
    // Dispatch Date is the dispatch record's date; Production Date the slab's.
    expect(page).toMatch(/dateFmt\.format\(slab\.dispatchDate\)[\s\S]{0,120}dateFmt\.format\(slab\.receivedDate\)/);
  });

  it('is read-only: no action, no form but the filter, nothing that writes', () => {
    expect(page).not.toMatch(/Action\b|SendForm|<form/);
    expect(form).toMatch(/<form method="get"/);
    expect(form).not.toMatch(/useActionState|server\/actions/);
    expect(repo).not.toMatch(/\.(create|update|upsert|delete)(Many)?\(/);
  });

  it('counts each dispatched slab once, the same way for the KPIs and the table', () => {
    expect(repo).toMatch(/async function countDispatchedSlabs[\s\S]{0,200}distinct: \['slabId'\]/);
    const list = repo.slice(repo.indexOf('export async function listDispatchedSlabs('));
    expect(list).toMatch(/distinct: \['slabId'\]/);
    expect(repo).toMatch(/countDispatchedSlabs\(\{\}\),/);
  });

  it('makes Dispatch Date and Dispatch Date Range the prominent filters', () => {
    expect(form).toMatch(/const prominentLabel = 'text-\[15px\] font-semibold text-foreground';/);
    expect(form).toMatch(/htmlFor="dispatchDate" className=\{prominentLabel\}/);
    expect(form).toMatch(/htmlFor="range" className=\{prominentLabel\}/);
    expect(form).toMatch(/Apply Filters/);
    expect(form).toMatch(/Clear Filters/);
  });
});
