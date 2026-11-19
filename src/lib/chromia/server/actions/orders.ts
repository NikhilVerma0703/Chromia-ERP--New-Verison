'use server';

import { randomUUID } from 'node:crypto';

import { ChromiaAuditAction as AuditAction } from '@prisma/client';
import { revalidatePath } from 'next/cache';

import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { requireActingUser } from '@/lib/chromia/current-user';
import { prisma } from '@/lib/chromia/db';
import { AppError, ErrorCode, isAppError } from '@/lib/chromia/errors';
import { chromiaHasFullOrderAccess } from '@/lib/chromia/tier';
import { currentUser } from '@/lib/rbac';
import { createLogger } from '@/lib/chromia/logger';
import { ORDER_FORM_FIELDS, parseOrderForm } from '@/lib/chromia/orders';
import { ORDER_PHOTO_MODEL } from '@/lib/chromia/server/repositories/order-repository';

const log = createLogger('orders');

export interface OrderFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /** Set once the order is stored — a new entry then empties the form. */
  savedAt?: number;
  savedCustomer?: string;
}

/** The photo formats the editor saves, recognised by their first bytes. */
const KINDS: { mime: string; ext: string; magic: (b: Buffer) => boolean }[] = [
  { mime: 'image/jpeg', ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', ext: 'webp', magic: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
];

/** Upper bound for one photo. The editor re-encodes well under it. */
const MAX_BYTES = 8 * 1024 * 1024;

type Photo = { bytes: Buffer<ArrayBuffer>; mime: string; ext: string };

/** A photo from the form: none, one that is really an image, or why not. */
async function readPhoto(value: FormDataEntryValue | null): Promise<Photo | null | string> {
  if (!(value instanceof File) || value.size === 0) return null;
  if (value.size > MAX_BYTES) return 'The reference photo is too large — crop or resize it and save again.';
  const bytes = Buffer.from(await value.arrayBuffer());
  const kind = KINDS.find((candidate) => candidate.magic(bytes));
  if (!kind) return 'The reference photo is not an image (JPEG, PNG or WebP).';
  return { bytes, mime: kind.mime, ext: kind.ext };
}

/**
 * Save an order (Orders, 17 Nov 2026) — a new one, or the one named by `id`.
 *
 * Only the customer's name is required. A new Reference Photo comes as two
 * files, the original and the annotated copy; both are stored in entry_photo
 * against the order, and any photo it had before is replaced. Nothing outside
 * chromia_order and its photos is read or written.
 *
 * THE CHROMIA OPERATOR (19 Nov 2026) has no Customer Name and no Order
 * Initiated By. Decided here from the signed-in login, not from the form: an
 * operator's save keeps the order's own two values whatever the request
 * carries (none, for a new order — a role that sees customers adds the name
 * later), and does not need a customer name to save.
 */
export async function saveOrderAction(_previous: OrderFormState, formData: FormData): Promise<OrderFormState> {
  const text = (key: string) => {
    const value = formData.get(key);
    return typeof value === 'string' ? value : '';
  };
  const full = chromiaHasFullOrderAccess(await currentUser());
  const parsed = parseOrderForm(Object.fromEntries(ORDER_FORM_FIELDS.map((key) => [key, text(key)])), { withCustomer: full });
  if (!parsed.ok) return { fieldErrors: parsed.fieldErrors, error: 'Check the highlighted fields.' };

  const original = await readPhoto(formData.get('photoOriginal'));
  const edited = await readPhoto(formData.get('photoEdited'));
  if (typeof original === 'string') return { error: original };
  if (typeof edited === 'string') return { error: edited };
  // One file alone is both the original and the edited copy.
  const pair = original || edited ? { original: (original ?? edited) as Photo, edited: (edited ?? original) as Photo } : null;

  const id = text('id').trim();
  const values = parsed.values;

  try {
    const user = await requireActingUser();
    await prisma.$transaction(async (tx) => {
      const before = id ? await tx.chromiaOrder.findUnique({ where: { id } }) : null;
      if (id && !before) throw new Error('This order no longer exists. Reload the page.');
      if (!full) {
        // Not the operator's to set or see: kept as the order has them.
        values.customerName = before?.customerName ?? '';
        values.requestedBy = before?.requestedBy ?? null;
      }

      const orderId = before?.id ?? randomUUID();
      let photoIds: { photoOriginalId: string; photoEditedId: string } | null = null;
      if (pair) {
        const store = async (photo: Photo, kind: 'original' | 'edited') => {
          const photoId = `eph${randomUUID().replace(/-/g, '')}`;
          await tx.entryPhoto.create({
            data: {
              id: photoId,
              model: ORDER_PHOTO_MODEL,
              recordId: orderId,
              filename: `order-${kind}.${photo.ext}`,
              mime: photo.mime,
              data: photo.bytes,
              takenBy: user.employeeCode,
            },
          });
          return photoId;
        };
        photoIds = { photoOriginalId: await store(pair.original, 'original'), photoEditedId: await store(pair.edited, 'edited') };
        // The photo it replaces.
        const old = [before?.photoOriginalId, before?.photoEditedId].filter((v): v is string => Boolean(v));
        if (old.length) await tx.entryPhoto.deleteMany({ where: { id: { in: old }, model: ORDER_PHOTO_MODEL } });
      }

      if (before) {
        await tx.chromiaOrder.update({ where: { id: orderId }, data: { ...values, ...photoIds, updatedById: user.id } });
      } else {
        await tx.chromiaOrder.create({ data: { id: orderId, ...values, ...photoIds, createdById: user.id, updatedById: user.id } });
      }
      await tx.chromiaAuditLog.create({
        data: {
          entity: 'Order',
          entityId: orderId,
          action: before ? AuditAction.UPDATE : AuditAction.CREATE,
          userId: user.id,
          changes: { customerName: values.customerName, delivered: values.actualDeliveryDate !== null, newPhoto: pair !== null },
        },
      });
    });
    log.info({ customer: values.customerName, edit: Boolean(id) }, 'Order saved');
  } catch (error) {
    if (isAppError(error) || error instanceof Error) return { error: error.message };
    throw error;
  }

  revalidatePath(APP_ROUTES.orders);
  if (id) revalidatePath(`${APP_ROUTES.orders}/${id}`);
  return { savedAt: Date.now(), savedCustomer: full ? values.customerName : undefined };
}

export interface OrderDeleteState {
  error?: string;
  deletedAt?: number;
}

/**
 * Delete an order for good (19 Nov 2026): the order, its Reference Photo pair,
 * and nothing else (no slab record reads an order). A DELETE row in the audit
 * log keeps what it was.
 *
 * Every Chromia login but the Chromia Operator (chromiaHasFullOrderAccess) —
 * asked HERE, so a request sent without the button is refused the same way.
 */
export async function deleteOrderAction(_previous: OrderDeleteState, formData: FormData): Promise<OrderDeleteState> {
  const id = String(formData.get('id') ?? '').trim();
  if (!id) return { error: 'This order could not be identified. Reload Orders and try again.' };
  try {
    const user = await requireActingUser();
    if (!chromiaHasFullOrderAccess(await currentUser())) {
      throw new AppError(ErrorCode.FORBIDDEN, 'The Chromia Operator login cannot delete an order. Ask the In-Charge or an admin.', 403);
    }
    await prisma.$transaction(async (tx) => {
      const order = await tx.chromiaOrder.findUnique({ where: { id } });
      if (!order) throw new AppError(ErrorCode.NOT_FOUND, 'This order has already been deleted. Reload Orders.', 404);
      await tx.entryPhoto.deleteMany({ where: { model: ORDER_PHOTO_MODEL, recordId: id } });
      await tx.chromiaOrder.delete({ where: { id } });
      await tx.chromiaAuditLog.create({
        data: {
          entity: 'Order',
          entityId: id,
          action: AuditAction.DELETE,
          userId: user.id,
          changes: {
            customerName: order.customerName,
            designName: order.designName,
            quantity: order.quantity,
            delivered: order.actualDeliveryDate !== null,
          },
        },
      });
    });
    log.warn({ id }, 'Order deleted');
  } catch (error) {
    if (isAppError(error) || error instanceof Error) return { error: error.message };
    throw error;
  }
  revalidatePath(APP_ROUTES.orders);
  revalidatePath(`${APP_ROUTES.orders}/${id}`);
  return { deletedAt: Date.now() };
}
