import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { providerStatus } from "../src/lib/llm";

// The provider chain is a user CHOICE, so the choice has to be testable
// without keys or a network. Each case writes a settings file, reloads the
// module (the settings cache is per-process), and reads the resulting order.
function withSettings<T>(llm: unknown, env: Record<string, string>, fn: () => T): T {
  const dir = mkdtempSync(join(tmpdir(), "jr-llm-"));
  const path = join(dir, "settings.json");
  writeFileSync(path, JSON.stringify(llm === undefined ? {} : { llm }));
  const prev = { ...process.env };
  for (const k of ["ANTHROPIC_API_KEY", "GROQ_API_KEY", "CEREBRAS_API_KEY", "GOOGLE_API_KEY", "DEEPSEEK_API_KEY", "OLLAMA_MODEL"]) {
    delete process.env[k];
  }
  Object.assign(process.env, env, { JOBRADAR_SETTINGS_PATH: path });
  try {
    return fn();
  } finally {
    process.env = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

const ready = () => providerStatus().filter((p) => p.ready).map((p) => p.name);
const orderWith = (llm: unknown, env: Record<string, string>) =>
  withSettings(llm, env, ready);

const KEYS = { ANTHROPIC_API_KEY: "k", GROQ_API_KEY: "k", OLLAMA_MODEL: "qwen3.8:27b" };

test("the local model leads by default — the recommendation, not a hardcoding", () => {
  assert.deepEqual(orderWith(undefined, KEYS), ["ollama", "anthropic", "groq"]);
});

test("a user who prefers a cloud key gets it first", () => {
  assert.deepEqual(orderWith({ order: ["groq"] }, KEYS), ["groq", "ollama", "anthropic"]);
});

test("local-only disables the cloud fallback entirely", () => {
  const order = orderWith({ disabled: ["anthropic", "groq"] }, KEYS);
  assert.deepEqual(order, ["ollama"]);
});

test("settings pick the local model over the dotenv", () => {
  const model = withSettings({ localModel: "qwen3.6:35b" }, { OLLAMA_MODEL: "qwen3:8b" },
    () => providerStatus().find((p) => p.name === "ollama")!.model);
  assert.equal(model, "qwen3.6:35b");
});
