// CHROMIA'S WRITES: ONE COMMIT PER QC SAVE, ONE DEVICE PER SLAB, AND THE
// FINISHED-GOODS MARK ON THE RIGHT NUMBER — the code review of 20 Oct 2026,
// CHR-5, CHR-6 and CHR-9.
//
//   CHR-5  The QC save was three or four services each committing on its own;
//          a failure after the grade left a Grade C slab no screen could
//          recover. Now one transaction, threaded through every service as an
//          optional `inTx`, and saveTrip repairs a slab already left that way.
//   CHR-6  Dispatch, stock, sample cutting and waste were read-check-insert;
//          two devices pressing Send on one slab dispatched it twice. Now the
//          slab's own row is claimed first, guarded by the state it was read in.
//   CHR-9  Restarting production with a corrected slab number left the CHROMIA
//          mark on the old number in finished goods.
//
// The services import Prisma through the `@/` alias, which node --test does not
// resolve, so their source is read and held to the shape that makes each true.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning --test tests/chromiaServiceWrites.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** One function's text, from its declaration to the next top-level declaration or section rule. */
function fn(src: string, name: string): string {
  const m = new RegExp(`\\n(?:export )?async function ${name}\\(`).exec(src);
  assert.ok(m, `${name} not found`);
  const rest = src.slice(m.index + 1);
  const end = rest.slice(1).search(/\n(?:export |async function |function |\/\/ -{3,})/);
  return end < 0 ? rest : rest.slice(0, end + 1);
}

const SERVICES = "src/lib/chromia/server/services/";
const DB = read("src/lib/chromia/db.ts");
const SLAB_ACTIONS = read("src/lib/chromia/server/actions/slab.ts");
const INTAKE = read(`${SERVICES}slab-intake-service.ts`);
const OUTCOME = read(`${SERVICES}intake-outcome-service.ts`);
const DISPOSITION = read(`${SERVICES}disposition-service.ts`);
const RECAL = read(`${SERVICES}recalibration-flow-service.ts`);
const STOCKYARD = read(`${SERVICES}stockyard-service.ts`);

// ── CHR-5 ───────────────────────────────────────────────────────────────────

test("CHR-5: withTransaction joins the caller's transaction, or opens one of its own", () => {
  assert.match(DB, /export type ChromiaTx = Prisma\.TransactionClient;/);
  assert.match(DB, /export function withTransaction<T>\(\n\s+tx: ChromiaTx \| undefined,\n\s+work: \(tx: ChromiaTx\) => Promise<T>,\n\): Promise<T> \{\n\s+return tx \? work\(tx\) : prisma\.\$transaction\(work\);\n\}/);
});

test("CHR-5: the QC save runs every step inside one transaction, handing it to each", () => {
  const save = fn(SLAB_ACTIONS, "saveQc");
  const at = save.indexOf("await prisma.$transaction(async (tx) => {");
  assert.ok(at > 0, "one transaction");
  const block = save.slice(at, save.indexOf("}, QC_SAVE_TX);", at));
  assert.match(block, /const slabId = await persist\(user\.id, tx\);/);
  assert.match(block, /await applyIntakeGrade\(slabId, qc, user\.id, tx\);/);
  assert.match(block, /await applyDisposition\(slabId, qc, user\.id, tx\);/);
  assert.match(block, /await markAwaitingRecalibration\(slabId, reasonId, user\.id, tx\);/);
  // The reason name becomes a record before, outside — master data.
  assert.ok(save.indexOf("resolveRecalibrationReasonId(") < at);
  assert.match(SLAB_ACTIONS, /const QC_SAVE_TX = \{ maxWait: 10_000, timeout: 20_000 \} as const;/);
  // Both ways in pass the transaction to their first step.
  assert.match(fn(SLAB_ACTIONS, "completeSlabAction"), /completeSlabIntake\(slabId, userId, tx\)/);
  assert.match(fn(SLAB_ACTIONS, "editSlabQcAction"), /await resetSlabQcForCorrection\(slabId, userId, tx\);/);
  // Every outcome the QC records writes through it.
  const apply = fn(SLAB_ACTIONS, "applyDisposition");
  assert.equal((apply.match(/\n\s+userId,\n\s+tx,\n\s+\);/g) ?? []).length, 3, "stock, sample cutting and waste");
});

test("CHR-5: each service the save calls reads through the transaction and writes inside it — none commits alone", () => {
  const steps: Array<[string, string]> = [
    [INTAKE, "completeSlabIntake"],
    [OUTCOME, "applyIntakeGrade"],
    [OUTCOME, "resetSlabQcForCorrection"],
    [DISPOSITION, "recordStock"],
    [DISPOSITION, "recordSampleCutting"],
    [DISPOSITION, "declareWaste"],
    [RECAL, "markAwaitingRecalibration"],
    [RECAL, "writeOff"],
  ];
  for (const [src, name] of steps) {
    const body = fn(src, name);
    assert.match(body.slice(0, body.indexOf("{")), /\binTx\?: ChromiaTx\b/, `${name} takes the caller's transaction`);
    assert.doesNotMatch(body, /prisma\.\$transaction\(/, `${name} must not open a transaction of its own inside the save's`);
    assert.doesNotMatch(body, /await prisma\.chromia/, `${name} must not read or write outside the save's transaction`);
  }
  for (const [src, name] of steps.filter(([, n]) => n !== "markAwaitingRecalibration")) {
    assert.match(fn(src, name), /withTransaction\(inTx, async \(tx\) => \{/, name);
  }
  // markAwaitingRecalibration's writes go through `db = inTx ?? prisma`, and
  // its write-off and waiting record are handed the same.
  const mark = fn(RECAL, "markAwaitingRecalibration");
  assert.match(mark, /const db = inTx \?\? prisma;/);
  assert.match(mark, /await writeOff\(slab\.id, slab\.slabNo, slab\.status, userId, inTx\);/);
  assert.match(mark, /await openWaitingTrip\(slab\.id, slab\.slabNo, used, reasonId, userId, db\);/);
});

test("CHR-5: saveTrip opens the missing waiting record for a slab a broken save left condemned without one", () => {
  const trip = fn(RECAL, "saveTrip");
  assert.match(trip, /const repairable =\n\s+!found &&\n\s+slab\.status === SlabStatus\.GRADED &&\n\s+slab\.currentDisposition === Disposition\.RECALIBRATION &&\n\s+!isWriteOff\(slab\.recalibrations\);/);
  assert.match(trip, /const trip = repairable\n\s+\? await openWaitingTrip\(slab\.id, slab\.slabNo, attemptsUsed\(slab\.recalibrations\), undefined, userId\)\n\s+: found;/);
  // Anything else still refused in the words it had.
  assert.match(trip, /`Slab \$\{slab\.slabNo\} is not waiting for recalibration right now`/);
  // The repair is the same record the QC save opens.
  assert.match(fn(RECAL, "openWaitingTrip"), /attemptNumber: used \+ 1,\n\s+status: RecalibrationStatus\.PENDING_DISPATCH,/);
});

// ── CHR-6 ───────────────────────────────────────────────────────────────────

test("CHR-6: claimSlab moves the slab only from the status and outcome it was read in, and refuses otherwise", () => {
  const claim = fn(DISPOSITION, "claimSlab");
  assert.match(claim, /tx\.chromiaSlab\.updateMany\(\{\n\s+where: \{\n\s+id: slab\.id,\n\s+status: slab\.status,\n\s+currentDisposition: slab\.currentDisposition,\n\s+deletedAt: null,\n\s+\},\n\s+data,\n\s+\}\);/);
  assert.match(claim, /if \(claimed\.count === 0\) \{\n\s+throw new BusinessRuleViolationError\(/);
});

test("CHR-6: dispatch, stock, sample cutting and waste each claim the slab first, before writing anything", () => {
  const outcomes: Array<[string, string, string]> = [
    ["recordDispatch", "SlabStatus.DISPATCHED", "tx.chromiaDispatch.create("],
    ["recordStock", "SlabStatus.IN_STOCK", "tx.chromiaStockEntry.create("],
    ["recordSampleCutting", "SlabStatus.SAMPLE_CUT", "tx.chromiaSampleCutting.create("],
    ["declareWaste", "SlabStatus.WASTE", "tx.chromiaWasteRecord.create("],
  ];
  for (const [name, status, create] of outcomes) {
    const body = fn(DISPOSITION, name);
    const open = body.search(/(?:prisma\.\$transaction\(|withTransaction\(inTx, )async \(tx\) => \{\n\s+await claimSlab\(tx, slab, \{\n\s+status: /);
    assert.ok(open > 0, `${name}: the claim is the transaction's first statement`);
    assert.ok(body.indexOf(`status: ${status},`, open) > open, `${name} claims ${status}`);
    assert.ok(body.indexOf("claimSlab(") < body.indexOf(create), `${name}: claimed before ${create}`);
    // The slab's row is written once, by the guarded claim — no unguarded update after it.
    assert.doesNotMatch(body, /tx\.chromiaSlab\.update\(/, `${name}: no unguarded slab update`);
  }
});

// The review of the CHR-1/CHR-6 fixes found two writes that still checked the
// slab and then overwrote it: the Edit path's QC reset, and the Stockyard's
// send for recalibration. A dispatch pressed at the same moment could be undone
// by either. Both now claim the slab with the same claimSlab, first. The race
// itself is run against an in-memory database in tests/chromia/slab-claims.test.ts.

test("CHR-1/CHR-6: claimSlab is shared, so every write that moves a slab on claims it the same way", () => {
  assert.match(DISPOSITION, /\nexport async function claimSlab\(\n\s+tx: ChromiaTx,\n\s+slab: Pick<Slab, 'id' \| 'slabNo' \| 'status' \| 'currentDisposition'>,/);
  assert.match(OUTCOME, /import \{ claimSlab \} from '@\/lib\/chromia\/server\/services\/disposition-service';/);
  assert.match(STOCKYARD, /import \{ claimSlab, recordDispatch \} from '@\/lib\/chromia\/server\/services\/disposition-service';/);
});

test("CHR-1/CHR-6: the QC reset claims the slab before it clears anything, and never overwrites it unguarded", () => {
  const reset = fn(OUTCOME, "resetSlabQcForCorrection");
  const open = reset.search(
    /withTransaction\(inTx, async \(tx\) => \{\n(?:\s+\/\/[^\n]*\n)*\s+await claimSlab\(tx, slab, \{\n\s+status: SlabStatus\.IN_PROCESS,\n\s+currentGrade: null,\n\s+currentDisposition: null,\n\s+updatedById: userId,\n\s+\}\);/,
  );
  assert.ok(open > 0, "the claim is the transaction's first statement");
  // After the refusal was decided, before a stock, sample-cutting, waste or grade row goes.
  assert.ok(reset.indexOf("qcCorrectionRefusal(") < open);
  assert.ok(open < reset.indexOf("deleteMany"));
  assert.doesNotMatch(reset, /tx\.chromiaSlab\.update\(/, "the slab's row is written once, by the guarded claim");
});

test("CHR-6: the Stockyard's send for recalibration claims the slab and opens the waiting record in one transaction", () => {
  const send = fn(STOCKYARD, "sendStockToRecalibration");
  // Read with its outcome, so the claim matches the exact state the checks passed on.
  assert.match(send, /status: true,\n(?:\s+\/\/[^\n]*\n)*\s+currentDisposition: true,/);
  const at = send.indexOf("await prisma.$transaction(async (tx) => {");
  assert.ok(at > 0, "one transaction");
  const block = send.slice(at);
  assert.match(
    block,
    /^await prisma\.\$transaction\(async \(tx\) => \{\n(?:\s+\/\/[^\n]*\n)*\s+await claimSlab\(tx, slab, \{\n\s+status: SlabStatus\.GRADED,\n\s+currentDisposition: Disposition\.RECALIBRATION,\n\s+updatedById: userId,\n\s+\}\);/,
    "the claim is the transaction's first statement",
  );
  // The waiting record is opened inside it, after the claim — a refusal rolls it back.
  assert.match(block, /const result = await markAwaitingRecalibration\(slab\.id, undefined, userId, tx\);\n\s+if \(result\.writtenOff\) \{\n\s+throw new BusinessRuleViolationError\(/);
  assert.equal((send.match(/markAwaitingRecalibration\(/g) ?? []).length, 1, "never called outside the transaction");
  assert.ok(block.indexOf("claimSlab(") < block.indexOf("markAwaitingRecalibration("));
  assert.doesNotMatch(send, /\.chromiaSlab\.update\(/, "no unguarded slab update");
});

// ── CHR-9 ───────────────────────────────────────────────────────────────────

test("CHR-9: a restart that corrects the slab number moves the finished-goods mark, after the transaction", () => {
  const restart = fn(RECAL, "restartProduction");
  assert.match(RECAL, /import \{ markSlabsChromia, unmarkSlabsChromia \} from '@\/lib\/chromia\/inventory-bridge';/);
  assert.match(restart, /if \(input\.slabNo !== slab\.slabNo\) \{\n\s+await unmarkSlabsChromia\(\[slab\.slabNo\], null\);\n\s+await markSlabsChromia\(\[input\.slabNo\], null\);\n\s+\}/);
  const txEnd = restart.lastIndexOf("\n  });\n");
  assert.ok(txEnd > 0 && restart.indexOf("unmarkSlabsChromia(") > txEnd, "after the transaction has committed");
  // Renamed in the same function — the mark follows the record it renamed.
  assert.match(restart, /slabNo: input\.slabNo,/);
});
