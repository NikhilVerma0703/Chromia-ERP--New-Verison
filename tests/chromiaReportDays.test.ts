// CHROMIA'S DASHBOARD COUNTS WHAT HAS HAPPENED, AND EVERY CHROMIA REPORT FILES A
// DATE ON THE PLANT'S DAY — the code review of 20 Oct 2026, CHR-3 and CHR-8,
// with the owner's decision of the same day: "today" is the plant's 06:00–06:00
// production day.
//
//   CHR-3  The dashboard counted slabs QC had only decided for dispatch (still
//          in the Dispatch page's queue) as dispatched, took them off "in the
//          plant", and counted today's dispatched from today's decisions; a
//          slab written off after its fifth attempt kept counting as
//          recalibration, on the dashboard and the Recalibration sheet.
//   CHR-8  The Downloads sheets, the Summary and the dashboard's "today" used
//          the server's day (UTC) for instants while the sheet printed the
//          plant's: a C-shift stock entry at 01:30 on 1 Nov sat on October's
//          sheet dated 1 Nov, and was missing from November's.
//
// The rules are pure and run here on instants built in plant time, so the file
// reads the same on any host; the repositories and pages import Prisma, the
// `@/` alias or JSX, so their source is read and held to the shape that makes
// each rule reach the screen.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning --test tests/chromiaReportDays.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  addPlantDays,
  formatPlantDay,
  formatPlantReportDay,
  isPlantDayKey,
  isStoredDay,
  plantDayRange,
  plantInstant,
  plantToday,
  toPlantDateInput,
  toPlantProductionDay,
  toPlantReportDay,
  toPlantTimeInput,
} from "../src/lib/chromia/plant-time.ts";
import {
  exportFileName,
  isWithinRangeDays,
  padRange,
  parseExportQuery,
  parseRangeQuery,
  rangeDays,
  recentMonths,
  resolveRange,
  type ExportQuery,
} from "../src/lib/chromia/exports.ts";
import { buildDailyActivity } from "../src/lib/chromia/production-summary.ts";
import { dayKey, defaultRange, parseRange } from "../src/lib/chromia/reports.ts";
import { buildOutcomeSplit, countFromDay, fromDay, outcomeKeyOf } from "../src/lib/chromia/dashboard-live.ts";
import { buildOverallTiles, inPlantNow } from "../src/lib/chromia/dashboard-totals.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** The review's slab: QC'd to Stock at 01:30 on 1 Nov — C shift of 31 Oct. stockDate = now. */
const STOCKED_AT_0130 = plantInstant(2026, 11, 1, 1, 30);
/** A day typed on the Dispatch page, built at midnight on the UTC server. */
const TYPED_1_NOV = new Date(Date.UTC(2026, 10, 1));
/** The same day built at midnight on a host set to India time. */
const TYPED_1_NOV_IST_HOST = plantInstant(2026, 11, 1);

const q = (over: Partial<ExportQuery>): ExportQuery => ({
  kind: "STOCK",
  preset: "MONTH",
  month: "2026-10",
  from: "",
  to: "",
  ...over,
});

// ── the rule ────────────────────────────────────────────────────────────────

test("CHR-8: the review's 01:30 stock entry is 2026-10-31T20:00Z, and files under 31 Oct", () => {
  assert.equal(STOCKED_AT_0130.toISOString(), "2026-10-31T20:00:00.000Z");
  assert.equal(isStoredDay(STOCKED_AT_0130), false);
  assert.equal(toPlantProductionDay(STOCKED_AT_0130), "2026-10-31");
  assert.equal(toPlantReportDay(STOCKED_AT_0130), "2026-10-31");
});

test("the production day turns at 06:00 plant time, not at midnight and not at 05:30", () => {
  assert.equal(toPlantReportDay(plantInstant(2026, 11, 1, 5, 59, 59)), "2026-10-31");
  assert.equal(toPlantReportDay(plantInstant(2026, 11, 1, 6, 0, 0)), "2026-11-01");
  assert.equal(toPlantReportDay(plantInstant(2026, 11, 1, 23, 59)), "2026-11-01");
  // An instant a millisecond past UTC midnight is 05:30 in the plant — night.
  assert.equal(toPlantReportDay(new Date(Date.UTC(2026, 10, 1, 0, 0, 0, 1))), "2026-10-31");
});

test("a typed or imported day stays the day it names, whichever zone built its midnight", () => {
  assert.equal(isStoredDay(TYPED_1_NOV), true);
  assert.equal(isStoredDay(TYPED_1_NOV_IST_HOST), true);
  assert.equal(toPlantReportDay(TYPED_1_NOV), "2026-11-01");
  assert.equal(toPlantReportDay(TYPED_1_NOV_IST_HOST), "2026-11-01");
  assert.equal(formatPlantReportDay(TYPED_1_NOV), formatPlantDay("2026-11-01"));
  assert.equal(formatPlantReportDay(STOCKED_AT_0130), formatPlantDay("2026-10-31"));
});

test("day keys: strict, and moved by label arithmetic", () => {
  assert.equal(isPlantDayKey("2026-02-28"), true);
  assert.equal(isPlantDayKey("2026-02-31"), false);
  assert.equal(isPlantDayKey("2026-13-01"), false);
  assert.equal(isPlantDayKey("nonsense"), false);
  assert.equal(addPlantDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addPlantDays("2028-02-28", 1), "2028-02-29");
  assert.equal(plantToday(STOCKED_AT_0130), "2026-10-31");
});

test("a plant-day range runs 00:00 to 23:59:59.999 in the plant, and reads back as the days asked for", () => {
  const range = plantDayRange("2026-10-01", "2026-10-31");
  assert.equal(range.from.toISOString(), "2026-09-30T18:30:00.000Z");
  assert.equal(range.to.toISOString(), "2026-10-31T18:29:59.999Z");
  assert.deepEqual(rangeDays(range), { from: "2026-10-01", to: "2026-10-31" });
  assert.equal(toPlantTimeInput(range.from), "00:00");
  assert.equal(toPlantTimeInput(range.to), "23:59");
});

// ── the Downloads sheets ────────────────────────────────────────────────────

test("CHR-8: October's Stock sheet has the 01:30 entry; November's does not", () => {
  const october = resolveRange(q({ month: "2026-10" }));
  const november = resolveRange(q({ month: "2026-11" }));
  assert.equal(isWithinRangeDays(STOCKED_AT_0130, october), true);
  assert.equal(isWithinRangeDays(STOCKED_AT_0130, november), false);
  // And the date printed beside it is the day it was filed under.
  assert.equal(read("src/lib/chromia/server/exports/sheet.ts").includes(
    "export const reportDay = (value: Date | null) => (value ? toPlantReportDay(value) : '');",
  ), true);
});

test("a dispatch dated 1 Nov on the Dispatch page is November's, never October's", () => {
  const october = resolveRange(q({ kind: "DISPATCH", month: "2026-10" }));
  const november = resolveRange(q({ kind: "DISPATCH", month: "2026-11" }));
  for (const typed of [TYPED_1_NOV, TYPED_1_NOV_IST_HOST]) {
    assert.equal(isWithinRangeDays(typed, october), false);
    assert.equal(isWithinRangeDays(typed, november), true);
  }
});

test("the query's padded window still reaches every row the exact filter keeps", () => {
  const october = resolveRange(q({ month: "2026-10" }));
  const { gte, lte } = padRange(october);
  // The last instant of 31 Oct's production day is 05:59:59.999 on 1 Nov.
  assert.ok(plantInstant(2026, 11, 1, 5, 59, 59).getTime() <= lte.getTime());
  // The first stored day of the month, built at plant midnight.
  assert.ok(plantInstant(2026, 10, 1).getTime() >= gte.getTime());
});

test("the presets count from the production day running now", () => {
  const night = STOCKED_AT_0130; // 01:30 on 1 Nov — still 31 Oct
  assert.deepEqual(rangeDays(resolveRange(q({ preset: "TODAY" }), night)), { from: "2026-10-31", to: "2026-10-31" });
  assert.deepEqual(rangeDays(resolveRange(q({ preset: "LAST_WEEK" }), night)), { from: "2026-10-24", to: "2026-10-31" });
  assert.deepEqual(rangeDays(resolveRange(q({ preset: "LAST_MONTH" }), night)), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(rangeDays(resolveRange(q({ preset: "MONTH", month: "2028-02" }), night)), { from: "2028-02-01", to: "2028-02-29" });
  assert.deepEqual(rangeDays(resolveRange(q({ preset: "MONTH", month: "2026-13" }), night)), { from: "2026-10-31", to: "2026-10-31" });
  assert.deepEqual(rangeDays(resolveRange(q({ preset: "CUSTOM", from: "2026-05-31", to: "2026-05-01" }), night)), { from: "2026-05-01", to: "2026-05-31" });
  assert.deepEqual(rangeDays(resolveRange(q({ preset: "CUSTOM", from: "2026-02-31", to: "" }), night)), { from: "2026-10-31", to: "2026-10-31" });
  // Defaults, the month list and the file name read the same days.
  assert.equal(parseExportQuery({}, night).from, "2026-10-31");
  assert.equal(parseExportQuery({}, night).month, "2026-10");
  assert.equal(parseRangeQuery({}, "p", night).to, "2026-10-31");
  assert.equal(recentMonths(2, night).map((m) => m.value).join(), "2026-10,2026-09");
  assert.equal(recentMonths(1, night)[0]?.label, "October 2026");
  assert.equal(exportFileName("STOCK", resolveRange(q({ month: "2026-10" }))), "chromia-stock_2026-10-01_to_2026-10-31.xlsx");
});

// ── the Summary ─────────────────────────────────────────────────────────────

test("CHR-8: the Summary's diary counts one night's work on one row", () => {
  const rows = buildDailyActivity({
    received: [TYPED_1_NOV],
    processingDone: [],
    dispatched: [TYPED_1_NOV],
    // 01:30 and 05:45 on 1 Nov: the same C shift. The server's UTC day split
    // them across 31 Oct and 1 Nov.
    stocked: [STOCKED_AT_0130, plantInstant(2026, 11, 1, 5, 45)],
    sampleCut: [plantInstant(2026, 11, 1, 6, 0)],
    recalibration: [],
  });
  assert.deepEqual(rows.map((row) => row.day), ["2026-11-01", "2026-10-31"]);
  assert.equal(rows[1]?.stocked, 2);
  assert.equal(rows[0]?.received, 1);
  assert.equal(rows[0]?.dispatched, 1);
  assert.equal(rows[0]?.sampleCut, 1);
});

test("CHR-8: the Summary's period is plant days, defaulting to the 30 ending today's production day", () => {
  const range = parseRange("2026-10-01", "2026-10-31", STOCKED_AT_0130);
  assert.deepEqual(rangeDays(range), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(rangeDays(defaultRange(STOCKED_AT_0130)), { from: "2026-10-02", to: "2026-10-31" });
  assert.deepEqual(rangeDays(parseRange("2026-10-31", "2026-10-01", STOCKED_AT_0130)), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(rangeDays(parseRange("rubbish", "", STOCKED_AT_0130)), { from: "2026-10-02", to: "2026-10-31" });
  assert.equal(dayKey(STOCKED_AT_0130), "2026-10-31");
  // The page's date inputs read the range back as plant days, not UTC.
  const page = read("src/app/chromia/reports/page.tsx");
  assert.match(page, /function iso\(date: Date\): string \{\n\s+return toPlantDateInput\(date\);\n\}/);
  assert.doesNotMatch(page, /toISOString\(\)/);
});

// ── the dashboard ───────────────────────────────────────────────────────────

test("CHR-3: twenty slabs in the Dispatch queue are in the plant, not dispatched", () => {
  const groups = [
    { currentDisposition: "DISPATCH" as const, status: "DISPATCHED", n: 5 },
    { currentDisposition: "DISPATCH" as const, status: "GRADED", n: 20 },
    { currentDisposition: "RECALIBRATION" as const, status: "WASTE", n: 2 },
    { currentDisposition: "RECALIBRATION" as const, status: "OUT_FOR_RECALIBRATION", n: 3 },
    { currentDisposition: null, status: "IN_PROCESS", n: 10 },
  ];
  const outcomes: Record<string, number> = {};
  for (const g of groups) {
    const key = outcomeKeyOf(g);
    outcomes[key] = (outcomes[key] ?? 0) + g.n;
  }
  assert.deepEqual(outcomes, { DISPATCH: 5, AWAITING_DISPATCH: 20, WASTE: 2, RECALIBRATION: 3, IN_PROCESSING: 10 });
  // In the plant: 40 received, less 5 actually dispatched and 2 written off.
  assert.equal(inPlantNow({ received: 40, dispatched: outcomes.DISPATCH ?? 0, writtenOff: 2 }), 33);
  const tiles = buildOverallTiles({
    received: 40,
    dispatched: outcomes.DISPATCH ?? 0,
    writtenOff: 2,
    inProcessing: outcomes.IN_PROCESSING ?? 0,
    qcDone: 30,
    stocked: 0,
    sampleCut: 0,
    recalibration: outcomes.RECALIBRATION ?? 0,
  });
  assert.equal(tiles.find((t) => t.key === "dispatched")?.value, 5);
  assert.equal(tiles.find((t) => t.key === "recalibration")?.value, 3);
  // The bar reads the same grouping, so it agrees with the tiles — and shows the queue.
  const split = buildOutcomeSplit(outcomes);
  assert.equal(split.find((s) => s.label === "Dispatched")?.count, 5);
  assert.equal(split.find((s) => s.label === "Awaiting dispatch")?.count, 20);
  assert.equal(split.find((s) => s.label === "Recalibration")?.count, 3);
  assert.equal(split.find((s) => s.label === "Waste")?.count, 2);
});

test("CHR-8: the dashboard's today is the production day, and a typed day counts on itself", () => {
  const today = plantToday(STOCKED_AT_0130); // 31 Oct, at 01:30 on 1 Nov
  assert.equal(today, "2026-10-31");
  assert.equal(countFromDay([STOCKED_AT_0130, plantInstant(2026, 10, 31, 5, 0), new Date(Date.UTC(2026, 9, 31)), null], today), 2);
  assert.deepEqual(fromDay([{ at: plantInstant(2026, 10, 31, 7, 0) }, { at: plantInstant(2026, 10, 30, 23, 0) }], (r) => r.at, today).length, 1);
});

test("CHR-3 / CHR-8: the dashboard reads dispatched-today from dispatch records, and today from the plant's clock", () => {
  const repo = read("src/lib/chromia/server/repositories/dashboard-repository.ts");
  assert.match(repo, /const today = plantToday\(\);\n\s+const since = plantDayStart\(today\);/);
  assert.match(repo, /prisma\.chromiaDispatch\.findMany\(\{\n\s+where: \{ dispatchDate: \{ gte: since \}, slab: \{ deletedAt: null \} \},/);
  assert.match(repo, /dispatched: countFromDay\(dispatchedSince\.map\(\(dispatch\) => dispatch\.dispatchDate\), today\),/);
  assert.match(repo, /const key = outcomeKeyOf\(row\);/);
  assert.doesNotMatch(repo, /dispositionToday\('DISPATCH'\)/);
  assert.doesNotMatch(repo, /getFullYear|setHours|startOfToday/);
});

test("CHR-3: the Recalibration sheet leaves out a slab written off after its last attempt", () => {
  const repo = read("src/lib/chromia/server/repositories/export-repository.ts");
  const recal = repo.slice(repo.indexOf("prisma.chromiaRecalibrationCycle.findMany("));
  assert.match(recal, /currentDisposition: Disposition\.RECALIBRATION,\n\s+status: \{ not: ChromiaSlabStatus\.WASTE \},/);
  assert.match(repo, /const day = \(date: Date \| null\) => \(date \? toPlantReportDay\(date\) : null\);/);
});

test("CHR-8: no server-clock day survives in the Chromia report code", () => {
  for (const path of [
    "src/lib/chromia/exports.ts",
    "src/lib/chromia/reports.ts",
    "src/lib/chromia/production-summary.ts",
    "src/lib/chromia/server/repositories/export-repository.ts",
    "src/lib/chromia/server/repositories/dashboard-repository.ts",
  ]) {
    const src = read(path);
    assert.doesNotMatch(src, /getFullYear\(|getMonth\(|getDate\(|setHours\(|setDate\(/, path);
  }
  // Both routes and the Downloads preview print the filed day.
  for (const path of ["src/app/api/chromia/exports/route.ts", "src/app/api/chromia/exports/production/route.ts"]) {
    const src = read(path);
    assert.doesNotMatch(src, /localDay\(/, path);
    assert.match(src, /reportDay\(row\./, path);
  }
  const downloads = read("src/app/chromia/downloads/page.tsx");
  assert.match(downloads, /render: \(row\) => formatPlantReportDay\(row\.date\),/);
  assert.match(downloads, /render: \(row\) => formatPlantReportDay\(row\.receivedDate\),/);
  // Every report day is a plant calendar day read through one formatter.
  assert.equal(toPlantDateInput(plantDayRange("2026-10-31", "2026-10-31").to), "2026-10-31");
});
