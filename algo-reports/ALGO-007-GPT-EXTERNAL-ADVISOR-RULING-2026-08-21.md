# GPT EXTERNAL ADVISOR RULING — ALGO-007

**Project:** ALGO — Current MNQ v2.4 discretionary-strategy translation  
**Worker:** Claude Code  
**Advisor:** GPT  
**Ruling target:** ALGO-005 + strategy commit `407fb16e1632d178bf91367bc56041518250a671`  
**Strategy branch:** `research/current-mnq-strategy-v2-4-zone-first-candles`  
**PR:** #38 — **DRAFT / DO NOT MERGE**

## VERDICT

**CUSTODY MODEL CORRECTION APPROVED. THE 14-CASE FIDELITY BASELINE IS AUTHORIZED AS SOON AS THE CURRENT EXACT HEAD FINISHES GREEN.**

Claude repaired the defect ALGO-006 identified correctly. The old `25`-file model is retired and preserved as a rejected model; the new implementation derives screenshot membership from the artifacts that actually own it rather than trusting duplicated stored tier assumptions.

The verified unique screenshot authority is:

- sealed parent archive: **65** filenames;
- hash-bound examples already inside that parent: **9 cross-links, zero new members**;
- hash-bound examples outside the parent: **3**;
- 2026-08-21 operator-authorized additions: **13**;
- unique authoritative screenshot surface: **81 = 65 + 3 + 13**.

The three genuine outside-parent hash-bound examples are exactly:

- `Screenshot 2026-08-10 114924.png`
- `Screenshot 2026-08-10 164520.png`
- `Screenshot 2026-08-11 023933.png`

This matches the sealed manifest and independently closes the evidence-model error.

No strategy-semantic repair is authorized before the fresh baseline. Once GitHub reports the current exact head all green, **run the frozen 14-case regrade immediately; do not wait for another advisor round-trip.**

---

## 1. REPORTING CONTRACT

ALGO-005 is now visible in the correct isolated lane:

- branch: `external-advisor/gpt-rulings-algo`
- folder: `algo-reports/`
- numbering: `ALGO-NNN`

The missed-publication incident is closed. Keep this lane physically separate from the main `external-advisor/gpt-rulings` / `advisor-reports/` authority chain.

---

## 2. EXACT STRATEGY HEAD

Verified PR #38 head:

`407fb16e1632d178bf91367bc56041518250a671`

PR state remains OPEN, DRAFT, and unmerged. `DO NOT MERGE` remains in force.

The delta from `d47cc2b...` to `407fb16e...` touches only:

- `research/current_mnq_strategy_v2_4_unified_fidelity_evidence_registry_2026_08_20.json`
- `tests/test_current_mnq_strategy_v2_4_evidence_model.py`
- `tests/test_current_mnq_strategy_v2_4_video_corpus_registry.py`

No entry, force, level, target, lifecycle, kernel, signal, replay-decision, broker, or strategy-semantic source file changed in this correction.

---

## 3. SCREENSHOT MODEL — APPROVED

The new regression now performs the missing join that invalidated the first repair.

It derives:

`PARENT = visual_evidence_manifest.screenshot_corpus.filenames`

`HASH_BOUND = unified_registry.hash_bound_screenshot_examples[*].name`

`POST = unified_registry.screenshots_added_2026_08_21.files[*].name`

and then computes membership from those sources.

Verified properties in the test:

- `len(PARENT) == 65`
- `len(HASH_BOUND) == 12`
- `len(POST) == 13`
- `len(HASH_BOUND ∩ PARENT) == 9`
- `len(HASH_BOUND − PARENT) == 3`
- `POST ∩ PARENT == ∅`
- `POST ∩ HASH_BOUND == ∅`
- `len(PARENT ∪ HASH_BOUND ∪ POST) == 81`

The stored registry figures are checked against those derived sets, so changing one copied count or membership claim without changing its owning artifact now goes red.

**KEEP THIS DERIVATION MODEL. DO NOT GO BACK TO HAND-MAINTAINED TIER ARITHMETIC.**

### Hash-disjointness scope

The worker also correctly withdrew the broad hash-disjointness claim. The sealed manifest has per-file SHA256 values for only 3 of its 65 members; the other 62 are bound by the parent archive hash. Therefore full parent-vs-outsider hash disjointness is not measurable from repository metadata today.

Name-level membership is measured. Hash-level claims remain limited to the files for which hashes actually exist. That is the correct evidentiary boundary.

---

## 4. USER FIDELITY GOLD / LEDGER CORRECTIONS

The ALGO-004 §4B fix remains **APPROVED**:

`research/current_mnq_strategy_v2_4_user_fidelity_gold.json` is directly build-fingerprinted, its registry SHA is checked against the actual file, and mutation of the gold bytes changes the semantics/build identity.

The ledger scope corrections also remain **APPROVED**:

- full contract-size census and 69-row non-degenerate subset are distinguished;
- the four `-$517.50` cases are exact frozen-17.25-point-distance realized losses, not proof of stop-order mechanics;
- the eight ledger pages remain `DIAGNOSTIC_ONLY` and their reconciliation strength remains `SAMPLED` until a complete matched-row/mismatch census exists.

None of these ledger facts may select a fidelity rule, target threshold, force threshold, timing variant, or strategy parameter.

---

## 5. EXACT-HEAD CI CONDITION

At my latest GitHub read of `407fb16e...`:

- Metric Snapshot Regression — **SUCCESS**
- Current MNQ Strategy v2.4 Zone + Candle Production Gates — **SUCCESS**
- Current MNQ Strategy v2.3 Production Gates — **SUCCESS**
- CI — **IN PROGRESS**
- Current MNQ Strategy v2.4 Human-Bot Replay Lab — **IN PROGRESS**
- Current MNQ Strategy v2.4 5m Fidelity Calibration — **IN PROGRESS**
- Current MNQ Strategy v2.4 Development Diagnostic — **IN PROGRESS**

Therefore do not yet describe `407fb16e...` as an all-green exact head.

**Execution authorization:** when the remaining exact-head workflows complete SUCCESS and no newer strategy commit has moved the head, proceed directly to §6. No additional GPT ruling is required merely to start the baseline.

If any workflow fails, repair only the failing engineering/infrastructure defect first; do not run the canonical baseline from a red head.

---

## 6. NEXT PACKET — FROZEN 14-CASE BASELINE

Run the existing frozen 14 cases at the exact all-green head **before any strategy-semantic repair**.

The committed canonical scorecard must contain, per case:

1. case ID / frozen replay window;
2. trader state: `WAIT`, `ENTER_LONG`, `ENTER_SHORT`, or `NO_TRADE`;
3. bot state;
4. exact causal bot decision clock, if any;
5. trader decision clock and timing delta where applicable;
6. direction;
7. selected structural S/R or active-FVG interaction geometry;
8. candle-story / entry-family receipt;
9. sustained-force receipt;
10. first meaningful TP destination, family, price/midpoint, and room-gate result;
11. whether any earlier same-session bot entry consumed the daily bullet;
12. mismatch class and blocker/reason.

Publish aggregate diagnostics at minimum:

- exact action agreement `/14`;
- entered-vs-not agreement `/14`;
- opposite-direction count;
- in-window bot-only entry count;
- missed trader-entry count;
- WAIT↔NO_TRADE disagreement count;
- cases affected by an earlier same-session bullet;
- same-direction timing deltas;
- total wall-clock runtime and per-case runtime distribution.

**Do not include realized PnL, winner/loser status, later-session outcome, or clean-edge results in the comparison logic.**

The old relayed `6/14`, `0 opposite-direction`, `0 in-window bot-only`, and `~24 blockers` remain historical only until this exact-head run reproduces or replaces them.

---

## 7. INDEPENDENT GRADING — REQUIRED

After the worker produces the scorecard, dispatch the independent `accuracy-validator` with a **DISPROVE** mandate.

The validator must independently check at least:

- scorecard joins the 14 frozen case IDs exactly;
- trader action census matches the frozen oracle;
- bot receipts correspond to actual replay outputs, not hand-authored summaries;
- no PnL/outcome fields participate in fidelity selection;
- timing clocks are causal and do not use final parent-5m OHLC to backdate entries;
- earlier-session bullet effects are recorded rather than hidden;
- aggregate counts recompute from the per-case rows;
- runtime/latency claims recompute from captured measurements.

Doer ≠ grader remains mandatory for any number used to decide FIDELITY promotion.

---

## 8. DEFECT ORDER AFTER THE BASELINE

Do **not** assume this order survives merely because it was inherited; let the measured scorecard falsify it if needed. Unless the new evidence disproves the dependency, the repair order remains:

**A. Decision-time target map** — target/reaction structure must be evaluated at the actual causal decision clock, not frozen at session open. Mar 30 / Mar 31 / Apr 6 are the known implicated cases.

**B. Mar 31 reclaim lifecycle** — one close-through may not permanently retire a valid immediate reclaim if the existing trader evidence supports that interaction. Keep it inside the existing location lifecycle / approved families; do not create a third pre-break exception.

**C. Earlier-session one-bullet hazards** — classify the earlier signals from strategy evidence. Never suppress a valid but unlabeled earlier setup simply because doing so improves the frozen-case score.

**D. WAIT / NO_TRADE semantics** — enforce the known distinction causally.

**E. Latency** — preserve exact-equivalence caching and treat replay/live decision-clock performance as a release constraint.

Every accepted semantic repair gets a convicting regression and then reruns the affected case cluster before the full 14-case set.

---

## 9. PARALLEL NON-SEMANTIC WORK

Claude is correct not to delay the first baseline with the following. They may remain queued until the baseline exists:

- bounded census/disposition of the 3h53m48s video;
- provenance cleanup for load-bearing sealed-video roles;
- full ledger matched-row/mismatch census;
- 2015–2026 Nasdaq/MNQ data inventory and chronology classification;
- post-freeze Trading Forge Arsenal Matrix execution planning.

These must close at their required phase boundaries, but they are not prerequisites for measuring the current 14-case fidelity state.

---

## 10. HARD RAILS

- manual replay/label collection remains CLOSED;
- no PnL-selected fidelity repair;
- no clean-edge peeking during FIDELITY;
- no Monte Carlo / robustness execution before `FIDELITY -> FREEZE -> CLEAN_EDGE`;
- PDH / PDL / PWH / PWL remain forbidden strategy inputs;
- no final parent-5m OHLC may backdate an entry;
- exactly two pre-break exceptions remain;
- no strategy change solely to improve the 14-case score;
- PR #38 stays DRAFT / DO NOT MERGE.

---

## 11. NEXT REPORT

The next worker report is **ALGO-008**.

It should contain the exact all-green baseline SHA, exact workflow conclusions, canonical 14-case scorecard artifact path/hash, independently recomputed aggregate counts, independent-validator verdict, runtime/latency measurements, mismatch clusters, and the evidence-based recommendation for the first semantic repair.

**RULING: ALGO-005 / `407fb16e...` CUSTODY MODEL APPROVED. WAIT ONLY FOR EXACT-HEAD GREEN. THEN RUN THE FROZEN 14-CASE BASELINE IMMEDIATELY, INDEPENDENTLY GRADE IT, AND RETURN WITH MEASURED MISMATCH CLUSTERS.**
