import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/chromia/ui';
import { field, SectionCard } from '@/components/chromia/ui/form';
import { chromiaHasFullOrderAccess } from '@/lib/chromia/access';
import { API_ROUTES, APP_ROUTES } from '@/lib/chromia/constants/app';
import { ORDER_VIEW_LABELS, parseCustomerSearch, parseOrderView, type OrderView } from '@/lib/chromia/orders';
import type { RawSearchParams } from '@/lib/chromia/simple-filters';
import {
  countOrders,
  listOrdersInView,
  listRecentOrders,
  loadCustomerNames,
  searchOrdersByCustomer,
} from '@/lib/chromia/server/repositories/order-repository';
import { loadBaseMaterialNames, loadDesignFileNames } from '@/lib/chromia/server/services/operator-service';
import { requirePageUser } from '@/lib/pageUser';

import { OrderForm } from './order-form';
import { OrdersTable } from './orders-table';

export const metadata: Metadata = { title: 'Orders' };
export const dynamic = 'force-dynamic';

/** A link to this page with the given search and view, keeping the URL short. */
function ordersHref(customer: string, view: OrderView | null): string {
  const params = new URLSearchParams();
  if (customer) params.set('customer', customer);
  if (view) params.set('view', view);
  const query = params.toString();
  return query ? `${APP_ROUTES.orders}?${query}` : APP_ROUTES.orders;
}

const countPill = (n: number) => (
  <span className="border-line surface text-muted rounded-full border px-3 py-1 text-xs font-medium">
    <span className="text-foreground font-semibold tabular-nums">{n}</span> {n === 1 ? 'order' : 'orders'}
  </span>
);

/** Each KPI card: its colour, and the words on it. */
const KPI: Record<OrderView, { title: string; tone: string; ring: string; dot: string }> = {
  completed: { title: 'Total Completed Orders', tone: 'text-status-done', ring: 'border-status-done ring-status-done ring-2', dot: 'bg-status-done' },
  pending: { title: 'Total Pending Orders', tone: 'text-status-waste', ring: 'border-status-waste ring-status-waste ring-2', dot: 'bg-status-waste' },
};

/**
 * Orders (17 Nov 2026) — customer orders, recorded and tracked. Standalone:
 * it reads and writes only chromia_order and its photos, and no slab page,
 * count, KPI or report reads it.
 *
 *   Dashboard       Search Customer Name; Total Completed Orders (green) and
 *                   Total Pending Orders (red), each opening its orders with
 *                   the Total of Quantity of Slabs and an Excel download;
 *   Order Entry     the order form, with DELIVERY STATUS and Reference Photo;
 *   Recent Orders   the latest ten, S.No. counting down, then Action.
 *
 * WHO SEES WHAT (19 Nov 2026). The Chromia Operator (chromiaHasFullOrderAccess
 * is false) has no Dashboard — not drawn, and its data never read, so neither
 * ?customer= nor ?view= shows it anything — and no Customer Name or Order
 * Initiated By, in the form or the table; Design Name opens an order; Edit,
 * no Delete. Every other Chromia login, the Fab & Chromia Head included, has
 * all of it. The actions and the download ask the same rule.
 */
export default async function OrdersPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const user = await requirePageUser();
  const full = chromiaHasFullOrderAccess(user);
  const params = await searchParams;
  // The Dashboard's two queries are read only for the roles that have it.
  const customer = full ? parseCustomerSearch(params.customer) : '';
  const view = full ? parseOrderView(params.view) : null;

  const [counts, recent, found, listed, customerNames, baseMaterials, fileNames] = await Promise.all([
    countOrders(),
    listRecentOrders(),
    customer ? searchOrdersByCustomer(customer) : Promise.resolve(null),
    view ? listOrdersInView(view) : Promise.resolve(null),
    full ? loadCustomerNames() : Promise.resolve([]),
    loadBaseMaterialNames(),
    loadDesignFileNames(),
  ]);
  const total = counts.completed + counts.pending;

  return (
    <>
      <PageHeader
        title="Orders"
        description={full ? `${total} ${total === 1 ? 'order' : 'orders'} · ${counts.pending} pending` : 'Enter an order, or open one from its Design Name to update it'}
      />

      {/* ------------------------------------------------------ Dashboard --- */}
      {full ? (
        <div className="mb-6">
          <SectionCard title="Dashboard" accent="brand">
            <div className="flex flex-col gap-5">
              <form action={APP_ROUTES.orders} method="get" className="flex flex-wrap items-end gap-3" role="search">
                {view ? <input type="hidden" name="view" value={view} /> : null}
                <label className="flex min-w-[240px] flex-1 flex-col gap-1.5 sm:max-w-md">
                  <span className="text-muted text-[13px] font-medium">Search Customer Name</span>
                  <input name="customer" type="search" defaultValue={customer} placeholder="Customer name" maxLength={100} className={field} />
                </label>
                <button type="submit" className="bg-brand-600 hover:bg-brand-700 inline-flex h-11 items-center justify-center rounded-lg px-6 text-sm font-semibold text-white">
                  Search
                </button>
                {customer ? (
                  <Link href={ordersHref('', view)} className="text-brand-700 inline-flex h-11 items-center text-sm font-medium hover:underline">
                    Clear search
                  </Link>
                ) : null}
              </form>

              <div className="grid gap-4 sm:grid-cols-2 lg:max-w-3xl">
                {(['completed', 'pending'] as const).map((kpi) => {
                  const active = view === kpi;
                  const k = KPI[kpi];
                  return (
                    <Link
                      key={kpi}
                      href={ordersHref(customer, active ? null : kpi)}
                      scroll={false}
                      data-kpi={kpi}
                      aria-current={active ? 'true' : undefined}
                      title={active ? `Showing the ${kpi} orders — click again to close` : `Show every ${kpi} order`}
                      className={`surface block rounded-xl border p-5 shadow-[0_1px_3px_rgba(16,24,40,0.06)] transition-colors hover:border-brand-400 ${active ? k.ring : 'border-line'}`}
                    >
                      <div className="flex items-start gap-2">
                        <span className={`${k.dot} mt-[6px] inline-block size-2 shrink-0 rounded-full`} />
                        <span className="text-muted text-[12px] font-semibold tracking-[0.1em] uppercase">{k.title}</span>
                      </div>
                      <p className={`${k.tone} mt-3 text-[34px] leading-none font-bold tabular-nums`}>{counts[kpi]}</p>
                      <p className={`${k.tone} mt-2 text-xs font-semibold`}>{active ? 'Shown below · click to close' : 'Click to See Orders'}</p>
                    </Link>
                  );
                })}
              </div>
            </div>
          </SectionCard>

          {found ? (
            <div className="mt-4">
              <SectionCard title={`Orders for “${customer}”`} accent="active" padded={found.length === 0} actions={countPill(found.length)}>
                <OrdersTable rows={found} empty={`No order found for a customer named like “${customer}”.`} canDelete />
              </SectionCard>
            </div>
          ) : null}

          {view && listed ? (
            <div className="mt-4">
              <SectionCard
                title={ORDER_VIEW_LABELS[view]}
                accent={view === 'pending' ? 'grade' : 'active'}
                padded={listed.length === 0}
                actions={
                  <span className="flex flex-wrap items-center gap-2">
                    {countPill(listed.length)}
                    {listed.length > 0 ? (
                      <a
                        href={`${API_ROUTES.ordersExport}?view=${view}`}
                        data-orders-download={view}
                        className="bg-brand-600 hover:bg-brand-700 inline-flex h-9 items-center justify-center rounded-lg px-4 text-xs font-semibold text-white"
                      >
                        Download Excel
                      </a>
                    ) : null}
                  </span>
                }
              >
                <OrdersTable rows={listed} empty={view === 'pending' ? 'No order is pending.' : 'No order has been completed yet.'} canDelete showTotal />
              </SectionCard>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ---------------------------------------------------- Order Entry --- */}
      <div className="mb-6">
        <SectionCard title="Order Entry" accent="active">
          <OrderForm customerNames={customerNames} baseMaterials={baseMaterials} fileNames={fileNames} limited={!full} />
        </SectionCard>
      </div>

      {/* -------------------------------------------------- Recent Orders --- */}
      <SectionCard
        title="Recent Orders"
        accent="brand"
        padded={recent.length === 0}
        actions={<span className="text-muted text-xs font-medium">{full ? `Latest ${recent.length} of ${total}` : `Latest ${recent.length}`}</span>}
      >
        <OrdersTable rows={recent} empty="No order has been recorded yet." operator={!full} canDelete={full} />
      </SectionCard>
    </>
  );
}
