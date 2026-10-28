import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/chromia/ui';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { toDateInput, toTimeInput } from '@/lib/chromia/operator-register';
import { toPlantDateInput } from '@/lib/chromia/plant-time';
import { openTrip, ordinal, stageOf, statusLabel } from '@/lib/chromia/recalibration-flow';
import { manualRemark } from '@/lib/chromia/slab-remarks';
import { listRecalibrationReasons } from '@/lib/chromia/server/repositories/recalibration-repository';
import { loadSlabTrips } from '@/lib/chromia/server/repositories/recalibration-flow-repository';
import { loadSlabRecord } from '@/lib/chromia/server/repositories/slab-record-repository';
import {
  loadBaseMaterialNames,
  loadDesignFileNames,
  loadRecentBatchNos,
} from '@/lib/chromia/server/services/operator-service';
import { requirePageUser } from '@/lib/pageUser';

import { RecalibrationSlabForm } from './slab-form';

export const metadata: Metadata = { title: 'Recalibration' };
export const dynamic = 'force-dynamic';

/** A stored day as the date input writes it, or ''. */
const day = (date: Date | null) => (date ? toDateInput(date) : '');

/** Where one attempt stands — the board's words, for that attempt alone. */
function tripStatus(trip: { attemptNumber: number; sentDate: Date | null; receivedDate: Date | null; restartedAt: Date | null }): string {
  const n = ordinal(trip.attemptNumber);
  if (!trip.sentDate) return `Need ${n} Time Recalibration`;
  if (!trip.receivedDate) return `Sent for ${n} Time Recalibration`;
  if (!trip.restartedAt) return `Received from the ${n} Time Recalibration`;
  return `Back in processing after the ${n} attempt`;
}

/**
 * One slab's Recalibration form (rebuilt 27 Oct 2026) — opened by clicking
 * its Slab No. on the Recalibration page. Send and Receive, Update Slab
 * Details and QC Report together on one page (slab-form.tsx), pre-filled from
 * the slab's own record and its trips, saved by one Update Slab button
 * (updateRecalibrationSlabAction). The slab is the same record throughout.
 */
export default async function RecalibrationSlabPage({ params }: { params: Promise<{ slabId: string }> }) {
  await requirePageUser();
  const { slabId } = await params;

  const [record, trips, reasons, baseMaterials, fileNames, batchNos] = await Promise.all([
    loadSlabRecord(slabId),
    loadSlabTrips(slabId),
    listRecalibrationReasons(),
    loadBaseMaterialNames(),
    loadDesignFileNames(),
    loadRecentBatchNos(),
  ]);
  if (!record) notFound();

  const state = {
    disposition: record.currentDisposition,
    writtenOff: record.status === 'WASTE',
    trips: trips.map(({ reason: _reason, ...trip }) => trip),
  };
  const stage = stageOf(state);
  // Part A records the trip waiting to be sent, or the one out.
  const current = stage === 'AWAITING_SEND' || stage === 'OUT'
    ? openTrip(state.trips) ?? trips.find((t) => t.sentDate === null) ?? null
    : null;
  const currentReason =
    (current ? trips.find((t) => t.attemptNumber === current.attemptNumber)?.reason?.name : undefined) ??
    [...trips].reverse().find((t) => t.reason)?.reason?.name ??
    '';

  return (
    <>
      <PageHeader
        eyebrow="Recalibration"
        title={`Slab ${record.slabNo}`}
        description={statusLabel(state, record.currentGrade)}
        actions={
          <Link
            href={APP_ROUTES.recalibrations}
            className="border-line surface hover:border-line-strong inline-flex h-11 items-center justify-center rounded-lg border px-4 text-sm font-medium transition-colors hover:bg-[var(--surface-muted)]"
          >
            Back to Recalibration
          </Link>
        }
      />

      <RecalibrationSlabForm
        // Keyed on the slab only: a save changes its stage, and remounting on
        // that would drop the "saved" state that takes the user back.
        key={record.id}
        slabId={record.id}
        stage={stage}
        status={record.status}
        trips={trips.map((trip) => ({
          attemptNumber: trip.attemptNumber,
          sentDate: day(trip.sentDate),
          receivedDate: day(trip.receivedDate),
          reason: trip.reason?.name ?? '',
          status: tripStatus(trip),
        }))}
        currentTrip={
          current
            ? { attemptNumber: current.attemptNumber, sentDate: day(current.sentDate), receivedDate: day(current.receivedDate) }
            : null
        }
        details={{
          productionDate: toDateInput(record.receivedDate),
          batchNo: record.batchNo,
          slabNo: record.slabNo,
          baseMaterial: record.baseMaterial,
          fileName: record.designFileName,
          thicknessCm: record.thicknessCm === null ? '' : String(record.thicknessCm),
          // Back from a trip, the In-time is the NEW pass's — entered, not the
          // last pass's carried over (change 10: carried over, an unchanged
          // save restarted nothing).
          inTime: stage === 'RETURNED' || !record.inTime ? '' : toTimeInput(record.inTime),
        }}
        qc={{
          grade: record.currentGrade ?? '',
          disposition: record.currentDisposition ?? '',
          reason: currentReason,
          remarks: manualRemark(record.remarks, record.currentDisposition) ?? '',
        }}
        recalibrationReasons={reasons}
        baseMaterials={baseMaterials}
        fileNames={fileNames}
        batchNos={batchNos}
        today={toPlantDateInput(new Date())}
      />
    </>
  );
}
