import type { Metadata } from 'next';

import { EmptyState, PageHeader, Stat } from '@/components/chromia/ui';
import { dataTable, field, SectionCard } from '@/components/chromia/ui/form';
import { SlabActions } from '@/components/chromia/ui/delete-slab-button';
import { APP_ROUTES } from '@/lib/chromia/constants/app';
import { GradeBadge } from '@/components/chromia/ui/status';
import { stockedOnDay, stockyardToday, STOCK_OUTCOME_LABELS } from '@/lib/chromia/constants/stock-outcomes';
import { type RawSearchParams } from '@/lib/chromia/simple-filters';
import { manualRemark } from '@/lib/chromia/slab-remarks';
import { buildStockyardQuery, hasStockyardFilters, parseStockyardFilters } from '@/lib/chromia/stockyard-filters';
import { daysBetween } from '@/lib/chromia/utils/dates';
import {
  listSentFromStock,
  listStockedSlabs,
  listStockOutcomeRecords,
  stockyardFilterOptions,
  stockyardKpis,
} from '@/lib/chromia/server/repositories/stockyard-repository';
import { PLANT_TIME_ZONE } from '@/lib/chromia/plant-time';
import { requirePageUser } from '@/lib/pageUser';

import { FindASlab } from './find-a-slab';
import { StockOutcomeForm } from './stock-outcome-form';

export const metadata: Metadata = { title: 'Stockyard' };
export const dynamic = 'force-dynamic';

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric', timeZone: PLANT_TIME_ZONE, });

const { th, td, tdMuted, tdNum } = dataTable;

/** Sent From Stock names each outcome as where the slab now is. */
const SENT_OUTCOME_LABELS: Record<keyof typeof STOCK_OUTCOME_LABELS, string> = {
  DISPATCH: 'Dispatched',
  APPROVED: 'Approved',
  SAMPLE_CUTTING: 'Sample Cutting',
};

/** One row of In Stock Records, whichever way it was found. */
interface RecordRow {
  key: string;
  slabId: string;
  slabNo: string;
  receivedDate: Date;
  batchNo: string;
  baseMaterial: string;
  fileName: string | null;
  thicknessCm: number | null;
  grade: Parameters<typeof GradeBadge>[0]['grade'];
  remarks: string | null;
  stockDate: Date | null;
  /** Set for a slab that has left stock: where it went, and when. */
  sent: { outcome: keyof typeof STOCK_OUTCOME_LABELS; on: Date | null } | null;
}

/**
 * Stockyard.
 *
 * A slab graded Stock at QC goes on the rack, and leaves it later by one of
 * three Stock Outcomes — Dispatch, Approved or Sample Cutting (sendFromStock).
 *
 * FOUR SECTIONS, IN THIS ORDER, AND NO OTHERS (27 Oct 2026; Sent From Stock
 * added 8 Nov 2026, change 11):
 *
 *   Dashboard         four figures for the whole yard, never filtered — Current
 *                     Stock Available (the In Stock list's own count), and the
 *                     totals sent by each outcome (Total Stock Slabs removed,
 *                     7 Nov 2026, change 10);
 *   Find a Slab       production date, batch, slab, material, design and Stock
 *                     Outcome, alone or together (lib/chromia/stockyard-filters);
 *   In Stock Records  the slabs on the rack, each with its Stock Outcome form —
 *                     or, when a Stock Outcome is searched for, the slabs that
 *                     left the rack that way, read-only, with the date;
 *   Sent From Stock   every slab that left the rack by Dispatch, Approved or
 *                     Sample Cutting, each once, with Edit and Delete.
 *
 * The old Dispatched from stock log is gone: Find a Slab with Stock Outcome =
 * Dispatched is the same list, and the other two outcomes have one as well.
 */
export default async function StockyardPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requirePageUser();
  const raw = await searchParams;
  const filters = parseStockyardFilters(raw);
  // Sent From Stock's own Slab Number search (change 11) — apart from Find a Slab.
  const sentSlabNo = (Array.isArray(raw.sentSlabNo) ? raw.sentSlabNo[0] : raw.sentSlabNo ?? '').trim().slice(0, 80);
  const filtered = hasStockyardFilters(filters);

  const [kpis, options, stocked, sent, sentFromStock] = await Promise.all([
    stockyardKpis(),
    stockyardFilterOptions(),
    filters.outcome ? Promise.resolve([]) : listStockedSlabs(filtered ? filters : undefined),
    filters.outcome ? listStockOutcomeRecords(filters.outcome, filters) : Promise.resolve([]),
    listSentFromStock(sentSlabNo),
  ]);

  const now = new Date();
  // Today in the plant (IST) — the latest date a row's calendar offers.
  const today = stockyardToday(now);

  const rows: RecordRow[] = filters.outcome
    ? sent.map((entry) => ({
        key: entry.id,
        slabId: entry.slabId,
        slabNo: entry.slabNo,
        receivedDate: entry.receivedDate,
        batchNo: entry.batch.batchNo,
        baseMaterial: entry.baseMaterial.name,
        fileName: entry.plannedDesign?.fileName ?? entry.plannedDesign?.name ?? null,
        thicknessCm: entry.thicknessCm,
        grade: entry.currentGrade,
        remarks: manualRemark(entry.remarks, entry.currentDisposition),
        stockDate: entry.stockDate,
        sent: { outcome: entry.releaseOutcome ?? filters.outcome!, on: entry.releasedAt },
      }))
    : stocked.map((slab) => ({
        key: slab.id,
        slabId: slab.id,
        slabNo: slab.slabNo,
        receivedDate: slab.receivedDate,
        batchNo: slab.batch.batchNo,
        baseMaterial: slab.baseMaterial.name,
        fileName: slab.plannedDesign?.fileName ?? slab.plannedDesign?.name ?? null,
        thicknessCm: slab.thicknessCm,
        grade: slab.currentGrade,
        remarks: manualRemark(slab.remarks, slab.currentDisposition),
        stockDate: slab.stockDate,
        sent: null,
      }));

  const noun = (n: number) => `${n} ${n === 1 ? 'slab' : 'slabs'}`;
  const recordsWhat = filters.outcome
    ? `sent as ${STOCK_OUTCOME_LABELS[filters.outcome]}`
    : 'in stock';

  return (
    <>
      <PageHeader
        title="Stockyard"
        description={`${noun(kpis.currentStock)} in stock`}
      />

      {/* ------------------------------------------------------ Dashboard --- */}
      {/* Four KPIs (7 Nov 2026, change 10): Total Stock Slabs is gone. Current
          Stock Available is the In Stock Records table's own count. */}
      <div className="mb-6">
        <SectionCard title="Dashboard" accent="brand" padded>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Current Stock Available" value={kpis.currentStock} hint="On the racks now" tone="stock" />
            <Stat label="Total Dispatched Slabs" value={kpis.dispatched} tone="done" />
            <Stat label="Total Approved Slabs" value={kpis.approved} tone="approved" />
            <Stat label="Total Sample Cutting Slabs" value={kpis.sampleCutting} tone="hold" />
          </div>
        </SectionCard>
      </div>

      {/* ---------------------------------------------------- Find a Slab --- */}
      <div className="mb-6">
        <FindASlab
          key={buildStockyardQuery(filters)}
          options={options}
          values={{
            productionDate: filters.productionDate ? filters.productionDate.toISOString().slice(0, 10) : '',
            batchNo: filters.batchNo,
            slabNo: filters.slabNo,
            baseMaterial: filters.baseMaterial,
            fileName: filters.fileName,
            outcome: filters.outcome ?? '',
          }}
        />
      </div>

      {/* ----------------------------------------------- In Stock Records --- */}
      <SectionCard
        title="In Stock Records"
        accent="active"
        padded={rows.length === 0}
        actions={
          <span className="border-line surface text-muted rounded-full border px-3 py-1 text-xs font-medium">
            <span className="text-foreground font-semibold tabular-nums">{rows.length}</span>{' '}
            {rows.length === 1 ? 'slab' : 'slabs'} {recordsWhat}
            {filtered ? ' · filtered' : ''}
          </span>
        }
      >
        {rows.length === 0 ? (
          <EmptyState>
            {filtered
              ? `No slab ${recordsWhat} matches these filters.`
              : 'Nothing is on the racks right now.'}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className={dataTable.root}>
              <thead className={dataTable.head}>
                <tr>
                  {/* Production Date, not a separate Stock Date: a slab marked
                      Stock at QC is stocked on its production date, so the two
                      are the same day and the register's date is the one shown. */}
                  <th className={th}>Production Date</th>
                  <th className={th}>Batch Number</th>
                  <th className={th}>Slab Number</th>
                  <th className={th}>Base Material / Slab Name</th>
                  <th className={th}>File Name / Planned Design</th>
                  <th className={`${th} text-right`}>Thickness (cm)</th>
                  <th className={th}>Grade</th>
                  <th className={th}>Slab Remarks</th>
                  <th className={`${th} text-right`}>Days in Stock</th>
                  <th className={`${th} text-right`}>Stock Outcome</th>
                  <th className={`${th} text-right`}>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className={dataTable.row}>
                    <td className={`${td} font-medium whitespace-nowrap`}>{dateFmt.format(row.receivedDate)}</td>
                    <td className={`${tdMuted} font-mono`}>{row.batchNo}</td>
                    <td className={`${td} font-mono`}>{row.slabNo}</td>
                    <td className={td}>{row.baseMaterial}</td>
                    <td className={tdMuted}>{row.fileName ?? '—'}</td>
                    <td className={`${tdNum} text-right`}>{row.thicknessCm === null ? '—' : row.thicknessCm}</td>
                    <td className={td}>
                      <GradeBadge grade={row.grade} />
                    </td>
                    <td className={`${td} max-w-[16rem]`}>{row.remarks ?? <span className="text-muted">—</span>}</td>
                    <td className={`${tdNum} text-right`}>
                      {/* On the rack: to today. Sent on: the days it was held. */}
                      {row.stockDate === null
                        ? '—'
                        : daysBetween(row.stockDate, row.sent ? (row.sent.on ?? now) : now)}
                    </td>
                    <td className={`${td} text-right`}>
                      {row.sent ? (
                        <span className="text-sm whitespace-nowrap">
                          <span className="font-medium">{STOCK_OUTCOME_LABELS[row.sent.outcome]}</span>
                          {row.sent.on ? <span className="text-muted"> · {dateFmt.format(row.sent.on)}</span> : null}
                        </span>
                      ) : (
                        <StockOutcomeForm
                          slabId={row.slabId}
                          slabNo={row.slabNo}
                          today={today}
                          stockedOn={stockedOnDay(row.stockDate)}
                        />
                      )}
                    </td>
                    <td className={`${td} text-right`}>
                      <SlabActions editHref={`${APP_ROUTES.stockyard}/${row.slabId}/edit`} slabId={row.slabId} slabNo={row.slabNo} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* ----------------------------------------------- Sent From Stock --- */}
      {/* Change 11 (8 Nov 2026): every slab that left the rack by a Stock
          Outcome, each once (listSentFromStock) — never filtered. The In Stock
          Records columns, with Stock Outcome after Grade and no Days in Stock;
          Edit opens the Stockyard Edit form, Delete is the global delete. */}
      <div id="sent-from-stock" className="mt-6 scroll-mt-6">
        <SectionCard
          title="Sent From Stock"
          accent="brand"
          padded={false}
          actions={
            <span className="border-line surface text-muted rounded-full border px-3 py-1 text-xs font-medium">
              <span className="text-foreground font-semibold tabular-nums">{sentFromStock.length}</span>{' '}
              {sentFromStock.length === 1 ? 'slab' : 'slabs'} sent from stock
              {sentSlabNo ? ' · filtered' : ''}
            </span>
          }
        >
          {/* Slab Number search: a GET form that keeps Find a Slab's filters. */}
          <form
            method="get"
            action={`${APP_ROUTES.stockyard}#sent-from-stock`}
            className="border-line flex flex-wrap items-end gap-3 border-b px-4 py-3"
          >
            {[...new URLSearchParams(buildStockyardQuery(filters))].map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            <label htmlFor="sentSlabNo" className="flex flex-col gap-1 text-sm font-medium">
              Slab Number
              <input
                id="sentSlabNo"
                name="sentSlabNo"
                type="search"
                defaultValue={sentSlabNo}
                placeholder="Search slab number"
                maxLength={80}
                className={`${field} w-56`}
              />
            </label>
            <button
              type="submit"
              className="bg-brand-600 hover:bg-brand-700 inline-flex h-11 items-center justify-center rounded-lg px-5 text-sm font-semibold text-white"
            >
              Search
            </button>
            {sentSlabNo ? (
              <a
                href={`${APP_ROUTES.stockyard}${buildStockyardQuery(filters) ? `?${buildStockyardQuery(filters)}` : ''}#sent-from-stock`}
                className="border-line surface hover:border-line-strong inline-flex h-11 items-center justify-center rounded-lg border px-4 text-sm font-medium"
              >
                Clear
              </a>
            ) : null}
          </form>
          {sentFromStock.length === 0 ? (
            <EmptyState>
              {sentSlabNo ? `No slab sent from stock matches slab number “${sentSlabNo}”.` : 'No slab has been sent from stock yet.'}
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className={dataTable.root}>
                <thead className={dataTable.head}>
                  <tr>
                    <th className={th}>Production Date</th>
                    <th className={th}>Batch Number</th>
                    <th className={th}>Slab Number</th>
                    <th className={th}>Base Material / Slab Name</th>
                    <th className={th}>File Name / Planned Design</th>
                    <th className={`${th} text-right`}>Thickness (cm)</th>
                    <th className={th}>Grade</th>
                    <th className={th}>Stock Outcome</th>
                    <th className={th}>Slab Remarks</th>
                    <th className={`${th} text-right`}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sentFromStock.map((slab) => (
                    <tr key={slab.id} className={dataTable.row}>
                      <td className={`${td} font-medium whitespace-nowrap`}>{dateFmt.format(slab.receivedDate)}</td>
                      <td className={`${tdMuted} font-mono`}>{slab.batch.batchNo}</td>
                      <td className={`${td} font-mono`}>{slab.slabNo}</td>
                      <td className={td}>{slab.baseMaterial.name}</td>
                      <td className={tdMuted}>{slab.plannedDesign?.fileName ?? slab.plannedDesign?.name ?? '—'}</td>
                      <td className={`${tdNum} text-right`}>{slab.thicknessCm === null ? '—' : slab.thicknessCm}</td>
                      <td className={td}>
                        <GradeBadge grade={slab.currentGrade} />
                      </td>
                      <td className={td}>
                        <span className="text-sm whitespace-nowrap">
                          <span className="font-medium">{SENT_OUTCOME_LABELS[slab.outcome]}</span>
                          <span className="text-muted"> · {dateFmt.format(slab.sentOn)}</span>
                        </span>
                      </td>
                      <td className={`${td} max-w-[16rem]`}>
                        {manualRemark(slab.remarks, slab.currentDisposition) ?? <span className="text-muted">—</span>}
                      </td>
                      <td className={`${td} text-right`}>
                        <SlabActions editHref={`${APP_ROUTES.stockyard}/${slab.id}/edit?from=sent`} slabId={slab.id} slabNo={slab.slabNo} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>
    </>
  );
}
