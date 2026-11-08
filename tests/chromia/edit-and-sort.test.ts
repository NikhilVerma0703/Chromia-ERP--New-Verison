import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const lastHeader = (page: string) => {
  const head = page.slice(page.indexOf('<thead'), page.indexOf('</thead>'));
  const all = [...head.matchAll(/>([^<>{}]+)<\/th>/g)].map((m) => m[1]);
  return all[all.length - 1];
};

const SEVEN_TABLES = [
  'src/app/chromia/slabs/page.tsx',
  'src/app/chromia/stockyard/page.tsx',
  'src/app/chromia/dispatch/page.tsx',
  'src/app/chromia/approved/page.tsx',
  'src/app/chromia/trimming/page.tsx',
  'src/app/chromia/recalibrations/page.tsx',
  'src/app/chromia/recalibration-tracking/page.tsx',
];

describe('the Action column (28 Oct 2026; Edit and Delete on all seven tables, change 5)', () => {
  it('is the last column on every slab table', () => {
    for (const path of SEVEN_TABLES) {
      // Dispatched names it Actions (change 12, 8 Nov 2026).
      expect(lastHeader(read(path)), path).toBe(path.includes('/dispatch/') ? 'Actions' : 'Action');
    }
  });

  it('holds Edit and Delete on every slab table', () => {
    for (const path of SEVEN_TABLES) {
      expect(read(path), path).toMatch(/<SlabActions/);
    }
  });

  it('Edit opens each page’s own edit form, as before', () => {
    expect(read('src/app/chromia/stockyard/page.tsx')).toMatch(/editHref=\{`\$\{APP_ROUTES\.stockyard\}\/\$\{row\.slabId\}\/edit`\}/);
    expect(read('src/app/chromia/approved/page.tsx')).toMatch(/editHref=\{`\$\{open\}\/edit`\}/);
    expect(read('src/app/chromia/recalibrations/page.tsx')).toMatch(/editHref=\{`\$\{APP_ROUTES\.recalibrations\}\/\$\{row\.slabId\}`\}/);
    expect(read('src/app/chromia/slabs/page.tsx')).toMatch(/editHref=\{`\$\{APP_ROUTES\.operator\}\?slab=\$\{slab\.id\}&edit=1/);
    expect(read('src/app/chromia/trimming/page.tsx')).toMatch(/editHref=\{`\$\{APP_ROUTES\.trimming\}\/\$\{row\.id\}`\}/);
    // The two with no edit form of their own open an existing one.
    // Dispatched has its own Edit form since change 12 (8 Nov 2026).
    expect(read('src/app/chromia/dispatch/page.tsx')).toMatch(/editHref=\{`\$\{APP_ROUTES\.dispatch\}\/\$\{slab\.slabId\}\/edit`\}/);
    expect(read('src/app/chromia/recalibration-tracking/page.tsx')).toMatch(/editHref=\{`\$\{APP_ROUTES\.recalibrations\}\/\$\{record\.id\}`\}/);
  });

  it('Delete asks first, naming the slab, and deletes through the admin-only slab delete', () => {
    const button = read('src/components/chromia/ui/delete-slab-button.tsx');
    expect(button).toMatch(/title=\{`Delete slab \$\{slabNo\} permanently\?`\}/);
    expect(button).toMatch(/deleteSlabRecordAction/);
    expect(read('src/lib/chromia/server/actions/slab-record.ts')).toMatch(/requireChromiaAdmin\('delete a slab record'\)/);
  });
});

describe('the edit forms', () => {
  it('Stockyard: New Entry, QC Report and Stock Outcome, with Back in Stock', () => {
    const form = read('src/app/chromia/stockyard/slab-edit-form.tsx');
    const at = ['title="New Entry"', 'title="QC Report"', 'title="Stock Outcome"'].map((s) => form.indexOf(s));
    expect(at.every((i, n) => i > 0 && (n === 0 || i > at[n - 1]))).toBe(true);
    expect(form).toMatch(/IN_STOCK: 'Back in Stock \(no outcome\)'/);
    expect((form.match(/type="submit"/g) ?? []).length).toBe(1);
  });

  it('Approved: the same entry and QC form, the current photo, and the camera', () => {
    const page = read('src/app/chromia/approved/[slabId]/edit/page.tsx');
    expect(page).toMatch(/<StockyardSlabEditForm key=\{record\.id\} form="approved"/);
    expect(page).toMatch(/title="Current Photo"/);
    expect(page).toMatch(/<PhotoCapture slabId=\{record\.id\}/);
  });

  it('the save checks everything, then corrects the same record in order', () => {
    const action = read('src/lib/chromia/server/actions/stockyard-edit.ts');
    const checked = action.indexOf('if (Object.keys(errors).length) return { fieldErrors: errors };');
    const order = ['await updateSlabRecord(correction, user.id);', 'await correctStockGrade(', 'await correctStockOutcome('].map((s) => action.indexOf(s));
    expect(checked).toBeGreaterThan(0);
    expect(order.every((i, n) => i > checked && (n === 0 || i > order[n - 1]))).toBe(true);
    expect(action).not.toMatch(/chromiaSlab\.create|recordOperatorEntry/);
    // Grade in place: A or B only.
    expect(action).toMatch(/grade !== 'A' && grade !== 'B'/);
  });

  it('a corrected outcome is undone before the new one is recorded, the date checked first', () => {
    const service = read('src/lib/chromia/server/services/stockyard-edit-service.ts');
    const fn = service.slice(service.indexOf('export async function correctStockOutcome('));
    const at = ["throw new BusinessRuleViolationError('The date cannot be in the future')", 'await tx.chromiaDispatch.delete(', 'await sendFromStock('].map((s) => fn.indexOf(s));
    expect(at.every((i, n) => i > 0 && (n === 0 || i > at[n - 1]))).toBe(true);
  });

  it('Recalibration: every trip already back has its dates to correct, and a status', () => {
    const form = read('src/app/chromia/recalibrations/[slabId]/slab-form.tsx');
    expect(form).toMatch(/name=\{`trip_\$\{trip\.attemptNumber\}_sent`\}/);
    expect(form).toMatch(/name=\{`trip_\$\{trip\.attemptNumber\}_received`\}/);
    expect(form).toMatch(/<th className="py-1\.5">Status<\/th>/);
    const action = read('src/lib/chromia/server/actions/recalibration-flow.ts');
    expect(action).toMatch(/await correctTripDates\(slabId, past\.attemptNumber, past, user\.id\);/);
  });

  it('Slab Records: the saved QC Report and Reason for Recalibration are pre-filled or shown', () => {
    const page = read('src/app/chromia/operator/page.tsx');
    expect(page).toMatch(/initial: saved,/);
    expect(read('src/app/chromia/operator/entry-form.tsx')).toMatch(/reasonName: qc\.initial\?\.reason,/);
  });
});

describe('newest Production Date first, on all five pages', () => {
  it('each list is ordered by its Production Date, descending', () => {
    expect(read('src/lib/chromia/server/repositories/slab-repository.ts')).toMatch(/orderBy: \[\{ receivedDate: 'desc' \}, \{ createdAt: 'desc' \}\]/);
    const stock = read('src/lib/chromia/server/repositories/stockyard-repository.ts');
    expect(stock).toMatch(/orderBy: \[\{ receivedDate: 'desc' \}, \{ createdAt: 'desc' \}\]/);
    // The Stockyard lists, the rack and each Stock Outcome's, read slabs now (change 10),
    // and Sent From Stock (change 11).
    expect(stock.match(/orderBy: \[\{ receivedDate: 'desc' \}, \{ createdAt: 'desc' \}\]/g)?.length).toBe(3);
    expect(read('src/lib/chromia/server/repositories/recalibration-flow-repository.ts')).toMatch(/orderBy: \[\{ receivedDate: 'desc' \}, \{ createdAt: 'desc' \}, \{ id: 'asc' \}\]/);
    for (const path of ['src/lib/chromia/server/repositories/dispatch-repository.ts', 'src/lib/chromia/server/repositories/approved-repository.ts']) {
      expect(read(path), path).toMatch(/\.sort\(\n\s+\(a, b\) =>\n\s+b\.receivedDate\.getTime\(\) - a\.receivedDate\.getTime\(\) \|\|/);
    }
  });
});
