import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { allowedDispositions } from '@/lib/chromia/constants/process-stages';
import { stageOf, statusLabel } from '@/lib/chromia/recalibration-flow';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const trip = { attemptNumber: 1, sentDate: new Date('2026-11-01'), receivedDate: new Date('2026-11-03'), restartedAt: new Date('2026-11-04') };

describe('QC Report — the complete options on every QC (21 Nov 2026)', () => {
  it('Grade A: Stock · Grade B: Stock, Sample Cutting · Grade C: Recalibration, Trimming', () => {
    expect(allowedDispositions('A', { trimming: true })).toEqual(['STOCK']);
    expect(allowedDispositions('B', { trimming: true })).toEqual(['STOCK', 'SAMPLE_CUTTING']);
    expect(allowedDispositions('C', { trimming: true })).toEqual(['RECALIBRATION', 'TRIMMING']);
  });

  it('the QC Report offers Trimming unless a screen turns it off', () => {
    expect(read('src/app/chromia/slabs/new/qc-section.tsx')).toMatch(/allowTrimming = true,\n\}: Props\)/);
  });

  it('Slab Entry and Slab Records Edit: Trimming whatever the slab’s recalibration history', () => {
    const page = read('src/app/chromia/operator/page.tsx');
    expect(page).toContain('qc={{ ...qc, allowTrimming: true }}');
    expect(page).not.toMatch(/allowTrimming: trips/);
  });

  it('after every recalibration cycle: the Recalibration page’s QC and its server action', () => {
    expect(read('src/app/chromia/recalibrations/[slabId]/slab-form.tsx')).not.toMatch(/allowTrimming=\{false\}/);
    expect(read('src/lib/chromia/server/actions/recalibration-flow.ts')).toContain('allowedDispositions(grade, { trimming: true })');
  });

  it('the server no longer refuses Trimming for a slab with a recalibration record', () => {
    expect(read('src/lib/chromia/server/services/intake-outcome-service.ts')).not.toMatch(/has a recalibration record/);
  });

  it('only the QC after trimming keeps Grade C → Recalibration', () => {
    expect(read('src/app/chromia/trimming/[id]/trimming-form.tsx')).toContain('allowTrimming={false}');
  });

  it('a recalibrated slab moved to Trimming reads so on the Recalibration page, in no Current card', () => {
    const state = { disposition: 'TRIMMING', writtenOff: false, trips: [trip] };
    expect(stageOf(state)).toBe('CLEARED');
    expect(statusLabel(state, 'C')).toBe('Moved to Trimming — Grade C');
  });
});
