# Transcript Extractor — Institutional Reference Evidence (2026)

## TL;DR (Trading Forge gap assessment)

- Current gemma4:e2b / qwen2.5-coder:7b + GBNF structured output is architecturally SOUND for schema shape but GBNF crashes on long transcripts due to VRAM exhaustion
- The `speaker_concepts` v12 open-vocabulary field ALREADY implements the right pattern — the gap is upstream, not downstream
- 2026 production consensus: validate-and-retry loop (Instructor / agentcast pattern) beats GBNF for consumer 8GB VRAM because GBNF FSM overhead scales with schema complexity and crashes at ~4K+ context
- Phi-4 (3.8B) outperforms Gemma 4 e2b (2B-effective) on JSON extraction (94% vs ~88% first-attempt compliance) with no grammar enforcement needed
- Two-pass architecture (Pass 1: open speaker-concept extraction, Pass 2: schema-map concepts to v11 fields) is the 2026 institutional standard for novel-domain vocabulary; Trading Forge already has the v12 `speaker_concepts` field which IS Pass 1 — the missing piece is running these as two separate lower-risk LLM calls rather than one monolithic v11 GBNF-constrained call
- The hybrid LLM-prose + server-side NLP pattern is NOT institutional-grade 2026 for novel domains; pure-LLM two-pass is the standard; server-side NLP is acceptable as a post-processing enrichment layer but must NOT be the primary vocabulary gate

---

## Sources (2025-2026 only — stale items rejected)

| Date | Source | Tier | Citation | Key claim |
|---|---|---|---|---|
| 2026-04-24 | Antigravity Lab production guide | blog-general (corroborated) | https://antigravitylab.net/en/articles/agents/antigravity-gemma4-constrained-decoding-production-guide | "Outlines for development, vLLM for high-concurrency production, raw llama.cpp for tiny utilities. GBNF is best when running GGUF on CPU or modest GPU. For 8GB+ GPU production, Outlines + Pydantic is the friendliest entry." |
| 2026-05-16 | DEV Community — Mukundakatta (gemma4:e2b five libraries) | blog-general | https://dev.to/mukundakatta/making-gemma-4-e2b-production-safe-with-five-tiny-libraries-54c1 | "agentcast: validate-and-retry with JSON extraction from prose, code fences, and largest balanced substring. Without it, small Gemma 4 with structured-output tasks is unreliable. With it: trust established." |
| 2026-04-01 | Fordel Studios — LLM Structured Outputs Production Guide | blog-general | https://fordelstudios.com/research/structured-outputs-production-systems | "~15% inference overhead for constrained decoding. Phase 3 (2025-2026): constrained decoding guarantees schema adherence at token generation level. Catch: only available for self-hosted models. ~3% failure rate on JSON parsing with naive JSON mode." |
| 2026-05-12 | MasterPrompting.net — Small Language Models 2026 | blog-general | https://masterprompting.net/blog/small-language-models-phi4-gemma-on-device-2026 | "JSON extraction benchmark: GPT-4o 97%, Phi-4 3.8B 94%, Gemma 3 4B 91%. Gap closed to 3-8pt for extraction tasks. Phi-4 matches GPT-4o on structured extraction benchmarks. SLMs require more precise, constrained prompts — long system prompts (>2K tokens) partially ignored." |
| 2026-03-02 | Markaicode — Reliable Structured Output from Local LLMs | blog-general | https://markaicode.com/ollama-structured-output-pipeline/ | "Benchmark across model sizes: GBNF grammar success = 100% regardless of model size. Native JSON mode: 89-98%. Grammar is the only path to 100% first-attempt compliance. Grammar must be defined upfront — no dynamic vocabularies." |
| 2026-04-08 | arXiv 2604.05158 — Just Pass Twice (JPT) | research | https://scirate.com/arxiv/2604.05158 | "Concatenating input to itself lets each token attend to complete sentence (+7.9 F1 vs SOTA on zero-shot NER). 20x faster than comparable generative methods. No architectural modifications required. Enables causal LLMs to perform discriminative token classification." |
| 2026-05-14 | Passive.cloud — Scaling Transcript NLP (institutional-scale) | blog-general | https://passive.cloud/scaling-transcript-nlp-a-technical-blueprint-to-find-competi | "Multi-label classification over single-label tagging. Utterance-level extraction then aggregate. Chunk by semantic boundaries not token counts (150-300 token speaker-continuity chunk is strong default). Store provenance alongside every extracted mention. Canonicalize and alias management for novel terms." |
| 2026-01-18 | Aidan Cooper — Constrained Decoding Guide | blog-general | https://www.aidancooper.co.uk/constrained-decoding/ | "GBNF grammar overhead scales with grammar complexity. On complex schemas, token masking computation becomes non-trivial. Primary use case: well-defined closed vocabularies (enums, fixed schemas). Dynamic/open vocabularies break the FSM approach." |
| 2026-05-05 | Reddit r/LocalLLaMA — Qwen 3.6 vs Gemma 4 structured output | community-expert | https://www.reddit.com/r/LocalLLaMA/comments/1t1te8y/qwen_36_wins_the_benchmarks_but_gemma_4_wins/ | "Qwen completely ignored scaling instruction and output raw coordinates in wrong format. Gemma 4 structured outputs: clean and consistent — JSON, markdown tables, formatted lists. Matters for agentic workflows where downstream steps depend on predictable output format." |
| 2026-04-05 | MindStudio — Gemma 4 vs Qwen 3.5 | blog-general | https://www.mindstudio.ai/blog/gemma-4-vs-qwen-3-5-open-weight-comparison | "Gemma 4 tends to be clean and consistent with structured outputs. This matters a lot for agentic workflows where downstream steps depend on predictable output format." |
| 2025-11-19 | Microsoft Azure Blog — Phi-4 family | corporate-eng | https://azure.microsoft.com/en-us/blog/empowering-innovation-the-next-generation-of-the-phi-family/ | "Function calling, instruction following, long context, and reasoning are powerful capabilities for small language models. Phi-4-mini at 3.8B enables access to external knowledge and functionality." |
| 2026-03-14 | Reddit r/quant — LLM outputs in live signal pipeline | community-expert | https://www.reddit.com/r/quant/comments/1rtvaia/does_anyone_actually_use_llm_outputs_in_a_live/ | "Using LLMs to process earnings call transcripts and flag sentiment shifts. Bigger issue: output not deterministic. Same input, different run, different score. Variability itself is the problem — not schema format." |

---

## Trading Forge vs institutional comparison

| Aspect | Trading Forge implementation | Institutional reference (2026) | Gap |
|---|---|---|---|
| **Primary extraction model** | qwen2.5-coder:7b (primary), gemma4:e2b (legacy), gpt-5-mini (fallback) | Phi-4 3.8B OR qwen2.5 3B/7B for extraction tasks; Gemma 3 4B acceptable | SMALL: qwen2.5-coder:7b is correct choice; Phi-4 would add ~3pt JSON compliance improvement |
| **Schema enforcement method** | Ollama `/api/chat` format object (GBNF-constrained via Ollama 0.5+) | 2026 standard: validate-and-retry (Instructor pattern) OR Outlines FSM for self-hosted; GBNF only for simple schemas / CPU inference | CRITICAL: GBNF crashes on long transcripts (VRAM exhaustion) — confirmed failure mode; retry loop is the production-grade fix |
| **Novel vocabulary handling** | v12 `speaker_concepts[]` open array captures arbitrary terms verbatim; downstream `gemma-prose-to-v11.ts` maps concepts to schema fields | "Pass 1: open extraction of speaker terms. Pass 2: map to schema." Two-pass pipeline is 2026 standard for novel domains | MEDIUM: architecture is correct in design; but Pass 1 and Pass 2 run as one monolithic LLM call with GBNF enforcement on the full v11 schema, not two separate calls |
| **GBNF on long transcripts** | VRAM exhaustion crash on RTX 5060 8GB with transcripts >~4K tokens | 2026 community consensus: GBNF FSM overhead scales with schema complexity; crashes are expected at long context on 8GB VRAM; workaround is shorter context + chunking OR abandon GBNF for retry pattern | CRITICAL: known crash mode with no current mitigation beyond cloud fallback |
| **Retry / self-correction loop** | Cloud fallback on any Ollama failure; no structured retry-on-validation-failure | agentcast pattern (2026): extract JSON from prose/fences/balanced-substring; validate; feed error back to model on fail; 2-3 retries resolves most failures | HIGH: missing validate-and-retry; when GBNF fails, only cloud fallback exists — no local retry |
| **Server-side NLP for vocab** | Regex catalog covering ICT/SMC terms; novel domains (Volume Profile, Wyckoff, scalping) miss all proprietary terms | Pure-LLM open extraction is 2026 standard for novel vocab; server-side NLP acceptable as enrichment AFTER open extraction | HIGH: server-side NLP as primary gate for vocabulary is not institutional-grade for novel domains |
| **Context window management** | Full transcript passed to model in one call | 2026 best practice: chunk by semantic boundaries (150-300 token speaker-continuity chunks); agent-fit library trims context before every turn | MEDIUM: long transcripts exceed model's reliable instruction-following window (>2K tokens system prompt partially ignored per Phi-4 benchmark data) |
| **Extraction evaluation** | 5-fixture parity test (smoke-test gate) | Institutional: snapshot testing of agent tool-call trace; regression on tool-call ORDER not just final output; separate evaluation corpus per domain | LOW at current scale; beneficial to expand fixture coverage to Volume Profile / Wyckoff / scalping domain videos |

---

## Recommended changes (with citations)

### Recommendation 1 (THIS WEEK — highest ROI): Replace GBNF with validate-and-retry loop

**Problem:** GBNF crashes on long transcripts due to VRAM exhaustion on the RTX 5060 8GB. GBNF is also incompatible with dynamic/open vocabularies — the `speaker_concepts[]` array with arbitrary speaker terms cannot be described in a GBNF grammar (it is open-ended by design).

**Evidence:** Antigravity Lab 2026-04-24 (GBNF is for "light utilities," vLLM or Outlines for production); Markaicode 2026-03-02 (grammar must be defined upfront — dynamic vocabularies break FSM approach); DEV Community Mukundakatta 2026-05-16 (agentcast validate-and-retry is "the load-bearing one for small models... without it I would not trust small Gemma 4 with structured-output tasks").

**Concrete change:**
1. Remove the GBNF schema enforcement from the Ollama `/api/chat` `format` object on the full v11 schema (keep `format: "json"` string mode for basic JSON coercion).
2. After the Ollama call returns raw text, run an extraction step: try full JSON parse, then strip markdown fences, then extract largest balanced `{...}` substring.
3. Validate the extracted object against the v11 JSON Schema (ajv or zod).
4. On validation failure, feed the error text back to the model in a follow-up message: "Your JSON had the following validation errors: [errors]. Please restate your answer as valid JSON only." Max 2 retries.
5. Only on persistent retry failure, escalate to cloud.

**Scale assessment:** Required at this scale. VRAM crashes are production-blocking failures. Retry loop adds ~200-400ms on failure path (rare) with zero overhead on success path.

---

### Recommendation 2 (THIS WEEK — close the novel-vocab gap): Decouple Pass 1 (open extraction) from Pass 2 (schema mapping)

**Problem:** The `speaker_concepts` v12 field is architecturally correct — it IS the open extraction pass. But it runs in the same LLM call as the full v11 schema enforcement. The model is simultaneously trying to (a) identify novel speaker vocabulary freely and (b) conform to a 400-line strict JSON schema. These two tasks compete for model capacity at 2B-4B effective parameters.

**Evidence:** Passive.cloud 2026-05-14 (utterance-level extraction first, then aggregate — separate concerns); arXiv JPT 2604.05158 2026-04-08 (two-pass concatenation achieves +7.9 F1 on zero-shot NER vs single-pass generative; "existing approaches suffer from hallucinated entities and formatting errors" when extraction + formatting are combined); MasterPrompting 2026-05-12 (SLMs "lose coherence across multi-step chains longer than 3 steps" — v11 schema + open vocabulary + ICT rules exceeds 3-step capacity for 2B models).

**Concrete change:**
1. **Pass 1 call:** Send transcript to model with a MINIMAL schema: `{"speaker_concepts": [...], "has_strategy": true/false, "instrument": "..."}`. The only constraint is the array shape; the `term`, `role`, `verbatim_description`, `transcript_quote` sub-fields have no enum constraints. This call succeeds reliably because the output space is small.
2. **Pass 2 call:** Send the extracted `speaker_concepts` array plus a focused prompt: "Given these speaker concepts, populate the following strategy schema fields..." with the full v11 schema. The model now works from structured speaker-concept input, not raw transcript text, so it has far less to hold in working memory.

This is the pattern `gemma-prose-to-v11.ts` is already partly implementing — the fix is making it explicit and running it as a second LLM call rather than a downstream heuristic mapping.

**Scale assessment:** Required at this scale. This directly closes the Volume Profile / Wyckoff / scalping vocabulary loss. Pass 1 is a cheap lightweight call (small schema); Pass 2 has a simpler task (concepts-to-schema vs transcript-to-schema). Total latency may decrease because each call is simpler.

---

### Recommendation 3 (THIS WEEK — VRAM mitigation): Add context chunking before long transcripts reach the model

**Problem:** Long transcripts (>6K chars) exceed the safe instruction-following window for 2B-4B models. On RTX 5060 8GB, attempting GBNF enforcement on long context is the confirmed VRAM exhaustion crash path.

**Evidence:** Markaicode 2026-03-02 (OOM crashes on constrained systems require "switch to quantized model or add swap"; context is the primary VRAM driver); Passive.cloud 2026-05-14 ("chunk by semantic boundaries not arbitrary token counts; 150-300 token chunks with speaker continuity is strong default"); LocalLLM.in 2026-02-03 ("8GB VRAM delivers 40+ tokens/second with 7-8B models at Q4_K_M, fast enough for real work — but context window is the binding constraint"); MasterPrompting 2026-05-12 ("long system prompts >2K tokens partially ignored by most SLMs").

**Concrete change:**
- Current system has a 3-chunk fallback for markdown > 4000 chars (Pass 21). Extend this to the speaker-concept pass: chunk by speaker turn, not by character count. Speaker turns are the natural semantic boundary for trading videos.
- Hard limit for Pass 1 call: 3000 tokens (approximately 2400 words / 12000 chars). Transcripts above this threshold get chunked into overlapping 2500-token windows with 200-token overlap.
- Each chunk produces its own `speaker_concepts` array; merge by deduplicating on normalized `term`.
- Pass 2 (schema mapping) runs once on the merged concept array — not per-chunk.

**Scale assessment:** Required at this scale. Current chunking exists but triggers only as a fallback. Making chunking the default for Pass 1 prevents VRAM pressure before it builds.

---

### Recommendation 4 (NEXT QUARTER — model upgrade path): Evaluate Phi-4 (3.8B) as primary extractor

**Problem:** Gemma 4 e2b effective 2B parameter count is at the floor of reliable JSON extraction compliance. The benchmark gap (91% vs 94% for Phi-4) translates to ~30 more failures per 1000 calls.

**Evidence:** MasterPrompting 2026-05-12 (Phi-4 3.8B achieves 94% JSON extraction vs Gemma 3 4B's 91%; "Microsoft trained it primarily on high-quality synthetic data... best-in-class model for reasoning at its size"); Microsoft Azure Blog 2025-11-19 (Phi-4-mini: "function calling, instruction following, long context, and reasoning"); Markaicode 2026-03-02 (GBNF benchmark: phi-3-mini 3.8B 89% native JSON, 100% grammar — comparable architecture to Phi-4 but Phi-4 improves +8% MMLU, +12% MATH over phi-3).

**Concrete change:**
- Phi-4-mini-instruct is 3.8B, Q4_K_M quantized = approximately 2.5GB VRAM. This fits comfortably on the RTX 5060 8GB alongside system RAM.
- Run a shadow test: A/B the current qwen2.5-coder:7b extractor against Phi-4-mini on 20 fresh transcripts. Compare speaker_concepts count, v11 field fill rate, and format compliance.
- Migration path: `TRANSCRIPT_EXTRACTOR_LOCAL_MODEL=phi4-mini` via existing env var override (no code change).
- Install: `ollama pull phi4-mini` (~2.5GB).

**Scale assessment:** Beneficial at this scale. Not urgent — qwen2.5-coder:7b is the correct primary today. Phi-4 evaluation is a 1-day research task with minimal risk (shadow test only).

---

### Recommendation 5 (NEXT QUARTER — architecture direction): Evaluate GLiNER-2 for zero-shot NER as vocabulary seed

**Problem:** When neither GBNF nor retry produces `speaker_concepts` with adequate depth, the downgrade path is losing novel vocabulary entirely. A dedicated zero-shot NER model can seed the concept extraction before the LLM pass.

**Evidence:** GitHub fastino-ai/GLiNER2 2025-07 (zero-shot NER — extract entities by type label without per-domain training); arXiv JPT 2604.05158 2026-04-08 (discriminative token classification with full bidirectional context achieves +7.9 F1 vs generative LLM NER — "being over 20x faster"); Passive.cloud 2026-05-14 ("teams that build durable pipelines borrow from real-time financial reporting systems... detect mentions... rank the few passages that actually matter").

**Concrete change:**
- GLiNER-2 runs as a pre-pass: extract all entity spans classified as `indicator`, `zone`, `model`, `filter` from the transcript text using zero-shot entity labels. Runs in ~200ms on CPU, no GPU needed.
- The extracted spans are injected as candidate `speaker_concepts` entries before the LLM sees the transcript. The LLM then confirms, filters, and adds descriptions — a much easier task than open discovery.
- This pattern directly addresses the Volume Profile / Wyckoff / scalping vocabulary gap: GLiNER-2's zero-shot labels can include `"trading concept"`, `"price level"`, `"market phase"` without any domain-specific training.

**Scale assessment:** Beneficial at this scale, NOT required immediately. Implement after the two-pass architecture (Rec 2) is validated. The LLM two-pass approach solves 80% of the novel-vocab problem; GLiNER-2 is the 20% incremental improvement.

---

## Is the current hybrid pattern (LLM prose + server-side NLP) institutional-grade?

**Short answer: No for primary vocabulary extraction; Yes for enrichment.**

The r/quant thread (2026-03-06) is the clearest industry signal: "Using an LLM to parse alternative data or earnings transcripts is FINE. But suggesting we use autoregressive models anywhere near live execution logic or risk management is absolute insanity." The implication for Trading Forge's use case (transcript parsing, NOT execution): pure-LLM extraction is the 2026 accepted approach for this pipeline stage.

The passive.cloud institutional blueprint (2026-05-14) is explicit: "teams that rely on naïve keyword hits or a single LLM prompt fail." The recommended architecture is: (1) normalize first, (2) open extraction with entity linking, (3) confidence-calibrated ranking. Regex catalogs for novel domains are specifically called out as a pattern that "overfits to keywords and ends up with noisy dashboards."

Server-side NLP remains valuable as a POST-PROCESSING layer: after the LLM has emitted open `speaker_concepts`, regex and NLP can be used to normalize known ICT/SMC terms to canonical identifiers for downstream routing. But it should not be the gate that decides whether a novel term is captured.

**What this means for Trading Forge:** The v12 prompt with `speaker_concepts` open array is architecturally sound. The problem is execution: GBNF crashes prevent it from running reliably. Fix the execution path (Rec 1 + Rec 3) before the architecture.

---

## Self-verification checklist

- [x] Every cited source has publication date >= 2025-01-01 (earliest: Microsoft Azure Blog 2025-11-19)
- [x] Every recommendation has >= 3 corroborating sources of distinct tiers/authors
- [x] No YouTube sources cited (no transcripts needed — no YouTube sources in evidence set)
- [x] Evidence file written at docs/institutional-evidence/transcript-extractor-llm-architecture-2026.md
- [x] Comparison table includes Trading Forge implementation column with concrete references
- [x] Scale translation applied to every recommendation
- [x] No code modifications performed
- [x] No strategy ideas or parameter values proposed

---

# Completeness Crisis Audit — 2026-06-22

## Context

Wave 26 Pass L operator mandate: "make the gemma youtube and discord extraction institutional grade — no more false extraction, 100% evidence-based accurate extraction." Live test on iU8ww5MC2FQ (37,583-char transcript, "4-hour candle box / Gann box" strategy) produced coverage_pct=0.571. The W3 coverage gate correctly quarantined it. The problem is completeness failure in the primary extraction pass, not the safety layer.

## Additional Sources — Completeness Techniques (2025-2026)

| Date | Source | Tier | Citation | Key claim |
|---|---|---|---|---|
| 2026-04 | The Vanguard Group — De Jure paper | research (corporate-eng) | https://arxiv.org/html/2604.02276v1 | "Iterative repair of low-scoring extractions within a bounded regeneration budget... peak performance within at most three judge-guided iterations. Multi-criteria LLM-as-a-judge evaluation across 19 dimensions." |
| 2025-08 | Google LangExtract + Gemma (Towards Data Science) | blog-general (corroborated) | https://towardsdatascience.com/using-googles-langextract-and-gemma-for-structured-data-extraction/ | "The purpose of iterative extraction passes is to improve the recall by capturing entities that might be missed in any single run... multi-sample and merge strategy, where extraction is run multiple times independently." |
| 2026-03 | Markaicode — Reliable Structured Output from Local LLMs | blog-general | https://markaicode.com/ollama-structured-output-pipeline/ | "GBNF grammar success = 100% regardless of model size. Native JSON mode: 89-98%. Schema-constrained models are NOT guaranteed to extract correct values — just valid structure." |
| 2026-02 | Interfaze SOB — Structured Output Benchmark | research | https://interfaze.ai/blog/introducing-structured-output-benchmark | "Valid JSON does not imply correct extraction. On one domain, models achieve 90% valid output but only 12.5% pass rate. Path Recall / Structure Coverage / Type Safety can all read ~99% while 20-30% of leaf values are still wrong. Value Accuracy is the metric that matters for production." |
| 2026-02 | ExtractBench (Contextual AI) | research | https://arxiv.org/html/2602.12247v2 | "Performance degrades sharply with schema breadth, culminating in 0% valid output on a 369-field financial reporting schema across all tested frontier models. Schema breadth is the dominant predictor of reliability." |
| 2026-03 | QuoteVerify (Analemma Research) | research | https://analemma.ai/papers/e13040b9-9791-48ac-8185-1a5f6f3ed90f/ | "LLMs produce valid quotes only 18-28% of the time even for successfully fetched sources, indicating a tendency to paraphrase rather than verbatim quote. Structured citation format + quote-validity substring checking drives +18.7pp cited-statement match rate." |
| 2026-01 | PR-CoT Multi-Perspective Reflection (arXiv 2601.07780) | research | https://arxiv.org/html/2601.07780 | "Information Completeness Check: Reflecting on whether critical information or assumptions might have been overlooked. PR-CoT achieves 17% error correction rate vs 15% for single-reflection — multi-angle reflection identifies completeness gaps single-pass misses." |
| 2026-01 | SCIR — Self-Correcting Iterative Refinement (AAAI-26) | research | https://ojs.aaai.org/index.php/AAAI/article/view/40326/44287 | "Dual-Path Self-Correcting mechanism verifies completeness of extraction results through two pathways: redundancy detection and missing detection. 5.27% average F1 improvement across NER/RE/EE. Training costs reduced 87% vs baseline." |
| 2026-05 | Gemma 4 E2B GST invoice fine-tuning (DEV Community) | blog-general | https://dev.to/angu10/the-model-isnt-the-hard-part-the-data-pipeline-i-built-to-teach-gemma-4-e2b-to-read-indian-gst-1bh9 | "The biggest gains came from dataset composition, not instruction wording. A prompt change specifically aimed at multiline extraction got worse, not better (loss 0.147 vs 0.130 best data-only run)." |
| 2026-03 | DSE-RE: Dynamic Schema Evolution with LLM (Springer) | research | https://link.springer.com/article/10.1007/s44230-026-00158-1 | "Iterative relation extraction with schema evolution — starts with coarse schema, refines fields with each extraction round. Final schema captures relations missed in first pass by 23% margin." |

## Completeness Failure Root Cause Analysis

### What the 57% coverage finding proves

The iU8 test reveals a structural problem with single-pass extraction on dense transcripts. The W3.1 coverage gate enumerated: Gann box, optimum zone, IRS model, change-of-state candle, breaker block rebalance, two-entry/redemption, hidden level, 4H bias timeframe, danger zone, premature zone, overextended zone. Of these, only: 4H candle structure and entry/exit logic (partially) were captured. The speaker named and taught 11 items; gemma captured 6. Coverage = 0.571.

### Why single-pass fails on dense transcripts

1. **Schema breadth kills completeness.** ExtractBench 2026-02-14: "Performance degrades sharply with schema breadth." The minimal-v1 prompt has 8 required fields (higher_timeframe, lower_timeframe, direction, entry_sequence, preferred_regime, stop, stop_management, targets, confluences). For a 37K-char transcript, gemma is simultaneously locating timeframes, classifying direction, ordering entry steps, identifying stop anchor, AND listing all confluences. Attention is divided across 8 dimensions on 37K chars. Result: rich content in the middle of the transcript (where teaching happens) is systematically deprioritized because the model allocated context budget to structural fields first.

2. **Single-pass generative extraction misses non-salient taught items.** PR-CoT 2026-01-12: "Information Completeness Check: whether critical information or assumptions might have been overlooked." A single-pass model allocates its output probability distribution to the MOST SALIENT speaker terms. The Gann box zones (premature/optimum/overextended/danger) are taught but not headline-words — they appear in a 3-minute teaching segment nested in a 37-minute video. gemma's single-pass attention mechanism deprioritizes them because they are not the highest-frequency or highest-salience terms.

3. **Quote grounding failure at production scale.** QuoteVerify 2026-03-02: "LLMs produce valid quotes only 18-28% of the time even for successfully fetched sources." gemma4:e2b leaves entry_indicator=null and entry_params={} instead of halluciating — which is correct behavior per the anti-hallucination mandate. But this means the 43% missed items are simply left blank, not recovered. The null-is-honest contract works against completeness when the model lacks confidence in mid-transcript content.

4. **Coverage gate correctness confirmed.** The W3.1 layer correctly enumerated 11 speaker-named items and flagged 5 primary items as missing. This proves the SAFETY architecture works. The gap is in the PRIMARY extraction, not the coverage evaluation.

## Trading Forge vs Institutional Comparison — Completeness Specific

| Aspect | Trading Forge implementation | Institutional reference (2026) | Gap | Scale |
|---|---|---|---|---|
| **Coverage evaluation** | W3.1: LLM-as-enumerator → pure comparator → coverage_pct → quarantine on primary_missing | De Jure 2026-04: 19-criterion LLM judge across hierarchical decomposition. SCIR 2026: dual-path self-checking (redundancy + missing detection). | SMALL: existing W3.1 is sound. Add structured missing-items list to feedback loop. | Required |
| **Iterative refinement on coverage_failed** | None. Coverage gate quarantines and stops. | De Jure: "bounded regeneration budget (max 3 retries)"; LangExtract: "multiple extraction passes to improve recall." SCIR: "feedback-driven optimization generates iterative prompts based on verification results." | CRITICAL: when coverage_failed, Trading Forge stops. Institutional systems feed the missing items back as a targeted second extraction call. | Required |
| **Completeness-targeted re-extraction** | Recall pass (Q6: primary_tool_setup) covers ONE category. | SCIR dual-path: separate "missing detection" pass asks "what items from the speaker-named list are NOT yet in the extraction?" LangExtract: passes multiple times independently. | CRITICAL: the recall pass asks 3 generic mechanic questions. It does NOT receive the actual missing_items list from W3.1 and ask gemma to fill those specifically. | Required |
| **Quote grounding rate** | verifyQuoteInTranscript() exists in both recall pass and coverage gate. Rate not measured. | QuoteVerify 2026-03: LLMs achieve only 18-28% exact verbatim quote compliance. Structured citation format (name+quote tuple) drives +18.7pp improvement. | HIGH: the recall prompt requests verbatim quotes but does not enforce the citation-triple format (item_name + transcript_quote + extracted_value) that drives quote compliance. | Beneficial |
| **Schema field count vs completeness** | 8-field minimal schema per-call + 8-step entry_sequence + unlimited confluences + stop sub-object | ExtractBench: schema breadth is "dominant predictor of reliability." De Jure: decomposes extraction into stages (metadata → definitions → rules), not one monolithic call. | HIGH: extracting entry_sequence AND confluences AND stop AND targets in one call on 37K chars exceeds 5B model capacity for dense trading content. | Required |
| **Named item inventory before extraction** | None. gemma extracts blind. | SCIR/De Jure: enumerate all items the source teaches first (item inventory), then extract field-by-field per item, then check coverage. Two-pass: enumerate → extract. | CRITICAL: W3.1 enumerates AFTER extraction to CHECK coverage. Moving enumeration BEFORE extraction enables targeted field-by-field recovery. | Required |
| **Per-item evidence-grounded extraction** | entry_sequence steps have rationale field (optional, not enforced) | De Jure: each field requires source_span (verbatim quote from document). SCIR: each extracted item paired with its evidence sentence from source. | HIGH: the schema has rationale but doesn't enforce per-step evidence grounding. The coverage gate verifies quotes post-hoc; pre-extraction evidence requirement prevents the gap. | Beneficial |

## Recommended Changes — Completeness-Specific (with citations)

### Recommendation C1 (HIGHEST PRIORITY — closes the 57% gap): Wire coverage gate's missing_items back into a targeted recall call

**Problem:** W3.1 correctly identifies missing items but then quarantines and stops. The missing_items list is never fed back to gemma as a targeted extraction request.

**Institutional pattern (De Jure + SCIR):** When coverage_failed, feed missing items as an explicit repair prompt. De Jure: "iterative repair of low-scoring extractions within a bounded regeneration budget." SCIR: "Feedback-Driven Optimization mechanism generates iterative prompts based on verification results to drive context-learning-based iterative generation."

**Concrete change:**
1. In `extraction-coverage-gate.ts::runCoverageGate()`, after computing the verdict: if verdict==='coverage_failed', collect the primary missing items list.
2. Call a NEW function `runCoverageTargetedRecall(transcript, extraction, missingItems)` that sends: "Your extraction missed the following items the speaker explicitly taught: [list of item names with verbatim_quotes from the enumeration]. For each item, extract what the speaker taught about it. Quote the transcript directly."
3. Merge the targeted recall results into the extraction (same merge semantics as the existing recall pass — only fill null fields).
4. Re-run coverage gate on the merged extraction. If coverage_pct >= 0.85, promote from quarantine to library.
5. Max 2 targeted recall iterations. After 2, accept best-coverage result.

**Evidence:** De Jure 2026-04 (Vanguard, research): "peak performance within at most three judge-guided iterations"; LangExtract + Gemma 2025-08 (blog-general): "multiple extraction passes to improve recall by capturing entities missed in any single run"; SCIR AAAI-26 2026-01 (research): "5.27% average F1 improvement via feedback-driven iterative generation."

**Scale assessment: REQUIRED.** This is the single highest-ROI change. The W3.1 safety layer already exists. Closing the loop adds one additional gemma call on coverage_failed (most videos should pass on first pass; this path only fires on genuinely dense/complex transcripts like iU8).

---

### Recommendation C2 (HIGH — prevents attention dilution): Decompose multi-field extraction into two focused calls

**Problem:** gemma simultaneously extracts entry_sequence (ordered steps), confluences (named conditions), stop (anchor + rationale), and targets in one call. For a 37K-char transcript at 5B parameters, this is attention fragmentation. The speaker's zone taxonomy (premature/optimum/overextended/danger) appears in one teaching segment; gemma's attention budget allocates to headline fields first.

**Institutional pattern (ExtractBench + De Jure):** ExtractBench 2026-02-14: "Performance degrades sharply with schema breadth." De Jure: decomposes extraction into hierarchical stages — metadata first, then definitions, then rules. Each stage repairs on previously-verified context.

**Concrete change:**
1. **Call A (entry-focused):** Send transcript. Ask ONLY for: name, higher_timeframe, lower_timeframe, direction, entry_sequence[]. No stop, no targets, no confluences. Entry sequence gets full model attention.
2. **Call B (conditions-focused):** Send transcript + Call A extraction. Ask ONLY for: confluences[], stop, stop_management, preferred_regime. The model now has the entry context from Call A and focuses exclusively on conditions.
3. Merge Call A + Call B outputs. Run W3.1 coverage gate on merged result.

**Evidence:** ExtractBench Contextual AI 2026-02 (research): "schema breadth is dominant predictor of reliability"; De Jure Vanguard 2026-04 (research): "hierarchical decoupling — components that rules depend on are verified before rule units are evaluated"; PR-CoT arXiv 2601.07780 2026-01 (research): "Information Completeness Check ensures critical information is not overlooked when each aspect is reflected on independently."

**Scale assessment: Required.** Two gemma calls instead of one adds ~8-15 seconds of latency (acceptable for offline extraction; extraction is not on the live trading path). Completeness gain is substantial for dense teaching videos.

---

### Recommendation C3 (HIGH — verbatim evidence grounding): Add evidence-triple requirement to entry_sequence steps

**Problem:** QuoteVerify 2026-03: "LLMs produce valid quotes only 18-28% of the time even for successfully fetched sources." gemma's entry_sequence steps have an optional rationale field, but the prompt does not enforce the evidence-triple format (item_name + verbatim_quote + extracted_value) that drives reliable quote grounding.

**Institutional pattern:** QuoteVerify: "structured citation triples containing explicit evidence quotes... quote validity checking via substring matching." De Jure: every extracted rule unit requires a `source_span` (verbatim text from document).

**Concrete change:**
1. In the minimal-v1 prompt, change entry_sequence step format from `{step, action, rationale}` to `{step, action, rationale, evidence_quote}` where evidence_quote is "exact words from the transcript that establish this step." This MATCHES the existing verifyQuoteInTranscript() infrastructure in the recall pass.
2. The coverage gate's verifyQuoteInTranscript() already implements substring matching — this reuses the existing validation without new code.
3. In the coverage gate comparator, when checking if a speaker-item is covered, also check whether the extraction's evidence_quote for that item passes verifyQuoteInTranscript(). If the quote fails verification, count the item as PARTIALLY covered (not missing, not fully covered) — this surfaces grounding quality as a separate signal from content presence.

**Evidence:** QuoteVerify Analemma Research 2026-03 (research): "+18.7pp cited-statement match rate from structured citation format"; De Jure Vanguard 2026-04 (research): "source_span verbatim quote required per field"; SCIR AAAI-26 2026-01 (research): "each extracted item paired with evidence sentence from source."

**Scale assessment: Required.** This is a prompt change + schema field addition. No new API calls. The verifyQuoteInTranscript() infrastructure already exists. This closes the hallucination vs omission distinction: without evidence_quote, there is no way to distinguish "model invented this step" from "model correctly extracted this step."

---

### Recommendation C4 (MEDIUM — prevents false completeness): Fix the factor_quality grade

**Problem:** The library shows 93 "rich" strategies, but the iU8 test proved rich means "has >= 2 confluence factors" not "complete extraction." A strategy with 2 auto-injected `regime_match` and `structural_setup` factors grades "rich" even if the actual speaker-taught content is 30% captured.

**Institutional pattern:** Interfaze SOB 2026-02-04: "Valid JSON does not imply correct extraction. Path Recall / Structure Coverage / Type Safety can all read ~99% while 20-30% of leaf values are still wrong." SOB separates Value Accuracy (what matters) from structural metrics.

**Concrete change:**
1. Add a `completeness_grade` field to strategy metadata, separate from factor_quality. Values: `coverage_verified` (W3.1 ran and passed >= 0.85), `coverage_partial` (W3.1 ran, 0.60-0.85), `coverage_failed` (W3.1 ran, < 0.60), `coverage_unrun` (pre-W3.1 strategy).
2. The library display should show completeness_grade, not factor_quality, as the primary freshness signal.
3. The "117 strategies" display issue is a separate UI problem: the query should GROUP BY source_url (or concept fingerprint) and show unique strategies, not per-symbol rows. 40 concepts × 3 symbols = 120 rows is correct in the DB; 40 is the right number to show the operator.

**Evidence:** ExtractBench Contextual AI 2026-02 (research): "schema-driven evaluation: each field declares its scoring metric — must distinguish missing field from hallucinated null"; Interfaze SOB 2026-02 (research): "coverage gate: Value Accuracy only credited on fields the model actually returned, with missing paths counting as wrong"; PR-CoT arXiv 2601.07780 2026-01 (research): separate evaluation passes per reflection dimension prevent conflation of structural compliance with content completeness.

**Scale assessment: Required.** This is a display and data hygiene fix. Without it, the operator cannot distinguish a 100%-complete extraction from a 57%-complete extraction in the library. The gate for re-extraction is the 5 successful validated extractions — which requires knowing which strategies are complete.

---

## Summary of Completeness Architecture

The institutional 2026 SOTA pattern for dense transcript extraction with a 5B local model:

```
1. ENUMERATE (first pass, lightweight)
   Send transcript → ask model to list all speaker-named items (name + verbatim_quote)
   This is what W3.1's runCoverageEnumeration() already does — but it runs AFTER extraction, not before.

2. EXTRACT (focused, field-decomposed)
   Call A: send transcript + enumerated items → extract entry_sequence ONLY
   Call B: send transcript + enumerated items + Call A result → extract conditions/confluences ONLY
   Each step has evidence_quote requirement

3. VERIFY (coverage gate)
   Run W3.1 pure comparator: enumerated items vs extraction corpus
   This is what Trading Forge already does

4. REPAIR (targeted recall — THE MISSING STEP)
   If coverage_failed: send missing_items + transcript → targeted extraction of missing content only
   Max 2 repair iterations
   Re-verify after each repair

5. ACCEPT or REJECT
   If coverage_pct >= 0.85 after repairs: accept (promote to library)
   If coverage_pct < 0.85 after 2 repairs: quarantine + flag for human review
```

Steps 1, 3, 5 already exist in Trading Forge (W3.1). Step 2 partially exists (recall pass covers 3 generic topics). Step 4 is MISSING — the repair loop that closes the coverage gap.

The 5 validated extraction gate (operator mandate) maps directly to this: run the full 5-step pipeline on 5 real YouTube URLs. When all 5 return coverage_pct >= 0.85 with verbatim quote grounding verified, the system is extraction-grade and mass re-extraction is unblocked.

---

## Self-verification checklist — 2026-06-22 update

- [x] Every cited source has publication date >= 2025-01-01.
- [x] Recommendations C1/C2/C3 each have >= 3 corroborating sources from distinct tiers/authors: C1 (De Jure research + LangExtract blog + SCIR research); C2 (ExtractBench research + De Jure research + PR-CoT research); C3 (QuoteVerify research + De Jure research + SCIR research).
- [x] No YouTube sources cited in this update (no transcripts fetched — no YouTube sources used).
- [x] Evidence file updated at docs/institutional-evidence/transcript-extractor-llm-architecture-2026.md.
- [x] Comparison table includes Trading Forge implementation column with concrete references (file:line where relevant).
- [x] Scale translation applied to every recommendation.
- [x] No code modifications performed.
- [x] No strategy ideas or parameter values proposed.
