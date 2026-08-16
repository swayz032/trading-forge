# GPT EXTERNAL ADVISOR RULING — AR-1210 · 2026-08-15

## AR-1209 IS ACCEPTED. THE STOP-CEILING ALARM IS CORRECTLY WITHDRAWN. THE UNREGISTERED-STRATEGY BYPASS IS A REAL FRAMEWORK-RISK DEFECT: IT BYPASSES `skip_trade` IN PAPER/LIVE, AND THE BACKTESTER'S MATCHING PASSTHROUGH OCCURS BEFORE ITS STRUCTURAL-STOP EVALUATION. FIX THE ARCHITECTURAL SEPARATION, NOT THE STRATEGY NAME.

```text
RULING ON : AR-1209 — STOP CEILING WITHDRAWAL + ONBOARDING BYPASS
WORKER SHA : eeda148078c67b01efeca7762c2727dec449d4be
WORKER BR  : claude/worker1-h1-20260815
GRADE      : ACCEPT REPORT; SAFETY DEFECT CONFIRMED
CERT       : RED — no certification / compile / backtest / paper / live authorization
NEXT       : framework refusal must run before optional overlay bypass in BOTH backtest and paper/live
```

---

## 1. INDEPENDENT VERIFICATION

The worker report is supported by the repository evidence.

- The worker SHA exists and contains a read-only witness plus artifact/inventory changes; no production money-path code was changed.
- The corrected instrument witness shows the prior MES-vs-MNQ stop-ceiling conclusion was false. Under the synthetic geometry, MNQ remains below its own ceiling and the stop price is preserved rather than clamped.
- The production `evaluate_signal` path contains an unregistered-strategy `TAKE` return before `stop_plan.skip_trade` is checked. Therefore an unregistered name with `skip_trade=True` bypasses the structural-stop refusal.
- The exact sVkm extraction name is `fvg_breakout_range_1m_5m`, so the witness is not testing an invented strategy identity.
- The existing ds21 parity test intentionally locks the unregistered overlay bypass but never tests `skip_trade=True`, explaining why the defect stayed green.
- The backtester has its own unregistered passthrough before the per-signal block that computes structural stops and invokes `evaluate_signal`. Therefore moving only the paper/live check would repair safety on one path while recreating backtest↔paper divergence.
- GitHub exposes no CI/status evidence for the worker SHA. The claimed local test count remains local evidence only.

---

## 2. RULING ON THE WITHDRAWN STOP-CEILING FINDING

Withdrawal accepted completely.

The previous claim that Trading Forge quietly shrinks the teacher's stop is false for the inspected structural-stop path. The code preserves the computed stop and raises `skip_trade` when the ceiling is exceeded. The prior apparent sVkm ceiling breach was also produced with MES risk configuration for a Nasdaq/MNQ source example.

Do not spend another ruling on source-vs-framework precedence from that false premise.

Canonical rule remains:

> preserve source geometry; framework risk may refuse the setup; never fabricate a tighter substitute stop.

---

## 3. THE NEW DEFECT IS REAL

The comment says the unregistered branch bypasses only the optional eligibility overlay while framework/risk gates still apply.

The code does not satisfy that contract.

In paper/live `evaluate_signal`:

1. strategy registration is checked;
2. unregistered strategy returns `TAKE`;
3. only afterward would `stop_plan.skip_trade` be checked.

So the framework refusal never runs for that path.

In the backtester, the unregistered-strategy passthrough returns before the normal per-signal structural-stop computation and eligibility evaluation. This means the same conceptual separation is missing there too.

This is a safety defect, but AR-1209 correctly did **not** prove broker egress or claim a bad live order was placed. Preserve that scope discipline.

---

## 4. DO NOT 'FIX' THIS BY BLINDLY REGISTERING sVkm

Do **not** make `fvg_breakout_range_1m_5m` green by simply stuffing the name into `ALL_STRATS`.

Registration has playbook meaning. Blind registration can accidentally change which overlay rules apply and would hide the architectural defect for the next newly certified strategy.

The defect is generic:

> NEW/UNREGISTERED may bypass PLAYBOOK/CONFLUENCE OVERLAY policy, but NEW/UNREGISTERED may NEVER bypass FRAMEWORK RISK / REFUSAL policy.

Fix that boundary once.

---

## 5. AUTHORIZED FASTEST ROBUST REPAIR

### LANE A — PERMANENT REDS FIRST

Add failing tests before production edits.

**Paper/live witness:**

- unregistered strategy + `stop_plan.skip_trade=True` => `SKIP`;
- same unregistered strategy + safe stop => retains the intended overlay bypass / passthrough behavior;
- registered strategy behavior remains unchanged.

Use the actual emitted sVkm strategy name as one test fixture, but no source-specific name may enter production logic.

**Backtest witness:**

- unregistered strategy whose framework stop exceeds the symbol ceiling must not survive as an admitted entry merely because the overlay is bypassed;
- same unregistered strategy with a safe framework stop must still retain the intended unregistered-overlay passthrough;
- mode/provenance must remain explicit so operators can distinguish `overlay bypassed, framework risk enforced` from a fully evaluated overlay run.

Use correct per-symbol cases, including MNQ=62pt. Preserve skip-not-clamp.

### LANE B — SEPARATE FRAMEWORK REFUSAL FROM OPTIONAL OVERLAY

Implement the smallest generic architecture that makes the ordering explicit in both engines:

```text
SOURCE SIGNAL
   -> FRAMEWORK HARD REFUSALS / RISK
      -> if refused: SKIP
   -> OPTIONAL PLAYBOOK / CONFLUENCE OVERLAY
      -> registered: evaluate overlay
      -> unregistered: bypass overlay only
   -> downstream
```

Do not duplicate business rules into two independently drifting implementations if avoidable. Prefer one canonical framework-refusal predicate/result reused by the two paths, or an equivalent shared contract with parity tests.

The repair must preserve the reason the unregistered bypass exists: a new strategy must not be killed merely because it is absent from a playbook list. It must only lose the ability to bypass framework safety.

### LANE C — PARITY CONTROL

Prove these outcomes side-by-side:

1. registered + oversized stop => SKIP in both paths;
2. unregistered + oversized stop => SKIP in both paths;
3. unregistered + safe stop => overlay bypass remains intentional in both paths;
4. stop price remains un-clamped;
5. wrong symbol cannot silently select another instrument's ceiling.

Do not call this closed from unit tests against `evaluate_signal` alone.

### LANE D — OPTIONAL DEFENSE IN DEPTH, AFTER THE PRIMARY FIX

A second money-egress assertion is useful only if it consumes the same authoritative refusal state. Do not create a second independent stop-ceiling calculation that can drift from the first. First repair the primary framework-risk boundary; then a downstream `refused => no order` assertion may be added as defense in depth if the existing order envelope carries the refusal state cleanly.

---

## 6. QUEUE ORDER

This safety defect outranks the remaining sVkm visual/integration work.

Order:

1. red-prove and repair unregistered framework-risk parity;
2. demonstrate backtest + paper/live parity with the actual unregistered sVkm name;
3. then resume AR-1208 Lane 3 paired visual proof;
4. then resume Lane 4 integration of antecedent + fidelity detector into the versioned grade path.

Do not use the bypass repair to certify sVkm. The extraction remains red for its separate unresolved grading/stop-identity issues.

---

## 7. FORBIDDEN

- no blind `ALL_STRATS` registration as the fix;
- no removal of the unregistered overlay bypass without proving backtest/paper parity;
- no moving only the paper/live check and leaving backtest semantically different;
- no clamp/substitute stop;
- no sVkm-specific production hardcode;
- no claim that `TAKE` from this function proves broker execution;
- no compile/backtest/paper/live authorization from this ruling;
- no fake CI claim: current worker evidence is local-only.

---

## 8. ENGINEERING GRADE

**AR-1209: PASS.** The worker corrected the false money-path alarm, built the requested witness, found a real deeper defect, stated the scope correctly, and stopped before changing money-path semantics.

**System finding: MATERIAL SAFETY DEFECT.** The code says unregistered strategies bypass only overlay policy, but today they also bypass the structural-stop refusal in the paper/live function, while the backtester passthrough occurs before structural-stop evaluation. The right repair is architectural separation of mandatory framework risk from optional overlay policy, with parity proof on both paths.
