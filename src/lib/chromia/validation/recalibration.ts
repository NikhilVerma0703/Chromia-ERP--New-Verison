import { z } from 'zod';

const optionalText = z
  .string()
  .trim()
  .max(1000)
  .optional()
  .transform((value) => (value === '' ? undefined : value));

const optionalId = z
  .string()
  .optional()
  .transform((value) => (value === '' ? undefined : value));

const optionalDate = z
  .string()
  .optional()
  .transform((value) => (value === '' || value === undefined ? undefined : value))
  .pipe(z.coerce.date().optional());

const optionalDecimal = z
  .union([z.string(), z.number()])
  .optional()
  .transform((value) => {
    if (value === undefined || value === '') return undefined;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  })
  .refine((value) => value === undefined || value > 0, 'Must be greater than zero');

/** Issue the slab out to the recalibration facility. */
export const sendForRecalibrationSchema = z.object({
  slabId: z.string().uuid(),
  reason: z.string().trim().min(1, 'Enter a recalibrate reason').max(120),
  sentDate: optionalDate,
  expectedReturnDate: optionalDate,
  facilityName: optionalText,
  gatePassNo: optionalText,
  transporter: optionalText,
  vehicleNo: optionalText,
  conditionOnSend: optionalText,
  thicknessBeforeMm: optionalDecimal,
  reasonNotes: optionalText,
});

/** Book the slab back in after the upper surface has been removed. */
export const receiveFromRecalibrationSchema = z.object({
  recalibrationId: z.string().uuid(),
  receivedDate: optionalDate,
  thicknessAfterMm: optionalDecimal,
  conditionOnReturn: optionalText,
  workAccepted: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .optional()
    .transform((value) => (value === undefined ? true : value === true || value === 'true')),
  locationId: optionalId,
  notes: optionalText,
});

/** Restart the whole Chromia process — opens the next cycle. */
export const restartAfterRecalibrationSchema = z.object({
  recalibrationId: z.string().uuid(),
  locationId: optionalId,
});
