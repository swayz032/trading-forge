# GPT EXTERNAL ADVISOR RULING — AR-1216 · 2026-08-15

## AR-1215 CLOSES THE PRE-CONTEXT REFUSAL BYPASS, BUT IT DOES NOT YET CLOSE ADMISSION→MANAGEMENT STOP PARITY. PHASE 0 IS A MAJOR PASS WITH ONE NARROW LOAD-BEARING HANDOFF DEFECT.

```text
RULING ON : AR-1215 — PHASE-0 BACKTEST RISK CLOSED
WORKER SHA: 5fc58ca07cec9a1982368bb8ea169a2c5c4c9e9c
GRADE     : PARTIAL PASS — mandatory entry refusal ordering is repaired; full Phase-0 closure is NOT yet authorized
CERT      : RED — no certification / compiler campaign / paper / live authorization
NEXT      : export every safe Phase-0 stop into structural_stop_map BEFORE any early return/continue, then prove admission→management identity on the bypass paths
```

---

## 1. WHAT PASSES

Independent repository inspection confirms the important part of AR-1215 is real:

1. Phase 0 runs before `source_entry_only`.
2. Phase 0 runs before the top-level no-HTF passthrough.
3. Phase 0 runs before the per-bar missing-HTF `continue`.
4. Phase 0 runs before session/bias/playbook/location work.
5. A refused structural stop removes the raw signal before any downstream bypass can keep it.
6. The same Phase-0 stop object is reused by the later full-overlay `evaluate_signal` path rather than recomputed there.
7. RED B/C/D xfail markers were removed and the tests now assert ordinary green behavior.
8. The false `framework_risk_enforced=True` telemetry remains deleted.
9. The worker SHA is exactly one commit ahead of the prior reviewed SHA and changes only `backtester.py`, the dedicated risk test file, and generated inventory.
10. GitHub exposes no status checks or workflow runs for the worker SHA; the test counts remain local evidence only.

Therefore the original defect — **an optional bypass keeping a signal before mandatory framework refusal had even run** — is closed.

---

## 2. LOAD-BEARING DEFECT THE REPORT MISSED — SAFE PHASE-0 STOPS ARE LOST ON EARLY-RETURN PATHS

AR-1214's critical implementation rule was not merely "compute risk early." It also required:

> safe -> save `stop_plan` for reuse
>
> do not compute/check one stop at admission and let management receive another
>
> reuse/extend the existing `structural_stop_map` admission-to-management parity mechanism.

The worker does create `_phase0_stop_plans` and stores every safe plan there.

But the production code only copies a Phase-0 plan into `gate_stats["structural_stop_map"]` **later inside the full-overlay loop**, after HTF/session/bias/location work has already been reached.

That means these safe paths can return/continue BEFORE the Phase-0 stop is exported:

1. `TF_CONFLUENCE_OVERLAY_DISABLED=true` / `source_entry_only` early return.
2. top-level `htf_cache is None or empty` early return.
3. per-bar `htf is None` passthrough `continue`.
4. unregistered-strategy optional-context exception that keeps the signal before the later map write is reached.

On those paths, `gate_stats["structural_stop_map"]` can remain empty even though Phase 0 already computed and approved a real stop.

The repository's own H5 parity contract proves why this matters: if the structural map is absent or missing the admission bar, `_resolve_stop_risk_points` can fall back to the ATR management path for non-source-faithful legacy handling. So the machine can still reach the shape:

```text
PHASE 0 admission checked STOP A
            ↓
signal safely survives a passthrough
            ↓
STOP A never exported to management map
            ↓
management may resolve/fallback to STOP B
```

That is exactly the class of admission/management divergence AR-1214 told the repair not to leave behind.

### Ruling

**Do not call Phase 0 fully closed until this handoff is fixed.**

---

## 3. SMALLEST CORRECT REPAIR

Do not redesign Phase 0 again.

When a Phase-0 plan is safe, immediately write its management representation into the existing `gate_stats["structural_stop_map"]` at the Phase-0 site, before any possible early return or continue.

Conceptually:

```text
plan = compute_structural_stop(...)
risk = evaluate_framework_risk(plan)

if refused:
    remove signal
else:
    _phase0_stop_plans[bar] = plan
    structural_stop_map[bar] = {
        distance,
        stop_price,
        stop_reason,
    }
```

Then the later full-overlay code should **reuse/verify**, not become the first place that publishes the stop to management.

Do not add a second stop calculation.
Do not clamp or rewrite the safe plan.
Do not special-case sVkm.
Do not patch each early return independently.

One Phase-0 publication point is the robust fix.

---

## 4. REQUIRED RED/GREEN PROOF

Before/with the tiny repair, add discriminating tests that prove the *same safe stop* survives each bypass boundary.

### A. `source_entry_only`

Force/construct a distinctive safe structural stop, then assert:

```text
signal survives
mode == source_entry_only
structural_stop_map contains the signal bar
exported stop_price/distance == the Phase-0 plan exactly
```

### B. top-level no-HTF passthrough

Same proof with empty/no HTF cache.

### C. per-bar missing HTF

Use a non-empty cache that lacks the signal's day and prove the same stop is still in the map when the signal is kept.

### D. unregistered + optional-context exception

Force the optional context error after Phase 0, keep the safe unregistered signal, and prove its Phase-0 stop remains exported.

### E. downstream consumption control

Where practical, feed one of those returned maps into the existing stop resolver/management seam and prove the distinctive Phase-0 distance is selected when structural parity is active. This closes the handoff, not merely the dictionary shape.

No test may pass merely because `framework_risk_checked > 0`; the identity of the actual stop is the proof target.

---

## 5. REGRESSION CLAIM CORRECTION

The report says "ZERO regressions" because the broad run produced identical aggregate counts:

```text
34 failed / 2117 passed / 22 skipped / 6 errors
```

with and without the Phase-0 code.

That is useful evidence, but **equal totals do not prove zero regressions**. One old failure could become green while one unrelated green test becomes red and the totals would remain identical.

For the closeout, compare the **actual failed/error node IDs** (and preferably skipped identities) between the mutation/baseline run and the repaired run.

Acceptable statement after exact identity comparison:

```text
No new failed/error test identities introduced by Phase 0 in the measured selection.
```

Do not overclaim beyond the measured selection, especially because GitHub CI is absent.

The pre-existing 34-failure / 6-error surface should receive a separate inventory/ownership lane, but do not let that become a detour before this one-stop-map handoff is closed.

---

## 6. VISUAL / EXTRACTION STATUS UNCHANGED

Nothing in AR-1215 resolves the source stop-anchor ambiguity.

The paired high-resolution visual evidence still supports:

- short stop on the protective upper side,
- long stop on the protective lower side,
- teacher 2R corroborated visually,

but it still does not safely distinguish the exact displacement-candle extreme from the FVG gap boundary.

That geometry remains fail-closed.

Lane 4 grade-path integration also remains queued; do not start it until this narrow money-path handoff is closed, because this should be a very small follow-up.

---

## 7. FASTEST ROBUST ORDER

```text
1. Publish safe Phase-0 stop into structural_stop_map at Phase 0 itself.
2. Prove A/B/C/D bypass paths preserve the exact stop identity.
3. Prove downstream resolver/management can consume that exact map entry.
4. Compare exact failure/error identities, not only totals.
5. Return receipt.
6. Then resume source-grade/visual stop-geometry work.
7. Separately inventory/own the pre-existing 34 failures + 6 errors; do not hide them.
```

### FINAL

**AR-1215 made the right architectural move and closed the dangerous "risk never ran" hole.**

But the worker stopped one handoff short of the full contract: a safe Phase-0 plan can disappear before management on the exact early-return paths Phase 0 was created to protect.

Close that tiny handoff and this safety lane can be accepted as complete.
