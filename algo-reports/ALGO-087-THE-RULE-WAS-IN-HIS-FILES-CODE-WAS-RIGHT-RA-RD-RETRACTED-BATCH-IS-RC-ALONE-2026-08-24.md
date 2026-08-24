# ALGO-087 — The operator said "all of this is in my files already" and he is RIGHT: the complete $400 rule — floor, NO blind rollover, processed-rollover — has been held in `trader_fidelity_addendum_2026_08_20.json` since 08-20, and the code implements it exactly. ALGO-076 searched the wrong surface. R-A and R-D are RETRACTED; the batch reduces to R-C alone. The campaign's one live conviction is TIMING.

**Advisor:** Claude (Fable 5), ALGO seat. **Channel head at drafting:** `e9842fd9`.
**Strategy head:** `2a84102a`, untouched. **PR #38: DRAFT / DO NOT MERGE.**
**DECISION: CITATION PINNED (§1) + SEARCH-FAILURE CONFESSED (§2) + R-A RETRACTED (§3) +
R-D RETRACTED (§4) + BATCH = R-C ALONE (§5).**

## 1. The rule, from his files [MEASURED HERE at `2a84102a`]

Operator: *"yes i aim to the next tp but all of this is in ym files already."* Verified:
`research/current_mnq_strategy_v2_4_trader_fidelity_addendum_2026_08_20.json:101-144`
(committed 2026-08-20, **three days before ALGO-076 graded the floor UNCITED**):

- *"$400 or more is safe; under $400 is not safe"* — gauged from the **platform TP
  display** at the frozen 15-MNQ reference (`reference_safe_floor_usd: 400.0`);
- `under_400_immediate_entry: BLOCK`;
- **`no_blind_rollover`**: *"An untouched under-$400 TP1 may not be automatically skipped
  just because a farther TP2 exists"*;
- **`processed_rollover_rule`**: a continuation **earned** at the TP1 area (repeat-test
  momentum · completed-break follow-through · weak-break pullback/15m-bar3) treats that
  reaction as processed and uses the next meaningful destination.

**The shipping code implements this exactly** (single-shot refusal at
`target_policy.py:144` + the `PROCESSED_REACTION_ROLLOVER` path). His chat answer "aim to
the next tp" is the PROCESSED case, consistent with the file. **NO CODE CHANGE. The code
was right the whole time.** The ALGO-086 open question is CLOSED by the file + his answer.

## 2. This desk's search failure, on the record

ALGO-076 wrote "the same search that finds ALGO-004's $517.50 finds nothing for $400" —
**that search ran over the RULINGS branches only.** The rule lived in the research corpus
the whole time. [prior-art-check] re-convicted in its own words: a census is bounded by its
SURFACE; an unstated surface is a wrong denominator. From here, every provenance grade
names the surfaces searched, and the research corpus (spec, addenda, video-evidence,
fidelity-gold) is ALWAYS among them. The operator caught it from memory — twice in one day.

## 3. R-A — RETRACTED PERMANENTLY (not re-scoped)

R-A's structural spent-filter **is blind rollover**: it skips an untouched near destination
because a farther one exists — the exact thing `no_blind_rollover` forbids. Its 18-entry
blast radius (ALGO-084) was not a scoping accident; it was the taught rule pushing back.
The taught version of "spent" is `processed_rollover_rule`, and it is ALREADY IN THE CODE.
The held patch stays held as a record; nothing from it lands, ever.

## 4. R-D — RETRACTED. A held teaching contradicts it.

`current_mnq_strategy_v2_4_video_evidence.md` #7 [MEASURED HERE]: *"Targets remain the
next meaningful reaction/liquidity/**zone** destination, not fixed R."* Cluster and
liquidity destinations are **TAUGHT** members of the target universe — R-D's kind
restriction would have deleted taught semantics on the strength of chat phrasing
("next key zone") read against it. Where two held teachings differ in grain, the SPEC-grade
artifact governs the machine and the chat teaching is its narrative, not its repeal.
**And the deeper point: every "the machine's target ≠ his marked TP" conviction (census S5,
the TPG tables) compared executable targets against replay-marked TPs — that is label
forensics, VOID under ALGO-083.** The target layer has no live conviction against it.
`TARGET_NOT_IN_MAP` remains a valid residual name for honest reporting; it convicts
nothing by itself.

## 5. What remains — and it is one thing

The campaign's one conviction that survives every correction is **TIMING, at day grain**:
the bot spends its bullet 46 min–3 h early at stale machine structure while the teacher
trades fresh zones (census §3, day-level clocks — not label minutiae). The lawful lane is
**R-C alone**: freshness at entry (outside-teachings cited under his vocabulary, ALGO-082),
5m/15m zones only (ALGO-086), taught exceptions (Route D accepted-break retest and the
addendum's processed-continuation stories) enumerated with citations, never silently
exempted.

**ORDERED — the R-C-only batch report** (hypothetical, nothing lands): approved-entry
capture at both pins, all 14 sessions, deltas by key. Pre-registered: (a) 04-14 control's
approved entry SURVIVES; (b) the five convicted early trades REFUSED with freshness
evidence printed; (c) NO target-layer change of any kind; (d) every net addition passes
the ALGO-070 clause walk. **ALGO-088 rules it; it lands whole or not at all; re-exam #3
after.** STOPS unchanged.

LESSON: three retractions in one day trace to one habit — reading a chat sentence as a
complete rule when a fuller, older, spec-grade version already sat in the corpus. The
teacher's files outrank the teacher's shorthand; check the files FIRST, and when he says
"it's in my files," believe him before asking him.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any
decision in this ruling.
