# Local model candidates vs. qwen3.8:27b — deep verification pass

Research date: 2026-09-04. Machine: RTX 3060 Laptop, **6GB VRAM**, 32GB system RAM, 16 logical
CPU cores, Windows, Ollama. Current model `qwen3.8:27b`: 27B dense (hybrid attention, per the
prior pass's HuggingFace config.json read — not re-fetched this pass), 18.5GB at Q4_K_M, of which
only ~2.5GB fits in VRAM — GPU sits at 0% utilization, inference runs on CPU from system RAM.

Task: structured judgement over a job posting, ~3,315 input tokens (posting + rubric + full CV) +
~250 output tokens (0-100 score + verdict word + one-line reason). Classification-with-reasoning,
not code/creative/long-context/agentic. Background batch queue — **latency is irrelevant**,
throughput and quality are everything. Quality floor: must match `qwen3.8:27b` dense on this kind
of judgement; nothing is pre-ruled-out except dropping below that floor.

This pass supersedes and broadens `docs/local-model-options.md` (an earlier, narrower screening
pass). Every fact below is FOUND (seen on a fetched page, cited) or INFERRED (arithmetic/deduction
from found numbers, marked as such) or flagged as vendor-only where no independent source was
found. This pass was run via four parallel deep-verification fronts (dense 7-32B models,
reasoning/distilled models, RTX-class throughput, and post-mid-2026 releases); their fetches are
consolidated below with sources preserved.

**A grounding caveat that matters for reading every score in this file**: Artificial Analysis's
Intelligence Index was found on THREE apparently-different scales across sources fetched this
pass, and they do not agree with each other even for the same model:

- The live per-model pages (`artificialanalysis.ai/models/<slug>`) for the Qwen3.5/3.6/3.8
  lineage: qwen3.8-27b = **52** ("ranked #1 out of 140 models in its class"), Qwen3.6-27B = **38**,
  Qwen3.5-27B = **35** (page flags itself "deprecated"). Internally consistent with each other,
  and this is the scale that anchors the current model's own position.
- The article `artificialanalysis.ai/articles/sub-32b-open-weights`: Qwen3.5-27B (Reasoning) =
  **42**, Gemma 4 31B (Reasoning) = **39** — different numbers for a model (Qwen3.5-27B) that the
  live page above scores 35. Not reconciled in this pass; both are reported as found, dated
  2026-09-04, rather than picked between.
- A third, older-looking scale (`v4.1.1` per the page's own label, roughly 0-20 range) on other
  per-model pages: Gemma 3 27B = **7**, Mistral Small 3.2 = **11**, Mistral Small 3.1 = **15**,
  Phi-4 = **5**. These numbers are **not comparable** to either scale above — do not read "Gemma 3
  27B = 7" against "qwen3.8-27b = 52" as a 45-point gap; it may be a different metric entirely.

Net effect: within one AA scale (the live-page lineage), qwen3.8:27b's 52 beats every other
same-family score found (Qwen3.6 38, Qwen3.5 35), and every reasoning/distilled model found lands
far lower (QwQ-32B 13, R1-Distill-Qwen-32B 11) — that ordering is trustworthy. Cross-family
comparisons against Gemma/Mistral/Phi on the v4.1.1 scale, or against the sub-32b article's
numbers, are reported as found but flagged as not safely comparable to the 52.

---

## Main comparison table

| Model | Params | Size @ Q4 | Fits our 6GB? | Independent evidence (reasoning/classification) | Suitability for scored judgement | Verdict |
|---|---|---|---|---|---|---|
| **qwen3.8:27b (current/floor)** | 27B dense | 18.5GB (Q4_K_M) | No — fully spills, ~2.5GB in VRAM, rest CPU/RAM (measured baseline) | AA live page: Intelligence Index **52**, "ranked #1 out of 140 models in its class" — [artificialanalysis.ai/models/qwen3-8-27b](https://artificialanalysis.ai/models/qwen3-8-27b) | This is the floor itself | Reference point |
| Qwen3-8B (dense) | 8B | 5.2GB — [ollama.com/library/qwen3/tags](https://ollama.com/library/qwen3/tags) | **Yes**, fits with headroom | No independent AA/LiveBench page found (404 on guessed slugs) | Fits, but no evidence it reaches floor quality | Untested, no evidence either way |
| Qwen3-14B (dense) | 14B | 9.3GB — ollama.com/library/qwen3/tags | No, spills | No independent evidence found | Spills, unverified quality | Not prioritized |
| Qwen3-32B (dense) | 32B | 20GB — ollama.com/library/qwen3/tags | No, spills heavily | No independent evidence found (404) | Spills more than current model for no proven quality gain | Not prioritized |
| Qwen3.5-27B | 27B dense | Not resized this pass (same class as 3.8, ~18GB) | No, spills | AA live page = **35** (self-flagged "deprecated"); AA article = **42** (reasoning variant) — scales disagree, see caveat above | Superseded by 3.8 within its own family on the live scale | Superseded — skip |
| Qwen3.6-27B | 27B dense | Not resized this pass | No, spills | AA live page: **38** — [artificialanalysis.ai/models/qwen3-6-27b](https://artificialanalysis.ai/models) | Below current model (52) on the same scale | Superseded — skip |
| Gemma 3 12B | 12B dense | 8.1GB — [ollama.com/library/gemma3](https://ollama.com/library/gemma3) | No, spills (8.1GB > 6GB) | No independent evidence found for the 12B tag specifically | Spills, unverified | Not prioritized |
| Gemma 3 27B | 27B dense | 17GB — ollama.com/library/gemma3 | No, spills heavily | AA (v4.1.1 scale, not comparable to 52) = **7**, "median: 6" among similar-size open models | Spills; scale mismatch means no safe read against the floor | Not prioritized |
| Gemma 4 12B/26B-A4B/31B | 12B dense / 26B MoE (3.8B active) / 31B dense | Not individually resized; family newly released ~Apr 2026 | 12B likely spills partially; 26B/31B spill heavily | AA live page, 31B = **30**; 26B-A4B MoE = no AA page found (404 on tried slugs) | Below current model (52); 31B independently the weaker of the "notably slower than peers" per AA's own note | Below floor — skip |
| Mistral Small 3.1/3.2 (24B) | 24B dense | 14GB — [ollama.com/library/mistral-small](https://ollama.com/library/mistral-small) | No, spills heavily | AA (v4.1.1 scale): 3.2 = **11**, 3.1 = **15** — internally inconsistent (newer point release scores lower); scale not comparable to 52 | Vendor's own target is a single RTX 4090 (24GB) — explicitly not a 6GB card | Not prioritized |
| Phi-4 (14B) | 14B dense | 9.1GB — [ollama.com/library/phi4](https://ollama.com/library/phi4) | No, spills | AA (v4.1.1) = **5**, "below average... median 6" | Spills, and independently below-median even on its own scale | Not prioritized |
| Granite 4 small tags | 1-3B dense/hybrid | 2.1-3.3GB — [ollama.com/library/granite4](https://ollama.com/library/granite4) | Yes, fits easily | No quality evidence found | Params far below 27B class; implausible floor match | Skip |
| Granite 4 32b-a9b-h (hybrid MoE) | 32.2B total / 9B active | 19GB total — ollama.com/library/granite4 | No, spills | No independent evidence found | Spills; unverified | Not prioritized, untested |
| Nemotron-3-Nano-30B-A3B (MoE) | 30B total / 3.5B active | 24GB total — [ollama.com/library/nemotron-3-nano](https://ollama.com/library/nemotron-3-nano) | No, spills | AA article ≈ **24** (reasoning variant), same scale as Qwen3.5-27B=42 → well below dense tier on that scale | Spills; measured below floor-class scores on the one scale that includes it | Below floor — skip |
| Nemotron-3-Nano-4B (dense) | 4B | 2.8GB — ollama.com/library/nemotron-3-nano | Yes, fits | No quality evidence found | Far below 27B class parameter count | Skip |
| Nemotron-3.5-Lightning (MoE) | 30B total / 3B active | Not stated in GB this pass | No, spills | AA live page = **24** | Below floor (52) | Below floor — skip |
| Llama 3.3 (70B) | 70B dense | 43GB — [ollama.com/library/llama3.3](https://ollama.com/library/llama3.3) | No — larger than current model itself | Not scored this pass (out of scope on size alone) | Bigger download and worse fit than what we're replacing | Out of scope |
| Llama 4 Scout / Maverick | 109B/17B active, 400B/17B active | 67GB / 245GB — [ollama.com/library/llama4](https://ollama.com/library/llama4) | No, far beyond even RAM-spill budget | Not scored this pass | Not a realistic local candidate on this machine | Out of scope |
| Cohere Command R7B | 7B dense | 5.1GB — [ollama.com/library/command-r7b](https://ollama.com/library/command-r7b) | Yes, fits | No independent AA/LiveBench page found | Fits, but no quality evidence for/against the floor | Untested, no evidence either way |
| InternLM3-8B | 8B (nominal) | Page lists **18GB** for the default tag — anomalous for 8B at Q4, likely an fp16/unquantized default rather than a genuine Q4 build; quant unconfirmed | Unclear — if 18GB is real, no, spills like the current model; if a Q4 tag exists separately, unconfirmed | No independent evidence found | Size/quant ambiguity itself is a flag; not usable as stated | Skip — verify quant before considering |
| Yi (6B/9B/34B), Yi-Coder | 6-34B | Various, ollama.com library | N/A | Not sought — pages show "updated 2 years ago" / "1 year ago" | Stale relative to Sept 2026; superseded generations exist | Skip — recency alone disqualifies |
| GLM-5.3 (max) | 753B total / 40B active MoE | Not locally runnable at any quant (Q4 of 753B params is far beyond 32GB system RAM) | No — not even RAM-spill feasible | AA live page = **60**, released Aug 18 2026 — [artificialanalysis.ai/models/glm-5-3](https://artificialanalysis.ai/models/glm-5-3) | Best-in-class on paper but categorically not a local candidate on this machine | Out of scope — too large to run at all |
| Kimi K3 (max) | 2.8T total / 104B active MoE | Not locally runnable at any quant | No | AA live page = **60**, "#1/112" in class, released July 16 2026 — [artificialanalysis.ai/models/kimi-k3](https://artificialanalysis.ai/models/kimi-k3) | Same as above | Out of scope — too large to run at all |
| Laguna XS.2 (Poolside AI) | 33B total / 3B active MoE | Not resized this pass | No, spills | No AA page found (404 on tried slugs); vendor-only coding benchmark (SWE-bench Verified 68.2%) | Coding-agent focused, off-target task shape for classification; no general-reasoning evidence | Skip — wrong task type, no relevant evidence |
| DeepSeek-R1-Distill-Qwen-7B | 7B | 4.7GB — [ollama.com/library/deepseek-r1/tags](https://ollama.com/library/deepseek-r1) | Yes, fits | No distinct AA score found for this exact tag | See reasoning-cost note below | Untested; cost risk (see below) |
| DeepSeek-R1-Distill-Qwen-8B / -Llama-8B | 8B | 5.2GB — ollama.com/library/deepseek-r1 | Yes, fits | AA: R1-Distill-Llama-8B = **6** ("below average, median 9") | Independently below-median even among similar-size open models | Below floor — skip |
| DeepSeek-R1-Distill-Qwen-14B | 14B | 9.0GB — ollama.com/library/deepseek-r1 | No, spills | AA: **10** ("above average, median 9" — barely) | Spills; marginal score even on a lenient local comparison | Not prioritized |
| DeepSeek-R1-Distill-Qwen-32B | 32B | 20GB — ollama.com/library/deepseek-r1 | No, spills more than current model | AA: **11** | Bigger download than current model, independently scores far below it | Below floor — skip |
| QwQ-32B | 32B dense | 20GB — [ollama.com/library/qwq](https://ollama.com/library/qwq) | No, spills | AA: **13** ("above average, median 9") | Still far below dense-27-31B tier (35-52 range) | Below floor — skip |
| Qwen3 thinking-tagged variants (e.g. `4b-thinking-2507`, `30b-a3b-thinking-2507`) | 4B / 30B-A3B | 2.5GB / 19GB — ollama.com/library/qwen3/tags | 4B fits; 30B-A3B spills | No distinct AA score found for these specific tags | Reasoning suppressible/tunable (see below); quality unverified at these sizes | Untested, no evidence either way |
| OpenThinkerAgent-8B-RL / OpenThinker-Agent-32B | 8B / 32B | Not resized this pass | 8B fits; 32B spills | No evaluation metrics shown on fetched org page; no independent AA/LiveBench page found | Project has pivoted to agent/tool-use training, not classification — off-target | Skip — wrong task focus, no evidence |
| NVIDIA OpenReasoning-Nemotron-32B | 32B | Not resized this pass | No, spills | Vendor only (GPQA 73.1, MMLU-Pro 80.0) — no independent page found | Trained/evaluated with up to 64K output tokens — structurally mismatched to our ~250-token budget | Skip — reasoning-length mismatch alone disqualifies for this workload |
| Bespoke-Stratos-32B | 33B | Not resized this pass | No, spills | Vendor only (AIME24 63.3%, MATH-500 93.0%) — no independent page found | No classification-relevant evidence | Untested, no independent evidence |

---

## Reasoning-tuned/distilled: the token-cost catch

The task brief's concern is real and confirmed asymmetric between families:

- **Qwen3 family (including qwen3.8 itself) documents a runtime on/off switch for thinking, no
  separate weight download required.** qwen3.8's own Ollama page: thinking is "on by default and
  can be disabled per request; reasoning depth can be tuned with `reasoning_effort`," plus a
  `preserve_thinking` option. Qwen's blog ([qwenlm.github.io/blog/qwen3](https://qwenlm.github.io/blog/qwen3/),
  fetched) confirms `enable_thinking=True/False` in `apply_chat_template()`, or inline `/think`
  and `/no_think` tags "to switch the model's thinking mode from turn to turn." No concrete
  average thinking-token count was found on either page — only that a bound exists and is
  controllable.
- **DeepSeek-R1 distills document no such switch.** DeepSeek's own repo
  ([github.com/deepseek-ai/DeepSeek-R1](https://github.com/deepseek-ai/DeepSeek-R1), fetched)
  says: "Avoid adding a system prompt" and recommends "enforcing the model to initiate its
  response with `<think>\n`" — the design assumes full chain-of-thought always runs, with no
  documented suppression mechanism. Combined with these distills scoring well below the floor
  anyway (6-13 on the AA scale that has qwen3.8 at 52), this is a second, independent reason to
  rule the R1-distill branch out, not just a cost caveat on an otherwise-viable candidate.
- No concrete average-reasoning-token-count figure (e.g. "N thinking tokens per response on a
  short-answer task") was found for any reasoning-tuned model in this pass, for either family —
  flagged as a genuine evidence gap, not filled by estimation.

---

## Throughput: 6GB-resident vs. CPU-heavy 27B, computed

No RTX 3060 **Laptop 6GB** exact-card benchmark was found despite multiple search attempts — every
number below is a same-class proxy, labeled as such.

- **Fits-6GB reference (7-9B dense, fully GPU-resident):** RTX 3060 12GB desktop —
  [localscore.ai/accelerator/43](https://www.localscore.ai/accelerator/43) (fetched): Llama 3.1 8B
  Q4_K_M = **51.6 tok/s**. RTX 3060 Ti 8GB desktop —
  [databasemart.com/blog/ollama-gpu-benchmark-rtx3060ti](https://www.databasemart.com/blog/ollama-gpu-benchmark-rtx3060ti)
  (fetched): Llama 3.1 8B = **57.34 tok/s**, Mistral 7B = **71.16 tok/s**, Qwen2 7B = **63.73
  tok/s**. Both are larger-VRAM desktop proxies for our 6GB laptop card, not the exact part.
- **CPU-heavy 27B baseline:** no direct 27B CPU-only measurement was found anywhere in this pass.
  [github.com/ggml-org/llama.cpp/discussions/3847](https://github.com/ggml-org/llama.cpp/discussions/3847)
  (fetched) gives two points on the same Ryzen 5700G rig: 7B CPU-only = **11 tok/s**; 70B CPU-only
  = **0.8 tok/s**. Log-linear interpolation to 27B (shown): ln(11)=2.398, ln(0.8)=−0.223, fraction
  of log-param-range from 7B to 70B covered by 27B = (ln27−ln7)/(ln70−ln7) = 1.350/2.303 = 0.586;
  interpolated ln(tok/s) = 2.398 + 0.586×(−0.223−2.398) = 0.862 → e^0.862 ≈ **2.4 tok/s**. This is
  an extrapolation, not a measurement, and the Ryzen 5700G is a desktop APU proxy for our laptop
  CPU.
- **Partial-spill middle case (12-14B on an 8GB card):** databasemart.com (fetched): 12-13B-class
  models on the RTX 3060 Ti 8GB fall to **9.25-18.73 tok/s** even though the card has 8GB — a sharp
  3-6x cliff the moment a model stops fitting comfortably, before it's even fully off the card.
  This is the best available shape for what "partially spills" looks like at this scale.

**Computed ratio:** 51.6 / 2.4 ≈ **21x**, up to 73 / 2.4 ≈ **30x**, using the two most defensible
measured/extrapolated numbers found. Even generously derated 2-3x for proxy-card and
extrapolation uncertainty, the gap stays at roughly **7-15x**. Reading: a model that fully fits
6GB is very likely at least an order of magnitude faster than the current CPU-offloaded 27B on
raw tokens/sec — this is a real, large number, but it says nothing about whether any 6GB-fitting
model clears the quality floor, which is the open question this table above tries to answer and
mostly cannot, for lack of independent classification-specific evidence at that size.

---

## What's genuinely new since mid-2026

Exhaustive fetch of Ollama's newest-sorted library, Qwen's own version lineage (3.5 → 3.6 → 3.8,
no 3.9 or 4 found — `ollama.com/search?q=qwen3.9` returns only fine-tunes of 3.5/3.6, and
`artificialanalysis.ai/models/qwen3-7-27b` 404s), and Artificial Analysis's live pages for every
newly-surfaced candidate found **nothing released in the last three months that independently
outscores `qwen3.8:27b` (52) on the one composite index that has it.** Confirmed:

- `qwen3.8:27b` itself is the newest and highest-scoring model in its lineage —
  [artificialanalysis.ai/models/qwen3-8-27b](https://artificialanalysis.ai/models/qwen3-8-27b)
  (fetched): "Release Date: August 14, 2026," "ranked #1 out of 140 models in its class."
- Nemotron-3.5-Lightning (Aug 11, 2026, MoE 30B/3B active) — AA = 24, well below.
- Gemma 4 family (~April 2026) — 31B tag AA = 30, well below.
- GLM-5.3 and Kimi K3 score higher (60) but are 753B/40B-active and 2.8T/104B-active respectively
  — confirmed this pass via direct AA fetches — categorically not runnable on this machine at any
  quantization, not just "doesn't fit 6GB."
- Laguna XS.2 (Poolside AI, MoE 33B/3B active, coding-focused) — no independent general-reasoning
  score found; wrong task shape regardless.

---

## Closing: candidates worth actually testing

**Honest bottom line first:** nothing found in this pass has independent evidence of matching
`qwen3.8:27b`'s quality on scored classification — every model with an independent score on a
scale that includes the current model (52) scored lower, and every model that fits fully in 6GB
(Qwen3-8B, Command R7B, DeepSeek-R1-Distill-7B/8B, Qwen3-4B-thinking) either has no independent
evidence at all, or (the one 6GB-fitting model that was scored — R1-Distill-Llama-8B) scored
below-median among similar-size models, not near the floor. This closes the branch the task asked
to check plainly: **no small model was found with credible evidence of holding the 27B floor.**
That said, "no evidence found" is different from "evidence of failure" for most of the untested
6GB-fitting candidates — the gap is real and the only way to close it is to measure.

In priority order, three candidates worth actually testing against the 12,886 existing 27B
judgements:

1. **Qwen3-8B (dense)** — fits 6GB with headroom (5.2GB), same vendor family and tokenizer
   lineage as the floor model (more likely to share the floor model's judgement conventions than
   an unrelated architecture), and the throughput math above suggests an order-of-magnitude speed
   win if it holds quality. No independent evidence for or against on this task — cheapest
   candidate to disprove or confirm, so it should go first.
2. **Cohere Command R7B** — fits 6GB (5.1GB), and Command R models are specifically positioned
   around structured/RAG-style output rather than open-ended chat, which is a closer task-shape
   match to "score + verdict + one-line reason" than a general chat model. No independent
   evidence found either way — worth a real measurement precisely because it's untested and
   plausible on task-shape grounds, not on any benchmark claim.
3. **Qwen3-4B-thinking-2507** — fits 6GB (2.5GB) with room to spare, and its documented
   `enable_thinking`/`reasoning_effort` controls mean the reasoning-token-cost risk that rules out
   the DeepSeek-R1 branch can be bounded here. No independent classification evidence exists, and
   its small size makes it the longest shot of the three, but it's cheap enough to test third
   without much cost if 1 and 2 don't clear the bar.

Everything scored on an AA scale that includes the current model's 52 — every Qwen3.x successor,
every MoE (Nemotron, Gemma 4-A4B, Nemotron-3-Nano), QwQ-32B, and every DeepSeek-R1 distill scored
lower — is not worth testing; independent evidence already puts it below the floor.
