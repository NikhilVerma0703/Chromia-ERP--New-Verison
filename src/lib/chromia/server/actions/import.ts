'use server';

import { revalidatePath } from 'next/cache';
import * as XLSX from 'xlsx';

import { requireChromiaAdmin } from '@/lib/chromia/current-user';
import { isAppError } from '@/lib/chromia/errors';
import { findDuplicateSlabNos, parseRegister } from '@/lib/chromia/import/pro-register';
import {
  deleteImportBatch,
  importProRegister,
  type ImportSummary,
} from '@/lib/chromia/server/services/import-service';

const MAX_BYTES = 10 * 1024 * 1024;

export interface ImportFormState {
  error?: string;
  summary?: ImportSummary;
  preview?: {
    fileName: string;
    sheetName: string;
    parsedRows: number;
    skipped: number;
    issues: { sourceRow: number; reason: string }[];
    duplicates: string[];
    sample: {
      sourceRow: number;
      slabNo: string;
      batchNo: string;
      materialName: string;
      designFile: string | null;
      receivedDate: string;
      remark: string | null;
      disposition: string | null;
      grade: string | null;
    }[];
  };
}

/**
 * A file is missing one or more of the six required columns — say which, by
 * name, instead of a bare failure. Column order does not matter and extra
 * columns are ignored, so the only thing to fix is the ones named here.
 */
function missingColumnsMessage(missing: string[]): string {
  const plural = missing.length === 1 ? '' : 's';
  return `This file is missing required column${plural}: ${missing.join(', ')}. Column order does not matter and extra columns are fine — add the missing column${plural} and import again.`;
}

/** Read the uploaded workbook into a row matrix. */
async function readSheet(file: File) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) throw new Error('The workbook has no sheets.');

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error('The first sheet could not be read.');

  // raw:true + cellDates:true hands back real Date objects. With raw:false
  // SheetJS formats them as "5/1/26", which JS parses as the year 2001.
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: true,
    defval: null,
    raw: true,
  });

  return { sheetName, rows };
}

function validateFile(file: FormDataEntryValue | null): File {
  if (!(file instanceof File) || file.size === 0) {
    throw new Error('Choose an .xlsx file to import.');
  }
  if (file.size > MAX_BYTES) {
    throw new Error('That file is larger than 10 MB.');
  }
  if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) {
    throw new Error('Only Excel workbooks (.xlsx) are supported.');
  }
  return file;
}

/*
 * ADMIN-ONLY, all three (the owner's decision on CHR-4 of the code review of
 * 20 Oct 2026; see requireChromiaAdmin). An import writes a whole month of
 * slabs, and deleting one removes every slab it brought in; both were open to
 * every Chromia login. The preview writes nothing, but it is the first half of
 * the same act on the same form, which the Import page now shows to admins
 * only — so it asks the same question rather than parse a 10 MB workbook for a
 * login that cannot go on to import it.
 */

/** Dry run — parse and report, write nothing. */
export async function previewImportAction(
  _previousState: ImportFormState,
  formData: FormData,
): Promise<ImportFormState> {
  try {
    await requireChromiaAdmin('import a production register');
    const file = validateFile(formData.get('file'));
    const { sheetName, rows } = await readSheet(file);
    const result = parseRegister(rows);

    if (result.missingColumns && result.missingColumns.length > 0) {
      return { error: missingColumnsMessage(result.missingColumns) };
    }

    return {
      preview: {
        fileName: file.name,
        sheetName,
        parsedRows: result.rows.length,
        skipped: result.skipped,
        issues: result.issues.slice(0, 25),
        duplicates: findDuplicateSlabNos(result.rows).slice(0, 25),
        sample: result.rows.slice(0, 10).map((row) => ({
          sourceRow: row.sourceRow,
          slabNo: row.slabNo,
          batchNo: row.batchNo,
          materialName: row.materialName,
          designFile: row.designFile,
          receivedDate: row.receivedDate.toISOString().slice(0, 10),
          remark: row.remark,
          disposition: row.disposition,
          grade: row.grade,
        })),
      },
    };
  } catch (error) {
    if (isAppError(error) || error instanceof Error) return { error: error.message };
    throw error;
  }
}

/** Commit — parse and write. */
export async function runImportAction(
  _previousState: ImportFormState,
  formData: FormData,
): Promise<ImportFormState> {
  try {
    const user = await requireChromiaAdmin('import a production register');
    const file = validateFile(formData.get('file'));
    const periodLabel = String(formData.get('periodLabel') ?? '').trim() || null;

    const { sheetName, rows } = await readSheet(file);
    const parsed = parseRegister(rows);

    if (parsed.missingColumns && parsed.missingColumns.length > 0) {
      return { error: missingColumnsMessage(parsed.missingColumns) };
    }

    if (parsed.rows.length === 0) {
      return { error: 'No slab rows were found in that sheet.' };
    }

    const summary = await importProRegister(
      parsed,
      { sourceFile: file.name, sheetName, periodLabel },
      user.id,
    );

    revalidatePath('/chromia/slabs');
    revalidatePath('/chromia/dashboard');
    revalidatePath('/chromia/recalibrations');

    return { summary };
  } catch (error) {
    if (isAppError(error) || error instanceof Error) return { error: error.message };
    throw error;
  }
}

export interface DeleteImportState {
  error?: string;
  /** Set on success — how many slabs the delete removed. */
  deleted?: number;
  /** Slabs the file brought in that were worked on by hand since, and kept (CHR-2). */
  kept?: number;
  sourceFile?: string;
}

/**
 * Delete a previously imported file: the batch record and every slab it
 * brought in that nobody has worked on since, through the same cascade a
 * single slab's delete uses. A slab graded, dispatched or otherwise worked on
 * by hand is kept (the code review of 20 Oct 2026, CHR-2; deleteImportBatch).
 */
export async function deleteImportAction(
  _previousState: DeleteImportState,
  formData: FormData,
): Promise<DeleteImportState> {
  const importBatchId = String(formData.get('importBatchId') ?? '').trim();
  if (!importBatchId) return { error: 'That import could not be identified.' };

  try {
    const user = await requireChromiaAdmin('delete an imported file');
    const result = await deleteImportBatch(importBatchId, user.id);

    revalidatePath('/chromia/import');
    revalidatePath('/chromia/slabs');
    revalidatePath('/chromia/dashboard');
    revalidatePath('/chromia/recalibrations');

    return { deleted: result.deleted, kept: result.kept, sourceFile: result.sourceFile };
  } catch (error) {
    if (isAppError(error) || error instanceof Error) return { error: error.message };
    throw error;
  }
}
