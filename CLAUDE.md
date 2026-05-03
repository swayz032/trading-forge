# Trading Forge — Project Conventions

## Mission

Trading Forge is an autonomous futures strategy research, validation, paper-trading, and ATS-export pipeline for prop-firm trading.

The business target is concrete and non-negotiable: **find one strategy that clears $10,000/month net on a single 50K prop-firm account** after fees, commissions, slippage, firm rules, buffer phase, and payout splits. A strategy that requires multi-account scaling is rejected. Agents must never fake profitability. The gates decide.

The System Map (`Trading Forge System Map v2.md`) is the source of truth for all subsystems. Agents: reference the System Map for architecture details. CLAUDE.md covers conventions, constraints, and patterns.

### Current Phase: Production Hardening Only

All build phases are done. No new subsystems, no greenfield features. The only remaining work is hardening, integration, organization, and deletion. Agents must reject feature-add suggestions and reframe work as production hardening.

### Operating Principles
1. Enterprise-grade automation — every step collects data, every handoff is tracked
2. Self-evolving — the system gets smarter as data accumulates (DeepAR auto-graduates,
   critic loop improves strategies, strategy memory learns from failures)
3. Zero loop leaks — the lifecycle pipeline has no bugs, errors, or silent failures
4. Human controls deployment ONLY — you decide what strategies go to TradingView.
   Everything else is autonomous.
5. The system map must always be current. After architecture changes, run
   `npm run system-map:sync` and keep CI passing with `npm run system-map:check`.
6. n8n is part of Trading Forge automation. Current Trading Forge workflows in
   live n8n are first-class automation components, not external/non-core.
   Archived Trading Forge workflows are excluded from the active inventory.

## What This Is
Autonomous futures/derivatives strategy research lab. Single user (swayz032), single 50K prop-firm account, $10K/month net target. Fully automated research -> validation -> paper trading -> ATS-export pipeline. Human controls TradingView deployment only. Not a SaaS product.

**Trading Forge is PRIVATE — no SaaS, no marketplace, no monetization channels.**
Pine export remains available for personal TradingView indicator use only.
Reject any feature suggestion framed around selling, licensing, or distributing
strategy artifacts. The B9 Pine marketplace component was REMOVED 2026-05-03
(reverted at commit `6740db2`) because it conflicted with this constraint.

## Hosting / Cost Posture

- **Railway is the PAID $20/month plan** (not free tier). Plenty of usage-based
  compute headroom for backtests, async paper signal generation, and B6 cloud
  failover. Do not assume "free-tier $5 credit window" constraints — those are
  obsolete.
- Skytech is primary compute. Railway is emergency failover (B6 state machine
  in `src/server/lib/compute-failover.ts`).
- Other free tiers (Fly.io, Cloudflare Workers, IBM Quantum) remain in use as
  secondary fallbacks; cost discipline still applies elsewhere.

## Strategy Lifecycle (Automated)
CANDIDATE -> TESTING -> PAPER -> DEPLOY_READY -> [PILOT ->] DEPLOYED -> DECLINING -> RETIRED -> GRAVEYARD

Automated transitions (every 6h scheduler check):
- CANDIDATE -> TESTING: forgeScore >= 50, tier 1/2/3, backtest + WF complete
- TESTING -> PAPER: MC survival > 70%, prop compliance >= 1 firm
- PAPER -> DEPLOY_READY: 30+ days paper, rolling Sharpe >= 1.5
- DEPLOY_READY -> PILOT: **HUMAN ONLY** (canary track — 5 sessions, 1 contract)
- DEPLOY_READY -> DEPLOYED: **HUMAN ONLY** (legacy direct deploy)
- PILOT -> DEPLOYED: AUTOMATIC after 5 paper sessions when rolling Sharpe >= 1.0 AND all sessions compliance-passed
- PILOT -> GRAVEYARD: AUTOMATIC if any kill switch fires OR criteria fail at session 5
- DEPLOYED -> DECLINING: Rolling Sharpe < 1.0 (inline check every 4h)
- DECLINING -> RETIRED: Evolution fails or max attempts
- Any -> GRAVEYARD: Catastrophic failure, compliance violation, kill signal

The system NEVER auto-deploys without a human first promoting to DEPLOY_READY → PILOT (or DEPLOY_READY → DEPLOYED for legacy direct deploys). PILOT → DEPLOYED auto-promotion happens only after the 5-session canary window passes its gates. You choose what enters PILOT; the system finishes the canary check.

### PILOT Canary State (W14 / B8)

- **Schema:** `pilot_sessions` table (migration 0077) tracks one row per session
  slot (`sessionNumber` 1-5) with `rollingSharpeFinal`, `compliancePassed`,
  `outcome`, `killReason`, `contracts` (forced to 1).
- **Service:** `LifecycleService.checkPilotAutoPromotions()` runs in the
  6-hour `lifecycle-auto-check` cron alongside the regular auto-promotion sweep.
  Pipeline pause guard via the scheduler `pipelineGate()` wrapper.
- **Authority:** PILOT auto-promotion / auto-kill is SYSTEM-driven. PILOT entry
  requires `actor="human_release"` (matches DEPLOYED authority).
- **Why:** Industry canary pattern between DEPLOY_READY and DEPLOYED — catches
  "passed paper but live trading exposes new failure modes" without committing
  full size to a single strategy.

### Minimum Regime Performance (W14 / B10)

- **Schema:** `mrp_sharpe` (numeric) + `mrp_regime_breakdown` (jsonb) columns
  on the `backtests` table (migration 0078). Null for pre-B10 backtests or
  backtests with insufficient regime data.
- **Computation:** Fire-and-forget after backtest completes. Groups
  `backtest_trades` by `macroRegime`, computes annualized Sharpe per regime
  (>= 3 trades required, UNKNOWN regime excluded), stores the minimum value.
  Runs INSIDE `runBacktest()` after the entry-point `isPipelineActive()` guard,
  so it inherits the pause gate.
- **Authority:** SOFT gate at PAPER -> DEPLOY_READY. `mrp_sharpe < 0.5` logs
  an advisory `audit_log` row + WARN-level log line; never blocks promotion.
  Hard gate activates after 30 days of MRP data.
- **Why:** Per Alexander-Fabozzi (2026), MRP is the best single metric for
  regime-conditional fragility. A strategy with mrp_sharpe < 0.5 will fail
  when the dominant macro regime rotates.

### Macro News Blackout Opt-In (W14 / B11)

- **`bypass_news_blackout: true`** in DSL (per W13 B3 spec) lets event-driven
  strategies (e.g., `news_fade_mcl`) trade during FOMC/CPI/NFP ±30 min macro
  blackouts. Default is the full blackout (fail-safe for all other strategies).
- **Holidays still block.** No strategy can trade on CME-closed holidays —
  `bypass_news_blackout` does NOT override the holiday check.
- **Wired:** `paper-signal-service.ts` reads the opt-in from `sessionConfig.config`
  before evaluating any entry signal; `dsl-translator.ts` propagates it from
  fixture into the paper config; `calendar_filter.py` defines the FOMC/CPI/NFP
  blackout windows for 2026-2027.
- **Authority:** explicit opt-in only. Without the field, default behavior
  (SIT_OUT ±30 min) applies — matches the CLAUDE.md "Don't trade through
  FOMC/CPI/NFP without explicit event handling" rule.

### CME Venue Outage Handling (W15 / C1)

- **Schema:** `exchange_outages` table (migration 0079) — one row per detected
  outage event (`exchange`, `started_at`, `ended_at`, `affected_symbols`,
  `response_taken`). Active outage = `ended_at IS NULL` (partial index for
  fast lookup).
- **Service:** `exchange-status-service.ts` polls a CME GLOBEX status endpoint
  every 60 s. State machine: probe-OK + no-active → no-op; probe-FAIL +
  no-active → open outage row, notify paper engine, fire critical alert;
  probe-OK + active → close outage row, lift entry block; probe-FAIL +
  active → no-op (already recorded). Fails CLOSED on fetch error.
- **Engine integration:** `paper-execution-service.ts` registers an
  `OutageNotifyFn` callback at module init. On outage start:
  `isExchangeHalted("CME")` gate in `openPosition()` blocks NEW entries; open
  positions are HELD (NOT closed — fills unreliable during halt). On resume:
  block lifted, **NO auto-reissue of queued orders** — manual review required
  (lesson from Nov 28 2025 CME 10-hour halt where auto-reissue caused severe
  slippage).
- **Pipeline pause guard:** intentionally NOT applied — outage detection is
  a SAFETY signal, not a trading signal. Cron continues to run even when
  pipeline is paused.
- **Startup reconciliation:** deferred 3 s after init, re-hydrates active
  outage state from DB so the engine block survives process restart.
- **SSE events:** `exchange:outage-detected`, `exchange:outage-resolved`,
  `paper:order-blocked-outage`.
- **Test/admin hooks:** `simulateOutage()` / `resolveOutage()` for verification
  without touching the real probe.

### Prop Firm Suspension Detection (W15 / C2)

- **Schema:** `prop_firm_health_checks` table (migration 0080) — one row per
  15-min poll of each firm (`firm_id`, `status`, `response_code`,
  `response_body_snippet`, `alert_fired`). Status enum:
  `healthy | degraded | suspended | auth_failure | unreachable | skipped`.
- **Service:** `prop-firm-health-service.ts` probes 8 firm APIs (apex,
  topstep, mffu, tpt, ffn, alpha, tradeify, earn2trade) every 15 min.
  Detection rule: HTTP 401/403/423 OR body keywords
  (`suspended | banned | terminated | closed | inactive | frozen`) →
  classify as `suspended` / `auth_failure`. Network errors → `unreachable`
  (not alerted; transient).
- **Engine integration:** `paper-execution-service.ts` registers a
  `SuspensionNotifyFn` callback at module init. On suspension event,
  `isFirmSuspended(firmId)` gate in `openPosition()` blocks NEW entries for
  the affected firm only (per-firm independence).
- **Evidence layer:** `dashboard-snapshot-service.ts` captures hourly
  Playwright screenshots of each firm's dashboard to
  `data/firm-snapshots/<firmId>/` (30-day retention). Provides timestamped
  evidence for payout disputes (Apex banned profitable traders May 2025;
  MyForexFunds froze funds 2023-2025; "VPN-detected" payout denials
  unresolved 6+ months).
- **Pipeline pause guard:** NOT applied — suspension is a risk event that
  must surface regardless of trading state. Same rationale as C1.
- **Startup reconciliation:** at +4 s, reads latest `prop_firm_health_checks`
  row per firm and re-hydrates `suspendedFirms` Set so the engine block
  survives restart.
- **API key requirements:** firms without configured API keys are skipped
  silently (debug log). Configure via `<FIRM>_API_KEY`,
  `<FIRM>_PROBE_URL` env vars; dashboard cookies via
  `<FIRM>_SESSION_COOKIES`.
- **SSE events:** `prop-firm:suspension-detected`,
  `prop-firm:suspension-cleared`, `prop-firm:snapshot-captured`,
  `paper:order-blocked-suspension`.

### Prompt Injection Defense (W15 / C3)

- **Schema:** `llm_injection_attempts` table (migration 0081) — one row per
  detected injection (`source`, `source_url`, `content_snippet`,
  `injection_type` — comma-separated, `severity`,
  `blocked` boolean default true). 3 indexes: source+time, severity+time
  (filtered to `blocked = false` for high-priority alerts), detected_at.
- **Services:**
  - `llm-input-sanitizer.ts` — 30+ regex patterns covering OWASP LLM01-A
    through LLM01-F (override instructions, role hijacking, system-prompt
    leakage, delimiter tokens, encoded payloads, HTML/script). Returns
    sanitized text + injection-attempt log entry. Persistence is
    fire-and-forget (never blocks pipeline, never throws).
  - `llm-output-validator.ts` — validates LLM response before any DB write
    or compiler call: out-of-band content scan (file paths, tool calls,
    network exec, credential exfil), DSL schema conformance check, Python
    compiler round-trip. Rejects suspicious responses.
  - `llm-sandbox-service.ts` — Python AST pre-scan of LLM-generated strategy
    code via subprocess. Blocks 20+ forbidden modules
    (`os | subprocess | socket | urllib | requests | exec | eval | open`),
    256 KB code size limit, 50 KB stdout cap, 15 s wall-clock timeout,
    stripped env (no API keys, DB URL, credentials).
- **Wiring:**
  - `agent-service.ts` — calls `sanitizeExternalContent()` in `scoutIdeas`,
    `validateRawLLMResponse` + `validateDSLOutput` in `drainScoutedIdeas`,
    `sandboxCheckCode` in `runStrategy`.
  - `search-router.ts` — calls `sanitizeBatch` over all merged search
    results before returning to caller (defense at the scout source layer).
- **Pipeline pause guard:** services themselves are pure utilities — guards
  live at upstream entry points (`agent-service` already has 7
  `isPipelineActive()` gates; route paths covered there).
- **OWASP LLM01 coverage:** verified via 12 attack-scenario tests
  (38 tests total; all pass). Background: hedge fund lost $47M March 2025,
  JPMorgan $12M Aug 2025, OWASP #1 LLM vulnerability 3 years running.

### Network Failover Monitor (W16 / C4)

- **No new migration.** State is in-memory + reflected through `/api/health`
  and SSE events; persistent record of outage events lives in `audit_log`.
- **Service:** `src/server/lib/network-failover.ts` runs an internal state
  machine (`PRIMARY_HEALTHY → DEGRADED → FAILOVER_ALERT → TETHERING_ACTIVE
  → RECOVERED`). Probes broker connectivity (Tradovate API) + DNS fallback
  every 30 s; classifies ISP-side vs broker-side outage; fires CRITICAL
  alert on 3 consecutive failures.
- **Free-tier posture:** $0 added cost. Primary defense is server-side
  order placement (positions held in Railway PostgreSQL survive local
  connectivity loss). Secondary is phone USB tethering (uses existing phone
  plan). Cloud failover (B6) is third layer.
- **Engine integration:** `paper-execution-service.ts` annotates new
  positions with current connectivity state — annotation is informational
  only; never blocks orders, never distorts the promotion gate.
- **Pipeline pause guard:** intentionally NOT applied — connectivity
  monitoring is a SAFETY signal that must run regardless of trading state.
- **Health surface:** `GET /api/health` includes `networkFailover` block
  (state, last probe time, isp/broker classification).
- **Operator runbook:** `infra/network-redundancy.md` covers tethering
  setup, manual phone-based kill switch (call broker to flatten), env vars.
- **Future upgrade path (NOT in plan):** dedicated mobile hotspot ($30/mo)
  if revenue justifies fully-redundant connectivity.

### Bitwarden Credential Vault (W16 / C6)

- **No new migration.** Vault state is external (Bitwarden CLI). Process
  surface is environment-variable mutation at startup + `/api/health`
  reflection (`vault.mode`, `vault.loaded` count — never values).
- **Service:** `src/server/lib/credential-loader.ts` loads secrets from
  Bitwarden CLI at startup. Two modes: `env` (default — no-op passthrough
  for backwards compatibility), `bitwarden` (loads from vault, fails CLOSED
  via `process.exit(1)` if vault unreachable, locked, missing required
  credentials, or `BW_SESSION` absent).
- **Free-tier posture:** $0 added cost. Bitwarden Personal tier permanently
  free; CLI is MIT-licensed. TOTP via Bitwarden built-in or free
  authenticator apps. Hardware key (YubiKey ~$35) is a future upgrade option,
  not required per NIST 800-63B for this threat model.
- **Wiring:** `src/server/index.ts` calls `loadCredentials()` at process
  start (before any service that reads env vars). Each required credential
  is mapped to a Bitwarden Secure Note field via `.env.example`
  annotations.
- **Security contracts:** credential VALUES are never logged. `BW_SESSION`
  is redacted from all error messages. Vault failure in `bitwarden` mode
  exits cleanly — no silent degrade to `.env` fallback.
- **Operator runbook:** `infra/credential-vault-setup.md` covers Bitwarden
  CLI install, vault init, per-secret population, TOTP setup, IP
  whitelisting, GPG-encrypted quarterly backup, 90-day rotation,
  fail-closed troubleshooting.
- **Bootstrap env vars:** `TF_VAULT_MODE` (`env` | `bitwarden`),
  `BW_SESSION`, `TF_VAULT_FOLDER_ID`. Documented in `.env.example`.

### Validation Cadence Forcing Function (W16 / C7)

- **No new migration.** Reads `lifecycle_transitions` and `backtests`;
  writes summary rows to `audit_log` + `alerts` for replayability.
- **Service:** `src/server/services/validation-cadence-service.ts` exposes
  three live metrics — Days Since Last Live Backtest, Strategies Tested
  End-to-End This Month, Reality Check Score (composite 0–100).
  `runMonthlyRealityCheckReport()` compares backtested vs paper performance
  for all PAPER+ strategies, persists an audit row, fires alert at the
  right severity.
- **Routes:** `GET /api/validation-cadence/dashboard`,
  `POST /api/validation-cadence/reality-check`. Routes intentionally
  bypass the pipeline pause gate — operators must see cadence regardless
  of pipeline state, otherwise the panel becomes a vector for the failure
  mode it exists to prevent.
- **Cron:** `validation-cadence-monthly` (1st of month, 3:30 AM UTC).
  Bypasses pause gate (same rationale as routes).
- **Dashboard component:** `Trading_forge_frontend/amber-vision-main/src/components/forge/ValidationCadencePanel.tsx`
  rendered RED when days-idle > threshold, throughput below threshold, or
  composite score < 50. Wired into Dashboard ROW 1.5 (top-of-page
  visibility).
- **Hard rule (in `AGENTS.md`):** no new infrastructure work, refactor, or
  subsystem proposal is approved while the panel is RED. Tunable via
  `VALIDATION_CADENCE_RED_THRESHOLD_DAYS` (default 7) and
  `VALIDATION_CADENCE_MIN_STRATEGIES_PER_MONTH` (default 1). Operators may
  raise the threshold for documented reasons; they may NOT silently
  bypass the panel.
- **Why this is the most important W16 component:** Most common failure
  mode for sophisticated solo operators is building elaborate
  infrastructure for months and never validating live. The dashboard panel
  + AGENTS.md rule together make that failure mode visible and unavoidable.

### Windows Update Reboot Protection (W17 / C8)

- **No new migration.** State surfaces through the
  `pre-trading-day-health-check` scheduler job, `pipeline-control-service`
  PAUSED mode (when a check fails), `notifyCritical` alerts, and the
  `windows:health-check-failed` SSE event.
- **PowerShell script:** `scripts/pre-trading-day-health-check.ps1` runs
  five checks: (1) pending Windows reboot via 4 registry signals + CCM,
  (2) failed updates via `WindowsUpdateClient` event log IDs 20/25 in last
  24h, (3) Node + Python process liveness, (4) `>= 10GB` free on `C:`,
  (5) RAM utilization `< 80%`. Exit codes: `0` healthy, `1` pending reboot,
  `2` failed updates, `3` degraded, `99` script error. Emits structured
  JSON to stdout for the Node cron to parse.
- **Service:** `src/server/services/windows-health-check-service.ts`
  spawns the script with `-NonInteractive -ExecutionPolicy Bypass`,
  parses JSON, classifies the exit code, and on any non-zero result calls
  `setMode("PAUSED", reason)` via pipeline-control-service (fail-CLOSED) +
  `notifyCritical` + `broadcastSSE`. Spawn-level errors and `setMode`
  failures also fail closed. Non-Windows hosts return healthy (no-op).
- **Cron:** `pre-trading-day-health-check` registered in
  `src/server/scheduler.ts`. Cron schedule `0 12,13 * * 1-5` covers EDT
  (UTC-4) and EST (UTC-5); ET-hour filter pins to 8:00 AM ET. Runs ahead
  of the 9:30 ET cash open with margin to manually intervene.
  **Intentionally NOT pipelineGated** — the cron must run regardless of
  pause state so the operator can observe successful runs in the
  job-health dashboard after a self-imposed pause. Same pattern as C1
  (CME outage) and C2 (prop firm health) — safety signals run while
  trading does not.
- **Pause is sticky.** A healthy follow-up run does NOT auto-resume the
  pipeline. The operator must explicitly resume via the dashboard after
  reviewing the runbook (`infra/windows-update-policy.md`).
- **Bypass:** `BYPASS_PRE_MARKET_HEALTH_CHECK=true` env var skips the
  check (testing only — never set in production).
- **Operator runbook:** `infra/windows-update-policy.md` covers Group
  Policy disabling automatic restart, full-week active hours, weekend-only
  manual update window, and the automated 8:00 AM ET forcing function.
- **Free-tier posture:** $0 added cost. Pure PowerShell + TypeScript +
  built-in registry/event-log/CIM probes. No third-party agents.
- **Why:** April 2026 KB5082063 (and the same April pattern in 2024 and
  2025) triggered forced reboots that would kill open futures positions
  during cash session. This is a forcing function so a queued reboot
  cannot ambush the trader.

### LLM Mode Collapse / DSL Diversity Check (W17 / C9)

- **Schema:** `strategy_dsl_features` table (migration 0082) — one row per
  accepted strategy: `feature_vector_compressed` (gzip of float32[]),
  `feature_dim`, `dsl_fingerprint` (sha256 of canonical DSL JSON),
  `created_at`. `UNIQUE(strategy_id)` enforces one vector per strategy.
  Indexes: `idx_dsl_features_created` (recency scan),
  `idx_dsl_features_fingerprint` (exact-match fast path),
  `idx_dsl_features_strategy` (UNIQUE upsert).
- **Service:** `src/server/services/dsl-diversity-service.ts` extracts a
  13-dimension float32 feature vector from DSL fields (entry indicator,
  exit type, direction, symbol, timeframe, regime, SL/TP ATR multiples,
  up to 5 entry-param values, padded), gzip-compresses (same pattern as
  A7 signal-correlation-service), and gates new candidates by cosine
  similarity. Threshold: `STRATEGY_DSL_SIMILARITY_THRESHOLD` (default
  `0.85`). Lookback: `STRATEGY_DSL_LOOKBACK` (default 50, max 200).
  Exact-fingerprint match short-circuits to immediate reject.
- **Wiring:**
  - `agent-service.ts` `runStrategyFromDSL()` — HARD GATE for
    `source === "ollama" | "openclaw"`, runs AFTER graveyard gate, BEFORE
    strategy DB insert. Rejection writes a candidate-contract audit_log
    row (`acceptance_rejection_result: "rejected"`, `expected_uplift: 0`,
    `replay_priority: 0`). Status: `"blocked_dsl_diversity"`.
  - `agent-service.ts` `runStrategyFromDSL()` (post-insert) —
    `persistDslFeatureVector()` fire-and-forget after strategy DB insert
    so the feature table only contains accepted candidates.
  - `strategy-prevalidator.ts` — ADVISORY only. Surfaces
    `dslDiversity: { passed, maxSimilarity, mostSimilarStrategyId, ... }`
    in `PrevalidationResult.checks`. Reasons array gets a
    `dsl-diversity-advisory:` warning if the score exceeds the threshold,
    but `passed=false` is NOT flipped from this layer (hard gate is in
    agent-service).
- **Pipeline pause guard:** `checkDslDiversity()` returns `passed:true`
  (pass-through) when `isPipelineActive() === false` so the gate cannot
  silently drop candidates while the operator pauses for unrelated
  reasons. Fail-open on DB error too — never blocks the main flow.
- **Defense-in-depth with A7 (W11):** A7 (`signal-correlation-service.ts`)
  catches POST-backtest signal duplication (different code that produces
  identical signals — Two Sigma failure mode). C9 catches PRE-backtest
  DSL template repetition (LLM mode-collapse: same template, new name)
  before backtest compute is spent. Different stages, different failure
  modes, intentional defense-in-depth — NOT duplication.
- **Free-tier posture:** $0 added cost. Pure TypeScript + SQL + Node
  built-in `zlib` for compression. No external embedding service, no
  paid similarity API.
- **Verification gate (confirmed 2026-05-03):** identical DSL → rejected
  (similarity > 0.85); two genuinely different DSLs → accepted. 31 tests
  cover feature extraction, fingerprinting, compression round-trip,
  cosine math, pipeline-pause pass-through, fail-open on DB error, and
  audit-log shape compliance with the candidate contract.
- **Why:** "I asked an LLM to generate 20 strategies. 14 were the same
  thing." StockBench 2025 documented LLM agents failing to outperform
  passive benchmarks without explicit diversity enforcement. Without
  this gate, mode-collapsed strategies waste backtest compute and create
  false portfolio diversity at the lifecycle layer.

### Information Ratio (W18 / A13)

- **Schema:** `information_ratio` numeric column on `backtests` table
  (migration 0083). Null when benchmark unavailable or fewer than 2 bars.
  Pre-A13 backtests are not retroactively populated.
- **Module:** `src/engine/risk_metrics.py:compute_information_ratio()`
  computes `IR = E[R_p - R_b] / σ_diff * sqrt(252)`. Benchmark series:
  SPX close-to-close for ES/NQ/MES/MNQ; crude price for MCL. When
  benchmark series is all-zeros, IR degenerates to standard Sharpe
  (intended property — verified in `test_information_ratio.py`).
- **Wiring:** `src/engine/backtester.py` loads benchmark series aligned to
  strategy trading dates and computes IR after backtest completes
  (lines 1864-1914 strategy path, 3241-3273 class-based path). Result
  rounded to 4dp and persisted via `backtests.information_ratio`.
- **Authority:** OBSERVATION ONLY — additive metric for ranking and
  research. Does NOT gate any lifecycle decision.
- **Tests:** 12 tests in `src/engine/tests/test_information_ratio.py`
  (formula correctness, degenerate inputs, length mismatch alignment,
  benchmark-zero → Sharpe equivalence property, NaN handling).
- **Why:** Per Bailey-López-de-Prado, Sharpe alone over-rewards passive
  beta; IR isolates true alpha vs the relevant benchmark. Critical for
  ranking ES/NQ strategies that may simply ride SPX drift rather than
  generate active edge.

### Macro Regime Overlay (W18 / C11)

- **Schema:** Two tables (migration 0084):
  - `macro_features` — every macro observation with look-ahead-safe
    `publication_timestamp` (when FRED/BLS/Treasury actually published it,
    NOT `series_date` the value applies to). Backtests must filter on
    `publication_timestamp <= simulated_now`. UNIQUE on
    `(series_id, series_date, revision_number)` so revisions are tracked.
  - `macro_regime_states` — daily HMM classification output. Columns:
    `prob_growth | prob_inflation | prob_crisis | prob_easing` (sum to 1.0),
    `dominant_state`, `crisis_gate_triggered` (boolean,
    `prob_crisis > 0.60`), `fomc_day_proximity` (signed int days),
    `macro_release_day` (boolean). UNIQUE on `state_date`.
- **Series ingested (10 total):** T10Y2Y_vol, DFF_change, USEPUINDXD,
  VIXCLS, RRPONTSYD, WTREGEN, ISM_PMI, DTWEXBGS, TAIL_BPS, INDIRECT.
  Sources: FRED daily (4 PM ET), H.4.1 weekly (Thu 4:30 PM ET), BLS
  release-day, TreasuryDirect auctions.
- **Classifier:** `src/engine/macro_regime_classifier.py` — 4-state
  Gaussian HMM (`hmmlearn`, `n_iter=200`, `random_state=42`,
  `covariance_type="diag"`). Backward-only rolling features (no centred
  windows). States: 0=Growth, 1=Inflation, 2=Crisis, 3=Easing. Validated
  against known regime labels (Mar 2020 Crisis, 2022 Inflation, late 2024
  Easing).
- **Fusion:** `src/engine/macro_regime_fusion.py` — combines HMM macro
  probs with DeepAR microstructure regimes. **Hard cap
  `MACRO_WEIGHT_CAP = 0.30`** (DeepAR drives ≥70% of fused signal). Dec
  2025 lesson: strategies weighting macro >40% got whipsawed because
  macro lags intraday by 5-7 days. Macro is a FILTER, not a predictor.
- **Hard gates** (`src/server/services/macro-gate-service.ts`):
  1. `prob_crisis > 0.60` → block new ES/NQ/MES/MNQ longs > 2hr horizon
  2. `ISM < 49 AND RRP < $20B` → block new ES/NQ longs (Dec 2025 trigger)
  3. FOMC day ±1 → 50% position size reduction (NOT a block)
  4. Macro release day → block new entries (1hr before to 3hr after)
- **Engine integration:**
  - `paper-signal-service.ts` calls `evaluateMacroGates()` BEFORE the
    risk gate on every entry signal. Fail-OPEN: missing macro data /
    classifier failure proceeds without blocking. Blocked signals are
    persisted to `paper_signal_logs` with
    `signalType="macro_gate_blocked"`.
  - `sizing.py:compute_position_sizes()` accepts `fomc_proximity: int |
    None`. When `abs(fomc_proximity) <= 1`, all sizes halved (floor,
    minimum 1). Applied AFTER all other sizing modulations.
- **Crons** (4 new, all `pipelineGate()` early-exit):
  - `c11-fred-daily` — 4 PM ET weekdays — pulls 10 series, runs HMM
    classifier, persists `macro_regime_states` row
  - `c11-h41-weekly` — Thu 4:30 PM ET — H.4.1 RRPONTSYD + WTREGEN
  - `c11-bls-release` — daily release check — CPI/NFP/PPI when published
  - `c11-treasury-auctions` — daily — TreasuryDirect tail/indirect bps
- **Pipeline pause posture:** Ingestion crons HONOUR pipeline pause
  (data freshness is research, not safety). Macro gate evaluation in
  `paper-signal-service.ts` runs whenever signals are generated — but the
  signal-generation path is itself pipeline-gated upstream, so the gate
  effectively pauses with the pipeline.
- **Look-ahead bias prevention:** `publication_timestamp` is the barrier
  for backtest filters — never `series_date`. Indexes on both columns.
  Verified in `test_macro.py` (32 tests).
- **Tests:** 61 total — 29 in `test_c11_macro_regime.py` (HMM,
  fusion, hard gates, fallback) + 32 in `test_macro.py` (ingestion
  schema, look-ahead safety, revision handling, combined-stress
  detection). Includes Dec 2025 regression test
  (`TestDec2025Regression::test_nov28_2025_es_long_block`) confirming
  ISM<49 + RRP<$20B + crisis_prob=0.68 would have correctly blocked ES
  longs on Nov 28 2025.
- **Free-tier posture:** $0 added cost. fredapi (MIT), hmmlearn (BSD),
  TreasuryDirect public XML, BLS public API. No paid macro feed.
- **Authority:** Hard gates BLOCK new entries (per-instrument). Existing
  positions are HELD (NOT auto-closed) — same posture as C1 CME outage.
  Sizing modulation modifies size only, never blocks.
- **Why:** Per Goldman Sachs / Marcos López de Prado regime literature,
  most "alpha" failures during regime rotations come from strategies
  blind to the underlying macro state. C11 adds a regime-aware filter
  without polluting the microstructure-driven trade signal. Dec 2025
  Powell-pivot whipsaw + Nov 28 ISM-RRP-crisis combo are the canonical
  cases this gate exists to catch.

## 47-Day Blueprint Status: COMPLETE (W9-W18)

The 47-day production-hardening blueprint shipped from W9 (2026-04-22) through
W18 (2026-04-30). All 10 waves complete. The end-to-end pipeline is now:

1. **Generation** — LLM scout → C9 DSL diversity check → C3 prompt-injection
   defense → DSL compiler → CANDIDATE
2. **Validation** — backtest with A1 determinism + A2 provenance + A13 IR +
   B10 MRP → walk-forward → MC → quantum (W1-W6 prior) → A4 Frankenstein
   gate → TESTING
3. **Paper** — TESTING→PAPER through Frankenstein hard gate, classical MC,
   Grover stress
4. **Promotion** — PAPER→DEPLOY_READY through A7 signal-correlation gate
   (cosine vs DEPLOYED) + B5 multi-firm eligibility (8 firms, fire-and-forget
   AFTER promotion) + B10 MRP soft gate
5. **Canary** — DEPLOY_READY→PILOT (B8/B8b: 5 sessions, 1 contract clamp,
   automatic post-promotion to DEPLOYED on rolling Sharpe ≥ 1.0)
6. **Live** — DEPLOYED with C1 CME outage detection + C2 prop firm health +
   C4 network failover + C8 Windows update protection + C11 macro hard gates
7. **Decline** — DEPLOYED→DECLINING (rolling Sharpe < 1.0) → B4 regen
   auto-trigger → new CANDIDATE (closed loop)

Background continuous loops:
- A6 Hypothesis property tests (CI on every PR)
- A8 data integrity service (nightly reconciliation + drift detection)
- A9 snapshot CI (3-tier regression)
- A11 shadow re-run (PAPER+ strategies)
- A12 audit (12-category code audit)
- B12 closed feedback loops (paper outcome → strategy memory)
- C6 Bitwarden vault (credential rotation)
- C7 validation cadence forcing function (RED dashboard panel + AGENTS.md
  rule blocks new infra work when validation lapses)

Migrations 0070-0084 applied. System map drift cleared. Production hardening
phase is the steady-state going forward.

## Tech Stack
- **API Server**: Express.js 5 + TypeScript (src/server/)
- **Database**: PostgreSQL + Drizzle ORM
- **Backtest Engine**: Python + vectorbt + Polars + DuckDB (src/engine/)
- **AI Agents**: TypeScript + Ollama (src/server/services/agent-service.ts, src/server/routes/agent.ts)
- **AI Models**: Ollama (qwen3-coder:30b, deepseek-r1:14b, nomic-embed-text) + GPT-5-mini (cloud)
- **DeepAR**: GluonTS PyTorch (regime forecasting, local)
- **Cloud Quantum**: IBM Quantum Platform + AWS Braket (autonomous pre-deploy validation with automatic classical fallback)
- **Dashboard**: React + Vite + TailwindCSS (src/dashboard/)
- **Data Lake**: AWS S3 (Parquet files)
- **Data Providers**:
  - **Databento** -- Institutional-grade historical tick/futures data ($125 credits)
  - **Massive** -- Free real-time WebSocket streaming (currencies, indices, options, stocks)
  - **Alpha Vantage** -- 60+ technical indicators, news/sentiment API, MCP support
- **Orchestration**: n8n (external, local, Docker Compose in `docker-compose.local-ai.yml`)
- **n8n automation rule**: Current Trading Forge workflows in live n8n are part
  of the autonomous system surface and must be reflected in the system map.
  Do not classify them as external/non-core. Exclude archived Trading Forge
  workflows from the active workflow inventory.
- **Strategy Scout**: OpenClaw + Ollama (autonomous research -- Brave Search, Reddit MCP, Tavily, YouTube MCP, Academic MCP)
- **AI Lab**: Ollama + n8n + OpenClaw + Trading Forge loop (see System Map section 2-3)
  - Custom Modelfile: `ollama/Modelfile.trading-quant` (Qwen2.5-Coder:14b tuned for vectorbt)
  - Critic model: deepseek-r1:14b (fast analysis loop), GPT-5-mini (depth critique)
  - Webhooks: `/api/agent/run-strategy`, `/api/agent/critique`, `/api/agent/batch`, `/api/agent/scout-ideas`

## Commands
- `npm run dev` -- Start Express server with hot reload
- `npm run db:generate` -- Generate Drizzle migrations
- `npm run db:migrate` -- Run Drizzle migrations (0027+ for DeepAR + cloud)
- `npm run db:studio` -- Open Drizzle Studio
- `npm test` -- Run vitest
- `npm run lint` -- ESLint

## Code Conventions
- TypeScript strict mode, ES modules
- Use Drizzle query builder, not raw SQL
- All API routes return JSON
- Auth: simple Bearer token (API_KEY env var), skip in dev
- Logging: pino (structured JSON in prod, pretty in dev)
- Python: type hints, pydantic for configs

## Project Structure
```
src/
+-- server/           # Express API
|   +-- index.ts      # Entry point
|   +-- routes/       # Route handlers (one file per domain)
|   +-- db/           # Drizzle schema + migrations
|   +-- services/     # Business logic
|   +-- middleware/    # Auth, logging, etc.
|   +-- scheduler.ts  # Cron jobs (lifecycle, decay, DeepAR, pre-market)
+-- engine/           # Python backtest + Monte Carlo + DeepAR + quantum
+-- data/             # Data pipeline scripts
+-- agents/           # AI research agents + prompt files
+-- dashboard/        # React frontend
models/               # Trained ML models (DeepAR, gitignored)
```

## DeepAR Regime Forecaster
- **Engine:** GluonTS DeepAR (PyTorch, local, $0/month)
- **Files:** `src/engine/deepar_forecaster.py`, `deepar_regime_classifier.py`
- **Service:** `src/server/services/deepar-service.ts`
- **Routes:** `/api/deepar/*` (forecast, accuracy, train, predict)
- **Schedule:** Train 2:30 AM ET, Predict 6:00 AM ET, Validate 6:30 AM ET
- **Governance:** `challenger_only` -- weight starts 0.0, auto-graduates
- **Graduation:** Shadow (60d) -> Challenger 0.05 -> Validated 0.10
- **Demotion:** hit_rate < 0.50 for 30d -> weight 0.0
- **Feeds into:** Bias engine, skip engine (#11), structural targets, critic optimizer
- Agents MUST treat DeepAR output as experimental until weight > 0

## Cloud Quantum Integration
- **IBM Quantum:** 4 backends (133-156 qubits), free tier (10 min/month QPU)
- **AWS Braket:** IonQ Forte 1 QPU, SV1/TN1/dm1 simulators, $30/month cap
- **Abstraction:** `src/engine/cloud_backend.py` (budget tracker, fallback chain)
- **Two-gate safety:** `QUANTUM_CLOUD_ENABLED=true` in env AND `opt_in_cloud=true` per request
- **Budget:** Hard-stops prevent overspend (IBM 600s, Braket $30)
- **Governance:** Cloud doesn't change authority -- all quantum remains `challenger_only`
- Auto-triggered backtest quantum runs stay LOCAL. Cloud is opt-in only.

## DSL Archetype Fixtures (W5a / Tier 5.5)

Three human-authored strategy archetypes expressed as JSON config consumed by the existing
DSL compiler. Located at `src/engine/strategies/dsl_fixtures/`. These are config-as-data,
not Python modules.

> **W13 B3 update:** 4 additional regime-coverage archetypes (range_fade_mnq,
> opening_range_breakout_mes, news_fade_mcl, overnight_drift_mes) extend the
> fixture set to 7 total. See "DSL Archetype Coverage (W13 / B3)" below for the
> regime mapping and Frankenstein modes.

### DSL Fixture Pattern
- Fixtures must conform exactly to `StrategyDSL` (Pydantic, `extra="forbid"`)
- Valid fields: `name`, `symbol`, `timeframe`, `direction`, `entry_type`, `entry_indicator`,
  `entry_params`, `entry_condition`, `exit_type`, `exit_params`, `stop_loss_atr_multiple`,
  `take_profit_atr_multiple`, `max_contracts`, `preferred_regime`, `session_filter`,
  `chart_construction`, `source`, `tags`, `schema_version`, `description`,
  `profit_scaling_tier`, `daily_target_dollars`
- `profit_scaling_tier` -- W5a Team A sizing integration, **wired** as
  `Optional[ProfitScalingTier]` in `strategy_schema.py`. Fixtures emit
  `{"increment": 2, "threshold": 3000}`; `account_pnl_total` is injected at
  backtest-run time, never in the fixture. The legacy
  `profit_scaling_tier_pending` placeholder tag has been retired.
- `daily_target_dollars` -- archetype-level daily P&L target (informational),
  optional Optional[float] >= 0. Currently consumed by paper automation
  telemetry only (no gate logic).
- `hard_sl_points` / `trail_config` / `contracts` are not first-class DSL
  fields -- use `stop_loss_atr_multiple`, `exit_params`, and `max_contracts`
  as the schema equivalents. Trail-stop W5b extensions (`break_even_at_r`,
  `time_decay_minutes`, `time_decay_multiplier`) belong inside `exit_params`
  and are translated through to `paper-signal-service.ts:TrailStopConfig`
  by `dsl-translator.ts`.

### Archetype Descriptions

**scalper_mes.json** -- Fast scalp, MES, 5m, both directions
- Target regime: `RANGE_BOUND` (choppy, intraday oscillation)
- Entry: `atr_breakout` (period=14, multiplier=1.5)
- Exit: `atr_multiple` (1.8x), tight stop at 1.2x ATR
- Max contracts: 5 | RTH only

**trend_mnq.json** -- Trend-follow workhorse, MNQ, 15m, both directions
- Target regime: `TRENDING` (directional momentum)
- Entry: `ema_crossover` (fast=9, slow=21, confirmation=2 bars)
- Exit: `trailing_stop` (2.0x ATR trail, break-even at 1:1R, 20-min time-decay to 0.75x)
- Max contracts: 10 | RTH only
- Gemini blueprint "outside predatory hunt zone" stop (1.8x ATR), 10-contract size per blueprint

**heavy_mcl.json** -- Heavier trend-follow, MCL crude oil, 15m, both directions
- Target regime: `TRENDING` (directional with expansion)
- Entry: `keltner_squeeze` (bb_period=20, kc_period=20, kc_multiplier=1.5)
- Exit: `trailing_stop` (2.5x ATR trail -- wider for oil session noise)
- Max contracts: 8 | RTH only
- Wider trail (2.5x) per Gemini ATR analysis for crude oil intraday noise

### Market Correlation Note
MES (S&P micro), MNQ (Nasdaq micro), MCL (crude oil micro) chosen for correlation < 0.3
on daily returns (equity vs energy). Aggregate max_contracts: 5+10+8 = 23, within 50K
account composite ceiling. Safe to deploy all three simultaneously.

### Schema Extension (SHIPPED — Cleanup Team D)
`ProfitScalingTier` and `daily_target_dollars` are now first-class fields on
`StrategyDSL`. See `src/engine/compiler/strategy_schema.py`. Field name
`profit_scaling_tier` matches Team A's `compute_position_sizes()` parameter.
`account_pnl_total` is intentionally NOT a fixture field — it is injected at
backtest-run time from live single-account PnL.

## Gemini Quantum Blueprint Feature Flags (W1 / Tier 0.3)
All flags default OFF (shadow). They control phased rollout of quantum
modules built in W2-W4. Kill switch: `unset $VAR && systemctl restart`.

- **`QUANTUM_QAE_GATE_PHASE`** -- 0/1/2 (default 0). Phase 0 = shadow (read both
  classical + quantum, log agreement, gate is 100% classical). Phase 1 =
  advisory disagreement alerts. Phase 2 = quantum participates in the gate.
  Wave 7 graduation flips the value after 30+ days of agreement data.
- **`QUANTUM_ENTROPY_FILTER_ENABLED`** -- default false. Enables Tier 3.1 QCNN
  noise score in skip engine. When false, `noise_score` is None and skip
  engine ignores the slot. **SHIPPED W3a.** Module: `src/engine/quantum_entropy_filter.py`.
  Architecture: 8-qubit QCNN (2 conv layers + 1 pooling layer, 37 gate ops).
  Output: `noise_score ∈ [0,1]`. Integrated into `premarket_analyzer.py` —
  adds `quantum_noise_score` to signals dict when flag is true.
  PennyLane 0.44.1 required; classical fallback returns None (skip engine
  continues with score 0.0 via `_score_quantum_entropy`).
  Performance: ~6ms wall-clock on CPU (default.qubit).
  **Cost telemetry (W3a deferred, SHIPPED):** Each `collect_quantum_noise()` call
  POSTs to `POST /api/quantum/cost` (1s timeout, fire-and-forget, never raises).
  This writes a `quantum_run_costs` row with `moduleName="entropy_filter"`, enabling
  Tier 7 graduation queries. Route: `src/server/routes/quantum-cost.ts`.
  The `requests` import is lazy (inside the helper) to preserve module isolation.
  W3b dependency: A+ Market Auditor reads `skip_decisions.signals.quantum_noise_score`
  per market per day — **WIRED (W3b deferred, SHIPPED):** `enrichWithPerMarketNoise()`
  in `a-plus-auditor-service.ts` queries `skip_decisions JOIN strategies WHERE symbol=?
  AND created_at > NOW()-6h` before each Python auditor call. Caller-provided
  `noise_score` is preserved (no DB query). Falls back to null per market on DB error.

  **Tier 3.1 Threshold Calibration Plan:**
  Placeholder threshold: `QUANTUM_NOISE_THRESHOLD = 0.5` (in `quantum_entropy_filter.py`).
  TODO (calibrate after 30 days of skip_decisions data):
    1. Query `skip_decisions.signals` for rows where `quantum_noise_score IS NOT NULL`.
    2. Label each row as "wick-out day" (price spiked + reversed within 1 ATR that session)
       by joining against intraday Parquet from S3.
    3. Build precision/recall curve over threshold range [0.3, 0.7] in 0.05 steps.
    4. Pick threshold that maximizes precision at >= 80% recall.
    5. Update `QUANTUM_NOISE_THRESHOLD` in `quantum_entropy_filter.py` and rerun
       `src/engine/tests/test_quantum_entropy_filter.py` to confirm no regressions.
    6. Also refit `_FEATURE_STATS` normalization means/stds using the 30-day sample.
  Target calibration date: ~2026-06-01 (30 days after entropy filter goes live).
- **`QUANTUM_COUNTERFACTUAL_ENABLED`** -- default false. Tier 3.2 deferred per
  architect review; flag reserved for future revival.
- **`QUANTUM_GRAVEYARD_QUBO_ENABLED`** -- default false. Enables Tier 2 SQA
  graveyard-aware penalty in `quantum_annealing_optimizer.build_parameter_qubo()`.
- **`QUANTUM_AMARKET_AUDITOR_ENABLED`** -- default false. Enables Tier 3.3
  A+ Market Auditor cron + cross-market lead-lag entanglement.
  **SHIPPED W3b.** Module: `src/engine/a_plus_market_auditor.py`.
  Service: `src/server/services/a-plus-auditor-service.ts`.
  Route: `POST /api/auditor/scan`, `GET /api/auditor/latest`.
  Schedule: 8:00 AM ET daily (Mon-Fri), cron job `a-plus-auditor-scan`.
  DB table: `a_plus_market_scans` (migration 0067). Pending-row contract.
  Cost telemetry: `quantum_run_costs` with `moduleName="a_plus_auditor"`.
  Architecture:
    - Per-market: volatility audit (ATR ratio) + P(hit 1:2 reward) + noise score (W3a)
    - Cross-market: 4-qubit VQC {MES=q0, MNQ=q1, MCL=q2, DXY=q3}
      Encoding: 60-min rolling correlation matrix → RY + CNOT fan-out
      CNOT topology: MES→MNQ (equity lead-lag), MNQ→DXY (tech-dollar), MES→MCL (risk)
      Readout: PauliZ on each qubit → lead_market (highest Z), entanglement_strength
    - Edge Score: 0.40*vol + 0.40*p_target + 0.10*(1-noise) + 0.10*entanglement
    - Winner: highest edge_score AND p_target_hit > 0.75 AND noise_score < 0.50
    - OBSERVATION_MODE: no winner → skip all strategies for the day
    - Lead-lag bonus: if winner is lagging market AND entanglement_strength > 0.70,
      publish lead_market field; strategies opt-in via DSL `require_lead_market_confirmation`
  Fallbacks: PennyLane unavailable → entanglement falls back to classical correlation
    proxy; noise unavailable → neutral 0.5; edge score always computes.
  Performance: full 3-market scan ~8-15ms wall-clock on CPU (default.qubit).
  **PROP FIRM COMPLIANCE HANDOFF (CLOSED — W5b Tier 5.3.1 SHIPPED):**
    Tier 3.3 produces the SIGNAL only. Cross-market lead-lag signal source ≠ traded
    instrument. Prop firms BAN simultaneous correlated positions (MNQ + MES together
    = position-limit-bypass violation). Enforcement is now LIVE in:
    - `src/engine/compliance/compliance_gate.py:check_correlated_position_guard()` (Python)
    - `src/server/services/correlated-position-guard.ts:checkCorrelatedPositionGuard()` (TS)
    - `src/engine/compliance/correlation_matrix.yaml` — threshold 0.70, pairs MES/MNQ/MCL/etc.
    paper-signal-service.ts queries ALL open positions cross-session and calls the TS guard
    BEFORE anti-setup gate on every new entry signal. Blocked signals are logged to
    paper_signal_logs with signalType="correlated_position_blocked".
    Sequential rule: lead-market position must be CLOSED before lagging-market entry fires.
    The `complianceHandoff` key in POST /api/auditor/scan response surfaces this note.
    Tests: 20 TS + 19 Python covering symmetry, sequential close, empty positions, unknown pairs.
  SSE event: `a-plus-auditor:scan-complete` on every completed scan.
- **`QUANTUM_ADVERSARIAL_STRESS_ENABLED`** -- default false. Enables Tier 3.4
  Grover worst-case sequencer pre-PAPER promotion check. **SHIPPED W3b.**
  Module: `src/engine/quantum_adversarial_stress.py`.
  Algorithm: Grover search over N trade orderings (N qubits, 8-15 max).
  Oracle: marks orderings where any rolling loss window exceeds daily_loss_limit.
  Outputs: `worst_case_breach_prob ∈ [0,1]`, `breach_minimal_n_trades`,
  `worst_sequence_examples` (top-K breach orderings).
  Classical fallback: N <= 12 -> brute-force 2^N; N > 12 -> 10K random samples.
  PennyLane 0.44.1 required; falls back to classical on import failure.
  Cost ceiling: 30s hard wall-clock abort (ThreadPoolExecutor TimeoutError).
  Scope: TIER_1 and TIER_2 strategies only (TIER_3 skipped — too noisy).
  Table: `adversarial_stress_runs` (migration 0066).
  Service: `src/server/services/adversarial-stress-service.ts`.
  Route: POST /api/adversarial-stress/run (pipeline pause guard: 423 when paused).
  Lifecycle: TESTING->PAPER gate reads adversarial stress evidence (Phase 0 shadow).

  **Phase 0 (W3b, current):** Shadow only. Runs and persists results.
  Lifecycle gate is 100% classical. Phase 1 block rule is evaluated and logged
  but NEVER enforced. Disagreement always logged at WARN level.

  **Phase 1 decision rule (W7b Day 52 — NOT NOW):**
  If `worst_case_breach_prob > 0.5` AND `breach_minimal_n_trades < 4` ->
  BLOCK TESTING->PAPER promotion. Meaning: strategy can be killed by 3 losses
  in a row -> prop firm `maximum_consecutive_losers: 4` gate fires.
  Graduation from Phase 0 -> Phase 1 requires 30+ days of shadow data and
  explicit W7b graduation review.

  **W7b Grover graduation (Day 52, not Day 30):**
  Day 52 (not Day 30 like QAE) because adversarial stress runs are more expensive
  and the graduation evidence window must cover a full month of TESTING->PAPER
  transitions. Canonical query and decision rule:
  see "Tier 7 W7b Graduation Query Pattern" section below.

  **Worst-case vs average-case distinction:**
  QAE (Tier 1.1) answers average-case breach probability. Adversarial stress
  (Tier 3.4) answers worst-case: can an adversary with full ordering knowledge
  engineer a breach? A strategy passing both is robust to both market noise
  AND trade-sequence luck. Strategies that only pass QAE may still be vulnerable
  to the prop firm failure mode of 5 losers in a row in the worst order.
- **`QUANTUM_CUQUANTUM_GPU_ENABLED`** -- default false. Enables Tier 4 cuQuantum
  GPU acceleration. **SHIPPED W4.** Default OFF — no behavior change unless
  explicitly enabled. When true, modules use `select_quantum_device()` to
  probe VRAM before selecting `lightning.gpu`; CPU fallback is mandatory and
  automatic when VRAM is insufficient or the GPU is unavailable.

  **Modules:**
  - `src/engine/quantum_device_selector.py` — `select_quantum_device(n_qubits, prefer_gpu=True) -> str`
    Returns `"lightning.gpu"` or `"default.qubit"`. Advisory only. No execution authority.
  - `src/engine/hardware_profile.py` — `probe_vram(required_mb) -> bool`
    Probes GPU 0 via pynvml (primary) or nvidia-smi (fallback). Never raises.

  **VRAM formula (per plan):** `required_mb = int(2 ** (n_qubits - 3) + 200)`
  Safety margin of +500 MB is applied inside `probe_vram`, not by callers.

  **RTX 5060 cap:** n_qubits > 25 always falls back to CPU. State-vector for
  25+ qubits requires ~4 GB+ and would OOM the 5060's 8 GB frame buffer.

  **Fallback chain (in order):**
  1. `prefer_gpu=False` → `"default.qubit"`
  2. `QUANTUM_CUQUANTUM_GPU_ENABLED != true` → `"default.qubit"`
  3. `n_qubits > 25` → `"default.qubit"` + WARNING log
  4. `probe_vram(required_mb)` returns False → `"default.qubit"`
  5. All checks pass → `"lightning.gpu"`

  **Wired modules (W4):**
  - `quantum_entropy_filter.py` (8 qubits) — replaces W3a CPU-only stub
  - `quantum_adversarial_stress.py` (8-15 qubits) — replaces raw try/except
  - `a_plus_market_auditor.py` (4 qubits VQC) — replaces hardcoded "default.qubit"
  - `quantum_mc.py` (AerSampler) — GPU backend_options when probe passes

  **Performance (env flag false):** output IDENTICAL to pre-W4. No behavior
  change when flag is off — all quantum module outputs are deterministic and
  reproducible on CPU as before.

  **Tests:**
  - `src/engine/tests/test_quantum_device_selector.py` — 26 tests (isolation,
    schema, GPU path, qubit cap, prefer_gpu override, VRAM fallback)
  - `src/engine/tests/test_hardware_profile.py` — 18 tests (probe_vram coverage)

- **`QUANTUM_CLOUD_ENABLED`** -- default false. Master gate for all IBM QPU submissions.
  Must be set to `"true"` to enable Tier 4.5 cloud_qmc enrichment. Without this flag,
  all cloud submissions are silently skipped and lifecycle promotion is unaffected.
  **SHIPPED W4 (Tier 4.5).** Kill switch: `unset QUANTUM_CLOUD_ENABLED && restart`.

## IBM Quantum Cloud Integration (Tier 4.5 W4 — Ising Decoder)
**Shadow-only. Never blocks promotion. Challenger evidence only.**

Architecture:
  - Strategy passes classical TESTING→PAPER gate → Lifecycle promotes to PAPER IMMEDIATELY
  - AFTER promotion commits, async fire-and-forget: `enqueueCloudQmcRun()` writes
    a `cloud_qmc_runs` row (status="queued") and submits to IBM Heron QPU
  - Async cloud worker polls IBM job status every 5 min via `cloud-qmc-poll` cron
  - On completion: Ising decoder decodes syndromes → persists to cloud_qmc_runs
  - Tier 7 measurement loop reads cloud_qmc_runs over 90 days to evaluate predictive value

**IBM Backend credentials (required to enable):**
```bash
export IBM_QUANTUM_TOKEN=<your-token>       # From https://quantum.ibm.com/account
export QUANTUM_CLOUD_ENABLED=true           # Master gate — both must be set
```
Without these, all cloud submissions are skipped and promotion is unaffected.

**Budget allocation:**
- 600s/month total IBM QPU budget — ALL reserved for Ising-encoded IAE runs
- Pessimism factor 2x: each 60s estimated run consumes 120s of budget capacity
- Allows ~5 runs/month before budget_exhausted
- `GET /api/cloud-qmc/budget` — check remaining budget

**IBM backends (156-qubit Heron R2):**
- ibm_fez (primary), ibm_kingston (fallback), ibm_marrakesh (fallback)
- Backend rotation: fez → kingston → marrakesh on errors
- 5-minute hard cap per job (prevents stuck queue from consuming budget)

**Surface code:**
- d=3 rotated surface code: 9 data + 8 ancilla = 17 physical qubits per logical
- 5 logical qubits → 85 physical (fits 156-qubit Heron with margin)
- Circuit: syndrome extraction only (tractable NISQ proxy — not full fault-tolerant simulation)

**Ising decoder:**
- Primary: `Ising-Decoder-SurfaceCode-1-Fast` (HuggingFace, ONNX → TensorRT FP8 on RTX 5060)
- Fallback: PyMatching (classical MWPM, always available)
- If model not downloaded: automatic PyMatching fallback, no error

**Files (W4 Tier 4.5):**
- `src/engine/surface_code_encoder.py` — d=3 rotated surface code circuit builder
- `src/engine/ising_decoder_wrapper.py` — Ising ONNX + TensorRT + PyMatching fallback
- `src/server/services/cloud-qmc-service.ts` — orchestrator (enqueue, poll, query helpers)
- `src/server/routes/cloud-qmc.ts` — POST /api/cloud-qmc/trigger, GET /status/:id, GET /budget
- `src/server/db/migrations/0068_cloud_qmc_runs.sql` — cloud_qmc_runs table + FK to lifecycle_transitions

**Governance:**
- cloud_qmc_runs.governance_labels.decision_role = "challenger_only" on ALL rows
- Promotion is never held for IBM job completion
- QUANTUM_CLOUD_ENABLED=false (default) → zero IBM submissions, classical promotion unchanged
- Lifecycle transitions.cloud_qmc_run_id links enrichment rows to promotion events for Tier 7

**Routes:**
- `POST /api/cloud-qmc/trigger` — manual trigger (pipeline pause guard: 423 when paused)
- `GET /api/cloud-qmc/status/:strategyId` — list recent cloud_qmc_runs
- `GET /api/cloud-qmc/budget` — IBM QPU budget status
- `POST /api/cloud-qmc/poll` — manual poll trigger (normally run by cloud-qmc-poll cron)

**Tests:**
- `src/engine/tests/test_surface_code_encoder.py` — isolation, geometry, reproducibility, failure
- `src/engine/tests/test_ising_decoder_wrapper.py` — isolation, fallback, schema, edge cases
- `src/server/__tests__/cloud-qmc-service.test.ts` — governance, budget guard, backend rotation,
  lifecycle integration, pipeline guard, pending-row contract, golden-file regression

## Lifecycle Telemetry Tables (W1 / Tier 0)
Two new tables ship in W1 to unblock Tier 7 quantum graduation queries:

- **`lifecycle_transitions`** (migration 0064) -- typed lifecycle history with
  first-class quantum challenger evidence columns
  (`quantum_agreement_score`, `quantum_advantage_delta`,
  `quantum_classical_disagreement_pct`, `quantum_fallback_triggered`,
  `cloud_qmc_run_id`). Dual-written alongside `audit_log` rows by
  `lifecycle-service.ts` inside the same transaction. Indexed for
  high-volume "low-agreement strategies over 30 days" queries.
- **`quantum_run_costs`** (migration 0065) -- per-run wall-clock + (if cloud)
  QPU-seconds + dollars for every quantum module
  (quantum_mc, sqa, rl_agent, entropy_filter, adversarial_stress,
  cloud_qmc, ising_decoder). Pending-row contract: status starts "pending",
  updated to "completed"/"failed" on resolve.

  Cost-benefit query for Tier 7 graduation:
  ```sql
  SELECT module_name,
         count(*) AS runs,
         avg(wall_clock_ms) AS avg_ms,
         sum(cost_dollars::numeric) AS total_dollars,
         sum(qpu_seconds::numeric) AS total_qpu_sec,
         count(*) FILTER (WHERE status = 'completed') AS completed,
         count(*) FILTER (WHERE status = 'failed') AS failed,
         count(*) FILTER (WHERE cache_hit) AS cache_hits
  FROM quantum_run_costs
  WHERE created_at > now() - interval '30 days'
  GROUP BY module_name
  ORDER BY module_name;
  ```

  Pruning: hourly cron `quantum-cost-prune` (registered in scheduler) +
  on-startup one-shot. Pending rows older than 1 hour are flipped to
  `status="failed"`, `errorMessage="stale_pending_pruned"`.

## Backtest Integrity Tables (W10 / A2 + A4)
Two new tables ship in W10 to harden the backtester against drift and
lookahead bugs:

- **`backtest_provenance`** (migration 0070) -- A2 result-hash tracking. Records
  the `(data_hash, code_git_sha, strategy_hash, result_hash)` tuple for every
  completed backtest. Enables drift detection: identical inputs MUST produce
  identical `result_hash` values when `DETERMINISM_MODE=true`. Written by
  `backtest-service.ts` fire-and-forget (non-blocking). No status column —
  synchronous write only on `completed` backtests. **Authority:** read-only
  observation layer. Does NOT gate any lifecycle decision.
  Drift query (canonical): `SELECT data_hash, code_git_sha, strategy_hash,
  count(DISTINCT result_hash) FROM backtest_provenance GROUP BY 1,2,3
  HAVING count(DISTINCT result_hash) > 1;`
- **`frankenstein_test_runs`** (migration 0071) -- A4 randomization detection
  test results. Stores `p95_sharpe`, `median_pf`, and `passed` (gate criterion:
  p95_sharpe < 0.3 AND median_pf in [0.85, 1.15]) for every Frankenstein run.
  Pending-row contract: status starts `"pending"`, updated to
  `"completed"`/`"failed"` on resolve. **Authority:** HARD GATE on TESTING→PAPER
  lifecycle promotion. `lifecycle-service.ts` blocks promotion (fail-closed) when
  no completed Frankenstein run exists OR when `passed=false`. Operators must
  call `POST /api/frankenstein/run` for any in-flight CANDIDATE strategies before
  TESTING→PAPER will succeed. Pipeline pause guard on `/api/frankenstein/run`.

## Defensive Testing Tables (W11 / A7 + A8)
Two new tables ship in W11 to close the Two Sigma duplicate-signal failure
mode and to consolidate nightly data-integrity checks:

- **`strategy_signal_vectors`** (migration 0072) -- A7 empirical signal
  correlation. Stores per-bar int8 signal vectors (1=long, -1=short, 0=none)
  emitted by `backtester.py` after all filters (eligibility, parity, fill
  model, max_trades). Persistence layer gzip-compresses to `bytea` and writes
  one row per `(strategy_id, backtest_id)` pair (UNIQUE constraint enforced).
  Written by `backtest-service.ts` fire-and-forget (non-blocking). No status
  column — synchronous write only on `completed` backtests. **Authority:**
  HARD GATE on PAPER→DEPLOY_READY lifecycle promotion. `lifecycle-service.ts`
  blocks promotion (fail-closed) when no signal vector exists OR when cosine
  similarity > 0.85 with any DEPLOYED strategy (env override:
  `SIGNAL_CORRELATION_THRESHOLD`, default 0.85). Ramp-up rule: if no DEPLOYED
  strategy has a signal vector yet (pre-A7 backtests), gate passes with a
  warning so the gate does not permanently block all promotions during
  initial rollout. Defense-in-depth complement to W17 C9 (DSL diversity,
  pre-backtest). Routes: `GET /api/signal-correlation/matrix` for visual
  matrix review (pipeline-pause guarded).
- **`data_integrity_findings`** (migration 0073) -- A8 consolidated
  reconciliation + drift detection. Single `check_type` discriminator
  (`reconciliation` | `drift_detection`) with `check_name` subtype. Severity
  tiers: `info` | `warning` | `critical`. `affected_entity_type`/`_id`
  nullable for system-wide findings. `resolved` boolean (write-once row;
  operator flips `resolved=true` after investigation — not a pending-row
  contract). Indexed for unresolved-findings dashboard queries.
  **Authority:** observation/alert layer. Does NOT gate any lifecycle
  decision. Cron: `data-integrity-suite` runs nightly at 4:00 AM ET (UTC
  8:00 + 9:00 with ET filter for DST). Pipeline pause guard via
  `isPipelineActive()` early-exit. Reconciliation checks (4): `audit_log`
  vs `lifecycle_transitions` gaps, `paper_trades` vs `paper_positions`
  gaps, lifecycle backtest FK integrity, PAPER strategies missing
  `paper_sessions`. Drift checks: PSI on Sharpe / PF / MaxDD distributions
  computed across `backtest_provenance` groups with divergent `result_hash`.
  PSI > 0.2 = warning; > 0.5 = critical (industry-standard thresholds).

## Multi-Firm Promotion Eligibility (W13 / B5)

One new table ships in W13 to record per-firm deployment eligibility for every
strategy that reaches DEPLOY_READY:

- **`strategy_firm_eligibility`** (migration 0076) — B5 multi-firm promotion
  pipeline. One row per `(strategy_id, firm_id)` tuple, written fire-and-forget
  AFTER successful PAPER → DEPLOY_READY promotion (does NOT block promotion).
  Iterates all 8 configured firms (Topstep, Apex, MFFU, TPT, FFN, Alpha,
  Tradeify, Earn2Trade), runs `compliance_gate.py check_strategy_compliance`
  per firm with the firm's own contract caps, drawdown limits, consistency
  rules, commission, and overnight policy from `firm-config.ts`, and persists
  eligibility plus the full `compliance_check_result` JSONB for audit.
  **Authority:** OBSERVATION ONLY — additive to existing PAPER → DEPLOY_READY
  flow. Does NOT gate or override the A7 signal-correlation gate (W11), which
  runs BEFORE `promoteStrategy()` returns. B5 runs AFTER the promotion commits.
  **Service:** `src/server/services/multi-firm-promotion-service.ts`.
  **Pipeline pause guard:** `isPipelineActive()` early-exit returns empty
  result when paused (no firm checks are run, no rows are written).
  **Per-firm independence:** one firm's compliance_gate failure does not
  cascade — each firm gets its own pass/fail row. Subprocess errors fail
  closed (`eligible=false`, `result="error"`) for the affected firm only.
  **Why:** one validated edge → 3-5 simultaneous prop accounts → 3-5x income
  same day. The dashboard reads `strategy_firm_eligibility` to surface which
  firms a strategy can be deployed to without re-running compliance checks.

## DSL Archetype Coverage (W13 / B3)

W13 expands DSL fixtures from 3 to 7 archetypes covering 4 additional regimes:

- **`range_fade_mnq.json`** — VWAP-anchor fade on MNQ, 5m, RANGE_BOUND regime,
  RTH only. Frankenstein mode: `full_shuffle` (no calendar effect — pure
  intra-session mean-reversion behavior).
- **`opening_range_breakout_mes.json`** — first 30-min ORB on MES, 5m,
  OPENING_RANGE regime, RTH only. Frankenstein mode: `calendar_preserving`
  (calendar effect — first 30 min is structurally different from rest of RTH).
- **`news_fade_mcl.json`** — fade extreme moves around EIA Wednesday 10:30 ET
  inventory release on MCL, 5m, NEWS_DRIVEN regime, RTH only. Frankenstein
  mode: `calendar_preserving`. Sets `bypass_news_blackout: true` (event-driven
  strategies must explicitly opt into trading during the news window the
  default skip-engine guard would otherwise filter out).
- **`overnight_drift_mes.json`** — Asia → Europe directional drift on MES,
  15m, OVERNIGHT_DRIFT regime, ETH only. Frankenstein mode:
  `calendar_preserving` (session boundary effect).

**New EntryType:** `EVENT_DRIVEN` (added to `EntryType` enum) — covers
news/inventory release reactions. **New `bypass_news_blackout` field** on
`StrategyDSL`: explicit opt-in for strategies that must trade during macro
release blackouts. **New pattern_library entries:** `vwap_fade`,
`event_driven_fade`, `overnight_drift`, `session_open_breakout` with
required/optional params and validation ranges.

The 4 new fixtures bring the per-archetype `frankenstein_test_mode` choice
to 4 of 7 fixtures (the 3 W5a originals omit it and use the default
`full_shuffle`). Operators should set `calendar_preserving` for any strategy
that legitimately exploits a calendar effect so the A4 Frankenstein gate
does not incorrectly reject a valid edge.

## Kelly Sizing Convention (W13 / B7)

Kelly Criterion sizing ships behind a declarative DSL field. Backtest service
must build `kelly_params` from realized metrics before invoking
`compute_position_sizes()`:

- **`sizing_method` field** on `StrategyDSL` — Optional Literal: `"fixed"` |
  `"kelly"` | `"atr_based"` | None (default = backward-compatible existing
  ATR/fixed logic). Set on all 7 production fixtures as `"kelly"`. The DSL
  field is DECLARATIVE — it tells `backtest-service.ts` to compute realized
  win rate (edge) and avg_winner/avg_loser ratio (odds) from prior backtest
  trades, then pass `kelly_params={edge, odds, bankroll, risk_per_trade,
  kelly_fraction}` into `compute_position_sizes()`.
- **`kelly_optimal_contracts(edge, odds, bankroll, risk_per_trade,
  kelly_fraction=0.25, firm_max=None)`** in `src/engine/sizing.py` —
  Quarter-Kelly (industry safety standard) by default. Formula:
  `f* = (b*p - q) / b` where `b=odds`, `p=edge`, `q=1-p`. Contracts =
  `floor((f* * kelly_fraction) * (bankroll / risk_per_trade))`. NEVER exceeds
  `firm_max` (capped via `min(max_contracts, CONTRACT_CAP_MAX=20)`).
  Returns 0 when `f* <= 0` (no edge). Kelly produces a CONSTANT base size
  for all bars (strategy-level, not bar-level like ATR).
- **Profit-tier composition:** Kelly is ADDITIVE with `profit_scaling_tier`.
  Kelly determines the base contract count; profit tier scales it up. Result
  always capped at `firm_max`.
- **Risk parity (`src/engine/risk_parity.py`):** when N strategies run
  simultaneously, allocates contracts inversely proportional to per-strategy
  volatility so each strategy contributes approximately equal dollar risk.
  Floor + remainder distribution to lowest-vol strategies first; firm caps
  always honored.
- **Determinism preserved:** Kelly inputs (edge, odds, bankroll,
  risk_per_trade) come from realized backtest metrics — same backtest run →
  same kelly_params → same contract count. Compatible with A1 determinism.
- **Golden fixture parity:** Kelly affects sizing math; existing W10 A5
  golden fixtures pre-compute trade-ledger results without invoking the
  sizing pipeline, so the 5 hand-computed fixtures remain unaffected.

## Tier 7 W7b Graduation Query Pattern

The Phase 0 → Phase 1 graduation review for the Grover adversarial-stress gate
(W7b Day 52) is **a query, not a code change**. The query joins
`adversarial_stress_runs` (the shadow predictions) through `backtests`
(the strategy/run linkage) into `lifecycle_transitions` (the actual
TESTING→PAPER promotions), then left-joins `paper_sessions` to read the
real-world outcome that followed each promotion.

If the strategies the Phase 1 rule **would have blocked** show worse paper
outcomes than the strategies it **would have passed**, the Grover prediction
correlates with reality and we graduate. Graduation is mechanical: flip
`governance_state.grover_weight` from 0.0 → 0.05 and let the lifecycle gate
honor it.

**Phase 1 block rule:** `worst_case_breach_prob > 0.5` AND
`breach_minimal_n_trades < 4`. Background and rationale are in the
`QUANTUM_ADVERSARIAL_STRESS_ENABLED` flag block above (Worst-case vs
average-case distinction).

```sql
-- W7b Day 52: Grover Phase 0 → 1 graduation evaluation.
-- Joins adversarial_stress_runs through backtests through lifecycle_transitions
-- so we can compare each shadow prediction to the paper outcome that followed.
SELECT
  s.name AS strategy_name,
  asr.worst_case_breach_prob,
  asr.breach_minimal_n_trades,
  lt.from_state,
  lt.to_state,
  lt.created_at AS promotion_date,
  -- Phase 1 recommendation (would-have, never enforced in Phase 0)
  CASE
    WHEN asr.worst_case_breach_prob > 0.5
     AND asr.breach_minimal_n_trades < 4 THEN 'WOULD_HAVE_BLOCKED'
    ELSE 'WOULD_HAVE_PASSED'
  END AS phase1_recommendation,
  ps.outcome AS actual_paper_outcome
FROM adversarial_stress_runs asr
JOIN backtests bt              ON asr.backtest_id = bt.id
JOIN lifecycle_transitions lt  ON lt.backtest_id = bt.id
JOIN strategies s              ON lt.strategy_id = s.id
LEFT JOIN paper_sessions ps    ON ps.strategy_id = s.id
                              AND ps.created_at > lt.created_at
WHERE lt.from_state = 'TESTING'
  AND lt.to_state   = 'PAPER'
  AND lt.created_at > NOW() - INTERVAL '30 days';
```

**Graduation decision:**
- Compute `bad_outcome_rate(WOULD_HAVE_BLOCKED)` vs `bad_outcome_rate(WOULD_HAVE_PASSED)`.
- "Bad outcome" = `paper_sessions.outcome IN ('killed', 'rule_breach', 'drawdown_breach')`.
- If `bad_rate(BLOCKED) > bad_rate(PASSED) + 0.10` AND sample size ≥ 20
  promotions per bucket → the gate would have improved outcomes → graduate.
- Set `governance_state.grover_weight = 0.05` in the same transaction that
  flips `QUANTUM_ADVERSARIAL_STRESS_ENABLED` Phase 0 → Phase 1.
- If sample size is too small or the rate gap is < 0.10, leave the gate in
  Phase 0 and re-run the query in 30 days.

**Cost gate (read alongside this query, not in it):**
Use the `quantum_run_costs` cost-benefit query (above, in this section) with
`module_name = 'adversarial_stress'`. If average wall-clock >
`adversarial_stress.timeout_ms` per run or budget burn-rate is unsustainable,
graduation is **blocked regardless of predictive value** — the gate has to
both work AND fit the cost envelope.

**Why this is documentation, not a script:**
Day 52 graduation is a deliberate, human-reviewed event. Encoding it as an
auto-cron risks flipping the gate during a low-data window or under a
regime shift. The query is canonical, the decision is not.

## Profit-Based Position Scaling (W5a / Tier 5.4)
Gemini "Forge-Tested" 2026 Edition: every $3,000 of cumulative profit = +2 micro
contracts added to the position size. Single-account compounding only.

**CLAUDE.md constraint:** ONE account must be profitable. `compute_profit_tier()`
is single-account only — do NOT aggregate PnL across multiple accounts.

**Module:** `src/engine/sizing.py`
- `compute_profit_tier(account_pnl_total, base_contracts, increment=2, threshold=3000, firm_max=None) -> int`
- Formula: `tier_count = floor(pnl / threshold); extra = tier_count * increment; final = min(base + extra, firm_max)`
- Negative PnL -> tier_count=0 (no scaling). Zero PnL -> no scaling.
- Result is always an int, always >= base_contracts, always <= CONTRACT_CAP_MAX (20).
- `compute_position_sizes()` now accepts optional `profit_scaling_tier: dict | None = None`.
  When None (default) -> behavior is 100% identical to pre-Tier-5.4 (backwards-compatible).
  When provided: `{"increment": 2, "threshold": 3000, "account_pnl_total": <float>}`

**Per-firm cap behavior:**
- All 8 main production firms: base cap 15, scale up to max 20 (CONTRACT_CAP_MAX)
- 3 conservative firms (top_one, yrm_prop, fundingpips): base cap 5, clamped min 10
- Profit tier never pushes result above firm's `max_contracts` (clamped to CONTRACT_CAP_MAX=20)
- Scaling applied after ATR base sizing, before return

**Audit log:** `logger.debug("sizing.profit_tier_applied ...")` fires on every
bar where extra_contracts > 0. Includes base, extra, final, firm_cap, pnl.

**Tests:** `src/engine/tests/test_profit_tier.py` (27 tests: 18 unit + 2 constraint + 7 integration)

**Team B coordination (DSL fixtures):** DSL JSON fixtures that include profit scaling
should use: `"profit_scaling_tier": {"increment": 2, "threshold": 3000}` (without
`account_pnl_total` — that is injected at backtest-run time from live account PnL).

## Quantum Pre-Flight Cache for n8n (Tier 6 / W6)

n8n workflows call this CACHE-READ-ONLY endpoint between "Parse Output" and
"Submit Backtest" to short-circuit strategies whose DSL hash already failed a
prop-firm UCI test in a prior `quantum_mc_runs` row.

- **Route:** `POST /api/quantum/pre-flight` (mounted in `src/server/index.ts`).
  Standard rate-limited only (NOT strict) because n8n submits per generated
  strategy in burst.
- **Module:** `src/server/routes/quantum-pre-flight.ts` (also exports
  `computeStrategyHash` for tests).
- **Tests:** `src/server/__tests__/quantum-pre-flight.test.ts` (14 tests).

**CRITICAL CONSTRAINTS — do not violate:**
1. This route MUST NEVER spawn quantum compute. The backtest auto-fire path at
   `backtest-service.ts:1022-1041` remains the SOLE quantum-compute trigger.
   Spawning here would cause double quantum work per logical strategy event.
2. Cache MISS returns `{cached: false, passed: true}` — proceed without
   blocking. Do NOT auto-fire QMC from this path.
3. Pipeline pause guard MANDATORY — `isActive() === false` returns
   `{cached: false, passed: true, reason: "pipeline_paused"}` so paused
   pipelines never appear as "blocked by stale cache".
4. NEVER import `runQuantumMC`, `runQuantumBreachEstimation`,
   `enqueueCloudQmcRun`, or any compute helper from this route file. The test
   suite asserts these mocks are never invoked across all code paths.

**Strategy hash:**
- `sha256(canonicalJson(dsl))` → 64-char hex
- Canonical JSON sorts object keys recursively so n8n payload-shape variations
  do NOT fragment the cache.

**UCI formula:** `UCI = estimated_value + confidence_interval.upper`
**Threshold:** env `QUANTUM_PROP_FIRM_UCI_THRESHOLD` default 0.01 (1% breach
probability ceiling).

**Cache lookup query:**
```sql
SELECT q.id, q.backtest_id, q.estimated_value, q.confidence_interval
FROM quantum_mc_runs q
JOIN backtests b ON b.id = q.backtest_id
WHERE q.status = 'completed'
  AND b.config->>'strategy_hash' = $1
ORDER BY q.created_at DESC
LIMIT 1
```

Backtests written before backtest-service starts embedding `strategy_hash`
into config produce cache misses — that's correct behavior (proceed without
blocking, do not spawn).

**Response shapes:**
```json
{ "cached": false, "passed": true,  "score": null,    "reason": "pipeline_paused" }
{ "cached": false, "passed": true,  "score": null,    "reason": "no_prior_quantum_run" }
{ "cached": false, "passed": true,  "score": null,    "reason": "cache_lookup_error" }
{ "cached": true,  "passed": true,  "score": 0.0073, "qmcRunId": "...", "reason": "uci_within_threshold" }
{ "cached": true,  "passed": false, "score": 0.0234, "qmcRunId": "...", "reason": "uci_above_threshold" }
```

**n8n workflows touched (W6):**
- `eCr7cyb0aPArFCZc` (Strategy Generation Loop) — inserted between
  "Concept Validated?" and "Submit Backtest". Block path returns to
  "Check Iteration Limit" so the AI can refine.
- `Z4NcOCDbet8KzjDd` (Nightly Strategy Research Loop) — inserted between
  "Parse Ollama Strategy Output" and "Submit Strategies for Backtest".
  Block path emits a no-op record for journaling.
- HTTP node config: `onError: continueRegularOutput`, `retryOnFail: true`,
  `maxTries: 2`, `waitBetweenTries: 1000`, `timeout: 5000`. n8n must NEVER
  hard-fail the workflow when pre-flight is unavailable — proceed to backtest.
- IF node gate: `{{ $json.cached === true && $json.passed === false }}` —
  output[0] (TRUE) = blocked, output[1] (FALSE) = proceed to Submit Backtest.

**Performance budget:**
- Cache hit p95: <200ms (single indexed JOIN query).
- Cache miss p95: <5s (same query, empty result).

**Backtest-service backlink (FUTURE — not required for Tier 6):**
For pre-flight cache HITS to start populating, `backtest-service.ts` should
embed `strategy_hash` into `backtests.config` JSONB when persisting a new
backtest. Until then, every pre-flight call returns `cached: false` and the
n8n workflow always proceeds to backtest — this is the SAFE default.

## SQA Promise Registry (W2 / Tier 1.2)
SQA fire-and-forget at `backtest-service.ts:598` is now observable to the
critic via `src/server/lib/sqa-promise-registry.ts`. Critic calls
`sqaRegistry.awaitWithTimeout(backtestId, 30s)` instead of polling DB.

- **Hard timeout:** 30s. Critic falls back to no-Optuna-seed if SQA
  hasn't completed (classical search proceeds).
- **Circuit breaker:** 3 timeouts in 10 min -> OPEN. Skips
  `awaitWithTimeout` calls entirely. Auto-closes after 1 hour cooldown.
  No HALF_OPEN probe (SQA is fire-and-forget; no probe call to send).
- **Audit log:** state changes write `quantum.sqa_circuit_breaker_open`
  and `quantum.sqa_circuit_breaker_closed` entries.
- **Restart behavior:** session-local Map cleared on restart. Critic falls
  through to existing DB single-read on registry miss. No correctness
  regression -- only loses the "race-condition optimization" for runs
  spawned before restart.

## Strategy Philosophy -- SIMPLE WINS, HIGH EARNERS
- **Max 3-5 parameters per strategy.** More = overfitting. No exceptions.
- **One-sentence rule:** If you can't describe the strategy in one sentence, it's too complex. Reject it.
- **Proven edges only:** Trend following, mean reversion, volatility expansion, session patterns. No exotic ML signals.
- **Robustness > optimization.** A strategy that works with MA=15-25 is better than one that only works with MA=17.
- **Walk-forward validation is mandatory.** No strategy passes without out-of-sample testing.
- **Signal generation is method-agnostic.** ML, tensor networks, and quantum-inspired methods are permitted IF they pass the full walk-forward + MC + OOS pipeline. The gates decide, not the method.
- Agents must REJECT strategies that require tight parameter optimization to be profitable.
- **ICT/SMC concepts are fully codified.** 54 ICT indicators and 15 ICT strategies are implemented in `src/engine/indicators/` and `src/engine/strategies/`. Agents CAN generate, test, and optimize ICT-based strategies. ICT constructs (order blocks, FVGs, breakers, sweeps, market structure) are subject to the same robustness rules as any other codified strategy.
- **ONE account must be profitable.** Agents REJECT any strategy that requires multi-account scaling to be worth trading. If a strategy can't earn serious money on a single $50K prop firm account, it's not good enough.

## Strategy Performance Requirements -- HARD MINIMUMS

> A strategy that needs 20 accounts to matter is not an edge. Every strategy Forge approves
> must be profitable enough to trade on ONE account and survive most trading days in a month.

### Minimum Performance Gates (agents MUST enforce these)

```yaml
# All metrics measured on walk-forward out-of-sample data, NOT in-sample backtests.
# ~20 trading days per month assumed.

minimum_avg_daily_pnl: $250        # $250/day x 20 days = $5,000/month gross on 1 account
minimum_monthly_gross: $5,000      # Must clear this on a single 50K account
minimum_win_rate_by_days: 0.60     # Profitable on 12+ out of 20 trading days
minimum_profit_factor: 1.75        # Winners must significantly outweigh losers
minimum_sharpe_ratio: 1.5          # Risk-adjusted returns must be strong
maximum_max_drawdown: $2,000       # Must survive tightest prop firm (Topstep 50K = $2K)
maximum_consecutive_losers: 4      # Max 4 losing days in a row (mental + drawdown survival)
minimum_expectancy_per_trade: $75  # Every trade must be worth taking
minimum_avg_winner_to_loser: 2.0   # Avg win must be 2x avg loss minimum (1:2 R:R)
```

### Performance Tiers (for ranking strategies)

```yaml
# TIER 1 -- "Bread and Butter" (deploy immediately)
tier_1:
  avg_daily_pnl: ">= $500"        # $10K+/month on one account
  win_days_per_month: ">= 14"     # 70%+ winning days
  max_drawdown: "< $1,500"        # Comfortable buffer at every firm
  profit_factor: ">= 2.5"
  sharpe: ">= 2.0"

# TIER 2 -- "Solid Edge" (deploy with monitoring)
tier_2:
  avg_daily_pnl: ">= $350"        # $7K+/month
  win_days_per_month: ">= 13"     # 65%+ winning days
  max_drawdown: "< $2,000"
  profit_factor: ">= 2.0"
  sharpe: ">= 1.75"

# TIER 3 -- "Minimum Viable" (deploy on best-fit firm only)
tier_3:
  avg_daily_pnl: ">= $250"        # $5K+/month
  win_days_per_month: ">= 12"     # 60%+ winning days
  max_drawdown: "< $2,500"
  profit_factor: ">= 1.75"
  sharpe: ">= 1.5"

# BELOW TIER 3 -- REJECT. Not worth the trader's time or prop firm fees.
```

### Why These Numbers

```
MFFU 50K account costs $77/month to evaluate.
If strategy makes $5,000/month gross:
  - Pass evaluation in ~12-15 trading days (< 1 month)
  - Funded payout: $5,000 x 0.80 = $4,000/month to you
  - ROI on $77 eval fee = 5,194% annualized
  - One account. No scaling needed. No 20-account Apex games.

If strategy only makes $500/month (the kind we REJECT):
  - Takes 6+ months to pass evaluation = $462 in fees before funding
  - Funded payout: $500 x 0.80 = $400/month
  - Barely covers the eval cost in year one
  - You'd need 10 accounts to make $4,000/month = complexity, risk, headache
```

### Daily Survival Requirement

```
20 trading days/month. Strategy must be GREEN on 12+ of them.
The trader sits down, executes the signal, and walks away profitable most days.
Not "profitable over a 3-month window" -- profitable THIS WEEK.

Agents track:
  - worst_month_win_days: Minimum winning days in any single month
  - avg_daily_pnl_on_losing_days: How bad are the red days?
  - recovery_days: After a losing day, how many days to recover?

Rules:
  - If worst_month_win_days < 10 in any month -> REJECT (too inconsistent)
  - If avg_loss_on_red_days > avg_win_on_green_days -> REJECT (losers too big)
  - If recovery after max_drawdown > 5 days -> FLAG for review
```

## Institutional Edge -- Monitoring & Risk (Top 1% Practices)
- **Regime detection is mandatory.** Every strategy must have a "preferred regime" tag. Regime filter pauses strategies when their preferred regime is NOT active. Use ADX + ATR percentile for classification.
- **Dynamic position sizing.** Scale position size inversely to trailing ATR: `contracts = target_risk / (ATR * tick_value)`. Never use fixed position sizes in production.
- **Stress test against historical crises.** Every strategy must survive 2008, COVID crash, 2022 rate shock with 3x spreads and 50% reduced fill rates. If any scenario exceeds prop firm max drawdown -> FAIL.
- **Track execution quality.** Log expected vs actual fill price on every trade. If average slippage > backtest assumptions -> strategy is NOT actually profitable. Use stop-limit orders, never stop-market.
- **Monitor for alpha decay.** Track 30-day rolling Sharpe. Shrinking average wins (before win rate drops) is the earliest decay signal. Reduce allocation gradually to decaying strategies.
- **Detect live vs backtest drift.** If live 30-day rolling metrics deviate > 1 std dev from backtest expectations -> investigate. > 2 std dev -> ALERT.
- **Multi-strategy portfolio.** Target 2-3 uncorrelated strategies (correlation < 0.3 on returns). Track total portfolio heat, not just per-trade risk. If correlation > 0.5 -> treat as one strategy for sizing.
- **Strategy pipeline.** Always have at least 1 strategy in development while others are deployed. Strategies have lifespans -- plan to replace them, not run forever.
- **Build execution cost as a VARIABLE** in backtests, not a constant. Slippage increases during volatility spikes and around news events.

## Key Patterns
- **Audit Log**: Every significant action (backtest, MC run, strategy change) gets an audit_log entry -- borrowed from Aspire's Trust Spine pattern
- **Forge Score**: 0-100 composite score for strategy quality (Sharpe + Drawdown + MC survival + Walk-forward)
- **Node<->Python bridge**: Node spawns Python subprocess, passes JSON config, receives JSON results
- **DeepAR Auto-Graduation**: weight 0.0 -> 0.05 -> 0.10 based on rolling hit rate. Agents must respect current weight.
- **Cloud Quantum Two-Gate**: env flag + per-request opt-in. Never auto-trigger cloud QPU.
- **Fire-and-Forget Tracking**: All async runs (MC, SQA, QUBO, Tensor, RL, Quantum MC) write pending row BEFORE Python call, update to completed/failed after.
- **Post-Close SSE Resilience**: broadcastSSE("paper:trade") always fires after transaction, even if post-processing fails.

## Database
- PostgreSQL on Railway
- Schema in src/server/db/schema.ts
- Migrations via drizzle-kit
- All IDs are UUIDs

## Prop Firm Integration
- **Full rules reference:** `docs/prop-firm-rules.md` -- agents MUST load this when simulating strategies
- 8 firms tracked: MFFU, Topstep, TPT, Apex, FFN, Alpha Futures, Tradeify, Earn2Trade
- Agents simulate strategies against each firm's exact rules (drawdown, consistency, contract limits)
- Agents rank firms by expected ROI given a strategy's profile
- Agents calculate payout projections after splits, fees, and ongoing costs
- User trades manually -- Forge provides strategy signals and firm rule compliance tracking

## Prop Firm Compliance (Live Rule Enforcement)
- **Architecture:** `docs/PROP-FIRM-COMPLIANCE.md` -- three-layer compliance architecture
- **OpenClaw Compliance Guard:** `src/agents/OPENCLAW_COMPLIANCE_GUARD.md` -- system prompt for compliance sidecar
- **Rule Engine:** `src/engine/compliance/compliance_gate.py` -- deterministic enforcement (no AI judgment)
- **API Routes:** `src/server/routes/compliance.ts` -- `/api/compliance/*`
- **Three layers:** OpenClaw monitors -> Rule engine enforces -> Human approves
- **Freshness gate:** `ruleset_max_age_hours` -- 24h for active trading, 72h for research, 0h after drift
- **Drift detection:** Content hash comparison on every doc fetch -- blocks approvals until human revalidates
- **Tables:** `compliance_rulesets`, `compliance_reviews`, `compliance_drift_log`
- **Critical rule:** No strategy runs if current rules are stale, ambiguous, or violated. Compliance beats profit.

## System Journal (AI Self-Learning Loop)
- **Table:** `system_journal` -- logs every AI-generated strategy's full backtest results, equity curve, daily P&Ls, and prop compliance
- **Purpose:** AI reviews its own past generations nightly via n8n and self-critiques. The system gets smarter every day.
- **Routes:**
  - `GET /api/journal` -- List entries (filter by `?status=`, `?tier=`, `?source=`, `?limit=`)
  - `GET /api/journal/:id` -- Single entry
  - `POST /api/journal` -- Log new entry (called by n8n after backtest)
  - `PATCH /api/journal/:id` -- Update (AI adds self-critique notes)
  - `GET /api/journal/stats/summary` -- Aggregate stats (total, pass rate, by tier/source)

## Prop Risk Calculator
- **Routes:**
  - `POST /api/risk/max-contracts` -- Given symbol, ATR, firm, account size, returns safe max contracts
  - `POST /api/risk/portfolio-heat` -- Given all open positions, returns total exposure, unrealized P&L, drawdown usage per account, and heat percentage
- **Purpose:** Call before every live session to ensure you never breach drawdown limits across multiple prop accounts
- Supports all 8 firms and contract specs (MES, MNQ, MCL)

## Data Provider Roles
- **Databento** -> Historical bulk downloads (backfill). Download once to S3, never re-pay.
- **Massive** -> Real-time streaming for paper/live trading. Free WebSocket.
- **Alpha Vantage** -> Server-side indicators + sentiment for AI agents. MCP-enabled.
- All three are free ($0/mo). Databento has $125 one-time credits.

## Data Layer Rules
- **Polars is the primary data library** -- use for all Parquet loading, transforms, and filtering. 5-10x faster than Pandas.
- **DuckDB for S3 queries** -- query Parquet on S3 directly with SQL, no download needed for selective date ranges.
- **Pandas only at the vectorbt boundary** -- convert Polars -> Pandas with `.to_pandas()` only when passing data to vectorbt.
- **ALWAYS use ratio-adjusted continuous contracts for backtesting** -- never raw Databento prices. Roll gaps create fake signals.
- Raw prices stored in S3 for reference, but all backtests run on `ratio_adj/` data.
- **Optuna for parameter robustness testing** -- Bayesian search (TPE) to map stable plateaus, not find "best" params. ~800 trials vs 100K+ grid search.

## Tournament Gating (n8n-canonical)

The 4-role tournament gate (Proposer → Critic → Prosecutor → Promoter) lives in n8n workflows, NOT in the in-process Node loop. This is intentional.

- `src/server/routes/tournament.ts` is a read-only metrics API — it does not gate anything.
- `agent-service.runStrategy()` does NOT call tournament checks before backtest. It calls the graveyard gate (cosine similarity) and proceeds directly to backtest.
- The 4-role tournament evaluation runs as part of the n8n Strategy_Generation_Loop workflow which orchestrates: scout → tournament gate → POST /api/agent/run-strategy → backtest.

**Implication for non-n8n deployments:** if the in-process Node loop is run without n8n (e.g., dev environments invoking POST /api/agent/run-strategy directly), the tournament gate is BYPASSED. Strategies will reach the backtest without the 4-role adversarial filter.

**Decision history:** This was deliberately scoped to n8n during Phase 4 to avoid duplicating LLM orchestration logic in Node. If we ever decommission n8n or want a tournament gate inside the Node loop, port the workflow to a Node service (not a top priority — graveyard + backtest gates are doing most of the filtering work).

## Don't
- Don't add Supabase or complex auth -- it's just one user
- Don't over-engineer -- MVP each phase, iterate
- Don't generate complex strategies -- max 5 parameters, one-sentence logic, proven edges only
- Don't optimize parameters to find "the best" -- test robustness across a wide range instead
- Don't trigger cloud quantum on auto-triggered backtest runs -- cloud is opt-in only
- Don't treat DeepAR output as authoritative until weight > 0 -- it starts in shadow mode
- Don't bypass lifecycle service for state transitions -- all promotions/demotions go through promoteStrategy()
- Don't create fire-and-forget runs without a pending DB row -- silent loss on restart
- Signal generation methods (including ML, tensor networks, quantum-inspired) are permitted IF validated through the same walk-forward + Monte Carlo + OOS pipeline as any other strategy. No method gets a free pass -- the gates decide, not the method.
- Don't store secrets in code -- use .env
- Don't commit the data/ directory -- it's gitignored (lives in S3)
- Don't waste Databento credits on data you can get from Massive/Alpha Vantage for free
- Don't simulate strategies against a firm without loading `docs/prop-firm-rules.md` first
- Don't ignore consistency rules (TPT 50%, FFN Express 15%) -- these disqualify many strategies
- Don't use Pandas for data loading -- use Polars (only convert to Pandas at vectorbt boundary)
- Don't backtest on raw/unadjusted continuous contracts -- always use ratio-adjusted data
- Don't use grid search for parameter testing -- use Optuna (Bayesian/TPE) for 100x fewer trials
- Don't use fixed position sizes in production -- scale inversely to volatility (ATR-based)
- Don't deploy a strategy without a preferred regime tag -- regime filter must gate every strategy
- Don't use stop-market orders -- use stop-limit orders (stop-market can cause catastrophic slippage)
- Don't ignore execution quality -- if slippage > backtest assumptions, the strategy isn't profitable
- Don't run just one strategy -- target 2-3 uncorrelated strategies (correlation < 0.3 on returns)
- Don't treat strategies as permanent -- they have lifespans, always be developing replacements
- Don't model slippage as a constant -- it's a function of volatility (higher during vol spikes)
- Don't ignore time-of-day liquidity -- overnight ES has 2x spreads vs RTH core; slippage multipliers by session are mandatory
- Don't trade through FOMC/CPI/NFP without explicit event handling -- default is SIT_OUT +/-30 min
- Don't assume limit orders always fill -- model fill probability, especially for mean reversion entries at extremes
- Don't use gross P&L for performance gates -- use net P&L per firm (commissions differ: Topstep $0.37/side, Alpha $0.00/side, Tradeify $1.29/side, others $0.62/side)
- Don't ignore firm contract caps in backtests -- ATR sizing capped to `min(ATR_size, firm_max_contracts)`
- Don't ignore overnight gap risk -- strategies holding across sessions need gap-adjusted MAE and drawdown
- Don't pass slippage/fees to vectorbt for futures -- compute P&L manually (futures math, not equity math)
