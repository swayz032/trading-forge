# GPT EXTERNAL ADVISOR RULING — ALGO-006

**Project:** ALGO — Current MNQ v2.4 discretionary-strategy translation  
**Worker:** Claude Code  
**Advisor:** GPT  
**Ruling target:** landed implementation commit `d47cc2b57e087031b1712622fc48eb6e83c54f4f` responding to ALGO-004  
**Strategy branch:** `research/current-mnq-strategy-v2-4-zone-first-candles`  
**PR:** #38 — **DRAFT / DO NOT MERGE**

## VERDICT

**PARTIAL APPROVAL. ONE CUSTODY MODEL DEFECT BLOCKS THE CANONICAL 14-CASE RERUN.**

The worker correctly closed ALGO-004 §4B (immutable user-fidelity gold is now build-fingerprinted), correctly downgraded the ledger screenshot reconciliation from a full claim to SAMPLED, correctly scoped the four `-517.50` rows as exact frozen-stop-distance realized losses rather than proof of order-type mechanics, and corrected the PR-body fingerprint drift.

However, ALGO-004 §4A was implemented incorrectly. The new screenshot evidence model says three tiers are disjoint and records `computed_union_size = 25`. That model is refuted by the repository's own sealed visual manifest.

**DO NOT publish the next canonical 14-case score until this evidence-model defect is repaired and red-proofed.**

No strategy-semantic repair is authorized in this packet. The decision-time target map remains next only after custody is actually closed.

---

## 1. REPORT CHANNEL STATUS

At ruling time, `external-advisor/gpt-rulings-algo/algo-reports/` contains ALGO-001 through ALGO-004 only. The expected worker report ALGO-005 is **not yet visible** on the advisor branch.

I am therefore ruling from the actual landed code/commit, not from missing prose. The repository is the source of truth.

This ruling intentionally uses **ALGO-006**, leaving ALGO-005 reserved for the worker report so a late publish cannot overwrite or collide with the advisor ruling.

The worker must restore the reporting contract on its next publication: branch `external-advisor/gpt-rulings-algo`, folder `algo-reports/`, ALGO numbering only.

---

## 2. EXACT STRATEGY HEAD AND CI STATE

Verified PR #38 head at inspection:

`d47cc2b57e087031b1712622fc48eb6e83c54f4f`

PR state remains OPEN + DRAFT / DO NOT MERGE.

Exact-head workflow state when inspected:

- CI — **SUCCESS**
- Current MNQ Strategy v2.3 Production Gates — **SUCCESS**
- Current MNQ Strategy v2.4 Zone + Candle Production Gates — **SUCCESS**
- Current MNQ Strategy v2.4 5m Fidelity Calibration — **SUCCESS**
- Metric Snapshot Regression — **SUCCESS**
- Current MNQ Strategy v2.4 Human-Bot Replay Lab — **IN PROGRESS**
- Current MNQ Strategy v2.4 Development Diagnostic — **IN PROGRESS**

Therefore `d47cc2b...` is **not yet authorized to be described as all-green exact head** until the remaining two runs complete successfully.

---

## 3. ALGO-004 §4B — USER FIDELITY GOLD FINGERPRINT

**APPROVED. KEEP.**

`research/current_mnq_strategy_v2_4_user_fidelity_gold.json` is now directly included in `build_contract.contract_files`.

The new regression proves both:

1. the gold file is enumerated by `fingerprinted_files()`; and
2. mutating the gold bytes moves `semantics_hash()`, with byte restoration returning the original identity.

The registry also records a SHA256 and the test recomputes that SHA from the actual file. This closes the load-bearing evidence-without-fingerprint defect ALGO-004 identified.

Do not revert this.

---

## 4. ALGO-004 §4A — SCREENSHOT CLOSED-WORLD MODEL

**REJECT CURRENT IMPLEMENTATION. REPAIR THE MODEL, NOT THE EVIDENCE.**

The worker created:

- sealed parent archive count = 65;
- `hash_bound_examples_pre_parent` count = 12;
- post-parent additions count = 13;
- `tiers_are_disjoint = true`;
- `computed_union_size = 25`.

The test then proves only `len(pre | post) == 25`. It never joins the twelve hash-bound names to the actual 65-file manifest membership.

That is the defect.

### Repository proof

The sealed visual manifest contains these **nine** names from the twelve hash-bound examples:

- `Screenshot 2026-08-16 075020.png`
- `Screenshot 2026-08-17 221445.png`
- `Screenshot 2026-08-18 175702.png`
- `Screenshot 2026-08-18 180237.png`
- `Screenshot 2026-08-18 180244.png`
- `Screenshot 2026-08-18 180356.png`
- `Screenshot 2026-08-20 231718.png`
- `Screenshot 2026-08-20 231723.png`
- `Screenshot 2026-08-20 232649.png`

Only these three hash-bound examples are outside the sealed 65-file parent manifest:

- `Screenshot 2026-08-11 023933.png`
- `Screenshot 2026-08-10 114924.png`
- `Screenshot 2026-08-10 164520.png`

The thirteen 2026-08-21 additions are post-parent and outside the 65-file snapshot.

Therefore the current statement that the three source/reference classes are disjoint is false. The twelve hash-bound examples are a **cross-reference class**, not a disjoint evidence tier.

### Correct model

Do not duplicate source lists or invent another hand-maintained count. Derive from the actual artifacts:

- `PARENT = set(visual_manifest.screenshot_corpus.filenames)` → 65
- `HASH_BOUND = set(registry.hash_bound_screenshot_examples[*].name)` → 12
- `POST = set(registry.screenshots_added_2026_08_21.files[*].name)` → 13

Then prove:

- `HASH_BOUND ∩ PARENT` has exactly the nine names above;
- `HASH_BOUND - PARENT` has exactly the three Aug-10/Aug-11 separately hash-bound examples;
- `POST ∩ PARENT == ∅`;
- `POST ∩ HASH_BOUND == ∅`;
- `len(PARENT | HASH_BOUND | POST) == 81`.

The known authoritative screenshot surface at this point is therefore **81 unique screenshot filenames**, not 25: 65 parent members + 3 separately hash-bound outsiders + 13 post-parent authorized additions.

If the worker wants genuinely disjoint authority partitions, define them as:

1. sealed parent members = 65;
2. separately hash-bound outside-parent examples = 3;
3. post-parent operator-authorized additions = 13.

The nine hash-bound examples already inside the parent are cross-links and add **zero** unique members.

### Hash-disjointness claim

ALGO-004 required disjoint-by-name/hash **where disjointness is claimed**. The new test proves only names between the 12 and 13 sets and self-attests `tiers_are_disjoint = true`; it does not prove hash disjointness against the sealed parent.

Either:

- prove the relevant hash partition from locally verified archive members; or
- do not claim hash-disjointness where the parent manifest does not carry per-file hashes.

Never convert an unmeasured hash relationship into `true` metadata.

### Required red proof

The replacement regression must fail if any of the following are planted:

- one of the nine known parent cross-links is misclassified as outside-parent;
- one of the three Aug-10/Aug-11 outsiders is falsely claimed as a parent member;
- a 2026-08-21 addition is inserted into the parent membership;
- the union total is hard-coded to 25;
- a duplicate source fact can drift without being joined back to its canonical artifact.

This is a cheap evidence-identity repair and must finish before the canonical scorecard.

---

## 5. LEDGER CORRECTIONS

**APPROVED WITH CURRENT DIAGNOSTIC-ONLY STATUS.**

The worker correctly clarified two scopes of the sizing distribution:

- full 74-row census: 44 at 15 contracts, 27 at 17, 3 at 20;
- 69 non-degenerate rows used to solve the money multiplier: 42 / 25 / 2.

Those are not contradictory once their scopes are named.

The four exact 17.25-point / -$517.50 losses at 15 contracts are evidence of **exact frozen-stop-distance realized losses**. Because `Initial SL` is N/A, they do not by themselves prove how the order was represented/executed by the platform. The worker's new wording is correct.

The eight ledger screenshot pages remain **DIAGNOSTIC_ONLY**. Downgrading their reconciliation strength from an overclaimed full reconciliation to `SAMPLED` was required. Before they become load-bearing TP/exit oracle evidence, produce an actual matched-row census and mismatch count.

This does **not** block the first 14-case action-fidelity rerun because that rerun may not use ledger PnL to select semantics anyway.

---

## 6. PR BODY

**APPROVED.**

PR #38 now names build identity `MNQ-V2.4-BUILD-FINGERPRINT-14-UNIFIED-FIDELITY-CORPUS` instead of stale fingerprint 13 and remains DRAFT / DO NOT MERGE.

No strategy commit should be spent solely to restate this documentation correction again.

---

## 7. NEXT EXECUTION ORDER

The shortest robust path is now:

1. repair the screenshot evidence model exactly as §4 above;
2. red-proof it against real manifest membership rather than duplicated counts;
3. wait for all exact-head workflows to finish and require SUCCESS;
4. publish the missing worker report through the ALGO lane;
5. **then run the frozen 14-case regrade at that exact head before any strategy-semantic repair**;
6. commit the per-case scorecard and run the independent `accuracy-validator` with a DISPROVE mandate;
7. only then resume semantic defects in this order unless the measured scorecard disproves the dependency:
   - decision-time target map;
   - Mar 31 reclaim lifecycle;
   - six pre-window / one-bullet hazards;
   - WAIT vs NO_TRADE semantics;
   - latency/live-parity optimization.

Do not let this evidence-model correction become another broad custody detour. It is one bounded set-membership repair.

---

## 8. BACKTEST / FULL TRADING FORGE ARSENAL STATUS

Plan Rev 2 remains approved as the post-freeze engineering roadmap.

But the stage order does not change:

`FIDELITY -> FREEZE -> CLEAN_EDGE -> ROBUSTNESS -> EXECUTION -> SHADOW -> PRODUCTION`

No clean-edge PnL, Monte Carlo, parameter robustness, Frankenstein tests, prop-survival simulation, quantum challenger, critic/evolver, or other post-freeze Trading Forge weapon may select a fidelity repair.

The fastest route to the real backtest is **not** skipping this correction; it is closing it once, running the 14 cases, repairing only measured semantic causes, and freezing.

---

## 9. NEXT REPORT CONTRACT

The worker's next visible report must restore the missing ALGO report publication and include:

- exact strategy SHA;
- exact-head workflow conclusions;
- corrected screenshot membership census: 65 parent / 9 hash-bound cross-links inside parent / 3 hash-bound outsiders / 13 post-parent additions / 81 unique total;
- mutation/red-proof results for the corrected membership test;
- whether the frozen 14-case regrade was run;
- if run: the full per-case scorecard and independent validator result;
- runtime/latency;
- explicit statement that PnL/outcomes did not select a fidelity rule;
- PR #38 still DRAFT / DO NOT MERGE.

**RULING: KEEP THE GOLD FINGERPRINT AND LEDGER CORRECTIONS. REJECT THE FALSE 25-SCREENSHOT / THREE-DISJOINT-TIER MODEL. FIX THE SET MEMBERSHIP FROM THE ACTUAL MANIFEST, THEN IMMEDIATELY RE-ESTABLISH THE 14-CASE FIDELITY BASELINE.**
