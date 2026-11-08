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

describe('Stockyard page — exactly four sections, in order', () => {
  const page = read('src/app/chromia/stockyard/page.tsx');

  it('is Dashboard, then Find a Slab, then In Stock Records, then Sent From Stock, and nothing else', () => {
    const titles = [...page.matchAll(/<SectionCard\s+title="([^"]+)"/g)].map((m) => m[1]);
    expect(titles).toEqual(['Dashboard', 'In Stock Records', 'Sent From Stock']);
    expect(page.indexOf('title="Sent From Stock"')).toBeGreaterThan(page.indexOf('title="In Stock Records"'));
    const dashboard = page.indexOf('title="Dashboard"');
    const find = page.indexOf('<FindASlab');
    const records = page.indexOf('title="In Stock Records"');
    expect(dashboard).toBeGreaterThan(0);
    expect(find).toBeGreaterThan(dashboard);
    expect(records).toBeGreaterThan(find);
    expect(read('src/app/chromia/stockyard/find-a-slab.tsx')).toMatch(/<SectionCard title="Find a Slab"/);
    expect(page).not.toMatch(/Dispatched from stock"|SimpleFilterBar/);
  });

  it('shows exactly four KPIs, in this order — Total Stock Slabs removed (change 10)', () => {
    expect([...page.matchAll(/<Stat label="([^"]+)"/g)].map((m) => m[1])).toEqual([
      'Current Stock Available',
      'Total Dispatched Slabs',
      'Total Approved Slabs',
      'Total Sample Cutting Slabs',
    ]);
    expect(page).not.toMatch(/label="Total Stock Slabs"|kpis\.totalStock/);
    // Current Stock Available is the count the In Stock Records table lists.
    expect(page).toMatch(/<Stat label="Current Stock Available" value=\{kpis\.currentStock\}/);
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

describe('Stockyard → Sent From Stock (change 11, 8 Nov 2026)', () => {
  const page = read('src/app/chromia/stockyard/page.tsx');
  const section = page.slice(page.indexOf('title="Sent From Stock"'));
  const repo = read('src/lib/chromia/server/repositories/stockyard-repository.ts');

  it('has the In Stock Records columns, Stock Outcome right after Grade, and no Days in Stock', () => {
    expect([...section.matchAll(/<th className=\{[^>]+\}>([^<]+)<\/th>/g)].map((m) => m[1])).toEqual([
      'Production Date',
      'Batch Number',
      'Slab Number',
      'Base Material / Slab Name',
      'File Name / Planned Design',
      'Thickness (cm)',
      'Grade',
      'Stock Outcome',
      'Slab Remarks',
      'Action',
    ]);
    expect(section).not.toMatch(/Days in Stock/);
  });

  it('names each outcome as Dispatched, Approved or Sample Cutting, with its date', () => {
    expect(page).toMatch(/DISPATCH: 'Dispatched',\n\s+APPROVED: 'Approved',\n\s+SAMPLE_CUTTING: 'Sample Cutting',/);
    expect(section).toMatch(/SENT_OUTCOME_LABELS\[slab\.outcome\][\s\S]{0,120}dateFmt\.format\(slab\.sentOn\)/);
  });

  it('gives every row Edit (the Stockyard Edit form, from=sent) and the global permanent Delete', () => {
    expect(section).toMatch(/<SlabActions editHref=\{`\$\{APP_ROUTES\.stockyard\}\/\$\{slab\.id\}\/edit\?from=sent`\} slabId=\{slab\.id\} slabNo=\{slab\.slabNo\} \/>/);
  });

  it('lists slabs released from the rack by the outcome they are in now, each physical slab once', () => {
    const fn = repo.slice(repo.indexOf('export async function listSentFromStock'));
    expect(fn).toMatch(/await physicalSlabWhere\(\)/);
    expect(fn).toMatch(/status: \{ in: \[SlabStatus\.DISPATCHED, SlabStatus\.APPROVED, SlabStatus\.SAMPLE_CUT\] \}/);
    expect(fn).toMatch(/entry\.releasedAt === null \|\| entry\.releaseOutcome !== outcome\) return \[\]/);
  });

  it('opened from Sent From Stock, Edit offers only the three outcomes and returns to the table', () => {
    const form = read('src/app/chromia/stockyard/slab-edit-form.tsx');
    const edit = read('src/app/chromia/stockyard/[slabId]/edit/page.tsx');
    expect(form).toMatch(/const SENT_PLACE_LABEL: Record<string, string> = \{ DISPATCH: 'Dispatched', APPROVED: 'Approved', SAMPLE_CUTTING: 'Sample Cutting' \};/);
    expect(edit).toMatch(/\(await searchParams\)\.from === 'sent'/);
    expect(edit).toMatch(/#sent-from-stock/);
    expect(page).toMatch(/<div id="sent-from-stock"/);
  });

  it('has its own Slab Number search, partial and case-insensitive, keeping Find a Slab’s filters', () => {
    expect(section).toMatch(/<input\s+id="sentSlabNo"\s+name="sentSlabNo"/);
    expect(section).toMatch(/new URLSearchParams\(buildStockyardQuery\(filters\)\)/);
    expect(page).toMatch(/listSentFromStock\(sentSlabNo\)/);
    expect(repo).toMatch(/slabNo \? \{ slabNo: \{ contains: slabNo, mode: 'insensitive' \} \} : \{\}/);
  });
});
