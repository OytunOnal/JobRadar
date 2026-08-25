import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ONE BOOTSTRAP FOR EVERY DB-BACKED SUITE.
//
// The temp-SQLite recipe — mkdtemp, point DATABASE_URL at it (forward slashes,
// or the Windows path never parses as a file: URL), push the schema, import
// the client only afterwards — existed as three verbatim copies that had
// already drifted once: one suite had no teardown at all, leaking a pushed
// database into %TEMP% per run and keeping the engine handle open past the
// last test. A bootstrap change now lands once, not three times minus the one
// somebody forgot.
//
// The caller still does its own DYNAMIC imports after calling this: the env
// has to be set before db.ts constructs its client, and a static import would
// hoist past us.
export function testDb(prefix: string): {
  dir: string;
  teardown: (prisma: { $disconnect(): Promise<void> }) => Promise<void>;
} {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  process.env.DATABASE_URL = `file:${join(dir, "test.db").replace(/\\/g, "/")}`;
  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    env: process.env,
    stdio: "pipe",
  });
  return {
    dir,
    async teardown(prisma) {
      // Disconnect first: on Windows an open engine handle makes the rm fail
      // with EBUSY rather than merely leak.
      await prisma.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
