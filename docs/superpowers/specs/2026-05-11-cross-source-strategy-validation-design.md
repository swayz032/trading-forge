# Cross-Source Strategy Validation — Design Spec

**Date:** 2026-05-11
**Author:** Claude (Pass 18 design)
**Status:** Approved — moving to implementation plan
**Supersedes:** None
**Builds on:** Pass 16 (scout-extract endpoint), Pass 17 (Tavily body-fetch + Ollama fallback)

---

## Why this exists

Today's pipeline accepts a strategy candidate when a *single* source extracts a complete entry/exit/risk-rules markdown. That's how Pass 16 produced the 3 working MES strategies and how Pass 17 wired body fetching. The gap exposed by operator on 2026-05-11: **a strategy seen on one YouTube channel or one Reddit thread is not strong enough evidence to enter the lifecycle.** Real strategies are corroborated — multiple independent sources discuss the same setup with the same instrument, indicators, and regime.

This spec adds a **cross-source validation layer**: every scout extraction lands in a "pending bucket" keyed by setup fingerprint; the cross-validator actively searches other sources for the same setup; a candidate graduates to the real `/scout-ideas/strict` path only when **three or more independent sources** have confirmed it.

Operator's words: *"if more sources are saying the same thing about this one strategy then it should be valid... doesn't matter where it came from."*

---

## Operator-locked design decisions

The brainstorm on 2026-05-11 locked these decisions. They are NOT up for debate during implementation — every detail below flows from them.

1. **Threshold:** ≥3 distinct sources required for graduation.
2. **Source weighting:** **Equal weight.** No tiers. Reddit counts the same as Edgeful. Consensus across heterogeneous sources is the quality bar — diversity matters more than provenance.
3. **Matching mechanism:** **Hybrid hash + LLM tie-break.** Coarse fingerprint groups candidates into buckets; GPT-5-mini judges whether near-matches within a bucket are the same idea.
4. **Persistence:** **Pending bucket pattern.** Every extraction is persisted with its fingerprint; bucket accumulates evidence over time; auto-graduates when count ≥ 3. 90-day freshness window — mentions older than that are evicted by a daily sweep.
5. **Validation timing:** **Active.** When a scout posts a new extraction, the cross-validator immediately fires searches against the other sources to look for confirmation. Operator quote: *"find an idea then pull multiple searches from different data sources to validate the idea."*
6. **Pipeline coupling:** **Hybrid push-pull (decoupled async).** Scouts post fast to the pending bucket and return; an n8n webhook fires the cross-validator workflow asynchronously. Scouts and validator have separate failure modes.

---

## Architecture

```
                    ┌─────────────────────────────────────────────────────────┐
                    │ SCOUT FLEET (parallel, each independent, all equal)    │
                    │                                                         │
                    │  5L  Tavily quant blogs       daily 2 AM ET             │
                    │  5M  Brave News + Tavily      daily 6 AM ET             │
                    │  5J  TF unified search        hourly                    │
                    │  5N→5O Brave Video + Supadata daily 8 AM ET             │
                    │  5P  ScrapingBee YouTube      daily 9 AM ET   NEW       │
                    │  5Q  Apify Reddit             every 4 hr      NEW       │
                    └────────────────────┬────────────────────────────────────┘
                                         │ POST /api/agent/scout-ideas/pending
                                         │   (NEW endpoint; replaces direct
                                         │    POST to /scout-ideas/strict
                                         │    for ALL scouts)
                                         ▼
                    ┌────────────────────────────────────────────────────────┐
                    │ PENDING BUCKET (new DB)                                │
                    │                                                        │
                    │   strategy_pending_buckets  one row per fingerprint    │
                    │     fingerprint_hash, market, entry_archetype,         │
                    │     exit_type, source_count, status, first_seen,       │
                    │     last_seen                                          │
                    │                                                        │
                    │   strategy_pending_mentions  one row per extraction    │
                    │     bucket_id, source_provider, source_url,            │
                    │     extracted_idea (jsonb), created_at                 │
                    └────────────────────┬───────────────────────────────────┘
                                         │ INSERT triggers webhook
                                         ▼
                    ┌────────────────────────────────────────────────────────┐
                    │ CV1 cross-validator workflow (NEW, n8n)                │
                    │                                                        │
                    │  1. Read new mention from webhook payload              │
                    │  2. Fire 3 active searches in parallel:                │
                    │     - Tavily /search for the setup terms               │
                    │     - Apify Reddit search                              │
                    │     - ScrapingBee YouTube search                       │
                    │  3. Each result → scout-extract for normalization      │
                    │  4. Call cross_source_validator (new GPT-5-mini role): │
                    │     "Do these N results describe the same setup as    │
                    │      the seed? Return per-result yes/no + confidence." │
                    │  5. Each confirmed match → POST a NEW mention to       │
                    │     /scout-ideas/pending (same bucket, different       │
                    │     source_provider)                                   │
                    └────────────────────┬───────────────────────────────────┘
                                         │ inserts more mentions
                                         ▼
                    ┌────────────────────────────────────────────────────────┐
                    │ GRADUATION (DB trigger or pending-poll cron)           │
                    │                                                        │
                    │  When bucket.source_count ≥ 3 AND distinct_providers   │
                    │  ≥ 3 AND bucket.status = 'pending':                    │
                    │   - status → 'graduating'                              │
                    │   - Pick best consensus extraction (highest confidence)│
                    │   - POST to /api/agent/scout-ideas/strict (existing!)  │
                    │   - status → 'graduated'                               │
                    │   - audit_log: lifecycle.cross_validated               │
                    └────────────────────┬───────────────────────────────────┘
                                         │
                                         ▼
                          [EXISTING PIPELINE: system_journal → 8A → strategies]
```

The existing `/scout-ideas/strict` endpoint, the 8A synthesizer, the compiler, the `strategies` table, and the frontend remain UNCHANGED. The new layer is upstream of them. From the existing pipeline's perspective, `/scout-ideas/strict` now only receives **pre-validated, cross-confirmed** strategies.

---

## Component-by-component

### 1. New backend endpoint: `POST /api/agent/scout-ideas/pending`

Replaces direct scout calls to `/scout-ideas/strict`. Accepts the same strict scout shape (thesis, market, timeframe, entry_rules, exit_rules, risk_rules, source_url, regime, concept_name, source_provider, confidence_score) plus an `is_cross_validation_result` boolean (false from scouts, true from CV1 self-loops).

Behavior:
1. Validate strict scout shape (same zod schema as `/scout-ideas/strict`).
2. Compute fingerprint: `sha256(market + "|" + entry_archetype + "|" + exit_type).hex()[:32]`. `entry_archetype` is normalized from entry_rules via a small Code-node helper (regex extraction of breakout/mean_reversion/trend_follow/etc).
3. Upsert into `strategy_pending_buckets` (insert if new fingerprint; bump `last_seen` if existing).
4. Insert into `strategy_pending_mentions`.
5. If `is_cross_validation_result === false`, fire-and-forget POST to CV1 webhook with the bucket_id (active validation).
6. After every insert, run graduation check: if bucket has ≥3 distinct `source_provider` values AND status='pending', kick off graduation transaction (see §4 below).
7. Return `{accepted: true, bucket_id, source_count, distinct_providers, status}`.

Idempotency: `(bucket_id, source_url)` uniqueness — same URL cannot count twice for the same bucket.

### 2. New DB tables (migration 0103)

```sql
CREATE TABLE strategy_pending_buckets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint_hash TEXT NOT NULL UNIQUE,
  market TEXT NOT NULL,                  -- MES | MNQ | MCL
  entry_archetype TEXT NOT NULL,         -- breakout | mean_reversion | trend_follow | ...
  exit_type TEXT NOT NULL,               -- atr_multiple | trailing_stop | fixed_target | ...
  source_count INT NOT NULL DEFAULT 0,
  distinct_providers INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | graduating | graduated | expired | killed
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  graduated_at TIMESTAMPTZ,
  graduated_strategy_id UUID REFERENCES strategies(id),
  CHECK (market IN ('MES','MNQ','MCL')),
  CHECK (source_count >= 0),
  CHECK (distinct_providers >= 0)
);

CREATE INDEX idx_buckets_status_lastseen ON strategy_pending_buckets(status, last_seen_at DESC);

CREATE TABLE strategy_pending_mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id UUID NOT NULL REFERENCES strategy_pending_buckets(id) ON DELETE CASCADE,
  source_provider TEXT NOT NULL,         -- youtube | reddit | tavily | brave | parallel | scrapingbee | apify | tf_search
  source_url TEXT NOT NULL,
  extracted_idea JSONB NOT NULL,         -- the strict scout shape
  is_cross_validation_result BOOL NOT NULL DEFAULT FALSE,
  cross_validator_confidence NUMERIC(3,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (bucket_id, source_url)
);

CREATE INDEX idx_mentions_bucket ON strategy_pending_mentions(bucket_id);
CREATE INDEX idx_mentions_recent ON strategy_pending_mentions(created_at DESC);
```

Forward-only per repo convention. Idempotent (`IF NOT EXISTS` clauses; `CREATE INDEX` skipped if already present).

### 3. Cross-validator: new GPT-5-mini role `cross_source_validator`

Added to `src/server/services/model-router.ts` MODEL_CONFIGS:
- `provider: "openai"`
- `model: "gpt-5-mini"`
- `temperature: 0.2`
- `maxTokens: 1500`
- `systemPromptPath: "src/agents/cross-source-validator.md"`
- `responseFormat: "json"`
- `responsesApiVersion: "v1"`
- `fallback: { provider: "ollama", model: "deepseek-r1:14b" }`
- Daily cap: 20k tokens (10th role in the system)

Input payload (from CV1 workflow):
```json
{
  "seed": { /* strict scout shape */ },
  "candidates": [
    { "source_provider": "youtube", "source_url": "...", "extracted_idea": { /* shape */ } },
    { "source_provider": "reddit",  "source_url": "...", "extracted_idea": { /* shape */ } }
  ]
}
```

Output (strict JSON schema):
```json
{
  "matches": [
    { "index": 0, "is_same_setup": true,  "confidence": 0.89, "divergence_notes": "Identical market+timeframe+entry; minor difference in trail multiplier (2.0 vs 2.5)" },
    { "index": 1, "is_same_setup": false, "confidence": 0.12, "divergence_notes": "Different timeframe and different exit (fixed target vs ATR)" }
  ]
}
```

Prompt (`src/agents/cross-source-validator.md`, 4-block per AGENT-LOGS convention):
- **Personality:** Adversarial similarity judge. Bias toward "different" — false positives hurt more than false negatives. We'd rather miss a real match than fabricate consensus.
- **Pipeline Context:** Trading Forge cross-validation layer. Input is one seed extraction + N candidate extractions from other sources. Output decides whether each candidate confirms the seed.
- **Goal Pathway:** Compare market (must match exactly), entry_archetype (must match), key indicators (must overlap ≥50%), timeframe (must be in the same family — intraday vs daily), regime (must be compatible). Allow minor parameter differences. Reject if any major dimension differs.
- **Guardrails:** Refusal is legal output. JSON only. Confidence ≤ 0.7 means "not certain" — caller may treat as no-match.

### 4. Graduation flow

When `/scout-ideas/pending` insert completes AND bucket meets thresholds, the route runs a transaction:

```sql
BEGIN;
UPDATE strategy_pending_buckets
SET status = 'graduating', graduated_at = NOW()
WHERE id = $bucket_id AND status = 'pending'
  AND distinct_providers >= 3 AND source_count >= 3
RETURNING *;
-- If row returned, proceed; else (race), abort.
COMMIT;
```

After the UPDATE succeeds:
1. Read all mentions in the bucket.
2. Pick the "best consensus" mention: highest `cross_validator_confidence` among non-CV results, or first organic scout if confidences are all null.
3. POST the chosen mention's extracted_idea to the existing `POST /api/agent/scout-ideas/strict` route via internal fetch.
4. On success: UPDATE bucket SET status='graduated', graduated_strategy_id=<returned id>.
5. On failure: UPDATE bucket SET status='pending' (rollback so it can retry on next mention).
6. Write `audit_log` row: `action='strategy.cross_validated'`, `evidence={bucket_id, distinct_providers, source_urls[]}`.

### 5. CV1 cross-validator n8n workflow (NEW)

- **Trigger:** Webhook `POST /webhook/cv1-validate` with payload `{ bucket_id, seed_mention_id }`. Auth via Bearer (same secret as eCr7 — store as `N8N_CV1_BEARER`).
- **Step 1:** Fetch the seed mention from TF backend (`GET /api/agent/pending-mention/:id`).
- **Step 2:** Three parallel branches firing active searches with terms derived from `entry_archetype + market + key indicators`:
  - **Tavily branch:** `POST https://api.tavily.com/search` (futures-targeted query) → SplitInBatches → POST scout-extract per result
  - **Reddit branch:** Apify run on `reddit-scraper` actor with query string → SplitInBatches → POST scout-extract per top comment thread
  - **YouTube branch:** ScrapingBee YouTube search → SplitInBatches → Supadata transcript → POST scout-extract per video
- **Step 3:** Merge all 3 branches into one array of candidate extractions.
- **Step 4:** POST `/api/agent/cross-validate` (NEW thin route) with `{ seed, candidates }`. That route calls `callOpenAIOrFallback("cross_source_validator", ...)`, parses output, returns `{ matches: [{index, is_same_setup, confidence}, ...] }`.
- **Step 5:** For each match with `is_same_setup === true AND confidence >= 0.7`: POST `/api/agent/scout-ideas/pending` with the candidate idea + `is_cross_validation_result: true`. The pending route handles bucket bump and graduation check.
- **Error handling:** Standard — `retryOnFail`, `alwaysOutputData`, `errorWorkflow: BbCvlV1ARyyvY3NI`. If any branch fails, the others still proceed (`continueOnError: true` on parent merge).

Estimated cost per CV1 invocation: 1 cross_source_validator LLM call (~$0.005) + 3 Tavily searches (~$0.005) + 1 Apify reddit query (~$0.001) + 1 ScrapingBee search (~$0.002) ≈ **$0.013 per candidate**. At 50 candidates/day, ~**$0.65/day**.

### 6. Two NEW organic scouts

#### 5P — YouTube channel watcher (ScrapingBee + Supadata)

- **Trigger:** Schedule, daily 9:00 AM ET.
- **Curated channel list** (operator-tunable via env var or a small DB table `scout_curated_channels`):
  - FuturesTrader71, Topstep (TopstepTV), SMB Capital, Trader Dale, ThinkOrSwim Live, Convergent Trading, Day Trading Academy, TradingHub Daily, Apex Trader Funding, E-mini Mike
- **Flow:** Code node holds channel list → SplitInBatches → ScrapingBee fetch of channel's "/videos" page (recent uploads) → parse for new video URLs (filter to ≥10min length AND title contains MES|MNQ|MCL|micro|opening range|breakout|reversion|ICT|ORB|VWAP) → for each URL, hit Supadata transcript-extract → POST `/scout-extract` → IF `extracted && ideas>0` → split → POST `/scout-ideas/pending` (per idea) → Wait 3s → loop.
- Dedupe: track previously-seen video URLs in a `scout_seen_urls` table to skip them on next run.

#### 5Q — Reddit scraper (Apify)

- **Trigger:** Schedule, every 4 hours.
- **Curated subreddits:** r/FuturesTrading, r/Daytrading, r/algotrading, r/Trading, r/quantfinance.
- **Apify actor:** `trudax/reddit-scraper-lite` or equivalent — top posts past 24h matching keywords `MES OR MNQ OR MCL OR "micro futures" OR "opening range" OR "mean reversion"`.
- **Flow:** Apify run trigger → GET dataset items → for each post, concatenate title + body + top 5 comments → POST `/scout-extract` → IF passed → POST `/scout-ideas/pending` → Wait 3s → loop.

### 7. Frontend: Pending Watchlist

New section on `/scout` page (existing) — below the current `Strategy candidates / Market news / All` filter row:

- New filter tab: **"Pending validation"** showing all rows from `strategy_pending_buckets` WHERE `status='pending'` ORDER BY `source_count DESC, last_seen_at DESC`.
- Each row shows: market badge (MES/MNQ/MCL), entry_archetype, exit_type, source_count progress bar (`2/3`, `1/3`), distinct_providers chips (one per source), age (e.g. "first seen 2h ago"), action buttons:
  - **View mentions** (collapsible panel listing source_urls + confidence)
  - **Force graduate** (manual override — operator can promote with 1-2 sources if they trust it)
  - **Kill** (mark bucket as 'killed' so it doesn't pollute future scouts)
- SSE event `pending_bucket.updated` for live counter increments.

### 8. API key handling

Three new env vars, added to `trading-forge/.env`:
- `SCRAPINGBEE_API_KEY` — the operator's ScrapingBee key
- `APIFY_API_KEY` — the operator's Apify API key
- `APIFY_USER_ID` — the operator's Apify user ID

Mirror into Bitwarden vault (`tf/credentials`) per C6 pattern. n8n workflows read from `$env.X`. `.env.example` updated with placeholders. Health endpoint `/api/health` reports presence (boolean only, never the value) so dashboards can flag missing credentials.

---

## Testing

### Unit
- `src/server/__tests__/scout-pending-endpoint.test.ts` — pending insert, bucket upsert, graduation trigger threshold logic, idempotency on duplicate URL. 12+ tests.
- `src/server/__tests__/cross-validator-route.test.ts` — match/no-match cases, fallback to Ollama, empty candidates array. 6+ tests.
- `src/server/__tests__/strategy-fingerprint.test.ts` — hash determinism, archetype extraction regex coverage. 8+ tests.

### Integration
- `src/server/__tests__/cross-validation-flow.integration.test.ts` — end-to-end: 3 scouts post to /pending, validator runs, bucket auto-graduates, strategy row created. Uses in-memory mocked LLM. 2-3 scenarios.

### Existing test suite
- `scout-extract.test.ts` (Pass 16, 9 tests) — must continue passing.
- `scheduler-retry.test.ts`, `system-topology.test.ts` — verify the new graduation cron doesn't break existing scheduler.

### Live verification gate (manual)
- Trigger 5P (ScrapingBee YT scout) on 1 channel, confirm extraction lands in pending bucket.
- Trigger 5Q (Apify Reddit scout) on 1 subreddit, confirm extraction lands in same/different bucket.
- Force-graduate a 2-source bucket via UI to test the override path.
- Verify a real organic 3-source graduation produces a strategy in the DB.

---

## Observability

- **audit_log entries:** `pending_bucket.created`, `pending_bucket.mention_added`, `pending_bucket.graduated`, `pending_bucket.killed`, `pending_bucket.expired`, `cross_validator.invoked`, `cross_validator.match_confirmed`, `cross_validator.match_rejected`.
- **Metrics (Prometheus via `/api/metrics`):** `pending_buckets_total{status}`, `cross_validator_calls_total{outcome}`, `cross_validator_latency_seconds`, `graduation_rate_per_day`.
- **Traces:** Each pending POST gets a correlation_id propagated through scout → pending insert → CV1 webhook → cross_validator LLM call → graduation. Reconstruct any 90-day-old strategy back to its 3 source URLs.
- **SSE event:** `pending_bucket.updated` for live UI.
- **Discord alert:** When a bucket graduates, single message to `#strategy-finds` with name, sources, and links — operator sees the moment a new strategy is born.

---

## Migrations + System Map

- Migration `0103_cross_source_validation.sql` — the two new tables.
- `system-map:sync` after every workflow add and every backend route add — three sync points: after backend endpoints, after workflows, after frontend changes.
- `system-map:check` must exit 0 before any commit.

---

## AGENT-LOGS

Append session log entry as **Pass 18** with the entry IDs of the first graduated strategy as proof of end-to-end functionality.

---

## What this does NOT change

- `/scout-ideas/strict` — unchanged. It's the downstream gate that only receives cross-validated graduates now.
- `8A-idea-to-strategy` synthesizer — unchanged.
- Compiler — unchanged.
- `strategies` table schema — unchanged.
- `/strategies` frontend page — unchanged (still renders what 8A produces).
- Z4Nc Nightly Research, eCr7 Strategy Generation Loop, hPXh Strategy Tournament — unchanged.

The change is purely additive upstream.

---

## Out of scope (deferred to later passes)

- Multi-firm strategy assignment (Track 6+ already handled this for the deployed-strategy side).
- Per-source trust scoring beyond "is this source's content extractable" (operator explicitly rejected tier weighting in this design).
- Auto-killing of stale buckets older than 90 days — daily sweep cron handles this; no UI work needed yet.
- Pine export for cross-validated strategies — they flow through the existing pipeline and inherit existing Pine export behavior unchanged.

---

## Estimated total build size

- Backend: ~400 LoC (endpoint + cross-validator route + fingerprint helper + migration + tests).
- n8n: 3 new workflows (5P, 5Q, CV1) + edits to 5L/5M/5J/5N→5O to route via `/pending` instead of `/strict`.
- Frontend: ~150 LoC (Pending Watchlist component + SSE wiring).
- Total: ~6–8 hours work via parallel subagent dispatch.
