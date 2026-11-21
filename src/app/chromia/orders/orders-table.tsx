import Link from 'next/link';

import { EmptyState } from '@/components/chromia/ui';
import { dataTable } from '@/components/chromia/ui/form';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import {
  descendingSerials,
  NO_CUSTOMER_LABEL,
  ORDER_INITIATED_BY_LABEL,
  ORDER_STATUS_LABELS,
  printingChoiceOf,
  printingStatusLabel,
  quantityTotal,
  type OrderStatus,
} from '@/lib/chromia/orders';
import { PLANT_TIME_ZONE } from '@/lib/chromia/plant-time';
import { formatThickness } from '@/lib/chromia/trimming';
import type { OrderRow } from '@/lib/chromia/server/repositories/order-repository';

import { DeleteOrderButton } from './delete-order-button';

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
 * Printing Status (21 Nov 2026): "Printing Completed" in plain text, or
 * "Printing NOT Completed" with only NOT in red; "—" when nobody chose yet.
 */
export function PrintingStatus({ printingCompleted }: { printingCompleted: boolean | null }) {
  if (printingStatusLabel(printingCompleted) === null) return <span className="text-muted">—</span>;
  if (printingCompleted) return <span className="text-foreground">Printing Completed</span>;
  return (
    <span className="text-foreground">
      Printing <span className="font-semibold text-red-600">NOT</span> Completed
    </span>
  );
}

/**
 * An Orders table — Recent Orders, a customer's search results, the Pending
 * and Completed Orders lists. S.No. counts down, so the newest row has the
 * highest number.
 *
 * TWO SHAPES (19 Nov 2026):
 *   full      the roles that see customers: Customer Name (which opens the
 *             order), Order Initiated By, … Status, then Action — Edit and,
 *             where `canDelete`, Delete;
 *   operator  the Chromia Operator: no Customer Name, no Order Initiated By;
 *             S.No., then Design Name, highlighted, which opens the order, then
 *             the rest; Action holds Edit only.
 * `showTotal` adds the Total of Quantity of Slabs under exactly these rows.
 */
export function OrdersTable({
  rows,
  empty,
  operator = false,
  canDelete = false,
  showTotal = false,
}: {
  rows: OrderRow[];
  empty: string;
  operator?: boolean;
  canDelete?: boolean;
  showTotal?: boolean;
}) {
  if (rows.length === 0) return <EmptyState>{empty}</EmptyState>;
  const serials = descendingSerials(rows.length);
  const dash = <span className="text-muted">—</span>;
  const open = (id: string) => `${APP_ROUTES.orders}/${id}`;
  return (
    <div className="overflow-x-auto">
      <table className={dataTable.root} data-orders-table="">
        <thead className={dataTable.head}>
          <tr>
            <th className={th}>S.No.</th>
            {operator ? null : <th className={th}>Customer Name</th>}
            {operator ? null : <th className={th}>{ORDER_INITIATED_BY_LABEL}</th>}
            <th className={th}>Design Name</th>
            <th className={th}>Base Material Name</th>
            <th className={th}>Printing File Name</th>
            <th className={th}>Quantity of Slabs</th>
            <th className={th}>Thickness of Slabs</th>
            <th className={th}>Finishing Type</th>
            <th className={th}>Requested Delivery Date</th>
            <th className={th}>Printing Status</th>
            <th className={th}>Actual Delivery Date</th>
            <th className={th}>Person In-Charge Name</th>
            <th className={th}>Remarks</th>
            <th className={th}>Status</th>
            <th className={`${th} text-right`}>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id} className={dataTable.row}>
              <td className={tdNum}>{serials[i]}</td>
              {operator ? null : (
                <td className={td}>
                  <Link href={open(row.id)} className="text-brand-700 font-medium whitespace-nowrap hover:underline" title="Open this order to update it">
                    {row.customerName || <span className="text-muted italic">{NO_CUSTOMER_LABEL}</span>}
                  </Link>
                </td>
              )}
              {operator ? null : <td className={tdMuted}>{row.requestedBy ?? dash}</td>}
              <td className={td}>
                {operator ? (
                  <Link
                    href={open(row.id)}
                    data-design-link=""
                    title="Open this order to update it"
                    className="bg-brand-50 text-brand-800 hover:bg-brand-100 border-brand-200 inline-flex rounded-md border px-2 py-1 font-semibold whitespace-nowrap underline-offset-4 hover:underline"
                  >
                    {row.designName ?? 'Open order'}
                  </Link>
                ) : (
                  (row.designName ?? dash)
                )}
              </td>
              <td className={td}>{row.baseMaterialName ?? dash}</td>
              <td className={tdMuted}>{row.printingFileName ?? dash}</td>
              <td className={tdNum}>{row.quantity ?? dash}</td>
              <td className={`${td} whitespace-nowrap tabular-nums`}>{row.thicknessMm === null ? dash : formatThickness(row.thicknessMm)}</td>
              <td className={td}>{row.finishingType ?? dash}</td>
              <td className={`${td} whitespace-nowrap`}>{row.requestedDeliveryDate ? dateFmt.format(row.requestedDeliveryDate) : dash}</td>
              <td className={`${td} whitespace-nowrap`} data-printing-status={printingChoiceOf(row.printingCompleted)}>
                <PrintingStatus printingCompleted={row.printingCompleted} />
              </td>
              <td className={`${td} whitespace-nowrap`}>{row.actualDeliveryDate ? dateFmt.format(row.actualDeliveryDate) : '--'}</td>
              <td className={tdMuted}>{row.personInCharge ?? dash}</td>
              <td className={`${tdMuted} max-w-[280px] whitespace-pre-line`}>{row.remarks ?? dash}</td>
              <td className={td}>
                <OrderStatusBadge status={row.status} />
              </td>
              <td className={`${td} text-right`}>
                <div className="flex justify-end gap-2">
                  <Link
                    href={open(row.id)}
                    aria-label={`Edit the order ${operator ? row.designName ?? '' : row.customerName || row.designName || ''}`.trim()}
                    className="border-line surface hover:border-line-strong inline-flex h-9 items-center justify-center rounded-lg border px-3 text-xs font-medium transition-colors hover:bg-[var(--surface-muted)]"
                  >
                    Edit
                  </Link>
                  {canDelete ? <DeleteOrderButton id={row.id} name={row.customerName || row.designName || 'without a customer'} /> : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
        {showTotal ? (
          <tfoot>
            <tr data-orders-total="" className="border-foreground border-t-2 font-semibold">
              <td className={`${td} font-semibold`}>Total</td>
              {/* Up to Quantity of Slabs: the customer columns (not for the operator), Design, Material, File. */}
              {Array.from({ length: operator ? 3 : 5 }, (_, k) => (
                <td key={k} className={td} />
              ))}
              <td className={`${tdNum} font-semibold`}>{quantityTotal(rows)}</td>
              <td className={td} colSpan={9} />
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
