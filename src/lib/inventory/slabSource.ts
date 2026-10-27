// WHERE A FINISHED-GOODS SLAB CAME FROM, AS THE SCREENS SHOW AND FILTER IT.
//
// Owner, 26 Oct 2026: slab 129939 came in with the bulk upload of 3 Jul, was
// corrected on the slab intake form on 15 and 26 Oct, and still read "Bulk
// upload" — "make it entered or corrected by hand and dump both categories into
// this (do not show them in bulk upload)".
//
// The stored `source` column is NOT changed: it keeps where the row first came
// from, and two rules read it as that — the intake form's photo rule
// (MANUAL_ENTRY = both defect photos owed) and the production-request
// suggestions (QC_AUTOLINK = a real QC pass). Only what the screens call a slab
// changes: a bulk-upload or QC slab corrected by hand is shown and filtered
// under "Entered or corrected by hand", never under "Bulk upload" or "From QC"
// (owner, 26 Oct 2026, for the QC slabs: "Yes please").
// "Corrected by hand" = a field of it was changed by a person: one of the two
// HAND_CORRECTIONS events (the intake form's correction, or the Edit button in
// the Finished Goods slab panel). A save on the form that changed nothing but
// carried a design/batch approval, or only added a photo, is not a correction.
//
// PURE: no imports, so node --test loads it bare (tests/fgSourceByHand.test.ts).

/** The SlabEvent.source the intake form writes on every change it saves
 *  (slab-intake/actions.ts imports it, so the two cannot drift apart). */
export const HAND_EDIT_SOURCE = "Slab intake form";
/** The SlabEvent.source of the Finished Goods panel's Edit button
 *  (api/inventory/slab/edit imports it). */
export const ADMIN_EDIT_SOURCE = "Admin edit";

/** The SlabEvents that are a person correcting a field of the slab, as
 *  (kind, source) pairs — a Prisma `OR` over SlabEvent as it stands. */
export const HAND_CORRECTIONS: ReadonlyArray<{ kind: string; source: string }> = [
  { kind: "manual_correction", source: HAND_EDIT_SOURCE },
  { kind: "edit", source: ADMIN_EDIT_SOURCE },
];

/** The source filter's options: the SlabSource enum values, in plant words. */
export const SOURCE_FILTERS: ReadonlyArray<readonly [string, string]> = [
  ["QC_AUTOLINK", "From QC"],
  ["BULK_UPLOAD", "Bulk upload"],
  ["MANUAL_ENTRY", "Entered or corrected by hand"],
];

/** The stored sources a hand correction moves under "Entered or corrected by hand". */
const MOVED_BY_HAND = ["BULK_UPLOAD", "QC_AUTOLINK"];

/** Which filter option a slab falls under. */
export function shownSource(stored: string | null | undefined, handCorrected: boolean): string | null {
  if (handCorrected && MOVED_BY_HAND.includes(stored ?? "")) return "MANUAL_ENTRY";
  return stored ?? null;
}

/** One slab's source in words, for its detail panel and the intake form. */
export function sourceWords(stored: string | null | undefined, handCorrected: boolean): string | null {
  if (stored === "BULK_UPLOAD") return handCorrected ? "Corrected by hand (first came in by bulk upload)" : "Bulk upload";
  if (stored === "MANUAL_ENTRY") return "Entered by hand";
  if (stored === "QC_AUTOLINK") return handCorrected ? "Corrected by hand (first came in from QC)" : "From QC";
  return stored ?? null;
}

/** The slab list's source filter as a Prisma clause, or null for no filter. A
 *  value off the list is no filter, as before: `source` is an enum column, and
 *  Prisma answers an unknown value with an error, not an empty list. */
export function sourceFilterWhere(v: string): Record<string, unknown> | null {
  const byHand = { OR: HAND_CORRECTIONS.map((c) => ({ ...c })) };
  if (v === "MANUAL_ENTRY") return { OR: [{ source: "MANUAL_ENTRY" }, { source: { in: MOVED_BY_HAND }, events: { some: byHand } }] };
  if (v === "BULK_UPLOAD" || v === "QC_AUTOLINK") return { source: v, events: { none: byHand } };
  return null;
}

/** The same rule for the stock register's raw SQL over fg_finished_slab, or
 *  null for a value off the list (the register refuses those before this).
 *  `ph` binds a value and returns its placeholder; ::text because `source` is a
 *  Postgres enum and a bound text parameter will not compare with it. */
export function sourceFilterSql(v: string, ph: (value: unknown) => string): string | null {
  const byHand = () =>
    `EXISTS (SELECT 1 FROM fg_slab_event e WHERE e.slab_number = fg_finished_slab.slab_number AND (${
      HAND_CORRECTIONS.map((c) => `(e.kind = ${ph(c.kind)} AND e.source = ${ph(c.source)})`).join(" OR ")}))`;
  if (v === "MANUAL_ENTRY") return `(source::text = 'MANUAL_ENTRY' OR (source::text IN ('BULK_UPLOAD', 'QC_AUTOLINK') AND ${byHand()}))`;
  if (v === "BULK_UPLOAD" || v === "QC_AUTOLINK") return `(source::text = '${v}' AND NOT ${byHand()})`;
  return null;
}
