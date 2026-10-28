'use client';

import { useActionState, useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import { Field, FormError } from '@/components/chromia/ui';
import { ComboInput } from '@/components/chromia/ui/combo';
import { field, FieldGrid, SectionCard, selectField } from '@/components/chromia/ui/form';
import { DispositionBadge, GradeBadge } from '@/components/chromia/ui/status';
import { TimeInput } from '@/components/chromia/ui/time-input';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { DUPLICATE_SLAB_NO_MESSAGE } from '@/lib/chromia/slab-record';
import { saveSlabEntryAction, type OperatorFormState } from '@/lib/chromia/server/actions/operator';
import { checkSlabNoAction } from '@/lib/chromia/server/actions/slab-record';

import { QcSection, type Option } from '../slabs/new/qc-section';

const INITIAL_STATE: OperatorFormState = {};

/** The slab this form is correcting, when it is open on one. */
export interface EditingSlab {
  id: string;
  slabNo: string;
  batchNo: string;
  baseMaterial: string;
  fileName: string;
  thicknessCm: string;
  receivedDate: string;
  inTime: string;
  remarks: string;
}

/**
 * The QC Report under the entry.
 *
 *   grade   — the slab is new, or still waiting for QC: grade it, or leave the
 *             grade empty to save it In-Processing;
 *   correct — the Edit path: the current grade and outcome, to be changed;
 *   none    — its QC is settled (graded, dispatched, in recalibration…): the
 *             report says why in `message`, and only Slab Remarks is editable.
 */
export interface QcReport {
  mode: 'grade' | 'correct' | 'none';
  recalibrationReasons: Option[];
  /** What was saved — pre-filled on the Edit path, and shown when the QC is settled. */
  initial?: { grade?: string; disposition?: string; reason?: string };
  message?: ReactNode;
}

interface Props {
  /** `yyyy-mm-dd` the blank form starts on. */
  entryDate: string;
  /** `HH:mm` on the server when the page rendered — avoids a hydration mismatch. */
  nowTime: string;
  baseMaterials: string[];
  fileNames: string[];
  batchNos: string[];
  /** Set when the screen is open on an existing slab — see the operator page. */
  editing?: EditingSlab;
  qc: QcReport;
  /** Where to return after saving an opened slab (see the page's `back`). */
  back?: string;
}

/** Only an in-app Chromia path is ever navigated to. */
function returnTarget(back?: string): string {
  return back && back.startsWith('/chromia/') ? back : APP_ROUTES.operator;
}

export function EntryForm({
  entryDate,
  nowTime,
  baseMaterials,
  fileNames,
  batchNos,
  editing,
  qc,
  back,
}: Props) {
  const isEditing = editing !== undefined;
  const router = useRouter();

  /*
   * ONE FORM, ONE BUTTON (27 Oct 2026). The entry and its QC Report are one
   * form now, saved by one action: a new row is recorded, an opened slab is
   * corrected, and either is graded in the same press when a grade is chosen
   * (saveSlabEntryAction says how). Keeping it one component is still what
   * stops the fields and their rules drifting apart — a correction is held to
   * the same schema as the original entry.
   */
  const [state, formAction, isPending] = useActionState<OperatorFormState, FormData>(
    saveSlabEntryAction,
    INITIAL_STATE,
  );
  const [isReturning, startReturn] = useTransition();
  const handled = useRef<number | string | null>(null);

  /*
   * PRODUCTION DATE STAYS PUT. It used to be an uncontrolled input whose
   * defaultValue was today, and React resets uncontrolled fields after a form
   * action — so every save silently sent the date back to today. An operator
   * catching up on Tuesday's production would set the date once, save, and the
   * next four slabs would be booked against today without anyone seeing it.
   *
   * It is held in state now, like the batch and the material either side of it:
   * the operator sets it when the day changes and not before.
   *
   * Every field below is seeded from props ONCE, so the page mounts this with a
   * `key` that changes with the slab. That is not belt and braces: the App
   * Router deliberately keeps a segment's React state across a search-param
   * change ("search params do not cause state to be lost"), so navigating from
   * one ?slab= to another re-renders this component rather than remounting it.
   * Without the key the hidden slabId and the action would switch to the new
   * slab while the visible fields still held the old one's values — and the
   * next Save would write them onto it.
   */
  const [productionDate, setProductionDate] = useState(editing?.receivedDate ?? entryDate);

  // Batch, material, artwork and thickness stay put between rows — an operator
  // books a whole run of the same thing. Slab no. clears every time.
  const [batchNo, setBatchNo] = useState(editing?.batchNo ?? '');
  const [baseMaterial, setBaseMaterial] = useState(editing?.baseMaterial ?? '');
  const [fileName, setFileName] = useState(editing?.fileName ?? '');
  const [thicknessCm, setThicknessCm] = useState(editing?.thicknessCm ?? '');
  const [slabNo, setSlabNo] = useState(editing?.slabNo ?? '');
  /* Blank, not the clock. The in-time is optional now, and pre-filling it with
     "now" made a guess look like a reading on every row that was left alone. */
  const [inTime, setInTime] = useState(editing?.inTime ?? '');
  const slabInput = useRef<HTMLInputElement>(null);

  /**
   * Caught as the operator leaves the field, not after the whole row is filled
   * in. The save is refused by the service and by the database's unique index
   * as well — this is the courtesy, not the guard.
   */
  const [duplicate, setDuplicate] = useState(false);
  const [, startCheck] = useTransition();

  const checkSlabNo = () => {
    const value = slabNo.trim();
    // The slab keeps its own number when its own entry is being corrected.
    if (value === '' || value === editing?.slabNo) {
      setDuplicate(false);
      return;
    }
    startCheck(async () => {
      const { taken } = await checkSlabNoAction(value);
      setDuplicate(taken);
    });
  };

  /* The QC Report starts blank for every new row: remounted on each save. */
  const [qcKey, setQcKey] = useState(0);

  useEffect(() => {
    // The entry saved but its QC did not: open that slab, In-Processing, so
    // its QC Report is finished on it — never re-saved as a new row, which
    // the slab number would now refuse.
    if (state.qcFailed && state.savedSlabId) {
      if (handled.current === state.savedSlabId) return;
      handled.current = state.savedSlabId;
      const opened = `${APP_ROUTES.operator}?slab=${state.savedSlabId}`;
      startReturn(() => router.push(opened));
      return;
    }
    if (!state.savedAt || handled.current === state.savedAt) return;
    handled.current = state.savedAt;
    if (isEditing) {
      // An opened slab goes back to where it was opened from.
      startReturn(() => router.push(returnTarget(back)));
      return;
    }
    // Only the slab number, the in-time and the QC Report clear: everything
    // else is the run the operator is still booking, the date included.
    setSlabNo('');
    setInTime('');
    setDuplicate(false);
    setQcKey((key) => key + 1);
    slabInput.current?.focus();
  }, [state.savedAt, state.qcFailed, state.savedSlabId, isEditing, back, router]);

  const errors = state.fieldErrors;
  const slabNoError = errors?.slabNo?.[0] ?? (duplicate ? DUPLICATE_SLAB_NO_MESSAGE : undefined);
  const dateFieldName = isEditing ? 'receivedDate' : 'entryDate';
  const dateError = (isEditing ? errors?.receivedDate?.[0] : errors?.entryDate?.[0]) ?? undefined;

  /* An error under a field this form does not render has nowhere to appear, and
     the screen would simply sit still on Save — which is exactly what a missing
     `remarks` field did. Anything unplaced is said in the banner instead. */
  const shown = new Set(['entryDate', 'receivedDate', 'batchNo', 'slabNo', 'baseMaterial', 'fileName', 'thicknessCm', 'inTime', 'remarks', 'grade', 'disposition', 'recalibrationReason', 'slabRemarks']);
  // The entry's own remark error belongs under the QC Report's field.
  const qcErrors = errors?.remarks ? { ...errors, slabRemarks: errors.remarks } : errors;
  const unplaced = Object.entries(errors ?? {})
    .filter(([key, messages]) => !shown.has(key) && messages && messages.length > 0)
    .map(([key, messages]) => `${key}: ${messages?.[0]}`)
    .join(' · ');

  return (
    <form action={formAction} className="mb-6 flex flex-col gap-6">
      {isEditing ? <input type="hidden" name="slabId" value={editing.id} /> : null}
      <input type="hidden" name="qcMode" value={qc.mode} />
      {qc.mode === 'correct' ? (
        <>
          <input type="hidden" name="initialGrade" value={qc.initial?.grade ?? ''} />
          <input type="hidden" name="initialDisposition" value={qc.initial?.disposition ?? ''} />
          <input type="hidden" name="initialReason" value={qc.initial?.reason ?? ''} />
        </>
      ) : null}

      <SectionCard
        title={isEditing ? `Entry — slab ${editing.slabNo}` : 'New Entry'}
        accent="active"
      >
        <div className="flex flex-col gap-6">

          <FieldGrid columns={3}>
            <Field label="Production Date *" htmlFor={dateFieldName} error={dateError}>
              <input
                id={dateFieldName}
                name={dateFieldName}
                type="date"
                required
                value={productionDate}
                onChange={(event) => setProductionDate(event.target.value)}
                className={field}
              />
            </Field>

            <Field label="Batch No. *" htmlFor="batchNo" error={errors?.batchNo?.[0]}>
              <input
                id="batchNo"
                name="batchNo"
                required
                list="batch-list"
                value={batchNo}
                onChange={(event) => setBatchNo(event.target.value)}
                placeholder="1245"
                className={`${field} font-mono`}
              />
              <datalist id="batch-list">
                {batchNos.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            </Field>

            <Field label="Slab No. *" htmlFor="slabNo" error={slabNoError}>
              <input
                id="slabNo"
                name="slabNo"
                required
                autoFocus={!isEditing}
                ref={slabInput}
                value={slabNo}
                onChange={(event) => {
                  setSlabNo(event.target.value);
                  setDuplicate(false);
                }}
                onBlur={checkSlabNo}
                placeholder="130520"
                aria-invalid={slabNoError ? true : undefined}
                className={`${field} font-mono ${slabNoError ? 'border-status-waste' : ''}`}
              />
            </Field>

            {/*
             * Pick from the list, or type something the list has never seen.
             *
             * A plain select cannot express "one of these, or a new one", and a
             * material that arrived this morning is not a reason to stop the
             * register. The server matches what is typed against the existing
             * records — ignoring case and stray spaces — and creates one only
             * when the name is genuinely new.
             */}
            <Field
              label="Base Material / Slab Name *"
              htmlFor="baseMaterial"
              error={errors?.baseMaterial?.[0]}
            >
              <ComboInput
                id="baseMaterial"
                name="baseMaterial"
                options={baseMaterials}
                value={baseMaterial}
                onChange={setBaseMaterial}
                required
                placeholder="Pick one, or type a new name"
                className={selectField}
              />
            </Field>

            <Field
              label="File Name / Planned Design *"
              htmlFor="fileName"
              error={errors?.fileName?.[0]}
            >
              <ComboInput
                id="fileName"
                name="fileName"
                options={fileNames}
                value={fileName}
                onChange={setFileName}
                required
                placeholder="Pick one, or type a new design"
                className={selectField}
              />
            </Field>

            <Field
              label="Thickness of Slab (cm)"
              htmlFor="thicknessCm"
              error={errors?.thicknessCm?.[0]}
            >
              <input
                id="thicknessCm"
                name="thicknessCm"
                inputMode="decimal"
                value={thicknessCm}
                onChange={(event) => setThicknessCm(event.target.value)}
                placeholder="2"
                className={field}
              />
            </Field>

            {/* No asterisk: the in-time is genuinely sometimes not known when
                the row is written, and refusing the entry over it only bought a
                guessed time that nothing downstream can tell from a real one. */}
            <Field label="In-time" htmlFor="inTime" error={errors?.inTime?.[0]}>
              <TimeInput
                id="inTime"
                name="inTime"
                value={inTime}
                onChange={setInTime}
                placeholder={nowTime}
                className={field}
              />
            </Field>

          </FieldGrid>
        </div>
      </SectionCard>

      {/*
       * QC Report — part of this form, saved by the same button. Slab Remarks
       * lives here now (it was an entry field), apart from the outcome. When
       * the slab's QC is settled, the report says why and keeps only the
       * remark editable; the remark still travels as `slabRemarks`.
       */}
      <SectionCard title="QC Report" accent="grade">
        {qc.mode === 'none' ? (
          <div className="flex flex-col gap-4">
            {qc.message ? <p className="text-muted text-sm">{qc.message}</p> : null}
            {qc.initial?.grade ? (
              // The saved QC Report, shown as it is (28 Oct 2026): settled, so
              // not changed here, but every value of it is in front of the user.
              <FieldGrid columns={3}>
                <Field label="Grade" htmlFor="saved-grade">
                  <div id="saved-grade" className="flex h-11 items-center">
                    <GradeBadge grade={qc.initial.grade as never} />
                  </div>
                </Field>
                <Field label="QC Outcome" htmlFor="saved-outcome">
                  <div id="saved-outcome" className="flex h-11 items-center">
                    {qc.initial.disposition ? <DispositionBadge disposition={qc.initial.disposition as never} /> : <span className="text-muted">—</span>}
                  </div>
                </Field>
                {qc.initial.reason ? (
                  <Field label="Reason for Recalibration" htmlFor="saved-reason">
                    <input id="saved-reason" readOnly value={qc.initial.reason} className={`${field} cursor-default bg-[var(--surface-muted)]`} />
                  </Field>
                ) : null}
              </FieldGrid>
            ) : null}
            <FieldGrid>
              <Field label="Slab Remarks" htmlFor="slabRemarks" error={qcErrors?.slabRemarks?.[0]}>
                <input
                  id="slabRemarks"
                  name="slabRemarks"
                  defaultValue={editing?.remarks ?? ''}
                  placeholder="Optional"
                  maxLength={500}
                  className={field}
                />
              </Field>
            </FieldGrid>
          </div>
        ) : (
          <QcSection
            key={qcKey}
            optional={qc.mode === 'grade'}
            remarksField
            recalibrationReasons={qc.recalibrationReasons}
            errors={qcErrors}
            initial={{
              grade: qc.initial?.grade,
              disposition: qc.initial?.disposition,
              reasonName: qc.initial?.reason,
              slabRemarks: editing?.remarks ?? '',
            }}
          />
        )}
      </SectionCard>

      <div className="flex flex-col gap-4">
          <FormError message={state.error ?? (unplaced || undefined)} />

          <div className="flex flex-wrap items-center gap-4">
            <button
              type="submit"
              disabled={isPending || isReturning || duplicate}
              className="bg-brand-600 hover:bg-brand-700 inline-flex h-11 items-center justify-center rounded-lg px-6 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(16,24,40,0.12)] transition-colors disabled:cursor-not-allowed disabled:opacity-55"
            >
              {isPending ? 'Saving…' : isReturning ? 'Saved — returning…' : 'Save Entry'}
            </button>

            {state.savedSlabNo && !state.error ? (
              <span className="text-status-done inline-flex items-center gap-2 text-sm font-medium">
                <span className="bg-status-done inline-block size-1.5 rounded-full" />
                Slab {state.savedSlabNo} {isEditing ? 'updated' : 'saved'}
              </span>
            ) : null}
          </div>
      </div>
    </form>
  );
}
