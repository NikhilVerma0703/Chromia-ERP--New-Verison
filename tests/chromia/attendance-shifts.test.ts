import { describe, expect, it } from 'vitest';

import {
  INCOMPLETE_PREVIOUS_DAY,
  SUM_OF_HOURS_LABEL,
  minutesLabel,
  sumWorkedMinutes,
  anotherShiftError,
  canStartAnotherShift,
  nightShiftStillOpen,
  outDate,
  overnightAwaitingOut,
  previousDayIncomplete,
  previousDayState,
  shiftLengthError,
  shiftOverlapError,
  workedLabel,
  workedMinutes,
} from '@/lib/attendance/attendance';

/**
 * Attendance — night shifts and more than one shift a day (7 Nov 2026).
 * The owner's two cases, and the edges either side of them.
 */

const SAT = '2026-11-07';
const SUN = '2026-11-08';

describe('a normal day shift', () => {
  it('counts its hours and stays on its own date', () => {
    expect(workedMinutes('06:00', '14:00')).toBe(480);
    expect(workedLabel('06:00', '14:00')).toBe('8h');
    expect(outDate(SAT, '06:00', '14:00')).toBe(SAT);
    expect(shiftLengthError('06:00', '14:00')).toBeNull();
  });
});

describe('a night shift: In 18:00 on the 7th, Out 06:00 on the 8th', () => {
  it('is 12 hours, and its Out belongs to the 8th', () => {
    expect(workedMinutes('18:00', '06:00')).toBe(720);
    expect(workedLabel('18:00', '06:00')).toBe('12h');
    expect(outDate(SAT, '18:00', '06:00')).toBe(SUN);
    expect(shiftLengthError('18:00', '06:00')).toBeNull();
  });

  it('is awaiting its Out on the 8th — not incomplete — while it could still be running', () => {
    const open = { shiftNo: 1, inTime: '18:00', outTime: null };
    // Past midnight, at 06:00: 12 hours in.
    expect(overnightAwaitingOut(open, { isToday: true, now: '06:00' })).toBe(true);
    expect(overnightAwaitingOut(open, { isToday: true, now: '00:30' })).toBe(true);
    expect(previousDayState([open], false, { isToday: true, now: '06:00' })).toEqual({ kind: 'overnight', row: open });
  });

  it('is genuinely incomplete once it could not still be running (more than 16 hours)', () => {
    const open = { shiftNo: 1, inTime: '18:00', outTime: null };
    expect(overnightAwaitingOut(open, { isToday: true, now: '10:30' })).toBe(false);
    expect(previousDayState([open], false, { isToday: true, now: '10:30' }).kind).toBe('incomplete');
  });

  it('read for an earlier date, an open evening shift is the night shift awaiting the Out that was missed', () => {
    expect(overnightAwaitingOut({ inTime: '22:00', outTime: '' }, { isToday: false, now: '15:00' })).toBe(true);
  });

  it('only an evening In (from 18:00) can be a night shift', () => {
    const day = { shiftNo: 1, inTime: '14:00', outTime: null };
    expect(overnightAwaitingOut(day, { isToday: true, now: '02:00' })).toBe(false);
    expect(previousDayState([day], false, { isToday: true, now: '02:00' }).kind).toBe('incomplete');
  });

  it('a new shift waits until it is marked out, with a sentence saying so', () => {
    expect(nightShiftStillOpen(SAT)).toBe('The night shift from 07/11/2026 has no Out-Time yet. Mark it out first.');
  });
});

describe('genuinely incomplete attendance still holds', () => {
  it('an Out with no In, or an earlier shift left open, is incomplete', () => {
    expect(previousDayState([{ shiftNo: 1, inTime: null, outTime: '14:00' }], false, { isToday: true, now: '06:00' }).kind).toBe('incomplete');
    // Shift 1 never marked out, shift 2 an evening shift: shift 1 is the problem.
    const rows = [
      { shiftNo: 1, inTime: '06:00', outTime: null },
      { shiftNo: 2, inTime: '18:00', outTime: null },
    ];
    expect(previousDayState(rows, false, { isToday: true, now: '05:00' })).toEqual({ kind: 'incomplete', row: rows[0] });
    expect(INCOMPLETE_PREVIOUS_DAY).toMatch(/incomplete/);
  });

  it('leave, no row, and finished shifts hold nobody', () => {
    const open = { shiftNo: 1, inTime: '08:00', outTime: null };
    expect(previousDayState([open], true, { isToday: true, now: '06:00' }).kind).toBe('clear');
    expect(previousDayState([], false, { isToday: true, now: '06:00' }).kind).toBe('clear');
    expect(previousDayState([{ shiftNo: 1, inTime: '18:00', outTime: '06:00' }], false, { isToday: true, now: '07:00' }).kind).toBe('clear');
    // The original single-row rule is unchanged.
    expect(previousDayIncomplete({ row: { inTime: '06:00', outTime: '14:00' } })).toBe(false);
  });

  it('two finished shifts, then a night shift still running: that last one is awaiting its Out', () => {
    const rows = [
      { shiftNo: 1, inTime: '06:00', outTime: '10:00' },
      { shiftNo: 2, inTime: '20:00', outTime: null },
    ];
    expect(previousDayState(rows, false, { isToday: true, now: '04:00' })).toEqual({ kind: 'overnight', row: rows[1] });
  });
});

describe('another shift on the same date (the Sunday call-back)', () => {
  it('Sat 18:00 → Sun 06:00, then Sun 14:00: the 14:00 is after the night shift ended', () => {
    const saturday = [{ shiftNo: 1, inTime: '18:00', outTime: '06:00' }];
    expect(shiftOverlapError({ date: SUN, shift: { shiftNo: 1, inTime: '14:00', outTime: null }, previousDayRows: saturday, dayRows: [] })).toBeNull();
    // Before the night shift ended, it would overlap it.
    expect(shiftOverlapError({ date: SUN, shift: { shiftNo: 1, inTime: '05:00', outTime: null }, previousDayRows: saturday, dayRows: [] }))
      .toMatch(/previous shift ended at 06:00/);
  });

  it('a second shift may start once the first is finished, and not before', () => {
    const finished = [{ shiftNo: 1, inTime: '06:00', outTime: '14:00' }];
    expect(canStartAnotherShift(finished)).toBe(true);
    expect(anotherShiftError(SUN, finished)).toBeNull();

    const open = [{ shiftNo: 1, inTime: '06:00', outTime: null }];
    expect(canStartAnotherShift(open)).toBe(false);
    expect(anotherShiftError(SUN, open)).toBe('Shift 1 on 08/11/2026 is not finished yet. Mark it out before starting another shift.');

    expect(canStartAnotherShift([])).toBe(false); // the first shift is simply entered
  });

  it('no second shift on a date whose shift ran past midnight', () => {
    const night = [{ shiftNo: 1, inTime: '18:00', outTime: '06:00' }];
    expect(canStartAnotherShift(night)).toBe(false);
    expect(anotherShiftError(SAT, night)).toMatch(/ran past midnight/);
  });

  it('each shift keeps its own hours, and they may not overlap', () => {
    const day = [{ shiftNo: 1, inTime: '06:00', outTime: '14:00' }];
    expect(workedLabel('06:00', '14:00')).toBe('8h');
    expect(workedLabel('18:00', '22:30')).toBe('4h 30m');
    expect(shiftOverlapError({ date: SUN, shift: { shiftNo: 2, inTime: '18:00', outTime: '22:30' }, previousDayRows: [], dayRows: day })).toBeNull();
    expect(shiftOverlapError({ date: SUN, shift: { shiftNo: 2, inTime: '13:00', outTime: null }, previousDayRows: [], dayRows: day }))
      .toMatch(/previous shift ended at 14:00/);
    // Correcting shift 1's Out past shift 2's In is refused too.
    const both = [{ shiftNo: 2, inTime: '18:00', outTime: '22:00' }];
    expect(shiftOverlapError({ date: SUN, shift: { shiftNo: 1, inTime: '06:00', outTime: '19:00' }, previousDayRows: [], dayRows: both }))
      .toMatch(/Shift 2 starts at 18:00/);
    expect(shiftOverlapError({ date: SUN, shift: { shiftNo: 1, inTime: '06:00', outTime: '02:00' }, previousDayRows: [], dayRows: both }))
      .toMatch(/cannot run past midnight/);
  });
});

describe('impossible pairs are refused, not stored as a shift with no hours', () => {
  it('equal times, and more than 16 hours', () => {
    expect(shiftLengthError('08:00', '08:00')).toMatch(/not a shift/);
    expect(shiftLengthError('18:00', '11:00')).toMatch(/at most 16 hours/); // 17 hours
    expect(shiftLengthError('06:00', '')).toBeNull(); // not marked out yet
  });
});

describe('Downloads — Sum of Total Working Hours (change 7)', () => {
  it('the owner’s example: 9h 12m + 12h 7m + 12h 27m = 33h 46m', () => {
    const rows = [
      { inTime: '06:00', outTime: '15:12' }, // 9h 12m
      { inTime: '18:00', outTime: '06:07' }, // 12h 7m, across midnight
      { inTime: '08:00', outTime: '20:27' }, // 12h 27m
    ];
    expect(rows.map((r) => workedLabel(r.inTime, r.outTime))).toEqual(['9h 12m', '12h 7m', '12h 27m']);
    expect(minutesLabel(sumWorkedMinutes(rows))).toBe('33h 46m');
  });

  it('minutes carry into hours, and a shift not marked out adds nothing', () => {
    expect(minutesLabel(sumWorkedMinutes([{ inTime: '08:00', outTime: '08:45' }, { inTime: '09:00', outTime: '09:30' }]))).toBe('1h 15m');
    expect(minutesLabel(sumWorkedMinutes([{ inTime: '08:00', outTime: null }, { inTime: '10:00', outTime: '12:00' }]))).toBe('2h');
    expect(minutesLabel(sumWorkedMinutes([]))).toBe('0h');
    expect(minutesLabel(45)).toBe('45m');
    expect(minutesLabel(60 * 100 + 5)).toBe('100h 5m'); // never rolled into days
    expect(SUM_OF_HOURS_LABEL).toBe('Sum of Total Working Hours');
  });
});
