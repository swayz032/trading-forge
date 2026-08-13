# AR-1147 — GPT STATIC AUDIT: CUSTOM PAPER CANDIDATE IDENTITY + DURATION GATE

**Date:** 2026-08-13  
**Runtime lineage inspected:** `main` at `64bd430810dc73e4206f8221792c922364eeec0f`  
**Compiler lane:** unchanged; Claude remains mid-order on AR-1138.

## 1. Custom PAPER authority is correct on main

M3 commit `91e1870fa148fd8ff3335050ca5870b3bb3e456d` is contained in `main` and makes the internal Massive/custom engine authoritative for lifecycle state `PAPER`.

This audit therefore evaluates the custom engine, not the TradingView/TradersPost paper route.

## 2. P0 schedule mismatch: current lifecycle still requires 30 PAPER trading days

Current `src/server/lib/paper-to-deploy-ready-precondition.ts` defines:

```text
PAPER_TO_DEPLOY_READY_MIN_TRADING_DAYS = 30
PAPER_TO_DEPLOY_READY_MIN_ROLLING_SHARPE = 1.5
```

The same file calls this an interim precondition expected to be superseded by a shorter qualifying-day evaluator, but the current constants remain 30 days.

`lifecycle-service.ts` uses a shared `countPaperTradingDaysSince()` query in both manual and cron promotion paths, so this is not a comment-only artifact: the 30-day threshold is active in the current static runtime code.

### Verdict

For the operator's current **3-5 actual trading-day custom PAPER qualification requirement**, the 30-day gate is a direct schedule conflict and must be intentionally reconciled before the qualification window. Do not bypass the rest of the evidence gates; change only the obsolete duration contract through one shared source of truth.

## 3. Current PAPER ledger does not stamp an immutable full candidate version

Current `paper_sessions` stores `strategy_id`, session/risk state, timestamps and metrics, but no full strategy-version hash.

Current `paper_trades` stores the session link and trade evidence, but no strategy-version hash.

By contrast, `production_trades` already has a required `strategy_version_hash` column.

This means custom PAPER evidence is linked to a strategy row by ID, but the ledger itself does not prove which exact executable version of that row produced every day/trade.

## 4. Restart can reload a changed strategy row

`paper-signal-service.ts::getSessionConfig(sessionId)` behaves as follows:

```text
session cache hit -> reuse cached candidate
cache miss -> load paper_sessions.strategy_id
-> fetch CURRENT strategies row
-> read CURRENT strategy.config
-> translate DSL if needed
-> cache it in process memory
```

A process restart clears the in-memory cache. The resumed PAPER session can therefore load whatever strategy row exists at restart time.

Without an immutable version receipt, a multi-day PAPER window cannot prove from the paper ledger alone that Day 1 and Day 5 executed byte-equivalent candidate logic.

## 5. Existing frozen-policy hash is useful but insufficient for full candidate identity

The current frozen-policy contract hashes only five fields:

```text
entry_quality
position_size
stop_loss
take_profit
exit_plan_config
```

It deliberately ignores other config/DSL fields.

There is also a concrete representation mismatch worth fixing or proving harmless:

- `frozen-policy-hash.ts` extracts `exit_plan_config` from `strategy.config`.
- the current paper engine loads adaptive exits from the separate top-level `strategies.exit_plan_config` column.
- `freezePolicyForStrategy()` fetches only `strategies.config` when computing the hash.

So the frozen-policy hash is not sufficient evidence that the exact adaptive-exit configuration used by custom PAPER stayed unchanged.

## 6. Reusable version-hash foundation already exists

`broker-router.ts` already contains `computeStrategyVersionHashForRouting()`.

That helper canonical-sorts the full `strategies.config` JSON and hashes it with SHA-256 for `production_trades.strategy_version_hash`.

This is useful prior art and should be reused/extracted rather than inventing another incompatible canonicalization scheme.

However, that helper is still **config-only**. The custom PAPER executable identity also consumes top-level fields outside `config`, including at minimum:

```text
strategy ID
symbol / symbol set used by the session
timeframe
separate exitPlanConfig
full strategy.config
```

The final PAPER candidate receipt should be defined from the actual custom-engine consumer surface, not from an arbitrary entire database row and not from the existing five-field frozen-policy slice.

## 7. Fast, bounded acceptance contract

Do not redesign the paper engine. Add one narrow identity contract around the existing engine:

1. Define one canonical `paper_candidate_version_hash` from the execution-relevant strategy fields.
2. Stamp it when the strategy enters the official PAPER window.
3. Persist it on the PAPER session or an immutable qualification receipt tied to that session.
4. On restart/resume, recompute the current candidate hash and require equality before the interval is counted as clean qualification evidence.
5. Keep trade rows traceable through the immutable session receipt; copying the hash onto every trade is optional if the session binding itself is immutable and auditable.
6. Stamp a separate environment/session receipt for non-strategy inputs that can change results, such as firm/risk profile and feed/config version. Do not mix those with strategy identity.
7. Use the existing shared PAPER-day counter, but replace the obsolete 30-day duration contract with the operator-approved 3-5-day qualification rule through one shared constant/evaluator used by both manual and cron paths.

## 8. PAPER qualification semantics

For the official window:

- **GREEN DAY** — same candidate version hash as the PAPER baseline; session/restart identity reconstructable; nightly AR-1145 evidence healthy.
- **YELLOW** — evidence degraded but reconstructable; do not count until reconciled.
- **RED DAY** — candidate hash changed, candidate identity missing, or restart evidence cannot prove continuity; do not count toward the required PAPER days.

A candidate improvement discovered by the 3AM learning loop should become a new version/challenger for a future run, not mutate the candidate already being qualified.

## 9. Verdict

- Custom PAPER internal-engine authority: **PROVEN on current main doctrine**.
- Shared custom PAPER trading-day counter: **FOUND**.
- Current PAPER duration gate: **30 days — CONFLICTS WITH CURRENT 3-5-DAY REQUIREMENT**.
- Full immutable PAPER candidate-version receipt: **NOT FOUND**.
- Existing frozen-policy hash: **PARTIAL ONLY**.
- Existing full-config SHA-256 implementation: **FOUND and reusable, but incomplete for top-level custom-PAPER fields**.
- Exact same-candidate proof across restart / all 3-5 days: **NOT YET CERTIFIED**.

**Advisor directive:** treat duration-contract reconciliation + immutable custom-PAPER candidate identity as bounded P0 readiness work. Do not divert Claude from AR-1138; this is prepared so the fix can be executed quickly after the compiler critical path reaches the handoff point.