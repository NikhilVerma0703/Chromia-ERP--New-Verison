/** Application-wide constants. */

/**
 * Every Chromia screen, re-rooted under /chromia when the module was mounted
 * inside the ERP. Nothing in the module hardcodes a path — it reads it here —
 * so this object is the single place the mount point is written down.
 */
export const APP_ROUTES = {
  home: '/chromia',
  dashboard: '/chromia/dashboard',
  operator: '/chromia/operator',
  slabs: '/chromia/slabs',
  /**
   * Where a slab number opens for grading.
   *
   * It used to be a page of its own, /chromia/slabs/new. QC now happens on the
   * operator's own screen, below the entry fields, so this points there with
   * the slab in the query — one constant, so every table's slab link followed
   * without being touched. The old path still exists and redirects here.
   */
  slabIntake: '/chromia/operator',
  stockyard: '/chromia/stockyard',
  dispatch: '/chromia/dispatch',
  /** Approved Slabs — slabs sent from the Stockyard as Approved (27 Oct 2026). */
  approved: '/chromia/approved',
  recalibrations: '/chromia/recalibrations',
  recalibrationTracking: '/chromia/recalibration-tracking',
  import: '/chromia/import',
  reports: '/chromia/reports',
  downloads: '/chromia/downloads',
  /** The attendance register, shared with the Robo line — see
   *  lib/attendance/server.ts for why there is one of it and two ways in. */
  attendance: '/chromia/attendance',
} as const;

export const API_ROUTES = {
  exports: '/api/chromia/exports',
  /** One saved slab photo: `${slabPhoto}/<photo id>`. */
  slabPhoto: '/api/chromia/slab-photo',
} as const;

export const PAGINATION = {
  defaultPage: 1,
  defaultPageSize: 25,
  maxPageSize: 200,
} as const;
