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
import { loadTrimmingRecord } from '@/lib/chromia/server/repositories/trimming-repository';
import { listSentFromStock } from '@/lib/chromia/server/repositories/stockyard-repository';
import { updateStockyardSlabAction } from '@/lib/chromia/server/actions/stockyard-edit';
import { loadProductionDashboard } from '@/lib/chromia/server/repositories/dashboard-repository';
import { loadRecalibrationBoard, loadSlabTrips } from '@/lib/chromia/server/repositories/recalibration-flow-repository';
import { loadSlabRecord } from '@/lib/chromia/server/repositories/slab-record-repository';
import { toDateInput, toTimeInput } from '@/lib/chromia/operator-register';

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
    ready: board.kpis.ready,
    sent: board.kpis.sent,
    received: board.kpis.received,
    pending: board.kpis.pending,
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
  await step('QC: Grade C → Recalibration — Ready', () => enter(n('5'), { grade: 'C', disposition: 'RECALIBRATION', reason: 'Pinholes' }), { produced: 1, recalibration: 1, ready: 1, todayProduced: 1 });
  expect('status', (await statusOf(n('5'))).label, 'Ready for Recalibration');
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const ord = ['1st', '2nd', '3rd', '4th', '5th'][attempt - 1];
    await step(`Attempt ${attempt}: sent`, () => recalibrationForm(n('5'), { sentDate: TODAY }), { ready: -1, sent: 1, pending: 1 });
    expect(`attempt ${attempt} out`, await statusOf(n('5')), { status: 'OUT_FOR_RECALIBRATION', location: 'EXTERNAL_FACILITY', label: `Sent for ${ord} Time Recalibration` });
    await step(`Attempt ${attempt}: received`, () => recalibrationForm(n('5'), { receivedDate: TODAY }), { received: 1, pending: -1 });
    expect(`attempt ${attempt} back`, await statusOf(n('5')), { status: 'RECEIVED_FROM_RECALIBRATION', location: 'YARD', label: `Received from the ${ord} Time Recalibration` });
    await step(`Attempt ${attempt}: back on the line`, () => recalibrationForm(n('5'), { inTime: '11:00' }), { recalibration: -1, inProcessing: 1 });
    expect(`attempt ${attempt} in processing`, (await statusOf(n('5'))).label, `In Processing — After Attempt ${attempt}`);
    if (attempt < 5) {
      await step(`Attempt ${attempt}: QC Grade C again — Need the next`, () => recalibrationForm(n('5'), { grade: 'C', disposition: 'RECALIBRATION', recalibrationReason: 'Pinholes' }), { recalibration: 1, inProcessing: -1, ready: 1 });
      expect(`after attempt ${attempt}`, (await statusOf(n('5'))).label, `Need ${['2nd', '3rd', '4th', '5th'][attempt - 1]} Time Recalibration`);
    }
  }
  await step('After the 5th: Grade C again — written off', () => recalibrationForm(n('5'), { grade: 'C', disposition: 'RECALIBRATION', recalibrationReason: 'Pinholes' }), { recalibration: 1, inProcessing: -1 });
  expect('written off', (await statusOf(n('5'))).label, 'Written Off / Waste');

  await step('QC: Grade C → Recalibration (a second slab)', () => enter(n('6'), { grade: 'C', disposition: 'RECALIBRATION', reason: 'Half Print' }), { produced: 1, recalibration: 1, ready: 1, todayProduced: 1 });
  await step('…sent and received in one save', () => recalibrationForm(n('6'), { sentDate: TODAY, receivedDate: TODAY }), { ready: -1, sent: 1, received: 1 });
  await step('…its new pass, graded A → Stock: cleared into Current Stock', () => recalibrationForm(n('6'), { inTime: '12:00', grade: 'A' }), { recalibration: -1, stock: 1 });
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
    stockyardEdit(n('1'), { form: 'dispatched', destination: 'RECALIBRATION', alterDate: TODAY }), { dispatched: -1, recalibration: 1, ready: 1 });
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
    { trimming: -1, recalibration: 1, ready: 1 });
  // Sent and received, back on the line, then re-graded C with a forged
  // Trimming: the Recalibration page's Grade C is Recalibration only, so the
  // server sets it — the slab never reaches Trimming.
  await step('Recalibration re-grade: Grade C stays Recalibration, even when Trimming is sent', async () => {
    await recalibrationForm(n('7'), { sentDate: TODAY, receivedDate: TODAY });
    await recalibrationForm(n('7'), { inTime: '12:00' });
    return recalibrationForm(n('7'), { grade: 'C', disposition: 'TRIMMING' });
  }, { sent: 1, received: 1 });
  expect('the re-grade sent it to Recalibration, not Trimming', (await statusOf(n('7'))).label, 'Need 2nd Time Recalibration');
  expect('its outcome', (await prisma.chromiaSlab.findUniqueOrThrow({ where: { slabNo: n('7') }, select: { currentDisposition: true } })).currentDisposition, 'RECALIBRATION');

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

  // ── Edits never duplicate ─────────────────────────────────────────────
  await step('Slab Records Edit: thickness corrected — the same record', async () =>
    saveSlabEntryAction({}, form({ qcMode: 'none', slabId: await slabId(n('2')), entryDate: TODAY, receivedDate: TODAY, inTime: '09:30', batchNo: BATCH, slabNo: n('2'), baseMaterial: MATERIAL, fileName: DESIGN, thicknessCm: '1.8', slabRemarks: 'corrected' })));
  expect('one record named so', await prisma.chromiaSlab.count({ where: { slabNo: n('2') } }), 1);

  // ── One physical slab: 14567 and 14567-A ──────────────────────────────
  await step('A re-entered slab (…3-A) is the same physical slab, where its latest record is', () => enter(`${n('3')}-A`), { sampleCutting: -1, inProcessing: 1 });

  // ── Delete from any table (change 5, 7 Nov 2026) ─────────────────────
  await step('Delete: a stocked slab — gone from Current Stock and every count', async () =>
    deleteSlabRecordAction({}, form({ slabId: await slabId(n('4')), slabNo: n('4') })), { produced: -1, approved: -1, todayProduced: -1 });
  expect('its record and its stock entry are gone', [await prisma.chromiaSlab.count({ where: { slabNo: n('4') } }), await prisma.chromiaStockEntry.count({ where: { slab: { slabNo: n('4') } } })], [0, 0]);
  expect('and from Sent From Stock', n('4') in (await sentFromStock()), false);
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
