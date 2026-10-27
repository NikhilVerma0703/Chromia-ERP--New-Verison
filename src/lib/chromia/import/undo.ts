/**
 * Deleting an import without deleting anybody's work.
 *
 * Pure and alias-free so `node --test` can reach it, the same split
 * outcome.ts uses. The database half — reading the slabs and removing them —
 * stays in server/services/import-service.ts (deleteImportBatch).
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 * The code review of 20 Oct 2026, CHR-2. A month's register is imported.
 * Rows whose remark maps to no outcome come in IN_PROCESS; recalibration rows
 * come in out or back. Over the following weeks the in-charge grades those
 * slabs on Operator Entry, sends some from the Dispatch page and restarts the
 * ones that came back. Then somebody deletes the import, to bring in a
 * corrected file. The dialog said "Slabs entered or graded by hand are not
 * touched" — and the delete removed every slab the import had brought in, and
 * by the database's cascade every grade, dispatch, stock entry, cycle and trip
 * recorded on them by hand since. The re-import then put them back only as
 * the spreadsheet described them.
 *
 * So a slab goes with its import only while it is still exactly as the import
 * left it. Two things say so, and both must hold:
 *
 *   • NOBODY HAS SAVED IT SINCE. Every hand action in the module — QC and its
 *     Edit, dispatch, stock, sample cutting, a trip, a restart, a Slab Records
 *     correction — saves the slab's own row, and Prisma moves updatedAt on
 *     every save. The importer creates the row and never saves it again, and
 *     Prisma stamps createdAt and updatedAt from the same clock reading when a
 *     row is created. A few seconds of tolerance covers a transaction that
 *     took its time; nobody grades a slab in the seconds the import is writing
 *     it.
 *   • EVERY EVENT IN ITS HISTORY IS ONE THE IMPORT WROTE: "Imported from …"
 *     when it was created and, when the remark carried a grade, "Grade A →
 *     Dispatch (from import remark)". Every hand action writes its own event,
 *     so one more is work. Both notes are built by the functions below, which
 *     the importer itself calls, so the marks and the check cannot drift apart.
 *
 * Everything else — anything graded, sent, stocked, cut, corrected or tripped
 * by hand — is KEPT, with its whole history. It stays in Slab Records under its
 * own number, carrying the register's file, sheet, row and remark as it always
 * did; only its link to the deleted import goes (the database sets it to null).
 * A re-import of the corrected file then leaves those slabs alone, as it
 * leaves every slab already in the ERP alone: live data wins.
 */

/** How the importer's own SLAB_CREATED note begins. */
export const IMPORT_CREATED_NOTE_PREFIX = 'Imported from ';

/** How the importer's own GRADE_ASSIGNED note ends. */
export const IMPORT_GRADE_NOTE_SUFFIX = '(from import remark)';

/**
 * How long after the import creates a slab its row may read as saved and still
 * be the import's own write — the clock readings of one transaction. Ten
 * seconds is generous for that, and far too short for a person to have opened
 * the slab and graded it.
 */
export const IMPORT_WRITE_TOLERANCE_MS = 10_000;

/** The note on the event the importer writes when it creates a slab. */
export function importCreatedNote(sourceFile: string, sourceRow: number, remark: string | null): string {
  return `${IMPORT_CREATED_NOTE_PREFIX}${sourceFile} row ${sourceRow}${remark ? ` — "${remark}"` : ''}`;
}

/** The note on the event the importer writes when the remark carried a grade. */
export function importGradeNote(grade: string, disposition: string): string {
  return `Grade ${grade} → ${disposition} ${IMPORT_GRADE_NOTE_SUFFIX}`;
}

/** Is this event one the importer wrote? */
export function isImportEvent(event: { eventType: string; note: string | null }): boolean {
  if (event.note === null) return false;
  if (event.eventType === 'SLAB_CREATED') return event.note.startsWith(IMPORT_CREATED_NOTE_PREFIX);
  if (event.eventType === 'GRADE_ASSIGNED') return event.note.endsWith(IMPORT_GRADE_NOTE_SUFFIX);
  return false;
}

/**
 * The same test as a Prisma relation filter on ChromiaSlab: every event on the
 * slab is one the importer wrote. A fresh object each call, so a caller can
 * spread it into a `where` and nothing is shared.
 */
export function onlyImportEvents() {
  return {
    events: {
      every: {
        OR: [
          { eventType: 'SLAB_CREATED' as const, note: { startsWith: IMPORT_CREATED_NOTE_PREFIX } },
          { eventType: 'GRADE_ASSIGNED' as const, note: { endsWith: IMPORT_GRADE_NOTE_SUFFIX } },
        ],
      },
    },
  };
}

/** Nobody has saved the slab since the import created it. */
export function untouchedSinceImport(slab: { createdAt: Date; updatedAt: Date }): boolean {
  return slab.updatedAt.getTime() - slab.createdAt.getTime() <= IMPORT_WRITE_TOLERANCE_MS;
}

/** Still exactly as the import left it — the slab may go with its import. */
export function isAsImported(slab: {
  createdAt: Date;
  updatedAt: Date;
  events: readonly { eventType: string; note: string | null }[];
}): boolean {
  return untouchedSinceImport(slab) && slab.events.every(isImportEvent);
}

/**
 * What the Delete dialog says, from the real figures: how many slabs the file
 * brought in are still in the ERP, and how many of those would go.
 *
 * The dialog used to name the import's own "imported" counter, which a run cut
 * off part-way never wrote (CHR-7) — it said 0 while the delete removed every
 * slab that run had made.
 */
export function deleteImportDetail(fileName: string, slabs: number, removable: number): string {
  const kept = Math.max(0, slabs - removable);
  const slabWord = (n: number) => (n === 1 ? 'slab' : 'slabs');
  const final = 'This cannot be undone.';

  if (slabs === 0) {
    return `None of the slabs ${fileName} imported is still in the ERP. Only the record of the import will be removed. ${final}`;
  }

  if (kept === 0) {
    return `${fileName} and the ${slabs} ${slabWord(slabs)} it imported will be removed permanently, and those slab numbers freed. Nothing has been done to ${slabs === 1 ? 'it' : 'them'} by hand since the import. ${final}`;
  }

  const keptLine =
    kept === 1
      ? 'It is kept, with all its history, and stays in Slab Records.'
      : 'They are kept, with all their history, and stay in Slab Records.';

  if (removable === 0) {
    const which = slabs === 1 ? `The one slab ${fileName} imported has` : `Every one of the ${slabs} slabs ${fileName} imported has`;
    return `${which} been graded, dispatched, corrected or otherwise worked on by hand since, so none will be removed. ${keptLine} Only the record of the import will go. ${final}`;
  }

  return `${removable} of the ${slabs} slabs ${fileName} imported will be removed permanently, and those slab numbers freed. The other ${kept} ${kept === 1 ? 'has' : 'have'} been graded, dispatched, corrected or otherwise worked on by hand since the import. ${keptLine} ${final}`;
}
