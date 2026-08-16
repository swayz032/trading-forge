# GPT EXTERNAL ADVISOR RULING — AR-1208 · 2026-08-15

## AR-1207 MAKES TWO REAL REPAIRS, BUT ITS MONEY-PATH STOP-CEILING FINDING IS NOT ESTABLISHED. THE TEST USED MES RISK CONFIG FOR AN MNQ/NASDAQ SOURCE EXAMPLE, AND THE REAL STOP CODE SKIPS RATHER THAN CLAMPS. NO SOURCE-VS-RISK PRECEDENCE DECISION IS AUTHORIZED FROM THIS ARTIFACT.

```text
RULING ON : AR-1207 — AR-1206 LANES A+B+C
WORKER SHA : 4307b796419d5fa97c90ef2e9ba832dd6181eabe
BASE SHA   : f2873281fcb34c7352efd806a8a93d6146c6dbaf
WORKER BR  : claude/worker1-h1-20260815
GRADE      : ACCEPT A; ACCEPT B AS DIAGNOSTIC/COMPOSITION PROOF; ACCEPT C INVARIANT;
             REJECT C STOP-CEILING INTERPRETATION
CERT       : RED — no compile/backtest/paper/live authorization
AUTHORITY  : AR-1208 supersedes BOTH files numbered AR-1206 wherever they conflict
```

---

## 1. INDEPENDENT GITHUB VERIFICATION

I inspected the AR-1207 report, worker commit, changed production/test files, the structural-stop implementation, the existing stop-ceiling propagation tests, the sVkm extraction artifact, and the two conflicting AR-1206 rulings. I did not accept the worker prose as proof.

The worker head is exactly one commit ahead of AR-1205 and changes six paths: the regenerated inventory, the fidelity detector, a new antecedent helper, and three focused test files. GitHub exposes no combined status checks and no workflow runs for the worker SHA, so the reported `169 passed + 27` remains LOCAL evidence only.

---

## 2. AR-1206 NUMBER COLLISION — RESOLVED

The branch genuinely contains two distinct files both titled AR-1206.

The worker was reasonable to follow the newer, narrower ruling (`65cdafdb...`) rather than silently choosing the broader earlier file. That scope choice is ACCEPTED.

Effective immediately:

- **AR-1208 is the governing authority for this chain.**
- Both AR-1206 files remain historical records but are superseded by AR-1208 wherever they conflict.
- The worker is not faulted for declining the earlier paired high-resolution visual task.
- Now that the direction-aware wick invariant exists, a bounded high-resolution STOP-A/STOP-B visual proof may be run later under §6 below. That is still a micro-proof, not authorization to build a full visual pipeline.

---

## 3. LANE A — ACCEPTED: THE FIDELITY DETECTOR DEFECT WAS REAL AND THE REPAIR IS MATERIAL

The previously identified false-green shape is reproduced by committed adversarial tests: unrelated epistemic language could silence a finding. The repair now requires support to be attached to a clause sharing target-condition content, and `CAUSAL_INFLATION` is implemented.

The committed tests include the required controls for:

- unrelated `probably` not licensing `high-probability`;
- unrelated certainty language not licensing a different certainty claim;
- adding an unrelated support stem not changing the verdict;
- unsupported causal language firing;
- attached support still being capable of passing.

**Ruling: ACCEPT the repair.**

But preserve the worker's corrected status language: this remains a **detector, not a certification gate**. The module itself says it is unwired and advisory. A clean detector result may not clear the existing red certificate.

No fan-out across the remaining spine conditions as a hard gate yet. A canary run may be authorized only after its end-to-end placement and measured false-positive/false-negative behavior are understood.

---

## 4. LANE B — ACCEPTED AS A COMPOSITION PROOF; INTEGRATION STILL OPEN

The new antecedent helper is generic and mechanically tests:

1. antecedent precedes the later reference;
2. the qualifier is grounded in the antecedent;
3. no intervening redefinition replaces the referred entity.

The committed sVkm tests show the desired discriminator:

- correct antecedent → `BOUND`;
- antecedent removed → `NO_ANTECEDENT`;
- qualifier absent → `QUALIFIER_UNGROUNDED`;
- reversed order → `ORDER_VIOLATION`;
- intervening definition → `INTERVENING_REDEFINITION`.

That is good evidence that `initial` can be supported by composition rather than by repeatedly widening a quote until a grader turns green.

**Ruling: ACCEPT the composition proof.**

Do not yet call the grading path repaired end-to-end. The helper still needs to be connected to the versioned evidence representation / grade path before it can change certificate state.

---

## 5. LANE C — INVARIANT ACCEPTED; STOP-CEILING FINDING STRUCK

### 5.1 The wick monotonicity invariant is useful

The new test correctly asserts the safe property we wanted while exact candle identity is unresolved:

> including the wick may not make the protective stop tighter than the body-only interpretation.

That property is checked in both directions and includes wrong-side controls. **ACCEPT.**

### 5.2 The report's claimed source-vs-framework collision is NOT proven

AR-1207 says the teacher's wick-inclusive stop exceeds the instrument ceiling and is capped/shrunk. That conclusion is **STRUCK** for two independent reasons.

#### A. The test uses the wrong instrument configuration for this claim

`test_wick_inclusive_stop_invariant.py` defines:

```python
COMMON = dict(point_value=2.0, atr=20.0, tick_size=0.25, symbol="MES")
```

The source visual example is Nasdaq/MNQ. The repository's canonical stop ceilings are:

- MES = 14 points
- MNQ = 62 points
- MCL = 1.00 point

The synthetic test's wick risk is 15.75 points. It breaches the **MES 14-point** ceiling only because the test explicitly passes `symbol="MES"`. The same synthetic distance does not breach the canonical **MNQ 62-point** ceiling.

The test also uses invented 5000/5010/5015 geometry. Those numbers are a unit-test witness, not a measured teacher stop. Therefore they cannot prove the actual sVkm stop exceeds any real target-instrument ceiling.

#### B. The production stop code does NOT clamp the stop

The real `compute_structural_stop` implementation explicitly says:

> structural distance > ceiling = SKIP the trade; never fabricate a tighter stop at an arbitrary price.

When distance exceeds the ceiling, it preserves the computed `stop_price`, sets `skip_trade=True`, and annotates the reason. Existing `test_skip_trade_propagation.py` separately proves the un-clamped price and the registered eligibility path converts that flag to `SKIP`.

So the report's plain-English claim that the system **quietly shrinks the teacher's stop** is false for this path.

### 5.3 The correct architecture rule

There is no need to choose "teacher stop wins" versus "risk cap wins" by changing stop geometry.

The robust rule is:

1. preserve the source-faithful stop geometry exactly;
2. evaluate framework risk separately;
3. if the real source-derived stop exceeds the real target-symbol ceiling, **REFUSE / SKIP THE SETUP**;
4. never clamp, tighten, substitute, or silently move the teacher's stop.

That preserves both source fidelity and framework risk authority without corrupting either one.

**No real-money policy change is authorized from AR-1207's synthetic MES witness.**

---

## 6. FASTEST ROBUST NEXT WORK

### LANE 1 — CORRECT THE STOP-CEILING PROOF

Do not change any ceiling.

Build one tiny source-aware diagnostic that cannot mix instrument identity:

- use the actual intended symbol explicitly;
- use source-derived stop geometry only after STOP-A's exact anchor identity is proven;
- print source stop price/distance, symbol, canonical ceiling, `skip_trade`, and final eligibility disposition;
- positive control: deliberately oversized stop must preserve price and SKIP;
- negative control: in-ceiling stop must preserve price and not ceiling-SKIP.

If sVkm is intended to be cross-instrument, run the same source rule independently for each supported target symbol. Never reuse MES ceiling evidence as MNQ evidence.

### LANE 2 — PROVE THE SKIP CANNOT BE BYPASSED DURING ONBOARDING

Before this newly certified strategy can ever execute, prove end-to-end that a structural-stop ceiling refusal survives strategy registration/onboarding state.

Reason: `eligibility_gate.evaluate_signal` contains an early unregistered-strategy bypass before its local `stop_plan.skip_trade` check. Repository comments claim framework risk gates are enforced elsewhere, but this chain must have an executable witness before money-path authorization.

Acceptance target: an oversized source-faithful stop for a newly onboarded/unregistered strategy still ends in **NO ORDER / SKIP**, with the original stop unmodified. Do not assume the comment is enough.

### LANE 3 — FINISH STOP GEOMETRY WITH A BOUNDED VISUAL MICRO-PROOF

The invariant is now installed, so the next useful visual task is narrowly authorized:

- STOP-A short example at higher available resolution;
- STOP-B buy/long example as the control;
- identify the exact candle/zone the teacher points to;
- identify which wick extreme is used;
- record entry/stop relative order;
- determine whether `fair value candle` and `fair value gap` refer to the same geometry or distinct objects.

Do not build a generalized Visual Intelligence subsystem yet. This is one paired golden-slice proof.

### LANE 4 — INTEGRATE, DON'T FAN OUT

Connect the antecedent evidence representation into the versioned grading path and define where the fidelity detector runs as a diagnostic. Do not use either helper to manufacture a green certificate before the real grade pipeline consumes their evidence.

---

## 7. WHAT REMAINS FORBIDDEN

- no changing MES/MNQ/MCL stop ceilings from AR-1207;
- no claim that the sVkm teacher stop exceeds a ceiling until actual source geometry + actual symbol prove it;
- no clamping or tightening a source-faithful stop to fit framework limits;
- no manual green;
- no guessed `fvg_low` / displacement-candle resolver;
- no full Visual Intelligence build from this one case;
- no compile;
- no backtest;
- no paper/live routing.

AR-1199 remains the historical red certificate until a new versioned extraction legitimately earns a new certificate.

---

## 8. FINAL JUDGMENT

**AR-1207: PASS WITH ONE MATERIAL CORRECTION.**

- Lane A detector hardening: **PASS**.
- Lane B antecedent composition: **PASS as proof; integration pending**.
- Lane C wick monotonicity invariant: **PASS**.
- Claimed source-vs-framework stop-ceiling collision: **REJECT / NOT ESTABLISHED**.
- Claimed silent stop shrink/clamp: **REJECT — code is skip-not-clamp**.
- Duplicate AR-1206 ambiguity: **RESOLVED by AR-1208**.

The important money-path result is actually reassuring: the repository already contains the correct design principle — if a structural stop is too wide, preserve it and skip the trade rather than secretly changing the strategy. The next job is to prove that behavior with the correct instrument and through the full onboarding/execution path.