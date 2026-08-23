import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, unlinkSync, readFileSync, writeFileSync } from "node:fs";
import { loadSettings, patchSettings, saveSettings, SETTINGS_PATH } from "../src/lib/settings";

// These tests write the real settings file, so they restore whatever was there.
const backup = existsSync(SETTINGS_PATH) ? readFileSync(SETTINGS_PATH, "utf8") : null;
const restore = () => {
  if (backup === null) { if (existsSync(SETTINGS_PATH)) unlinkSync(SETTINGS_PATH); }
  else saveSettings(JSON.parse(backup));
};

test("settings: a patch is readable immediately, no restart", () => {
  patchSettings({ languages: ["en", "de"] });
  assert.deepEqual(loadSettings().languages, ["en", "de"]);
  restore();
});

test("settings: patching one field leaves the others intact", () => {
  patchSettings({ languages: ["en"], workAuthorization: ["tr"] });
  patchSettings({ languages: ["en", "fr"] });
  const s = loadSettings();
  assert.deepEqual(s.languages, ["en", "fr"]);
  assert.deepEqual(s.workAuthorization, ["tr"]);
  restore();
});

test("settings: a corrupt file degrades to empty instead of breaking scoring", () => {
  writeFileSync(SETTINGS_PATH, "{ this is not json", "utf8");
  assert.deepEqual(loadSettings(), {});
  restore();
});
