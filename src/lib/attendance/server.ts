/**
 * The Attendance API — ONE implementation, mounted twice.
 *
 * ── WHY ONE FILE AND NOT TWO SETS OF ROUTES ───────────────────────────────
 * Robo and Chromia must always show the same register, so there is one set of
 * tables and one set of handlers. What differs between the two ERPs is only
 * which gate lets you in: /api/robo/attendance/… is behind roboGate and the
 * middleware's /api/robo rule, /api/chromia/attendance/… behind chromiaGate
 * and the /api/chromia rule. Each module's route file is five lines — its own
 * gate, then this.
 *
 * It is NOT mounted at a new /api/attendance prefix, which would be the
 * obvious thing and is wrong twice over: middleware has no rule for it, so
 * every other department's login would reach it, while the ROBO and CHROMIA
 * role caps (which allow only their own module's paths) would lock out the two
 * logins that actually need it.
 *
 * Twenty near-identical route files — ten endpoints in two modules — would be
 * the alternative, and Nav.tsx already records what happens to hand-kept
 * copies: they drift the first time one of them is edited. So the dispatch is
 * by path here, once.
 *
 * ── "VIEW AS" STAYS READ-ONLY ─────────────────────────────────────────────
 * Every request that is not a GET runs inside unlessViewing()
 * (lib/viewAsServer.ts), the way Lab's and Accounts' writes do: while an admin
 * views the ERP as a Robo or Chromia login, nothing is written and the screen
 * is told why in words. The Prisma write guard (lib/prisma.ts) would refuse
 * the write anyway, but as a thrown error the register could only report as
 * "That did not save". tests/viewAsSource.test.ts lists this file among the
 * callers.
 *
 * ── EVERY WRITE LEAVES A TRAIL ────────────────────────────────────────────
 * The register is written from two shared tablet logins (ROBO, CHROMIA)
 * through either door, so "who changed this, and what did it say before?"
 * has to be answerable from the record — the tables carry no actor column.
 * Every write and its action_log row are one transaction (logActionTx, as the
 * Robo slab delete writes its own): if the trail cannot be written, neither is
 * the change. The row names the login, says in words what changed, and keeps
 * what was there before — for a removal, the whole row — so a mistake can be
 * put back by hand. Kind "edit", never "delete": the global Undo
 * (app/batch/undo.ts, undoLastAction with no batch) reverses the last "delete"
 * anywhere in the ERP, and must not restore a leave record someone removed on
 * purpose (lib/actionLogKinds NOT_UNDOABLE; the commercial alias delete logs
 * the same way). All of it runs inside unlessViewing, so a view writes no
 * trail either.
 */

import * as XLSX from "xlsx-js-style";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logActionTx } from "@/lib/actionLog";
import { currentUser } from "@/lib/rbac";
import {
  ALREADY_SAVED, NOT_YOURS, ONLY_TODAY, plantRightsOfUser, type PlantRights,
} from "@/lib/plantAccess";
import { unlessViewing, viewAsBlocked } from "@/lib/viewAsServer";
import { styleRoboSheet } from "@/lib/robo/exportStyle";
import { toPlantDateInput, toPlantTimeInput } from "@/lib/chromia/plant-time";
import { isValidTime } from "@/lib/robo/time";
import { INVALID_TIME, inTimeErrorOn, inTimeUnchanged, outTimeToStoreOn } from "./clock.ts";
import {
  INCOMPLETE_PREVIOUS_DAY,
  SHIFT_TOO_LONG,
  amendsSavedRow,
  cleanOperatorName,
  closesOpenRow,
  dayKind,
  joinLines,
  laterThanNowError,
  leaveLabel,
  leaveTypeError,
  leaveTypeLabel,
  linesLabel,
  operatorNameError,
  outDate,
  overnightShiftOpen,
  parseLeaveType,
  previousDay,
  previousDayIncomplete,
  workedLabel,
} from "./attendance.ts";
import {
  ATTENDANCE_COLUMNS,
  LEAVE_COLUMNS,
  PERIOD_MODES,
  RECORD_TYPES,
  columnsFor,
  describeFilter,
  filterFileName,
  periodBounds,
  widthsFor,
  type AttendanceFilter,
  type PeriodMode,
  type RecordType,
} from "./filters.ts";

/** Today, on the plant's clock rather than the server's — the host runs in UTC
 *  and "last week" must not start a day early for a night shift. */
const todayPlant = () => toPlantDateInput(new Date());

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const bad = (message: string, status = 400) => json({ error: message }, status);

const isDate = (v: unknown): v is string => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ""));

/** A typed time as it is stored: "HH:MM", or null for an empty box. Anything
 *  that is not a time is refused rather than stored as text nobody can total. */
function timeOrNull(v: unknown): string | null | undefined {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return isValidTime(s) ? s : undefined; // undefined = invalid, the caller refuses
}

/* ── Operators ─────────────────────────────────────────────────────── */

async function listOperators() {
  /* THE ROSTER'S OWN ORDER, which is the owner's list in the owner's order —
     the order the line is called in. It is NOT alphabetical and must not be
     re-sorted into it: "Jagadeesh, Rajesh, Saravanan .L, Kiran…" is how the
     register reads on paper, and a screen that answers with "Aaquib, Jagadeesh,
     Kiran…" is a different document. `id` only breaks a tie between two rows
     left on the same number, so the list can never come back shuffled. */
  return prisma.attendanceOperator.findMany({
    select: { id: true, name: true, isActive: true, sortOrder: true },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
}

/** Where a newly added operator goes: the end. Adding one never moves anybody
 *  already on the list. */
async function nextSortOrder(tx: Tx): Promise<number> {
  const last = await tx.attendanceOperator.findFirst({
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  return (last?.sortOrder ?? 0) + 1;
}

/* ── The day's register ────────────────────────────────────────────── */

/**
 * Every active operator for a date, each with their row if one exists. The
 * register is the roster, not the rows: an operator with nothing entered yet
 * still has a line to fill in, which is the whole point of a register.
 */
async function dayRegister(date: string) {
  const prev = previousDay(date);
  const [operators, days, held] = await Promise.all([
    listOperators(),
    prisma.attendanceDay.findMany({ where: { date } }),
    heldForPreviousDay(date),
  ]);
  const byOperator = new Map(days.map((d) => [d.operatorId, d]));
  return operators
    .filter((o) => o.isActive || byOperator.has(o.id))
    .map((o) => {
      const d = byOperator.get(o.id);
      return {
        operatorId: o.id,
        operatorName: o.name,
        isActive: o.isActive,
        lines: d?.lines ?? "",
        linesLabel: linesLabel(d?.lines),
        inTime: d?.inTime ?? "",
        outTime: d?.outTime ?? "",
        /* A shift that went in at 22:00 and came out at 06:00 is ONE row, on
           the day it started; the Out is the next date and the screen says so
           rather than printing a 06:00 that reads as eight hours earlier. */
        outDate: outDate(date, d?.inTime, d?.outTime),
        worked: workedLabel(d?.inTime, d?.outTime),
        saved: Boolean(d),
        /** The previous day is unfinished for this operator, so nothing new
         *  may be entered for them until it is. */
        blocked: held.has(o.id),
        blockedDate: held.has(o.id) ? prev : "",
        /** That unfinished row, so the page can offer the night shift its
         *  "Mark out now" (closesOpenRow). Null when nothing is held. */
        blockedRow: held.get(o.id) ?? null,
      };
    });
}

/**
 * The operators whose PREVIOUS day is unfinished — the ones held until it is
 * put right — each with that row. One pass for the whole register rather than
 * a query per operator.
 *
 * Two facts per operator, which is what previousDayIncomplete asks for: the
 * previous day's row, and whether they were on recorded leave that day. An
 * operator with no row that day is not held (see previousDayIncomplete).
 */
async function heldForPreviousDay(date: string): Promise<Map<string, { lines: string; inTime: string; outTime: string }>> {
  const held = new Map<string, { lines: string; inTime: string; outTime: string }>();
  const prev = previousDay(date);
  if (!prev) return held;
  const [rows, leaves] = await Promise.all([
    prisma.attendanceDay.findMany({ where: { date: prev }, select: { operatorId: true, lines: true, inTime: true, outTime: true } }),
    prisma.attendanceLeave.findMany({ where: { date: prev }, select: { operatorId: true } }),
  ]);
  const onLeave = new Set(leaves.map((l) => l.operatorId));
  for (const r of rows) {
    if (previousDayIncomplete({ row: r, onLeave: onLeave.has(r.operatorId) })) {
      held.set(r.operatorId, { lines: r.lines, inTime: r.inTime ?? "", outTime: r.outTime ?? "" });
    }
  }
  return held;
}

/* ── Leave ─────────────────────────────────────────────────────────── */

async function listLeave() {
  const rows = await prisma.attendanceLeave.findMany({
    orderBy: [{ date: "desc" }, { createdAt: "asc" }],
    take: 500,
    include: { operator: { select: { name: true } } },
  });
  /* S.No. is the row's 1..N position within its own date, computed here and
     never stored — the same rule Slab Records follows, and for the same
     reason: a typed serial on a register gets mistyped and then two rows
     claim the same number. */
  const seenPerDate = new Map<string, number>();
  const dated = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.getTime() - b.createdAt.getTime());
  const serials = new Map<string, number>();
  for (const r of dated) {
    const n = (seenPerDate.get(r.date) ?? 0) + 1;
    seenPerDate.set(r.date, n);
    serials.set(r.id, n);
  }
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    serial: serials.get(r.id) ?? 1,
    operatorId: r.operatorId,
    operatorName: r.operator?.name ?? "",
    /* The code is what the screen colours by and what an edit sends back; the
       label is what it prints. Both, so neither end has to know the other's
       vocabulary. */
    leaveType: parseLeaveType(r.leaveType) ?? "",
    leaveTypeLabel: leaveTypeLabel(r.leaveType),
    fromTime: r.fromTime ?? "",
    toTime: r.toTime ?? "",
    leaveTime: leaveLabel(r.fromTime, r.toTime),
    reason: r.reason ?? "",
    remarks: r.remarks ?? "",
  }));
}

/* ── Downloads ─────────────────────────────────────────────────────── */

function readFilter(p: URLSearchParams): AttendanceFilter {
  const type = (RECORD_TYPES as readonly string[]).includes(String(p.get("type")))
    ? (p.get("type") as RecordType)
    : "ATTENDANCE";
  const period = (PERIOD_MODES as readonly string[]).includes(String(p.get("period")))
    ? (p.get("period") as PeriodMode)
    : "ALL";
  return {
    type,
    period,
    operatorId: p.get("operatorId") ?? "",
    date: p.get("date") ?? undefined,
    from: p.get("from") ?? undefined,
    to: p.get("to") ?? undefined,
    month: p.get("month") ?? undefined,
  };
}

/** The where-clause a filter means. The period is turned into bounds once, by
 *  periodBounds, so the page's table and the spreadsheet cannot disagree. */
function filterWhere(f: AttendanceFilter, today: string) {
  const { from, to } = periodBounds(f, today);
  const where: { operatorId?: string; date?: { gte?: string; lte?: string } } = {};
  if (f.operatorId) where.operatorId = f.operatorId;
  if (from !== null || to !== null) {
    where.date = {};
    if (from !== null) where.date.gte = from;
    if (to !== null) where.date.lte = to;
  }
  return where;
}

/** The rows a filter selects, already shaped as the table and the sheet show
 *  them — ONE function behind both, so the download is the table you looked at. */
async function filteredRows(f: AttendanceFilter, today: string) {
  const where = filterWhere(f, today);
  if (f.type === "LEAVE") {
    const rows = await prisma.attendanceLeave.findMany({
      where,
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      include: { operator: { select: { name: true } } },
    });
    const perDate = new Map<string, number>();
    return rows.map((r) => {
      const n = (perDate.get(r.date) ?? 0) + 1;
      perDate.set(r.date, n);
      return {
        "Date": r.date,
        "S.No.": n,
        "Operator Name": r.operator?.name ?? "",
        "Leave Type": leaveTypeLabel(r.leaveType),
        "Leave Time": leaveLabel(r.fromTime, r.toTime),
        "Leave Reason": r.reason ?? "",
        "Remarks": r.remarks ?? "",
      } as Record<string, string | number>;
    });
  }
  /* Date first, then the roster's own order within the date — so a day in the
     sheet reads down the page exactly as the register does on screen. */
  const rows = await prisma.attendanceDay.findMany({
    where,
    orderBy: [{ date: "asc" }, { operator: { sortOrder: "asc" } }, { operatorId: "asc" }],
    include: { operator: { select: { name: true } } },
  });
  return rows
    .map((r) => ({
      "Date": r.date,
      "Operator Name": r.operator?.name ?? "",
      "Line": linesLabel(r.lines),
      "In-Time": r.inTime ?? "-",
      "Out-Time": r.outTime ?? "-",
      "Total Working Hours": workedLabel(r.inTime, r.outTime),
    }) as Record<string, string | number>);
}

async function operatorNameOf(id: string): Promise<string> {
  if (!id) return "";
  const row = await prisma.attendanceOperator.findUnique({ where: { id }, select: { name: true } });
  return row?.name ?? "";
}

/* ── The trail ─────────────────────────────────────────────────────── */

type Tx = Prisma.TransactionClient;
type Model = "AttendanceOperator" | "AttendanceDay" | "AttendanceLeave";

/** The action_log row for one attendance write, in the write's own
 *  transaction (see EVERY WRITE LEAVES A TRAIL above). `payload` carries the
 *  row before and after; `action` names the write for anyone filtering the
 *  log. */
function trail(tx: Tx, model: Model, summary: string, payload: { action: string } & Record<string, unknown>) {
  return logActionTx(tx, { kind: "edit", model, summary, payload });
}

/** A yyyy-mm-dd as the summary reads it, dd/mm/yyyy (the screen's dmy). */
const onDay = (d: string) => d.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$3/$2/$1");
/** A day's row in words: "Robo + Chromia, In 06:00, Out 14:00". */
const dayWords = (d: { lines: string; inTime: string | null; outTime: string | null }) =>
  `${linesLabel(d.lines)}, In ${d.inTime || "-"}, Out ${d.outTime || "-"}`;

/* ── The one handler ───────────────────────────────────────────────── */

/** The sentence when a view skipped the write and the view itself could not
 *  be named (it always can, inside a request — this is the fallback). */
const VIEWING = "This is a read-only view of another login — nothing was saved.";

/**
 * Dispatch on the path AFTER ".../attendance". Both module routes hand their
 * own segments in, so the same request reaches the same code whichever ERP
 * asked. A read goes straight through; anything else is skipped during an
 * admin's "View as" and answered with the read-only sentence (403).
 */
export async function attendanceApi(req: Request, segments: string[]): Promise<Response> {
  const method = req.method.toUpperCase();
  /* WHO IS ASKING, decided HERE and not in the two route files.
     The register is one implementation behind two doors, and the owner asked
     for "the same permissions consistently in both ERPs" — so the permissions
     are read in the shared half, where there is no second copy to drift. The
     module gates upstream (roboGate, chromiaGate) have already settled whether
     this login belongs in the building; this settles what it may do inside.
     A request with no session at all reads as the narrowest tier, not the
     widest: see plantRightsOf. */
  const rights = plantRightsOfUser(await currentUser());
  if (method === "GET") return route(req, segments, method, rights);
  // Boxed, so a handler's answer is never mistaken for the skipped write.
  const done = await unlessViewing(async () => ({ res: await route(req, segments, method, rights) }));
  return done ? done.res : bad((await viewAsBlocked()) ?? VIEWING, 403);
}

/**
 * What this tier is refused at this endpoint, by its path alone, or null.
 *
 * The three cards an operator never sees. Kept as one table rather than a
 * check inside each handler, so the list is readable next to the hidden cards
 * in AttendanceClient and the paths in routeCaps.plantOperatorRefused — the
 * three layers the owner asked for, each of which must be able to be read
 * against the other two.
 *
 * The day's register is NOT here: it is the one endpoint where both tiers have
 * business, and what separates them is the date and what is already written,
 * which only the handler knows. Nor is the roster's GET: the tablet has to
 * read the list of operators to draw the register it IS allowed to write.
 */
function refusedHere(rights: PlantRights, head: string, method: string): string | null {
  if (head === "leave" && !rights.leave) return NOT_YOURS;
  if ((head === "records" || head === "export") && !rights.downloads) return NOT_YOURS;
  if (head === "operators" && method !== "GET" && !rights.roster) return NOT_YOURS;
  return null;
}

async function route(req: Request, segments: string[], method: string, rights: PlantRights): Promise<Response> {
  const url = new URL(req.url);
  const p = url.searchParams;
  const [head, id] = segments;
  /* Refused before the body is read, let alone acted on. 403, not 404: the
     endpoint is there and the answer is no, which is what the screen says
     too — one wording for both, from lib/plantAccess.ts. */
  const refused = refusedHere(rights, String(head ?? ""), method);
  if (refused) return bad(refused, 403);
  const body = method === "GET" || method === "DELETE" ? {} : await req.json().catch(() => ({}));

  /* operators */
  if (head === "operators" && !id) {
    if (method === "GET") return json(await listOperators());
    if (method === "POST") {
      const name = cleanOperatorName((body as { name?: unknown }).name);
      const err = operatorNameError(name);
      if (err) return bad(err);
      const clash = await prisma.attendanceOperator.findUnique({ where: { name }, select: { id: true } });
      if (clash) return bad(`${name} is already on the list.`, 409);
      const row = await prisma.$transaction(async (tx) => {
        const made = await tx.attendanceOperator.create({
          data: { name, sortOrder: await nextSortOrder(tx) },
          select: { id: true, name: true, isActive: true, sortOrder: true },
        });
        await trail(tx, "AttendanceOperator", `Attendance: operator ${name} added`,
          { action: "attendance.operator.add", after: made });
        return made;
      });
      return json(row, 201);
    }
  }

  if (head === "operators" && id) {
    if (method === "PATCH") {
      const data: { name?: string; isActive?: boolean } = {};
      if ((body as { name?: unknown }).name !== undefined) {
        const name = cleanOperatorName((body as { name?: unknown }).name);
        const err = operatorNameError(name);
        if (err) return bad(err);
        const clash = await prisma.attendanceOperator.findFirst({ where: { name, NOT: { id } }, select: { id: true } });
        if (clash) return bad(`${name} is already on the list.`, 409);
        data.name = name;
      }
      if (typeof (body as { isActive?: unknown }).isActive === "boolean") data.isActive = (body as { isActive: boolean }).isActive;
      if (Object.keys(data).length === 0) return bad("Nothing to change.");
      const row = await prisma.$transaction(async (tx) => {
        const before = await tx.attendanceOperator.findUnique({ where: { id }, select: { id: true, name: true, isActive: true } });
        if (!before) return null;
        const after = await tx.attendanceOperator.update({ where: { id }, data, select: { id: true, name: true, isActive: true } });
        const said = [
          before.name !== after.name ? `renamed ${before.name} → ${after.name}` : "",
          before.isActive !== after.isActive ? `${after.name} ${after.isActive ? "back on" : "taken off"} the roster` : "",
        ].filter(Boolean).join("; ");
        await trail(tx, "AttendanceOperator", `Attendance: ${said || `operator ${after.name} saved unchanged`}`,
          { action: "attendance.operator.edit", before, after });
        return after;
      });
      if (!row) return bad("That operator is not on the list any more. Reload the page.", 404);
      return json(row);
    }
    if (method === "DELETE") {
      /* An operator who has ever been marked present is part of the record, so
         deleting them would take their attendance with them. They are switched
         off instead and keep their history; one who has never been used is
         simply removed. The caller is told which happened, and the trail keeps
         the row either way. */
      const out = await prisma.$transaction(async (tx) => {
        const before = await tx.attendanceOperator.findUnique({ where: { id } });
        if (!before) return null;
        // One after the other: a transaction's queries share one connection.
        const days = await tx.attendanceDay.count({ where: { operatorId: id } });
        const leaves = await tx.attendanceLeave.count({ where: { operatorId: id } });
        if (days + leaves > 0) {
          const row = await tx.attendanceOperator.update({ where: { id }, data: { isActive: false }, select: { name: true } });
          await trail(tx, "AttendanceOperator", `Attendance: ${row.name} taken off the roster (${days + leaves} record(s) on file, so not deleted)`,
            { action: "attendance.operator.deactivate", before, after: { ...before, isActive: false }, records: days + leaves });
          return { deactivated: true, name: row.name, records: days + leaves };
        }
        await tx.attendanceOperator.delete({ where: { id } });
        await trail(tx, "AttendanceOperator", `Attendance: operator ${before.name} removed (no attendance or leave on file)`,
          { action: "attendance.operator.delete", before });
        return { deleted: true };
      });
      if (!out) return bad("That operator is not on the list any more. Reload the page.", 404);
      return json(out);
    }
  }

  /* the day's register */
  if (head === "day") {
    if (method === "GET") {
      const date = isDate(p.get("date")) ? (p.get("date") as string) : todayPlant();
      /* The tablet reads today and no other day. Refused rather than quietly
         answered with today's rows under yesterday's date: a screen told
         "here is 25/10" while holding 26/10's register is worse than a
         refusal, and a manual request deserves the true answer. */
      if (!rights.anyDate && date !== todayPlant()) return bad(ONLY_TODAY, 403);
      return json({ date, rows: await dayRegister(date) });
    }
    if (method === "PUT") {
      const b = body as { date?: unknown; operatorId?: unknown; lines?: unknown; inTime?: unknown; outTime?: unknown };
      if (!isDate(b.date)) return bad("Pick a date.");
      const operatorId = String(b.operatorId ?? "");
      if (!operatorId) return bad("Pick an operator.");
      const inTime = timeOrNull(b.inTime);
      if (inTime === undefined) return bad("In-Time is not a valid time.");
      const lines = joinLines(Array.isArray(b.lines) ? b.lines.map(String) : String(b.lines ?? "").split(","));
      const date = b.date;

      /* THE CLOCK IS THE SERVER'S, not the browser's.
         The page checks the same two rules so the operator is told at once, but
         a page can be edited and a request can be made without one, so what is
         stored is decided here against this machine's own reading of the plant
         clock. See lib/attendance/clock.ts. */
      const nowPlant = toPlantTimeInput(new Date());
      const today = todayPlant();
      const existing = await prisma.attendanceDay.findUnique({
        where: { date_operatorId: { date, operatorId } },
        select: { lines: true, inTime: true, outTime: true },
      });
      /* LAST NIGHT'S OUT-TIME. The night shift marks in at 22:00 and out at
         06:00, and its row is dated the day it started — so at 06:00 the
         tablet's today is the next date. The tablet may put the Out-Time on
         the PREVIOUS day's open row (In-Time, no Out-Time) and do nothing
         else on that day (code review, 26 Oct 2026): same Lines, same
         In-Time, and the Out stamped from this machine's clock below. */
      const closesLastNight = !rights.anyDate && date === previousDay(today)
        && closesOpenRow(existing, { lines, inTime: b.inTime, outTime: b.outTime });
      /* THE TABLET WRITES TODAY. Owner, 26 Oct 2026: operators may enter
         their In and Out "for the current date", and may not "select
         previous dates or future dates", "edit previous attendance records",
         "enter missed attendance for previous dates", or "bypass incomplete
         previous-day attendance restrictions". All four are this one line:
         with no other date reachable there is no previous record to edit, no
         missed day to fill in, and no way round the hold — which clears when
         the night shift is marked out (above) or when the Plant In-Charge
         finishes the day that is holding it, the login that exists to do
         exactly that.

         Checked against THE SERVER'S reading of the plant date, not the
         browser's, for the reason the clock rules are: a page can be edited
         and a request can be made without one. */
      if (!closesLastNight && !rights.anyDate && date !== today) return bad(ONLY_TODAY, 403);
      // A day shift nobody marked out of is not the night shift: stamping
      // this morning's clock on it would be a false Out.
      if (closesLastNight && !overnightShiftOpen(existing?.inTime, nowPlant)) return bad(SHIFT_TOO_LONG);
      const kind = dayKind(date, today);
      // A day that has not happened cannot be attended. This is the only case
      // the past-day correction path below would otherwise let through.
      if (kind === "future") return bad(`${INVALID_TIME} That date has not happened yet.`);
      const isToday = kind === "today";
      /* THE CLOCK RULES ARE THE TABLET'S: marking attendance as it happens.
         The Plant In-Charge types both times on today's row as on a past day
         — the 06:00 In nobody tapped, the 14:00 Out somebody forgot — and is
         refused only a time that has not happened yet (laterThanNowError). */
      const clockRules = isToday && !rights.amendSaved;
      const correctsToday = isToday && rights.amendSaved;

      // Rule 1 — only when the In-Time is being ENTERED or changed. Carrying an
      // old one back (saving the row to correct its Line) must not be refused.
      /* YESTERDAY FIRST. A new entry is refused while the operator's previous
         day is unfinished — started and never finished (previousDayIncomplete).
         Checked here and not only on the page, because the page is not what
         decides; and only for a NEW entry, so the row being complained about
         can still be put right. */
      if (!existing && (await heldForPreviousDay(date)).has(operatorId)) {
        return bad(INCOMPLETE_PREVIOUS_DAY);
      }

      const inTimeChanged = !inTimeUnchanged(b.inTime as string, existing?.inTime);
      if (inTimeChanged) {
        const refused = inTime === null ? null
          : inTimeErrorOn(clockRules, inTime, nowPlant) ?? (correctsToday ? laterThanNowError(inTime, nowPlant) : null);
        if (refused) return bad(refused);
      }
      // Rule 2 — the Out-Time is stamped, never taken, when the tablet writes
      // it: on today's row, and on last night's. Whatever arrived is discarded
      // unless it is the one already stored. Typed by the Plant In-Charge, and
      // on a past day, because no reading of the clock would be right for a
      // day that has already ended.
      const outTime = outTimeToStoreOn(clockRules || closesLastNight, b.outTime as string, existing?.outTime, nowPlant);
      /* The In-Charge's Out on today is judged against the In it will be
         stored WITH, whichever of the two changed: moving the In past an Out
         already there makes that Out tomorrow's, which has not happened yet
         (clock.ts — an Out-Time is never later than the moment it was
         recorded). */
      if (correctsToday && outTime && (inTimeChanged || outTime !== (existing?.outTime ?? null))) {
        const refused = laterThanNowError(outTime, nowPlant, inTime);
        if (refused) return bad(refused);
      }

      /* AND IT WRITES ONCE. The tablet may fill in what is blank — the
         morning's In-Time, the evening's Out-Time onto the same row — and may
         not write over what is already there. Asked AFTER the two clock rules
         have decided what would be stored, because that, and not what the
         browser sent, is what would change (amendsSavedRow says why). The
         Plant In-Charge passes straight through: correcting the register is
         what that login is for. */
      if (!rights.amendSaved && amendsSavedRow(existing, { lines, inTime, outTime })) {
        return bad(ALREADY_SAVED, 403);
      }

      const row = await prisma.$transaction(async (tx) => {
        const before = await tx.attendanceDay.findUnique({ where: { date_operatorId: { date, operatorId } } });
        /* The upsert IS the "no duplicates" rule: (date, operatorId) is unique in
           the database, so the same day saved from Robo and from Chromia is one
           row that the second save corrects rather than a second row. */
        const saved = await tx.attendanceDay.upsert({
          where: { date_operatorId: { date, operatorId } },
          create: { date, operatorId, lines, inTime, outTime },
          update: { lines, inTime, outTime },
          include: { operator: { select: { name: true } } },
        });
        const was = before ? ` (was ${dayWords(before)})` : "";
        await trail(tx, "AttendanceDay",
          `Attendance: ${saved.operator?.name ?? "an operator"} on ${onDay(date)} — ${dayWords(saved)}${was}`,
          {
            action: before ? "attendance.day.edit" : "attendance.day.add",
            before: before ? { id: before.id, date, operatorId, lines: before.lines, inTime: before.inTime, outTime: before.outTime } : null,
            after: { id: saved.id, date, operatorId, lines: saved.lines, inTime: saved.inTime, outTime: saved.outTime },
          });
        return saved;
      });
      return json({
        operatorId,
        lines: row.lines,
        linesLabel: linesLabel(row.lines),
        inTime: row.inTime ?? "",
        outTime: row.outTime ?? "",
        outDate: outDate(date, row.inTime, row.outTime),
        worked: workedLabel(row.inTime, row.outTime),
        saved: true,
      });
    }
  }

  /* leave */
  if (head === "leave" && !id) {
    if (method === "GET") return json(await listLeave());
    if (method === "POST") {
      const b = body as Record<string, unknown>;
      if (!isDate(b.date)) return bad("Pick a date.");
      const operatorId = String(b.operatorId ?? "");
      if (!operatorId) return bad("Pick an operator.");
      const fromTime = timeOrNull(b.fromTime);
      const toTime = timeOrNull(b.toTime);
      if (fromTime === undefined || toTime === undefined) return bad("Leave time is not a valid time.");
      /* Required, and checked here rather than only on the form: an absence is
         either excused or it is not, and a record that cannot say which is of
         no use to the supervisor reading it. */
      const typeErr = leaveTypeError(b.leaveType);
      if (typeErr) return bad(typeErr);
      const date = b.date;
      await prisma.$transaction(async (tx) => {
        const made = await tx.attendanceLeave.create({
          data: {
            date,
            operatorId,
            leaveType: parseLeaveType(b.leaveType) as string,
            fromTime,
            toTime,
            reason: String(b.reason ?? "").trim(),
            remarks: String(b.remarks ?? "").trim() || null,
          },
          include: { operator: { select: { name: true } } },
        });
        const { operator, ...after } = made;
        await trail(tx, "AttendanceLeave", `Attendance: leave added for ${operator?.name ?? "an operator"} on ${onDay(date)} (${leaveLabel(fromTime, toTime)})`,
          { action: "attendance.leave.add", after });
      });
      return json(await listLeave(), 201);
    }
  }

  if (head === "leave" && id) {
    if (method === "PATCH") {
      const b = body as Record<string, unknown>;
      const data: Record<string, unknown> = {};
      if (b.date !== undefined) {
        if (!isDate(b.date)) return bad("Pick a date.");
        data.date = b.date;
      }
      if (b.operatorId !== undefined) {
        if (!String(b.operatorId ?? "")) return bad("Pick an operator.");
        data.operatorId = String(b.operatorId);
      }
      if (b.leaveType !== undefined) {
        const typeErr = leaveTypeError(b.leaveType);
        if (typeErr) return bad(typeErr);
        data.leaveType = parseLeaveType(b.leaveType) as string;
      }
      for (const k of ["fromTime", "toTime"] as const) {
        if (b[k] !== undefined) {
          const t = timeOrNull(b[k]);
          if (t === undefined) return bad("Leave time is not a valid time.");
          data[k] = t;
        }
      }
      if (b.reason !== undefined) data.reason = String(b.reason ?? "").trim();
      if (b.remarks !== undefined) data.remarks = String(b.remarks ?? "").trim() || null;
      if (Object.keys(data).length === 0) return bad("Nothing to change.");
      const there = await prisma.$transaction(async (tx) => {
        const found = await tx.attendanceLeave.findUnique({ where: { id }, include: { operator: { select: { name: true } } } });
        if (!found) return false;
        const { operator: was, ...before } = found;
        const { operator, ...after } = await tx.attendanceLeave.update({ where: { id }, data, include: { operator: { select: { name: true } } } });
        await trail(tx, "AttendanceLeave",
          `Attendance: leave for ${operator?.name ?? "an operator"} on ${onDay(after.date)} (${leaveLabel(after.fromTime, after.toTime)}) changed — was ${was?.name ?? "an operator"} on ${onDay(before.date)} (${leaveLabel(before.fromTime, before.toTime)})`,
          { action: "attendance.leave.edit", before, after });
        return true;
      });
      if (!there) return bad("That leave record is not there any more. Reload the page.", 404);
      return json(await listLeave());
    }
    if (method === "DELETE") {
      /* Removed for good, so the trail keeps the whole row: who it was for,
         the day, the hours, the reason and the remarks. */
      const there = await prisma.$transaction(async (tx) => {
        const before = await tx.attendanceLeave.findUnique({ where: { id }, include: { operator: { select: { name: true } } } });
        if (!before) return false;
        await tx.attendanceLeave.delete({ where: { id } });
        const { operator, ...row } = before;
        await trail(tx, "AttendanceLeave",
          `Attendance: leave removed for ${operator?.name ?? "an operator"} on ${onDay(row.date)} (${leaveLabel(row.fromTime, row.toTime)}${row.reason ? `, ${row.reason}` : ""})`,
          { action: "attendance.leave.delete", before: { ...row, operatorName: operator?.name ?? null } });
        return true;
      });
      if (!there) return bad("That leave record is not there any more. Reload the page.", 404);
      return json(await listLeave());
    }
  }

  /* downloads — the table, then the same rows as a sheet */
  if (head === "records" && method === "GET") {
    const f = readFilter(p);
    const today = todayPlant();
    const rows = await filteredRows(f, today);
    return json({
      columns: columnsFor(f.type),
      rows,
      description: describeFilter(f, today, await operatorNameOf(f.operatorId)),
    });
  }

  if (head === "export" && method === "GET") {
    const f = readFilter(p);
    const today = todayPlant();
    const rows = await filteredRows(f, today);
    const columns = [...columnsFor(f.type)];
    const ws = XLSX.utils.json_to_sheet(rows, { header: columns });
    ws["!cols"] = widthsFor(f.type).map((wch) => ({ wch }));
    styleRoboSheet(ws, { columnCount: columns.length });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, (f.type === "LEAVE" ? "Leave" : "Attendance").slice(0, 31));
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    return new Response(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filterFileName(f, today, await operatorNameOf(f.operatorId))}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return bad("Not found", 404);
}

/** Re-exported so a test can check the sheets match the registers on screen. */
export { ATTENDANCE_COLUMNS, LEAVE_COLUMNS };
