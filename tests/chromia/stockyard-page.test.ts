import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { buildStockyardQuery, hasStockyardFilters, parseStockyardFilters, stockyardSlabWhere } from '@/lib/chromia/stockyard-filters';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

describe('Stockyard → Find a Slab (27 Oct 2026)', () => {
  it('reads all six filters, and no filter means the full In Stock list', () => {
    const none = parseStockyardFilters({});
    expect(hasStockyardFilters(none)).toBe(false);
    expect(none.outcome).toBeNull();

    const all = parseStockyardFilters({
      productionDate: '2026-10-23',
      batchNo: ' 1300 ',
      slabNo: '9001',
      baseMaterial: 'Super White',
      fileName: 'ta',
      outcome: 'APPROVED',
    });
    expect(all).toMatchObject({ batchNo: '1300', slabNo: '9001', baseMaterial: 'Super White', fileName: 'ta', outcome: 'APPROVED' });
    expect(hasStockyardFilters(all)).toBe(true);
  });

  it('accepts only the three Stock Outcomes', () => {
    expect(parseStockyardFilters({ outcome: 'DISPATCH' }).outcome).toBe('DISPATCH');
    expect(parseStockyardFilters({ outcome: 'SAMPLE_CUTTING' }).outcome).toBe('SAMPLE_CUTTING');
    expect(parseStockyardFilters({ outcome: 'RECALIBRATION' }).outcome).toBeNull();
    expect(parseStockyardFilters({ outcome: 'stock' }).outcome).toBeNull();
  });

  it('combines filters, matching anywhere in the value and ignoring case ("ta" finds Tajvein)', () => {
    const where = stockyardSlabWhere(parseStockyardFilters({ baseMaterial: 'Super White', fileName: 'ta', batchNo: '13' }));
    expect(where.baseMaterial).toEqual({ name: { contains: 'Super White', mode: 'insensitive' } });
    expect(where.plannedDesign).toEqual({
      OR: [
        { fileName: { contains: 'ta', mode: 'insensitive' } },
        { name: { contains: 'ta', mode: 'insensitive' } },
      ],
    });
    expect(where.batch).toEqual({ batchNo: { contains: '13', mode: 'insensitive' } });
    // The outcome chooses the list; it is not a slab condition.
    expect(where).not.toHaveProperty('outcome');
  });

  it('round-trips into the query string that keys the form', () => {
    const query = buildStockyardQuery(parseStockyardFilters({ fileName: 'Tajvein', outcome: 'DISPATCH' }));
    expect(new URLSearchParams(query).get('fileName')).toBe('Tajvein');
    expect(new URLSearchParams(query).get('outcome')).toBe('DISPATCH');
    expect(buildStockyardQuery(parseStockyardFilters({}))).toBe('');
  });

  it('offers the outcomes as Dispatched, Approved and Sample Cutting, with Clear Filters back to the page', () => {
    const form = read('src/app/chromia/stockyard/find-a-slab.tsx');
    expect(form).toMatch(/DISPATCH: 'Dispatched',\n\s+APPROVED: 'Approved',\n\s+SAMPLE_CUTTING: 'Sample Cutting',/);
    expect(form).toMatch(/href=\{APP_ROUTES\.stockyard\}[\s\S]{0,400}Clear Filters/);
    for (const name of ['batchNo', 'slabNo', 'baseMaterial', 'fileName']) {
      expect(form).toMatch(new RegExp(`<ComboInput\\n\\s+id="${name}"`));
    }
  });
});

describe('Stockyard page — exactly three sections, in order', () => {
  const page = read('src/app/chromia/stockyard/page.tsx');

  it('is Dashboard, then Find a Slab, then In Stock Records, and nothing else', () => {
    const titles = [...page.matchAll(/<SectionCard\s+title="([^"]+)"/g)].map((m) => m[1]);
    expect(titles).toEqual(['Dashboard', 'In Stock Records']);
    const dashboard = page.indexOf('title="Dashboard"');
    const find = page.indexOf('<FindASlab');
    const records = page.indexOf('title="In Stock Records"');
    expect(dashboard).toBeGreaterThan(0);
    expect(find).toBeGreaterThan(dashboard);
    expect(records).toBeGreaterThan(find);
    expect(read('src/app/chromia/stockyard/find-a-slab.tsx')).toMatch(/<SectionCard title="Find a Slab"/);
    expect(page).not.toMatch(/Dispatched from stock"|SimpleFilterBar/);
  });

  it('shows the five KPIs, two then three', () => {
    const first = page.slice(page.indexOf('sm:grid-cols-2'), page.indexOf('sm:grid-cols-3'));
    const second = page.slice(page.indexOf('sm:grid-cols-3'));
    expect([...first.matchAll(/<Stat label="([^"]+)"/g)].map((m) => m[1])).toEqual(['Total Stock Slabs', 'Current Stock Available']);
    expect([...second.matchAll(/<Stat label="([^"]+)"/g)].slice(0, 3).map((m) => m[1])).toEqual([
      'Total Dispatched Slabs',
      'Total Approved Slabs',
      'Total Sample Cutting Slabs',
    ]);
  });

  it('counts Current Stock Available with the very condition the In Stock list uses', () => {
    const repo = read('src/lib/chromia/server/repositories/stockyard-repository.ts');
    expect(repo).toMatch(/const IN_STOCK_NOW = \{ deletedAt: null, status: SlabStatus\.IN_STOCK \} as const;/);
    // Each physical slab once, in the list and the KPI alike (change 10).
    expect(repo).toMatch(/AND: \[\n\s+await physicalSlabWhere\(\),\n\s+IN_STOCK_NOW,/);
    expect(repo).toMatch(/prisma\.chromiaSlab\.count\(\{ where: \{ AND: \[physical, IN_STOCK_NOW\] \} \}\)/);
    // The KPIs are never filtered.
    expect(page).toMatch(/stockyardKpis\(\),/);
  });
});
