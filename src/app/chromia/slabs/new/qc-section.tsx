'use client';

import { useState } from 'react';

import { ComboInput } from '@/components/chromia/ui/combo';

import { Field } from '@/components/chromia/ui';
import { DispositionBadge, GradeBadge } from '@/components/chromia/ui/status';
import { DISPOSITION_LABELS, GRADE_ALLOWED_DISPOSITIONS } from '@/lib/chromia/constants/process-stages';
import { Disposition, SlabGrade } from '@/lib/chromia/constants/process-stages';

import { field, FieldGrid, OutcomePanel, selectField } from './ui';

export interface Option {
  id: string;
  name: string;
}

interface Props {
  recalibrationReasons: Option[];
  errors?: Record<string, string[] | undefined>;
  /** Pre-filled values when correcting an already-graded slab (the Edit path). */
  initial?: {
    grade?: string;
    disposition?: string;
    slabRemarks?: string;
    reasonName?: string;
  };
  /**
   * Show Slab Remarks as a field of its own (Slab Entry's QC Report). Off, the
   * remark the slab already carries rides along unchanged in a hidden input —
   * the re-grade after recalibration, which has no remarks field, must not
   * blank what was written at entry.
   */
  remarksField?: boolean;
  /**
   * Grade is optional here: Slab Entry saves a slab with no grade as
   * In-Processing, its QC Report to be finished later. Off (the default), a
   * grade is required, as on every screen whose only job is grading.
   */
  optional?: boolean;
}

const GRADE_OPTIONS = [
  { value: SlabGrade.A, label: 'Grade A' },
  { value: SlabGrade.B, label: 'Grade B' },
  { value: SlabGrade.C, label: 'Grade C' },
] as const;

/** The outcome a grade decides by itself, when it allows exactly one. */
function onlyOutcome(grade: string): string {
  const allowed = grade ? GRADE_ALLOWED_DISPOSITIONS[grade as keyof typeof GRADE_ALLOWED_DISPOSITIONS] : [];
  return allowed.length === 1 ? allowed[0] : '';
}

/**
 * QC Report.
 *
 *   Grade A → Stock                       (set by the grade)
 *   Grade B → Stock · Sample Cutting      (chosen)
 *   Grade C → Recalibration               (set by the grade)
 *
 * QC decides the grade and the outcome that grade allows, and nothing else at
 * the bench: the dates a slab is stocked or cut are captured on those sections'
 * own screens, when the slab actually gets there. Recalibration keeps its
 * reason, which is decided here.
 *
 * SLAB REMARKS ARE THE GRADER'S OWN WORDS (27 Oct 2026). The remark used to be
 * filled in behind the scenes with the outcome ("Stock", "RECALIBRATE - Roller
 * Mark"), so the column repeated what QC Outcome already said. It is now a
 * plain optional field that stays empty unless somebody types in it, kept
 * apart from the outcome.
 */
export function QcSection({ recalibrationReasons, errors, initial, remarksField = false, optional = false }: Props) {
  const [grade, setGrade] = useState<string>(initial?.grade ?? '');
  const [disposition, setDisposition] = useState<string>(
    initial?.disposition || onlyOutcome(initial?.grade ?? ''),
  );
  const [remarks, setRemarks] = useState(initial?.slabRemarks ?? '');
  const [reasonName, setReasonName] = useState(initial?.reasonName ?? '');

  const allowed = grade
    ? GRADE_ALLOWED_DISPOSITIONS[grade as keyof typeof GRADE_ALLOWED_DISPOSITIONS]
    : [];
  // A and C decide their outcome; only B asks for one.
  const fixed = allowed.length === 1;

  function chooseGrade(value: string) {
    setGrade(value);
    setDisposition(onlyOutcome(value));
    setReasonName('');
  }

  return (
    <div className="flex flex-col gap-6">
      <FieldGrid>
        <Field
          label={optional ? 'Decide Grade' : 'Decide Grade *'}
          htmlFor="grade"
          error={errors?.grade?.[0]}
          hint={optional && !grade ? 'Leave empty to save the slab as In-Processing' : undefined}
          badge={grade ? <GradeBadge grade={grade as SlabGrade} /> : undefined}
        >
          <select
            id="grade"
            name="grade"
            required={!optional}
            className={selectField}
            value={grade}
            onChange={(event) => chooseGrade(event.target.value)}
          >
            <option value="" disabled={!optional}>
              {optional ? 'Not graded yet' : 'Select grade'}
            </option>
            {GRADE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label={grade ? 'QC Outcome *' : 'QC Outcome'}
          htmlFor="disposition"
          error={errors?.disposition?.[0]}
          hint={grade ? (fixed ? `Set by Grade ${grade}` : undefined) : 'Choose a grade first'}
          badge={
            disposition ? <DispositionBadge disposition={disposition as Disposition} /> : undefined
          }
        >
          {/* A fixed outcome is shown, not offered: a select with one option
              reads as a choice nobody can make. The value still travels in the
              hidden input, and the server derives it from the grade regardless. */}
          {fixed ? (
            <>
              <input
                id="disposition"
                readOnly
                value={DISPOSITION_LABELS[disposition as keyof typeof DISPOSITION_LABELS] ?? ''}
                className={`${selectField} cursor-default`}
              />
              <input type="hidden" name="disposition" value={disposition} />
            </>
          ) : (
            <select
              id="disposition"
              name="disposition"
              required={Boolean(grade)}
              disabled={!grade}
              className={selectField}
              value={disposition}
              onChange={(event) => setDisposition(event.target.value)}
            >
              <option value="" disabled>
                {grade ? 'Select outcome' : '—'}
              </option>
              {allowed.map((value) => (
                <option key={value} value={value}>
                  {DISPOSITION_LABELS[value]}
                </option>
              ))}
            </select>
          )}
        </Field>
      </FieldGrid>

      {/* Recalibration keeps its reason — the one outcome-specific field QC
          still fills, because the reason is decided at the bench, not later. */}
      {disposition === Disposition.RECALIBRATION ? (
        <OutcomePanel title="Recalibration">
          <FieldGrid>
            <Field
              label="Recalibrate Reason"
              htmlFor="recalibrationReason"
              error={errors?.recalibrationReason?.[0]}
            >
              <ComboInput
                id="recalibrationReason"
                name="recalibrationReason"
                options={recalibrationReasons.map((reason) => reason.name)}
                value={reasonName}
                onChange={setReasonName}
                placeholder="Pick one, or type a new reason"
                className={field}
              />
            </Field>
          </FieldGrid>
        </OutcomePanel>
      ) : null}

      {remarksField ? (
        <FieldGrid>
          <Field label="Slab Remarks" htmlFor="slabRemarks" error={errors?.slabRemarks?.[0]}>
            <input
              id="slabRemarks"
              name="slabRemarks"
              value={remarks}
              onChange={(event) => setRemarks(event.target.value)}
              placeholder="Optional"
              maxLength={500}
              className={field}
            />
          </Field>
        </FieldGrid>
      ) : (
        <input type="hidden" name="slabRemarks" value={remarks} />
      )}
    </div>
  );
}
