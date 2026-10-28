import type { Metadata } from 'next';

import { EmptyState, PageHeader } from '@/components/chromia/ui';
import { dataTable, SectionCard } from '@/components/chromia/ui/form';
import { API_ROUTES } from '@/lib/chromia/constants/app';
import { REPORT_DATE_LABELS, REPORT_LABELS, type BuiltReport } from '@/lib/chromia/download-reports';
import {
  buildExportQuery,
  buildRangeQuery,
  GROUP_CLASSES,
  parseExportQuery,
  parseRangeQuery,
  recentMonths,
  resolveRange,
} from '@/lib/chromia/exports';
import { PLANT_TIME_ZONE } from '@/lib/chromia/plant-time';
import { loadDownloadReport } from '@/lib/chromia/server/repositories/export-repository';
import { requirePageUser } from '@/lib/pageUser';

import { DownloadForm } from './download-form';
import { ProductionForm } from './production-form';

export const metadata: Metadata = { title: 'Downloads' };
export const dynamic = 'force-dynamic';

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric', timeZone: PLANT_TIME_ZONE, });

const { td } = dataTable;

/** Header cell carrying its band colour — mirrors the Excel sheet exactly. */
const th = (group: keyof typeof GROUP_CLASSES) =>
  `${GROUP_CLASSES[group]} px-5 py-3 text-[11px] font-semibold tracking-[0.12em] whitespace-nowrap uppercase`;

/**
 * A report's preview: its columns and its rows exactly as the workbook writes
 * them (loadDownloadReport → buildReport), S.No. first — so what is shown is
 * what is downloaded, cell for cell.
 */
function ReportPreview({ report }: { report: BuiltReport }) {
  return (
    <div className="overflow-x-auto">
      <table className={dataTable.root} data-report={report.kind}>
        <thead>
          <tr>
            {report.columns.map((column) => (
              <th key={column.label} className={`${th(column.group)} ${column.label === 'S.No.' || column.label === 'Thickness (cm)' ? 'text-right' : ''}`}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row) => (
            <tr key={String(row[0])} className={dataTable.row}>
              {row.map((cell, i) => (
                <td
                  key={report.columns[i]?.label ?? i}
                  className={`${td} ${typeof cell === 'number' ? 'text-right tabular-nums' : ''} ${i === 1 ? 'font-medium whitespace-nowrap' : ''} max-w-[18rem]`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Downloads (rebuilt 28 Oct 2026, change 12).
 *
 *   01 Complete Production  Slab Records' columns, every slab produced in the period
 *   02 By Slab Status       In Stock · Dispatched · Approved · Sample Cutting · Recalibration
 *
 * Each with its period (unchanged), a live preview of exactly the rows the
 * workbook will hold — oldest first on the report's own date, S.No. 1…n — and
 * its Download Excel. lib/chromia/download-reports.ts defines every report.
 */
export default async function DownloadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePageUser();
  const params = await searchParams;

  // Two independent pickers on one URL: the complete-production one namespaces
  // its params with `p` so applying either never disturbs the other.
  const query = parseExportQuery(params);
  const range = resolveRange(query);

  const productionQuery = parseRangeQuery(params, 'p');
  const productionRange = resolveRange(productionQuery);

  const [report, production] = await Promise.all([
    loadDownloadReport(query.kind, range),
    loadDownloadReport('PRODUCTION', productionRange),
  ]);

  const downloadHref = `${API_ROUTES.exports}?${buildExportQuery(query)}`;
  const productionHref = `${API_ROUTES.exports}/production?${buildRangeQuery(productionQuery)}`;
  const months = recentMonths();
  const period = (r: { from: Date; to: Date }) => `${dateFmt.format(r.from)} – ${dateFmt.format(r.to)}`;

  return (
    <>
      <PageHeader eyebrow="Records" title="Downloads" />

      <ProductionForm
        query={productionQuery}
        months={months}
        rowCount={production.rows.length}
        downloadHref={productionHref}
      />

      <SectionCard
        title="Production preview"
        accent="active"
        padded={production.rows.length === 0}
        actions={
          <span className="border-line surface text-muted rounded-full border px-3 py-1 text-xs font-medium">
            {period(productionRange)} ·{' '}
            <span className="text-foreground font-semibold tabular-nums">{production.rows.length}</span>{' '}
            {production.rows.length === 1 ? 'slab' : 'slabs'} · oldest production date first
          </span>
        }
      >
        {production.rows.length === 0 ? (
          <EmptyState>No slabs were produced in this period.</EmptyState>
        ) : (
          <ReportPreview report={production} />
        )}
      </SectionCard>

      <div className="border-line my-8 border-t" />

      <DownloadForm
        query={query}
        months={months}
        rowCount={report.rows.length}
        downloadHref={downloadHref}
      />

      <SectionCard
        step="03"
        title={`${REPORT_LABELS[query.kind]} preview`}
        accent="grade"
        padded={report.rows.length === 0}
        actions={
          <span className="border-line surface text-muted rounded-full border px-3 py-1 text-xs font-medium">
            {period(range)} · <span className="text-foreground font-semibold tabular-nums">{report.rows.length}</span>{' '}
            {report.rows.length === 1 ? 'slab' : 'slabs'} · oldest {REPORT_DATE_LABELS[query.kind].toLowerCase()} first
          </span>
        }
      >
        {report.rows.length === 0 ? (
          <EmptyState>No {REPORT_LABELS[query.kind].toLowerCase()} slabs in this period.</EmptyState>
        ) : (
          <ReportPreview report={report} />
        )}
      </SectionCard>
    </>
  );
}
