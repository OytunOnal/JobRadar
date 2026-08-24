import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir, uptime } from "node:os";

// One GPU, and a laptop that falls over if two models are on it.
//
// The judge is 17.7 GB and the embedder 0.6 GB; the card holds 6 GB, so
// llama-server keeps most of the judge in system RAM. With a dev server and a
// browser open, roughly 4 GB of the 32 remains. Loading the second model on top
// of the first does not merely thrash — it takes the machine down. So this is a
// CRASH GUARD, not a scheduler, and one rule follows from that: when the state
// of the card is uncertain, do not work.
//
// THE CARD IS HELD BY A RUN, NOT BY A PROCESS. A run is one occupancy of the
// GPU: created when the card is taken, carrying an identity generated at that
// moment, ended when the last process taking part in it has gone. Processes are
// PARTICIPANTS. A process id answers exactly one question — is this participant
// still alive — and never says which run this is or who may join it.
//
// That distinction is the whole design, and it was learned the expensive way.
// Five rounds of review found twenty-eight defects here and the count did not
// fall, because every one of them was the same unanswered question wearing a
// different coat: the worker recording the pid of a tsx wrapper that loads no
// model; two writers disagreeing over one field; an orphan signing a lock a
// different worker had taken; a recycled pid impersonating the process that
// died. None of those is expressible once the holder is a run — with one
// qualification kept honest: membership is still a pid comparison, so a
// recycled number could walk into a LIVE run. That is why dead participants are
// pruned on every beat rather than carried, and why the run's identity, which
// is what a joiner must present, is not a pid at all.

function lockPath(): string {
  // Read per call, not at module load: a packaged build puts state outside the
  // repo, and a test needs its own file. Freezing it at import is the same bug
  // twice — settings.ts had it too.
  //
  // The default lives OUTSIDE anything synced. It used to be data/gpu.lock,
  // which sits inside a OneDrive folder — and a lock whose correctness rests on
  // millisecond renames does not belong under a sync engine's and antivirus's
  // open handles; those produce exactly the write failures writeLock reports
  // and the three-strike rule stops the worker over. Runtime state, not data.
  //
  // Migration note: a worker from the old build watches the old path and
  // cannot see this one — the upgrade happens with the worker stopped, the
  // same discipline the run redesign already required.
  if (process.env.JOBRADAR_GPU_LOCK) return process.env.JOBRADAR_GPU_LOCK;
  const base = process.env.LOCALAPPDATA || tmpdir();
  return join(base, "jobradar", "gpu.lock");
}

// The environment variable a spawned process inherits, carrying the id of the
// run it is meant to take part in. It replaces a delegation FLAG, which said
// only that someone had delegated and not which run — the gap every forgery
// lived in.
const TOKEN = "JOBRADAR_GPU_RUN";

// A backstop, not a schedule.
//
// A live participant holds the card however long it has been silent, because it
// may still have the model resident and taking the card from it is the crash.
// This exists only for the one way a dead run can look alive forever: the OS
// reissuing a dead participant's number to an unrelated process. It must
// therefore exceed the longest legitimate run — a judging pass is roughly four
// hours — and it is not a limit on how long work may take.
export const BACKSTOP_MS = 8 * 60 * 60_000;

// now − uptime drifts a few milliseconds between calls (measured: 13ms); the
// tolerance only has to be far smaller than the time a reboot takes.
const BOOT_TOLERANCE_MS = 60_000;
function bootEpochNow(): number {
  return Date.now() - uptime() * 1000;
}

export interface Run {
  /** Generated when the run is created. The card's identity; never a pid. */
  id: string;
  /** Human-readable, for the busy message: "worker/lane", "manual/fit". */
  holder: string;
  since: string;
  /** Last time any participant said it was still working. */
  beat: number;
  /** Pids taking part. Liveness only. */
  participants: number[];
  /**
   * When the machine that issued these pids booted. A pid only means anything
   * on the boot that issued it: after a crash leaves the file behind and the
   * machine restarts, the OS reissues low numbers quickly, and a listed pid
   * landing on an innocent system process used to hold the card for the whole
   * backstop — with the busy message pointing the reader at that innocent
   * process. Absent on runs written before the stamp existed; those keep the
   * old rules.
   */
  bootEpoch?: number;
  /**
   * The pid that began the run, kept for the busy MESSAGE alone: whether it is
   * gone is the difference between "still working" and "abandoned but still
   * holding". No rule in this module treats it as special, and it is never
   * removed — which is the point. It used to be read off participants[0], and
   * that is wrong the moment the process leaves gracefully: the list shifts,
   * the next participant becomes first, and a run whose worker had exited
   * cleanly reported itself as healthy while naming a holder that no longer
   * existed.
   */
  startedBy?: number;
}

/** What a caller got when it asked for the card. */
export type GpuClaim = "acquired" | "joined" | "busy" | "unwritable";

function read(): Run | null {
  try {
    const path = lockPath();
    if (!existsSync(path)) return null;
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<Run> & { pid?: number; child?: number };
    if (typeof raw.id === "string" && Array.isArray(raw.participants)) return raw as Run;
    // A lock from the previous build: one holder pid, optionally one delegated
    // child. Read as a run with those as its participants. The upgrade is meant
    // to happen with the worker stopped, but the cost of forgetting that is the
    // crash this module exists to prevent, so the compatibility is insurance
    // rather than a plan.
    if (typeof raw.pid !== "number") return null;
    return {
      id: `legacy:${raw.pid}`,
      holder: raw.holder ?? "önceki sürüm",
      since: raw.since ?? new Date(raw.beat ?? Date.now()).toISOString(),
      beat: raw.beat ?? Date.now(),
      participants: [raw.pid, raw.child].filter((n): n is number => typeof n === "number"),
      startedBy: raw.pid,
    };
  } catch {
    return null; // an unreadable lock is no lock
  }
}

// Replace the record in one step, and say whether it worked.
//
// ATOMIC, because "an unreadable lock is no lock" turns a half-written file
// into a free GPU, and two participants write this file twenty seconds apart.
// writeFileSync truncates before it writes; a reader landing in that window
// gets "", which reads as no lock at all. The temp name carries the pid so two
// writers cannot tear each other's scratch file instead.
//
// AND IT REPORTS, because a write that fails must never read as one that
// worked. Swallowing the error here once turned taking the card into a silent
// lie: success returned, nothing on disk, every other process told the card was
// free.
function writeLock(run: Run): boolean {
  const path = lockPath();
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tmp, JSON.stringify(run), "utf8");
    renameSync(tmp, path);
    return true;
  } catch {
    try { unlinkSync(tmp); } catch { /* nothing to clean up */ }
    return false;
  }
}

// Signal 0 sends nothing; it only asks whether the pid can be signalled. ESRCH
// means no such process. EPERM means it exists but belongs to someone else —
// alive, and not ours to take. Any other answer is read as alive, because
// refusing to work is a smaller failure than crashing the machine.
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

// The run this process created or joined, remembered so that it can find its
// way back in if a stale write drops it from the record. A participant's
// membership is a fact about this process, not only about the file.
let myRun: string | null = null;

/** May I take part in this run? Either I already do, or I was handed its id. */
function mine(run: Run): boolean {
  return run.participants.includes(process.pid)
    || process.env[TOKEN] === run.id
    || myRun === run.id;
}

/** The live run, or null when the card is free. */
export function gpuRun(): Run | null {
  const run = read();
  if (!run) return null;
  // A run with nobody alive in it is over, whatever its heartbeat says. This is
  // what makes a restart instant: the old worker's participants are dead the
  // moment it is killed, so the replacement starts at once rather than waiting
  // out a timer for a process that no longer exists.
  // A run stamped by a previous boot is over before liveness is even asked:
  // its pids were issued by a machine that no longer exists, so a live answer
  // for one of them is about a stranger, not a participant.
  if (run.bootEpoch !== undefined && Math.abs(run.bootEpoch - bootEpochNow()) > BOOT_TOLERANCE_MS) return null;
  if (!run.participants.some(alive)) return null;
  if (Date.now() - run.beat > BACKSTOP_MS) return null;
  return run;
}

/**
 * The id to hand to a process being spawned into this run — and only when the
 * run is ours to hand out.
 *
 * Taking the card is a read then a write, not one atomic step, so two processes
 * can both see it free and both write, the later rename winning silently. A
 * token taken from whatever happens to be on disk would then be a STRANGER's
 * run id, handed to our child as a credential: it would join that run and load
 * the judge onto a card someone else is already using. Exactly the crash this
 * file exists to prevent, arrived at by way of a helper that looked like a
 * getter.
 */
export function gpuToken(): string | null {
  const run = gpuRun();
  return run && mine(run) ? run.id : null;
}

// Enter myself in the run and refresh its beat. Idempotent, and re-entrant on
// purpose: a claim written once can be lost once, and was — a single stale
// write from another writer erased it permanently, after which that process's
// beats were refused as a stranger's.
function enter(run: Run): boolean {
  // Drop participants that have died, rather than carrying them for the life of
  // the run. They are not merely untidy: membership is tested by raw pid
  // equality, so every dead pid left in the list is another number an unrelated
  // process could be issued and walk in on. Pruning keeps that surface at the
  // processes actually working.
  const kept = run.participants.filter((p) => p === process.pid || alive(p));
  const participants = kept.includes(process.pid) ? kept : [...kept, process.pid];
  const ok = writeLock({ ...run, participants, beat: Date.now() });
  if (ok) myRun = run.id;
  return ok;
}

/**
 * Take part in a run for `holder`'s work: join the one I was handed, create one
 * if the card is free, or report that someone else has it.
 *
 * The three-way decision lives here rather than in each caller, so that no
 * caller can re-derive it differently — the shape of mistake this module has
 * already paid for.
 */
export function claimGpu(holder: string): GpuClaim {
  const current = gpuRun();
  if (current) {
    if (!mine(current)) return "busy";
    return enter(current) ? "joined" : "unwritable";
  }
  const run: Run = {
    id: randomUUID(),
    holder,
    since: new Date().toISOString(),
    beat: Date.now(),
    participants: [process.pid],
    startedBy: process.pid,
    bootEpoch: bootEpochNow(),
  };
  // CREATION IS EXCLUSIVE, because taking the card is a read and then a write.
  // Two processes could both see it free and both write; the later rename won
  // silently, and BOTH walked away believing they had acquired — the loser
  // kept working uncovered, warning into a log nobody reads mid-run. With
  // `wx`, exactly one create lands; the loser re-reads and is told the truth.
  //
  // Updates stay on the tmp+rename path: those races are between participants
  // of the SAME run, and re-entry on every beat already heals them.
  const created = createLock(run);
  if (created === "created") {
    myRun = run.id;
    return "acquired";
  }
  if (created === "exists") {
    const winner = gpuRun();
    if (winner) {
      if (!mine(winner)) return "busy";
      // Ours after all — the race was against a sibling holding our token.
      return enter(winner) ? "joined" : "unwritable";
    }
    // A file is there, but no live run is in it — corrupt, or a dead run's
    // leftover. "An unreadable lock is no lock" still holds; replacing what a
    // fresh create cannot get past is the one place the non-exclusive write
    // remains right.
    if (!writeLock(run)) return "unwritable";
    myRun = run.id;
    return "acquired";
  }
  return "unwritable";
}

function createLock(run: Run): "created" | "exists" | "failed" {
  const path = lockPath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(run), { encoding: "utf8", flag: "wx" });
    return "created";
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EEXIST" ? "exists" : "failed";
  }
}

/** True when this process is now taking part in a run for its work. */
export function acquireGpu(holder: string): boolean {
  const claim = claimGpu(holder);
  return claim === "acquired" || claim === "joined";
}

/**
 * Say the work is still going. Returns false when this process is no longer
 * covered — the card changed hands, or the record cannot be written — which is
 * a silent disaster unless the caller reports it, because the run would go on
 * loading a model onto a card someone else believes is theirs.
 */
export function beatGpu(): boolean {
  const run = gpuRun();
  if (!run || !mine(run)) return false;
  return enter(run);
}

/**
 * Leave the run. The last participant out ends it.
 *
 * Leaving is an optimisation rather than a correctness requirement: a
 * participant that dies without getting here is seen as dead, and a run with
 * nobody alive in it is already over.
 */
export function leaveGpu(): void {
  const run = read();
  if (!run || !run.participants.includes(process.pid)) return;
  const participants = run.participants.filter((p) => p !== process.pid);
  if (myRun === run.id) myRun = null;
  if (participants.length === 0) {
    try { unlinkSync(lockPath()); } catch { /* already gone */ }
    return;
  }
  writeLock({ ...run, participants });
}

/**
 * For work that should refuse rather than compete. Returns a message to print,
 * or null when the card is free or already ours.
 */
export function gpuBusyMessage(): string | null {
  const run = gpuRun();
  if (!run || mine(run)) return null;
  const mins = Math.round((Date.now() - Date.parse(run.since)) / 60000);
  // Name processes the reader can actually act on. Telling someone to wait for
  // or stop a pid that no longer exists is the confusion this whole design came
  // out of — "GPU busy: worker/lane (pid 12940, 43 min)" for a process that had
  // already been killed.
  const live = run.participants.filter(alive);
  const abandoned = run.startedBy !== undefined && !alive(run.startedBy) ? ", terk edilmiş" : "";
  return `GPU meşgul: "${run.holder}" (pid ${live.join(", ")}${abandoned}, ${mins} dk). `
    + "Ya onun bitmesini bekleyin ya da durdurun.";
}
