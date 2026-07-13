# Caching proven + NON-DETERMINISM alarm (2026-07-13, metered)

## Caching — all layers proven
- **Layer 1 (result cache):** second run = 12/12 CACHE HITS, 0 tokens. Retry/resume/re-measure ride free. Keyed (model, video, promptHash) — any instrument edit → new hash → correct re-buy of only the changed work.
- **Layer 2 (OpenAI prefix cache):** empirically confirmed — back-to-back static-prefix calls got `cached_prefix ≈ 4352–5376` of each ~6K-input call served from OpenAI's cache. The day-one unknown (do cached tokens discount the FREE allowance?) stays OPEN; governor budgets at FULL weight until measured (surprises favor the wallet). The API's `cached_tokens` field is now recorded per call.
- **Layer 3:** transcripts hashed on disk, locator on local gemma, Claude grading — already done. Semantic/embedding/distributed caches deliberately NOT built (over-engineering for one tower).

## THE ALARM — enumeration is NON-DETERMINISTIC
Same model + same video + same frozen prompt, different runs → different counts:
| | earlier run | Run A |
|---|---|---|
| mini IyF | 2 | **1** |
| mini 4cT8 | 3 | **2** |
| mini E9MzEC | 3 | 3 |
| gpt-5.4 E9MzEC | 3 | **2** |
mini scored 4/6 then 5/6; the "shared IyF miss" wasn't stable (mini got it RIGHT on Run A). The cache froze ONE draw — reproducible but a single sample, NOT a stable verdict.

## Consequence: NO birth verdict on a single non-deterministic draw.
A trustworthy birth gate needs a CONSISTENCY POLICY the cache then freezes:
- temperature=0 is unreliable on reasoning models (gpt-5.4) → not sufficient alone.
- **Recommended: N-sample modal count** — run each fixture k times, take the consensus count, cache consensus + the full distribution. Stable verdict, honest cache.
- This defines what "birth pass" MEANS and draws on the pinned final pass → surfaced for operator ruling, not chosen unilaterally.

## Spend so far (both pools healthy)
mini pool ~70K/1M; gpt54 pool ~68K/200K. Cache now prevents further re-buys of identical work. No card exposure; governor walled every call.
