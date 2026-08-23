import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { TrackDef } from "./profile";

// Mutable profile settings, owned by the app.
//
// Why a file and not the database: profile.ts is imported synchronously by the
// scorer, the prompts and the UI — moving it behind an async DB read would turn
// every call site async for no benefit. A JSON file gives us a synchronous
// read, a human-editable artifact (developers keep their editor workflow), a
// trivial export/import story, and — because we control the writes — an
// atomic-replace + in-memory cache with explicit invalidation.
//
// Precedence when composing the effective profile (most specific wins):
//   config/settings.json  (this file — what the UI writes)
//   config/profile.generated.json  (last CV generation, reviewed)
//   config/user.ts  (developer overrides / identity)
//   built-in template defaults

// Read at CALL time, not module load: the file will not always live in the
// repo (a packaged desktop build puts it in the user's data directory), and a
// test must be able to point at its own copy rather than the developer's real
// settings. A module-level constant would freeze whichever was set first.
export function settingsPath(): string {
  return process.env.JOBRADAR_SETTINGS_PATH || "config/settings.json";
}

export interface Settings {
  // Everything the profile page may edit. All fields optional: absent means
  // "fall through to the generated profile / template".
  tracks?: TrackDef[];
  languages?: string[];
  workAuthorization?: string[];
  seniority?: { boost: string[]; avoid: string[] };
  extraRoleNegatives?: string[];
  acceptRegions?: string[];
  searchQueries?: string[];
  targetRoles?: string;
  salaryFloorEURYear?: number;
  // Which model does the judging. A choice, not a secret: API KEYS stay in
  // .env, the PREFERENCE lives here so it is editable from the profile page
  // without touching a dotfile or restarting.
  //
  // The recommended default is the local model — it has no quota, no cost and
  // no third party reading your CV — but a laptop without a GPU wants a cloud
  // key instead, so both are first-class. `order` names providers best-first;
  // any provider not listed keeps its built-in position behind the listed
  // ones, so adding a key later does not require editing this.
  llm?: {
    order?: string[];
    disabled?: string[];
    localModel?: string;
  };
  // Bookkeeping so the UI can show "edited by hand on ..." next to a value
  // that no longer matches the CV generation.
  updatedAt?: string;
}

let cache: Settings | null = null;
let cachedStamp = "";

function fileStamp(path: string): string {
  try {
    // Cheap staleness check: a developer editing the file by hand (or another
    // process writing it) must not be shadowed by our in-memory copy. The path
    // is part of the stamp so switching files invalidates the cache too.
    return `${path}:${existsSync(path) ? readFileSync(path).length : 0}`;
  } catch {
    return `${path}:0`;
  }
}

export function loadSettings(): Settings {
  const path = settingsPath();
  const stamp = fileStamp(path);
  if (cache !== null && stamp === cachedStamp) return cache;
  try {
    cache = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Settings) : {};
  } catch {
    cache = {}; // a corrupt settings file must never break scoring
  }
  cachedStamp = stamp;
  return cache;
}

// Atomic write: a half-written settings file would silently retarget the whole
// radar, so we write a temp file and rename over the original.
export function saveSettings(next: Settings): void {
  const path = settingsPath();
  mkdirSync(dirname(path), { recursive: true });
  const body = JSON.stringify({ ...next, updatedAt: new Date().toISOString() }, null, 2);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, body, "utf8");
  renameSync(tmp, path);
  cache = null; // force the next read to see it
  cachedStamp = "";
}

export function patchSettings(patch: Partial<Settings>): Settings {
  const merged = { ...loadSettings(), ...patch };
  saveSettings(merged);
  return merged;
}
