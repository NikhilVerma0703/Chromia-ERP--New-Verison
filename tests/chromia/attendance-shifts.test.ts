import { describe, expect, it } from 'vitest';

import {
  INCOMPLETE_PREVIOUS_DAY,
  SUM_OF_HOURS_LABEL,
  minutesLabel,
  sumWorkedMinutes,
  anotherShiftError,
  canStartAnotherShift,
  laterThanNowError,
  outDaysOf,
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

  it('is still the shift running however long it has been — there is no longest shift (17 Nov 2026)', () => {
    const open = { shiftNo: 1, inTime: '18:00', outTime: null };
    expect(overnightAwaitingOut(open, { isToday: true, now: '10:30' })).toBe(true);
    expect(previousDayState([open], false, { isToday: true, now: '10:30' })).toEqual({ kind: 'overnight', row: open });
  });

  it('read for an earlier date, an open evening shift is the night shift awaiting the Out that was missed', () => {
    expect(overnightAwaitingOut({ inTime: '22:00', outTime: '' }, { isToday: false, now: '15:00' })).toBe(true);
  });

  it('any In-Time, early or late, left open is the shift still running — marked out from the next date', () => {
    const day = { shiftNo: 1, inTime: '06:00', outTime: null };
    expect(overnightAwaitingOut(day, { isToday: true, now: '07:00' })).toBe(true); // 25 hours on
    expect(overnightAwaitingOut({ inTime: '07:30', outTime: '' }, { isToday: false, now: '15:00' })).toBe(true);
  });

  it('a new shift waits until it is marked out, with a sentence saying so', () => {
    expect(nightShiftStillOpen(SAT)).toBe('The night shift from 07/11/2026 has no Out-Time yet. Mark it out first.');
  });
});

describe('an In-Time before 18:00, Out the next morning (17 Nov 2026)', () => {
  const NEXT = SUN;

  it.each([
    ['16:45', '06:12', 807, '13h 27m'],
    ['17:53', '06:12', 739, '12h 19m'],
    ['17:56', '06:12', 736, '12h 16m'],
  ])('In %s today, Out %s tomorrow: one shift of %i minutes (%s)', (inTime, outTime, minutes, label) => {
    expect(workedMinutes(inTime, outTime)).toBe(minutes);
    expect(workedLabel(inTime, outTime)).toBe(label);
    expect(shiftLengthError(inTime, outTime)).toBeNull();
    // Saved on the row of the day it started; its Out is the next date's.
    expect(outDate(SAT, inTime, outTime)).toBe(NEXT);
  });

  it('is the shift still running the next morning, so it can be marked out — not incomplete', () => {
    for (const inTime of ['16:45', '17:53', '17:56']) {
      const open = { shiftNo: 1, inTime, outTime: null };
      expect(overnightAwaitingOut(open, { isToday: true, now: '06:12' })).toBe(true);
      expect(previousDayState([open], false, { isToday: true, now: '06:12' })).toEqual({ kind: 'overnight', row: open });
    }
    // Read for an earlier date too: it could have run past midnight.
    expect(overnightAwaitingOut({ inTime: '16:45', outTime: '' }, { isToday: false, now: '15:00' })).toBe(true);
  });

  it('the Out recorded on the next date gives the same hours', () => {
    expect(outDaysOf(SAT, NEXT)).toBe(1);
    expect(workedLabel('17:56', '06:12', outDaysOf(SAT, NEXT))).toBe('12h 16m');
    expect(outDate(SAT, '17:56', '06:12', NEXT)).toBe(NEXT);
  });
});

describe('no longest shift: an operator may work 35 hours or more (17 Nov 2026)', () => {
  const MON = '2026-11-09';

  it('08:00 on the 7th to 19:00 on the 8th is 35 hours — the recorded Out date says which', () => {
    expect(workedMinutes('08:00', '19:00', 1)).toBe(35 * 60);
    expect(workedLabel('08:00', '19:00', outDaysOf(SAT, SUN))).toBe('35h');
    expect(outDate(SAT, '08:00', '19:00', SUN)).toBe(SUN);
    // Without a recorded date the times read as they always did: the same day, 11 hours.
    expect(workedLabel('08:00', '19:00')).toBe('11h');
    expect(shiftLengthError('08:00', '19:00', 1)).toBeNull();
  });

  it('more than a day, and longer than 16 hours, is a shift', () => {
    expect(workedLabel('06:00', '07:30', 2)).toBe('49h 30m');
    expect(shiftLengthError('18:00', '11:00')).toBeNull(); // 17 hours, the next morning
    expect(workedLabel('14:00', '06:12')).toBe('16h 12m');
  });

  it('the Out still has to come after the In', () => {
    expect(shiftLengthError('08:00', '08:00')).toMatch(/Out-Time must be after the In-Time/);
    expect(shiftLengthError('08:00', '07:00', 0)).toMatch(/Out-Time must be after the In-Time/);
    expect(workedMinutes('08:00', '07:00', 0)).toBeNull();
  });

  it('adds into the Sum of Total Working Hours by its recorded date', () => {
    expect(minutesLabel(sumWorkedMinutes([
      { date: SAT, inTime: '08:00', outTime: '19:00', outDate: SUN }, // 35h
      { date: MON, inTime: '06:00', outTime: '14:00' }, // 8h, no date recorded
    ]))).toBe('43h');
  });

  it('a shift that ended on a later date: no second shift on its own date', () => {
    const long = [{ shiftNo: 1, inTime: '08:00', outTime: '19:00', outDate: SUN }];
    expect(canStartAnotherShift(long, SAT)).toBe(false);
    expect(anotherShiftError(SAT, long)).toMatch(/ran past midnight/);
    expect(canStartAnotherShift([{ shiftNo: 1, inTime: '08:00', outTime: '19:00', outDate: SAT }], SAT)).toBe(true);
  });

  it('the next date may start only after it ended, and a date it ran through takes no shift at all', () => {
    const sat = [{ shiftNo: 1, inTime: '08:00', outTime: '19:00', outDate: SUN }];
    expect(shiftOverlapError({ date: SUN, shift: { shiftNo: 1, inTime: '18:00', outTime: null }, previousDayRows: sat, dayRows: [] }))
      .toMatch(/previous shift ended at 19:00/);
    expect(shiftOverlapError({ date: SUN, shift: { shiftNo: 1, inTime: '19:30', outTime: null }, previousDayRows: sat, dayRows: [] })).toBeNull();
    const toMonday = [{ shiftNo: 1, inTime: '08:00', outTime: '07:30', outDate: MON }];
    expect(shiftOverlapError({ date: SUN, shift: { shiftNo: 1, inTime: '20:00', outTime: null }, previousDayRows: toMonday, dayRows: [] }))
      .toMatch(/ran until 07:30 on 09\/11\/2026, so no shift can start on 08\/11\/2026/);
  });

  it('a typed Out on a later date than today has not happened yet', () => {
    expect(laterThanNowError('07:00', '10:00', '08:00', 1)).toMatch(/cannot be later than now/);
    expect(laterThanNowError('07:00', '10:00', '08:00', 0)).toBeNull();
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
  it('equal times are no shift; an Out not yet marked is not judged', () => {
    expect(shiftLengthError('08:00', '08:00')).toMatch(/not a shift/);
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
