'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Field, FormError } from '@/components/chromia/ui';
import { ComboInput } from '@/components/chromia/ui/combo';
import { field, FieldGrid, SectionCard, selectField } from '@/components/chromia/ui/form';
import { DispositionBadge, GradeBadge } from '@/components/chromia/ui/status';
import { TimeInput } from '@/components/chromia/ui/time-input';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { updateTrimmingSlabAction, type TrimmingFormState } from '@/lib/chromia/server/actions/trimming';
import { TRIM_OTHER, TRIM_PRESETS } from '@/lib/chromia/trimming';

import { QcSection, type Option } from '../../slabs/new/qc-section';

export interface TrimmingDetails {
  productionDate: string;
  batchNo: string;
  slabNo: string;
  baseMaterial: string;
  fileName: string;
  thicknessCm: string;
  inTime: string;
}

interface Props {
  id: string;
  /** Is there a Chromia slab behind it? False for a slab without design printing, until graded. */
  linked: boolean;
  /** "3 cm (30 mm)", from the slab's own record — or the record's, without printing. */
  currentThickness: string;
  trim: { choice: string; fromMm: string; toMm: string; otherFromCm: string; otherToCm: string };
  dates: { sent: string; received: string };
  details: TrimmingDetails;
  qc: { grade: string; disposition: string; remarks: string };
  /** The QC Report after trimming is saved. */
  graded: boolean;
  recalibrationReasons: Option[];
  baseMaterials: string[];
  fileNames: string[];
  batchNos: string[];
  today: string;
}

/**
 * One slab's Trimming page (7 Nov 2026), laid out as the Recalibration slab
 * page: four parts, all visible, saved by one Update Slab button
 * (updateTrimmingSlabAction). Each part saves only if something in it was
 * entered or changed, so any one can be saved alone and nothing else is
 * touched — the Sent Date now, the Received Date later, From → To whenever.
 *
 *   A  Trimmed From → To — the slab's current thickness, and 3 cm → 2 cm,
 *      2 cm → 1.2 cm or Others (From and To typed, in cm or mm).
 *   B  Send & Receive — the Sent Date and the Received Date, nothing else.
 *   C  Update Slab Details — the Slab Entry fields, pre-filled.
 *   D  QC Report — once the slab is back: A → Stock, B → Stock or Sample
 *      Cutting, C → Recalibration.
 *
 * After a successful save the page returns to Trimming.
 */
export function TrimmingSlabForm(props: Props) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<TrimmingFormState, FormData>(updateTrimmingSlabAction, {});
  const [isReturning, startReturn] = useTransition();
  const handled = useRef<number | null>(null);
  const [choice, setChoice] = useState(props.trim.choice);
  const [received, setReceived] = useState(props.dates.received);
  const [inTime, setInTime] = useState(props.details.inTime);
  const [baseMaterial, setBaseMaterial] = useState(props.details.baseMaterial);
  const [fileName, setFileName] = useState(props.details.fileName);
  const [remarks, setRemarks] = useState(props.qc.remarks);

  useEffect(() => {
    if (!state.savedAt || handled.current === state.savedAt) return;
    handled.current = state.savedAt;
    startReturn(() => router.push(APP_ROUTES.trimming));
  }, [state.savedAt, router]);

  const errors = state.fieldErrors;
  const busy = isPending || isReturning || Boolean(state.savedAt);
  // Graded once it is back: a Received Date saved, or entered in this save.
  const canGrade = !props.graded && received !== '';
  const d = props.details;
  // A slab without design printing has no line details of its own yet.
  const req = props.linked ? ' *' : '';

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="id" value={props.id} />
      <input type="hidden" name="initialTrimFromMm" value={props.trim.fromMm} />
      <input type="hidden" name="initialTrimToMm" value={props.trim.toMm} />
      <input type="hidden" name="initialSentDate" value={props.dates.sent} />
      <input type="hidden" name="initialReceivedDate" value={props.dates.received} />
      {(Object.keys(d) as (keyof TrimmingDetails)[]).map((key) => (
        <input key={key} type="hidden" name={`initial_${key}`} value={d[key]} />
      ))}
      <input type="hidden" name="initialRemarks" value={props.qc.remarks} />

      {/* ──────────────────────────────────────────── A. Trimmed From → To */}
      <SectionCard title="A. Trimmed From → To" accent="grade">
        <FieldGrid columns={3}>
          <Field label="Current Thickness" htmlFor="currentThickness">
            <div id="currentThickness" className={`${field} flex items-center font-medium tabular-nums`}>
              {props.currentThickness}
            </div>
          </Field>
          <Field label="Trimmed From → To" htmlFor="trimChoice" error={errors?.trimFrom?.[0]}>
            <select id="trimChoice" name="trimChoice" value={choice} onChange={(e) => setChoice(e.target.value)} className={selectField}>
              <option value="">Select</option>
              {TRIM_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {preset.label}
                </option>
              ))}
              <option value={TRIM_OTHER}>Others</option>
            </select>
          </Field>
        </FieldGrid>
        {choice === TRIM_OTHER ? (
          <div className="mt-4">
            <FieldGrid columns={3}>
              <Field label="From *" htmlFor="trimFrom">
                <input id="trimFrom" name="trimFrom" inputMode="decimal" required defaultValue={props.trim.otherFromCm} placeholder="e.g. 3" className={field} />
              </Field>
              <Field label="To *" htmlFor="trimTo">
                <input id="trimTo" name="trimTo" inputMode="decimal" required defaultValue={props.trim.otherToCm} placeholder="e.g. 2" className={field} />
              </Field>
              <Field label="Unit" htmlFor="trimUnit">
                <select id="trimUnit" name="trimUnit" defaultValue="cm" className={selectField}>
                  <option value="cm">cm</option>
                  <option value="mm">mm</option>
                </select>
              </Field>
            </FieldGrid>
          </div>
        ) : null}
      </SectionCard>

      {/* ──────────────────────────────────────────────── B. Send & Receive */}
      <SectionCard title="B. Send & Receive" accent="grade">
        <FieldGrid>
          <Field label="Sent Date" htmlFor="sentDate" error={errors?.sentDate?.[0]}>
            <input id="sentDate" name="sentDate" type="date" max={props.today} defaultValue={props.dates.sent} className={field} />
          </Field>
          <Field
            label="Received Date"
            htmlFor="receivedDate"
            error={errors?.receivedDate?.[0]}
            hint="Leave empty until the slab comes back — save the Sent Date alone"
          >
            <input
              id="receivedDate"
              name="receivedDate"
              type="date"
              max={props.today}
              value={received}
              onChange={(e) => setReceived(e.target.value)}
              className={field}
            />
          </Field>
        </FieldGrid>
      </SectionCard>

      {/* ──────────────────────────────────────────── C. Update Slab Details */}
      <SectionCard title="C. Update Slab Details" accent="active">
        <FieldGrid columns={3}>
          <Field label={`Production Date${req}`} htmlFor="productionDate" error={errors?.productionDate?.[0]}>
            <input id="productionDate" name="productionDate" type="date" required={props.linked} defaultValue={d.productionDate} className={field} />
          </Field>
          <Field label="Batch No. *" htmlFor="batchNo" error={errors?.batchNo?.[0]}>
            <input id="batchNo" name="batchNo" required list="trim-batches" defaultValue={d.batchNo} className={`${field} font-mono`} />
            <datalist id="trim-batches">
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
          <Field label={`File Name / Planned Design${req}`} htmlFor="fileName" error={errors?.fileName?.[0]}>
            <ComboInput id="fileName" name="fileName" options={props.fileNames} value={fileName} onChange={setFileName} required={props.linked} className={selectField} />
          </Field>
          <Field label="Thickness of Slab (cm)" htmlFor="thicknessCm" error={errors?.thicknessCm?.[0]}>
            <input id="thicknessCm" name="thicknessCm" inputMode="decimal" defaultValue={d.thicknessCm} className={field} />
          </Field>
          <Field label="In-time" htmlFor="inTime" error={errors?.inTime?.[0]}>
            <TimeInput id="inTime" name="inTime" value={inTime} onChange={setInTime} placeholder="10:30" className={field} />
          </Field>
        </FieldGrid>
      </SectionCard>

      {/* ──────────────────────────────────────────────────── D. QC Report */}
      <SectionCard title="D. QC Report" accent="grade">
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
              <Field label="Grade" htmlFor="shown-grade" error={errors?.grade?.[0]}>
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
            <FieldGrid>
              <Field label="Slab Remarks" htmlFor="slabRemarks" error={errors?.slabRemarks?.[0]}>
                <input id="slabRemarks" name="slabRemarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" maxLength={500} className={field} />
              </Field>
            </FieldGrid>
            <p className="text-muted text-xs">
              {props.graded ? 'Its QC Report after trimming is saved.' : 'The slab is graded again once it is back from trimming — enter its Received Date.'}
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
          <span className="text-muted text-sm">Saves only what you entered or changed, in any of the four parts.</span>
        </div>
      </div>
    </form>
  );
}
