import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { navigation } from '@/lib/chromia/config/navigation';
import {
  descendingSerials,
  finishingChoiceOf,
  ORDER_OTHERS,
  orderStatusOf,
  parseCustomerSearch,
  parseOrderForm,
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
    expect(titles).toEqual(['Dashboard', 'Pending Orders', 'Order Entry', 'Recent Orders']);
    expect(page).toMatch(/Search Customer Name/);
    expect(page).toMatch(/Total Completed Orders/);
    expect(page).toMatch(/Total Pending Orders/);
    expect(page).toMatch(/Click to See Orders/);
  });

  it('Recent Orders has exactly the fourteen columns asked for, in order', () => {
    const heads = [...table.matchAll(/<th className=\{th\}>([^<]+)<\/th>/g)].map((m) => m[1]);
    expect(heads).toEqual([
      'S.No.',
      'Customer Name',
      'Requested By',
      'Design Name',
      'Base Material Name',
      'Printing File Name',
      'Quantity of Slabs',
      'Thickness of Slabs',
      'Finishing Type',
      'Requested Delivery Date',
      'Actual Delivery Date',
      'Person In-Charge Name',
      'Remarks',
      'Status',
    ]);
    expect(table).toMatch(/row\.actualDeliveryDate \? dateFmt\.format\(row\.actualDeliveryDate\) : '--'/);
  });

  it('the form: nine Order Details, the DELIVERY STATUS heading, then its four', () => {
    const labels = [...form.matchAll(/<Field\s+label="([^"]+)"/g)].map((m) => m[1]);
    expect(labels).toEqual([
      'Customer Name *',
      'Requested By',
      'Design Name',
      'Base Material Name',
      'Printing File Name',
      'Quantity of Slabs',
      'Thickness of Slabs',
      'Finishing Type',
      'Requested Delivery Date',
      'Actual Delivery Date',
      'Person In-Charge Name',
      'Remarks',
      'Reference Photo',
    ]);
    expect(form.indexOf('>DELIVERY STATUS<')).toBeGreaterThan(form.indexOf('label="Requested Delivery Date"'));
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
