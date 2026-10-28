import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { buildReport, formatSlabInTime, REPORT_COLUMNS, type ReportRecord } from '@/lib/chromia/download-reports';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const d = (day: string) => new Date(`${day}T00:00:00Z`);

const record = (slabNo: string, eventDay: string, over: Partial<ReportRecord> = {}): ReportRecord => ({
  eventDate: d(eventDay),
  productionDate: d('2026-10-01'),
  createdAt: d('2026-10-01'),
  batchNo: '1300',
  slabNo,
  baseMaterial: 'Astral Mist',
  design: 'AlmondMist1',
  thicknessCm: 2,
  inTime: new Date('2026-10-01T04:00:00Z'), // 09:30 IST
  grade: 'A',
  disposition: 'STOCK',
  currentStatus: 'In Stock',
  remarks: null,
  ...over,
});

const labels = (kind: keyof typeof REPORT_COLUMNS) => buildReport(kind, []).columns.map((c) => c.label);

describe('Downloads — the columns of each report, exactly as asked (change 12)', () => {
  it('Complete Production: Slab Records’ columns, in its order', () => {
    expect(labels('PRODUCTION')).toEqual([
      'S.No.', 'Production Date', 'Batch No.', 'Slab No.', 'Base Material / Slab Name', 'File Name / Planned Design',
      'Thickness (cm)', 'In-Time', 'Grade', 'QC Outcome', 'Current Status', 'Slab Remarks',
    ]);
    // …which is Slab Records' table, its Action column aside.
    const page = read('src/app/chromia/slabs/page.tsx');
    const head = page.slice(page.indexOf('<thead'), page.indexOf('</thead>'));
    expect(['S.No.', ...[...head.matchAll(/>([^<>{}]+)<\/th>/g)].map((m) => m[1]).filter((l) => l !== 'Action')]).toEqual(labels('PRODUCTION'));
  });

  it('In Stock', () => {
    expect(labels('STOCK')).toEqual([
      'S.No.', 'Production Date', 'Batch No.', 'Slab No.', 'Base Material / Slab Name', 'File Name / Planned Design',
      'Thickness (cm)', 'In-Time', 'Grade', 'QC Outcome', 'Current Status', 'Slab Remarks',
    ]);
  });

  it('Dispatched, Approved and Sample Cutting: their own date first', () => {
    const tail = ['Production Date', 'Batch No.', 'Slab No.', 'Base Material / Slab Name', 'File Name / Planned Design', 'Thickness (cm)', 'Grade', 'Slab Remarks'];
    expect(labels('DISPATCH')).toEqual(['S.No.', 'Dispatch Date', ...tail]);
    expect(labels('APPROVED')).toEqual(['S.No.', 'Approved Date', ...tail]);
    expect(labels('SAMPLE_CUTTING')).toEqual(['S.No.', 'Sample Cutting Date', ...tail]);
  });

  it('Recalibration: the Recalibration page’s fourteen columns', () => {
    expect(labels('RECALIBRATION')).toEqual([
      'S.No.', 'Production Date', 'Batch No.', 'Slab No.', 'Base Material / Slab Name', 'File Name / Planned Design',
      'Thickness (cm)', 'Grade', 'Slab Outcome', 'Reason for Recalibration', 'Slab Remarks', 'Attempt Number',
      'Sent Date', 'Received Date', 'Current Status',
    ]);
  });
});

describe('Downloads — oldest first, S.No. 1…n', () => {
  const report = buildReport('DISPATCH', [
    record('900003', '2026-10-27'),
    record('900001', '2026-10-05'),
    record('900002', '2026-10-27', { productionDate: d('2026-09-30') }),
  ]);

  it('sorts on the report’s own date, ascending; ties by production date', () => {
    expect(report.rows.map((r) => r[4])).toEqual(['900001', '900002', '900003']);
    expect(report.rows.map((r) => r[1])).toEqual(['05 Oct 2026', '27 Oct 2026', '27 Oct 2026']);
  });

  it('numbers the rows 1…n after the sort — never a database id or a serial', () => {
    expect(report.rows.map((r) => r[0])).toEqual([1, 2, 3]);
    expect(buildReport('DISPATCH', [record('X', '2026-10-01')]).rows[0]?.[0]).toBe(1);
  });

  it('writes the values the pages show', () => {
    const [row] = buildReport('STOCK', [record('900009', '2026-10-01')]).rows;
    expect(row).toEqual([1, '01 Oct 2026', '1300', '900009', 'Astral Mist', 'AlmondMist1', 2, '01 Oct, 09:30', 'Grade A', 'Stock', 'In Stock', '—']);
    expect(formatSlabInTime(null)).toBe('—');
  });
});

describe('Downloads — the page and the file are one report', () => {
  it('previews and downloads the same loadDownloadReport', () => {
    expect(read('src/app/chromia/downloads/page.tsx')).toMatch(/loadDownloadReport\(query\.kind, range\),\n\s+loadDownloadReport\('PRODUCTION', productionRange\),/);
    expect(read('src/app/api/chromia/exports/route.ts')).toMatch(/columns: report\.columns,\n\s+rows: report\.rows,/);
    expect(read('src/app/api/chromia/exports/production/route.ts')).toMatch(/columns: report\.columns, rows: report\.rows/);
  });

  it('is titled By Slab Status, with five reports', () => {
    const form = read('src/app/chromia/downloads/download-form.tsx');
    expect(form).toMatch(/title="By Slab Status"/);
    expect(form).not.toMatch(/By outcome/);
  });

  it('reads each report by the ERP’s rules: physical slabs, by status', () => {
    const repo = read('src/lib/chromia/server/repositories/export-repository.ts');
    expect(repo).toMatch(/AND: \[await physicalSlabWhere\(\), REPORT_WHERE\[kind\]/);
    expect(repo).toMatch(/STOCK: \{ status: SlabStatus\.IN_STOCK \}/);
    expect(repo).toMatch(/APPROVED: \{ status: SlabStatus\.APPROVED \}/);
  });
});
