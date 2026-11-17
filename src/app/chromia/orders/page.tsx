import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/chromia/ui';
import { field, SectionCard } from '@/components/chromia/ui/form';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { parseCustomerSearch, PENDING_VIEW } from '@/lib/chromia/orders';
import type { RawSearchParams } from '@/lib/chromia/simple-filters';
import {
  countOrders,
  listPendingOrders,
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
function ordersHref(customer: string, view: string | null): string {
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

/**
 * Orders (17 Nov 2026) — customer orders, recorded and tracked. Standalone:
 * it reads and writes only chromia_order and its photos, and no slab page,
 * count, KPI or report reads it.
 *
 *   Dashboard       Search Customer Name; Total Completed Orders (green) and
 *                   Total Pending Orders (red), which opens every pending order;
 *   Order Entry     the order form, with DELIVERY STATUS and Reference Photo;
 *   Recent Orders   the latest ten, S.No. counting down.
 */
export default async function OrdersPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  await requirePageUser();
  const params = await searchParams;
  const customer = parseCustomerSearch(params.customer);
  const showPending = (Array.isArray(params.view) ? params.view[0] : params.view) === PENDING_VIEW;

  const [counts, recent, found, pending, customerNames, baseMaterials, fileNames] = await Promise.all([
    countOrders(),
    listRecentOrders(),
    customer ? searchOrdersByCustomer(customer) : Promise.resolve(null),
    showPending ? listPendingOrders() : Promise.resolve(null),
    loadCustomerNames(),
    loadBaseMaterialNames(),
    loadDesignFileNames(),
  ]);
  const total = counts.completed + counts.pending;

  return (
    <>
      <PageHeader title="Orders" description={`${total} ${total === 1 ? 'order' : 'orders'} · ${counts.pending} pending`} />

      {/* ------------------------------------------------------ Dashboard --- */}
      <div className="mb-6">
        <SectionCard title="Dashboard" accent="brand">
          <div className="flex flex-col gap-5">
            <form action={APP_ROUTES.orders} method="get" className="flex flex-wrap items-end gap-3" role="search">
              {showPending ? <input type="hidden" name="view" value={PENDING_VIEW} /> : null}
              <label className="flex min-w-[240px] flex-1 flex-col gap-1.5 sm:max-w-md">
                <span className="text-muted text-[13px] font-medium">Search Customer Name</span>
                <input name="customer" type="search" defaultValue={customer} placeholder="Customer name" maxLength={100} className={field} />
              </label>
              <button type="submit" className="bg-brand-600 hover:bg-brand-700 inline-flex h-11 items-center justify-center rounded-lg px-6 text-sm font-semibold text-white">
                Search
              </button>
              {customer ? (
                <Link href={ordersHref('', showPending ? PENDING_VIEW : null)} className="text-brand-700 inline-flex h-11 items-center text-sm font-medium hover:underline">
                  Clear search
                </Link>
              ) : null}
            </form>

            <div className="grid gap-4 sm:grid-cols-2 lg:max-w-3xl">
              <div className="border-line surface rounded-xl border p-5 shadow-[0_1px_3px_rgba(16,24,40,0.06)]" data-kpi="completed">
                <div className="flex items-start gap-2">
                  <span className="bg-status-done mt-[6px] inline-block size-2 shrink-0 rounded-full" />
                  <span className="text-muted text-[12px] font-semibold tracking-[0.1em] uppercase">Total Completed Orders</span>
                </div>
                <p className="text-status-done mt-3 text-[34px] leading-none font-bold tabular-nums">{counts.completed}</p>
              </div>
              <Link
                href={ordersHref(customer, showPending ? null : PENDING_VIEW)}
                scroll={false}
                data-kpi="pending"
                aria-current={showPending ? 'true' : undefined}
                title={showPending ? 'Showing the pending orders — click again to close' : 'Show every pending order'}
                className={`surface block rounded-xl border p-5 shadow-[0_1px_3px_rgba(16,24,40,0.06)] transition-colors hover:border-status-waste ${
                  showPending ? 'border-status-waste ring-status-waste ring-2' : 'border-line'
                }`}
              >
                <div className="flex items-start gap-2">
                  <span className="bg-status-waste mt-[6px] inline-block size-2 shrink-0 rounded-full" />
                  <span className="text-muted text-[12px] font-semibold tracking-[0.1em] uppercase">Total Pending Orders</span>
                </div>
                <p className="text-status-waste mt-3 text-[34px] leading-none font-bold tabular-nums">{counts.pending}</p>
                <p className="text-status-waste mt-2 text-xs font-semibold">{showPending ? 'Shown below · click to close' : 'Click to See Orders'}</p>
              </Link>
            </div>
          </div>
        </SectionCard>

        {found ? (
          <div className="mt-4">
            <SectionCard title={`Orders for “${customer}”`} accent="active" padded={found.length === 0} actions={countPill(found.length)}>
              <OrdersTable rows={found} empty={`No order found for a customer named like “${customer}”.`} />
            </SectionCard>
          </div>
        ) : null}

        {pending ? (
          <div className="mt-4">
            <SectionCard title="Pending Orders" accent="grade" padded={pending.length === 0} actions={countPill(pending.length)}>
              <OrdersTable rows={pending} empty="No order is pending." />
            </SectionCard>
          </div>
        ) : null}
      </div>

      {/* ---------------------------------------------------- Order Entry --- */}
      <div className="mb-6">
        <SectionCard title="Order Entry" accent="active">
          <OrderForm customerNames={customerNames} baseMaterials={baseMaterials} fileNames={fileNames} />
        </SectionCard>
      </div>

      {/* -------------------------------------------------- Recent Orders --- */}
      <SectionCard title="Recent Orders" accent="brand" padded={recent.length === 0} actions={<span className="text-muted text-xs font-medium">Latest {recent.length} of {total}</span>}>
        <OrdersTable rows={recent} empty="No order has been recorded yet." />
      </SectionCard>
    </>
  );
}
