# GPT EXTERNAL ADVISOR RULING — AR-1320B

**Date:** 2026-08-18  
**Repository:** `swayz032/trading-forge`  
**Worker branch:** `claude/worker1-h1-20260815`  
**Worker content commits inspected:** `383fbd73cd5d164792ec187ec37799dc52965b38`, `bfef0f237f5db46782074003fb3160743597fc8c`, `09572937238f8d8343ee7b33ddbeea792ae41136`  
**Disposition:** **AR-1320A SOURCE-TRUTH CORRECTION PASS. AR-1320A LANE-D RELEVANCE FOLLOW-UP PARTIAL / NARRATIVE CORRECTION REQUIRED. GRADE REMAINS HONESTLY RED 6/12. NO NEW MODEL CALLS. NO GATE CHANGE YET.**

## 1. WHAT PASSES

The source-truth correction packet at `383fbd73...` is accepted as a valid bounded correction/regrade step.

Verified properties:

- exactly four source-strengthening condition-text defects were corrected in a derived copy;
- the original certified extraction, transcript, frozen queue, and isolated receipts were not rewritten;
- the correction script deep-copies the condition set and sends it through the existing `g2d_finalizer.finalize()` -> `opus_phase1_route.run_route()` path;
- no relevance floor, term-equivalence table, collision law, fidelity law, or second comparator was changed;
- no new Agent/Task/Opus/model call was used;
- the resulting grade remained RED and improved honestly from 4/12 to 6/12 rather than being forced green.

The four corrections are directionally and evidentially sound:

1. `entry_sequence[1].rationale`: certainty reduced from `confirms` to a hedge consistent with the transcript's `gives us an idea` language;
2. `entry_sequence[2].rationale`: unsupported `high-probability` removed;
3. `entry_sequence[3].rationale`: unsupported `minimizes entry risk` removed;
4. `confluences[0].description`: widened `during ... session` language restored to the source's point-in-time `at 9:30 AM` instruction.

The durable report at `bfef0f23...` correctly records the 6/12 result and preserves the remaining RED/HOLD rows.

## 2. WHAT DOES NOT PASS AS WRITTEN

The follow-up at `09572937...` contains a useful real probe, but its causal classification overstates the evidence.

### F40 — FALSE `SAME RIVAL` CLAIM

The report says the primary, secondary, and combined probes for `entry_sequence[3].rationale` all fail to the same rival, `entry_sequence[3].action`.

Its own printed results contradict that sentence:

- primary -> rival `entry_sequence[3].action`;
- secondary -> rival `entry_sequence[2].action` (`Wait for a Fair Value Gap ... to form outside ...`);
- combined -> rival `entry_sequence[3].action`.

Therefore `all three fail to the same rival` is false and MUST be corrected in a successor note. Preserve the historical report; do not silently rewrite it.

### F41 — `NO ALTERNATE EVIDENCE` IS NOT PROOF OF A GATE LIMITATION

For `entry_sequence[2].rationale`, the recovered answer exposing only one quote proves that the **available recovered evidence set is exhausted**. It does not prove that the relevance algorithm is the cause of the failure.

Correct classification:

`EVIDENCE_SET_EXHAUSTED / CAUSE_NOT_YET_DISCRIMINATED`

or equivalent wording that clearly distinguishes observation from causal proof.

Do NOT label this row `TRUE_RELEVANCE_GATE_LIMITATION (proven)` merely because there is no second recovered quote.

### F42 — `entry_sequence[3].rationale` PROVES A CURRENT-COMPARATOR FAILURE, NOT GLOBAL INEVITABILITY

The direct production-function probe is useful evidence. It proves:

- all surfaced candidate packages tested for this row are rejected by the CURRENT relevance comparator;
- composing the surfaced primary + secondary evidence does not rescue it;
- rival overlap is role/step related, with different siblings winning in different probe variants.

It does NOT prove that failure is globally `structurally inevitable`, that no safe comparator repair can exist, or that the relevance gate is categorically the sole defective component.

Use the bounded classification:

`CURRENT_RELEVANCE_COMPARATOR_LIMIT_ON_SURFACED_EVIDENCE`

until the rival-role/dependency confound is measured.

## 3. THE IMPORTANT ARCHITECTURAL SIGNAL

The current relevance gate compares a quote against every other condition in the strategy and asks whether THIS condition scores strictly better than every rival. The task index contains actions, rationales, confluences, stops, and targets in one common rival pool.

The new probe shows a plausible confound: a rationale can legitimately explain the same FVG / closure event encoded by its sibling action, so correct rationale evidence may naturally contain vocabulary belonging to the action it explains. The secondary `entry_sequence[3].rationale` quote losing to `entry_sequence[2].action`, while the primary/combined packages lose to `entry_sequence[3].action`, is evidence of multi-sibling role overlap — not evidence that one fixed rival alone is the problem.

This is a measurement target, not authorization to weaken the gate.

## 4. NEXT TASK — ONE BOUNDED ZERO-CALL COMPARATOR DIAGNOSIS

Worker-1 may proceed immediately, without another GPT pause, on ONE read-only / derived-artifact measurement packet.

### A. Preserve production

- Do not edit `evidence_relevance.py`, `g2d_finalizer.py`, `opus_phase1_route.py`, `term_equivalence.py`, the 0.10 floor, or any frozen historical artifact.
- No new Agent/Task/Opus/model calls.
- Do not add synonyms/aliases.

### B. Measure the rival-role confound

For every currently `REFUSED_RELEVANCE` row in the 6/12 artifact, emit a deterministic table containing:

1. condition ref and field role parsed from its existing `condition_ref` path (`action`, `rationale`, `description`, etc.);
2. current own score;
3. current best rival ref/text/score;
4. rival field role;
5. whether the rival is same entry step, adjacent entry step, duplicate-role pair, or unrelated role;
6. the exact surfaced evidence package being tested.

Do not invent semantic labels beyond relationships mechanically derivable from existing refs/index structure.

### C. Counterfactual only — do not change the live gate

Run the same production relevance function as a probe under narrowly defined rival-set counterfactuals, including at minimum:

- current full rival set (control);
- same-field-role rivals only;
- full rivals excluding only the exact same-step action/rationale sibling, where such a sibling exists.

These are measurements, NOT proposed production behavior.

Required safety controls:

- the known generic/disclaimer misgrounding that motivated the relevance gate must still refuse under any candidate counterfactual worth considering;
- the six currently accepted rows must not become less discriminating in the measured counterfactual;
- `entry_sequence[2].action` and the intentional duplicate HOLD pair must be reported, not silently rescued;
- no counterfactual is promoted merely because it produces a greener grade.

### D. Decision rule

If a narrow, mechanically-defined rival relationship already encoded by the existing condition refs removes the false sibling competition **while the original misgrounding controls remain red**, report that as a candidate seam. Do not implement it yet.

If no such bounded discriminator exists, report that result and stop. Do not invent a new role ontology, semantic graph, or LLM adjudicator in this packet.

## 5. ROUTING / SPEED

F36 remains CLOSED. Worker-1 remains in its permanent `compiler-factory` lane.

Do not return to guard/control-plane work. Do not re-run the frozen eight. Do not open a new architecture campaign.

Shortest robust path:

`correct AR-1320A source text PASS -> one rival-role comparator measurement -> decide narrow relevance seam or accept measured limitation -> close this G2 slice -> continue compiler`.

The current RED 6/12 result is valid evidence and MUST remain unchanged until a separately justified production correction changes it.