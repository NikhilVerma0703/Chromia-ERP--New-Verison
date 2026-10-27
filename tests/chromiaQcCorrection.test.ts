// A SLAB THAT HAS LEFT STAYS LEFT — the code review of 20 Oct 2026, CHR-1.
//
// Correcting QC on the Edit path undoes the QC first. It used to refuse only a
// slab in recalibration and then delete every dispatch, stock, sample-cutting
// and waste row the slab had ever had: a slab sent from the Dispatch page on
// 5 Oct, re-saved on 20 Oct with its pre-filled A → Dispatch, lost its real
// dispatch and went back in the queue; a stocked slab dispatched from the
// Stockyard went back on the rack; and an earlier cycle's stock history went
// with the current one. The rule is pure and runs here; the service and the
// Edit screen import Prisma and JSX, so their source is read.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning --test tests/chromiaQcCorrection.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { qcCorrectionRefusal, type QcCorrectionState } from "../src/lib/chromia/qc-correction.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const slab = (over: Partial<QcCorrectionState>): QcCorrectionState => ({
  slabNo: "154321",
  status: "GRADED",
  currentDisposition: "DISPATCH",
  decidedDisposition: "DISPATCH",
  hasDispatch: false,
  ...over,
});

test("the review's slab: graded A → Dispatch, then sent from the Dispatch page — its QC is not redone", () => {
  const sent = slab({ status: "DISPATCHED", hasDispatch: true });
  const refusal = qcCorrectionRefusal(sent);
  assert.equal(refusal?.reason, "DISPATCHED");
  assert.match(refusal?.message ?? "", /^Slab 154321 has already been dispatched — it has left the plant/);
  // A dispatch row alone is enough, whatever the status says; so is the status alone.
  assert.equal(qcCorrectionRefusal(slab({ status: "GRADED", hasDispatch: true }))?.reason, "DISPATCHED");
  assert.equal(qcCorrectionRefusal(slab({ status: "DISPATCHED", hasDispatch: false }))?.reason, "DISPATCHED");
});

test("stocked at QC, then dispatched from the Stockyard: refused the same way", () => {
  const fromRack = slab({ status: "DISPATCHED", currentDisposition: "DISPATCH", decidedDisposition: "STOCK", hasDispatch: true });
  assert.equal(qcCorrectionRefusal(fromRack)?.reason, "DISPATCHED");
});

test("still where its QC put it: queued for dispatch, or on the rack — correctable, as the Edit path was built for", () => {
  assert.equal(qcCorrectionRefusal(slab({})), null, "graded A → Dispatch, still in the queue");
  assert.equal(qcCorrectionRefusal(slab({ status: "IN_STOCK", currentDisposition: "STOCK", decidedDisposition: "STOCK" })), null);
  assert.equal(qcCorrectionRefusal(slab({ status: "IN_PROCESS", currentDisposition: null, decidedDisposition: null })), null, "ungraded: Edit simply grades it");
});

test("cut for samples BY its QC stays correctable; cut after a different QC does not", () => {
  // B → Sample Cutting records the cut at the QC save itself: correcting the
  // decision is correcting the cut.
  assert.equal(qcCorrectionRefusal(slab({ status: "SAMPLE_CUT", currentDisposition: "SAMPLE_CUTTING", decidedDisposition: "SAMPLE_CUTTING" })), null);
  // Stocked at QC, cut from the rack later: a later event, not the QC's.
  const cutLater = qcCorrectionRefusal(slab({ status: "SAMPLE_CUT", currentDisposition: "SAMPLE_CUTTING", decidedDisposition: "STOCK" }));
  assert.equal(cutLater?.reason, "CUT_AFTER_QC");
  assert.equal(qcCorrectionRefusal(slab({ status: "SAMPLE_CUT", currentDisposition: "SAMPLE_CUTTING", decidedDisposition: null }))?.reason, "CUT_AFTER_QC");
});

test("written off: refused — QC never decides waste on this line", () => {
  // The fifth failure's write-off keeps disposition RECALIBRATION; the written-off
  // reason wins over the recalibration one, because there is no trip to correct.
  assert.equal(qcCorrectionRefusal(slab({ status: "WASTE", currentDisposition: "RECALIBRATION", decidedDisposition: "RECALIBRATION" }))?.reason, "WRITTEN_OFF");
  assert.equal(qcCorrectionRefusal(slab({ status: "WASTE", currentDisposition: "WASTE", decidedDisposition: "WASTE" }))?.reason, "WRITTEN_OFF");
});

test("in recalibration: refused with the words it always had, pointing at the Recalibration page", () => {
  for (const s of [
    slab({ status: "GRADED", currentDisposition: "RECALIBRATION", decidedDisposition: "RECALIBRATION" }),
    slab({ status: "OUT_FOR_RECALIBRATION", currentDisposition: "RECALIBRATION" }),
    slab({ status: "RECEIVED_FROM_RECALIBRATION", currentDisposition: "RECALIBRATION" }),
  ]) {
    const refusal = qcCorrectionRefusal(s);
    assert.equal(refusal?.reason, "IN_RECALIBRATION");
    assert.equal(refusal?.message, "Slab 154321 is in a recalibration cycle — correct it on the Recalibration page, not here.");
  }
});

const SERVICE = read("src/lib/chromia/server/services/intake-outcome-service.ts");
const RESET = SERVICE.slice(SERVICE.indexOf("export async function resetSlabQcForCorrection("));

test("the reset asks the rule first, with the dispatch rows and this pass's decision read from the database", () => {
  assert.ok(RESET.length > 0, "resetSlabQcForCorrection");
  assert.match(RESET, /dispatches: \{ select: \{ id: true \}, take: 1 \}/);
  assert.match(RESET, /select: \{ id: true, createdAt: true, disposition: true \}/);
  assert.match(RESET, /const refusal = qcCorrectionRefusal\(\{\n\s+slabNo: slab\.slabNo,\n\s+status: slab\.status,\n\s+currentDisposition: slab\.currentDisposition,\n\s+decidedDisposition: cycle\?\.disposition \?\? null,\n\s+hasDispatch: slab\.dispatches\.length > 0,\n\s+\}\);\n\s+if \(refusal\) throw new BusinessRuleViolationError\(refusal\.message\);/);
  // Refused before anything is deleted.
  assert.ok(RESET.indexOf("qcCorrectionRefusal(") < RESET.indexOf("deleteMany"));
});

test("only this pass's records are cleared, and no dispatch is ever deleted", () => {
  assert.match(RESET, /const thisPass = \{ slabId: slab\.id, createdAt: \{ gte: cycle\.createdAt \} \};/);
  assert.match(RESET, /tx\.chromiaStockEntry\.deleteMany\(\{ where: thisPass \}\)/);
  assert.match(RESET, /tx\.chromiaSampleCutting\.deleteMany\(\{ where: thisPass \}\)/);
  assert.match(RESET, /tx\.chromiaWasteRecord\.deleteMany\(\{ where: thisPass \}\)/);
  assert.doesNotMatch(RESET, /chromiaDispatch\.delete/, "a dispatch is refused, never unwound");
  // No outcome table is cleared by slab id alone any more — that is what took
  // earlier cycles' stock history with it.
  assert.doesNotMatch(RESET, /deleteMany\(\{ where: \{ slabId: slab\.id \} \}\)/);
  // Without a cycle there is no telling this pass from older ones: nothing is cleared.
  assert.match(RESET, /if \(!cycle\) throw new NotFoundError\('Process cycle'\);/);
});

test("the Edit screen asks the same rule, so it never offers a QC section the save would refuse", () => {
  const page = read("src/app/chromia/operator/page.tsx");
  assert.match(page, /import \{ qcCorrectionRefusal \} from '@\/lib\/chromia\/qc-correction';/);
  assert.match(page, /decidedDisposition: selected\.decidedDisposition,\n\s+hasDispatch: selected\.hasDispatch,/);
  assert.match(page, /correctionRefusal\?\.reason === 'IN_RECALIBRATION'\s+\?/);
  // The QC Report is part of the entry form now (27 Oct 2026): a refused
  // correction settles it as 'none' and shows the refusal's own sentence.
  assert.match(page, /: correctionRefusal\n\s+\? \{ mode: 'none', recalibrationReasons, message: correctionRefusal\.message \}/);
  assert.doesNotMatch(page, /const inRecalibration =/, "one rule, not a second copy of part of it");
  const repo = read("src/lib/chromia/server/repositories/slab-record-repository.ts");
  assert.match(repo, /decidedDisposition: cycle\?\.disposition \?\? null,\n\s+hasDispatch: slab\.dispatches\.length > 0,/);
});
