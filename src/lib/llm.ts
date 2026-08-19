// Multi-provider LLM layer. Providers are tried in order; if one is rate-limited
// or errors, the next takes over — this keeps JobRadar working when a single
// provider's budget runs out. Anthropic (Claude) is first for quality; the
// OpenAI-compatible free tiers (Cerebras, Groq, …) stay as fallbacks.

export class RateLimitError extends Error {}

// "anthropic" uses the /v1/messages shape; "openai" uses /chat/completions.
type ProviderKind = "openai" | "anthropic";

interface Provider {
  name: string;
  kind: ProviderKind;
  baseURL: string;
  key: string;
  fastModel: string;
  strongModel: string;
}

function providers(): Provider[] {
  const list: Provider[] = [];
  const env = process.env;
  // LLM_DISABLE="anthropic,deepseek" sidelines providers without touching keys.
  const disabled = new Set((env.LLM_DISABLE ?? "").split(",").map((s) => s.trim()).filter(Boolean));

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
  return list.filter((p) => !disabled.has(p.name));
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
  if (!res.ok) throw new Error(`${p.name} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
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
  if (!res.ok) throw new Error(`${p.name} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("") ?? "";
}

async function callProvider(p: Provider, messages: Msg[], opts: ChatOpts): Promise<string> {
  const model = opts.tier === "fast" ? p.fastModel : p.strongModel;
  return p.kind === "anthropic"
    ? callAnthropic(p, messages, model, opts)
    : callOpenAI(p, messages, model, opts);
}

// Try providers in order; fall through on rate-limit/error. Returns null only if
// no provider is configured. Throws RateLimitError only if ALL are exhausted.
// Providers that answered with a permanent failure (402 no balance) sit out
// the rest of the process instead of erroring at the end of every chain.
const deadProviders = new Set<string>();

export async function chat(messages: Msg[], opts: ChatOpts = {}): Promise<string | null> {
  const provs = providers().filter((p) => !deadProviders.has(p.name));
  if (provs.length === 0) return null;

  let rateLimited = 0;
  const failures: string[] = [];
  for (const p of provs) {
    try {
      return await callProvider(p, messages, opts);
    } catch (e: any) {
      failures.push(`${p.name}: ${String(e?.message ?? e).slice(0, 160)}`);
      if (e instanceof RateLimitError) rateLimited++;
      // Out of balance is permanent for this process — stop asking.
      else if (/HTTP 402/.test(e?.message ?? "")) deadProviders.add(p.name);
      // try the next provider
    }
  }
  if (rateLimited === provs.length) throw new RateLimitError("all providers rate-limited");
  // Every provider's reason, not just the last one — the chain hides bugs otherwise.
  throw new Error(`all providers failed — ${failures.join(" | ")}`);
}
