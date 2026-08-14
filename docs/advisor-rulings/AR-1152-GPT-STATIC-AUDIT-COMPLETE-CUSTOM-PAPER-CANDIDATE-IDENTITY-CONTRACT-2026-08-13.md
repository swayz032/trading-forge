# AR-1152 — GPT STATIC AUDIT — COMPLETE CUSTOM PAPER CANDIDATE IDENTITY CONTRACT

Date: 2026-08-13  
Repo: `swayz032/trading-forge`  
Runtime/PAPER authority inspected: `main` at `64bd430810dc73e4206f8221792c922364eeec0f`  
Compiler authority remains: `h1-wave4-sealed12-driver`  

## Verdict

**DO NOT EXPAND THE LEGACY 5-FIELD FROZEN-POLICY HASH INTO A GIANT NEW HASH ON THE DEADLINE PATH.**

The smallest robust solution for official 3–5 day custom PAPER qualification is:

1. one **session-scoped executable candidate hash** built from the exact strategy inputs the custom PAPER hot path actually consumes;
2. one separate **PAPER run/environment fingerprint** for the resolved session/feed/risk environment;
3. one **runtime build revision pin** for the deployed code executing the candidate;
4. stamp those once at official PAPER start, preserve the immutable source snapshot in the existing append-only audit spine, and recompute/compare them before a day can count.

This closes the current identity hole without:

- rewriting the historical `frozenPolicyHash` contract;
- re-baselining old frozen strategies;
- creating another strategy object model;
- creating another telemetry table;
- interrupting Claude's AR-1138/compiler work.

The key new finding is that the existing five-field frozen-policy slice is not merely missing the dedicated live exit column. It is also far narrower than the actual custom PAPER executable strategy surface. The PAPER engine loads and executes the **full translated strategy config**.

## 1. What the custom PAPER engine actually executes

Current `paper-signal-service.ts` loads a strategy row, then:

```text
strategy.config
    ↓
if DSL: translateDSLToPaperConfig(...)
    ↓
full executable StrategyConfig
    ↓
CachedSession.config
    ↓
evaluateSignals(...)
```

The hot-path cache also carries:

```text
strategyId
name
symbol
timeframe
lifecycleState
shadowModeEnabled
exitPlanConfig  // dedicated live strategies.exit_plan_config column
```

This matters because several of these are behavior-affecting, not display metadata.

### `name` is executable behavior

The context/eligibility gate uses the strategy **concept name** to match allowed strategies. The code explicitly documents that passing the UUID instead of the name previously made live signals SKIP incorrectly.

Therefore a rename is not harmless metadata for custom PAPER. A complete executable candidate identity must include the strategy name unless/until that live name-based routing dependency is removed.

This is intentionally stricter than the old frozen-policy hash, whose comment says changing `strategy.name` does not invalidate the hash.

### `symbol` and `timeframe` are executable behavior

The cached symbol is the product identity, and the cached timeframe drives the live aggregation/evaluation path. Both belong in the candidate identity.

### the full translated `config` is executable behavior

Weighted scoring, entry-quality routing, confluence dispatch, entry windows, sizing inputs, stops, triggers, and other strategy logic are read from the runtime `config` object. The old five-field slice cannot certify that those inputs stayed unchanged.

Do **not** hand-maintain another partial list of dozens of config keys. Hash the complete executable config object that the PAPER engine actually evaluates.

### dedicated `exitPlanConfig` is executable behavior

The current engine explicitly reads the separate top-level `strategies.exitPlanConfig` field, not `strategy.config.exit_plan_config`, for adaptive-exit routing at fill time.

That is the already-confirmed dual-column HIGH finding in:

`docs/ratify-packets/frozen-policy-exit-config-dual-column-2026-07-17.md`

The legacy `frozenPolicyHash` still hashes the JSONB copy and therefore cannot serve as the official PAPER candidate identity.

## 2. Candidate identity v1 — exact minimal contract

Use a new, PAPER-specific versioned projection. Conceptually:

```ts
interface PaperExecutableCandidateIdentityV1 {
  schema_version: "paper-candidate-v1";
  strategy_id: string;
  strategy_name: string;
  symbol: string;
  timeframe: string;

  // IMPORTANT: this is the runtime config AFTER the same DSL translation
  // getSessionConfig() uses, not a second independent translation policy.
  executable_config: unknown;

  // Authoritative live exit column used by the fill path.
  live_exit_plan_config: ExitPlanConfig | null;
}
```

Then:

```text
canonical sorted JSON
        ↓
SHA-256
        ↓
paper_candidate_hash
```

### Why post-translation config

The requirement is **same executable candidate**, not merely same source-row bytes.

If two source representations compile/translate to the same executable PAPER config, the execution identity can remain the same. If a source row is unchanged but translation behavior changes because the deployed runtime changes, the separate runtime-revision pin below catches that change.

### Do not use the dead JSONB exit copy as authority

`config.exit_plan_config` may remain in the source snapshot for diagnostics, but it must not override the dedicated live `exitPlanConfig` in the v1 PAPER candidate projection.

Do not require the two historical copies to be equal as a prerequisite for hashing; the existing ratify packet proves many ordinary graduations can disagree at birth. Blocking solely on that legacy mismatch would create a deadline-wide false stop.

## 3. Keep legacy frozen-policy semantics separate

Current `freezePolicyForStrategy()` selects only:

```text
strategies.id
strategies.config
```

and computes the old five-field hash from `config`.

Do **not** silently change that historical hash basis as part of the PAPER deadline patch. The July ratify packet correctly warns that doing so can reinterpret already-frozen rows and trigger an override/rebaseline storm.

For the current deadline:

```text
legacy frozenPolicyHash
    = historical lifecycle/re-optimization contract

paper_candidate_hash v1
    = official custom-PAPER executable identity contract
```

They may be rationalized later through a separately ratified versioned migration. They do not need to be merged now.

## 4. Separate strategy identity from PAPER run/environment identity

A strategy can stay byte-identical while the PAPER environment changes enough to alter behavior.

Do not contaminate the strategy candidate hash with rolling equity, P&L, counters, or other mutable session state. Instead create a separate run fingerprint over the **resolved static settings actually used for this qualification run**.

Conceptually:

```ts
interface PaperQualificationRunIdentityV1 {
  schema_version: "paper-run-v1";
  paper_candidate_hash: string;

  mode: "paper";
  firm_id: string | null;

  resolved_session_config: {
    side: string | null;
    cooldown_bars: number;
    daily_loss_budget: number;
    bypass_news_blackout: boolean;
    fill_model_enabled: boolean;
    latency_ms: number;
    firm_key: string | null;
    trailing_dd_amount: number | null;
  };

  feed: {
    feed_mode: "delayed" | "realtime" | "unknown";
    nominal_delay_seconds: number | null;
    resolved_stream_symbols: string[];
    resolved_provider_contract_tickers: string[];
  };

  runtime_revision: string;
}
```

Exact field names can match existing conventions. The invariants matter.

### Use resolved values, not just optional raw input

`paper_sessions.config` is intentionally sparse and many fields fall back to firm/code/env defaults. Hashing only the raw optional JSON would miss a behavior change caused by a changed default.

The run fingerprint should capture the **effective values** used at session start.

### Feed identity belongs here, not in the strategy hash

AR-1148 already established that the current custom stream is pinned by default to the Massive delayed feed and that listed-contract resolution remains a separate P0.

The official run identity must record the actual resolved contract ticker(s) and feed recency. Do not infer them later from the strategy root symbol.

### Mutable session values do NOT belong in this hash

Do not hash:

- current equity;
- peak/HWM;
- daily P&L;
- total trades;
- proven trades;
- governor runtime state;
- cooldown-until timestamps;
- signal timestamps;
- metrics snapshots.

Those are evidence generated by the run, not the definition of the run.

## 5. Runtime revision is a separate P0 pin

A strategy row can remain unchanged while a deployment changes the code that translates or evaluates it.

Example:

```text
same strategy.config
same dedicated exitPlanConfig
new translateDSLToPaperConfig implementation
        ↓
different executable behavior
```

Therefore candidate-row hashing alone cannot prove “same executable candidate” across 3–5 days.

Every official PAPER day must also carry one stable deployed runtime revision/build identity.

Preferred rule:

```text
official PAPER qualification run
    -> one pinned runtime revision
    -> no ordinary runtime deploys during the 3–5 qualifying-day window
```

If an emergency deploy changes the PAPER runtime revision, the next day must not silently continue the old qualification chain. Start a new run/continuity chain unless an explicitly versioned policy proves the changed build is outside the executing surface.

Do not fabricate this value from the current GitHub `main` HEAD at report time. The running deployment must stamp its own build/deploy revision. If the platform already exposes a deployment commit SHA, use it; otherwise inject a deploy-time `TF_RUNTIME_REVISION`-style value through CI/deployment.

## 6. Lifecycle/shadow state are qualification assertions, not candidate fields

Current session cache carries `lifecycleState` and `shadowModeEnabled`, but these are orchestration/routing state and lifecycle transitions are intentionally mutable.

For an official counted custom-PAPER day require:

```text
lifecycle_state == "PAPER"
shadow_mode_enabled == false
paper_session.mode == "paper"
```

Do not bury these inside the immutable strategy hash. Put them in the daily receipt validity checks.

A day that accidentally ran in SHADOW, PILOT, or another authority state does not count as an official PAPER qualification day.

## 7. Fast persistence design — reuse existing JSONB + append-only trust spine

Do not add a new telemetry table.

The repo already has the exact low-cost pattern needed here:

`paper-evidence-labels.ts` stamps additive metadata into existing `paper_sessions.config` and also emits an audit row. Its own header explicitly notes that this needs no migration.

Reuse that architecture for a small set-once qualification identity block, for example:

```text
paper_sessions.config.qualification_identity = {
  schema_version,
  candidate_hash,
  run_config_hash,
  runtime_revision,
  stamped_at
}
```

At the same time write one append-only audit event, e.g.:

```text
paper_candidate.identity_stamped
```

whose input/result preserves the canonical candidate projection and resolved run snapshot used to compute the hashes.

Why both:

- session JSONB gives the hot/restart path a cheap comparison target;
- append-only `audit_log` preserves the immutable historical source snapshot even if the strategy row is later edited.

The audit spine already has a database mutation-prevention trigger. Reuse it.

### Set-once rule

For an official qualification session:

```text
missing identity at first start
    -> compute + stamp once

same identity on restart/day check
    -> continue

different recomputed candidate/run/runtime identity
    -> fail qualification closed
    -> preserve mismatch evidence
    -> do NOT overwrite the old stamp
```

Never “repair” a mismatch by silently replacing the stored hash.

## 8. Do not make the synchronous stream starter async

`paper-trading-stream.ts::startStream()` is intentionally synchronous and its audit path is fire-and-forget.

Do not force DB identity work into that function and turn the streaming primitive async just to meet this contract.

Stamp/verify qualification identity in the existing **async PAPER session start/resume orchestration immediately before the stream is allowed to become qualification-active**. Then let `startStream()` remain the small synchronous stream primitive.

On process restart, verification must happen before a resumed session becomes qualification-valid.

## 9. Daily receipt join

AR-1150's receipt can now use:

```text
paper_candidate_hash
paper_run_config_hash
runtime_revision
        +
paper session / signal / position / trade evidence
        +
feed-gap + restart evidence
        +
3AM run/correlation evidence
        ↓
PAPER-DAY RECEIPT
```

A counted day requires at minimum:

```text
candidate_hash_matches_start == true
run_config_hash_matches_start == true
runtime_revision_matches_start == true
lifecycle_state_is_paper == true
shadow_mode_disabled == true
custom_massive_authority == true
unresolved_provider_gap == false
restart_recovery_incomplete == false
unreconciled_signal_execution_count == 0
duplicate_execution_count == 0
critical_risk_control_failure_count == 0
nightly_required_evidence_complete == true
unauthorized_candidate_mutation_count == 0
```

This makes AR-1150 and AR-1151 implementable without inventing another source of truth.

## 10. Required RED → GREEN tests

Minimum implementation evidence:

1. **full config mutation bites** — change an entry/trigger/confluence field outside the old five-field slice; `paper_candidate_hash` must change.
2. **live exit-column mutation bites** — change only dedicated `strategies.exitPlanConfig`; old frozen hash may stay the same, but `paper_candidate_hash` must change.
3. **name mutation bites** — rename strategy; candidate hash changes because name participates in live context routing.
4. **symbol mutation bites** — candidate hash changes.
5. **timeframe mutation bites** — candidate hash changes.
6. **key order does not bite** — semantically identical JSON with different object key order produces identical hash.
7. **same restart is stable** — same candidate + resolved run config + runtime revision recomputes identically after process restart.
8. **environment change is separated** — change feed/session resolved config; candidate hash stays the same but run-config hash changes.
9. **runtime deploy bites** — same candidate/run settings with a new runtime revision invalidates continuity.
10. **mismatch is fail-closed and immutable** — mismatch writes evidence and does not overwrite the original start stamp.
11. **legacy contract untouched** — existing frozen-policy tests remain byte-for-byte behaviorally valid; no old `frozenPolicyHash` row is re-baselined.
12. **real lifecycle seam** — test the actual PAPER start/resume path, not a copied helper, and prove stream qualification cannot begin before identity verification succeeds.

## 11. Fast implementation order for Claude after AR-1138

Do this in the smallest vertical slice:

1. pure canonical hash helper for `paper-candidate-v1` + `paper-run-v1`;
2. expose/reuse the SAME executable config/session-cache translation path — no copied DSL translation;
3. extend `PaperSessionConfigShape` with the set-once qualification identity metadata;
4. stamp + append-only audit at official PAPER start;
5. verify on restart/resume and mark mismatch fail-closed for qualification;
6. thread the three identity values into AR-1150 daily receipt;
7. make AR-1151 3-day-min / 5-day-target evaluator count only receipt-valid days;
8. run live restart + 3AM evidence proof.

Do not start by migrating the legacy frozen-policy schema. Do not redesign the stream. Do not rebuild telemetry.

## 12. Status

- Legacy five-field frozen-policy hash: **KEEP / NOT COMPLETE PAPER IDENTITY**
- Full translated PAPER config as candidate basis: **PROVEN BY CURRENT HOT PATH**
- Strategy name as behavior-affecting candidate input: **PROVEN BY CURRENT CONTEXT-GATE DEPENDENCY**
- Symbol/timeframe as candidate inputs: **PROVEN BY CURRENT SESSION CACHE / STREAM PATH**
- Dedicated `exitPlanConfig` as candidate input: **PROVEN / CURRENT LIVE AUTHORITY**
- Session/evidence-label JSONB reuse: **PROVEN FOUNDATION / NO NEW TABLE REQUIRED**
- Append-only audit spine reuse: **PROVEN FOUNDATION**
- PAPER candidate hash v1: **FROZEN REQUIREMENT / NOT IMPLEMENTED**
- PAPER run-config hash v1: **FROZEN REQUIREMENT / NOT IMPLEMENTED**
- Runtime revision pin: **FROZEN REQUIREMENT / NOT YET PROVEN IN DEPLOYED RUNTIME**
- Daily receipt integration: **NEXT IMPLEMENTATION JOIN AFTER IDENTITY**
- Claude compiler branch: **UNTOUCHED**

## Bottom line

The fastest robust path is **not** “fix the old hash and hope.”

It is:

```text
actual executable strategy
        ↓
paper_candidate_hash v1

resolved PAPER environment
        ↓
paper_run_config_hash v1

actual deployed code
        ↓
runtime_revision

all three stable
        +
daily reconciliation green
        ↓
ONE receipt-valid PAPER day
        ↓
3 minimum / 5 target
```

That gives Claude a bounded implementation instead of another architecture-discovery session when the weekly limit resets.
