import { PrismaClient } from "@prisma/client";

/**
 * A single shared Prisma client. In dev, Next.js hot-reload would otherwise
 * spawn a new client (and DB connection) on every reload, so we stash it on
 * globalThis and reuse it.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
