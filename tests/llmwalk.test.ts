import test from "node:test";
import assert from "node:assert/strict";
import { walkProviders, RateLimitError, DEAD_TTL_MS } from "../src/lib/llm/llm";

// The WALK over the provider chain, tested for the first time. The ORDER was
// always testable without keys or a network (llmorder.test.ts); the walk — what
// actually happens when a provider rate-limits, runs out of balance, or errors
// — lived only inside chat(), behind real fetch calls, driven by seven callers
// and zero tests.
//
// The seam: the walk takes the providers, the call, and the dead-map as
// parameters. Production hands it the real callProvider and a module-owned map;
// each test here builds its own — fresh state per case, because a module-global
// leaking between tests is exactly how this suite once passed a credential
// check that was never being exercised.

type P = { name: string };

// A scripted provider: each name maps to a behaviour, and the walk's calls are
// logged so order and skipping are observable facts rather than inferences.
function chain(script: Record<string, "ok" | "fail" | "ratelimit" | "broke">) {
  const called: string[] = [];
  const provs: P[] = Object.keys(script).map((name) => ({ name }));
  const call = async (p: P): Promise<string> => {
    called.push(p.name);
    switch (script[p.name]) {
      case "ok": return `${p.name} answered`;
      case "ratelimit": throw new RateLimitError(`${p.name} rate limit`);
      case "broke": throw new Error(`${p.name} HTTP 402: no balance`);
      default: throw new Error(`${p.name} HTTP 500: boom`);
    }
  };
  return { provs, call, called };
}

test("the first provider that answers, answers — nobody behind it is asked", async () => {
  const { provs, call, called } = chain({ ollama: "ok", groq: "ok" });
  assert.equal(await walkProviders(provs, call, new Map()), "ollama answered");
  assert.deepEqual(called, ["ollama"]);
});

test("a failure falls through to the next in order", async () => {
  const { provs, call, called } = chain({ ollama: "fail", groq: "ok" });
  assert.equal(await walkProviders(provs, call, new Map()), "groq answered");
  assert.deepEqual(called, ["ollama", "groq"]);
});

test("only a chain that is ENTIRELY rate-limited reports itself rate-limited", async () => {
  const { provs, call } = chain({ ollama: "ratelimit", groq: "ratelimit" });
  await assert.rejects(walkProviders(provs, call, new Map()), RateLimitError);

  // One plain failure among the rate limits means the caller should not wait
  // and retry — something else is wrong, and backing off would hide it.
  const mixed = chain({ ollama: "ratelimit", groq: "fail" });
  await assert.rejects(
    walkProviders(mixed.provs, mixed.call, new Map()),
    (e: Error) => !(e instanceof RateLimitError),
  );
});

test("when everything fails, the error carries every provider's reason", async () => {
  const { provs, call } = chain({ ollama: "fail", groq: "ratelimit" });
  await assert.rejects(walkProviders(provs, call, new Map()), (e: Error) => {
    // Not just the last one — a chain that reports only its tail hides bugs
    // in its head.
    assert.match(e.message, /ollama.*HTTP 500/);
    assert.match(e.message, /groq.*rate limit/);
    return true;
  });
});

test("out of balance means sitting out an hour, not the rest of the process", async () => {
  const dead = new Map<string, number>();
  let clock = 1_000_000;
  const now = () => clock;

  const first = chain({ groq: "broke", ollama: "ok" });
  assert.equal(await walkProviders(first.provs, first.call, dead, now), "ollama answered");
  assert.equal(dead.has("groq"), true, "402 put it in the dead-map");

  // Within the hour: not even asked. This is what protects the free tiers —
  // an out-of-balance provider erroring at the head of every chain is pure
  // waste for as long as the balance stays empty.
  clock += DEAD_TTL_MS - 1;
  const second = chain({ groq: "ok", ollama: "ok" });
  assert.equal(await walkProviders(second.provs, second.call, dead, now), "ollama answered");
  assert.deepEqual(second.called, ["ollama"], "the dead provider was skipped");

  // Past the hour: tried again, and a recovered balance rejoins the chain.
  // The old rule was "sit out the rest of the process", which was fine for a
  // four-hour backfill child and wrong for the dev server: topping up the
  // balance changed nothing until the server was restarted.
  clock += 2;
  const third = chain({ groq: "ok", ollama: "ok" });
  assert.equal(await walkProviders(third.provs, third.call, dead, now), "groq answered");
  assert.equal(dead.has("groq"), false, "revival clears the entry");
});

test("an empty chain answers null, and so does one that is entirely sitting out", async () => {
  assert.equal(await walkProviders([], async () => "x", new Map()), null);

  // Same answer on purpose: to a caller, "nothing configured" and "everything
  // configured is out of balance right now" both mean "no LLM at the moment",
  // and every caller already handles null by skipping gracefully.
  const dead = new Map([["groq", 500]]);
  const { provs, call, called } = chain({ groq: "ok" });
  assert.equal(await walkProviders(provs, call, dead, () => 501), null);
  assert.deepEqual(called, []);
});

test("rate-limit accounting is over the providers actually tried", async () => {
  // One dead (skipped), one rate-limited: every provider that was ASKED hit a
  // rate limit, so the chain is rate-limited — the dead one's silence is not a
  // reason to report a generic failure instead.
  const dead = new Map([["groq", 500]]);
  const { provs, call } = chain({ groq: "ok", ollama: "ratelimit" });
  await assert.rejects(walkProviders(provs, call, dead, () => 501), RateLimitError);
});
