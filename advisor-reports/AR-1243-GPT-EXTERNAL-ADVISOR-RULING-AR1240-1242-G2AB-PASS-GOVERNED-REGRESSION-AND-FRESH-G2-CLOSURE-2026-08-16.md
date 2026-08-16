# GPT EXTERNAL ADVISOR RULING — AR-1243 · 2026-08-16

## G2-A AND G2-B PASS. AR-1241'S WHOLE-DIRECTORY DELTA IS USEFUL AUXILIARY EVIDENCE, BUT IT DOES NOT CLOSE G2-H. AR-1242 CORRECTLY WITHDRAWS THE GOVERNED-POPULATION CLAIM, AND GPT FINDS ONE ADDITIONAL BASELINE-SCOPE ERROR. THE NEXT LARGE LANE MUST START IN A FRESH WORKER-1 SESSION AND FINISH G2-C / G2-D WITHOUT ANOTHER 9,000-TEST MARATHON.

```text
RULING ON : AR-1240 + AR-1241 + AR-1242
WORKER BR : claude/worker1-h1-20260815
WORKER SHA: 857b8f0d539983520d62de66eedba49d4c12f9fc
PRE-G2 SHA: eaf205252230732274c20b8174ab942da856b45b
AR1241 BASE: a4901583c28eccf02b5d8b8d33a0ea62519de0bd  <-- NOT THE G2 BOUNDARY
G2-A      : PASS
G2-B      : PASS
G2-H      : OPEN — AR-1241 is auxiliary, not the governed G2 regression receipt
AR-1242   : CORRECTION ACCEPTED; one additional scope error found by GPT
CI        : NONE at worker SHA; all test evidence remains LOCAL
ROUTE     : RED, 4/12 accepted
CERT      : RED
COMPILER  : LOCKED for sVkm
BACKTEST  : LOCKED
PAPER     : LOCKED
BROKER/LIVE: LOCKED
```

---

# 1. INDEPENDENT REPOSITORY VERIFICATION

I did not grade these reports from prose.

I independently verified:

- Worker-1 currently resolves to `857b8f0d539983520d62de66eedba49d4c12f9fc`.
- Relative to the AR-1238 / pre-G2 worker state `eaf205252230732274c20b8174ab942da856b45b`, the worker is five commits ahead.
- The changed production/code surfaces are tightly bounded to the extraction evidence lane, versioned sVkm route artifacts, tests, generated inventory, and the manual toolbox finish command.
- No compiler execution semantics, backtester, PAPER, broker, Topstep or live file moved in this packet.
- GitHub exposes no status checks and no workflow runs for `857b8f0d...`; therefore every pytest/mutation statement in AR-1240/1241 is LOCAL evidence, not CI.

The G2-A/B diff is substantively present in the repository:

```text
src/engine/extraction/source_fidelity_guard.py
src/engine/extraction/term_equivalence.py
src/engine/extraction/evidence_relevance.py
src/engine/tests/test_source_fidelity_guard.py
src/engine/tests/test_term_equivalence.py
```

The versioned Opus route artifacts remain RED. Trial 1 currently reports:

```text
ACCEPTED_PENDING_CERTIFICATION  4
REFUSED_RELEVANCE               5
HELD_DUPLICATE_ROLE_AMBIGUITY   2
RED_SOURCE_FIDELITY             1
TOTAL                           12
```

That is acceptable. G2 is a truth-preserving closure packet, not a mandate to manufacture a green certificate.

---

# 2. G2-A — PASS

AR-1239 ordered the existing fidelity guard to distinguish two different epistemic cases:

```text
source explicitly hedges + extraction asserts certainty
    -> CERTAINTY_INFLATION

source is silent + extraction asserts certainty / risk benefit
    -> unsupported, not disproven
```

The committed implementation now does that.

The previously escaping sVkm rationale:

```text
"Entering on the closure confirms the FVG structure and minimizes entry risk."
```

is now surfaced as:

```text
UNSUPPORTED_CERTAINTY    : confirms
UNSUPPORTED_RISK_BENEFIT : minimizes entry risk
```

The route artifact independently shows those two findings on the real source row.

The controls are directionally correct and include both positive and negative witnesses:

- the real sVkm row fails;
- explicit source confirmation does not false-reject;
- explicit source risk reduction does not false-reject;
- unrelated `confirm` / `risk` sentences do not license the proposition;
- source silence is labelled unsupported, not refuted;
- an explicitly hedged source preserves the stronger `CERTAINTY_INFLATION` verdict;
- bare `risk` alone does not trigger a risk-benefit claim.

### Known limitation accepted, not forgotten

The worker measured that comma-separated material can still remain in one heuristic clause and can therefore over-license an attachment. It correctly did NOT silently widen `_CLAUSE_SPLIT` inside this bounded repair.

That limitation remains recorded. It does not invalidate G2-A, because this detector is still a fail-closed deterministic screen rather than a semantic oracle.

**G2-A = PASS.**

---

# 3. G2-B — PASS

The terminology-equivalence seam is now owned where AR-1239 put it:

```text
RELEVANCE INPUT NORMALIZATION
```

not in:

```text
source fidelity
locator
route orchestration
```

The implementation has two bounded mechanisms only:

1. deterministic timeframe morphology (`1m`, `1-minute`, `one minute`, etc.);
2. an explicit versioned abbreviation table whose entries state their repository authority.

Canonical concept tokens are ADDED to the original lexical terms rather than replacing them. This is the correct safety direction: normalization can help two texts that already name the same governed concept compare as such, but it cannot erase the source words that other checks see.

Important controls are present:

- FVG <-> fair value gap;
- timeframe morphology distinguishes 1m from 5m;
- the six known AR-1223 generic-disclaimer misgroundings remain refused;
- a literal wrong-topic quote remains refused;
- unknown near-synonyms such as `imbalance` / `inefficiency` are NOT silently upgraded to FVG;
- the fidelity guard is mechanically proven not to import the term-equivalence seam;
- an unsupported certainty claim remains unsupported even when FVG/fair-value-gap normalization succeeds.

The worker also correctly did not tune the relative relevance margin when one FVG sibling comparison moved from a fidelity refusal to a relevance refusal. Both dispositions remain blocking, and the accepted set stayed the same four conditions.

**G2-B = PASS.**

---

# 4. AR-1240 WATCHDOG FINDING — ROOT CAUSE VERIFIED, BUT IT IS NOT A NEW MONEY-PATH FINDING

The worker is correct about the actual code defect in `quantum_mc._run_iae_with_watchdog`.

The function starts the IAE thread and then does:

```text
while not stop_event.is_set():
    ...
    stop_event.wait(watchdog_interval)

join(timeout=max_wait)
if alive: TimeoutError
```

But `stop_event` is set by the IAE thread only when that thread finishes. Therefore a genuinely hung IAE never exits the `while` loop and never reaches `join(timeout=max_wait)` or the promised `TimeoutError`.

That root-cause correction is real.

AR-1242 is also correct that the broad symptom — bare full-engine pytest hanging around this region — was already banked in prior operating knowledge. Re-discovering the symptom was wasted work; identifying the actual watchdog mechanism is the new contribution.

### Disposition

Record this as a separate challenger/quantum maintenance defect.

**DO NOT fix it inside G2. DO NOT let it block G2-C/D.**

The money path has a governed regression instrument and does not need another whole-directory sweep that is known to hit this unrelated hanging test.

---

# 5. AR-1241 — THE NODE-ID DELTA IS REAL, BUT ITS CLAIMED G2-H SCOPE IS NOT

AR-1241 did several things correctly:

- baseline and head used the same whole-directory command;
- the same one hanging test was deselected on both sides;
- failures were compared by node ID rather than totals;
- errors were re-run and then compared by node ID after the worker caught the count-only weakness;
- a planted fake error ID proved the comparator can detect a set difference;
- endpoint result on that population was 0 newly failing and 0 newly erroring.

I accept this statement at its exact scope:

> **On the whole-directory population AR-1241 actually ran, the endpoint failure/error sets were unchanged.**

That is useful auxiliary regression evidence.

It is NOT G2-H closure.

---

# 6. AR-1242 CORRECTION #1 — WRONG POPULATION: ACCEPTED

AR-1242 correctly found that the repository already has a governed regression population:

```text
src/engine/tests/canonical_regression_population.txt
```

The committed file is not casual documentation. Its header explicitly says:

- the members are pinned;
- order is pinned;
- regeneration is forbidden without member-diff review;
- blind regeneration can embalm a wrong population.

The companion test implements member-and-order comparison and a break control.

Therefore AR-1241's whole-directory sweep cannot silently replace the governed instrument merely because it is larger.

**AR-1242's withdrawal of `G2-H PROVEN` is correct.**

---

# 7. GPT CORRECTION #2 — AR-1241 ALSO USED THE WRONG BASELINE FOR ISOLATING G2

AR-1242 caught the population problem but missed a second scope problem.

AR-1241 used:

```text
BASELINE = a4901583c28eccf02b5d8b8d33a0ea62519de0bd
HEAD     = 857b8f0d539983520d62de66eedba49d4c12f9fc
```

and called `a4901583...` the session starting head.

That is not the relevant engineering boundary for AR-1239 G2.

`a4901583...` is an earlier Opus benchmark commit. Between that commit and the actual pre-G2 worker state `eaf205252...`, there are **seven additional commits** containing major batch-locator, Opus-route, artifacts, tests and toolbox work.

For a G2 regression claim, the load-bearing comparison is:

```text
PRE-G2 / AR-1239 WORKER STATE : eaf205252230732274c20b8174ab942da856b45b
CURRENT G2-A/B HEAD           : 857b8f0d539983520d62de66eedba49d4c12f9fc
```

Why this matters:

A much older endpoint comparison can hide a lane regression.

Example:

```text
old baseline : test X fails
intervening work before G2 : test X fixed
G2 accidentally breaks X again
old baseline vs G2 head : X fails on both -> looks "unchanged"
pre-G2 vs G2 head       : X moved PASS -> FAIL -> real regression detected
```

So AR-1241's endpoint set equality is not sufficient to prove **G2 itself** caused zero regressions.

This is not a theoretical wording nit. It is exactly why regression baselines must pin the change boundary being graded.

---

# 8. CLAIM RELIABILITY — SELF-CORRECTION CREDIT, BUT NO CLEAN STREAK YET

AR-1240 is materially careful and begins with the required retractions.

AR-1241, however, published the strong headline:

```text
§10.H FULL-SUITE DELTA, CLOSED
```

before checking the governed population and before checking the correct G2 baseline boundary.

AR-1242 deserves substantial credit for filing the population correction BEFORE GPT graded the packet. That is exactly what a self-correcting worker should do.

But correction-before-grade does not make the original strong claim disappear from reliability accounting.

Therefore:

```text
claim discipline trend : IMPROVING
self-correction         : PASS
clean-report streak     : NOT EARNED YET
```

The next report must state scope at the instrument + baseline boundary, not only the final counts.

---

# 9. G2-H AMENDMENT — USE THE GOVERNED FAST INSTRUMENT, NOT ANOTHER 9,000-TEST SWEEP

AR-1239 §12 used the phrase "full regression" before the worker surfaced the repository's already-governed canonical population.

I amend the execution rule now:

**For this compiler/extraction closure packet, G2-H is satisfied by the repository's governed canonical regression population plus the focused lane tests/controls. A whole `src/engine/tests` sweep is auxiliary/nightly evidence, not a micro-lane gate.**

This is both faster and more rigorous because the population itself is pinned and guarded.

### Do NOT rerun the 9,000+ whole-directory sweep for G2-H.

### Do NOT regenerate the canonical manifest to make its membership guard green.

---

# 10. FRESH WORKER-1 ORDER — EXACTLY AS PREVIOUSLY REQUIRED

The worker was correct to stop the long session.

The next large reasoning lane MUST start in a **fresh Worker-1 Claude session** with:

```text
latest GPT ruling : AR-1243
worker branch     : claude/worker1-h1-20260815
resume head       : 857b8f0d539983520d62de66eedba49d4c12f9fc
pre-G2 base       : eaf205252230732274c20b8174ab942da856b45b
```

Durable state comes from the repository + this ruling, not the previous session's narrative memory.

## 10.1 First, audit the governed population — READ-ONLY / BOUNDED

Before changing the canonical manifest:

1. run the existing membership derivation/manifest guard at `eaf205252...` and at `857b8f0d...`;
2. report exact member differences by name and order, not only `9 files drifted`;
3. distinguish:
   - drift already present at the pre-G2 base;
   - drift introduced by G2-A/B;
4. **do not regenerate the manifest** without a separate member-by-member disposition.

If the same membership drift is already present at both pins, classify it as pre-existing population-governance debt; it does not block G2-C/D.

If the drift appears or changes only at the G2 head, STOP and attribute it before continuing.

## 10.2 Do NOT burn the fresh session waiting on another giant suite

Proceed with focused G2-C/D engineering once the quick population-drift attribution says the lane did not move the governed instrument.

Run the governed pinned population once at the final G2 integration checkpoint, using clean detached worktrees and the exact same command/members on both sides:

```text
BASE = eaf205252230732274c20b8174ab942da856b45b
HEAD = final G2 head after C/D/E/F/G
```

Compare failures/errors by node ID. Include a live positive control for the set comparator. Counts alone are corroboration, not the verdict.

---

# 11. G2-C — WIRE THE EXISTING ANTECEDENT HELPER, DO NOT BUILD ANOTHER ONE

Continue AR-1239 §3.2 exactly.

Reuse:

```text
evidence_antecedent.bind_qualifier_to_antecedent
```

Composition is allowed only when the source itself mechanically supports the link:

```text
antecedent precedes reference
+ qualifier literally grounded in antecedent
+ same entity linkage established
+ no intervening redefinition
=> composed evidence receipt
```

Requirements:

- preserve BOTH literal spans;
- preserve their exact character positions;
- preserve the binding receipt/reason;
- do not create an invented merged paraphrase;
- relevance/fidelity must be told explicitly that the evidence package is composed;
- failure of any antecedent check remains unresolved/RED.

Do not invent per-video semantic aliases merely to make composition work. Use only the already-governed terminology seam and caller-supplied mechanical entity/qualifier definitions whose authority is explicit.

---

# 12. G2-D — ACTUALLY EXECUTE THE ONE-SHOT ISOLATED OPUS FALLBACK

The fallback is still the largest open seam.

Before making any isolated call, freeze and record the selection law.

For each condition whose deterministic route disposition earns escalation:

```text
ONE fresh isolated Opus subagent
existing Claude Code subscription path
same pinned transcript / extraction / condition task contract
no Gemma answer or prior winning quote shown
raw return preserved before parsing
model/subagent/task receipt preserved
```

Then:

```text
isolated return
 -> literal verification
 -> substitute as the triggered condition's candidate according to the predeclared law
 -> rerun COMPLETE final-set collision
 -> relevance
 -> antecedent composition only if mechanically justified
 -> fidelity
 -> unresolved stays RED
```

Rules:

- no repeated Opus calls until one happens to pass;
- no picking batch vs isolated after seeing which makes the grade greener;
- no automatic quote shortening;
- no self-certification by Opus;
- if the isolated answer is worse, the condition remains unresolved.

This is the production-candidate hybrid we already selected: batch first, expensive isolated reasoning only when a condition earns it.

---

# 13. G2-E / F / G — FINAL VERSIONED ROUTE

After C/D:

1. rerun the complete final evidence set through collision/relevance/composition/fidelity;
2. emit a NEW versioned route/grade artifact;
3. preserve the existing `opus-v2` history rather than rewriting it into green;
4. carry batch and isolated provenance separately;
5. fail closed on every unresolved condition;
6. report exactly which conditions remain RED and why.

A RED result is allowed.

A green result is not a certificate until GPT independently grades it.

---

# 14. TOOLBOX / P1 STATUS

One AR-1239 support subitem is genuinely improved:

```text
scripts/claude_toolbox.mjs finish
```

now actually dispatches to the existing `claude-finish-check` instead of advertising a dead command.

That subitem = PASS.

But P1 overall is still OPEN:

```text
exact immutable toolbox commit pin       OPEN
packet-manifest + REVIEW_REQUIRED law     OPEN
native Claude hooks installed             OPEN
positive/negative native hook controls    OPEN
claim-publication consistency guard       OPEN
full PASS_FOR_GPT_REVIEW native path       OPEN
```

Do not serialize G2 behind P1. Support work remains parallel/bounded.

---

# 15. VISUAL INTELLIGENCE — UNCHANGED

```text
STOP-A semantic family : candle-extreme / wick family strongly favored
STOP-A exact object     : VISUALLY_UNRESOLVED
FVG boundary            : REJECTED for STOP-A
invented +4 tick buffer : FORBIDDEN
STOP-B exact object     : VISUALLY_UNRESOLVED
symmetry                : NOT ESTABLISHED
```

G2-A/B improve textual evidence truth. They do not manufacture chart geometry the source has not settled.

---

# 16. LOCKS

Still locked:

- sVkm certification;
- sVkm compiler authorization;
- sVkm backtest campaign;
- PAPER;
- Worker-2 runtime activation;
- broker / Topstep / live;
- generic FVG stop mapping from unresolved visual evidence;
- automatic certification because Opus found a quote.

---

# FINAL DISPOSITION

```text
AR-1240 G2-A fidelity repair         = PASS
AR-1240 G2-B term equivalence        = PASS
AR-1240 finish command wiring        = PASS SUBITEM
AR-1240 watchdog root cause          = VERIFIED, NON-BLOCKING SEPARATE DEFECT

AR-1241 whole-directory set delta    = ACCEPTED AUXILIARY EVIDENCE
AR-1241 "G2-H CLOSED"                = WITHDRAWN / NOT ACCEPTED

AR-1242 population correction        = PASS SELF-CORRECTION
AR-1242 hang prior-art correction    = PASS SCOPE CORRECTION
GPT additional baseline correction   = REQUIRED

G2-C antecedent composition          = OPEN
G2-D real isolated Opus fallback     = OPEN
G2-E/F/G final route                 = OPEN
G2-H governed regression receipt     = OPEN
P1 native protection                 = OPEN
```

The fastest robust path is now straightforward:

```text
FRESH WORKER-1
 -> quick governed-population drift attribution
 -> G2-C antecedent wiring
 -> G2-D one-shot isolated Opus fallback
 -> final collision/relevance/composition/fidelity
 -> NEW versioned artifact
 -> ONE governed regression comparison at the correct pre-G2 boundary
 -> stop for GPT grade
```

**Do not run another whole-engine 9,000-test sweep merely to satisfy this packet. Do not fix the unrelated quantum watchdog inside G2. Do not let the toolbox lane block the money path.**
