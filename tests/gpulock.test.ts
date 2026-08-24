import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// SEAM 1: the lock module's own interface, with the lock file redirected.
//
// The module reads its path per call, which is what makes it drivable from
// outside without reaching into it. Everything here asserts what another
// process would observe — the record on disk, and the module's answers — never
// how an answer was reached.
//
// What this seam CANNOT see is the gap between processes, and that gap is where
// the defects actually shipped. See gpulock.spawn.test.ts.

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

// A pid that cannot exist anywhere, rather than one that happens not to. Linux
// caps pid_max at 2^22 and Windows pids sit well below this; a number in the
// plausible range would make the case a bet on what else is running.
const GONE = 0x7ffffff;

// A REAL other process. A made-up pid means nothing to a module that asks the
// OS whether a participant is alive — fixtures inventing one gave false results
// three times while this design was worked out: twice by naming a pid that was
// not alive, once by collapsing a two-process chain into one.
function withLiveProcess<T>(fn: (pid: number) => T): T {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  // spawn reports failure asynchronously; an `error` with no listener is
  // rethrown and takes down the whole test process rather than one case.
  child.on("error", () => {});
  try {
    assert.ok(child.pid, "could not spawn the stand-in process");
    return fn(child.pid);
  } finally {
    child.kill();
  }
}

// Play a process that was handed a run id, the way a spawned backfill is.
function withToken<T>(id: string, fn: () => T): T {
  const prev = process.env.JOBRADAR_GPU_RUN;
  process.env.JOBRADAR_GPU_RUN = id;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.JOBRADAR_GPU_RUN;
    else process.env.JOBRADAR_GPU_RUN = prev;
  }
}

const { acquireGpu, claimGpu, beatGpu, leaveGpu, gpuRun, gpuToken, gpuBusyMessage, BACKSTOP_MS } =
  await import("../src/lib/queue/gpu-lock");

const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));

test("taking a free card creates a run with the taker as its first participant", () => {
  withLock((path) => {
    assert.equal(claimGpu("worker/lane"), "acquired");
    const run = gpuRun();
    assert.equal(run?.holder, "worker/lane");
    assert.deepEqual(run?.participants, [process.pid]);
    assert.ok(run?.id, "a run carries an identity of its own");
    assert.equal(gpuToken(), run?.id, "and that identity is what gets handed down");
    leaveGpu();
    assert.equal(existsSync(path), false, "the last participant out ends the run");
  });
});

test("two runs never hold the card at once", () => {
  withLock((path) => withLiveProcess((other) => {
    writeFileSync(path, JSON.stringify({
      id: "run-a", holder: "worker/lane", since: new Date().toISOString(),
      beat: Date.now(), participants: [other],
    }), "utf8");
    assert.equal(claimGpu("manual/fit"), "busy");
    assert.deepEqual(gpuRun()?.participants, [other], "and we did not add ourselves");
  }));
});

test("a process handed the run id joins it", () => {
  withLock((path) => withLiveProcess((other) => {
    writeFileSync(path, JSON.stringify({
      id: "run-a", holder: "worker/lane", since: new Date().toISOString(),
      beat: Date.now(), participants: [other],
    }), "utf8");
    withToken("run-a", () => {
      assert.equal(claimGpu("manual/fit"), "joined");
      assert.deepEqual(read(path).participants, [other, process.pid]);
      assert.equal(read(path).holder, "worker/lane", "joining does not relabel the run");
    });
  }));
});

// The orphan case, and the reason the token is the run's identity rather than a
// flag or a pid: kill a worker while its script is still booting, let a second
// worker legitimately take the freed card, and the orphan finishes booting to
// find a run that was never its own.
test("a process cannot join a run it was not handed", () => {
  withLock((path) => withLiveProcess((other) => {
    writeFileSync(path, JSON.stringify({
      id: "run-b", holder: "worker2/lane", since: new Date().toISOString(),
      beat: Date.now(), participants: [other],
    }), "utf8");
    withToken("run-a", () => { // our parent's run, not this one
      assert.equal(claimGpu("manual/fit"), "busy");
      assert.deepEqual(read(path).participants, [other], "not ours to sign");
      beatGpu();
      assert.deepEqual(read(path).participants, [other], "nor ours to beat");
    });
  }));
});

test("any participant's beat keeps the run alive", () => {
  withLock((path) => withLiveProcess((other) => {
    const old = Date.now() - 60_000;
    writeFileSync(path, JSON.stringify({
      id: "run-a", holder: "worker/lane", since: new Date(old).toISOString(),
      beat: old, participants: [other, process.pid],
    }), "utf8");
    beatGpu();
    assert.ok(read(path).beat > old, "the beat came from a participant that did not create the run");
  }));
});

// A claim written once can be lost once. It was: a single stale write from
// another writer erased it permanently, after which that process's beats were
// refused as a stranger's. Re-entry on every beat is what makes it survivable.
test("a participant dropped from the record puts itself back on the next beat", () => {
  withLock((path) => withLiveProcess((other) => {
    writeFileSync(path, JSON.stringify({
      id: "run-a", holder: "worker/lane", since: new Date().toISOString(),
      beat: Date.now(), participants: [other, process.pid],
    }), "utf8");
    // Someone writes a record that has forgotten us. In life this is a spawned
    // backfill, so it still holds the run id it was handed — which is the
    // credential that lets it back in.
    writeFileSync(path, JSON.stringify({
      id: "run-a", holder: "worker/lane", since: new Date().toISOString(),
      beat: Date.now(), participants: [other],
    }), "utf8");
    withToken("run-a", () => {
      beatGpu();
      assert.deepEqual(read(path).participants, [other, process.pid]);
    });
  }));
});

test("a run outlives the participant that created it", () => {
  withLock((path) => withLiveProcess((other) => {
    writeFileSync(path, JSON.stringify({
      id: "run-a", holder: "worker/lane", since: new Date().toISOString(),
      beat: Date.now(), participants: [process.pid, other],
    }), "utf8");
    leaveGpu(); // the creator goes; the other participant is still judging
    assert.equal(gpuRun()?.holder, "worker/lane");
    assert.deepEqual(gpuRun()?.participants, [other]);
    assert.equal(claimGpu("worker2/lane"), "busy", "so the card is not free");
  }));
});

test("a run whose participants are all gone is taken at once, however fresh", () => {
  withLock((path) => {
    writeFileSync(path, JSON.stringify({
      id: "run-a", holder: "worker/lane", since: new Date().toISOString(),
      beat: Date.now(), // beating as of this instant
      participants: [GONE],
    }), "utf8");
    assert.equal(gpuRun(), null, "a fresh beat from a dead run holds nothing");
    assert.equal(gpuBusyMessage(), null);
    assert.equal(claimGpu("worker/lane"), "acquired", "the replacement starts immediately");
  });
});

// The rule the crash risk inverts. A process that is alive but silent may still
// have 17.7 GB resident; taking the card from it is the crash the lock exists
// to prevent. Waiting is correct, and ending it is the operator's call.
test("a live run is never taken, however long it has been silent", () => {
  withLock((path) => withLiveProcess((other) => {
    writeFileSync(path, JSON.stringify({
      id: "run-a", holder: "worker/lane", since: new Date().toISOString(),
      beat: Date.now() - BACKSTOP_MS + 60_000, // silent for hours, still short of the backstop
      participants: [other],
    }), "utf8");
    assert.notEqual(gpuRun(), null);
    assert.equal(claimGpu("worker2/lane"), "busy");
  }));
});

// The one way a dead run could look alive forever: the OS reissuing a dead
// participant's number to an unrelated process. The window is longer than any
// legitimate run, because it is a backstop and not a schedule.
test("the backstop frees a run whose participant number has been recycled", () => {
  withLock((path) => withLiveProcess((other) => {
    writeFileSync(path, JSON.stringify({
      id: "run-a", holder: "worker/lane", since: new Date().toISOString(),
      beat: Date.now() - BACKSTOP_MS - 1000,
      participants: [other],
    }), "utf8");
    assert.equal(gpuRun(), null);
    assert.equal(claimGpu("worker2/lane"), "acquired");
  }));
});

// A write that fails must never read as one that worked. Wrapping the write in
// a swallowing catch once turned a throw into a silent lie: taking the card
// reported success while nothing was on disk and every other process was told
// the card was free.
test("a run that cannot be recorded does not start", () => {
  withLock((path) => {
    mkdirSync(path); // the lock path is a directory: the write cannot land
    assert.equal(claimGpu("worker/lane"), "unwritable");
    assert.equal(gpuRun(), null);
  });
});

test("a lock from the previous build is read as a run with one participant", () => {
  withLock((path) => withLiveProcess((other) => {
    // Exactly the shape the old worker leaves behind: no id, no participants.
    writeFileSync(path, JSON.stringify({
      holder: "worker/lane", pid: other,
      since: "2026-08-24T15:11:50.514Z", beat: Date.now(),
    }), "utf8");
    assert.deepEqual(gpuRun()?.participants, [other], "its pid is its sole participant");
    assert.equal(claimGpu("worker2/lane"), "busy", "and it still holds the card");
  }));
});

test("the busy message names a process the reader can actually stop", () => {
  withLock((path) => withLiveProcess((other) => {
    writeFileSync(path, JSON.stringify({
      id: "run-a", holder: "worker/lane", since: new Date().toISOString(),
      beat: Date.now(), participants: [GONE, other],
    }), "utf8");
    const msg = gpuBusyMessage() ?? "";
    assert.match(msg, new RegExp(String(other)), "the live participant");
    assert.doesNotMatch(msg, new RegExp(String(GONE)), "not the one that is gone");
    assert.match(msg, /worker\/lane/);
  }));
});

test("a participant of the live run is not blocked by it", () => {
  withLock((path) => withLiveProcess((other) => {
    writeFileSync(path, JSON.stringify({
      id: "run-a", holder: "worker/lane", since: new Date().toISOString(),
      beat: Date.now(), participants: [other, process.pid],
    }), "utf8");
    assert.equal(gpuBusyMessage(), null, "we are part of this run, not waiting on it");
  }));
});

test("acquireGpu reports whether the card was taken", () => {
  withLock((path) => withLiveProcess((other) => {
    assert.equal(acquireGpu("worker/lane"), true);
    leaveGpu();
    writeFileSync(path, JSON.stringify({
      id: "run-b", holder: "other", since: new Date().toISOString(),
      beat: Date.now(), participants: [other],
    }), "utf8");
    assert.equal(acquireGpu("worker/lane"), false);
  }));
});
