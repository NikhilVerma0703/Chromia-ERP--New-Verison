/**
 * THE ATTENDANCE CHECK (17 Nov 2026 round, change 2) — Out-Time the next day
 * for any In-Time, and shifts of any length, driven through the API that the
 * Robo and Chromia screens share, on a simulated plant clock, as the line
 * tablet and as the Plant In-Charge.
 *
 *   npm run test:attendance      (against a *_test database only)
 *
 * It makes its own operators (named WF-ATT…), and removes them and their rows.
 */
import { prisma } from '@/lib/prisma';
import { attendanceApi } from '@/lib/attendance/server';
import { INCOMPLETE_PREVIOUS_DAY, nightShiftStillOpen } from '@/lib/attendance/attendance';

const SAT = '2031-11-08';
const SUN = '2031-11-09';
const MON = '2031-11-10';
const TUE = '2031-11-11';

const TABLET = { id: 'wf-tablet', role: 'CHROMIA', branch: 'SHOP_FLOOR', name: 'WF tablet' };
const INCHARGE = { id: 'wf-incharge', role: 'PLANT_INCHARGE', branch: 'SHOP_FLOOR', name: 'WF in-charge' };
type Who = typeof TABLET;

/* The plant clock, moved by the check. */
const RealDate = Date;
let offset = 0;
class ClockDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length) super(...(args as [string]));
    else super(RealDate.now() + offset);
  }
  static now() {
    return RealDate.now() + offset;
  }
}
globalThis.Date = ClockDate as DateConstructor;
const at = (date: string, time: string) => {
  offset = new RealDate(`${date}T${time}:00+05:30`).getTime() - RealDate.now();
};

let failures = 0;
let checks = 0;
function expect(what: string, actual: unknown, expected: unknown) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}${ok ? '' : `: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}
function expectMatch(what: string, actual: unknown, pattern: RegExp) {
  checks += 1;
  const ok = pattern.test(String(actual ?? ''));
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}${ok ? '' : `: expected ${pattern}, got ${JSON.stringify(actual)}`}`);
}

async function api(who: Who, method: string, path: string, body?: unknown) {
  (globalThis as { __attendanceUser?: unknown }).__attendanceUser = who;
  const res = await attendanceApi(
    new Request(`http://localhost/api/chromia/attendance/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    (path.split('?')[0] ?? '').split('/'),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

interface Shift { date: string; shiftNo?: number; inTime?: string; outTime?: string; outDate?: string }
const madeOperators: string[] = [];
async function operator(tag: string) {
  const made = await prisma.attendanceOperator.create({ data: { name: `WF-ATT ${tag} ${RealDate.now()}`, sortOrder: 9000 + madeOperators.length } });
  madeOperators.push(made.id);
  return made.id;
}
const put = (who: Who, operatorId: string, s: Shift) => api(who, 'PUT', 'day', { operatorId, lines: ['CHROMIA'], ...s });
const stored = (operatorId: string) =>
  prisma.attendanceDay
    .findMany({ where: { operatorId }, orderBy: [{ date: 'asc' }, { shiftNo: 'asc' }], select: { date: true, shiftNo: true, inTime: true, outTime: true, outDate: true } })
    .then((rows) => rows.map((r) => `${r.date} #${r.shiftNo} ${r.inTime ?? '-'}→${r.outTime ?? '-'} out ${r.outDate ?? 'null'}`));
const lineOf = async (who: Who, date: string, operatorId: string) => {
  const { body } = await api(who, 'GET', `day?date=${date}`);
  return (body.rows as Record<string, unknown>[]).filter((r) => r.operatorId === operatorId);
};

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.replace(/^\//, '').endsWith('_test')) {
    throw new Error(`Refusing to run: ${url.pathname.slice(1)} is not a *_test database. This check writes attendance rows.`);
  }

  // ── The owner's three cases: In before 18:00, Out 06:12 the next morning ──
  for (const [inTime, hours] of [['16:45', '13h 27m'], ['17:53', '12h 19m'], ['17:56', '12h 16m']] as const) {
    // The tablet marks in at the time, and marks out the next morning in one tap.
    const tab = await operator(`tablet ${inTime}`);
    at(SAT, inTime);
    expect(`tablet: In ${inTime} saved`, (await put(TABLET, tab, { date: SAT, inTime })).status, 200);
    at(SUN, '06:12');
    const line = (await lineOf(TABLET, SUN, tab))[0] ?? {};
    expect(`tablet: In ${inTime} — next morning's register offers last night's shift, not a hold`, [line.blocked, (line.overnight as { inTime?: string } | null)?.inTime], [false, inTime]);
    const early = await put(TABLET, tab, { date: SUN, inTime: '06:12' });
    expect(`tablet: In ${inTime} — no new In while it is open`, early.body.error, nightShiftStillOpen(SAT));
    const out = await put(TABLET, tab, { date: SAT, inTime, outTime: '06:12' });
    expect(`tablet: In ${inTime} → Out 06:12 next day: hours`, [out.status, out.body.worked], [200, hours]);
    expect(`tablet: In ${inTime} — Out dated the next day, on the original row`, await stored(tab), [`${SAT} #1 ${inTime}→06:12 out ${SUN}`]);

    // The In-Charge types it from the next morning's register.
    const inc = await operator(`in-charge ${inTime}`);
    at(SAT, inTime);
    await put(INCHARGE, inc, { date: SAT, inTime });
    at(SUN, '07:00');
    const typed = await put(INCHARGE, inc, { date: SAT, inTime, outTime: '06:12', outDate: SUN });
    expect(`in-charge: In ${inTime} → Out 06:12 next day: hours`, [typed.status, typed.body.worked, typed.body.outDate], [200, hours, SUN]);
    // And typed on the earlier date's own row, with no Out date: read from the times as before.
    const inc2 = await operator(`in-charge row ${inTime}`);
    const plain = await put(INCHARGE, inc2, { date: SAT, inTime, outTime: '06:12' });
    expect(`in-charge: In ${inTime}, Out 06:12 typed on the row: hours and date`, [plain.status, plain.body.worked, plain.body.outDate], [200, hours, SUN]);
  }

  // ── 35 hours: In 08:00 Saturday, Out 19:00 Sunday ─────────────────────
  const long = await operator('tablet 35h');
  at(SAT, '08:00');
  await put(TABLET, long, { date: SAT, inTime: '08:00' });
  at(SUN, '19:00');
  const out35 = await put(TABLET, long, { date: SAT, inTime: '08:00', outTime: '19:00' });
  expect('tablet: 08:00 Sat → 19:00 Sun is 35h', [out35.status, out35.body.worked, out35.body.outDate], [200, '35h', SUN]);
  at(SUN, '19:00');
  const sameSunday = await put(INCHARGE, long, { date: SUN, inTime: '18:00' });
  expectMatch('a Sunday shift may not start before the 35h shift ended', sameSunday.body.error, /previous shift ended at 19:00/);
  at(SUN, '19:30');
  const after = await put(TABLET, long, { date: SUN, inTime: '19:30' });
  expect('tablet: a Sunday shift after it ended is fine', after.status, 200);

  const inc35 = await operator('in-charge 35h');
  at(MON, '09:00');
  const typed35 = await put(INCHARGE, inc35, { date: SAT, inTime: '08:00', outTime: '19:00', outDate: SUN });
  expect('in-charge: typed 08:00 Sat → 19:00 Sun with its Out date is 35h', [typed35.status, typed35.body.worked], [200, '35h']);

  // ── More than a day: In 06:00 Saturday, Out 07:30 Monday ──────────────
  const twoDays = await operator('in-charge 49h');
  at(MON, '09:00');
  const typed49 = await put(INCHARGE, twoDays, { date: SAT, inTime: '06:00', outTime: '07:30', outDate: MON });
  expect('in-charge: 06:00 Sat → 07:30 Mon is 49h 30m', [typed49.status, typed49.body.worked, typed49.body.outDate], [200, '49h 30m', MON]);
  const sunday = await put(INCHARGE, twoDays, { date: SUN, inTime: '10:00' });
  expectMatch('no shift on a date the long shift ran through', sunday.body.error, /no shift can start on 09\/11\/2031/);

  // ── The rules that stay ───────────────────────────────────────────────
  const rules = await operator('in-charge rules');
  at(MON, '09:00');
  expectMatch('an Out date still to come is refused', (await put(INCHARGE, rules, { date: SAT, inTime: '08:00', outTime: '07:00', outDate: TUE })).body.error, /cannot be later than now/);
  expectMatch('an Out later than now today is refused', (await put(INCHARGE, rules, { date: SAT, inTime: '08:00', outTime: '10:00', outDate: MON })).body.error, /cannot be later than now/);
  expectMatch('an Out date before the shift is refused', (await put(INCHARGE, rules, { date: SUN, inTime: '08:00', outTime: '10:00', outDate: SAT })).body.error, /cannot be before/);
  expectMatch('an Out before the In on the same date is refused', (await put(INCHARGE, rules, { date: SAT, inTime: '08:00', outTime: '07:00', outDate: SAT })).body.error, /Out-Time must be after the In-Time/);
  expectMatch('equal times are refused', (await put(INCHARGE, rules, { date: SAT, inTime: '08:00', outTime: '08:00' })).body.error, /not a shift/);
  expect('nothing was stored for the refused ones', await stored(rules), []);

  // An Out with no In is still unfinished, and holds the next day.
  const half = await operator('half');
  await prisma.attendanceDay.create({ data: { date: SAT, operatorId: half, shiftNo: 1, outTime: '14:00' } });
  at(SUN, '07:00');
  expect('an Out with no In still holds the next day', (await put(TABLET, half, { date: SUN, inTime: '07:00' })).body.error, INCOMPLETE_PREVIOUS_DAY);

  // A row saved before (no Out date) reads exactly as it did.
  const old = await operator('old row');
  await prisma.attendanceDay.create({ data: { date: SAT, operatorId: old, shiftNo: 1, lines: 'CHROMIA', inTime: '18:00', outTime: '06:00' } });
  const oldLine = (await lineOf(INCHARGE, SAT, old))[0] ?? {};
  expect('an old row: 18:00→06:00 is 12h, out the next day', [oldLine.worked, oldLine.outDate], ['12h', SUN]);

  // Multiple shifts on one date still work.
  const two = await operator('two shifts');
  at(MON, '06:00');
  await put(TABLET, two, { date: MON, inTime: '06:00' });
  at(MON, '10:00');
  await put(TABLET, two, { date: MON, inTime: '06:00', outTime: '10:00' });
  at(MON, '14:00');
  const second = await put(TABLET, two, { date: MON, shiftNo: 2, inTime: '14:00' });
  expect('a second shift on the same date', second.status, 200);
  expect('two shifts stored', await stored(two), [`${MON} #1 06:00→10:00 out ${MON}`, `${MON} #2 14:00→- out null`]);

  // ── Downloads: hours, Out-Time cell and the sum ───────────────────────
  at(MON, '09:00');
  const recs = await api(INCHARGE, 'GET', `records?type=ATTENDANCE&period=ALL&operatorId=${long}`);
  const rows = recs.body.rows as Record<string, string>[];
  expect('Downloads: the 35h shift reads 35h with its Out date', [rows[0]?.['Out-Time'], rows[0]?.['Total Working Hours']], ['19:00 (09/11/2031)', '35h']);
  const nightRecs = await api(INCHARGE, 'GET', `records?type=ATTENDANCE&period=ALL&operatorId=${old}`);
  expect('Downloads: an ordinary night shift prints as before', (nightRecs.body.rows as Record<string, string>[])[0]?.['Out-Time'], '06:00');
  expect('Downloads: Sum of Total Working Hours counts the 35h', recs.body.sumOfHours, '35h');

  console.log(`\n${checks - failures} of ${checks} checks pass.`);
}

main()
  .catch((error) => {
    failures += 1;
    console.error(error);
  })
  .finally(async () => {
    globalThis.Date = RealDate;
    if (madeOperators.length) {
      await prisma.attendanceDay.deleteMany({ where: { operatorId: { in: madeOperators } } });
      await prisma.attendanceOperator.deleteMany({ where: { id: { in: madeOperators } } });
    }
    await prisma.$disconnect();
    if (failures) process.exitCode = 1;
  });
