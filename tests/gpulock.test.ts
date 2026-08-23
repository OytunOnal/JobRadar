import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each case gets its own lock file; the module reads the path per call.
function withLock<T>(fn: (path: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "jr-gpu-"));
  const path = join(dir, "gpu.lock");
  const prev = process.env.JOBRADAR_GPU_LOCK;
  process.env.JOBRADAR_GPU_LOCK = path;
  try { return fn(path); } finally {
    if (prev === undefined) delete process.env.JOBRADAR_GPU_LOCK;
    else process.env.JOBRADAR_GPU_LOCK = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

const { acquireGpu, releaseGpu, gpuHolder, gpuBusyMessage } = await import("../src/lib/gpu-lock");

test("acquire, then hold: the same process may re-acquire", () => {
  withLock(() => {
    assert.equal(acquireGpu("worker/embed"), true);
    assert.equal(acquireGpu("worker/judge"), true); // same pid, phase change
    assert.equal(gpuHolder()?.holder, "worker/judge");
    releaseGpu();
    assert.equal(gpuHolder(), null);
  });
});

test("another live process is refused, and told who holds it", () => {
  withLock((path) => {
    writeFileSync(path, JSON.stringify({
      holder: "worker/judge", pid: process.pid + 1,
      since: new Date().toISOString(), beat: Date.now(),
    }));
    assert.equal(acquireGpu("manual/embed"), false);
    assert.match(gpuBusyMessage() ?? "", /GPU meşgul.*worker\/judge/);
  });
});

test("a dead holder's lock is taken over, not waited on forever", () => {
  withLock((path) => {
    // A crashed process leaves the file behind; only the heartbeat says so.
    writeFileSync(path, JSON.stringify({
      holder: "worker/judge", pid: process.pid + 1,
      since: new Date(Date.now() - 3600_000).toISOString(), beat: Date.now() - 3600_000,
    }));
    assert.equal(gpuHolder(), null, "stale lock must not count as held");
    assert.equal(acquireGpu("worker/embed"), true);
    releaseGpu();
  });
});

test("a corrupt lock file blocks nothing", () => {
  withLock((path) => {
    writeFileSync(path, "{ not json");
    assert.equal(gpuHolder(), null);
    assert.equal(acquireGpu("worker/embed"), true);
    releaseGpu();
  });
});

test("releasing someone else's lock is a no-op", () => {
  withLock((path) => {
    writeFileSync(path, JSON.stringify({
      holder: "other", pid: process.pid + 1, since: new Date().toISOString(), beat: Date.now(),
    }));
    releaseGpu();
    assert.equal(gpuHolder()?.holder, "other");
  });
});
