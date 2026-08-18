# Scout Architecture — Layered Discovery Detail

> Moved verbatim from CLAUDE.md §2b during the 2026-08-18 token-optimization pass.
> On-demand reference — load when touching scout/extraction/graduation pipeline code.

## §2b. Scout Architecture — Layered Discovery (Pass 20 + Pass 21 + Wave 23F)

> **PRODUCTION-VERIFIED 2026-05-19:** Cycle 4 produced first organic W23F-shaped strategy (`orb_mnq_15m` with `entry_quality.confluence_factors=["structural_setup","vp_shape"]`, `extraction_provenance: youtube_transcript`). Pipeline runs end-to-end: MES → MNQ → MCL rotation, LLM extracts confluence factors + symbols, graduator emits entry_quality block, DSL critic accepts with W23F.L convention pre-filter, auditor accepts risk_derived_pyramid sizing. See AGENT-LOGS Wave 23F entry for full bug catalog + fixes.

The scout pipeline runs `autonomous-scout-discovery` cron every 4 hours via in-process `src/server/services/autonomous-scout-runner.ts`. Every compiled strategy passes through `src/server/services/framework-overlay.ts` which REPLACES the scout's risk-management with framework defaults (W23F.N: **Style C 33/33/33** default — TP1 33%@1R / TP2 33%@2R / runner 34% trails developing_session_poc with Chandelier(14,2) fallback; stop floor 1.5×ATR (+6pt MES min) + ceiling 14pt MES / 62pt MNQ / 100 tick MCL (Wave 1 2026-06-27 recal); 15:55 ET hard time-stop; 67% personal DLL; pyramid base 9 MES / 9 MNQ / 18 MCL with +3 increments (proven-trades ramp live / +$3K backtest fallback); max_risk 2%; per-symbol liquidity caps 100/50/30) while PRESERVING the entry signal. Style D is DEAD — see W23F.N AGENT-LOGS entry.

### Two-stage DSL philosophy

| Stage | Source of truth | What it captures |
|---|---|---|
| **Scout extract** | YouTube speaker / Reddit poster / web article | Entry signal — indicator + concrete numeric params (e.g. `ema_crossover { fast:9, slow:21 }`). This is the edge hypothesis we're testing. **W23F.B:** also emits `confluence_factors`, `min_factors_satisfied`, `source_claim_win_rate`, `source_claim_avg_r`, `symbols`. |
| **Framework overlay** | `framework-overlay.ts` (operator-canonical) | Risk management — Style C 33/33/33 exits, ATR stops, time-stop, pyramid sizing, DLL, max_risk. Idempotent; re-runs on already-overlaid configs are no-ops. AUTHORITATIVE — replaces LLM-extracted sizing/exit values, doesn't preserve them. |

### Layer 1 — Web (strategy NAMES + concepts)
- **Exa** (primary) — `https://api.exa.ai/search` neural search + `/contents`. `EXA_API_KEY`.
- **Brave Search** (secondary) — `https://api.search.brave.com/res/v1/web/search?q=...` with `X-Subscription-Token`. `BRAVE_SEARCH_API_KEY`.
- **Parallel.ai** (deep-research) — `https://api.parallel.ai/v1/tasks/runs` with simple 5-prop schema. Keep `task_spec.output_schema` to ≤5 properties. `PARALLEL_API_KEY`.

### Layer 2 — YouTube (DSL depth)
- **Google YouTube Data API v3** — clean JSON titles/IDs. 100 quota units/search × ~18/day = 1800/day (within 10K free tier). `YOUTUBE_DATA_API_KEY`.
- **`youtube-transcript` npm package** — hits YouTube's internal timedtext endpoint. FREE, no API key.
- **Wave 9 prune (2026-05-17):** ScrapingBee, Supadata, ScrapingDog REMOVED. YouTube uses Google YT Data API + `youtube-transcript` npm exclusively.
- **Title scoring (Pass 21):** `+2` for tutorial-positive keywords, `-3` for critique/news/vlog, `+1` if duration 10-30min. Top 3 by score pass downstream.
- **Chunked extraction fallback (Pass 21):** full 8K-char window first; if empty AND markdown > 4000, try 3 overlapping 4K chunks.

### Layer 3 — Reddit (community validation)
- **Free Reddit JSON API** — `https://www.reddit.com/r/<sub>/search.json?q=...&restrict_sr=1&sort=relevance&t=all&limit=10`. No auth.
- `sort=relevance` is MANDATORY (Pass 21).
- DO NOT use Apify — `trudax/reddit-scraper-lite` returns off-topic content (ignored subreddit filter).

### Cross-validation graduation (W23F)
- Same `concept_name` (snake_case normalized) from web + youtube + reddit = `layer_coverage_json = {web:true, youtube:true, reddit:true}` → graduates via `direct-bucket-graduator.ts`.
- **W23F.C** (2026-05-19): bucket fingerprint = `sha256(normalized_concept_name)` ONLY — market dropped from hash so cross-symbol concepts converge. Pre-W23F.C buckets isolated by design.
- Graduator (W23F.D) writes `entry_quality` block + `symbols[]` array + audit events `graduation.entry_quality_attached` + `graduation.symbols_multi_market`.
- See migration `0104_concept_fingerprint.sql`, `0111_strategies_symbols_array.sql`, `src/server/services/strategy-fingerprint.ts`.

### Pinned facts agents must NOT misdiagnose
- **SplitInBatches v3 output indices**: index 0 = "done" (terminal exit), index 1 = "loop" (per-batch body). Wiring downstream to index 0 silently does ZERO work. Always wire to index 1.
- **Webhook nodes added via n8n MCP partial-update API don't auto-register routes** in n8n 2.10.3. Operator must manually toggle Active OFF/ON in n8n UI.
- **Apify trudax reddit-scraper-lite returns off-topic content** — use free Reddit JSON API instead.
- **Supadata + ScrapingBee + ScrapingDog are gone (Wave 9, 2026-05-17)** — YouTube uses Google YT Data API + `youtube-transcript` npm exclusively.
- **Reddit search MUST use `sort=relevance&t=all`** — `sort=top&t=year` returns popular off-topic posts. Pass 21 fix; never revert.
- **YouTube video selection must score titles, not pick first 3** — critique/news/vlog/podcast videos return `no_strategy_content`. Pass 21 added title scoring; bypassing it kills extraction yield.
- **Transcript extractor strictness is a feature, not a bug** — it refuses to fabricate parameters. Don't relax the prompt; improve search instead.
- **Exa pre-cleans content via `/contents` endpoint** — prefer Exa for content extraction.
- **Backtest engine auto-shifts entries +1 bar (`np.roll()` in `src/engine/backtester.py:70-83`)** — bare `close > X` / `high > Y` / `low < Z` in DSL entry conditions is SAFE. LLM extractors do NOT need to add "next bar" qualifiers; the engine handles next-bar timing. The DSL quality critic must only flag IMPOSSIBLE references (`tomorrow`, `future_*`, centered windows, explicit `same_bar_fill: true`). W23F live-fix 2026-05-19 narrowed the rule after a clean ORB extract got rejected for bare `close > orh_15m`. If you change engine fill timing, update `src/agents/kb/anti-pattern-catalog.md` §3 in the SAME commit.
- **Style D is DEAD (W23F.N 2026-05-19)** — Wave 23 spec mandates Style C 33/33/33 as canonical default. Framework-overlay no longer has a `styleD` key. Any future agent that adds Style D back is regressing Wave 23. See AGENT-LOGS W23F.N entry.
- **DSL `entry_short = "high < low"` (with `direction: "long"`) is a deliberate never-true sentinel** — NOT incoherent. Critic must skip per anti-pattern-catalog §3b.
- **`entry_indicator` (canonical) vs `indicators[].type` (compiler-internal) name layers** — `session_open_breakout` ↔ `opening_range_breakout` is a known-valid pair. Critic must accept.
- **Prose fields vs compiled struct intentional divergence** — `entry_long_prose` keeps scout text, `entry_long` is compiled canonical. Both correct at different layers.
- **Strategy `name` derives from `symbols[0]`, NOT from the LLM's name field** — W23F.M graduator canonicalizes name from routing market. An MNQ-routed strategy must NOT have `_mes_` in its name even if the source text used MES as the example.
- **Sizing is FRAMEWORK-AUTHORITATIVE (W23F.N)** — overlay REPLACES LLM-extracted base/tier/cap values. The operator's pyramid math wins, not the YouTuber's. Canonical (2026-06-23 recal — this line previously said the stale 6/6/18): MES 9 / MNQ 9 / MCL 18 base + 3 per tier (proven-trades ramp live / +$3K dollar fallback in backtests) + per-symbol liquidity caps MES 100 / MNQ 50 / MCL 30. Post-C-05/D9 (2026-07-16): base is the SLOW-RAMP floor of the pyramid TIER only — it never overrides the risk-derived cap ("lowest wins", §4).
- **Bare import of any module that transitively pulls the vectorbt-JIT backtester HANGS under pytest collection on the tower** — engine tests must mock vectorbt. (Reconfirmed 2026-06-22 hardening audit; full entry in AGENT-LOGS archive.)

### Stage 2 weighted scoring (Wave 25, Pass 1, W25.1)

`src/server/services/paper-signal-service.ts:3080-3264` dispatcher now has THREE paths (priority order):

1. **Path C (Wave 25, opt-in)** — `entry_quality.use_weighted_scoring === true` → `evaluateWeightedConfluence()` in `src/server/services/confluence-score.ts`.
2. **Path A (W23H.D)** — `confirming_indicators[]` non-empty → per-strategy boolean satisfiedCount.
3. **Path B (Wave 23.C)** — fallback → canonical-5-factor boolean.

**11-factor canonical weight model** (Wave 25 Pass 2.5 expansion from 9 → 11; equal-weight starter; adjust only after 30+ days audit_log instrumentation):

| factor | weight | hard-block? |
|---|---|---|
| `market_structure_aligned`  | 0.20 | no |
| `liquidity_target_clear`    | 0.13 | no (LIVE since Pass 3 — reads liquidity_levels) |
| `smt_confirmation`          | 0.10 | no (LIVE since Pass 5 in backtests via compute_smt_divergence; live-paper bridge DEFERRED to Wave 26 — fail-open `smt_unavailable` for live signals) |
| `vwap_alignment`            | 0.10 | no (LIVE since Pass 5 — institutional discount/premium model + 1σ band reject + anchored VWAP retest) |
| `killzone_active`           | 0.08 | no |
| `delta_or_volume_signature` | 0.08 | no |
| `vp_level_proximity`        | 0.08 | no |
| `macro_alignment`           | 0.08 | **YES — FOMC/CPI/NFP blackout = score=0** |
| `internals_aligned`         | 0.05 | no (MES/MNQ only — MCL skipped) |
| `cross_asset_aligned`       | 0.05 | no (DXY + 10Y vs bias) |
| `regime_match`              | 0.05 | no (bias-engine single-winner match — satisfied when `bias_active_strategy_id === strategyId`, or when no active-strategy preference is set, per `evalRegimeMatch()` in `confluence-score.ts:916-930` fed by `resolveActiveStrategy()` in `bias-state-service.ts`; NOT `preferred_regimes[]` array containment) |
| **sum**                     | **1.00** | |
| **default threshold**       | **0.72** | |

**Decay footnote (W25.7, Pass 4; live-feed reality corrected 2026-07-09 deep-scan HIGH-2; unit + wiring fix 2026-07-17 confluence-decay-bar-unit-mismatch packet):** 6 of 11 factors have decay CODE PATHS in `confluence-decay.ts::deriveFactorDecay()` — `market_structure_aligned` (CHoCH 10-trading-day / MSS 6-trading-day half-life — day-scale, matching the daily-`exec_bars`-computed age it actually receives; PROPOSED/needs-post-ship-validation, not backtested — structure_state is `None` in every backtest), `smt_confirmation` (60-bar), `vwap_alignment` (anchored VWAP 200-bar via fvgDecay), `delta_or_volume_signature` (generic 200-bar), `vp_level_proximity` (5-session), `cross_asset_aligned` (hours-based generic). **But in the LIVE / paper Path C, only 3 of those 6 actually RECEIVE age telemetry → the other 3 return confidence=1.0 (no penalty):** LIVE-FED = `market_structure_aligned` (age from `structureState.choch_age_bars` / `mss_age_bars` / `bos_age_bars` — now genuinely live-fed and independently tracked per-type, RECENCY-FIRST selection among them with same-age ties broken `MSS > CHoCH > BOS`, matching `structure_engine.py::_find_last_break()`'s own same-bar tiebreak; falls back to `last_break_age_bars` only when no per-type age is available), `smt_confirmation` (`smt_age_bars` from the Wave-26 live SMT bridge), `cross_asset_aligned` (`cross_asset_age_hours` from the pre_market_sessions row — CONSUMER wiring (`cross-asset-context.ts`) verified correct end-to-end 2026-07-09 deep-scan HIGH-1, cert band 9 **on the consumer side only**; the PRODUCER — `pre_market_sessions`'s bars-derived DXY/10Y fields — has delivered 0/39 non-null values ever, per the 2026-07-17 liveness audit. **`GET /api/bars/:symbol` SHIPPED 2026-07-17 (landed `9578ad7d`, S3/DuckDB-backed, honest-empty contract) so `pre-market-routine.ts` no longer 404s** — but the 0/39 count is STILL UNCHANGED, because `CONTRACT_SPECS` (`src/engine/config.py`) has zero registered entries for DXY or ZN/10Y (only MES/MNQ/MCL + their ES/NQ/CL aliases) — the endpoint now returns an honest `200 {bars: []}` for those symbols instead of a 404, but there is still no data-lake producer for DXY/10Y anywhere in the codebase. So `cross_asset_age_hours` is correctly READ when present but has never been genuinely populated in production — this is a live DATA-SOURCING gap now (not a missing-endpoint gap); do not cite "cert band 9" as end-to-end confirmation until a real DXY/10Y data source is wired AND a non-null value is observed — sourcing that feed is a distinct, separately-scoped operator decision (new external dependency, unknown cost/rate-limits), flagged but not built). NOT LIVE-FED (confidence stays 1.0, and this is DEFENSIBLE — not a silent bug): `vwap_alignment` decays only for OPT-IN anchored VWAP (`vwap_anchor_age_bars`); session VWAP (the default) has no anchor so no-decay is correct-by-design; `vp_level_proximity` and `delta_or_volume_signature` both evaluate FRESH current-bar indicators (`vp_poc`/`vp_vah`/`vp_val` vs current close; bar-derived `volume_rolling_mean_20`) — a fresh-per-bar signal has ~0 age so full confidence is correct. Their `vp_age_sessions`/`delta_age_bars` decay hooks exist for a FUTURE where those signals carry a persisted staleness (e.g. VP levels tagged with sessions-since-build); the backtest path may populate them where live does not. Do NOT fabricate ages to "light up" these decays — an unfed decay reading full-confidence is the honest conservative default. 5 factors SKIP decay (anti-double-decay guard): `liquidity_target_clear` (already touch+age-decayed in liquidity-map-service), `internals_aligned` (5-min staleness gate in market-internals-service), `macro_alignment` (hard-block binary), `regime_match` (binary state — STAYS binary even after Pass 6 expanded the regime vocabulary from 3 to 8 values; narrative phase is its own env-gated gate, NOT a decay layer on regime), `killzone_active` (binary time window). `FactorContribution.decay_confidence` is `null` for SKIP factors, `[0,1]` for decayed factors. Hard-kill (mitigated FVG/OB) forces satisfied=false and confidence=0.

**MCL redistribution (W25.5c):** for MCL signals, `internals_aligned` weight is zeroed (stock breadth irrelevant for crude) and the +0.05 redistributes to `cross_asset_aligned` (→ 0.10). Crude follows DXY/yields, not NYSE breadth. Renormalized weights still sum to 1.00. Logic in `confluence-score.ts::evaluateWeightedConfluence` (`isMCL` branch).

**Override hierarchy (highest wins):** per-strategy `strategies.confluence_score_weights` (JSONB) > env var `CONFLUENCE_SCORE_WEIGHTS` (JSON string) > `CODE_DEFAULTS` table.

**Hard-block contract:** `macro_alignment` (and any future factor with `is_hard_block: true`) forces score to 0 when not satisfied — bypasses the weighted sum entirely. Never tradable in event blackout regardless of how strong other factors look.

**Backward compat:** `use_weighted_scoring` defaults FALSE — all pre-Wave-25 strategies stay on Path A/B. Opt in per-strategy via `scripts/wave25-pass1-weighted-opt-in.ts --apply` (idempotent, dry-run by default).

**Independent Structure Engine (W25.2):** `src/engine/context/structure_engine.py` publishes `StructureState` (BOS/CHoCH/MSS/PD-zone/HTF-alignment) BEFORE the entry trigger evaluates. Fixes the circular-logic bug where `structural_setup=True` whenever the entry fired. Persisted to `bias_state.structure_state` JSONB (migration 0134); typed contract in `BiasStateForSignal.structureState` and `confluence-score.ts::StructureState`.

**Killzone helper (W25.3):** `src/server/lib/killzone.ts` — 5 first-class zones (`london`, `ny_am`, `ny_pm`, `silver_bullet`, `macro_window`) with DST-correct Intl.DateTimeFormat evaluation. Pure functions, never throws.

### 5-TF MTF hierarchy (Wave 25, Pass 2, W25.4)

Engine moves from 2-TF (exec + daily) to full institutional top-down: **daily / HTF / ITF / trigger / exec**. Declared per-strategy via 4 OPTIONAL TEXT columns on `strategies` (migration 0138 idx 140): `daily_tf`, `htf_tf`, `itf_tf`, `trigger_tf`. Daily ALWAYS loads (engine invariant); other TFs are optional and skipped when null. Strategies with NONE of the new columns set continue 2-TF operation identically to pre-Pass-2 behavior — backward-compat is the engine default, not an opt-in.

| Engine helper | File | Role |
|---|---|---|
| `load_n_timeframes()` | `src/engine/data_loader.py` | Loads up to 5 TFs from S3 ratio-adjusted Parquet; returns Polars DataFrames keyed by TF label |
| `compute_multi_htf_indicators()` | `src/engine/indicators/core.py` | Computes per-TF indicator set (ATR, EMA, VWAP, structure markers) before join |
| `join_n_timeframes_to_exec()` | `src/engine/indicators/mtf_join.py` | Aligns higher-TF indicators to exec-TF bar timestamps without look-ahead; emits `engine.mtf_join_completed` audit row |
| `resample_daily_to_weekly()` | `src/engine/indicators/mtf_join.py` | ISO-week aggregation helper (used by Pass 2.5 for PWH/PWL) |

DSL compiler (`src/server/lib/dsl-compiler.ts`) extended from single-TF (`bias_timeframe`) AND-gating to N-TF AND-gating: any TF declared on the strategy participates in the bias-alignment check at signal time.

### HTF Narrative State (Wave 25, Pass 2, W25.5)

Per-session institutional context, computed pure-functionally (no DB, no `time.now()`, no side effects — replay-deterministic).

`src/engine/context/htf_narrative.py::compute_htf_narrative()` emits 4 snake-case dataclasses (Python-side) mirrored exactly by 5 exported TS interfaces (`bias-state-service.ts:71-117`). All field types are primitives (`Optional[float|int|str|bool]`) — no Python-only types like `Decimal`.

| Dataclass | Session window (ET) | Fields |
|---|---|---|
| `AsianRange`   | 18:00 prev day → 03:00 | `high`, `low`, `range_size`, `formed_at_bar_idx` |
| `LondonBias`   | 03:00 → 08:30          | `direction` ("bullish"/"bearish"/null), `swept_pdh`, `swept_pdl` |
| `NYBias`       | 08:30 → 10:30          | `direction`, `open_above_overnight_range`, `open_below_overnight_range` |
| `DailyDealing` | full daily             | `dealing_range_high`, `dealing_range_low`, `current_quadrant` (premium_upper / premium_lower / discount_upper / discount_lower / equilibrium / null) |

Persisted to `bias_state.htf_narrative` JSONB (migration 0137 idx 139). Wired into TS via `BiasStateForSignal.htfNarrative` (typed). Audit event: `bias_engine.htf_narrative_computed`. **Fail-open contract**: a null narrative NEVER blocks signal flow — strategies without 5-TF declaration use `structureState` only.

**Cross-pass consumer contract:** Pass 6 (narrative continuity state machine) will EXTEND HtfNarrative with A/M/E phase tracking via a PARALLEL field — do NOT mutate the existing 4 sub-dataclasses or piggyback A/M/E onto `DailyDealing.current_quadrant`. Pass 7 (adaptive exits) consumes `daily_dealing` for runner-trail target selection.

---

