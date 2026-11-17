/**
 * Orders (17 Nov 2026) — the rules of the standalone customer-order record.
 *
 * Nothing here knows about slabs. An order is what a customer asked for and
 * whether it has been delivered; no production count, KPI or report reads it.
 * Kept pure (no Prisma, no React) so the page, the server action and the tests
 * share one reading of every field.
 */
import { z } from 'zod';

import { isPlantDayKey, plantDayStart, toPlantDateInput } from './plant-time';
import { toMillimetres, type ThicknessUnit } from './trimming';

/** The dropdown value that opens a typed entry. */
export const ORDER_OTHERS = 'OTHERS';

/** Thickness of Slabs — the three usual ones, in millimetres, then Others. */
export const ORDER_THICKNESS_OPTIONS = [
  { value: '30', mm: 30, label: '3 cm (30 mm)' },
  { value: '20', mm: 20, label: '2 cm (20 mm)' },
  { value: '12', mm: 12, label: '1.2 cm (12 mm)' },
] as const;

/** Finishing Type — the three usual ones, then Others (typed). */
export const ORDER_FINISHING_OPTIONS = ['Polishing', 'Leather', 'Honed'] as const;

/** Recent Orders shows this many, the latest first. */
export const RECENT_ORDERS_LIMIT = 10;

/** The Dashboard's Pending Orders KPI opens this view. */
export const PENDING_VIEW = 'pending' as const;

export type OrderStatus = 'PENDING' | 'COMPLETED';

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: 'Pending',
  COMPLETED: 'Order Completed',
};

/** Pending until an Actual Delivery Date is entered; then Completed. */
export function orderStatusOf(actualDeliveryDate: Date | string | null | undefined): OrderStatus {
  return actualDeliveryDate ? 'COMPLETED' : 'PENDING';
}

/**
 * S.No. for a table of `count` rows, the latest first: 10, 9, … 1 — so the
 * oldest order shown is 1 and the newest is the highest number.
 */
export function descendingSerials(count: number): number[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => count - i);
}

/** Which dropdown choice a stored thickness is: one of the three, or Others. */
export function thicknessChoiceOf(mm: number | null | undefined): string {
  if (mm === null || mm === undefined) return '';
  return ORDER_THICKNESS_OPTIONS.find((o) => o.mm === mm)?.value ?? ORDER_OTHERS;
}

/** Which dropdown choice a stored finishing type is: one of the three, or Others. */
export function finishingChoiceOf(finishing: string | null | undefined): string {
  if (!finishing) return '';
  return (ORDER_FINISHING_OPTIONS as readonly string[]).includes(finishing) ? finishing : ORDER_OTHERS;
}

/** The text of a search box: trimmed, at most 100 characters, '' for none. */
export function parseCustomerSearch(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw ?? '').trim().slice(0, 100);
}

/* ── The form ─────────────────────────────────────────────────────────── */

const optionalText = (max: number, name: string) => z.string().trim().max(max, `${name} is too long`);

const dayField = z
  .string()
  .trim()
  .refine((v) => v === '' || isPlantDayKey(v), 'Enter a valid date');

export const orderFormSchema = z
  .object({
    customerName: z.string().trim().min(1, 'Enter the customer name').max(120, 'Customer name is too long'),
    requestedBy: optionalText(120, 'Requested By'),
    designName: optionalText(120, 'Design name'),
    baseMaterialName: optionalText(120, 'Base material name'),
    printingFileName: optionalText(160, 'Printing file name'),
    quantity: z
      .string()
      .trim()
      .refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) > 0 && Number(v) <= 100000), 'Enter the number of slabs, e.g. 12'),
    thickness: z.string().trim(),
    thicknessOther: z.string().trim(),
    thicknessUnit: z.enum(['cm', 'mm']).catch('cm'),
    finishing: z.string().trim(),
    finishingOther: optionalText(60, 'Finishing type'),
    requestedDeliveryDate: dayField,
    actualDeliveryDate: dayField,
    personInCharge: optionalText(120, 'Person In-Charge name'),
    remarks: optionalText(1000, 'Remarks'),
  })
  .superRefine((v, ctx) => {
    if (v.thickness === ORDER_OTHERS && toMillimetres(v.thicknessOther, v.thicknessUnit) === null) {
      ctx.addIssue({ code: 'custom', path: ['thicknessOther'], message: 'Enter the thickness, e.g. 1.8' });
    } else if (v.thickness && v.thickness !== ORDER_OTHERS && !ORDER_THICKNESS_OPTIONS.some((o) => o.value === v.thickness)) {
      ctx.addIssue({ code: 'custom', path: ['thickness'], message: 'Choose a thickness from the list' });
    }
    if (v.finishing === ORDER_OTHERS && !v.finishingOther) {
      ctx.addIssue({ code: 'custom', path: ['finishingOther'], message: 'Type the finishing type' });
    } else if (v.finishing && v.finishing !== ORDER_OTHERS && !(ORDER_FINISHING_OPTIONS as readonly string[]).includes(v.finishing)) {
      ctx.addIssue({ code: 'custom', path: ['finishing'], message: 'Choose a finishing type from the list' });
    }
  });

export type OrderFormInput = z.input<typeof orderFormSchema>;

/** What is stored for one order, every empty field as null. */
export interface OrderValues {
  customerName: string;
  requestedBy: string | null;
  designName: string | null;
  baseMaterialName: string | null;
  printingFileName: string | null;
  quantity: number | null;
  thicknessMm: number | null;
  finishingType: string | null;
  requestedDeliveryDate: Date | null;
  actualDeliveryDate: Date | null;
  personInCharge: string | null;
  remarks: string | null;
}

export const ORDER_FORM_FIELDS = [
  'customerName',
  'requestedBy',
  'designName',
  'baseMaterialName',
  'printingFileName',
  'quantity',
  'thickness',
  'thicknessOther',
  'thicknessUnit',
  'finishing',
  'finishingOther',
  'requestedDeliveryDate',
  'actualDeliveryDate',
  'personInCharge',
  'remarks',
] as const;

/**
 * Read the form. Only the customer's name is required; every other field may
 * be left empty and filled in later. A date is the plant's day it names.
 */
export function parseOrderForm(
  input: Partial<Record<(typeof ORDER_FORM_FIELDS)[number], string>>,
): { ok: true; values: OrderValues } | { ok: false; fieldErrors: Record<string, string[] | undefined> } {
  const parsed = orderFormSchema.safeParse(
    Object.fromEntries(ORDER_FORM_FIELDS.map((key) => [key, input[key] ?? (key === 'thicknessUnit' ? 'cm' : '')])),
  );
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  const v = parsed.data;
  const orNull = (s: string) => (s === '' ? null : s);
  const day = (s: string) => (s === '' ? null : plantDayStart(s));
  const thicknessMm =
    v.thickness === ''
      ? null
      : v.thickness === ORDER_OTHERS
        ? toMillimetres(v.thicknessOther, v.thicknessUnit as ThicknessUnit)
        : Number(v.thickness);
  return {
    ok: true,
    values: {
      customerName: v.customerName,
      requestedBy: orNull(v.requestedBy),
      designName: orNull(v.designName),
      baseMaterialName: orNull(v.baseMaterialName),
      printingFileName: orNull(v.printingFileName),
      quantity: v.quantity === '' ? null : Number(v.quantity),
      thicknessMm,
      finishingType: v.finishing === '' ? null : v.finishing === ORDER_OTHERS ? v.finishingOther : v.finishing,
      requestedDeliveryDate: day(v.requestedDeliveryDate),
      actualDeliveryDate: day(v.actualDeliveryDate),
      personInCharge: orNull(v.personInCharge),
      remarks: orNull(v.remarks),
    },
  };
}

/** A stored date as the form's yyyy-mm-dd, '' for none. */
export const dayInput = (date: Date | null | undefined): string => (date ? toPlantDateInput(date) : '');
