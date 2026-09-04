# Chinese LLM providers: pricing, weights, and evidence

Research date: 2026-09-04. This is a landscape map, not a proof that any model matches our quality
floor (**Qwen3.8-27B dense, Q4_K_M** — see `docs/llm-hosting-cost.md`). No controlled, parameter-matched
benchmark against that exact model was found for any provider below; where that's true it is stated
plainly rather than guessed at. FOUND = read directly on a fetched page, quoted. INFERRED = our
arithmetic or deduction from found numbers, always labeled. A page that would not render is reported
*unreachable* with the actual error.

**Workload (fixed, do not re-derive):** ~1,573 input + ~250 output tokens/call, 86%/14% split.
Backlog = 106,140 calls = 196M tokens → **168.56M in / 27.44M out**. Ongoing = 1,140 calls/day = 63M
tokens/month → **54.18M in / 8.82M out**. Cost formula used throughout: `(input_M × $/M-in) +
(output_M × $/M-out)`.

**Exchange rate used for every CNY figure below:** 1 USD = 6.71153279 CNY — xe.com
(https://www.xe.com/currencyconverter/convert/?Amount=1&From=USD&To=CNY), read 2026-09-04, "Mid-market
rate ... 06:39 UTC," cross-checked against Google Finance (https://www.google.com/finance/quote/USD-CNY,
same read date): "6.7168" — the two agree to within 0.08%.

---

## Comparison table

All $/M in USD. "Our 196M" = one-off backlog cost. "Our 63M/mo" = ongoing monthly cost. Independent
evidence is the **Artificial Analysis Intelligence Index** (AA, a 9-eval reasoning/knowledge composite —
general capability, not classification-specific) or **LMArena/arena.ai** (general human-preference chat
Elo, also not classification-specific) where found; "vendor only" means only the provider's own claimed
numbers exist; "none found" means neither AA nor LMArena tracks the model at all.

| Provider | Model | Open weights? | Licence | Params (active) | $/M in | $/M out | Our 196M | Our 63M/mo | Independent evidence | International access |
|---|---|---|---|---|---|---|---|---|---|---|
| DeepSeek | V4-Flash (off-peak, cache-miss) | Yes (HF) | MIT | 284B (13B MoE) | $0.22 | $0.66 | $55.19 | $17.74 | AA Intelligence Index **52** | Not confirmed — no card/geo statement found after 4 attempts |
| DeepSeek | V4-Pro (off-peak, cache-miss) | Yes (HF) | MIT | 1.6T (49B MoE) | $0.66 | $1.98 | $165.58 | $53.22 | AA Intelligence Index **53** | Same, not confirmed |
| Alibaba Qwen (DashScope) | Qwen-Turbo | API alias (see note) | n/a (alias) | not disclosed | $0.05 | $0.20 | $13.92 | $4.47 | **Gap** — only a deprecated predecessor (Qwen2.5-Turbo, AA score 6) was found under this slug | Confirmed: Singapore + Frankfurt (EU) endpoints, separate API keys |
| Alibaba Qwen (DashScope) | Qwen-Flash | API alias | n/a | not disclosed | $0.05 | $0.40 | $19.40 | $6.24 | Gap, same as above | Confirmed, same as above |
| Alibaba Qwen (DashScope) | Qwen-Plus | API alias | n/a | not disclosed | $0.40 | $1.20 | $100.35 | $32.26 | Not independently found | Confirmed |
| Alibaba Qwen (DashScope) | Qwen3.8-Max | API alias | n/a | not disclosed | $2.00 | $6.00 | $501.76 | $161.28 | AA Intelligence Index **58** — highest of any Chinese model found | Confirmed |
| Alibaba Qwen (open weight) | **Qwen3.8-27B** | **Yes (HF)** | **Apache-2.0** | 27B dense | n/a — self-host only | n/a | n/a | n/a | n/a — this is our own quality-floor model family | n/a |
| Moonshot / Kimi | K2.6 (standard) | Yes (HF) | Modified MIT | 1T (32B MoE) | $0.95 | $4.00 | $269.89 | $86.75 | AA Intelligence Index **45** | Confirmed: platform.kimi.ai (Singapore, USD) vs. mainland kimi.com/moonshot.cn |
| Moonshot / Kimi | K2.6 (batch, 40% off, confirmed) | Yes (HF) | Modified MIT | 1T (32B MoE) | $0.57 | $2.40 | $161.94 | $52.05 | Same as above | Same as above |
| Moonshot / Kimi | K3 | Yes (HF) | Custom "Kimi K3 License" ($20M/yr MaaS gate) | 2.8T (104B MoE) | $3.00 | $15.00 | $917.28 | $294.84 | AA Intelligence Index **60**; LMArena rank #12 (general chat) | Confirmed, same domain split as K2.6 |
| Zhipu / Z.ai | GLM-5.3-Flash (promo, **expires 2026-09-09**) | n/a (see GLM-4.x row) | n/a | not disclosed | $0.075 | $0.25 | $19.50 | $6.27 | Not found for this specific tier | Inferred: z.ai/docs.z.ai vs. JS-blocked mainland open.bigmodel.cn |
| Zhipu / Z.ai | GLM-5.3-Flash (list, post-promo) | — | — | — | $0.15 | $0.50 | $39.00 | $12.54 | Same as above | Same as above |
| Zhipu / Z.ai | GLM-4.5-Air | Yes (HF) | MIT | 106B (12B MoE) | $0.20 | $1.10 | $63.90 | $20.54 | AA Intelligence Index **17** | Same as above |
| Zhipu / Z.ai | GLM-4.7-FlashX | Yes (HF, 4.x family) | MIT | not disclosed | $0.07 | $0.40 | $22.78 | $7.32 | Not independently found | Same as above |
| Zhipu / Z.ai | GLM-5.3 | Yes (HF) | Custom "GLM-5.3 License" ($10B/yr gate) | 753B (40B MoE) | $1.40 | $4.40 | $356.72 | $114.66 | AA Intelligence Index **60** (tied with Kimi K3); LMArena rank #20 | Same as above |
| MiniMax | M2.7 / M3 (discounted rate) | Yes (HF) | Custom "MiniMax Community License" — non-commercial by default, notice/authorization required above $20M/yr | M3: 428B (23B MoE); M2.7: 229B (~10B MoE, inferred) | $0.30 | $1.20 | $83.50 | $26.84 | AA Intelligence Index: M3 **45** (#12/112), predecessor M2 **29** | Confirmed: Singapore entity, US data under EU-US Privacy Framework, named EU representative |
| Baidu (Qianfan/ERNIE) | ERNIE-4.5-Turbo-32K (online) | No (priced tier is proprietary) | n/a | not disclosed | $0.119 | $0.477 | $33.18 | $10.66 | **None found** for this priced model | Weak — Chinese-only site, mandatory real-name ID verification |
| Baidu (Qianfan/ERNIE) | ERNIE-4.5-Turbo-32K (batch, 40% of online, confirmed) | No | n/a | not disclosed | $0.048 | $0.191 | $13.27 | $4.27 | Same — none found | Same — weak |
| Baidu (Qianfan/ERNIE) | ERNIE 5.1 (≤32K) | No | n/a | not disclosed | $0.596 | $2.682 | $174.06 | $55.95 | None found (only vendor marketing claims) | Weak |
| Baidu (open weight, different gen) | ERNIE-4.5-300B-A47B | Yes (HF) | Apache-2.0 | 300B (47B MoE) | n/a | n/a | n/a | n/a | AA Intelligence Index **9** — below average, worst independent score found in this whole survey | n/a |
| ByteDance (Volcengine Ark, mainland) | doubao-seed-1.6-flash (online) | No (priced tier proprietary) | n/a | not disclosed | $0.0224 | $0.2235 | $9.90 | $3.18 | None found for this priced model | Mainland-billed (CNY), unconfirmed for non-China customers |
| ByteDance (Volcengine Ark, mainland) | doubao-seed-1.6-flash (batch, 50% off) | No | n/a | not disclosed | $0.0112 | $0.1118 | $4.95 | $1.59 | Same — none found | Same |
| ByteDance (Volcengine Ark, mainland) | doubao-seed-1.6 (online, our output bracket) | No | n/a | not disclosed | $0.119 | $1.192 | $52.80 | $16.97 | Same | Same |
| ByteDance (BytePlus, international) | ByteDance-Seed-1.6-flash (flat USD, no batch tier) | No | n/a | not disclosed | $0.075 | $0.30 | $20.87 | $6.71 | Same — none found | **Confirmed**: BytePlus Pte Ltd (Singapore), full GDPR apparatus, named UK + EEA/CH reps |
| ByteDance (open weight, different model) | Seed-OSS-36B-Instruct | Yes (HF) | Apache-2.0 | 36B dense | n/a | n/a | n/a | n/a | AA Intelligence Index **19** | n/a |
| Tencent | Hunyuan-A13B (legacy, cheap) | Yes (HF) | Custom, **explicitly excludes EU/UK/South Korea** | 80B (13B MoE) | $0.0745 | $0.298 | $20.74 | $6.67 | LMArena rank #169/400 (general chat, older snapshot) | Open-weight licence bars EU/UK; API/international billing not confirmed |
| Tencent | Hy4 preview (flagship, TokenHub) | Not released as weights | n/a | not disclosed | $0.894 | $2.683 | $224.33 | $72.11 | Not tracked by AA | Same, not confirmed |
| 01.AI | yi-lightning (only current model — router to DeepSeek-V3/Qwen3-30B-A3B/Yi-Lightning) | No (router, proprietary) | n/a | not disclosed | $0.1475 (blended, no in/out split published) | same | $28.92 | $9.30 | LMArena rank #231/400 (general chat) | China-only — CNY-only recharge, no international endpoint found |
| 01.AI (open weight, unrelated model) | Yi-1.5-34B-Chat | Yes (HF) | Apache-2.0 | 34B dense | n/a | n/a | n/a | n/a | Not independently benchmarked in this pass | n/a |
| StepFun | step-3.5-flash (no cache) | Yes (HF) | Apache-2.0 | 196.8B (~11B MoE) | $0.10 | $0.30 | $25.09 | $8.06 | LMArena rank #156/400, price cross-verified | Dedicated USD/English platform (platform.stepfun.ai); no explicit EU/card statement |
| StepFun | step-3.5-flash (full cache-hit, best case) | Yes (HF) | Apache-2.0 | 196.8B (~11B MoE) | $0.02 | $0.30 | $11.60 | $3.73 | Same | Same — **cheapest total found across every provider in this survey** |
| StepFun | step-3.7-flash (flagship, no cache) | Not released as weights | n/a | not disclosed | $0.20 | $1.15 | $65.27 | $20.98 | Not independently found | Same |
| iFlytek | Spark-X2-Flash (blended range, console detail login-gated) | Uncertain (see note) | Apache-2.0 if same org | 4B (dense, unconfirmed same org) | $0.149–$0.298 (blended) | same | $29.21–$58.42 | $9.39–$18.78 | **None found** — absent from both AA and LMArena | Weak — global.xfyun.cn exists but offers only speech/ASR/TTS, no LLM API found |
| iFlytek | Spark X2 (reasoning tier, blended range) | — | — | — | $0.298–$0.447 | same | $58.42–$87.63 | $18.78–$28.17 | None found | Same |

---

## Per-provider notes (data handling, international access, and evidence caveats)

### DeepSeek
SOURCE: https://api-docs.deepseek.com/quick_start/pricing/ · read 2026-09-04 · fetched
QUOTES: "1M Input Tokens (Cache Miss) - Off-Peak: v4-flash $0.22, v4-pro $0.66"; "Peak hours are 01:00 - 04:00
and 06:00 - 10:00 UTC, Monday through Friday" — off-peak is a flat 50% discount, directly usable for our
background queue.

SOURCE: https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html · read 2026-09-04 · fetched
QUOTES: "to train and improve our technology, such as our machine learning models" (training use confirmed);
"the right to opt-out of using your Personal Data for training" (opt-out exists); "we directly collect,
process and store your Personal Data in People's Republic of China" — data resides in China regardless of
customer location.

International/Europe access: **not found**. Four attempts across three official/CDN URLs (platform top-up
page 403, docs FAQ pages either stub or empty client-rendered shells) returned no payment-method or
geo-restriction text. USD pricing on the main docs page suggests international billing is possible, but
this is inference, not a confirmed fact.

### Alibaba Qwen (Model Studio / DashScope)
SOURCE: https://www.alibabacloud.com/help/en/model-studio/what-is-model-studio · read 2026-09-04 · fetched
QUOTES: "Alibaba Cloud protects data privacy and will never use your data for model training." — the
strongest data-handling statement of any provider surveyed (an absolute claim, not an opt-out). "China
(Beijing), US (Virginia), Singapore, Japan (Tokyo), Germany (Frankfurt), and China (Hong Kong)" — served
regions, including an EU region. "API keys (not interchangeable across regions)" confirms Beijing and
Singapore/Frankfurt are fully separate deployments — the clearest EU-access evidence found in this survey.

SOURCE: https://huggingface.co/Qwen/Qwen3.8-27B · read 2026-09-04 · fetched
QUOTES: "Number of Parameters: 27B" (dense); license header "apache-2.0"; "Context Length: 262,144
natively." **This is the open-weight model that shares its name with our own quality-floor model.** No
source in this research made an explicit "Qwen-Turbo/Flash IS Qwen3.8-27B" claim — Alibaba doesn't publish
which underlying weights back each hosted alias — so this is a strong hint, not a confirmed identity.

Evidence gap: no current independent benchmark exists for the qwen-turbo or qwen-flash aliases as they are
priced today. The only "qwen-turbo" page found on Artificial Analysis actually resolves to the deprecated
**Qwen2.5 Turbo** (AA score 6, explicitly flagged by AA as superseded) — not representative of the current
alias. Reported as a gap, not papered over with a stale number.

### Moonshot AI / Kimi
SOURCE: https://platform.kimi.ai/docs/pricing/batch.md · read 2026-09-04 · fetched
QUOTES: "Batch API inference costs are 60% of the standard model price" — confirmed 40%-off batch tier for
K2.6/K2.7-code, but **not offered for the K3 flagship**.

SOURCE: https://huggingface.co/moonshotai/Kimi-K3/blob/main/LICENSE · read 2026-09-04 · fetched
QUOTES: "If the Licensee... operates a Model as a Service business, and the aggregate revenue... exceeds 20
million US dollars... over any consecutive 12 months, the Licensee must enter into a separate agreement" —
a revenue-gated custom license, irrelevant to JobRadar's current scale but worth knowing if the product
ever monetizes.

SOURCE: https://platform.kimi.ai/docs/agreement/modeluse.md · read 2026-09-04 · fetched
QUOTES: "We may use Content to provide, maintain, develop, support, and improve the Services" (soft
training-use language); "Customer who requires restrictions on the use of Customer Content for training...
may contact Moonshot AI to discuss available enterprise arrangements" — opt-out exists but only via manual
enterprise agreement, not self-serve.

International access: confirmed distinct platform.kimi.ai (English, USD) vs. mainland kimi.com/moonshot.cn
(Chinese); privacy policy includes an explicit EEA/UK/Switzerland cross-border-transfer safeguard clause.

### Zhipu AI / Z.ai (GLM)
SOURCE: https://docs.z.ai/guides/overview/pricing · read 2026-09-04 · fetched
QUOTES: "GLM-5.3-Flash is available at a 50% discount" — regular price shown struck through
("~~$0.15~~ $0.075"), promo explicitly stated to end **"September 9, 2026"** — 5 days after the read date.
**This promo pricing has a short shelf life and should not be treated as a stable comparison point.**

SOURCE: https://docs.z.ai/legal-agreement/privacy-policy.md · read 2026-09-04 · fetched
QUOTES: "We generally provide the Services from Singapore." No explicit training-use or opt-out clause was
found in this document — reported as **not found**, not assumed either way.

SOURCE: https://docs.z.ai/legal-agreement/terms-of-use.md · read 2026-09-04 · fetched
QUOTES: "You confirm that you are not located in the following regions: Iran, North Korea, Cuba, Crimea,
Donetsk, or Zaporizhzhia." — the EU is explicitly not excluded, and the ToS separately cites EU-law
compliance obligations, indicating EU customers are served. Mainland pricing at open.bigmodel.cn was
unreachable (JS-rendered shell, no numeric table extractable) — z.ai/docs.z.ai is inferred to be the
international-facing surface based on domain/rendering split, not an explicit vendor statement.

### MiniMax
SOURCE: https://huggingface.co/MiniMaxAI/MiniMax-M3/raw/main/LICENSE · read 2026-09-04 · fetched
QUOTES: "Permission is hereby granted... to deal in the Software for non-commercial purposes... If the
Software... is used for any Commercial Use... you shall obtain a separate, prior written authorization
from MiniMax... if such products and services generate more than 20 million US dollars... in yearly
revenue; otherwise, you only need to send a one-time notice." — **not MIT/Apache**; free for non-commercial
use, one-time notice required for any commercial use regardless of revenue.

SOURCE: https://platform.minimax.io/protocol/privacy-policy · read 2026-09-04 · fetched
QUOTES: "we do not use your input personal data to infer characteristics about an individual, nor use
personal data for training to profile or target consumers" (narrow promise, not a blanket no-training
statement); "we store your data cross-border in Cloud's US data center in a manner certified under the
EU-US Privacy Framework"; "You can also contract our EU representative." Strong international-access
evidence; data-handling statement is narrower/more ambiguous than Alibaba's.

### Baidu (ERNIE / Qianfan)
SOURCE: https://cloud.baidu.com/doc/qianfan/s/wmh4sv6ya · read 2026-09-04 · fetched (via browser rendering
— static WebFetch returned only nav chrome, the pricing table is JS-rendered)
QUOTES: "ERNIE-4.5-Turbo-32K... 输入 0.0008 0.00032" (online/batch, CNY per 1K tokens) — confirms a genuine
batch tier at 40% of the online rate, the same ratio Tencent's TokenHub uses for third-party GLM models.

Evidence and access gaps, both reported as **not found** rather than assumed: no training-data/opt-out
statement was located after two direct URL attempts (both 404'd); no independent benchmark exists for the
actually-priced ERNIE 5.1/ERNIE-4.5-Turbo models (only the unrelated open-weight ERNIE-4.5-300B-A47B was
independently scored, and it scored the worst — AA 9 — of any model in this entire survey). Qianfan itself
is Chinese-language only with mandatory real-name ID verification for new accounts; a separate English
"Baidu AI Cloud International" site exists but whether it resells the ERNIE API specifically to non-China
customers was not confirmed.

### ByteDance (Doubao / Volcengine Ark / BytePlus)
SOURCE: https://docs.volcengine.com/docs/82379/1544106?lang=zh · read 2026-09-04 · fetched (via browser)
QUOTES: "按token后付费，相比在线推理，价格低至50%" ("batch pricing is up to 50% cheaper than online") —
confirmed batch discount, mainland (CNY) pricing only.

SOURCE: https://docs.byteplus.com/en/docs/legal/AI_Models_FAQ · read 2026-09-04 · fetched
QUOTES: "When you use our AI products and features, such as ModelArk Starter apps and Playground, your
information... may be used to train such models, unless you choose to opt out." — "**This does not apply
where we provide models as a service ('MaaS') to our corporate customers**, unless such corporate customers
have expressly authorized such model training." **This is the clearest positive data-handling statement
found in the entire survey**: for programmatic API/MaaS use (what JobRadar would do), inputs are NOT used
for training by default.

SOURCE: https://docs.byteplus.com/en/docs/legal/docs-privacy-policy · read 2026-09-04 · fetched
QUOTES: "If you are based in the United Kingdom, our designated GDPR representative is..."; "If you are
based in the EEA or Switzerland, our designated GDPR representative is..." — full, named GDPR apparatus,
the strongest international-access evidence found in this survey.

Caveat: the mainland CNY pricing (cheapest numbers in the whole table, e.g. doubao-seed-1.6-flash batch at
$4.95 backlog) is on Volcengine Ark, a separate mainland-billed product from BytePlus ModelArk (the
internationally-accessible, GDPR-documented one). BytePlus's own international pricing is flat-rate USD
with **no batch discount found** — international customers likely cannot reach the cheapest mainland
numbers.

### Tencent Hunyuan
SOURCE: https://huggingface.co/tencent/Hunyuan-A13B-Instruct/blob/main/LICENSE · read 2026-09-04 · fetched
QUOTES: "THIS LICENSE AGREEMENT DOES NOT APPLY IN THE EUROPEAN UNION, UNITED KINGDOM AND SOUTH KOREA" — an
explicit geographic carve-out that rules out the open-weight self-host path for a Europe-facing product.

SOURCE: https://cloud.tencent.com/document/product/301/97822 · read 2026-09-04 · fetched
QUOTES: "除另行获取您的授权同意外，腾讯云不会将您输入的内容用于开发或改进本服务的算法、模型等" ("Unless you
separately authorize it, Tencent Cloud will NOT use your input content to develop or improve this service's
algorithms/models") — a positive, opt-out-by-default data-handling statement, undercut by the EU/UK
exclusion on the open-weight license above.

### 01.AI (Yi)
SOURCE: https://platform.lingyiwanwu.com/docs · read 2026-09-04 · fetched (via browser)
QUOTES: "yi-lightning... 会根据用户输入，智能路由到 DeepSeek-V3、Qwen3-30B-A3B、Yi-Lightning 等" — confirms
01.AI's only current API offering is a **router** that dispatches to DeepSeek-V3, Qwen3-30B-A3B, or its own
Yi-Lightning model depending on the request. There is no way to force which backend handles a given call.

SOURCE: https://platform.lingyiwanwu.com/recharge · read 2026-09-04 · fetched
QUOTES: "充值金额 100元 200元 500元..." — top-up amounts are CNY-only; no international payment or endpoint
was found anywhere on the platform.

### StepFun
SOURCE: https://platform.stepfun.ai/docs/en/guides/pricing/details · read 2026-09-04 · fetched
QUOTES: "step-3.5-flash 1M tokens $0.10 (Cache Miss) $0.02 (Cache Hit) $0.30 (Output)" — native USD pricing
on a dedicated English platform, cross-validated against the CNY page (¥0.7/M × the day's exchange rate ≈
$0.1043 vs. the $0.10 published — consistent to within rounding).

SOURCE: https://platform.stepfun.ai/docs/en/agreement/userprivacy · read 2026-09-04 · fetched
QUOTES: "We may use and retain such data to evaluate and improve our models, products, and services,
including for issue analysis, training, and fine-tuning where permitted by applicable law." No "opt out,"
"zero retention," or "do not train" language was found anywhere on the page — **this is the one provider in
the survey with an explicit training-use statement and no discoverable opt-out at all.**

### iFlytek Spark
SOURCE: https://huggingface.co/XHToken · read 2026-09-04 · fetched
QUOTES: "SparkLLM focuses on developing leading general-purpose foundation models... The company offers its
proprietary Spark model family." The org page never mentions iFlytek, 讯飞, or xfyun.cn. **Whether this
Hugging Face org is actually iFlytek's official release could not be confirmed** — the model names
(Spark-X2.5-4B/1.7B) match iFlytek's own product page exactly, which is suggestive but not proof.

SOURCE: https://global.xfyun.cn/ · read 2026-09-04 · fetched
FOUND: iFlytek's international platform exists and is live, but every listed capability is
speech/ASR/TTS/translation — searching the rendered page for "Spark," "LLM," "large language model" found
**none**. The Spark chat/reasoning API does not appear to be offered internationally through this official
channel.

SOURCE: https://console.xfyun.cn/services/bm35 · read 2026-09-04 · unreachable — requires login; not
pursued further since creating an account was out of scope for this pass, so the finer per-model
input/output price split (only a blended ¥/M range was available from the public landing page) could not
be obtained.

---

## Worth a real evaluation against our 12,886 existing 27B judgements

Ranked roughly by (cost × independent evidence strength × practical access), not by raw benchmark score:

1. **Alibaba Qwen-Turbo / Qwen-Flash (DashScope, international endpoint)** — cheapest reliable option
   ($13.92–$19.40 backlog, $4.47–$6.24/month) from the provider with the strongest data-handling statement
   found ("will never use your data for model training") and confirmed EU access (Frankfurt endpoint). The
   evidence gap — no current independent benchmark for the specific turbo/flash alias — is exactly what our
   own held-out comparison would resolve, and Alibaba's own open-weight Qwen3.8-27B (Apache-2.0) is the same
   named family as our current quality-floor model, making this the most directly relevant candidate to test
   even though the alias-to-weights mapping isn't publicly confirmed.

2. **DeepSeek V4-Flash, off-peak** — $55.19 backlog / $17.74/month, with genuine independent evidence (AA
   Intelligence Index 52, nearly matching flagship V4-Pro's 53 at a fraction of the price) and a scheduled
   off-peak window that fits a background batch queue by construction. Open weights (MIT) exist but at 284B
   total/13B active the model is too large to self-host locally — this is an API-only candidate for us
   despite being "open."

3. **StepFun step-3.5-flash** — the single cheapest number found across the entire survey ($11.60 backlog /
   $3.73/month at full cache-hit; $25.09/$8.06 with no caching), open weight (Apache-2.0), and its price is
   independently corroborated on LMArena. Worth testing specifically because the price gap versus every
   other option is large enough to be worth confirming or disproving — but its data-handling posture is the
   worst found (trains on inputs by default, no opt-out located), so this is a cost/quality/privacy
   trade-off to weigh explicitly, not a free win.

4. **GLM-5.3 or Kimi K3 (flagship tier)** — tied for the best independent composite score of any Chinese
   model found (AA Intelligence Index 60 each), worth evaluating if raw capability matters more than price
   for a subset of harder judgements. Materially more expensive ($356.72/$114.66 for GLM-5.3; $917.28/
   $294.84 for K3) — K3's revenue-gated custom license and GLM-5.3's similar gate are both irrelevant at
   JobRadar's current scale.

## Ruled out, and why

- **iFlytek Spark** — no independent evidence anywhere (absent from both Artificial Analysis and LMArena),
  the open-weight HF org's affiliation with iFlytek is unconfirmed, and the international platform doesn't
  appear to offer the LLM product at all (speech/ASR/TTS only). Nothing here supports building a comparison.
- **01.AI Yi-lightning** — it is a router that dispatches to DeepSeek-V3 or Qwen3-30B-A3B under the hood, so
  evaluating it doesn't add independent information beyond what DeepSeek/Qwen evaluations already cover, and
  the platform is CNY-only with no discoverable international endpoint.
- **Baidu ERNIE (Qianfan)** — no independent evidence exists for the actual priced models (ERNIE 5.1 /
  ERNIE-4.5-Turbo); the only independently scored ERNIE model is an unrelated open-weight sibling that
  scored the worst (AA 9) of anything in this survey. Qianfan is Chinese-language-only with mandatory
  real-name verification, and no training-data policy could be located — three separate gaps stacking
  against it.
- **Tencent Hunyuan** — the open-weight license explicitly excludes the EU, UK, and South Korea, a legal
  blocker rather than a technical one if JobRadar ever needs to operate from or serve those regions. Its
  only independent signal is a general-chat LMArena rank (#169/400), not a reasoning/classification measure.
- **ByteDance Doubao (mainland pricing)** — the genuinely cheap numbers ($4.95–$9.90 backlog) are on the
  mainland Volcengine Ark product, which is CNY-billed and not confirmed accessible internationally; the
  internationally-accessible BytePlus ModelArk product is priced 2–4x higher with no batch discount. Neither
  tier has independent benchmark evidence for the actual priced Doubao-Seed models.
- **MiniMax** — decent independent evidence (AA 45) and reasonable pricing, but the custom "MiniMax
  Community License" is non-commercial by default and requires notice/authorization for any commercial use —
  a real constraint the moment JobRadar stops being a personal tool, worth flagging even though it isn't a
  hard blocker today.

---

## Sources

api-docs.deepseek.com/quick_start/pricing/, huggingface.co/deepseek-ai/DeepSeek-V4-Flash,
huggingface.co/deepseek-ai/DeepSeek-V4-Pro, huggingface.co/deepseek-ai/DeepSeek-V3.2, huggingface.co/deepseek-ai,
cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html, cdn.deepseek.com/policies/en-US/deepseek-terms-of-use.html,
artificialanalysis.ai/models/deepseek-v4-pro, artificialanalysis.ai/models/deepseek-v4-flash,
www.alibabacloud.com/help/en/model-studio/billing-for-model-studio, www.alibabacloud.com/help/en/model-studio/what-is-model-studio,
www.alibabacloud.com/help/en/model-studio/models, help.aliyun.com/zh/model-studio/billing-for-model-studio,
huggingface.co/Qwen/Qwen3.8-27B, huggingface.co/Qwen, artificialanalysis.ai/models/qwen3-8-max,
artificialanalysis.ai/models/qwen-turbo, platform.kimi.ai/docs/pricing (and /chat-k3.md, /chat-k27-code.md,
/chat-k26.md, /batch.md, /tools.md), platform.kimi.ai/docs/introduction/models, huggingface.co/moonshotai,
huggingface.co/moonshotai/Kimi-K2-Instruct, huggingface.co/moonshotai/Kimi-K2.6, huggingface.co/moonshotai/Kimi-K3
(and LICENSE), platform.kimi.ai/docs/agreement/userprivacy.md, platform.kimi.ai/docs/agreement/modeluse.md,
platform.kimi.com/docs/pricing/chat, artificialanalysis.ai/models/kimi-k2, /kimi-k3, /kimi-k2-6, arena.ai/leaderboard/text,
docs.z.ai/guides/overview/pricing, huggingface.co/zai-org, huggingface.co/zai-org/GLM-4.5, /GLM-4.5-Air, /GLM-4.6,
/GLM-5.3 (and LICENSE), artificialanalysis.ai/models/glm-4-6, /glm-4-7, /glm-4-5-air, /glm-5-3,
docs.z.ai/legal-agreement/privacy-policy.md, /terms-of-use.md, docs.z.ai/llms.txt,
platform.minimax.io/docs/guides/pricing-paygo, artificialanalysis.ai/models/minimax-m3, /minimax-m2,
huggingface.co/MiniMaxAI/MiniMax-M3 (and LICENSE), huggingface.co/MiniMaxAI/MiniMax-M2.7 (and LICENSE),
platform.minimax.io/protocol/privacy-policy, cloud.baidu.com/doc/qianfan/s/wmh4sv6ya,
huggingface.co/baidu/ERNIE-4.5-300B-A47B-PT, artificialanalysis.ai/models/ernie-4-5-300b-a47b,
intl.cloud.baidu.com/en, docs.volcengine.com/docs/82379/1544106, www.byteplus.com/en/product/modelark,
docs.byteplus.com/en/docs/legal/docs-privacy-policy, docs.byteplus.com/en/docs/legal/AI_Models_FAQ,
huggingface.co/ByteDance-Seed/Seed-OSS-36B-Instruct, artificialanalysis.ai/models/seed-oss-36b-instruct,
cloud.tencent.com/document/product/1729/97731, cloud.tencent.com/product/tokenhub,
huggingface.co/tencent/Hunyuan-A13B-Instruct (and LICENSE), cloud.tencent.com/document/product/301/97822,
platform.lingyiwanwu.com/docs, platform.lingyiwanwu.com/privacypolicy, platform.lingyiwanwu.com/recharge,
huggingface.co/01-ai, huggingface.co/01-ai/Yi-1.5-34B-Chat, platform.stepfun.com/docs/zh/guides/pricing/details,
platform.stepfun.ai/docs/en/guides/pricing/details, huggingface.co/stepfun-ai/Step-3.5-Flash,
platform.stepfun.ai/docs/en/agreement/userprivacy, xinghuo.xfyun.cn/sparkapi?scr=price, huggingface.co/XHToken,
huggingface.co/XHToken/Spark-X2.5-4B, www.xfyun.cn/doc/spark/PrivacyPolicy.html, global.xfyun.cn,
artificialanalysis.ai/providers, www.xe.com/currencyconverter, www.google.com/finance/quote/USD-CNY — all read
2026-09-04. Unreachable, reported as such rather than filled from memory: platform.deepseek.com/top_up (403),
static.deepseek.com FAQ (empty client-rendered shell), open.bigmodel.cn/pricing (JS-rendered, no static
table), artificialanalysis.ai/models/qwen3-8-flash and /qwen-flash and /providers/alibaba and /providers/zhipu
and /providers/tencent (404), z.ai/terms-of-service and z.ai/legal/terms (404), cloud.baidu.com/doc/Agreement
pages (404), console.xfyun.cn/services/bm35 (login-gated, not pursued).
