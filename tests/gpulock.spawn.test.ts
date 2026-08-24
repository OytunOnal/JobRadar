import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// SEAM 2: real processes.
//
// The in-process seam covers the rules; this one covers the gap BETWEEN
// processes, which is where every defect that actually shipped lived. Four
// rounds of review found their worst problem there — a recorded pid belonging
// to a wrapper rather than the script, two processes writing over each other,
// an orphan attaching to a run that was never its own — and each was caught
// only by a hand-written spawn probe that was then thrown away. These are those
// probes, kept.
//
// Deliberately three cases. Spawning through the wrapper costs seconds, so this
// seam earns its place by covering what the fast one cannot, not by repeating
// it.

const TSX = fileURLToPath(import.meta.resolve("tsx/cli"));
const FIXTURE = fileURLToPath(new URL("./fixtures/gpu-participant.ts", import.meta.url));

interface Spoke {
  claim: string;
  beat: boolean;
  pid: number;
  ppid: number;
  id: string | null;
  participants: number[];
}

/** `wrapper` is the pid the spawner can see — the tsx layer, not the script. */
interface Started { child: ChildProcess; wrapper: number; said: Spoke }

// Spawn a participant exactly as the worker does — node, then the tsx cli, then
// the script — and come back with the one line it prints about itself.
function start(lock: string, token: string | null, holder: string, diePath?: string): Promise<Started> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, JOBRADAR_GPU_LOCK: lock };
    if (token === null) delete env.JOBRADAR_GPU_RUN;
    else env.JOBRADAR_GPU_RUN = token;

    const args = [TSX, FIXTURE, holder];
    if (diePath) args.push(diePath);
    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "inherit"], env });
    child.on("error", reject);

    const wrapper = child.pid;
    if (wrapper === undefined) { reject(new Error("could not spawn the participant")); return; }

    let out = "";
    child.stdout!.on("data", (b: Buffer) => {
      out += b.toString();
      const line = out.split("\n").find((l) => l.trim().startsWith("{"));
      if (line) resolve({ child, wrapper, said: JSON.parse(line) as Spoke });
    });
    child.on("exit", () => reject(new Error(`participant exited without speaking: ${out}`)));
  });
}

function withLockDir<T>(fn: (lock: string, dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "jr-spawn-"));
  return fn(join(dir, "gpu.lock"), dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code !== "ESRCH"; }
};

async function waitGone(pid: number): Promise<void> {
  for (let i = 0; i < 100 && alive(pid); i++) await new Promise((r) => setTimeout(r, 50));
}

// The defect that survived a whole round of review and an end-to-end fix: the
// spawner cannot name the process that does the work, because tsx re-spawns.
// Measured then at parent 31116 / script 29748; asserted here rather than
// remembered.
test("a spawned participant joins under its own pid, not the wrapper's", async () => {
  await withLockDir(async (lock) => {
    const creator = await start(lock, null, "worker/lane", `${lock}.die-a`);
    try {
      assert.equal(creator.said.claim, "acquired");
      const joiner = await start(lock, creator.said.id, "manual/fit", `${lock}.die-b`);
      try {
        assert.equal(joiner.said.claim, "joined", "the id it was handed let it in");
        assert.equal(joiner.said.beat, true, "and its beat landed");

        assert.notEqual(joiner.said.pid, joiner.wrapper,
          "the process that spoke is not the one the spawner can see");
        assert.equal(joiner.said.ppid, joiner.wrapper,
          "the pid the spawner sees is the wrapper's — this is the gap");

        assert.ok(joiner.said.participants.includes(joiner.said.pid),
          "the record names the process doing the work");
        assert.ok(!joiner.said.participants.includes(joiner.wrapper),
          "and never the wrapper");
      } finally {
        writeFileSync(`${lock}.die-b`, "");
        await waitGone(joiner.said.pid);
      }
    } finally {
      writeFileSync(`${lock}.die-a`, "");
      await waitGone(creator.said.pid);
    }
  });
});

// Kill a worker while its script is still booting and no handler runs; a second
// worker legitimately takes the freed card; the orphan finishes booting and
// finds a run that was never its own. Under a delegation FLAG it signed that
// run and put a second model on the card.
test("an orphan cannot join the run it finds, only the run it was given", async () => {
  await withLockDir(async (lock) => {
    const worker2 = await start(lock, null, "worker2/lane", `${lock}.die-a`);
    try {
      assert.equal(worker2.said.claim, "acquired");
      const orphan = await start(lock, "a-run-that-ended", "manual/fit");
      assert.equal(orphan.said.claim, "busy", "someone else's run is not ours to join");
      assert.ok(!orphan.said.participants.includes(orphan.said.pid),
        "and it did not write itself in");
    } finally {
      writeFileSync(`${lock}.die-a`, "");
      await waitGone(worker2.said.pid);
    }
  });
});

// The case the whole design is for: the worker is gone, its backfill is still
// judging with 17.7 GB resident, and the card must not be handed to anyone.
test("a run survives the death of the process that created it", async () => {
  await withLockDir(async (lock) => {
    const creator = await start(lock, null, "worker/lane", `${lock}.die-a`);
    const joiner = await start(lock, creator.said.id, "manual/fit", `${lock}.die-b`);
    try {
      assert.equal(joiner.said.claim, "joined");

      writeFileSync(`${lock}.die-a`, ""); // the worker dies without leaving
      await waitGone(creator.said.pid);
      assert.equal(alive(joiner.said.pid), true, "the work is still going");

      const seen = await start(lock, null, "worker2/lane");
      assert.equal(seen.said.claim, "busy", "a replacement worker is refused");
      assert.ok(seen.said.participants.includes(joiner.said.pid),
        "because the run still has someone in it");
    } finally {
      writeFileSync(`${lock}.die-b`, "");
      await waitGone(joiner.said.pid);
    }
  });
});
