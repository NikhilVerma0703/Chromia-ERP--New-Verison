"use client";
/**
 * Attendance — the SAME screen in both ERPs.
 *
 * One component, rendered by /robo/attendance and /chromia/attendance, talking
 * to one set of tables through whichever of the two API doors its module owns
 * (the `api` prop). That is the whole of "keep the two in step": there is no
 * second screen to keep matching and no second copy of the data to reconcile.
 * An operator's day entered on the Robo tablet is the row the Chromia tablet
 * shows, because it is the row.
 *
 * Three registers, in the order the shop floor fills them in: the day's
 * attendance, leave asked for, and the downloads that read both back.
 *
 * ── WHO SEES WHICH OF THE THREE ───────────────────────────────────────────
 * `rights` (lib/plantAccess.ts) is the whole of it, and it arrives from the
 * server render rather than being worked out here. On the line tablet two of
 * the three registers are not drawn at all, the date is today and cannot be
 * moved, the roster has no buttons, and a row that is written is finished.
 * The Plant In-Charge gets the screen entire.
 *
 * NONE OF THIS IS THE ENFORCEMENT, and it is written on the assumption that
 * it is not: every rule below is checked again in lib/attendance/server.ts
 * against the session, and the paths that are refused outright are refused at
 * the edge as well (routeCaps.plantOperatorRefused). The owner's words were
 * "hiding menu items alone is insufficient". What this layer is for is that
 * the tablet never offers a control whose answer would be no.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui";
import { Toast } from "@/components/Toast";
import { TimeInput } from "@/components/robo/TimeInput";
import {
  inp, lbl, btnPrimary, btnGhost, btnDanger, th as thBase, thead, errorBox, noteBox, dmy, today,
} from "@/components/commercial/invoices/ui";
import {
  INCOMPLETE_PREVIOUS_DAY, LEAVE_TYPES, LEAVE_TYPE_HUES, LEAVE_TYPE_LABELS, LINES, LINE_LABELS,
  dayKind, laterThanNowError, leaveTypeHue, linesLabel, outDate, overnightShiftOpen, parseLines, workedLabel,
  type LineCode,
} from "@/lib/attendance/attendance";
import { IN_TIME_GRACE_MINUTES, earliestInTime, inTimeErrorOn, inTimeUnchanged } from "@/lib/attendance/clock";
import type { PlantRights } from "@/lib/plantAccess";
// The sentence only: the rights themselves still arrive as a prop.
import { ONLY_TODAY } from "@/lib/plantAccess";
import { toPlantDateInput, toPlantTimeInput } from "@/lib/chromia/plant-time";
import {
  PERIOD_LABELS, PERIOD_MODES, RECORD_TYPES, RECORD_TYPE_LABELS,
  type PeriodMode, type RecordType,
} from "@/lib/attendance/filters";

/* The ERP's own form, button and register classes — the strings
   components/commercial/invoices/ui.ts exports for the invoice register, which
   the Lab and Accounts screens draw with too — so this screen cannot drift
   into a look of its own. A button is 44px tall on a touch screen without
   asking: globals.css sizes every button and rounded link under
   `pointer: coarse`. What that file has no word for is composed here from the
   same idiom (InvoiceRegister's body cell and row, the proforma register's
   toggle chip). */
const label = lbl;
/** A header cell; never wraps, so a narrow screen scrolls rather than stacks. */
const th = `whitespace-nowrap ${thBase}`;
const td = "py-2 pr-4 align-top text-gray-700";
const tr = "border-b border-gray-50 last:border-0";
/** A message inside a register that scrolls sideways on a phone: held at the
 *  visible left edge and no wider than the screen (less the page's and the
 *  card's padding), so it is read whole without scrolling the table. */
const pinned = "sticky left-0 max-w-[calc(100vw-4.5rem)]";
/** One of the two lines, as a toggle chip. A <label>, not a button, so the
 *  touch-height rule in globals.css does not reach it; it asks for its own. */
const lineChip = (on: boolean) =>
  `flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition [@media_screen_and_(pointer:coarse)]:min-h-[44px] ${
    on ? "border-brand bg-brand/5 font-medium text-brand" : "border-gray-200 bg-white text-gray-600 hover:border-brand"}`;

/** Today on the device's own calendar — the register opens on today. */
/**
 * Today — on the PLANT's calendar, not the tablet's.
 *
 * The register opens on today and the date stays a field the supervisor can
 * change. "Today" is Asia/Kolkata because that is the day the shift belongs
 * to: a tablet left on another timezone, or one sitting a few hours either
 * side of midnight, would otherwise open yesterday's or tomorrow's page and
 * the first operator of the night shift would be marked in on the wrong day.
 * The same reading the server checks against.
 */
const todayStr = () => toPlantDateInput(new Date());
const thisMonth = () => todayStr().slice(0, 7);

/** The tablet's clock, read in plant time (Asia/Kolkata) — what the operator
 *  is standing in front of, and what the In-Time window is measured from on
 *  screen. The server checks the same rules against its own reading of the
 *  same clock before anything is stored; see lib/attendance/clock.ts. */
const nowPlant = () => toPlantTimeInput(new Date());

interface DayRow {
  operatorId: string;
  operatorName: string;
  isActive: boolean;
  lines: string;
  linesLabel: string;
  inTime: string;
  outTime: string;
  /** The date the Out-Time belongs to — the next one when the shift crossed
   *  midnight. "" when there is no Out-Time yet. */
  outDate: string;
  worked: string;
  saved: boolean;
  /** Their previous day is unfinished, so nothing new may be entered here
   *  until it is — and `blockedDate` is the day to go and finish. */
  blocked: boolean;
  blockedDate: string;
  /** That unfinished row — the night shift's open row gets "Mark out now". */
  blockedRow: { lines: string; inTime: string; outTime: string } | null;
}
interface Operator { id: string; name: string; isActive: boolean }
interface LeaveRow {
  id: string; date: string; serial: number; operatorId: string; operatorName: string;
  /** "INFORMED" / "UNINFORMED", or "" on a row written before the field existed. */
  leaveType: string;
  /** The same thing in words, as the server prints it. */
  leaveTypeLabel: string;
  fromTime: string; toTime: string; leaveTime: string; reason: string; remarks: string;
}

/** A draft of one attendance row, while it is being edited. */
interface Draft { lines: LineCode[]; inTime: string; outTime: string }
const NO_DRAFT: Draft = { lines: [], inTime: "", outTime: "" };

/** Said in place of a register's rows when they could not be read — never the
 *  empty-register sentence, which would invite an entry that fails the same
 *  way (the first view, for one, if the attendance tables are not there yet). */
const UNREAD = "The register could not be read.";

export function AttendanceClient({ api, rights }: {
  /** This module's door onto the shared register: "/api/robo/attendance" or
   *  "/api/chromia/attendance". Only the gate differs; the data is one. */
  api: string;
  /** What this login may do here — read on the server from the session and
   *  handed down, so the screen and the API cannot hold different opinions.
   *  See the note at the head of this file. */
  rights: PlantRights;
}) {
  const [date, setDate] = useState(todayStr);
  const [rows, setRows] = useState<DayRow[]>([]);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [leave, setLeave] = useState<LeaveRow[]>([]);
  const [loading, setLoading] = useState(true);
  /* Each register says its own failure where it is drawn: a read that failed
     is a row in its own table, a save that failed sits under the row or the
     form that sent it. Nothing is said only at the top of the page, which on a
     tablet is off screen by the time anyone presses Save. */
  /** The day's register could not be read (its message, or ""). */
  const [dayError, setDayError] = useState("");
  /** A failure of the Daily Attendance card's own controls (the operator list). */
  const [error, setError] = useState("");
  /** A row's save failed: said under that row. */
  const [rowError, setRowError] = useState<{ operatorId: string; message: string } | null>(null);
  const [operatorsFailed, setOperatorsFailed] = useState(false);
  const [leaveFailed, setLeaveFailed] = useState(false);
  /* A note that has to be read, not glanced at (an operator taken off the
     roster rather than deleted): it stays until the next change. A plain
     "done" is the ERP's Toast, gone after a moment. */
  const [notice, setNotice] = useState("");
  const [toast, setToast] = useState({ n: 0, text: "" });
  const done = useCallback((text: string) => setToast((t) => ({ n: t.n + 1, text })), []);

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(NO_DRAFT);
  const [saving, setSaving] = useState(false);
  /* The clock, kept fresh: the earliest In-Time it allows moves with it, and a
     row left open for a few minutes must not go on offering the window it had
     when it was opened. Every minute otherwise, for last night's "Mark out
     now", which is offered only while that shift could still be running. */
  const [now, setNow] = useState(nowPlant);
  useEffect(() => {
    const t = setInterval(() => setNow(nowPlant()), editing ? 15_000 : 60_000);
    return () => clearInterval(t);
  }, [editing]);

  const call = useCallback(async (path: string, init?: RequestInit) => {
    const res = await fetch(`${api}/${path}`, { cache: "no-store", ...init });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const read = !init?.method || init.method === "GET";
      throw new Error((body as { error?: string })?.error
        || (read ? "The register could not be read. Please try again." : "That did not save. Please try again."));
    }
    return res.json();
  }, [api]);

  /* Only the latest read of the day lands: pick 19/10 then 20/10 quickly and
     a slow answer for 19/10 must not fill the register under 20/10. */
  const dayRead = useRef(0);
  const loadDay = useCallback(async (d: string) => {
    const mine = ++dayRead.current;
    setLoading(true);
    setDayError("");
    try {
      const data = await call(`day?date=${encodeURIComponent(d)}`);
      if (mine === dayRead.current) setRows((data as { rows: DayRow[] }).rows ?? []);
    } catch (e) {
      if (mine !== dayRead.current) return;
      // Nothing read for another date stays on screen under this one.
      setRows([]);
      setDayError((e as Error).message || UNREAD);
      if ((e as Error).message === ONLY_TODAY) followTodayRef.current();
    } finally {
      if (mine === dayRead.current) setLoading(false);
    }
  }, [call]);

  const loadOperators = useCallback(async () => {
    try { setOperators(await call("operators")); setOperatorsFailed(false); }
    catch { setOperatorsFailed(true); }
  }, [call]);
  const loadLeave = useCallback(async () => {
    /* Not asked for at all where the card is not drawn. The endpoint would
       answer 403 and the screen would show a failure for a register it is not
       showing — and the edge refuses the path before the route does, so the
       failure would not even say why. */
    if (!rights.leave) return;
    try { setLeave(await call("leave")); setLeaveFailed(false); }
    catch { setLeave([]); setLeaveFailed(true); }
  }, [call, rights.leave]);

  useEffect(() => { void loadDay(date); }, [date, loadDay]);
  useEffect(() => { void loadOperators(); void loadLeave(); }, [loadOperators, loadLeave]);

  /* A new date closes whatever row was open. The half-typed In and Out belong
     to the date they were typed on; carried across, Save would write them over
     the new date's real row. The old date's rows go too, before the new read. */
  const changeDate = (d: string) => {
    if (d === date) return;
    setEditing(null);
    setDraft(NO_DRAFT);
    setRowError(null);
    setRows([]);
    setLoading(true); // "Loading…", not the empty-roster sentence, until the read lands
    setDate(d);
  };

  /* THE TABLET FOLLOWS THE CALENDAR. It has no date field and is never
     signed out, so a page opened yesterday would go on sending yesterday's
     date, and every save would be refused as another day. Checked every
     minute, whenever the page comes back into view, and whenever the server
     says "today only" — then the register moves to today and says so.
     Returns whether it moved. */
  const followToday = (): boolean => {
    if (rights.anyDate) return false;
    const t = todayStr();
    if (t === date) return false;
    changeDate(t);
    done(`A new day has started. The register now shows ${dmy(t)}.`);
    return true;
  };
  // The latest one, for the read above and the timers below.
  const followTodayRef = useRef(followToday);
  useEffect(() => { followTodayRef.current = followToday; });
  useEffect(() => {
    if (rights.anyDate) return;
    const check = () => { followTodayRef.current(); };
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    const t = setInterval(check, 60_000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
    };
  }, [rights.anyDate]);

  const startEdit = (r: DayRow) => {
    setEditing(r.operatorId);
    /* A row with no In-Time yet opens ON THE CLOCK, which is the time the
       operator is marking: the ten minutes are there for the walk to the
       tablet, not as a field to fill in from memory. One already entered is
       left exactly as it was. */
    const clock = nowPlant();
    setNow(clock);
    setDraft({ lines: parseLines(r.lines), inTime: r.inTime || clock, outTime: r.outTime });
    setRowError(null);
  };

  const toggleLine = (code: LineCode) =>
    setDraft((d) => ({ ...d, lines: d.lines.includes(code) ? d.lines.filter((l) => l !== code) : [...d.lines, code] }));

  const saveRow = async (operatorId: string) => {
    setSaving(true);
    setRowError(null);
    try {
      const saved = await call("day", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, operatorId, ...draft }),
      });
      setRows((rs) => rs.map((r) => (r.operatorId === operatorId ? { ...r, ...(saved as Partial<DayRow>) } : r)));
      setEditing(null);
    } catch (e) {
      if ((e as Error).message === ONLY_TODAY && followToday()) return;
      setRowError({ operatorId, message: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  /* MARKING OUT, IN ONE TAP — the tablet's whole evening.
     A row the tablet has already written cannot be opened for editing
     (rights.amendSaved), and it does not need to be: the only thing left to
     do to it is stamp the Out-Time, which is not an edit but the other half
     of marking attendance. So the row offers one button instead of an
     editor, and sends back exactly what is already stored plus the clock.
     The server stamps the Out-Time again from its own clock and refuses the
     save outright if anything else differs. */
  const markOutRow = async (r: DayRow) => {
    setSaving(true);
    setRowError(null);
    try {
      const saved = await call("day", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, operatorId: r.operatorId, lines: parseLines(r.lines), inTime: r.inTime, outTime: nowPlant() }),
      });
      setRows((rs) => rs.map((row) => (row.operatorId === r.operatorId ? { ...row, ...(saved as Partial<DayRow>) } : row)));
    } catch (e) {
      if ((e as Error).message === ONLY_TODAY && followToday()) return;
      setRowError({ operatorId: r.operatorId, message: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  /* LAST NIGHT'S OUT, IN ONE TAP. The night shift went in at 22:00 on the
     date before, and its row is dated then; at 06:00 the register is on the
     new date and that operator is held by the open row. The one thing the
     tablet may do to the day before is stamp that Out-Time (the server checks
     it is only that, and stamps its own clock), and doing it lifts the hold. */
  const markOutLastNight = async (r: DayRow) => {
    if (!r.blockedRow || rights.anyDate) return; // the tablet's (lastNightOpen)
    setSaving(true);
    setRowError(null);
    try {
      await call("day", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: r.blockedDate, operatorId: r.operatorId,
          lines: parseLines(r.blockedRow.lines), inTime: r.blockedRow.inTime, outTime: nowPlant(),
        }),
      });
      setRows((rs) => rs.map((row) => (row.operatorId === r.operatorId
        ? { ...row, blocked: false, blockedDate: "", blockedRow: null } : row)));
      done(`${r.operatorName} marked out for ${dmy(r.blockedDate)}.`);
    } catch (e) {
      if ((e as Error).message === ONLY_TODAY && followToday()) return;
      setRowError({ operatorId: r.operatorId, message: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  /* Worked hours as the operator types the Out — the same figure the server
     will store, from the same function, so the row never changes on save. */
  const draftWorked = useMemo(() => workedLabel(draft.inTime, draft.outTime), [draft.inTime, draft.outTime]);

  /* Why the drafted In-Time cannot be used, or null. The SAME function the
     server will use, and on the same terms:
       • empty is not an error — a row may be saved for its Line alone;
       • an UNCHANGED one is not an error either, however old. Opening this
         morning's row in the evening to tick the other line sends its 06:00
         back; judging that would make the row uncorrectable for the rest of
         the day, and the rule is about entering a time, not carrying one. */
  const originalIn = editing ? (rows.find((r) => r.operatorId === editing)?.inTime ?? "") : "";
  const originalOut = editing ? (rows.find((r) => r.operatorId === editing)?.outTime ?? "") : "";
  /* The clock rules are for marking attendance AS IT HAPPENS — the tablet, on
     today's page. An earlier date is being put right after the fact, which
     the register now requires (a new entry is held until the previous day is
     finished), so the times there are typed; and so are the Plant
     In-Charge's on today, short of a time that has not happened yet. The
     server decides this the same way, from its own reading of the plant date. */
  const isToday = dayKind(date, todayStr()) === "today";
  const clockRules = isToday && !rights.amendSaved;
  const inError = useMemo(
    () => (draft.inTime.trim() && !inTimeUnchanged(draft.inTime, originalIn)
      ? inTimeErrorOn(clockRules, draft.inTime, now) ?? (isToday && !clockRules ? laterThanNowError(draft.inTime, now) : null)
      : null),
    [draft.inTime, originalIn, now, isToday, clockRules],
  );
  /* The In-Charge's typed Out-Time on today, by the same rule as the server:
     judged whenever either time changes, because moving the In past an Out
     already there makes that Out tomorrow's. */
  const outError = useMemo(
    () => (isToday && !clockRules && draft.outTime.trim()
      && (draft.outTime.trim() !== originalOut.trim() || !inTimeUnchanged(draft.inTime, originalIn))
      ? laterThanNowError(draft.outTime, now, draft.inTime) : null),
    [draft.outTime, draft.inTime, originalOut, originalIn, now, isToday, clockRules],
  );

  return (
    <div className="space-y-6">
      <Toast trigger={toast.n} text={toast.text} />

      <DailyAttendance
        date={date} setDate={changeDate} rows={rows} loading={loading}
        dayError={dayError} retry={() => void loadDay(date)} error={error} notice={notice} rowError={rowError}
        editing={editing} draft={draft} draftWorked={draftWorked} saving={saving}
        now={now} inError={inError} outError={outError} isToday={isToday} clockRules={clockRules}
        markOut={() => { const t = nowPlant(); setNow(t); setDraft((d) => ({ ...d, outTime: t })); }}
        clearOut={() => setDraft((d) => ({ ...d, outTime: "" }))}
        startEdit={startEdit} cancel={() => { setEditing(null); setRowError(null); }} toggleLine={toggleLine}
        setDraft={setDraft} saveRow={saveRow} markOutRow={markOutRow} markOutLastNight={markOutLastNight} rights={rights}
        operators={operators} operatorsFailed={operatorsFailed}
        onOperatorsChanged={async (msg, note) => {
          if (note) setNotice(msg);
          else { setNotice(""); done(msg); }
          await loadOperators();
          await loadDay(date);
        }}
        call={call} setError={setError}
      />

      {/* The two registers the line tablet does not keep. Owner, 26 Oct 2026:
          "Hide and restrict Downloads and LEAVE TAKEN completely from
          operators." Not drawn, not fetched, and refused by the route and the
          edge besides. */}
      {rights.leave && (
        <LeaveTaken
          rows={leave} failed={leaveFailed} retry={() => void loadLeave()}
          operators={operators} operatorsFailed={operatorsFailed} call={call}
          onChanged={(next, msg) => { setLeave(next); setLeaveFailed(false); done(msg); }}
        />
      )}

      {rights.downloads && <Downloads api={api} operators={operators} operatorsFailed={operatorsFailed} />}
    </div>
  );
}

/* ── 1. Daily Attendance ───────────────────────────────────────────── */

function DailyAttendance(props: {
  date: string; setDate: (d: string) => void; rows: DayRow[]; loading: boolean;
  dayError: string; retry: () => void; error: string; notice: string;
  rowError: { operatorId: string; message: string } | null;
  editing: string | null; draft: Draft; draftWorked: string; saving: boolean;
  /** The plant clock, and why the drafted In-Time or the In-Charge's typed
   *  Out-Time cannot be used (null when it can). */
  now: string; inError: string | null; outError: string | null;
  /** Is the page showing the plant's today? */
  isToday: boolean;
  /** Do the clock rules apply — the tablet, on today? Anywhere else the
   *  times are typed. */
  clockRules: boolean;
  /** Stamp the Out-Time with the clock, or take it off again. It is never typed. */
  markOut: () => void; clearOut: () => void;
  startEdit: (r: DayRow) => void; cancel: () => void; toggleLine: (c: LineCode) => void;
  setDraft: (f: (d: Draft) => Draft) => void; saveRow: (id: string) => void;
  /** Stamp the Out-Time straight onto a written row, without opening it. */
  markOutRow: (r: DayRow) => void;
  /** Stamp the Out-Time onto the night shift's open row from the day before. */
  markOutLastNight: (r: DayRow) => void;
  /** What this login may do here — see the head of this file. */
  rights: PlantRights;
  operators: Operator[]; operatorsFailed: boolean;
  onOperatorsChanged: (message: string, note: boolean) => void | Promise<void>;
  call: (path: string, init?: RequestInit) => Promise<unknown>;
  setError: (m: string) => void;
}) {
  const { date, setDate, rows, loading, dayError, rowError, editing, draft, draftWorked, saving, now, inError, outError, isToday, clockRules, rights } = props;
  /** Last night's open row, while that shift could still be running: the
   *  tablet may stamp its Out-Time, and nothing else on that day. The
   *  TABLET's only — the server stamps last night's Out only for a login held
   *  to today (closesLastNight); the Plant In-Charge and admins would send it
   *  as an ordinary past-day save, storing this browser's clock as a typed
   *  Out. They open that day with the date field and type it there. */
  const lastNightOpen = (r: DayRow) => !rights.anyDate && isToday && Boolean(r.blockedRow?.inTime) && !r.blockedRow?.outTime
    && overnightShiftOpen(r.blockedRow?.inTime, now);
  /** The date the drafted Out-Time belongs to, when it is not this one. */
  const draftOutDate = (() => {
    const d = outDate(date, draft.inTime, draft.outTime);
    return d && d !== date ? d : "";
  })();
  const [managing, setManaging] = useState(false);
  /* A failed save is said under its own row, and brought into view: the row
     can be far down a long roster, below the fold on a tablet. */
  const rowErrorRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    if (rowError) rowErrorRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [rowError]);

  return (
    <section>
      <Card>
        <SectionHead
          title="Daily Attendance"
          subtitle={
            `One line per operator for the day. An operator on both lines has one In and one Out — they came to work once. ` +
            (clockRules
              ? `Mark in as you arrive: an In-Time may be up to ${IN_TIME_GRACE_MINUTES} minutes old, and the Out-Time is stamped with the clock.`
              : isToday
                ? `You are putting today right, so both times are typed. Neither may be later than now.`
                : `This is an earlier day, so its times are filled in rather than marked — a shift that ended after midnight shows the date it ended on.`)
          }
        />
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div className="w-full sm:w-56">
            <span className={label}>Date</span>
            {/* THE TABLET SHOWS TODAY AND ONLY TODAY, so it shows the date
                rather than offering it: a date field that cannot be changed
                reads as a broken field, and a disabled one invites the tap
                anyway. The register the supervisor keeps has the picker. */}
            {rights.anyDate ? (
              /* Held while a row saves: the save is for the date it was typed on. */
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={saving} className={inp} />
            ) : (
              <div className={`${inp} font-medium text-gray-900`}>{dmy(date)}<span className="ml-2 text-xs font-normal text-gray-400">today</span></div>
            )}
          </div>
          {/* The roster is the Plant In-Charge's. A tablet reads the list to
              draw the register and does not add to, rename or remove from
              it. */}
          {rights.roster && (
            <button type="button" onClick={() => setManaging((v) => !v)} className={btnGhost}>
              {managing ? "Done" : "+ Add Operator"}
            </button>
          )}
        </div>

        {props.error && <p role="alert" className={`mb-4 ${errorBox}`}>{props.error}</p>}
        {props.notice && <p className={`mb-4 ${noteBox}`}>{props.notice}</p>}

        {rights.roster && managing && (
          <OperatorManager
            operators={props.operators} failed={props.operatorsFailed} call={props.call} setError={props.setError}
            onChanged={props.onOperatorsChanged}
          />
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className={thead}>
                {["Operator Name", "Line", "In-Time", "Out-Time", "Total Working Hours", "Action"].map((h, i, a) => (
                  <th key={h} className={`${th} ${i === a.length - 1 ? "pr-0 text-right" : ""}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} className="py-10 text-center text-gray-400">Loading…</td></tr>
              )}
              {!loading && dayError && <UnreadRow cols={6} message={dayError} retry={props.retry} />}
              {!loading && !dayError && rows.length === 0 && (
                <tr><td colSpan={6} className="py-10 text-center text-gray-400">
                  {rights.roster
                    ? "No operators yet — add one with + Add Operator."
                    : "No operators on the roster yet. Ask the Plant In-Charge to add them."}
                </td></tr>
              )}
              {!loading && rows.map((r) => {
                const isEditing = editing === r.operatorId;
                /* Not `isEditing && …` any more: the tablet's one-tap Mark
                   out never opens the row, and a refusal nobody can see is a
                   button that silently does nothing. Both paths clear this
                   before they try again. */
                const failed = rowError?.operatorId === r.operatorId ? rowError.message : "";
                return (
                  <Fragment key={r.operatorId}>
                  <tr className={failed ? "border-b-0" : tr}>
                    <td className={`${td} font-medium text-gray-900`}>
                      {r.operatorName}
                      {!r.isActive && <span className="ml-2 text-xs font-normal text-gray-400">(off the roster)</span>}
                    </td>
                    <td className={td}>
                      {isEditing ? (
                        <div className="flex flex-wrap gap-2">
                          {LINES.map((code) => (
                            <label key={code} className={lineChip(draft.lines.includes(code))}>
                              <input type="checkbox" checked={draft.lines.includes(code)}
                                onChange={() => props.toggleLine(code)} className="h-4 w-4 rounded border-gray-300" />
                              {LINE_LABELS[code]}
                            </label>
                          ))}
                        </div>
                      ) : linesLabel(r.lines)}
                    </td>
                    <td className={td}>
                      {isEditing ? (
                        <div className="min-w-[7rem]">
                          <TimeInput value={draft.inTime} onChange={(v) => props.setDraft((d) => ({ ...d, inTime: v }))}
                            className={`${inp} w-24 ${inError ? "border-red-400 focus:border-red-400 focus:ring-red-100" : ""}`} />
                          {inError
                            ? <p role="alert" className="mt-1 text-xs font-medium text-red-600">{inError}</p>
                            : clockRules
                              ? <p className="mt-1 text-xs text-gray-400">{earliestInTime(now)} or later</p>
                              : isToday
                                ? <p className="mt-1 text-xs text-gray-400">Up to {now}</p>
                                : <p className="mt-1 text-xs text-gray-400">Filling in {dmy(date)}</p>}
                        </div>
                      ) : (r.inTime || "-")}
                    </td>
                    {/* The Out-Time is stamped, never typed: it is the moment
                        the operator pressed it, so it cannot be back-dated and
                        cannot be set ahead. The server stamps it again from its
                        own clock, so this button is the convenience, not the
                        rule. The Plant In-Charge, and any earlier day, types
                        it instead — and the server refuses one still to come. */}
                    <td className={td}>
                      {isEditing ? (
                        <div className="min-w-[8rem]">
                          {clockRules ? (
                            <>
                              <div className={`${inp} w-24 ${draft.outTime ? "font-medium text-gray-900" : "text-gray-400"}`}>
                                {draft.outTime || "—"}
                              </div>
                              <div className="mt-1 flex flex-wrap gap-1.5">
                                <button type="button" className={btnGhost} onClick={props.markOut}>
                                  {draft.outTime ? "Update to now" : "Mark out now"}
                                </button>
                                {draft.outTime && (
                                  <button type="button" className={btnGhost} onClick={props.clearOut}>Clear</button>
                                )}
                              </div>
                            </>
                          ) : (
                            <>
                              <TimeInput value={draft.outTime} onChange={(v) => props.setDraft((d) => ({ ...d, outTime: v }))}
                                className={`${inp} w-24 ${outError ? "border-red-400 focus:border-red-400 focus:ring-red-100" : ""}`} />
                              {outError && <p role="alert" className="mt-1 text-xs font-medium text-red-600">{outError}</p>}
                            </>
                          )}
                          {draftOutDate && <p className="mt-1 text-xs font-medium text-amber-700">{dmy(draftOutDate)} (next day)</p>}
                        </div>
                      ) : r.outTime ? (
                        <span className="whitespace-nowrap">
                          {r.outTime}
                          {/* A shift that crossed midnight came out on the NEXT
                              date, and the hours already count it that way. */}
                          {r.outDate && r.outDate !== date && (
                            <span className="ml-1.5 text-xs font-medium text-amber-700">{dmy(r.outDate)}</span>
                          )}
                        </span>
                      ) : "-"}
                    </td>
                    <td className={`${td} font-medium text-gray-900`}>{isEditing ? draftWorked : r.worked}</td>
                    <td className={`${td} pr-0 text-right`}>
                      {isEditing ? (
                        <div className="flex justify-end gap-2 whitespace-nowrap">
                          <button type="button" className={btnGhost} onClick={props.cancel} disabled={saving}>Cancel</button>
                          <button type="button" className={btnPrimary} onClick={() => props.saveRow(r.operatorId)} disabled={saving || Boolean(inError) || Boolean(outError)}>
                            {saving ? "Saving…" : "Save"}
                          </button>
                        </div>
                      ) : r.blocked && !r.saved ? (
                        lastNightOpen(r) ? (
                          /* Last night's shift, still open: the one thing to
                             do to it is stamp the Out-Time, and that is what
                             lifts the hold. */
                          <div className="flex flex-col items-end gap-1">
                            <button type="button" className={btnPrimary} onClick={() => props.markOutLastNight(r)} disabled={saving}>
                              {saving ? "Saving…" : "Mark out now"}
                            </button>
                            <span className="text-xs text-gray-500">In {r.blockedRow?.inTime} on {dmy(r.blockedDate)}</span>
                          </div>
                        ) : (
                          /* Yesterday is unfinished for this operator. Nothing
                             new may be entered for them until it is, and the
                             message says which day to go to — the date field
                             above is how to get there. */
                          <span role="alert" className="inline-block max-w-[16rem] text-right text-xs font-medium text-red-600">
                            {INCOMPLETE_PREVIOUS_DAY}
                            {r.blockedDate && <span className="block font-normal text-gray-500">({dmy(r.blockedDate)})</span>}
                          </span>
                        )
                      ) : rights.amendSaved || !r.saved ? (
                        <button type="button" className={btnGhost} onClick={() => props.startEdit(r)}>
                          {r.saved ? "Edit" : "Enter"}
                        </button>
                      ) : r.outTime ? (
                        /* Written, and marked out: the tablet's day with this
                           operator is over. A correction is the Plant
                           In-Charge's, so there is no control here at all
                           rather than one that would be refused. */
                        <span className="text-xs text-gray-400">Done</span>
                      ) : (
                        /* Written, not yet out. ONE TAP, no editor: stamping
                           the Out-Time is the other half of marking
                           attendance, not an edit of what is already there. */
                        <button type="button" className={btnPrimary} onClick={() => props.markOutRow(r)} disabled={saving}>
                          {saving ? "Saving…" : "Mark out now"}
                        </button>
                      )}
                    </td>
                  </tr>
                  {failed && (
                    <tr ref={rowErrorRef} className={tr}>
                      <td colSpan={6} className="pb-3 pr-0">
                        <p role="alert" className={`${pinned} ${errorBox}`}>{failed}</p>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}

/** Add, rename and remove operators. The list is shared, so a name added here
 *  is on the other ERP's register too, on its next read. */
function OperatorManager(props: {
  operators: Operator[]; failed: boolean;
  call: (path: string, init?: RequestInit) => Promise<unknown>;
  setError: (m: string) => void;
  onChanged: (message: string, note: boolean) => void | Promise<void>;
}) {
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState("");

  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    props.setError("");
    try {
      const out = await fn();
      const d = out as { deactivated?: boolean; name?: string };
      if (d?.deactivated) {
        await props.onChanged(`${d.name} has attendance or leave on record, so they have been taken off the roster rather than deleted — their history is kept.`, true);
      } else {
        await props.onChanged(message, false);
      }
    } catch (e) {
      props.setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-5 rounded-xl border border-gray-200 bg-white p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Operators</p>
      <div className="mb-3 flex flex-wrap gap-2">
        <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="New operator's name"
          className={`${inp} sm:max-w-xs`} />
        <button type="button" className={btnPrimary} disabled={busy || !adding.trim()}
          onClick={() => run(async () => {
            const r = await props.call("operators", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: adding }),
            });
            setAdding("");
            return r;
          }, `${adding.trim()} added.`)}>Add</button>
      </div>
      {props.failed && <p className="mb-2 text-xs font-medium text-red-600">The operator list could not be read. Reload the page to try again.</p>}
      <ul className="space-y-1.5">
        {props.operators.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-2 text-sm">
            {renaming === o.id ? (
              <>
                <input value={renameTo} onChange={(e) => setRenameTo(e.target.value)} className={`${inp} sm:max-w-xs`} />
                <button type="button" className={btnPrimary} disabled={busy}
                  onClick={() => run(async () => {
                    const r = await props.call(`operators/${o.id}`, {
                      method: "PATCH", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ name: renameTo }),
                    });
                    setRenaming(null);
                    return r;
                  }, "Name changed.")}>Save</button>
                <button type="button" className={btnGhost} onClick={() => setRenaming(null)}>Cancel</button>
              </>
            ) : (
              <>
                <span className={`flex-1 ${o.isActive ? "text-gray-800" : "text-gray-400"}`}>
                  {o.name}{!o.isActive && " (off the roster)"}
                </span>
                <button type="button" className={btnGhost} onClick={() => { setRenaming(o.id); setRenameTo(o.name); }}>Rename</button>
                {o.isActive ? (
                  <button type="button" className={btnDanger} disabled={busy}
                    onClick={() => {
                      if (!window.confirm(`Remove ${o.name}? Someone with attendance or leave on record is taken off the roster instead, and their history is kept.`)) return;
                      void run(() => props.call(`operators/${o.id}`, { method: "DELETE" }), `${o.name} removed.`);
                    }}>Remove</button>
                ) : (
                  <button type="button" className={btnGhost} disabled={busy}
                    onClick={() => run(() => props.call(`operators/${o.id}`, {
                      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: true }),
                    }), `${o.name} is back on the roster.`)}>Restore</button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── 2. Leave Taken ────────────────────────────────────────────────── */

const emptyLeave = () => ({
  date: todayStr(), operatorId: "", leaveType: "", fromTime: "", toTime: "", reason: "", remarks: "",
});

function LeaveTaken(props: {
  rows: LeaveRow[]; failed: boolean; retry: () => void;
  operators: Operator[]; operatorsFailed: boolean;
  call: (path: string, init?: RequestInit) => Promise<unknown>;
  onChanged: (rows: LeaveRow[], message: string) => void;
}) {
  const [form, setForm] = useState(emptyLeave);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /* This card's own failures, said under its own buttons (as Downloads says
     its own), where the person who pressed Save or Remove is looking. */
  const [error, setError] = useState("");
  const active = props.operators.filter((o) => o.isActive || o.id === form.operatorId);
  const formRef = useRef<HTMLDivElement>(null);
  const firstField = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [error]);

  /* Edit fills the form above the register, which on a phone or a long list
     is out of sight: take the reader to it and put the cursor in it. */
  const edit = (r: LeaveRow) => {
    setEditingId(r.id);
    setForm({ date: r.date, operatorId: r.operatorId, leaveType: r.leaveType, fromTime: r.fromTime, toTime: r.toTime, reason: r.reason, remarks: r.remarks });
    setError("");
    formRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    firstField.current?.focus({ preventScroll: true });
  };

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const next = await props.call(editingId ? `leave/${editingId}` : "leave", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      props.onChanged(next as LeaveRow[], editingId ? "Leave record saved." : "Leave record added.");
      setForm(emptyLeave());
      setEditingId(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: LeaveRow) => {
    if (!window.confirm(`Remove ${r.operatorName}'s leave on ${dmy(r.date)}? It cannot be brought back.`)) return;
    setBusy(true);
    setError("");
    try {
      props.onChanged(await props.call(`leave/${r.id}`, { method: "DELETE" }) as LeaveRow[], "Leave record removed.");
      // The row open in the form is gone: nothing is left there to save.
      if (editingId === r.id) { setEditingId(null); setForm(emptyLeave()); }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <section>
      <Card>
        <SectionHead title="Leave Taken"
          subtitle="The leave an operator took, and whether they told anyone first. Shared with the other line's register." />
        <div ref={formRef} className="mb-5 grid scroll-mt-20 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div>
            <span className={label}>Date</span>
            <input ref={firstField} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={inp} />
          </div>
          <div>
            <span className={label}>Operator Name</span>
            <select value={form.operatorId} onChange={(e) => setForm({ ...form, operatorId: e.target.value })} className={inp}>
              <option value="">Select operator</option>
              {active.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            {props.operatorsFailed && <p className="mt-1 text-xs font-medium text-red-600">The operator list could not be read. Reload the page to try again.</p>}
          </div>
          {/* Immediately after the operator, which is where it reads in the
              table below. Each option wears its own colour, and so does the
              closed box once one is picked: a browser that ignores styling on
              an <option> (Safari does) still shows the choice in its colour,
              and the WORDS say which it is either way. */}
          <div>
            <span className={label}>Leave Type</span>
            <select value={form.leaveType} onChange={(e) => setForm({ ...form, leaveType: e.target.value })}
              className={`${inp} ${form.leaveType ? "font-semibold" : ""}`}
              style={{ color: leaveTypeHue(form.leaveType) }}>
              <option value="" style={{ color: "#374151", fontWeight: 400 }}>Select leave type</option>
              {LEAVE_TYPES.map((t) => (
                <option key={t} value={t} style={{ color: LEAVE_TYPE_HUES[t], fontWeight: 600 }}>
                  {LEAVE_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className={label}>Leave Time</span>
            <div className="flex items-center gap-1.5">
              <TimeInput value={form.fromTime} onChange={(v) => setForm({ ...form, fromTime: v })} className={`${inp} px-2`} />
              <span className="text-sm text-gray-400">to</span>
              <TimeInput value={form.toTime} onChange={(v) => setForm({ ...form, toTime: v })} className={`${inp} px-2`} />
            </div>
            <p className="mt-1 text-xs text-gray-400">Leave both blank for a full day.</p>
          </div>
          <div>
            <span className={label}>Leave Reason</span>
            <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className={inp} />
          </div>
          <div>
            <span className={label}>Remarks</span>
            <input value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} className={inp} />
          </div>
        </div>
        <div className="mb-5">
          <div className="flex gap-2">
            {/* The type is as required as the operator: an absence is either
                excused or it is not, and the server refuses a record that
                cannot say which. */}
            <button type="button" className={btnPrimary} disabled={busy || !form.operatorId || !form.leaveType} onClick={submit}>
              {editingId ? "Save changes" : "Add leave record"}
            </button>
            {editingId && (
              <button type="button" className={btnGhost} onClick={() => { setEditingId(null); setForm(emptyLeave()); setError(""); }}>Cancel</button>
            )}
          </div>
          {error && <p ref={errorRef} role="alert" className={`mt-3 ${errorBox}`}>{error}</p>}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-sm">
            <thead>
              <tr className={thead}>
                {["Date", "S.No.", "Operator Name", "Leave Type", "Leave Time", "Leave Reason", "Remarks", "Action"].map((h, i, a) => (
                  <th key={h} className={`${th} ${i === a.length - 1 ? "pr-0 text-right" : ""}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {props.failed ? (
                <UnreadRow cols={8} message={UNREAD} retry={props.retry} />
              ) : props.rows.length === 0 ? (
                <tr><td colSpan={8} className="py-10 text-center text-gray-400">No leave records yet.</td></tr>
              ) : props.rows.map((r) => (
                <tr key={r.id} className={tr}>
                  <td className={`${td} whitespace-nowrap`}>{dmy(r.date)}</td>
                  <td className={td}>{r.serial}</td>
                  <td className={`${td} font-medium text-gray-900`}>{r.operatorName}</td>
                  {/* In its own colour, and in words — a reader with no colour
                      vision loses nothing. */}
                  <td className={`${td} whitespace-nowrap`}>
                    {r.leaveTypeLabel
                      ? <span className="font-semibold" style={{ color: leaveTypeHue(r.leaveType) }}>{r.leaveTypeLabel}</span>
                      : "-"}
                  </td>
                  <td className={`${td} whitespace-nowrap`}>{r.leaveTime}</td>
                  <td className={td}>{r.reason || "-"}</td>
                  <td className={td}>{r.remarks || "-"}</td>
                  <td className={`${td} pr-0 text-right`}>
                    <div className="flex justify-end gap-2 whitespace-nowrap">
                      <button type="button" className={btnGhost} onClick={() => edit(r)}>Edit</button>
                      <button type="button" className={btnDanger} disabled={busy} onClick={() => void remove(r)}>Remove</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}

/* ── 3. Downloads ──────────────────────────────────────────────────── */

function Downloads({ api, operators, operatorsFailed }: { api: string; operators: Operator[]; operatorsFailed: boolean }) {
  const [type, setType] = useState<RecordType>("ATTENDANCE");
  const [operatorId, setOperatorId] = useState("");
  const [period, setPeriod] = useState<PeriodMode>("DATE");
  const [date, setDate] = useState(todayStr);
  const [from, setFrom] = useState(todayStr);
  const [to, setTo] = useState(todayStr);
  const [month, setMonth] = useState(thisMonth);
  const [result, setResult] = useState<{ columns: string[]; rows: Record<string, string | number>[]; description: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /* The filters, as the query string both the table and the sheet are asked
     for. One function, so the download is exactly the table on screen. */
  const query = useMemo(() => {
    const q = new URLSearchParams({ type, period });
    if (operatorId) q.set("operatorId", operatorId);
    if (period === "DATE") q.set("date", date);
    if (period === "RANGE") { q.set("from", from); q.set("to", to); }
    if (period === "MONTH") q.set("month", month);
    return q.toString();
  }, [type, operatorId, period, date, from, to, month]);

  const show = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${api}/records?${query}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Could not read those records.");
      setResult(await res.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <Card>
        <SectionHead title="Downloads" subtitle="Filter the register, read it here, then take the same rows as a spreadsheet." />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <span className={label}>Record Type</span>
            <select value={type} onChange={(e) => setType(e.target.value as RecordType)} className={inp}>
              {RECORD_TYPES.map((t) => <option key={t} value={t}>{RECORD_TYPE_LABELS[t]}</option>)}
            </select>
          </div>
          <div>
            <span className={label}>Operator Name</span>
            <select value={operatorId} onChange={(e) => setOperatorId(e.target.value)} className={inp}>
              <option value="">All operators</option>
              {operators.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            {operatorsFailed && <p className="mt-1 text-xs font-medium text-red-600">The operator list could not be read; All operators still works.</p>}
          </div>
          <div>
            <span className={label}>Period</span>
            <select value={period} onChange={(e) => setPeriod(e.target.value as PeriodMode)} className={inp}>
              {PERIOD_MODES.map((m) => <option key={m} value={m}>{PERIOD_LABELS[m]}</option>)}
            </select>
          </div>
          {period === "DATE" && (
            <div><span className={label}>Date</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inp} /></div>
          )}
          {period === "MONTH" && (
            <div><span className={label}>Month</span>
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={inp} /></div>
          )}
          {period === "RANGE" && (
            <>
              <div><span className={label}>From</span>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inp} /></div>
              <div><span className={label}>To</span>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inp} /></div>
            </>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" className={btnPrimary} onClick={show} disabled={busy}>
            {busy ? "Reading…" : "Show results"}
          </button>
          <a href={`${api}/export?${query}`} className={`inline-flex items-center ${btnGhost}`}>Download Excel</a>
        </div>
        {error && <p className={`mt-3 ${errorBox}`}>{error}</p>}

        {result && (
          <div className="mt-6">
            <p className="mb-2 text-sm text-gray-500">
              <span className="font-medium text-gray-800">{result.rows.length}</span>
              {result.rows.length === 1 ? " record" : " records"} · {result.description}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-sm">
                <thead>
                  <tr className={thead}>{result.columns.map((c) => <th key={c} className={th}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {result.rows.length === 0 ? (
                    <tr><td colSpan={result.columns.length} className="py-10 text-center text-gray-400">
                      Nothing matches those filters.
                    </td></tr>
                  ) : result.rows.map((r, i) => (
                    <tr key={i} className={tr}>
                      {/* Dates read dd/mm/yyyy on screen, as everywhere in the
                          ERP (dmy); the sheet keeps the sortable yyyy-mm-dd. */}
                      {/* The one column that carries a colour carries it here
                          too — the same green and red as the register above. */}
                      {result.columns.map((c) => (
                        <td key={c}
                          className={`${td} ${c === "Date" ? "whitespace-nowrap" : ""} ${c === "Leave Type" ? "font-semibold" : ""}`}
                          style={c === "Leave Type" ? { color: leaveTypeHue(r[c]) } : undefined}>
                          {c === "Date" ? dmy(String(r[c] ?? "")) : String(r[c] ?? "") || "-"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>
    </section>
  );
}

/** A register's row when its read failed: what went wrong, and a way to ask
 *  again — never the empty-register sentence. */
function UnreadRow({ cols, message, retry }: { cols: number; message: string; retry: () => void }) {
  return (
    <tr>
      <td colSpan={cols} className="py-8">
        <div className={`${pinned} text-center`}>
          <p role="alert" className="text-sm text-red-700">{message}</p>
          <button type="button" className={`mt-3 ${btnGhost}`} onClick={retry}>Try again</button>
        </div>
      </td>
    </tr>
  );
}

/** A register's title, at the head of its card — the page's <h1> is the
 *  module page's own (app/robo/attendance, app/chromia/attendance). */
function SectionHead({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      <p className="mt-0.5 max-w-2xl text-sm text-gray-500">{subtitle}</p>
    </div>
  );
}
