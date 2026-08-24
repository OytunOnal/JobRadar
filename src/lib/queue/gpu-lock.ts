import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
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
   * The delegated process actually using the GPU, when the holder is a parent
   * that spawned one. The holder only supervises — the 27B model is loaded by
   * the child, and the two can outlive each other.
   *
   * ONLY THAT PROCESS EVER WRITES THIS, on every beat. The parent used to
   * write its own guess here as well, and the guess was wrong twice over: it
   * named the tsx wrapper rather than the script, so the field pointed at a
   * process that loads no model; and having two writers with two meanings in
   * one field meant the parent could erase the child's claim — on a stale
   * beat, or by clearing it when the wrapper exited while the real work went
   * on. One writer, one meaning. The cost is the second or two of tsx boot
   * before the claim lands, during which the lock rests on the holder's pid
   * alone.
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

// Replace the lock in one step, and say whether it worked.
//
// ATOMIC, because "an unreadable lock is no lock" turns a half-written file
// into a free GPU. Two processes beat this file 20 seconds apart and
// `writeFileSync` truncates before it writes; a reader landing inside that
// window gets "", `read()` swallows the parse error and answers null, and the
// next `acquireGpu` hands out a card that is already full. Writing beside the
// lock and renaming over it closes that; the temp name carries the pid so the
// two writers cannot tear each other's scratch file instead.
//
// AND IT REPORTS, because a write that fails must never read as one that
// worked. `acquireGpu` used to throw when the write failed; wrapping it in a
// swallowing catch turned that into a silent lie. Measured with the rename
// failing: acquireGpu returned true, gpuHolder() returned null, and
// gpuBusyMessage() told every other process the card was free.
function writeLock(info: LockInfo): boolean {
  const path = lockPath();
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(info), "utf8");
    renameSync(tmp, path);
    return true;
  } catch {
    try { unlinkSync(tmp); } catch { /* nothing to clean up */ }
    return false;
  }
}

// WHO delegated, and WHICH lock.
//
// The worker sets this on the environment of the script it spawns, and every
// descendant inherits it. It used to say "1", which is an assertion with no
// subject: any delegated process attached itself to whatever lock happened to
// be on disk. Measured — a process the holder had never spawned wrote its own
// pid onto a stranger's lock, and since the claim is re-asserted on every
// beat, forging it once was forging it for good.
//
// Naming the parent fixed that but left the identity resting on a number the
// OS hands back out. Worker1 is killed while tsx boots, worker2 starts, and if
// it is given the same pid then the orphan's token matches a lock it has never
// seen. Measured with a live holder and a different `since`: the check passed.
// (Not a frequent event — sixty sequential spawns here reused nothing — but
// the check should not depend on how the OS feels about recycling numbers.)
//
// So the token carries the lock's own birth stamp as well. `since` is written
// once when the lock is first taken and carried across every phase change, so
// it identifies THE LOCK rather than the moment; two different workers cannot
// produce the same pair. A legacy "1" matches no token at all, fails the
// check, and the run takes its own lock — the safe direction. This also stops
// the identity being a number that has to be reserved: a real pid 1, which any
// container entrypoint gets, used to be rejected as if it were the old flag.
function tokenFor(info: LockInfo): string {
  return `${info.pid}:${info.since}`;
}

// The token to hand to a child, or null when we hold nothing to delegate.
export function gpuToken(): string | null {
  const info = gpuHolder();
  return info ? tokenFor(info) : null;
}

// Is this lock the one my parent took on my behalf?
export function delegatedUnder(info: LockInfo | null): boolean {
  const token = process.env.JOBRADAR_GPU_DELEGATED;
  return !!token && info !== null && token === tokenFor(info);
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

// Give the claim back. The exiting child does this itself so that the lock
// stops naming it the moment it stops working — including when its parent is
// already dead and there is nobody else left to do the clearing.
export function releaseGpuChild(): void {
  const info = read();
  if (!info || info.child !== process.pid) return;
  delete info.child;
  writeLock(info);
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
  return writeLock(info);
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
//
// THE BEAT IS ALSO THE CLAIM, and that is not tidiness — it is the only way
// the claim survives. It used to be written once, by a separate call, into the
// same field the parent was writing its own guess into. Every caller does
// read → mutate → write with no atomicity across the pair, so the parent's
// next beat could rename its stale copy over the top and erase the claim for
// good; a one-shot claim never comes back, and from then on the child's beats
// were rejected as a stranger's. Measured: claim written, one parent beat, and
// the field was gone. Re-asserting it here makes it self-healing — whoever is
// doing the work says so twenty seconds later, and the twenty seconds after
// that.
// Returns whether the beat landed. False means we are no longer covered —
// either the write failed, or the lock is not ours any more because it went
// stale and somebody else legitimately took it. Both are silent disasters if
// nobody says them: we go on holding 17.7 GB on a card another process now
// believes it owns. The module has no logger of its own, so it reports and
// lets the caller — which has one, and a log file — decide how loudly.
export function beatGpu(): boolean {
  const info = read();
  if (!info) return false;
  if (delegatedUnder(info)) info.child = process.pid;
  else if (info.pid !== process.pid) return false;
  info.beat = Date.now();
  return writeLock(info);
}

export function releaseGpu(): void {
  const info = read();
  if (info && info.pid !== process.pid) return; // never release someone else's
  // Nor release on behalf of a child that is still working. The worker's
  // SIGINT/SIGTERM handler unlinks the lock on its way out, which is right
  // when it was doing the work itself and wrong the moment it delegated: a
  // graceful stop during a four-hour judging pass would drop the lock, leave
  // the child holding the model, and let the next process take a card that is
  // already full. The child gives its claim back on the way out
  // (`releaseGpuChild`), so this refusal cannot outlive the work it protects —
  // and if the child dies without getting that far, `gpuHolder` sees two dead
  // pids and the lock is takeable anyway.
  if (info?.child && info.child !== process.pid && alive(info.child)) return;
  const path = lockPath();
  try { if (existsSync(path)) unlinkSync(path); } catch { /* already gone */ }
}

// For scripts that should refuse to run rather than compete. Returns a
// message to print, or null when the GPU is free.
export function gpuBusyMessage(): string | null {
  const h = gpuHolder();
  if (!h || h.pid === process.pid) return null;
  // The worker holds the lock and then runs the real script as a child. The
  // child is a different pid but the same claim, so the parent DELEGATES:
  // without this the worker would lock itself out of its own work.
  //
  // Only for MY parent's lock, though. This used to wave through any process
  // carrying the delegation flag, whatever lock it found — so an orphan whose
  // own parent had died would sail past a lock a completely different worker
  // had since taken, and load the model on a busy card.
  if (delegatedUnder(h)) return null;
  const mins = Math.round((Date.now() - Date.parse(h.since)) / 60000);
  // Name the pid the reader can actually act on, which is the CHILD whenever
  // there is one — not only when the parent is dead.
  //
  // Telling someone to wait for or stop a process that no longer exists is the
  // confusion that started all of this: "GPU busy: worker/lane (pid 12940, 43
  // min)" for a pid that had already been killed. But naming a LIVE parent is
  // just as misleading now, because `releaseGpu` refuses while its child is
  // working: stop the worker as instructed and the GPU stays locked for the
  // rest of the judging pass, by a process the message never mentioned.
  //
  // Safe to point at, now that the only thing that writes `child` is the
  // process doing the work. While the parent also wrote a guess here, this
  // could name a tsx wrapper — a pid whose death frees nothing on Windows,
  // because the grandchild holding the model is in no job object with it.
  const working = h.child && alive(h.child) ? h.child : null;
  const who = working
    ? `pid ${working}${alive(h.pid) ? "" : ", terk edilmiş"} alt süreç`
    : `pid ${h.pid}`;
  return `GPU meşgul: "${h.holder}" (${who}, ${mins} dk). Ya onun bitmesini bekleyin ya da durdurun.`;
}
