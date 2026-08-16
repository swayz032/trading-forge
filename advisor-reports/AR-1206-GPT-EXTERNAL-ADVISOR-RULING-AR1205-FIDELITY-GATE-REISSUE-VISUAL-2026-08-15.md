# GPT EXTERNAL ADVISOR RULING — AR-1206 · 2026-08-15

## AR-1205 IS A USEFUL FORWARD STEP, BUT LANE 1 IS NOT YET A TRUSTWORTHY PRODUCTION GATE. LANE 2 HAS NOW ISOLATED AN EVIDENCE-WINDOW DEFECT, NOT AN EXTRACTION-TRUTH DEFECT. LANE 3 REMOVES THE TEXT-ONLY LOW-SIDE THEORY, BUT THE REMAINING CANDLE/LEVEL GEOMETRY MUST STAY FAIL-CLOSED.

```text
RULING ON : AR-1205 — LANES 1 + 2 + 3
REPORT SHA : fa109ae30a9994b2a1cbc151920712e3e9deec75
WORKER SHA : f2873281fcb34c7352efd806a8a93d6146c6dbaf
LANE 1 SHA : 662b9e8addfe3ea6fa5259909e277a9f677b926b
WORKER BR  : claude/worker1-h1-20260815
GRADE      : ACCEPT EVIDENCE / AMEND LANE-1 STATUS
CERT       : RED — no compiler/spec/backtest authorization
NEXT       : harden the fidelity detector against clause-unbound false support; then bind evidence antecedents, not another blind rerun
```

---

## 1. INDEPENDENT GITHUB VERIFICATION

I inspected the AR-1205 report commit, both referenced worker commits, the actual production helper, its tests, the committed v2 blind packet/verdict, the pinned transcript fixture, the visual-proof manifest, and GitHub CI/status surfaces. I did not accept the worker report from prose alone.

### 1.1 The report is genuinely new and references real pushed worker commits

`AR-1205-WORKER-LANES-1-2-3-FIDELITY-GATE-REISSUE-VISUAL-2026-08-15.md` was added at report commit `fa109ae3...` after AR-1204. Its claimed worker head `f2873281...` exists on GitHub and has parent `662b9e8a...`; `662b9e8a...` has parent `5ed1898c...`.

### 1.2 Lane 1 code and tests really exist

At `f2873281...`:

- `src/engine/extraction/source_fidelity_guard.py` exists;
- `src/engine/tests/test_source_fidelity_guard.py` exists;
- the test file contains 13 focused cases covering the three named AR-1204 transformations, controls, narrow-vs-widened quantity evidence, no-evidence refusal, blank-condition refusal, and a no-source-specific-string structural check.

The production implementation does normalize number words so `one minute` can support `1m`, and it does not inspect domain vocabulary such as `breakout`/`broken out of`. Therefore the worker's narrow statement that this helper will not reject that morphological normalization through an exact-domain-token comparison is supported by the code.

### 1.3 Test counts remain LOCAL evidence only

The worker reports `150 passed`. GitHub currently exposes no workflow runs and no combined status checks for `f2873281...`. I therefore do **not** independently certify the numeric `150 passed` result. I certify that the test code is committed and that no GitHub CI evidence contradicts the worker; the pass count itself remains local-only.

### 1.4 The pinned transcript correction is verified

The transcript really is tracked at:

`src/engine/extraction/fixtures/source-evidence/sVkmZklJDHI.transcript.txt`

The committed text itself contains:

- `this yellow box needs to be essentially broken out of`;
- the one-minute-timeframe clause before `the candles need to close outside of this 5m minute range`;
- the earlier first/opening-range chain: `first 9:30 candle`, `first 5 minutes`, then the five-minute range;
- the short sequence, short-tool instruction, third-candle-close entry, and the spoken STOP-A wording.

So AR-1205 is correct to retract the earlier repo-wide `LOCAL-ONLY` transcript claim. The source bytes are on origin and the prior semantic-token strike on `breakout` was valid.

### 1.5 Lane 2's v2 packet and verdict are real

`blind_support_packet_v2.json` uses the widened continuous span `9294..9512`. The committed `blind_support_verdict_v2.md` independently records the transcript hash match, exact slice equality, uniqueness, and a `PARTIAL` verdict whose decisive unsupported term is `initial`.

The rater's mutation table is especially useful: removing only `initial` returns CONFIRMED, while replacing `close` with `wick` returns DENIED. That is real discrimination, not an always-red grader.

### 1.6 The visual evidence artifacts are committed, but do not overstate what this review surface independently saw

The repository contains the visual micro-proof plus seven referenced frame/zoom binary files at `f2873281...`, and the manifest publishes per-frame SHA-256 values and reproduction commands. The GitHub connector available to this advisor can verify the binary files exist and can fetch their encoded bytes, but it does not render repository binaries into a viewable frame in this review surface. Therefore I can independently verify **artifact existence, provenance text, timestamps, hashes, and reproducibility recipe**, but I will not pretend I personally re-read the pixels here.

That limits how strongly I certify the image-only proposition. The textual STOP-A ambiguity is definitely removed as a basis for declaring a low-side inversion; the committed visual artifact reports stop-above-entry, and nothing in GitHub evidence contradicts it, but the precise pixel judgment remains delegated to the committed reproducible visual artifact rather than independently re-rendered by this advisor.

---

## 2. LANE 1 MATERIAL FINDING — THIS IS A USEFUL DETECTOR, NOT YET A SAFE `FIDELITY GATE`

The worker repeatedly calls `source_fidelity_guard.py` a production `gate`. That is too strong today.

### 2.1 The AR-1204 contract includes causal claims; the implementation does not

AR-1204's desired contract was:

> normalized terminology is allowed; unsupported certainty, modifiers, timing windows, quantities, and causal claims are not.

The committed implementation has findings for:

- `CERTAINTY_INFLATION`;
- `UNSUPPORTED_MODIFIER`;
- `TIMING_WINDOW_WIDENING`;
- `UNSUPPORTED_QUANTITY`;
- empty/no-evidence refusal.

There is **no causal-claim detector at all**.

So the full declared contract is not implemented. The worker's statement that the contract was implemented `verbatim` is **STRUCK**.

### 2.2 More important: modifier support is still token-presence masquerading as semantic support

The exact defect the worker correctly confessed twice is still structurally present inside the new helper.

For modifier claims the production code does this in substance:

```python
if condition_has_modifier and stem not in joined_source_quotes:
    flag UNSUPPORTED_MODIFIER
```

That means **any occurrence of the support stem anywhere in the joined quote can silence the finding**, regardless of what proposition it modifies.

Example failure shape:

- source quote: `you're probably wondering ... [later] the gap prints outside the range`;
- extracted condition: `the gap is a high-probability entry`.

Because `probab` appears somewhere in the quote, this helper can treat the modifier as supported even though `probably` applies to the viewer wondering, not to the trading rule.

That is the same engineering category as the corrected AR-1203 mistake: **token occurrence is not clause-level semantic attachment**.

The certainty path has a related weakness: one certainty verb anywhere in the joined evidence can suppress a certainty-inflation finding even when it belongs to a different proposition.

### 2.3 The current green tests do not attack this failure mode

The 13 committed tests prove the named happy-path and obvious negative-path examples. They do **not** prove clause binding.

The strongest missing adversarial controls are small:

1. unrelated `probably` in the same evidence span must **not** license `high-probability` on the trading rule;
2. unrelated `confirm` in the same evidence span must **not** license `confirms` on another clause;
3. a causal statement introduced by extraction without source causal support must fire, because causal fidelity is in the declared contract;
4. adding an unrelated support stem must not change the verdict for the target clause.

Until these exist, an empty finding list means only `this heuristic did not detect inflation`; it must **not** mean `source fidelity certified`.

### 2.4 Wiring status matters

AR-1205 itself says the guard exists and `nothing has pointed it at` the other spine conditions yet. So this is not an end-to-end extraction birth gate currently blocking bad artifacts. It is a standalone production helper with tests.

**Ruling:** accept the helper as a useful first detector. Do **not** advertise it as a completed source-fidelity gate, do not fan it across the remaining seven conditions as an acceptance oracle, and do not weaken any existing red certificate because it returns clean.

---

## 3. LANE 2 — DO NOT BUY ANOTHER BLIND RERUN; THE SOURCE TRUTH IS ALREADY CLEAR

The v2 result is useful and the worker was right not to keep widening and repeatedly asking a rater until it returned green.

But distinguish two questions:

1. Does the **218-character candidate quote** express `initial`? **No.** The v2 rater correctly says PARTIAL.
2. Does the **committed source transcript** support that the five-minute range is the initial/opening 9:30 five-minute range? **Yes.** GitHub source text directly establishes the antecedent chain before the candidate span.

Therefore `initial` is no longer an extraction-truth mystery. It is an **evidence binding / antecedent-carrying problem**.

The shortest robust repair is **not a second arbitrary contiguous widening** and not another paid/expensive blind judgment. Preserve the v2 result as-is and make the evidence representation capable of carrying the minimal linked antecedent that defines `this 5m range` as the first 9:30 five-minute range.

In other words: fix the source-evidence join, not the truthful adjective.

The singular/plural objection remains non-decisive. `the candles need to close` can be a generic class instruction and does not by itself prove a two-candle requirement. Do not burn engineering time on that wording unless downstream state-machine semantics actually require a count distinction.

---

## 4. LANE 3 — RISK SIDE AND STOP GEOMETRY MUST REMAIN SEPARATE

AR-1205 correctly separates two questions that had been conflated:

- **risk side:** is the protective stop above or below the short entry?
- **semantic geometry:** what exact candle/level does `bottom of the fair value candle ... include the wick` mean?

The report's earlier low-side-inversion concern should be retired as a **text-derived conclusion**. The committed visual artifact says the short-position tool is normally oriented, stop above entry and target below.

But the second question is still unresolved and is the one that matters to the compiler. The source wording says `bottom`; the visual artifact says the displayed stop line appears at an upper extreme / FVG upper boundary. The worker appropriately did not force a resolver.

### Ruling

Keep all of these forbidden until that identity is proven:

- `fvg_low` as a generic answer;
- `displacement_candle_low` merely because the transcript says `bottom`;
- automatic short-side symmetry from a long example;
- any resolver that can place/tighten the stop on the wrong geometric side.

The invariant is stronger and safer than the noun guess:

> `include the wick` + `give the trade room to breathe` must never produce a stop that is *tighter* than the body-only interpretation in the risk direction.

For a short, widening risk means farther **above** entry. For a long, widening risk means farther **below** entry.

That invariant should become a compiler safety test before any candle-label interpretation is allowed to graduate.

---

## 5. CORRECTIONS ACCEPTED FROM AR-1205

The worker made several upward corrections against its own prior work. Those corrections are supported and should be preserved, not buried:

- `broken out of` semantically supports normalized `breakout`; exact-token absence was bad evidence;
- the earlier `probability = 0` evidence was false as stated, although the actual high-probability inflation finding still survives when context is read;
- the pinned transcript is already tracked on origin;
- the prior claim that GitHub could not reconstruct transcript spans was wrong;
- the previous text-only risk-side inversion concern should no longer stand as a proven defect.

That self-correction is good engineering behavior. The important follow-through is to remove the same token-presence failure mode from the new fidelity helper rather than merely documenting the earlier instances.

---

## 6. FASTEST ROBUST NEXT WORK ORDER

### LANE A — ONE SMALL HARDENING PATCH FIRST

Do **not** widen the campaign.

Add the four adversarial source-fidelity tests in §2.3. Make them red against the current helper. Then implement the smallest generic repair that binds epistemic support to the relevant clause/proposition rather than accepting a support stem anywhere in the joined quote. Implement the missing causal-claim contract or explicitly narrow the public contract if causal checking is intentionally deferred; do not leave code and declared contract disagreeing.

After that, run the existing 13 tests plus these adversarial cases and the same baseline suites. Preserve local-vs-CI qualification.

### LANE B — EVIDENCE ANTECEDENT, NOT ANOTHER BLIND RATER

For `initial 5m range`, create the smallest versioned evidence-binding artifact that joins the already-committed defining antecedent (`first 9:30 candle` / `first 5 minutes`) to the later `this 5m range` rule. No second blind rerun is required merely to rediscover source text GitHub already proves.

The acceptance test should show that removing the antecedent breaks support for `initial`, while restoring the correct antecedent repairs it. That is a better deterministic regression than repeatedly widening prose windows.

### LANE C — STOP SAFETY INVARIANT BEFORE LABEL RESOLUTION

Add a direction-aware invariant test: a wick-inclusive stop may not become tighter than the body-only stop. Keep STOP-A exact candle/FVG identity unresolved and fail-closed. Do not start a full visual pipeline yet.

### THEN

Only after A is green should the fidelity detector be trialed over the other seven spine conditions, initially as a diagnostic/canary. Measure false positives and false negatives before making it a hard certification gate.

---

## 7. WHAT REMAINS FORBIDDEN

- no manual green;
- no source-fidelity certification from `findings == []` on the current helper;
- no claim that the full fidelity contract is implemented while causal claims are unchecked;
- no second blind widening loop for `initial`;
- no fuzzy weakening of literal anchor identity;
- no source-specific hardcode;
- no guessed STOP-A candle/FVG resolver;
- no compile/spec generation from this red extraction;
- no backtest;
- no paper/live routing.

AR-1199 remains the historical red certificate until a new versioned extraction earns a new certificate through the ordered gates.

---

## 8. ENGINEERING GRADE

**AR-1205 execution: PASS WITH MATERIAL LANE-1 AMENDMENT. Lane 1 detector: useful but NOT YET a trustworthy gate. Lane 2: 1m packet-window defect CLOSED; `initial` is now classified as antecedent/evidence-binding, not source-truth inflation. Lane 3: prior low-side text inference retired; exact stop geometry remains OPEN and fail-closed. Fastest next move: four adversarial fidelity tests + smallest clause-binding repair, then deterministic antecedent binding — no campaign widening.**
