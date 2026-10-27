/**
 * When attendance may be marked — the two rules that stop a day being written
 * as something other than what happened.
 *
 * Pure and alias-free so `node --test` can reach it, and so the page and the
 * server decide identically rather than each having an opinion.
 *
 * ── THE RULES ─────────────────────────────────────────────────────────────
 *   1. An In-Time may be no earlier than IN_TIME_GRACE_MINUTES before now, and
 *      not in the future. Ten minutes is room to finish walking to the tablet;
 *      it is not room to write this morning in at six o'clock this evening.
 *   2. An Out-Time is never typed. It is stamped with the clock, so it cannot
 *      be back-dated, cannot be post-dated, and is exactly the moment the
 *      operator pressed it.
 *
 * ── WHOSE CLOCK ───────────────────────────────────────────────────────────
 * The plant's, Asia/Kolkata, on both ends. The tablet shows it and fills the
 * field with it; the SERVER then checks and stamps against its own reading of
 * the same clock, because a page can be edited and a request can be made
 * without one. The browser never decides what is stored.
 *
 * Both clocks are read as "HH:MM" minutes-of-day, and the comparison goes the
 * SHORT way round, so 23:58 is two minutes before 00:00 rather than twenty-three
 * hours and fifty-eight minutes after it. The night shift marks in across
 * midnight every night and must not meet a wall when it does.
 */

/** How far back an In-Time may be set from the clock. */
export const IN_TIME_GRACE_MINUTES = 10;

/**
 * How far AHEAD of the server a tablet may be and still be believed.
 *
 * The owner's rule is about back-dating, and this is not a loosening of it: it
 * is for the honest entry. A shop-floor tablet keeps its own clock, and one
 * running a couple of minutes fast would have every single operator's In-Time
 * refused as "in the future" — for a reason nobody on the floor could see, let
 * alone fix. Two minutes absorbs ordinary drift and nothing more; an Out-Time,
 * which is the one the record really turns on, is not typed at all and so is
 * never in the future by even a second.
 */
export const CLOCK_SKEW_MINUTES = 2;

/**
 * What a refused time is called, in the owner's words.
 *
 * Every refusal opens with this sentence so the floor meets one phrase, and
 * each one then says what WOULD work — "Invalid entry/time." alone tells an
 * operator at 04:56 that 04:45 is wrong and leaves them guessing by how much.
 */
export const INVALID_TIME = "Invalid entry/time.";

const HALF_DAY = 12 * 60;
const DAY = 24 * 60;

/** Minutes since midnight for "HH:MM", or null when it is not a time. */
export function clockMinutes(t: string | null | undefined): number | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(t ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h > 23 || min > 59 ? null : h * 60 + min;
}

/** "HH:MM" for minutes since midnight, wrapping at both ends. */
export function clockLabel(minutes: number): string {
  const m = ((Math.round(minutes) % DAY) + DAY) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * How many minutes BEFORE `now` the time `t` is, the short way round the clock:
 * 0 when they are the same, 10 when t was ten minutes ago, and NEGATIVE when t
 * is still to come. 23:55 against a clock reading 00:05 is 10, not −1430.
 *
 * Anything more than half a day away is read as the other direction, which is
 * the only sane reading of a bare clock time: nothing on this screen is ever
 * meant to be thirteen hours out.
 */
export function minutesBefore(t: number, now: number): number {
  let d = now - t;
  if (d > HALF_DAY) d -= DAY;
  if (d < -HALF_DAY) d += DAY;
  return d;
}

/**
 * Why this In-Time cannot be used, or null when it can.
 *
 * `now` is "HH:MM" on the plant clock — the tablet's on screen, the server's
 * when it matters. The message names the earliest time that WOULD work, so the
 * operator is told what to do rather than only what is wrong.
 */
export function inTimeError(value: string | null | undefined, now: string): string | null {
  const t = clockMinutes(value);
  if (t === null) return `${INVALID_TIME} Enter the In-Time as HH:MM.`;
  const n = clockMinutes(now);
  if (n === null) return null; // no usable clock — do not block the floor over it
  const before = minutesBefore(t, n);
  if (before > IN_TIME_GRACE_MINUTES) {
    return `${INVALID_TIME} The earliest allowed now is ${clockLabel(n - IN_TIME_GRACE_MINUTES)} — mark attendance when you arrive.`;
  }
  if (before < -CLOCK_SKEW_MINUTES) {
    return `${INVALID_TIME} It cannot be later than now (${clockLabel(n)}).`;
  }
  return null;
}

/** The earliest In-Time a clock reading of `now` allows — what the field's
 *  hint shows, from the same arithmetic as the check. */
export function earliestInTime(now: string): string {
  const n = clockMinutes(now);
  return n === null ? "" : clockLabel(n - IN_TIME_GRACE_MINUTES);
}

/**
 * What to store for an Out-Time, given what arrived, what the row already holds
 * and the server's own clock.
 *
 *   • nothing sent, or sent empty  → null: the operator cleared it, or has not
 *     marked out yet. Clearing is allowed because a mis-tap has to be
 *     recoverable, and a re-stamp can only ever be the clock again.
 *   • sent unchanged               → the stored value, untouched. This is the
 *     case that matters most: saving a row to correct its LINE must not move an
 *     Out-Time stamped hours ago to now.
 *   • anything else                → `now`. Whatever the browser sent is
 *     discarded. That is the whole of rule 2: there is no path by which a typed
 *     time, a future time or an edited time reaches the column.
 */
export function outTimeToStore(
  sent: string | null | undefined,
  existing: string | null | undefined,
  now: string,
): string | null {
  const s = String(sent ?? "").trim();
  if (!s) return null;
  const e = String(existing ?? "").trim();
  if (e && s === e) return e;
  return clockMinutes(now) === null ? e || null : now;
}

/**
 * Likewise for the In-Time: an unchanged one is kept as it stands, whatever the
 * clock says now.
 *
 * Without this, opening this morning's row at six in the evening to tick the
 * other line would send its 06:00 In-Time back, the window would refuse it, and
 * the row could never be corrected again. The rule is about ENTERING a time,
 * not about carrying one.
 */
export function inTimeUnchanged(sent: string | null | undefined, existing: string | null | undefined): boolean {
  return String(sent ?? "").trim() === String(existing ?? "").trim();
}

/* ── Marking in, and putting a past day right ──────────────────────── */

/**
 * Both rules above govern MARKING ATTENDANCE AS IT HAPPENS — an operator at the
 * tablet, on TODAY's row. A row for an earlier date is a different act: it is a
 * correction, and it has to be possible, because the register now refuses a new
 * entry until the previous day is complete (attendance.previousDayIncomplete).
 * If the ten-minute window applied there too, a day whose In-Time was never
 * recorded could never be filled in — the supervisor would be told to complete
 * yesterday and given no way to do it, and the whole line would stop at the
 * tablet. So on a past day the times are typed, and only read for being times.
 *
 * Nothing is loosened by this. A past day's times are all in the past by
 * definition, so the one guarantee that matters — an Out-Time is never later
 * than the moment it was recorded — still holds everywhere. A FUTURE day is
 * refused outright by the caller, which is the case this would otherwise open.
 */
export function inTimeErrorOn(isToday: boolean, value: string | null | undefined, now: string): string | null {
  if (isToday) return inTimeError(value, now);
  return clockMinutes(value) === null ? `${INVALID_TIME} Enter the In-Time as HH:MM.` : null;
}

/** Likewise for the Out-Time: stamped with the clock on today's row, typed on
 *  a past one — there is no clock reading that would be right for a day that
 *  has already ended. */
export function outTimeToStoreOn(
  isToday: boolean,
  sent: string | null | undefined,
  existing: string | null | undefined,
  now: string,
): string | null {
  if (isToday) return outTimeToStore(sent, existing, now);
  const s = String(sent ?? "").trim();
  if (!s) return null;
  return clockMinutes(s) === null ? String(existing ?? "").trim() || null : s;
}
