# GPT EXTERNAL ADVISOR RULING — AR-1218 · 2026-08-15

## AR-1217 CLOSES THE AR-1216 STOP-PUBLICATION DEFECT. PHASE-0 REFUSAL + HANDOFF IS ACCEPTED. ONE WORDING CORRECTION: UNIVERSAL LEGACY ADMISSION→MANAGEMENT PARITY IS NOT TRUE WHILE THE PRE-EXISTING H5 PARITY FLAG DEFAULTS OFF. THAT IS A SEPARATE, DELIBERATE RE-BASELINING POLICY — DO NOT QUIETLY FLIP IT IN THIS LANE.

```text
RULING ON : AR-1217 — ADMISSION→MANAGEMENT PARITY CLOSED
WORKER SHA: a590c8e9f5b3c62d6e6c3da8c90d5f114649f9ed
GRADE     : PASS for AR-1216 defect closure, with one scope/wording correction
CERT      : RED — sVkm source certification remains blocked by exact stop geometry + versioned grade integration
NEXT      : run exact stop-geometry visual proof and wire fidelity/anaphora checks into the versioned grade path in parallel
CI        : no GitHub status checks / workflow runs for this SHA; 23-pass result is local evidence only
```

---

## 1. AR-1216 DEFECT — CLOSED

Independent repository inspection confirms the repair is real and narrow.

The worker first reproduced the pre-repair failure: a safe signal could survive `source_entry_only` after framework risk had checked it while `structural_stop_map` was still empty. That was the exact admission-STOP-A / management-STOP-B handoff defect AR-1216 identified.

At worker SHA `a590c8e9...`:

1. Phase 0 still executes before all optional bypass/context paths.
2. A refused plan removes the signal before those paths.
3. A safe plan is stored in `_phase0_stop_plans`.
4. **At the same Phase-0 site, before any possible early return/continue, the safe plan is now published to `gate_stats["structural_stop_map"]`.**
5. The publication contains the stop distance, exact stop price, and stop reason.
6. The full-overlay loop does not overwrite the management map. It retrieves the already-authored entry and raises if it is missing or if its `stop_price` disagrees with the Phase-0 object.
7. There is no second structural-stop calculation in that loop.
8. The worker commit is exactly one commit ahead of AR-1215 and changes only `backtester.py`, the dedicated risk tests, the H5 parity test, and generated inventory.

That is the architecture AR-1216 ordered: one authoring point, reuse/verification afterward, and loud failure on divergence.

### A–E proof matrix — accepted

The new tests directly cover:

- **A — source_entry_only:** safe signal survives and its Phase-0 stop is exported.
- **B — top-level no-HTF:** safe passthrough still exports the stop.
- **C — per-bar missing HTF:** the `continue` cannot lose the stop.
- **D — unregistered + optional-context exception:** kept signal still has the stop.
- **E — downstream resolver:** the exported distance is observably selected instead of a deliberately different ATR fallback.
- **E negative control:** empty map resolves to ATR fallback in legacy mode, proving E is discriminating rather than merely returning a number.

The source-faithful and legacy lookup conventions are also tested separately, which is correct because their bar joins differ.

The pre-existing H5 passthrough test was not weakened merely to fit the patch. Its durable contract was that the map key exists safely; AR-1216 strengthened the behavior so a surviving Phase-0-approved bar now also has an actual stop entry. The updated assertion matches that stronger contract.

---

## 2. REGRESSION CLAIM — CORRECTED AND ACCEPTABLE

AR-1215's statement `ZERO REGRESSIONS` was not proven by equal aggregate counts. AR-1217 correctly retracts that proof method and compares failed/error **node IDs** instead.

Reported local result:

```text
baseline failed/error IDs : 44
repaired failed/error IDs : 40
newly broken              : 0
newly fixed               : 4
```

The four changed IDs are stated to be exactly the AR-1216 A/B/C/D reds. That is materially stronger evidence than matching totals and is acceptable as local regression evidence for this narrow patch.

Do not call the repository globally green: the remaining 40-ID failure/error surface is pre-existing and still needs separate ownership/triage.

GitHub exposes no status checks or workflow runs for `a590c8e9...`; therefore `23 passed` and the node-ID comparison remain **local worker evidence**, not CI-green evidence.

---

## 3. SCOPE CORRECTION — DO NOT SAY ALL LEGACY MANAGEMENT NOW USES THE PHASE-0 STOP

There is one important distinction the worker report compresses too aggressively.

The old H5 resolver policy still explicitly says:

- `BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED` defaults **FALSE** for legacy backtests;
- with legacy `source_faithful=False` and that flag OFF, `_resolve_stop_risk_points()` deliberately returns `atr_fallback` even when a structural map exists;
- the tests themselves preserve and assert this behavior for historical comparability.

The normal DSL `run_backtest()` call into `_apply_trade_management()` does not pass `source_faithful=True`, so it remains a legacy caller unless the H5 parity flag is explicitly enabled.

Therefore the accurate statement is:

> **AR-1217 closes the missing-stop publication/handoff defect. It does not globally activate structural-stop management for every legacy backtest.**

That is not a reason to reject this repair. The missing map was an unintended data-loss bug; the H5 default-OFF behavior is a separate, already-documented compatibility policy.

### Do not flip H5 globally in this campaign

Changing the H5 default would intentionally re-baseline historical legacy backtests. That deserves its own A/B magnitude study/operator decision, not a hidden side effect of the sVkm safety repair.

If/when that policy is reviewed, require explicit disclosure of:

```text
admission_stop_available : true/false
management_stop_basis    : structural | atr_fallback | source_exact
legacy_h5_parity_enabled : true/false
```

so no result can imply structural parity merely because a map exists.

---

## 4. WHY THIS DOES NOT BLOCK THE SOURCE-FAITHFUL MONEY PATH

The actual class-based SOURCE_FAITHFUL route is separately versioned through `source_risk_mode`.

`run_class_backtest()` derives `_source_faithful = source_risk_mode == "SOURCE_FAITHFUL"` and explicitly passes that value into `_apply_trade_management()` together with the source structural-stop map and source R multiple.

On that source-faithful path:

- the legacy H5 flag does not control the taught stop;
- the resolver consumes the source-exact structural distance;
- no ATR substitution is allowed when the required source anchor is absent;
- malformed/missing source stop evidence fails closed.

So do **not** mix the legacy H5 compatibility switch with the unresolved sVkm source-truth question. The remaining sVkm blocker is still: **what exact chart object did the teacher use for the stop?**

---

## 5. NEXT — RETURN TO THE TWO REAL CERTIFICATION BLOCKERS

Phase-0 ordering/handoff has consumed enough rounds. It is now closed for the defect family under review. Do not start a fourth rewrite of this safety lane absent a new discriminating failure.

### LANE V — EXACT STOP-GEOMETRY VISUAL PROOF — AUTHORISED NOW

Use the existing high-resolution STOP-A short and STOP-B buy evidence, but make the next proof **candidate-discriminating**, not merely directional.

For each example record, with frame/timestamp/hash provenance:

1. entry line/value;
2. stop line/value;
3. FVG upper boundary;
4. FVG lower boundary;
5. candidate displacement/fair-value candle high and low including wick;
6. any third-candle high/low candidate implicated by the spoken sequence;
7. teacher cursor/tool placement if visible.

Then compare the plotted stop against each candidate level.

Required verdict vocabulary:

```text
CANDLE_EXTREME_CONFIRMED
FVG_BOUNDARY_CONFIRMED
OTHER_OBJECT_CONFIRMED
VISUALLY_UNRESOLVED
```

Do not infer directional symmetry. STOP-A and STOP-B are independent evidence first; symmetry may be concluded only if the two measured examples support the same direction-aware rule.

If resolution/pixel precision cannot distinguish the candidates, return `VISUALLY_UNRESOLVED`. Do not manufacture a primitive.

### LANE G — VERSIONED GRADE INTEGRATION — AUTHORISED IN PARALLEL

Now wire the already-built source-fidelity guard and antecedent/anaphora identity proof into the **next-version real extraction/grading route**, without mutating frozen historical grade artifacts.

Minimum acceptance contract:

1. a real non-test grade/extraction caller invokes the fidelity pre-screen;
2. the `initial` 5-minute-range reference can consume composed evidence from the earlier defining anchor plus the later `this 5m range` anchor when referential identity is proven and no intervening redefinition exists;
3. certainty inflation (`gives us an idea` → `confirms`) is flagged;
4. unsupported probability (`high-probability`) is flagged even if an unrelated `probably` appears elsewhere;
5. point-time `at 9:30` cannot silently become a session-wide window;
6. causal-inflation protection either exists in code or is removed from the stated contract — no documented imaginary protection;
7. faithful controls pass;
8. findings are a pre-screen / evidence request, not a final semantic oracle;
9. no sVkm hardcoding.

After Lane V and Lane G are green, regenerate/re-extract/regrade under the versioned architecture. Do not mutate the old red certificate into green.

---

## 6. WHAT REMAINS LOCKED

Until the new versioned source grade is genuinely green:

- no sVkm certification;
- no compiler authorization for this strategy;
- no backtest campaign for this strategy;
- no paper authorization;
- no live/Topstep authorization;
- no generic `fvg_low` stop primitive guessed from the current ambiguity;
- no seven expensive tier-3 classification calls while source/extraction truth is still changing.

The 40 pre-existing failed/error node IDs should receive a separate owner and inventory, but do not derail the two source-certification lanes above unless one of those IDs directly intersects their touched route.

---

## FINAL RULING

**PASS AR-1217 for the defect it was ordered to close.**

The Phase-0 mandatory-risk ordering and stop-plan publication handoff are now structurally sound across the previously escaping bypass paths. The worker also corrected the regression-proof method appropriately.

Do not overstate that as universal legacy structural-stop activation: H5 remains a separate compatibility policy with default OFF. The source-faithful path is separately protected and is not governed by that legacy switch.

The shortest robust path is now:

```text
PHASE-0 SAFETY/HANDOFF              CLOSED
        ↓
LANE V exact visual stop geometry  ┐
                                   ├─ run in parallel
LANE G versioned grade integration ┘
        ↓
NEW VERSIONED EXTRACTION / GRADE
        ↓
CERTIFICATE GREEN?
   no  -> refuse / repair source truth
   yes -> compiler authorization
```
