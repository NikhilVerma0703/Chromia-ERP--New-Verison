'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Field, FormError } from '@/components/chromia/ui';
import { ComboInput } from '@/components/chromia/ui/combo';
import { field, FieldGrid, SectionCard, selectField } from '@/components/chromia/ui/form';
import { DispositionBadge, GradeBadge } from '@/components/chromia/ui/status';
import { TimeInput } from '@/components/chromia/ui/time-input';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import {
  updateRecalibrationSlabAction,
  type RecalibrationSlabFormState,
} from '@/lib/chromia/server/actions/recalibration-flow';

import { QcSection, type Option } from '../../slabs/new/qc-section';

export interface TripView {
  attemptNumber: number;
  sentDate: string;
  receivedDate: string;
  reason: string;
  /** Where this attempt stands, in words. */
  status: string;
}

export interface SlabDetails {
  productionDate: string;
  batchNo: string;
  slabNo: string;
  baseMaterial: string;
  fileName: string;
  thicknessCm: string;
  inTime: string;
}

interface Props {
  slabId: string;
  /** recalibration-flow stage: AWAITING_SEND · OUT · RETURNED · IN_PRODUCTION · CLEARED · WRITTEN_OFF */
  stage: string;
  status: string;
  /** Every trip, oldest first. One already back has its dates as inputs, to correct. */
  trips: TripView[];
  /** The trip whose dates part A records, if the slab has one to send or receive. */
  currentTrip: { attemptNumber: number; sentDate: string; receivedDate: string } | null;
  details: SlabDetails;
  qc: { grade: string; disposition: string; reason: string; remarks: string };
  recalibrationReasons: Option[];
  baseMaterials: string[];
  fileNames: string[];
  batchNos: string[];
  today: string;
}

const ord = (n: number) => ['1st', '2nd', '3rd', '4th', '5th'][n - 1] ?? `${n}th`;

/**
 * One slab's Recalibration form (27 Oct 2026): Send and Receive, Update Slab
 * Details and QC Report, all on one page, all visible, saved by one Update
 * Slab button. Each part is saved only if something in it was entered or
 * changed (updateRecalibrationSlabAction compares against the hidden
 * initial_* values), so any one can be done on its own and nothing else is
 * touched. Which parts accept what follows the slab's stage:
 *
 *   A  Sent / Received of the trip waiting or out; every earlier trip shown.
 *   B  every Slab Entry field, pre-filled — once the slab is back, saving it
 *      starts the slab's next pass (In Processing — After Attempt N).
 *   C  the grade of the new pass (A → Stock, B → Stock or Sample Cutting,
 *      C → Recalibration) once the slab is back; before that, its Reason for
 *      Recalibration and Slab Remarks.
 *
 * After a successful save the page returns to Recalibration.
 */
export function RecalibrationSlabForm(props: Props) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<RecalibrationSlabFormState, FormData>(updateRecalibrationSlabAction, {});
  const [isReturning, startReturn] = useTransition();
  const handled = useRef<number | null>(null);
  const [inTime, setInTime] = useState(props.details.inTime);
  const [baseMaterial, setBaseMaterial] = useState(props.details.baseMaterial);
  const [fileName, setFileName] = useState(props.details.fileName);
  const [remarks, setRemarks] = useState(props.qc.remarks);
  const [reason, setReason] = useState(props.qc.reason);

  useEffect(() => {
    if (!state.savedAt || handled.current === state.savedAt) return;
    handled.current = state.savedAt;
    startReturn(() => router.push(APP_ROUTES.recalibrations));
  }, [state.savedAt, router]);

  const errors = state.fieldErrors;
  const back = props.stage === 'RETURNED' || props.stage === 'IN_PRODUCTION';
  const canGrade = back;
  const canTrip = props.currentTrip !== null;
  const canReason = props.stage === 'AWAITING_SEND' || props.stage === 'OUT';
  const busy = isPending || isReturning || Boolean(state.savedAt);
  const d = props.details;

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="slabId" value={props.slabId} />
      <input type="hidden" name="initialSentDate" value={props.currentTrip?.sentDate ?? ''} />
      <input type="hidden" name="initialReceivedDate" value={props.currentTrip?.receivedDate ?? ''} />
      {(Object.keys(d) as (keyof SlabDetails)[]).map((key) => (
        <input key={key} type="hidden" name={`initial_${key}`} value={d[key]} />
      ))}
      <input type="hidden" name="initialGrade" value={canGrade ? '' : props.qc.grade} />
      <input type="hidden" name="initialReason" value={props.qc.reason} />
      <input type="hidden" name="initialRemarks" value={props.qc.remarks} />

      {/* ─────────────────────────────────────────────── A. Send and Receive */}
      <SectionCard title="A. Send and Receive" accent="grade">
        <div className="flex flex-col gap-5">
          {props.trips.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted text-left text-[11px] font-semibold tracking-[0.08em] uppercase">
                  <tr>
                    <th className="py-1.5 pr-4">Attempt</th>
                    <th className="py-1.5 pr-4">Sent Date</th>
                    <th className="py-1.5 pr-4">Received Date</th>
                    <th className="py-1.5 pr-4">Reason for Recalibration</th>
                    <th className="py-1.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {props.trips.map((trip) => {
                    // A trip already back is corrected here; the one waiting
                    // or out is recorded in the fields below.
                    const closed = trip.sentDate !== '' && trip.receivedDate !== '';
                    const error = errors?.[`trip_${trip.attemptNumber}_sent`]?.[0];
                    return (
                      <tr key={trip.attemptNumber} className="border-line border-t align-top" data-trip={trip.attemptNumber}>
                        <td className="py-2 pr-4 font-medium">{ord(trip.attemptNumber)}</td>
                        <td className="py-2 pr-4 tabular-nums">
                          {closed ? (
                            <>
                              <input type="hidden" name={`initial_trip_${trip.attemptNumber}_sent`} value={trip.sentDate} />
                              <input
                                name={`trip_${trip.attemptNumber}_sent`}
                                type="date"
                                max={props.today}
                                defaultValue={trip.sentDate}
                                aria-label={`Sent Date — ${ord(trip.attemptNumber)} attempt`}
                                className={`${field} h-9 w-40`}
                              />
                            </>
                          ) : (
                            trip.sentDate || '—'
                          )}
                        </td>
                        <td className="py-2 pr-4 tabular-nums">
                          {closed ? (
                            <>
                              <input type="hidden" name={`initial_trip_${trip.attemptNumber}_received`} value={trip.receivedDate} />
                              <input
                                name={`trip_${trip.attemptNumber}_received`}
                                type="date"
                                max={props.today}
                                defaultValue={trip.receivedDate}
                                aria-label={`Received Date — ${ord(trip.attemptNumber)} attempt`}
                                className={`${field} h-9 w-40`}
                              />
                            </>
                          ) : (
                            trip.receivedDate || '—'
                          )}
                        </td>
                        <td className="py-2 pr-4">{trip.reason || '—'}</td>
                        <td className="py-2">
                          <span className="text-status-recalibration font-medium">{trip.status}</span>
                          {error ? <p className="text-status-waste mt-1 text-xs">{error}</p> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}

          {canTrip ? (
            <FieldGrid>
              <Field
                label={`Sent Date — ${ord(props.currentTrip!.attemptNumber)} attempt`}
                htmlFor="sentDate"
                error={errors?.sentDate?.[0]}
              >
                <input id="sentDate" name="sentDate" type="date" max={props.today} defaultValue={props.currentTrip!.sentDate} className={field} />
              </Field>
              <Field
                label="Received Date"
                htmlFor="receivedDate"
                error={errors?.receivedDate?.[0]}
                hint="Leave empty until the slab comes back — save the Sent Date alone"
              >
                <input id="receivedDate" name="receivedDate" type="date" max={props.today} defaultValue={props.currentTrip!.receivedDate} className={field} />
              </Field>
            </FieldGrid>
          ) : (
            <p className="text-muted text-sm">
              {props.stage === 'RETURNED' || props.stage === 'IN_PRODUCTION'
                ? 'Back from recalibration — its dates are saved above. Update its details and grade its new pass below.'
                : props.stage === 'CLEARED'
                  ? 'Cleared — no trip to send or receive.'
                  : props.stage === 'WRITTEN_OFF'
                    ? 'Written off after its last attempt — no trip to send.'
                    : 'No trip to send or receive.'}
            </p>
          )}
        </div>
      </SectionCard>

      {/* ──────────────────────────────────────────── B. Update Slab Details */}
      <SectionCard title="B. Update Slab Details" accent="active">
        <div className="flex flex-col gap-4">
          {props.stage === 'RETURNED' ? (
            <p className="text-status-active text-sm font-medium">
              Back from recalibration: saving these details starts the slab’s next pass — enter its In-time.
            </p>
          ) : null}
          <FieldGrid columns={3}>
            <Field label="Production Date *" htmlFor="productionDate" error={errors?.productionDate?.[0]}>
              <input id="productionDate" name="productionDate" type="date" required defaultValue={d.productionDate} className={field} />
            </Field>
            <Field label="Batch No. *" htmlFor="batchNo" error={errors?.batchNo?.[0]}>
              <input id="batchNo" name="batchNo" required list="recal-batches" defaultValue={d.batchNo} className={`${field} font-mono`} />
              <datalist id="recal-batches">
                {props.batchNos.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            </Field>
            <Field label="Slab No. *" htmlFor="slabNo" error={errors?.slabNo?.[0]}>
              <input id="slabNo" name="slabNo" required defaultValue={d.slabNo} className={`${field} font-mono`} />
            </Field>
            <Field label="Base Material / Slab Name *" htmlFor="baseMaterial" error={errors?.baseMaterial?.[0]}>
              <ComboInput id="baseMaterial" name="baseMaterial" options={props.baseMaterials} value={baseMaterial} onChange={setBaseMaterial} required className={selectField} />
            </Field>
            <Field label="File Name / Planned Design *" htmlFor="fileName" error={errors?.fileName?.[0]}>
              <ComboInput id="fileName" name="fileName" options={props.fileNames} value={fileName} onChange={setFileName} required className={selectField} />
            </Field>
            <Field label="Thickness of Slab (cm)" htmlFor="thicknessCm" error={errors?.thicknessCm?.[0]}>
              <input id="thicknessCm" name="thicknessCm" inputMode="decimal" defaultValue={d.thicknessCm} className={field} />
            </Field>
            <Field label={props.stage === 'RETURNED' ? 'In-time *' : 'In-time'} htmlFor="inTime" error={errors?.inTime?.[0]}>
              <TimeInput id="inTime" name="inTime" value={inTime} onChange={setInTime} placeholder="10:30" className={field} />
            </Field>
          </FieldGrid>
        </div>
      </SectionCard>

      {/* ──────────────────────────────────────────────────── C. QC Report */}
      <SectionCard title="C. QC Report" accent="grade">
        {canGrade ? (
          <QcSection
            optional
            remarksField
            recalibrationReasons={props.recalibrationReasons}
            errors={errors}
            initial={{ slabRemarks: props.qc.remarks, reasonName: '' }}
          />
        ) : (
          <div className="flex flex-col gap-5">
            <FieldGrid>
              <Field label="Grade" htmlFor="shown-grade">
                <div id="shown-grade" className="flex h-11 items-center">
                  {props.qc.grade ? <GradeBadge grade={props.qc.grade as never} /> : <span className="text-muted">—</span>}
                </div>
              </Field>
              <Field label="QC Outcome" htmlFor="shown-outcome">
                <div id="shown-outcome" className="flex h-11 items-center">
                  {props.qc.disposition ? <DispositionBadge disposition={props.qc.disposition as never} /> : <span className="text-muted">—</span>}
                </div>
              </Field>
            </FieldGrid>
            {canReason ? (
              <FieldGrid>
                <Field label="Reason for Recalibration" htmlFor="recalibrationReason" error={errors?.recalibrationReason?.[0]}>
                  <ComboInput
                    id="recalibrationReason"
                    name="recalibrationReason"
                    options={props.recalibrationReasons.map((r) => r.name)}
                    value={reason}
                    onChange={setReason}
                    placeholder="Pick one, or type a new reason"
                    className={field}
                  />
                </Field>
              </FieldGrid>
            ) : (
              <input type="hidden" name="recalibrationReason" value={props.qc.reason} />
            )}
            <FieldGrid>
              <Field label="Slab Remarks" htmlFor="slabRemarks" error={errors?.slabRemarks?.[0]}>
                <input id="slabRemarks" name="slabRemarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" maxLength={500} className={field} />
              </Field>
            </FieldGrid>
            <p className="text-muted text-xs">
              {props.stage === 'AWAITING_SEND' || props.stage === 'OUT'
                ? 'The slab is graded again on its new pass, once it is back and its details are updated.'
                : 'QC is settled for this slab.'}
            </p>
          </div>
        )}
      </SectionCard>

      <div className="flex flex-col gap-3">
        <FormError message={state.error} />
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="submit"
            disabled={busy}
            className="bg-brand-600 hover:bg-brand-700 inline-flex h-11 items-center justify-center rounded-lg px-6 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(16,24,40,0.12)] transition-colors disabled:cursor-not-allowed disabled:opacity-55"
          >
            {isPending ? 'Saving…' : isReturning || state.savedAt ? 'Saved — returning…' : 'Update Slab'}
          </button>
          <span className="text-muted text-sm">Saves only what you entered or changed, in any of the three parts — an earlier trip’s dates included.</span>
        </div>
      </div>
    </form>
  );
}
