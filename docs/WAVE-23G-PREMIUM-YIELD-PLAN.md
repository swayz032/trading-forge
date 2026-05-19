# Wave 23G — Premium Strategy Yield Plan

> **Mission:** Lift strategy-factory yield from ~5–15% (15 strategies / 246 eligible videos / cycle)
> to **40–60%** (~100+ strategies / cycle) by removing 15 enumerated bottlenecks while keeping
> every change production-grade (fail-closed, audited, idempotent, system-map synced).

> **Scope:** 12 production tracks (W23G.1 – W23G.12). Every track ships behind a CI hard gate, has a
> migration if state changes, emits structured audit events, and includes regression tests pinned
> to operator-verified examples.

> **Hard constraints (CLAUDE.md):**
> - Style C 33/33/33 canonical (no Style D regressions)
> - Sizing = `risk_derived_pyramid`, base 6 MES / 6 MNQ / 18 MCL, max_risk 2%, 67% personal DLL
> - Per-symbol liquidity caps MES 100 / MNQ 50 / MCL 30
> - Win rate is OUTPUT not target — gates measure expectancy / PF / deflated Sharpe / regime survival
> - Strategy is firm-agnostic; sizing is firm-aware (Topstep trailing-DD buffer vs MFFU 2%)
> - 1 A+ trade/day/account — bias engine + playbook router picks active strategy by regime
> - Daily scout cron runs ONCE per UTC day (08:00 ET / 12:00–13:00 UTC) — never multiple times per day
> - System Map sync mandatory after every track; CI gate `system-map:check` must stay green
> - Commit + push after every successful track (CLAUDE.md §11a hard rule)

---

## Audit baseline (2026-05-19)

`scripts/audit-graduated-strategy-dsls.ts` against 74 graduated strategies:

| Result | Count | Note |
|---|---|---|
| "Clean" | 67 | But **100% are single-direction** — that IS the bottleneck |
| Flagged | 7 | All flagged for `direction='both'` + `risk_derived_pyramid` |

**Critical finding:** the audit script is at Wave 22 spec — it rejects both `direction='both'` AND `risk_derived_pyramid` even though CLAUDE.md §4 makes the latter canonical. The 7 "flagged" strategies are actually the **only correct ones** for current spec.

**Architectural finding:** `dsl-compiler.ts:55` already accepts `direction: "long" | "short" | "both"`. Every supported pattern emits both `entry_long` and `entry_short` grammar with the sentinel `"high < low"` masking the unused side. `backtester.py:1825-1830` already runs both sides when `entry_short` column is non-sentinel. **Bidirectional is architecturally present today** — only the LLM prompt, graduator default, and audit script gate it.

This dramatically reduces W23G.12 (formerly W23F.AA) scope.

---

## Bottleneck → Track map

| # | Bottleneck | Track | Severity | Effort |
|---|---|---|---|---|
| 1 | DSL collapses confluence to single indicator | **W23G.11** | 🔴 Critical | 1.5 d |
| 2 | DSL one timeframe field — no bias_tf + execution_tf | **W23G.11** | 🔴 Critical | (combined) |
| 3 | `wrong_instrument` over-rejects mixed-chart futures | **W23G.2** | 🔴 Critical | 2 h |
| 4 | `missing_params` rejects structural (SMC/ICT/Wyckoff) | **W23G.3** | 🔴 Critical | 3 h |
| 5 | Transcript fetch 70% fail when caption filter dropped | **W23G.4** | 🔴 Critical | 4–6 h |
| 6 | YouTube API ranks differently than UI | **W23G.5** | 🟡 High | 2 h |
| 7 | Same-creator bias | **W23G.5** | 🟡 High | (combined) |
| 8 | Title-only filter loses content-rich descriptions | **W23G.6** | 🟡 High | 3 h |
| 9 | Chunked extraction wastes 60–80 K tokens / video | **W23G.7** | 🟡 High | 3 h |
| 10 | Reddit verify-only, never enriches extraction | **W23G.8** | 🟡 High | 4 h |
| 11 | Strategies single-direction; symmetric setups halved | **W23G.12** | 🔴 Critical | 1 d (reduced) |
| 12 | Audit script stale (Wave 22 spec) | **W23G.1** | 🟡 High | 2 h |
| 13 | Once-daily cron caps absolute throughput | **n/a — by design (token budget)** | — | — |
| 14 | Transient LLM 429/5xx fails extraction | **W23G.9** | 🟢 Medium | 2 h |
| 15 | Title-scorer indicator+clickbait under-ranking | **W23G.10** | 🟢 Medium | 1 h |

Total: 12 tracks, ~5 working days of effort. Bottleneck #13 (once-daily cron) is preserved by feedback memory `feedback_strategy_gen_once_daily.md` — out of scope.

---

## Execution order (4 waves)

### Wave G-Alpha — Defensive fixes (audit + retries)
*Ship first; unblocks everything else; zero risk to graduated bucket.*

1. **W23G.1** — Fix stale audit script
2. **W23G.9** — LLM transient error retry
3. **W23G.10** — Title-scorer tune

### Wave G-Beta — Extractor robustness
*Increases LLM hit rate on EXISTING discovery flow.*

4. **W23G.2** — `wrong_instrument` tightening
5. **W23G.3** — Structural missing_params recovery
6. **W23G.7** — Single-pass extraction (token savings)

### Wave G-Gamma — Discovery breadth
*Widens the funnel; depends on Beta being solid so we don't amplify garbage.*

7. **W23G.4** — Transcript retry queue + caption two-pass
8. **W23G.5** — Multi-order sampling + per-channel cap
9. **W23G.6** — Description-first filtering
10. **W23G.8** — Reddit cross-extract enrichment

### Wave G-Delta — Schema upgrades
*Highest impact, most invasive; ships last with full migration + backfill.*

11. **W23G.11** — Multi-indicator + multi-timeframe DSL (W23F.W)
12. **W23G.12** — Bidirectional strategy support (W23F.AA, reduced scope)

After Delta: re-audit, backfill 67 single-direction strategies to bidirectional where archetype is symmetric, re-run all 74 through new validator, re-graduate if needed.

---

## Track specs (production-grade)

Every track ships with: ✅ test plan, ✅ audit_log events, ✅ migration (if state change), ✅ rollback path, ✅ system-map sync, ✅ commit-and-push immediately on green.

### W23G.1 — Fix stale audit script

**File:** `scripts/audit-graduated-strategy-dsls.ts`

**Changes:**
- Accept `position_size.type ∈ {risk_derived_pyramid, profit_tier_pyramid}`
- Accept `direction ∈ {long, short, both}`; when `'both'` REQUIRE non-empty `entry_long` AND `entry_short`
- Accept Style C `exit_params.tp1_at_r=1`, `tp2_at_r=2`, `runner_trail` in addition to legacy `partial_at_r=1` + chandelier
- Accept `max_contracts=undefined` when `type=risk_derived_pyramid` (computed at signal-time)

**Tests:** `src/server/__tests__/audit-graduated-strategy-dsls.test.ts` — assert 0 defects on the 7 currently-flagged strategies.

**Migration:** none.
**Audit events:** none (script is read-only).
**Rollback:** revert single file.

---

### W23G.2 — `wrong_instrument` over-rejection

**File:** `src/server/services/agent-service.ts` (scout-extract prompt) + `src/server/__tests__/scout-extract.test.ts`

**Changes:**
- Tighten classifier: reject ONLY when ≥70% of transcript references non-futures markets (forex pairs, crypto symbols, stock tickers).
- Brief illustration of forex/stock chart in a futures-titled video = KEEP.
- Add `reason: "mixed_instrument_kept_futures"` to scout-extract audit_log for observability.

**Tests:** synthetic JackTrades-style transcript (futures 4H pattern + 30 s EURUSD chart segment) — must extract.

**Migration:** none.
**Audit events:** `scout.extracted` with new `instrument_classification` field.

---

### W23G.3 — Structural missing_params recovery

**File:** `src/server/services/agent-service.ts` + `src/server/routes/agent.ts` (W23F.S branch extension)

**Changes:**
- When LLM returns `reject: true, reason: 'missing_params'` AND prose mentions structural concept (regex match for liquidity_sweep / order_block / fvg / wyckoff_spring / wyckoff_upthrust / judas_swing / silver_bullet / breaker), synthesize stub DSL: `{ entry_type: 'structural', entry_indicator: 'archetype:<name>', entry_params: {}, archetype_detected: true }`
- Mark `extraction_provenance: 'structural_recovery'` for downstream observability.

**Tests:** 6 archetype-specific transcript fixtures; each produces a valid DSL with non-empty archetype.

**Migration:** none (uses existing `extraction_provenance` field).
**Audit events:** `scout.structural_recovery` with `archetype_name`.

---

### W23G.4 — Transcript retry queue + caption two-pass

**File:** `src/server/services/autonomous-scout-runner.ts` + new `src/server/services/transcript-fetch-queue.ts`

**Changes:**
- New service: exponential-backoff retry (3 attempts, jittered 2s / 8s / 30s).
- Two-pass search: pass 1 `videoCaption=closedCaption` (high yield, ~96% success); pass 2 no filter (recovery for high-value channels missed in pass 1).
- Per-video audit_log row: `{ video_id, outcome: captioned_succeeded | captioned_failed | auto_recovered | all_failed, attempt_count }`.
- Dashboard metric: transcript success rate per cycle (target ≥85%).

**Tests:** mock youtube-transcript responses for 200/429/timeout; verify retry path + final outcome attribution.

**Migration:** `0112_transcript_fetch_outcomes.sql` — new table `transcript_fetch_outcomes(video_id, outcome, attempts, duration_ms, created_at)`.
**Audit events:** `scout.transcript_fetched`.
**Rollback:** drop table + revert service.

---

### W23G.5 — Multi-order sampling + per-channel cap

**File:** `src/server/services/autonomous-scout-runner.ts`

**Changes:**
- Per query: 3 API calls — `order=relevance(maxResults=25)` + `order=viewCount(15)` + `order=date(10)`. Dedupe by `videoId`.
- After scoring, apply `MAX 2 videos per channel` cap.
- Audit_log per-cycle channel diversity stats: `{ unique_channels, max_per_channel, total_unique_videos }`.

**Tests:** 8 queries should produce ≥150 unique videos across ≥30 distinct channels.

**Migration:** none.
**Audit events:** `scout.diversity_stats`.

**Quota math:** 8 queries × 3 calls × 100 quota units = 2400/day (still inside 10K free tier; previous was 800).

---

### W23G.6 — Description-first filtering

**File:** `src/server/services/autonomous-scout-runner.ts`

**Changes:**
- `snippet.description` already returned by YouTube search — no extra quota cost.
- New `scoreContent(title, description)` extends `scoreTitle` with description-side regex matches at half weight (description signal is noisier than title).
- Threshold `> -3` applied to combined score; observability: log both `title_score` and `combined_score`.

**Tests:** synthetic title "$500/day futures method" (clickbait) + description "9 EMA crosses 21 EMA on MES 5-min RTH-only" → combined score ≥ 0.

**Migration:** none.
**Audit events:** existing `scout.scored` extended with `combined_score`.

---

### W23G.7 — Single-pass extraction

**File:** `src/server/services/agent-service.ts` (chunked-fallback logic)

**Changes:**
- Default to single-pass 12 K window (current first pass is 8 K).
- Chunked fallback (3×4K) ONLY triggers if first pass returns empty AND raw markdown > 12 K.
- Per-cycle token-cost telemetry: `audit_log.input.tokens_estimated`.

**Tests:** golden fixture — 9-K transcript with strategy in middle 6 K. First pass must extract; fallback must NOT fire.

**Migration:** none.
**Audit events:** existing `scout.extracted` + new `extraction_mode: single_pass | chunked_fallback`.

**Expected savings:** 60% reduction (8K + 12K = 20K → 12K single-pass).

---

### W23G.8 — Reddit cross-extract enrichment

**File:** `src/server/services/autonomous-scout-runner.ts` + new helper `enrichFromReddit`

**Changes:**
- When YouTube extraction returns empty OR concept appears with `score >= 50 reddit upvotes`, fetch top 5 comments via Reddit JSON API.
- Concatenate post body + top 5 comments → re-run scout-extract.
- Merge result with YouTube extraction; on conflict, YouTube wins (it's the primary source), Reddit fills gaps (params, exit rules).

**Tests:** synthetic concept_name found only in Reddit → graduates with `extraction_provenance: reddit_only`.

**Migration:** none.
**Audit events:** `scout.reddit_enriched` with `concept_name` + `merge_outcome`.

---

### W23G.9 — LLM transient retry

**File:** `src/server/services/openai-client.ts` (or wherever `callOpenAI` lives) — scoped to `scout_extract` role only.

**Changes:**
- Exponential-backoff retry: 3 attempts, 1s / 4s / 15s.
- Retry on: 429, 5xx, network timeout, `model_unavailable`.
- Final fail-OPEN to Ollama fallback (already wired for strategy_proposer; extend for scout_extract).

**Tests:** mock 429-then-200 sequence; assert single extraction emitted.

**Migration:** none.
**Audit events:** `llm.retry_attempt` per failed attempt.

---

### W23G.10 — Title-scorer indicator+clickbait tuning

**File:** `src/server/services/autonomous-scout-runner.ts` (scoreTitle function)

**Changes:**
- If `INDICATOR_NAME_TITLE` AND `CLICKBAIT_TITLE` BOTH match, soften clickbait penalty from `-3` to `-1`.
- Rationale: explicit indicator name in clickbait title still signals educational content.

**Tests:** "THIS 1HR FUTURES STRATEGY MAKES $500/DAY" should score ≥ 0 (indicator `1hr` + indicator `strategy` + clickbait `$500/day`).

**Migration:** none.
**Audit events:** none (scoring change is observable via score itself).

---

### W23G.11 — Multi-indicator + multi-timeframe DSL (W23F.W)

> **Heaviest track. Ships with full schema migration + scout-extract prompt overhaul + graduator persistence + DSL compiler extension + backtester evaluation + tests.**

**Files (all in single coordinated commit):**
- `src/server/db/schema.ts` — add columns
- `src/server/db/migrations/0113_confluence_dsl.sql` — additive, nullable
- `src/server/services/agent-service.ts` — extractor prompt
- `src/server/services/direct-bucket-graduator.ts` — persistence
- `src/server/lib/dsl-compiler.ts` — emit AND-combined entry grammar
- `src/server/services/framework-overlay.ts` — verify symmetric Style C
- `src/engine/compiler/compiler.py` — validate confluence schema
- `src/engine/signals.py` — already supports AND/OR combinators (verify)
- `src/server/__tests__/wave23g-confluence-dsl.test.ts`

**Schema additions (additive, all nullable for backward compat):**

```typescript
// strategies.config additions
{
  primary_indicator: string,             // existing entry_indicator (rename-alias preserved)
  confirming_indicators: Array<{
    indicator: string,
    params: Record<string, number>,
    direction: "agree" | "disagree" | "either",
    weight: number  // 0.0–1.0; defaults to 1.0
  }>,
  min_factors_satisfied: number,         // already in W23F.B for source_claim; reused
  bias_timeframe: string | null,         // "1h", "4h" — null = single-timeframe legacy
  execution_timeframe: string,           // existing `timeframe` field renamed; kept as alias
  bias_condition: string | null          // optional — "ema_50_4h > ema_200_4h" for HTF gate
}
```

**LLM extractor prompt changes:**
- Add: "If source describes multiple indicators that must ALL hold (confluence), set `primary_indicator` to the main signal and list others in `confirming_indicators[]`. Set `min_factors_satisfied` to how many must agree."
- Add: "If source describes a higher-timeframe bias (e.g. '4H trend up, enter on 15m pullback'), set `bias_timeframe` to '4h' and `bias_condition` to the bias rule, then set `execution_timeframe` to '15m'."

**DSL compiler:**
- Emit `entry_long` as `<primary_long> AND <confirm_1_long> AND <confirm_2_long>` (where each confirming indicator is mapped through the same primitive translator).
- For HTF bias: emit `bias_condition` as `<htf_indicator_4h> > <htf_threshold>` and gate entries with `AND <bias_condition>`.

**Backtester:**
- `compute_indicators` already supports per-timeframe resampling — verify and document.
- Signals.py grammar already supports `AND` / `OR` — verify with new compiled output.

**Tests:**
- Confluence: ORB + FVG + Order Block, all 3 must agree → only fires when all 3 conditions hold.
- MTF: 4H EMA50 > EMA200 bias + 15M RSI<30 entry → entry only fires when both timeframe conditions met.
- Backward compat: legacy single-indicator strategies still compile and run unchanged.

**Migration:** `0113_confluence_dsl.sql` — additive nullable columns + index on `confirming_indicators IS NOT NULL` for diversity tracking.
**Audit events:** `graduation.confluence_strategy`, `graduation.mtf_strategy`.
**Rollback:** new columns are nullable + un-referenced if rolled back; safe.

---

### W23G.12 — Bidirectional strategy support (W23F.AA, reduced scope)

> **Reduced from 1.5d to 1d after audit revealed engine + compiler already support `direction='both'`.**

**Files:**
- `src/server/services/agent-service.ts` — prompt update
- `src/server/services/direct-bucket-graduator.ts` — auto-mirror logic
- `src/server/services/framework-overlay.ts` — verify symmetric Style C application
- `src/server/services/pine-export.ts` — emit both long+short entries
- `scripts/backfill-bidirectional-strategies.ts` — one-shot backfill for 67 existing
- `src/server/__tests__/wave23g-bidirectional.test.ts`

**LLM extractor prompt:**
- Add: "If source describes both long AND short setups with mirrored logic (e.g. 'enter long on ORH break, short on ORL break'), set `direction='both'`. The compiler will emit both entry grammar lines."
- For asymmetric strategies (e.g. counter-trend at VWAP — long only), keep `direction='long'`.

**Graduator auto-mirror rule:**
- For symmetric archetypes (`opening_range_breakout`, `bollinger_breakout`, `donchian_breakout`, `mean_reversion`, `wyckoff_spring`↔`wyckoff_upthrust`, `keltner_squeeze`), if LLM returned `direction='long'` OR `direction='short'`, automatically promote to `direction='both'` and tag `mirror_inferred: true`.
- For asymmetric archetypes (`vwap_reversion`, `connors_rsi2`, single-side patterns), keep LLM's emitted direction.

**Pine export:**
- When `direction='both'`, emit both `strategy.entry(id="L", direction=strategy.long, when=<entry_long_compiled>)` AND `strategy.entry(id="S", direction=strategy.short, when=<entry_short_compiled>)`.
- Stop / TP / runner all already direction-agnostic in Style C — verified.

**Framework-overlay:**
- Style C is direction-symmetric by construction (TP1@1R, TP2@2R, runner trails POC). Verified with new test.

**Backfill script:**
- Walk all 67 single-direction "clean" strategies.
- For each, check if archetype is in symmetric set.
- If yes, promote to `direction='both'`, set `mirror_inferred: true`, write audit `strategy.bidirectional_backfilled`.
- Re-run all 74 through new audit script — must return 0 defects.

**Tests:**
- ORB long-only → auto-mirrored to bidirectional with `mirror_inferred: true`.
- VWAP reversion long-only → kept as long-only.
- Backtest on bidirectional ORB shows non-zero short trades.
- Pine export contains both `strategy.entry(direction=strategy.long, ...)` and `(direction=strategy.short, ...)`.

**Migration:** `0114_bidirectional_metadata.sql` — add `mirror_inferred BOOLEAN` to strategies.config (json column extension, no DDL needed if already JSONB).
**Audit events:** `strategy.bidirectional_backfilled`, `graduation.bidirectional`.

---

## Risk register

| Risk | Mitigation |
|---|---|
| Multi-order sampling 3× quota | Still within free 10K tier (2400 < 10K); cron is once-daily anyway |
| Auto-mirror creates fake short edges where asymmetric strategy exists | Whitelist symmetric archetypes ONLY; default = keep LLM direction |
| Confluence DSL backward-incompat with 74 existing strategies | All new fields nullable; legacy strategies un-touched |
| Reddit cross-extract amplifies low-quality forum opinions | Require `score >= 50 upvotes` + restrict to known subs (`r/futurestrading`, `r/daytrading`, `r/algotrading`) |
| Single-pass extraction misses strategies in second half of long transcripts | Fallback path still exists for empty-first-pass + length>12K case |
| Caption two-pass doubles transcript-fetch traffic | Retry queue with jittered delays + per-video dedupe prevents flooding |

---

## Verification gates per track

Every track must satisfy ALL of:

1. ✅ Vitest passes for new tests AND existing test suite (no regressions)
2. ✅ `npm run check:production-isolation` green
3. ✅ `npm run check:2026-compliance` green
4. ✅ `npm run system-map:check` green
5. ✅ Audit event present in `audit_log` for happy + sad paths
6. ✅ Migration applies cleanly + idempotently
7. ✅ Rollback path documented + tested in staging
8. ✅ Commit + push to origin/main immediately on green (CLAUDE.md §11a)

---

## Success criteria (end of Wave 23G)

- Re-run E2E on 8 operator-curated keywords → ≥100 unique strategies extracted (vs ~15 today)
- ≥40% of new strategies have `confirming_indicators[]` populated (vs 0 today)
- ≥30% of new strategies have `bias_timeframe` non-null (vs 0 today)
- ≥60% of new strategies have `direction='both'` (vs 0 today)
- Audit script returns 0 defects on all 74 + N new strategies
- Token spend per cycle ≤1.0M (within Trading Forge cap; protects shared 2.5M budget with Aspire)
- System-map drift = 0
- Existing 67 strategies backfilled where symmetric (~40 expected promotions to bidirectional)

---

## Timeline (autonomous execution)

| Wave | Tracks | Days |
|---|---|---|
| G-Alpha | 1, 9, 10 | 0.5 |
| G-Beta | 2, 3, 7 | 1.0 |
| G-Gamma | 4, 5, 6, 8 | 1.5 |
| G-Delta | 11, 12 + backfill | 2.0 |

**Total: ~5 working days.** Each wave ends with system-map sync + commit-push + AGENT-LOGS.md entry + memory-update if a new fact is pinned.

---

## Carry-forward for next session

After Wave 23G completes, candidate follow-ups (NOT in scope here):
- Bias engine + playbook router wiring to confluence strategies (separate agent owns this per memory `feedback_strategy_factory_ownership.md`)
- Backtest-engine confluence coverage tests (golden fixtures)
- TradersPost webhook contract update if Pine bidirectional emits new fields
- Frontend `LibraryDiversityPanel` confluence + direction columns

End of plan.
