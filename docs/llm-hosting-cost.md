# LLM hosting cost: rent a GPU vs. pay per token

Research date: 2026-09-04. Quality floor (fixed, non-negotiable): **Qwen3.8-27B dense (Q4_K_M)**. Every
number below was fetched from the provider's own page this run; a page that would not render or return
data is marked *unreachable* with the actual error, not filled from memory. FOUND = read directly.
INFERRED = our arithmetic on found numbers.

**Workload (fixed, do not re-derive):** ~1,573 input + ~250 output tokens/call (86.3%/13.7% split).
Backlog = 106,140 calls = 196M tokens (169.1M in / 26.9M out). Ongoing = 1,140 calls/day = 63M
tokens/month (54.4M in / 8.6M out). Batch-shaped, latency-tolerant — nothing is user-facing.

---

## 1. Rented GPU (single 24GB-class card: RTX 4090 / A10G / L4 class)

| Provider | GPU | VRAM | $/hr | Stability | $/month |
|---|---|---|---|---|---|
| RunPod (Secure Cloud) | RTX A5000 | 24GB | $0.27 | on-demand, stable | $197.10 *(inferred, ×730)* |
| RunPod (Community Cloud) | RTX 4090 | 24GB | $0.34 | spot/preemptible, can be reclaimed | $248.20 *(inferred)* |
| Hetzner (GEX45, dedicated) | RTX PRO 4000 Blackwell | 24GB | ~$0.34 equiv. | dedicated monthly, stable (not hourly billing) | $249 flat *(third-party citation of Hetzner's own announced price — Hetzner's own page would not render numeric values to fetch)* |
| Vast.ai (marketplace) | RTX 4090 | 24GB | ~$0.29–0.59 typical, $0.09–0.31 spot | auction marketplace, variable/interruptible | ~$292 *(inferred midpoint, unstable — vast.ai's own pricing pages are JS-rendered and would not return live numbers to fetch; figures are third-party aggregator readings, explicitly flagged)* |
| RunPod (Secure Cloud) | RTX 4090 | 24GB | $0.74 | on-demand, stable | $540.20 *(inferred)* |
| Lambda (lambda.ai) | Quadro RTX 6000 | 24GB | $0.69 | on-demand, stable | $503.70 *(inferred)* |
| Scaleway | L4 | 24GB | $0.92 (€0.79) | on-demand, stable | $668.28 *(page states €574.87/mo directly; USD via EUR/USD≈1.1627, itself a WebSearch-sourced rate, not independently fetched)* |
| OVHcloud | L4-90 (1× L4) | 24GB | $1.00 | on-demand, stable | $720 *(stated directly on page)* |

Sources: runpod.io/pricing, runpod.io/gpu-models/rtx-4090, vast.ai/pricing (unreachable for live numbers;
figures from synpixcloud.com blog + aggregated WebSearch results, third-party), lambda.ai/pricing,
hetzner.com/dedicated-rootserver/gex45 (unreachable for price; figure from itbrief.com.au reporting
Hetzner's own announcement), scaleway.com/en/pricing/gpu, us.ovhcloud.com/public-cloud/prices — all read
2026-09-04.

**Duty-cycle honesty check — corrected.** An earlier pass in this document used a 20–40 tok/s placeholder
that turned out to be measured on the *user's own laptop running the model on CPU* (6GB VRAM, 2.5GB
resident, ~0% GPU utilization) — not on a rented 24GB card, where the whole model fits in VRAM. That
number was wrong and has been replaced below with measured GPU-server benchmarks.

**Measured throughput (2026-09-04).** No public benchmark directly measures continuous-batched throughput
for a Q4 27–32B dense model on a single 24GB card — a real gap, not papered over. The best-supported
numbers assembled from actual fetched sources:
- **Decode, batch≈1: 35 tok/s**, the direct average of four measured Q4/GGUF 27–34B-dense models on an
  RTX 4090 24GB (Qwen2.5-32B 34.39, Gemma2-27B 37.97, QWQ-32B 31.80, LLaVA-34B 36.67 tok/s) —
  databasemart.com/blog/ollama-gpu-benchmark-rtx4090, read 2026-09-04.
- **Prefill, batch≈1: ~2,800 tok/s** — inferred by scaling llama.cpp's own measured Llama-2-7B-Q4_0 pp512
  prefill throughput (11,992.70 tok/s, RTX 4090) down by parameter-count ratio to 27–32B —
  github.com/ggml-org/llama.cpp/discussions/15013, read 2026-09-04. Cross-checked by scaling the same
  source's decode number (186.21 tok/s) by weight-byte ratio, which independently lands on ~35–38 tok/s
  decode, converging with the direct measurement above.
- **Batched-decode upside is genuinely uncertain.** The only same-GPU (RTX 4090) data point close to our
  VRAM situation is vLLM's own benchmark of Gemma-2-9B (FP16, ~18GB weights — comparably close to the 24GB
  ceiling as our 18.5GB Q4 target), which shows roughly a 10x batching multiplier over its own batch-1
  floor at 300 concurrent requests (databasemart.com/blog/vllm-gpu-benchmark-rtx4090, read 2026-09-04).
  Applying that multiplier speculatively gives ~360 tok/s decode — but it is not measured for this exact
  model class + quantization + GPU, and Q4 27–34B weights already consume 78–92% of a 24GB card's VRAM per
  the Ollama benchmark above, leaving little headroom for the KV cache that batching needs. **We report two
  scenarios rather than picking the favorable one:**

| Scenario | Prefill | Decode | Basis |
|---|---|---|---|
| **A — measured floor (use this to budget)** | 2,800 tok/s | 35 tok/s | directly measured, batch≈1 |
| **B — inferred batching upside (unverified for this config)** | 2,800 tok/s | 360 tok/s | ~10x multiplier borrowed from an analogous same-GPU case, not this model class |

**GPU-hours and cost, at 86.3%/13.7% input/output split** (backlog 169.1M in / 26.9M out; monthly 54.4M in
/ 8.6M out; GPU-seconds = input/prefill_tok_s + output/decode_tok_s):

| | Backlog GPU-hours | Backlog cost (RunPod A5000 $0.27/hr, metered) | Backlog cost (OVHcloud L4-90 $1.00/hr) | Monthly GPU-hours | Monthly cost (RunPod A5000) | Monthly cost (OVHcloud) |
|---|---|---|---|---|---|---|
| Scenario A | 230.3h | **$62.18** | $230.30 | 73.7h | **$19.90** | $73.70 |
| Scenario B | 37.5h | $10.13 | $37.50 | 12.0h | $3.24 | $12.00 |

This flips the framing of the table above: those $197–720/month figures assume the box runs **24/7 flat**
(730 billed hours regardless of use). But RunPod's Secure Cloud (and most on-demand providers) bill
per-second/minute *while a pod is running* — nothing requires leaving it up around the clock. Since our
queue is explicitly batch-shaped and latency-tolerant, a pod can be started when work arrives and stopped
when it drains. Under that operating model, metered actual usage (Scenario A: 73.7 GPU-hours/month) on the
cheapest stable rental (RunPod A5000, $0.27/hr) costs **~$19.90/month ongoing, ~$62.18 for the whole
backlog** — far below the flat-24/7 figures in the table, and below every free-tier-augmented API price in
Section 3. The tradeoff is operational: this requires scripting pod start/stop around the queue (something
a managed serverless platform, Section 5, does automatically) rather than the zero-effort "just leave it
running" model the flat-rate figures assumed. Hetzner's flat $249/month plan is a poor fit at this low a
utilization (12–74 GPU-hours/month out of 730 available) unless the box is also doing other work.

---

## 2. API per token — models at/above the 27B-dense floor

Backlog = 196M tokens (169.1M in / 26.9M out) · Monthly = 63M tokens (54.4M in / 8.6M out). All $/M USD.

| Provider · model | $/M in | $/M out | Backlog (196M) | Monthly (63M) | Note |
|---|---|---|---|---|---|
| **Cerebras · Qwen3.8-27B** | $0.99 | $1.49 | **$207.48** | **$66.69** | Exact quality-floor match. Provider labels it "Preview... not intended for use in production environments." |
| **Groq · Qwen3.8-27B** | $0.80 | $4.00 | $242.81 | $78.05 | Exact quality-floor match. Same "Preview" caveat. |
| DeepSeek · V4-Pro (off-peak, 01:00–04:00 & 06:00–10:00 UTC Mon–Fri) | $0.66 | $1.98 | $164.84 | $52.98 | 1.6T total / 49B active MoE, not dense; MMLU-Pro 82.9–87.5, GPQA-D 72.9–90.1 per own model card — no controlled 27B-dense comparison. |
| DeepSeek · V4-Pro (peak) | $1.32 | $3.96 | $329.68 | $105.97 | same model, peak-hours rate |
| DashScope · Qwen3.7-Plus (promo, 20% off) | $0.40 | $1.60 | $110.65 | $35.57 | Alibaba's own promo rate, not guaranteed permanent |
| Zhipu/Z.ai · GLM-4.6 | $0.60 | $2.20 | $160.61 | $51.62 | 357B total / 32B active MoE — active-param count close to 27–32B dense but no verbatim benchmark table could be pulled this run |
| Mistral · Large 3 | $0.50 | $1.50 | $124.88 | $40.14 | |
| Google · Gemini 2.5 Flash | $0.30 | $2.50 | $117.93 | $37.91 | |
| Google · Gemini 3.7/3.8 Flash (promo through 2026-12-31) | $0.75 | $3.75 | $227.64 | $73.17 | rises to $1.50/$7.50 from 2027-01-01 |
| OpenAI · gpt-5.6-luna (short context) | $0.20 | $1.20 | $66.08 | $21.24 | positional "mini" analog; page does not use a "mini" label — flagged as inference, not a page-stated fact |
| Anthropic · Claude Haiku 4.5 | $1.00 | $5.00 | $303.52 | $97.56 | |
| Together · Llama 3.3 70B | $1.04 | $1.04 | $203.84 | $65.52 | |
| Together / Groq / Fireworks · GPT-OSS-120B | $0.15 | $0.60 | **$41.50** | **$13.34** | Cheapest of all. MoE, quality vs. the dense-27B floor **not verified** in this research — flag before using. |
| Fireworks · Qwen3.8 Max | $2.00 | $6.00 | $499.52 | $160.56 | |
| DashScope · Qwen3.8-Max | $2.00 | $6.00 | $499.52 | $160.56 | |
| Moonshot · Kimi K2.6 (cache miss) | $0.95 | $4.00 | $268.18 | $86.20 | 1T total / 32B active MoE (K2 gen); own paper MMLU-Pro 81.1, GPQA-D 75.1, IFEval 89.8 |
| Fireworks / Together · Kimi K3 | $3.00 | $15.00 | $910.55 | $292.68 | most expensive found |
| Mistral · Medium 3.5 | $1.50 | $7.50 | $455.27 | $146.34 | |
| Fireworks/Together · GLM-5.3 | $1.40 | $4.40 | $355.04 | $114.12 | |

Sources (all read 2026-09-04): console.groq.com/docs/models, cerebras.ai/pricing, api-docs.deepseek.com/quick_start/pricing,
www.together.ai/pricing, docs.fireworks.ai/serverless/pricing, ai.google.dev/gemini-api/docs/pricing,
claude.com/pricing, developers.openai.com/api/docs/pricing, mistral.ai/pricing/api,
alibabacloud.com/help/en/model-studio/model-pricing, platform.kimi.ai/docs/pricing/chat-k26,
docs.z.ai/guides/overview/pricing. Unreachable: groq.com/pricing (redirects to marketing page, worked
around via console docs), platform.deepseek.com/api-docs/pricing (403, worked around via
api-docs.deepseek.com), openai.com/api/pricing/ (403, worked around via developers.openai.com),
open.bigmodel.cn/pricing (geo-restricted, used docs.z.ai international page instead).

---

## 3. Free tiers

| Provider · model | RPM | RPD | TPD | Trains on free data? | Carries 1,140 calls/day? | Backlog (106,140 calls) time |
|---|---|---|---|---|---|---|
| **Cerebras · qwen-3.8-27b** (quality-floor match) | 5 | — | 1,000,000 | not stated on fetched page | No — ~548 calls/day capacity (48% of need) | ~193.5 days |
| Groq · qwen/qwen3.8-27b (quality-floor match) | 30 | 1,000 | 200,000 | not stated | No — ~109 calls/day capacity (~10%) | ~967 days |
| Moonshot/Kimi · Tier 0 ($1 min. recharge — not truly $0) | 3 | — | 1,500,000 | not stated | No — ~822 calls/day (72%); Tier 1 ($10 spent) removes the cap entirely | ~129 days at Tier 0; <1 day at Tier 1 |
| OpenRouter `:free` models | 20 | 50 (unfunded) / 1,000 ($10+ lifetime spend) | — | not checked this run | No, even funded (1,000 < 1,140) | ~2,123 days unfunded; ~106 days funded. Current `:free` catalog has no confirmed 27B-dense-class model — active params seen were 3.6B–12B (MoE), quality floor unverified. |
| Google AI Studio / Gemini | not published on static docs (viewable only after console login) | unresolved | unresolved | **Yes — confirmed**: "Google uses the content you submit... to provide, improve, and develop Google products... and machine learning technologies" (free/unpaid tier only; paid tier explicitly excluded) | unresolved | unresolved |
| Mistral (La Plateforme) | not published on static docs (admin-console-gated) | unresolved | unresolved | unresolved | unresolved | unresolved |
| Zhipu · GLM-4.5-Flash / GLM-4.7-Flash | unconfirmed (third-party claims "1 concurrent," not verified on official pages) | not published | not published, priced "Free" | not checked this run | unresolved — no throughput ceiling found | unresolved |
| Alibaba DashScope | not published | — | 1,000,000 tokens **one-time**, 90-day expiry, per eligible model, Singapore/International endpoint only | not checked this run | No — one-time pool ≈ 548 calls total | covers ~0.5% of the backlog, then gone |
| DeepSeek | no RPM/RPD/TPD published; only concurrency caps (500–2,500 connections) on a **paid** API | — | — | n/a — no confirmed free tier | No confirmed free tier at all | n/a |
| Together AI | no free tier, trial credits, or free model found on any fetched page | — | — | n/a | No | n/a |

Sources (all read 2026-09-04): console.groq.com/docs/rate-limits, inference-docs.cerebras.ai/support/rate-limits,
ai.google.dev/gemini-api/docs/rate-limits, ai.google.dev/gemini-api/terms, docs.mistral.ai/admin/user-management-finops/tier,
openrouter.ai/docs/api-reference/limits, openrouter.ai/api/v1/models, www.together.ai/pricing,
docs.together.ai/docs/faq (404), api-docs.deepseek.com/quick_start/rate_limit, api-docs.deepseek.com/quick_start/pricing,
platform.deepseek.com/api-docs/rate-limits (403, unreachable), www.alibabacloud.com/help/en/model-studio/new-free-quota,
docs.z.ai/guides/overview/pricing, docs.bigmodel.cn/cn/guide/models/free/glm-4.7-flash, platform.kimi.ai/docs/pricing/limits.

**Bottom line on free tiers:** none of the providers with confirmed numbers (Cerebras, Groq, OpenRouter,
Kimi) can fully cover the 1,140 calls/day ongoing need for $0. **Cerebras's `qwen-3.8-27b` free tier is
the standout** — it's the exact quality-floor model, genuinely $0, and covers 48% of daily ongoing need
outright; the rest would need to spill onto Cerebras's paid rate ($0.99/$1.49 per M, already the cheapest
paid floor-quality option in Section 2). Google Gemini and Mistral free-tier throughput is simply
unpublished — unresolved, not zero; would require console login to confirm. Gemini's free tier is
confirmed to train on submitted data, which may itself be a reason to avoid it regardless of throughput.

---

## 4. Cheap Chinese providers — price vs. quality evidence

Full detail from the research pass; summarized here.

| Provider · flagship | Architecture | $/M in / out | Own benchmark numbers (FOUND) | Independent comparison to ~27–32B dense found? |
|---|---|---|---|---|
| DeepSeek V4-Pro | 1.6T total / 49B active MoE | $0.66–1.32 / $1.98–3.96 | MMLU-Pro 82.9–87.5, GPQA-D 72.9–90.1 (huggingface.co/deepseek-ai/DeepSeek-V4-Pro model card, depending on reasoning-effort mode) | No controlled parameter-matched comparison found. |
| Alibaba Qwen3-32B (dense, DashScope) | 32B dense | $0.16 / $0.64 | — | On Artificial Analysis's own Intelligence Index (artificialanalysis.ai, fetched), Alibaba's own **dense** ~27–31B models (Qwen3.6/3.8-27B, scores 31–52 across effort tiers) score **at or above** Alibaba's large MoE flagship Qwen3-235B-A22B (score 30) — i.e. Alibaba's big MoE does not clearly beat Alibaba's own dense 27B sibling on this one independent index. This is the single most direct same-vendor data point found. |
| Moonshot Kimi K2 (K2.5/K3 priced) | 1T total / 32B active MoE | K2.6 $0.95/$4.00 | K2 (older gen) MMLU-Pro 81.1, GPQA-D 75.1, IFEval 89.8 (arxiv 2507.20534) | Artificial Analysis: Kimi K2.5 scores 47 — above Qwen3.6-27B's low-effort tier (31–38) but not clearly above Qwen3.8-27B-xhigh (52). Numbers mix model versions (K2 paper vs. K2.5 leaderboard, K2.6 pricing) — not apples-to-apples. |
| Zhipu GLM-4.6 | 357B total / 32B active MoE | $0.60 / $2.20 | Benchmark table on huggingface.co/zai-org/GLM-4.6 is an **image**, not extractable text — no verbatim number obtained this run despite two attempts. | Genuine evidence gap — not a finding either way. |
| MiniMax M2.7 | 229.9B total / **9.8B active** MoE | $0.30 / $1.20 | GPQA-Diamond 89.8 (own technical report, arxiv 2605.26494) — very high for only 9.8B active params | Artificial Analysis Intelligence Index score of 50 reported only via WebSearch summary, **not independently fetched-and-quoted** — flagged as lower-confidence than other rows here. |

**What's measured vs. marketing:** every one of these flagship models is a large MoE with far more active
parameters than 27B (except MiniMax, which has fewer). None of the five providers publishes a controlled,
same-harness benchmark run pitting their model against Qwen3-32B / Gemma-27B / Mistral-Small-24B. The one
genuinely useful data point is the Alibaba same-vendor comparison above, because it's apples-to-apples
within one benchmark index. Everything else is "a bigger/different-shaped model scores well on general
benchmarks" — suggestive, not proof, for JobRadar's specific structured-judgment task (score + one-line
verdict on a job posting).

Sources (all read 2026-09-04): api-docs.deepseek.com/quick_start/pricing, huggingface.co/deepseek-ai/DeepSeek-V4-Pro,
arxiv.org/html/2606.19348v1, www.alibabacloud.com/help/en/model-studio/model-pricing, qwenlm.github.io/blog/qwen3/,
artificialanalysis.ai/models/open-source/small, artificialanalysis.ai/articles/sub-32b-open-weights,
platform.kimi.ai/docs/pricing/chat-k3, arxiv.org/html/2507.20534, docs.z.ai/guides/overview/pricing,
huggingface.co/zai-org/GLM-4.6, arxiv.org/pdf/2508.06471, platform.minimax.io/docs/guides/pricing-paygo.md,
arxiv.org/html/2605.26494.

---

## 5. Serverless / pay-per-use GPU

The two options above bill either for wall-clock hours (Section 1) or for tokens through someone else's
model (Section 2). Serverless GPU sits between them: pay per second of actual compute, with the platform
scaling to zero between requests — a plausible fit for a workload that's idle most of the day. The catch
is cold starts: if the platform reloads the full model on every request, that eats the savings.

**Throughput assumption — corrected.** The 25 tok/s figure used in an earlier pass of this section was
measured on the user's own laptop CPU (not a GPU server) and has been replaced; full derivation and
sourcing is in Section 1. Two scenarios carry through:
- **Scenario A (measured floor, use to budget):** 35 tok/s decode, 2,800 tok/s prefill — directly measured
  on Q4/GGUF 27–34B-dense models on an RTX 4090, batch≈1.
- **Scenario B (inferred batching upside, unverified for this exact config):** 360 tok/s decode, same
  prefill — a ~10x multiplier borrowed from an analogous same-GPU vLLM case, not measured for this model
  class/quant/GPU combination.

GPU-seconds needed (86.3%/13.7% in/out split): backlog (169.1M in / 26.9M out) = **829,080s (Scenario A)**
or **135,000s (Scenario B)**; monthly (54.4M in / 8.6M out) = **265,320s (A)** or **43,200s (B)**. These
replace the entire table below, which used the flawed 25 tok/s figure in an earlier version of this
document.

| Platform | 24GB-class GPU | $/sec | Backlog, Scenario A | Backlog, Scenario B | Monthly, Scenario A | Monthly, Scenario B | Cold start | Warm between requests? |
|---|---|---|---|---|---|---|---|---|
| RunPod Serverless | L4 / A5000 / 3090 / MIG-24GB | $0.0001917 | $158.92 | $25.88 | $50.86 | $8.28 | not stated numerically | Yes by default — FlashBoot + 5s idle timeout (configurable up) |
| Beam | RTX 4090 | $0.000191667 | $158.91 | $25.88 | $50.85 | $8.28 | not stated; unclear if model load is billed | Not stated — genuine gap |
| Koyeb | L4 (24GB) | $0.0001944 | $161.17 | $26.24 | $51.58 | $8.40 | 1–5s ("Deep Sleep") or 200ms ("Light Sleep") | Yes — default idle-before-sleep is 5 minutes |
| Modal | L4 | $0.000222 | $184.06 | $29.97 | $58.90 | $9.59 | container boot ~1s stated; model-weight load time not stated | Borderline — default `scaledown_window` is 60s |
| Baseten | L4 | $0.0002357 ($0.01414/min) | $195.41 | $31.82 | $62.54 | $10.18 | not stated numerically | No — scale-to-zero default; per-MINUTE billing on top |
| Fal | RTX PRO 6000 (96GB — no true 24GB tier published) | $0.0003056 | $253.36 | $41.26 | $81.09 | $13.20 | ~6–7s for ~20GB of weights (FlashPack) — the one platform with a real number | Borderline — default `keep_alive` is 60s |
| Replicate | none in 20–24GB band (T4=16GB too small, next is L40S=48GB) | $0.000975 | $808.35 | $131.63 | $258.69 | $42.12 | vague — "several minutes" worst case, no lower bound stated | No — scale-to-zero default |

Sources (all read 2026-09-04): runpod.io/pricing, docs.runpod.io/serverless/pricing, docs.runpod.io/serverless/workers/flashboot,
modal.com/pricing, modal.com/docs/guide/cold-start, replicate.com/pricing, replicate.com/docs/reference/how-does-replicate-work,
fal.ai/serverless, fal.ai/learn/serverless/what-is-a-serverless-gpu-cold-start, www.baseten.co/pricing/,
docs.baseten.co/deployment/autoscaling, docs.baseten.co/performance/cold-starts (loaded but had no cold-start-duration
content), www.beam.cloud/pricing, www.koyeb.com/pricing (GPU row figures corroborated via search snippet, not a
direct page quote — flagged lower-confidence), www.koyeb.com/docs/run-and-scale/scale-to-zero. Throughput
sources: databasemart.com/blog/ollama-gpu-benchmark-rtx4090, github.com/ggml-org/llama.cpp/discussions/15013,
databasemart.com/blog/vllm-gpu-benchmark-rtx4090 — all read 2026-09-04, detailed in Section 1.

**Reading this table honestly, corrected:** with real GPU throughput, per-call compute time drops sharply
— from the earlier (wrong) 72s/call estimate to **~7.7s/call under Scenario A** (0.56s prefill + 7.14s
decode) or **~1.26s/call under Scenario B**. That reverses the earlier conclusion that cold starts don't
matter: at 72s/call a 1–7s cold start was 1–10% overhead and safely ignorable; at 7.7s/call it's
**13–90% overhead if incurred on every call**, and at 1.26s/call a cold start would dominate the cost
entirely. This makes the warm-vs-cold operating model the decisive factor, more than it was before: the
table above assumes calls are **batch-drained in one continuous warm session** (the whole backlog, or a
day's 1,140 calls, processed back-to-back with no gaps) rather than fired as isolated invocations spread
through the day. Platforms with a short default idle window (Modal 60s, Fal 60s `keep_alive`, Baseten/Replicate
scale-to-zero) would cold-start on most calls if invoked in isolation at our ~76s average call cadence,
inflating cost well above the table — only Koyeb's 5-minute default window and RunPod's tunable FlashBoot
window comfortably survive isolated, spread-out invocation without configuration changes. Compared against
Section 1, the fully-metered on-demand-rental path (start a pod, drain the queue, stop it) is cheaper than
every serverless platform here at the same throughput scenario, because none of these platforms' per-second
rates undercut RunPod's own $0.27/hr on-demand rate — serverless buys automatic scale-to-zero convenience
here, not a lower unit price.

---

## 6. Per-token endpoints for open-weight ~24–32B dense models

Between renting a card and paying a frontier-API rate sits paying per token for a specific open-weight
model in the *same size and architecture class* as the quality floor (Qwen3.8-27B dense), rather than a
much larger MoE flagship. None of the providers below serve Qwen3.8-27B itself — the closest matches found
are older Qwen3.x-27B dense releases and other ~24–32B dense open models (Gemma, Mistral-Small, Qwen3-32B).
**Quality equivalence to Qwen3.8-27B specifically is an assumption based on parameter count and
architecture family, not a verified benchmark match — flag this before relying on it.**

| Provider | Model | Params | Dense? | $/M in | $/M out | Backlog (196M tok) | Monthly (63M tok) |
|---|---|---|---|---|---|---|---|
| Deepinfra | Mistral-Small-24B-Instruct-2501 | 24B | Yes | $0.05 | $0.08 | **$10.61** | **$3.41** |
| Deepinfra | gemma-3-27b-it | 27B | Yes | $0.08 | $0.16 | $17.83 | $5.73 |
| Deepinfra | Qwen3-32B | 32B | Yes (page states "Mixture-of-Experts: No") | $0.08 | $0.28 | $21.06 | $6.76 |
| Deepinfra | gemma-4-31B-it-turbo | 30.7B | Yes | $0.09 | $0.34 | $24.37 | $7.82 |
| Novita | Gemma 3 27B | 27B | Yes (by naming; not explicitly labeled on page) | $0.119 | $0.20 | $25.50 | $8.19 |
| Deepinfra | gemma-4-31B-it | 30.7B | Yes | $0.13 | $0.38 | $32.21 | $10.34 |
| Novita | Gemma 4 31B | 30.7B | Yes | $0.14 | $0.40 | $34.43 | $11.06 |
| Together AI | Gemma 4 31B | 30.7B | Yes ("30.7B parameter dense transformer") | $0.39 | $0.97 | $92.04 | $29.56 |
| Fireworks / Together | Gemma 4 31B / Muse Glimmer 30B | 30.7B / 30B | Yes | $0.35 | $1.50 | $99.54 | $31.94 |
| Deepinfra | Qwen3.5-27B | 27B | Yes (no "-A" MoE suffix) | $0.26 | $2.60 | $113.91 | $36.50 |
| Novita | Qwen3.5 27B | 27B | Yes | $0.30 | $2.40 | $115.29 | $36.96 |
| Deepinfra | Qwen3.6-27B | 27B | Yes | $0.32 | $3.20 | $140.19 | $44.93 |
| Fireworks | Qwen3-32B (generic ">16B" tier, no per-model override) | 32.7B | Yes | $0.90 | $0.90 | $176.40 | $56.70 |
| Novita | Qwen3.6 27B | 27B | Yes | $0.60 | $3.60 | $198.30 | $63.60 |

Not shown: Together AI's "Ternary Bonsai 27B" (a 1.71-bit ternary-quantized build of Qwen3.6-27B) priced
at $0.00/M both directions — excluded from the table because a ternary quantization is not a clean
Q4_K_M-equivalent quality comparator, flagged rather than presented as a real free option. Hyperbolic could
not be evaluated: 8 URL attempts (hyperbolic.xyz/pricing, www.hyperbolic.ai/pricing, docs pages, app pages)
all returned redirects, 404s, or JS-rendered shells with no static price table — reported as unreachable,
not filled from search-snippet memory.

Sources (all read 2026-09-04): www.together.ai/pricing, together.ai/models/gemma-4-31b,
together.ai/models/muse-glimmer, together.ai/models/prism-ml-ternary-bonsai-27b, docs.fireworks.ai/serverless/pricing,
fireworks.ai/models/fireworks/qwen3-32b, fireworks.ai/models?search=gemma-4, fireworks.ai/pricing,
deepinfra.com/pricing, novita.ai/llm-api. Unreachable: hyperbolic.xyz/pricing, www.hyperbolic.ai/pricing,
docs.hyperbolic.xyz/docs/hyperbolic-pricing, app.hyperbolic.ai/pricing, www.hyperbolic.ai/inference (all
404 or redirect loops); docs.hyperbolic.ai/ and app.hyperbolic.ai/models loaded but carried no price data.

**Reading this section honestly:** Deepinfra is the standout — its dense Mistral-Small-24B backlog cost
($10.61 total, $3.41/month ongoing) undercuts every other option in this entire report, including every
free tier's paid overflow and every serverless-GPU figure in Section 5, by more than an order of magnitude.
Its dense Qwen3-32B ($21.06 backlog / $6.76/month) is the closest architecture match to the quality floor
model family and is still dramatically cheaper than Cerebras's exact-match Qwen3.8-27B ($207.48 backlog /
$66.69/month) or Groq's ($242.81 / $78.05). The gap is too large to explain by model-generation difference
alone and was not independently benchmarked in this pass — before committing to it, JobRadar should run
its own held-out rubric-scoring comparison of Deepinfra's Qwen3-32B or Mistral-Small-24B against
Qwen3.8-27B locally, since price alone does not establish that it clears the quality floor.

---

## Recommendation

**Correction note (this revision):** an earlier version of this document used a 25 tok/s throughput
placeholder for Sections 1 and 5 that was measured on the user's own laptop CPU, not a rented GPU — see
the corrected derivation in Section 1 (measured 35 tok/s decode / ~2,800 tok/s prefill on an RTX 4090,
batch≈1, with an unverified ~360 tok/s batched-decode upside scenario). That correction changes this
recommendation materially: self-hosting on a metered (start/stop, not 24/7-flat) GPU rental is now
competitive with the cheapest APIs, using the *exact* quality-floor model rather than a substitute.

**These are two different questions with two different answers — treat them separately. Sections 5 and 6,
plus the throughput correction to Section 1, change the picture: the cheapest options are no longer the
flat-24/7-rental or frontier-API numbers from the original Sections 1–2 — they're metered self-hosting and
the open-weight per-token endpoints in Section 6, each with its own caveat attached.**

**Three options now cluster together, each with a different caveat — no single one is free of one:**

| Option | Backlog | Monthly | Caveat |
|---|---|---|---|
| Self-hosted, metered on-demand GPU (RunPod A5000 $0.27/hr, Scenario A — measured floor) | **$62.18** | **$19.90** | Exact quality-floor model (no substitution risk), but requires scripting pod start/stop around the queue instead of a managed API; Scenario B (unverified batching upside) would drop this to $10.13 / $3.24 |
| Deepinfra dense Qwen3-32B (per-token, open weight) | $21.06 | $6.76 | Cheapest, zero ops burden, but a different (older, larger) dense model — quality parity with Qwen3.8-27B was not independently benchmarked in this research |
| Cerebras Qwen3.8-27B (paid API, exact match) | $207.48 | $66.69 (partly offset by a free tier covering ~48% of daily volume) | Exact quality-floor model, zero ops burden, but Cerebras's own docs label it "Preview... not intended for use in production" |

**Backlog (106,140 calls, one-off, want it done and gone):** Under the conservative, actually-measured
Scenario A throughput, self-hosting on a metered on-demand GPU ($62.18) is now cheaper than the exact-match
API (Cerebras, $207.48) and carries none of that option's "Preview" risk or Deepinfra's quality-substitution
risk — it's literally the floor model running on rented hardware you control. It requires operational
setup (a script or small harness that boots the pod, points the queue at it, and tears it down when
drained) that a managed API doesn't. If that setup cost is acceptable, this is the recommended backlog
path. Deepinfra remains cheaper in raw dollars ($21.06) but needs a held-out quality check first (a few
hundred labeled postings scored both ways) before trusting it with the whole backlog. Managed serverless
GPU (Section 5) is not competitive for the backlog at either scenario — its per-second rates don't
undercut RunPod's own on-demand hourly rate, so it only adds convenience, not savings, and the cheapest
serverless option (RunPod Serverless, $158.92 at Scenario A) still costs ~2.5x the self-managed on-demand
path for the identical GPU class.

**Steady-state (63M tokens/month forever):** Same ranking. Self-hosted metered ($19.90/month, Scenario A)
beats Cerebras's paid+free-tier-blended cost ($66.69/month) by ~3x while running the exact floor model,
provided the low, batch-shaped call volume (~1,140/day, ~7.7s of GPU compute each under Scenario A) is
actually drained in one or a few daily warm sessions rather than fired as isolated triggers — see Section
5's note on why cold-start-vs-compute-time now matters more than it did under the old throughput estimate.
Deepinfra remains the cheapest number on paper ($6.76/month) contingent on the same quality check.
Every 24/7-flat GPU rental ($197–720/month) and every managed serverless platform (~$483–770/month at
worst-case Scenario A) is now dominated by the metered self-host path — those higher figures only make
sense if the box needs to be instantly available with zero cold-start risk at all times, which this
workload (explicitly latency-tolerant, queue-shaped) does not require.

**Caveat that applies across the board:** if the operational overhead of self-managed GPU start/stop is
unwanted and Deepinfra's quality can't be confirmed, Cerebras's "Preview" label is a real but probably
acceptable risk given the price gap to the next honest alternative — DeepSeek V4-Pro off-peak ($164.84
backlog / $52.98/month, real if not parameter-matched benchmark strength) or GPT-OSS-120B ($41.50 backlog
/ $13.34/month, cheapest of all, but quality against the 27B-dense floor was not verified in this research
and should not be assumed).

## Correction, 2026-09-04 — the payload was described wrong, twice over

Every cost in this file was computed from a workload brief I wrote, and the
brief understated our own payload. Two corrections, and the second matters
more than the arithmetic.

**Volume is roughly double.** The brief said ~1,573 input tokens: a job
description plus a short rubric. It omitted `CV_CONTEXT`, which `llm/fit.ts`
puts in every judge call — the user's full CV, measured at 6,968 characters,
about 1,742 tokens. Real per-call input is therefore ~3,315, and with ~250
generated the totals become:

  * backlog: 106,140 calls ≈ **378M tokens**, not 196M
  * ongoing: ~1,140/day ≈ **122M tokens/month**, not 63M

Multiply every figure in the tables above by roughly two. The RANKING is
unaffected — all options scale together — but the absolute numbers are not:
Deepinfra ≈ $42 backlog / $13 month, self-hosted metered GPU ≈ $124 / $40,
Cerebras ≈ $414 / $134.

**Privacy is a first-order constraint, not a footnote.** Because the CV goes
out with every call, this workload is not "public job postings" as the brief
implied. It is a named person's employment history, leaving the machine on
every judgement. That reorders the options independently of price:

  * A provider that trains on inputs with no opt-out is disqualified for this
    lane whatever it costs — see the StepFun entry in
    [llm-china-options.md](llm-china-options.md).
  * An explicit no-training guarantee stops being a nicety and becomes a
    feature worth paying for.
  * Self-hosting moves from "most expensive of three" to "the one where the
    data never leaves", which is a different kind of argument than cost.

The cheapest option that clears both bars is no longer obviously the cheapest
option overall, and that is the honest state of this analysis.

## Owner's decision, 2026-09-04: the CV leaving the machine is acceptable

The correction above raised data handling to a first-order constraint, on the
grounds that every judge call carries the user's full CV. The user has since
ruled that this does not matter to them. It is their CV and their call, so the
privacy filter comes off the tables.

What that changes, concretely:

  * **StepFun is no longer disqualified.** It was ruled out for stating it may
    train on inputs with no opt-out, while being the cheapest open-weight
    option in the survey. It returns to the comparison on price and quality
    alone — where it remains unverified against the 27B floor, which is a
    different objection and still stands.
  * **Free tiers that train on inputs are usable**, which matters because
    their binding limit was always requests-per-day rather than price.
  * **Alibaba's "we will never use your data for training" stops being worth
    paying a premium for.** It is still a genuine differentiator, just not one
    that buys anything here.

What it does NOT change: self-hosting on a rented GPU still wins on cost at
this duty cycle, and the "Preview / not for production" label on the
exact-match models at Cerebras and Groq is an availability risk, not a privacy
one. Those two arguments were never about the CV.
