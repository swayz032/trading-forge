# Ratify-Packet — Backtest Compliance-Gate Coverage Gap + Sizing Balance Snapshot (2026-07-17)

**STATUS: PARTIALLY IMPLEMENTED — headline disclosure, not buried (updated same day by a
second pass after independent wave-grading flagged the original status line as stale and
under-disclosing).** Per-finding state, precisely:

- **Finding 3 (roll-spread fail-loud, default ON) — SHIPPED, both DSL and class paths.**
  `RollSpreadCostComputeError` + `check_roll_spread_fail_loud()` added to
  `roll_spread_cost.py`; all 4 swallow sites in `backtester.py` (DSL entry/exit, class-path
  entry/exit) now call the guard instead of `print`-and-continue. `BACKTEST_ROLL_SPREAD_FAIL_LOUD`
  defaults `true`. 20/20 `test_roll_spread_cost.py` (4 new fail-loud tests, RED-proofed) +
  32/32 across the roll-spread/equity-reconciliation suite, zero regressions, syntax +
  import verified. This was the one default-ON item — closing it removed the only
  currently-silent capital-number-shifting gap in this packet.
- **Finding 1 (MFFU 2%/HFT/hedging detection), shadow-mode slice — SHIPPED, default OFF**
  (`BACKTEST_COMPLIANCE_VIOLATION_CHECK_ENABLED`; real non-mocked `check_violation()` calls,
  running-balance-walk RED-proof, negative controls, non-MFFU no-op, hedging-ban direct-call
  tests — independently re-verified by the wave-grader).
- **Finding 1, enforce-mode slice (bounded-iteration `vbt.Portfolio.from_signals` re-run,
  capped at 3 passes, wired at BOTH the DSL and class-strategy integration points, 6 named
  RED-proofs incl. non-convergence fail-loud) — NOT SHIPPED.** This is the packet's own
  explicitly-licensed fallback ("shadow-only enforcement with the deferral made the HEADLINE
  decision") — invoked here because it is a genuinely separate, non-trivial architecture
  change (2-pass re-simulation, bounded iteration, dual-path wiring) that deserves its own
  dedicated implementation + grading pass, not a tail-end addition to an already-large wave.
  Default OFF → zero production delta from this being open.
- **Finding 2 (sizing.py real firm-starting-floor, `BACKTEST_SIZING_REAL_STARTING_BALANCE_ENABLED`)
  — NOT SHIPPED.** Smaller than Finding 1's enforce-mode but still needs its own A/B receipt
  per §2.4 item 3 before landing. Default OFF → zero production delta.

**Named owner + trigger for the two open items:** the next dedicated instrument-hardening
session on this repo (backtest-core charter) picks up Finding 1's enforce-mode re-run and
Finding 2's starting-floor correction directly from this packet's already-written §1.3/§2.3
design — both are fully specified, scope-locked, and ready to implement without re-deriving
anything. Do not treat shipping Finding 3 or Finding 1's shadow slice as closing this packet;
re-open it explicitly when that session starts.

Per the operator-amended `ratify-packet` skill (2026-07-11): this is instrument code (engine
compliance gate + sizing math) but **pre-live**. Not the irreversible/live-capital class →
proceeds autonomously through the agent-loop (scope-locked implementer → fresh-context
independent grader); no permission-wait. This packet is the receipt the independent grader
rules on.

**Default posture is NOT uniform across the three findings — stated precisely here so the
header can't be skimmed into a false blanket claim:**
- **Findings 1 and 2** (P&L-shifting compliance-blocking + sizing-balance math) ship
  **default-OFF**, mirroring `BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED` /
  `GOVERNOR_MULTI_STEP_ESCALATION_ENABLED` — every backtest's numbers stay byte-identical
  until an operator/grader opts in and re-runs the affected cohort.
- **Finding 3** (roll-spread fail-loud) ships **default-ON**, mirroring the ALREADY-LANDED
  `BACKTEST_ZERO_VOLUME_TRADE_CRITICAL_FAIL_LOUD` precedent in this exact codebase (Wave
  27.5 Pass D, CLAUDE.md §12/§13) — this is a *different risk shape*, not an inconsistency:
  a backtest that never hits the roll-spread-parse-exception path is completely unaffected
  (byte-identical); one that DOES hit it today silently produces an already-wrong,
  already-invisible number, and default-ON converts that into a loud, attributable
  failure instead of substituting one "trusted" number for a different one. It removes
  false trust rather than shifting a certified value — the reserved-class trigger
  ("invalidates a certified ref other decisions trust") is about the latter, not the
  former. See §3.2/§3.3 for the full reasoning and the flip-to-`false` fallback.

Base: `56f0fd04` (`wt-deepscan-b-fixwave`, pinned). Subsystem: capital-safety —
compliance gate (`src/engine/compliance/compliance_gate.py`) + position sizing
(`src/engine/sizing.py`) + backtest engine wiring (`src/engine/backtester.py`) + prop-firm
day-by-day simulation (`src/engine/prop_sim.py`).

## Anchors verified against base `56f0fd04` (implementer re-anchors by SYMBOL, not lines)

| Symbol | File:line | Role |
|---|---|---|
| `_permissive_rules` construction | `backtester.py:755-758` | The ONLY compliance ruleset ever passed to `check_strategy_compliance()` in the whole engine |
| `check_strategy_compliance()` call | `backtester.py:759` | The ONLY call site of this function anywhere in `backtester.py` |
| `check_strategy_compliance()` def | `compliance_gate.py:110-260` | 6-dimension strategy audit: drawdown / daily_loss / consistency / overnight / contract_limits / automation |
| `check_violation()` def | `compliance_gate.py:400-535` | Pre-order hard-prohibition check: automation-ban, VPS-ban, **MFFU 2% rule, HFT limit, hedging ban** |
| `compute_position_sizes()` `account_balance` default | `sizing.py:1055-1061` | `float(profit_scaling_tier.get("account_balance", 50_000.0)) if profit_scaling_tier is not None else 50_000.0` |
| Vectorized DSL sizing call site | `backtester.py:4288-4293` | `compute_position_sizes(df, _sized_config, spec, atr_period, max_contracts=..., stop_multiplier=..., symbol=...)` — **no `profit_scaling_tier` arg** |
| Legacy class-backtest sizing call site | `backtester.py:6864` | `compute_position_sizes(df, size_config, spec, 14, max_contracts=max_contracts)` — type is `fixed`/`dynamic_atr`, never reaches the `risk_derived_pyramid` branch, so this call site is unaffected by the `account_balance` default (see §2.1 scoping) |
| `simulate_all_firms` import | `backtester.py:72` | `from src.engine.prop_sim import simulate_all_firms` — **note:** a *second*, unrelated `simulate_all_firms` exists in `prop_compliance.py::run_prop_compliance`'s call graph but `backtester.py` never imports it; all "downstream coverage" claims below are verified against `prop_sim.py`, the module actually invoked |
| Roll-spread cost swallow (DSL path, `run_backtest`) | `backtester.py:5241-5245` (entry) + `5264-5268` (exit) | `except Exception as _re: print(..., file=sys.stderr)` — cost silently omitted from `net_pnl` |
| Roll-spread cost swallow (**class path, `run_class_backtest` — confirmed sibling, same shape**) | `except Exception as _re_cls:` (entry side) + `except Exception as _re_cls_exit:` (exit side), inside `run_class_backtest`'s per-trade loop, variable `_roll_cost_usd_cls` | Byte-for-byte the same `print(..., file=sys.stderr)`-only swallow as the DSL path — `net_pnl = gross - slip_cost - comm_cost - _roll_cost_usd_cls` runs with the roll cost silently missing on the same exception shape. See §3.1/§3.3 — Finding 3's scope is extended to this sibling, not left silent, per the repo's fix-the-whole-class discipline. |
| Class-path per-trade loop (compliance detector integration point) | `run_class_backtest`'s trade-list-build loop, keyed off `trades_records.iterrows()`, variable prefix `_cls`/`managed_trades` | `run_class_backtest` builds its own independent trade list and NEVER calls `detect_trade_compliance_violations()` or any compliance check — confirmed via a grep for both `compliance_violation` and `detect_trade_compliance`, scoped to the function body, returning zero matches for either. `firm_key` IS already a `run_class_backtest` parameter, so the same detector function is directly reusable here. See §1.3 — scope extended. |

---

## Finding 1 (HIGH) — `check_violation()`'s MFFU 2% / HFT / hedging-ban logic is never invoked anywhere in the backtest engine

### 1.1 What & why (defect + receipts, independently verified — corrects the initial framing)

**Repro (structural, not a single input case):**
```
grep -rn "check_violation" src/engine/
  → src/engine/compliance/compliance_gate.py (definition only)
  → src/engine/tests/test_compliance_gate_cli_ruleset_scope.py (test only)
grep -n "check_violation" src/engine/backtester.py
  → (no matches)
```
`check_violation()` (`compliance_gate.py:400-535`) is the function that implements the
**MFFU 2026 Rule 8 2%-per-trade check** (`check_two_percent_rule`), the **MFFU HFT limit**
(`check_hft_limit`, 500 trades/day), and the **MFFU hedging ban** (MNQ↔NQ / MES↔ES /
MCL↔CL simultaneous-position check) — all three named explicitly in CLAUDE.md §6 as live
MFFU rules. It IS wired on the TS/live side (`paper-execution-service.ts`,
`broker-router.ts`, `lifecycle-service.ts` all call it — confirmed via
`grep -rln check_violation src/server`). It is **never called from `backtester.py`, or
from any module `backtester.py` transitively invokes** (`prop_sim.py` was checked line by
line — see §1.1b). This means a backtested strategy's own risk math is the *only* thing
standing between it and a 2%-rule / HFT-limit / hedging-ban breach in the numbers that feed
promotion; there is no independent audit trail proving compliance, and no way for an
`enforce`-mode backtest to actually reject a strategy on these grounds.

**§1.1a — CLAUDE.md's own claim is the receipt for materiality.** §12's Hard Gates table
row *"Backtest compliance enforce mode (Wave 27.5 Pass C — DEFAULT)"* states:
`BACKTEST_COMPLIANCE_MODE=enforce` (default) *"blocks violating trades at fill time"*.
That claim is TRUE only for the narrow slice `check_strategy_compliance()` actually
evaluates at the parity gate (automation-ban, overnight-holding) — it is FALSE for the
three MFFU violation classes CLAUDE.md §6 itself documents as live rules, because the
function that checks them is never called. An operator reading §12 would reasonably
believe "enforce" catches a 2%-rule breach; it does not.

**§1.1b — independent verification narrowed (and partially corrected) the rest of the
originally-suspected gap; recorded so the grader doesn't re-litigate settled ground.**
Tracing `simulate_all_firms` (`backtester.py:72` imports it from `prop_sim.py`, **not**
from `prop_compliance.py` — the latter has its own `run_prop_compliance()` with real
per-firm checks but `backtester.py` never calls it; confirmed via `grep -n "from
src.engine.prop_sim import\|from src.engine.prop_compliance import" backtester.py`):
`prop_sim.py::simulate_prop_firm()` runs unconditionally on **every** backtest, post-run,
using real per-firm rules and the real computed daily P&L / trade list:

| Dimension | Backtest-engine coverage found | Verified location |
|---|---|---|
| Trailing drawdown | **REAL, hard-enforced.** Feeds `passed` verdict. | `prop_sim.py:207-226`, feeds `passed` at `:417-422` |
| Overnight holding | **REAL, hard-enforced** via `overnight_violation`, uses real `firm.overnight_ok`. | `prop_sim.py:411-422` |
| Consistency (best-day %) | **NO-OP for both live firms' canonical rule names** (`topstep_50pct`, `mffu_50pct_sim_payout`) — only fires for the legacy `mffu_50pct` name nothing configures. Comment at `prop_sim.py:304-306` is explicit: *"this legacy daily-statement sim does NOT enforce these rules — B14 `simulate_firm_survival` is the authoritative consistency model."* Real consistency enforcement lives in the separate B14/MC lifecycle gate, not the raw backtest engine. | `prop_sim.py:294-328` |
| Daily loss limit | **Tracked but deliberately non-blocking.** `daily_loss_breaches`/`gap_breaches` are recorded and surfaced, but the code comment (`prop_sim.py:129-156`, tagged `PHASE21-PART3 FIX`) explicitly documents *why* it does not gate `passed`: EOD mark-to-market daily P&L over-fires on overnight-held-position drift days with no trades at all, producing false "the firm halted you" verdicts. This is a **deliberate, documented design choice**, not a silent gap — not re-litigated by this packet. | `prop_sim.py:129-156`, verdict formula `:417-422` (daily-loss is absent from it) |
| Contract limits | Enforced via a **separate mechanism** — `firm_contract_cap`/`FIRM_CONTRACT_CAPS` clamp contracts at sizing time (`backtester.py:6854-6856`, `sizing.py` `effective_firm_cap_bar`), not via `check_strategy_compliance()`'s `contract_limits` key. | `backtester.py:6854-6856` |
| Automation ban | Moot for the two active firms — `FIRM_RULES`/`FIRM_CONFIGS` carry no `automation_banned` key for `topstep_50k`/`mffu_50k`; `check_violation()`'s docstring names the firms this rule targets (Apex 4.0, Tradeify, FundingPips) as the ones it matters for, and those were removed from production scope by migration 0097 (CLAUDE.md §6). Not a live gap against real capital today. | `firm_config.py:101-164` (no key present) |
| **MFFU 2% per-trade rule** | **GENUINE, TOTAL GAP.** Nowhere in `backtester.py` or anything it calls. | (absence confirmed above) |
| **MFFU HFT limit (500/day)** | **GENUINE, TOTAL GAP.** Nowhere. | (absence confirmed above) |
| **MFFU hedging ban** | **GENUINE GAP**, though structurally low-materiality *today* — a single-symbol, single-strategy backtest run has no cross-strategy/cross-symbol open-position view to check against, so even if wired it would rarely fire until multi-symbol/multi-strategy backtests exist. Worth wiring for correctness and because it's near-zero marginal cost once the 2%/HFT wiring lands (same call). | (absence confirmed above) |

**§1.1c — the class-strategy path (`run_class_backtest`) is a confirmed sibling gap, not a separate finding.** `run_class_backtest` (the `BaseStrategy`-subclass execution path, distinct from the DSL-compiled `run_backtest` path) builds its own independent per-trade loop and list of executed trades and — like `run_backtest` before this packet — never calls `check_violation()` or any MFFU compliance check. Verified: `firm_key: Optional[str] = None` is already a `run_class_backtest` parameter (so the firm context needed to gate MFFU-only checks is available for free), and `detect_trade_compliance_violations()` is trade-list-shape-agnostic (it takes `trades: list[dict]`, `firm_key`, `starting_balance` — nothing DSL-specific), so it is directly reusable at the class-path's per-trade loop with no new code beyond the same integration this packet already specifies for the DSL path. Per this repo's fix-the-whole-class discipline (memory `feedback_fix_the_pattern_class_not_the_instance`), this packet's scope is EXTENDED to both integration points — see §1.3's design, which now instructs the implementer to wire both.

**Also found while verifying (folded into scope, not a separate finding):** the
`_permissive_rules` dict passed to `check_strategy_compliance()` at the parity gate
(`backtester.py:755-758`) sets `"overnight_allowed": True` unconditionally — which
**defeats the code's own stated purpose**. The comment immediately above it
(`backtester.py:753-754`) says *"we only want to catch automation-banned or overnight
violations at signal time"* — but `check_strategy_compliance()`'s overnight check is
`if holds_overnight and not overnight_allowed:` (`compliance_gate.py:216-218`), and with
`overnight_allowed` hard-coded `True`, `not overnight_allowed` is always `False` — **the
one check the comment claims is active can never fire, regardless of what the strategy
actually does.** This is real and worth fixing (it contradicts its own docstring), but its
*marginal safety impact* is low given §1.1b's finding that `prop_sim.py` already catches
real overnight violations post-backtest with the real firm rule.

### 1.2 Blast radius
- **Shadow mode** (`compliance_mode="shadow"`): a `check_violation()` pass is purely
  additive (new detection, new fields in the result dict) — it does not change any
  existing trade, size, or P&L number. Zero blast radius on existing certified backtests
  as long as it ships default-OFF.
- **Enforce mode** (`compliance_mode="enforce"`): per the task's explicit requirement
  ("enforce mode should genuinely be able to catch these violation classes"), this packet
  now proposes REAL blocking, not audit-only — see §1.3's re-run design. This DOES change
  trade counts, P&L, and every downstream metric (Sharpe/PF/WFE/B14/prop_compliance) for
  any `enforce`-mode MFFU backtest where a genuine 2%/HFT/hedging violation is detected —
  exactly the kind of re-baseline this packet's env-flag gating exists to contain. Default
  OFF means zero blast radius until opted in.
- **Fixing `overnight_allowed: True` → real `firm.overnight_ok`** at the parity gate CAN
  change `compliance_blocked`/trade counts for any backtest where `config.overnight_hold`
  is set against Topstep or MFFU (both declare `overnight_ok: False`) — in `enforce` mode
  this newly blocks ALL signals for such a strategy at the parity gate, where today it
  silently proceeds (and only shows up later as `prop_compliance[firm].passed == false`,
  informationally, without having blocked any trades). This is a genuine re-baseline for
  the overnight-holding cohort → gate it.
- No frozen-policy hash impact (position_size / entry_quality config unchanged — only the
  compliance-evaluation and sizing COMPUTATION paths change). No CI-gate impact
  (`check:2026-compliance` lints `firm_config.py` against the 2026 docs, not this wiring).
- **§1.1c class-path extension:** wiring `run_class_backtest` doubles the surface area of
  both the shadow-mode blast radius (zero — purely additive there too) and the
  enforce-mode blast radius (any MFFU `run_class_backtest` run with a genuine violation is
  now also affected once opted in). Same env flags gate both paths — there is no separate
  flag for the class path, so flipping `BACKTEST_COMPLIANCE_VIOLATION_CHECK_ENABLED` on
  affects DSL and class-strategy MFFU backtests identically and simultaneously. This is the
  intended contract (one flag, one meaning, no path silently exempted) — not a scope
  overreach.

### 1.3 Exact change, scope-locked

**Phase 1 (this packet's proposed scope — all gated, no sizing-architecture change):**

1. **New env flag `BACKTEST_COMPLIANCE_PARITY_GATE_REAL_RULESET_ENABLED`** (default
   `false`). When `true`, `backtester.py`'s `_permissive_rules` construction
   (`:755-758`) reads the real firm's `overnight_ok` (and, for future-proofing, a real
   `automation_banned` if `FIRM_RULES` ever gains one for a re-added firm) from
   `FIRM_RULES[firm_key]` instead of the hardcoded permissive values. Requires threading
   `firm_key` to the call site (it is already resolvable — `backtester.py` has `firm_key`
   in scope in both call paths that reach `_apply_backtest_parity_gates`). When `false`
   (default): byte-identical to today.
2. **New env flag `BACKTEST_COMPLIANCE_VIOLATION_CHECK_ENABLED`** (default `false`).
   Genuinely enforces in `enforce` mode; audits (logs, doesn't block) in `shadow` mode —
   restoring the shadow-vs-enforce distinction the task requires and this codebase's other
   compliance mechanisms already follow.

   **Why this doesn't need the "materially larger" 2-pass sizing architecture from
   §2.1a:** Finding 2 establishes that sizing is already static — it does NOT depend on
   running equity today. Blocking a violating trade therefore does not need to trigger any
   re-sizing cascade; it only needs the trade's ENTRY SIGNAL removed and the portfolio
   re-run so the removed trade — and any position-slot side-effects of its absence (e.g. a
   different signal that was previously suppressed only because a position was already
   open) — are reflected correctly. The parity gate ALREADY does exactly this kind of
   entry-signal zeroing before `vbt.Portfolio.from_signals` runs (`backtester.py:784`,
   `return np.zeros_like(out), parity_stats`); this packet reuses the identical mechanism,
   applied surgically to specific violating trades' entry bars instead of the whole array.

   **Design — bounded-iteration re-run (reuses existing `vbt.Portfolio.from_signals`
   call, `backtester.py:5026`/`7233`, and the existing `entries_pd`/`short_entries_pd`
   signal arrays fed to it):**
   - **Pass 1 (today's pass, unchanged):** run signals → sizing → `vbt.Portfolio.from_signals`
     → build the trade list, exactly as today.
   - **Detection (new, both modes):** walk the resulting trade list chronologically (the
     existing per-trade loop at `backtester.py:~5170-5270` that already computes
     commission/roll-spread per trade sequentially is the natural integration point). For
     each trade, call `check_violation()` with:
     - `firm = config.firm_key` (skip entirely when firm is not `"mffu"` — the three
       checks this packet closes are all MFFU-specific per `compliance_gate.py:471-518`)
     - `strategy_state.intended_max_loss` = this trade's stop-distance-in-dollars
       (`sizing_stop_pts × point_dollar_value × contracts`, already computed per-trade)
     - `strategy_state.account_balance` = running-balance approximation: firm's real
       starting balance (from `FIRM_RULES`, e.g. MFFU `48_000`) plus the cumulative sum of
       `net_pnl` for prior trades **that were NOT themselves blocked** — since the walk is
       already sequential/chronological, a blocked trade's `net_pnl` is simply excluded
       from the running sum for every trade after it, requiring no extra pass on its own.
     - `strategy_state.trades_today` = count of NON-blocked trades on the same entry
       calendar day seen so far in the walk
     - `strategy_state.proposed_symbol` = `config.symbol`; `strategy_state.open_positions`
       = `[]` for a single-symbol backtest (honest — see §1.1b hedging-ban scoping; do not
       fabricate a synthetic counter-position)
     - `strategy_state.host = "skytech-tower"` explicit (**do not** leave `host` unset/
       default — `check_violation()`'s VPS-ban check defaults `host="unknown"`, not in the
       allowed set, and would spuriously flag every Topstep backtest if this is ever
       extended to Topstep; scoped OUT of this MFFU-only pass, documented so a future
       agent doesn't rediscover this footgun)
   - **Shadow mode:** record every detected violation in `result["compliance_violation_audit"]`
     (mirrors `parity_stats["compliance_violations"]`'s shape) and emit
     `[compliance.shadow_logged]`-style stderr lines per violation. Stop here — one pass,
     no re-run, matches this codebase's existing shadow contract everywhere else.
   - **Enforce mode:** if any violations were detected, zero those trades' entry bars in
     `entries_pd`/`short_entries_pd` and re-invoke `vbt.Portfolio.from_signals` (Pass 2).
     Re-run detection on the NEW trade list (a newly-unblocked slot could in principle
     admit a different trade that itself violates — rare in practice for a
     single-position-at-a-time backtest, but not provably impossible, so don't assume
     one pass suffices). **Bound the iteration at 3 total `vbt` passes.** If violations are
     still detected after the cap, **fail loud** (raise, do not silently ship an
     under-enforced result) with a clear `compliance.violation_check_non_convergent`
     error — institutional discipline over a silent best-effort. In the (expected-common)
     case of 0-or-1 violating trades, this is a 2-pass run, not an iterative loop. Emit
     `compliance.enforce_block`-style stderr lines (matching the existing enforce-block
     format) for each trade actually excluded, distinct from the shadow-mode log line.
   - **§1.1c scope: wire this at BOTH integration points, not just the DSL path.**
     `run_class_backtest` builds its own independent per-trade loop and already receives
     `firm_key` as a parameter — the identical shadow-mode call (walk the class path's own
     trade list through `detect_trade_compliance_violations()`, same running-balance
     sequential-sum design) belongs at that loop's natural per-trade boundary, mirroring the
     DSL integration point. The enforce-mode bounded-iteration re-run for the class path
     re-invokes whatever `run_class_backtest`'s own portfolio-construction call is (its
     equivalent of `vbt.Portfolio.from_signals`) rather than the DSL path's specific call —
     an implementer must find and use the correct re-entry point for that path, not assume
     the DSL path's exact call signature transfers unchanged. Both paths share ONE pair of
     env flags (§1.3 items 1-2) — there is no DSL-only or class-only variant of either flag.
3. **Fix `_permissive_rules`'s misleading name/comment** regardless of flag state — rename
   to `_signal_time_rules` and correct the comment to state plainly what is and isn't
   checked at signal time and why (drawdown/daily-loss/consistency require backtest
   results not yet available; contract limits are enforced via the sizing clamp instead;
   this is documented pre-existing behavior, not new).

**Explicitly OUT of scope for this packet (named, not silently dropped):**
- Wiring VPS-ban / automation-ban for Topstep (moot today per §1.1b; revisit only if a
  removed firm like Apex is ever re-added).
- Multi-symbol/cross-strategy hedging-ban detection (no cross-strategy view exists in a
  single backtest run today).
- Re-litigating the deliberate daily-loss-limit soft-tracking design (`PHASE21-PART3`).
- If the independent implementer/grader finds the bounded-iteration re-run genuinely does
  NOT compose cleanly with some part of the pipeline this packet-author didn't anticipate
  (e.g. an existing downstream consumer that assumes trade count is fixed once `vbt` runs
  once), the fallback is shadow-only enforcement with the deferral made the HEADLINE
  decision (not a buried sub-bullet) and an explicit note added here — but the default
  design target is real enforce-mode blocking, per the task's explicit ask.

### 1.4 Verification plan
1. **RED-proof #1 (overnight self-contradiction):** unit test constructs a strategy with
   `overnight_hold=True` against `firm_key="topstep_50k"` (`overnight_ok=False`); asserts
   that with the flag OFF (today) `compliance_violations` stays empty; with the flag ON,
   a violation is recorded. Revert the fix → the ON-case assertion fails, proving the test
   is non-vacuous.
2. **RED-proof #2 (2% — shadow mode):** construct a trade list with one trade whose
   `intended_max_loss` exceeds 2% of the running MFFU balance at that point (e.g. size the
   position so stop-loss-dollars > $960 on a $48K starting floor with zero prior P&L);
   assert `compliance_violation_audit` contains a `two_percent_rule` entry when the flag
   is ON (shadow mode), empty when OFF, and the trade is UNCHANGED in the shadow-mode
   trade list either way. Include a companion case where the SAME nominal stop-dollars is
   compliant early in the trade list but becomes a violation after a simulated drawdown
   consumes the running balance (proves the running-sum approximation, not just a static
   check, is exercised, and proves excluded-trade P&L correctly drops out of the running
   sum once enforce-mode starts excluding trades — see RED-proof #4).
3. **RED-proof #3 (HFT limit):** construct >500 same-day trades; assert the 501st is
   flagged when ON.
4. **RED-proof #4 (enforce mode genuinely blocks):** same fixture as #2 but
   `compliance_mode="enforce"`; assert the violating trade is ABSENT from the final trade
   list, `net_pnl`/trade-count/Sharpe reflect its exclusion, and a
   `compliance.enforce_block`-style stderr line was emitted naming it. Revert the
   enforce-mode re-run logic (fall back to audit-only) → this assertion fails, proving the
   test actually exercises real blocking, not just detection.
5. **RED-proof #5 (bounded-iteration fail-loud):** construct a pathological fixture where
   blocking trade N structurally unlocks a new violating trade N' every re-run pass (or
   mock `check_violation()` to always return a fresh violation); assert the engine raises
   `compliance.violation_check_non_convergent` after the 3-pass cap rather than returning
   a silently-under-enforced result.
6. **Flip-enumeration:** both flags OFF (default) → byte-identical output on a golden
   fixture (existing `test:metrics` golden values unchanged — any drift is a HOLD signal).
7. Unit tests for `_signal_time_rules` rename: existing `test_compliance_enforce_mode.py`
   suite (which mocks `check_strategy_compliance` entirely, per its own docstring) must
   still pass unmodified — the rename/comment fix does not change call signatures.
8. **RED-proof #6 (§1.1c class-path sibling coverage):** run RED-proof #2's fixture (or an
   equivalent over-2% MFFU trade) through `run_class_backtest` instead of `run_backtest`;
   assert the SAME violation is flagged in shadow mode and the SAME trade is excluded in
   enforce mode. This is the RED-proof a grader will specifically look for — landing only
   the DSL-path wiring and marking Finding 1 closed while the class path stays silently
   uncovered is exactly the missed-sibling failure this repo's fix-the-whole-class rule
   exists to catch.
9. Independent grade (doer≠grader): confirm the running-balance approximation is genuinely
   derived from the sequential, exclusion-aware trade walk (not a second hardcoded
   constant — this is exactly the class of defect memory
   `feedback_hardcoded_test_copy_is_fabricated_safety_claim` warns about, applied here to
   production code, not just tests); confirm `host` is never left to default inside the
   new call; confirm shadow mode never mutates trades; confirm enforce mode's re-run count
   is genuinely bounded and fails loud rather than looping or silently returning early;
   confirm performance (the 2nd/3rd `vbt.Portfolio.from_signals` pass) is acceptable —
   flag if backtest runtime materially regresses for MFFU strategies with the flag ON.

### 1.5 Rollback
Both new env vars default `false` — instant revert to current byte-identical behavior via
env, no code revert needed. The `_permissive_rules` → `_signal_time_rules` rename is a
single-commit, no-behavior-change revert if the naming itself is contested.

---

## Finding 2 (HIGH, compounding with Finding 1) — `compute_position_sizes()` sizes every `risk_derived_pyramid` backtest against a static `$50,000` snapshot, never the account's real starting balance or its running equity during the run

### 2.1 What & why (defect + receipts)

`sizing.py:1055-1061`:
```python
account_balance = (
    float(profit_scaling_tier.get("account_balance", 50_000.0))
    if profit_scaling_tier is not None
    else 50_000.0
)
```
`profit_scaling_tier` is **never passed** from `backtester.py` — confirmed via
`grep -n "profit_scaling_tier" src/engine/backtester.py` → zero matches anywhere in the
file, including at the one call site that reaches the `risk_derived_pyramid` branch
(`backtester.py:4288-4293`). So `account_balance` is unconditionally `50_000.0` for the
**entire duration of every `risk_derived_pyramid` backtest**, with no exceptions, for
every strategy, every symbol, every firm.

This constant scalar feeds `compute_risk_derived_contracts()` (`sizing.py:225` on),
which for the Topstep branch (the default, `firm="topstep"`) computes
`buffer = account_balance - trailing_floor` where `trailing_floor = min(high_water_balance
- trailing_dd, account_starting_floor)`; since `high_water_balance` also defaults to
`account_balance` when not threaded, `buffer` is a **constant $2,000 for the entire
backtest run**, and `risk_dollars = buffer × max_risk_pct_per_trade` is a constant ~$40
for a Topstep 50K account regardless of how the account's real equity has moved. The
per-bar risk-derived contract cap (`sizing.py:1189-1211`) uses this same constant
`risk_dollars_scalar` for every bar — it only varies bar-to-bar via the bar's own ATR, not
via the account's simulated P&L to that point. **A real drawdown that occurs mid-backtest
never tightens the 2%-of-current-equity risk cap** — the backtest keeps sizing as if the
account were perpetually at its starting balance, even on the bar immediately after a
string of losses that a real account would have felt.

**§2.1a — architectural root cause, verified.** The vectorized DSL path
(`backtester.py:5026`/`7233`, `vbt.Portfolio.from_signals`) computes ALL per-bar position
sizes via `compute_position_sizes()` **before** the trade simulation runs — there is no
per-bar running-equity value available at sizing time in the current architecture (sizing
happens in one vectorized pass; the equity curve is an OUTPUT of running the portfolio
with those sizes, not an input available beforehand). This is the same chicken-and-egg
constraint that motivated the `stop_multiplier`/`symbol` threading pattern already used
elsewhere in this function (Wave 2, 2026-07-16) — but those parameters are STATIC
(strategy config), not a function of simulated results. Genuinely threading real
*running* equity requires either an iterative two-pass re-sizing (run once, extract the
equity curve, re-size against it, re-run — potentially to convergence) or accepting an
approximation; this is a materially larger architecture change than the rest of this
packet and is scoped OUT (see the shared Phase-2 note).

**§2.1b — the second, cheaper, independently real sub-defect: the STARTING balance
itself is wrong for any account that isn't exactly $50K.** Even setting aside the
running-equity problem, `$50,000` is a hardcoded literal, not the real firm's starting
balance. This bites differently per firm branch (`sizing.py:436-482`):
- **MFFU branch:** `risk_dollars = account_balance × max_risk_pct_per_trade` directly (no
  buffer/trailing-floor math). MFFU's real starting floor is `$48,000`
  (`FIRM_RULES["mffu_50k"]["starting_floor"]`, `firm_config.py:141`), not `$50,000` — so
  every MFFU `risk_derived_pyramid` backtest today computes `risk_dollars` **4.2% too
  high** (`50,000 / 48,000`) for the entire run, a direct, unconditional overstatement of
  the per-trade risk budget, not an edge case.
- **Topstep branch:** `buffer = account_balance − trailing_floor` where
  `trailing_floor = min(high_water_balance − trailing_dd, account_starting_floor)`; since
  both `account_balance` and (when unthreaded, as today) `high_water_balance` default to
  the same constant, `buffer` collapses to a constant `$2,000` for the entire run
  regardless of real account size. Topstep's real starting balance already IS `$50,000`
  (`FIRM_RULES["topstep_50k"]["account_size"]`), so this specific $50K-vs-real-balance
  delta is zero for Topstep today — but CLAUDE.md §4's own worked examples describe real
  accounts at $100K and $150K (`"$100K account: $2,000/$30 = 66 contracts"`,
  `"$150K account: $3,000/$30 = 100 contracts"`) — any backtest run intending to model one
  of those larger accounts is silently sized as if it were the base $50K, a real, if
  currently unexercised (no $100K/$150K backtest configs found in this repo at the time
  of writing), gap. This sub-defect has NO architecture blocker (the firm's/account's real
  starting balance is static config, known at backtest-config time) and is cheap to close
  independent of §2.1a.

**§2.1c — this is the same underlying data gap Finding 1's §1.3-item-2 running-balance
approximation depends on.** Finding 1's `check_violation()` 2%-rule audit and Finding 2's
sizing risk-cap both ultimately want "the account's real balance at this point in the
run." Finding 1's audit-pass version is cheap (post-hoc, sequential-sum, no architecture
change) because it runs AFTER the trade list exists. Finding 2's sizing version is
expensive (pre-hoc, needed BEFORE the trade list exists) because of §2.1a. Recording this
so a future implementer builds ONE shared "running-equity-since-backtest-start" primitive
rather than two divergent one-off implementations.

**Also verified — this is consistent with, not isolated from, how the rest of the engine
treats starting capital.** `STARTING_CAPITAL = 50_000.0` and `account_size=50_000` appear
as engine-wide constants at `backtester.py:2333`, `5041`, `5692`, `7248`, `7813` — the
whole engine currently assumes a $50K denomination for portfolio P&L simulation. So
`account_balance`'s default is not a unique anomaly; it is one more instance of an
engine-wide simplification. This packet does not propose changing the engine-wide
$50K portfolio-simulation assumption (out of scope, much larger blast radius); it proposes
closing the SIZING-specific gap where the risk-derived contract CAP should track the
account's real firm-starting-floor and, longer-term, real running equity — those matter
for the 2%-per-trade rule and drawdown-cap correctness even if the portfolio P&L curve
itself stays denominated at $50K.

**Also verified — no downstream catch exists.** Checked whether the Governor
(`backtest_governor`, `backtester.py:5648-5671`) or any other mechanism independently
validates that a trade's risk-dollars stayed within 2% of real running equity at entry
time: the Governor operates on a **daily loss BUDGET escalation ladder** (using the real
`daily_loss_limit` from `FIRM_RULES`, per `backtester.py:5658-5665`) and produces a
**parallel, informational `governor_result`** (`result["governor"]`) — it does not
retroactively modify the executed trades or flag individual oversized entries. There is no
downstream safety net for this specific gap (consistent with memory
`feedback_claimed_safeguards_owe_wiring_verify` — checked, not assumed).

### 2.2 Blast radius
- **§2.1b fix (real firm starting floor) is instrument-touching and changes historical
  numbers for any backtest run with `firm_key="mffu_50k"`** (buffer/risk_dollars shift
  from a $50K to a $48K starting-floor assumption) — small in absolute terms (~4%) but
  real, and per this repo's own precedent (`BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED`,
  `GOVERNOR_MULTI_STEP_ESCALATION_ENABLED`, and this session's sibling packet
  `freshscan10-2026-07-12-sizing-ddroom-parity.md` which ships the analogous
  `current_drawdown_room` threading gated default-OFF), **gate it.**
- Any Topstep backtest is UNCHANGED by §2.1b (Topstep's real starting floor already IS
  $50,000 — `FIRM_RULES["topstep_50k"]["account_size"]`).
- §2.1a (true running equity) is explicitly NOT proposed in this packet — deferred, see
  the shared Phase-2 note. No blast radius from this packet on that front because nothing
  ships.
- No frozen-policy hash impact. `test:metrics` golden fixtures MUST be re-verified
  unchanged with the new flag OFF (default); any drift at OFF is an immediate HOLD.
- **Relationship to the already-staged, DISTINCT `freshscan10` packet:** that packet adds
  a MISSING `current_drawdown_room` parameter to `compute_position_sizes()` (still
  unlanded — confirmed via `grep -rn BACKTEST_DRAWDOWN_ROOM_PARITY_ENABLED src/` → zero
  matches in this worktree). This packet's §2.1b is a DIFFERENT axis (the STARTING
  BALANCE used inside `compute_risk_derived_contracts`'s buffer formula, not the
  drawdown-ROOM term added on top of it). Both are real, independent, and additive — an
  implementer should NOT treat landing one as closing the other, and should coordinate the
  two new env flags (`BACKTEST_DRAWDOWN_ROOM_PARITY_ENABLED` and this packet's
  `BACKTEST_SIZING_REAL_STARTING_BALANCE_ENABLED`) so they compose cleanly rather than
  fight over `compute_position_sizes()`'s signature.

### 2.3 Exact change, scope-locked

**Phase 1 (this packet's proposed scope):**

New env flag `BACKTEST_SIZING_REAL_STARTING_BALANCE_ENABLED` (default `false`). When
`true`, the vectorized DSL call site (`backtester.py:4288-4293`) constructs and passes
`profit_scaling_tier={"account_balance": <resolved>, "firm": config.firm_key}` instead of
omitting the parameter entirely, where `<resolved>` = `FIRM_RULES[firm_key].get(
"starting_floor", FIRM_RULES[firm_key].get("account_size", 50_000.0))` — MFFU has an
explicit `starting_floor` (48,000, closing the real 4.2% overstatement in §2.1b);
Topstep has no `starting_floor` key, falls back to `account_size` (50,000, unchanged from
today). When `firm_key` is `None` (no firm specified), fall back to `50_000.0` unchanged.
**Scope note — do not conflate with `profit_scaling_tier`'s separate
`"account_starting_floor"` key** (a DIFFERENT field `compute_position_sizes` reads at
`sizing.py:1077-1079`, feeding only the Topstep trailing-floor `min()` and the largely
inert post-C-05/D9 `account_health_ratio` diagnostic): this packet does not thread that
key, since Topstep's real value already matches its existing default (50,000) and MFFU's
branch never reads it. A future agent extending this to Topstep accounts of a genuinely
different size (§4's $100K/$150K examples) would need to thread `account_starting_floor`
too — out of scope here because no such backtest config exists in this repo today (see
§2.1b). When the flag is `false` (default): byte-identical to today — `profit_scaling_tier`
remains unpassed.

**Explicitly OUT of scope for this packet, named as a follow-up (§2.1a — do not silently
drop):** true running-equity sizing via a two-pass architecture. Recommended shape for
that follow-up packet: Pass 1 runs the existing (or §2.1b-fixed) static-starting-balance
sizing to completion and extracts the resulting equity curve; Pass 2 broadcasts that curve
onto the bar timeline as a per-bar `account_balance` array and re-invokes
`compute_position_sizes()` with it, then re-runs the portfolio; document convergence
behavior (does a single re-size pass suffice, or does it need to iterate?) and runtime
cost (roughly 2× the vectorized sizing/portfolio cost) before landing. Gate behind its own
new flag (e.g. `BACKTEST_RUNNING_EQUITY_SIZING_ENABLED`, default `false`) — do not fold it
into `BACKTEST_SIZING_REAL_STARTING_BALANCE_ENABLED`, since an operator or grader may
reasonably want the cheap starting-floor correctness fix without opting into a 2× runtime
cost and a bigger P&L-shifting change.

### 2.4 Verification plan
1. **RED-proof:** unit test on `compute_position_sizes()` (or an integration test through
   `backtester.py`'s parity-gate/sizing call) asserting that an MFFU-firm backtest with the
   flag ON produces a DIFFERENT (tighter) risk-derived contract cap than the same backtest
   with the flag OFF, on a fixture where the $2K starting-floor delta changes the binding
   cap. Revert the fix → the ON-case assertion fails (proves the flag isn't a no-op).
2. **Flip-enumeration:** flag OFF (default) → byte-identical to current output on the
   existing `test_risk_derived_sizing.py` / `test_wave22_firm_sizing.py` fixtures and the
   golden `test:metrics` values. Any drift at OFF is an immediate HOLD, not a "close
   enough."
3. **A/B receipt:** a small script/table (mirrors the style of
   `docs/replay-results/2026-07-16-c05-lowest-wins-ab.md`) on ≥1 real MFFU strategy backtest
   showing contracts-before vs contracts-after at the flag boundary, written to
   `docs/replay-results/<ISO>-sizing-real-starting-balance-ab.md`.
4. Cross-check against the sibling `freshscan10` packet's `current_drawdown_room` param
   (once either lands first) — confirm the two additive changes compose without one
   silently overwriting the other's contribution to `compute_position_sizes()`'s
   signature or the per-bar `min()` chain.
5. Independent grade (doer≠grader): confirm the fallback chain (`starting_floor` →
   `account_size` → `50_000.0`) is correct per firm, confirm Topstep truly is unaffected
   (both paths resolve to 50,000), confirm the flag-OFF path is genuinely byte-identical
   (not just "close"), and confirm the Phase-2 deferral is documented rather than silently
   dropped.

### 2.5 Rollback
Single new env var, default `false` — instant revert via env, no code revert needed.

---

## Finding 3 (LOW, bundled) — roll-spread cost computation fails OPEN on a parse/compute exception, silently omitting the cost from `net_pnl` instead of charging it

### 3.1 What & why (defect + receipts)

`backtester.py:5226-5245` (entry-side) and `:5249-5268` (exit-side): on a bar flagged
`is_rollover_day`, the engine tries to parse that bar's ET timestamp into a `date` and call
`compute_roll_spread_cost(config.symbol, roll_date, contracts)`. If that parse or call
raises (a null/NaT timestamp on the rollover bar, a malformed `ts_et` string, or any other
exception inside `compute_roll_spread_cost`), the `except Exception as _re:` block only
`print()`s to stderr — `_roll_cost_usd` is never incremented for that side of the trade,
and execution falls through to `net_pnl = gross - slip_cost - comm_cost - _roll_cost_usd`
at `:5270` with the roll cost silently missing. The trade's `net_pnl` — and everything
downstream that consumes it (Sharpe, PF, WFE, B14, promotion gates) — is computed as if
the rollover cost never happened, with no audit trail distinguishing "no roll cost was due"
from "a roll cost was due but couldn't be computed."

This is the same failure CLASS this codebase already fixed for zero-volume trade-critical
bars (`BACKTEST_ZERO_VOLUME_TRADE_CRITICAL_FAIL_LOUD`, `check_zero_volume_trade_critical()`
in `data_loader.py:529-590`, CLAUDE.md §12/§13 "Wave 27.5 Pass D") — that fix's own
rationale (`data_loader.py:499-501`) is "a silent skip... can mask systematic backtest
errors" and its precedent explicitly documents the default as fail-loud with an opt-out
for backward-compat only. This finding is the same shape on a sibling cost-path (roll
spread instead of zero-volume fills) that the Pass D sweep did not reach.

**§3.1a — confirmed sibling instance in `run_class_backtest` (the class-strategy path).**
This is not speculative: `run_class_backtest`'s own per-trade loop carries a byte-for-byte
copy of the identical pattern — entry-side `except Exception as _re_cls:` and exit-side
`except Exception as _re_cls_exit:`, both `print(..., file=sys.stderr)`-only, feeding
`net_pnl = gross - slip_cost - comm_cost - _roll_cost_usd_cls` with the same
silently-omitted-cost shape. The DSL-path fix in isolation would leave this sibling
untouched and just as silently wrong — per this repo's fix-the-whole-class discipline
(memory `feedback_fix_the_pattern_class_not_the_instance`), this finding's scope covers
BOTH sites from the start, not as a follow-up.

### 3.2 Blast radius
- Fail-loud-by-default on a currently-silent exception path is, by construction, the
  STRICTER direction (a `raise` surfaces what a `print` hid) — consistent with this repo's
  "ship gates strict" convention. But it is still a behavior change: any existing
  backtest whose rollover-day bars currently trigger this exception path (a data-quality
  issue in the Parquet/`ts_et` column on roll days) would, post-fix-default-ON, raise
  instead of silently completing — a `raise` inside a per-trade loop needs a decision on
  whether it aborts the WHOLE backtest run or is caught one level up and turned into a
  degraded/partial result (see §3.3 design choice below).
- Fixing this can also change historical `net_pnl` numbers for the (currently unknown,
  currently invisible) set of trades where the swallow already silently fired — those
  trades' `net_pnl` was overstated by the missing roll cost. Gate it for the same
  re-baseline-discipline reason as Findings 1-2.

### 3.3 Exact change, scope-locked (engineering call, documented per the task's instruction)

Chose **fail-loud by default, mirroring the zero-volume precedent exactly**, over the
"charge a reasonable fallback estimate" alternative — reasoning: a fallback estimate
would still corrupt `net_pnl` (an estimate is not the real per-published-CME-schedule
cost the itemization feature exists to be accurate about — `ROLL_SPREAD_<SYMBOL>_TICKS`
values are sourced from *"published CME spread costs"* per CLAUDE.md's env-var table), and
silently substituting an estimate for a computation failure hides the SAME
data-quality signal (a null/NaT timestamp on a rollover bar likely means something is
wrong with that bar generally, not just its roll-cost field) that the zero-volume
precedent exists to surface. A future agent wanting the fallback-estimate alternative
instead should treat that as a separate, explicit design decision, not a byproduct of this
fix.

New env flag `BACKTEST_ROLL_SPREAD_FAIL_LOUD` (default `true` — **institutional default,
matching the zero-volume precedent's default**, not a "gate everything to false" pattern;
this one is a data-integrity fail-loud switch, not a P&L-shifting sizing/compliance
change, so it follows the OTHER half of this repo's precedent table — compare
`BACKTEST_ZERO_VOLUME_TRADE_CRITICAL_FAIL_LOUD` and `BACKTEST_ROLL_SPREAD_ITEMIZED`, both
default `true`). When `true`: replace the `except Exception as _re: print(...)` blocks —
**all four of them, per §3.1a**: `run_backtest`'s entry-side `:5241-5245` and exit-side
`:5264-5268`, AND `run_class_backtest`'s mirrored entry-side (`except Exception as
_re_cls:`) and exit-side (`except Exception as _re_cls_exit:`) blocks — with a re-raise of
a new `RollSpreadCostComputeError(RuntimeError)` (mirrors `ZeroVolumeOnTradeCriticalBar`'s
shape: carries symbol, roll_date-or-raw-timestamp-string, and the original exception) —
caught ONE level up at each function's own per-trade-loop boundary (not swallowed inside
the per-bar processing) so a single bad rollover bar surfaces as a clear, attributable
backtest failure rather than aborting mid-loop with a confusing partial trade list. One
shared exception class, one shared env flag — both call sites raise/suppress identically,
so there is no path where the flag's meaning differs between the DSL and class engines.
Emit `backtest.roll_spread_compute_failed_raised` as an audit-style print
(clearly distinguishable from the existing `[roll-spread]` warn-only line format used
today) before raising, from both sites. When `false`: preserves exactly today's
silent-print-and-continue behavior at both sites (backward-compat for existing
fixtures/tests that may depend on it, same pattern as the zero-volume flag's `false`
path).

### 3.4 Verification plan
1. **RED-proof:** unit test that monkeypatches `compute_roll_spread_cost` (or feeds a
   deliberately malformed `ts_et` value on a flagged rollover bar) to raise; asserts that
   with the flag ON (default) the backtest raises `RollSpreadCostComputeError` with the
   default flag; asserts that with the flag OFF, the existing silent-continue behavior is
   preserved (today's behavior byte-identical) and `net_pnl` is missing the roll cost
   exactly as it does today. Revert the fix → both assertions collapse to the same
   silent-continue path, proving the test is non-vacuous.
2. **Existing `test_e7_roll_spread_exit_day.py` / `test_roll_spread_cost.py`** must
   continue to pass with the flag at its new default (`true`) — confirm no existing test
   fixture currently relies on triggering this exception path silently (if one does, that
   test itself was unknowingly RED-proofing the old swallow and needs updating to assert
   the new raise, not a spurious regression).
3. **RED-proof, class path (§3.1a sibling coverage):** repeat RED-proof #1 through
   `run_class_backtest` instead of `run_backtest` — same monkeypatched/malformed-timestamp
   fixture, same assertion shape (raises by default, silent-continue when flag is `false`).
   Landing only the DSL-path fix and calling Finding 3 closed while the class path's
   identical swallow is untouched is the missed-sibling failure the fix-the-whole-class
   discipline exists to catch — this RED-proof is what a grader checks first.
4. Confirm the raise is caught at the per-trade-loop boundary, not the whole
   `run_backtest`/`run_class_backtest` function boundary — i.e. confirm the failure
   message correctly identifies WHICH trade/bar triggered it rather than presenting as a
   generic top-level crash. Confirm this independently for BOTH functions' loops.
5. Independent grade (doer≠grader): confirm the flag-OFF path is genuinely
   byte-identical to today (this is the backward-compat contract) **at both call sites**,
   confirm the new exception class follows the `ZeroVolumeOnTradeCriticalBar` naming/shape
   convention closely enough that a future agent recognizes the pattern, confirm the
   audit-print is visually distinguishable from a routine warn line, confirm neither call
   site was left on the old swallow while the other was fixed.

### 3.5 Rollback
Single new env var; set `BACKTEST_ROLL_SPREAD_FAIL_LOUD=false` for instant revert to
today's silent-continue behavior, no code revert needed (same operational shape as
`BACKTEST_ZERO_VOLUME_TRADE_CRITICAL_FAIL_LOUD`).

---

## Shared Phase-2 note (explicitly deferred, named, not a silent carry-forward)

Findings 1 and 2 both eventually want the SAME primitive: "the account's real equity at
point X in a backtest run." Finding 1's version is cheap today (post-hoc running-sum over
a trade list that already exists — used by both its shadow-mode audit and its
enforce-mode blocking detection). Finding 2's sizing version is expensive (pre-hoc, needed
BEFORE the trade list exists, requires the 2-pass architecture named at §2.1a/§2.3 — a
DIFFERENT 2-pass than Finding 1's enforce-blocking re-run, which only re-runs `vbt` to
exclude specific trades and does not change how any trade was sized). **This packet does
not propose building a genuinely shared primitive** — it proposes the immediately
actionable pieces (Finding 1's full shadow+enforce wiring using the post-hoc running-sum;
Finding 2's static real-starting-floor correction) now, gated, and names the follow-up
explicitly so it does not silently rot as an unnamed TODO: a future packet titled along
the lines of "backtest running-equity sizing (2-pass)" should build a genuine per-bar
running-equity primitive once and wire BOTH Finding 1's running-balance approximation
(upgrading it from a post-hoc trade-level sum to the same real per-bar equity curve the
sizing path would use) and Finding 2's true running-equity sizing off of it.

---

## Plain-English summary for the operator (standing veto; NOT a code decision)

Two real gaps, one small one, all currently harmless because nothing is live yet:

1. **Your backtests never independently check the MFFU 2%-per-trade rule, the 500-trade
   HFT limit, or the hedging ban.** There's a piece of code that does exactly this check
   (it's already used on your live/paper side), but the historical backtest engine never
   calls it. Your trade sizing SEPARATELY tries to stay near 2% via its own math, so this
   isn't "your bot ignores the 2% rule" — it's "nobody double-checks that the sizing math
   actually landed inside 2%, and there's no MFFU HFT/hedging check at all in backtests."
   I'm proposing to add that check, OFF by default: when you turn it on in "shadow" mode
   it just shows you the truth without touching any trade; in "enforce" mode (the
   institutional default, once you opt in) it genuinely removes any trade that would have
   broken one of these rules and re-computes the results honestly — matching what "enforce
   mode blocks violations" already means for the checks your backtests DO run today. Your
   engine actually has two separate backtest paths (one for the auto-extracted strategies,
   one for hand-built ones) and I found this same gap in both — the fix covers both, not
   just one.

2. **Your position sizing always pretends every account started with exactly $50,000**,
   even for a $100K or $150K account, and it never adjusts DOWN during a losing stretch
   within a single backtest the way a real account's balance would. I found the second
   part (adjusting for real losses as they happen) is a bigger, more invasive fix — I'm
   recommending we NOT build that in this packet, and instead ship the cheap, safe part
   now: make the STARTING number match your real account (MFFU's real starting cushion is
   $48,000, not $50,000) — OFF by default, so nothing changes until you or the grader
   flips it on and re-runs the affected MFFU backtests.

3. **Small one:** if a rollover-day bar has bad/missing timestamp data, the engine
   currently just prints a warning and quietly skips charging the roll cost for that trade
   — so that trade's profit looks slightly better than it really would be. I'm proposing
   to make it fail loudly instead (like a very similar fix already shipped for
   holiday/zero-volume bars) so a bad rollover-day bar gets caught and fixed rather than
   quietly making a handful of trades look a little too good. Unlike items 1 and 2, this
   one is proposed ON by default (matching the earlier holiday/zero-volume fix) — because
   it can only ever affect a backtest that was ALREADY silently wrong on this exact bar; a
   clean backtest that never hits this exception path is untouched either way. Same as
   item 1, I found the identical copy-pasted bug in both of your backtest engines and this
   fix covers both.

**No action needed from you right now.** Items 1 and 2 ship OFF by default — nothing about
your numbers changes until an independent grader verifies each one and you (or the grader,
per your standing autonomous-instrument-work authorization) decide to turn one on. Item 3
is proposed ON by default for the reason above, but still nothing lands until the
independent grader signs off — you're not deciding anything today either way.
