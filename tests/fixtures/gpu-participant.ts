// A real participant, spawned the way the worker spawns one.
//
// This exists because the seam that drives the lock module in-process cannot
// see the thing that actually broke: between the spawner and this file sits a
// tsx wrapper, and the pid the spawner gets back belongs to the wrapper, which
// loads no model. Every fixture that invented a pid instead of spawning one
// gave a false answer.
//
// Prints one JSON line describing what it got, then either leaves cleanly or —
// when handed a path to watch — waits for that file to appear and exits
// WITHOUT leaving, which is what a crash looks like to the rest of the system.

import { existsSync } from "node:fs";
import { beatGpu, claimGpu, gpuRun, leaveGpu } from "../../src/lib/queue/gpu-lock";

const holder = process.argv[2] ?? "manual/fit";
const diePath = process.argv[3];

const claim = claimGpu(holder);
const beat = beatGpu();
const run = gpuRun();

console.log(JSON.stringify({
  claim,
  beat,
  pid: process.pid,
  ppid: process.ppid, // the wrapper, and the whole point: it is not us
  id: run?.id ?? null,
  participants: run?.participants ?? [],
}));

if (!diePath) {
  leaveGpu();
} else {
  const timer = setInterval(() => {
    if (!existsSync(diePath)) return;
    clearInterval(timer);
    process.exit(0); // no leaveGpu: this is a crash, not a goodbye
  }, 50);
}
