import { type NextRequest } from 'next/server';

import { chromiaGate } from '@/lib/chromia/access';
import { withErrorHandling } from '@/lib/chromia/api';
import type { ExportColumn } from '@/lib/chromia/exports';
import { ORDER_EXPORT_COLUMNS, ORDER_VIEW_LABELS, orderExportFileName, orderExportMatrix, parseOrderView } from '@/lib/chromia/orders';
import { formatPlantDay, toPlantDateInput } from '@/lib/chromia/plant-time';
import { chromiaHasFullOrderAccess } from '@/lib/chromia/tier';
import { formatThickness } from '@/lib/chromia/trimming';
import { writeStyledWorkbook } from '@/lib/chromia/server/exports/sheet';
import { listOrdersInView } from '@/lib/chromia/server/repositories/order-repository';
import { currentUser } from '@/lib/rbac';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** The bands the downloads use, per column. */
const GROUP: Record<(typeof ORDER_EXPORT_COLUMNS)[number], ExportColumn['group']> = {
  'S.No.': 'identity',
  'Customer Name': 'identity',
  'Order Initiated By': 'identity',
  'Design Name': 'product',
  'Base Material Name': 'product',
  'Printing File Name': 'product',
  'Quantity of Slabs': 'product',
  'Thickness of Slabs': 'product',
  'Finishing Type': 'product',
  'Requested Delivery Date': 'timing',
  'Printing Status': 'state',
  'Actual Delivery Date': 'timing',
  'Person In-Charge Name': 'state',
  Remarks: 'state',
  Status: 'outcome',
};

/**
 * Orders → Pending or Completed Orders, as an Excel workbook (19 Nov 2026):
 * exactly the list the KPI shows (listOrdersInView — the condition it counts),
 * in its order and with its S.No., and the Total of Quantity of Slabs.
 *
 * The Dashboard's: refused to the Chromia Operator, whatever the request.
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  const gate = await chromiaGate();
  if (!gate.ok) return new Response(gate.status === 401 ? 'Unauthorized' : 'Forbidden', { status: gate.status });
  if (!chromiaHasFullOrderAccess(await currentUser())) return new Response('Forbidden', { status: 403 });

  const view = parseOrderView(request.nextUrl.searchParams.get('view') ?? undefined);
  if (!view) return new Response('Choose Pending or Completed orders', { status: 400 });

  const rows = await listOrdersInView(view);
  const { body, total } = orderExportMatrix(rows, {
    thickness: formatThickness,
    day: (d) => formatPlantDay(toPlantDateInput(d)),
  });
  const buffer = writeStyledWorkbook({
    sheetName: ORDER_VIEW_LABELS[view],
    columns: ORDER_EXPORT_COLUMNS.map((label) => ({ label, group: GROUP[label], width: label === 'Remarks' ? 36 : label.length > 14 ? 22 : 16 })),
    rows: body,
    footer: total,
  });

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${orderExportFileName(view)}"`,
      'Cache-Control': 'no-store',
    },
  });
});
