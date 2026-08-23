import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// These tests used to write the developer's REAL config/settings.json and
// restore it afterwards. Two things were wrong with that. Test files run
// concurrently, and several of them import profile.ts — which reads settings
// — so they could observe the deliberately corrupt file this suite writes,
// and did: three settings tests failed in a full run and passed alone. And a
// crash between write and restore would leave a developer's actual settings
// truncated.
//
// settingsPath() reads the env per call, so each test gets its own file and
// the shared mutable resource disappears.
const dir = mkdtempSync(join(tmpdir(), "jr-settings-"));
const PATH = join(dir, "settings.json");
process.env.JOBRADAR_SETTINGS_PATH = PATH;

const settingsModule = await import("../src/lib/settings");
const { loadSettings, patchSettings } = settingsModule;

test.after(() => {
  delete process.env.JOBRADAR_SETTINGS_PATH;
  rmSync(dir, { recursive: true, force: true });
});

test("settings: a patch is readable immediately, no restart", () => {
  patchSettings({ languages: ["en", "de"] });
  assert.deepEqual(loadSettings().languages, ["en", "de"]);
});

test("settings: patching one field leaves the others intact", () => {
  patchSettings({ languages: ["en"], workAuthorization: ["tr"] });
  patchSettings({ languages: ["en", "fr"] });
  const s = loadSettings();
  assert.deepEqual(s.languages, ["en", "fr"]);
  assert.deepEqual(s.workAuthorization, ["tr"]);
});

test("settings: a corrupt file degrades to empty instead of breaking scoring", () => {
  writeFileSync(PATH, "{ this is not json", "utf8");
  assert.deepEqual(loadSettings(), {});
});

test("settings: a save keeps the previous version beside it", () => {
  patchSettings({ languages: ["en"] });
  patchSettings({ languages: ["de"] });
  // The file is gitignored, so git cannot restore it — a stray write really
  // did destroy one during a test run, with nothing to fall back on.
  const bak = JSON.parse(readFileSync(`${PATH}.bak`, "utf8"));
  assert.deepEqual(bak.languages, ["en"]);
});

test("settings: an unreadable file is reported, not swallowed", () => {
  writeFileSync(PATH, "{ broken", "utf8");
  assert.deepEqual(loadSettings(), {});
  assert.match(settingsModule.settingsUnreadable ?? "", /settings\.json/);
});
