import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const lastHeader = (page: string) => {
  const head = page.slice(page.indexOf('<thead'), page.indexOf('</thead>'));
  const all = [...head.matchAll(/>([^<>{}]+)<\/th>/g)].map((m) => m[1]);
  return all[all.length - 1];
};

describe('the Action column (28 Oct 2026)', () => {
  it('is the last column on Slab Records, Stockyard, Approved Slabs and Recalibration', () => {
    for (const path of [
      'src/app/chromia/slabs/page.tsx',
      'src/app/chromia/stockyard/page.tsx',
      'src/app/chromia/approved/page.tsx',
      'src/app/chromia/recalibrations/page.tsx',
    ]) {
      expect(lastHeader(read(path)), path).toBe('Action');
    }
  });

  it('opens each page’s own edit form', () => {
    expect(read('src/app/chromia/stockyard/page.tsx')).toMatch(/<EditLink href=\{`\$\{APP_ROUTES\.stockyard\}\/\$\{row\.slabId\}\/edit`\}/);
    expect(read('src/app/chromia/approved/page.tsx')).toMatch(/<EditLink href=\{`\$\{open\}\/edit`\}/);
    expect(read('src/app/chromia/recalibrations/page.tsx')).toMatch(/<EditLink href=\{`\$\{APP_ROUTES\.recalibrations\}\/\$\{row\.slabId\}`\}/);
    expect(read('src/app/chromia/slabs/row-actions.tsx')).toMatch(/href=\{`\$\{APP_ROUTES\.operator\}\?slab=\$\{slabId\}&edit=1/);
  });

  it('Dispatched stays read-only: no Action column, no Edit', () => {
    const page = read('src/app/chromia/dispatch/page.tsx');
    expect(page).not.toMatch(/EditLink|>Action<\/th>|>Edit</);
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
    expect(stock).toMatch(/orderBy: \[\{ slab: \{ receivedDate: 'desc' \} \}, \{ releasedAt: 'desc' \}/);
    expect(read('src/lib/chromia/server/repositories/recalibration-flow-repository.ts')).toMatch(/orderBy: \[\{ receivedDate: 'desc' \}, \{ createdAt: 'desc' \}, \{ id: 'asc' \}\]/);
    for (const path of ['src/lib/chromia/server/repositories/dispatch-repository.ts', 'src/lib/chromia/server/repositories/approved-repository.ts']) {
      expect(read(path), path).toMatch(/\.sort\(\n\s+\(a, b\) =>\n\s+b\.receivedDate\.getTime\(\) - a\.receivedDate\.getTime\(\) \|\|/);
    }
  });
});
