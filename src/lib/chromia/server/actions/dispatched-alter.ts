'use server';

import { revalidatePath } from 'next/cache';

import { ALTER_DESTINATIONS, type AlterDestination } from '@/lib/chromia/constants/alter-destinations';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { stockyardToday } from '@/lib/chromia/constants/stock-outcomes';
import { requireActingUser } from '@/lib/chromia/current-user';
import { isAppError } from '@/lib/chromia/errors';
import { registerDay } from '@/lib/chromia/operator-register';
import { alterFromDispatched } from '@/lib/chromia/server/services/dispatched-alter-service';

export interface AlterFromDispatchedState {
  error?: string;
  movedSlabNo?: string;
  movedAt?: number;
}

/** Every page a slab moved out of Dispatched shows on, or leaves. */
async function revalidateAlteredViews() {
  for (const path of [
    APP_ROUTES.dispatch,
    APP_ROUTES.stockyard,
    APP_ROUTES.recalibrations,
    APP_ROUTES.recalibrationTracking,
    APP_ROUTES.slabs,
    APP_ROUTES.dashboard,
    APP_ROUTES.operator,
    APP_ROUTES.reports,
    APP_ROUTES.downloads,
  ]) {
    revalidatePath(path);
  }
}

/**
 * Alter From Dispatched — one row's destination and date (change 12, 8 Nov
 * 2026). Checked here, then moved by alterFromDispatched in one transaction;
 * the row leaves the Dispatched table once this returns.
 */
export async function alterFromDispatchedAction(
  _previous: AlterFromDispatchedState,
  formData: FormData,
): Promise<AlterFromDispatchedState> {
  const get = (key: string) => {
    const value = formData.get(key);
    return typeof value === 'string' ? value.trim() : '';
  };
  const slabId = get('slabId');
  const destination = get('destination') as AlterDestination;
  const day = get('date');

  if (!slabId) return { error: 'Pick a slab from the list.' };
  if (!ALTER_DESTINATIONS.includes(destination)) return { error: 'Choose In Stock or Recalibration.' };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(day) ? registerDay(day) : null;
  if (!date) return { error: 'Choose the date of the move.' };
  if (day > stockyardToday()) return { error: 'The date cannot be in the future.' };

  let slabNo: string;
  try {
    const user = await requireActingUser();
    slabNo = (await alterFromDispatched({ slabId, destination, date }, user.id)).slabNo;
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    if (error instanceof Error) return { error: error.message };
    throw error;
  }

  await revalidateAlteredViews();
  return { movedSlabNo: slabNo, movedAt: Date.now() };
}
