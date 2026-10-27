// CHROMIA'S LISTS LOAD A PAGE, NOT THEIR WHOLE HISTORY — the code review of
// 20 Oct 2026, CHR-10.
//
// Slab Records dropped paging for ANY filter: Grade A, or Status Dispatched,
// loaded every matching slab ever recorded in one render, each row with its own
// dialog. The Recalibration and Recalibration Tracking pages loaded every slab
// that has ever had a trip, with all its trips. All three grow by thousands of
// rows a year on pages rendered fresh on every visit.
//
// The limits are pure (lib/chromia/list-limits.ts) and run here; the pages and
// repositories import Prisma, JSX or the `@/` alias, so their source is read.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning --test tests/chromiaListLimits.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  isWholeRangeFilter,
  pageWindow,
  parsePage,
  RECALIBRATION_PAGE_SIZE,
  WHOLE_RANGE_MAX_DAYS,
  WHOLE_RANGE_ROW_CAP,
} from "../src/lib/chromia/list-limits.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

// The Slab Records filter parses a date input with `new Date("yyyy-mm-dd")`.
const d = (iso: string) => new Date(iso);
const none = { receivedFrom: null, receivedTo: null, receivedOn: null };

// ── Slab Records ────────────────────────────────────────────────────────────

test("a month or less of production dates is shown whole — the in-charge's February", () => {
  assert.equal(WHOLE_RANGE_MAX_DAYS, 31);
  assert.equal(isWholeRangeFilter({ ...none, receivedFrom: d("2026-02-01"), receivedTo: d("2026-02-28") }), true);
  assert.equal(isWholeRangeFilter({ ...none, receivedFrom: d("2026-01-01"), receivedTo: d("2026-01-31") }), true);
  assert.equal(isWholeRangeFilter({ ...none, receivedOn: d("2026-10-20") }), true);
  assert.equal(isWholeRangeFilter({ ...none, receivedFrom: d("2026-10-20"), receivedTo: d("2026-10-20") }), true);
});

test("a grade, a status, an open-ended or a longer date range pages", () => {
  assert.equal(isWholeRangeFilter(none), false, "Grade A alone: no dates at all");
  assert.equal(isWholeRangeFilter({ ...none, receivedFrom: d("2026-01-01") }), false, "From with no To");
  assert.equal(isWholeRangeFilter({ ...none, receivedTo: d("2026-10-20") }), false, "To with no From");
  assert.equal(isWholeRangeFilter({ ...none, receivedFrom: d("2026-01-01"), receivedTo: d("2026-02-01") }), false, "32 days");
  assert.equal(isWholeRangeFilter({ ...none, receivedFrom: d("2026-02-10"), receivedTo: d("2026-02-01") }), false, "backwards");
});

test("Slab Records asks for the whole window only by that rule, and even then with a ceiling", () => {
  const page = read("src/app/chromia/slabs/page.tsx");
  assert.match(page, /const wholeRange = isWholeRangeFilter\(filters\);/);
  assert.match(page, /searchSlabs\(filters, \{ wholeRange \}\),/);
  assert.doesNotMatch(page, /unpaged/);
  assert.match(page, /const pages = wholeRange \? 1 : pageCount\(total, filters\.pageSize\);/);
  assert.match(page, /const capped = wholeRange && rows\.length < total;/);
  assert.match(page, /Narrow the production dates to see the/);
  const repo = read("src/lib/chromia/server/repositories/slab-repository.ts");
  assert.match(repo, /const pageArgs: \{ skip\?: number; take: number \} = options\.wholeRange\n\s+\? \{ take: WHOLE_RANGE_ROW_CAP \}\n\s+: \{ skip: \(filters\.page - 1\) \* filters\.pageSize, take: filters\.pageSize \};/);
  assert.ok(WHOLE_RANGE_ROW_CAP >= 500, "far above a month of this line");
});

// ── Recalibration and Recalibration Tracking ───────────────────────────────

test("pages: a hundred rows, held inside the pages there are", () => {
  assert.equal(RECALIBRATION_PAGE_SIZE, 100);
  assert.deepEqual(pageWindow(250, 1, 100), { page: 1, pages: 3, skip: 0, take: 100, from: 1, to: 100 });
  assert.deepEqual(pageWindow(250, 3, 100), { page: 3, pages: 3, skip: 200, take: 100, from: 201, to: 250 });
  assert.deepEqual(pageWindow(250, 9, 100).page, 3, "past the end lands on the last page");
  assert.deepEqual(pageWindow(0, 4, 100), { page: 1, pages: 1, skip: 0, take: 100, from: 0, to: 0 });
  assert.equal(parsePage("2"), 2);
  assert.equal(parsePage(["3", "1"]), 3);
  for (const bad of [undefined, "", "0", "-1", "abc"]) assert.equal(parsePage(bad), 1, String(bad));
});

test("every match's STATE is read thin, and the full rows only for the page shown", () => {
  const repo = read("src/lib/chromia/server/repositories/recalibration-flow-repository.ts");
  const states = repo.slice(repo.indexOf("export async function searchRecalibrationStates("), repo.indexOf("export async function searchRecalibrationPage("));
  assert.match(states, /select: \{\n\s+id: true,\n\s+currentDisposition: true,\n\s+status: true,\n\s+recalibrations: \{/);
  assert.doesNotMatch(states, /SLAB_FIELDS/);
  const page = repo.slice(repo.indexOf("export async function searchRecalibrationPage("), repo.indexOf("export async function findRecalibrationRecord("));
  assert.match(page, /const cut = pageWindow\(states\.length, options\.page, options\.pageSize\);/);
  assert.match(page, /await prisma\.chromiaSlab\.findMany\(\{ where: \{ id: \{ in: ids \} \}, select: SLAB_FIELDS \}\);/);
  // The unbounded search is gone, and nothing calls it.
  assert.doesNotMatch(repo, /searchRecalibrationRecords/);
  // STANDALONE: the ERP list also held its main dashboard's Chromia card
  // (src/lib/dashboard/server/loaders/modules.ts) to this; that card is the
  // ERP's, not the module's, and did not come across.
  for (const path of ["src/app/chromia/recalibrations/page.tsx", "src/app/chromia/recalibration-tracking/page.tsx"]) {
    assert.doesNotMatch(read(path), /searchRecalibrationRecords/, path);
  }
});

test("the Recalibration page shows a page, and counts its KPIs over every slab on the board", () => {
  // Rebuilt 27 Oct 2026 (Dashboard · Find a Slab · Recalibration Records):
  // still a page at a time, the KPIs still over every match, not the page.
  const page = read("src/app/chromia/recalibrations/page.tsx");
  assert.match(page, /loadRecalibrationBoard\(filters, \{ page: parsePage\(params\.page\), pageSize: RECALIBRATION_PAGE_SIZE \}\)/);
  assert.match(page, /<PageNav page=\{board\.page\} pages=\{board\.pages\} href=\{pageHref\} \/>/);
  const repo = read("src/lib/chromia/server/repositories/recalibration-flow-repository.ts");
  const board = repo.slice(repo.indexOf("export async function loadRecalibrationBoard("));
  assert.match(board, /const kpis = boardKpis\(everything\);/);
  assert.match(board, /const cut = pageWindow\(all\.length, options\.page, options\.pageSize\);/);
  // Only the page shown is read in full.
  assert.match(board, /where: \{ id: \{ in: ids \} \}, select: SLAB_FIELDS/);
});

test("Recalibration Tracking: the attempt filter and the figures cover every match, the table a page", () => {
  const page = read("src/app/chromia/recalibration-tracking/page.tsx");
  assert.match(page, /keep: filters\.attempt === null \? undefined : \(state\) => attemptOf\(state\) === filters\.attempt,/);
  assert.match(page, /const kpis = buildTrackingKpis\(result\.states\);/);
  assert.match(page, /const rows = result\.records\.map\(\(record\) => \(\{/);
  assert.match(page, /return `\$\{APP_ROUTES\.recalibrationTracking\}\?\$\{query \? `\$\{query\}&` : ''\}page=\$\{page\}`;/);
  // STANDALONE: the ERP test went on to check its main dashboard's Chromia
  // card (src/lib/dashboard/server/loaders/modules.ts) reads the same states.
  // That card is the ERP's and did not come across.
});
