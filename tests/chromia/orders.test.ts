import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { navigation } from '@/lib/chromia/config/navigation';
import {
  descendingSerials,
  finishingChoiceOf,
  ORDER_EXPORT_COLUMNS,
  ORDER_INITIATED_BY_LABEL,
  ORDER_OTHERS,
  orderExportMatrix,
  orderStatusOf,
  parseCustomerSearch,
  parseOrderForm,
  parseOrderView,
  printingChoiceOf,
  printingStatusLabel,
  quantityTotal,
  thicknessChoiceOf,
} from '@/lib/chromia/orders';
import { toPlantDateInput } from '@/lib/chromia/plant-time';

const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8').replace(/\r\n/g, '\n');

/** Every source file under a folder. */
function sources(dir: string): string[] {
  const abs = new URL(dir, root);
  return readdirSync(abs).flatMap((name) => {
    const path = join(dir, name).replace(/\\/g, '/');
    return statSync(new URL(path, root)).isDirectory() ? sources(`${path}/`) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('Orders — status, S.No. and the dropdowns (17 Nov 2026)', () => {
  it('is Pending without an Actual Delivery Date, Order Completed with one', () => {
    expect(orderStatusOf(null)).toBe('PENDING');
    expect(orderStatusOf(undefined)).toBe('PENDING');
    expect(orderStatusOf(new Date('2026-11-17T00:00:00Z'))).toBe('COMPLETED');
  });

  it('numbers a table counting down: 10, 9, … 1', () => {
    expect(descendingSerials(10)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(descendingSerials(3)).toEqual([3, 2, 1]);
    expect(descendingSerials(0)).toEqual([]);
  });

  it('reads a stored thickness and finishing back into the dropdowns', () => {
    expect(thicknessChoiceOf(30)).toBe('30');
    expect(thicknessChoiceOf(12)).toBe('12');
    expect(thicknessChoiceOf(18)).toBe(ORDER_OTHERS);
    expect(thicknessChoiceOf(null)).toBe('');
    expect(finishingChoiceOf('Leather')).toBe('Leather');
    expect(finishingChoiceOf('Brushed')).toBe(ORDER_OTHERS);
    expect(finishingChoiceOf(null)).toBe('');
  });

  it('trims the customer search, and takes the first of repeated ones', () => {
    expect(parseCustomerSearch('  Acme  ')).toBe('Acme');
    expect(parseCustomerSearch(['Bharat', 'x'])).toBe('Bharat');
    expect(parseCustomerSearch(undefined)).toBe('');
  });
});

describe('Orders — the form saves what is entered, and only the customer is required', () => {
  it('saves with every other field empty, as Pending', () => {
    const r = parseOrderForm({ customerName: 'Acme Tiles' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.values).toEqual({
      customerName: 'Acme Tiles',
      requestedBy: null,
      designName: null,
      baseMaterialName: null,
      printingFileName: null,
      quantity: null,
      thicknessMm: null,
      finishingType: null,
      requestedDeliveryDate: null,
      printingCompleted: null,
      actualDeliveryDate: null,
      personInCharge: null,
      remarks: null,
    });
    expect(orderStatusOf(r.values.actualDeliveryDate)).toBe('PENDING');
  });

  it('refuses an order with no customer name', () => {
    const r = parseOrderForm({ customerName: '  ', designName: 'Astral' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fieldErrors.customerName?.[0]).toMatch(/customer name/i);
  });

  it('stores a listed thickness in mm, and Others in either unit', () => {
    const listed = parseOrderForm({ customerName: 'A', thickness: '12' });
    expect(listed.ok && listed.values.thicknessMm).toBe(12);
    const cm = parseOrderForm({ customerName: 'A', thickness: ORDER_OTHERS, thicknessOther: '1.8', thicknessUnit: 'cm' });
    expect(cm.ok && cm.values.thicknessMm).toBe(18);
    const mm = parseOrderForm({ customerName: 'A', thickness: ORDER_OTHERS, thicknessOther: '25', thicknessUnit: 'mm' });
    expect(mm.ok && mm.values.thicknessMm).toBe(25);
    const blank = parseOrderForm({ customerName: 'A', thickness: ORDER_OTHERS, thicknessOther: '' });
    expect(blank.ok).toBe(false);
  });

  it('stores Finishing Type as chosen, or as typed under Others', () => {
    const listed = parseOrderForm({ customerName: 'A', finishing: 'Honed' });
    expect(listed.ok && listed.values.finishingType).toBe('Honed');
    const typed = parseOrderForm({ customerName: 'A', finishing: ORDER_OTHERS, finishingOther: 'Brushed' });
    expect(typed.ok && typed.values.finishingType).toBe('Brushed');
    expect(parseOrderForm({ customerName: 'A', finishing: ORDER_OTHERS }).ok).toBe(false);
    expect(parseOrderForm({ customerName: 'A', finishing: 'Glossy' }).ok).toBe(false);
  });

  it('an Actual Delivery Date completes the order, on the plant day typed', () => {
    const r = parseOrderForm({ customerName: 'A', requestedDeliveryDate: '2026-11-20', actualDeliveryDate: '2026-11-18', quantity: '12' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(toPlantDateInput(r.values.actualDeliveryDate as Date)).toBe('2026-11-18');
    expect(toPlantDateInput(r.values.requestedDeliveryDate as Date)).toBe('2026-11-20');
    expect(r.values.quantity).toBe(12);
    expect(orderStatusOf(r.values.actualDeliveryDate)).toBe('COMPLETED');
  });

  it('refuses a quantity that is not a whole number of slabs, and a date that is not one', () => {
    expect(parseOrderForm({ customerName: 'A', quantity: '2.5' }).ok).toBe(false);
    expect(parseOrderForm({ customerName: 'A', quantity: '0' }).ok).toBe(false);
    expect(parseOrderForm({ customerName: 'A', actualDeliveryDate: '2026-02-31' }).ok).toBe(false);
  });
});

describe('Orders — the page', () => {
  const page = read('src/app/chromia/orders/page.tsx');
  const table = read('src/app/chromia/orders/orders-table.tsx');
  const form = read('src/app/chromia/orders/order-form.tsx');

  it('is Dashboard, then Order Entry, then Recent Orders', () => {
    const titles = [...page.matchAll(/<SectionCard\s+title="([^"]+)"/g)].map((m) => m[1]);
    expect(titles).toEqual(['Dashboard', 'Order Entry', 'Recent Orders']);
    expect(page).toMatch(/Search Customer Name/);
    expect(page).toMatch(/Total Completed Orders/);
    expect(page).toMatch(/Total Pending Orders/);
    // Both KPI cards open their orders (19 Nov 2026).
    expect(page).toMatch(/\(\['completed', 'pending'\] as const\)\.map\(\(kpi\) => \{/);
    expect(page).toMatch(/'Click to See Orders'/);
    expect(page).toMatch(/title=\{ORDER_VIEW_LABELS\[view\]\}/);
  });

  it('Recent Orders has the columns asked for, in order, then Action after Status (19 Nov 2026)', () => {
    const head = table.slice(table.indexOf('<thead'), table.indexOf('</thead>'));
    const heads = [...head.matchAll(/<th className=\{[^>]+\}>([^<]+)<\/th>/g)].map((m) => m[1]);
    expect(heads).toEqual([
      'S.No.',
      'Customer Name',
      '{ORDER_INITIATED_BY_LABEL}',
      'Design Name',
      'Base Material Name',
      'Printing File Name',
      'Quantity of Slabs',
      'Thickness of Slabs',
      'Finishing Type',
      'Requested Delivery Date',
      'Printing Status',
      'Actual Delivery Date',
      'Person In-Charge Name',
      'Remarks',
      'Status',
      'Action',
    ]);
    expect(table).toMatch(/row\.actualDeliveryDate \? dateFmt\.format\(row\.actualDeliveryDate\) : '--'/);
  });

  it('the form: ten Order Details (Printing Completed? after Requested Delivery Date), the DELIVERY STATUS heading, then its four', () => {
    const labels = [...form.matchAll(/<Field\s+label=(?:"([^"]+)"|\{([A-Z_]+)\})/g)].map((m) => m[1] ?? m[2]);
    expect(labels).toEqual([
      'Customer Name *',
      'ORDER_INITIATED_BY_LABEL',
      'Design Name',
      'Base Material Name',
      'Printing File Name',
      'Quantity of Slabs',
      'Thickness of Slabs',
      'Finishing Type',
      'Requested Delivery Date',
      'Printing Completed?',
      'Actual Delivery Date',
      'Person In-Charge Name',
      'Remarks',
      'Reference Photo',
    ]);
    expect(form.indexOf('>DELIVERY STATUS<')).toBeGreaterThan(form.indexOf('label="Printing Completed?"'));
    expect(form.indexOf('>DELIVERY STATUS<')).toBeLessThan(form.indexOf('label="Actual Delivery Date"'));
  });

  it('is last in both navigations, in its own Orders section', () => {
    expect(navigation[navigation.length - 1]).toMatchObject({ title: 'Orders', href: '/chromia/orders' });
    expect(read('src/lib/navModel.ts')).toMatch(/section\("Orders", CHROMIA_ITEMS\.filter\(\(t\) => t\.href === "\/chromia\/orders"\)\)/);
  });
});

describe('Orders — kept apart from every slab workflow', () => {
  const orderFiles = [
    ...sources('src/app/chromia/orders/'),
    'src/lib/chromia/orders.ts',
    'src/lib/chromia/server/actions/orders.ts',
    'src/lib/chromia/server/repositories/order-repository.ts',
    // The KPI lists' Excel (19 Nov 2026) reads orders and nothing else.
    'src/app/api/chromia/orders-export/route.ts',
  ];

  it('the Orders code touches only chromia_order and its photos', () => {
    for (const file of orderFiles) {
      const src = read(file);
      const models = [...src.matchAll(/(?:prisma|tx)\.(\w+)\./g)].map((m) => m[1]);
      expect(models.filter((m) => !['chromiaOrder', 'entryPhoto', 'chromiaAuditLog', '$transaction'].includes(m as string)), file).toEqual([]);
    }
  });

  it('no other Chromia page, count or report reads an order', () => {
    const others = [...sources('src/app/'), ...sources('src/lib/'), ...sources('src/components/')].filter(
      (f) => !orderFiles.includes(f) && !f.includes('api/chromia/order-photo'),
    );
    for (const file of others) expect(read(file), file).not.toMatch(/chromiaOrder|order-repository|ORDER_PHOTO_MODEL/);
  });
});

describe('Orders — who sees and does what (19 Nov 2026)', () => {
  const page = read('src/app/chromia/orders/page.tsx');
  const one = read('src/app/chromia/orders/[id]/page.tsx');
  const table = read('src/app/chromia/orders/orders-table.tsx');
  const form = read('src/app/chromia/orders/order-form.tsx');
  const actions = read('src/lib/chromia/server/actions/orders.ts');
  const route = read('src/app/api/chromia/orders-export/route.ts');

  it('"Requested By" is "Order Initiated By" for every role', () => {
    expect(ORDER_INITIATED_BY_LABEL).toBe('Order Initiated By');
    expect([page, table, form].join('')).not.toMatch(/>Requested By</);
  });

  it('the operator\'s form saves without a customer name; every other role\'s still needs one', () => {
    const blank = { customerName: '', designName: 'Tajvein', quantity: '4' };
    expect(parseOrderForm(blank).ok).toBe(false);
    const operator = parseOrderForm(blank, { withCustomer: false });
    expect(operator.ok).toBe(true);
    if (operator.ok) expect(operator.values.designName).toBe('Tajvein');
  });

  it('the server, not the form, keeps the operator off Customer Name and Order Initiated By', () => {
    expect(actions).toMatch(/const full = chromiaHasFullOrderAccess\(await currentUser\(\)\);/);
    expect(actions).toMatch(/if \(!full\) \{\n\s+\/\/[^\n]*\n\s+values\.customerName = before\?\.customerName \?\? '';\n\s+values\.requestedBy = before\?\.requestedBy \?\? null;/);
  });

  it('Delete and the Excel are refused to the operator on the server', () => {
    const del = actions.slice(actions.indexOf('export async function deleteOrderAction'));
    expect(del).toMatch(/const user = await requireActingUser\(\);\n\s+if \(!chromiaHasFullOrderAccess\(await currentUser\(\)\)\) \{\n\s+throw new AppError\(ErrorCode\.FORBIDDEN,/);
    expect(del).toMatch(/tx\.entryPhoto\.deleteMany\(\{ where: \{ model: ORDER_PHOTO_MODEL, recordId: id \} \}\)/);
    expect(del).toMatch(/action: AuditAction\.DELETE/);
    expect(route).toMatch(/if \(!chromiaHasFullOrderAccess\(await currentUser\(\)\)\) return new Response\('Forbidden', \{ status: 403 \}\);/);
  });

  it('the operator gets no Dashboard, no customers and no Delete on the page', () => {
    expect(page).toMatch(/const full = chromiaHasFullOrderAccess\(user\);/);
    expect(page).toMatch(/const customer = full \? parseCustomerSearch\(params\.customer\) : '';/);
    expect(page).toMatch(/const view = full \? parseOrderView\(params\.view\) : null;/);
    expect(page).toMatch(/full \? loadCustomerNames\(\) : Promise\.resolve\(\[\]\)/);
    expect(page).toMatch(/\{full \? \(\n\s+<div className="mb-6">\n\s+<SectionCard title="Dashboard"/);
    expect(page).toMatch(/<OrderForm [^>]*limited=\{!full\} \/>/);
    expect(page).toMatch(/<OrdersTable rows=\{recent\} [^>]*operator=\{!full\} canDelete=\{full\} \/>/);
    expect(form).toMatch(/\{limited \? null : \(\n\s+<>\n\s+<Field label="Customer Name \*"/);
    expect(one).toMatch(/full \? loadCustomerNames\(\) : Promise\.resolve\(\[\]\)/);
    expect(one).toMatch(/limited=\{!full\}/);
  });

  it('the operator\'s table: S.No., then Design Name, highlighted, which opens the order; no customer columns', () => {
    expect(table).toMatch(/\{operator \? null : <th className=\{th\}>Customer Name<\/th>\}/);
    expect(table).toMatch(/\{operator \? null : <th className=\{th\}>\{ORDER_INITIATED_BY_LABEL\}<\/th>\}/);
    expect(table).toMatch(/\{operator \? \(\n\s+<Link\n\s+href=\{open\(row\.id\)\}\n\s+data-design-link=""/);
    expect(table).toMatch(/\{canDelete \? <DeleteOrderButton /);
  });

  it('a KPI list\'s Total is the Quantity of Slabs of exactly its rows, on screen and in the Excel', () => {
    const rows = [
      { quantity: 5 }, { quantity: 11 }, { quantity: null }, { quantity: 9 },
    ];
    expect(quantityTotal(rows)).toBe(25);
    expect(quantityTotal([])).toBe(0);
    const day = new Date('2026-11-19T00:00:00Z');
    const order = (customerName: string, quantity: number | null) => ({
      customerName, requestedBy: null, designName: 'Tajvein', baseMaterialName: null, printingFileName: null, quantity,
      thicknessMm: 20, finishingType: null, requestedDeliveryDate: day, printingCompleted: false, actualDeliveryDate: null, personInCharge: null, remarks: null,
      status: 'PENDING' as const,
    });
    const { body, total } = orderExportMatrix([order('Customer 1', 5), order('Customer 2', 11), order('', 9)], { thickness: (mm) => `${mm} mm`, day: () => '19 Nov 2026' });
    expect(body.map((r) => [r[0], r[1], r[6]])).toEqual([[3, 'Customer 1', 5], [2, 'Customer 2', 11], [1, 'Customer not entered', 9]]);
    expect(total[0]).toBe('Total');
    expect(total[ORDER_EXPORT_COLUMNS.indexOf('Quantity of Slabs')]).toBe(25);
    expect(body[0]).toHaveLength(ORDER_EXPORT_COLUMNS.length);
    expect(read('src/app/api/chromia/orders-export/route.ts')).toMatch(/const rows = await listOrdersInView\(view\);/);
    expect(table).toMatch(/<td className=\{`\$\{tdNum\} font-semibold`\}>\{quantityTotal\(rows\)\}<\/td>/);
  });

  it('each KPI lists the very orders it counts', () => {
    const repo = read('src/lib/chromia/server/repositories/order-repository.ts');
    expect(repo).toMatch(/prisma\.chromiaOrder\.count\(\{ where: \{ actualDeliveryDate: \{ not: null \} \} \}\)/);
    expect(repo).toMatch(/listCompletedOrders[\s\S]{0,200}where: \{ actualDeliveryDate: \{ not: null \} \}/);
    expect(repo).toMatch(/prisma\.chromiaOrder\.count\(\{ where: \{ actualDeliveryDate: null \} \}\)/);
    expect(repo).toMatch(/listPendingOrders[\s\S]{0,200}where: \{ actualDeliveryDate: null \}/);
    expect(parseOrderView('completed')).toBe('completed');
    expect(parseOrderView('everything')).toBeNull();
  });
});

describe('Orders — Printing Completed? and Printing Status (21 Nov 2026)', () => {
  it('Yes and No are stored as true and false; not chosen stays empty', () => {
    const yes = parseOrderForm({ customerName: 'Acme', printingCompleted: 'YES' });
    const no = parseOrderForm({ customerName: 'Acme', printingCompleted: 'NO' });
    const none = parseOrderForm({ customerName: 'Acme' });
    expect([yes, no, none].map((r) => (r.ok ? r.values.printingCompleted : 'refused'))).toEqual([true, false, null]);
    const bad = parseOrderForm({ customerName: 'Acme', printingCompleted: 'MAYBE' });
    expect(bad.ok).toBe(false);
  });

  it('the Chromia Operator\'s form has it too: only Customer Name and Order Initiated By are left out', () => {
    const r = parseOrderForm({ designName: 'Tajvein', printingCompleted: 'NO' }, { withCustomer: false });
    expect(r.ok && r.values.printingCompleted).toBe(false);
    const form = read('src/app/chromia/orders/order-form.tsx');
    const limitedBlock = form.slice(form.indexOf('{limited ? null : ('), form.indexOf('label="Design Name"'));
    expect(limitedBlock).not.toContain('printingCompleted');
  });

  it('reads back into the form, and labels the column', () => {
    expect([true, false, null].map(printingChoiceOf)).toEqual(['YES', 'NO', '']);
    expect([true, false, null].map(printingStatusLabel)).toEqual(['Printing Completed', 'Printing NOT Completed', null]);
  });

  it('only the word NOT is red', () => {
    const table = read('src/app/chromia/orders/orders-table.tsx');
    expect(table).toContain('Printing <span className="font-semibold text-red-600">NOT</span> Completed');
    expect(table).toContain('<span className="text-foreground">Printing Completed</span>');
  });

  it('the Excel keeps the table\'s order: Printing Status after Requested Delivery Date', () => {
    expect(ORDER_EXPORT_COLUMNS.indexOf('Printing Status')).toBe(ORDER_EXPORT_COLUMNS.indexOf('Requested Delivery Date') + 1);
  });
});
