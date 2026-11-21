/**
 * THE CHROMIA WORKFLOW CHECK (28 Oct 2026, change 10) — every workflow move,
 * driven through the very server actions the pages call, with the
 * consistency audit (src/lib/chromia/server/audit/consistency.ts) and the
 * expected KPI movement checked after each step.
 *
 *   npm run test:workflows       (against a *_test database only)
 *
 * It creates its own slabs (numbers starting WF), walks them through Slab
 * Entry and QC, the Stockyard's outcomes and corrections, five recalibration
 * attempts and a write-off, an edit, and a re-entered 14567-A style slab —
 * then deletes them, and checks the database is back where it started.
 */
import { prisma } from '@/lib/chromia/db';
import { toPlantDateInput } from '@/lib/chromia/plant-time';
import { stageOf, statusLabel } from '@/lib/chromia/recalibration-flow';
import { parseBoardFilters } from '@/lib/chromia/recalibration-board';
import { auditConsistency } from '@/lib/chromia/server/audit/consistency';
import { saveSlabEntryAction } from '@/lib/chromia/server/actions/operator';
import { updateRecalibrationSlabAction } from '@/lib/chromia/server/actions/recalibration-flow';
import { deleteSlabRecordAction } from '@/lib/chromia/server/actions/slab-record';
import { sendFromStockAction } from '@/lib/chromia/server/actions/stockyard';
import { alterFromDispatchedAction } from '@/lib/chromia/server/actions/dispatched-alter';
import { addTrimmingWithoutPrintingAction, deleteTrimmingAction, updateTrimmingSlabAction } from '@/lib/chromia/server/actions/trimming';
import { listRecentOrders } from '@/lib/chromia/server/repositories/order-repository';
import { loadTrimmingBoard, loadTrimmingRecord } from '@/lib/chromia/server/repositories/trimming-repository';
import { parseTrimFilters, type TrimBoardKpis } from '@/lib/chromia/trimming-board';
import { listSentFromStock } from '@/lib/chromia/server/repositories/stockyard-repository';
import { updateStockyardSlabAction } from '@/lib/chromia/server/actions/stockyard-edit';
import { loadProductionDashboard } from '@/lib/chromia/server/repositories/dashboard-repository';
import { loadRecalibrationBoard, loadSlabTrips } from '@/lib/chromia/server/repositories/recalibration-flow-repository';
import { loadSlabRecord } from '@/lib/chromia/server/repositories/slab-record-repository';
import { toDateInput, toTimeInput } from '@/lib/chromia/operator-register';
import { deleteOrderAction, saveOrderAction } from '@/lib/chromia/server/actions/orders';

const TODAY = toPlantDateInput(new Date());
const RUN = String(Date.now() % 1_000_000).padStart(6, '0');
const BATCH = 'WF-BATCH';
const MATERIAL = 'Astral Mist';
const DESIGN = 'AlmondMist1';

let failures = 0;
let steps = 0;
const created: { id: string; slabNo: string }[] = [];

function expect(what: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures += 1;
    console.log(`  FAIL  ${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

/** What the KPIs say now — the numbers each step expects to move. */
async function snapshot() {
  const [{ overall, todays }, board] = await Promise.all([
    loadProductionDashboard(null),
    loadRecalibrationBoard(parseBoardFilters({}), { page: 1, pageSize: 100_000 }),
  ]);
  return {
    produced: overall.produced,
    inProcessing: overall.inProcessing,
    stock: overall.currentStock,
    dispatched: overall.dispatched,
    approved: overall.approved,
    sampleCutting: overall.sampleCutting,
    recalibration: overall.places.RECALIBRATION,
    trimming: overall.places.TRIMMING,
    // Recalibration Dashboard, OVERALL STATUS (events) …
    recalibrated: board.kpis.recalibrated,
    sent: board.kpis.sent,
    received: board.kpis.received,
    pending: board.kpis.pending,
    // … and CURRENT STATUS (slabs, each once).
    ready: board.kpis.ready,
    out: board.kpis.out,
    returned: board.kpis.returned,
    available: board.kpis.available,
    todayProduced: todays.produced,
  };
}
type Snapshot = Awaited<ReturnType<typeof snapshot>>;

/** Run one step, then the full audit, then the KPI movement it should cause. */
async function step(name: string, run: () => Promise<unknown>, moves: Partial<Snapshot> = {}) {
  steps += 1;
  const before = await snapshot();
  const result = (await run()) as { error?: string; fieldErrors?: unknown } | undefined;
  console.log(`${String(steps).padStart(2)}. ${name}`);
  if (result && (result.error || result.fieldErrors)) {
    failures += 1;
    console.log(`  FAIL  the action refused: ${JSON.stringify(result.error ?? result.fieldErrors)}`);
  }
  const after = await snapshot();
  for (const key of Object.keys(before) as (keyof Snapshot)[]) {
    expect(`${key} moves by ${moves[key] ?? 0}`, after[key] - before[key], moves[key] ?? 0);
  }
  for (const check of await auditConsistency()) {
    if (!check.ok) {
      failures += 1;
      console.log(`  FAIL  audit — ${check.check}: expected ${check.expected}, got ${check.actual}`);
    }
  }
}

async function slabId(slabNo: string) {
  const slab = await prisma.chromiaSlab.findUniqueOrThrow({ where: { slabNo }, select: { id: true } });
  return slab.id;
}

/** A Slab Entry save — entry and QC Report together, as the operator screen sends it. */
async function enter(slabNo: string, qc: { grade?: string; disposition?: string; reason?: string } = {}) {
  const result = await saveSlabEntryAction(
    {},
    form({
      qcMode: 'grade',
      entryDate: TODAY,
      inTime: '09:30',
      batchNo: BATCH,
      slabNo,
      baseMaterial: MATERIAL,
      fileName: DESIGN,
      thicknessCm: '2',
      slabRemarks: '',
      grade: qc.grade ?? '',
      disposition: qc.disposition ?? '',
      recalibrationReason: qc.reason ?? '',
    }),
  );
  if (result.savedSlabId) created.push({ id: result.savedSlabId, slabNo });
  return result;
}

/** The Recalibration form, filled as its page fills it, with `patch` typed over it. */
async function recalibrationForm(slabNo: string, patch: Record<string, string>) {
  const id = await slabId(slabNo);
  const [record, trips] = await Promise.all([loadSlabRecord(id), loadSlabTrips(id)]);
  if (!record) throw new Error(`no slab ${slabNo}`);
  const state = { disposition: record.currentDisposition, writtenOff: record.status === 'WASTE', trips };
  const stage = stageOf(state);
  const current =
    stage === 'AWAITING_SEND' || stage === 'OUT' ? (trips.find((t) => t.sentDate && !t.receivedDate) ?? trips.find((t) => !t.sentDate)) : undefined;
  const day = (date: Date | null) => (date ? toDateInput(date) : '');
  const details = {
    productionDate: toDateInput(record.receivedDate),
    batchNo: record.batchNo,
    slabNo: record.slabNo,
    baseMaterial: record.baseMaterial,
    fileName: record.designFileName,
    thicknessCm: record.thicknessCm === null ? '' : String(record.thicknessCm),
    // As the page fills it: back from a trip, the new pass's In-time is empty.
    inTime: stage === 'RETURNED' || !record.inTime ? '' : toTimeInput(record.inTime),
  };
  const canGrade = stage === 'RETURNED' || stage === 'IN_PRODUCTION';
  const values: Record<string, string> = {
    slabId: id,
    initialSentDate: day(current?.sentDate ?? null),
    initialReceivedDate: day(current?.receivedDate ?? null),
    sentDate: day(current?.sentDate ?? null),
    receivedDate: day(current?.receivedDate ?? null),
    initialGrade: canGrade ? '' : (record.currentGrade ?? ''),
    initialReason: '',
    recalibrationReason: '',
    initialRemarks: '',
    slabRemarks: '',
    grade: '',
    ...Object.fromEntries(Object.entries(details).flatMap(([k, v]) => [[k, v], [`initial_${k}`, v]])),
  };
  for (const trip of trips) {
    if (trip.sentDate && trip.receivedDate) {
      values[`trip_${trip.attemptNumber}_sent`] = values[`initial_trip_${trip.attemptNumber}_sent`] = day(trip.sentDate);
      values[`trip_${trip.attemptNumber}_received`] = values[`initial_trip_${trip.attemptNumber}_received`] = day(trip.receivedDate);
    }
  }
  return updateRecalibrationSlabAction({}, form({ ...values, ...patch }));
}

async function statusOf(slabNo: string) {
  const slab = await prisma.chromiaSlab.findUniqueOrThrow({
    where: { slabNo },
    select: {
      status: true,
      currentGrade: true,
      currentDisposition: true,
      currentLocation: { select: { type: true } },
      recalibrations: { orderBy: { attemptNumber: 'asc' }, select: { attemptNumber: true, sentDate: true, receivedDate: true, restartedAt: true } },
    },
  });
  return {
    status: slab.status,
    location: slab.currentLocation?.type ?? null,
    label: statusLabel({ disposition: slab.currentDisposition, writtenOff: slab.status === 'WASTE', trips: slab.recalibrations }, slab.currentGrade),
  };
}

/** The Stockyard Edit form, filled as its page fills it, with `patch` typed over it. */
async function stockyardEdit(slabNo: string, patch: Record<string, string>) {
  const id = await slabId(slabNo);
  const record = await loadSlabRecord(id);
  if (!record) throw new Error(`no slab ${slabNo}`);
  const entry = await prisma.chromiaStockEntry.findFirst({ where: { slabId: id }, orderBy: { stockDate: 'desc' } });
  const place = { IN_STOCK: 'IN_STOCK', DISPATCHED: 'DISPATCH', APPROVED: 'APPROVED', SAMPLE_CUT: 'SAMPLE_CUTTING' }[record.status as string] ?? '';
  const details = {
    productionDate: toDateInput(record.receivedDate),
    batchNo: record.batchNo,
    slabNo: record.slabNo,
    baseMaterial: record.baseMaterial,
    fileName: record.designFileName,
    thicknessCm: record.thicknessCm === null ? '' : String(record.thicknessCm),
    inTime: record.inTime ? toTimeInput(record.inTime) : '',
  };
  const outcomeDate = place !== 'IN_STOCK' && entry?.releasedAt ? toPlantDateInput(entry.releasedAt) : '';
  return updateStockyardSlabAction(
    {},
    form({
      form: 'stockyard',
      slabId: id,
      ...Object.fromEntries(Object.entries(details).flatMap(([k, v]) => [[k, v], [`initial_${k}`, v]])),
      grade: record.currentGrade ?? '',
      initialGrade: record.currentGrade ?? '',
      slabRemarks: '',
      initialRemarks: '',
      outcome: place,
      initialOutcome: place,
      outcomeDate,
      initialOutcomeDate: outcomeDate,
      stockedOn: entry ? toPlantDateInput(entry.stockDate) : '',
      ...patch,
    }),
  );
}

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.replace(/^\//, '').endsWith('_test')) {
    throw new Error(`Refusing to run: ${url.pathname.slice(1)} is not a *_test database. The workflow check writes slabs.`);
  }
  const start = await snapshot();
  const n = (k: string) => `WF${RUN}${k}`;
  const sent = async (slabNo: string, outcome: string) =>
    sendFromStockAction({}, form({ slabId: await slabId(slabNo), outcome, date: TODAY }));

  // ── Slab Entry and QC ─────────────────────────────────────────────────
  await step('Slab Entry, no QC yet → In-Processing', () => enter(n('1')), { produced: 1, inProcessing: 1, todayProduced: 1 });
  await step('QC of that slab: Grade A → Stock', async () =>
    saveSlabEntryAction({}, form({ qcMode: 'grade', slabId: await slabId(n('1')), entryDate: TODAY, receivedDate: TODAY, inTime: '09:30', batchNo: BATCH, slabNo: n('1'), baseMaterial: MATERIAL, fileName: DESIGN, thicknessCm: '2', slabRemarks: '', grade: 'A', disposition: 'DISPATCH' })),
    { inProcessing: -1, stock: 1 });
  expect('Grade A is Stock, whatever the request said', (await statusOf(n('1'))).status, 'IN_STOCK');
  await step('Slab Entry with QC: Grade B → Stock', () => enter(n('2'), { grade: 'B', disposition: 'STOCK' }), { produced: 1, stock: 1, todayProduced: 1 });
  await step('Slab Entry with QC: Grade B → Sample Cutting', () => enter(n('3'), { grade: 'B', disposition: 'SAMPLE_CUTTING' }), { produced: 1, sampleCutting: 1, todayProduced: 1 });
  await step('Slab Entry with QC: Grade B → Stock', () => enter(n('4'), { grade: 'B', disposition: 'STOCK' }), { produced: 1, stock: 1, todayProduced: 1 });

  // ── Stock movements ───────────────────────────────────────────────────
  await step('Stockyard: Dispatch — out of Current Stock, into Dispatched', () => sent(n('1'), 'DISPATCH'), { stock: -1, dispatched: 1 });
  await step('Stockyard: Approved — out of Current Stock, into Approved', () => sent(n('2'), 'APPROVED'), { stock: -1, approved: 1 });
  await step('Stockyard: Sample Cutting — out of Current Stock, into Sample Cutting', () => sent(n('4'), 'SAMPLE_CUTTING'), { stock: -1, sampleCutting: 1 });
  await step('Stockyard: the same slab cannot be sent twice', async () => {
    const again = await sent(n('1'), 'APPROVED');
    expect('a dispatched slab is refused', Boolean(again.error), true);
  });

  // ── Stockyard corrections ─────────────────────────────────────────────
  await step('Stockyard Edit: Approved → Dispatch', () => stockyardEdit(n('2'), { outcome: 'DISPATCH', outcomeDate: TODAY }), { approved: -1, dispatched: 1 });
  await step('Stockyard Edit: Dispatch → Back in Stock', () => stockyardEdit(n('2'), { outcome: 'IN_STOCK', outcomeDate: '' }), { dispatched: -1, stock: 1 });
  await step('Stockyard Edit: Sample Cutting → Approved, grade B → A', () => stockyardEdit(n('4'), { outcome: 'APPROVED', outcomeDate: TODAY, grade: 'A' }), { sampleCutting: -1, approved: 1 });
  await step('Stockyard Edit: a date in the future is refused, nothing moves', async () => {
    const tomorrow = toPlantDateInput(new Date(Date.now() + 86_400_000));
    const refused = await stockyardEdit(n('4'), { outcome: 'DISPATCH', outcomeDate: tomorrow });
    expect('refused', Boolean(refused.fieldErrors), true);
  });

  // ── Recalibration: five attempts, then the write-off ──────────────────
  await step('QC: Grade C → Recalibration — Ready', () => enter(n('5'), { grade: 'C', disposition: 'RECALIBRATION', reason: 'Pinholes' }), { produced: 1, recalibration: 1, recalibrated: 1, ready: 1, todayProduced: 1 });
  expect('status', (await statusOf(n('5'))).label, 'Ready for Recalibration');
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const ord = ['1st', '2nd', '3rd', '4th', '5th'][attempt - 1];
    // Ready is the FIRST send only: a repeat send leaves it as it is.
    await step(`Attempt ${attempt}: sent`, () => recalibrationForm(n('5'), { sentDate: TODAY }), { ...(attempt === 1 ? { ready: -1 } : {}), sent: 1, pending: 1, out: 1 });
    expect(`attempt ${attempt} out`, await statusOf(n('5')), { status: 'OUT_FOR_RECALIBRATION', location: 'EXTERNAL_FACILITY', label: `Sent for ${ord} Time Recalibration` });
    await step(`Attempt ${attempt}: received`, () => recalibrationForm(n('5'), { receivedDate: TODAY }), { received: 1, pending: -1, out: -1, returned: 1, available: 1 });
    expect(`attempt ${attempt} back`, await statusOf(n('5')), { status: 'RECEIVED_FROM_RECALIBRATION', location: 'YARD', label: `Received from the ${ord} Time Recalibration` });
    // Reprinted: off "Received", and off "Available after Recalibration" (21 Nov 2026).
    await step(`Attempt ${attempt}: back on the line`, () => recalibrationForm(n('5'), { inTime: '11:00' }), { recalibration: -1, inProcessing: 1, returned: -1, available: -1 });
    expect(`attempt ${attempt} in processing`, (await statusOf(n('5'))).label, `In Processing — After Attempt ${attempt}`);
    if (attempt < 5) {
      await step(`Attempt ${attempt}: QC Grade C again — Need the next`, () => recalibrationForm(n('5'), { grade: 'C', disposition: 'RECALIBRATION', recalibrationReason: 'Pinholes' }), { recalibration: 1, inProcessing: -1, recalibrated: 1 });
      expect(`after attempt ${attempt}`, (await statusOf(n('5'))).label, `Need ${['2nd', '3rd', '4th', '5th'][attempt - 1]} Time Recalibration`);
    }
  }
  await step('After the 5th: Grade C again — written off', () => recalibrationForm(n('5'), { grade: 'C', disposition: 'RECALIBRATION', recalibrationReason: 'Pinholes' }), { recalibration: 1, inProcessing: -1 });
  // The whole history of one slab, five times over: 5 records, 5 sends, 5 receipts.
  expect('Overall Status counts every attempt of …5', await (async () => {
    const t = await prisma.chromiaRecalibrationCycle.findMany({ where: { slab: { slabNo: n('5') } } });
    return [t.length, t.filter((x) => x.sentDate).length, t.filter((x) => x.receivedDate).length];
  })(), [5, 5, 5]);
  expect('written off', (await statusOf(n('5'))).label, 'Written Off / Waste');

  await step('QC: Grade C → Recalibration (a second slab)', () => enter(n('6'), { grade: 'C', disposition: 'RECALIBRATION', reason: 'Half Print' }), { produced: 1, recalibration: 1, recalibrated: 1, ready: 1, todayProduced: 1 });
  await step('…sent and received in one save', () => recalibrationForm(n('6'), { sentDate: TODAY, receivedDate: TODAY }), { ready: -1, sent: 1, received: 1, returned: 1, available: 1 });
  await step('…its new pass, graded A → Stock: cleared into Current Stock', () => recalibrationForm(n('6'), { inTime: '12:00', grade: 'A' }), { recalibration: -1, stock: 1, returned: -1, available: -1 });
  expect('cleared', (await statusOf(n('6'))).status, 'IN_STOCK');
  await step('…and dispatched from the Stockyard', () => sent(n('6'), 'DISPATCH'), { stock: -1, dispatched: 1 });

  // ── Stockyard → Sent From Stock (change 11, 8 Nov 2026) ───────────────
  const sentFromStock = async () =>
    Object.fromEntries((await listSentFromStock(`WF${RUN}`)).map((r) => [r.slabNo, r.outcome]));
  await step('Sent From Stock: the slabs that left the rack, each once — not QC-direct, not the rack', async () => {
    expect('rows', await sentFromStock(), { [n('6')]: 'DISPATCH', [n('4')]: 'APPROVED', [n('1')]: 'DISPATCH' });
    expect('Slab Number search', Object.keys(Object.fromEntries((await listSentFromStock(n('6').toLowerCase())).map((r) => [r.slabNo, 1]))), [n('6')]);
  });
  await step('Sent From Stock Edit: Dispatched → Sample Cutting with its date', () => stockyardEdit(n('6'), { outcome: 'SAMPLE_CUTTING', outcomeDate: TODAY }), { dispatched: -1, sampleCutting: 1 });
  expect('the row shows its new outcome', (await sentFromStock())[n('6')], 'SAMPLE_CUTTING');
  expect('its dispatch record is gone, its cut recorded', [await prisma.chromiaDispatch.count({ where: { slab: { slabNo: n('6') } } }), await prisma.chromiaSampleCutting.count({ where: { slab: { slabNo: n('6') } } })], [0, 1]);

  // ── Dispatched → Alter From Dispatched (change 12, 8 Nov 2026) ────────
  const alter = async (slabNo: string, destination: string, date = TODAY) =>
    alterFromDispatchedAction({}, form({ slabId: await slabId(slabNo), destination, date }));
  await step('Alter From Dispatched: a date in the future is refused, nothing moves', async () => {
    const refused = await alter(n('1'), 'IN_STOCK', toPlantDateInput(new Date(Date.now() + 86_400_000)));
    expect('refused', Boolean(refused.error), true);
  });
  await step('Alter From Dispatched: a date before the dispatch is refused, nothing moves', async () => {
    const refused = await alter(n('1'), 'IN_STOCK', '2020-01-01');
    expect('refused', Boolean(refused.error), true);
  });
  await step('Alter From Dispatched → In Stock: out of Dispatched, into Current Stock', () => alter(n('1'), 'IN_STOCK'), { dispatched: -1, stock: 1 });
  expect('no dispatch record, a new open stock entry beside the old one', [
    await prisma.chromiaDispatch.count({ where: { slab: { slabNo: n('1') } } }),
    await prisma.chromiaStockEntry.count({ where: { slab: { slabNo: n('1') } } }),
    await prisma.chromiaStockEntry.count({ where: { slab: { slabNo: n('1') }, releasedAt: null } }),
  ], [0, 2, 1]);
  expect('the trail says where it went', Boolean(await prisma.chromiaSlabEvent.findFirst({ where: { slab: { slabNo: n('1') }, note: { startsWith: 'Altered from Dispatched' } } })), true);
  await step('Alter From Dispatched: a slab no longer dispatched cannot be moved again', async () => {
    const refused = await alter(n('1'), 'RECALIBRATION');
    expect('refused', Boolean(refused.error), true);
  });
  await step('…dispatched again from the Stockyard', () => sent(n('1'), 'DISPATCH'), { stock: -1, dispatched: 1 });
  await step('Dispatched Edit: Alter From Dispatched → Recalibration — Ready', () =>
    stockyardEdit(n('1'), { form: 'dispatched', destination: 'RECALIBRATION', alterDate: TODAY }), { dispatched: -1, recalibration: 1, recalibrated: 1, ready: 1 });
  expect('waiting for its first trip', (await statusOf(n('1'))).status, 'GRADED');

  // ── Grade C → Trimming (7 Nov 2026) ───────────────────────────────────
  await step('Slab Entry with QC: Grade C and no outcome chosen is refused, nothing saved', async () => {
    const refused = await enter(n('7'), { grade: 'C' });
    expect('asks for the outcome', Boolean(refused.fieldErrors?.disposition), true);
  });
  expect('no slab saved', await prisma.chromiaSlab.count({ where: { slabNo: n('7') } }), 0);
  await step('Slab Entry with QC: Grade C → Trimming', () => enter(n('7'), { grade: 'C', disposition: 'TRIMMING' }), { produced: 1, trimming: 1, todayProduced: 1 });
  expect('saved as Graded, outcome Trimming', await prisma.chromiaSlab.findUniqueOrThrow({ where: { slabNo: n('7') }, select: { status: true, currentGrade: true, currentDisposition: true } }), { status: 'GRADED', currentGrade: 'C', currentDisposition: 'TRIMMING' });
  expect('no recalibration record', await prisma.chromiaRecalibrationCycle.count({ where: { slab: { slabNo: n('7') } } }), 0);
  expect('no stock entry', await prisma.chromiaStockEntry.count({ where: { slab: { slabNo: n('7') } } }), 0);
  await step('Slab Entry Edit: Trimming corrected to Recalibration — leaves Trimming, Ready', async () =>
    saveSlabEntryAction({}, form({ qcMode: 'correct', slabId: await slabId(n('7')), entryDate: TODAY, receivedDate: TODAY, inTime: '09:30', batchNo: BATCH, slabNo: n('7'), baseMaterial: MATERIAL, fileName: DESIGN, thicknessCm: '2', slabRemarks: '', grade: 'C', disposition: 'RECALIBRATION', initialGrade: 'C', initialDisposition: 'TRIMMING', initialReason: '' })),
    { trimming: -1, recalibration: 1, recalibrated: 1, ready: 1 });
  // The QC after recalibration has the complete options (21 Nov 2026): Grade
  // C may go to Trimming, and the slab leaves the recalibration journey for it.
  await step('Recalibration re-grade after the 1st attempt: Grade C → Trimming', async () => {
    await recalibrationForm(n('7'), { sentDate: TODAY, receivedDate: TODAY });
    await recalibrationForm(n('7'), { inTime: '12:00' });
    return recalibrationForm(n('7'), { grade: 'C', disposition: 'TRIMMING' });
  }, { sent: 1, received: 1, ready: -1, recalibration: -1, trimming: 1 });
  expect('its outcome is Trimming, with a Trimming record; its trip stays in the history', [
    (await prisma.chromiaSlab.findUniqueOrThrow({ where: { slabNo: n('7') }, select: { currentDisposition: true } })).currentDisposition,
    await prisma.chromiaTrimming.count({ where: { slab: { slabNo: n('7') } } }),
    (await prisma.chromiaRecalibrationCycle.findMany({ where: { slab: { slabNo: n('7') } }, select: { attemptNumber: true } })).length,
  ], ['TRIMMING', 1, 1]);
  expect('the Recalibration page says where it went', await (async () => {
    const board = await loadRecalibrationBoard(parseBoardFilters({ slabNo: n('7') }), { page: 1, pageSize: 10 });
    return board.rows.map((r) => statusLabel(r.state, r.grade));
  })(), ['Moved to Trimming — Grade C']);

  // ── The Trimming section (7 Nov 2026, change 4) ───────────────────────
  const trimForm = async (slabNo: string, patch: Record<string, string>) => {
    const record = await prisma.chromiaTrimming.findFirstOrThrow({ where: { OR: [{ slab: { slabNo } }, { slabNo }] } });
    const row = await loadTrimmingRecord(record.id);
    if (!row) throw new Error(`no trimming row for ${slabNo}`);
    const day = (date: Date | null) => (date ? toDateInput(date) : '');
    const cm = (mm: number | null) => (mm === null ? '' : String(mm / 10));
    const details = {
      productionDate: day(row.productionDate),
      batchNo: row.batchNo,
      slabNo: row.slabNo,
      baseMaterial: row.baseMaterial,
      fileName: row.fileName ?? '',
      thicknessCm: cm(row.thicknessMm),
      inTime: row.inTime instanceof Date ? toTimeInput(row.inTime) : (row.inTime ?? ''),
    };
    return updateTrimmingSlabAction({}, form({
      id: row.id,
      trimChoice: '',
      initialTrimFromMm: row.trimFromMm === null ? '' : String(row.trimFromMm),
      initialTrimToMm: row.trimToMm === null ? '' : String(row.trimToMm),
      sentDate: day(row.sentDate),
      receivedDate: day(row.receivedDate),
      initialSentDate: day(row.sentDate),
      initialReceivedDate: day(row.receivedDate),
      ...Object.fromEntries(Object.entries(details).flatMap(([k, v]) => [[k, v], [`initial_${k}`, v]])),
      slabRemarks: '',
      initialRemarks: '',
      grade: '',
      ...patch,
    }));
  };
  const trimRow = async (slabNo: string) => {
    const record = await prisma.chromiaTrimming.findFirstOrThrow({ where: { OR: [{ slab: { slabNo } }, { slabNo }] } });
    return loadTrimmingRecord(record.id);
  };
  await step('Slab Entry: Grade C → Trimming — straight into the Trimming table', () => enter(n('8'), { grade: 'C', disposition: 'TRIMMING' }), { produced: 1, trimming: 1, todayProduced: 1 });
  expect('its record, Ready for Trimming, nothing saved yet', (await trimRow(n('8')))?.status, 'Ready for Trimming');
  await step('Trimming: only From → To (3 cm → 2 cm) saved', () => trimForm(n('8'), { trimChoice: '30-20' }));
  expect('status', (await trimRow(n('8')))?.status, 'Ready for Trimming — 3 cm → 2 cm');
  await step('Trimming: only the Sent Date saved', () => trimForm(n('8'), { sentDate: TODAY }));
  expect('status after Sent', (await trimRow(n('8')))?.status, 'Sent for Trimming (3 cm → 2 cm)');
  expect('From → To kept', [(await trimRow(n('8')))?.trimFromMm, (await trimRow(n('8')))?.trimToMm], [30, 20]);
  await step('Trimming: the Received Date later — the slab is now 2 cm', () => trimForm(n('8'), { receivedDate: TODAY }));
  expect('status after Received', (await trimRow(n('8')))?.status, 'Received from Trimming (3 cm → 2 cm) — Awaiting QC');
  expect('thickness is the To value', (await trimRow(n('8')))?.thicknessMm, 20);
  await step('Trimming: QC Grade A → Stock — out of Trimming, into Current Stock', () => trimForm(n('8'), { grade: 'A' }), { trimming: -1, stock: 1 });
  expect('the row stays, trimmed', (await trimRow(n('8')))?.status, 'Trimmed — Grade A: Stock');
  expect('the slab is in stock, still one record', [(await statusOf(n('8'))).status, await prisma.chromiaSlab.count({ where: { slabNo: n('8') } })], ['IN_STOCK', 1]);

  await step('Trimming Without Design Printing: added — no production count', () =>
    addTrimmingWithoutPrintingAction({}, form({ batchNo: BATCH, slabNo: n('9'), baseMaterial: MATERIAL, thicknessCm: '3' })));
  expect('its row', (await trimRow(n('9')))?.status, 'Ready for Trimming');
  await step('…the same slab number again is refused', async () => {
    const again = await addTrimmingWithoutPrintingAction({}, form({ batchNo: BATCH, slabNo: n('9'), baseMaterial: MATERIAL, thicknessCm: '3' }));
    expect('duplicate refused', Boolean(again.fieldErrors?.slabNo), true);
  });
  await step('…Others: 30 mm → 25 mm, sent and received in one save', () => trimForm(n('9'), { trimChoice: 'OTHER', trimFrom: '30', trimTo: '25', trimUnit: 'mm', sentDate: TODAY, receivedDate: TODAY }));
  expect('its thickness is now 25 mm', (await trimRow(n('9')))?.thicknessMm, 25);
  await step('…QC Grade B → Sample Cutting: it becomes a Chromia slab', () => trimForm(n('9'), { grade: 'B', disposition: 'SAMPLE_CUTTING' }), { produced: 1, sampleCutting: 1, todayProduced: 1 });
  const madeSlab = await prisma.chromiaSlab.findUnique({ where: { slabNo: n('9') }, select: { id: true, status: true, currentThicknessMm: true } });
  expect('a sample-cut slab of 25 mm', [madeSlab?.status, Number(madeSlab?.currentThicknessMm)], ['SAMPLE_CUT', 25]);
  if (madeSlab) created.push({ id: madeSlab.id, slabNo: n('9') });
  expect('still marked as without design printing', (await trimRow(n('9')))?.source, 'WITHOUT_PRINTING');

  await step('Trimming Without Design Printing: one more, then deleted', async () => {
    await addTrimmingWithoutPrintingAction({}, form({ batchNo: BATCH, slabNo: n('10'), baseMaterial: MATERIAL, thicknessCm: '2' }));
    const record = await prisma.chromiaTrimming.findUniqueOrThrow({ where: { slabNo: n('10') } });
    return deleteTrimmingAction({}, form({ id: record.id }));
  });
  expect('gone', await prisma.chromiaTrimming.count({ where: { slabNo: n('10') } }), 0);

  // ── Slab Records Edit: any QC Grade and Outcome (17 Nov 2026, change 4) ──
  /** The Edit path's Save Entry with a new QC Report, the saved one as its initial values. */
  const correct = async (slabNo: string, grade: string, disposition: string, reason = '') => {
    const id = await slabId(slabNo);
    const now = await prisma.chromiaSlab.findUniqueOrThrow({ where: { id }, select: { currentGrade: true, currentDisposition: true } });
    return saveSlabEntryAction({}, form({
      qcMode: 'correct', slabId: id, entryDate: TODAY, receivedDate: TODAY, inTime: '09:30', batchNo: BATCH, slabNo, baseMaterial: MATERIAL,
      fileName: DESIGN, thicknessCm: '2', slabRemarks: '', grade, disposition, recalibrationReason: reason,
      initialGrade: now.currentGrade ?? '', initialDisposition: now.currentDisposition ?? '', initialReason: '',
    }));
  };
  const trips = (slabNo: string) => prisma.chromiaRecalibrationCycle.findMany({
    where: { slab: { slabNo } }, orderBy: { attemptNumber: 'asc' },
    select: { attemptNumber: true, sentDate: true, receivedDate: true, restartedAt: true, reason: { select: { name: true } } },
  });
  const e = n('20');
  await step('QC: Grade C → Recalibration — Ready', () => enter(e, { grade: 'C', disposition: 'RECALIBRATION', reason: 'Pinholes' }), { produced: 1, recalibration: 1, recalibrated: 1, ready: 1, todayProduced: 1 });
  await step('Edit: Recalibration → Stock (Grade A) — off Recalibration, onto the rack', () => correct(e, 'A', 'STOCK'), { recalibration: -1, recalibrated: -1, ready: -1, stock: 1 });
  expect('its waiting trip is gone', (await trips(e)).length, 0);
  expect('in stock', (await statusOf(e)).status, 'IN_STOCK');
  await step('Edit: Stock → Recalibration (Grade C, a new reason) — off the rack, Ready', () => correct(e, 'C', 'RECALIBRATION', 'Half Print'), { stock: -1, recalibration: 1, recalibrated: 1, ready: 1 });
  expect('one waiting trip, 1st attempt, with the new reason', (await trips(e)).map((t) => [t.attemptNumber, t.sentDate, t.reason?.name]), [[1, null, 'Half Print']]);
  await step('Edit: Recalibration → Trimming (Grade C) — no trip back, so Trimming is allowed', () => correct(e, 'C', 'TRIMMING'), { recalibration: -1, recalibrated: -1, ready: -1, trimming: 1 });
  await step('Edit: Trimming → Sample Cutting (Grade B)', () => correct(e, 'B', 'SAMPLE_CUTTING'), { trimming: -1, sampleCutting: 1 });
  await step('Edit: Sample Cutting → Recalibration (Grade C)', () => correct(e, 'C', 'RECALIBRATION', 'Pinholes'), { sampleCutting: -1, recalibration: 1, recalibrated: 1, ready: 1 });
  await step('…sent for recalibration', () => recalibrationForm(e, { sentDate: TODAY }), { ready: -1, sent: 1, pending: 1, out: 1 });
  await step('Edit while it is out: Recalibration → Stock (Grade A) — the trip is undone', () => correct(e, 'A', 'STOCK'), { recalibration: -1, recalibrated: -1, sent: -1, pending: -1, out: -1, stock: 1 });
  expect('no trip, no attempt counted, not at the facility', [
    (await trips(e)).length,
    (await prisma.chromiaSlab.findUniqueOrThrow({ where: { slabNo: e }, select: { recalibrationCount: true, isRecalibrationOut: true } })),
    (await statusOf(e)).location !== 'EXTERNAL_FACILITY',
  ], [0, { recalibrationCount: 0, isRecalibrationOut: false }, true]);
  await step('Edit: Stock → Recalibration again', () => correct(e, 'C', 'RECALIBRATION', 'Pinholes'), { stock: -1, recalibration: 1, recalibrated: 1, ready: 1 });
  await step('…sent and received', () => recalibrationForm(e, { sentDate: TODAY, receivedDate: TODAY }), { ready: -1, sent: 1, received: 1, returned: 1, available: 1 });
  await step('Edit once it is back: Recalibration → Stock (Grade A) — its next pass, graded', () => correct(e, 'A', 'STOCK'), { recalibration: -1, stock: 1, returned: -1, available: -1 });
  expect('the trip stays, restarted; the slab is on its 2nd pass, in stock', [
    (await trips(e)).map((t) => [t.attemptNumber, Boolean(t.sentDate), Boolean(t.receivedDate), Boolean(t.restartedAt)]),
    (await prisma.chromiaSlab.findUniqueOrThrow({ where: { slabNo: e }, select: { currentCycleNumber: true, status: true } })),
  ], [[[1, true, true, true]], { currentCycleNumber: 2, status: 'IN_STOCK' }]);
  // Slab Records Edit: the complete QC options whatever the slab's history (21 Nov 2026).
  await step('Edit: Stock → Trimming (Grade C) for a slab that has been to recalibration', () => correct(e, 'C', 'TRIMMING'), { stock: -1, trimming: 1 });
  expect('in Trimming', [(await statusOf(e)).label, await prisma.chromiaTrimming.count({ where: { slab: { slabNo: e } } })], ['Moved to Trimming — Grade C', 1]);
  // Waiting for its 2nd send: a new record, but not "Ready" (first send only).
  await step('Edit: Trimming → Recalibration on its 2nd pass — the 2nd attempt waits', () => correct(e, 'C', 'RECALIBRATION', 'Pinholes'), { trimming: -1, recalibration: 1, recalibrated: 1 });
  expect('2nd attempt waiting', (await trips(e)).map((t) => [t.attemptNumber, Boolean(t.sentDate)]), [[1, true], [2, false]]);
  await step('Edit: a dispatched slab keeps its QC — refused, nothing changed', async () => {
    const refused = await correct(n('6'), 'B', 'STOCK');
    expect('refused', Boolean(refused.error), true);
  });

  // ── Trimming Dashboard: a slab trimmed twice (21 Nov 2026) ─────────────
  const trimKpis = async () => (await loadTrimmingBoard(parseTrimFilters({}))).kpis;
  /** What one step changed on the Trimming Dashboard (only the cards that moved). */
  const trimStep = async (what: string, run: () => Promise<unknown>, want: Partial<TrimBoardKpis>, overall: Record<string, number> = {}) => {
    const before = await trimKpis();
    await step(what, run, overall);
    const after = await trimKpis();
    const moved = Object.fromEntries(
      Object.entries(after).map(([k, v]) => [k, v - before[k as keyof TrimBoardKpis]]).filter(([, v]) => v !== 0),
    );
    expect(`Trimming Dashboard after "${what}"`, moved, want);
  };
  const tw = n('21');
  await trimStep('Trimming Dashboard: Grade C → Trimming — Ready', () => enter(tw, { grade: 'C', disposition: 'TRIMMING' }),
    { trimmed: 1, ready: 1 }, { produced: 1, trimming: 1, todayProduced: 1 });
  await trimStep('…3 cm → 2 cm, sent', () => trimForm(tw, { trimChoice: '30-20', sentDate: TODAY }),
    { sent: 1, pending: 1, ready: -1, out: 1 });
  await trimStep('…received — back, and available (no QC yet)', () => trimForm(tw, { receivedDate: TODAY }),
    { received: 1, pending: -1, out: -1, returned: 1, available: 1 });
  await trimStep('…QC Grade A → Stock — processed: no longer available; the trimming stays counted', () => trimForm(tw, { grade: 'A' }),
    { available: -1 }, { trimming: -1, stock: 1 });
  await trimStep('Edit: Stock → Trimming again (Grade C) — a 2nd trimming; the 1st is kept', () => correct(tw, 'C', 'TRIMMING'),
    { trimmed: 1, ready: 1, returned: -1 }, { stock: -1, trimming: 1 });
  const twRow = await trimRow(tw);
  expect('the record is the 2nd trimming, cleared; the 1st kept with its dates and grade', [
    twRow?.attemptNumber,
    twRow?.status,
    twRow?.attempts.map((a) => [a.attemptNumber, Boolean(a.sentDate), Boolean(a.receivedDate), a.qcGrade]),
  ], [2, 'Ready for Trimming', [[1, true, true, 'A'], [2, false, false, null]]]);
  await trimStep('…2nd trimming sent — both sends counted', () => trimForm(tw, { trimChoice: '20-12', sentDate: TODAY }),
    { sent: 1, pending: 1, ready: -1, out: 1 });
  const found = await loadTrimmingBoard(parseTrimFilters({ slabNo: tw, batchNo: BATCH, baseMaterial: MATERIAL }));
  expect('Find a Slab: one row for the slab; Total Trimmed lists both attempts', [
    found.rows.map((r) => r.slabNo),
    (await loadTrimmingBoard(parseTrimFilters({ slabNo: tw, view: 'trimmed' }))).rows.map((r) => [r.attemptNumber, r.status]),
  ], [[tw], [[2, 'Sent for Trimming (2 cm → 1.2 cm)'], [1, 'Trimmed — Grade A: Stock']]]);
  expect('Find a Slab: a slab number that is not there finds nothing', (await loadTrimmingBoard(parseTrimFilters({ slabNo: `${tw}-none` }))).rows.length, 0);

  // ── Edits never duplicate ─────────────────────────────────────────────
  await step('Slab Records Edit: thickness corrected — the same record', async () =>
    saveSlabEntryAction({}, form({ qcMode: 'none', slabId: await slabId(n('2')), entryDate: TODAY, receivedDate: TODAY, inTime: '09:30', batchNo: BATCH, slabNo: n('2'), baseMaterial: MATERIAL, fileName: DESIGN, thicknessCm: '1.8', slabRemarks: 'corrected' })));
  expect('one record named so', await prisma.chromiaSlab.count({ where: { slabNo: n('2') } }), 1);

  // ── One physical slab: 14567 and 14567-A ──────────────────────────────
  await step('A re-entered slab (…3-A) is the same physical slab, where its latest record is', () => enter(`${n('3')}-A`), { sampleCutting: -1, inProcessing: 1 });

  // ── Who may delete (19 Nov 2026) ────────────────────────────────────────────────
  // The standalone runs as one local login; these steps run the real actions
  // as the main ERP's logins (src/lib/rbac.ts, CHROMIA_LOCAL_*).
  const runAs = (login: Record<string, string>) => {
    for (const k of ['CHROMIA_LOCAL_ROLE', 'CHROMIA_LOCAL_BRANCH', 'CHROMIA_LOCAL_ALT_ROLE', 'CHROMIA_LOCAL_ALT_BRANCH']) delete process.env[k];
    Object.assign(process.env, login);
  };
  const OPERATOR = { CHROMIA_LOCAL_ROLE: 'CHROMIA' };
  const GIBIN_IN_CHROMIA = { CHROMIA_LOCAL_ROLE: 'CHROMIA', CHROMIA_LOCAL_ALT_ROLE: 'CHROMIA' };
  runAs(OPERATOR);
  await step('Chromia Operator: Delete is refused on the server, nothing moves', async () => {
    const refused = await deleteSlabRecordAction({}, form({ slabId: await slabId(n('4')), slabNo: n('4') }));
    expect('refused, and says why', /Chromia Operator login cannot delete a slab record/.test(String(refused.error)), true);
    expect('the slab is still there', await prisma.chromiaSlab.count({ where: { slabNo: n('4'), deletedAt: null } }), 1);
  });
  await step('Chromia Operator: deleting a Trimming record is refused the same way', async () => {
    const refused = await deleteTrimmingAction({}, form({ id: 'any-trimming-record' }));
    expect('refused before anything is looked up', /Chromia Operator login cannot delete a Trimming record/.test(String(refused.error)), true);
  });
  await step('Chromia Operator: Edit still saves', async () => {
    const saved = await stockyardEdit(n('4'), { slabRemarks: 'Edited by the operator' });
    expect('saved', Boolean(saved.savedAt), true);
  });
  runAs(GIBIN_IN_CHROMIA);

  // ── Delete from any table (change 5, 7 Nov 2026) ─────────────────────
  await step('Delete (as the Fab & Chromia Head, Chromia job): a stocked slab — gone from Current Stock and every count', async () =>
    deleteSlabRecordAction({}, form({ slabId: await slabId(n('4')), slabNo: n('4') })), { produced: -1, approved: -1, todayProduced: -1 });
  expect('its record and its stock entry are gone', [await prisma.chromiaSlab.count({ where: { slabNo: n('4') } }), await prisma.chromiaStockEntry.count({ where: { slab: { slabNo: n('4') } } })], [0, 0]);
  expect('and from Sent From Stock', n('4') in (await sentFromStock()), false);
  // That delete ran as the Fab & Chromia Head in his Chromia job; the rest as the local admin.
  runAs({});
  await step('Delete: a re-entered slab (…3-A) — its earlier entry …3 goes too, so nothing reappears', async () =>
    deleteSlabRecordAction({}, form({ slabId: await slabId(`${n('3')}-A`), slabNo: `${n('3')}-A` })), { produced: -1, inProcessing: -1, todayProduced: -1 });
  expect('both entries gone', await prisma.chromiaSlab.count({ where: { slabNo: { in: [n('3'), `${n('3')}-A`] } } }), 0);
  await step('Delete: a slab in Trimming — its Trimming record goes with it', async () =>
    deleteSlabRecordAction({}, form({ slabId: await slabId(n('8')), slabNo: n('8') })), { produced: -1, stock: -1, todayProduced: -1 });
  expect('no Trimming record left for it', await prisma.chromiaTrimming.count({ where: { slab: { slabNo: n('8') } } }), 0);
  for (const gone of [n('4'), n('3'), `${n('3')}-A`, n('8')]) {
    const at = created.findIndex((s) => s.slabNo === gone);
    if (at >= 0) created.splice(at, 1);
  }

  // ── Orders: who may do what (19 Nov 2026) ─────────────────────────────
  // Orders read and write only chromia_order: no slab count moves (step()).
  const orderNamed = (designName: string) => prisma.chromiaOrder.findFirst({ where: { designName } });
  const designA = `WF${RUN} Design A`;
  const designB = `WF${RUN} Design B`;
  runAs({});
  await step('Orders (admin): a new order still needs its customer name', async () => {
    const refused = await saveOrderAction({}, form({ designName: designA, quantity: '5' }));
    expect('asks for the customer', Boolean(refused.fieldErrors?.customerName), true);
  });
  await step('Orders (admin): saved with its customer and Order Initiated By', async () => {
    const saved = await saveOrderAction({}, form({ customerName: `WF${RUN} Customer`, requestedBy: 'Sales desk', designName: designA, quantity: '5' }));
    expect('saved', Boolean(saved.savedAt), true);
  });
  runAs(OPERATOR);
  await step('Orders (Chromia Operator): a new order saves with no customer name', async () => {
    const saved = await saveOrderAction({}, form({ designName: designB, quantity: '11', requestedDeliveryDate: TODAY }));
    expect('saved', Boolean(saved.savedAt), true);
    expect('no customer, no initiator', await orderNamed(designB).then((o) => [o?.customerName, o?.requestedBy, o?.quantity]), ['', null, 11]);
  });
  await step('Orders (Chromia Operator): a customer name or initiator in the request is ignored', async () => {
    const before = await orderNamed(designA);
    const saved = await saveOrderAction({}, form({
      id: before!.id, customerName: 'Forged Customer', requestedBy: 'Forged', designName: designA, quantity: '5',
      requestedDeliveryDate: TODAY, actualDeliveryDate: TODAY,
    }));
    expect('saved', Boolean(saved.savedAt), true);
    const after = await orderNamed(designA);
    expect('customer and initiator kept; both delivery dates saved', [after?.customerName, after?.requestedBy, Boolean(after?.requestedDeliveryDate), Boolean(after?.actualDeliveryDate)],
      [`WF${RUN} Customer`, 'Sales desk', true, true]);
  });
  await step('Orders (Chromia Operator): Printing Completed? No on a new order, then Yes through Edit (21 Nov 2026)', async () => {
    const designP = `WF${RUN} Design P`;
    const created = await saveOrderAction({}, form({ designName: designP, quantity: '3', printingCompleted: 'NO' }));
    expect('saved with No', [Boolean(created.savedAt), (await orderNamed(designP))?.printingCompleted], [true, false]);
    const order = await orderNamed(designP);
    const edited = await saveOrderAction({}, form({ id: order!.id, designName: designP, quantity: '3', printingCompleted: 'YES' }));
    expect('updated to Yes; still no customer', [Boolean(edited.savedAt), (await orderNamed(designP))?.printingCompleted, (await orderNamed(designP))?.customerName], [true, true, '']);
    const row = (await listRecentOrders()).find((r) => r.designName === designP);
    expect('Recent Orders shows it at once', row?.printingCompleted, true);
    await prisma.chromiaOrder.delete({ where: { id: order!.id } });
  });
  await step('Orders (Chromia Operator): Delete is refused on the server', async () => {
    const order = await orderNamed(designA);
    const refused = await deleteOrderAction({}, form({ id: order!.id }));
    expect('refused, and says why', /Chromia Operator login cannot delete an order/.test(String(refused.error)), true);
    expect('still there', await prisma.chromiaOrder.count({ where: { id: order!.id } }), 1);
  });
  runAs(GIBIN_IN_CHROMIA);
  await step('Orders (Fab & Chromia Head): adds the customer to the operator\'s order', async () => {
    const order = await orderNamed(designB);
    const saved = await saveOrderAction({}, form({ id: order!.id, customerName: `WF${RUN} Late Customer`, designName: designB, quantity: '11' }));
    expect('saved', Boolean(saved.savedAt), true);
    expect('customer now set', (await orderNamed(designB))?.customerName, `WF${RUN} Late Customer`);
  });
  await step('Orders (Fab & Chromia Head): deletes both orders, for good', async () => {
    for (const design of [designA, designB]) {
      const order = await orderNamed(design);
      const done = await deleteOrderAction({}, form({ id: order!.id }));
      expect(`${design} deleted`, Boolean(done.deletedAt), true);
    }
    expect('no workflow order left', await prisma.chromiaOrder.count({ where: { designName: { startsWith: `WF${RUN}` } } }), 0);
    expect('each delete is in the audit log', await prisma.chromiaAuditLog.count({ where: { entity: 'Order', action: 'DELETE', changes: { path: ['designName'], string_starts_with: `WF${RUN}` } } }), 2);
  });
  runAs({});

  // ── Clean up: the database is back where it started ────────────────────
  for (const slab of [...created].reverse()) {
    await deleteSlabRecordAction({}, form({ slabId: slab.id, slabNo: slab.slabNo }));
  }
  const end = await snapshot();
  expect('back where it started', end, start);
  const left = await prisma.chromiaSlab.count({ where: { slabNo: { startsWith: `WF${RUN}` } } });
  expect('no workflow slab left', left, 0);

  console.log(failures === 0 ? `\nAll ${steps} steps pass, each with the full audit.` : `\n${failures} FAILURE(S) in ${steps} steps.`);
}

main()
  .catch((error) => {
    failures += 1;
    console.error(error);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
  });
