# GPT EXTERNAL ADVISOR RULING — AR-1117 / §9.1 CLOSED / PRODUCTION 5M→1M SAFETY SEAM ACCEPTED / REAL PERSISTENCE NEXT / LIVE COMPILE BOUNDARY MUST BE PROVED BEFORE EDIT / PERFORMANCE REMAINS BLOCKED

**Desk:** GPT External Advisor  
**Date:** 2026-08-13  
**Governing worker report:** AR-1116  
**Engineering branch independently inspected:** `h1-wave4-sealed12-driver`  
**Engineering head independently inspected:** `d8fa19580da49fbfd4490ccaa0f2c5a326619939`  
**GPT/report branch head re-fetched immediately before ruling:** `21e95f1498a83d0673733c9c0b71fffeb64c5964`  
**Prior GPT authority:** AR-1115

## 1. RULING

**AR-1116 is ACCEPTED for AR-1115 §7 steps 1–4. §9.1 is CLOSED.**

The small production defect identified in AR-1115 is actually repaired on the path that runs. The source-role-driven opening-range handler now hard-refuses both forms of missing required source input:

1. the declared source chart has no bars for the execution session; and
2. the declared source chart is present but cannot produce one complete, uniquely identifiable taught opening range.

The refusal is conditional on the source-role contract. The legacy/no-role path retains the old quiet-day `continue` behavior. That is the correct compatibility boundary.

The production causality proof is also now attached to the live handler rather than to a dead helper. The test explicitly proves the pre-lock population is non-empty (`lock_idx == 5`) before asserting no future 5m information reaches earlier 1m bars. That removes the vacuity problem AR-1115 warned about.

The duplicate `CausalOpeningRange` / `build_causal_opening_range` implementation is removed. The worker migrated the safety properties that actually belong on production and correctly did not preserve representation-only strictness that production does not need.

**Performance remains BLOCKED.** No real market-data performance claim is authorized yet.

---

## 2. WHAT I INDEPENDENTLY VERIFIED

### 2.1 Both production masking sites are now fail-closed under the source contract

In `SpecConditionStrategy._h_opening_range`, after `_resolve_opening_range_source()` has admitted the narrow sVkm role combination, the production handler derives:

```python
source_role_driven = self.source_timeframe_roles is not None
```

Then:

- `not session_bars` raises `FamilyMetaEnforcementError` when source-role-driven;
- `not state.opening_range_complete` raises `FamilyMetaEnforcementError` when source-role-driven;
- both branches retain `continue` on legacy/no-role execution.

This is the narrow repair ordered by AR-1115. No generic MTF framework or new orchestration layer was introduced.

### 2.2 The production tests discriminate instead of merely going green

The new production tests call `_h_opening_range` itself.

They include:

- missing 09:30 5m source bar → refusal;
- source session absent → refusal;
- identical positive setup with complete source bar → executes and preserves the 5m ORH/ORL;
- legacy/no-role control → still returns all-False rather than raising;
- 5m high mutation `100.50 → 133.00` with identical 1m execution bars;
- explicit `lock_idx == 5` before the no-leak assertion;
- migrated production refusals for duplicate source bars, wrong role-frame label, and mis-localized source timestamps.

The reported ablations are directionally credible because the refusal ablation leaves the positive witness and legacy control green, while the causal-lock ablation specifically collapses `lock_idx` from 5 to 0. That is the failure signature the tests are supposed to detect.

### 2.3 The dead causal helper is actually gone

At the inspected head, `svkm_role_execution.py` retains the production-used pieces:

- `SourceRoleExecutionError`;
- `parse_minutes`;
- `assert_svkm_role_combination`;
- `RoleFrame`.

`CausalOpeningRange` and `build_causal_opening_range` are removed. The generated inventory was regenerated in the same engineering commit and no longer lists the deleted helper as BUILT-UNREACHABLE.

This is a net architectural improvement: one causal rule, one live implementation, production-path tests.

### 2.4 Regression evidence is accepted at its stated scope

The worker did **not** claim repository-wide green. The reported regression population is the same import-closure rule used in AR-1114, rebuilt on both trees, with identical failure membership and no new failure IDs.

That is sufficient for this narrow change. The unmeasured repository remainder remains explicitly unmeasured.

---

## 3. NEXT: §9.2 IS AUTHORIZED, BUT DO NOT BUILD IT INTO AN UNPROVED DEAD BOUNDARY

The next objective is still the real source artifact:

> certified source evidence → produced artifact → persisted strategy/source record → Band C load → source-role parse → 5m/1m behavior

However, AR-1116 surfaced a new routing fact that must be resolved before editing:

`src/engine/extraction/spec_producer.py::produce_spec_artifact_from_record()` describes itself as the public full-record production compile boundary, and I independently verified that the function currently produces the artifact, opening-range lowering, and execution candidates **but does not emit `source_timeframe_roles`**.

The worker additionally reports that SYSTEM-INVENTORY classifies the producer module as unreachable from the measured entry-point set.

That creates a simple rule:

**DO NOT add the real timeframe carrier to `produce_spec_artifact_from_record()` merely because its docstring calls it production. First prove the live compile/persistence route.**

A beautifully correct carrier written into an unreachable producer would recreate the exact dead-code failure class this campaign just removed.

### 3.1 `SVKM-REAL-PERSIST-ROUTE-1` — first, read-only route proof

Before the next semantic edit, measure the real path from a certified extraction record to the persisted artifact/strategy row that the Band C money path actually loads.

Publish one concrete chain:

```text
real certified record
→ actual invoked compiler/producer entry point
→ portable artifact boundary
→ persistence writer / DB row or durable artifact
→ loader used by Band C
→ SpecConditionStrategy construction
→ SOURCE_FAITHFUL runtime gate
```

For every hop, name:

- file/function;
- whether it is statically reachable from a measured entry point;
- what identity travels across the hop;
- what source-owned fields survive;
- one positive control proving the hop runs;
- one negative/control case capable of detecting that the wrong path was inspected.

Stop if the alleged production producer is not on that chain.

### 3.2 Choose exactly one owning compile boundary

After the route proof, there are only two acceptable outcomes:

**A. `produce_spec_artifact_from_record()` is intended to be the canonical boundary but is not wired.**  
Wire that boundary into the real path, then make it the single owner of the source-role production step.

**B. Another boundary is already the real production compiler.**  
Put the role production there, or deliberately route that live boundary through `produce_spec_artifact_from_record()`.

Do **not** teach two independent producers how to reconstruct the same role contract.

---

## 4. `SVKM-REAL-PERSIST-1` — THE REAL SOURCE ROLE CARRIER

Once the live owning boundary is proved, recompile the real sVkm source and persist the versioned role carrier from certified evidence.

Required values and evidence grades remain:

```text
OPENING_RANGE_WINDOW = 5m   / EXPLICIT
BREAKOUT_CONFIRMATION = 1m  / EXPLICIT
FVG_DETECTION = 1m          / SOURCE_RESOLVED_BY_CONTINUITY
ENTRY_COMPLETION = 1m       / SOURCE_RESOLVED_BY_CONTINUITY
```

The persisted carrier must retain:

- role;
- timeframe;
- evidence grade;
- source quote/evidence pointer;
- source condition identity;
- schema version.

### Forbidden recoveries

The producer/persistence path may not reconstruct the carrier from:

- scalar `strategy.timeframe`;
- `trigger_tf`;
- lowest-timeframe logic;
- the prior confidence-0.4 backfill;
- the narrow adapter's expected-value table;
- a test fixture;
- a hand-authored sVkm constant pretending to be extracted evidence.

The adapter's `SVKM_EXPECTED_ROLE_TIMEFRAMES` remains a **validator**, never a producer.

### Required persistence discriminator

Take the real persisted sVkm artifact/row and prove:

1. all four role bindings survive save/load byte-semantically;
2. deleting the carrier from the persisted artifact makes SOURCE_FAITHFUL refuse;
3. changing only `OPENING_RANGE_WINDOW` from 5m to 1m or 15m makes the narrow execution path refuse;
4. leaving old scalar timeframe fields untouched cannot rescue either mutation.

That is the proof that persistence, not a nearby test constructor, owns the fact.

---

## 5. §9.3 SOURCE/CANDIDATE PAIRING COMES IMMEDIATELY AFTER PERSISTENCE

At the owning Band C join seam, require the execution candidate to belong to the exact persisted/executed source artifact.

The load-bearing identity must include the parent/source spec identity already carried by the candidate and the persisted artifact/spec hash.

Minimum rule:

```text
candidate parent/source spec hash == persisted/executed source spec hash
```

Missing identity or mismatch → REFUSE.

Do not solve this with name similarity, condition-count uniqueness, normalized titles, or "only candidate present" logic.

Required mutation:

- same well-shaped candidate from source A attached to source B must refuse before signal evaluation.

---

## 6. §9.4 END-TO-END DISCRIMINATORS REMAIN REQUIRED

After §9.2 and §9.3, execute the A–G end-to-end proof set from AR-1113/AR-1115 on the **real persisted sVkm artifact**, not only fixtures.

The final chain must prove:

```text
certified source evidence
→ compiler
→ persisted real strategy artifact
→ correct source/candidate identity
→ 5m opening-range source frame
→ causal lock
→ 1m breakout
→ 1m FVG
→ 1m entry completion
→ source stop
→ fixed 2R
```

No generic MTF engine. No silent resampling assumption. No scalar fallback. No future leak.

Only after §9.4 is green should the independent grader be dispatched.

---

## 7. ORDER OF WORK — FASTEST ROBUST PATH

1. **§9.1 CLOSED — do not revisit it without new contradictory evidence.**
2. `SVKM-REAL-PERSIST-ROUTE-1` — prove the live compiler/persistence chain, read-only first.
3. `SVKM-REAL-PERSIST-1` — emit + persist the real four-role carrier at the single owning boundary.
4. §9.3 — pin source/candidate identity at the owning join seam.
5. §9.4 — run the real persisted end-to-end A–G discriminator set.
6. Independent grade.
7. Only then unlock performance testing.

Do not spend another cycle improving fixture-only helpers, generic MTF infrastructure, or unrelated compiler architecture.

## 8. FINAL STATUS

**AR-1116: ACCEPTED.**  
**§9.1 narrow 5m→1m production execution seam: CLOSED.**  
**§9.2 real persistence: AUTHORIZED, with live-route proof first.**  
**§9.3 pairing: queued immediately after persistence.**  
**§9.4 real end-to-end proof: still required.**  
**Independent grade: not yet.**  
**Performance: BLOCKED.**
