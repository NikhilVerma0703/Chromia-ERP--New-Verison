// The rules behind two of the /batch slab-fix tools, kept apart from the
// server actions so node --test can run them as they are (no imports but the
// import-free slabAddedBy.ts, by relative path; tests/slabFixRules.test.ts).
//
//   1. WHICH ROW "Rectify duplicates (keep latest)" KEEPS.
//   2. WHICH SLABS finished goods must be re-projected for after a /batch tool
//      changed Polish QC rows.
//   3. WHAT A DESIGN FIX OR A BATCH MOVE CARRIES INTO A STOCK ROW — and what
//      it does not.
import { AUTOFILL_PREFIX } from "./slabAddedBy.ts";
//
// ─────────────── 1. "LATEST" IS createdTime ?? importedAt, NOT createdTime ───
//
// rectifyDuplicates (app/batch/slabs/actions.ts) keeps the latest row of each
// slab entered twice at a station and deletes the rest. It decided "latest" on
// created_time alone (created for Polish Entry) — and every row entered in the
// ERP since 8 June 2026 has created_time NULL. That column is the Airtable
// record's creation time; the ERP's own entries carry only imported_at, which
// is why every other reader (autolink, shiftScore, monthlyReport, the polishing
// report, misShift's `created_time IS NULL AND imported_at` key) reads
// createdTime ?? importedAt. So between two ERP rows the comparison was
// NaN — the sort treated them as equal and kept whichever the database happened
// to return first — and between an Airtable row and an ERP row the OLDER
// Airtable row always won, because a timestamp beats a null. The tool named
// "keep latest" deleted the newest QC entry and kept the stale one.
//
// Now: the row's own time is createdTime (created for Polish Entry; Oven has
// only imported_at) when it has one, imported_at when it does not — every row
// has imported_at, the column is NOT NULL. Equal times fall to the id, larger
// first. Prisma's cuid() ids begin with their creation time, so the larger id
// is the later insert in practice; what matters is that the same rows always
// give the same answer instead of whatever order the database read them in.

/** A station row as rectify reads it: its id, slab and the time columns. */
export interface RecencyRow { id: string; slabNumber?: unknown; importedAt?: unknown; [field: string]: unknown }

function ms(v: unknown): number | null {
  if (v instanceof Date) { const t = v.getTime(); return Number.isFinite(t) ? t : null; }
  if (typeof v === "string" || typeof v === "number") { const t = new Date(v).getTime(); return Number.isFinite(t) ? t : null; }
  return null;
}

/** When this row was entered: its own time field (createdTime / created) when
 *  set, else imported_at; -Infinity only when neither reads as a time. */
export function rowRecency(row: RecencyRow, field: string): number {
  return ms(row[field]) ?? ms(row.importedAt) ?? -Infinity;
}

/** Sort comparator, LATEST FIRST: by rowRecency, then by id (larger first). */
export function latestFirst(field: string): (a: RecencyRow, b: RecencyRow) => number {
  return (a, b) => {
    const ta = rowRecency(a, field), tb = rowRecency(b, field);
    if (ta !== tb) return ta < tb ? 1 : -1;
    return a.id === b.id ? 0 : a.id < b.id ? 1 : -1;
  };
}

/** The rows rectify removes: for every slab entered more than once, all but
 *  the latest. Rows with no usable slab number are left alone (blank rows have
 *  their own tool). `slabs` are the slab numbers that lost a row, sorted. */
export function duplicatesToRemove(rows: RecencyRow[], field: string): { ids: string[]; slabs: number[] } {
  const groups = new Map<number, RecencyRow[]>();
  for (const r of rows) {
    const s = r.slabNumber;
    if (typeof s !== "number" || !Number.isFinite(s)) continue;
    (groups.get(s) ?? groups.set(s, []).get(s)!).push(r);
  }
  const ids: string[] = [];
  const slabs: number[] = [];
  const order = latestFirst(field);
  for (const [s, g] of groups) {
    if (g.length < 2) continue;
    g.sort(order);
    for (let i = 1; i < g.length; i++) ids.push(g[i].id);
    slabs.push(s);
  }
  return { ids, slabs: slabs.sort((a, b) => a - b) };
}

// ─────────────── 2. THE SLABS FINISHED GOODS IS RE-PROJECTED FOR ────────────
//
// fg_finished_slab is a projection of polish_qc: one row per slab, refreshed
// by autolinkFinishedSlabFromQc, removed by relinkFinishedSlabAfterNumberChange
// when the last QC row for a slab is gone. The /tables editor and the QC form
// call those on every QC write. The /batch tools did not — Add & verify, Delete,
// Rectify duplicates, the batch design fix and the wrong-batch move all wrote
// polish_qc and left finished goods as it was: a deleted QC row left AVAILABLE
// stock behind, an added one never reached stock, a design or batch correction
// left the old design and batch on the stock row. Add & verify, Delete and
// Rectify now hand the slab numbers they touched to reprojectFinishedSlabs
// (lib/inventory/finishedSlab.ts), which asks this for the list to work
// through; the design fix and the batch move carry only what they corrected
// (section 3).
//
// Whole slab numbers only, each once, in order. An insert slab (144338.1) is
// never projected (autolink logs it and stops, pending the decimal-slab
// decision), and a blank slab number has nothing to project.
//
// NO NEW STOCK, AND NO PLACEHOLDER (the code review of 20 Oct 2026, the first
// two reviews of this fix). Only Add & verify — a real QC row entered by hand,
// the QC form's job done late — may put a slab into finished goods. Every other
// tool corrects what is there: reprojectFinishedSlabs leaves a slab with no
// stock row alone (finished goods projects QC only from the ledger's start, so
// a QC row of a slab sold before then has none, and re-projecting it minted
// AVAILABLE stock for a slab that left long ago), and does not project an "Add
// all missing" or range-confirm placeholder over a stock row: those are
// ungraded stand-ins (lib/slabAddedBy) that by design never reach stock.

/** The distinct whole slab numbers in `values`, ascending. */
export function qcSlabsToReproject(values: Iterable<unknown>): number[] {
  const out = new Set<number>();
  for (const v of values) if (typeof v === "number" && Number.isInteger(v)) out.add(v);
  return [...out].sort((a, b) => a - b);
}

/** The line a /batch tool adds to its message when finished goods could not
 *  be brought up to date for some slabs; "" when every slab went through. The
 *  QC change itself is stored either way — re-projection is best-effort, as
 *  it is on the /tables editor — but the person who made the change is told,
 *  so the stock list is not left wrong with nobody knowing. */
export function reprojectNote(failed: number[]): string {
  if (!failed.length) return "";
  const shown = failed.slice(0, 5).join(", ");
  const more = failed.length > 5 ? ` and ${failed.length - 5} more` : "";
  return ` Finished goods could not be updated for slab ${shown}${more} — open the slab in Tables → Polish QC and save it again.`;
}

/** An "Add all missing" or range-confirm placeholder row (lib/slabAddedBy):
 *  ungraded, no inspector, never a source for finished goods. */
export function isPlaceholderQc(remarks: unknown): boolean {
  return typeof remarks === "string" && remarks.startsWith(AUTOFILL_PREFIX);
}

// ─────────────── 3. A CORRECTION CARRIES ONLY WHAT IT CORRECTED ─────────────
//
// The batch design fix and the wrong-batch move re-projected every QC field of
// every slab they touched (autolink rewrites design, grade, thickness, quality
// issue, polish type, inspector, batch). A grade or thickness the inventory
// team had corrected on the stock row through the slab-intake form — while the
// QC row still read the old value — went back to the QC row's value across the
// whole batch, with nothing but a generic "qc_update" event. So these two now
// write the one thing they changed: the design, or the batch number and key.
//
// And only onto the stock row that IS this QC row's projection: a slab's stock
// row must still read what the QC row read before the change — the old design
// in the same batch, or the old batch key. A stock row projected from another
// batch's QC row of the same slab, or whose design someone has set by hand, is
// not this row's to change. No stock row, nothing written. A placeholder,
// nothing written.

/** A Polish QC row as the design fix and the batch move read it. */
export interface QcCorrectionRow {
  slabNumber?: unknown;
  design?: unknown;
  batchKey?: unknown;
  batchNumber?: unknown;
  remarks?: unknown;
}

/** One guarded write to fg_finished_slab: `where` is what the stock row must
 *  still read (with its slab number), `data` what it then reads, and
 *  field/from/to the audit line. */
export interface StockCarry {
  slabNumber: number;
  where: Record<string, string>;
  data: Record<string, string>;
  field: string;
  from: string;
  to: string;
}

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** What a design change on this QC row (its design as it read BEFORE the
 *  change, now `to`) writes to its stock row; null when it writes nothing —
 *  a placeholder, an insert slab, a blank design or batch, no change. */
export function designCarry(row: QcCorrectionRow, to: unknown): StockCarry | null {
  const sn = row.slabNumber;
  if (typeof sn !== "number" || !Number.isInteger(sn) || isPlaceholderQc(row.remarks)) return null;
  const from = typeof row.design === "string" ? row.design : "";
  const key = text(row.batchKey);
  const next = typeof to === "string" ? to : "";
  if (!from.trim() || !key || !next.trim() || from === next) return null;
  return { slabNumber: sn, where: { design: from, batchKey: key }, data: { design: next }, field: "design", from, to: next };
}

/** What moving this QC row (its batch as it read BEFORE the move) to batch
 *  `toRaw` / `toKey` writes to its stock row; null when it writes nothing. */
export function batchCarry(row: QcCorrectionRow, toRaw: string, toKey: string): StockCarry | null {
  const sn = row.slabNumber;
  if (typeof sn !== "number" || !Number.isInteger(sn) || isPlaceholderQc(row.remarks)) return null;
  const fromKey = text(row.batchKey);
  if (!fromKey || !text(toKey) || !text(toRaw) || fromKey === toKey) return null;
  return {
    slabNumber: sn, where: { batchKey: fromKey }, data: { batchNumber: toRaw, batchKey: toKey },
    field: "batch", from: text(row.batchNumber) || fromKey, to: toRaw,
  };
}
