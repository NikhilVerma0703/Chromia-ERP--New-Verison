import { type NextRequest } from 'next/server';

import { chromiaGate } from '@/lib/chromia/access';
import { withErrorHandling } from '@/lib/chromia/api';
import { parseRangeQuery, productionFileName, resolveRange } from '@/lib/chromia/exports';
import { loadDownloadReport } from '@/lib/chromia/server/repositories/export-repository';
import { writeStyledWorkbook } from '@/lib/chromia/server/exports/sheet';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Downloads → Complete Production, as an Excel workbook (rebuilt 28 Oct 2026,
 * change 12): Slab Records' columns in its order and its words, oldest
 * production date first, S.No. 1…n — the very report the page previews.
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  const gate = await chromiaGate();
  if (!gate.ok) return new Response(gate.status === 401 ? 'Unauthorized' : 'Forbidden', { status: gate.status });

  const range = resolveRange(parseRangeQuery(Object.fromEntries(request.nextUrl.searchParams.entries())));
  const report = await loadDownloadReport('PRODUCTION', range);

  const buffer = writeStyledWorkbook({ sheetName: 'Production', columns: report.columns, rows: report.rows });

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${productionFileName(range)}"`,
      'Cache-Control': 'no-store',
    },
  });
});
