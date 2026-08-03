# SCOUT — Reference-Interpreter / Differential-Oracle FIT against actual Trading Forge code

**Seat:** architecture scout (read-only). **Date:** 2026-08-02.
**Question source:** `docs/research/RESEARCH-VELOCITY-TOPSTEPX-2026-08-03.md` §1.2 / §1.6 / §1.8 (CAMPAIGN tree).
**Mandate:** close the architecture-to-code mapping the researcher never opened, or report honestly that it cannot be closed.
**Constraint discipline:** read-only. No file written except this one. No `git` mutation of any kind. `runtime-production` never opened.

## TREE LEGEND — every finding below carries one of these two labels

| label | path | branch | HEAD |
|---|---|---|---|
| **CAMPAIGN** | `C:/Users/tonio/Projects/wt-h1-wave4-20260712` | `h1-wave4-sealed12-driver` | `86146315` |
| **MAIN** | `C:/Users/tonio/Projects/trading-forge/trading-forge` | `hardening/phase-0` | `c766f468` |

`[MEASURED HERE, CAMPAIGN, git rev-parse]`. Both are checkouts of the same repository on different branches.

**Tree divergence on the load-bearing surfaces** `[MEASURED HERE, both trees, diff --strip-trailing-cr]` — a raw `cmp` reported all 14 files as differing; that was **my instrument, not the artifacts** (CRLF vs LF). Re-measured with CR stripped:

| file | verdict |
|---|---|
| `src/engine/compiler/compiler.py` | SAME modulo CR |
| `src/engine/compiler/strategy_schema.py` | SAME modulo CR |
| `src/engine/signals.py` | SAME modulo CR |
| `src/server/lib/dsl-compiler.ts` | SAME modulo CR |
| `src/engine/parity_engine/diff_harness.py` | SAME modulo CR |
| `src/engine/parity_engine/shadow_runner.py` | SAME modulo CR |
| `src/engine/invariant_harness/core.py` | SAME modulo CR |
| `src/engine/config.py` | REAL DIFF, 6 lines |
| `src/server/db/schema.ts` | REAL DIFF, 74 lines |
| `src/server/lib/spec-family-bindings.ts` | REAL DIFF, 145 lines |
| `scripts/check-spec-binding-plan-parity.ts` | REAL DIFF, 252 lines |
| `src/engine/spec_condition_compiler.py` | REAL DIFF, 581 lines (MAIN 876 / CAMPAIGN 1435) |
| `src/engine/backtester.py` | REAL DIFF, 689 lines (MAIN 8637 / CAMPAIGN 8536) |
| `src/engine/spec_family_bindings.py` | REAL DIFF, 2197 lines (MAIN 744 / CAMPAIGN 2907) |

**Consequence for the desk:** the DSL compiler, the expression evaluator, the parity engine and the invariant harness are the *same code in both trees*. The **Tier-A spec-compiler lane is CAMPAIGN-only in substance** — MAIN's `spec_family_bindings.py` is 744 lines against CAMPAIGN's 2907. Any oracle scoped to the Tier-A lane must be measured in CAMPAIGN; a number taken from MAIN would be a number about a different compiler.

---

## VERDICT

**PARTIALLY FITS — and the fit is much further along than the research assumed, but wired to the wrong left-hand side.** There *is* a structured, serialisable IR (two of them, at different layers, both persisted as JSON in `strategies.config`), and there *is* a per-trade record rich enough for PineForge-grade trade-for-trade diffing (entry/exit price, bar index, direction, P&L, exit reason) — so the pattern is not blocked on either precondition. More importantly, **a differential-parity shadow lane already exists and is already wired into the production backtest path with full audit/Discord/SSE observability** (`src/engine/parity_engine/`, `PARITY_SHADOW_ENABLED`). It does not deliver the research's benefit for one measured reason: `diff_harness.py:19-21` deliberately refuses to import the production engine, so the shadow diffs *a minimal re-implementation* against *backtrader* — the production trade list is never one of the two sides (`grep` for any read of `trades` inside `parity_engine/` returns nothing, positive control passes). **The blocking unknown is not "is there an IR" — it is whether an independent second implementation can be made independent enough to avoid the failure the campaign has already suffered once.** `P0-VNEXT-DESIGN-2026-08-01.md` §0 records it verbatim: *"the parity gate's historic failure mode — AR-499 §2: both lanes over-refusing identically while the gate printed EXIT 0 · PASS."* That is correlated failure of two peer implementations producing a false green — the exact hazard a reference-interpreter oracle is supposed to eliminate, already realised in-house. Secondarily: identical IR does **not** currently imply identical trades (27 env vars in `backtester.py`, a Python module-level strategy registry that silently bypasses the entire 7-layer gate, and a run receipt that fingerprints no env), so "diff two implementations of the same IR" is not yet a well-posed comparison. Neither of those two unknowns is resolvable from the artifacts — they are desk decisions.

---

## PART 1 — IS THERE AN INTERMEDIATE REPRESENTATION AT ALL?

### YES. There are TWO, at different layers, both structured and serialisable JSON.

**Lane A — DSL / archetype IR: `StrategyConfig` inside `BacktestRequest`.**
`[MEASURED HERE, CAMPAIGN]`
- `src/engine/config.py:440` `class StrategyConfig(BaseModel)` — fields at `:441-478`: `name`, `symbol`, `timeframe`, `indicators: list[IndicatorConfig]`, `entry_long: str`, `entry_short: str`, `exit: str`, `stop_loss: StopConfig`, `take_profit`, `position_size: PositionSizeConfig`, `overnight_hold`, `preferred_regime`, `fill_rate`, `spread_multiplier`, `bias_timeframe`, `bias_condition`, `allowed_entry_windows`.
- `src/engine/config.py:610` `class BacktestRequest(BaseModel)` — the run envelope: `strategy: StrategyConfig`, `start_date`, `end_date`, `slippage_ticks`, `commission_per_side`, `mode`, `walk_forward_splits`, `embargo_bars`, `max_trades_per_day`, `firm_key`, `event_calendar`, `fill_model`, `vix_now`, `top3_depth_ratio`, `exit_engine`, `adaptive_exit_context`, `trial_n_total`.
- Entry point is `python backtester.py --config <json>` (`src/engine/backtester.py:4-5` docstring; `main()` at `:8063`). So the IR crosses the Node→Python boundary **as a JSON file/string** — already inspectable, already serialisable, already the actual production contract.
- **Producer:** `src/server/lib/dsl-compiler.ts:271` `compileDslToEngine()` and `:692` `compileDslWithConfluence()`, returning `interface CompiledStrategy { indicators, entry_long, entry_short, compileNotes, mtfUnsupported?, compiler_warnings? }` (`:79-93`). **Wired:** non-test caller at `src/server/services/direct-bucket-graduator.ts:2206` (`const compiledEngine = compileDslWithConfluence(compileInput)`), imported at `:33`. `[MEASURED HERE, CAMPAIGN]`
- **Persisted:** `strategies.config` JSONB — `src/server/db/schema.ts:66` `config: jsonb("config").notNull(), // Full strategy definition JSON`. `[MEASURED HERE, CAMPAIGN]`

**Lane B — Tier-A spec IR: the `compiled_spec` dict. This is the Phase-1 lane's IR.**
`[MEASURED HERE, CAMPAIGN]`
- **Producer:** `src/server/services/spec-onboarding-service.ts:666` `compiled_spec: { video, spec_hash, graph_canonical_hash, ledger_d, spec, exit_provenance?, binding_plan_summary? }`, nested inside `finalConfig` at `:663-690` which becomes `strategies.config`.
- **Consumer:** `src/engine/backtester.py:8199` `elif isinstance(config, dict) and config.get("compiled_spec"):` → `:8208` `from src.engine.spec_condition_compiler import from_compiled_spec` → `:8220` `strategy = from_compiled_spec(config["compiled_spec"], ...)`.
- **The executable:** `src/engine/spec_condition_compiler.py:1408` `def from_compiled_spec(...) -> SpecConditionStrategy`; `:305` `class SpecConditionStrategy(BaseStrategy)`.
- Critically, `spec-onboarding-service.ts:673-676` states the contract in its own comment: *"the Python engine recomputes the full plan itself at backtest time via `spec_family_bindings.compile_binding_plan` — this summary is for fast operator/audit inspection without a recompute."* So `binding_plan_summary` is **not authoritative**; the TS side and the Python side each compute the plan. That is why a TS↔Python parity script exists, and it is the object the whole P0 chain is qualifying.

### The `spec → code with no inspectable IR` risk does NOT apply, but ONE named compiler is dead code

`src/engine/compiler/compiler.py:41` `def compile_to_backtest(dsl: StrategyDSL) -> dict` looks like the answer and **is not**. `[MEASURED HERE, BOTH TREES]` — every reference outside its own module is a test or its own CLI:
- CAMPAIGN: `compiler.py:200` (own CLI `--action compile`), `src/engine/strategies/dsl_fixtures/__tests__/test_dsl_fixtures.py:82`, `src/engine/tests/test_b3_archetypes.py:115`, `src/engine/tests/test_compiler.py:223,240,248,256,262,270,277`.
- MAIN: identical set.
- **Positive control on the same surface, same query:** the analogous search for `compileDslToEngine` *did* find a live non-test caller (`direct-bucket-graduator.ts:2206`). So the caller search works; the absence for `compile_to_backtest` is real, not a query failure.
- `AGENT-LOGS.md:5820` (CAMPAIGN) independently records the same fact — treat as `ARTIFACT-SOURCED` corroboration only; the `file:line` grep above is the measurement.

**Do not build a reference interpreter for `compile_to_backtest`'s output.** It is a plausible-looking, well-documented, unreachable surface. An oracle built against it would be green forever and mean nothing.

### The IR is a HYBRID, and that is the single most important structural fact for Part 2

`src/engine/config.py:445-447`: `entry_long: str`, `entry_short: str`, `exit: str`. `[MEASURED HERE, CAMPAIGN]` The signal logic is **not** a structured tree — it is an expression **string** in a small DSL (`"ema_9 crosses_above ema_21 AND rsi_14 < 30"`), interpreted at runtime by `src/engine/signals.py:202` `evaluate_expression()`. Everything else (indicators, stops, sizing, windows) is structured Pydantic.

---

## PART 2 — COULD A DELIBERATELY-SIMPLE REFERENCE INTERPRETER EXECUTE IT?

### The signal layer: YES, and it is already deliberately simple

`src/engine/signals.py` is **306 lines total** `[MEASURED HERE, CAMPAIGN, wc -l]`, pure Polars, imports only `re`, `typing`, `polars`, and `StrategyConfig`. Grammar surface is fully enumerable from the executable lines: `_COMPARISON_OPS` `>=,<=,>,<,==` (`:61-68`), `crosses_above` / `crosses_below` (`:44,53`), `AND`/`OR`/`NOT` with paren-depth-aware splitting (`:160` `_split_at_depth0`, `:235` NOT, `:241-253`), chained-comparison rejection (`:135-141`), numeric-literal-or-column operand resolution (`:27`). `generate_signals()` (`:259`) emits exactly four boolean columns: `entry_long, entry_short, exit_long, exit_short` (`:301-306`). A second implementation of *this* is a genuinely small, obviously-correct artifact.

### The execution model: NO — and this is where the pattern's cost actually lives

Measured spans in `src/engine/backtester.py`, CAMPAIGN `[MEASURED HERE, computed by walking top-level `def` boundaries]`:

| function | line span | size |
|---|---|---|
| `run_backtest` | 3625 → 6152 | **2527 lines** |
| `run_class_backtest` | 6541 → 8003 | **1462 lines** |
| `_apply_static_styleC_management` (**the default exit engine**) | 1285 → 1796 | 511 lines |
| `_apply_adaptive_management` | 1796 → 2197 | 401 lines |
| `apply_eligibility_gate` | 247 → 545 | 298 lines |
| `_apply_backtest_parity_gates` | 640 → 938 | 298 lines |
| `_apply_dsl_stop_loss_and_time_stop` | 3206 → 3487 | 281 lines |
| `_apply_stop_only_management` | 1047 → 1188 | 141 lines |
| `_apply_naked_management` | 938 → 1047 | 109 lines |
| `_apply_trade_management` (dispatcher) | 1188 → 1285 | 97 lines |

Plus, all CAMPAIGN, `wc -l`: `src/engine/indicators/core.py` 860 · `src/engine/sizing.py` 1340 · `src/engine/slippage.py` 164 · `src/engine/prop_sim.py` 547 · `src/engine/fill_model.py` 628 · the seven `src/engine/context/*` modules the eligibility gate imports = **3301 lines** (`bias_engine.py` 1401, `playbook_router.py` 457, `structural_targets.py` 332, `session_context.py` 301, `eligibility_gate.py` 296, `structural_stops.py` 294, `location_score.py` 220).

A reference interpreter aiming at **trade-for-trade** parity would have to model, at minimum: bar iteration; the next-bar fill convention (`backtester.py:70-101` — signals shifted forward one bar by `np.roll()`, and the comment at `:88-101` declares this a cross-service contract with `anti-pattern-catalog.md` §3); the 4-way exit-engine dispatch (`naked` / `stop_only` / `static_styleC` / `adaptive`); intrabar stop/TP trigger-price resolution including gap-through-stop override (`:5058-5086`, the "C4" path that *replaces* vectorbt's bar-close exit prices); structural-vs-ATR stop basis with per-symbol ceilings (`_resolve_stop_risk_points` `:2984`, `_get_stop_ceiling_for_symbol` `:2921`); position sizing incl. `risk_derived_pyramid` tiers (`config.py:362-435`); per-bar session-multiplied slippage, symmetric on exit; commission per side per firm; roll-spread cost on rollover days, entry- and exit-side, de-duplicated for same-bar round trips (`:5180-5224`); `max_trades_per_day` (`:2756`); DLL halt (`:3487`); allowed entry windows; 15:55 ET flatten (`:220`); DST-correct ET hour derivation (`:123,162`); multi-timeframe HTF joins with mandatory `shift(1)` (`:103-122` convention block, `shift_higher_tf_columns` `:2197`); and the 7-layer eligibility overlay.

### Not self-contained — THREE measured reach-ins that break "same IR ⇒ same trades"

1. **Ambient environment.** 35 `os.environ` accesses in `backtester.py`, 27 distinct variable names `[MEASURED HERE, CAMPAIGN, grep -c / grep -o | sort -u]`, including `BACKTEST_MAX_HOLD_BARS`, `BACKTEST_STATIC_C_PARTIALS_ENABLED`, `BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED`, `BACKTEST_EXIT_SLIPPAGE_SYMMETRIC`, `DLL_HALT_PCT`, `TF_CONFLUENCE_OVERLAY_DISABLED`, `TF_OVERLAY_DISABLE_LAYERS`, `TF_BACKTEST_SKIP_MODE`, `TF_BACKTEST_ANTI_SETUP_MODE`, `STOP_CHANDELIER_MULTIPLIER_TRENDING`. `spec_condition_compiler.py` reads 10 distinct `TF_*` flags; `spec_family_bindings.py` reads 9. And the bridge passes the *entire server environment* through: `src/server/lib/python-runner.ts:388` `env: { ...process.env, ...deterministicEnv }`.
2. **A Python module-level registry silently disables the whole overlay.** `backtester.py:318-323`: `from src.engine.context.playbook_router import ALL_STRATS` … `if strat_normalized and strat_normalized not in all_normalized: gate_stats["mode"] = "passthrough_strategy_unregistered"; return entry_signals, exit_signals, gate_stats`. The 7-layer gate is bypassed based on a name-normalisation match against a list that lives in Python source, not in the IR. The in-code comment at `:309-316` records that this exact condition previously produced `gate_stats` blobs indistinguishable from a genuine overlay run.
3. **Per-instance disk reads.** `spec_condition_compiler.py` `__init__` resolves `role_demotion_mode()` and, when not `"off"`, calls `get_classifications_for_video(...)` — an audited on-disk map keyed by video.

**And the run receipt does not fingerprint any of it.** `_build_run_receipt` (`backtester.py:2691-2753`) emits `engine_version`, `git_commit`, `code_hash`, `config_hash`, `dataset_hash`, `random_seed`, `numpy/polars/python` versions, `timestamp_utc`, `determinism_verified`, `determinism_verification_requested`. **No environment fingerprint.** `[MEASURED HERE, CAMPAIGN, full function read]` Two runs of a byte-identical IR under different `TF_*`/`BACKTEST_*` settings produce different trades and *identical receipts modulo timestamp*. HYPOTHESIS (flagged, not measured): this makes a differential-diff finding non-attributable — a disagreement could be a compiler bug or an env skew, and the receipt cannot tell you which.

**Honest scope note.** A reference interpreter restricted to *signal generation* (does bar N fire?) is small and buildable. A reference interpreter delivering *PineForge-grade trade-for-trade parity* must reproduce the P&L/exit/sizing model, which is where ~4000+ lines of deliberate, incident-driven futures-specific logic lives. Those are two different projects with two different qualification burdens. The research does not distinguish them; the desk must.

---

## PART 3 — WHAT IS THE DIFFABLE SURFACE?

### In memory / stdout: YES, and it is a superset of PineForge's diff key

`[MEASURED HERE, CAMPAIGN]` `src/engine/backtester.py:5043` `trades_list: list[dict] = []`; each record built at `:5231-5311`; appended `:5312`; emitted as `result["trades"]` at `:5721`. Class-based path mirrors this at `:7290`.

Fields on each record:
- From vectorbt `pf.trades.records_readable` (`:5020`), consumed at `:5119-5121`: `Avg Entry Price`, `Avg Exit Price`, `Size`, `Direction`, `Entry Timestamp`, `Exit Timestamp`.
- **Bar indices, engine-added and integrity-checked:** `:5023-5037` maps timestamps→bar index and *raises* `"CRITICAL: {n} trade timestamps unmapped to bar indices"` on any miss → `Entry Idx`, `Exit Idx`.
- Engine-added at `:5240-5257`: `Avg Exit Price` (managed override), `exit_reason`, `PnL`, `GrossPnL`, `SlippageCost`, `CommissionCost`, `RollSpreadCost`, `entry_idx`, `entry_timestamp`.
- Engine-added at `:5279-5303`: `stop_basis`, `rr`, `mae`, `mfe`.

PineForge's diff key was *entry/exit price, bar index, P&L*. This record carries all three **plus direction, size, exit reason, stop basis and cost decomposition** — a strictly richer trade-for-trade join. Trades are **not** merely summarised into metrics.

### At the DB boundary: LOSSY — bar-index alignment is destroyed

`[MEASURED HERE, CAMPAIGN]`
- `src/server/db/schema.ts:300-337` `backtest_trades`: `entryTime`, `exitTime`, `direction`, `entryPrice`, `exitPrice`, `pnl`, `netPnl`, `contracts`, `commission`, `grossPnl`, `slippage`, `mae`, `mfe`, plus enrichment columns. **No bar-index column. No `exit_reason`. No `stop_basis`. No `rr`. No `RollSpreadCost`.**
- `src/server/services/backtest-service.ts:904-953` builds the rows; insert at `:1119` `await tx.insert(backtestTrades).values(tradeRows)`.
- The load-bearing defect is `:912-917`:
  ```ts
  const parseTs = (v: unknown): Date => {
    if (v == null) return new Date();
    if (typeof v === "string" && v.includes("-")) return new Date(v);
    // Integer index from vectorbt — use backtest start date + offset
    return config.start_date ? new Date(config.start_date + "T00:00:00Z") : new Date();
  };
  ```
  The comment says "start date + offset"; the executable line adds **no offset**. If `Entry Timestamp` arrives as an integer index, **every trade in the run collapses to the same `entry_time`** and the diff loses its join key entirely. `[MEASURED HERE — read the executable line, not the comment]`
- One consumer additionally truncates: `backtest-service.ts:2239` `trades: result.trades?.slice(0, 200) ?? []`.

**Practical consequence:** trade-for-trade diffing is viable against the **stdout JSON / in-process `result` dict**, not against `backtest_trades`. Any oracle designed to replay from the DB would be diffing a degraded surface.

### A persisted signal-level diff surface already exists and is already consumed

`[MEASURED HERE, CAMPAIGN]` `backtester.py:6152` `_build_expected_signals_from_trades()` → shape `{signal_ts, direction, entry_price, intended_size}` (`:6211-6216`), populated into `result["expected_signals"]` by `_emit_validated_result` (`:6239` docstring, `:6258`), persisted to `backtests.result_extras.expected_signals`, and consumed as the baseline by the SHADOW→PAPER divergence gate (`shadow-signal-divergence-checker.ts::ExpectedSignal`, named at `:6160`). This is a working, persisted, cross-lane differential contract at signal granularity — weaker than trade-for-trade, stronger than summary metrics.

### No golden trade-list corpus exists

`[MEASURED HERE, CAMPAIGN, absence claim with two positive controls]`
- `grep -rl "Avg Entry Price" --include=*.json .` (node_modules excluded) → **no matches**.
- **Positive control 1, same surface + same glob:** `grep -rl "entry_indicator" --include=*.json .` → 5+ matches (`docs/designs/corpus-v2-mode-ab-strategies.json`, `mode_ab_G4_phase1_non1m.json`, …). The JSON-restricted search works.
- **Positive control 2, same string, no glob:** `grep -rl "Avg Entry Price" .` → 8+ matches, all `.py` (`src/engine/backtester.py`, `src/engine/sanity_checks.py`, `scripts/h5_structural_stop_parity_ab_report.py`, several tests). The string is findable.
- `tests/python/golden/` contains exactly 3 files: `pine_compiler_sma_cross.json` (keys: `exportability`, `artifacts`, `strategy_name`, `pine_version`, `content_hash` — Pine export artifacts, **no trades**), `quantum_mc_breach.json`, `sqa_optimizer_params.json`.
- `src/engine/strategies/dsl_fixtures/` holds **10 strategy JSON fixtures** (`archetype_bounce_off_level`, `archetype_gann_box_4h_continuation`, `archetype_silver_bullet`, `heavy_mcl`, `news_fade_mcl`, `opening_range_breakout_mes`, `overnight_drift_mes`, `range_fade_mnq`, `scalper_mes`, `trend_mnq`) plus `uncatalogued_fake_speaker_term.json`. **Corpus scale reference: PineForge used 246 strategies / 375,000+ trades.**
- `src/engine/tests/test_exit_policy_replay.py` (608 lines) is *not* a golden corpus — it unit-tests the management functions with in-code fixtures and states at `:22-23` that "the full `run_class_backtest` integration test is intentionally EXCLUDED from this file."

---

## PART 3b — ⚠ THE PATTERN IS ALREADY ~80% BUILT, AND WIRED TO THE WRONG LEFT-HAND SIDE

This is the finding the desk most needs and the research could not have known.

`src/engine/parity_engine/` — **identical in both trees modulo CR** `[MEASURED HERE]`:
`diff_harness.py` 561 lines · `shadow_runner.py` 452 · `backtrader_adapter.py` 393 · `__init__.py` 10.

**What it does:** `diff_harness.py:1-7` — *"runs same fixture through vectorbt and backtrader, then compares trade lists, total PnL, and Sharpe within defined tolerances."* Tolerances are explicit constants at `:71-73`: `PNL_TOLERANCE_PCT = 0.10`, `TRADE_COUNT_TOLERANCE = 1`, `SHARPE_TOLERANCE = 0.05`. It defines a first-class trade record `@dataclass VBTTrade` at `:39-49` with exactly the PineForge diff key: `entry_bar, exit_bar, entry_price, exit_price, direction, contracts, net_pnl, exit_reason`. `:12` — *"P&L is computed with futures math (never delegated to vectorbt/backtrader)"*, honouring the campaign's standing rule.

**It is wired into production.** `backtester.py:6126-6140` (DSL path) and `:8451-8464` (class path):
```python
if os.environ.get("PARITY_SHADOW_ENABLED", "false").lower() == "true":
    from src.engine.parity_engine.shadow_runner import run_parity_shadow
    shadow_report = run_parity_shadow(request, result, df)
    result["parity_shadow"] = shadow_report
    if shadow_report.get("ran") and not shadow_report.get("passed", True):
        print(f"PARITY_SHADOW_DRIFT_JSON {json.dumps(...)}", file=sys.stderr)
```

**The observability rail is complete** `[MEASURED HERE, CAMPAIGN]`: stderr sentinel → `python-runner.ts:234` `parseTruthinessSentinel()` / `:239` `{ type: "parity_shadow_drift", payload }` / `:427-428` elevation to `backtest.parity_shadow_drift_detected` / `:498` attached as `_truthiness_events` (with a chunk-straddle reassembly buffer at `:411-419` so a sentinel split across pipe chunks is not silently lost) → `backtest-service.ts:1245-1300`, which merges the stderr side-channel into `result.parity_shadow`, then classifies `parityFailed` (`ran===true && passed===false`), `parityCatastrophic` (`pnl_diff_pct > 1.0`) and `parityUnexpectedSkip` (`ran===false` with a reason other than `strategy_archetype_not_supported`), and routes to audit + Discord + SSE. `parity_shadow` is a typed persisted field (`src/server/db/jsonb-shapes.ts:230`).

**Why it does not deliver the research's benefit — three measured limits:**

1. **The production engine is not one of the two sides.** `diff_harness.py:19-21`, verbatim: *"This module does NOT import from backtester.py to avoid pulling in the full production dependency tree into the parity test. The vectorbt run here is a **minimal re-implementation** of the EMA crossover / ATR breakout signal logic."* And `run_parity_shadow` (`shadow_runner.py:333-448`) receives `result` but uses it **only** to obtain OHLCV: `:374` `df_pd = _extract_production_data(result, df)`, whose body (`:200-237`) touches only `open/high/low/close/volume` and the index. **Absence measured:** `grep -rn '"trades"\|'"'"'trades'"'"'\|\.trades' src/engine/parity_engine/` → exit 1, no matches. **Positive control, same surface, same tool:** `grep -rn "vbt_total_pnl" src/engine/parity_engine/` → 3 matches (`diff_harness.py:57,551`, `shadow_runner.py:270`). So: **it is `minimal-reimpl` vs `backtrader`, not `reference` vs `production`.** It is structurally incapable of catching a bug in `run_backtest`'s 2527 lines, `_apply_static_styleC_management`'s 511, or the C4 managed-exit override.
2. **Archetype coverage is 2.** `shadow_runner.py:40` `_SUPPORTED_ENTRY_INDICATORS: set[str] = {"ema_crossover", "atr_breakout"}`. Anything else returns `ran=False, reason="strategy_archetype_not_supported_by_parity_engine"` (`:365-371`). The Tier-A `compiled_spec` lane — the entire Phase-1 target — is out of scope by construction.
3. **Default OFF.** `shadow_runner.py:356` `enabled = os.environ.get("PARITY_SHADOW_ENABLED", "false").lower() == "true"`; `:357-358` returns `_disabled_report()`. `[MEASURED HERE — code default. Whether it is set in the executing runtime is MACHINE-BOUND and NOT MEASURED here: I did not open `runtime-production`.]`

**Adjacent assets already in place, both measured:**
- **The invariant/metamorphic layer exists and runs unconditionally.** `src/engine/invariant_harness/core.py:771` `run_invariants(result)`, called at `backtester.py:5941` and `:8418`, in a block commented *"always runs — cheap pure validation … Never env-gated"* (`:5935-5938`), serialised into `result["invariants"]` (`:5954-5960`). 12+ named invariants recompute metrics from the raw trade list and assert agreement (`core.py:11-50`) — precisely §1.5's "test the engine, not the strategy." (Instrument note: the call sites sit inside `try:` at `:5939`, so a harness throw is swallowed rather than failing the run — flagged, not adjudicated.)
  ⚠ **Measurement-discipline note against myself:** my first search for callers used `grep ... | grep -v test`, which deleted **every** `backtester.py` line because the filename contains the substring "test". I initially recorded this harness as having zero non-test callers. That was **my filter, not the code.** Re-measured without the filter. Recording it because the same filter would misgrade any Python surface in this repo.
- **Seven TS↔Python parity scripts already ship** `[MEASURED HERE, CAMPAIGN, ls scripts]`: `check-spec-binding-plan-parity.ts`, `wave26-ts-python-exit-parity.ts`, `check-ts-python-event-product-scope-parity.ts`, `check-ts-python-pm-factor-parity.ts`, `check-ts-python-tier1-parity.ts`, `check-gate-parity.mjs`, `check-pglite-ddl-parity.ts`. Two are npm-scripted (`package.json:25` `check:ts-python-exit-parity`, `:28` `check:spec-binding-plan-parity`). Differential testing is **already the campaign's dominant verification idiom** — at the decision-projection layer, never at the trade layer.
- **The mirror-pair contract is explicit.** `src/server/lib/spec-family-bindings.ts:4-20`: *"TS MIRROR of `src/engine/spec_family_bindings.py` — Ledger E parity contract … Both sides implement the SAME pure condition-family → primitive binding-plan logic … If you change `FAMILY_META`, `MIN_SPINE_BOUND_RATIO`, or `SESSION_KEYWORDS` here, you MUST change `src/engine/spec_family_bindings.py` in the SAME commit."* Note what this coupling means for oracle independence: the two "independent" implementations are **contractually required to change together**.

---

## PART 4 — WHERE WOULD IT SIT AGAINST `P0PG → P0VC → P0DG → P0I → P0IG`?

Graph read: `docs/designs/V4-PHASE1-EXECUTION-GRAPH-2026-08-02.json`, CAMPAIGN, 28 nodes, `schema_version`/`authority`/`objective`/`nodes`/`edges`. `[MEASURED HERE — node titles and acceptance text quoted from the JSON]`

| node | title | acceptance (verbatim, abridged where marked …) |
|---|---|---|
| `P0PG` | Independent grade of corrected admission prototype | "The grader independently re-plants R-543 and external AR-589 defects, runs a novel complement-first hunt, and reports SOUND or honest null with exact coverage and limitations against the corrected prototype commit." |
| `P0VC` | Close mutation validity and diagnostic ownership | "Consumes the corrected prototype and its independent grade, including honest misses and novel findings; closes only the design promises demonstrated by those artifacts, with unresolved coverage retained as explicit residuals." |
| `P0DG` | Independent design grade | "SOUND or honest-null coverage receipt against the exact design blob; novel false-green hunt included." |
| `P0I` | Implement P0-vNext instrument | "Every pre-registered mutation bites through its named catcher; clean controls remain green; CI wiring exists." |
| `P0IG` | Independent implementation grade | "Fresh re-plants plus novel attacks against the exact implementation commit; pipeline limitations named." |

### These five nodes are about a DIFFERENT LAYER than the research's oracle. It does not replace them.

The `P0-vNext` instrument is a checker over the **spec → binding-plan projection**, not over executed trades. `docs/designs/P0-VNEXT-DESIGN-2026-08-01.md` §0 defines its three claims: **A · AGREEMENT** ("TS and Python project the same value", all 301 cells), **B · FROZEN-LEDGER CONFORMANCE** (asserted cells only, 140), **C · COMPLETENESS** (fail-closed `INCOMPLETE_AUTHORITY`). §1: membership is `43` fixture-rows × `7` axes = `301` cells; §2 pins claim A's denominator at **215 unique projected fields** (multiplicity histogram `{1:172, 3:43}`, because one projected `reason` feeds three ledger axes). The axes are the binding-plan fields — `bindable`, `session_zone`, `approximation`, `primitive`, `reason` — visible as `interface ConditionBinding` at `src/server/lib/spec-family-bindings.ts:30-41`. `[ARTIFACT-SOURCED for the design text; MEASURED HERE for the TS interface]`

So: **P0 qualifies a COMPILE-TIME ADMISSION instrument** ("can this spec's conditions be bound to real primitives, and do both lanes agree?"). **The research's oracle is a RUNTIME SEMANTICS instrument** ("given a bound strategy, do two implementations produce the same trades?"). Both are needed; neither substitutes for the other. **No node in `P0PG→P0IG` becomes redundant.** The P0 chain's mutation-catcher machinery (52-record plantable manifest, `P0D`) is also the machinery that would later qualify *any* oracle, so `P0I`'s "CI wiring exists" is an enabler, not a competitor.

### ⚠⚠ The campaign has ALREADY suffered the pattern's primary failure mode. This is the decision-critical finding.

`P0-VNEXT-DESIGN-2026-08-01.md` §0, verbatim: *"**AGREEMENT IS NOT CORRECTNESS AND NEITHER IS COMPLETENESS.** The parity gate's historic failure mode — `AR-499 §2`: both lanes over-refusing identically while the gate printed `EXIT 0 · PASS` — is exactly claim A passing while claim B is unasked."* `[ARTIFACT-SOURCED, CAMPAIGN]`

That is **correlated failure of two peer implementations producing a false green**, already realised, in this codebase, at this layer. The research's §1.2 rests on the reference implementation being *independent* ("independence from the thing-under-test is what gives it oracle power"). Trading Forge's existing two lanes are not independent in that sense, and `spec-family-bindings.ts:18-20` makes the coupling a **written requirement**: change one, change the other in the same commit. HYPOTHESIS (explicitly labelled — this is a mechanism claim I have not tested): a reference interpreter authored by the same seat, from the same design document, against the same fixture corpus, would inherit the same correlated blind spots, and its green would carry the same weight as AR-499's. Whether Trading Forge can source genuine implementation independence is **UNKNOWN from the artifacts** and is the load-bearing desk question.

### Where it WOULD sit: under `FIDELITY`, which currently names no instrument

`[MEASURED HERE, CAMPAIGN, graph JSON]` `FIDELITY` — "Calibrate compile fidelity in authoritative runtime", `kind: calibration`, `phase: 1C-tier-a`, `state_at_epoch: blocked_by_BIND_P0IG`, `owner: independent verifier`, output "current Surface-B compile-fidelity calibration receipt", acceptance: *"Calibration runs on the frozen current Surface-B population in the executing runtime lineage; **P0 synthetic green is not cited as fidelity.**"*

Edges: `BIND → FIDELITY` (data, hard); `P0IG → FIDELITY` (**`type: "instrument_authority"`**, artifact "qualified P0-vNext instrument receipt"); `FIDELITY → PH1_EXIT` (gate). And `PH1_EXIT` acceptance: *"P0 instrument qualified AND at least one frozen current Tier-A spec fully bound AND compile-fidelity calibration passes."*

`FIDELITY` is therefore the only node in Phase 1 whose stated purpose is *measuring how faithfully a spec compiles in the real runtime* — and its acceptance explicitly forbids citing P0's synthetic green as fidelity, i.e. it is asking for evidence P0 by design cannot supply. **A trade-level (or signal-level) differential oracle is a candidate instrument for `FIDELITY`, sitting under it, downstream of `P0IG`'s instrument authority.** `FIDELITY` names no instrument today. ⚠ I am **not** authorised to propose graph edits and am not proposing one; this is a description of the relationship.

### Nodes whose stated purpose the pattern would make PARTIALLY redundant — FLAGGED, not adjudicated

1. **`P2` — "Freeze source-keyed truth membership."** Its *only* graph role is the edge `P2 → GBS`, `type: "oracle"`, artifact "frozen source-keyed truth membership". `[MEASURED HERE, graph JSON edges]` So the graph's oracle is a **static JSON ledger** (`docs/designs/P1-P2-TOTAL-MEMBERSHIP-2026-07-31.json@1551c7e5…`), 43 rows × 7 axes = 301 cells. An executable reference implementation would compute what that ledger asserts. Note `P2`'s acceptance is scoped to `evidence_freeze` / `read_only_evidence` and its state is `completed_f362a80b_verified_a9c0d557_guarded_43a9596e` — it is *delivered*, so "redundant" here means "its ongoing maintenance role could shift", not "its delivered work was wasted."
2. **The Gate-B hand-authored oracle authority — and its measured staleness rate is the research's thesis in this codebase's own history.** `docs/designs/BLUEPRINT-V4-DRAFT.md:694-716` requires *"An expected-results oracle **independent of both implementations**"*, currently satisfied by `docs/designs/ORACLE-AUTHORITY-ORPHAN-ZONES-2026-07-30.md` — **verified present, 16,314 bytes** `[MEASURED HERE, CAMPAIGN, ls -la]` — sha256-pinned `3494d4bb…`, with the gate required to hash the bytes before reading any oracle row (*"Echoing `ORACLE.json.authority_sha256` is an assertion, not verification"*). `:712` scopes it: *"The current oracle schema adjudicates `plan.bindings` only."* And `:718-724`, verbatim: *"**THIS PIN HAS NOW GONE STALE THREE TIMES** — `09e016fd…` (R-483 §12) → `9b708e24…` (R-484) → `3494d4bb…` (R-491) — **AND MY OWN R-489 "CORRECTION" IS THE MIDDLE ONE.** I fixed the pointer at adoption and my own R-491 amendment obsoleted my fix twenty minutes later."* Three supersessions inside roughly ten days, each load-bearing rather than cosmetic. `[ARTIFACT-SOURCED, CAMPAIGN]` **This is in-house, dated, quantified evidence of exactly the hand-authored-oracle maintenance cost §1.2/§1.8 predicts** — an executable interpreter recomputes instead of being re-pinned. It is also the strongest single argument in the whole question, and it comes from the campaign's own record, not from the literature.
3. **No conflict found.** `grep -i` over the entire graph JSON for `oracle|differential|reference interpreter|golden` yields exactly 3 hits: two `differential` (both in `P0PC`, meaning "same-source CJS-ESM differential" — module identity, not strategy semantics) and one `oracle` (the `P2 → GBS` edge type). The graph contains **no node that a strategy-semantics reference interpreter would collide with.** `[MEASURED HERE, CAMPAIGN]`

---

## RECORDED, LEFT ALONE — worker state in the campaign tree

`git status --porcelain` (CAMPAIGN) at scout time: 7 modified tracked files (`AGENT-LOGS.md`, `docs/A12-AUDIT-REPORT.md`, two `docs/replay-results/...json`, `docs/scaling-validation/cli-report-existence-test.md`, `docs/wave25-exit-engine-ab-report.md`, `src/engine/tests/test_synthetic_market_simulator.py`) plus a large untracked set under `docs/designs/`, `docs/replay-results/`. **Recorded, not touched, not staged, not stashed.**

⚠ **One brief premise did not reproduce.** The brief states `prototypes/p0-vnext-admission/` is legitimately dirty. `git status --porcelain prototypes/` returned **empty**; `git check-ignore -v prototypes/p0-vnext-admission/run.mjs` exited 1 (not ignored); `git ls-files prototypes/ | wc -l` = **22 tracked files**. So at scout time that directory is **tracked and clean** — 17 entries visible on disk incl. `run.mjs`, `source-admission.mjs`, `runtime-admission.mjs`, `red-proof.mjs`, `type-value-proof.mjs`, `module-tuple.mjs`, `membership.mjs`, `emitted-freeze.mjs`, `RESULTS-2026-08-02.md`. Either the worker has committed since the brief was written, or the edits are elsewhere. **Reporting the discrepancy; I changed nothing and did not investigate further.**

---

## COVERAGE

### Examined (all reads; zero writes outside this file; zero `git` mutations)
- `docs/research/RESEARCH-VELOCITY-TOPSTEPX-2026-08-03.md` §§1.1-1.8 in full (CAMPAIGN).
- `docs/designs/V4-PHASE1-EXECUTION-GRAPH-2026-08-02.json` — all 28 node ids/titles; full JSON for `P0D, P0P, P0PC, P0PG, P0VC, P0DG, P0I, P0IG, P1, P2, GBS, FIDELITY, PH1_EXIT`; all edges touching `FIDELITY`; regex sweep for oracle/differential/interpreter/golden (CAMPAIGN).
- `docs/designs/P0-VNEXT-DESIGN-2026-08-01.md` §§0-2 (CAMPAIGN). `docs/designs/BLUEPRINT-V4-DRAFT.md:685-725` (CAMPAIGN). `docs/designs/ORACLE-AUTHORITY-ORPHAN-ZONES-2026-07-30.md` — existence + byte count only, contents NOT read.
- Compiler surfaces, both trees: `src/engine/compiler/{compiler.py, strategy_schema.py, pattern_library.py}` (listing), `src/server/lib/dsl-compiler.ts:1-130` + exports, `src/engine/spec_condition_compiler.py:305-400,1408-1435`, `src/server/lib/spec-family-bindings.ts:1-70` + export scan, `src/engine/spec_family_bindings.py` (size + env-flag scan only).
- Engine: `src/engine/config.py:318-537,610-684`; `src/engine/signals.py` **in full**; `src/engine/backtester.py:1-122, 247-324, 2691-2756, 5020-5320, 5930-5975, 6123-6150, 6152-6226, 8199-8221, 8450-8464` + top-level `def` census + env-var census; `src/engine/invariant_harness/core.py:1-50`; `src/engine/parity_engine/{diff_harness.py:1-95, shadow_runner.py:1-120,200-240,333-452}`.
- Node/DB: `src/server/services/backtest-service.ts:880-1120, 1230-1300`; `src/server/db/schema.ts:300-337` + `strategies` config column; `src/server/lib/python-runner.ts:214-240, 360-430, 490-500`; `src/server/services/spec-onboarding-service.ts:590-705`; `src/server/services/direct-bucket-graduator.ts` (compiler call sites only).
- Corpus/CI: `src/engine/strategies/dsl_fixtures/` listing; `tests/python/golden/` listing + `pine_compiler_sma_cross.json` keys; `scripts/` parity-script listing; `package.json:25,28`; `.github/workflows/` listing.

### NOT examined — named honestly
- 🛑 **`runtime-production` — never opened.** Per constraint. Therefore **whether `PARITY_SHADOW_ENABLED`, `TF_*` or `BACKTEST_*` are actually set in the executing runtime is NOT MEASURED.** Code defaults are measured; the deployed environment is machine-bound and out of scope. LANDED ≠ RUNNING.
- The 689 changed lines of `backtester.py` between trees were **not** read line-by-line; only counted. Which specific execution-model semantics diverge between MAIN and CAMPAIGN is **UNKNOWN**.
- `spec_family_bindings.py` (CAMPAIGN 2907 lines) read only for size + env-flag names. `FAMILY_META` primitive-resolution correctness NOT assessed.
- `_apply_static_styleC_management` (511 lines) and `_apply_adaptive_management` (401) read only at their dispatch boundaries. Their internal exit semantics are **not** characterised beyond span.
- `walk_forward.py`, Monte-Carlo, prop-sim, Pine-export, paper/live surfaces: **out of scope, not opened.**
- `backtrader_adapter.py` (393 lines): existence and role from `diff_harness.py:34` import only; body not read.
- Whether any parity script is invoked by `.github/workflows/ci.yml` or `metric-snapshot.yml`: `package.json` scripts confirmed; **the workflow YAML bodies were NOT read** — CI wiring of the parity family is **UNKNOWN**.
- No command was executed that runs a backtest, a compiler, a test, or a parity script. Every number above is from static reading, `wc`, `grep`, `diff`, and `python -c` JSON parsing of committed artifacts.

### Positive controls used (every absence claim has one on the same surface)
| absence claimed | positive control on same surface | result |
|---|---|---|
| `compile_to_backtest` has no non-test caller (both trees) | same caller-search shape for `compileDslToEngine` | FOUND live caller `direct-bucket-graduator.ts:2206` → search works |
| `parity_engine/` never reads production `trades` | `grep -rn "vbt_total_pnl" src/engine/parity_engine/` | 3 matches → grep works on that surface |
| no golden trade-list JSON fixture | (a) `grep -rl "entry_indicator" --include=*.json .` → 5+ hits; (b) `grep -rl "Avg Entry Price" .` (no glob) → 8+ `.py` hits | both found → glob and string both work; absence is real |
| run receipt carries no env fingerprint | full `_build_run_receipt` body read `:2691-2753`, all 12 emitted keys enumerated | complete read, not a grep |
| graph contains no conflicting oracle node | same regex found the 2 `differential` + 1 `oracle` hits it does contain | regex works |
| — instrument self-correction — | `run_invariants` initially graded "no non-test caller"; **my `grep -v test` filter deleted every `backtester.py` line** (filename contains "test"). Re-measured without filter | **CALLED at `backtester.py:5941` and `:8418`.** Prior reading was my instrument, not the code |

---

## THE FOUR ANSWERS, CONDENSED

| # | question | answer | grade |
|---|---|---|---|
| 1 | Is there an IR? | **YES, two.** Lane A `StrategyConfig`/`BacktestRequest` at `src/engine/config.py:440,610` (CAMPAIGN), produced by `dsl-compiler.ts:271,692`, persisted `strategies.config` JSONB (`schema.ts:66`). Lane B `compiled_spec` at `spec-onboarding-service.ts:666` → `backtester.py:8199-8221` → `spec_condition_compiler.py:1408`. **The plausible-looking `compile_to_backtest` (`compiler.py:41`) is DEAD — zero non-test callers, both trees.** IR is a hybrid: structured everywhere except `entry_long/entry_short/exit`, which are expression strings (`config.py:445-447`). | MEASURED HERE |
| 2 | Could a simple reference interpreter execute it? | **Signal layer YES** — `signals.py` is 306 self-contained lines. **Execution model NO at trade-for-trade fidelity** — `run_backtest` 2527 lines, default exit engine 511, eligibility gate 298 + 3301 lines of `context/`, sizing 1340. **Not self-contained:** 27 env vars in `backtester.py`, whole server env inherited (`python-runner.ts:388`), the 7-layer gate silently bypassed by the Python-side `playbook_router.ALL_STRATS` membership check (`backtester.py:318-323`), per-instance disk reads for role demotion. Run receipt fingerprints **no env** (`:2691-2753`) — so "same IR ⇒ same trades" is not currently true. | MEASURED HERE (env-attribution consequence: HYPOTHESIS) |
| 3 | What is the diffable surface? | **Trade-for-trade, in memory: YES and richer than PineForge's key** — `backtester.py:5231-5312`, emitted `result["trades"]` `:5721`, carrying `Entry Idx`/`Exit Idx` (`:5036-5037`, with a hard raise on unmapped timestamps `:5031`), `Avg Entry/Exit Price`, `Size`, `Direction`, `PnL`, `GrossPnL`, `SlippageCost`, `CommissionCost`, `RollSpreadCost`, `exit_reason`, `stop_basis`, `rr`, `mae`, `mfe`. **Persisted surface is LOSSY** — `backtest_trades` (`schema.ts:300-337`) has no bar index and no exit reason, and `backtest-service.ts:912-917` collapses integer-index timestamps to a single `start_date` for every trade (comment says "+ offset"; the line adds none). Signal-level persisted diff already exists and is consumed (`backtester.py:6152` → `result_extras.expected_signals` → shadow-divergence gate). **No golden trade corpus; 10 DSL fixtures vs PineForge's 246.** | MEASURED HERE |
| 4 | Where would it sit vs `P0PG→P0IG`? | **It sits UNDER `FIDELITY`, not over the P0 chain, and replaces none of the five nodes.** P0 qualifies a *compile-time admission* instrument (43×7=301 cells, 215 unique projections, claims AGREEMENT/CONFORMANCE/COMPLETENESS); the oracle is a *runtime semantics* instrument. `FIDELITY` ("Calibrate compile fidelity in authoritative runtime", fed by `P0IG` `instrument_authority`, gating `PH1_EXIT`) names **no instrument** and explicitly forbids citing P0 synthetic green as fidelity. **FLAGGED as partially redundant, not adjudicated:** `P2`'s sole `type:"oracle"` role is a *static* membership ledger; and the Gate-B *hand-authored* oracle authority (`BLUEPRINT-V4-DRAFT.md:694-716`) whose sha256 pin **has gone stale three times in ten days** by the blueprint's own account — in-house evidence of exactly the cost §1.8 predicts. **No conflicting node exists.** ⚠ No graph edit proposed. | MEASURED HERE (graph/design text ARTIFACT-SOURCED) |

**The blocking unknown, restated for the desk:** not "is there an IR" (there is) and not "is there a diffable output" (there is, richer than the precedent). It is **(a)** whether a second implementation can be made independent enough to avoid AR-499's correlated-refusal false green, given that the existing mirror pair is *contractually required* to change in lockstep (`spec-family-bindings.ts:18-20`); and **(b)** whether the env/registry reach-ins can be closed and receipted so that a diff disagreement is attributable to the compiler rather than to ambient state. Both are desk decisions. Neither is determinable from the artifacts.
