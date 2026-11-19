'use client';

import { useActionState, useEffect, useRef, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { Field, FormError } from '@/components/chromia/ui';
import { field, selectField } from '@/components/chromia/ui/form';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { ORDER_FINISHING_OPTIONS, ORDER_INITIATED_BY_LABEL, ORDER_OTHERS, ORDER_THICKNESS_OPTIONS } from '@/lib/chromia/orders';
import { saveOrderAction, type OrderFormState } from '@/lib/chromia/server/actions/orders';

import { PhotoEditor, type PhotoEditorHandle } from './photo-editor';

/** One order's stored values, as the form's fields hold them. */
export interface OrderFormValues {
  id: string;
  customerName: string;
  requestedBy: string;
  designName: string;
  baseMaterialName: string;
  printingFileName: string;
  quantity: string;
  thickness: string;
  thicknessOther: string;
  finishing: string;
  finishingOther: string;
  requestedDeliveryDate: string;
  actualDeliveryDate: string;
  personInCharge: string;
  remarks: string;
  /** Where the saved Reference Photo is shown, or null for none. */
  photoEditedSrc: string | null;
  photoOriginalSrc: string | null;
}

const EMPTY: OrderFormValues = {
  id: '',
  customerName: '',
  requestedBy: '',
  designName: '',
  baseMaterialName: '',
  printingFileName: '',
  quantity: '',
  thickness: '',
  thicknessOther: '',
  finishing: '',
  finishingOther: '',
  requestedDeliveryDate: '',
  actualDeliveryDate: '',
  personInCharge: '',
  remarks: '',
  photoEditedSrc: null,
  photoOriginalSrc: null,
};

const primary =
  'bg-brand-600 hover:bg-brand-700 inline-flex h-11 items-center justify-center rounded-lg px-6 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(16,24,40,0.12)] transition-colors disabled:cursor-not-allowed disabled:opacity-55';

/**
 * Order Entry (Orders, 17 Nov 2026) — a new order, or one opened from its
 * Customer Name to change. Nine Order Details, then DELIVERY STATUS: Actual
 * Delivery Date, Person In-Charge, Reference Photo and Remarks. Only the
 * customer's name is required. Status follows the Actual Delivery Date:
 * Pending without one, Order Completed with one.
 *
 * `limited` is the Chromia Operator's form (19 Nov 2026): Customer Name and
 * Order Initiated By are not on it at all — not hidden, absent — and the
 * server keeps the order's own values for both (saveOrderAction). Every other
 * field, Requested and Actual Delivery Date included, is the operator's.
 */
export function OrderForm({
  order,
  customerNames,
  baseMaterials,
  fileNames,
  limited = false,
}: {
  order?: OrderFormValues;
  customerNames: string[];
  baseMaterials: string[];
  fileNames: string[];
  limited?: boolean;
}) {
  const router = useRouter();
  const editing = Boolean(order?.id);
  const initial = order ?? EMPTY;
  const [state, formAction, isPending] = useActionState<OrderFormState, FormData>(saveOrderAction, {});
  const [isSubmitting, startSubmit] = useTransition();
  const [isReturning, startReturn] = useTransition();
  const [round, setRound] = useState(0);
  const [thickness, setThickness] = useState(initial.thickness);
  const [finishing, setFinishing] = useState(initial.finishing);
  const [delivered, setDelivered] = useState(Boolean(initial.actualDeliveryDate));
  const editor = useRef<PhotoEditorHandle>(null);
  const handled = useRef<number | null>(null);

  useEffect(() => {
    if (!state.savedAt || handled.current === state.savedAt) return;
    handled.current = state.savedAt;
    if (editing) {
      startReturn(() => router.push(APP_ROUTES.orders));
      return;
    }
    // A new order is in Recent Orders: empty the form for the next one.
    setRound((n) => n + 1);
    setThickness('');
    setFinishing('');
    setDelivered(false);
    editor.current?.clear();
  }, [state.savedAt, editing, router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const photo = await editor.current?.result();
    if (photo) {
      data.set('photoOriginal', new File([photo.original], 'order-original.jpg', { type: 'image/jpeg' }));
      data.set('photoEdited', new File([photo.edited], 'order-edited.jpg', { type: 'image/jpeg' }));
    }
    startSubmit(() => formAction(data));
  }

  const errors = state.fieldErrors;
  const busy = isPending || isSubmitting || isReturning;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      <input type="hidden" name="id" value={initial.id} />
      <div key={round} className="flex flex-col gap-6">
        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          {limited ? null : (
            <>
              <Field label="Customer Name *" htmlFor="customerName" error={errors?.customerName?.[0]}>
                <input id="customerName" name="customerName" required list="order-customers" defaultValue={initial.customerName} maxLength={120} className={field} />
                <datalist id="order-customers">
                  {customerNames.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </Field>
              <Field label={ORDER_INITIATED_BY_LABEL} htmlFor="requestedBy" error={errors?.requestedBy?.[0]}>
                <input id="requestedBy" name="requestedBy" defaultValue={initial.requestedBy} maxLength={120} className={field} />
              </Field>
            </>
          )}
          <Field label="Design Name" htmlFor="designName" error={errors?.designName?.[0]}>
            <input id="designName" name="designName" defaultValue={initial.designName} maxLength={120} className={field} />
          </Field>
          <Field label="Base Material Name" htmlFor="baseMaterialName" error={errors?.baseMaterialName?.[0]}>
            <input id="baseMaterialName" name="baseMaterialName" list="order-materials" defaultValue={initial.baseMaterialName} maxLength={120} className={field} />
            <datalist id="order-materials">
              {baseMaterials.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </Field>
          <Field label="Printing File Name" htmlFor="printingFileName" error={errors?.printingFileName?.[0]}>
            <input id="printingFileName" name="printingFileName" list="order-files" defaultValue={initial.printingFileName} maxLength={160} className={field} />
            <datalist id="order-files">
              {fileNames.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </Field>
          <Field label="Quantity of Slabs" htmlFor="quantity" error={errors?.quantity?.[0]}>
            <input id="quantity" name="quantity" inputMode="numeric" defaultValue={initial.quantity} className={field} />
          </Field>
          <Field label="Thickness of Slabs" htmlFor="thickness" error={errors?.thickness?.[0] ?? errors?.thicknessOther?.[0]}>
            <select id="thickness" name="thickness" value={thickness} onChange={(e) => setThickness(e.target.value)} className={selectField}>
              <option value="">Select</option>
              {ORDER_THICKNESS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
              <option value={ORDER_OTHERS}>Others</option>
            </select>
            {thickness === ORDER_OTHERS ? (
              <div className="flex gap-2">
                <input name="thicknessOther" inputMode="decimal" defaultValue={initial.thicknessOther} placeholder="e.g. 1.8" aria-label="Other thickness" className={field} />
                <select name="thicknessUnit" defaultValue="cm" aria-label="Unit" className={`${selectField} w-24 shrink-0`}>
                  <option value="cm">cm</option>
                  <option value="mm">mm</option>
                </select>
              </div>
            ) : null}
          </Field>
          <Field label="Finishing Type" htmlFor="finishing" error={errors?.finishing?.[0] ?? errors?.finishingOther?.[0]}>
            <select id="finishing" name="finishing" value={finishing} onChange={(e) => setFinishing(e.target.value)} className={selectField}>
              <option value="">Select</option>
              {ORDER_FINISHING_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
              <option value={ORDER_OTHERS}>Others</option>
            </select>
            {finishing === ORDER_OTHERS ? (
              <input name="finishingOther" defaultValue={initial.finishingOther} maxLength={60} placeholder="Type the finishing type" aria-label="Other finishing type" className={field} />
            ) : null}
          </Field>
          <Field label="Requested Delivery Date" htmlFor="requestedDeliveryDate" error={errors?.requestedDeliveryDate?.[0]}>
            <input id="requestedDeliveryDate" name="requestedDeliveryDate" type="date" defaultValue={initial.requestedDeliveryDate} className={field} />
          </Field>
        </div>

        <div className="bg-brand-50 border-brand-200 rounded-xl border px-5 py-2.5 text-center">
          <h3 className="text-brand-800 text-[17px] font-bold tracking-[0.12em]">DELIVERY STATUS</h3>
        </div>

        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            label="Actual Delivery Date"
            htmlFor="actualDeliveryDate"
            error={errors?.actualDeliveryDate?.[0]}
            badge={
              <span className={`text-xs font-semibold ${delivered ? 'text-status-done' : 'text-status-waste'}`} data-order-status-preview="">
                ● {delivered ? 'Order Completed' : 'Pending'}
              </span>
            }
          >
            <input
              id="actualDeliveryDate"
              name="actualDeliveryDate"
              type="date"
              defaultValue={initial.actualDeliveryDate}
              onChange={(e) => setDelivered(e.target.value !== '')}
              className={field}
            />
          </Field>
          <Field label="Person In-Charge Name" htmlFor="personInCharge" error={errors?.personInCharge?.[0]}>
            <input id="personInCharge" name="personInCharge" defaultValue={initial.personInCharge} maxLength={120} className={field} />
          </Field>
          <Field label="Remarks" htmlFor="remarks" error={errors?.remarks?.[0]} className="sm:col-span-2 lg:col-span-1">
            <textarea id="remarks" name="remarks" defaultValue={initial.remarks} maxLength={1000} rows={2} className={`${field} h-auto min-h-11 py-2.5`} />
          </Field>
        </div>

        <Field label="Reference Photo">
          {initial.photoEditedSrc ? (
            <div className="mb-2 flex flex-wrap items-end gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element -- a stored photo, served by its own route */}
              <img src={initial.photoEditedSrc} alt="Saved reference photo" className="border-line max-h-48 rounded-lg border" />
              <div className="flex flex-col gap-1 text-sm">
                <a href={initial.photoEditedSrc} target="_blank" rel="noreferrer" className="text-brand-700 font-medium hover:underline">
                  View marked-up photo
                </a>
                {initial.photoOriginalSrc ? (
                  <a href={initial.photoOriginalSrc} target="_blank" rel="noreferrer" className="text-brand-700 font-medium hover:underline">
                    View original photo
                  </a>
                ) : null}
                <span className="text-muted text-xs">A new photo below replaces this one when you save.</span>
              </div>
            </div>
          ) : null}
          <PhotoEditor ref={editor} savedOriginalSrc={initial.photoOriginalSrc} />
        </Field>
      </div>

      <div className="border-line flex flex-col gap-3 border-t pt-5">
        <FormError message={state.error} />
        {state.savedAt && !editing && !state.error ? (
          <p className="text-status-done text-sm font-medium" role="status">
            {state.savedCustomer ? `Order for ${state.savedCustomer} saved` : 'Order saved'} — it is at the top of Recent Orders.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-4">
          <button type="submit" disabled={busy} className={primary}>
            {busy ? (isReturning ? 'Saved — returning…' : 'Saving…') : editing ? 'Update Order' : 'Save Order'}
          </button>
          <span className="text-muted text-sm">Only the customer name is required — the rest can be filled in later.</span>
        </div>
      </div>
    </form>
  );
}
