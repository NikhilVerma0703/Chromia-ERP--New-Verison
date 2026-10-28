import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState, PageHeader } from '@/components/chromia/ui';
import { dataTable, SectionCard } from '@/components/chromia/ui/form';
import { DispositionBadge, GradeBadge } from '@/components/chromia/ui/status';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { toDateInput, toTimeInput } from '@/lib/chromia/operator-register';
import { qcCorrectionRefusal } from '@/lib/chromia/qc-correction';
import { needsIntakeQc } from '@/lib/chromia/slab-links';
import { manualRemark } from '@/lib/chromia/slab-remarks';
import { link } from '@/lib/chromia/ui';
import { listRecalibrationReasons } from '@/lib/chromia/server/repositories/recalibration-repository';
import { loadSlabRecord } from '@/lib/chromia/server/repositories/slab-record-repository';
import { PLANT_TIME_ZONE } from '@/lib/chromia/plant-time';
import {
  loadBaseMaterialNames,
  loadDesignFileNames,
  loadRecentBatchNos,
  loadRecentRegister,
} from '@/lib/chromia/server/services/operator-service';
import { requirePageUser } from '@/lib/pageUser';

import { EntryForm, type QcReport } from './entry-form';

export const metadata: Metadata = { title: 'Slab Entry' };
export const dynamic = 'force-dynamic';

// Plant time (IST), 24-hour — what the Entered column and the in-time show.
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: PLANT_TIME_ZONE });

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric', timeZone: PLANT_TIME_ZONE, });

const { th, td } = dataTable;

/** `?slab=` — the one this screen is open on, if any. */
function resolveSlabId(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.trim() !== '' ? value.trim() : null;
}

/** `?date=` if it is a real date, otherwise today. Only seeds the blank form. */
function resolveDay(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return toDateInput(new Date());
}

/**
 * Slab Entry (was Operator Entry; renamed 27 Oct 2026) — the shop-floor
 * register, digitised.
 *
 * The register shows exactly what the operator entered: S.No., Production Date,
 * Batch No., Slab No., Base Material / Slab Name, File Name / Planned Design,
 * Thickness and In-time. The operator does not record individual stages — the
 * slab goes into Base Primer and comes out three to four hours later.
 *
 * ── ONE FORM: NEW ENTRY → QC REPORT → SAVE ENTRY ────────────────────────────
 * QC used to be a page of its own, then a second form under the entry with its
 * own button. Now the QC Report is part of the entry form and one Save Entry
 * saves both (saveSlabEntryAction). A slab saved with no grade is
 * In-Processing: Recent Slabs Entry says so in QC Outcome and marks its slab
 * number until its QC Report is saved. Opening a slab (`?slab=<id>`) fills the
 * form with what was recorded, to correct it or to finish its QC Report.
 *
 * The route is still /chromia/operator, so every link and bookmark holds.
 */
export default async function OperatorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Signed in, or no further, on every visit: the module layout's gate is
  // not run again when the browser moves between this module's pages
  // (requirePageUser in lib/pageUser.ts says why).
  await requirePageUser();
  const params = await searchParams;
  const slabId = resolveSlabId(params.slab);
  // `?edit=1` — opened from Slab Records "Edit" for a full correction of the
  // record, QC included, rather than the normal grade-a-new-slab flow.
  const editMode = (Array.isArray(params.edit) ? params.edit[0] : params.edit) === '1';
  // The filtered Slab Records view this slab was opened from, if any — carried
  // through so saving its QC returns there instead of the bare list. See
  // slabHref and completeSlabAction.
  const backRaw = Array.isArray(params.back) ? params.back[0] : params.back;
  const back = backRaw && backRaw.trim() !== '' ? backRaw : undefined;

  const [rows, baseMaterials, fileNames, batchNos, selected, recalibrationReasons] =
    await Promise.all([
      loadRecentRegister(),
      loadBaseMaterialNames(),
      loadDesignFileNames(),
      loadRecentBatchNos(),
      slabId ? loadSlabRecord(slabId) : Promise.resolve(null),
      // The QC Report is on every entry now, new rows included.
      listRecalibrationReasons(),
    ]);

  /* A slab that has already been graded, or is away at the recalibration
     facility, has no QC left to do — its entry is still shown so it can be
     corrected, but the QC section is not offered. Same rule as slabHref, so a
     link that exists always leads to something. */
  const qcOpen = selected !== null && needsIntakeQc(selected.status);

  // Whether this slab's QC may be redone on the Edit path — the one rule the
  // save itself enforces (resetSlabQcForCorrection), so the section is never
  // offered for a save that would be refused. A slab mid-recalibration has a
  // multi-cycle journey the Recalibration page owns, and says where to go; a
  // slab that has been dispatched, written off, or cut for samples after its
  // QC has left, and its QC stays as it is (CHR-1, the code review of 20 Oct
  // 2026). Its entry fields above can still be corrected either way.
  const correctionRefusal =
    selected === null
      ? null
      : qcCorrectionRefusal({
          slabNo: selected.slabNo,
          status: selected.status,
          currentDisposition: selected.currentDisposition,
          decidedDisposition: selected.decidedDisposition,
          hasDispatch: selected.hasDispatch,
        });

  /* What the QC Report under the entry can do for this slab. The same three
     answers the separate QC section gave: grade it, correct it on the Edit
     path, or say why its QC is settled. */
  const qc: QcReport = !selected
    ? { mode: 'grade', recalibrationReasons }
    : editMode
      ? correctionRefusal?.reason === 'IN_RECALIBRATION'
        ? {
            mode: 'none',
            recalibrationReasons,
            message: (
              <>
                Slab {selected.slabNo} is in a recalibration cycle — correct it on the{' '}
                <Link href={APP_ROUTES.recalibrations} className={link}>
                  Recalibration
                </Link>{' '}
                page.
              </>
            ),
          }
        : correctionRefusal
          ? { mode: 'none', recalibrationReasons, message: correctionRefusal.message }
          : {
              mode: 'correct',
              recalibrationReasons,
              initial: {
                grade: selected.currentGrade ?? '',
                disposition: selected.currentDisposition ?? '',
              },
            }
      : qcOpen
        ? { mode: 'grade', recalibrationReasons }
        : {
            mode: 'none',
            recalibrationReasons,
            message: (
              <>
                Slab {selected.slabNo} has already been graded — its outcome is on{' '}
                <Link href={APP_ROUTES.slabs} className={link}>
                  Slab Records
                </Link>
                .
              </>
            ),
          };

  return (
    <>
      <PageHeader
        eyebrow="Shop floor"
        title="Slab entry"
        description={
          selected
            ? editMode
              ? `Slab ${selected.slabNo} — correct any field, including QC, below`
              : qcOpen
                ? `Slab ${selected.slabNo} — correct the entry, or finish its QC Report below`
                : `Slab ${selected.slabNo} — correct the entry below`
            : 'Book slabs onto the line, with their QC Report'
        }
        actions={
          selected ? (
            <Link
              href={APP_ROUTES.operator}
              className="border-line surface hover:border-line-strong inline-flex h-11 items-center justify-center rounded-lg border px-4 text-sm font-medium transition-colors hover:bg-[var(--surface-muted)]"
            >
              New entry
            </Link>
          ) : null
        }
      />

      {/*
       * `key` per slab, and it is load-bearing. The App Router keeps a
       * segment's React state across a search-param change on purpose — its own
       * words: "search params do not cause state to be lost" — so going from
       * ?slab=A to ?slab=B, or from a half-typed new entry to a slab, would
       * re-render the form with the new id and the OLD field values still in
       * state. The next Save would write one slab's numbers onto another.
       * Keying on the slab makes each one a fresh form.
       */}
      <EntryForm
        key={`${slabId ?? 'new'}${editMode ? ':edit' : ''}`}
        baseMaterials={baseMaterials}
        entryDate={resolveDay(params.date)}
        nowTime={toTimeInput(new Date())}
        fileNames={fileNames}
        batchNos={batchNos}
        qc={qc}
        back={back}
        editing={
          selected
            ? {
                id: selected.id,
                slabNo: selected.slabNo,
                batchNo: selected.batchNo,
                baseMaterial: selected.baseMaterial,
                fileName: selected.designFileName,
                thicknessCm: selected.thicknessCm === null ? '' : String(selected.thicknessCm),
                receivedDate: toDateInput(selected.receivedDate),
                inTime: selected.inTime ? toTimeInput(selected.inTime) : '',
                remarks: manualRemark(selected.remarks, selected.currentDisposition) ?? '',
              }
            : undefined
        }
      />

      <SectionCard
        title="Recent Slabs Entry"
        accent="brand"
        padded={rows.length === 0}
        actions={
          <span className="border-line surface text-muted rounded-full border px-3 py-1 text-xs font-medium">
            last <span className="text-foreground font-semibold tabular-nums">{rows.length}</span>{' '}
            entered
          </span>
        }
      >
        {rows.length === 0 ? (
          <EmptyState>Nothing entered yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className={dataTable.root}>
              <thead className={dataTable.head}>
                <tr>
                  <th className={`${th} w-20`}>S. No.</th>
                  <th className={th}>Production Date</th>
                  <th className={th}>Batch No.</th>
                  <th className={th}>Slab No.</th>
                  <th className={th}>Base Material / Slab Name</th>
                  <th className={th}>File Name / Planned Design</th>
                  <th className={`${th} text-right`}>Thickness (cm)</th>
                  <th className={`${th} text-right`}>In-time</th>
                  <th className={th}>Grade</th>
                  <th className={th}>QC Outcome</th>
                  <th className={th}>Slab Remarks</th>
                  {/* The order the rows are in, made visible: without it a list
                      that mixes production dates looks arbitrarily sorted. */}
                  <th className={`${th} text-right`}>Entered</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className={`${dataTable.row} ${row.id === slabId ? 'bg-[var(--surface-muted)]' : ''}`}
                  >
                    <td className={`${td} text-muted tabular-nums`}>{row.serialNo ?? '—'}</td>
                    <td className={`${td} whitespace-nowrap`}>{dateFmt.format(row.receivedDate)}</td>
                    <td className={`${td} font-mono`}>{row.batchNo}</td>
                    <td className={td}>
                      {/* QC pending: the number is marked in the hold colour
                          until the slab's QC Report is saved. */}
                      <Link
                        href={`${APP_ROUTES.operator}?slab=${row.id}`}
                        title={row.pendingQc ? 'QC pending — open to finish its QC Report' : undefined}
                        className={
                          row.pendingQc
                            ? 'text-status-processing inline-flex items-center gap-1.5 font-mono font-semibold underline decoration-dotted underline-offset-4'
                            : `${link} font-mono`
                        }
                      >
                        {row.pendingQc ? <span aria-hidden className="bg-status-processing inline-block size-1.5 rounded-full" /> : null}
                        {row.slabNo}
                      </Link>
                    </td>
                    <td className={td}>{row.baseMaterial}</td>
                    <td className={td}>{row.fileName ?? '—'}</td>
                    <td className={`${td} text-right tabular-nums`}>
                      {row.thicknessCm === null ? '—' : row.thicknessCm}
                    </td>
                    <td className={`${td} text-right tabular-nums`}>
                      {row.inTime ? timeFmt.format(row.inTime) : '—'}
                    </td>
                    <td className={td}>
                      {row.currentGrade ? <GradeBadge grade={row.currentGrade} /> : <span className="text-muted">—</span>}
                    </td>
                    <td className={td}>
                      {row.pendingQc ? (
                        <span className="text-status-processing text-sm font-semibold whitespace-nowrap">In-Processing</span>
                      ) : (
                        <DispositionBadge disposition={row.currentDisposition} />
                      )}
                    </td>
                    <td className={`${td} max-w-[16rem]`}>
                      {manualRemark(row.remarks, row.currentDisposition) ?? <span className="text-muted">—</span>}
                    </td>
                    <td className={`${td} text-muted text-right whitespace-nowrap tabular-nums`}>
                      {dateFmt.format(row.enteredAt)} {timeFmt.format(row.enteredAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </>
  );
}
