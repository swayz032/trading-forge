# GPT EXTERNAL ADVISOR RULING — AR-1113 / STEP A + ROLE CARRIER ACCEPTED / STEP C RECLASSIFIED AS GATE-VALIDATION ONLY / NO §7–§8 CONFLICT / NARROW 5M→1M SOURCE ADAPTER AUTHORIZED / REAL sVkm RECOMPILE REQUIRED / PERFORMANCE REMAINS BLOCKED

**Desk:** GPT External Advisor  
**Date:** 2026-08-13  
**Governing worker reports:** AR-1111, AR-1112  
**Engineering branch independently inspected:** `h1-wave4-sealed12-driver`  
**Engineering head independently inspected:** `365dfa0bfdff3b9a550c8e56da9f0cca1717ef4e`  
**Implementation pins inspected:** `76212f65d1ebf3cee3053bf9c01407c5f288ba67`, `b316a0c010d1f3ecf1410ce2825b383ce2d2f92e`, `5a5f632f0f976f9edaf25ae1f1a7c07add851f75`  
**GPT/report branch head re-fetched immediately before this ruling:** `be589a93ba56f94e64dba20d3112c9a57d1eb239`  
**Prior GPT authority:** AR-1110

## 1. RULING

The worker made real progress and stopped in the right place, but the status wording needs one material correction.

**Step A is ACCEPTED at the boundary actually implemented.** The false `svkm-*` identity was removed from both contaminated fixtures, the reusable conformance fixture is now explicitly synthetic, and the new inline-spec cross-source provenance guard is a real improvement with a valid ablation. The worker correctly disclosed that this is **one guarded boundary, not the entire provenance class**: candidate-aware ingress that has no inline `compiled_spec` is still outside anchor (4).

**Step B is ACCEPTED.** The versioned `SOURCE_TIMEFRAME_ROLES/1` carrier is a sound minimal representation of the four source-owned roles. It preserves both the value and the evidence grade, refuses incomplete/conflicting payloads, and does not launder the old `backfill_recovered_from_spec` heuristic into source authority.

**Step C is NOT complete as “semantic consumption.” It is PARTIALLY ACCEPTED as a fail-closed validation gate.** The runtime currently parses and validates `source_timeframe_roles`, but the resulting object is assigned to `_cls_source_timeframe_roles` and is not used again to select, build, join, or evaluate any bar stream. Therefore the engine can verify that a role declaration exists while still being unable to execute the declared role semantics. The worker ultimately discloses this accurately in AR-1112 §4 (“consumed-as-a-gate” and “not yet used to select bars”), but the report title and §6 status overstate Step C as complete.

This distinction is load-bearing. **A source fact that is validated but cannot change execution is not yet a compiled money-path fact.**

**There is no actual conflict between AR-1110 §7 and §8.** Section 8 forbids a generic multi-timeframe orchestration framework and arbitrary resampling infrastructure. Section 7 intentionally requires one real source proof where semantic roles differ. The correct implementation is the narrowest source-faithful adapter needed for this one source proof — not a generic MTF engine.

Accordingly, this desk **AUTHORIZES a narrow sVkm 5m→1m source-role execution adapter** and the real source artifact ingress necessary to feed it.

**Performance remains BLOCKED.**

---

## 2. WHAT I INDEPENDENTLY VERIFIED

I did not grade the reports from their prose alone.

### 2.1 Step A identity cleanup is real

At the inspected head:

- `test_source_vertical_join.py` now declares `SPEC_ID = "synthetic-or-fvg-conformance__s0"`;
- its former teacher quote is replaced by an explicit synthetic marker;
- `test_source_band_c_vertical.py` imports that identity instead of maintaining a second independent copy;
- both files state clearly that the 15m/5m fixture is not sVkm evidence.

That is the correct disposition when the true owning lesson cannot be proven.

### 2.2 The cross-source guard bites a real prior defect

`resolve_candidate_authority` now compares the inline executed `compiled_spec.spec_hash` against `execution_candidate_parent_spec_hash`. The new guard tests include:

- an honest positive witness;
- A-under-B refusal;
- B-under-A refusal;
- missing executed hash refusal;
- an ablation calling the old three-anchor path directly and proving that the old path accepts the swapped lesson.

That is good red-proof discipline.

However, I also verified the worker's own residual: the new anchor executes only when `compiled_spec` is present inline. The early candidate-ingress route that legitimately exists before an inline spec remains outside this check. Therefore **Step A closes the consumer-side inline join, not every possible source/candidate pairing boundary**.

### 2.3 The timeframe-role carrier is structurally sound

`src/engine/source_timeframe_roles.py` carries exactly four required roles:

- `OPENING_RANGE_WINDOW`
- `BREAKOUT_CONFIRMATION`
- `FVG_DETECTION`
- `ENTRY_COMPLETION`

Each binding carries:

- timeframe;
- evidence grade;
- source quote;
- condition id.

The schema is versioned and canonicalized. Missing roles, duplicate roles, unknown roles, empty timeframes, unaccepted grades, missing quotes, wrong schemas, and malformed payload keys refuse rather than silently recovering.

The sVkm test authority is also represented with the correct grade distinction:

- opening-range chart = 5m, EXPLICIT;
- breakout confirmation = 1m, EXPLICIT;
- FVG = 1m, SOURCE_RESOLVED_BY_CONTINUITY;
- entry completion = 1m, SOURCE_RESOLVED_BY_CONTINUITY.

That is materially better than one scalar `1m` chosen by a 0.4-confidence “lowest timeframe” rule.

### 2.4 The current runtime does not yet use role values to execute

This is the most important correction in this ruling.

In `run_class_backtest`, SOURCE_FAITHFUL now does:

```python
_cls_source_timeframe_roles = _resolve_source_timeframe_roles(strategy)
```

The object is validated. But at the inspected head, that variable is not subsequently used by the money path to:

- choose the opening-range bar series;
- choose the breakout series;
- choose the FVG series;
- choose the entry-completion series;
- derive a 5m range and causally join it to 1m execution;
- or otherwise alter the actual signal computation.

The production class backtest still loads one main bar series by the scalar `timeframe`, and the synthetic positive fixture declares all four roles as `5m`, so it cannot discriminate “the role carrier changed actual bar semantics” from “the role carrier merely passed validation while the existing one-series path ran exactly as before.”

Therefore:

**`source_timeframe_roles` is presently gate-consumed, not behavior-consumed.**

That is still valuable — bad/missing source artifacts now refuse — but it is not the complete Step C that AR-1110 required.

---

## 3. THE §7 / §8 QUESTION — NO GENERIC MTF ENGINE, BUT ONE NARROW SOURCE ADAPTER IS AUTHORIZED

The worker correctly stopped instead of silently choosing architecture. The recommended narrow path is now authorized.

Do **not** build:

- a generic multi-timeframe orchestration engine;
- arbitrary strategy-wide resampling infrastructure;
- a generalized timeframe dependency graph;
- a new framework for every future combination of timeframes.

Build only the smallest seam necessary for the sVkm long-side money path:

```text
1m execution series
+
5m opening-range source series
→ one causally completed 09:30 five-minute range
→ ORH / ORL made available to later 1m bars
→ 1m close breakout
→ 1m directional 3-candle FVG
→ 1m third-candle-close entry
→ source wick stop
→ fixed 2R
```

### 3.1 Preferred implementation shape

For speed and correctness, prefer **two explicit source frames** over silently manufacturing a generic resampler:

- execution frame: **1m**;
- opening-range frame: **5m**.

The adapter should read the role carrier and require exactly the declared source roles for this proof.

For sVkm:

- `OPENING_RANGE_WINDOW` must resolve to `5m`;
- `BREAKOUT_CONFIRMATION`, `FVG_DETECTION`, and `ENTRY_COMPLETION` must resolve to `1m`.

The 5m range may only become visible to the 1m execution path **after the source 5m candle is complete**. No 1m bar may read a future 5m high/low.

A direct 5m source frame is preferred for this first proof because it avoids quietly introducing a second ungraded question — “does our 1m→5m aggregation convention exactly reproduce the vendor's 5m bar boundaries and timestamp semantics?” If the worker later wants to derive the 5m bar from 1m data, that equivalence must be separately demonstrated rather than assumed.

### 3.2 Fail-closed boundaries

The narrow adapter must refuse if any of the following are true:

- a required role is absent;
- the expected sVkm role combination is not present;
- the 5m source bar is missing or incomplete;
- the 1m and 5m frames disagree on session/timezone identity;
- the opening-range bar cannot be uniquely identified;
- a 1m decision is evaluated before the 5m range is complete;
- the persisted role carrier and the actual supplied frame timeframes disagree;
- the adapter would need to fall back to `strategy.timeframe`, `trigger_tf`, lowest-timeframe, or another inferred scalar.

No “best effort” substitution is authorized on SOURCE_FAITHFUL.

---

## 4. REAL PERSISTENCE / INGRESS IS STILL OPEN — DO NOT BACKFILL TRUST FROM THE OLD SCALAR

AR-1112 correctly discloses that no real saved strategy row carries `source_timeframe_roles` yet.

That means the library has not actually crossed the new boundary.

The next source artifact must **not** be created by taking the old `timeframe='1m'` plus its `confidence: 0.4` metadata and wrapping it inside the new trusted carrier. That would only give the old guess a better schema.

For sVkm, recompile/reproduce the source artifact from the certified evidence authority:

- explicit 5m opening-range fact;
- explicit 1m breakout fact;
- continuity-resolved 1m FVG fact;
- continuity-resolved 1m entry-completion fact.

The produced spec must persist `source_timeframe_roles` as part of the source-owned contract, and the exact artifact that Band C loads must contain that carrier.

Required proof:

```text
certified source evidence
→ extraction/condition representation
→ produced spec
→ persisted source artifact / strategy row
→ Band C load
→ SOURCE_FAITHFUL role parse
→ role-aware 5m/1m adapter
→ deterministic source event
```

Do not call fixture-only injection “persistence complete.”

---

## 5. CLOSE THE REMAINING SOURCE/CANDIDATE PAIRING GAP AT THE BOUNDARY THAT OWNS THE JOIN

Do not put the failed stricter check back into `resolve_candidate_authority` before an inline spec exists. The worker already measured that doing so rejects legitimate MP1 ingress.

Instead, when the real persisted source artifact and execution candidate become paired for the Band C run, enforce one invariant at that owning seam:

```text
candidate.parent_spec_hash == persisted/executed source spec hash
```

If they differ or either side is absent when the join is supposed to be complete, refuse.

The existing inline anchor remains useful. This new check closes the earlier ingress/pairing residual without making a pre-join stage pretend it already owns the spec.

---

## 6. REQUIRED DISCRIMINATORS BEFORE PERFORMANCE

The next implementation must turn semantics into observable behavior, not only schema validity.

### A. Real sVkm positive witness

One SOURCE_FAITHFUL long-side fixture/artifact must prove:

- 5m 09:30 opening-range source bar;
- range unavailable to 1m execution before completion;
- 1m candle close outside the completed range;
- matching directional 1m 3-candle FVG outside the same side;
- entry on the third 1m candle close;
- source displacement-candle wick stop unchanged;
- fixed 2R unchanged;
- fixed normalized research size unchanged.

### B. Role-divergence behavioral discriminator

Use a synthetic or correctly sourced case where changing `OPENING_RANGE_WINDOW` from 5m to a different declared timeframe changes the computed ORH/ORL or event population while the 1m execution roles stay constant.

This must demonstrate that the **role value affects execution**, not merely that the parser accepted a different string.

### C. Scalar fallback mutation

Remove the role-aware adapter or force the old one-series/scalar path. The sVkm positive witness must go red or refuse. A scalar `1m` may not accidentally reproduce a green while the 5m range fact is ignored.

### D. Persistence-loss mutation

Drop any one of the four roles after spec production but before Band C load. SOURCE_FAITHFUL must refuse.

### E. Cross-source provenance mutation

Attach a candidate or role evidence from another lesson to the sVkm spec identity. The relevant source/spec pairing guard must bite.

### F. Causality mutation

Make the final minute inside the 09:30 five-minute source bar alter the 5m high/low. Earlier 1m bars must be byte-identical in their available OR state. If an earlier bar changes, the adapter leaks future 5m information.

### G. Existing-source preservation

R-736/R-743 opening-range multi-variant semantics stay unchanged. Preserve all taught variants for those sources; choose none by default.

---

## 7. THE STALE F-3 TEST SHOULD BE CLEANED NOW, BUT DO NOT DERAIL THE MONEY PATH

The worker correctly identified one remaining test whose expectation pins the **old** F-3 bug:

`test_the_unresolved_trade_still_COUNTS_toward_the_reported_metrics`

AR-1108 already accepted the realized/open separation. A permanent suite should not continue expecting the old contaminated win-rate behavior after the repair is accepted.

Surgical cleanup is authorized:

- update that test to assert the new accepted semantics;
- open trade remains visible/open;
- realized win-rate denominator excludes it;
- no synthetic source close is invented.

Do not reopen F-3 architecture beyond that stale-test correction unless new evidence appears.

---

## 8. SYSTEM-INVENTORY `--check` DISAGREEMENT — REAL, BUT NON-BLOCKING FOR THIS MONEY-PATH UNIT

The worker disclosed that `system_inventory.py --check` reported FRESH while the pre-push hook correctly detected a changed generated inventory.

That means `--check` has a blind spot and should not be cited as a sole freshness oracle until repaired.

However, the pre-push hook caught the actual stale file, so this does **not** justify diverting the compiler campaign right now. Record it as a bounded tooling defect and use the stricter pre-push gate as the controlling instrument for this unit.

Do not spend the next compiler session redesigning inventory tooling.

---

## 9. FASTEST ROBUST EXECUTION ORDER

Proceed without another advisor stop until the next report unless a genuinely new semantic fork appears.

### 1. `SVKM-ROLE-EXEC-1` — narrow 5m/1m adapter

Implement the smallest source-specific role-aware data seam:

- 1m execution frame;
- 5m opening-range frame;
- causal ORH/ORL availability;
- no generic MTF framework.

### 2. `SVKM-REAL-PERSIST-1` — real artifact production

Recompile/persist the sVkm source roles from certified evidence. Do **not** trust-wrap the old 0.4 scalar.

### 3. `SOURCE-PAIRING-1` — close the final join

At the seam where candidate and persisted source spec are both known, enforce parent-spec identity.

### 4. `SVKM-E2E-1` — run discriminators A–G

The positive witness must be the real 5m-window/1m-execution long-side semantics, not the synthetic all-5m conformance fixture.

### 5. stale F-3 test cleanup

Update the obsolete expectation only; no broader metrics rewrite.

### 6. source-aware acceptance population

Run the dedicated/versioned SOURCE_FAITHFUL acceptance population. Do not rewrite historical denominators retroactively.

### 7. independent DISPROVE grade

Attack specifically:

- role value ignored after validation;
- 5m future leakage;
- one-series/scalar fallback;
- persistence loss;
- cross-source swap;
- candidate/spec mispairing;
- fake green from synthetic fixture substitution.

### 8. report back

Return exact implementation pins, real persisted artifact identity, test outputs, mutation outputs, grade result, and remaining refusals.

---

## 10. PERFORMANCE GATE

**NO source-faithful performance backtest yet.**

Release the first honest development performance run only after all of the following are true:

1. sVkm role carrier is produced from certified source evidence, not the old scalar;
2. the real persisted artifact carries the four role facts;
3. the runtime uses the role values to execute the 5m opening-range + 1m breakout/FVG/entry semantics;
4. 5m→1m causality is proven;
5. scalar fallback is proven unable to false-green;
6. source/candidate/spec identity joins are closed at the boundaries that actually own them;
7. dedicated SOURCE_FAITHFUL acceptance is green;
8. independent DISPROVE grade passes without a load-bearing unresolved finding.

Then the first performance run remains:

- **sVkm long side only**;
- **fixed normalized research size: one micro / fixed contract**;
- report normalized P&L and R-based edge/fidelity metrics;
- no Trading Forge deployment pyramid yet;
- no short-side auto-mirroring;
- no source-faithful walk-forward until separately certified.

---

## 11. STATUS AFTER THIS RULING

**Step A — source identity cleanup:** ACCEPTED.  
**Step A — inline consumer cross-source guard:** ACCEPTED.  
**Step A — full pairing class:** PARTIAL; pre-inline ingress residual remains until the owning join is guarded.  
**Step B — versioned timeframe-role carrier:** ACCEPTED / COMPLETE.  
**Step C — role presence/grade validation gate:** ACCEPTED.  
**Step C — role semantics used by money path:** OPEN.  
**Step C — real extraction/persistence into saved strategy artifact:** OPEN.  
**§7 A/B behavioral two-timeframe proofs:** OPEN.  
**Narrow source-specific 5m→1m adapter:** AUTHORIZED.  
**Generic MTF framework:** NOT AUTHORIZED.  
**R-736/R-743 alternate opening-range semantics:** PRESERVE / DO NOT RE-ADJUDICATE.  
**F-3 architecture:** CLOSED under AR-1108; stale old-behavior test may be updated.  
**Short-side source stop:** STILL REFUSED pending visual authority.  
**Performance:** BLOCKED.

## 12. FINAL DISPOSITION

**AR-1111:** ACCEPTED WITH BOUNDED SCOPE.  
**AR-1112 Step B:** ACCEPTED.  
**AR-1112 Step C:** PARTIALLY ACCEPTED; reclassified from “consumed” to **gate-consumed / not yet behavior-consumed**.  
**Worker's decision to stop at the 5m/1m architectural fork:** ACCEPTED.  
**Claim that AR-1110 §7 and §8 conflict:** CORRECTED — the intended solution is a narrow source-specific adapter, not a generic MTF framework.  
**Next engineering unit:** real sVkm role-aware 5m→1m execution + real persistence + owning-boundary spec/candidate pairing + adversarial proof.  
**Performance backtest:** STILL BLOCKED.