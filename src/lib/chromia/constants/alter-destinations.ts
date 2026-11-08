/**
 * Alter From Dispatched (change 12, 8 Nov 2026): where a dispatched slab can
 * be moved back to. Kept apart from the service so the row form in the
 * browser carries these few strings and not the server code.
 */
export const ALTER_DESTINATIONS = ['IN_STOCK', 'RECALIBRATION'] as const;
export type AlterDestination = (typeof ALTER_DESTINATIONS)[number];

export const ALTER_DESTINATION_LABELS: Record<AlterDestination, string> = {
  IN_STOCK: 'In Stock',
  RECALIBRATION: 'Recalibration',
};
