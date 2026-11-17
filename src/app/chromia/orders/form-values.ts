import { API_ROUTES } from '@/lib/chromia/constants/app';
import { dayInput, finishingChoiceOf, ORDER_OTHERS, thicknessChoiceOf } from '@/lib/chromia/orders';
import type { OrderRow } from '@/lib/chromia/server/repositories/order-repository';

import type { OrderFormValues } from './order-form';

const photoSrc = (id: string | null) => (id ? `${API_ROUTES.orderPhoto}/${encodeURIComponent(id)}` : null);

/** A stored order as the form's fields hold it. */
export function orderFormValues(order: OrderRow): OrderFormValues {
  const thickness = thicknessChoiceOf(order.thicknessMm);
  const finishing = finishingChoiceOf(order.finishingType);
  return {
    id: order.id,
    customerName: order.customerName,
    requestedBy: order.requestedBy ?? '',
    designName: order.designName ?? '',
    baseMaterialName: order.baseMaterialName ?? '',
    printingFileName: order.printingFileName ?? '',
    quantity: order.quantity === null ? '' : String(order.quantity),
    thickness,
    // Others is shown in cm, the unit the field starts in.
    thicknessOther: thickness === ORDER_OTHERS && order.thicknessMm !== null ? String(order.thicknessMm / 10) : '',
    finishing,
    finishingOther: finishing === ORDER_OTHERS ? (order.finishingType ?? '') : '',
    requestedDeliveryDate: dayInput(order.requestedDeliveryDate),
    actualDeliveryDate: dayInput(order.actualDeliveryDate),
    personInCharge: order.personInCharge ?? '',
    remarks: order.remarks ?? '',
    photoEditedSrc: photoSrc(order.photoEditedId),
    photoOriginalSrc: photoSrc(order.photoOriginalId),
  };
}
