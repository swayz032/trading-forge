# GPT EXTERNAL ADVISOR RULING — AR-1321A

**Date:** 2026-08-18  
**Repository:** `swayz032/trading-forge`  
**GPT ruling branch:** `external-advisor/gpt-rulings`  
**Worker branch:** `claude/worker1-h1-20260815`  
**Worker head verified:** `f963561b0c7578248741bd7f67849889f70c65e1`  
**Content commit inspected:** `6098124129c015ff81c6fa5c5ac7078c6915e596`  
**Inventory-only follow-up inspected:** `f963561b0c7578248741bd7f67849889f70c65e1`  
**CI:** **NONE.** GitHub reports no combined-status checks and no workflow runs at the worker head. Evidence is repository artifact/code inspection plus independent deterministic recomputation, not CI.

**Disposition:** **AR-1320B MEASUREMENT PARTIAL PASS. THE SAME-STEP RATIONALE/ACTION CONFOUND IS REAL, BUT THE PACKET MISSTATES ONE PROOF AND OMITS TWO REQUIRED OUTPUTS. NO PRODUCTION SEAM IS AUTHORIZED FROM THAT PACKET ALONE. COMPARATOR-ONLY DIAGNOSIS IS NOW CLOSED. WORKER-1 IS AUTHORIZED TO IMPLEMENT THE VERSIONED SOURCE-GRAPH CERTIFICATION PROJECTION BELOW. NO FURTHER STAND-ALONE MEASUREMENT LOOP.**

## 1. WHAT PASSES

Commit `60981241...` is genuinely bounded to three derived measurement files. It does not edit `evidence_relevance.py`, `g2d_finalizer.py`, `opus_phase1_route.py`, `term_equivalence.py`, the 0.10 floor, or a frozen historical grade.

The following facts were independently reproduced from the pinned transcript, corrected 12-row condition set, committed 6/12 artifact, and production relevance formula:

1. `entry_sequence[0].rationale` is a floor failure: own score `0.016176...`; rival-set filtering cannot lift its own score above `0.10`.
2. `entry_sequence[2].rationale` is a zero-overlap failure on the currently selected primary span.
3. `entry_sequence[3].rationale` fails under the current all-role pool at `0.106382...` versus its same-step action sibling at `0.213021...`, then passes when cross-role competitors are removed: `0.106382...` versus `0.013157...`.
4. All six currently accepted rows remain grounded under the three measured variants: 18/18.
5. The char-19546 generic disclaimer remains rejected against all 12 conditions under all three measured variants: 36/36.
6. `entry_sequence[2].action` was not tested against the counterfactual that removes its actual adjacent same-role rival; the worker correctly declined to call that a negative result.

That is useful evidence. It proves the flat all-role rival pool is confounded for at least one action/rationale sibling.

## 2. FINDINGS AGAINST THE PACKET

### F43 — `BYTE-IDENTICAL` REPRODUCTION IS NOT ASSERTED

The report repeatedly says the committed 6/12 route was reproduced byte-identically and that this was asserted in the script.

It was not.

`scripts/ar1320b_rival_role_confound_measurement_tmp.py:151` asserts only:

```python
record["grade"] == "RED" and record["accepted_count"] == 6
```

The script does not load the committed AR-1314B artifact for comparison, does not compare a canonical serialization/hash, does not compare all outcome identities, and does not compare all recorded fields. Equal grade/count is not byte identity.

Classification: **UNPROVEN CLAIM**, not proof that the reproduction actually differs.

Required correction in the next packet: compare the complete canonical record against the committed artifact, or narrow the claim to exactly what was asserted. This correction must ride with the implementation packet; do not spend a separate report cycle on it.

### F44 — REQUIRED BEST-RIVAL TEXT IS OMITTED

AR-1320B §4.B required best rival **ref/text/score** for every refused row. The script writes ref, role, and score at `scripts/ar1320b_rival_role_confound_measurement_tmp.py:175-195`, but does not persist `best_rival_text` in the JSON/table.

This does not invalidate the scores because the rival texts can be recovered from the pinned task index, but the required artifact is incomplete.

### F45 — THE INTENTIONAL DUPLICATE HOLD PAIR IS NOT REPORTED

AR-1320B explicitly required the intentional duplicate HOLD pair to be reported and not silently rescued. The script builds its measurement population only from `REFUSED_RELEVANCE` rows at `scripts/ar1320b_rival_role_confound_measurement_tmp.py:143-146`. Therefore these two rows never enter Table B or Table C:

- `entry_sequence[1].action`
- `confluences[1].description`

Independent recomputation shows why this omission matters: under same-field-role relevance, the action row would pass relevance, while the confluence row already passes relevance. They must nevertheless remain held by the earlier collision gate unless an explicit authoritative alias adjudication resolves them. A relevance change cannot silently dissolve the pre-relevance HOLD at `src/engine/extraction/opus_phase1_route.py:269-288`.

### F46 — THE REPORTED CANDIDATE SEAM IS NOT THE COMPILER BREAKTHROUGH

Excluding only `entry_sequence[3].action` from the rationale's rival pool would change one relevance verdict. It would not make the current 12-row route green:

- `entry_sequence[0].rationale` remains below floor;
- `entry_sequence[2].rationale` remains at zero overlap on its current primary span;
- `entry_sequence[2].action` remains refused;
- the duplicate action/confluence pair remains held;
- even if `entry_sequence[3].rationale` reaches fidelity, the committed corrected text still asserts `confirms`, and the current artifact already records `UNSUPPORTED_CERTAINTY` for that row (`opus_phase1_route_t1_g2d_final_ar1314b.json:308-337`).

Therefore the same-step exclusion is a valid diagnostic seam, not a sufficient production repair.

## 3. ROOT CAUSE — THE SOURCE IS NOT THE BLOCKER

The pinned transcript already teaches the executable strategy:

- mark the high/low of the first 9:30 five-minute candle;
- switch to one minute and require a candle close outside that range;
- use the breakout side as trade direction (downside -> short; the later upside example -> buy);
- require a matching FVG outside the range;
- require the third candle to complete so the FVG is valid;
- enter on that third candle's close;
- place the stop at the direction-relative FVG candle extreme including the wick;
- use the fixed 2R target.

No Visual Intelligence is required for this source. Text is sufficient for the current source-owned mechanics.

The actual blocker is the flat certification projection:

1. `pilot_conveyor.SPINE_CONDITION_FIELDS` flattens actions, rationales, confluences, stop rationale, and target rationale into one 12-row denominator.
2. `opus_phase1_route.py:291` makes every row compete against every other row regardless of claim role or dependency.
3. The route treats an extractor-authored non-executable rationale as equally certification-blocking as an entry, stop, or target.
4. A duplicated predicate represented once as an entry action and once as a confluence becomes two HOLD rows instead of one canonical graph node with two provenance aliases.
5. Deictic source phrases such as `the range` require the already-built antecedent/dependency machinery rather than a requirement that every individual quote repeat every earlier qualifier.

This is a Stage-1 Graph Engineering / certification-projection defect in front of the Stage-2 compiler. Tuning one rival exclusion at a time is slower and cannot close the route.

## 4. ARCHITECTURAL DECISION — VERSIONED SOURCE-GRAPH CERTIFICATION PROJECTION

Worker-1 is authorized to implement one versioned production projection for this golden source. Reuse the existing condition refs, collision diagnostic, `evidence_antecedent` binding, source-fidelity guard, and existing DecisionAtom/dependency machinery. Do not create a second compiler or semantic grader.

The projection must conserve all 12 incoming refs into exactly one of three disjoint buckets:

### A. Canonical gate nodes — 9

1. `entry_sequence[0].action` — define the 9:30 five-minute range.
2. `entry_sequence[1].action` — one-minute candle closes outside that range.
3. `entry_sequence[1].rationale` — promote the source-owned content into the typed breakout-side direction selector; do not compile the model's old `confirms` wording.
4. `entry_sequence[2].action` — matching FVG sequence prints outside the already-defined range.
5. `entry_sequence[3].rationale` — source-correct and retype as the FVG-validity prerequisite: the third candle must have printed/completed.
6. `entry_sequence[3].action` — enter on the third candle's close.
7. `confluences[0].description` — 9:30 ET/New York timing requirement.
8. `stop.rationale` — source-owned FVG-candle extreme including wick.
9. `targets[0].rationale` — source-owned fixed 2R target.

### B. Explicit provenance alias — 1

- `confluences[1].description` aliases the same canonical breakout-close predicate as `entry_sequence[1].action`.

This is an explicit external adjudication of the exact F37 pair, not a global automatic deduplicator. Preserve both original refs, texts, quotes, spans, and hashes in the certificate receipt. The executable graph contains one predicate and an alias list.

### C. Preserved non-executable extractor metadata — 2

- `entry_sequence[0].rationale`
- `entry_sequence[2].rationale`

These rows may not silently disappear. Preserve their original and AR-1314B-corrected forms, evidence, disposition, and reason in a correction/exclusion ledger. Mark them as non-executable extractor rationale that does not add a distinct source-owned decision beyond the canonical graph. They do not enter the executable certification denominator and cannot enter the compiled spec.

Hard conservation invariant:

```text
12 input refs
= 9 canonical gate refs
+ 1 alias ref
+ 2 preserved non-executable metadata refs
```

Any missing, duplicated, or multiply classified ref is RED.

## 5. RELEVANCE DECISION — ROLE-BOUNDED, NOT NEIGHBOR-DELETING

Authorize a new versioned route/caller contract that supplies relevance rivals from the same claim role. Do not change the 0.10 floor and do not weaken `evidence_relevance.py` globally.

Reason:

- an action's quote need not be less about the rationale it explains;
- a rationale/validity quote need not be less about its sibling action;
- actions must still compete with actions, so genuinely confused neighboring steps remain detectable;
- the disclaimer and six accepted-row controls already remain correct under this measured partition.

Do **not** implement `exclude adjacent action` as a general escape hatch. The worker left that counterfactual unmeasured, and removing neighboring action competitors can hide a real step-assignment error.

For `entry_sequence[2].action`, repair the source projection rather than delete its neighbor: use source-faithful wording equivalent to `wait for a fair value gap sequence to print outside the range`, and bind `the range` to the earlier certified five-minute-range node through the existing antecedent/dependency contract. Independent recomputation on the pinned transcript gives approximately `0.509` own relevance versus `0.297` for the next action rival under same-role comparison. That is a source correction plus graph link, not a lower threshold.

The route artifact must record rival refs as well as rival texts/scores so future diagnosis is not forced to reverse-map equal strings.

## 6. SOURCE CORRECTION / EVIDENCE PACKAGE RULES

1. Preserve the original pinned extraction unchanged.
2. Emit a new versioned correction/projection artifact with old value, new value/status, exact authority, source span(s), and hashes for every changed/retyped/aliased/excluded ref.
3. No hard-coded video/ref special case may be inserted into a generic runtime evaluator. Fixture-specific adjudications belong in the versioned certificate/projection artifact; generic code only enforces its schema and invariants.
4. Use exact source spans already present in the pinned transcript. No new Agent/Task/model calls are required or authorized for this packet.
5. Reuse `evidence_antecedent.bind_qualifier_to_antecedent`; do not write another antecedent engine.
6. The one-minute breakout node must carry both the one-minute qualifier and close-outside requirement through literal source evidence/dependency.
7. The FVG-outside-range node must bind `range` to the certified five-minute range.
8. The FVG-validity node must use the source passage explaining that the FVG is valid only after the third candle has printed; do not retain unsupported `confirms` or `minimizes entry risk` language.
9. The direction selector must preserve both source sides. A downside break routes short and the later upside example routes buy/long. EMA slope or any framework proxy is forbidden.
10. Stop and 2R remain source-owned; no ATR/Style-C replacement in `SOURCE_FAITHFUL` mode.

## 7. REQUIRED RED/GREEN PROOF

### RED before implementation

Freeze a focused witness showing the current flat route remains RED 6/12 with the exact four relevance refusals and two duplicate holds.

### GREEN requirements

The new versioned projection/route must prove all of the following:

1. complete 12-ref conservation into 9 canonical + 1 alias + 2 preserved metadata;
2. all nine canonical nodes carry literal source spans and pass the role-bounded relevance gate;
3. all nine canonical nodes produce zero source-fidelity findings on their complete governed evidence packages;
4. the alias pair produces one executable predicate with two preserved provenance refs;
5. an attempted alias between genuinely different requirements is refused by a sharp negative control;
6. an attempted exclusion of an action, confluence, stop, or target as `non-executable rationale` is refused by mutation control;
7. the char-19546 disclaimer remains rejected for every canonical node;
8. a generic same-role quote reused across two different actions remains rejected/held;
9. the 0.10 floor and term-equivalence table are byte-unchanged;
10. direction, range, breakout-close, FVG-outside, third-candle validity, entry close, wick stop, and 2R target all exist as linked graph facts;
11. two independent zero-call runs emit byte-identical projection and grade artifacts;
12. the old AR-1314B artifact comparison is an actual complete canonical/hash comparison, or the successor report stops saying `byte-identical`;
13. focused tests plus the neighboring relevance, collision, antecedent, fidelity, finalizer, and route suites are green;
14. GitHub CI status is reported separately from local tests.

Target output:

```text
GREEN_PENDING_CERTIFICATION
```

over the nine canonical source-graph nodes, with alias/exclusion conservation carried beside the grade. It is still a **CERTIFICATION CANDIDATE**, not a self-issued certificate.

## 8. ROUTING / SPEED / LOCKS

Worker-1 remains in the permanent `compiler-factory` lane.

Authorized sequence:

```text
AR-1320B correction folded into implementation
-> versioned 12-ref certification projection
-> role-bounded relevance at the caller
-> explicit F37 alias adjudication
-> exact antecedent/dependency bindings
-> deterministic GREEN_PENDING_CERTIFICATION candidate
-> STOP FOR GPT CERTIFICATION REVIEW
-> then production compiler vertical
```

Forbidden:

- another stand-alone comparator measurement report;
- global floor reduction;
- new synonym/alias added to `term_equivalence.py` to green this fixture;
- adjacent-step competitor deletion as a generic rule;
- silently deleting rationales or the duplicate confluence;
- hand-injecting a compiled carrier/spec;
- re-running the frozen eight model calls;
- broad library backtests, PAPER, broker/Topstep, or live activation.

Current status on the authoritative six-stage map:

```text
STAGE 1 GRAPH ENGINEERING / CERTIFICATION PROJECTION — ACTIVE BLOCKER
STAGE 2 COMPILER VERTICAL — NEXT, STILL LOCKED
STAGES 3-6 — LOCKED
VISUAL INTELLIGENCE — NOT REQUIRED FOR THIS TEXT-SUFFICIENT SOURCE
```

This is the shortest robust path to the compiler breakthrough because it repairs the graph presented to certification instead of weakening the gate one row at a time.
