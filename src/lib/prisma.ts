import { PrismaClient } from "@prisma/client";

// STANDALONE: the one Prisma client for the whole app.
//
// Pacific ERP's version wraps the client in its "view as" write guard (an
// admin viewing the ERP as another login may not save) and can route through
// Neon's pooled endpoint (DATABASE_URL_POOLED). Neither applies to a local,
// single-user app, so this is the plain singleton; every module still imports
// `prisma` from here exactly as it did.

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

// next dev keeps the client on globalThis across hot reloads, so it is not
// re-created (and the connection pool re-opened) on every edit.
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
