/**
 * One clock for the whole Chromia module: the plant's, Asia/Kolkata.
 *
 * ── THE BUG THIS FIXES ────────────────────────────────────────────────────
 * Every date-time in the module was read and written in the SERVER's timezone,
 * and the server runs in UTC. Two things went wrong from that one fact:
 *
 *   • Instants stamped by the database — a QC saved at 14:53, a slab entered at
 *     14:53, any created/updated time — were FORMATTED in UTC, so the screen
 *     showed 09:23 for something that happened at 14:53. Off by the whole India
 *     offset, on every row.
 *
 *   • Times the operator TYPED — an in-time of 09:15 — were parsed in UTC and
 *     displayed in UTC, so they happened to round-trip, but only because both
 *     ends were wrong in the same direction. The moment the displays are fixed
 *     to plant time, the parsing has to move with them or a typed 09:15 comes
 *     back 14:45.
 *
 * So both ends are pinned here, to one timezone, explicitly — never to the
 * server's. Format an instant → plant time. Parse a typed wall-clock → the
 * instant that wall-clock names in the plant. The result is server-independent:
 * it is correct on a UTC host, an IST host, or anywhere else.
 *
 * India Standard Time is a fixed +05:30 with no daylight saving, ever, which is
 * why the offset can be a constant and the arithmetic is exact.
 *
 * Date-ONLY values (a production date, a dispatch date) are stored as midnight
 * and only ever shown as a day; +05:30 keeps them on the same calendar day, so
 * they read correctly through the plant-time formatters without any change to
 * how they are stored or filtered.
 */

export const PLANT_TIME_ZONE = 'Asia/Kolkata';

/** +05:30, in milliseconds. IST has no DST, so this never varies. */
const PLANT_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

const pad = (value: number) => String(value).padStart(2, '0');

/** The plant-local calendar/clock parts of an instant. */
function plantParts(date: Date): {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
} {
  // Shift the instant by the offset, then read UTC parts: with no DST to worry
  // about, that is exactly the plant-local wall clock.
  const shifted = new Date(date.getTime() + PLANT_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
  };
}

/**
 * The instant a plant-local wall clock names.
 *
 * `plantInstant(2026, 8, 24, 14, 53)` is 14:53 in the plant — 09:23 UTC. This
 * is how a typed date and time become a stored instant, so the value that comes
 * back through the formatters below is the one that was typed.
 */
export function plantInstant(
  year: number,
  month: number,
  day: number,
  hours = 0,
  minutes = 0,
  seconds = 0,
): Date {
  return new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds) - PLANT_OFFSET_MS);
}

/** `yyyy-mm-dd` in plant time — for date inputs and day keys. */
export function toPlantDateInput(date: Date): string {
  const p = plantParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** `HH:mm` in plant time — for time inputs and the "now" default. */
export function toPlantTimeInput(date: Date): string {
  const p = plantParts(date);
  return `${pad(p.hours)}:${pad(p.minutes)}`;
}

/*
 * ── THE DAY A CHROMIA REPORT FILES A DATE UNDER ──────────────────────────
 *
 * The owner's decision of 20 Oct 2026 (CHR-8 and SHOP-6 of the code review of
 * that day): "today" is the plant's production day, 06:00 to 06:00, the house
 * rule every other ERP report already keeps. A shift starts at 06:00 and C
 * shift runs past midnight, so a calendar day would cut C shift in half and
 * blame two dates for one night's work.
 *
 * What went wrong before. The Downloads sheets, the Summary diary and the
 * dashboard's "today" bucketed with getFullYear/getMonth/getDate, which is the
 * SERVER's day, and the server runs in UTC. A slab QC'd to Stock at 01:30 on
 * 1 Nov (C shift) gets stockDate = now = 2026-10-31T20:00Z: the October Stock
 * sheet filtered it in (UTC day 31 Oct) but printed it as 1 Nov (the plant's
 * calendar day), and November's sheet left it out. One rule now decides both
 * the filter and the printed date: toPlantReportDay.
 *
 * Two kinds of value sit in the same columns, and each keeps its own meaning:
 *
 *   • A DAY someone typed or a register carried — a production date, a
 *     dispatch date from the Dispatch page, every date the importer reads. It
 *     is stored as midnight: midnight UTC when it was built on the server
 *     (registerDay, the importer's toCalendarDay, toDateColumn and a zod date
 *     all build midnight in the server's zone, which is UTC on Vercel), or
 *     midnight plant time from a host set to India time. That day IS the
 *     answer; it is never moved, whatever the clock rule. 1 Nov typed is 1 Nov.
 *   • An INSTANT the system stamped — a QC's stock or sample-cut time (the QC
 *     form has no date field, so the service stamps now), a cycle's out-time,
 *     a recalibration record's creation. That falls on the production day it
 *     happened in: its plant wall clock less six hours. 01:30 on 1 Nov is
 *     31 Oct's C shift.
 *
 * Telling them apart: a stored day is midnight UTC or midnight plant time TO
 * THE MILLISECOND. An instant stamped by the system lands there one time in
 * 86 million. The only values that can sit exactly on one are clock times
 * typed as 00:00 or 05:30 (an in-time), and no report buckets those.
 */

/** The production day starts at 06:00 plant time — A shift. */
export const PRODUCTION_DAY_START_HOUR = 6;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** `yyyy-mm-dd` of the production day an instant falls in: its plant wall clock, less six hours. */
export function toPlantProductionDay(date: Date): string {
  return toPlantDateInput(new Date(date.getTime() - PRODUCTION_DAY_START_HOUR * HOUR_MS));
}

/** True when a stored value is a calendar day, not an instant: midnight UTC, or midnight plant time, to the millisecond. */
export function isStoredDay(date: Date): boolean {
  const atMidnight = (ms: number) => ((ms % DAY_MS) + DAY_MS) % DAY_MS === 0;
  return atMidnight(date.getTime()) || atMidnight(date.getTime() + PLANT_OFFSET_MS);
}

/**
 * The day a Chromia report files a stored date under, as `yyyy-mm-dd`: a stored
 * day is its own calendar day; an instant is the production day it fell in.
 * Every Chromia day filter and every printed report date goes through this.
 */
export function toPlantReportDay(date: Date): string {
  return isStoredDay(date) ? toPlantDateInput(date) : toPlantProductionDay(date);
}

/** The production day running at `now` — before 06:00 it is still yesterday. */
export function plantToday(now: Date = new Date()): string {
  return toPlantProductionDay(now);
}

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A `yyyy-mm-dd` that names a real calendar day (2026-02-31 does not). */
export function isPlantDayKey(value: string): boolean {
  const match = DAY_KEY.exec(value);
  if (!match) return false;
  const t = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(t).toISOString().slice(0, 10) === value;
}

/** A day key moved by `n` days. Label arithmetic: a day label has no 23- or 25-hour variant. */
export function addPlantDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** 00:00 plant time on a day key — the instant a plant-day range starts. */
export function plantDayStart(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  return plantInstant(year ?? 1970, month ?? 1, date ?? 1);
}

/**
 * The instants bounding a run of plant days, both ends inclusive: 00:00 plant
 * time on the first, 23:59:59.999 plant time on the last. Read back through
 * toPlantDateInput they are the two days that were asked for, and every
 * plant-time formatter prints them as those days.
 */
export function plantDayRange(fromDay: string, toDay: string): { from: Date; to: Date } {
  return {
    from: plantDayStart(fromDay),
    to: new Date(plantDayStart(addPlantDays(toDay, 1)).getTime() - 1),
  };
}

/*
 * Display formatters, all pinned to plant time and built once. Each mirrors the
 * option shape a page was already using, so the ONLY thing that changes on
 * screen is the offset — "24 Aug, 09:23" becomes "24 Aug, 14:53", not a
 * different layout.
 */
const DATE = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: PLANT_TIME_ZONE,
});

const DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: PLANT_TIME_ZONE,
});

const TIME = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: PLANT_TIME_ZONE,
});

/** "24 Aug 2026". */
export const formatPlantDate = (date: Date): string => DATE.format(date);

/** "24 Aug, 14:53". */
export const formatPlantDateTime = (date: Date): string => DATE_TIME.format(date);

/** "14:53". */
export const formatPlantTime = (date: Date): string => TIME.format(date);

/** "24 Aug 2026" for a `yyyy-mm-dd` plant day key — midday, so no clock rule can move it. */
export const formatPlantDay = (day: string): string => DATE.format(new Date(plantDayStart(day).getTime() + 12 * HOUR_MS));

/** "24 Aug 2026" for the day a report files a stored date under (toPlantReportDay). */
export const formatPlantReportDay = (date: Date): string => formatPlantDay(toPlantReportDay(date));
