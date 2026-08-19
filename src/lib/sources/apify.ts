// Shared Apify actor runner: start a run, poll to completion, fetch the
// dataset. Plain REST — no SDK dependency. Every Apify-backed source skips
// itself when APIFY_API_TOKEN is missing (the free plan carries ~$5/month of
// credit; per-source maxItems budgets keep usage inside it).

const BASE = "https://api.apify.com/v2";
const POLL_MS = 5_000;
const RUN_TIMEOUT_MS = 8 * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function apifyToken(): string | null {
  return process.env.APIFY_API_TOKEN || null;
}

export async function runActor<T>(actorId: string, input: unknown, token: string): Promise<T[]> {
  const started = await fetch(`${BASE}/acts/${actorId}/runs?token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!started.ok) throw new Error(`apify ${actorId} start: HTTP ${started.status}`);
  const run = (await started.json()).data;

  const deadline = Date.now() + RUN_TIMEOUT_MS;
  let status = run.status as string;
  while (["READY", "RUNNING"].includes(status)) {
    if (Date.now() > deadline) throw new Error(`apify ${actorId}: run timed out`);
    await sleep(POLL_MS);
    const res = await fetch(`${BASE}/actor-runs/${run.id}?token=${token}`);
    if (!res.ok) throw new Error(`apify ${actorId} poll: HTTP ${res.status}`);
    const data = (await res.json()).data;
    status = data.status;
    // Surface the real cost once per run — the store pages only say "from $X".
    if (!["READY", "RUNNING"].includes(status) && typeof data.usageTotalUsd === "number") {
      console.log(`[apify] ${actorId}: $${data.usageTotalUsd.toFixed(4)} (${status})`);
    }
  }
  if (status !== "SUCCEEDED") throw new Error(`apify ${actorId} ended: ${status}`);

  const items = await fetch(
    `${BASE}/datasets/${run.defaultDatasetId}/items?token=${token}&format=json&clean=true`,
  );
  if (!items.ok) throw new Error(`apify ${actorId} dataset: HTTP ${items.status}`);
  return (await items.json()) as T[];
}
