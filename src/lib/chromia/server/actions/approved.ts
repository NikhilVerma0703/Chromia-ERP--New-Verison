'use server';

import { randomUUID } from 'node:crypto';

import { revalidatePath } from 'next/cache';

import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { requireActingUser } from '@/lib/chromia/current-user';
import { prisma } from '@/lib/chromia/db';
import { createLogger } from '@/lib/chromia/logger';
import { loadApproval, SLAB_PHOTO_MODEL } from '@/lib/chromia/server/repositories/approved-repository';

const log = createLogger('approved');

export interface SlabPhotoFormState {
  error?: string;
  /** Set once the photo is stored — the page then returns to Approved Slabs. */
  savedAt?: number;
}

/** The photo formats a browser crops to, recognised by their first bytes. */
const KINDS: { mime: string; ext: string; magic: (b: Buffer) => boolean }[] = [
  { mime: 'image/jpeg', ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', ext: 'webp', magic: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
];

/** Upper bound for one cropped photo. The crop step re-encodes well under it. */
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Save the cropped photo of one approved slab (27 Oct 2026).
 *
 * Only a slab that left the Stockyard as Approved takes a photo here. The
 * file must really be an image — judged by its bytes, not by the name or type
 * the browser claims — and is stored in entry_photo against the slab's own id.
 * Nothing about the slab changes: no new slab, no edited field, no new status.
 * A second photo is added beside the first; the slab shows its latest.
 */
export async function saveApprovedSlabPhotoAction(
  _previous: SlabPhotoFormState,
  formData: FormData,
): Promise<SlabPhotoFormState> {
  const slabId = formData.get('slabId');
  const photo = formData.get('photo');

  if (typeof slabId !== 'string' || !slabId) return { error: 'This slab could not be identified. Open it again from Approved Slabs.' };
  if (!(photo instanceof File) || photo.size === 0) return { error: 'Take or choose a photo of the slab, crop it, then save.' };
  if (photo.size > MAX_BYTES) return { error: 'That photo is too large — crop it smaller and save again.' };

  const bytes = Buffer.from(await photo.arrayBuffer());
  const kind = KINDS.find((candidate) => candidate.magic(bytes));
  if (!kind) return { error: 'That file is not a photo (JPEG, PNG or WebP).' };

  try {
    const user = await requireActingUser();

    const slab = await prisma.chromiaSlab.findFirst({ where: { id: slabId, deletedAt: null }, select: { id: true, slabNo: true } });
    if (!slab) return { error: 'This slab no longer exists.' };
    if (!(await loadApproval(slab.id))) return { error: `Slab ${slab.slabNo} is not marked as Approved, so its photo is not taken here.` };

    await prisma.entryPhoto.create({
      data: {
        id: `eph${randomUUID().replace(/-/g, '')}`,
        model: SLAB_PHOTO_MODEL,
        recordId: slab.id,
        filename: `approved-${slab.slabNo}.${kind.ext}`.slice(0, 200),
        mime: kind.mime,
        data: bytes,
        takenBy: user.employeeCode,
      },
    });

    log.info({ slabNo: slab.slabNo, bytes: bytes.length }, 'Approved slab photo saved');
  } catch (error) {
    if (error instanceof Error) return { error: error.message };
    throw error;
  }

  revalidatePath(APP_ROUTES.approved);
  return { savedAt: Date.now() };
}
