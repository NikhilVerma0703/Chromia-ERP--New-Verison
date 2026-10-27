// A REGISTER IMPORT THAT CAN FINISH, AND A DELETE THAT LEAVES HAND WORK ALONE —
// the code review of 20 Oct 2026, CHR-2 and CHR-7.
//
//   CHR-2  "Delete import" removed every slab the file had brought in, and by
//          the cascade every grade, dispatch, stock entry, cycle and trip
//          recorded on them by hand since — while its dialog said slabs graded
//          by hand were not touched, and named a count a cut-off run left at 0.
//   CHR-7  The import was a row-by-row loop (about ten round trips a row) on a
//          page with no maxDuration. Cut off part-way, it left an import stuck
//          at PROCESSING saying 0 imported, and its slabs never got the
//          finished-goods CHROMIA mark, not even from a re-import.
//
// The rules are pure (lib/chromia/import/undo.ts, outcome.ts) and run here; the
// service, the action and the pages import Prisma, the `@/` alias or JSX, so
// their source is read and held to the shape that makes each rule true.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning --test tests/chromiaImportRuns.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  deleteImportDetail,
  importCreatedNote,
  importGradeNote,
  IMPORT_WRITE_TOLERANCE_MS,
  isAsImported,
  isImportEvent,
  onlyImportEvents,
  untouchedSinceImport,
} from "../src/lib/chromia/import/undo.ts";
import { IMPORT_MAX_SECONDS, wasCutOff } from "../src/lib/chromia/import/outcome.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** One function's text, from its declaration to the next top-level declaration. */
function fn(src: string, name: string): string {
  const m = new RegExp(`\\n(?:export )?async function ${name}\\(`).exec(src);
  assert.ok(m, `${name} not found`);
  const rest = src.slice(m.index + 1);
  const end = rest.slice(1).search(/\n(?:export |async function |function |const |interface |\/\*\*)/);
  return end < 0 ? rest : rest.slice(0, end + 1);
}

const SERVICE = read("src/lib/chromia/server/services/import-service.ts");
const IMPORT_PAGE = read("src/app/chromia/import/page.tsx");
const BUTTON = read("src/app/chromia/import/delete-import-button.tsx");

const at = (iso: string) => new Date(iso);
const created = at("2026-09-02T10:00:00.000Z");
const importEvents = [
  { eventType: "SLAB_CREATED", note: importCreatedNote("PRO SEP.xlsx", 14, "OK STOCK") },
  { eventType: "GRADE_ASSIGNED", note: importGradeNote("A", "STOCK") },
];

// ── CHR-2: which slabs a delete may take ────────────────────────────────────

test("the importer's own notes are the ones it always wrote", () => {
  // The marks and the check come from one place; the text is unchanged, so
  // every import already in the ERP is recognised.
  assert.equal(importCreatedNote("PRO MAY.xlsx", 7, null), "Imported from PRO MAY.xlsx row 7");
  assert.equal(importCreatedNote("PRO MAY.xlsx", 7, "C RECAL"), 'Imported from PRO MAY.xlsx row 7 — "C RECAL"');
  assert.equal(importGradeNote("C", "RECALIBRATION"), "Grade C → RECALIBRATION (from import remark)");
  const svc = fn(SERVICE, "writePreparedRows");
  assert.match(svc, /note: importCreatedNote\(meta\.sourceFile, row\.sourceRow, row\.remark\),/);
  assert.match(svc, /note: importGradeNote\(row\.grade, row\.disposition\),/);
});

test("an event is the import's only when its type and its note both say so", () => {
  for (const e of importEvents) assert.equal(isImportEvent(e), true);
  assert.equal(isImportEvent({ eventType: "GRADE_ASSIGNED", note: "Grade A → DISPATCH" }), false, "graded at QC");
  assert.equal(isImportEvent({ eventType: "SLAB_CREATED", note: "Slab 154321 entered on the register" }), false);
  assert.equal(isImportEvent({ eventType: "DISPATCHED", note: "Dispatched" }), false);
  assert.equal(isImportEvent({ eventType: "SLAB_CREATED", note: null }), false);
  // The same rule as a Prisma filter: every event matches one of the two marks.
  assert.deepEqual(onlyImportEvents(), {
    events: {
      every: {
        OR: [
          { eventType: "SLAB_CREATED", note: { startsWith: "Imported from " } },
          { eventType: "GRADE_ASSIGNED", note: { endsWith: "(from import remark)" } },
        ],
      },
    },
  });
  assert.notEqual(onlyImportEvents(), onlyImportEvents(), "a fresh object each call");
});

test("the review's slabs: graded, dispatched or restarted by hand are kept; untouched ones go", () => {
  const untouched = { createdAt: created, updatedAt: created, events: importEvents };
  assert.equal(isAsImported(untouched), true);
  // A row written in a slow transaction still reads as the import's own write.
  assert.equal(untouchedSinceImport({ createdAt: created, updatedAt: new Date(created.getTime() + IMPORT_WRITE_TOLERANCE_MS) }), true);

  // Graded on Operator Entry three weeks later: saved, and an event of its own.
  const graded = {
    createdAt: created,
    updatedAt: at("2026-09-23T09:12:00.000Z"),
    events: [...importEvents, { eventType: "GRADE_ASSIGNED", note: "Grade A → DISPATCH" }],
  };
  assert.equal(isAsImported(graded), false);
  // Either signal alone keeps it: a saved row (a trip date re-saved writes no event)…
  assert.equal(isAsImported({ ...untouched, updatedAt: at("2026-09-23T09:12:00.000Z") }), false);
  // …or an event the import did not write.
  assert.equal(isAsImported({ ...untouched, events: [...importEvents, { eventType: "DISPATCHED", note: "Dispatched" }] }), false);
});

test("deleteImportBatch removes only the slabs as the import left them, guarded against a save after the read", () => {
  const del = fn(SERVICE, "deleteImportBatch");
  const tx = del.slice(del.indexOf("await prisma.$transaction(async (tx) => {"));
  assert.match(tx, /const readAt = new Date\(\);/);
  assert.match(tx, /where: \{ importBatchId, \.\.\.onlyImportEvents\(\) \},\n\s+select: \{ id: true, batchId: true, slabNo: true, createdAt: true, updatedAt: true \},/);
  assert.match(tx, /const removable = candidates\.filter\(untouchedSinceImport\);/);
  assert.match(tx, /await tx\.chromiaSlab\.deleteMany\(\{\n\s+where: \{\n\s+id: \{ in: removable\.slice\(at, at \+ 500\)\.map\(\(slab\) => slab\.id\) \},\n\s+importBatchId,\n\s+updatedAt: \{ lt: readAt \},\n\s+\.\.\.onlyImportEvents\(\),/);
  // Never the old blanket delete.
  assert.doesNotMatch(del, /deleteMany\(\{ where: \{ importBatchId \} \}\)/);
  // The production batches lose exactly what went; the audit names what stayed.
  assert.match(tx, /const gone = removable\.filter\(\(slab\) => !stillThere\.has\(slab\.id\)\);/);
  assert.match(tx, /for \(const slab of gone\) perBatch\.set/);
  assert.match(tx, /keptSlabs: remaining\.length,/);
  assert.match(tx, /keptSlabNos: remaining\.slice\(0, 50\)\.map\(\(slab\) => slab\.slabNo\),/);
  // Only the slabs that went lose their finished-goods mark.
  assert.match(del, /await unmarkSlabsChromia\(removed\.map\(\(s\) => s\.slabNo\), null\);/);
  assert.match(del, /return \{ deleted: removed\.length, kept, sourceFile: batch\.sourceFile \};/);
});

test("the Delete dialog tells the truth, from the real figures", () => {
  const all = deleteImportDetail("PRO SEP.xlsx", 186, 186);
  assert.match(all, /^PRO SEP\.xlsx and the 186 slabs it imported will be removed permanently/);
  const some = deleteImportDetail("PRO SEP.xlsx", 186, 150);
  assert.match(some, /^150 of the 186 slabs PRO SEP\.xlsx imported will be removed permanently/);
  assert.match(some, /The other 36 have been graded, dispatched, corrected or otherwise worked on by hand since the import\. They are kept, with all their history/);
  const one = deleteImportDetail("PRO SEP.xlsx", 186, 185);
  assert.match(one, /The other 1 has been graded.*It is kept, with all its history, and stays in Slab Records\./);
  assert.match(deleteImportDetail("PRO SEP.xlsx", 12, 0), /^Every one of the 12 slabs PRO SEP\.xlsx imported has been graded.*so none will be removed/);
  assert.match(deleteImportDetail("PRO SEP.xlsx", 0, 0), /Only the record of the import will be removed/);
  for (const text of [all, some, one]) assert.match(text, /This cannot be undone\.$/);
  // The old promise is gone from the button, and so is the import's own counter.
  assert.doesNotMatch(BUTTON, /not touched/);
  assert.match(BUTTON, /detail=\{deleteImportDetail\(fileName, slabCount, removableCount\)\}/);
  assert.doesNotMatch(IMPORT_PAGE, /slabCount=\{run\.importedRows\}/);
  assert.match(IMPORT_PAGE, /canManage \? importDeleteCounts\(history\.map\(\(run\) => run\.id\)\) : Promise\.resolve\(null\),/);
  assert.match(IMPORT_PAGE, /slabCount=\{deleteCounts\?\.get\(run\.id\)\?\.slabs \?\? 0\}/);
  assert.match(IMPORT_PAGE, /removableCount=\{deleteCounts\?\.get\(run\.id\)\?\.removable \?\? 0\}/);
  // The page's counts use the delete's own rule.
  const counts = fn(SERVICE, "importDeleteCounts");
  assert.match(counts, /\.\.\.onlyImportEvents\(\) \},/);
  assert.match(counts, /if \(entry && untouchedSinceImport\(slab\)\) entry\.removable \+= 1;/);
});

// ── CHR-7: an import that can finish ────────────────────────────────────────

test("one read finds every slab number already in the ERP — no findUnique per row", () => {
  const run = fn(SERVICE, "importProRegister");
  assert.doesNotMatch(run, /chromiaSlab\.findUnique/);
  assert.match(run, /const existing = await prisma\.chromiaSlab\.findMany\(\{\n\s+where: \{ slabNo: \{ in: \[\.\.\.new Set\(parseResult\.rows\.map\(\(row\) => row\.slabNo\)\)\] \} \},/);
  assert.match(run, /if \(inErp\.has\(row\.slabNo\)\) \{\n\s+alreadyExists\(row\);\n\s+continue;/);
});

test("a number the sheet repeats: left alone when its first row landed, written when that row failed", () => {
  // The row-by-row importer reached a repeat with the first row already there
  // and skipped it — or, when the first row had failed, with nothing there,
  // and wrote it. Calling that repeat "already exists" would hide a slab the
  // ERP does not have.
  const run = fn(SERVICE, "importProRegister");
  assert.match(run, /if \(queued\.has\(row\.slabNo\)\) \{\n\s+repeats\.push\(row\);\n\s+continue;/);
  const after = run.slice(run.indexOf("for (const row of repeats) {"));
  assert.ok(after.length > 0 && run.indexOf("for (const row of repeats) {") > run.indexOf("for (let at = 0; at < toWrite.length; at += IMPORT_CHUNK_ROWS) {"), "after the chunks");
  assert.match(after, /if \(written\.has\(row\.slabNo\)\) \{\n\s+alreadyExists\(row\);\n\s+continue;\n\s+\}\n\s+const \[landed\] = await writeRows\(\[row\]\);\n\s+if \(!landed\) continue;\n\s+written\.add\(row\.slabNo\);\n\s+imported \+= 1;\n\s+if \(AT_CHROMIA\.has\(landed\.status\)\) await markSlabsChromia\(\[row\.slabNo\], null\);/);
  // Every chunk records what landed, so the repeat knows.
  assert.match(run, /const landed = await writeRows\(toWrite\.slice\(at, at \+ IMPORT_CHUNK_ROWS\)\);\n\s+for \(const p of landed\) written\.add\(p\.row\.slabNo\);/);
  // The notes come back in the sheet's order, after what the parser could not read.
  assert.match(run, /notes\.push\(\.\.\.notes\.splice\(unreadable\)\.sort\(\(a, b\) => a\.sourceRow - b\.sourceRow\)\);/);
});

test("rows go a hundred to a transaction; a chunk that fails is written again a row at a time", () => {
  assert.match(SERVICE, /const IMPORT_CHUNK_ROWS = 100;/);
  assert.match(SERVICE, /const IMPORT_CHUNK_TX = \{ maxWait: 10_000, timeout: 30_000 \} as const;/);
  const run = fn(SERVICE, "importProRegister");
  assert.match(run, /await prisma\.\$transaction\(\(tx\) => writePreparedRows\(tx, prepared, context\), IMPORT_CHUNK_TX\);/);
  assert.match(run, /for \(const one of prepared\) \{\n\s+try \{\n\s+await prisma\.\$transaction\(\(tx\) => writePreparedRows\(tx, \[one\], context\)\);\n\s+landed\.push\(one\);\n\s+\} catch \(error\) \{\n\s+fail\(one\.row, error\);/);
  // One createMany per table, not a create per record.
  const write = fn(SERVICE, "writePreparedRows");
  for (const table of ["chromiaSlab", "chromiaProcessCycle", "chromiaSlabEvent", "chromiaGradeDecision", "chromiaRecalibrationCycle", "chromiaDispatch", "chromiaStockEntry", "chromiaSampleCutting"]) {
    assert.match(write, new RegExp(`tx\\.${table}\\.createMany\\(`), table);
    assert.doesNotMatch(write, new RegExp(`tx\\.${table}\\.create\\(`), table);
  }
  assert.match(write, /tx\.chromiaBatch\.createMany\(\{[\s\S]*?skipDuplicates: true,/);
});

test("after every chunk: the counters are saved and the chunk's slabs at Chromia are marked", () => {
  const run = fn(SERVICE, "importProRegister");
  const loop = run.slice(run.indexOf("for (let at = 0; at < toWrite.length; at += IMPORT_CHUNK_ROWS) {"));
  const progress = loop.indexOf("await prisma.chromiaImportBatch.update({");
  const mark = loop.indexOf("if (atChromia.length > 0) await markSlabsChromia(atChromia, null);");
  const close = loop.indexOf("const counts = { imported, alreadyPresent, blankRows, unreadable, failed };");
  assert.ok(progress > 0 && mark > progress && close > mark, "both inside the loop, before the run is closed");
  assert.match(loop.slice(progress, mark), /importedRows: imported,\n\s+skippedRows: alreadyPresent \+ blankRows,\n\s+failedRows: failed,/);
  // The old single mark after the loop is gone.
  assert.doesNotMatch(run, /await markSlabsChromia\(atChromia, null\);\n\n\s+log\.info/);
});

test("a re-import marks the slabs a cut-off run left at Chromia — and nobody else's", () => {
  const run = fn(SERVICE, "importProRegister");
  assert.match(run, /importBatch: \{ select: \{ completedAt: true \} \},/);
  assert.match(run, /slab\.deletedAt === null &&\n\s+slab\.importBatch !== null &&\n\s+slab\.importBatch\.completedAt === null &&\n\s+AT_CHROMIA\.has\(slab\.status\),/);
  assert.match(run, /await markSlabsChromia\(unmarked, null\);/);
});

test("the import page states its deadline, the one IMPORT_MAX_SECONDS names", () => {
  const m = /\nexport const maxDuration = (\d+);\n/.exec(IMPORT_PAGE);
  assert.ok(m, "maxDuration on the import page");
  assert.equal(Number(m[1]), IMPORT_MAX_SECONDS);
});

test("a run still PROCESSING well past that deadline shows as stopped part-way", () => {
  const startedAt = at("2026-10-20T09:00:00.000Z");
  const run = { status: "PROCESSING", startedAt, createdAt: startedAt };
  assert.equal(wasCutOff(run, new Date(startedAt.getTime() + 60_000)), false, "still running");
  assert.equal(wasCutOff(run, new Date(startedAt.getTime() + (IMPORT_MAX_SECONDS + 61) * 1000)), true);
  assert.equal(wasCutOff({ ...run, status: "COMPLETED" }, new Date(startedAt.getTime() + 86_400_000)), false);
  assert.equal(wasCutOff({ ...run, startedAt: null }, new Date(startedAt.getTime() + 86_400_000)), true, "falls back to createdAt");
  assert.match(IMPORT_PAGE, /\{wasCutOff\(run, now\) \? \(/);
  assert.match(IMPORT_PAGE, /stopped part-way/);
});
