import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ALTER_DESTINATION_LABELS, ALTER_DESTINATIONS } from '@/lib/chromia/constants/alter-destinations';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

describe('Dispatched → Alter From Dispatched (change 12, 8 Nov 2026)', () => {
  const page = read('src/app/chromia/dispatch/page.tsx');
  const row = read('src/app/chromia/dispatch/alter-from-dispatched-form.tsx');
  const service = read('src/lib/chromia/server/services/dispatched-alter-service.ts');
  const action = read('src/lib/chromia/server/actions/dispatched-alter.ts');

  it('offers exactly In Stock and Recalibration', () => {
    expect(ALTER_DESTINATIONS.map((d) => ALTER_DESTINATION_LABELS[d])).toEqual(['In Stock', 'Recalibration']);
  });

  it('sits right after Slab Remarks, before Actions, with a Select and a Date', () => {
    expect(page).toMatch(/<th className=\{th\}>Slab Remarks<\/th>\n\s+<th className=\{th\}>Alter From Dispatched<\/th>\n\s+<th className=\{`\$\{th\} text-right`\}>Actions<\/th>/);
    expect(row).toMatch(/name="destination"/);
    expect(row).toMatch(/name="date"\n\s+type="date"\n\s+required\n\s+min=\{dispatchedOn\}\n\s+max=\{today\}/);
    expect(row).toMatch(/alterFromDispatchedAction/);
  });

  it('moves the slab in one transaction, claimed from DISPATCHED, its dispatch record removed', () => {
    expect(service).toMatch(/slab\.status !== SlabStatus\.DISPATCHED/);
    expect(service).toMatch(/await prisma\.\$transaction/);
    expect(service.match(/await claimSlab\(tx, slab,/g)?.length).toBe(2);
    expect(service.match(/tx\.chromiaDispatch\.deleteMany\(\{ where: \{ slabId: slab\.id \} \}\)/g)?.length).toBe(2);
  });

  it('In Stock: a new stock entry on the date; Recalibration: the waiting record, never a write-off', () => {
    expect(service).toMatch(/status: SlabStatus\.IN_STOCK,\n\s+currentDisposition: Disposition\.STOCK/);
    expect(service).toMatch(/tx\.chromiaStockEntry\.create\(\{\n\s+data: \{ slabId: slab\.id, stockDate: input\.date/);
    expect(service).toMatch(/status: SlabStatus\.GRADED,\n\s+currentDisposition: Disposition\.RECALIBRATION/);
    expect(service).toMatch(/markAwaitingRecalibration\(slab\.id, undefined, userId, tx\)/);
    expect(service).toMatch(/isWriteOff\(slab\.recalibrations\)/);
  });

  it('keeps the trail: an event names the destination and the dispatch date it came back from', () => {
    expect(service).toMatch(/note: `Altered from Dispatched\$\{from\} to In Stock`/);
    expect(service).toMatch(/note: `Altered from Dispatched\$\{from\} to Recalibration`/);
  });

  it('refuses a future date and one before the dispatch', () => {
    expect(service).toMatch(/The date cannot be in the future/);
    expect(service).toMatch(/The date cannot be before slab \$\{slab\.slabNo\} was dispatched/);
    expect(action).toMatch(/day > stockyardToday\(\)/);
  });

  it('refreshes every page the slab leaves or lands on', () => {
    for (const route of ['dispatch', 'stockyard', 'recalibrations', 'recalibrationTracking', 'slabs', 'dashboard', 'reports', 'downloads']) {
      expect(action).toContain(`APP_ROUTES.${route},`);
    }
  });

  it('Edit opens the Dispatched Edit form: New Entry, QC Report and Alter From Dispatched', () => {
    const edit = read('src/app/chromia/dispatch/[slabId]/edit/page.tsx');
    const form = read('src/app/chromia/stockyard/slab-edit-form.tsx');
    const save = read('src/lib/chromia/server/actions/stockyard-edit.ts');
    expect(edit).toMatch(/<StockyardSlabEditForm key=\{loaded\.record\.id\} form="dispatched" returnTo=\{APP_ROUTES\.dispatch\}/);
    expect(form).toMatch(/props\.form === 'dispatched' \? \(\n\s+<SectionCard title="Alter From Dispatched"/);
    expect(save).toMatch(/await alterFromDispatched\(\{ slabId, destination, date: alterDate \}, user\.id\)/);
  });
});
