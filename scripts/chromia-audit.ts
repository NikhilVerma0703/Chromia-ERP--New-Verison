/**
 * The Chromia consistency audit, against the database in .env — READ-ONLY.
 *
 *   npm run audit:chromia
 *
 * Every KPI against the list it stands for, every page against the others,
 * and every slab's status against its records (src/lib/chromia/server/audit/
 * consistency.ts). Exits 1 if any check fails.
 */
import { auditConsistency } from '@/lib/chromia/server/audit/consistency';
import { prisma } from '@/lib/chromia/db';

async function main() {
  const checks = await auditConsistency();
  const width = Math.max(...checks.map((c) => c.check.length));
  for (const c of checks) {
    console.log(`${c.ok ? 'ok  ' : 'FAIL'}  ${c.check.padEnd(width)}  expected ${c.expected}, got ${c.actual}`);
  }
  const failed = checks.filter((c) => !c.ok).length;
  console.log(failed === 0 ? `\nAll ${checks.length} checks pass.` : `\n${failed} of ${checks.length} checks FAILED.`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
