import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// How long a writer waits for the lock before giving up.
//
// This system is deliberately multi-process — the worker, the dev server and
// any manual script all write the same SQLite file — and several of its
// passes hold a write transaction for a while: repair-descriptions commits
// 500 updates at once, rescore walks in batches of 2,000, embed-fill writes
// 256 vectors in one statement. Prisma's default of 5s is comfortably shorter
// than those, so a batch running while another process writes would raise
// SQLITE_BUSY and kill the script outright. No such failure has appeared in
// the logs yet; 30s is the cheap way to keep it that way.
//
// NOT lowering `synchronous` from FULL, which is the usual companion advice.
// With WAL it would be crash-safe (a power cut loses the last transactions
// but does not corrupt), and it would speed the batch passes up. The trade is
// wrong here: a lost transaction is a lost 27B judgment, ~60 seconds of GPU
// that cannot be reproduced by re-running anything, while the batch passes
// are rare. Durability is worth more than throughput when the data is
// expensive to make.
void prisma.$queryRawUnsafe("PRAGMA busy_timeout = 30000").catch(() => {
  // A failed PRAGMA leaves the 5s default, which is the status quo — never a
  // reason to stop the process from starting.
});
