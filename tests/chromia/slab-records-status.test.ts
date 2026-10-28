import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { currentStatusOf } from '@/lib/chromia/current-status';
import { earlierEntries, overallProduction, type OverviewSlab } from '@/lib/chromia/production-overview';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const d = (day: string) => new Date(`${day}T00:00:00Z`);
const trip = (attemptNumber: number, sent?: string, received?: string, restarted?: string) => ({
  attemptNumber,
  sentDate: sent ? d(sent) : null,
  receivedDate: received ? d(received) : null,
  restartedAt: restarted ? d(restarted) : null,
});
const slab = (status: string, currentDisposition: string | null, currentGrade: string | null) => ({ status, currentDisposition, currentGrade });

describe('Slab Records → Current Status (28 Oct 2026)', () => {
  it('Grade C → Recalibration reads as the Recalibration page does', () => {
    expect(currentStatusOf(slab('GRADED', 'RECALIBRATION', 'C'), [trip(1)]).label).toBe('Ready for Recalibration');
    expect(currentStatusOf(slab('OUT_FOR_RECALIBRATION', 'RECALIBRATION', 'C'), [trip(1, '2026-10-01')]).label).toBe('Sent for 1st Time Recalibration');
    expect(
      currentStatusOf(slab('GRADED', 'RECALIBRATION', 'C'), [trip(1, '2026-09-01', '2026-09-05', '2026-09-06'), trip(2)]).label,
    ).toBe('Need 2nd Time Recalibration');
    expect(currentStatusOf(slab('IN_PROCESS', null, null), [trip(1, '2026-09-01', '2026-09-05', '2026-09-06')]).label).toBe(
      'In Processing — After Attempt 1',
    );
    // A condemned slab with no waiting record yet still reads as the board's.
    expect(currentStatusOf(slab('GRADED', 'RECALIBRATION', 'C'), []).label).toBe('Ready for Recalibration');
  });

  it('Grade B → Sample Cutting is Sample Cutting', () => {
    expect(currentStatusOf(slab('SAMPLE_CUT', 'SAMPLE_CUTTING', 'B'), [])).toEqual({ label: 'Sample Cutting', tone: 'hold' });
  });

  it('Grade A or B → Stock: where the Stockyard has it now', () => {
    expect(currentStatusOf(slab('IN_STOCK', 'STOCK', 'A'), []).label).toBe('In Stock');
    expect(currentStatusOf(slab('IN_STOCK', 'STOCK', 'B'), []).label).toBe('In Stock');
    expect(currentStatusOf(slab('DISPATCHED', 'DISPATCH', 'A'), []).label).toBe('Dispatch');
    expect(currentStatusOf(slab('APPROVED', 'STOCK', 'A'), []).label).toBe('Approved');
    expect(currentStatusOf(slab('SAMPLE_CUT', 'SAMPLE_CUTTING', 'B'), []).label).toBe('Sample Cutting');
  });

  it('a slab cleared from recalibration reads where it is, not as Cleared', () => {
    const back = [trip(1, '2026-09-01', '2026-09-05', '2026-09-06')];
    expect(currentStatusOf(slab('IN_STOCK', 'STOCK', 'A'), back).label).toBe('In Stock');
    expect(currentStatusOf(slab('APPROVED', 'STOCK', 'B'), back).label).toBe('Approved');
  });

  it('QC not done yet is In-Processing', () => {
    expect(currentStatusOf(slab('IN_PROCESS', null, null), [])).toEqual({ label: 'In-Processing', tone: 'processing' });
  });
});

describe('Slab Records → one row per physical slab', () => {
  const at = (n: number) => new Date(Date.UTC(2026, 9, 1) + n * 1000);
  const records: OverviewSlab[] = [
    { id: 'a', slabNo: '14567', status: 'SAMPLE_CUT', currentDisposition: 'SAMPLE_CUTTING', currentGrade: 'B', receivedDate: d('2026-10-20'), createdAt: at(1) },
    { id: 'b', slabNo: '14567-A', status: 'IN_STOCK', currentDisposition: 'STOCK', currentGrade: 'A', receivedDate: d('2026-10-25'), createdAt: at(2) },
    { id: 'c', slabNo: '14568', status: 'IN_STOCK', currentDisposition: 'STOCK', currentGrade: 'A', receivedDate: d('2026-10-25'), createdAt: at(3) },
  ];

  it('leaves out exactly the earlier entries, so the rows are Total Produced', () => {
    const earlier = earlierEntries(records);
    expect([...earlier.entries()]).toEqual([['a', { latestId: 'b', slabNo: '14567' }]]);
    expect(records.length - earlier.size).toBe(overallProduction(records).produced);
  });

  it('the repository filters the earlier entries out of the rows and the count, and names them on the row', () => {
    const repo = read('src/lib/chromia/server/repositories/slab-repository.ts');
    expect(repo).toMatch(/const earlier = earlierEntries\(live\);/);
    expect(repo).toMatch(/\{ AND: \[filterWhere, \{ id: \{ notIn: \[\.\.\.earlier\.keys\(\)\] \} \}\] \}/);
    expect(repo).toMatch(/prisma\.chromiaSlab\.count\(\{ where \}\)/);
    expect(repo).toMatch(/orderBy: \[\{ receivedDate: 'desc' \}, \{ createdAt: 'desc' \}\]/);
  });
});

describe('Slab Records → the table', () => {
  const page = read('src/app/chromia/slabs/page.tsx');

  it('lists the twelve columns in exactly the order asked for', () => {
    const head = page.slice(page.indexOf('<thead'), page.indexOf('</thead>'));
    expect([...head.matchAll(/>([^<>{}]+)<\/th>/g)].map((m) => m[1])).toEqual([
      'Production Date', 'Batch No.', 'Slab No.', 'Base Material / Slab Name', 'File Name / Planned Design',
      'Thickness (cm)', 'In-Time', 'Grade', 'QC Outcome', 'Current Status', 'Slab Remarks', 'Action',
    ]);
  });

  it('reads Current Status from the shared rule', () => {
    expect(page).toMatch(/const current = currentStatusOf\(slab, slab\.recalibrations\);/);
    expect(page).toMatch(/<Badge tone=\{current\.tone\}>\{current\.label\}<\/Badge>/);
  });
});
