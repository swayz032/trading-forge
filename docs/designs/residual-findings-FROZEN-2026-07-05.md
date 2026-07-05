# Residual Findings — Problem B FULLY CHARACTERIZED (frozen 2026-07-05)

**Frozen per GPT's sequence (freeze residual findings before the extractor redesign).** The residual probe
(pre-registered `residual-probe-2concepts-2026-07-05.md`, output `docs/replay-results/residual-probe-2026-07-05.json`)
resolved the 6 remaining dead strategies. **They die from two DIFFERENT, unrelated mechanisms — and one is a
second, previously-unseen extraction defect.** Every dead strategy in the corpus is now explained.

## The corpus collapse — now fully decomposed
| Failure mode | What | Where | Fix path |
|---|---|---|---|
| **A — Context over-specification** (SOLVED) | Junk (scene-setting/narrative/UI/strawman) mis-typed as HARD spine gates → over-conjoined AND can't fire | extraction role-assignment (too much → spine) | demotion (proven: 9/15 revived) → extractor fix Track #24 |
| **B1 — Role UNDER-assignment** (NEW) | The MIRROR of A: the REAL entry conditions were all assigned `confluence` (soft), leaving the spine EMPTY (`conjunction_depth==0` in ALL arms) with only one unbindable `WAIT_SESSION:"timeframe selection"` (DRI ALTERNATIVE) → no executable gate → vacuous/no signal | extraction role-assignment (too little → spine) | extractor fix Track #24 must be BIDIRECTIONAL |
| **B2 — Temporal / representation limit** (NEW, Layer-2) | The concept is a 3-phase state machine; the instantaneous-AND spine ANDs complementary bearish+bullish EMA conditions onto ONE bar (`joint_rate == 0.0` exactly, verified all 3 instances) and has no memory of the specific hammer's high | execution-model architecture, NOT extraction | a NEW phase — stateful/sequential execution semantics |

## Verified evidence (independent re-check)
- **B1 `5m_minute_support_level` ×3 → `EXTRACTION_ROLE_ASSIGNMENT_DEFECT`:** spine EMPTY in all 6 demotion arms incl. baseline; sole spine condition is an unbindable ALTERNATIVE (`WAIT_SESSION:"timeframe selection"` — no `SESSION_KEYWORDS` match); every genuine transcript concept (zone location, TF hierarchy, rejection-confirmation, FVG, TP) was role-assigned `confluence` at Band B extraction, never `spine`. The lone n=1 bar-0 "signal" is an empty-AND vacuous-true artifact, not a real entry. **`struct_all` cannot act — there is no DRI-classified spine content to demote.** A 5th taxonomy class, UPSTREAM of DRI classification.
- **B2 `hammer_candle_long_side` ×3 → `TEMPORAL_INTERACTION` (primary) + `REPRESENTATION_LIMIT` (secondary):** 12 genuine `JUSTIFIED_MANDATORY` conditions survive `struct_all` (depth 12, transcript-confirmed) but collapse to 4 executable arrays. `WAIT_BIAS:"sharp red move downward"` (bearish, fast<slow) and `"bullish reversal"` (bullish, fast>slow) are exact logical complements of the same same-bar EMA comparison → individual rates 0.476/0.524, **`joint_rate == 0.0` exactly (verified, all 3 instances)** — structurally impossible, not rare. The concept needs: a bearish move EARLIER → a hammer OUTSIDE the box within 60-90min → break of THAT hammer's own high (a session-anchored level carried across bars). The instantaneous-AND spine cannot express sequencing or level-memory. **No demotion fixes this.**

## Pre-registration honesty
The 4-outcome table did NOT cleanly fit: B1 is a 5th class (role-assignment gap upstream of DRI — the probe
flagged it rather than force-fitting `RESIDUAL_DRI_INFLATION`); B2 matched rows 3+4 (temporal + representation).
`same_condition_blocks_all_six = False` — genuinely two mechanisms, not one.

## What this hands the next work
1. **Track #24 (extractor fix) is now BIDIRECTIONAL** — the role classifier must fix BOTH over-promotion
   (context→spine, Problem A) AND under-assignment (real gates→confluence, Problem B1). The context-misclassification
   milestone + this finding together define the full role-classification correction.
2. **A genuinely NEW phase exists (Problem B2 / Layer-2):** the instantaneous-AND spine cannot represent
   multi-phase state machines (sequence + level-memory). This is an EXECUTION-MODEL architecture limit, not an
   extraction bug — a separate, later track. It is the first hard evidence that GPT's "constraint interaction
   semantics" layer is real and necessary for a class of educator strategies.

**Every dead strategy in the corpus is now mechanistically explained.** The causal model is complete.
