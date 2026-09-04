// Multi-provider LLM layer. Providers are tried in order; if one is
// rate-limited or errors, the next takes over — this keeps JobRadar working
// when a single provider's budget runs out.
//
// WHICH provider leads is the user's choice, not ours (see settings.llm).
// Keys stay in .env because they are secrets; the preference lives in
// settings.json because it is a preference, and the profile page edits it.

import { loadSettings } from "../user/settings";

export class RateLimitError extends Error {}
// Out of balance, as a TYPE. The walk used to recognize it by grepping the
// error message for "HTTP 402" — a substring match over up to 200 chars of
// echoed response body, so a gateway whose error text merely mentioned 402
// could bench a healthy provider, and Anthropic's dialect (an empty credit
// balance reports as HTTP 400) could never bench the real thing. The adapters
// hold res.status and the body; meaning is translated there, not guessed
// downstream from prose.
export class OutOfBalanceError extends Error {}

// "anthropic" uses the /v1/messages shape; "openai" uses /chat/completions.
type ProviderKind = "openai" | "anthropic" | "ollama";

interface Provider {
  name: string;
  kind: ProviderKind;
  baseURL: string;
  key: string;
  fastModel: string;
  strongModel: string;
}

// Recommended order when the user has not chosen one. Local first: the
// judgments are the expensive, opinionated part of this tool, and running
// them on your own machine costs nothing, cannot be rate-limited, and does
// not send your CV to a third party. Cloud providers follow for machines
// that cannot host a 27B, and the user can reorder any of it.
const DEFAULT_ORDER = ["ollama", "endpoint", "anthropic", "cerebras", "groq", "gemini", "deepseek"];

// What the profile page shows: every provider we know how to talk to, whether
// it is usable on this machine, and why not when it is not.
export function providerStatus(): Array<{ name: string; ready: boolean; model: string; needs: string }> {
  const ready = new Map(providers().map((p) => [p.name, p.strongModel]));
  const known: Array<[string, string]> = [
    ["ollama", "yerel model (OLLAMA_MODEL veya ayarlardan)"],
    ["endpoint", "LLM_ENDPOINT_URL (+ LLM_ENDPOINT_MODEL, isteğe bağlı LLM_ENDPOINT_KEY)"],
    ["anthropic", "ANTHROPIC_API_KEY"],
    ["cerebras", "CEREBRAS_API_KEY"],
    ["groq", "GROQ_API_KEY"],
    ["gemini", "GOOGLE_API_KEY"],
    ["deepseek", "DEEPSEEK_API_KEY"],
  ];
  const order = llmOrder();
  return known
    .map(([name, needs]) => ({ name, ready: ready.has(name), model: ready.get(name) ?? "", needs }))
    .sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
}

function llmOrder(): string[] {
  const chosen = loadSettings().llm?.order ?? [];
  return [...chosen, ...DEFAULT_ORDER.filter((n) => !chosen.includes(n))];
}

function providers(): Provider[] {
  const list: Provider[] = [];
  const env = process.env;
  const settings = loadSettings().llm ?? {};
  // LLM_DISABLE="anthropic,deepseek" sidelines providers without touching keys.
  // The settings file can do the same from the UI; either is enough.
  const disabled = new Set([
    ...(env.LLM_DISABLE ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    ...(settings.disabled ?? []),
  ]);
  // LLM_ONLY="endpoint" is LLM_DISABLE's inverse: keep ONLY these providers.
  //
  // It exists for measurement, where reordering is not enough and enumerating
  // the others is a trap. The fallback chain is built to hide a failure by
  // answering from the next provider, which is right in production and ruinous
  // in a benchmark: point the run at a rented endpoint, let it quietly fall
  // through to ollama, and the report describes the local model while claiming
  // to describe the rented one. With LLM_ONLY the chain has nowhere to fall,
  // so a broken endpoint fails loudly instead of returning a plausible number.
  const only = new Set((env.LLM_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean));

  // Anthropic first: best judgment quality. Haiku for everything (cheap, fast).
  if (env.ANTHROPIC_API_KEY) {
    list.push({
      name: "anthropic",
      kind: "anthropic",
      baseURL: "https://api.anthropic.com/v1",
      key: env.ANTHROPIC_API_KEY,
      fastModel: env.ANTHROPIC_FAST_MODEL || "claude-haiku-4-5",
      strongModel: env.ANTHROPIC_MODEL || "claude-haiku-4-5",
    });
  }
  // Cerebras: generous free tier, very fast. Fallback for the bulk fit passes.
  if (env.CEREBRAS_API_KEY) {
    list.push({
      name: "cerebras",
      kind: "openai",
      baseURL: "https://api.cerebras.ai/v1",
      key: env.CEREBRAS_API_KEY,
      fastModel: env.CEREBRAS_FAST_MODEL || "gemma-4-31b",
      strongModel: env.CEREBRAS_MODEL || "gpt-oss-120b",
    });
  }
  if (env.GROQ_API_KEY) {
    list.push({
      name: "groq",
      kind: "openai",
      baseURL: "https://api.groq.com/openai/v1",
      key: env.GROQ_API_KEY,
      // Catalog checked live 2026-08: the llama-3.x models are retired.
      fastModel: env.GROQ_FIT_MODEL || "openai/gpt-oss-20b",
      strongModel: env.GROQ_MODEL || "openai/gpt-oss-120b",
    });
  }
  if (env.GOOGLE_API_KEY) {
    list.push({
      name: "gemini",
      kind: "openai",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
      key: env.GOOGLE_API_KEY,
      // Rolling aliases — always point at the current stable Flash models.
      fastModel: env.GEMINI_FAST_MODEL || "gemini-flash-lite-latest",
      strongModel: env.GEMINI_MODEL || "gemini-flash-latest",
    });
  }
  // The local model, keyless and quota-free. The settings file wins over the
  // dotenv so the choice can be made in the UI; either one enables it.
  const localModel = settings.localModel || env.OLLAMA_MODEL;
  if (localModel) {
    list.push({
      name: "ollama",
      kind: "ollama",
      baseURL: env.OLLAMA_URL || "http://localhost:11434",
      key: "ollama", // the endpoint ignores auth; the header just needs a value
      fastModel: env.OLLAMA_FAST_MODEL || localModel,
      strongModel: localModel,
    });
  }
  // ANY OpenAI-COMPATIBLE ENDPOINT, named by environment rather than by us.
  //
  // Added for a rented-GPU trial, and deliberately not written as a RunPod
  // adapter: the protocol is the same one Cerebras, Groq, Gemini, DeepSeek,
  // Together, Deepinfra, Fireworks, StepFun, Alibaba and a self-hosted vLLM
  // all speak, so one entry configured by two variables reaches every option
  // in docs/llm-hosting-cost.md and docs/llm-china-options.md without another
  // branch here. A provider-shaped hole is worth more than a provider.
  //
  // It sits second in the default order, behind the local model: a machine
  // with an endpoint configured is one deliberately pointed somewhere, and it
  // should be preferred over the paid clouds below — but not over a local
  // model that costs nothing.
  //
  // LLM_ENDPOINT_URL    the /v1 base (RunPod: .../openai/v1)
  // LLM_ENDPOINT_MODEL  the model name that endpoint expects
  // LLM_ENDPOINT_KEY    bearer token; optional, since a private vLLM may want none
  if (env.LLM_ENDPOINT_URL && env.LLM_ENDPOINT_MODEL) {
    list.push({
      name: "endpoint",
      kind: "openai",
      baseURL: env.LLM_ENDPOINT_URL,
      key: env.LLM_ENDPOINT_KEY || "none",
      fastModel: env.LLM_ENDPOINT_FAST_MODEL || env.LLM_ENDPOINT_MODEL,
      strongModel: env.LLM_ENDPOINT_MODEL,
    });
  }
  if (env.DEEPSEEK_API_KEY) {
    list.push({
      name: "deepseek",
      kind: "openai",
      baseURL: env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
      key: env.DEEPSEEK_API_KEY,
      fastModel: "deepseek-chat",
      strongModel: "deepseek-chat",
    });
  }
  // Availability decided which providers exist; preference decides the order
  // they are tried in.
  const order = llmOrder();
  return list
    .filter((p) => !disabled.has(p.name))
    .filter((p) => only.size === 0 || only.has(p.name))
    .sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
}

export function llmEnabled(): boolean {
  return providers().length > 0;
}

interface ChatOpts {
  temperature?: number;
  maxTokens?: number;
  tier?: "fast" | "strong";
}

type Msg = { role: "system" | "user" | "assistant"; content: string };

async function callOpenAI(p: Provider, messages: Msg[], model: string, opts: ChatOpts): Promise<string> {
  const res = await fetch(`${p.baseURL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.key}` },
    body: JSON.stringify({
      model,
      messages,
      temperature: opts.temperature ?? 0.5,
      max_tokens: opts.maxTokens ?? 900,
    }),
  });
  if (res.status === 429) throw new RateLimitError(`${p.name} rate limit`);
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200);
    if (res.status === 402) throw new OutOfBalanceError(`${p.name} HTTP 402: ${body}`);
    throw new Error(`${p.name} HTTP ${res.status}: ${body}`);
  }
  const data = await res.json();
  const content: string = data.choices?.[0]?.message?.content ?? "";
  // Local reasoning models (Qwen3 via Ollama) inline their thinking; strip it
  // so JSON extraction sees only the answer.
  return content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

// Anthropic Messages API: system is a top-level field (not a message), auth via
// x-api-key, and the response text lives in content[].text.
async function callAnthropic(p: Provider, messages: Msg[], model: string, opts: ChatOpts): Promise<string> {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest = messages.filter((m) => m.role !== "system");
  const res = await fetch(`${p.baseURL}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": p.key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: opts.maxTokens ?? 900,
      // temperature is deprecated on current Anthropic models (HTTP 400 if sent)
      ...(system ? { system } : {}),
      messages: rest.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  if (res.status === 429) throw new RateLimitError(`${p.name} rate limit`);
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200);
    // Anthropic's out-of-balance dialect is HTTP 400 with a credit-balance
    // message, not 402 — without this, the head-of-chain provider could never
    // be benched when out of credits, and ate a failed round-trip on every
    // call of a multi-hour backfill.
    if (res.status === 402 || (res.status === 400 && /credit balance/i.test(body))) {
      throw new OutOfBalanceError(`${p.name} HTTP ${res.status}: ${body}`);
    }
    throw new Error(`${p.name} HTTP ${res.status}: ${body}`);
  }
  const data = await res.json();
  return (data.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("") ?? "";
}

// Ollama's native /api/chat, because its OpenAI-compat endpoint routes ALL
// of a reasoning model's output into a separate `reasoning` field (measured:
// content "", finish "length" — the whole budget spent thinking). Native
// `think: false` disables the thinking phase outright; OLLAMA_THINK=1 re-enables.
async function callOllama(p: Provider, messages: Msg[], model: string, opts: ChatOpts): Promise<string> {
  const res = await fetch(`${p.baseURL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      think: process.env.OLLAMA_THINK === "1",
      options: {
        temperature: opts.temperature ?? 0.5,
        num_predict: opts.maxTokens ?? 900,
        // Prompt (~3.5k tok: system + CV + posting) + generation brushed the
        // 4096 default — Ollama SILENTLY truncates the head when it overflows,
        // i.e. the model would stop seeing the start of the CV.
        num_ctx: 8192,
      },
    }),
    signal: AbortSignal.timeout(180_000), // local models are slow, not broken
  });
  if (!res.ok) throw new Error(`ollama HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const content: string = data?.message?.content ?? "";
  return content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

async function callProvider(p: Provider, messages: Msg[], opts: ChatOpts): Promise<string> {
  const model = opts.tier === "fast" ? p.fastModel : p.strongModel;
  if (p.kind === "ollama") return callOllama(p, messages, model, opts);
  return p.kind === "anthropic"
    ? callAnthropic(p, messages, model, opts)
    : callOpenAI(p, messages, model, opts);
}

// A provider that answered 402 sits out this long before being asked again.
// It used to sit out the rest of the process, which was fine for a four-hour
// backfill child and wrong for the dev server: topping up the balance changed
// nothing until the server was restarted. An hour matches the human act it is
// waiting for.
export const DEAD_TTL_MS = 60 * 60_000;

/**
 * THE WALK over the provider chain, separated from the calling so it can be
 * tested — every LLM call in the system rides this loop, and until the seam
 * existed its behaviour was reachable only through real fetch calls. The
 * decision lives here; the effect (`call`) and the memory (`dead`) come in as
 * parameters. Production hands in the real callProvider and a module-owned
 * map; a test hands in a script and a fresh map, so no state leaks between
 * cases.
 *
 * The contract, pinned by tests/llmwalk.test.ts:
 * - providers are tried in order and the first success answers;
 * - a failure falls through; a 402 additionally benches the provider for
 *   DEAD_TTL_MS, because out-of-balance erroring at the head of every chain
 *   is pure waste for as long as the balance stays empty;
 * - RateLimitError is thrown only when every provider ASKED was rate-limited
 *   — benched providers and ones that revealed an empty balance mid-walk do
 *   not count against it, because their silence says nothing about limits,
 *   while one plain failure among the limits means something else is wrong
 *   and backing off would hide it;
 * - when everything fails, the error carries every provider's reason, not
 *   just the tail's;
 * - null means "no LLM at the moment": nothing configured, everything
 *   currently benched, or every provider revealing an empty balance on this
 *   very walk. Callers must treat null as "skip, try later" — deepprobe once
 *   treated it as a completed answer and burned its rescue lane on it.
 */
export async function walkProviders<P extends { name: string }>(
  all: readonly P[],
  call: (p: P) => Promise<string>,
  dead: Map<string, number>,
  now: () => number = Date.now,
): Promise<string | null> {
  const provs = all.filter((p) => {
    const diedAt = dead.get(p.name);
    if (diedAt === undefined) return true;
    const age = now() - diedAt;
    // A negative age means the clock stepped backwards (VM restore, RTC fix);
    // holding the bench for the size of the step would recreate the very
    // "topping up changed nothing" failure the TTL exists to end.
    if (age < 0 || age >= DEAD_TTL_MS) {
      dead.delete(p.name); // revival: the bench is a timeout, not a verdict
      return true;
    }
    return false;
  });
  if (provs.length === 0) return null;

  let rateLimited = 0;
  let broke = 0;
  const failures: string[] = [];
  for (const p of provs) {
    try {
      return await call(p);
    } catch (e: any) {
      failures.push(`${p.name}: ${String(e?.message ?? e).slice(0, 160)}`);
      if (e instanceof RateLimitError) rateLimited++;
      else if (e instanceof OutOfBalanceError) {
        broke++;
        dead.set(p.name, now());
      }
      // try the next provider
    }
  }
  // Everything that answered said "no balance": they are all benched now, so
  // this walk's truth is the same as the next hour's — no LLM at the moment.
  if (broke === provs.length) return null;
  // An empty balance revealed mid-walk says nothing about rate limits; only
  // the providers whose answer COULD have been a limit are in the denominator.
  // Without this, an hourly revival of a still-broke provider injected one
  // plain failure into an otherwise all-limited walk and downgraded the
  // throw the ingest loops break on.
  if (rateLimited > 0 && rateLimited === provs.length - broke) {
    throw new RateLimitError("all providers rate-limited");
  }
  // Every provider's reason, not just the last one — the chain hides bugs otherwise.
  throw new Error(`all providers failed — ${failures.join(" | ")}`);
}

const deadProviders = new Map<string, number>();

export async function chat(messages: Msg[], opts: ChatOpts = {}): Promise<string | null> {
  return walkProviders(providers(), (p) => callProvider(p, messages, opts), deadProviders);
}
