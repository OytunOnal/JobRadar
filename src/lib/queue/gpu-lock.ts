import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// One GPU, several workers that all want it.
//
// The 27B judge is 17.7 GB of weights and the embedder is 0.6 GB. Ollama
// unloads one to make room for the other, so two processes taking turns per
// job do not share the GPU — they spend most of their time reloading models.
// The fix is not finer-grained sharing but coarser: whoever holds the lock
// keeps it for a whole PHASE (all the embedding, or a run of judgments), and
// the other waits.
//
// A file rather than a database row: the workers are separate processes, the
// lock must survive a crashed one, and a stale lock has to be recoverable
// without a human. Hence the heartbeat — a holder that stops writing is
// assumed dead and its lock can be taken.

// Read per call, not at module load: a packaged build puts state outside the
// repo, and a test needs its own file. Freezing it at import is the same bug
// twice — settings.ts had it too.
function lockPath(): string {
  return process.env.JOBRADAR_GPU_LOCK || "data/gpu.lock";
}
// Generous: a single 27B judgment can take a minute, and a batch embed of 256
// rows longer. This only has to be shorter than "the process is really gone".
const STALE_MS = 5 * 60_000;

export interface LockInfo {
  holder: string;
  pid: number;
  since: string;
  beat: number;
  /**
   * The delegated child actually using the GPU, when the holder is a parent
   * that spawned one. The lock records the worker's pid, but the worker only
   * supervises — the 27B model is loaded by the child, and the two can outlive
   * each other. See `gpuHolder`.
   */
  child?: number;
}

function read(): LockInfo | null {
  try {
    const path = lockPath();
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8")) as LockInfo;
  } catch {
    return null; // an unreadable lock is no lock
  }
}

// Is the process that wrote this lock still running?
//
// Signal 0 sends nothing; it only asks whether the pid can be signalled.
// ESRCH means no such process. EPERM means it exists but belongs to someone
// else — alive, and not ours to take. Any other answer is treated as alive,
// because refusing to work is a smaller failure than two processes swapping
// 17.7 GB of weights against each other.
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

export function gpuHolder(): LockInfo | null {
  const info = read();
  if (!info) return null;
  // A dead holder is not a holder, whatever its heartbeat says.
  //
  // The time rule alone is right for a process that HANGS — it stops beating
  // but might still be mid-judgment — and wrong for one that is simply gone.
  // Restarting the worker hits the second case every time: the old process is
  // killed, its lock is seconds old, and the replacement refuses to start for
  // the next five minutes. Measured on a real restart: "GPU busy: worker/lane
  // (pid 12940, 43 min)" while pid 12940 no longer existed.
  //
  // Pid reuse could in principle make this wrong in the other direction, but
  // only in the window where the OS has recycled the number AND the lock has
  // not gone stale — and the consequence is one taken lock, not corruption.
  //
  // ASK ABOUT THE CHILD TOO. The worker holds the lock and then delegates the
  // real work: the 17.7 GB of weights is loaded by a child, not by the pid in
  // this file. Killing the worker alone — taskkill, or Task Manager, either of
  // which reaches the parent and not the group Ctrl-C would — leaves that child
  // judging for up to four hours with a dead parent's pid on the lock. Asking
  // only about the parent would then hand the GPU to a replacement instantly
  // and put two 27B loads on a 6 GB card, which is the one thing this file
  // exists to prevent. The old five-minute rule blunted that by accident; this
  // asks the question directly.
  if (!alive(info.pid) && !(info.child && alive(info.child))) return null;
  return Date.now() - info.beat > STALE_MS ? null : info;
}

// Record the delegated child that is really using the GPU, or clear it when
// that child is gone. A no-op for a process that does not hold the lock, on
// the same principle as `beatGpu`: never edit someone else's claim.
export function setGpuChild(pid: number | null): void {
  const info = read();
  if (!info || info.pid !== process.pid) return;
  if (pid === null) delete info.child;
  else info.child = pid;
  try { writeFileSync(lockPath(), JSON.stringify(info), "utf8"); } catch { /* transient */ }
}

// Take the GPU for `holder`, or return false if someone else has it. Callers
// decide what to do with a refusal: the worker waits, a manual script says so
// and exits rather than fighting for VRAM.
export function acquireGpu(holder: string): boolean {
  const current = gpuHolder();
  if (current && current.pid !== process.pid) return false;
  const path = lockPath();
  mkdirSync(dirname(path), { recursive: true });
  const info: LockInfo = {
    holder,
    pid: process.pid,
    since: current?.since ?? new Date().toISOString(),
    beat: Date.now(),
    // Carry a live child across a re-acquire. This function is how a holder
    // changes phase — worker/lane becomes worker/archive — and rebuilding the
    // record from scratch would drop the orphan protection silently, at the
    // one moment nothing is watching for it. A child that has since died is
    // not carried: there is nothing left to protect, and a recycled pid would
    // hold the lock on behalf of a stranger.
    ...(current?.child && alive(current.child) ? { child: current.child } : {}),
  };
  writeFileSync(path, JSON.stringify(info), "utf8");
  return true;
}

// Must be called periodically while working, or the lock goes stale and
// another process takes it mid-phase.
//
// THE BEAT COMES FROM WHOEVER IS USING THE GPU, which is the holder OR the
// child it delegated to. It used to come from the holder alone, and that made
// the clock ask the wrong question: not "is the work still going?" but "is the
// supervisor still up?". Kill the worker and leave its child judging and
// nobody beats at all — so the child's own liveness kept the lock for exactly
// as long as the clock allowed, five minutes, while the child went on holding
// 17.7 GB for up to four hours. Letting the child beat is what makes the
// staleness rule mean what it says.
export function beatGpu(): void {
  const info = read();
  if (!info || (info.pid !== process.pid && info.child !== process.pid)) return;
  info.beat = Date.now();
  try { writeFileSync(lockPath(), JSON.stringify(info), "utf8"); } catch { /* transient */ }
}

export function releaseGpu(): void {
  const info = read();
  if (info && info.pid !== process.pid) return; // never release someone else's
  // Nor release on behalf of a child that is still working. The worker's
  // SIGINT/SIGTERM handler unlinks the lock on its way out, which is right
  // when it was doing the work itself and wrong the moment it delegated: a
  // graceful stop during a four-hour judging pass would drop the lock, leave
  // the child holding the model, and let the next process take a card that is
  // already full. The child clears itself out of the lock when it exits, so
  // this refusal cannot outlive the work it is protecting.
  if (info?.child && info.child !== process.pid && alive(info.child)) return;
  const path = lockPath();
  try { if (existsSync(path)) unlinkSync(path); } catch { /* already gone */ }
}

// For scripts that should refuse to run rather than compete. Returns a
// message to print, or null when the GPU is free.
export function gpuBusyMessage(): string | null {
  // The worker holds the lock and then runs the real script as a child. The
  // child is a different pid but the same claim, so the parent DELEGATES:
  // without this the worker would lock itself out of its own work.
  if (process.env.JOBRADAR_GPU_DELEGATED === "1") return null;
  const h = gpuHolder();
  if (!h || h.pid === process.pid) return null;
  const mins = Math.round((Date.now() - Date.parse(h.since)) / 60000);
  // Name the pid the reader can actually act on. Telling someone to wait for
  // or stop a process that no longer exists is the exact confusion that
  // started all of this — "GPU busy: worker/lane (pid 12940, 43 min)" for a
  // pid that had already been killed. When the holder is gone and its child is
  // still judging, the child is the one to wait for.
  const orphan = !alive(h.pid) && h.child && alive(h.child);
  const who = orphan ? `pid ${h.child}, terk edilmiş alt süreç` : `pid ${h.pid}`;
  return `GPU meşgul: "${h.holder}" (${who}, ${mins} dk). Ya onun bitmesini bekleyin ya da durdurun.`;
}
