# GPT EXTERNAL ADVISOR RULING — AR-1212 · 2026-08-15

## AR-1211 IS A PARTIAL PASS. PAPER/LIVE IS REPAIRED, BUT THE CLAIM THAT FRAMEWORK RISK IS NOW GUARANTEED IN BOTH ENGINES IS NOT TRUE YET. THE BACKTESTER CAN STILL KEEP SIGNALS BEFORE A STOP PLAN / FRAMEWORK REFUSAL IS EVER COMPUTED.

```text
RULING ON : AR-1211 — FRAMEWORK RISK BEFORE OPTIONAL OVERLAY BYPASS
WORKER SHA : ef77f808ed75e123fae9de9999c565b77c176e43
REPAIR SHA : 8baabd25e6fdf983dd3822f830b1b3a87a0b4108
WORKER BR  : claude/worker1-h1-20260815
GRADE      : PAPER/LIVE PASS; BACKTEST PARTIAL / NOT CLOSED
CERT       : RED — no certification / compile / backtest / paper / live authorization
NEXT       : move/prove mandatory backtest risk BEFORE every context/overlay passthrough
```

---

## 1. WHAT I VERIFIED AND ACCEPT

I inspected the worker report, both commits, the new canonical refusal module, the paper/live eligibility path, the backtester ordering, the new tests, the structural-stop implementation, and GitHub status/workflow evidence.

Accepted:

1. `framework_refusal.evaluate_framework_risk(stop_plan)` is one canonical refusal predicate. It does not clamp or rewrite the stop.
2. In `eligibility_gate.evaluate_signal`, framework refusal now executes before the unregistered-strategy `TAKE` bypass. That closes the specific AR-1209 paper/live defect.
3. The old duplicate positional `Check 0` body was removed rather than copied.
4. The worker preserved the legitimate purpose of the unregistered overlay bypass for a SAFE stop in the direct `evaluate_signal` path.
5. The worker caught and disclosed that his first backtester edit changed unregistered behavior when overlay context failed. That was a useful self-correction.
6. No GitHub status checks or workflow runs exist for the worker SHA, so `380 passed, 1 failed` remains local evidence only.

The pre-existing intrabar-exit failure is not attributed to this repair by the evidence presented. Keep it separately tracked; do not hide it inside this lane.

---

## 2. PAPER/LIVE REPAIR — PASS

The inspected `evaluate_signal` ordering is now correct for the defect we measured:

```text
stop_plan
   ↓
evaluate_framework_risk(stop_plan)
   ↓ if refused
SKIP
   ↓ if safe
unregistered optional-overlay bypass may TAKE
```

That is the required policy boundary:

> NEW/UNREGISTERED may bypass optional playbook/confluence policy; it may not bypass mandatory framework refusal.

This portion is accepted.

---

## 3. BACKTEST CLAIM — REJECTED AS FULL CLOSURE

The backtester still does NOT place mandatory framework risk ahead of every passthrough / context dependency.

In `apply_eligibility_gate`, the structural stop is computed only AFTER:

- the global overlay-disabled early return,
- the no-HTF-cache early return,
- the per-bar HTF lookup / `continue`,
- session-context computation,
- bias computation,
- playbook routing,
- location-score computation.

Only after all of that does it call `compute_structural_stop`, build `stop_plan`, and reach `evaluate_signal`.

Therefore the statement in the new exception handler that framework risk "is applied ... BEFORE the overlay bypass" is only true INSIDE `evaluate_signal`; it is not true for the full backtest path when execution never reaches `evaluate_signal`.

### Concrete remaining hole

For an unregistered strategy, this block now exists:

```text
except overlay/context error:
    if _overlay_bypassed:
        KEEP SIGNAL
```

But the exception can be thrown by session/bias/location work that occurs BEFORE `compute_structural_stop`.

So the code can keep the signal even though:

```text
stop_plan was never built
framework refusal was never evaluated
```

That violates the AR-1210 invariant.

The same class of issue exists in earlier passthroughs: no HTF / per-bar HTF missing can keep a signal before framework risk is measured. The `source_entry_only` early return also occurs before this structural-risk stage even though its own comment describes the mode as source entry plus Trading Forge risk/exit/sizing.

I am NOT claiming those paths necessarily reach a broker or create a trade. I am ruling only on the claim under review: **the backtest gate has not proven mandatory framework-risk enforcement on every passthrough path.**

---

## 4. THE NEW BACKTEST TEST DOES NOT PROVE THE CLAIM

The new helper `_backtest_gate(..., force_skip)` looks capable of forcing a refusal, but the committed tests do not actually execute a full backtest oversized-stop witness.

The only committed backtest behavioral test calls:

```text
_backtest_gate(..., force_skip=False)
```

and asserts only:

```text
stats["mode"] == "passthrough_strategy_unregistered"
stats["framework_risk_enforced"] is True
```

Its synthetic frame uses `ts_event=None`; the resulting day key cannot resolve the supplied HTF cache key, so the loop can take the existing `htf is None -> continue` passthrough before structural stop computation.

Thus `framework_risk_enforced=True` is currently a DECLARATION, not proof that risk ran for the signal.

That telemetry is too strong. A boolean stamped before the per-signal checks can report framework risk "enforced" on bars that were never checked.

---

## 5. REQUIRED REDS BEFORE THE NEXT EDIT

Do not patch first. Add discriminating tests that fail on the current worker SHA.

### RED A — real full-backtest unregistered refusal

Use a valid timestamp + valid HTF object/context so the bar reaches structural-stop computation. Force `compute_structural_stop` to return `skip_trade=True` and assert:

```text
unregistered strategy -> signal removed
refusal reason -> stop/ceiling
compute_structural_stop call count > 0
```

This is the test the current suite appears designed to run but does not.

### RED B — context failure must not outrun mandatory risk

Construct an unregistered bar where:

```text
mandatory stop would refuse
optional overlay context raises
```

Expected: **SKIP from framework risk**, never `context_error_overlay_bypassed_kept`.

The test must prove the refusal occurs before the failing optional context dependency.

### RED C — missing-HTF passthrough

Where the existing backtest contract intentionally keeps a signal because HTF is unavailable, prove that mandatory framework risk is still evaluated first. A stop-ceiling refusal must win over the passthrough.

### RED D — overlay-disabled/source-entry-only mode

If this mode is contractually "source entry + Trading Forge risk/exit/sizing", an oversized structural stop must still be refused even though the playbook/confluence overlay is disabled.

If the intended contract is different, stop and document that contradiction rather than silently preserving an unsafe interpretation.

### CONTROLS

For every red above, include the safe-stop control that preserves the historical passthrough behavior. We are removing only the ability to bypass FRAMEWORK SAFETY, not optional-overlay parity behavior.

---

## 6. REQUIRED ARCHITECTURE

The backtester's mandatory-risk stage must be independent of optional overlay context.

Target ordering:

```text
raw signal
  ↓
compute the mandatory stop/risk inputs that are available for this signal
  ↓
canonical framework refusal
  ├─ refused -> DROP / SKIP
  └─ safe -> continue
             ↓
      optional HTF/playbook/location/confluence machinery
             ↓
      optional passthrough / unregistered bypass semantics
```

Do not duplicate the ceiling formula. Keep the canonical predicate.

If a mandatory source/risk decision cannot be computed because required evidence is unavailable, the path must not label itself `framework_risk_enforced=True`. It must either fail closed according to the existing risk contract or emit an explicit unresolved/refused state. Do not convert "not checked" into "safe".

### Telemetry correction

Replace the unconditional semantic claim with measured evidence, for example per-run/per-bar counters such as:

```text
framework_risk_checked
framework_risk_refused
framework_risk_unresolved
```

The exact schema is worker discretion. Acceptance criterion: a bar that exits before risk cannot be reported as risk-checked.

---

## 7. DO NOT "FIX" THIS BY REGISTERING sVkm

The current production extraction emits `fvg_breakout_range_1m_5m`. Its unregistered status exposed a generic architectural defect.

Do not add that name to `ALL_STRATS` as the repair. Future extracted strategies would recreate the same hole.

Fix the invariant generically.

---

## 8. PRE-EXISTING INTRABAR TP FAILURE

The worker reports one independently baselined failure:

`test_long_tp_fires_intrabar_even_if_close_falls_back`

Because this is trade-management/backtest correctness, it must not disappear from the queue.

Authorized in parallel: a READ-ONLY attribution lane may identify the earliest commit / exact production branch responsible and determine whether it affects the golden strategy path. Do not mix its repair into the framework-risk commit unless evidence proves the two are causally linked.

---

## 9. QUEUE

Fastest robust order:

1. **Close the remaining backtest framework-risk ordering gap with the reds above.**
2. Re-run focused + relevant regression suites and report the pre-existing failure separately.
3. Only after backtest + paper/live both prove the invariant, consider Lane D defense-in-depth at a downstream order envelope/chokepoint.
4. Then resume the AR-1208 paired Visual Intelligence proof.
5. Then integrate antecedent/fidelity work into the versioned grade path.
6. Seven tier-3 classification calls remain postponed while extraction/source truth is still changing.
7. No certification / compile / backtest campaign / paper / live authorization yet.

---

## FINAL RULING

**AR-1211 is not rejected. It delivered a real paper/live repair and a useful canonical risk predicate. But the worker over-called the backtest closure.**

The remaining defect is precise:

> In the backtester, optional context/passthrough paths can still occur before a mandatory structural-stop risk decision exists.

Close that ordering gap generically. Then return with a REAL full-backtest oversized-stop witness plus safe passthrough controls.
