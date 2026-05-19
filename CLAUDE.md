# Trading Forge — Project Conventions

> Living rules for operating the system. Historical build journal lives in `AGENT-LOGS.md`. Architecture detail lives in `Trading Forge System Map v2.md`.

> **File recovery note (W23F.N 2026-05-19):** This file was reconstructed after corruption at mtime 02:57:49 (45KB → 45KB of null bytes). Reconstruction sources: conversation session-reminder snapshots + Wave 23 + W23F.N updates. If a section appears thinner than you remember, that's why — flag drift and reinstate from your memory.

---

## §1. Mission

Trading Forge is a production-grade, family-distributable futures trading bot infrastructure. Operator (swayz032) and family members each run independent bots on independent prop firm accounts.

**Target:** scale ONE robustly-validated strategy (avg-R ≥ 2.0R, PF ≥ 1.7, deflated Sharpe ≥ 1.5, max 1-2 A+ trades/day) from a $250/day baseline to **$1,000–5,000+/day** via four scaling levers. Win rate is an OBSERVED output metric — never a target, never a gate, never specified as a band.

1. **Contract pyramid** — single account, profit-tier scaling on one strategy (base 6 MES / 6 MNQ / 18 MCL → risk-cap-bounded ceiling, +3 per +$3K cumulative profit)
2. **Multi-account same firm** — Topstep allows multiple accounts per user (single TopstepX subscription covers all)
3. **Multi-firm parallel** — Topstep + MFFU running DIFFERENT strategies per firm (MFFU collaborative-trading compliance)
4. **Family copy distribution** — each family member runs a DIFFERENT DEPLOYED strategy on their own TradingView + TradersPost + own MFFU/Topstep account

Agents must never fake profitability. The gates decide.

---

## §2. Current Phase: Production Hardening ONLY

All build phases are done. **No new subsystems for 90 days.** The only work is production hardening:

- **Pipeline production** — CANDIDATE → TESTING → PAPER → DEPLOY_READY → PILOT → DEPLOYED must flow without orphan states or silent drops
- **Lifecycle production** — every state transition atomic + audited via `audit_log` and `lifecycle_transitions`
- **Bug tracing** — correlation_id propagates end-to-end (bar → handler → DB → SSE → audit_log) so any 90-day-old trade can be reconstructed
- **Bugs / errors / disconnects / incidents** — fix them where they live; root cause, not workaround
- **n8n enterprise grade** — every workflow has retry + idempotency + `errorWorkflow` attached to `BbCvlV1ARyyvY3NI` (ZZ global error sink) + dedupe. Drift detector cron runs monthly.
- **Bottlenecks blocking lifecycle flow** — anything stopping CANDIDATE from reaching DEPLOYED is the priority
- **Systems live together** — Node ↔ Python ↔ n8n ↔ Postgres ↔ frontend must agree on contracts. No silent drift.
- **System Map sync mandatory** — after every architectural change, run `npm run system-map:sync` and keep `system-map:check` green
- **Claude Code Team Mode** — multi-pass parallel-subagent dispatch is the default for any work touching ≥2 subsystems

**Agents must reject feature-add suggestions and reframe work as production hardening.**

---

## §2b. Scout Architecture — Layered Discovery (Pass 20 + Pass 21 + Wave 23F)

> **PRODUCTION-VERIFIED 2026-05-19:** Cycle 4 produced first organic W23F-shaped strategy (`orb_mnq_15m` with `entry_quality.confluence_factors=["structural_setup","vp_shape"]`, `extraction_provenance: youtube_transcript`). Pipeline runs end-to-end: MES → MNQ → MCL rotation, LLM extracts confluence factors + symbols, graduator emits entry_quality block, DSL critic accepts with W23F.L convention pre-filter, auditor accepts risk_derived_pyramid sizing. See AGENT-LOGS Wave 23F entry for full bug catalog + fixes.

The scout pipeline runs `autonomous-scout-discovery` cron every 4 hours via in-process `src/server/services/autonomous-scout-runner.ts`. Every compiled strategy passes through `src/server/services/framework-overlay.ts` which REPLACES the scout's risk-management with framework defaults (W23F.N: **Style C 33/33/33** default — TP1 33%@1R / TP2 33%@2R / runner 34% trails developing_session_poc with Chandelier(14,2) fallback; stop floor 1.5×ATR + ceiling 14pt MES / 40pt MNQ / 25 tick MCL; 15:55 ET hard time-stop; 67% personal DLL; pyramid base 6 MES / 6 MNQ / 18 MCL with +3 increments per +$3K; max_risk 2%; per-symbol liquidity caps 100/50/30) while PRESERVING the entry signal. Style D is DEAD — see W23F.N AGENT-LOGS entry.

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
- **Sizing is FRAMEWORK-AUTHORITATIVE (W23F.N)** — overlay REPLACES LLM-extracted base/tier/cap values. The operator's pyramid math wins, not the YouTuber's. Wave 23 canonical: MES 6 / MNQ 6 / MCL 18 base + 3 per +$3K + per-symbol liquidity caps MES 100 / MNQ 50 / MCL 30.

---

## §3. Operator Workflow

### Daily (5 minutes)
- Glance at `ProductionStatusPanel` — 6 questions, GREEN/RED
- Discord ping on any RED → handle on phone
- That's it. The bot trades; you observe.

### Weekly (Sunday, 30 minutes)
- Read weekly drift report (auto-fires Sunday 6 PM ET; auto-HALT on >2σ deviation)
- Review `LibraryDiversityPanel` — is scout pipeline producing new strategies?
- Approve any DEPLOY_READY → PILOT promotions (or enable operator-absent mode if vacationing)
- Family member check-in: any TradingView / TradersPost issues?

### Vacation Mode (operator absent 7+ days)
- Set `OPERATOR_ABSENT_AUTOPROMOTE=true`
- Tier 1 strategies (rolling Sharpe ≥ 2.0, all gates passed) auto-promote DEPLOY_READY → PILOT
- BW vault auto-refresh keeps secrets fresh (if `TF_VAULT_MODE=bitwarden`)
- Prop firm cookie refresh keeps C2 evidence intact
- Dead-man's heartbeat alerts you via Discord/SMS if backend silent >2h during RTH
- 14-day vacations are safe by design

---

## §4. Trading Framework (Wave 23 — Style C canonical)

Data sources: Raschke, Grimes, Bellafiore, SMB consensus; Topstep funded-trader case studies; QuantifiedStrategies / Edgeful backtests; Lopez de Prado, Carver, Hurst-Ooi-Pedersen, Kaminski-Lo.

### Stop Loss — structural, NEVER fixed-point
```
stop_distance = invalidation_swing + 1pt buffer
floor   = 1.5 × current-timeframe ATR
ceiling = 14pts MES   (≈ 40pts MNQ, ≈ 25 ticks MCL)
If structural distance > ceiling → SKIP TRADE
```

### Take Profit — Style C default (Wave 23 canonical, W23F.N)
**Style C is the ONLY default exit. Style D is DEAD.**
- **TP1:** 33% off at +1.0R
- **TP2:** 33% off at +2.0R
- **Runner:** 34% trails developing session POC (Chandelier(14, 2.0) fallback for markets without VP feed)
- **Move stop to BE+1 tick on TP1 fill**
- **Time-stop:** hard flatten 15:55 ET

### Sizing — Risk-Derived Pyramid (W23F.N — Wave 23 canonical)
Sizing is **risk-management-bounded, not contract-count-bounded**. Pyramid is the SLOW-RAMP floor; risk math is the CEILING. Lowest wins.

**Pyramid ramp (time progression):**
```
Base:      6 MES / 6 MNQ / 18 MCL
Increment: +3 contracts per +$3,000 cumulative profit
```

**Risk-derived ceiling (computed every signal):**
```
finalContracts = min(
  pyramidTier,                                            // slow ramp
  floor(accountBalance × max_risk_pct_per_trade
        ÷ (stop_multiplier × ATR_points × point_dollar_value)),   // risk cap
  firmContractCap,                                        // Topstep/MFFU tier
  liquidity_comfort_cap                                   // book-depth ceiling
)
```

**Per-symbol liquidity comfort caps (W23F.N):**
| Symbol | Cap | Rationale |
|---|---|---|
| MES | 100 | 200-500 contracts typical at touch; 3× headroom over Phase 2 ramp of 33 |
| MNQ | 50 | 50-150 contracts at touch; cap prevents eating the entire book |
| MCL | 30 | 20-80 contracts at touch (retail flow); cap prevents 1-2 tick slippage |

**Sizing parameters:**
- `max_risk_pct_per_trade: 0.02` — 2% of risk base per trade
- `personal_dll_pct: 0.67` — Personal DLL = 67% of firm DLL
- `tier_threshold_dollars: 3000` — pyramid steps every +$3K profit

**Concrete examples (1.5×ATR stop, ATR=4pts on MES, MFFU 2% rule):**
- $50K eval funded:   $1,000 risk / $30/contract = 33 contracts ceiling
- $100K account:      $2,000 / $30 = 66 contracts
- $150K account:      $3,000 / $30 = 100 contracts (binds at liquidity cap)

**Schema:** strategies write `position_size.type="risk_derived_pyramid"`. Static `max_contracts` MUST NOT be baked at graduation — computed at signal-time only. See `src/server/lib/risk-sizing.ts`.

**Mini→micro contract conversion:** scout-extract's `remapMarket()` scales contracts 10× when remapping ES→MES, NQ→MNQ, CL→MCL. Transcript "trade 3 ES" becomes "trade 30 MES" — same dollar-risk exposure post-conversion.

### Daily Loss Limit — kill switch
```
Personal DLL = 67% of firm DLL
HALT new entries at 67% (env: DLL_HALT_PCT)
FORCE-CLOSE all positions at 95% (env: DLL_FORCE_CLOSE_PCT)
Reset at session boundary
```

---

## §5. Scaling Plan — $250/day → $1K-5K+/day

| Phase | Scaling lever | Daily target | Account requirement |
|---|---|---|---|
| 1 | Single account + base size (6 MES) | $250-500/day | MFFU 50K eval funded |
| 2 | Risk-derived pyramid (6 → MFFU-2%-bounded cap) on one strategy | $1,000-3,000/day | Same account, accumulated profit |
| 3 | Multi-account same firm (Topstep: N accounts per user) | $2,000-5,000/day | 2-3 Topstep accounts under one user |
| 4 | Multi-firm parallel (Topstep + MFFU, DIFFERENT strategies per firm) | $3,000-7,000/day | Both firms funded; different strategy assigned to each firm |
| 5 | Family copy distribution (4 family × different strategies) | $5,000-15,000+/day household | Each family member fully onboarded |

**Mini contracts (ES/NQ/CL) are FUTURE — graduate when single account funded balance ≥ $200K.** Pass 1 Track 1 safety guard prevents accidental flip until contract_class field is set explicitly.

---

## §6. Prop Firms — Topstep + MFFU ONLY

9 legacy firms removed via migration 0097 on 2026-05-10.

### Topstep (PRIMARY)
- 2026 rules: `docs/prop-firm-rules-2026-topstep.md`
- Platform: TopstepX ONLY (January 12, 2026 lockdown — NinjaTrader/Tradovate banned)
- API: TopstepX REST + WebSocket ($14.50/mo with promo code "topstep") — **DEFERRED until operator opens account**
- Multi-account within one user: ALLOWED
- Copy trading across own accounts: ALLOWED
- Personal device only: NO VPS / VPN / remote desktop
- Trailing drawdown: EOD

### MFFU (My Funded Futures, secondary)
- 2026 rules: `docs/prop-firm-rules-2026-mffu.md`
- 80/20 payout split, bi-weekly payouts
- Collaborative trading BAN: 2+ accounts running identical/opposite strategies → ban
- Same-device BAN: family members on shared computer → ban
- Hedging BAN: MNQ + NQ simultaneously = same underlying = violation
- 2% price limit: max 2% account loss per single trade
- Tier 1 economic data: restricted trading (FOMC, CPI, NFP, GDP, ISM, PPI)

### CI lint
`npm run check:2026-compliance` — fails if `firm_config.py` or compliance gates drift from canonical 2026 docs.

---

## §7. Execution Layer

### Current path
```
Strategy fires signal → Pine alert (TradingView) → TradersPost webhook →
broker login → MFFU/Topstep account
```

### Future path (when operator opens Topstep account)
```
Strategy fires signal → broker-router → TopstepX REST/WebSocket API →
Topstep account (direct, no TradersPost middleware)
```

### Broker abstraction layer
`src/server/services/broker-router.ts` is the SINGLE SOURCE OF TRUTH for order routing. Today: TradersPost path active, TopstepX returns stub.

### Per-account broker mapping
`broker_accounts` table maps each account_id → firm_id + broker_type + Bitwarden vault ref. `instance_config.enabled_firms` controls which firms an instance allows.

---

## §8. Paper Testing — TradingView is the Bot's Eye

Every new strategy paper-trades through TradingView's Strategy() panel for 3-5 days before going live.

**Paper-trading workflow:**
1. Load assigned `.pine` file into TradingView chart for the strategy's symbol + timeframe
2. Configure alert webhook to TradersPost (Once Per Bar Close frequency)
3. TradersPost routes orders to PAPER account (not funded)
4. Watch Strategy() panel for 3-5 trading days
5. Compare Strategy Tester P&L vs TradersPost paper account P&L (should match within 1-2 ticks)
6. After 3-5 clean days → flip TradersPost destination from paper to funded account

---

## §9. Family Distribution

### Architecture
Each family member runs independent stack: own TradingView Premium, own TradersPost, own prop firm account, own personal device (same-device BAN).

### Strategy assignment rules
- Operator assigns DIFFERENT strategy per family member running on the same firm (MFFU collaborative-trading compliance)
- Topstep multi-account exception: operator's own Topstep accounts running same strategy is ALLOWED
- `account_strategy_assignments` table enforces UNIQUE(account_id, strategy_id)

### Per-recipient Pine
- Pine compiler generates per-recipient `.pine` with `qty` pre-substituted + HMAC secret embedded
- HMAC secret persists in `account_strategy_assignments.hmac_secret` (idempotent per account+strategy pair)
- Artifact storage: DB (table `strategy_export_artifacts`), not filesystem
- Download endpoint: `GET /api/pine-export/:exportId/artifacts/:artifactId/download`

### Onboarding docs
- `docs/family-onboarding-runbook.md`, `docs/family-onboarding-checklist.md`, `docs/family-monitoring-guide.md`, `docs/strategy-update-runbook.md`, `docs/family-2026-rules-cheatsheet.md`

---

## §10. System Map = Source of Truth

`Trading Forge System Map v2.md` is canonical for all subsystem details.

### Mandate after any architectural change
1. `npm run system-map:sync`
2. `npm run system-map:check` (CI gate — must exit 0)
3. Update `docs/system-readiness.generated.json` + `docs/system-topology.generated.json`
4. Write audit_log row: `action: "system_map.synced"`

**No track is complete until System Map sync passes.**

---

## §10b. AGENT-LOGS.md Write Mandate (HARD RULE)

`AGENT-LOGS.md` is the project's session-by-session memory. **Every agent must append a session-log entry before ending its session.**

### Entry format
Place new entries **above** the `## Known-Facts Pin — Stop Misdiagnosing These` section.

```markdown
### Session Log — YYYY-MM-DD <short title>

**Mission:** <one sentence>
**Work completed:** <bullets>
**Verification:** <test runs, validator output, live checks>
**Known-facts updates:** <only when you pinned a new fact>
**Carry-forward for next session:** <unfinished, blocked, follow-ups>
```

---

## §11. Claude Code Team Mode

### Skills invoked for any plan execution
- `superpowers:executing-plans`, `superpowers:dispatching-parallel-agents`, `superpowers:subagent-driven-development`, `superpowers:test-driven-development`, `superpowers:verification-before-completion`, `superpowers:requesting-code-review`

### Subagent assignments (4-pass execution pattern)
| Subagent | Charter |
|---|---|
| `backtest-core` | DSL compiler, Python engine, schema validation, golden fixtures |
| `paper-parity` | Paper execution service, lifecycle wiring, broker integration, kill switches |
| `pine-export` | Pine compiler, per-recipient export, TradingView artifact delivery |
| `observability-reliability` | Tracing, audit_log, SSE, alerting, reconciliation, drift, autopilot |
| `trading-forge-architect` | Cross-cutting integrity, contract enforcement, System Map sync (LAST per track) |
| `quantum-challenger` | Quantum modules, challenger-only governance |
| `n8n-orchestration` | n8n workflow integrity, drift detector, retry/idempotency hardening |
| `critic-optimizer` | Critic loop, bounded refinement, calibration harness |

### Coordination rules
1. Sequential subagents within a track when dependencies exist (migration → service → route → frontend)
2. Parallel subagents across tracks within a pass when independent
3. `trading-forge-architect` runs LAST per track
4. `observability-reliability` runs after EVERY pass
5. Parent claude reviews each subagent output before approving merge

---

## §12. Hard Gates — Don't Bypass

| Gate | Stage | What it catches |
|---|---|---|
| **C9 DSL Diversity** | pre-backtest | LLM mode collapse |
| **A4 Frankenstein** | TESTING → PAPER | Curve-fit luck via N-shuffle |
| **A7 Signal Correlation** | PAPER → DEPLOY_READY | Duplicate-signal failure |
| **B10 MRP** | PAPER → DEPLOY_READY (soft) | Regime-conditional fragility |
| **A14 Black Swan** | PAPER → DEPLOY_READY (Phase 0 advisory) | Unseen-regime fragility |
| **B14 Survival Twin** | PAPER → DEPLOY_READY (Phase 0 advisory) | Per-firm payout-denial / ban risk |
| **C11 Macro Gates** | paper signal | Crisis regime + ISM/RRP stress |
| **C1 CME Outage** | live execution | Block new entries during halts |
| **C2 Firm Suspension** | live execution | Per-firm block on suspension |
| **C8 Windows Reboot** | 8 AM ET pre-market | Pre-market PAUSE if reboot pending |
| **Production Mode Halt** | every openPosition | `killSwitch.isHaltedForProduction()` — FIRST gate |
| **Style C Exit Skip** | every signal | Skip if structural stop > ceiling |
| **2026 Compliance** | every entry | 2% rule, HFT limit, simultaneous-limit-price, MFFU hedging ban |
| **Validation Cadence RED** | infra work approval | No new infra while panel RED |
| **DSL Quality Critic (W23F.K + W23F.L)** | graduation | Anti-pattern matches; engine-aware look-ahead; factory conventions pre-filter |
| **Auditor (W23F live-fix)** | graduation | Schema invariants; accepts both `risk_derived_pyramid` and legacy `profit_tier_pyramid` |

---

## §13. Don't (organized by category)

### Data
- Don't backtest on raw/unadjusted continuous contracts — use `ratio_adj/` data
- Don't use Pandas for data loading — Polars only; convert to Pandas at vectorbt boundary
- Don't pass slippage/fees to vectorbt for futures — compute P&L manually
- Don't model slippage as a constant — it's a function of volatility + session

### Execution
- Don't use fixed-point stops on MES (10pt/12pt/etc) — structural with ATR bounds. Floor 1.5×ATR, ceiling 14pt. Skip if exceeded.
- Don't use stop-market orders — use stop-limit
- Don't trade through FOMC/CPI/NFP without `bypass_news_blackout=true` opt-in
- Don't pyramid into winners (Style B) — wrong distribution
- Don't trip kill switch at 95% of firm DLL — 67% leaves buffer
- Don't bypass `routeOrder()` — every order flows through broker-router

### Compliance
- Don't simulate strategies against a firm without loading the firm's 2026 rules doc first
- Don't ignore firm contract caps in backtests
- Don't flip symbol from MES → ES (or micro→mini) without `contract_class="mini"` + mini specs migration. CONTRACT_SPECS use MICRO point values; flipping causes 10x silent risk inflation.
- Don't deploy without preferred regime tag

### Operations
- Don't trigger cloud quantum on auto-triggered backtest runs — cloud is opt-in only
- Don't bypass `pipelineGate()` on lifecycle-mutating crons
- Don't import research-side modules into `src/server/production/*` — CI lint enforces
- Don't bypass `killSwitch.isHaltedForProduction()` — FIRST gate in any new entry path
- Don't bypass `dead-mans-heartbeat-check`
- Don't disable `bitwarden-session-refresh-daily`
- Don't auto-promote Tier 2/3 in operator-absent mode — only Tier 1 qualifies
- Don't create fire-and-forget runs without a pending DB row
- Don't store secrets in code — use `.env` or Bitwarden vault
- Don't commit the `data/` directory — gitignored, lives in S3

### Family Distribution
- Don't assign same strategy to 2+ family members on the same MFFU firm
- Don't hardcode firm allowlists — read from `instance_config.enabled_firms`
- Don't regenerate HMAC secrets per Pine export — must be idempotent per `(account_id, strategy_id)`
- Don't share Pine source code with anyone outside the family
- Don't run the bot from a VPN/VPS — Topstep + MFFU both ban this

### Architecture
- Don't add Supabase or complex auth — single operator, no SaaS
- Don't over-engineer — MVP each phase, iterate
- Don't generate complex strategies — max 5 parameters
- Don't optimize parameters to find "the best" — test robustness across a wide range
- Don't add backwards-compat hacks unless explicitly required
- **Don't use `sql\`col = ANY(${jsArray})\`` for Drizzle array filters** — use `inArray(col, array)` instead
- **Don't reintroduce Style D** — Wave 23 canonical is Style C 33/33/33. No styleD key in framework-overlay.ts.
- **Don't use single global liquidity cap** — per-symbol (MES 100 / MNQ 50 / MCL 30). Override per-strategy only with evidence.
- **Don't write hit-rate / win-rate targets in spec** — win rate is OBSERVED output, never a design parameter. Gates measure expectancy/PF/Sharpe/regime survival, all hit-rate-agnostic.
- **Don't preserve LLM-extracted sizing values in framework overlay** — overlay is AUTHORITATIVE, replaces scout-extracted base/tier/cap with operator-canonical Wave 23 values.

---

## §14. Commands

```bash
# Development
npm run dev                              # Start Express server with hot reload
npm run db:generate                      # Generate Drizzle migration
npm run db:migrate                       # Run migrations
npm run db:studio                        # Open Drizzle Studio
npm test                                 # vitest
npm run lint                             # ESLint

# CI hard gates (must all pass)
npm run check:production-isolation       # Production code can't import research
npm run check:2026-compliance            # firm_config matches canonical 2026 docs
npm run system-map:check                 # System Map drift detection

# Architectural
npm run system-map:sync                  # Regenerate System Map after changes

# n8n
npm run audit:n8n                        # n8n drift detector
```

---

## §15. Tech Stack

- **API Server:** Express.js 5 + TypeScript (`src/server/`)
- **Database:** PostgreSQL on Railway + Drizzle ORM (`src/server/db/schema.ts`)
- **Backtest Engine:** Python + vectorbt + Polars + DuckDB (`src/engine/`)
- **AI Agents:** TypeScript + Ollama (qwen3-coder:30b, deepseek-r1:14b) + GPT-5-mini (cloud)
- **Orchestration:** n8n on Railway since Pass 21 — `https://n8n-production-84ff.up.railway.app`
- **Data Lake:** AWS S3 (Parquet, ratio-adjusted continuous contracts)
- **Dashboard:** React + Vite + TailwindCSS (`Trading_forge_frontend/amber-vision-main/`)
- **Data Providers:** Databento (historical), Massive (real-time WS), Alpha Vantage (indicators + sentiment)
- **Execution:** TradingView Premium → TradersPost → MFFU/Topstep (current); TopstepX API direct (future)
- **Hosting:** Hybrid — Skytech tower (Ollama + Python backtest + NSSM services) + Railway (Postgres + n8n + tf-relay)
- **Quantum:** IBM Quantum Platform + AWS Braket (challenger-only Phase 0)

## §15a. Hosting Topology (Pass 21, 2026-05-12)

```
┌─────────────────────────────────┐         ┌──────────────────────────────────┐
│ SKYTECH TOWER (home, 24/7)      │         │ RAILWAY (cloud, 99.95% SLA)      │
│                                 │         │                                  │
│  • NSSM TradingForgeAPI :4000   │────────▶│  • n8n service                   │
│  • Ollama (qwen3 + deepseek)    │         │  • Postgres                      │
│  • Python backtest engine       │         │  • tf-relay service              │
│  • DuckDB + Polars              │   WSS   │                                  │
│  tower-relay-client.cjs       ──┼────────▶│      forwards HTTP frames        │
└─────────────────────────────────┘  HTTP   └──────────────────────────────────┘
```

**Required env vars (tower-side .env):**
```
N8N_BASE_URL=https://n8n-production-84ff.up.railway.app
TF_N8N_API_KEY=<JWT from n8n Settings → API>
TF_BACKEND_PUBLIC_URL=https://tf-relay-production.up.railway.app
```

**Pinned facts:**
- n8n on Railway requires `PORT=5678`
- Same `N8N_ENCRYPTION_KEY` as the previous local install
- Cloudflare Quick Tunnel URLs are DEPRECATED — use stable `tf-relay` service
- Tower relay client logs: `C:\Users\tonio\bin\tower-relay-client.log`
- Relay singleton — second client connection force-closes the older one
- `RELAY_TOKEN` must match between Railway env and tower client env

---

> **Living rules end here.** For build history, see `AGENT-LOGS.md`. For subsystem architecture, see `Trading Forge System Map v2.md`. For agent contract, see `AGENTS.md`.
