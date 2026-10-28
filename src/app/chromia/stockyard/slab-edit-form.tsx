'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Field, FormError } from '@/components/chromia/ui';
import { ComboInput } from '@/components/chromia/ui/combo';
import { field, FieldGrid, SectionCard, selectField } from '@/components/chromia/ui/form';
import { DispositionBadge, GradeBadge } from '@/components/chromia/ui/status';
import { TimeInput } from '@/components/chromia/ui/time-input';
import { STOCK_OUTCOME_LABELS } from '@/lib/chromia/constants/stock-outcomes';
import { updateStockyardSlabAction, type StockyardEditFormState } from '@/lib/chromia/server/actions/stockyard-edit';

export interface EditDetails {
  productionDate: string;
  batchNo: string;
  slabNo: string;
  baseMaterial: string;
  fileName: string;
  thicknessCm: string;
  inTime: string;
}

interface Props {
  /** 'stockyard' adds the Stock Outcome part; 'approved' is entry and QC only. */
  form: 'stockyard' | 'approved';
  slabId: string;
  details: EditDetails;
  qc: { grade: string; disposition: string; remarks: string };
  /** The Stockyard has this slab: its grade (and outcome) can be corrected. */
  editable: boolean;
  /** IN_STOCK, DISPATCH, APPROVED or SAMPLE_CUTTING — where the Stockyard has it. */
  outcome: string;
  outcomeDate: string;
  /** The plant day it was stocked: the earliest Stock Outcome date. */
  stockedOn: string;
  today: string;
  baseMaterials: string[];
  fileNames: string[];
  batchNos: string[];
  /** Where to go after a save. */
  returnTo: string;
}

const PLACE_LABEL: Record<string, string> = { IN_STOCK: 'Back in Stock (no outcome)', ...STOCK_OUTCOME_LABELS };

/**
 * Edit one slab from the Stockyard or Approved Slabs (28 Oct 2026): its New
 * Entry fields and QC Report pre-filled from the saved record — and, on the
 * Stockyard, its Stock Outcome and date — saved together by one Update Slab
 * (updateStockyardSlabAction), which changes only what was changed. The
 * hidden initial_* values are what was saved, to compare against.
 */
export function StockyardSlabEditForm(props: Props) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<StockyardEditFormState, FormData>(updateStockyardSlabAction, {});
  const [isReturning, startReturn] = useTransition();
  const handled = useRef<number | null>(null);
  const [inTime, setInTime] = useState(props.details.inTime);
  const [baseMaterial, setBaseMaterial] = useState(props.details.baseMaterial);
  const [fileName, setFileName] = useState(props.details.fileName);
  const [outcome, setOutcome] = useState(props.outcome);

  useEffect(() => {
    if (!state.savedAt || handled.current === state.savedAt) return;
    handled.current = state.savedAt;
    startReturn(() => router.push(props.returnTo));
  }, [state.savedAt, router, props.returnTo]);

  const errors = state.fieldErrors;
  const d = props.details;
  const busy = isPending || isReturning || Boolean(state.savedAt);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="form" value={props.form} />
      <input type="hidden" name="slabId" value={props.slabId} />
      {(Object.keys(d) as (keyof EditDetails)[]).map((key) => (
        <input key={key} type="hidden" name={`initial_${key}`} value={d[key]} />
      ))}
      <input type="hidden" name="initialGrade" value={props.qc.grade} />
      <input type="hidden" name="initialRemarks" value={props.qc.remarks} />
      <input type="hidden" name="initialOutcome" value={props.outcome} />
      <input type="hidden" name="initialOutcomeDate" value={props.outcomeDate} />
      <input type="hidden" name="stockedOn" value={props.stockedOn} />

      {/* ───────────────────────────────────────────────────── New Entry */}
      <SectionCard title="New Entry" accent="active">
        <FieldGrid columns={3}>
          <Field label="Production Date *" htmlFor="productionDate" error={errors?.productionDate?.[0]}>
            <input id="productionDate" name="productionDate" type="date" required max={props.today} defaultValue={d.productionDate} className={field} />
          </Field>
          <Field label="Batch No. *" htmlFor="batchNo" error={errors?.batchNo?.[0]}>
            <input id="batchNo" name="batchNo" required list="edit-batches" defaultValue={d.batchNo} className={`${field} font-mono`} />
            <datalist id="edit-batches">
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
          <Field label="In-time" htmlFor="inTime" error={errors?.inTime?.[0]}>
            <TimeInput id="inTime" name="inTime" value={inTime} onChange={setInTime} placeholder="10:30" className={field} />
          </Field>
        </FieldGrid>
      </SectionCard>

      {/* ───────────────────────────────────────────────────── QC Report */}
      <SectionCard title="QC Report" accent="grade">
        <div className="flex flex-col gap-4">
          <FieldGrid>
            {props.editable ? (
              <Field label="Grade *" htmlFor="grade" error={errors?.grade?.[0]} hint="A or B — both go to Stock, so the slab stays where it is">
                <select id="grade" name="grade" defaultValue={props.qc.grade} className={selectField}>
                  <option value="A">Grade A</option>
                  <option value="B">Grade B</option>
                </select>
              </Field>
            ) : (
              <Field label="Grade" htmlFor="shown-grade" error={errors?.grade?.[0]}>
                <input type="hidden" name="grade" value={props.qc.grade} />
                <div id="shown-grade" className="flex h-11 items-center">
                  {props.qc.grade ? <GradeBadge grade={props.qc.grade as never} /> : <span className="text-muted">—</span>}
                </div>
              </Field>
            )}
            <Field label="QC Outcome" htmlFor="shown-outcome">
              <div id="shown-outcome" className="flex h-11 items-center">
                {props.qc.disposition ? <DispositionBadge disposition={props.qc.disposition as never} /> : <span className="text-muted">—</span>}
              </div>
            </Field>
          </FieldGrid>
          <FieldGrid>
            <Field label="Slab Remarks" htmlFor="slabRemarks" error={errors?.slabRemarks?.[0]}>
              <input id="slabRemarks" name="slabRemarks" defaultValue={props.qc.remarks} placeholder="Optional" maxLength={500} className={field} />
            </Field>
          </FieldGrid>
          {!props.editable ? (
            <p className="text-muted text-xs">This slab is no longer the Stockyard’s, so its grade is corrected on Slab Records.</p>
          ) : null}
        </div>
      </SectionCard>

      {/* ───────────────────────────────────── Stock Outcome (Stockyard) */}
      {props.form === 'stockyard' ? (
        <SectionCard title="Stock Outcome" accent="brand">
          {props.editable ? (
            <FieldGrid>
              <Field label="Stock Outcome" htmlFor="outcome" error={errors?.outcome?.[0]}>
                <select id="outcome" name="outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} className={selectField}>
                  {Object.entries(PLACE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label={outcome === 'IN_STOCK' ? 'Date' : 'Date *'}
                htmlFor="outcomeDate"
                error={errors?.outcomeDate?.[0]}
                hint={outcome === 'IN_STOCK' ? 'On the racks — no outcome date' : 'The day the slab left the rack'}
              >
                <input
                  id="outcomeDate"
                  name="outcomeDate"
                  type="date"
                  min={props.stockedOn || undefined}
                  max={props.today}
                  defaultValue={props.outcomeDate}
                  disabled={outcome === 'IN_STOCK'}
                  required={outcome !== 'IN_STOCK'}
                  className={field}
                />
              </Field>
            </FieldGrid>
          ) : (
            <>
              <input type="hidden" name="outcome" value={props.outcome} />
              <p className="text-muted text-sm">This slab is no longer the Stockyard’s, so its Stock Outcome cannot be changed here.</p>
            </>
          )}
        </SectionCard>
      ) : null}

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
          <span className="text-muted text-sm">Saves only what you changed. The same slab record is corrected — nothing is duplicated.</span>
        </div>
      </div>
    </form>
  );
}
