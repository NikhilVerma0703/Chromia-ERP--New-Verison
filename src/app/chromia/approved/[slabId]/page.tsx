import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { EmptyState, Field, PageHeader } from '@/components/chromia/ui';
import { field, FieldGrid, SectionCard } from '@/components/chromia/ui/form';
import { GradeBadge } from '@/components/chromia/ui/status';
import { API_ROUTES, APP_ROUTES } from '@/lib/chromia/constants/app';
import { DISPOSITION_LABELS } from '@/lib/chromia/constants/process-stages';
import { toDateInput, toTimeInput } from '@/lib/chromia/operator-register';
import { PLANT_TIME_ZONE } from '@/lib/chromia/plant-time';
import { manualRemark } from '@/lib/chromia/slab-remarks';
import { loadApproval, latestSlabPhotos } from '@/lib/chromia/server/repositories/approved-repository';
import { loadSlabRecord } from '@/lib/chromia/server/repositories/slab-record-repository';
import { requirePageUser } from '@/lib/pageUser';

import { PhotoCapture } from './photo-capture';

export const metadata: Metadata = { title: 'Approved Slab' };
export const dynamic = 'force-dynamic';

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: PLANT_TIME_ZONE });
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: PLANT_TIME_ZONE,
});

/** A recorded value, shown in the form's own field style but not editable. */
function Shown({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  const id = `shown-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <Field label={label} htmlFor={id}>
      <input id={id} readOnly value={value || '—'} className={`${field} cursor-default bg-[var(--surface-muted)] ${mono ? 'font-mono' : ''}`} />
    </Field>
  );
}

/**
 * One approved slab — its New Entry and QC Report as recorded, marked as
 * Approved, and its photo (Approved Slabs, 27 Oct 2026).
 *
 * The entry and the QC Report are SHOWN, not edited: this page manages the
 * slab's photo and nothing else, so no saved detail, QC decision, approval
 * date or Stockyard history can change from here, and no slab is created.
 * Corrections to the record stay where they always were (Slab Records → Edit).
 * Underneath, the camera / upload / crop and Save Changes (photo-capture.tsx);
 * the slab's current photo, if it has one, is shown above it.
 */
export default async function ApprovedSlabPage({ params }: { params: Promise<{ slabId: string }> }) {
  await requirePageUser();
  const { slabId } = await params;

  const [slab, approval] = await Promise.all([loadSlabRecord(slabId), loadApproval(slabId)]);
  if (!slab) notFound();

  if (!approval) {
    return (
      <>
        <PageHeader title={`Slab ${slab.slabNo}`} description="Not an approved slab" />
        <EmptyState>
          Slab {slab.slabNo} is not marked as Approved in the Stockyard, so its photo is not taken here.{' '}
          <Link href={APP_ROUTES.approved} className="text-brand-700 font-medium underline">
            Back to Approved Slabs
          </Link>
        </EmptyState>
      </>
    );
  }

  const photo = (await latestSlabPhotos([slab.id])).get(slab.id) ?? null;

  return (
    <>
      <PageHeader
        eyebrow="Approved Slabs"
        title={`Slab ${slab.slabNo}`}
        description="Its entry and QC Report as recorded — and its photo"
        actions={
          <Link
            href={APP_ROUTES.approved}
            className="border-line surface hover:border-line-strong inline-flex h-11 items-center justify-center rounded-lg border px-4 text-sm font-medium transition-colors hover:bg-[var(--surface-muted)]"
          >
            Back to Approved Slabs
          </Link>
        }
      />

      {/* The status, said plainly at the top. */}
      <div className="border-status-done/40 mb-6 flex flex-wrap items-center gap-3 rounded-xl border bg-[var(--surface-muted)] px-5 py-4">
        <span className="bg-status-done inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold text-white">
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M20 6L9 17l-5-5" />
          </svg>
          Marked as Approved
        </span>
        <span className="text-sm">
          Approved in the Stockyard on <strong>{approval.approvedDate ? dateFmt.format(approval.approvedDate) : '—'}</strong>
        </span>
      </div>

      <div className="mb-6">
        <SectionCard title="New Entry" accent="active">
          <FieldGrid columns={3}>
            <Shown label="Production Date" value={toDateInput(slab.receivedDate)} />
            <Shown label="Batch No." value={slab.batchNo} mono />
            <Shown label="Slab No." value={slab.slabNo} mono />
            <Shown label="Base Material / Slab Name" value={slab.baseMaterial} />
            <Shown label="File Name / Planned Design" value={slab.designFileName} />
            <Shown label="Thickness of Slab (cm)" value={slab.thicknessCm === null ? '' : String(slab.thicknessCm)} />
            <Shown label="In-time" value={slab.inTime ? toTimeInput(slab.inTime) : ''} />
          </FieldGrid>
        </SectionCard>
      </div>

      <div className="mb-6">
        <SectionCard title="QC Report" accent="grade">
          <FieldGrid>
            <Field label="Grade" htmlFor="shown-grade">
              <div id="shown-grade" className="flex h-11 items-center">
                <GradeBadge grade={slab.currentGrade} />
              </div>
            </Field>
            <Shown
              label="QC Outcome"
              value={slab.currentDisposition ? DISPOSITION_LABELS[slab.currentDisposition] : ''}
            />
            <Shown label="Slab Remarks" value={manualRemark(slab.remarks, slab.currentDisposition) ?? ''} />
          </FieldGrid>
        </SectionCard>
      </div>

      {photo ? (
        <div className="mb-6">
          <SectionCard title="Current Photo" accent="brand" padded>
            <div className="flex flex-col items-start gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- a stored photo, served as-is */}
              <img
                src={`${API_ROUTES.slabPhoto}/${encodeURIComponent(photo.id)}`}
                alt={`Slab ${slab.slabNo}`}
                className="max-h-[40vh] max-w-full rounded-lg border"
              />
              <span className="text-muted text-xs">Saved {dateTimeFmt.format(photo.at)}</span>
            </div>
          </SectionCard>
        </div>
      ) : null}

      <PhotoCapture slabId={slab.id} slabNo={slab.slabNo} hasPhoto={Boolean(photo)} />
    </>
  );
}
