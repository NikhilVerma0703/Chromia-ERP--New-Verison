'use server';

import { revalidatePath } from 'next/cache';

import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { ChromiaDisposition as Disposition } from '@prisma/client';
import { requireActingUser } from '@/lib/chromia/current-user';
import { prisma, type ChromiaTx } from '@/lib/chromia/db';
import { isAppError } from '@/lib/chromia/errors';
import { intakeQcSchema, type IntakeQcInput } from '@/lib/chromia/validation/slab';
import {
  declareWaste,
  recordSampleCutting,
  recordStock,
} from '@/lib/chromia/server/services/disposition-service';
import {
  applyIntakeGrade,
  resetSlabQcForCorrection,
} from '@/lib/chromia/server/services/intake-outcome-service';
import { markAwaitingRecalibration } from '@/lib/chromia/server/services/recalibration-flow-service';
import { resolveRecalibrationReasonId } from '@/lib/chromia/server/services/reference-service';
import { completeSlabIntake } from '@/lib/chromia/server/services/slab-intake-service';

export interface SlabIntakeFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /** Set once the save succeeds, so the panel knows to return the user to the
   *  page they came from. A number (not a boolean) so two saves in a row are
   *  two distinct successes and the panel navigates for each. */
  savedAt?: number;
}

/**
 * The QC save's one transaction (CHR-5) — see saveQc. A QC save is a dozen or
 * so statements, each a round trip to Neon, so it gets more room than Prisma's
 * default five seconds; the wait for a connection is bounded too, so a busy
 * pool fails the save (nothing written, Save can be pressed again) rather than
 * holding the button on "Saving…".
 */
const QC_SAVE_TX = { maxWait: 10_000, timeout: 20_000 } as const;

/** Run the outcome-specific record for everything except recalibration. */
async function applyDisposition(
  slabId: string,
  qc: IntakeQcInput,
  userId: string,
  tx: ChromiaTx,
) {
  switch (qc.disposition) {
    case Disposition.DISPATCH:
      // Grade A → Dispatch no longer dispatches on the spot. The slab is graded
      // and joins the Dispatch page queue; its real dispatch date is recorded
      // there when it is actually sent, days or weeks later. See /chromia/dispatch.
      return undefined;

    case Disposition.STOCK:
      return recordStock(
        {
          slabId,
          stockDate: qc.stockDate,
          notes: qc.stockNotes,
        },
        userId,
        tx,
      );

    case Disposition.SAMPLE_CUTTING:
      return recordSampleCutting(
        {
          slabId,
          cutDate: qc.cutDate,
          notes: undefined,
        },
        userId,
        tx,
      );

    case Disposition.WASTE:
      return declareWaste(
        {
          slabId,
          finalDefectTypeId: qc.finalDefectTypeId,
          rootCause: qc.rootCause,
          disposalRef: qc.disposalRef,
          notes: undefined,
        },
        userId,
        tx,
      );

    default:
      // RECALIBRATION is completed on the Recalibration page.
      return undefined;
  }
}

/**
 * Finish a slab the operator already entered.
 *
 * Identical form, identical QC rules — the only difference is that section 1
 * updates a slab instead of creating one. Keeping both paths on one function
 * means a change to the grading rules can never apply to new slabs and quietly
 * miss the ones being finished.
 */
export async function completeSlabAction(
  _previousState: SlabIntakeFormState,
  formData: FormData,
): Promise<SlabIntakeFormState> {
  const raw = formData.get('slabId');
  const slabId = typeof raw === 'string' ? raw : '';
  if (!slabId) return { error: 'This slab could not be identified. Reopen it from Slabs.' };

  return saveQc(formData, (userId, tx) =>
    completeSlabIntake(slabId, userId, tx).then((slab) => slab.id),
  );
}

/**
 * Correct the QC on a slab that has already been graded — the Edit path.
 *
 * The whole grading flow is reused: the slab's current QC is undone, then the
 * new grade and outcome are applied exactly as a first grading would, onto the
 * same record. Nothing here is a second, parallel way to grade — it is the same
 * one, run again — so the rules can never drift from the normal screen.
 */
export async function editSlabQcAction(
  _previousState: SlabIntakeFormState,
  formData: FormData,
): Promise<SlabIntakeFormState> {
  const raw = formData.get('slabId');
  const slabId = typeof raw === 'string' ? raw : '';
  if (!slabId) return { error: 'This slab could not be identified. Reopen it from Slab Records.' };

  return saveQc(formData, async (userId, tx) => {
    await resetSlabQcForCorrection(slabId, userId, tx);
    return slabId;
  });
}

async function saveQc(
  formData: FormData,
  persist: (userId: string, tx: ChromiaTx) => Promise<string>,
): Promise<SlabIntakeFormState> {
  /**
   * Read a form field as text.
   *
   * `FormData.get` returns **null** for a field that is not in the document,
   * and the QC section only renders the panel for the outcome that was chosen —
   * so on a dispatch, every stock and sample-cutting field is absent. The
   * optional schemas accept a string or nothing, never null, so passing the raw
   * result rejected the form on fields the user could not even see, and the
   * errors had nowhere to appear. Nothing saved, nothing shown.
   */
  const text = (key: string): string | undefined => {
    const value = formData.get(key);
    return typeof value === 'string' ? value : undefined;
  };

  const qcParsed = intakeQcSchema.safeParse({
    grade: text('grade'),
    disposition: text('disposition'),
    slabRemarks: text('slabRemarks'),
    dispatchDate: text('dispatchDate'),
    stockDate: text('stockDate'),
    stockNotes: text('stockNotes'),
    cutDate: text('cutDate'),
    recalibrationReason: text('recalibrationReason'),
    finalDefectTypeId: text('finalDefectTypeId'),
    rootCause: text('rootCause'),
    disposalRef: text('disposalRef'),
  });

  if (!qcParsed.success) {
    return { fieldErrors: qcParsed.error.flatten().fieldErrors };
  }

  const qc = qcParsed.data;

  let reasonId: string | undefined;

  try {
    const user = await requireActingUser();

    // The reason can be typed as well as picked, so a name becomes a record
    // here — matched against what exists, created only when new.
    if (qc.disposition === Disposition.RECALIBRATION && qc.recalibrationReason) {
      reasonId = await resolveRecalibrationReasonId(qc.recalibrationReason);
    }

    /*
     * ONE COMMIT FOR THE WHOLE SAVE (the code review of 20 Oct 2026, CHR-5).
     *
     * These steps used to commit one by one. The in-charge saved Grade C →
     * Recalibration, the intake and the grade committed, and then a Neon drop
     * or a function timeout stopped markAwaitingRecalibration — no waiting trip.
     * The Recalibration page listed the slab as "Need 1st Time Recalibration"
     * with a Trip button that saveTrip refused ("not waiting for recalibration
     * right now"); Edit refused it as in recalibration and a fresh QC as already
     * graded, so the slab was stuck until somebody deleted it. On the Edit path
     * the reset's deletions committed even when the regrade after them failed.
     *
     * Now every step writes through one transaction: the intake (or the Edit
     * path's reset), the grade, the outcome record and the recalibration wait
     * all land, or none of them does and the slab is exactly as it was — so the
     * same Save can simply be pressed again. The reason name was turned into a
     * record above, outside: it is master data, harmless on its own, and kept
     * out of the transaction it would otherwise lengthen.
     */
    await prisma.$transaction(async (tx) => {
      const slabId = await persist(user.id, tx);

      await applyIntakeGrade(slabId, qc, user.id, tx);
      await applyDisposition(slabId, qc, user.id, tx);

      // A condemned slab is not sent anywhere yet — it is put down inside the
      // plant. This opens that waiting record so it appears on the Recalibration
      // page with its reason and an attempt count that has deliberately not
      // moved, and writes the slab off if this was the sixth condemnation.
      if (qc.disposition === Disposition.RECALIBRATION) {
        await markAwaitingRecalibration(slabId, reasonId, user.id, tx);
      }
    }, QC_SAVE_TX);
  } catch (error) {
    if (isAppError(error)) {
      return { error: error.message };
    }
    if (error instanceof Error && error.message.includes('db:seed')) {
      return { error: error.message };
    }
    throw error;
  }

  // Every page a QC outcome can change is marked stale, so whichever one the
  // panel returns to shows the just-graded slab correctly — the record in Slab
  // Records, the counts on the Dashboard, and the queues on Recalibration,
  // Stockyard and Dispatch. The operator screen too: it is where the grading
  // happens, so it is stale the instant this returns.
  revalidatePath(APP_ROUTES.slabs);
  revalidatePath(APP_ROUTES.dashboard);
  revalidatePath(APP_ROUTES.recalibrations);
  revalidatePath(APP_ROUTES.stockyard);
  revalidatePath(APP_ROUTES.dispatch);
  revalidatePath(APP_ROUTES.operator);

  /*
   * No redirect() from here — deliberately, and this is the fix.
   *
   * A server redirect() inside a useActionState action ties the form's pending
   * state to a server-driven navigation. The destinations here are
   * force-dynamic pages (the whole filtered Slab Records list, the Recalibration
   * table), and while one of those rendered the button sat on "Saving…" — on a
   * slow render it never came back, so the save looked stuck even though it had
   * already committed. Worse, it forced the destination: Recalibration jumped to
   * the Recalibration page, and every other outcome to Slab Records, no matter
   * which screen the grader had actually come from.
   *
   * So the action just reports success. The panel (qc-panel.tsx) resolves its
   * own pending the moment this returns, then navigates the user back to exactly
   * where the slab was opened from — the same filtered Slab Records view, or
   * Operator Entry — client-side. Recalibration is no exception: the record is
   * updated here, and the user stays where they were.
   */
  return { savedAt: Date.now() };
}
