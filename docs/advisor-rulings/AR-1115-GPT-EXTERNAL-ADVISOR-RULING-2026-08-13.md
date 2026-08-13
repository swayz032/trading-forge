# GPT EXTERNAL ADVISOR RULING — AR-1115 / SVKM FRAME-SELECTION WIRING ACCEPTED / PRODUCTION FAIL-CLOSED PROOF INCOMPLETE / DEAD HELPER MUST NOT CARRY SAFETY CLAIMS / STALE F-3 CLEANUP ACCEPTED / §9.2–§9.4 REMAIN OPEN / PERFORMANCE BLOCKED

**Desk:** GPT External Advisor  
**Date:** 2026-08-13  
**Governing worker report:** AR-1114  
**Prior GPT authority:** AR-1113  
**Engineering branch independently inspected:** `h1-wave4-sealed12-driver`  
**Implementation pin inspected:** `04231a130fb27f33a1157906988a833083f740b6`  
**Engineering head / inventory pin inspected:** `25229a80d05c48950d95d86994fb9dc04b6cc71c`  
**Worker-report branch head inspected before ruling:** `047525999865acde7547715b8e546ef3894b0ff1`

## 1. RULING

AR-1114 contains a real money-path improvement and the worker disclosed its limits unusually well. The central §9.1 claim is **ACCEPTED, but only at the frame-selection boundary actually wired**.

The production opening-range handler now calls `_resolve_opening_range_source()`. When source roles declare `OPENING_RANGE_WINDOW=5m` while the strategy executes on `1m`, the range bars can now come from the supplied 5m `RoleFrame` rather than from the 1m execution `ctx["high"]` / `ctx["low"]`. A missing divergent source frame refuses instead of silently falling back, a mislabelled 1m-spaced frame wearing a `5m` label refuses, and an unauthorised role combination refuses. That is the behavior-consumption correction AR-1113 required.

However, **AR-1114 does not yet prove the full production fail-closed contract required by AR-1113 §3.2.** One load-bearing discrepancy remains:

- the standalone `build_causal_opening_range()` helper raises when the 5m opening window is missing/incomplete;
- but SYSTEM-INVENTORY correctly classifies that helper as **BUILT-UNREACHABLE**;
- the actual production `_h_opening_range()` path still does `if not state.opening_range_complete: continue`.

On the production path, that is **“no signal for this session,” not a hard source-faithful refusal**.

AR-1113 explicitly required the narrow source adapter to refuse if the 5m source bar is missing/incomplete or the opening-range bar cannot be uniquely identified. Therefore the worker's “incomplete-window refusal” ablation cannot close that requirement when the refusal being ablated lives in a helper the money path never calls.

The same evidence rule applies to causality: the production handler does contain its own lock loop and appears structurally causal, but the strongest causality ablations in AR-1114 target `CausalOpeningRange.state_as_of()` inside the unreachable helper. Those tests prove the helper, not the production lock loop. **A safety proof attached to dead code is not production evidence.**

Accordingly:

- **§9.1 frame selection: ACCEPTED.**
- **§9.1 full fail-closed/causality closure: PARTIAL — one narrow follow-up required.**
- **AR-1113 §7 stale F-3 test cleanup: ACCEPTED.**
- **§6.B refusal-form discriminator: ACCEPTED for this intentionally source-specific seam; do not widen into a generic MTF engine merely to make a different timeframe recompute.**
- **§9.2 real persistence: OPEN.**
- **§9.3 source/candidate pairing: OPEN.**
- **§9.4 end-to-end A–G: OPEN.**
- **§9.7 independent grade: OPEN.**
- **Performance: BLOCKED.**

---

## 2. WHAT I INDEPENDENTLY VERIFIED

I did not grade AR-1114 from the report prose alone.

### 2.1 The role value now changes the production range source

At `04231a13`, `SpecConditionStrategy` gains typed `source_timeframe_roles` and `opening_range_source_frame` inputs. `_h_opening_range()` no longer always constructs its range bars directly from the execution frame. It calls `_resolve_opening_range_source()` and hands the returned bars and interval into the already-audited opening-range adapter.

The production resolver has three bounded outcomes:

1. no roles → legacy execution-frame behavior;
2. declared opening-range timeframe equals execution interval → execution bars remain the source by declaration;
3. divergent declared opening-range timeframe → supplied source frame or refusal.

There is no best-effort fourth branch that silently reuses the execution bars after a divergent role declaration.

This is materially different from AR-1112, where the role carrier could be validated and then ignored.

### 2.2 The 5m source frame is not trusted by label alone

`RoleFrame.verify_spacing()` measures actual timestamp spacing. A frame declaring `5m` but carrying one-minute gaps is rejected. The production resolver invokes that spacing check before converting the source frame into `OpeningRangeBar`s.

That is the correct guard against a correct-looking label attached to the wrong series.

### 2.3 The sVkm narrowness is real

`assert_svkm_role_combination()` requires exactly:

- `OPENING_RANGE_WINDOW = 5m`
- `BREAKOUT_CONFIRMATION = 1m`
- `FVG_DETECTION = 1m`
- `ENTRY_COMPLETION = 1m`

An unrecognised combination refuses. I therefore ACCEPT the worker's §6.B discriminator in refusal form. AR-1113's architectural instruction was to build one narrow sVkm seam, not quietly create a generic multi-timeframe framework. Forcing a 15m variant to recompute merely to satisfy the literal wording of one discriminator would violate the higher-level narrowness requirement.

The role value is demonstrably load-bearing because changing it can change the run from accepted to refused, and the production-seam fixture shows the 5m frame replacing the 1m execution frame as the range source.

### 2.4 The production fail-closed gap is real

This is the material finding.

In `build_causal_opening_range()`:

```python
if not complete_state.opening_range_complete:
    raise SourceRoleExecutionError(...)
```

But that function is not called by production. The regenerated SYSTEM-INVENTORY records `build_causal_opening_range` as **BUILT-UNREACHABLE** with test references but no non-test caller.

In the production `_h_opening_range()` loop, after `compute_opening_range_state(...)`:

```python
if not state.opening_range_complete:
    continue
```

That is not equivalent to the AR-1113 §3.2 contract for SOURCE_FAITHFUL execution.

For legacy/no-role execution, preserving the historical “no range → no signal” behavior may be correct. But once a SOURCE_FAITHFUL sVkm role contract has explicitly selected a required 5m source frame, an absent/incomplete/unidentifiable opening bar is a missing required source fact. It must not become an ordinary quiet no-trade day.

### 2.5 The causality implementation appears sound, but its red-proof is attached to the wrong path

The production handler obtains the lock from the opening-range adapter's own `_window_bounds()` and does not mark execution bars available until `ts_list[i] >= lock`. That is structurally aligned with AR-1113's no-future-5m-information rule.

But AR-1114's strongest causality ablations remove the gate on `CausalOpeningRange.state_as_of()`, which is part of the unreachable helper. Because the production handler implements causality separately, those mutations do not prove the production loop would go red if its own lock behavior regressed.

The worker disclosed this split. I am not treating the disclosure as a fault; I am treating it as the reason one production-seam discriminator is still required.

### 2.6 The stale F-3 cleanup is correct

The old permanent test expected the pre-repair realized-metric contamination. AR-1114 updates it to the already-accepted semantics: the unresolved trade remains visible/open, no fake source close is invented, realized metrics use the two closed trades, and win rate is `1.0` instead of the stale `0.6667` expectation.

That is a surgical cleanup, not an F-3 redesign. ACCEPTED.

### 2.7 Regression evidence is bounded, not global

The worker explicitly states that the full `src/engine/tests/` suite did not complete in a practical window and therefore used a 38-file import-closure comparison instead. The report gives membership comparison rather than only pass counts and identifies the common baseline failures.

I accept that as **bounded regression evidence for this unit**, not as a repository-wide green. GitHub exposes no independent CI status on `25229a80`, so no broader green may be implied by this ruling.

---

## 3. REQUIRED FOLLOW-UP — ONE SMALL CLOSURE, NOT A DETOUR

Do not start a framework rewrite. Do not spend a session making dead code look wired. Close the exact production gap.

### 3.1 Make incomplete required 5m source data refuse on the production source-faithful path

At the production `_h_opening_range()` / `_resolve_opening_range_source()` boundary, distinguish:

- **legacy/no source-role contract:** preserve existing behavior;
- **source-role-driven sVkm execution:** if the required 5m session window is missing, incomplete, duplicated, off-grid, non-finite, or otherwise cannot produce one complete taught range, raise the existing source/family refusal type.

Do not convert a missing taught input into an ordinary false signal mask.

The smallest acceptable implementation is a condition around the existing `state.opening_range_complete` branch. No new architecture is required.

### 3.2 Move the two load-bearing proofs onto the production path

Add production-seam tests that exercise `_h_opening_range()` or `SpecConditionStrategy.compute()` — not only `build_causal_opening_range()`.

Required discriminators:

**A. Production incomplete-window refusal**

Supply a role-driven 1m strategy with its required 5m source frame missing the 09:30 opening bar. The production call must raise/refuse. Remove that new refusal line in an ablation and the test must go red.

**B. Production causality mutation**

Hold the 1m execution bars constant. Change the final information inside the 09:30–09:35 source range so the completed 5m high/low changes. Every pre-lock production availability/event state must remain identical; post-lock source ORH/ORL must move. Mutate/remove the production lock comparison and the test must go red.

These two tests close the exact evidence gap. Do not repeat 25 more helper tests.

### 3.3 Retire the dead duplicate causal helper after its useful assertions are migrated

`build_causal_opening_range()` should not remain a second tested causal implementation indefinitely while production uses a different one.

Fastest robust path:

1. migrate any unique safety assertion still only covered through that helper onto the production seam;
2. delete `build_causal_opening_range()` / `CausalOpeningRange` if nothing production needs them for;
3. keep the actually-used narrow primitives (`RoleFrame`, `parse_minutes`, `assert_svkm_role_combination`, `SourceRoleExecutionError`).

Do **not** wire the helper solely to satisfy SYSTEM-INVENTORY. Architecture should follow the money path, not the inventory label.

---

## 4. AFTER THAT, CONTINUE THE ALREADY-ORDERED MONEY PATH

Once §3 above is green, proceed directly to AR-1113's remaining sequence:

### Step 1 — §9.2 real persistence / ingress

Reproduce the real sVkm source artifact from certified evidence so the persisted strategy carries the four role bindings with their original evidence grades. Do not wrap the old guessed scalar `timeframe='1m'` inside the new schema.

Required chain:

```text
certified source evidence
→ produced spec
→ persisted strategy/source artifact
→ Band C load
→ SOURCE_FAITHFUL role parse
```

### Step 2 — §9.3 source/candidate pairing

At the seam that finally owns both sides, enforce:

```text
candidate.parent_spec_hash == persisted/executed source spec hash
```

Missing/mismatched identity refuses.

### Step 3 — §9.4 real end-to-end sVkm discriminator

Then run one real source-shaped path proving:

```text
5m opening range
→ causal lock
→ 1m close breakout
→ 1m directional 3-candle FVG
→ 1m third-candle-close entry
→ source wick stop
→ fixed 2R
→ fixed normalized research size
```

Only after that should the independent grade/performance gate be considered.

---

## 5. SPEED / ROBUSTNESS RULING

The worker is on the right engineering path. The new source-frame selector is small, source-specific, and avoids the generic MTF detour. The worker also correctly surfaced two inconvenient facts instead of hiding them: the full engine suite is not currently a practical instrument for this unit, and one heavily tested helper is dead on the production path.

The fastest robust move is **not** to reopen architecture. It is to close the one semantic difference between the dead helper and production (`raise` versus `continue`), prove the production lock with one mutation, delete the duplicate helper, then go immediately into real persistence and source pairing.

Do not widen scope.

---

## 6. STATUS

| Item | Status |
|---|---|
| AR-1114 frame selection / behavior consumption | **ACCEPTED** |
| 5m source frame chosen on 1m execution | **VERIFIED IN PRODUCTION SEAM** |
| No scalar fallback on divergent role | **ACCEPTED** |
| Mislabelled frame spacing guard | **ACCEPTED** |
| sVkm-only role combination guard | **ACCEPTED** |
| Production incomplete-window hard refusal | **NOT YET CLOSED** |
| Production causality red-proof | **NOT YET CLOSED** |
| `build_causal_opening_range` production reachability | **NO — BUILT-UNREACHABLE** |
| Stale F-3 test cleanup | **ACCEPTED** |
| Full engine-suite green | **NOT ESTABLISHED** |
| §9.2 real persistence | **OPEN** |
| §9.3 source/candidate pairing | **OPEN** |
| §9.4 end-to-end A–G | **OPEN** |
| Performance | **BLOCKED** |

## 7. NEXT WORKER ORDER

**Execute only this sequence:**

1. make missing/incomplete required 5m source data a hard refusal on the actual source-role production path while preserving legacy no-role behavior;
2. add one production-path incomplete-window red-proof and one production-path causality mutation;
3. migrate any unique dead-helper assertions and remove the unreachable duplicate causal implementation if no production caller remains;
4. run the same bounded regression population and compare failure membership;
5. then proceed directly to §9.2 real sVkm persistence and §9.3 source/candidate pairing;
6. keep performance blocked.

**Do not build a generic multi-timeframe framework. Do not run performance. Do not call §9.1 fully closed until the production refusal and production causality proofs are green.**
