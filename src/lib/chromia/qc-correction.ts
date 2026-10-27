/**
 * May this slab's QC be redone? The Edit path's rule, in one place.
 *
 * The Edit screen re-opens the QC section on a slab that has already been
 * decided, so an in-charge catching up old registers can put right a grade or
 * an outcome keyed wrongly. Redoing a QC means UNDOING it first: the grade
 * decision goes, and so does the record that decision produced — the stock
 * entry, the sample cutting — before the slab is graded afresh onto the same
 * record (resetSlabQcForCorrection).
 *
 * That is only true while the slab is still where its QC put it. The code
 * review of 20 Oct 2026 (CHR-1) found it was not checked: a slab graded
 * A → Dispatch on 2 Oct and sent from the Dispatch page on 5 Oct could be
 * opened on 20 Oct to fix its thickness, "Save QC changes" pressed with the
 * pre-filled A → Dispatch untouched, and the reset deleted the real 5 Oct
 * dispatch and put the slab back in the queue — gone from October's Dispatch
 * sheet, from the Summary's dispatched count, its dispatch date lost. A stocked
 * slab later dispatched from the Stockyard went back on the rack the same way.
 *
 * So a slab that has LEFT stays left. Refused here:
 *
 *   • Written off (WASTE). QC never decides waste on this line — Grade C goes
 *     to recalibration, and only the fifth failure ends a slab's life, on the
 *     Recalibration page (GRADE_ALLOWED_DISPOSITIONS). Nothing about it is the
 *     QC's to undo.
 *   • Dispatched — by status, or by any dispatch record at all. A dispatch is
 *     never what the QC wrote (A → Dispatch only joins the queue); it is the
 *     day the slab physically left the plant, recorded on the Dispatch page or
 *     the Stockyard, or by the register import.
 *   • In a recalibration cycle — that journey belongs to the Recalibration
 *     page, as it always has.
 *   • Cut for samples when the QC on this pass said something else (stocked,
 *     then cut from the rack). The cut is its own later event, not the QC's.
 *
 * What stays correctable is exactly what the Edit path was built for: a slab
 * still graded and queued for dispatch, still on the rack its QC put it on, or
 * cut for samples BY that QC (B → Sample Cutting — the cut and the decision
 * are one act, recorded together at the QC save, so correcting the decision is
 * correcting the cut). Its identity — thickness, slab number, batch — can
 * always be corrected in the entry form above the QC section, whatever this
 * says.
 *
 * Pure and import-free (statuses as their string values) so node --test can
 * hold the rule: tests/chromiaQcCorrection.test.ts.
 */

export interface QcCorrectionState {
  slabNo: string;
  /** `status` on the slab — where it is now. */
  status: string;
  /** `currentDisposition` on the slab. */
  currentDisposition: string | null;
  /**
   * The outcome QC recorded on the slab's current pass: the latest cycle's
   * `disposition`. Written by the QC save (applyIntakeGrade) and by the
   * register import, and — unlike the slab's own currentDisposition — never
   * overwritten by what happened to the slab afterwards.
   */
  decidedDisposition: string | null;
  /** True when the slab has any dispatch record. */
  hasDispatch: boolean;
}

/** Why a QC may not be redone. IN_RECALIBRATION is the one with somewhere to go. */
export type QcCorrectionRefusalReason = 'WRITTEN_OFF' | 'DISPATCHED' | 'IN_RECALIBRATION' | 'CUT_AFTER_QC';

export interface QcCorrectionRefusal {
  reason: QcCorrectionRefusalReason;
  /** In words for the in-charge — the server's refusal and the Edit screen's notice alike. */
  message: string;
}

/** The refusal, or null when the slab's QC may be redone. */
export function qcCorrectionRefusal(slab: QcCorrectionState): QcCorrectionRefusal | null {
  if (slab.status === 'WASTE') {
    return {
      reason: 'WRITTEN_OFF',
      message: `Slab ${slab.slabNo} has been written off, so its QC can no longer be redone.`,
    };
  }

  if (slab.status === 'DISPATCHED' || slab.hasDispatch) {
    return {
      reason: 'DISPATCHED',
      message: `Slab ${slab.slabNo} has already been dispatched — it has left the plant, so its QC can no longer be redone. Its entry details can still be corrected.`,
    };
  }

  if (
    slab.currentDisposition === 'RECALIBRATION' ||
    slab.status === 'OUT_FOR_RECALIBRATION' ||
    slab.status === 'RECEIVED_FROM_RECALIBRATION'
  ) {
    return {
      reason: 'IN_RECALIBRATION',
      message: `Slab ${slab.slabNo} is in a recalibration cycle — correct it on the Recalibration page, not here.`,
    };
  }

  if (slab.status === 'SAMPLE_CUT' && slab.decidedDisposition !== 'SAMPLE_CUTTING') {
    return {
      reason: 'CUT_AFTER_QC',
      message: `Slab ${slab.slabNo} was cut for samples after its QC, so its QC can no longer be redone. Its entry details can still be corrected.`,
    };
  }

  return null;
}
