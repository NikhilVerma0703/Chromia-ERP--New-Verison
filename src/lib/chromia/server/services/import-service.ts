import { randomUUID } from 'node:crypto';

import { ChromiaAuditAction as AuditAction, ChromiaCycleStatus as CycleStatus, ChromiaDisposition as Disposition, ChromiaImportStatus as ImportStatus, ChromiaRecalibrationStatus as RecalibrationStatus, ChromiaSlabEventType as SlabEventType, ChromiaSlabStatus as SlabStatus } from '@prisma/client';
import { MAX_RECALIBRATION_ATTEMPTS } from '@/lib/chromia/constants/process-stages';
import { prisma, type ChromiaTx } from '@/lib/chromia/db';
import { NotFoundError } from '@/lib/chromia/errors';
import { createLogger } from '@/lib/chromia/logger';
import { daysBetween, toDateColumn } from '@/lib/chromia/utils/dates';
import { importStatus, importSummaryLine } from '@/lib/chromia/import/outcome';
import {
  importCreatedNote,
  importGradeNote,
  onlyImportEvents,
  untouchedSinceImport,
} from '@/lib/chromia/import/undo';
import type { ParsedSlabRow, ParseResult } from '@/lib/chromia/import/pro-register';
import { markSlabsChromia, unmarkSlabsChromia } from '@/lib/chromia/inventory-bridge';

const log = createLogger('import');

export interface ImportSummary {
  importBatchId: string;
  totalRows: number;
  imported: number;
  /** Slabs already in the ERP, left untouched. */
  alreadyPresent: number;
  /** Blank spacer rows the sheet carries. Not slabs. */
  blankRows: number;
  /** Rows the parser could not read at all. */
  unreadable: number;
  /** Rows that threw while being written. The only real failures. */
  failed: number;
  /** What happened, in one line — see importSummaryLine. */
  line: string;
  /** Everything worth showing: unreadable rows, skips and failures alike. */
  errors: { sourceRow: number; reason: string }[];
}

/** Slug a free-text name into a stable master-data code. */
function toCode(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

/** Status implied by an imported row's disposition. */
function statusFor(row: ParsedSlabRow): SlabStatus {
  switch (row.disposition) {
    case Disposition.DISPATCH:
      return SlabStatus.DISPATCHED;
    case Disposition.STOCK:
      return SlabStatus.IN_STOCK;
    case Disposition.SAMPLE_CUTTING:
      return SlabStatus.SAMPLE_CUT;
    case Disposition.WASTE:
      return SlabStatus.WASTE;
    case Disposition.RECALIBRATION:
      return row.recalReceivedDate
        ? SlabStatus.RECEIVED_FROM_RECALIBRATION
        : SlabStatus.OUT_FOR_RECALIBRATION;
    default:
      return SlabStatus.IN_PROCESS;
  }
}

/**
 * Rows written per transaction. A chunk is one transaction of about ten
 * statements however many rows it holds — one createMany per table — so a
 * thousand-row register is ten of them instead of ten thousand round trips.
 */
const IMPORT_CHUNK_ROWS = 100;

/** A chunk's transaction: room for a hundred rows on a slow connection. */
const IMPORT_CHUNK_TX = { maxWait: 10_000, timeout: 30_000 } as const;

/** Deleting an import: a month of slabs and everything that cascades from them. */
const IMPORT_DELETE_TX = { maxWait: 10_000, timeout: 30_000 } as const;

/** One register row, resolved and given its ids, ready to be written. */
interface PreparedRow {
  row: ParsedSlabRow;
  slabId: string;
  cycleId: string;
  status: SlabStatus;
  baseMaterialId: string;
  plannedDesignId: string | null;
}

/** Statuses that leave a slab physically AT Chromia — see `atChromia` below. */
const AT_CHROMIA = new Set<SlabStatus>([
  SlabStatus.IN_PROCESS,
  SlabStatus.IN_STOCK,
  SlabStatus.OUT_FOR_RECALIBRATION,
  SlabStatus.RECEIVED_FROM_RECALIBRATION,
]);

/**
 * Write prepared rows — a chunk, or one row on its own — inside the caller's
 * transaction. The same records the importer has always written for a row,
 * one createMany per table instead of one create per record:
 *
 *   the production batch (found, or created from the first row that names it),
 *   the slab, its first cycle, its SLAB_CREATED event; when the remark carries
 *   a grade, the grade decision and its GRADE_ASSIGNED event; for a
 *   recalibration row, its trip; and the outcome record the remark names —
 *   dispatch, stock or sample cutting — dated on the register's last column.
 *
 * Ids are made here (randomUUID, the same v4 ids @default(uuid()) makes) so
 * the rows of one table can point at the rows of another without reading
 * anything back.
 */
async function writePreparedRows(
  tx: ChromiaTx,
  rows: readonly PreparedRow[],
  context: {
    userId: string;
    importBatchId: string;
    meta: { sourceFile: string; sheetName: string };
    reasonIds: Map<string, string>;
  },
) {
  const { userId, importBatchId, meta, reasonIds } = context;

  // Production batches: found by number, or created from the first row in the
  // sheet that names one — exactly what the per-row findUnique-or-create did.
  // skipDuplicates covers a batch another import or the register made a
  // moment ago; the second read then finds it.
  const batchNos = [...new Set(rows.map((p) => p.row.batchNo))];
  const known = await tx.chromiaBatch.findMany({
    where: { batchNo: { in: batchNos } },
    select: { id: true, batchNo: true },
  });
  const missing = batchNos.filter((no) => !known.some((batch) => batch.batchNo === no));
  if (missing.length > 0) {
    await tx.chromiaBatch.createMany({
      data: missing.map((batchNo) => {
        const first = rows.find((p) => p.row.batchNo === batchNo)!;
        return {
          batchNo,
          baseMaterialId: first.baseMaterialId,
          receivedDate: first.row.receivedDate,
          createdById: userId,
        };
      }),
      skipDuplicates: true,
    });
    known.push(
      ...(await tx.chromiaBatch.findMany({
        where: { batchNo: { in: missing } },
        select: { id: true, batchNo: true },
      })),
    );
  }
  const batchIdOf = new Map(known.map((batch) => [batch.batchNo, batch.id]));

  await tx.chromiaSlab.createMany({
    data: rows.map(({ row, slabId, status, baseMaterialId, plannedDesignId }) => ({
      id: slabId,
      slabNo: row.slabNo,
      batchId: batchIdOf.get(row.batchNo)!,
      baseMaterialId,
      plannedDesignId,
      status,
      currentCycleNumber: 1,
      currentGrade: row.grade,
      currentDisposition: row.disposition,
      originalThicknessMm: row.thicknessMm,
      currentThicknessMm: row.thicknessMm,
      recalibrationCount: row.disposition === Disposition.RECALIBRATION ? 1 : 0,
      isRecalibrationOut: status === SlabStatus.OUT_FOR_RECALIBRATION,
      receivedDate: row.receivedDate,
      legacySourceFile: meta.sourceFile,
      legacySheetName: meta.sheetName,
      legacySourceRow: row.sourceRow,
      legacyRemark: row.remark,
      importBatchId,
      createdById: userId,
      updatedById: userId,
    })),
  });

  // Each production batch counts exactly the slabs this write gave it.
  const perBatch = new Map<string, number>();
  for (const { row } of rows) {
    const id = batchIdOf.get(row.batchNo)!;
    perBatch.set(id, (perBatch.get(id) ?? 0) + 1);
  }
  for (const [id, count] of perBatch) {
    await tx.chromiaBatch.update({ where: { id }, data: { totalSlabs: { increment: count } } });
  }

  await tx.chromiaProcessCycle.createMany({
    data: rows.map(({ row, slabId, cycleId, plannedDesignId }) => {
      // An explicit in-time when the file carried one, else the production
      // date — the same fallback the operator entry uses.
      const inTime = row.inTime ?? row.receivedDate;
      const outTime = row.fullyPrintedDate ?? row.bypassedDate ?? null;
      return {
        id: cycleId,
        slabId,
        cycleNumber: 1,
        designId: plannedDesignId,
        inTime,
        outTime,
        // The register's own "fully printed" column. It doubles as the
        // out-time, since that is when the slab left the line, but it is also
        // kept in its own column so the download sheets can show it.
        fullyPrintedDate: toDateColumn(row.fullyPrintedDate),
        processingMinutes:
          outTime && inTime
            ? Math.max(0, Math.round((outTime.getTime() - inTime.getTime()) / 60_000))
            : null,
        status: outTime ? CycleStatus.COMPLETED : CycleStatus.ACTIVE,
        completedAt: outTime,
        disposition: row.disposition,
        finalGrade: row.grade,
        createdById: userId,
      };
    }),
  });

  // The remark's grade and outcome, recorded as a real grade decision so a
  // historical row carries the same Grade + Outcome a slab graded at QC does —
  // not just a disposition with no grade behind it. Each slab's events go in
  // the order they always did: created, then graded.
  const graded = rows.filter((p) => p.row.grade && p.row.disposition);

  await tx.chromiaSlabEvent.createMany({
    data: rows.flatMap(({ row, slabId, cycleId, status }) => [
      {
        slabId,
        cycleId,
        eventType: SlabEventType.SLAB_CREATED,
        toStatus: status,
        userId,
        occurredAt: row.receivedDate,
        note: importCreatedNote(meta.sourceFile, row.sourceRow, row.remark),
      },
      ...(row.grade && row.disposition
        ? [
            {
              slabId,
              cycleId,
              eventType: SlabEventType.GRADE_ASSIGNED,
              toStatus: status,
              userId,
              occurredAt: row.receivedDate,
              note: importGradeNote(row.grade, row.disposition),
            },
          ]
        : []),
    ]),
  });

  if (graded.length > 0) {
    await tx.chromiaGradeDecision.createMany({
      data: graded.map(({ row, slabId, cycleId }) => ({
        cycleId,
        slabId,
        grade: row.grade!,
        disposition: row.disposition!,
        reason: 'Graded from register remark on import',
        remarks: row.remark,
        decidedById: userId,
        decidedAt: row.receivedDate,
        attemptNumberAtDecision: 1,
      })),
    });
  }

  const recalibrated = rows.filter((p) => p.row.disposition === Disposition.RECALIBRATION);
  if (recalibrated.length > 0) {
    await tx.chromiaRecalibrationCycle.createMany({
      data: recalibrated.map(({ row, slabId, cycleId }) => {
        const sentDate = row.recalSentDate ?? row.receivedDate;
        const receivedDate = row.recalReceivedDate;
        return {
          slabId,
          attemptNumber: 1,
          status: receivedDate ? RecalibrationStatus.RECEIVED : RecalibrationStatus.SENT,
          failedCycleId: cycleId,
          reasonId: row.recalibrationReasonCode
            ? (reasonIds.get(row.recalibrationReasonCode) ?? null)
            : null,
          reasonNotes: row.remark,
          sentDate,
          receivedDate,
          turnaroundDays: receivedDate ? daysBetween(sentDate, receivedDate) : null,
          createdById: userId,
        };
      }),
    });
  }

  // The register's last date column is the day the slab left the line,
  // whatever the outcome. Which record it becomes is decided by the remark,
  // NOT by the presence of a date — a row remarked "Stock" with a date in that
  // column is a stock entry, not a dispatch.
  const outcomeDate = (row: ParsedSlabRow) => row.dispatchDate ?? row.receivedDate;
  const withOutcome = (disposition: Disposition) => rows.filter((p) => p.row.disposition === disposition);

  const dispatched = withOutcome(Disposition.DISPATCH);
  if (dispatched.length > 0) {
    await tx.chromiaDispatch.createMany({
      data: dispatched.map(({ row, slabId }) => ({
        slabId,
        dispatchDate: outcomeDate(row),
        dispatchedById: userId,
      })),
    });
  }

  const stocked = withOutcome(Disposition.STOCK);
  if (stocked.length > 0) {
    await tx.chromiaStockEntry.createMany({
      data: stocked.map(({ row, slabId }) => ({
        slabId,
        stockDate: outcomeDate(row),
        notes: row.remark,
        createdById: userId,
      })),
    });
  }

  const cut = withOutcome(Disposition.SAMPLE_CUTTING);
  if (cut.length > 0) {
    await tx.chromiaSampleCutting.createMany({
      data: cut.map(({ row, slabId }) => ({
        slabId,
        cutDate: outcomeDate(row),
        purpose: row.remark,
        doneById: userId,
      })),
    });
  }
}

/**
 * Load a parsed monthly register into the database.
 *
 * Every imported slab keeps a pointer back to its origin — source file, sheet,
 * row number and the original remark text — so an imported record can always
 * be reconciled against the spreadsheet it came from.
 *
 * Rows whose slab number already exists are skipped rather than overwritten:
 * live data always wins over an import.
 *
 * ── IN CHUNKS, AND RESUMABLE (the code review of 20 Oct 2026, CHR-7) ─────
 * It used to be one row at a time: a findUnique, then a transaction of five to
 * nine statements — about ten thousand round trips for a thousand-row month,
 * on a page with no maxDuration. Cut off at row 600, it left 600 slabs on an
 * import stuck at PROCESSING that said 0 imported, and the finished-goods
 * CHROMIA mark, which ran once after the loop, never ran at all; importing the
 * file again skipped the 600 as "already exists" and never marked them either.
 * Now:
 *   • one read finds every slab number already in the ERP;
 *   • a number the sheet repeats waits for its first row, and is written only
 *     when that row failed, as the row-by-row importer did;
 *   • the rest are written a hundred to a transaction (writePreparedRows). If
 *     a chunk fails as a whole — one bad row aborts its transaction — its rows
 *     are written again one at a time, as before, so the bad row fails alone
 *     and the others land;
 *   • after every chunk the import's counters are saved and the chunk's slabs
 *     at Chromia are marked in finished goods, so a run cut off part-way says
 *     how far it got and has marked what it wrote;
 *   • an import of the same file finishes a cut-off one: rows already in are
 *     left alone, and those a run that never finished left at Chromia get the
 *     mark they missed (the bridge is idempotent — see inventory-bridge.ts);
 *   • the import page states its deadline (maxDuration, IMPORT_MAX_SECONDS).
 */
export async function importProRegister(
  parseResult: ParseResult,
  meta: { sourceFile: string; sheetName: string; periodLabel: string | null },
  userId: string,
): Promise<ImportSummary> {
  const startedAt = new Date();

  const importBatch = await prisma.chromiaImportBatch.create({
    data: {
      sourceFile: meta.sourceFile,
      sheetName: meta.sheetName,
      periodLabel: meta.periodLabel,
      status: ImportStatus.PROCESSING,
      totalRows: parseResult.rows.length,
      startedAt,
      importedById: userId,
    },
  });

  /*
   * Three outcomes, counted separately.
   *
   * They used to share one `errors` array, and the status was then decided by
   * how long that array was — so a SKIP counted as a fault. A skip is the
   * documented behaviour of this importer ("live data always wins"), and the
   * register produces them on a first import too, because it repeats a slab
   * number when a slab comes back from recalibration. The result was a clean
   * import reported as PARTIAL and a re-import reported as FAILED, both beside
   * a "Failed: 0" that contradicted them. See lib/chromia/import/outcome.ts.
   *
   * `notes` is what the screen lists; the counters are what the status is
   * decided from. Keeping them apart is the fix.
   */
  const notes: { sourceRow: number; reason: string }[] = [...parseResult.issues];
  const unreadable = parseResult.issues.length;
  const blankRows = parseResult.skipped;
  let imported = 0;
  let failed = 0;
  let alreadyPresent = 0;

  // ONE READ for every slab number in the sheet, instead of one per row.
  const existing = await prisma.chromiaSlab.findMany({
    where: { slabNo: { in: [...new Set(parseResult.rows.map((row) => row.slabNo))] } },
    select: {
      slabNo: true,
      status: true,
      deletedAt: true,
      importBatch: { select: { completedAt: true } },
    },
  });
  const inErp = new Set(existing.map((slab) => slab.slabNo));

  // A slab number already in the ERP is left untouched.
  //
  // A number the sheet itself repeats (a slab back from recalibration) is held
  // back until the rows before it are written: its first row is the one that
  // counts, exactly as the row-by-row importer found the first already there
  // by the time it reached the second. And when that first row FAILED, the
  // row-by-row importer found nothing there and wrote the second instead —
  // so does this one, after the chunks (see `repeats` below), rather than
  // calling it "already exists" when it does not.
  const toWrite: ParsedSlabRow[] = [];
  const repeats: ParsedSlabRow[] = [];
  const queued = new Set<string>();
  const alreadyExists = (row: ParsedSlabRow) => {
    alreadyPresent += 1;
    notes.push({
      sourceRow: row.sourceRow,
      reason: `Slab ${row.slabNo} already exists — left untouched`,
    });
  };
  for (const row of parseResult.rows) {
    if (inErp.has(row.slabNo)) {
      alreadyExists(row);
      continue;
    }
    if (queued.has(row.slabNo)) {
      repeats.push(row);
      continue;
    }
    queued.add(row.slabNo);
    toWrite.push(row);
  }

  // A RE-IMPORT FINISHES A CUT-OFF ONE. Slabs an earlier import created but
  // never got to mark — that run never finished, so it has no completedAt —
  // and that are at Chromia still, by their live status, are marked now.
  // Already-marked slabs are a silent no-op in the bridge; slabs entered on
  // the register, and imports that finished, are not touched.
  const unmarked = existing
    .filter(
      (slab) =>
        slab.deletedAt === null &&
        slab.importBatch !== null &&
        slab.importBatch.completedAt === null &&
        AT_CHROMIA.has(slab.status),
    )
    .map((slab) => slab.slabNo);
  if (unmarked.length > 0) {
    await markSlabsChromia(unmarked, null);
    log.info({ count: unmarked.length }, 'Marked slabs a cut-off import left at Chromia');
  }

  // Resolve (and create where needed) the master data the sheet references.
  const materialIds = new Map<string, string>();
  const designIds = new Map<string, string>();
  const reasonIds = new Map<string, string>();

  for (const reason of await prisma.chromiaRecalibrationReason.findMany({
    select: { id: true, code: true },
  })) {
    reasonIds.set(reason.code, reason.id);
  }

  async function materialId(name: string): Promise<string> {
    const key = name.toUpperCase();
    const cached = materialIds.get(key);
    if (cached) return cached;

    const record = await prisma.chromiaBaseMaterial.upsert({
      where: { code: toCode(name) },
      update: {},
      create: { code: toCode(name), name },
      select: { id: true },
    });
    materialIds.set(key, record.id);
    return record.id;
  }

  async function designId(fileName: string): Promise<string> {
    const key = fileName.toUpperCase();
    const cached = designIds.get(key);
    if (cached) return cached;

    const record = await prisma.chromiaDesign.upsert({
      where: { code: toCode(fileName) },
      update: {},
      create: { code: toCode(fileName), name: fileName, fileName },
      select: { id: true },
    });
    designIds.set(key, record.id);
    return record.id;
  }

  const fail = (row: ParsedSlabRow, error: unknown) => {
    failed += 1;
    notes.push({
      sourceRow: row.sourceRow,
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
  };

  const context = { userId, importBatchId: importBatch.id, meta, reasonIds };

  /**
   * Write some rows — a chunk, or one row on its own — and say which landed.
   * A row that cannot be resolved or written is counted as failed, with its
   * reason, and the rest still land.
   */
  async function writeRows(rows: readonly ParsedSlabRow[]): Promise<PreparedRow[]> {
    const prepared: PreparedRow[] = [];
    for (const row of rows) {
      try {
        prepared.push({
          row,
          slabId: randomUUID(),
          cycleId: randomUUID(),
          status: statusFor(row),
          baseMaterialId: await materialId(row.materialName),
          plannedDesignId: row.designFile ? await designId(row.designFile) : null,
        });
      } catch (error) {
        fail(row, error);
      }
    }

    let landed: PreparedRow[] = [];
    try {
      if (prepared.length > 0) {
        await prisma.$transaction((tx) => writePreparedRows(tx, prepared, context), IMPORT_CHUNK_TX);
      }
      landed = prepared;
    } catch (chunkError) {
      if (prepared.length === 1) {
        // A row on its own: its own transaction was the one that failed.
        fail(prepared[0]!.row, chunkError);
        return [];
      }
      // One bad row aborts the whole chunk's transaction. Write the chunk again
      // a row at a time, as the importer always did, so it fails alone.
      for (const one of prepared) {
        try {
          await prisma.$transaction((tx) => writePreparedRows(tx, [one], context));
          landed.push(one);
        } catch (error) {
          fail(one.row, error);
        }
      }
    }
    return landed;
  }

  // The slab numbers this run has written, so a repeat knows whether its
  // first row landed.
  const written = new Set<string>();

  for (let at = 0; at < toWrite.length; at += IMPORT_CHUNK_ROWS) {
    const landed = await writeRows(toWrite.slice(at, at + IMPORT_CHUNK_ROWS));
    for (const p of landed) written.add(p.row.slabNo);

    imported += landed.length;

    // How far it got, saved as it goes: a run cut off after this chunk shows
    // what it wrote rather than 0, and stays PROCESSING (see wasCutOff).
    await prisma.chromiaImportBatch.update({
      where: { id: importBatch.id },
      data: {
        importedRows: imported,
        skippedRows: alreadyPresent + blankRows,
        failedRows: failed,
      },
    });

    // Slabs this import leaves physically AT Chromia — in process, in Chromia
    // stock, or out at recalibration — are marked in finished goods, chunk by
    // chunk. A row the register already shows dispatched, wasted or cut for
    // samples left Chromia in its own month; stamping today's inventory
    // CHROMIA for it would be fiction. The bridge never throws, and a failure
    // costs the inventory annotation, not the import.
    const atChromia = landed.filter((p) => AT_CHROMIA.has(p.status)).map((p) => p.row.slabNo);
    if (atChromia.length > 0) await markSlabsChromia(atChromia, null);
  }

  // A NUMBER THE SHEET REPEATS, now that the rows before it are settled. When
  // its first row landed it is left untouched, as it always was. When that row
  // failed, the row-by-row importer reached this one with nothing there and
  // wrote it — so it is written now, on its own, and once one repeat of a
  // number lands any later one is "already exists" again. In sheet order, so
  // the row written is the one the old importer would have written.
  for (const row of repeats) {
    if (written.has(row.slabNo)) {
      alreadyExists(row);
      continue;
    }
    const [landed] = await writeRows([row]);
    if (!landed) continue;
    written.add(row.slabNo);
    imported += 1;
    if (AT_CHROMIA.has(landed.status)) await markSlabsChromia([row.slabNo], null);
  }

  // Listed in the sheet's order, as the row-by-row importer listed them: what
  // the parser could not read first, then each row's own note by its row.
  notes.push(...notes.splice(unreadable).sort((a, b) => a.sourceRow - b.sourceRow));

  const counts = { imported, alreadyPresent, blankRows, unreadable, failed };
  const status = importStatus(counts);
  const line = importSummaryLine(counts);

  await prisma.chromiaImportBatch.update({
    where: { id: importBatch.id },
    data: {
      status: ImportStatus[status],
      importedRows: imported,
      // The column has always been "rows not written". Both halves of that are
      // reported separately on screen; the stored figure keeps its old meaning
      // so previous runs stay comparable.
      skippedRows: alreadyPresent + blankRows,
      failedRows: failed,
      completedAt: new Date(),
      errorLog: notes.length > 0 ? notes : undefined,
    },
  });

  log.info({ sourceFile: meta.sourceFile, status, ...counts }, 'Register import finished');

  return {
    importBatchId: importBatch.id,
    totalRows: parseResult.rows.length,
    ...counts,
    line,
    errors: notes.slice(0, 50),
  };
}

/** What a delete did: the slabs removed, and those kept because work was done on them by hand. */
export interface DeleteImportResult {
  deleted: number;
  kept: number;
  sourceFile: string;
}

/**
 * Undo an import — remove the slabs a file brought in that nobody has worked
 * on since, and the batch record.
 *
 * WORK DONE BY HAND IS NEVER DELETED (the code review of 20 Oct 2026, CHR-2).
 * A slab goes only while it is exactly as the import left it — nobody has saved
 * it since, and every event in its history is the import's own (see
 * lib/chromia/import/undo.ts). A slab graded, dispatched, stocked, cut,
 * corrected, tripped or restarted by hand is KEPT, with everything recorded on
 * it; the database sets its link to the deleted import to null, and it keeps
 * the register's file, sheet, row and remark. It used to go too, and the
 * cascade took every hand-recorded grade, dispatch, stock entry, cycle and trip
 * with it, although the dialog promised they were untouched.
 *
 * What goes, goes by the same cascade a single delete uses, scoped to each
 * slab's own id. The split is decided inside the transaction, on the rows as
 * they stand, and the delete is guarded against a save made after that read,
 * so a slab graded a second before the delete stays. Each production batch
 * loses exactly the slabs that went, and an audit entry records both figures.
 *
 * The removed slabs' numbers are handed back to the plant, so a file imported
 * by mistake can be corrected and imported again.
 */
export async function deleteImportBatch(
  importBatchId: string,
  userId: string,
): Promise<DeleteImportResult> {
  const batch = await prisma.chromiaImportBatch.findUnique({
    where: { id: importBatchId },
    select: { id: true, sourceFile: true },
  });
  if (!batch) throw new NotFoundError('Import batch');

  const { removed, kept } = await prisma.$transaction(async (tx) => {
    const readAt = new Date();

    // As the import left it: every event its own (the filter), and never saved
    // since (untouchedSinceImport, on the two timestamps the read brings back).
    const candidates = await tx.chromiaSlab.findMany({
      where: { importBatchId, ...onlyImportEvents() },
      select: { id: true, batchId: true, slabNo: true, createdAt: true, updatedAt: true },
    });
    const removable = candidates.filter(untouchedSinceImport);

    // Guarded: a save after the read moves updatedAt past readAt, and an event
    // written since fails the filter again, so that slab is not deleted.
    for (let at = 0; at < removable.length; at += 500) {
      await tx.chromiaSlab.deleteMany({
        where: {
          id: { in: removable.slice(at, at + 500).map((slab) => slab.id) },
          importBatchId,
          updatedAt: { lt: readAt },
          ...onlyImportEvents(),
        },
      });
    }

    // What is left on the import is what was kept — and so what went is
    // exactly the candidates no longer there, whatever the guard decided.
    const remaining = await tx.chromiaSlab.findMany({
      where: { importBatchId },
      select: { id: true, slabNo: true },
    });
    const stillThere = new Set(remaining.map((slab) => slab.id));
    const gone = removable.filter((slab) => !stillThere.has(slab.id));

    // Each production batch loses exactly the slabs this delete removed.
    const perBatch = new Map<string, number>();
    for (const slab of gone) perBatch.set(slab.batchId, (perBatch.get(slab.batchId) ?? 0) + 1);
    for (const [id, count] of perBatch) {
      await tx.chromiaBatch.update({
        where: { id },
        data: { totalSlabs: { decrement: count } },
      });
    }

    await tx.chromiaAuditLog.create({
      data: {
        entity: 'ImportBatch',
        entityId: batch.id,
        action: AuditAction.DELETE,
        userId,
        changes: {
          sourceFile: batch.sourceFile,
          deletedSlabs: gone.length,
          keptSlabs: remaining.length,
          // Kept because they were worked on by hand — named, so the record
          // says which (the first fifty; the count is the whole of it).
          keptSlabNos: remaining.slice(0, 50).map((slab) => slab.slabNo),
        },
      },
    });

    // The kept slabs' link to it is set to null by the database (ON DELETE SET
    // NULL), which leaves their own rows — and their updatedAt — untouched.
    await tx.chromiaImportBatch.delete({ where: { id: batch.id } });

    return { removed: gone, kept: remaining.length };
  }, IMPORT_DELETE_TX);

  // The marks the import made go with the slabs that went — "a file imported
  // by mistake can be corrected and imported again" has to include the
  // finished-goods sheet, or a mistaken monthly import leaves hundreds of
  // slabs stranded CHROMIA. Guarded per slab: only a slab actually CHROMIA
  // moves back; the re-import then re-marks whatever the corrected file still
  // shows at Chromia. A kept slab is still at Chromia, and keeps its mark.
  await unmarkSlabsChromia(removed.map((s) => s.slabNo), null);

  log.warn({ importBatchId, deleted: removed.length, kept }, 'Import batch deleted');
  return { deleted: removed.length, kept, sourceFile: batch.sourceFile };
}

/**
 * For the Import page's Delete dialog: of each listed import, how many slabs
 * are still in the ERP, and how many of those a delete would remove now — by
 * the rule deleteImportBatch applies (lib/chromia/import/undo.ts).
 */
export async function importDeleteCounts(
  importBatchIds: readonly string[],
): Promise<Map<string, { slabs: number; removable: number }>> {
  const counts = new Map<string, { slabs: number; removable: number }>();
  if (importBatchIds.length === 0) return counts;

  const [totals, candidates] = await Promise.all([
    prisma.chromiaSlab.groupBy({
      by: ['importBatchId'],
      where: { importBatchId: { in: [...importBatchIds] } },
      _count: { _all: true },
    }),
    prisma.chromiaSlab.findMany({
      where: { importBatchId: { in: [...importBatchIds] }, ...onlyImportEvents() },
      select: { importBatchId: true, createdAt: true, updatedAt: true },
    }),
  ]);

  for (const row of totals) {
    if (row.importBatchId) counts.set(row.importBatchId, { slabs: row._count._all, removable: 0 });
  }
  for (const slab of candidates) {
    const entry = slab.importBatchId ? counts.get(slab.importBatchId) : undefined;
    if (entry && untouchedSinceImport(slab)) entry.removable += 1;
  }
  return counts;
}

export { MAX_RECALIBRATION_ATTEMPTS };
