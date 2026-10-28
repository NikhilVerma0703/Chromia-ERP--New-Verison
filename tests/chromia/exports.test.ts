import { describe, expect, it } from 'vitest';

import {
  EXPORT_KIND_LABELS,
  EXPORT_KINDS,
  buildExportQuery,
  buildRangeQuery,
  exportFileName,
  isExportKind,
  isRangePreset,
  isWithinRangeDays,
  padRange,
  parseExportQuery,
  parseRangeQuery,
  productionFileName,
  recentMonths,
  resolveRange,
  toDateInput,
  toMonthInput,
  type ExportQuery,
} from '@/lib/chromia/exports';
import { plantInstant, toPlantTimeInput } from '@/lib/chromia/plant-time';

/**
 * Fixed "now" so the maths is deterministic: Fri 14 Aug 2026, 15:30 in the
 * plant. Every instant here is built in plant time, so the suite reads the same
 * on a UTC host and on an IST one — the days are the plant's (CHR-8, the code
 * review of 20 Oct 2026), not the server's.
 */
const NOW = plantInstant(2026, 8, 14, 15, 30);

function query(overrides: Partial<ExportQuery> = {}): ExportQuery {
  return {
    kind: 'DISPATCH',
    preset: 'TODAY',
    month: '2026-08',
    from: '2026-08-01',
    to: '2026-08-14',
    ...overrides,
  };
}

describe('range presets', () => {
  it('today covers the whole current day', () => {
    const range = resolveRange(query({ preset: 'TODAY' }), NOW);
    expect(toDateInput(range.from)).toBe('2026-08-14');
    expect(toDateInput(range.to)).toBe('2026-08-14');
    expect(toPlantTimeInput(range.from)).toBe('00:00');
    expect(toPlantTimeInput(range.to)).toBe('23:59');
  });

  it('today is the production day: after midnight the night shift is still on yesterday', () => {
    // 01:30 on 1 Nov is C shift of 31 Oct — the house rule, 06:00 to 06:00.
    const night = resolveRange(query({ preset: 'TODAY' }), plantInstant(2026, 11, 1, 1, 30));
    expect(toDateInput(night.from)).toBe('2026-10-31');
    const morning = resolveRange(query({ preset: 'TODAY' }), plantInstant(2026, 11, 1, 6, 0));
    expect(toDateInput(morning.from)).toBe('2026-11-01');
  });

  it('last week reaches back seven days from today', () => {
    const range = resolveRange(query({ preset: 'LAST_WEEK' }), NOW);
    expect(toDateInput(range.from)).toBe('2026-08-07');
    expect(toDateInput(range.to)).toBe('2026-08-14');
  });

  it('last month reaches back thirty days from today', () => {
    const range = resolveRange(query({ preset: 'LAST_MONTH' }), NOW);
    expect(toDateInput(range.from)).toBe('2026-07-15');
    expect(toDateInput(range.to)).toBe('2026-08-14');
  });

  it('month wise covers the whole calendar month', () => {
    const range = resolveRange(query({ preset: 'MONTH', month: '2026-07' }), NOW);
    expect(toDateInput(range.from)).toBe('2026-07-01');
    expect(toDateInput(range.to)).toBe('2026-07-31');
  });

  it('month wise handles February in a leap year', () => {
    const range = resolveRange(query({ preset: 'MONTH', month: '2028-02' }), NOW);
    expect(toDateInput(range.to)).toBe('2028-02-29');
  });

  it('month wise falls back to today when the month is malformed', () => {
    const range = resolveRange(query({ preset: 'MONTH', month: 'nonsense' }), NOW);
    expect(toDateInput(range.from)).toBe('2026-08-14');
  });

  it('custom uses the given dates, inclusive of the end day', () => {
    const range = resolveRange(
      query({ preset: 'CUSTOM', from: '2026-05-01', to: '2026-05-31' }),
      NOW,
    );
    expect(toDateInput(range.from)).toBe('2026-05-01');
    expect(toDateInput(range.to)).toBe('2026-05-31');
    expect(toPlantTimeInput(range.to)).toBe('23:59');
  });

  it('custom swaps a backwards range instead of returning nothing', () => {
    const range = resolveRange(
      query({ preset: 'CUSTOM', from: '2026-05-31', to: '2026-05-01' }),
      NOW,
    );
    expect(toDateInput(range.from)).toBe('2026-05-01');
    expect(toDateInput(range.to)).toBe('2026-05-31');
  });
});

describe('guards and parsing', () => {
  it('recognises valid kinds and presets only', () => {
    expect(isExportKind('STOCK')).toBe(true);
    expect(isExportKind('RECALIBRATION')).toBe(true);
    expect(isExportKind('ANYTHING')).toBe(false);
    expect(isRangePreset('MONTH')).toBe(true);
    expect(isRangePreset('YEARLY')).toBe(false);
  });

  it('offers the five By Slab Status reports, in the order asked for (change 12)', () => {
    expect([...EXPORT_KINDS]).toEqual(['STOCK', 'DISPATCH', 'APPROVED', 'SAMPLE_CUTTING', 'RECALIBRATION']);
    expect(EXPORT_KINDS.map((kind) => EXPORT_KIND_LABELS[kind])).toEqual(['In Stock (Current Stock)', 'Dispatched', 'Approved', 'Sample Cutting', 'Recalibration']);
  });

  it('defaults to today’s dispatch sheet', () => {
    const parsed = parseExportQuery({}, NOW);
    expect(parsed.kind).toBe('DISPATCH');
    expect(parsed.preset).toBe('TODAY');
    expect(parsed.month).toBe('2026-08');
    expect(parsed.from).toBe('2026-08-14');
  });

  it('rejects rubbish and keeps the defaults', () => {
    const parsed = parseExportQuery({ kind: 'HACK', preset: 'HACK', month: '13', from: 'x' }, NOW);
    expect(parsed.kind).toBe('DISPATCH');
    expect(parsed.preset).toBe('TODAY');
    expect(parsed.month).toBe('2026-08');
  });

  it('takes the first value when a param repeats', () => {
    const parsed = parseExportQuery({ kind: ['STOCK', 'DISPATCH'] }, NOW);
    expect(parsed.kind).toBe('STOCK');
  });
});

describe('query building', () => {
  it('carries only the fields the preset needs', () => {
    expect(buildExportQuery(query({ preset: 'TODAY' }))).toBe('kind=DISPATCH&preset=TODAY');

    const monthly = buildExportQuery(query({ preset: 'MONTH', month: '2026-07' }));
    expect(monthly).toContain('month=2026-07');
    expect(monthly).not.toContain('from=');

    const custom = buildExportQuery(query({ preset: 'CUSTOM' }));
    expect(custom).toContain('from=2026-08-01');
    expect(custom).toContain('to=2026-08-14');
  });
});

describe('helpers', () => {
  it('names the file after the sheet and the range', () => {
    const range = resolveRange(query({ preset: 'MONTH', month: '2026-07' }), NOW);
    expect(exportFileName('SAMPLE_CUTTING', range)).toBe(
      'chromia-sample-cutting_2026-07-01_to_2026-07-31.xlsx',
    );
  });

  it('lists recent months newest first', () => {
    const months = recentMonths(3, NOW);
    expect(months.map((m) => m.value)).toEqual(['2026-08', '2026-07', '2026-06']);
    expect(months[0]?.label).toBe('August 2026');
  });

  it('formats month and date in plant time, never the server\'s', () => {
    expect(toMonthInput(plantInstant(2026, 1, 31, 23, 30))).toBe('2026-01');
    expect(toDateInput(plantInstant(2026, 1, 31, 23, 30))).toBe('2026-01-31');
    // 23:30 in the plant is 18:00 UTC; 00:30 on 1 Feb is still 31 Jan in UTC.
    expect(toDateInput(plantInstant(2026, 2, 1, 0, 30))).toBe('2026-02-01');
  });

  it('starts the month list from the production day running now', () => {
    expect(recentMonths(1, plantInstant(2026, 11, 1, 1, 30))[0]?.value).toBe('2026-10');
    expect(recentMonths(1, plantInstant(2026, 11, 1, 6, 0))[0]?.value).toBe('2026-11');
  });
});

describe('the prefixed period picker', () => {
  it('reads its own namespaced params', () => {
    const parsed = parseRangeQuery(
      { pPreset: 'MONTH', pMonth: '2026-05', preset: 'CUSTOM', month: '2026-01' },
      'p',
      NOW,
    );
    // The unprefixed params belong to the other picker and must be ignored.
    expect(parsed.preset).toBe('MONTH');
    expect(parsed.month).toBe('2026-05');
  });

  it('reads unprefixed params when no prefix is given', () => {
    expect(parseRangeQuery({ preset: 'LAST_WEEK' }, '', NOW).preset).toBe('LAST_WEEK');
  });

  it('falls back to today when its params are absent or rubbish', () => {
    const parsed = parseRangeQuery({ pPreset: 'NONSENSE' }, 'p', NOW);
    expect(parsed.preset).toBe('TODAY');
    expect(parsed.month).toBe('2026-08');
  });

  it('resolves the same ranges as the outcome picker', () => {
    const range = resolveRange(
      parseRangeQuery({ pPreset: 'MONTH', pMonth: '2026-05' }, 'p', NOW),
      NOW,
    );
    expect(toDateInput(range.from)).toBe('2026-05-01');
    expect(toDateInput(range.to)).toBe('2026-05-31');
  });

  it('carries only the fields its preset needs', () => {
    expect(buildRangeQuery({ preset: 'TODAY', month: '2026-08', from: 'x', to: 'y' })).toBe(
      'preset=TODAY',
    );
    expect(
      buildRangeQuery({ preset: 'CUSTOM', month: '2026-08', from: '2026-05-01', to: '2026-05-31' }),
    ).toContain('from=2026-05-01');
  });

  it('names the production file after the range', () => {
    const range = resolveRange({ preset: 'MONTH', month: '2026-07', from: '', to: '' }, NOW);
    expect(productionFileName(range)).toBe('chromia-production_2026-07-01_to_2026-07-31.xlsx');
  });
});

describe('plant-day filtering', () => {
  const may = resolveRange({ preset: 'MONTH', month: '2026-05', from: '', to: '' }, NOW);

  it('pads the query range by a day at each end', () => {
    const padded = padRange(may);
    expect(toDateInput(padded.gte)).toBe('2026-04-30');
    expect(toDateInput(padded.lte)).toBe('2026-06-01');
  });

  it('accepts a stored day sitting exactly on the first midnight, whichever zone built it', () => {
    // The case that lost the whole May import: a slab received "1 May" is
    // stored as midnight — UTC midnight from the server, or plant midnight
    // from a host set to India time. Either way it is 1 May.
    expect(isWithinRangeDays(new Date(Date.UTC(2026, 4, 1)), may)).toBe(true);
    expect(isWithinRangeDays(plantInstant(2026, 5, 1), may)).toBe(true);
  });

  it('files a stamped instant in the small hours under the night shift that made it', () => {
    // CHR-8: a stock entry QC'd at 01:30 on 1 May is 30 April's C shift. The
    // importer snaps register days to exact midnight (toCalendarDay), so only
    // a stamped time can sit a little past it.
    expect(isWithinRangeDays(plantInstant(2026, 5, 1, 1, 30), may)).toBe(false);
    expect(isWithinRangeDays(plantInstant(2026, 5, 1, 6, 0), may)).toBe(true);
  });

  it('accepts the last moments of the final production day, up to 06:00 the morning after', () => {
    expect(isWithinRangeDays(plantInstant(2026, 5, 31, 23, 59, 59), may)).toBe(true);
    expect(isWithinRangeDays(plantInstant(2026, 6, 1, 5, 59), may)).toBe(true);
  });

  it('still rejects the days either side', () => {
    expect(isWithinRangeDays(plantInstant(2026, 4, 30, 23, 59), may)).toBe(false);
    expect(isWithinRangeDays(plantInstant(2026, 6, 1, 6, 0), may)).toBe(false);
    expect(isWithinRangeDays(new Date(Date.UTC(2026, 5, 1)), may)).toBe(false);
  });

  it('treats a missing date as outside the range', () => {
    expect(isWithinRangeDays(null, may)).toBe(false);
  });
});
