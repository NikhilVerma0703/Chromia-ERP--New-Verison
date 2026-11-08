import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/chromia/ui';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { toDateInput, toTimeInput } from '@/lib/chromia/operator-register';
import { toPlantDateInput } from '@/lib/chromia/plant-time';
import { manualRemark } from '@/lib/chromia/slab-remarks';
import { formatThickness, TRIM_OTHER, trimChoiceOf } from '@/lib/chromia/trimming';
import { listRecalibrationReasons } from '@/lib/chromia/server/repositories/recalibration-repository';
import { loadTrimmingRecord } from '@/lib/chromia/server/repositories/trimming-repository';
import { loadBaseMaterialNames, loadDesignFileNames, loadRecentBatchNos } from '@/lib/chromia/server/services/operator-service';
import { requirePageUser } from '@/lib/pageUser';

import { TrimmingSlabForm } from './trimming-form';

export const metadata: Metadata = { title: 'Trimming' };
export const dynamic = 'force-dynamic';

/** A stored day as the date input writes it, or ''. */
const day = (date: Date | null) => (date ? toDateInput(date) : '');
const cm = (mm: number | null) => (mm === null ? '' : String(Number((mm / 10).toFixed(3))));

/**
 * One slab's Trimming page (7 Nov 2026) — opened by its Slab Number, or Edit,
 * on the Trimming table. The same four parts for a slab from the line and for
 * one entered without design printing (trimming-form.tsx).
 */
export default async function TrimmingSlabPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageUser();
  const { id } = await params;

  const [record, reasons, baseMaterials, fileNames, batchNos] = await Promise.all([
    loadTrimmingRecord(id),
    listRecalibrationReasons(),
    loadBaseMaterialNames(),
    loadDesignFileNames(),
    loadRecentBatchNos(),
  ]);
  if (!record) notFound();

  const choice = trimChoiceOf(record.trimFromMm, record.trimToMm);
  const graded = record.qcGrade !== null;

  return (
    <>
      <PageHeader
        eyebrow={record.source === 'WITHOUT_PRINTING' ? 'Trimming · without design printing' : 'Trimming'}
        title={`Slab ${record.slabNo}`}
        description={record.status}
        actions={
          <Link
            href={APP_ROUTES.trimming}
            className="border-line surface hover:border-line-strong inline-flex h-11 items-center justify-center rounded-lg border px-4 text-sm font-medium transition-colors hover:bg-[var(--surface-muted)]"
          >
            Back to Trimming
          </Link>
        }
      />

      <TrimmingSlabForm
        key={record.id}
        id={record.id}
        linked={record.slabId !== null}
        currentThickness={formatThickness(record.thicknessMm)}
        trim={{
          choice,
          fromMm: record.trimFromMm === null ? '' : String(record.trimFromMm),
          toMm: record.trimToMm === null ? '' : String(record.trimToMm),
          otherFromCm: choice === TRIM_OTHER ? cm(record.trimFromMm) : '',
          otherToCm: choice === TRIM_OTHER ? cm(record.trimToMm) : '',
        }}
        dates={{ sent: day(record.sentDate), received: day(record.receivedDate) }}
        details={{
          productionDate: day(record.productionDate),
          batchNo: record.batchNo,
          slabNo: record.slabNo,
          baseMaterial: record.baseMaterial,
          fileName: record.fileName ?? '',
          thicknessCm: cm(record.thicknessMm),
          inTime: record.inTime instanceof Date ? toTimeInput(record.inTime) : (record.inTime ?? ''),
        }}
        qc={{
          // Graded after trimming: that grade. Before: the C → Trimming that sent it here.
          grade: graded ? (record.qcGrade as string) : 'C',
          disposition: graded ? (record.qcDisposition ?? '') : 'TRIMMING',
          remarks: manualRemark(record.remarks, record.slabDisposition) ?? '',
        }}
        graded={graded}
        recalibrationReasons={reasons}
        baseMaterials={baseMaterials}
        fileNames={fileNames}
        batchNos={batchNos}
        today={toPlantDateInput(new Date())}
      />
    </>
  );
}
