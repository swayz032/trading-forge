# WORKER REPORT — AR-1211 · 2026-08-15 · AR-1210 LANES A + B + C

## THE SAFETY DEFECT IS REPAIRED IN **BOTH** ENGINES, RED→GREEN, WITH THE BYPASS'S LEGITIMATE PURPOSE PRESERVED.
## 🛑 AND MY FIRST REPAIR WAS WRONG IN A WAY THAT MATTERED — IT MADE UNREGISTERED STRATEGIES INHERIT THE OVERLAY'S FRAGILITY. FOUND BY A TEST, FIXED, DISCLOSED.

```
RULING : AR-1210 §4/§5 LANES A (reds first) + B (architecture) + C (parity).
PIN    : worker head ef77f808ed75e123fae9de9999c565b77c176e43
         repair commit 8baabd25 · inventory ef77f808
         branch claude/worker1-h1-20260815 — pushed, verified on origin
CHANGED: src/engine/context/framework_refusal.py            (NEW — canonical predicate)
         src/engine/context/eligibility_gate.py             (refusal moved above the bypass)
         src/engine/backtester.py                           (no early return; bypass-safe errors)
         src/engine/tests/test_framework_risk_before_overlay_bypass.py  (NEW — 12 tests)
         docs/designs/SYSTEM-INVENTORY.md                   (regenerated for the pre-push gate)
TESTS  : 380 passed, 1 failed — the 1 is PRE-EXISTING and baselined (§5).
         LOCAL evidence only; GitHub exposes no CI status for this SHA.
```

---

## 1. LANE A — THE REDS, AND THEY DISCRIMINATE

Written and run **before any production edit**, as ordered:

```
FAILED test_unregistered_strategy_with_oversized_stop_is_refused
FAILED test_the_refusal_reason_names_the_stop_ceiling_not_the_bypass
FAILED test_framework_risk_parity_matrix[fvg_breakout_range_1m_5m-True-SKIP]
3 failed, 6 passed

AssertionError: 'fvg_breakout_range_1m_5m' skip_trade=True: expected SKIP, got TAKE
```

**3 of 9, not 9 of 9.** The six passthrough/control assertions passed from the start, so the
red isolates the defect rather than asserting the file into existence.

---

## 2. LANE B — THE ARCHITECTURE

**One canonical predicate**, per §5's "do not duplicate business rules into two
independently drifting implementations":

```
NEW  src/engine/context/framework_refusal.py :: evaluate_framework_risk(stop_plan)
```

- **`eligibility_gate`** — the structural-stop refusal now runs **above** the unregistered
  bypass. The old positional "Check 0" body is **deleted, not duplicated**; a comment marks
  where it used to sit so the ordering cannot silently regress. This repairs paper/live
  **and** the backtester's in-loop path at once, because both call `evaluate_signal`.
- **`backtester`** — the unregistered branch no longer `return`s before the per-signal loop,
  so structural stops are computed and the same predicate applies. The mode string
  `passthrough_strategy_unregistered` is preserved (existing disclosure tests depend on it)
  and `gate_stats["framework_risk_enforced"] = True` is added so an operator can distinguish
  *"overlay bypassed, framework risk enforced"* from a fully evaluated run (§5 LANE A).

**Ordering is now named rather than positional** — that is the actual fix. The defect existed
because a MANDATORY policy and an OPTIONAL policy shared one function and one exit order.

---

## 3. 🛑 THE SIDE EFFECT I CAUSED — THIS IS THE PART TO READ

My first backtester repair (just dropping the early return) **broke §5's own constraint**.
A test caught it:

```
test_wave_b_intrabar_stops::test_eligibility_gate_unregistered_strategy_passthrough
  AssertionError: Unregistered strategy: signals must be returned unchanged (bypass path)
  eligibility_gate_error bar=1: AttributeError: 'object' object has no attribute 'prev_day_high'
  eligibility_gate_error bar=4: ...
  eligibility_gate_error bar=9: ...
```

With the early return gone, unregistered strategies were now evaluated — and when the
**overlay's** data dependencies failed, the `context_error` path dropped every signal.

**That is more than losing the framework-safety bypass.** §5 says such a strategy *"must only
lose the ability to bypass framework safety"*; mine also inherited the overlay's
data-availability fragility, which is exactly the backtest↔paper divergence the bypass exists
to prevent.

**Fix:** when the overlay is bypassed, a **context error keeps the signal** (counted as
`context_error_overlay_bypassed_kept`). Framework refusal is untouched by this, because it
runs *before* the bypass and does not depend on the overlay's context at all.

★ I am flagging this loudly because the first version would have passed a careless review:
it made the safety test green while quietly changing backtest results for every unregistered
strategy.

---

## 4. LANE C — THE PARITY MATRIX

| case | result |
|---|---|
| registered + oversized stop | **SKIP** |
| unregistered + oversized stop | **SKIP** ← the repair |
| unregistered + safe stop | **TAKE**, bypass reasoning intact |
| stop price, every cell | **un-clamped** (4486.0 preserved) |
| refusal reason | names the stop/ceiling, not the bypass |
| backtest, unregistered | mode preserved + `framework_risk_enforced=True` |

Two structural guards so this cannot silently regress:
- the backtest branch is asserted to contain **no early return** in the 12 lines after its
  mode stamp;
- exactly **ONE** definition of `evaluate_framework_risk` exists.
  ⚠️ My first version of that check used `git grep`, which **skips untracked files** and
  returned `0` for a module that plainly exists. Instrument artifact, corrected to a
  filesystem scan **with a positive control** so a broken scanner cannot read as a clean result.

---

## 5. THE ONE REMAINING FAILURE IS NOT MINE — BASELINED

```
FAILED test_wave_b_intrabar_stops::test_long_tp_fires_intrabar_even_if_close_falls_back
  AssertionError: No-TP path: expected exit at original exit bar 5; got 3
```

I did **not** assume it was pre-existing. I copied my two modified production files aside,
restored both from `HEAD`, re-ran, and it failed **identically**; then restored my edits and
confirmed they were back. **Pre-existing intrabar-exit defect, unrelated to this ruling.**
Reported, not fixed.

---

## 6. DISCLOSED SCOPE EXCEPTION

The pre-commit ruff hook blocked the commit on **10 pre-existing findings** in
`eligibility_gate.py` (import order + an unused `route_playbook` re-export) — they entered
scope only because I touched the file. **I ran `ruff --fix` to unblock authorized work rather
than skipping the hook**, after verifying nothing imports `route_playbook` from that module.
That is the only unrelated change in the diff and it is mechanical.

Separately, the **pre-push inventory-freshness gate refused** the first push; I regenerated
`SYSTEM-INVENTORY.md` and committed it rather than bypassing.

---

## 7. FINDINGS AGAINST MYSELF

1. §3 — my first repair violated the ruling's own preservation constraint. A test found it,
   not me.
2. §4 — my `git grep` guard returned a false zero.
3. I have not done **Lane D** (downstream defense-in-depth assertion). §5 says it comes
   *after* the primary fix and only if the order envelope carries refusal state cleanly —
   I have not established that it does, so I did not start it.

---

```
STOP   : Primary repair complete in both engines. Not starting Lane D, AR-1208 Lane 3
         (paired visual) or Lane 4 (integration) — §6 orders the queue and I am reporting
         at the boundary it names.
GRADER : not dispatched — no ruling requires an independent grade of this repair, and
         AR-1199's grader lock is unchanged. Say the word if you want one; this is
         production money-path code and I am the doer.
NEXT   : per AR-1210 §6, the queue is: (1) this repair graded/accepted, (2) then Lane 3
         paired visual, (3) then Lane 4 integration.
         Two things I would put in front of the queue for your judgement:
         (a) **Lane D is more than housekeeping.** `skip_trade` still has ONE reader. It is
             now in the right place, but a refusal protecting real capital with a single
             enforcement point is fragile — and the failure mode is silent.
         (b) the pre-existing intrabar-exit failure (§5) is in the trade-management path.
             I have not investigated it and it is not in any lane, so it currently has
             no owner.
```
