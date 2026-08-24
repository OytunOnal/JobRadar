import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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

// A pid that cannot exist anywhere, rather than one that happens not to.
// Linux caps pid_max at 2^22 and Windows pids are multiples of four well below
// this; picking a number in the plausible range would make the test a bet on
// what else the machine is running.
const GONE = 0x7ffffff;

// A REAL other process, because since the liveness check landed a made-up pid
// no longer means anything.
//
// These cases used to write `process.pid + 1` to mean "someone else". That was
// never a live pid — it was an arbitrary number that happened to answer the way
// the test wanted, and only on Windows, where OpenProcess ignores the low two
// bits of a pid and so probes THIS process for +1, +2 and +3 alike. Measured
// both ways: on Windows all three report alive; under Linux, which is what CI
// runs, all three are ESRCH. So the fixture would have passed here and failed
// there — the worst shape a test can have. Spawn something instead: an idle
// node holding a timer is unambiguously alive and unambiguously not us.
function withLiveProcess<T>(fn: (pid: number) => T): T {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  // spawn reports failure asynchronously through an `error` event, and an
  // `error` with no listener is rethrown — so under memory pressure, the very
  // condition this project already documents (0xC0000142), a failed stand-in
  // would take down the whole test process instead of failing one case. The
  // assert below is what should report it.
  child.on("error", () => {});
  try {
    assert.ok(child.pid, "could not spawn the stand-in process");
    return fn(child.pid);
  } finally {
    child.kill();
  }
}

const { acquireGpu, releaseGpu, gpuHolder, gpuBusyMessage, setGpuChild, beatGpu, claimGpuChild, releaseGpuChild } = await import("../src/lib/queue/gpu-lock");

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
  withLock((path) => withLiveProcess((other) => {
    writeFileSync(path, JSON.stringify({
      holder: "worker/judge", pid: other,
      since: new Date().toISOString(), beat: Date.now(),
    }));
    assert.equal(acquireGpu("manual/embed"), false);
    assert.match(gpuBusyMessage() ?? "", /GPU meşgul.*worker\/judge/);
  }));
});

// The OTHER half of the pair: a holder that is still running but has stopped
// beating. Deliberately a live pid, so this exercises the staleness rule and
// not the liveness one — a hung holder is exactly the case the clock is for,
// and it is the only case where taking the lock is a judgement call rather
// than an observation.
test("a holder that stopped beating loses the lock, alive or not", () => {
  withLock((path) => withLiveProcess((other) => {
    writeFileSync(path, JSON.stringify({
      holder: "worker/judge", pid: other,
      since: new Date(Date.now() - 3600_000).toISOString(), beat: Date.now() - 3600_000,
    }));
    assert.equal(gpuHolder(), null, "stale lock must not count as held");
    assert.equal(acquireGpu("worker/embed"), true);
    releaseGpu();
  }));
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
  withLock((path) => withLiveProcess((other) => {
    writeFileSync(path, JSON.stringify({
      holder: "other", pid: other, since: new Date().toISOString(), beat: Date.now(),
    }));
    releaseGpu();
    assert.equal(gpuHolder()?.holder, "other");
  }));
});

// A dead holder is not a holder.
//
// The staleness rule alone is right for a process that HANGS and wrong for one
// that is gone: restarting the worker kills the old process, leaving a lock a
// few seconds old, and the replacement then refuses to start for five minutes.
// Seen on a real restart — "GPU busy: worker/lane (pid 12940, 43 min)" while
// pid 12940 no longer existed.
test("a lock whose process is gone is takeable immediately, however fresh", () => {
  withLock((path) => {
    writeFileSync(path, JSON.stringify({
      holder: "worker/lane",
      pid: GONE,
      since: new Date().toISOString(),
      beat: Date.now(), // beating as of this instant
    }), "utf8");

    assert.equal(gpuHolder(), null, "a fresh heartbeat from a dead pid holds nothing");
    assert.equal(gpuBusyMessage(), null);
    assert.equal(acquireGpu("worker/lane"), true, "the replacement takes it at once");
  });
});

// The direction the liveness check could regress into, and the reason the two
// tests above had to stop faking a pid: if `alive` ever answered too readily,
// nothing here would notice a lock being handed away from a working process.
test("a live holder still blocks, even when it is someone else", () => {
  withLock((path) => withLiveProcess((other) => {
    writeFileSync(path, JSON.stringify({
      holder: "manual/fit",
      pid: other,
      since: new Date().toISOString(),
      beat: Date.now(),
    }), "utf8");
    assert.notEqual(gpuHolder(), null, "a living holder is a holder");
    assert.equal(acquireGpu("worker/lane"), false, "and it is not takeable");
  }));
});

// A dead parent with a living child still holds the GPU.
//
// The worker takes the lock and then delegates: the model is loaded by the
// child, and a kill aimed at the parent alone (taskkill, Task Manager) leaves
// that child judging. Asking only about the parent's pid would hand a 6 GB
// card to a second 27B load — the failure the lock exists to prevent, arrived
// at through the fix for a different one.
test("a delegated child keeps the lock alive after its parent is gone", () => {
  withLock((path) => withLiveProcess((kid) => {
    writeFileSync(path, JSON.stringify({
      holder: "worker/lane",
      pid: GONE, // the parent is gone
      child: kid, // but the work is not
      since: new Date().toISOString(),
      beat: Date.now(),
    }), "utf8");
    assert.equal(gpuHolder()?.holder, "worker/lane");
    assert.equal(acquireGpu("worker/lane"), false, "no second judge on one card");
  }));
});

// The clock has to ask about the work, not about the supervisor.
//
// Recording the child stopped a replacement taking the GPU instantly, but only
// until the beat went stale: nobody was beating, because the beat came from
// the holder and the holder was dead. Five minutes of protection for four
// hours of work. The child beats now, so the staleness rule finally means what
// it says — still working, or genuinely hung.
test("a delegated child's beat is what keeps the lock alive", () => {
  withLock((path) => {
    const old = Date.now() - 6 * 60_000;
    writeFileSync(path, JSON.stringify({
      holder: "worker/lane",
      pid: GONE, // the worker was killed
      child: process.pid, // and WE are the child still judging
      since: new Date(old).toISOString(),
      beat: old, // nobody has beaten for six minutes
    }), "utf8");
    assert.equal(gpuHolder(), null, "a child that stopped beating is hung, and loses it");

    beatGpu();
    assert.equal(gpuHolder()?.holder, "worker/lane", "a beating child holds it, orphan or not");
    assert.equal(acquireGpu("worker/lane-2"), false, "so no second 27B lands on the card");
  });
});

// The pid the parent can see is not the pid that does the work.
//
// The worker spawns `node tsx/cli <script>` and tsx re-spawns, so what
// `setGpuChild` records is a wrapper. The test above fakes `child:
// process.pid` and so cannot see this at all — measured through the real
// spawn, the parent recorded 31116 while the script ran as 29748, and the
// beat from 29748 was rejected as a stranger's. Only the process doing the
// work can name itself.
test("the process doing the work claims the lock itself, whatever the parent guessed", () => {
  withLock((path) => withLiveProcess((wrapper) => {
    const old = Date.now() - 6 * 60_000;
    writeFileSync(path, JSON.stringify({
      holder: "worker/lane",
      pid: GONE, // the worker is dead
      child: wrapper, // and it recorded the tsx wrapper, not us
      since: new Date(old).toISOString(),
      beat: old,
    }), "utf8");

    beatGpu();
    assert.equal(gpuHolder(), null, "a beat from an unnamed process must not count");

    claimGpuChild(); // what backfill() now does when delegated
    beatGpu();
    assert.equal(gpuHolder()?.child, process.pid, "the worker's guess is corrected");
    assert.equal(acquireGpu("worker/lane-2"), false, "and the card is protected");

    releaseGpuChild();
    assert.equal(gpuHolder(), null, "handing the claim back frees it, parent dead or not");
  }));
});

test("a graceful stop does not release the lock out from under a live child", () => {
  withLock((path) => withLiveProcess((kid) => {
    // Exactly what the worker's SIGINT/SIGTERM handler does.
    writeFileSync(path, JSON.stringify({
      holder: "worker/lane", pid: process.pid, child: kid,
      since: new Date().toISOString(), beat: Date.now(),
    }), "utf8");
    releaseGpu();
    assert.equal(gpuHolder()?.child, kid, "the child is still holding the model");
  }));
});

test("the busy message names the process a reader can act on", () => {
  withLock((path) => withLiveProcess((kid) => {
    writeFileSync(path, JSON.stringify({
      holder: "worker/lane", pid: GONE, child: kid,
      since: new Date().toISOString(), beat: Date.now(),
    }), "utf8");
    const msg = gpuBusyMessage() ?? "";
    assert.match(msg, new RegExp(String(kid)), "the live child, not the dead parent");
    assert.doesNotMatch(msg, new RegExp(String(GONE)));
  }));
});

test("changing phase does not drop the child that is doing the work", () => {
  withLock(() => withLiveProcess((kid) => {
    assert.equal(acquireGpu("worker/lane"), true);
    setGpuChild(kid);
    acquireGpu("worker/archive"); // same process, new phase
    assert.equal(gpuHolder()?.child, kid, "the orphan protection survives a re-acquire");
    releaseGpu();
  }));
});

test("setGpuChild records and clears, and never edits another process's lock", () => {
  withLock(() => withLiveProcess((kid) => {
    assert.equal(acquireGpu("worker/lane"), true);
    setGpuChild(kid);
    assert.equal(gpuHolder()?.child, kid);
    setGpuChild(null);
    assert.equal(gpuHolder()?.child, undefined, "a finished child leaves no claim behind");
    releaseGpu();

    // Someone else's lock: writing a child into it would be forging a claim.
    writeFileSync(process.env.JOBRADAR_GPU_LOCK!, JSON.stringify({
      holder: "other", pid: kid, since: new Date().toISOString(), beat: Date.now(),
    }), "utf8");
    setGpuChild(process.pid);
    assert.equal(gpuHolder()?.child, undefined);
  }));
});
