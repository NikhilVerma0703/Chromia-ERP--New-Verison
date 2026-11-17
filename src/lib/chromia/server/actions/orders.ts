'use server';

import { randomUUID } from 'node:crypto';

import { ChromiaAuditAction as AuditAction } from '@prisma/client';
import { revalidatePath } from 'next/cache';

import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { requireActingUser } from '@/lib/chromia/current-user';
import { prisma } from '@/lib/chromia/db';
import { isAppError } from '@/lib/chromia/errors';
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
 */
export async function saveOrderAction(_previous: OrderFormState, formData: FormData): Promise<OrderFormState> {
  const text = (key: string) => {
    const value = formData.get(key);
    return typeof value === 'string' ? value : '';
  };
  const parsed = parseOrderForm(Object.fromEntries(ORDER_FORM_FIELDS.map((key) => [key, text(key)])));
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
  return { savedAt: Date.now(), savedCustomer: values.customerName };
}
