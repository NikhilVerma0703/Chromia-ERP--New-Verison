import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

describe('one physical slab, one count — every page (change 10)', () => {
  it('every slab-level list and KPI counts through physicalSlabWhere', () => {
    for (const path of [
      'src/lib/chromia/server/repositories/stockyard-repository.ts',
      'src/lib/chromia/server/repositories/dispatch-repository.ts',
      'src/lib/chromia/server/repositories/approved-repository.ts',
      'src/lib/chromia/server/repositories/recalibration-flow-repository.ts',
      'src/lib/chromia/server/repositories/report-repository.ts',
    ]) {
      expect(read(path), path).toMatch(/await physicalSlabWhere\(\)/);
    }
    // Slab Records and the dashboard read the same rule straight from production-overview.
    expect(read('src/lib/chromia/server/repositories/slab-repository.ts')).toMatch(/earlierEntries\(live\)/);
    expect(read('src/lib/chromia/server/repositories/physical-slabs.ts')).toMatch(/return \[\.\.\.earlierEntries\(live\)\.keys\(\)\];/);
  });

  it('a Stock Outcome list reads the slabs its KPI counts, by status', () => {
    const repo = read('src/lib/chromia/server/repositories/stockyard-repository.ts');
    const list = repo.slice(repo.indexOf('export async function listStockOutcomeRecords('));
    expect(list).toMatch(/\{ status: OUTCOME_STATUS\[outcome\] \}/);
    expect(list).not.toMatch(/chromiaStockEntry\.findMany/);
  });

  it('the Summary counts nothing of a deleted slab', () => {
    const repo = read('src/lib/chromia/server/repositories/report-repository.ts');
    for (const table of ['chromiaProcessCycle', 'chromiaDispatch', 'chromiaStockEntry', 'chromiaSampleCutting']) {
      expect(repo, table).toMatch(new RegExp(`prisma\\.${table}\\.findMany\\(\\{ where: \\{ [a-zA-Z]+: within, \\.\\.\\.live \\}`));
    }
  });
});

describe('recalibration moves the slab, and starts each new pass fresh (change 10)', () => {
  it('a trip moves the slab out to the facility and back to the yard, with its movements', () => {
    const service = read('src/lib/chromia/server/services/recalibration-flow-service.ts');
    expect(service).toMatch(/reason: MovementReason\.RECALIBRATION_OUT,/);
    expect(service).toMatch(/reason: MovementReason\.RECALIBRATION_IN,/);
    expect(service).toMatch(/moveTo\(LocationType\.EXTERNAL_FACILITY\)/);
    expect(service).toMatch(/moveTo\(LocationType\.YARD\)/);
  });

  it('back from a trip, the In-time is the new pass’s, not the last one carried over', () => {
    expect(read('src/app/chromia/recalibrations/[slabId]/page.tsx')).toMatch(
      /inTime: stage === 'RETURNED' \|\| !record\.inTime \? '' : toTimeInput\(record\.inTime\),/,
    );
  });
});

describe('the audit and the workflow check', () => {
  it('are wired as npm scripts, and the workflow check refuses a database that is not *_test', () => {
    const pkg = read('package.json');
    expect(pkg).toMatch(/"audit:chromia": "cross-env TZ=UTC tsx --env-file=\.env scripts\/chromia-audit\.ts"/);
    expect(pkg).toMatch(/"test:workflows": /);
    expect(read('scripts/workflow/chromia-workflows.ts')).toMatch(/endsWith\('_test'\)/);
  });
});
