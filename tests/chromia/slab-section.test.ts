import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { sameSlab, sectionOfSlab, slabSection, SLAB_SECTION_MESSAGES, type SectionSlab } from '@/lib/chromia/slab-section';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const d = (day: string) => new Date(`${day}T00:00:00Z`);

const slab = (over: Partial<SectionSlab>): SectionSlab => ({
  id: 'x',
  slabNo: '14567',
  status: 'GRADED',
  currentDisposition: null,
  createdAt: d('2026-11-01'),
  trips: [],
  ...over,
});
const trip = (sent?: string, received?: string, restarted?: string) => ({
  attemptNumber: 1,
  sentDate: sent ? d(sent) : null,
  receivedDate: received ? d(received) : null,
  restartedAt: restarted ? d(restarted) : null,
});

describe('Duplicate Slab Detection — the section a slab is in (21 Nov 2026)', () => {
  it('says the owner’s two sentences', () => {
    expect(SLAB_SECTION_MESSAGES.RECALIBRATION).toBe('This slab is already present in the RECALIBRATION SECTION.');
    expect(SLAB_SECTION_MESSAGES.TRIMMING).toBe('This slab is already present in the TRIMMING SECTION.');
  });

  it('Recalibration: waiting to be sent, out, back, or back on the line awaiting QC', () => {
    expect(sectionOfSlab(slab({ currentDisposition: 'RECALIBRATION', trips: [trip()] }))).toBe('RECALIBRATION');
    expect(sectionOfSlab(slab({ status: 'OUT_FOR_RECALIBRATION', currentDisposition: 'RECALIBRATION', trips: [trip('2026-11-02')] }))).toBe('RECALIBRATION');
    expect(sectionOfSlab(slab({ status: 'RECEIVED_FROM_RECALIBRATION', currentDisposition: 'RECALIBRATION', trips: [trip('2026-11-02', '2026-11-04')] }))).toBe('RECALIBRATION');
    expect(sectionOfSlab(slab({ status: 'IN_PROCESS', trips: [trip('2026-11-02', '2026-11-04', '2026-11-05')] }))).toBe('RECALIBRATION');
  });

  it('Trimming: graded C → Trimming, and a Without Design Printing number not yet graded', () => {
    expect(sectionOfSlab(slab({ status: 'GRADED', currentDisposition: 'TRIMMING' }))).toBe('TRIMMING');
    expect(slabSection([], [{ slabNo: '14567' }])).toBe('TRIMMING');
  });

  it('neither: a new slab, one in stock, dispatched, cleared after recalibration, or written off', () => {
    expect(slabSection([], [])).toBeNull();
    expect(sectionOfSlab(slab({ status: 'IN_STOCK', currentDisposition: 'STOCK' }))).toBeNull();
    expect(sectionOfSlab(slab({ status: 'IN_STOCK', currentDisposition: 'STOCK', trips: [trip('2026-11-02', '2026-11-04', '2026-11-05')] }))).toBeNull();
    expect(sectionOfSlab(slab({ status: 'IN_PROCESS' }))).toBeNull();
    expect(sectionOfSlab(slab({ status: 'WASTE', currentDisposition: 'RECALIBRATION', trips: [trip('2026-11-02', '2026-11-04')] }))).toBeNull();
  });

  it('the same physical slab: 14567-A finds 14567, never 145670; its latest record decides', () => {
    const records = [{ slabNo: '14567' }, { slabNo: '14567-a' }, { slabNo: '145670' }, { slabNo: '14567-2' }];
    expect(sameSlab('14567-A', records).map((r) => r.slabNo)).toEqual(['14567', '14567-a']);
    const older = slab({ id: 'old', currentDisposition: 'RECALIBRATION', trips: [trip()], createdAt: d('2026-10-01') });
    const newer = slab({ id: 'new', slabNo: '14567-A', status: 'IN_STOCK', currentDisposition: 'STOCK', createdAt: d('2026-11-10') });
    expect(slabSection([older, newer], [])).toBeNull();
    expect(slabSection([older], [])).toBe('RECALIBRATION');
  });

  it('Slab Entry checks as the number is typed, and names the section under Slab No.', () => {
    const form = read('src/app/chromia/operator/entry-form.tsx');
    expect(form).toContain('setTimeout(() => checkSlabNo(slabNo), 400)');
    expect(form).toContain('section ? SLAB_SECTION_MESSAGES[section]');
    expect(form).toMatch(/<Field label="Slab No\. \*" htmlFor="slabNo" error=\{slabNoError\}>/);
  });
});
