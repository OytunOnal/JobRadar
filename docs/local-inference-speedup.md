# Making qwen3.8:27b faster when it doesn't fit in VRAM

Research date: 2026-09-04. Machine: RTX 3060 Laptop (**6GB VRAM**), 32GB system RAM (~1GB free with
model loaded), 16 logical CPU cores, Windows, running Ollama. Model: `qwen3.8:27b`, dense-scale, Q4_K_M,
18.5GB weights — only ~2.5GB fits in VRAM, rest streams from system RAM. Measured symptom: GPU 0%
utilisation, CPU 80%, inference running from RAM. Decision already made: **keep this model**. This doc
is only about the runtime.

Workload: ~3,315 input tokens (job posting + rubric + full CV), ~250 generated tokens, background batch
queue (latency irrelevant, throughput matters), calls independent, and **~1,742 of the 3,315 input
tokens (the CV block) are byte-identical on every call.**

**Architecture correction that changes the caching story below.** `qwen3.8:27b` is not a conventional
dense-KV-cache model. Its HuggingFace
[config.json](https://huggingface.co/Qwen/Qwen3.8-27B/raw/main/config.json) (fetched 2026-09-04) shows
`model_type: "qwen3_5"`, `architectures: ["Qwen3_5ForConditionalGeneration"]`, 64 layers with a
`layer_types` pattern of **3 linear-attention layers + 1 full-attention layer, repeating 16 times**.
48 of 64 layers use fixed-size recurrent state (Gated DeltaNet-style linear attention), not a growing
KV cache. This matters directly for §3 below.

Grounding: every line is FOUND (fetched, quoted) or INFERRED (marked as such). Author/vendor claims are
labeled distinctly from independent measurements. Where nothing verifiable was found, it says "not
verified" rather than a remembered number — this happened more than usual here because the session's
shared WebSearch quota ran out partway through, so several sub-questions rest on direct doc/repo fetches
only, and Reddit (a likely source of exactly this hardware tier's benchmarks) was unreachable (403) all
session.

---

## 0. The honest ceiling — lead with this

CPU-offloaded decode at batch size 1 is memory-bandwidth-bound: generating one token requires reading
essentially the whole weight set once. Two real specs, one derivation:

- **RTX 3060 Laptop GPU memory bandwidth**: 336 GB/s at full power, 288 GB/s at the low-power/Max-Q
  config OEMs sometimes ship (192-bit bus, 6GB GDDR6). FOUND —
  [Wikipedia GeForce 30 series, "Laptop" table](https://en.wikipedia.org/wiki/GeForce_30_series)
  (cites TechPowerUp), fetched 2026-09-04.
- **System RAM bandwidth**: exact RAM generation for this machine wasn't given, so both bookends are
  reported. DDR4-3200 dual-channel theoretical = 51.2 GB/s
  ([Wikipedia DDR4_SDRAM](https://en.wikipedia.org/wiki/DDR4_SDRAM), fetched 2026-09-04, quoting the
  PC4-25600 spec). DDR5-5600 dual-channel theoretical = 89.6 GB/s
  ([Wikipedia DDR5_SDRAM](https://en.wikipedia.org/wiki/DDR5_SDRAM), fetched 2026-09-04).

**Derived estimate (my arithmetic, not a measurement):** `time_per_token ≈ (2.5GB / GPU_BW) + (16GB / RAM_BW)`,
weighting the ~2.5GB VRAM-resident portion against the ~16GB RAM-resident portion.

| RAM generation | Time/token (theoretical) | Theoretical tok/s | With 41–85% real-world efficiency* |
|---|---|---|---|
| DDR4-3200 dual-channel | 0.007s (GPU) + 0.3125s (RAM) = 0.320s | ≈3.1 tok/s | **≈1.3–2.6 tok/s** |
| DDR5-5600 dual-channel | 0.007s (GPU) + 0.179s (RAM) = 0.186s | ≈5.4 tok/s | **≈2.2–4.6 tok/s** |

\* The efficiency range is a sanity-check bookend, not a measured figure for this machine: the low end
(41%) comes from one real calibration point — an Apple M2 Ultra (800 GB/s unified memory, 94.27 tok/s
measured on a ~3.5GB Q4_0 7B model in the
[llama.cpp Apple Silicon benchmark megathread](https://github.com/ggml-org/llama.cpp/discussions/4167),
fetched 2026-09-04) — cross-architecture, offered only as one data point. The 60–85% upper bound is a
general x86 dual-channel rule of thumb, **not independently verified this session**.

**The GPU's 2.5GB contributes ~2% of the time budget either way (0.007s out of 0.19–0.32s) — the 336
GB/s GPU is essentially irrelevant at this offload ratio.** The RAM-resident 16GB dominates completely.
No independently measured tok/s figure for a comparable (~20–30GB Q4, partial-offload, small consumer
GPU) config was found to cross-check against (WebSearch exhausted, Reddit blocked) — this is a real gap,
reported as such rather than papered over.

**Bottom line: the realistic single-stream decode ceiling on this machine is roughly 1.3–4.6 tok/s,**
and a well-tuned setup is likely already sitting close to it — CPU at 80% with GPU at 0% is exactly the
signature of a RAM-bandwidth-bound decode loop, not an under-tuned one. **No software lever below turns
this into anything but a small multiple.** The only place real, uncapped-by-bandwidth gain is plausible
is aggregate throughput across the *queue* (batching/pipelining many independent calls, §4) and shrinking
the *input* side of the equation (prefix caching cutting redundant prefill work, §2 — with a real
architecture caveat) — not raw per-token decode speed.

---

## 1. llama.cpp / Ollama levers

Ollama vendors llama.cpp's `llama-server` directly as of
[PR #16031](https://github.com/ollama/ollama/pull/16031) (merged 2026-05-29, fetched 2026-09-04) — it
removed its own Go/CGO inference engines, so GGUF inference now runs exclusively through upstream
llama.cpp. Flags below are current llama.cpp `tools/server` README (fetched 2026-09-04) plus Ollama's
`docs/faq.mdx` and `docs/modelfile.mdx` (fetched 2026-09-04).

| Lever | What it does | Applies to our dense 27B? | Measured? | Effort |
|---|---|---|---|---|
| `-ngl`/`num_gpu` layer count | Layers offloaded to VRAM | Yes, but **now auto-fit by default** (`-fit on` — llama.cpp "adjust[s] unset arguments to fit in device memory"). Manual `num_gpu` is a legacy field, no longer in Ollama's documented Modelfile parameter table. | Not verified (no benchmark found) | Trivial — already automatic |
| `--n-cpu-moe`/`-ncmoe` | Keeps MoE expert weights on CPU | **No — confirmed MoE-only**, doesn't apply to a dense model | N/A | N/A |
| `--n-cpu-ffn`/`-ncffn N` | Dense-model analog: keeps the FFN weights of the first N layers on CPU | Yes — this is the real dense-model offload knob, less known than `-ngl` | Not verified (no independent benchmark found) | Low — one flag, worth a sweep |
| `--split-mode` | Splits layers/weights across **multiple** GPUs | No — only relevant with 2+ GPUs; we have one | N/A | N/A |
| KV-cache quant (`-ctk`/`-ctv`, `OLLAMA_KV_CACHE_TYPE`) | Quantizes K/V cache (needs flash attention) | Yes, frees RAM/VRAM headroom | Not verified as a raw speed lever (memory-footprint lever, not confirmed throughput effect) | Low — one env var |
| mmap vs `--no-mmap` (now `--load-mode`) | Controls whether the model file is memory-mapped | Yes | Not verified for Windows steady-state throughput (doc only documents a *load-time* effect: fewer pageouts) | Low, but unproven |
| Thread count (`-t`, `-tb`) vs 16 logical cores | CPU threads for generation vs prompt processing | Yes | Not verified — no benchmark found for a 16-core case | Low — worth a manual sweep |
| **Prompt/prefix caching** (`--cache-prompt`, `--cache-reuse`, slot save/restore) | Reuses cached KV state for a repeated prompt prefix instead of re-computing it | **Yes in principle, on by default** in both llama.cpp and Ollama (Ollama's API surfaces `prompt_eval_cached_count` directly) — **but see architecture caveat below** | **Yes, independently, dramatically** — see below | Zero (already on) to verify |

**Prefix caching — the real number, and the real caveat.** An independent, dated (filed 2026-08-05,
Ollama 0.32.5) GitHub issue,
[ollama/ollama#17577](https://github.com/ollama/ollama/issues/17577) (fetched 2026-09-04), shows real
server logs from a live Windows-Server user:

> `slot print_timing: prompt eval time = 64882.22 ms / 11317 tokens` (cold)
> `slot print_timing: prompt eval time = 1997.46 ms / 180 tokens` (`f_keep = 0.983`, cache hit — the
> remaining 11,314 tokens were restored, not recomputed)

and, on a larger prefix:

> "Request A: full prompt evaluation, approximately 279 seconds" → "Request B: approximately 8.5
> seconds. sim_best=0.999, cached n_tokens=41141" — **roughly a 33x prompt-eval speedup on a hit**, with
> zero client-side flags required; it's on by default via longest-common-prefix matching per server slot.

This is on an 8×V100 Windows Server box, not our laptop, so the *absolute* multiplier won't transfer —
but it proves the *mechanism* is real, live in current Ollama, and large when it fires.

**But the same issue documents exactly the failure mode that threatens our model:**

> "forcing full prompt re-processing due to lack of cache data (likely due to SWA or hybrid/recurrent
> memory)"

`qwen3.8:27b` is a hybrid/recurrent architecture (confirmed above: 48 of 64 layers are linear-attention
with fixed-size recurrent state, not a growing KV cache) — the same class of architecture (there,
DeepSeek-V4) that this issue shows breaking cache-reuse. **Whether Qwen3.5's specific hybrid design
breaks llama.cpp's checkpoint-restore the same way is not verified — this is a reasoned risk flag, not a
confirmed failure**, and it needs a direct test on this exact model before betting the plan on it. Two
more caveats from the same issue, both favorable to a back-to-back batch queue but real: (a) cache reuse
depends on requests landing on the same server slot, which happens automatically when
`OLLAMA_NUM_PARALLEL=1` (Ollama's default); (b) the cache checkpoint itself can be evicted after a short
idle gap (~30s in the reporter's case) even with the *model* kept resident via `keep_alive` — so calls
need to run close together, not trickle in.

---

## 2. Alternative inference runtimes

Fetched each project's own repo/docs; independent (non-author) benchmarks are labeled as such, absent
elsewhere.

| Project | What it targets | Dense 27B GGUF on Windows? | Measured speedup, by whom | Effort |
|---|---|---|---|---|
| [KTransformers](https://github.com/kvcache-ai/ktransformers) | Hot/cold **MoE expert** placement (GPU vs CPU) | Windows: native (confirmed, "Support windows native," Aug 2024). Dense: supported but the entire speedup mechanism is MoE-specific — no dense speedup number exists anywhere in the project. Its own paper is titled "...Hybrid Inference for **MoE** Models." | Author-only, 227.85 tok/s, but for DeepSeek-R1 (MoE) on **8×L20 GPU server hardware** — not comparable | Disqualified — mechanism doesn't apply to a dense model |
| [PowerInfer](https://github.com/SJTU-IPADS/PowerInfer) | Activation-sparsity hot/cold neuron placement | **No** — requires specially ReLU-sparsified checkpoints (ReluLLaMA/ReluFalcon/ProSparse/Bamboo); "we do not support these models now" for standard dense models | Author-only, up to 11x (Falcon 40B, RTX 4090), but only on those special checkpoints | Disqualified — model doesn't exist for Qwen3.8-27B |
| PowerInfer-2 | Same idea, for **smartphones** | No — Android/ARM only, not a Windows desktop runtime at all | N/A | Disqualified — wrong platform |
| [AirLLM](https://github.com/lyogavin/airllm) | Layer-by-layer streaming to let an oversized model *run* under tight VRAM | Windows: not documented (Linux/macOS only in docs, unverified for Windows). Own layer-split format, not GGUF — needs conversion. | No tok/s numbers published for any config; its "3x speedup" claim is a separate quantization feature, not the base mechanism | Disqualified for this workload — it optimizes for *fitting*, not *throughput*: reloading one layer at a time per token is a **latency/throughput-destroying** design, the opposite of what a batch queue wants |
| [MLC-LLM](https://github.com/mlc-ai/mlc-llm) | Compiled inference, CUDA/Vulkan | Windows: native (confirmed, "Linux / Win ✅ Vulkan, CUDA"). GGUF: **not accepted directly** — needs `mlc_llm convert_weight` from source weights into MLC's own format. No CPU-offload-for-oversized-model feature found in docs. | Not verified | Medium-high — full reconversion, benefit unconfirmed |
| [fastllm](https://github.com/ztxz16/fastllm) | Dense + MoE inference, GPU+CPU hybrid, NUMA-aware | Windows+NVIDIA: native install (`pip install ftllm`), confirmed. Dense support: explicit ("支持稠密模型与MoE模型"). GGUF: **partial** — needs original tokenizer/config alongside the GGUF (`--ori` flag). | Author's own docs cite 20–30 tok/s single-concurrency, 60+ tok/s multi-concurrency, but **not pinned to a comparable model/hardware config** in what was fetched — treat as unverified until tried here | **Low** — pip install, worth a real trial; multi-concurrency framing fits a batch queue |
| [llama-swap](https://github.com/mostlygeek/llama-swap) | Hot-swaps between *different* model processes | Confirmed **not a speed lever** — a reverse proxy for switching models, irrelevant to single-model throughput | N/A | Disqualified — solves a different problem |
| LM Studio | GUI wrapper; llama.cpp or MLX backend | MLX is Apple-only (general knowledge, not independently re-verified via fetch this session — two docs URLs 404'd). No evidence found of a separate, faster Windows+NVIDIA engine distinct from llama.cpp. | Not verified | Likely no advantage over Ollama — same backend, same limits (unverified) |
| vLLM (`--cpu-offload-gb`) | GPU+CPU hybrid serving | **No native Windows** — "vLLM does not support Windows natively," needs WSL or an unofficial third-party fork ([SystemPanic/vllm-windows](https://github.com/SystemPanic/vllm-windows), unverified maintenance). GGUF support unclear; primary format is HF safetensors. `--cpu-offload-gb` behavior not documented in the page fetched. | Not verified | High — WSL/unofficial fork, benefit unconfirmed |
| DeepSpeed ZeRO-Inference | Designed for exactly this scenario: params resident in CPU RAM | Linux/CUDA-oriented, Windows support poor/unofficial (not fetch-verified). Format is HuggingFace, not GGUF — reconversion cost, loses Q4_K_M unless DeepSpeed's own quant is substituted. | Author's own blog: **43 tok/s on OPT-30B** (dense, comparable scale) — but on a single 32GB V100 + **1.5TB DRAM** + NVMe swap, DGX2-class hardware. Not transferable to a 32GB-RAM laptop; no independent reproduction found. | High — Linux + HF conversion, hardware not comparable, deprioritized |

**Bottom line: of nine alternative runtimes checked, six are disqualified outright** for this exact
model/platform/workload (KTransformers, PowerInfer, PowerInfer-2, AirLLM, llama-swap, and effectively
vLLM/DeepSpeed on cost grounds), and two more (MLC-LLM, LM Studio) show no confirmed advantage over
staying on Ollama. **fastllm is the one candidate worth an actual trial** — confirmed dense+Windows+GGUF-
adjacent support and a multi-concurrency design that matches a batch queue — but its only throughput
number isn't pinned to a comparable config, so treat any gain as unverified until measured here.

---

## 3. Speculative decoding

llama.cpp itself ships real, current speculative-decoding support in `llama-server` — FOUND from the
server README (fetched 2026-09-04): `--spec-draft-model`/`-md`/`--model-draft`, independent GPU-layer
and device control for the draft model (`-ngld`/`-devd`), and a `--spec-type` selector covering
`draft-simple, draft-eagle3, draft-mtp, draft-dflash, draft-dspark, ngram-*`.

**Ollama's exposure of this is genuinely unclear, and the two research passes on this topic disagree
in a way worth stating plainly:**
- Ollama's `docs/modelfile.mdx` "Valid Parameters and Values" table (a direct doc fetch, higher
  confidence) lists a `draft_num_predict` parameter — suggesting some draft-model / speculative-decoding
  support exists at the Modelfile/API level generally.
- A separate GitHub-issue-search pass (lower confidence — the session's WebSearch quota was exhausted
  for this sub-topic, and list/search-page fetches showed signs of unreliable summarization) turned up
  two merged PRs suggesting speculative decoding may currently be scoped to Ollama's **MLX runner
  (Apple Silicon only)**, not the GGUF/CUDA runner this Windows box uses — but this could not be
  independently re-confirmed and is flagged explicitly as low-confidence.
- **Net: not verified either way for the GGUF/CUDA path.** This needs a direct test (`draft_num_predict`
  in a Modelfile against the running `qwen3.8:27b` tag) rather than trusting either signal.

**Draft model candidate**: [Qwen/Qwen3-0.6B-GGUF](https://huggingface.co/Qwen/Qwen3-0.6B-GGUF) (fetched
2026-09-04) is a real, official, small Qwen3-family model — 28 layers, GQA 16Q/8KV heads, 32K context,
639MB at Q8_0. **Caveat**: qwen3.8:27b is `Qwen3_5` (Qwen3.5, hybrid-attention), not the plain `Qwen3`
family Qwen3-0.6B belongs to — speculative decoding requires the draft and target to share a tokenizer/
vocab, and while both are Qwen-lineage, **vocabulary/architecture compatibility between Qwen3.5 (target)
and Qwen3 (draft) is not verified** and should not be assumed.

**No measured CPU-offload-specific speculative-decoding benchmark was found anywhere** (llama.cpp
discussions #4167 and #15013 were checked directly and returned no matching data; Reddit was
unreachable). This is reported as a real gap, not filled with a guess. The reasoning that speculative
decoding should help *more* in a memory-bandwidth-bound regime (each accepted draft token amortizes one
full 18.5GB weight-read across multiple tokens instead of one) is architecturally sound but **is a
hypothesis, not a finding** — no source confirms or refutes it this session.

---

## 4. Batching and pipelining for the queue

llama.cpp's `llama-server` has continuous batching **on by default** —
`-cb`/`--cont-batching` (default: enabled), `-np`/`--parallel N` (default: auto) — FOUND from the server
README, fetched 2026-09-04. Ollama exposes the same concept via `OLLAMA_NUM_PARALLEL` (default **1**,
i.e. off), and since [PR #16031](https://github.com/ollama/ollama/pull/16031) (merged 2026-05-29) Ollama
runs GGUF inference exclusively through this same llama-server backend — `OLLAMA_NUM_PARALLEL` now maps
directly onto llama.cpp's own `-np`.

**Measured batching results exist, but only for fully-GPU-resident models — not our scenario:**
- [llama.cpp#27050](https://github.com/ggml-org/llama.cpp/issues/27050) (fetched 2026-09-04): Qwen2.5-7B
  F16, fully on an RTX 5090. 1 slot = 100.1 tok/s → 32 slots = 705.9–1045.8 tok/s, **≈10x**. Bottleneck at
  32 slots was host-side logits-copy overhead, not weight-read bandwidth.
- [llama.cpp discussion #18308](https://github.com/ggml-org/llama.cpp/discussions/18308) (fetched
  2026-09-04): RTX 5090 + 96GB RAM, fully GPU-resident. 1 seq = 3937.64 t/s → 32 seq = 9267.83 t/s,
  **≈2.35x**, diminishing sharply past ~4 slots due to CPU-side sampling overhead.

**No independent measurement was found for a dense large model with most weights streaming from system
RAM (our actual configuration)** — llama.cpp discussion #15013 (the CUDA/CPU-offload megathread) was
checked directly and explicitly lacked data on "dense models in the 20-35GB range, partial offload
configurations with most layers on CPU." Reddit, the likeliest source, was unreachable all session. This
is an honest gap, not a filled-in guess.

**Reasoned (unverified) expectation:** in a RAM-bandwidth-bound decode, each weight tensor is read from
RAM once per forward pass regardless of batch size — batching N independent sequences into one pass
should amortize that read across N sequences and raise *aggregate* tok/s, the same mechanism behind the
GPU results above. But the crossover to CPU-compute-bound will hit at a far smaller batch size than on a
5090, because 16 CPU cores have vastly less matmul throughput than thousands of CUDA cores. A plausible
range is **2-4x aggregate throughput at batch 4-8** — this is a hypothesis clearly labeled as such, not a
measurement.

---

## Ranking: what to try first (expected gain ÷ effort)

1. **Verify prefix caching actually fires on `qwen3.8:27b`, then exploit it.** Already on by default in
   both llama.cpp and Ollama, zero code to write — the only "effort" is testing whether it survives this
   model's hybrid/recurrent architecture (§3 in the ceiling analysis / §1's caveat), keeping
   `OLLAMA_NUM_PARALLEL=1`, keeping calls back-to-back (no idle gaps), and reading
   `prompt_eval_cached_count` in the response to confirm hits. If it holds, it collapses the cost of the
   1,742 identical CV tokens on every call after the first — real, independently measured mechanism
   (~33x on a cache hit, different hardware), but **the single biggest open risk in this whole report is
   that it may simply not work on this specific hybrid architecture**, so test before planning around it.
2. **Raise `OLLAMA_NUM_PARALLEL` and fire the queue concurrently.** Low effort (one env var + concurrent
   requests), real on-by-default mechanism underneath, plausible (unverified) 2-4x aggregate throughput —
   the only lever with a real shot at beating the single-stream bandwidth ceiling, because it changes
   what's being measured (aggregate tok/s across calls, not one call's tok/s).
3. **Sweep `--n-cpu-ffn`, KV-cache quant, and thread count.** Low effort, each a single flag/env var, no
   benchmark found for any of them at our scale — likely marginal (we're bandwidth-bound, not
   config-bound) but cheap enough to just try and measure locally.
4. **Try fastllm as a second runtime, in parallel, not as a replacement.** Confirmed dense+Windows+GGUF-
   adjacent support and a multi-concurrency design suited to a batch queue; the only throughput number
   found isn't pinned to a comparable config, so this is a real experiment, not a known win. Moderate
   effort (separate install, GGUF caveat with `--ori`).
5. **Test speculative decoding via raw `llama-server` (bypassing Ollama) with Qwen3-0.6B-GGUF as draft.**
   Real, shipped llama.cpp mechanism; Ollama's own support for it on the GGUF/CUDA path is unverified
   either way. Theoretically well-suited to a bandwidth-bound regime (unverified hypothesis) and to our
   deterministic, template-heavy prompt (favorable to draft-acceptance rate, not verified). Higher effort
   because it likely means stepping outside Ollama, and the draft/target vocab compatibility between
   Qwen3.5 (target) and Qwen3 (draft) isn't confirmed.
6. **Everything else in §2 — skip.** Six of nine alternative runtimes are disqualified for this exact
   model/platform (wrong architecture requirement, wrong platform, or actively throughput-hostile
   design); the remaining two show no confirmed advantage over the current Ollama setup.

Nothing here is expected to beat the memory-bandwidth ceiling in §0 (roughly **1.3-4.6 tok/s realistic
single-stream decode**, depending on unconfirmed RAM generation) for a single call. The only levers with
room to move the *queue's* real number are prefix caching (shrinking the prefill side, architecture risk
noted) and batching (raising aggregate tok/s across concurrent calls, unverified magnitude for this exact
config) — everything else is a small, uncertain multiplier on top of a ceiling this setup is likely
already close to.
