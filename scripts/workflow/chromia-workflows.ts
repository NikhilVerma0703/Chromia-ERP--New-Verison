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

  // ── Edits never duplicate ─────────────────────────────────────────────
  await step('Slab Records Edit: thickness corrected — the same record', async () =>
    saveSlabEntryAction({}, form({ qcMode: 'none', slabId: await slabId(n('2')), entryDate: TODAY, receivedDate: TODAY, inTime: '09:30', batchNo: BATCH, slabNo: n('2'), baseMaterial: MATERIAL, fileName: DESIGN, thicknessCm: '1.8', slabRemarks: 'corrected' })));
  expect('one record named so', await prisma.chromiaSlab.count({ where: { slabNo: n('2') } }), 1);

  // ── One physical slab: 14567 and 14567-A ──────────────────────────────
  await step('A re-entered slab (…3-A) is the same physical slab, where its latest record is', () => enter(`${n('3')}-A`), { sampleCutting: -1, inProcessing: 1 });

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
