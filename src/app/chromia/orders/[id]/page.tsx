import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/chromia/ui';
import { SectionCard } from '@/components/chromia/ui/form';
import { chromiaHasFullOrderAccess } from '@/lib/chromia/access';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { NO_CUSTOMER_LABEL, ORDER_STATUS_LABELS } from '@/lib/chromia/orders';
import { loadCustomerNames, loadOrder } from '@/lib/chromia/server/repositories/order-repository';
import { loadBaseMaterialNames, loadDesignFileNames } from '@/lib/chromia/server/services/operator-service';
import { requirePageUser } from '@/lib/pageUser';

import { orderFormValues } from '../form-values';
import { OrderForm } from '../order-form';

export const metadata: Metadata = { title: 'Order' };
export const dynamic = 'force-dynamic';

/**
 * One order, opened from its Customer Name (Orders, 17 Nov 2026): the same
 * form, filled in. Entering the Actual Delivery Date is what completes it.
 *
 * The Chromia Operator opens it from its Design Name (19 Nov 2026) and gets
 * the operator's form: no Customer Name or Order Initiated By anywhere on the
 * page, the title included, and none of the customer names to pick from.
 */
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const full = chromiaHasFullOrderAccess(user);
  const { id } = await params;
  const [order, customerNames, baseMaterials, fileNames] = await Promise.all([
    loadOrder(id),
    full ? loadCustomerNames() : Promise.resolve([]),
    loadBaseMaterialNames(),
    loadDesignFileNames(),
  ]);
  if (!order) notFound();

  return (
    <>
      <PageHeader
        eyebrow="Orders"
        title={full ? order.customerName || NO_CUSTOMER_LABEL : order.designName || 'Order'}
        description={ORDER_STATUS_LABELS[order.status]}
        actions={
          <Link
            href={APP_ROUTES.orders}
            className="border-line surface hover:border-line-strong inline-flex h-11 items-center justify-center rounded-lg border px-4 text-sm font-medium transition-colors hover:bg-[var(--surface-muted)]"
          >
            Back to Orders
          </Link>
        }
      />
      <SectionCard title="Update Order" accent="active">
        <OrderForm
          key={order.id}
          // The operator's form carries no customer, not even in hidden fields.
          order={full ? orderFormValues(order) : { ...orderFormValues(order), customerName: '', requestedBy: '' }}
          customerNames={customerNames}
          baseMaterials={baseMaterials}
          fileNames={fileNames}
          limited={!full}
        />
      </SectionCard>
    </>
  );
}
