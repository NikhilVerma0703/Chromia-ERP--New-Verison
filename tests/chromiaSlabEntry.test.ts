// Slab Entry — the change of 27 Oct 2026: the QC Report under the entry,
// one Save Entry, Grade A → Stock, Recent Slabs Entry, and the stored S.No.
//
// Source guards, like the other node --test files here: they hold the pieces
// that cannot be checked without a database to the shape the change gave them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { GRADE_ALLOWED_DISPOSITIONS } from "../src/lib/chromia/constants/process-stages.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const ACTION = read("src/lib/chromia/server/actions/operator.ts");
const FORM = read("src/app/chromia/operator/entry-form.tsx");
const PAGE = read("src/app/chromia/operator/page.tsx");
const QC = read("src/app/chromia/slabs/new/qc-section.tsx");
const MIGRATION = read("prisma/migrations/0002_slab_entry_serial_no/migration.sql");
const SCHEMA = read("prisma/schema.prisma");

test("Grade A → Stock, Grade B → Stock or Sample Cutting, Grade C → Recalibration", () => {
  assert.deepEqual(GRADE_ALLOWED_DISPOSITIONS.A, ["STOCK"]);
  assert.deepEqual(GRADE_ALLOWED_DISPOSITIONS.B, ["STOCK", "SAMPLE_CUTTING"]);
  assert.deepEqual(GRADE_ALLOWED_DISPOSITIONS.C, ["RECALIBRATION"]);
});

test("the server sets the outcome of a one-outcome grade, whatever the page sent", () => {
  assert.match(ACTION, /const disposition = allowed\.length === 1 \? allowed\[0\] : chosen;/);
  assert.match(ACTION, /if \(!\(allowed as readonly string\[\]\)\.includes\(parsed\.data\.disposition\)\)/);
});

test("one Save Entry: the QC Report is judged before the entry is written, then saved through the existing one-transaction QC save", () => {
  const save = ACTION.slice(ACTION.indexOf("export async function saveSlabEntryAction("));
  const judged = save.indexOf("intakeQcSchema.safeParse(");
  const entry = save.indexOf("? await updateSlabRecordAction({}, entry)");
  const graded = save.indexOf("await editSlabQcAction({}, qc) : await completeSlabAction({}, qc)");
  assert.ok(judged > 0 && entry > judged && graded > entry, "QC checked, then entry, then QC saved");
  assert.match(save, /await requireActingUser\(\);/);
  // No grade is not an error: the slab is saved In-Processing.
  assert.match(save, /if \(qcMode !== 'none' && grade !== ''\) \{/);
  // The form has one action and one button.
  assert.match(FORM, /useActionState<OperatorFormState, FormData>\(\n\s+saveSlabEntryAction,/);
  assert.equal((FORM.match(/type="submit"/g) ?? []).length, 1);
  assert.doesNotMatch(PAGE, /<QcPanel/, "no second QC form on Slab Entry");
});

test("New Entry → QC Report → Save Entry, with Slab Remarks in the QC Report only", () => {
  const order = ["title={isEditing ? `Entry — slab ${editing.slabNo}` : 'New Entry'}", '<SectionCard title="QC Report" accent="grade">', "'Save Entry'"];
  const at = order.map((s) => FORM.indexOf(s));
  assert.ok(at.every((i, n) => i > 0 && (n === 0 || i > at[n - 1])), "in that order");
  assert.doesNotMatch(FORM, /name="remarks"/, "the entry no longer has its own remarks field");
  // The remark is the grader's own — never filled from the outcome.
  assert.doesNotMatch(QC, /DISPOSITION_LABELS\[value as keyof typeof DISPOSITION_LABELS\]\s*:/);
  assert.match(QC, /name="slabRemarks"/);
});

test("Recent Slabs Entry: no Status, Grade after In-time, QC Outcome, Slab Remarks after it", () => {
  assert.match(PAGE, /title="Recent Slabs Entry"/);
  assert.doesNotMatch(PAGE, /StatusBadge|<th className=\{th\}>Status<\/th>/);
  assert.match(PAGE, /In-time<\/th>\n\s+<th className=\{th\}>Grade<\/th>\n\s+<th className=\{th\}>QC Outcome<\/th>\n\s+<th className=\{th\}>Slab Remarks<\/th>/);
  // Pending QC reads In-Processing, and its slab number is marked.
  assert.match(PAGE, /row\.pendingQc \? \(\n\s+<span className="text-status-hold[^"]*">In-Processing<\/span>/);
  assert.match(PAGE, /hourCycle: 'h23', timeZone: PLANT_TIME_ZONE/);
});

test("S.No. is stored and numbered by the database, one number per date", () => {
  assert.match(SCHEMA, /entrySerialNo\s+Int\?\s+@map\("entry_serial_no"\)/);
  assert.match(SCHEMA, /@@unique\(\[receivedDate, entrySerialNo\]\)/);
  assert.match(MIGRATION, /CREATE UNIQUE INDEX IF NOT EXISTS "chromia_slab_received_date_entry_serial_no_key"/);
  assert.match(MIGRATION, /BEFORE INSERT OR UPDATE OF "received_date" ON "chromia_slab"/);
  assert.match(MIGRATION, /PERFORM pg_advisory_xact_lock\(/);
  // Backfilled in the order the screen used to count, live slabs only.
  assert.match(MIGRATION, /ROW_NUMBER\(\) OVER \(PARTITION BY "received_date" ORDER BY "created_at", "id"\)/);
  assert.match(MIGRATION, /WHERE "deleted_at" IS NULL/);
});
