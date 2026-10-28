import { DISPOSITION_LABELS } from './constants/process-stages.ts';
import type { ColumnGroup, ExportColumn } from './exports.ts';
import { formatPlantReportDay, PLANT_TIME_ZONE } from './plant-time.ts';

/**
 * THE DOWNLOAD REPORTS (28 Oct 2026, change 12) — one definition per report:
 * its columns, the value of every cell, the date it is filtered and sorted
 * on, and its S.No. The Downloads page's preview and the Excel file are both
 * built from buildReport, so a file cannot hold a column, an order or a
 * number the preview does not show.
 *
 *   Complete Production   Slab Records' columns, in its order and its words
 *   By Slab Status        In Stock · Dispatched · Approved · Sample Cutting ·
 *                         Recalibration
 *
 * Every report is OLDEST FIRST on its own date, and S.No. runs 1…n over the
 * filtered, sorted rows — counted here, never a database id or the register's
 * serial number, so it restarts at 1 with every range and every report.
 *
 * Plain TypeScript (no Prisma) so the node:test suites and the client form
 * both read it; export-repository.ts turns the database into ReportRecords.
 */

export const STATUS_REPORTS = ['STOCK', 'DISPATCH', 'APPROVED', 'SAMPLE_CUTTING', 'RECALIBRATION'] as const;
export type StatusReport = (typeof STATUS_REPORTS)[number];
export type ReportKind = 'PRODUCTION' | StatusReport;

export const REPORT_LABELS: Record<ReportKind, string> = {
  PRODUCTION: 'Complete Production',
  STOCK: 'In Stock (Current Stock)',
  DISPATCH: 'Dispatched',
  APPROVED: 'Approved',
  SAMPLE_CUTTING: 'Sample Cutting',
  RECALIBRATION: 'Recalibration',
};

/** The date each report is filtered on and sorted by, oldest first. */
export const REPORT_DATE_LABELS: Record<ReportKind, string> = {
  PRODUCTION: 'Production Date',
  STOCK: 'Production Date',
  DISPATCH: 'Dispatch Date',
  APPROVED: 'Approved Date',
  SAMPLE_CUTTING: 'Sample Cutting Date',
  RECALIBRATION: 'Production Date',
};

/** One slab (one row) of a report, as the database says it. */
export interface ReportRecord {
  /** The report's own date: what it is filtered and sorted on. */
  eventDate: Date;
  productionDate: Date;
  createdAt: Date;
  batchNo: string;
  slabNo: string;
  baseMaterial: string;
  design: string | null;
  thicknessCm: number | null;
  inTime: Date | null;
  grade: string | null;
  /** QC Outcome / Slab Outcome — the slab's current disposition. */
  disposition: string | null;
  /** Current Status, worked out by the page this report mirrors. */
  currentStatus: string;
  /** Slab Remarks as that page shows them. */
  remarks: string | null;
  // Recalibration only.
  reason?: string | null;
  attemptNumber?: number | null;
  sentDate?: Date | null;
  receivedDate?: Date | null;
}

type Cell = string | number;

interface ReportColumn extends ExportColumn {
  value: (record: ReportRecord) => Cell;
}

const DASH = '—';
const day = (date: Date | null | undefined) => (date ? formatPlantReportDay(date) : DASH);
const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];

/** Slab Records' In-time: "27 Oct, 14:00" in plant time. Slab Records reads this very formatter. */
const IN_TIME = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: PLANT_TIME_ZONE,
});
export const formatSlabInTime = (date: Date | null | undefined): string => (date ? IN_TIME.format(date) : DASH);

const col = (label: string, group: ColumnGroup, width: number, value: ReportColumn['value']): ReportColumn => ({ label, group, width, value });

const C = {
  productionDate: col('Production Date', 'identity', 16, (r) => day(r.productionDate)),
  batchNo: col('Batch No.', 'identity', 14, (r) => r.batchNo),
  slabNo: col('Slab No.', 'identity', 14, (r) => r.slabNo),
  baseMaterial: col('Base Material / Slab Name', 'product', 24, (r) => r.baseMaterial),
  design: col('File Name / Planned Design', 'product', 26, (r) => r.design ?? DASH),
  thickness: col('Thickness (cm)', 'product', 14, (r) => (r.thicknessCm === null ? DASH : r.thicknessCm)),
  inTime: col('In-Time', 'timing', 16, (r) => formatSlabInTime(r.inTime)),
  grade: col('Grade', 'state', 10, (r) => (r.grade ? `Grade ${r.grade}` : DASH)),
  qcOutcome: col('QC Outcome', 'state', 18, (r) => (r.disposition ? (DISPOSITION_LABELS as Record<string, string>)[r.disposition] ?? r.disposition : DASH)),
  slabOutcome: col('Slab Outcome', 'state', 18, (r) =>
    r.disposition ? (DISPOSITION_LABELS as Record<string, string>)[r.disposition] ?? r.disposition : 'In Processing',
  ),
  currentStatus: col('Current Status', 'state', 30, (r) => r.currentStatus),
  remarks: col('Slab Remarks', 'state', 30, (r) => r.remarks ?? DASH),
  reason: col('Reason for Recalibration', 'outcome', 26, (r) => r.reason ?? DASH),
  attempt: col('Attempt Number', 'outcome', 14, (r) => (r.attemptNumber ? (ORDINALS[r.attemptNumber - 1] ?? `${r.attemptNumber}th`) : DASH)),
  sentDate: col('Sent Date', 'outcome', 16, (r) => day(r.sentDate)),
  receivedDate: col('Received Date', 'outcome', 16, (r) => day(r.receivedDate)),
  event: (label: string) => col(label, 'outcome', 18, (r) => day(r.eventDate)),
};

const SNO: ExportColumn = { label: 'S.No.', group: 'identity', width: 7 };

/** Every report's columns after S.No., in exactly the order asked for. */
export const REPORT_COLUMNS: Record<ReportKind, ReportColumn[]> = {
  // Slab Records' own columns (its Action column aside), in its order.
  PRODUCTION: [C.productionDate, C.batchNo, C.slabNo, C.baseMaterial, C.design, C.thickness, C.inTime, C.grade, C.qcOutcome, C.currentStatus, C.remarks],
  STOCK: [C.productionDate, C.batchNo, C.slabNo, C.baseMaterial, C.design, C.thickness, C.inTime, C.grade, C.qcOutcome, C.currentStatus, C.remarks],
  DISPATCH: [C.event('Dispatch Date'), C.productionDate, C.batchNo, C.slabNo, C.baseMaterial, C.design, C.thickness, C.grade, C.remarks],
  APPROVED: [C.event('Approved Date'), C.productionDate, C.batchNo, C.slabNo, C.baseMaterial, C.design, C.thickness, C.grade, C.remarks],
  SAMPLE_CUTTING: [C.event('Sample Cutting Date'), C.productionDate, C.batchNo, C.slabNo, C.baseMaterial, C.design, C.thickness, C.grade, C.remarks],
  // The Recalibration page's fourteen columns, in its order.
  RECALIBRATION: [
    C.productionDate, C.batchNo, C.slabNo, C.baseMaterial, C.design, C.thickness, C.grade, C.slabOutcome,
    C.reason, C.remarks, C.attempt, C.sentDate, C.receivedDate, C.currentStatus,
  ],
};

export interface BuiltReport {
  kind: ReportKind;
  columns: ExportColumn[];
  /** Cell values, S.No. first — the preview's cells and the workbook's, alike. */
  rows: Cell[][];
}

/**
 * Sort oldest first on the report's date (then production date, then the
 * order the slabs were entered, then slab number), and number the rows 1…n.
 */
export function buildReport(kind: ReportKind, records: readonly ReportRecord[]): BuiltReport {
  const columns = REPORT_COLUMNS[kind];
  const sorted = [...records].sort(
    (a, b) =>
      a.eventDate.getTime() - b.eventDate.getTime() ||
      a.productionDate.getTime() - b.productionDate.getTime() ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.slabNo.localeCompare(b.slabNo, undefined, { numeric: true }),
  );
  return {
    kind,
    columns: [SNO, ...columns.map(({ label, group, width }) => ({ label, group, width }))],
    rows: sorted.map((record, index) => [index + 1, ...columns.map((column) => column.value(record))]),
  };
}

export function isStatusReport(value: string): value is StatusReport {
  return (STATUS_REPORTS as readonly string[]).includes(value);
}
