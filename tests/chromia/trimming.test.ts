import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { navigation } from '@/lib/chromia/config/navigation';
import { chromiaNav } from '@/lib/navModel';
import {
  TRIM_OTHER,
  TRIM_PRESETS,
  formatThickness,
  formatTrim,
  toMillimetres,
  trimChoiceOf,
  trimError,
  trimmingStage,
  trimmingStatus,
  tripDatesError,
} from '@/lib/chromia/trimming';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const empty = { trimFromMm: null, trimToMm: null, sentDate: null, receivedDate: null, qcGrade: null, qcDisposition: null };

describe('Trimming — thickness in cm and mm (7 Nov 2026)', () => {
  it('shows both units', () => {
    expect(formatThickness(30)).toBe('3 cm (30 mm)');
    expect(formatThickness(12)).toBe('1.2 cm (12 mm)');
    expect(formatThickness(null)).toBe('—');
    expect(formatTrim(30, 20)).toBe('3 cm → 2 cm (30 mm → 20 mm)');
    expect(formatTrim(null, 20)).toBe('');
  });

  it('reads a typed thickness in either unit, as millimetres', () => {
    expect(toMillimetres('3', 'cm')).toBe(30);
    expect(toMillimetres('1.2', 'cm')).toBe(12);
    expect(toMillimetres('1,2', 'cm')).toBe(12);
    expect(toMillimetres('25', 'mm')).toBe(25);
    expect(toMillimetres('', 'cm')).toBeNull();
    expect(toMillimetres('-2', 'cm')).toBeNull();
    expect(toMillimetres('abc', 'mm')).toBeNull();
  });

  it('the two presets, and Others for anything else', () => {
    expect(TRIM_PRESETS.map((p) => p.label)).toEqual(['3 cm to 2 cm (30 mm to 20 mm)', '2 cm to 1.2 cm (20 mm to 12 mm)']);
    expect(trimChoiceOf(30, 20)).toBe('30-20');
    expect(trimChoiceOf(20, 12)).toBe('20-12');
    expect(trimChoiceOf(30, 25)).toBe(TRIM_OTHER);
    expect(trimChoiceOf(null, null)).toBe('');
  });

  it('a trim makes the slab thinner', () => {
    expect(trimError(30, 20)).toBeNull();
    expect(trimError(20, 30)).toMatch(/thinner/);
    expect(trimError(20, 20)).toMatch(/thinner/);
    expect(trimError(null, 20)).toMatch(/both/);
  });
});

describe('Trimming — Current Status follows what is saved', () => {
  it('step by step', () => {
    expect(trimmingStatus(empty)).toBe('Ready for Trimming');
    expect(trimmingStatus({ ...empty, trimFromMm: 30, trimToMm: 20 })).toBe('Ready for Trimming — 3 cm → 2 cm');
    expect(trimmingStatus({ ...empty, sentDate: '2026-11-07' })).toBe('Sent for Trimming');
    expect(trimmingStatus({ ...empty, trimFromMm: 20, trimToMm: 12, sentDate: '2026-11-07' })).toBe('Sent for Trimming (2 cm → 1.2 cm)');
    expect(trimmingStatus({ ...empty, sentDate: '2026-11-07', receivedDate: '2026-11-08' })).toBe('Received from Trimming — Awaiting QC');
    expect(trimmingStatus({ ...empty, sentDate: 'x', receivedDate: 'y', qcGrade: 'A', qcDisposition: 'STOCK' })).toBe('Trimmed — Grade A: Stock');
    expect(trimmingStatus({ ...empty, qcGrade: 'C', qcDisposition: 'RECALIBRATION' })).toBe('Trimmed — Grade C: Recalibration');
    expect(trimmingStage({ ...empty, receivedDate: 'y' })).toBe('RECEIVED');
  });

  it('Send & Receive dates: in order, and not in the future', () => {
    const today = '2026-11-07';
    expect(tripDatesError('2026-11-05', '', today)).toBeNull();
    expect(tripDatesError('2026-11-05', '2026-11-07', today)).toBeNull();
    expect(tripDatesError('', '2026-11-07', today)).toMatch(/Sent Date before/);
    expect(tripDatesError('2026-11-06', '2026-11-05', today)).toMatch(/earlier than the Sent/);
    expect(tripDatesError('2026-11-08', '', today)).toMatch(/future/);
    expect(tripDatesError('2026-11-05', '2026-11-08', today)).toMatch(/future/);
  });
});

describe('Trimming — sidebar and table', () => {
  it('RECALIBRATION & TRIMMING: Trimming, Recalibration, Recal. Tracking; Production unchanged', () => {
    const model = chromiaNav();
    if (model.kind !== 'sections') throw new Error('sections expected');
    const block = (label: string) => model.blocks.find((b) => b.label === label)?.items.map((i) => i.label);
    expect(block('Recalibration & Trimming')).toEqual(['Trimming', 'Recalibration', 'Recal. Tracking']);
    expect(block('Production')).toEqual(['Dashboard', 'Slab Entry', 'Slab Records', 'Stockyard', 'Dispatched', 'Approved Slabs']);
    expect(navigation.map((n) => n.title).indexOf('Trimming')).toBe(navigation.map((n) => n.title).indexOf('Recalibration') - 1);
  });

  it('the table has exactly the columns asked for, in order', () => {
    const page = read('src/app/chromia/trimming/page.tsx');
    const heads = [...page.matchAll(/<th className=\{[^>]+>([^<]+)<\/th>/g)].map((m) => m[1]);
    expect(heads).toEqual([
      'Production Date', 'Batch Number', 'Slab Number', 'Base Material / Slab Name', 'File Name / Planned Design',
      'Thickness', 'Grade', 'Slab Outcome', 'Trimmed From → To', 'Sent Date', 'Received Date', 'Current Status', 'Action',
    ]);
    // Trimming Without Design Printing sits above the table.
    expect(page.indexOf('<WithoutPrintingForm')).toBeLessThan(page.indexOf('title="Trimming Records"'));
  });

  it('the slab page has the four parts, in order', () => {
    const form = read('src/app/chromia/trimming/[id]/trimming-form.tsx');
    const titles = [...form.matchAll(/<SectionCard title="([^"]+)"/g)].map((m) => m[1]);
    expect(titles).toEqual(['A. Trimmed From → To', 'B. Send & Receive', 'C. Update Slab Details', 'D. QC Report']);
  });
});
