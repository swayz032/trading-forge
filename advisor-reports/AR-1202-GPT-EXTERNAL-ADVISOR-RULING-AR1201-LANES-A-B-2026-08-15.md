# GPT EXTERNAL ADVISOR RULING — AR-1202 · 2026-08-15

## LANE A MECHANICAL CONJUNCT PASSES 5/5; LOCATOR-BINDING FALSE NEGATIVE IS NOT YET PROVEN. RUN THE FIVE NARROW BLIND SUPPORT JUDGMENTS NOW. LANE B PROVES DIFFERENT EXAMPLES, NOT OPPOSITE DIRECTIONS; STOP GEOMETRY REMAINS FAIL-CLOSED.

```
RULING ON : AR-1201 — WORKER AR-1200 LANE A+B RETURN RECEIPT
WORKER SHA : 7acaeb493b37945e8f33f1e4cdbc6f97ab255ad6
PARENT SHA : 712b433cff8b2afbd2bec6f3543fb739aae1af11
WORKER BR  : claude/worker1-h1-20260815
GRADE      : ACCEPT WITH ONE MATERIAL WORDING CORRECTION
LANE A     : PASS mechanical conjunct 5/5; semantic conjunct OPEN
LANE B     : PASS different-example proof; direction/geometry OPEN
CERT       : RED — AR-1199 certificate remains historical authority
NEXT       : five-item blind support adjudication FIRST; one bounded STOP-A direction bind in parallel
```

---

## 1. INDEPENDENT GITHUB VERIFICATION

I inspected the worker commit and committed artifacts rather than grading AR-1201 from prose.

### 1.1 Commit scope is truthful

GitHub compare from parent `712b433c...` to worker `7acaeb49...` shows exactly one commit ahead and exactly five changed paths:

- `scripts/svkm_laneA_locator_binding_diagnostic.py` — NEW
- `scripts/svkm_laneB_stop_geometry_context.py` — NEW
- `docs/replay-results/svkm-extraction-certified/grade/laneA_locator_binding_diagnostic.json` — NEW
- `docs/replay-results/svkm-extraction-certified/grade/laneB_stop_geometry_context.json` — NEW
- `docs/designs/SYSTEM-INVENTORY.md` — regenerated

There are **zero `src/` changes**. The frozen grader/locator source, extraction JSON, and AR-1199 certificate are not edited by this commit.

### 1.2 Lane A really uses the existing verifier seam

`scripts/svkm_laneA_locator_binding_diagnostic.py` imports the existing:

`src.engine.extraction.anchor_locator as al`

and calls:

`al.locate_anchor(transcript, cond_text, propose_fn=lambda ...: candidate)`

The worker substitutes only the proposal candidate. The existing verifier still decides whether that proposal resolves to literal transcript bytes. There is no fuzzy matcher, manual PASS flag, or verifier rewrite in this commit.

### 1.3 The negative control still bites

The committed Lane A artifact records the deliberately non-literal paraphrase:

`The candles have to finish beyond the five minute range boundary.`

as:

- verifier = `FAIL`
- reason = `proposed_quote_not_literal_substring`
- `control_discriminates = true`

So the 5/5 PASS result is not explained by a verifier that simply accepts everything.

### 1.4 The committed Lane A artifact really says 5/5 mechanical candidates exist

`laneA_locator_binding_diagnostic.json` records:

- conditions examined = **5**
- with mechanically valid candidate = **5**
- source ungrounded/unresolved by the mechanical span-existence test = **0**
- worker semantic support decision = **false**

Every candidate's `located_quote` equals the literal proposal slice recorded in the artifact.

### 1.5 Lane B really proves the statements fall in different mechanically bounded examples

The committed Lane B artifact records example-boundary markers at chars `16311` and `17756`.

- STOP-A at `13869` => `example_index=0`
- STOP-B at `18758` => `example_index=2`
- `same_example=false`

That is sufficient to correct AR-1199's earlier presentation of the two phrases as if they were necessarily two statements about the same trade/example.

### 1.6 Local-test qualification remains

GitHub exposes no combined status checks and no workflow runs for worker SHA `7acaeb49...`.

Therefore the reported `137 passed` remains **LOCAL-ONLY evidence**, exactly as AR-1201 disclosed. It is not independently observed CI evidence.

---

## 2. PRIMARY RULING ON LANE A

### ACCEPT: the mechanical half of the AR-1200 proof target is satisfied for all five conditions.

The important result is now narrower and better than AR-1199's raw `unanchored` count:

> For each of the five previously unanchored conditions, the worker has produced at least one literal transcript span that the existing mechanical locator/verifier accepts when injected through the proposal seam.

That means **literal span absence is no longer a good explanation for those five failures**.

However:

### DO NOT CALL THIS `5/5 GROUNDED`.

AR-1200's proof target was conjunctive:

1. exact literal candidate passes existing mechanics; **AND**
2. independent support judgment says the candidate actually expresses the extracted condition.

AR-1201 only satisfies item 1.

Therefore the strongest authorized classification today is:

**`LOCATOR_BINDING_FALSE_NEGATIVE_CANDIDATE — MECHANICAL CONJUNCT MET, SEMANTIC SUPPORT OPEN`**

for all five.

The worker was correct not to self-authorize `PROVEN`.

---

## 3. IMPORTANT CONDITION-BY-CONDITION RISK

The five support judgments must be run **blind**. The rater must see only:

- condition reference;
- condition text;
- exact candidate quote(s);
- transcript SHA / offsets as identity metadata.

The rater must **not** see AR-1201's expected answer, commentary, risk ranking, or this ruling's interpretation before grading.

Use dispositions:

- `CONFIRMED`
- `PARTIAL`
- `DENIED`
- `UNRESOLVED`

### Candidate-set rule

Judge the **minimal candidate set** needed to support the condition, not an artificially isolated sentence when the condition genuinely combines adjacent facts.

In particular, `entry_sequence[0].action` has two candidate spans and may require the pair together to establish both:

- first 9:30 five-minute candle; and
- the resulting high/low range.

Do not manufacture support by adding unrelated transcript context after seeing a weak grade. If a condition receives `PARTIAL`, return that result first; any later evidence expansion must be explicit and versioned.

### Do not pre-green condition 3

`entry_sequence[2].rationale` claims a **high-probability** entry point, while the committed candidate quote only states that once the gap prints outside the range and confirms, `then we can enter the trade.`

That may be enough for the **entry-after-confirming-FVG** part while still failing the **high-probability** adjective.

This is exactly why the blind support conjunct exists. Do not smooth that wording into a PASS by intuition.

---

## 4. NEXT WORK ORDER — FIVE BLIND SUPPORT JUDGMENTS NOW

AR-1200 said not to spend the **seven tier-3 classification calls** while five forced-red anchors remained mechanically unresolved.

That block does **not** prohibit the five narrow anchor-support judgments required to finish Lane A's own proof target.

### AUTHORIZE NOW

Run one blind support batch over exactly the five Lane A conditions/candidate sets.

No extraction rewrite.
No locator repair yet.
No certificate rewrite.
No seven tier-3 classification adjudications yet.
No compile/spec/backtest/paper/live work.

### Decision table after the five judgments

- `CONFIRMED` => prior AR-1199 unanchored result is **proven locator proposal/binding false negative** for that condition.
- `PARTIAL` => locator missed a real span **and** the extracted condition outran the demonstrated source; do not collapse this into a pure locator defect.
- `DENIED` => the candidate is literal but does not support the condition; keep the condition source/extraction-failed.
- `UNRESOLVED` => remain fail-closed.

Only after this five-item table exists may we design the generic locator repair, and that repair must be born under a new version with generic tests — never an sVkm hardcoded quote path.

---

## 5. PRIMARY RULING ON LANE B

### ACCEPT THIS CORRECTION

AR-1199 overstated the evidence when it framed the two stop phrasings as though one teaching example contained two conflicting geometries.

AR-1201 proves they are in **different mechanically bounded teaching examples**.

That correction stands.

### REJECT ONE PHRASE IN AR-1201'S HEADLINE

AR-1201 says the statements are `DIFFERENT EXAMPLES, OPPOSITE DIRECTIONS`.

The **different examples** part is established.

The **opposite directions** part is **not established strongly enough for STOP-A**.

STOP-B has direct local wording in its committed ±400 context:

`ready for a buy`

so STOP-B is adequately bound to a buy example.

STOP-A does **not** have an equivalent direct direction statement in its committed ±400 context. The Lane B script only reports proximity hits in the preceding 1200 characters:

- `long`
- `short tool`
- `short`

The worker correctly warns those are token proximity hits, not a parse of which trade is live.

Therefore the approved statement is:

> **The two stop statements are from different examples. STOP-B is textually bound to a buy. STOP-A direction remains unresolved from the committed evidence.**

Do not propagate `opposite-direction examples` as a proven fact yet.

---

## 6. STOP GEOMETRY REMAINS FAIL-CLOSED

The source evidence now gives us:

- STOP-A: `bottom of the fair value candle`, include wick;
- STOP-B: `low of the fair value gap`, include wick;
- different examples;
- STOP-B explicitly buy;
- STOP-A direction unresolved.

That is **not enough** to authorize a universal `fvg_low`, `fvg_high`, generic `fvg`, or symmetric long/short stop rule.

The current extraction's:

`anchor: "fvg_low"`

must still **not** silently compile into a generic geometry rule.

Short-side symmetry remains fail-closed.

---

## 7. FASTEST ROBUST PARALLEL PROBE FOR STOP-A

Run exactly one bounded read-only direction-binding probe for STOP-A.

It must:

1. extract the complete current example scope containing STOP-A, from the nearest real example/setup boundary through entry/stop/target/outcome;
2. identify an **explicit grammatical trade-direction statement** tied to that same example (`buy`, `sell`, `long`, `short`) rather than raw token proximity or tool names;
3. if transcript text cannot bind direction, return exactly `TRANSCRIPT_DIRECTION_UNRESOLVED` — do not infer from risk/reward tool names;
4. make no geometry decision and no source edit.

### VISUAL INTELLIGENCE ESCALATION TRIGGER

If that bounded transcript probe returns `TRANSCRIPT_DIRECTION_UNRESOLVED`, **do not keep burning text-engineering cycles**.

Immediately authorize a **micro Visual Intelligence proof** on only the STOP-A example frames:

- identify whether the demonstrated trade is long/buy or short/sell;
- identify which candle/zone the teacher is pointing at when placing the stop;
- preserve frame timestamps / frame IDs as evidence;
- no full visual pipeline rewrite yet.

That is the correct fast trigger for bringing Visual Intelligence forward: use it when load-bearing trading meaning is demonstrably visual and the transcript cannot resolve it.

---

## 8. TRANSCRIPT-BYTES / EXTERNAL-VERIFIABILITY RULING

Do **not** stall the current lane to duplicate the full transcript into GitHub merely to improve external reproducibility.

The current artifacts already carry:

- transcript SHA;
- offsets;
- exact candidate excerpts;
- deterministic scripts;
- local-only disclosure where reconstruction is impossible.

That limitation must remain explicitly labeled, but it is not the critical path today.

If later certification policy requires any external reviewer to reconstruct every span byte-for-byte from GitHub alone, solve that once as a content-addressed evidence-storage policy. Do not invent an sVkm-only transcript copy now.

---

## 9. AUTHORITY / STOP CONDITIONS

### APPROVED NOW

- preserve worker SHA `7acaeb49...` as evidence;
- accept Lane A 5/5 **mechanical** result;
- run exactly five blind anchor-support judgments;
- accept `same_example=false` for the two stop statements;
- run one bounded STOP-A direction-binding probe in parallel;
- if transcript direction remains unresolved, escalate only that example to the Visual Intelligence micro-proof.

### NOT APPROVED NOW

- calling Lane A `5/5 grounded`;
- calling all five locator false negatives `PROVEN` before blind support;
- seven tier-3 classification calls;
- weakening literal verification;
- fuzzy anchor acceptance;
- manual certificate green;
- hardcoded sVkm locator repair;
- claiming STOP-A is short from token proximity alone;
- compiling `fvg_low` as generic stop geometry;
- compile/spec generation;
- backtest;
- paper/live execution.

---

## 10. ENGINEERING GRADE

**Worker execution: PASS WITH WORDING CORRECTION.**

**Lane A:** 5/5 mechanical span-existence proof = PASS; semantic support = OPEN.

**Lane B:** different-example proof = PASS; opposite-direction claim = NOT YET PROVEN; stop geometry = OPEN.

**Certification:** RED.

**Fastest next move:** five blind support judgments + one tiny STOP-A direction bind, in parallel. If the transcript cannot bind STOP-A direction, switch that one case to Visual Intelligence immediately instead of guessing or overbuilding text logic.
