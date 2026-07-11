# Corpus v3 — Classifier Iteration (Pass 2 of 2) — DRAFT DESIGN, 2026-07-06

**Status:** DRAFT — designed in parallel with the independent Gate 1′ rater, NOT to be built until the rater
confirms the diagnosis (misses = classifier errors). If the rater FLIPS either disposition, this design's input
changes. Iteration budget: this is **pass 2 of 2** (a 3rd pass requires new evidence about why the margin is hard,
not another targeted rule).

## Diagnosis this addresses (PROVISIONAL pending independent rater)
The classifier OVER-CONTEXTUALIZES: on `snNkQSyWX4k` it moved the literal entry trigger ("candles retest the
averages → *that is our signal to sell*") and the consolidation avoid-rule to `context`, producing 0 spine → the
strategy didn't gate → missed revival on MNQ/MCL. Gate 1's finding was the classifier is human-equivalent (~67%)
on the margin; this is a specific place it errs — demoting genuine entry gates.

## The fix (mechanistic, NOT curve-fit to snNkQSyWX4k)
Strengthen `classifyGateStrength`'s deterministic layer so **entry-trigger / "wait-for → signal/enter" conditions
resolve to `mandatory` (→ spine), not `contextual`**. Candidate signal: a `WAIT_CONFIRMATION`/`WAIT_RETEST` (or the
condition whose object carries "retest…→ signal/entry", "wait for X then enter", "our signal is…") is a GATE, not
scene-setting. The rule must be authored to generalize, not to move two known pairs.

## HARD DISCIPLINE (Fable-5, locked before any code)
1. **Derive the pattern from the RULES-DESIGN 143 set** — characterize the gate-vs-context language on the
   entry-trigger conditions IN THE 143, NOT from snNkQSyWX4k. snNkQSyWX4k is held-out-adjacent; tuning to it is
   memorization.
2. **Validate on the HELD-OUT 70 BEFORE any Gate 3 re-run** — two pre-registered checks:
   - (a) **held-out margin agreement improves OR holds** (must not regress the classifier elsewhere). Report the
     stratified agreement (rule-covered vs margin) exactly as Gate 1 did.
   - (b) **rule-coverage overfit ratio stays sane** (current 2.00× design-vs-held-out; the new rule must not worsen
     it materially — a rule that only fires on the 2 misses will spike the ratio → REJECTED as memorization).
   - A fix that moves ONLY the 2 known misses and doesn't improve/hold held-out margin agreement is memorization
     wearing a rule's clothes → do not proceed to Gate 3.
3. **Gate 3 re-run = SINGLE-SHOT** vs the certified **N=9** (frozen ≥8/9 + zero unexplained regressions; the
   jlShztsY3oA deaths count explained ONLY if the independent rater upheld them). Same validity-before-verdict read
   order (validity block first, then verdict, both re-verified independently).
   - **PRE-COMMIT:** if the iterated classifier returns 7/9 with a DIFFERENT miss pattern → NOT another iteration →
     evidence the ~67% margin ceiling binds at the strategy level → the path-forward REOPENS honestly (gold quality
     / demotion-through-full-cert / architecture question), NOT a pass-3 targeted rule.

## Blocked-on / order
1. Independent blind rater confirms misses = errors (+ regressions = corrections). If FLIP → revise this design.
2. Build the rule against the 143; run the held-out margin + overfit checks. Gate on (a)+(b).
3. Single-shot Gate 3 vs N=9 on the fixed classifier's re-emitted v3-shadow specs (fixed-atom, same manifest,
   fixed engine). Re-verify independently; apply ≥8/9.

## Scope note
Classifier (`gate-strength.ts`) + its held-out validation only. No engine/spec/role/harness changes beyond
re-emitting the affected v3-shadow specs. Path-parity remains satisfied by construction (async classifier throughout).
