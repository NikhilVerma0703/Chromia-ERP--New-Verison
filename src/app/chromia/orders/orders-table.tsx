import Link from 'next/link';

import { EmptyState } from '@/components/chromia/ui';
import { dataTable } from '@/components/chromia/ui/form';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { descendingSerials, ORDER_STATUS_LABELS, type OrderStatus } from '@/lib/chromia/orders';
import { PLANT_TIME_ZONE } from '@/lib/chromia/plant-time';
import { formatThickness } from '@/lib/chromia/trimming';
import type { OrderRow } from '@/lib/chromia/server/repositories/order-repository';

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: PLANT_TIME_ZONE });

const { th, td, tdMuted, tdNum } = dataTable;

/** Pending in red, Order Completed in green — always with its words. */
export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const done = status === 'COMPLETED';
  return (
    <span
      data-order-status={status}
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${
        done
          ? 'text-status-done bg-[color-mix(in_srgb,var(--color-status-done)_13%,transparent)]'
          : 'text-status-waste bg-[color-mix(in_srgb,var(--color-status-waste)_12%,transparent)]'
      }`}
    >
      <span className={`inline-block size-1.5 rounded-full ${done ? 'bg-status-done' : 'bg-status-waste'}`} />
      {ORDER_STATUS_LABELS[status]}
    </span>
  );
}

/**
 * An Orders table — Recent Orders, a customer's search results, the Pending
 * Orders list. The fourteen columns, in the order asked for; S.No. counts
 * down, so the newest row has the highest number. The Customer Name opens
 * the order to change it.
 */
export function OrdersTable({ rows, empty }: { rows: OrderRow[]; empty: string }) {
  if (rows.length === 0) return <EmptyState>{empty}</EmptyState>;
  const serials = descendingSerials(rows.length);
  const dash = <span className="text-muted">—</span>;
  return (
    <div className="overflow-x-auto">
      <table className={dataTable.root} data-orders-table="">
        <thead className={dataTable.head}>
          <tr>
            <th className={th}>S.No.</th>
            <th className={th}>Customer Name</th>
            <th className={th}>Requested By</th>
            <th className={th}>Design Name</th>
            <th className={th}>Base Material Name</th>
            <th className={th}>Printing File Name</th>
            <th className={th}>Quantity of Slabs</th>
            <th className={th}>Thickness of Slabs</th>
            <th className={th}>Finishing Type</th>
            <th className={th}>Requested Delivery Date</th>
            <th className={th}>Actual Delivery Date</th>
            <th className={th}>Person In-Charge Name</th>
            <th className={th}>Remarks</th>
            <th className={th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id} className={dataTable.row}>
              <td className={tdNum}>{serials[i]}</td>
              <td className={td}>
                <Link
                  href={`${APP_ROUTES.orders}/${row.id}`}
                  className="text-brand-700 font-medium whitespace-nowrap hover:underline"
                  title="Open this order to update it"
                >
                  {row.customerName}
                </Link>
              </td>
              <td className={tdMuted}>{row.requestedBy ?? dash}</td>
              <td className={td}>{row.designName ?? dash}</td>
              <td className={td}>{row.baseMaterialName ?? dash}</td>
              <td className={tdMuted}>{row.printingFileName ?? dash}</td>
              <td className={tdNum}>{row.quantity ?? dash}</td>
              <td className={`${td} whitespace-nowrap tabular-nums`}>{row.thicknessMm === null ? dash : formatThickness(row.thicknessMm)}</td>
              <td className={td}>{row.finishingType ?? dash}</td>
              <td className={`${td} whitespace-nowrap`}>{row.requestedDeliveryDate ? dateFmt.format(row.requestedDeliveryDate) : dash}</td>
              <td className={`${td} whitespace-nowrap`}>{row.actualDeliveryDate ? dateFmt.format(row.actualDeliveryDate) : '--'}</td>
              <td className={tdMuted}>{row.personInCharge ?? dash}</td>
              <td className={`${tdMuted} max-w-[280px] whitespace-pre-line`}>{row.remarks ?? dash}</td>
              <td className={td}>
                <OrderStatusBadge status={row.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
