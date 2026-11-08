/**
 * The Attendance register's own rules — the half that is pure arithmetic and
 * text, so `node --test` can reach it and the two ERPs cannot drift apart by
 * each deciding something for itself.
 *
 * Pure and alias-free, like lib/robo/productionDate.ts.
 *
 * ── ONE REGISTER, TWO ERPs ────────────────────────────────────────────────
 * Robo and Chromia share the operators, so they share the register: the same
 * three attendance_* tables, read and written by both. Nothing is copied
 * between them and nothing has to be kept in step, because there is only ever
 * one row — (date, operator, shift) is unique in the database, so the same
 * shift entered from either screen is the same record, and an edit on one
 * screen IS the edit on the other. (A second shift on one date has its own
 * row, shift 2 — 7 Nov 2026.)
 *
 * Times are "HH:MM" and dates yyyy-mm-dd, the convention the shop floor
 * already uses. No Date object, no timezone, anywhere in this file.
 */

import { CLOCK_SKEW_MINUTES, INVALID_TIME } from "./clock.ts";

/* ── The two lines ─────────────────────────────────────────────────── */

/** Stored codes, in the order they are offered and shown. */
export const LINES = ["ROBO", "CHROMIA"] as const;
export type LineCode = (typeof LINES)[number];

export const LINE_LABELS: Record<LineCode, string> = {
  ROBO: "Robo Line",
  CHROMIA: "Chromia Line",
};

/**
 * The lines of a stored row: comma-joined codes, always in LINES order and
 * never repeated, so "CHROMIA,ROBO" and "ROBO,ROBO,CHROMIA" both read as the
 * one set they mean. Anything that is not a line is dropped rather than shown
 * as a line nobody runs.
 */
export function parseLines(stored: string | null | undefined): LineCode[] {
  const seen = new Set(
    String(stored ?? "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s): s is LineCode => (LINES as readonly string[]).includes(s)),
  );
  return LINES.filter((l) => seen.has(l));
}

/** The storage form of a set of lines — the inverse of parseLines, and the
 *  only thing that writes attendance_day.lines. */
export function joinLines(lines: readonly string[]): string {
  return parseLines(lines.join(",")).join(",");
}

/** "Robo Line", "Robo Line + Chromia Line", or "-" when none is set. */
export function linesLabel(stored: string | null | undefined): string {
  const l = parseLines(stored);
  return l.length === 0 ? "-" : l.map((c) => LINE_LABELS[c]).join(" + ");
}

/* ── Worked hours ──────────────────────────────────────────────────── */

/** Minutes since midnight for "HH:MM", or null. */
function toMins(t: string | null | undefined): number | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(t ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h > 23 || min > 59 ? null : h * 60 + min;
}

/** The longest shift the register will accept as one day's work. A night
 *  shift that starts at 22:00 and ends at 06:00 is eight hours; anything past
 *  sixteen is a typed Out that belongs to a different day. */
export const MAX_SHIFT_MINUTES = 16 * 60;

/**
 * Minutes worked between an In and an Out, or null when the pair cannot say.
 *
 * An Out earlier than the In is the night shift crossing midnight (22:00 →
 * 06:00 is 8 hours), the same reading the Robo delay log and the hourly
 * reports already use. Equal times are null, not zero: nobody works a shift of
 * no length, so it is a typo rather than a reading. Past MAX_SHIFT_MINUTES it
 * is null too — an inverted or mistyped pair should show as nothing rather
 * than as an impossible day.
 */
export function workedMinutes(inTime: string | null | undefined, outTime: string | null | undefined): number | null {
  const a = toMins(inTime);
  const b = toMins(outTime);
  if (a === null || b === null) return null;
  let diff = b - a;
  if (diff < 0) diff += 24 * 60;
  if (diff <= 0 || diff > MAX_SHIFT_MINUTES) return null;
  return diff;
}

/** "8h 15m", "45m" — the same shape fmtDuration gives everywhere else, and
 *  "-" when there is nothing to show. */
export function workedLabel(inTime: string | null | undefined, outTime: string | null | undefined): string {
  const mins = workedMinutes(inTime, outTime);
  if (mins === null) return "-";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

/** The label under every individual operator's Downloads results (7 Nov 2026). */
export const SUM_OF_HOURS_LABEL = "Sum of Total Working Hours";

/** Minutes as the register writes hours: "33h 46m", "8h", "45m", and "0h" for none. */
export function minutesLabel(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0 && m === 0) return "0h";
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

/**
 * The sum of Total Working Hours over a set of shifts — each shift's own
 * minutes (workedMinutes, the figure its row shows), added as minutes, so
 * 9h 12m + 12h 7m + 12h 27m is 33h 46m exactly. A shift with no hours to show
 * (not marked out yet) adds nothing, as its row reads "-".
 */
export function sumWorkedMinutes(rows: readonly { inTime?: string | null; outTime?: string | null }[]): number {
  return rows.reduce((sum, row) => sum + (workedMinutes(row.inTime, row.outTime) ?? 0), 0);
}

/* ── Which day a row belongs to ────────────────────────────────────── */

/** Whole days since the epoch for a yyyy-mm-dd, or null. UTC, so no timezone
 *  moves a date that was only ever a date. */
function dayNum(date: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((date ?? "").trim());
  return m ? Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000) : null;
}

/** The yyyy-mm-dd `days` days from `date`, or "" when that is not a date. */
export function shiftDate(date: string | null | undefined, days: number): string {
  const d = dayNum(date);
  return d === null ? "" : new Date((d + days) * 86_400_000).toISOString().slice(0, 10);
}

/** The day before — what the register must have finished with before a new
 *  entry is made. */
export const previousDay = (date: string | null | undefined): string => shiftDate(date, -1);

/** Where a row's date sits against the plant's own today. The register is
 *  kept on the plant clock, not on whatever a tablet believes the date is. */
export type DayKind = "today" | "past" | "future";

export function dayKind(date: string | null | undefined, today: string): DayKind {
  const a = dayNum(date);
  const b = dayNum(today);
  if (a === null || b === null) return "today"; // unreadable: judge it as now
  return a === b ? "today" : a < b ? "past" : "future";
}

/* ── A shift that crosses midnight ─────────────────────────────────── */

/**
 * Did this row's Out-Time fall after midnight?
 *
 * The night shift goes in at 22:00 and comes out at 06:00. The row is one row,
 * dated the day the shift STARTED, and its Out belongs to the next date — the
 * hours have always been counted that way round (workedMinutes wraps), so this
 * only names what the arithmetic already does, for a screen that has to show
 * which day the 06:00 was.
 */
export function rollsOvernight(inTime: string | null | undefined, outTime: string | null | undefined): boolean {
  const a = toMins(inTime);
  const b = toMins(outTime);
  return a !== null && b !== null && b < a;
}

/** The date an Out-Time belongs to: the row's own, or the next one when the
 *  shift crossed midnight. "" when there is no Out-Time to date. */
export function outDate(date: string | null | undefined, inTime: string | null | undefined, outTime: string | null | undefined): string {
  if (!String(outTime ?? "").trim()) return "";
  return rollsOvernight(inTime, outTime) ? shiftDate(date, 1) : String(date ?? "");
}

/* ── Yesterday has to be finished first ────────────────────────────── */

/**
 * What the register says when an operator's previous day is unfinished.
 *
 * The owner's words, exactly: it is the sentence the floor will be told, and
 * the server and the screen say the same one because they both read it here.
 */
export const INCOMPLETE_PREVIOUS_DAY =
  "Previous day's attendance entry is incomplete. Please complete it first.";

/**
 * Is the operator's previous day unfinished, so today may not be entered?
 *
 * Unfinished means a day that was STARTED AND NOT FINISHED: an In-Time with
 * no Out-Time (the Out was never recorded), or an Out-Time with no In-Time
 * (the entry was missed). Three things are not unfinished, or the register
 * would lock the floor out of itself:
 *
 *   • NO ROW AT ALL. A weekly off, a plant holiday or a day from before the
 *     register went live leaves no row, and none of them is a day to finish.
 *     The register has no roster of working days to tell those from a missed
 *     shift, so a missing day holds nobody (code review, 26 Oct 2026). The
 *     owner may later want missed days flagged; that needs a working-day
 *     roster to check against, not the bare absence of a row.
 *   • AN EMPTY LINE. A row that holds neither time is not an entry.
 *   • LEAVE. An operator with a leave row that day is not held — their
 *     absence is recorded, which is the whole point of the leave register.
 *
 * Nothing here reaches the database; the caller brings the two facts.
 */
export function previousDayIncomplete(prev: {
  /** The operator's row for the previous day, if there is one. */
  row?: { inTime?: string | null; outTime?: string | null } | null;
  /** Do they have a leave record for that day? */
  onLeave?: boolean;
}): boolean {
  if (prev.onLeave || !prev.row) return false;
  const inTime = String(prev.row.inTime ?? "").trim();
  const outTime = String(prev.row.outTime ?? "").trim();
  return Boolean(inTime) !== Boolean(outTime);
}

/* ── Last night's shift ────────────────────────────────────────────── */

/** The earliest In-Time of a shift that may run into the next morning: an
 *  evening shift (owner, 26 Oct 2026: only for evening shifts, In from 6 pm). */
export const EVENING_SHIFT_FROM = "18:00";

/**
 * Could a shift that went in at `inTime` on one date still be that same shift
 * at `now` on the NEXT date?
 *
 * Only an evening shift (In at or after EVENING_SHIFT_FROM), and only while the
 * time from the In to now is no longer than MAX_SHIFT_MINUTES — the longest the
 * register accepts as one day's work. 22:00 in, 06:00 now is eight hours: the
 * night shift. 14:00 in, 05:00 now is fifteen hours but a day shift nobody
 * marked out of, and 06:00 in, 07:00 now is twenty-five; stamping the morning
 * on either would read as a shift that never happened.
 */
export function overnightShiftOpen(inTime: string | null | undefined, now: string | null | undefined): boolean {
  const a = toMins(inTime);
  const n = toMins(now);
  if (a === null || n === null) return false;
  if (a < (toMins(EVENING_SHIFT_FROM) as number)) return false;
  const span = 24 * 60 - a + n;
  return span > 0 && span <= MAX_SHIFT_MINUTES;
}

/**
 * Is this save ONLY the Out-Time going onto a row that was marked in and never
 * marked out — the same Lines, the same In-Time, and an Out-Time sent?
 *
 * The line tablet may do this to the previous day's row, and nothing else on
 * that day (code review, 26 Oct 2026): the night shift marks in at 22:00 on
 * one date and out at 06:00 on the next, and the row is dated the day it
 * started. The Out is still stamped from the server's clock, never typed.
 */
export function closesOpenRow(
  existing: { lines?: string | null; inTime?: string | null; outTime?: string | null } | null | undefined,
  sent: { lines?: string | null; inTime?: unknown; outTime?: unknown },
): boolean {
  if (!existing) return false;
  const text = (v: unknown) => String(v ?? "").trim();
  const inTime = text(existing.inTime);
  if (!inTime || text(existing.outTime)) return false; // not an open row
  return text(sent.inTime) === inTime
    && joinLines(parseLines(sent.lines)) === joinLines(parseLines(existing.lines))
    && text(sent.outTime) !== "";
}

/** Said when the tablet tries to mark out a shift that is not last night's
 *  evening shift (In from 6 pm, within 16 hours). */
export const SHIFT_TOO_LONG =
  "Only last night's evening shift (In from 6 pm) can be marked out here the next morning. Ask the Plant In-Charge to enter the Out-Time.";

/**
 * Last night's row, when it is the night shift that ran into this morning —
 * the shift crossed midnight, or it is still open and could still be running
 * (overnightShiftOpen). Null otherwise.
 *
 * For the 07:00 report: the shift that went in at 22:00 yesterday is stored
 * on yesterday's row, and without this it would be in no report at all.
 */
export function nightShiftRow<R extends { inTime?: string | null; outTime?: string | null }>(
  lastNight: R | null | undefined,
  now: string,
): R | null {
  if (!lastNight) return null;
  const inTime = String(lastNight.inTime ?? "").trim();
  const outTime = String(lastNight.outTime ?? "").trim();
  if (!inTime) return null;
  if (outTime) return rollsOvernight(inTime, outTime) ? lastNight : null;
  return overnightShiftOpen(inTime, now) ? lastNight : null;
}

/* ── Night shifts and more than one shift a day (7 Nov 2026) ───────── */

/** dd/mm/yyyy for a yyyy-mm-dd — how the register's sentences name a day. */
const dmyOf = (date: string | null | undefined) =>
  String(date ?? "").replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$3/$2/$1");

/** One shift's row, as these rules read it. `shiftNo` is 1 for the first
 *  shift of a date, 2 for the next, and so on. */
export interface ShiftRow {
  shiftNo?: number | null;
  lines?: string | null;
  inTime?: string | null;
  outTime?: string | null;
}

const txt = (v: string | null | undefined) => String(v ?? "").trim();
const byShift = <R extends ShiftRow>(rows: readonly R[]) => [...rows].sort((a, b) => (a.shiftNo ?? 1) - (b.shiftNo ?? 1));

/**
 * Is this open row a NIGHT SHIFT STILL AWAITING ITS OUT-TIME, rather than an
 * unfinished day?
 *
 * The owner's case (7 Nov 2026): In at 18:00 on the 7th, Out at 06:00 on the
 * 8th. On the 8th the row from the 7th is open — that is the shift running,
 * not an entry somebody forgot. It is one when:
 *   • it has an In-Time and no Out-Time;
 *   • the In is an evening In (EVENING_SHIFT_FROM, 18:00, or later);
 *   • and, read on the plant's today, the shift could still be running
 *     (overnightShiftOpen: no longer than MAX_SHIFT_MINUTES from the In).
 * Read for an earlier date (the In-Charge putting a past day right), "now"
 * has no bearing, and an open evening row is the night shift waiting for the
 * Out that was never recorded — closed from the next day like any other.
 */
export function overnightAwaitingOut(
  row: ShiftRow | null | undefined,
  at: { isToday: boolean; now: string },
): boolean {
  if (!row) return false;
  const inTime = txt(row.inTime);
  if (!inTime || txt(row.outTime)) return false;
  const a = toMins(inTime);
  if (a === null || a < (toMins(EVENING_SHIFT_FROM) as number)) return false;
  return at.isToday ? overnightShiftOpen(inTime, at.now) : true;
}

/** What the previous date leaves for the next one. */
export type PreviousDayState<R extends ShiftRow> =
  | { kind: "clear" }
  /** Its last shift is a night shift awaiting its Out: close it, then go on. */
  | { kind: "overnight"; row: R }
  /** Genuinely unfinished (previousDayIncomplete): held until it is put right. */
  | { kind: "incomplete"; row: R };

/**
 * The previous date's shifts, read for the next date's register. Leave, and
 * no row at all, hold nobody (previousDayIncomplete says why). Of the rest,
 * only the LAST shift may be the night shift still running; any other open or
 * half-written shift is unfinished attendance, as before.
 */
export function previousDayState<R extends ShiftRow>(
  rows: readonly R[],
  onLeave: boolean,
  at: { isToday: boolean; now: string },
): PreviousDayState<R> {
  if (onLeave || rows.length === 0) return { kind: "clear" };
  const ordered = byShift(rows);
  const last = ordered[ordered.length - 1] as R;
  for (const row of ordered) {
    if (!previousDayIncomplete({ row })) continue;
    if (row === last && overnightAwaitingOut(row, at)) return { kind: "overnight", row };
    return { kind: "incomplete", row };
  }
  return { kind: "clear" };
}

/** Said when a new shift is tried while last night's is still running. */
export function nightShiftStillOpen(date: string): string {
  return `The night shift from ${dmyOf(date)} has no Out-Time yet. Mark it out first.`;
}

/**
 * May another shift be started on this date, after the shifts already on it?
 * Only once the last one is finished — an In and an Out — and only if it did
 * not run past midnight, because then it ended on the NEXT date and a second
 * shift on this one would overlap it.
 */
export function canStartAnotherShift(dayRows: readonly ShiftRow[]): boolean {
  if (dayRows.length === 0) return false;
  const last = byShift(dayRows)[dayRows.length - 1] as ShiftRow;
  return Boolean(txt(last.inTime)) && Boolean(txt(last.outTime)) && !rollsOvernight(last.inTime, last.outTime);
}

/** Why another shift cannot be started on this date, or null when it can. */
export function anotherShiftError(date: string, dayRows: readonly ShiftRow[]): string | null {
  if (dayRows.length === 0 || canStartAnotherShift(dayRows)) return null;
  const last = byShift(dayRows)[dayRows.length - 1] as ShiftRow;
  const n = last.shiftNo ?? 1;
  if (txt(last.inTime) && txt(last.outTime)) {
    return `Shift ${n} on ${dmyOf(date)} ran past midnight, so another shift cannot start on that date.`;
  }
  return `Shift ${n} on ${dmyOf(date)} is not finished yet. Mark it out before starting another shift.`;
}

/**
 * Why this shift's times would overlap another shift of the same operator, or
 * null. Every time here is on the shift's own date, the way the register
 * holds them:
 *   • its In may not be before the last Out that fell on this date — last
 *     night's shift ending at 06:00, or an earlier shift of this date;
 *   • its Out (when it does not run past midnight) may not be after the In of
 *     a later shift on this date.
 */
export function shiftOverlapError(input: {
  date: string;
  shift: ShiftRow;
  /** The previous date's shifts — one may have ended this morning. */
  previousDayRows: readonly ShiftRow[];
  /** The other shifts of this date. */
  dayRows: readonly ShiftRow[];
}): string | null {
  const n = input.shift.shiftNo ?? 1;
  const inM = toMins(input.shift.inTime);
  const outM = toMins(input.shift.outTime);

  const endsOnThisDate: number[] = [];
  for (const row of input.previousDayRows) {
    if (rollsOvernight(row.inTime, row.outTime)) endsOnThisDate.push(toMins(row.outTime) as number);
  }
  for (const row of input.dayRows) {
    if ((row.shiftNo ?? 1) < n && txt(row.outTime) && !rollsOvernight(row.inTime, row.outTime)) {
      endsOnThisDate.push(toMins(row.outTime) as number);
    }
  }
  if (inM !== null && endsOnThisDate.length > 0) {
    const lastEnd = Math.max(...endsOnThisDate);
    if (inM < lastEnd) {
      const at = `${String(Math.floor(lastEnd / 60)).padStart(2, "0")}:${String(lastEnd % 60).padStart(2, "0")}`;
      return `${INVALID_TIME} The previous shift ended at ${at}, so this In-Time cannot be earlier.`;
    }
  }

  if (outM !== null && inM !== null && !rollsOvernight(input.shift.inTime, input.shift.outTime)) {
    for (const row of input.dayRows) {
      const laterIn = toMins(row.inTime);
      if ((row.shiftNo ?? 1) > n && laterIn !== null && outM > laterIn) {
        return `${INVALID_TIME} Shift ${row.shiftNo} starts at ${txt(row.inTime)}, so this Out-Time cannot be later.`;
      }
    }
  }
  if (inM !== null && outM !== null && rollsOvernight(input.shift.inTime, input.shift.outTime)) {
    if (input.dayRows.some((row) => (row.shiftNo ?? 1) > n)) {
      return `${INVALID_TIME} A later shift is already on this date, so this one cannot run past midnight.`;
    }
  }
  return null;
}

/**
 * Why an In and an Out together cannot be one shift, or null. Equal times are
 * no shift at all, and more than MAX_SHIFT_MINUTES is a mistyped pair
 * (workedMinutes reads both as nothing) — refused rather than stored as a
 * shift with no hours.
 */
export function shiftLengthError(inTime: string | null | undefined, outTime: string | null | undefined): string | null {
  if (!txt(inTime) || !txt(outTime) || toMins(inTime) === null || toMins(outTime) === null) return null;
  if (workedMinutes(inTime, outTime) !== null) return null;
  return `${INVALID_TIME} ${txt(inTime)} to ${txt(outTime)} is not a shift — at most ${MAX_SHIFT_MINUTES / 60} hours, and the Out-Time cannot equal the In-Time.`;
}

/* ── The Plant In-Charge's times on today's row ────────────────────── */

/**
 * Why a time the Plant In-Charge TYPED on today's row cannot be stored, or null.
 *
 * The clock rules (lib/attendance/clock.ts) are the tablet's: they are about
 * marking attendance as it happens. The In-Charge is putting today right after
 * the fact — the 06:00 In nobody tapped, the 14:00 Out somebody forgot — so
 * both times are typed, as on a past day. What is still refused is a time that
 * has not happened yet, so an Out-Time is never later than the moment it was
 * recorded. An Out before the row's own In crossed midnight into tomorrow,
 * which has not happened either.
 */
export function laterThanNowError(
  time: string | null | undefined,
  now: string,
  inTime?: string | null,
): string | null {
  const t = toMins(time);
  const n = toMins(now);
  if (t === null || n === null) return null; // not a time, or no clock: other checks
  const overnight = inTime !== undefined && rollsOvernight(inTime, time);
  if (overnight || t - n > CLOCK_SKEW_MINUTES) return `${INVALID_TIME} It cannot be later than now (${now}).`;
  return null;
}

/**
 * Would this save CHANGE something the row already holds?
 *
 * The shared tablet may write what is not there yet and nothing that is
 * (owner, 26 Oct 2026: operators "must not be able to edit previous
 * attendance records"; and a tablet nobody signs out of is the same hands all
 * shift, so a row it has written is finished as far as it is concerned). The
 * Plant In-Charge is not held by this at all — correcting the register is the
 * whole of what that login is for.
 *
 * ADDING IS NOT CHANGING, which is the point of the field-by-field test: the
 * ordinary day is an In-Time written in the morning and an Out-Time stamped
 * onto the same row in the evening, and a rule that refused the second because
 * the first was already there would stop the register working at all.
 *
 * `next` is what WILL BE STORED, not what the browser sent — the Out-Time is
 * re-stamped from the server's clock and the Lines are re-joined before this
 * is asked (lib/attendance/clock.ts, and joinLines). Comparing the sent values
 * would let a re-stamp through as "unchanged" and refuse an honest save whose
 * Lines merely came back in another order.
 *
 * Pure, and nothing here reaches the database: the caller brings both rows.
 */
export function amendsSavedRow(
  existing: { lines?: string | null; inTime?: string | null; outTime?: string | null } | null | undefined,
  next: { lines?: string | null; inTime?: string | null; outTime?: string | null },
): boolean {
  if (!existing) return false; // a row being entered for the first time
  const text = (v: string | null | undefined) => String(v ?? "").trim();
  return (["lines", "inTime", "outTime"] as const).some((field) => {
    const before = text(existing[field]);
    // Empty is "not written yet": filling it in is the job, not an amendment.
    // Emptying one that IS written is an amendment, and is caught by this.
    return before !== "" && text(next[field]) !== before;
  });
}

/** The hours away on a leave row, by the same rule. Both times empty is the
 *  whole day, which the register writes in words rather than as a number. */
export function leaveLabel(fromTime: string | null | undefined, toTime: string | null | undefined): string {
  const from = (fromTime ?? "").trim();
  const to = (toTime ?? "").trim();
  if (!from && !to) return "Full day";
  if (!from || !to) return from || to;
  return `${from}–${to}`;
}

/* ── Informed or not ───────────────────────────────────────────────── */

/**
 * Whether the operator said they would be away.
 *
 * It is the one thing a supervisor reads this register for, so it is a field
 * and not a note in Remarks: "told us" and "did not turn up" are different
 * facts about the same absence, and only one of them is a problem.
 *
 * Stored as the code, never the label — the words on screen can be reworded
 * without rewriting anybody's history.
 */
export const LEAVE_TYPES = ["INFORMED", "UNINFORMED"] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  INFORMED: "Informed Leave",
  UNINFORMED: "Uninformed Leave",
};

/**
 * Dark green for informed, dark red for uninformed — the owner's colours.
 *
 * These exact steps, not "green" and "red": red against green is the ONE pair
 * a red-green colour-blind reader cannot separate, and the obvious #1b5e20 /
 * #c62828 come out at ΔE 2.0 under protanopia — the same colour. These two are
 * the steps already validated for the Robo shift chart, and they were checked
 * again for this pair: ΔE 8.5 protan, 28.9 normal, both over 3:1 on white.
 *
 * The colour is never the only thing saying it either — the cell reads
 * "Informed Leave" or "Uninformed Leave" in words — so the register is as
 * readable with no colour vision at all.
 */
export const LEAVE_TYPE_HUES: Record<LeaveType, string> = {
  INFORMED: "#1a7a42",
  UNINFORMED: "#cf2f26",
};

/**
 * A stored or typed leave type, read as one of the two codes. Takes the code
 * in any case ("informed", "INFORMED"), the label a sheet may carry ("Informed
 * Leave"), and the bare word. Anything else is null — never a guess, because
 * guessing here would mark somebody's absence as excused.
 */
export function parseLeaveType(raw: unknown): LeaveType | null {
  const s = String(raw ?? "").trim().toUpperCase();
  if (!s) return null;
  // "UNINFORMED" has to be tested first — it contains "INFORMED".
  if (/\bUN[\s_-]*INFORMED\b/.test(s) || s.startsWith("UN")) return "UNINFORMED";
  if (/\bINFORMED\b/.test(s)) return "INFORMED";
  return null;
}

/** What a cell shows for a leave row: "Informed Leave", "Uninformed Leave", or
 *  "" for a row recorded before the field existed. */
export function leaveTypeLabel(raw: unknown): string {
  const t = parseLeaveType(raw);
  return t ? LEAVE_TYPE_LABELS[t] : "";
}

/** Its colour, or undefined when there is no type to colour — an unknown value
 *  is shown in the ordinary ink rather than in one of the two meanings. */
export function leaveTypeHue(raw: unknown): string | undefined {
  const t = parseLeaveType(raw);
  return t ? LEAVE_TYPE_HUES[t] : undefined;
}

/** Why this leave type cannot be used, or null when it can. */
export function leaveTypeError(raw: unknown): string | null {
  return parseLeaveType(raw) ? null : "Pick a leave type.";
}

/* ── What an operator's name may be ────────────────────────────────── */

/** A typed operator name, tidied: inner runs of space collapsed, ends
 *  trimmed. "" when there is nothing left, which the caller refuses. */
export function cleanOperatorName(raw: unknown): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim();
}

export const OPERATOR_NAME_MAX = 80;

/** Why a name cannot be used, or null when it can. */
export function operatorNameError(raw: unknown): string | null {
  const name = cleanOperatorName(raw);
  if (!name) return "Enter the operator's name.";
  if (name.length > OPERATOR_NAME_MAX) return `Keep the name under ${OPERATOR_NAME_MAX} characters.`;
  return null;
}
