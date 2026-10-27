/**
 * Chromia's database handle.
 *
 * The standalone module owned its own Prisma client (Prisma 7 + a node-postgres
 * driver adapter). Inside the ERP there is exactly one client for the whole
 * app — `src/lib/prisma.ts` — and every module shares it, the same way the Robo
 * module does. This file exists so the ported module code can keep importing
 * `@/lib/chromia/db` unchanged: it is the one seam where "the module's database"
 * becomes "the ERP's database".
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export { prisma };
export type { PrismaClient } from "@prisma/client";

/**
 * The transaction a caller has already opened, when there is one.
 *
 * ONE QC SAVE, ONE COMMIT (the code review of 20 Oct 2026, CHR-5). Saving QC
 * runs three or four services one after another — the intake (or the Edit
 * path's reset), the grade, the outcome record, the recalibration wait — and
 * each committed on its own. A Neon drop or a function timeout between two of
 * them left a slab no screen could finish: graded C → Recalibration with no
 * waiting trip, so the Recalibration page offered a trip that saveTrip refused,
 * Edit refused it as in recalibration and a fresh QC as already graded. Each of
 * those services now takes an optional `tx`, so the QC save hands them one
 * transaction and the whole save lands or none of it does. Every other caller
 * passes nothing and behaves exactly as before.
 */
export type ChromiaTx = Prisma.TransactionClient;

/** Where a read goes: the caller's transaction (`inTx ?? prisma`), or the app's client. */
export type ChromiaDb = typeof prisma | ChromiaTx;

/**
 * Run `work` in the caller's transaction when it passed one, or in a new one
 * of its own when it did not. An interactive transaction cannot open another,
 * so a service written as `withTransaction(tx, async (t) => …)` is atomic on
 * its own and atomic as one step of a caller's. Reads outside the write block
 * use `tx ?? prisma`, so inside a caller's transaction they see what it has
 * already written.
 */
export function withTransaction<T>(
  tx: ChromiaTx | undefined,
  work: (tx: ChromiaTx) => Promise<T>,
): Promise<T> {
  return tx ? work(tx) : prisma.$transaction(work);
}
