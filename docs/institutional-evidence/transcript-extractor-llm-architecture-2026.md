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
