import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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

export const SETTINGS_PATH = "config/settings.json";

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
  // Bookkeeping so the UI can show "edited by hand on ..." next to a value
  // that no longer matches the CV generation.
  updatedAt?: string;
}

let cache: Settings | null = null;
let cachedMtime = 0;

function fileMtime(): number {
  try {
    // Cheap staleness check: a developer editing the file by hand (or another
    // process writing it) must not be shadowed by our in-memory copy.
    return existsSync(SETTINGS_PATH) ? Number(readFileSync(SETTINGS_PATH).length) : 0;
  } catch {
    return 0;
  }
}

export function loadSettings(): Settings {
  const stamp = fileMtime();
  if (cache !== null && stamp === cachedMtime) return cache;
  try {
    cache = existsSync(SETTINGS_PATH)
      ? (JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) as Settings)
      : {};
  } catch {
    cache = {}; // a corrupt settings file must never break scoring
  }
  cachedMtime = stamp;
  return cache;
}

// Atomic write: a half-written settings file would silently retarget the whole
// radar, so we write a temp file and rename over the original.
export function saveSettings(next: Settings): void {
  mkdirSync("config", { recursive: true });
  const body = JSON.stringify({ ...next, updatedAt: new Date().toISOString() }, null, 2);
  const tmp = `${SETTINGS_PATH}.tmp`;
  writeFileSync(tmp, body, "utf8");
  renameSync(tmp, SETTINGS_PATH);
  cache = null; // force the next read to see it
  cachedMtime = -1;
}

export function patchSettings(patch: Partial<Settings>): Settings {
  const merged = { ...loadSettings(), ...patch };
  saveSettings(merged);
  return merged;
}
