import { type NextRequest } from 'next/server';

import { chromiaGate } from '@/lib/chromia/access';
import { withErrorHandling } from '@/lib/chromia/api';
import { EXPORT_KIND_LABELS, exportFileName, parseExportQuery, resolveRange } from '@/lib/chromia/exports';
import { loadDownloadReport } from '@/lib/chromia/server/repositories/export-repository';
import { writeStyledWorkbook } from '@/lib/chromia/server/exports/sheet';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Downloads → By Slab Status, as an Excel workbook (rebuilt 28 Oct 2026,
 * change 12). The very report the page previews (loadDownloadReport): the
 * same columns, the same rows, oldest first, S.No. 1…n.
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  const gate = await chromiaGate();
  if (!gate.ok) return new Response(gate.status === 401 ? 'Unauthorized' : 'Forbidden', { status: gate.status });

  const query = parseExportQuery(Object.fromEntries(request.nextUrl.searchParams.entries()));
  const range = resolveRange(query);
  const report = await loadDownloadReport(query.kind, range);

  const buffer = writeStyledWorkbook({
    sheetName: EXPORT_KIND_LABELS[query.kind].slice(0, 31),
    columns: report.columns,
    rows: report.rows,
  });

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${exportFileName(query.kind, range)}"`,
      'Cache-Control': 'no-store',
    },
  });
});
