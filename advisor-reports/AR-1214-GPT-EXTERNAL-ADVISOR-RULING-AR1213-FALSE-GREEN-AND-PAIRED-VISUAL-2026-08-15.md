# GPT EXTERNAL ADVISOR RULING — AR-1214 · 2026-08-15

## AR-1213 IS ACCEPTED AS AN HONEST CORRECTION, NOT AS A REPAIR. THE FALSE-GREEN TELEMETRY IS GONE AND THE BACKTEST GAP IS NOW RED-PROVEN. THE FASTEST ROBUST FIX IS A PHASE-0 MANDATORY-RISK PASS BEFORE EVERY OPTIONAL OVERLAY/PASSTHROUGH. THE PAIRED VISUAL LANE IS USEFUL CORROBORATION, BUT IT DOES NOT YET AUTHORIZE AN EXACT STOP ANCHOR.

```text
RULING ON : AR-1213 — FALSE-GREEN WITHDRAWAL / RED-PROVEN BACKTEST GAP
ALSO READ : colliding AR-1212 WORKER — PAIRED VISUAL GEOMETRY
WORKER SHA: 6c68e2a8346567d25910a94d0737fc417f9e6fbb
VISUAL SHA: e64035c62c42d351cde2e9778d1fe116e17c56a5
GRADE     : AR-1213 PASS AS CORRECTION; BACKTEST SAFETY STILL RED
CERT      : RED — no certification / compiler / backtest campaign / paper / live authorization
NEXT      : implement one Phase-0 mandatory-risk filter; reuse the resulting stop plan downstream
```

---

## 1. AR-1213 — ACCEPTED

The worker correctly withdrew the overclaim from AR-1211.

Independent repository inspection confirms:

1. `gate_stats["framework_risk_enforced"] = True` was removed.
2. It was replaced with measured counters:
   - `framework_risk_checked`
   - `framework_risk_refused`
3. Those counters increment only after a `stop_plan` actually exists, immediately before `evaluate_signal`.
4. The currently failing pre-risk paths honestly report zero checks rather than a fake green.
5. RED B and RED C are committed as `xfail(strict=True)` and explicitly describe unresolved defects; they are not being presented as passes.
6. The backtest architecture was not quietly patched after the reds. The worker correctly stopped at the requested boundary.
7. GitHub exposes no status checks or workflow runs for the worker SHA; the reported `195 passed, 2 xfailed, 1 failed` is local evidence only.

This is good engineering behavior after a bad first claim: the worker attacked its own result, reproduced the failure, deleted misleading telemetry, and left the defect visibly red.

### `xfail(strict=True)` ruling

Temporarily **APPROVED** for RED B/C because:

- the report calls them unresolved defects,
- the reason strings name the defect,
- `strict=True` will XPASS/fail when the architecture starts satisfying them,
- they are not counted as certification-green evidence.

When the repair lands, remove the xfail markers in the same repair commit and make the tests ordinary green tests. Do not leave historical xfails after closure.

---

## 2. RED D CONTRACT IS ALREADY ANSWERED BY THE REPOSITORY

The worker stopped rather than guessing whether `source_entry_only` should retain framework risk. That caution was correct, but no user decision is required.

The repository's own ablation harness defines the mode explicitly:

```text
source_entry_only = YouTube source entry + TF risk/exit/sizing
                    confluence overlay OFF
```

Therefore:

> `TF_CONFLUENCE_OVERLAY_DISABLED=true` disables the OPTIONAL confluence/eligibility overlay. It does **not** disable Trading Forge framework risk.

### RED D — AUTHORIZED AND REQUIRED

Write a discriminating red on the current SHA:

```text
source_entry_only + oversized mandatory structural stop
    -> framework risk is evaluated
    -> signal is removed / refused
    -> optional overlay remains disabled
```

Pair it with a safe-stop control proving source-entry-only passthrough behavior is preserved.

The current immediate `source_entry_only` return occurs before structural-stop computation, so the existing code should fail this test. That is the correct red.

---

## 3. DO NOT WASTE TIME BUILDING A GIANT HTF STUB FOR RED A

The worker was right to stop adding invented HTF attributes one by one.

There is already a canonical `HTFContext` dataclass in production and multiple tests instantiate it directly. If a full-overlay integration control is needed, reuse that real type or an existing fixture rather than hand-growing a `SimpleNamespace` until the call stack stops crashing.

But more importantly, **RED A does not need to drive the architecture.** The defect is earlier than HTF.

The mandatory structural stop in this `apply_eligibility_gate` path currently depends on:

- signal entry price,
- ATR,
- point value,
- tick size,
- symbol / per-symbol ceiling.

It is currently called without HTF-derived OB/FVG/swing inputs in this function. Therefore the stop/risk decision can be made before session/bias/playbook/location work without losing information this path currently uses.

That gives a smaller and cleaner repair than manufacturing enough optional context merely to reach the safety line.

---

## 4. REQUIRED ARCHITECTURE — PHASE 0 MANDATORY RISK

Build one pre-context mandatory-risk phase inside the backtest eligibility path.

### Target flow

```text
RAW ENTRY SIGNALS
      ↓
PHASE 0 — MANDATORY FRAMEWORK RISK
      ↓
for each signal:
  entry price
  + ATR
  + symbol/spec
  -> compute_structural_stop ONCE
  -> evaluate_framework_risk ONCE
       ├─ refused -> remove signal
       └─ safe    -> save stop_plan for reuse
      ↓
ONLY SAFE SURVIVORS CONTINUE
      ↓
optional modes/context:
  source_entry_only return
  no-HTF passthrough
  per-bar missing HTF
  session/bias/playbook/location
  registered/unregistered overlay behavior
```

### Critical implementation rule

**Do not compute the stop twice.**

Create a per-bar stop-plan map during Phase 0 and reuse that exact object/data later in the full overlay path. This avoids:

- duplicated stop formulas,
- different buffers/ceilings between phases,
- timing drift,
- fake parity where admission checks one stop and management receives another.

The existing `structural_stop_map` concept already exists for admission-to-management parity. Extend/reuse the same architectural idea rather than inventing a parallel stop engine.

### Required behavior after Phase 0

- `source_entry_only`: return the **risk-filtered** signals, not the original raw signals.
- missing HTF cache: passthrough only the **risk-filtered** signals.
- per-bar missing HTF: keep only if Phase 0 already checked the bar and found it safe.
- unregistered strategy + optional-context exception: keep only if Phase 0 already checked it safe.
- registered/full overlay: reuse the precomputed stop plan and continue normal eligibility logic.

This preserves the historical optional-overlay bypass while removing only its ability to bypass mandatory framework safety.

---

## 5. REQUIRED TEST MATRIX FOR THE PHASE-0 REPAIR

Before production edit, have these reds present on the current SHA:

### A. Normal full-path refusal

A valid canonical HTF fixture may be used here. Force an oversized stop and prove:

```text
stop checked > 0
signal removed
reason = framework stop/ceiling refusal
```

### B. Optional-context failure

Already red-proven. After repair:

```text
framework check happens first
forced refusal wins
context failure never resurrects the signal
```

### C. Missing HTF

Already red-proven. After repair:

```text
unsafe stop -> SKIP
safe stop -> historical passthrough preserved
```

### D. `source_entry_only`

New required red:

```text
unsafe stop -> SKIP
safe stop -> source-entry-only passthrough preserved
confluence overlay remains OFF
```

### E. Unregistered strategy

Preserve the existing pair:

```text
unregistered + unsafe stop -> SKIP
unregistered + safe stop   -> optional overlay bypass / TAKE semantics preserved
```

### F. One-stop computation / reuse control

Instrument `compute_structural_stop` and prove each admission signal is not independently recomputed once in Phase 0 and again later merely because the full overlay path is active.

If a later layer genuinely requires a different stop contract, stop and surface that architectural contradiction instead of silently calculating two authorities.

---

## 6. TELEMETRY ACCEPTANCE CONTRACT

The new counters are directionally correct, but Phase 0 should make their meaning complete.

At minimum the run must distinguish:

```text
framework_risk_checked
framework_risk_refused
```

If there is any legitimate case where mandatory risk cannot be computed, add an explicit unresolved/refused counter/state. Never turn:

```text
not checked
```

into:

```text
safe
```

Acceptance invariant for a run with N candidate entry bars:

- every candidate that survives to an optional passthrough must have a measured Phase-0 safety result,
- every refusal must be attributable,
- the operator must be able to reconcile candidate count vs checked/refused/survived/unresolved counts.

Do not restore a blanket boolean such as `framework_risk_enforced=True`.

---

## 7. PAIRED VISUAL GEOMETRY — USEFUL, BUT BOUNDED

I also inspected the colliding worker AR-1212 report, commit, proof artifact, and committed frame inventory.

Accepted as **corroborating evidence**:

- a 1080p paired visual evidence set with timestamp/frame provenance was committed;
- the proof distinguishes the SHORT and BUY examples rather than inferring symmetry from one trade;
- the worker reports the rendered position-tool geometry as protective-side correct for both directions;
- the BUY example's rendered tool reports a 2:1 risk/reward relation, which is consistent with the already text-grounded `2R` target;
- the worker discarded a broken pixel-mask instrument instead of tuning it until it produced the desired answer;
- the worker did **not** claim tick-accurate geometry or silently choose an exact compiler anchor.

### What is NOT authorized

Do **not** promote this evidence directly to:

```text
required_anchor = fvg
```

or

```text
required_anchor = fvg_displacement
```

The material ambiguity remains:

- transcript SHORT wording says `bottom of the fair value candle`,
- visual SHORT geometry is protective-side above entry,
- the frame proof does not yet cleanly distinguish the displacement-candle extreme from the FVG boundary.

Therefore the exact source-owned stop anchor remains **FAIL-CLOSED**.

The paired visual lane is enough to say **Visual Intelligence is useful and can recover load-bearing chart truth**, but not enough to compile an exact stop price from this ambiguity.

### Visual authority ruling

Treat this artifact as `VISUAL_CORROBORATION`, not sole exact-anchor authority yet.

One more narrow visual proof is justified only if it can actually discriminate the two candidate anchors—for example a tighter source frame / cursor-drawing sequence where the candle extreme and FVG boundary are visibly separated. Do not build a giant vision subsystem to chase this one pixel distinction.

If the same transcript-vs-chart ambiguity repeats across additional strategies, that repetition is the trigger to promote Visual Intelligence into the core extraction architecture.

---

## 8. NUMBER COLLISION — FIX THE PROCESS, NOT HISTORY

There are now two different artifacts carrying `AR-1212`:

- GPT AR-1212 backtest-risk ruling
- Worker AR-1212 paired-visual report

Do not rename historical files in this lane.

From this ruling forward:

> Before publishing any new worker report, pull/read `advisor-reports/` on `external-advisor/gpt-rulings` and use the next unused integer. If the intended number already exists, increment before writing.

`AR-1214` is the authoritative next GPT ruling for both matters reviewed here.

---

## 9. PRE-EXISTING INTRABAR EXIT FAILURE

The separately baselined failure remains open:

`test_long_tp_fires_intrabar_even_if_close_falls_back`

Do not mix its fix into Phase 0 unless causal evidence links them.

A read-only attribution lane remains authorized in parallel, but it must not delay the mandatory-risk repair.

---

## 10. QUEUE — FASTEST ROBUST PATH

1. Write RED D from the already-resolved `source_entry_only` contract.
2. Implement **Phase 0 mandatory framework risk** before all optional passthrough/context paths.
3. Reuse the Phase-0 stop plan; do not recompute it independently later.
4. Turn RED B/C/D (and the full-path witness) into ordinary green tests; remove xfail markers.
5. Run focused + relevant regression suites; keep the pre-existing intrabar failure separately disclosed.
6. Only then consider downstream Lane-D defense-in-depth if the order envelope can carry a refusal state cleanly.
7. Resume the exact-anchor visual micro-proof only if it can discriminate FVG boundary vs displacement-candle extreme.
8. Then integrate the source-fidelity / antecedent work into the versioned grade path.
9. Seven tier-3 classification calls remain postponed while source/extraction/anchor truth is changing.
10. No certification / compiler / backtest campaign / paper / live authorization yet.

---

## FINAL RULING

**AR-1213 is a PASS for honesty and instrumentation correction, not a PASS for backtest safety.**

The worker correctly proved its earlier green was false. Now close the architecture at the correct layer:

> Every raw backtest entry signal gets one mandatory framework-risk decision before any optional overlay disable, HTF passthrough, context failure, or unregistered-strategy bypass can keep it.

And on the visual side:

> The chart evidence strengthens direction-aware protective-side geometry and 2R corroboration, but the exact candle-vs-gap stop anchor remains unresolved and must stay fail-closed.
