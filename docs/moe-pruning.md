# Can we prune an MoE and beat our dense 27B? — grounded findings

Read date for all sources below: 2026-09-04. Machine: RTX 3060 Laptop, 6 GB VRAM, 32 GB
system RAM, 16 cores, Windows, Ollama. Current model: `qwen3.8:27b` dense Q4_K_M, 18.5 GB
of weights, 2.5 GB resident in VRAM, GPU at 0%, CPU at 80% (figures as given in the task
brief, not independently re-measured this run). Task: ~3,315 input tokens, ~250 generated,
background batch classification-with-reasoning, latency irrelevant.

---

## 1. What "MoE pruning" actually means — five different things

| Technique | What it removes | Effect on memory footprint | Effect on quality |
|---|---|---|---|
| **Expert pruning** | Whole experts, permanently, per MoE layer | Shrinks resident weights proportionally to fraction of experts dropped — this is a real, permanent size reduction | Direct quality cost; magnitude depends on ratio (measured numbers below) |
| **Expert offloading** | Nothing — all experts kept, only the ones not activated for the current token are *streamed* from RAM/disk instead of sitting in VRAM | **Not pruning at all**, despite being frequently conflated with it. Full weight set stays resident somewhere (RAM/disk); only the working set moves through VRAM | None — output should be numerically identical to the unpruned model, modulo any perf-motivated quantization done alongside it |
| **Router-guided pruning** | A specific expert-pruning method that uses the router's own gate statistics (which experts it actually favors) plus expert activation norms to decide which experts to drop, rather than dropping at random or by weight-magnitude alone | Same class of saving as expert pruning | Measured to preserve quality better than naive/random expert pruning or expert *merging* (see §2) — this is what REAP is |
| **Layer pruning** | Whole transformer layers/blocks (attention + MoE block together) | Shrinks depth; found in the `eaddario/Qwen3-30B-A3B-pruned-GGUF` repo, which drops only 2 of 60 layers (5 and 39) | Small footprint change (30.53B → 29.29B params, ~4% smaller) for presumably small quality change — but this repo prunes so little it barely moves the needle on our fit problem |
| **Depth/width pruning** | Reduces hidden dimension or number of layers uniformly (structured pruning within the dense/backbone parts of the network, orthogonal to the MoE/expert axis) | Can shrink footprint substantially but is a distinct, dense-model technique; not what the Qwen3-30B-A3B community artefacts below are doing | Not evaluated in this pass — no artefact for our target model found using this axis |

**The technique that matters for "prune an MoE, ship fewer experts" is expert pruning**
(row 1/3). Expert offloading (row 2) is the alternative path in §5 — it is not pruning and
should not be scored against pruning's quality cost, because it doesn't have one.

SOURCE: https://huggingface.co/eaddario/Qwen3-30B-A3B-pruned-GGUF · read 2026-09-04 · fetched
FOUND: "layers 5 and 39 have been pruned" via a custom `llama-quantize` `--prune-layers` option; 30.53B → 29.29B params; F16 baseline 61.1 GB; Q4_K_M 16.3 GB (only a 12.4% reduction vs. non-pruned quant); wikitext-2 perplexity 8.446 for F16; average of ARC/HellaSwag/MMLU/TruthfulQA/WinoGrande = 57.28.
INFERRED: This is layer pruning, not expert pruning — it removes ~4% of total layers and correspondingly little size. It does not get us anywhere close to fitting 6 GB VRAM.

SOURCE: https://github.com/CerebrasResearch/reap · read 2026-09-04 · fetched
QUOTES: "REAP prunes experts from MoE models by evaluating both router gate-values and expert activation norms" — per WebFetch summary of the repo README (paraphrase, not a direct copy-paste quote; page content was summarized by the fetch tool rather than returned verbatim)
FOUND: Official implementation of Router-weighted Expert Activation Pruning (REAP); supports Qwen3, GLM-4.5, Mixtral, Llama-4, DeepSeek-V3.2 and others; most recent commits dated March 30, March 19, March 11, 2026 (9 commits on main visible in the fetch) — actively maintained, ~5 months stale as of this read, not abandoned.
INFERRED: No GGUF export tooling ships in the repo itself; GGUF conversion is done downstream by third parties (see §3 table).

---

## 2. What is MEASURED about quality loss from expert pruning

The one paper found with actual per-model, per-ratio numbers for our exact target model
(Qwen3-30B-A3B) is REAP: **"REAP the Experts: Why Pruning Prevails for One-Shot MoE
compression"**, arXiv:2510.13999 (Cerebras, dated Oct 15 2025).

SOURCE: https://arxiv.org/abs/2510.13999 · read 2026-09-04 · fetched
QUOTES: "Sparsely-activated Mixture-of-Experts (SMoE) models offer efficient pre-training and low latency but their large parameter counts create significant memory overhead, motivating research into expert compression. Contrary to recent findings favouring expert merging on discriminative benchmarks, we find that expert pruning is a superior strategy for generative tasks." — abstract, verbatim.
FOUND: Authors' own claim of "near-lossless compression on code generation and tool-calling tasks" at 50% expert reduction, tested across models 20B–1T params.

SOURCE: https://arxiv.org/html/2510.13999 (HTML rendering of the same paper, used to extract Table 2) · read 2026-09-04 · fetched
QUOTES: "perplexity and MC accuracy can therefore be viewed as _discriminative_ metrics" and "discriminative metrics such as perplexity and log-likelihood based MC benchmarks are not necessarily good proxies for generative model quality." — paper text, as returned by fetch (tool-summarized extraction, treat exact wording as approximate but the claim is the paper's own).
FOUND — Table 2, Qwen3-30B-A3B, REAP pruning, authors' own numbers (this is the AUTHORS' table, not an independent reproduction):
- Baseline (0% pruned): EvalPlus 0.814, LiveCodeBench 0.302, Coding avg 0.558; WildBench (creative writing) 0.811; GSM8K 0.903, MATH-500 0.872, Math avg 0.887; Multiple-Choice avg 0.721.
- 25% pruned: Coding avg 0.551 (−1.3% relative vs. baseline); Creative writing 0.804 (−0.9%); Math avg 0.888 (flat/+0.1%); MC avg 0.665 (−7.8% relative).
- 50% pruned: Coding avg 0.541 (−3.0% relative); Creative writing 0.718 (−11.5% relative); Math avg 0.857 (−3.4% relative); **MC avg 0.503 (−30.2% relative, largest drop of any category)**.
FOUND: The paper does NOT test pruning ratios beyond 50% for any model — 25% and 50% are the only ratios in the experimental design.
INFERRED: The paper's own framing exactly matches the brief's worry — "perplexity/MC held up, reasoning collapses" is backwards here: MC (the *discriminative*, closest-to-perplexity metric) is the one that collapses hardest (−30% relative at 50%), while generative code and math hold up much better (−3% range). Multiple-choice/knowledge-recall degrading disproportionately is concerning specifically for JobRadar's task, which is closer to structured classification-with-reasoning than to open-ended code generation — the paper's flagship "near-lossless" claim is for the wrong task category.

Independent, smaller-scale, third-party cross-check (not the authors' own numbers):

SOURCE: https://huggingface.co/GOBA-AI-Labs/PrunedHub-Qwen3-30B-A3B-EN-80pct-MxMoE · read 2026-09-04 · fetched
FOUND: "80pct" in the name means 80% of experts RETAINED (20% pruned) — 128→102 experts/layer across 36 MoE layers, using "activation_magnitude × routing_frequency" importance scoring on English calibration text, combined with MxMoE mixed quantization; file size 13.45 GB (vs. 17.28 GB Q4_K_M baseline claimed in that card).
FOUND: Their own small-scale eval — MMLU (0-shot, 100 questions, no-think): 70% pruned vs. 77% original (−7pp, −9% relative) at only 20% expert pruning; GSM8K (0-shot, 50 questions): 94% vs. 92% (+2pp, within noise of a 50-question sample).
INFERRED: This is a tiny eval (100 and 50 questions) from a third party, not a rigorous benchmark — but directionally it corroborates REAP's own finding that knowledge/MC-style accuracy degrades faster than math/generative accuracy, and that this shows up even at a mild 20% pruning ratio, not just at 50%.

**Net measured picture:** at the ONLY ratio anyone has published numbers for our target
model (25% and 50%), generative benchmarks (code, math, creative writing) hold up to
within single digits of relative loss, but discriminative/knowledge-style accuracy (MC)
drops 7.8% relative at 25% and a full 30.2% relative at 50%. Nobody has published a number
for any ratio beyond 50%. "No measurement found" is the honest answer for anything past
50% expert pruning on Qwen3-30B-A3B.

---

## 3. Shippable pruned artefacts

All fetched 2026-09-04 from Hugging Face model search (`huggingface.co/models?search=...`).

| Repo | Base model | Prune ratio | Resulting size | GGUF? | Last commit/update | Measured quality |
|---|---|---|---|---|---|---|
| [eaddario/Qwen3-30B-A3B-pruned-GGUF](https://huggingface.co/eaddario/Qwen3-30B-A3B-pruned-GGUF) | Qwen3-30B-A3B | 2 of 60 layers (layer pruning, ~4%) | Q4_K_M 16.3 GB (vs ~18.6 GB stock) | Yes, native GGUF | not explicitly dated in card; recent activity implied by "downloads last month: 181" | wikitext-2 PPL 8.446 (F16); avg ARC/HellaSwag/MMLU/TruthfulQA/WinoGrande = 57.28 — author's own numbers |
| [atbender/Qwen3-REAP-15B-A3B](https://huggingface.co/atbender/Qwen3-REAP-15B-A3B) | Qwen3-30B-A3B | 50% experts (REAP, 128→64/layer) | SafeTensors ~30 GB disk (F16-ish) | No (base weights only) | Updated March 1, 2026 | **None** — card states "No formal evals run yet; contributions welcome" and warns "quality degradation expected on tail tasks" |
| [12bitmisfit/Qwen3-30B-A3B_Pruned_REAP-15B-A3B-GGUF](https://huggingface.co/12bitmisfit/Qwen3-30B-A3B_Pruned_REAP-15B-A3B-GGUF) | Qwen3-30B-A3B | 50% experts (REAP) | Q4_K_M **9.75 GB**; Q2_K 5.99 GB; Q3_K_M 7.78 GB; Q5_K_M 11.4 GB; Q6_K 13.2 GB; Q8_0 17.1 GB | **Yes** | Oct 22, 2025 | None — "No model card" published for this GGUF conversion specifically |
| 12bitmisfit REAP GGUF variants (Instruct-2507, Coder) | Qwen3-30B-A3B-Instruct-2507 / Qwen3-Coder-30B-A3B | 50% experts (REAP) | ~16B params, GGUF ~9-17 GB depending on quant | Yes | Oct 21–22, 2025 | None found in card |
| [GOBA-AI-Labs/PrunedHub-Qwen3-30B-A3B-EN-80pct(-MxMoE)](https://huggingface.co/GOBA-AI-Labs/PrunedHub-Qwen3-30B-A3B-EN-80pct-MxMoE) | Qwen3-30B-A3B | 20% experts (80% retained), language-aware scoring + MxMoE quant | 13.45 GB | Not confirmed GGUF (MxMoE mixed-quant format) | Updated Feb 23, 2026 | MMLU 70% vs 77% baseline (−7pp); GSM8K 94% vs 92% (100Q/50Q samples — small-N) |
| [mradermacher/Qwen3-30B-A3B-Instruct-Pruned-2B-GGUF](https://huggingface.co/mradermacher/Qwen3-30B-A3B-Instruct-Pruned-2B-GGUF) | Qwen3-30B-A3B-Instruct | unclear/extreme (implies ~2B result) | 2B-class | Yes | Jan 14, 2026 | Not checked this run — flagged as an extreme outlier, likely far past any measured-safe ratio |
| Mixtral-8x7B pruned family (Na0s, + mradermacher/RichardErkhov GGUF conversions) | Mixtral-8x7B-Instruct-v0.1 | 1–7 of 8 experts dropped (multiple ratios) | 24 GB (4 experts) up to 41 GB (1 expert kept) | Yes (community GGUF conversions) | Original Oct 2024; GGUF conversions Oct 2024–Aug 2025 | Not checked this run — different base model, not our target |

SOURCE: https://huggingface.co/models?search=qwen3-30b-a3b+pruned · read 2026-09-04 · fetched
FOUND: 19 repos returned; list above is the subset relevant to expert (not layer) pruning of our exact target model, with GGUF availability.

SOURCE: https://huggingface.co/models?search=REAP-15B-A3B · read 2026-09-04 · fetched
FOUND: atbender's base REAP release plus at least 7 downstream GGUF/SafeTensors/exl3 conversions by other users (12bitmisfit, UnstableLlama, Disya, lainlives, mradermacher-style naming), confirming REAP-pruned Qwen3-30B-A3B is the one expert-pruning artefact with real GGUF distribution and multiple independent conversions — but **no conversion carries a published benchmark number**; every quality number we have for REAP-pruned Qwen3-30B-A3B traces back to the authors' own Table 2 (§2), not to any of the shipped GGUF cards themselves.

**Bottom line on shippability:** yes, a real, runnable, Ollama-compatible (GGUF) 50%-expert-pruned
Qwen3-30B-A3B exists and is actively converted by the community (most recent conversion Jan
2026). But none of the GGUF repos themselves report quality — the only quality numbers for
this exact artefact class come from the authors' Table 2, and that table's worst category
(MC, −30% relative at 50%) is the one closest to JobRadar's classification task.

---

## 4. The arithmetic that decides it

SOURCE: https://huggingface.co/Qwen/Qwen3-30B-A3B-GGUF · read 2026-09-04 · fetched
FOUND: "Q4_K_M (4-bit): 18.6 GB"; "30.5 billion total parameters with only 3.3 billion activated"; "128 experts total, with 8 activated per token."

- Full Qwen3-30B-A3B at Q4_K_M: **18.6 GB** resident weights (confirmed above), same class of
  problem as the current dense 27B (18.5 GB) — neither fits in 6 GB VRAM as a whole.
- To fit entirely inside 6 GB VRAM: 6 / 18.6 = **32.3% of the weight retained → 67.7% of
  experts would need to be pruned.**
- The REAP GGUF artefact that actually exists tops out at 50% pruned (9.75 GB Q4_K_M,
  12bitmisfit repo, §3) — still **3.75 GB over budget** for a 6 GB card, and this is
  already the deepest ratio anyone has published a number for.
- Even the maximum-tested-and-measured ratio (50%) does not fit our VRAM, and at that ratio
  the closest-to-our-task metric (MC) has already lost 30% relative accuracy (§2). Reaching
  67.7% pruned would go *past* the only data point anyone has, in the direction that metric
  was already falling fastest.

**Plain statement: fitting 6 GB VRAM requires pruning beyond the maximum ratio (50%) for
which any quality measurement exists, on a metric (MC) that is already the fastest-degrading
one at that maximum ratio.** This is not "unmeasured but probably fine" — it is
unmeasured in the direction the one existing measurement says is most dangerous.

---

## 5. The alternative that is not pruning: expert offloading

Offloading keeps every expert (no quality cost by construction — see §1) and streams the
inactive ones from RAM. Because Qwen3-30B-A3B only activates 8 of 128 experts (≈3.3B params)
per token, in principle only a small, changing slice of the 18.6 GB needs to move through
VRAM/compute per step, versus a dense 27B where the *entire* 18.5 GB participates in every
token's forward pass.

SOURCE: https://github.com/ggml-org/llama.cpp/pull/15077 · read 2026-09-04 · fetched
FOUND: llama.cpp ships `--cpu-moe` (keep all MoE weights on CPU) and `--n-cpu-moe N` (keep the first N MoE layers' weights on CPU, rest on GPU) specifically for this offloading pattern — this is the mechanism, not a hypothetical. One user-reported figure in the PR thread: "108T/s with gpt-oss:120b on dual 5090s with `--n-cpu-moe 3`" — high-end hardware, not comparable to our rig, included only to confirm the flag works at all scales.

SOURCE: https://github.com/ggml-org/llama.cpp/discussions/15396 · read 2026-09-04 · fetched
FOUND: User "QuantiusBenignus" (build 6139), hardware **Ryzen 7 5700X, 32 GB RAM, NVIDIA RTX 3060 (12 GB VRAM, desktop not laptop)**, running **gpt-oss-20b** (a ~21B-A3.6B-class MoE, not our exact model) with expert offloading:
- 16K context, `-ncmoe 2`: "64 tok/sec initial generation rate"
- 16K context, alternate layer-offload strategy: "67 tok/sec initial generation rate"
- Small context (2K), no offloading needed (fits in 12 GB): "75 tok/sec"
- 32K context, `-ncmoe`: "56 tok/sec initial generation rate"
INFERRED: This is the closest measured data point found to "MoE + CPU/RAM offload on a 3060-class card," and it shows offloading costs only ~10-25% of throughput relative to a fully-VRAM-resident run on the same card, for a similarly-sized MoE. It is NOT our exact model (gpt-oss-20b, not Qwen3-30B-A3B) and NOT our exact card (12 GB desktop 3060, not 6 GB laptop 3060), and it is not compared against a dense model of similar total size on the same rig within this source.

**No measurement found** — despite fetching Hugging Face, GitHub (llama.cpp PRs/discussions),
KTransformers' README, and attempting Reddit/DuckDuckGo/Bing searches (Reddit blocked this
session; DuckDuckGo returned a CAPTCHA; the general WebSearch tool's budget was exhausted
before this comparison could be run) — for a **direct, same-rig, same-day comparison of
Qwen3-30B-A3B-with-experts-offloaded versus dense Qwen3-27B-CPU-only throughput on 6 GB-VRAM/
32 GB-RAM hardware**. The KTransformers project (purpose-built for exactly this offloading
pattern) publishes throughput numbers only for enterprise multi-GPU rigs (8×L20, 4×RTX 4090),
not consumer single-GPU laptops.

**What can be said from what was fetched:** the mechanism (llama.cpp `--n-cpu-moe`/`--cpu-moe`)
exists and is shipped software, not a research prototype. The one directionally-close data
point (12 GB desktop 3060, similarly-sized MoE, offloaded) shows the offload penalty is
modest (~10-25% vs. fully-resident), which is the kind of result that would make "MoE
offloaded" plausible on our 6 GB laptop card too — but this is inference from an adjacent
model/card, not a measurement of our actual case, and no comparison to a same-size dense
model's CPU throughput was found to complete the loop.

---

## Verdict

**No — pruning an MoE down to our machine's 6 GB VRAM is not a real path, and the number
that rules it out is 67.7%: reaching 6 GB from Qwen3-30B-A3B's 18.6 GB (Q4_K_M) requires
pruning away 67.7% of its experts, while the only quality measurement that exists for this
exact model (Cerebras's REAP, arXiv:2510.13999) stops at 50% pruned and already shows a
30.2% relative collapse on multiple-choice/discriminative accuracy at that ratio** — the
benchmark category closest to JobRadar's classification-with-reasoning task, as opposed to
the code/math/creative-writing generation tasks where the paper's "near-lossless" headline
actually holds. Nobody has published what happens between 50% and 67.7%, but the one trend
line that exists is already pointing down fast in exactly the wrong metric, so treating that
gap as "probably fine" would be an unsupported bet, not a read of the evidence. Shippable
50%-pruned GGUF artefacts do exist (12bitmisfit's REAP-15B-A3B, updated Oct 2025) and are a
real option if 9.75 GB partially-offloaded is acceptable, but none of them fit fully in 6 GB
VRAM and none carry their own quality card — every number for that class traces back to the
authors' own table. The user's underlying intuition is likelier to pay off through **expert
offloading** (§5) rather than pruning — that path has no inherent quality cost and a
plausible-but-unconfirmed throughput case from adjacent hardware/model measurements — but no
direct, same-rig measurement against the dense 27B was found this run, so that remains a
promising untested hypothesis rather than a demonstrated win.
