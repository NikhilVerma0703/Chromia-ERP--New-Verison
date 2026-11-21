import { prisma } from '@/lib/chromia/db';
import { orderStatusOf, RECENT_ORDERS_LIMIT, type OrderStatus } from '@/lib/chromia/orders';

/** entry_photo rows of an order's Reference Photo carry this model name. */
export const ORDER_PHOTO_MODEL = 'ChromiaOrder';

/** One row of an Orders table, as the page shows it. */
export interface OrderRow {
  id: string;
  customerName: string;
  requestedBy: string | null;
  designName: string | null;
  baseMaterialName: string | null;
  printingFileName: string | null;
  quantity: number | null;
  thicknessMm: number | null;
  finishingType: string | null;
  requestedDeliveryDate: Date | null;
  printingCompleted: boolean | null;
  actualDeliveryDate: Date | null;
  personInCharge: string | null;
  remarks: string | null;
  photoOriginalId: string | null;
  photoEditedId: string | null;
  status: OrderStatus;
  createdAt: Date;
}

type Stored = Awaited<ReturnType<typeof prisma.chromiaOrder.findFirstOrThrow>>;

function toRow(o: Stored): OrderRow {
  return {
    id: o.id,
    customerName: o.customerName,
    requestedBy: o.requestedBy,
    designName: o.designName,
    baseMaterialName: o.baseMaterialName,
    printingFileName: o.printingFileName,
    quantity: o.quantity,
    thicknessMm: o.thicknessMm === null ? null : Number(o.thicknessMm),
    finishingType: o.finishingType,
    requestedDeliveryDate: o.requestedDeliveryDate,
    printingCompleted: o.printingCompleted,
    actualDeliveryDate: o.actualDeliveryDate,
    personInCharge: o.personInCharge,
    remarks: o.remarks,
    photoOriginalId: o.photoOriginalId,
    photoEditedId: o.photoEditedId,
    status: orderStatusOf(o.actualDeliveryDate),
    createdAt: o.createdAt,
  };
}

/** The latest first: by when the order was entered. */
const LATEST_FIRST = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];

/** Recent Orders: the latest ten entered. */
export async function listRecentOrders(): Promise<OrderRow[]> {
  const rows = await prisma.chromiaOrder.findMany({ orderBy: LATEST_FIRST, take: RECENT_ORDERS_LIMIT });
  return rows.map(toRow);
}

/** Every order whose customer name contains the text, any case — the latest first. */
export async function searchOrdersByCustomer(customer: string): Promise<OrderRow[]> {
  const rows = await prisma.chromiaOrder.findMany({
    where: { customerName: { contains: customer, mode: 'insensitive' } },
    orderBy: LATEST_FIRST,
  });
  return rows.map(toRow);
}

/** Every order with no Actual Delivery Date yet — the latest first. */
export async function listPendingOrders(): Promise<OrderRow[]> {
  const rows = await prisma.chromiaOrder.findMany({ where: { actualDeliveryDate: null }, orderBy: LATEST_FIRST });
  return rows.map(toRow);
}

/** Every completed order — the Completed Orders KPI's list (19 Nov 2026), the same condition it counts. */
export async function listCompletedOrders(): Promise<OrderRow[]> {
  const rows = await prisma.chromiaOrder.findMany({ where: { actualDeliveryDate: { not: null } }, orderBy: LATEST_FIRST });
  return rows.map(toRow);
}

/** A KPI's list: the very rows its card counts, the screen and the Excel alike. */
export function listOrdersInView(view: 'pending' | 'completed'): Promise<OrderRow[]> {
  return view === 'pending' ? listPendingOrders() : listCompletedOrders();
}

/** The two Dashboard KPIs. Together they are every order. */
export async function countOrders(): Promise<{ completed: number; pending: number }> {
  const [completed, pending] = await Promise.all([
    prisma.chromiaOrder.count({ where: { actualDeliveryDate: { not: null } } }),
    prisma.chromiaOrder.count({ where: { actualDeliveryDate: null } }),
  ]);
  return { completed, pending };
}

export async function loadOrder(id: string): Promise<OrderRow | null> {
  const order = await prisma.chromiaOrder.findUnique({ where: { id } });
  return order ? toRow(order) : null;
}

/** Customer names already used, for the form's suggestions. */
export async function loadCustomerNames(): Promise<string[]> {
  const rows = await prisma.chromiaOrder.findMany({ distinct: ['customerName'], select: { customerName: true }, orderBy: { customerName: 'asc' }, take: 500 });
  return rows.map((r) => r.customerName);
}

/** One saved Reference Photo, bytes and all — only an order's photo. */
export async function loadOrderPhoto(photoId: string) {
  return prisma.entryPhoto.findFirst({
    where: { id: photoId, model: ORDER_PHOTO_MODEL },
    select: { id: true, filename: true, mime: true, data: true },
  });
}
