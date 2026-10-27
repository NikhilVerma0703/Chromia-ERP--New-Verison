import type { Metadata } from 'next';

import { Card, EmptyState, PageHeader, Section } from '@/components/chromia/ui';
import { chromiaCanManage } from '@/lib/chromia/access';
import { actorNames } from '@/lib/chromia/actors';
import { prisma } from '@/lib/chromia/db';
import { IMPORT_MAX_SECONDS, wasCutOff } from '@/lib/chromia/import/outcome';
import { importDeleteCounts } from '@/lib/chromia/server/services/import-service';
import { table } from '@/lib/chromia/ui';
import { PLANT_TIME_ZONE } from '@/lib/chromia/plant-time';
import { requirePageUser } from '@/lib/pageUser';

import { DeleteImportButton } from './delete-import-button';
import { ImportForm } from './import-form';

export const metadata: Metadata = { title: 'Import' };
export const dynamic = 'force-dynamic';
/*
 * The import runs as this page's server action, so this is its deadline (the
 * code review of 20 Oct 2026, CHR-7: there was none, and a monthly register
 * could be cut off part-way on the platform's default). The literal is the
 * same figure as IMPORT_MAX_SECONDS — Next.js reads it from the source, so it
 * cannot be the constant; tests/chromiaImportRuns.test.ts holds the two
 * together.
 */
export const maxDuration = 120;

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit', timeZone: PLANT_TIME_ZONE, });

export default async function ImportPage() {
  // Signed in, or no further, on every visit: the module layout's gate is
  // not run again when the browser moves between this module's pages
  // (requirePageUser in lib/pageUser.ts says why).
  const user = await requirePageUser();
  /*
   * Importing a register and deleting an import are an admin's (the owner's
   * decision on CHR-4 of the code review of 20 Oct 2026): one writes a month of
   * slabs, the other removes every slab a file brought in, and both were open
   * to every Chromia login. The actions refuse anyone else
   * (requireChromiaAdmin); this page, by the same rule, shows the form and the
   * Delete buttons only to an admin. Everyone else still sees what was
   * imported, when and by whom.
   */
  const canManage = chromiaCanManage(user);
  const history = await prisma.chromiaImportBatch.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  // Who ran it: an ERP user id on the row, resolved to a name here because the
  // chromia_* tables hold no foreign key into users. See lib/chromia/actors.ts.
  // And, for the admin who can delete, what a delete of each would do now:
  // the slabs still in the ERP and how many of those would go (CHR-2).
  const [importers, deleteCounts] = await Promise.all([
    actorNames(history.map((run) => run.importedById)),
    canManage ? importDeleteCounts(history.map((run) => run.id)) : Promise.resolve(null),
  ]);
  const now = new Date();

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Import production register" />

      {canManage ? (
        <ImportForm />
      ) : (
        <Card>
          <p className="text-muted text-sm">
            Importing a production register, and deleting an import, are done by an admin. The
            files imported so far are listed below.
          </p>
        </Card>
      )}

      <Section title="Previous imports" className="mt-8">
        {history.length === 0 ? (
          <EmptyState>Nothing imported yet.</EmptyState>
        ) : (
          <div className={table.wrapper}>
            <table className={table.root}>
              <thead className={table.head}>
                <tr>
                  <th className={table.th}>File</th>
                  <th className={table.th}>Period</th>
                  <th className={table.th}>Status</th>
                  <th className={table.th}>Rows</th>
                  <th className={table.th}>Imported</th>
                  <th className={table.th}>Skipped</th>
                  <th className={table.th}>Failed</th>
                  <th className={table.th}>When</th>
                  {canManage ? <th className={`${table.th} text-right`}>Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {history.map((run) => (
                  <tr key={run.id} className={table.row}>
                    <td className={`${table.td} font-medium`}>{run.sourceFile}</td>
                    <td className={table.tdMuted}>{run.periodLabel ?? '—'}</td>
                    <td className={table.tdMuted}>
                      {/* A run still PROCESSING long after the longest an import
                          can take was cut off part-way (CHR-7). Importing the
                          same file again finishes it. */}
                      {wasCutOff(run, now) ? (
                        <span
                          className="text-status-hold font-medium"
                          title={`Stopped part-way — it ran past the ${IMPORT_MAX_SECONDS}-second limit. Import the same file again: rows already in are left alone and the rest are added.`}
                        >
                          stopped part-way
                        </span>
                      ) : (
                        run.status.toLowerCase()
                      )}
                    </td>
                    <td className={table.tdNum}>{run.totalRows}</td>
                    <td className={table.tdNum}>{run.importedRows}</td>
                    <td className={table.tdNum}>{run.skippedRows}</td>
                    <td className={table.tdNum}>{run.failedRows}</td>
                    <td className={table.tdMuted}>
                      {dateFmt.format(run.createdAt)}
                      {run.importedById ? ` · ${importers.get(run.importedById) ?? 'Unknown'}` : ''}
                    </td>
                    {canManage ? (
                      <td className={`${table.td} text-right`}>
                        <DeleteImportButton
                          importBatchId={run.id}
                          fileName={run.sourceFile}
                          slabCount={deleteCounts?.get(run.id)?.slabs ?? 0}
                          removableCount={deleteCounts?.get(run.id)?.removable ?? 0}
                        />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
