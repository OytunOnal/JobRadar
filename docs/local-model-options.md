# Local model options for the judge task

Research date: 2026-09-04. Machine: RTX 3060 Laptop, **6GB VRAM**, 32GB system RAM (~1GB free with
current model loaded), 16 logical CPU cores, Ollama. Current model: `qwen3.8:27b` — **confirmed** on
[ollama.com/library/qwen3.8](https://ollama.com/library/qwen3.8) (fetched) as a real, currently-shipping
tag: dense (not MoE), 27B, 18GB Q4_K_M-class weights, 256K max context. This is a distinct, recently
released (~Aug 2026) Alibaba model, not a typo for `qwen3:32b`.

**Architecture note that changes the compression math below.** Qwen3.8-27B's HuggingFace
[config.json](https://huggingface.co/Qwen/Qwen3.8-27B/raw/main/config.json) (fetched) shows a hybrid
attention design (`Qwen3_5ForConditionalGeneration`): of 64 transformer layers, only 16 (every 4th) use
full attention with a real KV cache (4 KV heads, head_dim 256); the other 48 use linear attention (Gated
DeltaNet) with a fixed-size recurrent state that does **not** grow with context length. This makes its
KV-cache footprint far smaller than a conventional 64-layer dense model — relevant to §2 below.

Task: structured judgement, ~1,573 input tokens + ~250 output tokens (≈1,823 total), 0-100 score + verdict
word + one-line reason. Batch queue, latency-insensitive, throughput/fit matters. Quality floor: must match
`qwen3.8:27b` dense Q4_K_M on this task — a quality drop is not acceptable to gain speed.

Grounding: every line below is FOUND (read on a fetched page, quoted) or INFERRED (arithmetic/deduction
from found numbers, marked as such). Vendor-reported numbers are labeled vendor; independent/third-party
measurements are labeled as such. Anything not independently fetched is marked "not verified."

---

## 1. What fits 6GB VRAM at this quality?

| Model | Total size @ Q4 | Active params | Fits 6GB alone? | Quality evidence | Verdict for our task |
|---|---|---|---|---|---|
| **qwen3.8:27b (current)** | 17-18GB (Q4_K_M) | 27B (dense) | No — only ~2.5GB fits, rest on CPU (measured baseline) | Independent (quesma.com): Q4_K_M ≈ lossless vs BF16 on GPQA Diamond/IFBench/Terminal-Bench 2.1 | Quality floor, does not fit |
| Qwen3-8B (dense) | 5.2GB — [ollama.com/library/qwen3](https://ollama.com/library/qwen3) (found) | 8B | **Yes**, fits with headroom for ~1.8K-token KV cache | No classification/judge-specific third-party benchmark found; general-purpose 8B, older Qwen3 generation (not Qwen3.8) | Fits, but no evidence it reaches 27B-dense quality — likely a real drop |
| Qwen3-14B (dense) | 9.3GB — ollama.com/library/qwen3 (found) | 14B | No, spills | Not independently benchmarked in this pass | Spills; not a fit |
| Qwen3-30B-A3B (MoE) | 19GB total — ollama.com/library/qwen3 (found) | 3.3B active — [huggingface.co/Qwen/Qwen3-30B-A3B](https://huggingface.co/Qwen/Qwen3-30B-A3B) (found: "30.5B total with 3.3B activated per token", 128 experts/8 active) | No — 19GB total weights can't sit in 6GB; only active-expert compute is small, weights still must live somewhere (mostly system RAM) | Vendor: "approaching GPT-4o." Independent (Simon Willison, hands-on): "failed entirely mid-execution" on a coding task — off-target task type, not classification | Spills; same-family successor scored below dense-27B on independent index (see below) |
| Qwen3.5/3.6-27B (dense, successor family) | Not sized in this pass | dense | No (27B-class, will not fit 6GB) | **Independent, third-party**: [artificialanalysis.ai/articles/sub-32b-open-weights](https://artificialanalysis.ai/articles/sub-32b-open-weights) (found): Qwen3.5-27B scores **42** on the AA Intelligence Index vs Qwen3.5-35B-A3B MoE at **37** — dense beats same-family MoE | Reference point: dense 27-31B models beat sub-30B-active MoE models of similar total size on this independent composite | 
| gpt-oss-20b | 14GB (MXFP4 native) — [ollama.com/library/gpt-oss](https://ollama.com/library/gpt-oss) (found: "20 billion total parameters, with the MoE weights responsible for 90+% of the total parameter count") | Not verified (exact active-param count not confirmed from a reachable primary source; OpenAI's own blog returned HTTP 403) | No, spills | **Independent** (Artificial Analysis): gpt-oss-20b-high scores **~24** on the Intelligence Index vs dense 27-31B models at 39-42 | Spills, and independently measured well below the dense-27B quality floor |
| Gemma 3 12B | 8.1GB — [ollama.com/library/gemma3](https://ollama.com/library/gemma3) (found) | 12B dense | No, spills | Not independently benchmarked for judge-task quality in this pass | Spills |
| Gemma 3 27B | 17GB — ollama.com/library/gemma3 (found) | 27B dense | No, spills heavily | Ollama page itself: "current, most capable model that runs on a single GPU" — implicitly assumes a larger single GPU than 6GB | Spills |
| Phi-4 (14B) | 9.1GB — [ollama.com/library/phi4](https://ollama.com/library/phi4) (found) | 14B dense | No, spills | Vendor (Microsoft model card): MMLU 84.8, GPQA 56.1 — vendor-reported, general benchmarks, not judge-specific | Spills; quality vs our floor unverified |
| Mistral Small 3.x (24B) | 14GB — [ollama.com/library/mistral-small](https://ollama.com/library/mistral-small) (found) | 24B dense | No, spills heavily | Vendor (mistral.ai blog): explicitly targets "a single RTX 4090" (24GB) — vendor does not claim 6GB fitness | Spills; vendor's own target hardware confirms mismatch |
| Granite 4 (small tags) | 2.1-3.3GB — [ollama.com/library/granite4](https://ollama.com/library/granite4) (found: `granite4:latest` 2.1GB, `granite4:1b` 3.3GB, `granite4:3b` 2.1GB) | 1-3B dense/hybrid | Yes, fits easily | No quality evidence found; params are far below 27B-dense class | Fits, but implausible it matches 27B-dense quality; larger Granite 4 MoE ("-h" hybrid) variant sizes not confirmed — not verified |
| Nemotron-3-Nano-30B-A3B (MoE, hybrid Mamba) | 24GB total — [ollama.com/library/nemotron-3-nano](https://ollama.com/library/nemotron-3-nano) (found: "3.5B/30B active/total") | 3.5B active | No — 24GB total, spills to RAM like Qwen3-30B-A3B | **Independent** (Artificial Analysis): scores **~24** on the Intelligence Index — below dense 27-31B (39-42) | Spills, and independently measured below the quality floor |
| Nemotron-3-Nano 4B (dense) | 2.8GB — ollama.com/library/nemotron-3-nano (found) | 4B | Yes, fits | Not benchmarked for judge-task quality in this pass | Fits, but far below 27B-dense parameter class; no quality evidence |
| DeepSeek-R1 distills (8B/14B) | Not re-sized in this pass (comparable to Qwen3/Llama dense sizes at same param count) | 8B/14B dense | 8B fits, 14B spills | Not independently benchmarked for judge-task quality in this pass | Not verified for our task |

**Bottom line on §1 (independent evidence, not vendor claims):** on the one third-party composite index
that was fetched (Artificial Analysis Intelligence Index — 9-eval composite: GDPval-AA v2, τ³-Banking,
Terminal-Bench v2.1, SciCode, Humanity's Last Exam, GPQA Diamond, CritPt, AA-Omniscience, AA-LCR), no
sub-30B-active MoE model and no model that actually fits 6GB scored anywhere near the dense-27B-class
tier. **No third-party classification/LLM-judge-specific benchmark (e.g. RewardBench) was found for any
candidate in this pass** — general reasoning-index scores are the best available proxy, not a direct
measurement of the target task, and this is a real evidence gap, not a conclusion.

---

## 2. Compressing the existing 27B, instead of replacing it

Sources (all fetched, all independent/third-party on this exact model except where noted):
[quesma.com/blog/qwen38-27b-quantizations-benchmarked](https://quesma.com/blog/qwen38-27b-quantizations-benchmarked/),
[kingy.ai/blog/qwen3-8-27b-best-quantization-gguf](https://kingy.ai/blog/qwen3-8-27b-best-quantization-gguf/),
[dev.to/purpledoubled/run-qwen-38-27b-locally](https://dev.to/purpledoubled/run-qwen-38-27b-locally-real-gguf-sizes-the-kv-cache-trick-and-the-template-trap-114j),
[docs.ollama.com/faq](https://docs.ollama.com/faq).

### 2.1 Lower quantization

| Quant | Size | Quality evidence (independent) |
|---|---|---|
| BF16 | 53.8-55GB | Reference |
| Q8_0 | 29GB | ~lossless (quesma.com) |
| Q6_K | 22.9GB | Not separately flagged as lossy |
| Q5_K_M | 19.8GB | Not separately flagged as lossy |
| Q4_K_M (current) | 17-18GB | quesma.com (found): "if you go with a 4-bit quantization Q4_K_M (17GB), you won't notice a difference" on GPQA Diamond/IFBench/Terminal-Bench 2.1 — quality-verified lossless vs BF16 |
| IQ4_XS | 15.7-16.51GB | kingy.ai (found): 95.39% top-1 token agreement vs BF16 |
| Q3_K_M / IQ3_S | 13.4-13.84GB | kingy.ai (found): IQ3_S = 92.41% top-1 agreement; described as "constrained but usable" |
| UD-Q2_K_XL | 10.7GB | quesma.com (found): "slightly lower" than Q4_K_M but usable |
| IQ2_S | 11.14GB | kingy.ai (found): 87.18% top-1 agreement, KL divergence 0.098; labeled "emergency only" |
| UD-IQ2_XXS | 9.0GB | Not separately quality-tested in sources found |
| UD-IQ1_S/M (1-bit) | **6.2GB** | quesma.com (found, independent): scores **"around random guessing (~50%)"** on GPQA Diamond — **directly contradicts** the vendor (Unsloth) claim of "72% top-1% accuracy retained" at 1-bit |

**None of the quality-preserving tiers fit 6GB.** The smallest tier with independently-verified
"usable/constrained" quality (Q3_K_M / IQ3_S, ~13.4-13.84GB) is still more than double the 6GB VRAM
budget. The only tier that is size-close to 6GB (1-bit, 6.2GB) is the one tier independently shown to
collapse to near-chance accuracy on a reasoning benchmark — a direct, measured failure of the stated
quality floor, not a vendor claim.

### 2.2 KV-cache quantization (OLLAMA_KV_CACHE_TYPE q8_0 / q4_0)

Ollama docs ([docs.ollama.com/faq](https://docs.ollama.com/faq), fetched): "f16: high precision and memory
usage (default)"; "q8_0: 8-bit quantization, uses approximately 1/2 the memory of f16"; "q4_0: 4-bit
quantization, uses approximately 1/4 the memory of f16." This is a global Ollama daemon setting and
requires flash attention enabled.

Because of Qwen3.8-27B's hybrid attention architecture (§ intro), only 16 of 64 layers pay a real
per-token KV-cache cost. dev.to (fetched) computed and the kingy.ai spec page independently corroborated:
**64KB of KV cache per token at f16** (vs. ~256KB/token for a conventional 64-layer dense model of similar
size — confirmed by contrast against `qwen3:32b`'s config on
[ollama.com/library/qwen3/tags](https://ollama.com/library/qwen3/tags), found: 8 KV heads × 128 head_dim ×
64 layers = 256KB/token).

**Arithmetic for our workload** (1,573 in + 250 out ≈ 1,823 tokens):

- @ f16: 64KB × 1,823 ≈ 116.7 MB ≈ **0.114 GB**
- @ q8_0: ≈ **0.057 GB**
- @ q4_0: ≈ **0.029 GB**

KV cache at our actual context length was never close to the constraint — quantizing it saves at most
~85MB. The weight file (17-18GB) needs to shrink by ~11-12GB to fit 6GB; KV-cache quantization cannot
touch that gap. (For reference, even at the model's full 256K context, KV cache tops out around
16.4GB per dev.to's table — still a context-length lever, just not the one that matters here.)

### 2.3 Smaller context window (num_ctx)

Confirmed by the arithmetic above: KV cache scales linearly with context length for the 16 full-attention
layers. Since we already only need ~1.8K tokens against a model configured for far more headroom, trimming
`num_ctx` saves a KV-cache amount that was already under 120MB — negligible next to the weight-size gap.

### 2.4 Partial GPU offload tuning (num_gpu)

`num_gpu` (Ollama's wrapper around llama.cpp's `--n-gpu-layers`) controls how many transformer layers are
placed on GPU vs CPU. This is a real, documented lever, but it does not change how much of the 17-18GB
weight file must exist somewhere — it only chooses which ~2.5GB slice sits in VRAM vs which ~15GB sits in
system RAM. **This is already the mechanism running today**, per the task brief's own measured baseline
(2.5GB in VRAM, rest in system RAM, GPU 0% utilized, CPU 80%). Tuning `num_gpu` further cannot fix a model
that is roughly 3x too large for the card at any quality-preserving quant. (The exact GitHub source for
`num_gpu` semantics was found only via a WebSearch snippet, not independently fetched in this pass —
flagged as not fully verified, though consistent with long-standing llama.cpp behavior.)

### 2.5 Verdict on compression

**No.** No quantization level of `qwen3.8:27b` that has independently verified quality-preserving behavior
fits 6GB VRAM. The gap is roughly 2x at the smallest usable tier (Q3_K_M/IQ3_S, ~13.4-13.84GB vs 6GB
available) and the only tier that would fit (1-bit, 6.2GB) is independently measured to collapse to
near-random accuracy on a reasoning benchmark. KV-cache quantization, context trimming, and offload tuning
are real Ollama features but do not address the actual bottleneck for this model, which is 100% weight
size against VRAM — KV cache at our ~1,800-token workload was already under 120MB before touching any of
these levers.

---

## 3. What would actually be faster here?

Baseline to beat: current measured behavior — 2.5GB of 17-18GB resident in VRAM, rest on CPU, GPU 0%
utilized, CPU 80%, 0.97GB system RAM free, throughput degrades 84% under concurrent load.

**Full-GPU-residency reference points found (fully independent, fetched):**

- **Exact model match** — Qwen3.8-27B fully GPU-resident across 32GB VRAM (2×RTX 5060 Ti 16GB), from
  [overbring.com/blog/2026-08-17-qwen3-8-27b-wall-clock](https://overbring.com/blog/2026-08-17-qwen3-8-27b-wall-clock/)
  (fetched): UD-Q4_K_XL quant averaged **33.34 tok/s** (range 31-35, max 45); Q6_K averaged 25.27 tok/s;
  NVFP4 averaged 26.58 tok/s. This is the ceiling for the current model even with full GPU residency on
  hardware we don't have — useful only as an upper bound.
- **8B dense, fully resident, 6-8GB-class cards**: RTX 3060 12GB desktop (not the laptop 6GB variant) —
  [localscore.ai/accelerator/43](https://www.localscore.ai/accelerator/43) (fetched): Llama 3.1 8B Q4_K_M
  = **51.6 tok/s**; RTX 3060 Ti 8GB —
  [databasemart.com/blog/ollama-gpu-benchmark-rtx3060ti](https://www.databasemart.com/blog/ollama-gpu-benchmark-rtx3060ti)
  (fetched): Llama 3.1 8B = **57.34 tok/s**, Mistral 7B = 71.16 tok/s, Qwen2 7B = 63.73 tok/s. A WebSearch
  snippet (not independently fetched, **not verified**) put the RTX 3060 **Laptop** (our exact card, 6GB)
  at ~40.8 tok/s on Llama 3.1 8B Q4_K_M.
- **12-14B dense on 8-12GB cards, still fully or mostly resident**: RTX 3060 12GB desktop —
  localscore.ai (fetched): Qwen2.5 14B = **26.4 tok/s**. RTX 3060 Ti 8GB — databasemart.com (fetched):
  12-13B-class models (StableLM2 12B, Llama2 13B) drop to **9.25-18.73 tok/s** even on an 8GB card — a
  sharp cliff once model size approaches the VRAM ceiling, consistent with partial spillover starting
  even before a model is fully off the card.
- **CPU-only baseline** — [ggml-org/llama.cpp discussions#3847](https://github.com/ggml-org/llama.cpp/discussions/3847)
  (fetched): CPU-only (Ryzen 5700G) on a 7B model = **11 tok/s**; the same class of model fully offloaded
  to a cheap 8GB GPU (RX 6600) = **33 tok/s** — roughly 3x from GPU residency alone at the 7-8B tier. No
  directly-measured 27-32B CPU-only figure was found in this pass despite searching; a downward
  extrapolation from the 3-13B → 8-15 tok/s CPU range suggests **~4-8 tok/s** for a 27B dense model
  CPU-heavy — **not verified**, extrapolation only.
- **MoE partial-offload degradation** (same-family successor, RTX 3090 24GB) —
  [gilesthomas.com/2026/07/benchmarking-qwen-3-6-35b-moe-rtx-3090](https://www.gilesthomas.com/2026/07/benchmarking-qwen-3-6-35b-moe-rtx-3090)
  (fetched): Qwen3.6-35B-A3B fully GPU-resident = 120-140 tok/s; with only 10-12 of ~48 layers offloaded to
  CPU, generation drops to **65-89 tok/s** — MoE throughput degrades sharply the moment any expert weight
  has to live in system RAM. Since a 30B+-class A3B MoE (17-24GB total) cannot come close to fitting our
  6GB card, essentially the whole model would sit in system RAM with only a handful of layers offloaded —
  by extrapolation from this curve, throughput on our 6GB card would likely be well below the 65-89 tok/s
  seen with 10-12/~48 layers offloaded on a 3090, plausibly closer to CPU-bound speeds — **not
  independently measured on 6GB, not verified**.
- A separate Ollama GitHub issue ([ollama/ollama#10458](https://github.com/ollama/ollama/issues/10458),
  fetched) found Qwen3-30B-A3B hit only **~30 tok/s even fully GPU-resident on a 24GB RTX 4090**, due to a
  reported low-GPU-utilization bug ("my 4090 is only running at ~120w, really low utilization") — a
  known Ollama-specific ceiling, not a fundamental hardware limit, but a caution against assuming MoE
  models automatically hit their theoretical speed on Ollama today.

**Batching, since our workload is a latency-insensitive queue:**
[jangwook.net](https://jangwook.net/en/blog/en/local-llm-concurrent-requests-num-parallel-experiment/)
(fetched, measured on Apple M1 16GB unified memory with a ~4GB model — not our hardware, direction only):
raising `OLLAMA_NUM_PARALLEL` from 1 to 4 nearly doubled aggregate throughput (18.4 → 33.2 tok/s) at the
cost of roughly 2x higher per-request latency — a good trade for a background queue. A Red Hat benchmark
([developers.redhat.com](https://developers.redhat.com/articles/2025/08/08/ollama-vs-vllm-deep-dive-performance-benchmarking),
fetched, A100 40GB, not our hardware) found Ollama's own batching throughput plateaus well below vLLM even
at `OLLAMA_NUM_PARALLEL=32` — a serving-stack swap is a separate lever from a model swap, and Ollama caps
how much batching alone can buy. On our 6GB card, each parallel request needs its own KV cache slot; given
our ~1,823-token workload, realistic parallel batching is likely `OLLAMA_NUM_PARALLEL=2-3` at most —
inferred from documented per-slot KV-cache behavior, not independently measured.

**Reading of §3**: CPU-offloaded inference on a 27B dense model is a genuinely low bar (the task brief's
own measured baseline shows GPU sitting at 0% utilization). Any model that is small enough to be fully
GPU-resident on a 6GB card — meaning realistically an 8B-class dense model — is very likely to beat the
current CPU-heavy 27B on raw tokens/sec by a wide margin (40-70+ tok/s fully resident vs. an unverified
~4-8 tok/s CPU-heavy extrapolation for the 27B). The unresolved question is entirely the quality floor
(§1): no 8B-class model was independently benchmarked against the judge task in this pass.

---

## 4. Test protocol: measure agreement against the 12,886 existing judgements

Proposed protocol (reasoned from the fixed facts above, not itself a web-fetched claim):

1. **Sample.** Draw a stratified random held-out sample from the 12,886 existing judgements, stratified by
   verdict word/category and by score decile (0-10, 11-20, ... 91-100) so rare verdicts and boundary
   scores are represented, not just the dense middle of the distribution. A sample of **n ≈ 500-1,000** is
   enough for a meaningful answer: for a binary agreement-rate estimate at the conservative p=0.5 variance
   case, n=1,067 gives a ±3% margin at 95% confidence (1.96² × 0.25 / 0.03²); if true agreement is high
   (e.g. ≥0.85, the more realistic case for a competent candidate model), the same 95%/±3% target only
   needs n≈544 (1.96² × 0.85 × 0.15 / 0.03²). **n=750, stratified,** is a reasonable middle choice that
   holds the margin tight even if agreement turns out lower than hoped.
2. **Re-run.** Feed the same job posting + rubric to the candidate model for every sampled item, using the
   same input construction as production (~1,573 tokens in), and capture its score, verdict word, and
   one-line reason.
3. **Score agreement metrics** (compute both, since a 0-100 score is continuous but verdict is categorical):
   - **Verdict exact-match rate** — the fraction of sampled items where candidate verdict word ==
     reference verdict word. Threshold to count as "matches 27B": **≥90% exact match**.
   - **Score closeness** — mean absolute difference (MAD) between candidate score and reference score
     across the sample, plus the fraction of items within ±10 points (a natural tolerance band given the
     score is itself a 0-100 heuristic, not a physical measurement). Threshold: **MAD ≤ 7 points**, and
     **≥85% of items within ±10 points**.
   - **Systematic bias check** — mean *signed* difference (candidate − reference) should not be
     statistically distinguishable from 0 (paired t-test or a bootstrap 95% CI on the mean difference that
     includes 0). A candidate that is uniformly 8 points harsher or more lenient fails even if MAD looks
     acceptable, because it would silently shift every downstream threshold.
4. **"Matches 27B" = composite pass**: verdict exact-match ≥90% AND score MAD ≤7 AND no significant
   systematic bias. Failing any one of the three is a fail, even if the others pass — a model that
   nails the verdict word but is systematically miscalibrated on score (or vice versa) is not a safe swap.
5. **Manual audit of disagreements.** Pull every case where verdict differs and/or |score diff| > 15, cap
   at the first 30-50 such cases, and manually read reference reason vs. candidate reason. This
   distinguishes "candidate made a defensible judgment call the rubric doesn't clearly resolve" from
   "candidate is actually worse" — a distinction the aggregate metrics above cannot make on their own.

---

## Closing recommendation

**Compression is not viable.** No independently-verified quality-preserving quantization of `qwen3.8:27b`
fits 6GB VRAM (§2) — the gap is roughly 2x even at the smallest usable tier, and the only size-fitting
tier collapses to near-random accuracy on an independent reasoning benchmark. KV-cache quantization,
context trimming, and offload tuning were all real levers investigated and all found to be irrelevant to
the actual bottleneck (weight size, not KV cache) for this specific hybrid-attention model.

**Candidates worth actually testing, in priority order:**

1. **Qwen3-8B (dense)** — fits 6GB with headroom (5.2GB, confirmed on ollama.com/library/qwen3), and is
   very likely to be dramatically faster than the current CPU-heavy setup based on comparable 8B tok/s
   figures on similar-VRAM cards (§3, 40-70+ tok/s fully resident vs. an unverified ~4-8 tok/s CPU-heavy
   extrapolation for the 27B). Its judge-task quality against the 27B floor is completely unverified —
   this is exactly what the §4 protocol should measure first, since it's the cheapest and fastest
   candidate to disprove or confirm.
2. **Qwen3-30B-A3B / its newer -A3B-class successor** (e.g. Qwen3.5-35B-A3B) — will not fit fully in 6GB
   VRAM (19-24GB total weights) and so will still spill to system RAM, but only 3.3-3.5B active parameters
   need compute per token, which may still beat the current 27B dense CPU path even with partial offload.
   The one independent composite-benchmark data point found (Artificial Analysis) shows this class scoring
   *below* dense 27-31B models, so it is a real quality-floor risk, not a free upgrade — worth testing
   against §4's protocol specifically to see whether the quality gap is small enough to trade for speed,
   or fails outright.
3. **gpt-oss-20b** only as a lower-priority third candidate — it independently scored the lowest of the
   three on the one composite benchmark found (~24 vs 37-42 for dense 27-31B and even below the other MoE
   candidate), so it should not be tested before the first two unless both fail.

Run the §4 protocol (n≈750 stratified sample, composite pass = verdict match ≥90% + score MAD ≤7 + no
systematic bias) against candidate 1 first, since it is the fastest to fit and the fastest to disprove.
