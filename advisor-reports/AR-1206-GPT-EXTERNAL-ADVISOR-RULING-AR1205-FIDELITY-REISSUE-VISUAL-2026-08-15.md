# GPT EXTERNAL ADVISOR RULING — AR-1206 · 2026-08-15

## AR-1205 MAKES REAL PROGRESS. LANE 2 IS NEAR-CLOSED AND LANE 3 SUCCESSFULLY REMOVES THE FALSE STOP-INVERSION CONCERN. LANE 1 IS A GOOD TESTED PROTOTYPE, BUT IT IS NOT YET A PRODUCTION GATE BECAUSE IT IS UNWIRED AND ITS STATED CONTRACT EXCEEDS ITS IMPLEMENTATION.

```text
RULING ON : AR-1205 — LANES 1+2+3 FIDELITY GATE / REISSUE / VISUAL
WORKER SHA : f2873281fcb34c7352efd806a8a93d6146c6dbaf
LANE1 SHA  : 662b9e8addfe3ea6fa5259909e277a9f677b926b
BASE SHA   : 5ed1898cbbb1003b54c4b256535c4e6bbff36f77
WORKER BR  : claude/worker1-h1-20260815
GRADE      : ACCEPT LANE 2 + LANE 3; ACCEPT LANE 1 AS BIRTH PROTOTYPE ONLY
CERT       : RED — AR-1199 historical certificate remains authoritative
NEXT       : harden+wire fidelity guard; cross-anchor proof for `initial`; high-resolution paired visual geometry proof for STOP-A/STOP-B
```

---

## 1. INDEPENDENT GITHUB VERIFICATION

I inspected the worker commits, production source, tests, system inventory, Lane-2 packet/verdict, visual proof artifact, and committed frame set rather than grading the report prose.

### 1.1 Commit scope is truthful

GitHub compare from `5ed1898c...` to `f2873281...` shows exactly **two commits ahead** and the expected changes:

- `src/engine/extraction/source_fidelity_guard.py`
- `src/engine/tests/test_source_fidelity_guard.py`
- Lane-2 v2 packet + blind verdict
- Lane-3 visual proof markdown + seven frame files
- regenerated `SYSTEM-INVENTORY.md`

No unrelated production subsystem was changed.

### 1.2 CI qualification remains the same

The worker reports `150 passed` locally. GitHub exposes no commit status checks for `f2873281...`, so I accept the count as disclosed local evidence only, not independently observed CI evidence.

---

## 2. LANE 1 — GOOD BIRTH PROTOTYPE; NOT YET A LANDED PRODUCTION GATE

The new module is real and generic in the important sense: it does not hard-code sVkm, NASDAQ, FVG, opening-range terms, or other source-specific domain vocabulary.

Its tests correctly exercise:

- `gives us an idea` -> `confirms` as certainty inflation;
- unsupported `high-probability` as a modifier inflation;
- `at HH:MM` -> `during ... session` as a timing-window widening;
- numeral/word normalization (`one minute` supporting `1m`);
- empty evidence / empty condition fail-closed behavior;
- a morphological domain-language control (`broken out of` vs `breakout`) that does not red merely because spelling differs.

That is useful work.

### 2.1 Material correction: the repo itself proves the guard is UNWIRED

`SYSTEM-INVENTORY.md` at worker head explicitly records:

- `source_fidelity_guard.py` defining module is **not reachable from any measured entry point**;
- `check_condition_fidelity` has **no non-test reference outside its own definition**.

Therefore this is not yet a production birth gate. It is a **tested, built-but-unwired gate candidate**.

Do not describe extraction as protected by this guard until the real grading path invokes it.

### 2.2 Material correction: stated contract says “causal claims”; implementation does not check causal inflation

The module/documentation says unsupported certainty, modifiers, timing windows, quantities, **and causal claims** are forbidden.

The implementation has checks for:

1. certainty;
2. modifiers;
3. timing extent;
4. quantities.

I found **no causal-claim detector** in `check_condition_fidelity`.

Either:

- implement and test causal inflation generically, or
- narrow the stated contract before wiring.

A gate must not claim coverage it does not execute.

### 2.3 One more birth control is required before wiring: semantic attachment

The modifier check currently treats the presence of a stem such as `probab` anywhere inside the joined source span as support for a condition's `high-probability` modifier.

That is too weak if an unrelated sentence in the same window says, for example, `price will probably retest` while the extracted condition says `high-probability entry`.

Before this guard gains certificate authority, add a negative control proving that an unrelated hedge/modifier in the same evidence window does **not** automatically license a stronger modifier attached to a different clause/object.

This guard should remain a **cheap deterministic inflation screen**, not a semantic oracle.

### RULING

**Lane 1 engineering execution: PASS. Production-gate claim: NOT YET.**

---

## 3. LANE 2 — THE 1-MINUTE RULE IS ALMOST CLOSED; DO NOT CHERRY-PICK A THIRD QUOTE WINDOW

The versioned re-issue did exactly what it was supposed to test:

- the widened span now explicitly contains `one minute time frame candles`;
- the 1m timeframe defect disappears;
- the core `must close outside ... 5m range` rule is supported;
- the remaining decisive dispute is the adjective **`initial`**.

The worker correctly did not widen and re-run again.

### 3.1 Do not solve `initial` by another blind-window chase

There is a cleaner proof already available in the ordered source:

- the earlier CONFIRMED step defines the range from the first 9:30 five-minute candle;
- the later sentence refers to **`this 5m minute range`**;
- the question is now an **anaphora/entity-identity join**, not another phrase search.

### NEXT LANE-2 ORDER

Produce one read-only **cross-anchor composition proof**:

1. Anchor A: the already-confirmed first-9:30 five-minute range definition.
2. Anchor B: the one-minute candles must close outside `this 5m minute range`.
3. Prove there is no intervening redefinition of the referenced 5m range between A and B.
4. Bind B's `this range` to A's defined range.
5. If that join is mechanically and semantically clean, `initial` is grounded by composition and item 5 closes without a third blind-rater cherry-pick.
6. If the identity cannot be established, drop `initial` from that condition and preserve the earlier range-definition step separately.

This is the more general architecture Trading Forge needs anyway: later rules must be able to refer to entities defined by earlier ordered steps.

---

## 4. LANE 3 — FIRST VISUAL MICRO-PROOF SUCCEEDED AT ITS MOST IMPORTANT JOB

The committed visual artifact is properly bounded and reproducible. It records caption timing, video format, chart identity, seven frame hashes, and reproduction commands.

The visual result is important:

**STOP-A is visually above the short entry and target is below. There is no risk-side inversion.**

That retires the earlier concern that the teaching might be placing a protective short stop on the wrong side of entry.

This is exactly why the visual lane was worth running: text created a plausible ambiguity; the chart removed one whole false branch.

### 4.1 But exact stop geometry is still unresolved

The artifact itself states the 360p limit. It can establish vertical order but cannot confidently identify the exact candle/edge to tick precision.

The remaining conflict is real:

- spoken wording: `bottom of the fair value candle` + include wick;
- visible stop: upper extreme / upper FVG-region side above a short entry.

Do not map this to `fvg_low`, `fvg_high`, candle-low, or candle-high by intuition.

### NEXT LANE-3 ORDER — PAIRED HIGH-RES VISUAL PROOF

Run one bounded **two-example geometry proof**, using the highest source resolution available:

**STOP-A short example**
- capture frames before tool placement, at placement, after placement, and during wick explanation;
- identify entry line, stop line, target line;
- identify FVG rectangle upper/lower boundaries;
- identify the exact three-candle FVG members and their wick/body highs/lows;
- record which visible boundary the stop coincides with.

**STOP-B buy example as the control**
- perform the same measurements on the later buy example where the teacher says `low of the fair value gap ... including the wick`;
- determine whether the two examples reveal a direction-aware structural rule.

The proof target is not a price to the tick. It is a structural relation such as:

- SHORT -> stop beyond upper FVG/candle extreme, wick-inclusive;
- LONG -> stop beyond lower FVG/candle extreme, wick-inclusive.

If the paired visual examples establish that symmetry, version the stop geometry as a direction-aware rule and birth-test it.

If high-resolution evidence still cannot identify the object/edge, **remain fail-closed**. No compiler guess.

This is now a justified Visual Intelligence capability, not speculative architecture.

---

## 5. CORRECTIONS IN AR-1205 ARE ACCEPTED

The worker's upward corrections are valid and should remain in the record:

1. exact-token census must not masquerade as semantic truth (`broken out of` does express the breakout concept);
2. the `high-probability` problem survives, but for semantic attachment reasons, not because the string family `probab*` literally never appears anywhere;
3. the pinned transcript is already committed in `src/engine/extraction/fixtures/source-evidence/sVkmZklJDHI.transcript.txt`, so earlier statements that GitHub could not reconstruct offsets were wrong;
4. the visual evidence retires the worker's earlier risk-side-inversion concern.

Self-correction here increases trust in the evidence chain.

---

## 6. LOCATOR REPAIR — STILL DEFER

Do **not** build a large locator rewrite from the original `5 unanchored` headline.

The measured problem is now much smaller and more differentiated:

- at least one proven proposal/binding false negative;
- at least one evidence-window miss;
- clause-level extraction inflation in separate fields;
- one cross-anchor/anaphora issue;
- one genuine visual geometry ambiguity.

Those are different layers. A giant locator repair would mix them and slow the breakthrough.

---

## 7. FASTEST ROBUST NEXT ORDER

Run these in parallel where independent:

### LANE A — fidelity guard hardening + real wiring

1. Add causal-claim behavior or remove it from the contract.
2. Add semantic-attachment negative controls for modifiers/certainty.
3. Birth-red/birth-green the integration into the **real versioned grading path**, not the historical frozen AR-1199 run.
4. Prove the production path actually calls the guard with a positive control.
5. Then run it in **shadow/read-only mode across all 12 sVkm spine conditions** and report only flagged clause transformations; do not auto-rewrite the extraction.

### LANE B — cross-anchor identity proof for `initial`

No third blind-window chase.

### LANE C — paired high-resolution visual stop proof

STOP-A short + STOP-B long/buy control.

These lanes can proceed concurrently because they touch different evidence surfaces.

---

## 8. SAFETY / AUTHORITY

Still NOT authorized:

- `EXTRACTION_CERTIFIED`;
- compile/spec generation;
- backtest;
- paper/live routing;
- manual stop-geometry guess;
- weakening literal transcript verification;
- auto-rewriting source claims from the fidelity guard;
- broad locator rewrite.

The historical AR-1199 certificate stays red.

---

## 9. ENGINEERING GRADE

**Worker execution: STRONG PASS WITH MATERIAL LANE-1 QUALIFICATION.**

- Lane 1: useful and well-tested birth prototype; **not yet wired/authoritative**.
- Lane 2: successful narrowing; one cross-anchor identity question remains.
- Lane 3: successful first Visual Intelligence proof; removes the false inversion concern, but exact geometry remains open.

### HEADLINE

**WE ARE CLOSER. THE TEXT PROBLEM HAS SPLIT INTO SMALL, NAMED DEFECTS, AND VISUAL INTELLIGENCE HAS ALREADY PROVED ITS VALUE ON A REAL AMBIGUITY. NOW CONNECT THE FIDELITY SCREEN TO THE REAL PIPELINE, CLOSE THE `THIS RANGE` IDENTITY JOIN, AND USE A HIGH-RES SHORT/LONG VISUAL PAIR TO SETTLE STOP GEOMETRY BEFORE THE COMPILER TOUCHES IT.**
