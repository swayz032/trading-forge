## VERDICT

**Band 5 — REFUTED (as an instrument), with the headline itself VERIFIED.**

The 5/8 figure reproduces exactly through two non-overlapping paths and survived every attack I mounted on it; but the evaluator that produces it publishes **four metrics that cannot be non-zero by construction**, degenerates `AGREEMENT_CLASSES` to a single class, and **crashes with a misdiagnosing error on the one state change it exists to watch for** — so the number is right and the instrument that certifies it is not.

---

## ARENA DISCIPLINE

Confirmed. Every command ran with `cwd` inside `arena-4d786333` or `arena-ea6f0940`. I never read, listed, `cd`-ed into, or ran anything against `C:/Users/tonio/Projects/wt-mnq-v24` or `C:/Users/tonio/Projects/trading-forge`. No `git` command was issued against any tree.

- Every file I **wrote** went to the scratchpad root (`path1.py`, `item2–4b.py`, `mut5.py`, `probe_manifest*.json`, `mutlab/`). Zero arena source, test, or artifact files were modified.
- Mutation work for item 5 ran in `…/scratchpad/mutlab`, a directory holding only a *copy* of the scorecard and the emitter, with pytest pointed at the **arena's** real test file by absolute path. The arena was read-only throughout.
- One unavoidable side effect: Python wrote `__pycache__/*.pyc` into both arenas on import. No `.py`, `.json`, or `.csv` was touched.
- I deliberately did **not** read the `ALGO-0NN-*.md` worker reports sitting in the scratchpad, so this grade is derived from the arenas only and is not anchored to your own account.
- **Wanted and did not take:** git history for either pin (I cannot confirm the arenas are faithful `git archive` extractions of `4d786333` / `ea6f0940` — I take that on your word, and my verdict names only what is in the trees). Also `C:/Users/tonio/Downloads/mnq_replay_v3_labels_FROZEN.json`, the external corroboration origin, which does not exist in either arena.

TRADE_START verified `09:30` in both arenas (`research/current_mnq_strategy_v2_2_engine.py:38`); headline `5/8` in both. Right trees.

---

## ITEM 1 — THE 5/8 HEADLINE REPRODUCES. Two independent paths. **MEASURED HERE.**

**Path 1** (`…/scratchpad/path1.py`, 90.3 s, ARENA_A): imports neither `run_frozen_14_case_baseline` nor `current_mnq_strategy_v2_4_frozen_replay_regrade` (asserted at runtime via `sys.modules`). Drives `current_mnq_strategy_v2_4_engine._analysis_run_day(env, dte, p)` — the production entry point, with **no `as_of`, no replay window, no manifest** — which is enforcement site #1 in `current_mnq_strategy_v2_4_session_budget.ENFORCEMENT_SITES`. I then applied the budget rule and the censoring set myself and scored agreement with my own comparator.

> `PATH1 agreement over uncensored decided cases: 5/8`

**Path 2** (`…/scratchpad/item2.py`, ARENA_A): pure re-aggregation from the artifact's own 14 case rows, no engine, no data. Reproduced `5/8` **and** `same_direction_timing_deltas_seconds = [-120.0, 0.0, 0.0, 120.0, 360.0]` exactly.

**Join key checked (14/14):** production's session-first entry clock vs the artifact's `budget_faithful.session_first_entry_time` — `mismatched join keys: 0`. This also independently clears the `as_of=end` truncation machinery in `iter_actionable_candidates`: the causally-truncated stream's first decision is the same trade the untruncated production path executes, in all 14 sessions.

**Corroborated:** `bot_traded_at_all_in_the_session_count: 14` — Path 1 got a non-`None` result from `_analysis_run_day` on 14/14 sessions.

**No CRITICAL here. 5/8 stands.**

---

## FINDINGS

### F-1 — CRITICAL — Four published metrics are structurally zero, and the evaluator crashes on the state change it exists to detect

**File:** `research/current_mnq_strategy_v2_4_frozen_replay_regrade.py:136-146` + `research/run_frozen_14_case_baseline.py:98-115` (identical in both arenas — `diff` of the regrade module across arenas is empty).

`_bot_window_state` can return `NO_ENTRY_IN_WINDOW` only when `budget_faithful` exists, `bullet_spent_before_window` is false, and `in_window` is `None`. The regrade makes that combination **impossible**: `row["in_window"] = _payload(executable)`, and `executable is None` **iff** `session_first is None` or `spent_before` — the first of which lands in the `if not decisions:` branch at line 136, which emits a row **with no `budget_faithful` key at all**, and the second of which returns `BUDGET_CONSUMED` before the `in_window` read is reached.

**Consequence — these are constructions, not measurements:**

| published metric | value | why it is zero |
|---|---|---|
| `bot_genuinely_declined_in_window_count` | 0 | counts `NO_ENTRY_IN_WINDOW`, unreachable |
| `both_declined_count` | 0 | needs a non-entered, non-consumed bot state |
| `censored_bot_declined_count` | 0 | same |
| `missed_reason_census["NO_PERMISSION_IN_WINDOW"]` | 0 | `_missed_reason` line 123, same |

`AGREEMENT_CLASSES = {"AGREE", "BOTH_DECLINED"}` therefore **degenerates to `{"AGREE"}`** — the entire G-1 repair (line 88-93, "the class the semantics work exists to produce") is dead code. And `MISSED_TRADER_ENTRY` can arise **only** from `BUDGET_CONSUMED`, so the docstring's F-3 claim — *"On the window join the bot can decline, so both are live"* — is **false**.

**Worse than a zero:** a session in which the bot genuinely takes no A+ entry through window end does not publish a zero, it **aborts the canonical baseline** with `REGRADE_ROW_PREDATES_THE_F1_REPAIR: … Re-run the regrade`, a message that would send an operator chasing a stale-artifact problem that does not exist.

**Repro (real red-proof, ARENA_A, `…/scratchpad/item4.py`):** narrows 2026-03-24's window to `09:30–09:31` (production's only entry is 09:32) via a manifest written **outside** the arena and passed through `regrade_frozen_case_windows(..., manifest_path=…)`:

```
regrade row keys : ['bot_action','bot_entry_time','case_id','decision_count_in_window',
                    'decision_count_through_end','decisions_discarded_by_first_only',
                    'in_window','in_window_actions','session','window_status']
has budget_faithful : False
*** THE CANONICAL SCORER RAISES ON THIS ROW ***
RuntimeError: REGRADE_ROW_PREDATES_THE_F1_REPAIR: no `budget_faithful` block...
```

**Positive control (CONTROL A, same file):** `_mismatch_class` fed `NO_ENTRY_IN_WINDOW` directly returns `BOTH_DECLINED` / `MISSED_TRADER_ENTRY` / `CENSORED_BOT_DECLINED` correctly. The classifier is fine; the state feeding it is the constant.

**Fair note, and it matters:** the substantive claim *"the bot never genuinely declines"* is **true on this corpus** — Path 1 measured a production entry in 14/14 sessions. The claim survives; the metric cited as its evidence is a tautology. ARENA_B's `test_the_bot_still_never_genuinely_declines` (line 93-99) pins a number that cannot move.

**Narrowest fix point:** `frozen_replay_regrade.py:136-145` — the no-decision branch must emit `budget_faithful` with `bullet_spent_before_window: False`, which makes all four metrics live in one edit.

---

### F-2 — HIGH — `FORCE_RECEIPT_DISAGREES_WITH_KERNEL_GATE` still has no path to red, and the artifact advertises it as a live guard

**File:** `research/current_mnq_strategy_v2_4_frozen_replay_regrade.py:101-107`; caption at `run_frozen_14_case_baseline.py:252-259`.

For `REV` and `BRK5`, `parent_for_setup` returns `(cand.signal_time, 5)`, and `cand.signal_time == ts`, `cand.confirmed_time == decision_time` — the *exact* tuple the kernel already gated on at `kernel.py:185`/`:203`. `force_snapshot` is pure, so `fs.confirmed` is `True` by construction. This is verbatim the F-4 defect the `independent_force` docstring says was closed; the repair added a second derivation but **left the dead raise standing**, and the scorecard's `force_receipt_note` still sells it: *"the regrade raises FORCE_RECEIPT_DISAGREES_WITH_KERNEL_GATE if it ever comes back unconfirmed."*

**Repro (`…/scratchpad/item3d.py`, ARENA_A):** spies on `force_snapshot`, tagging kernel-gate vs receipt-recomputation calls, on 2026-03-24:

```
kernel force_snapshot calls : 32 (16 distinct)
receipt recomputation calls : 1
   receipt ('2026-03-24 09:30:00-04:00', 5, 'L', '2026-03-24 09:32:00-04:00', True)
      -> identical arg-tuple already made by the kernel: True
receipt calls that returned confirmed=False: 0
```

**Scope:** 7/7 published force receipts are `REV` or `BRK5` (`parent_minutes: 5`). `independent_force`'s own docstring states zero `BRK15` candidates exist in any committed artifact. So the raise is dead for **100%** of the corpus.

**Fix point:** delete the raise or re-anchor it to a derivation that is not the gate — and correct `force_receipt_note`, which is a caption claiming a guard.

---

### F-3 — HIGH — `independent_force` is a re-typing, not a second derivation; it is blind to every error that lives upstream of it

**File:** `research/current_mnq_strategy_v2_4_independent_force.py:65-128` vs `current_mnq_strategy_v2_4_force.py:84-160` + `_geom` at `current_mnq_strategy_v2_4_entries.py:37-47`.

Line-for-line the same algebra: identical sub-bar mask, identical `path = [o] + closes` / `|diff|.sum()`, identical `progress/max(distance,EPS)`, identical at-extreme, and `rng = max(h-lo,EPS)` / `body/rng` / `(c-lo)/rng` reproducing `_geom` exactly. `compare()` even compares the **`reason` strings** — six identical constants in identical ladder order, which only two implementations sharing an author's single conception produce.

**Measured (`…/scratchpad/item3.py`, `item3b.py`, `item3c.py`, ARENA_A):**

| probe | result |
|---|---|
| 40,000 random 0.25-tick-grid windows (2,219 confirmed) | **0 disagreements** |
| degenerate / EPS-boundary shapes | 9 disagreements, **all** at 1e-10…1e-13 price scale — the `EPS 1e-12` vs `1e-9` mismatch, never a semantic difference |
| **shared** `body_frac` 0.62 → 0.05 | **883/8000 verdict flips**, cross-check disagreements **0** |
| **shared** `body_frac` 0.62 → 0.95 | **988/8000 verdict flips**, cross-check disagreements **0** |
| **shared** `parent_start` +1m / +2m | 344 / 387 of 3000 verdict flips, disagreements **0 / 0** |
| **shared** MIN observations 2→3 (both modules) | disagreements **0/6000** |
| **one-sided** MIN observations 2→3 (`force.py` only) | disagreements **6000/6000** ← the power it *does* have |

The last two rows are the whole finding: the cross-check has full power against *implementation drift inside `force.py`* and **zero power against specification error** — a wrong threshold, a wrong parent anchor, a wrong rule. Both derivations read `p.body_frac`, `p.close_loc`, and `parent_for_setup` from the same source, so anything wrong upstream is wrong identically in both. Fidelity to the trader is a *specification* question, which is precisely the axis this cross-check does not cover.

The existing test `test_it_calls_neither_force_snapshot_nor_momentum_bar` is an **AST token scan** — it proves non-delegation, not non-transliteration. `test_a_perturbed_threshold_makes_them_DISAGREE` red-proofs only the *one-sided* mutation.

**Verdict on the brief's question:** it does **not** reach the same answer for a different reason. It reaches the same answer by re-executing the same formulas. The agreement is worth something narrow and is captioned as if it were worth much more (*"Two implementations agreeing is evidence"*).

**Fix point:** `independent_force.py:65-67` — it must derive `body_frac`/`close_loc`/the parent anchor from an independent authority (the spec JSON, not `Params`), or the docstring must be narrowed to "detects drift between two copies of one rule".

---

### F-4 — HIGH — The censoring-symmetry pin does not pin the numerator (ARENA_B)

**File:** `tests/test_current_mnq_strategy_v2_4_censoring_symmetry.py` (ARENA_B).

**Repro (`…/scratchpad/mut5.py`, harness in `…/scratchpad/mutlab`, arena read-only):** 14 mutations against the real test file.

```
M0  unmutated control                                    GREEN  7 passed
M1  headline 5/8 -> 7/8 (numerator inflated)             GREEN  7 passed   <-- HOLE
M1b headline -> 8/8 (perfect fidelity claimed)           GREEN  7 passed   <-- HOLE
M2  headline -> 5/5, diagnostic untouched                RED    1 failed
M3  headline -> 5/5 + stricter field relabelled          RED    2 failed
M4  headline -> 5/5, symmetric field faked to 5/4        GREEN  7 passed   <-- HOLE
M5  adopt symmetric denominator wholesale (unc 8 -> 5)   RED    3 failed
M6  DELETE the diagnostic block                          RED    5 failed
M7  EMPTY the diagnostic block                           RED    5 failed
M8  DELETE the scorecard artifact entirely               RED    1 failed, 5 skipped
M9  flip STATUS to ADOPTED_AS_THE_HEADLINE               RED    1 failed
M10 drop 04-09 from the derived session list             RED    2 failed
M11 bot_genuinely_declined 0 -> 1                        RED    1 failed
M12 edit the EMITTER prose only                          RED    1 failed
M13 re-class 04-09 MISSED -> AGREE, headline 6/8         GREEN  7 passed   <-- HOLE
```

**The agreement count is unpinned.** M13 is the realistic shape: a future generosity bug re-classifies one `MISSED_TRADER_ENTRY` as `AGREE`, the three fields update consistently as the emitter would produce them, and all seven tests stay green at `6/8`. M1b takes it to `8/8` — a claim of perfect fidelity — still green.

**Why:** every assertion reads the artifact's own *summary* fields and checks them against each other. Only `test_every_named_session_really_had_no_in_window_bot_decision` crosses from the summary down to `doc["cases"]` — and it checks the session **list**, not the number. The pattern that would close this is already in the file; it was not applied to the figure that matters.

**Fix point:** add one test that recomputes `agreement_decided_cases` from `doc["cases"]` + `AGREEMENT_CLASSES` and asserts equality with the published string.

---

### F-5 — MEDIUM/HIGH — `test_the_published_headline_is_the_STRICTER_reading` asserts `X == X`

**File:** `research/run_frozen_14_case_baseline.py:300` and `:332` (ARENA_B) are **character-identical expressions**:

```python
f"{sum(1 for c in unc if c['mismatch_class'] in AGREEMENT_CLASSES)}/{len(unc)}"
```

The test compares the two fields those two copies emit. It cannot detect that the headline is the stricter reading; it can only detect an inconsistent *hand-edit*. The name asserts a property the assertion does not test.

Worse, the test that *does* compare the two readings — `test_the_symmetric_reading_is_the_one_that_FLATTERS_the_bot` — **cannot fail on any genuine re-run.** All three symmetric-excluded sessions carry `BUDGET_CONSUMED_BEFORE_WINDOW`, which `_mismatch_class` provably never maps into `AGREEMENT_CLASSES` (exhaustively enumerated in CONTROL A: it yields only `MISSED_TRADER_ENTRY` or `TRADER_DECLINED_BOT_TRADED_PRE_WINDOW`). So the numerator is **identical** in both readings and the ratio is fixed at `8/5 = 1.6` for any numerator ≥ 1.

**Three of the seven tests** (`..._is_recorded_but_NOT_adopted`, `..._is_the_one_that_FLATTERS_the_bot`, `..._still_never_genuinely_declines`) have **no path to red on a genuine re-run** — only on a hand-edited JSON.

---

### F-6 — MEDIUM — A second, censoring-blind agreement rule survives, and it is a raw string compare

**File:** `research/run_frozen_14_case_baseline.py:280-282` (both arenas).

```python
deltas = sorted(c["timing_delta_seconds"] for c in cases
                if c["timing_delta_seconds"] is not None
                and c["trader_state"] == c["bot_state_in_window"])
```

Iterates `cases`, not `unc`. This is the exact G-1 shape the comment three lines below claims is closed — *"Censored cases are excluded by the classifier itself, so there is no second place for the rule to drift."* Line 280 **is** that second place.

**Repro (`…/scratchpad/item2.py`, replication self-checked against the published artifact first — headline and delta list both reproduce exactly):** plant a known-bad — set censored case 2026-04-01's `trader_state` to its bot action:

```
headline    5/8 -> 5/8   (classifier guards it — correct)
delta list  [-120,0,0,120,360] -> [-120,0,0,120,360,720]
=> a RIGHT-CENSORED case entered a PUBLISHED statistic: True
```

Today the leak is latent (no censored label's `final_action` equals an `ENTER_*`), and it moves a diagnostic list rather than the headline. But it is the same failure mode, unguarded, in a published field.

---

### F-7 — MEDIUM — ARENA_A, the pin you asked me to grade, has **zero** tests binding the scorecard

Enumerated the full consumer surface of `frozen_14_case_scorecard` / `agreement_decided_cases` across both arenas:

- **ARENA_A (`4d786333`):** 14 hits, **all under `research/`**, **none under `tests/`**.
- **ARENA_B (`ea6f0940`):** the same 14 plus 3 test files.

At the graded pin the 5/8 headline is pinned by nothing at all. Everything in F-4/F-5 is a property of ARENA_B only.

---

### F-8 — MEDIUM — Stale caption in the censoring-uniformity diagnostic

**File:** `research/current_mnq_strategy_v2_4_censoring_uniformity.py`, docstring.

The module's reasoning is good and it independently corroborates the censoring set — **credit where due, it caught 04-02 and got the right answer.** But its conclusion is stated over a classification the artifact no longer carries:

> *"2026-04-02 is `NO_TRADE` at exactly the window end, is NOT censored, and carries `BOT_ONLY_ENTRY_UNCENSORED_DECLINE`"*

The published scorecard classifies 2026-04-02 as **`TRADER_DECLINED_BOT_TRADED_PRE_WINDOW`**, and `bot_only_entry_uncensored_decline_count` is **0**. The same docstring refers to *"the published 6/8"* when the published figure is **5/8**. The conclusion still holds under the current classification (04-02 remains in the denominator and remains a non-agreement), but the evidence sentence is stale. A caption is a claim.

Also: `LABELS = Path("C:/Users/tonio/Downloads/mnq_replay_v3_labels_FROZEN.json")` — this diagnostic still reads the out-of-git origin the F-6 repair moved the baseline off. It cannot run in either arena.

---

### F-9 — MEDIUM — The scorecard's censoring rule, as written, selects 8 cases; the annotation selects 6

**File:** `run_frozen_14_case_baseline.py:364-368` (`censoring_note`).

> *"Six labels carry TRADER_ENDED_PRESENTED_REPLAY_STILL_WAITING with a single timeline entry at exactly the window end."*

Measured against the labels file: **eight** of fourteen have their only timeline entry stamped at exactly the window end — the six censored, plus 2026-04-02 (`NO_TRADE` @ 10:55 = end) and **2026-04-09 (`ENTER_LONG` @ 11:35 = end)**. Additionally, *all fourteen* labels have exactly one timeline entry, so "a single timeline entry" is not a discriminator at all. The real discriminator is the hand-written `capture_warnings` list — which the code's own `keys_OUTSIDE_the_internal_signature` confirms sits **outside** `labels_sha256`, together with `status` and `wait_at_replay_end_count`. The entire denominator-selecting annotation is unsigned.

The full rule (from `censoring_uniformity.py`: *no entry* **and** *timeline at end*, with `WAIT` ≠ `NO_TRADE`) selects 7 and documents its one exception. **The direction of the discrepancy is against the bot**, not in its favour — applying the scorecard's own written note literally would censor 8 and move the headline to a more flattering **5/6**. This is a caption defect, not a generosity defect, and I want to be explicit about that.

**Residual, unresolved:** 2026-04-09's `ENTER_LONG` is stamped at *exactly* the replay cutoff — structurally the same signature as the six censored labels. Nothing in either arena asks whether that is a decision or a cutoff artifact, and it is one of the two `MISSED_TRADER_ENTRY` cases. It counts **against** the bot, so it is not generosity; it is label quality.

---

### F-10 — LOW — `internal_labels_sha256` is a decorative digest

`trader_labels_custody.internal_labels_sha256 = 11d8dec0…` reproduces under **none** of five canonicalizations I tried over `{schema_version, pack_id, frozen_at, labels}` (`sort_keys`×`separators`×`indent`). Nothing in the codebase compares it to anything. It is published inside a block titled "custody". The whole-file sha256 **does** verify (`1b20b0a8…`, MEASURED HERE) and is the real custody anchor.

### F-11 — LOW — Artifact deletion is caught by accident

M8 goes RED only because `test_every_named_session_really_had_no_in_window_bot_decision` opens `SCORECARD` directly and bypasses `_agg()`'s `pytest.skip`. "Fix" that inconsistency and deleting the artifact becomes a green run (5 skipped, 1 passed).

### F-12 — LOW — `independent_force`'s `n == 0` branch omits the keys `compare()` reads

`independent_force.py:78` returns only `{confirmed, reason, completed_1m}`. `compare()` then reads `independent.get("directional_progress", nan)`, and `abs(a - nan) <= tol` is False, so it reports a **spurious** three-field divergence when both derivations agree on `NO_COMPLETED_1M`. Unreachable in the pipeline (the kernel only yields on `confirmed`), but it is a `FORCE_DERIVATIONS_DISAGREE` waiting for the first caller with a different call pattern.

### F-13 — LOW — `pnl_or_exit_used: False` is a self-asserted literal

Hardcoded at `run_frozen_14_case_baseline.py:370` and `frozen_replay_regrade.py:261`. A field that cannot go red is not a guard. The property it asserts is **true** as measured (below) — but not by that field.

---

## SURVIVED — claims I attacked and could not break

1. **`agreement_decided_cases: 5/8`.** Two non-overlapping paths (production `_analysis_run_day` with no window machinery; artifact re-aggregation with no engine). Both `5/8`. 14/14 join-key match on the session-first entry clock.
2. **The `as_of=end` truncation is causally faithful.** Attacked by comparing the truncated regrade's `decisions[0]` against the *untruncated* production engine on all 14 sessions — identical to the minute, 14/14.
3. **"The flattering 5/5 cannot silently become the headline."** Every *plausible* emitter-driven route is caught: adopting the symmetric denominator (M5, 3 failures), swapping the headline alone (M2), swapping headline + label (M3). The only green route (M4) requires fabricating a nonsense `5/4` symmetric field by hand — not a route an emitter change produces.
4. **"The diagnostic cannot silently vanish."** Deleting it (M6) and emptying it (M7) both fire 5 tests. Flipping `STATUS` (M9) fires. Editing the emitter's prose (M12) fires.
5. **The derived session list is genuinely derived.** M10 (dropping 04-09) fires two tests, one of which re-derives the list from `doc["cases"]`.
6. **`opposite_direction_at_decision_count: 0` and `bot_only_entry_uncensored_decline_count: 0` are NOT structural zeros** — I could not refute them. Positive controls fire both (`…/scratchpad/item4b.py`, widening two windows to 09:30 so the session-first lands inside):
   ```
   2026-04-02  trader=NO_TRADE    bot=ENTER_SHORT -> BOT_ONLY_ENTRY_UNCENSORED_DECLINE
   2026-04-09  trader=ENTER_LONG  bot=ENTER_SHORT -> OPPOSITE_DIRECTION_AT_DECISION
   ```
   These two zeros are measurements, conditional on the pinned windows. (Worth knowing: the direction inversion the docstring's F-2 describes on 04-09 **is real and is in the data** — it is reported as zero because the budget-faithful join says the bot could not act there, which is the correct semantics, not a hidden defect.)
7. **`independent_force` is not a delegation, and the comparator has real power** against one-sided drift: 6000/6000 caught when `force.py` alone is mutated. My F-3 is about the axis it does *not* cover, not a claim that it is inert.
8. **Outcome-blindness holds.** Grep for `pnl|exit_|winner|loser|mfe|mae|profit` across the regrade + scoring path returns only prose and the `pnl_or_exit_used` flag; **positive control**: the same grep against `current_mnq_strategy_v2_4_engine.py` (which does compute `net_pnl`, `exit_1m_realistic`, `mfe`, `mae`) returns 8 hits, so the grep can find outcome vocabulary when it is present. The published artifact contains zero occurrences of `winner`, `loser`, `mfe`, `mae`, `profit`, `net_`. **Disclosure on my own method:** Path 1 called `_analysis_run_day`, which *does* compute PnL internally; I read only `entry_time` and `side` from its return. No outcome field entered any judgement of mine — and the regrade module's decision to stop at `build_and_classify` rather than reuse `_analysis_run_day` is, on this evidence, the right call.

---

## GRADING TABLE

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| `agreement_decided_cases: 5/8` | **7** | **VERIFIED** | 2 non-overlapping paths; 14/14 join keys; positive controls on 2 of the 4 near-zero classes | denominator rests on an unsigned hand-list (F-9); 04-09 label quality |
| Evaluator (`_mismatch_class`, `AGREEMENT_CLASSES`, `aggregates`) | **4** | **REFUTED** | F-1 red-proof: 4 structural zeros; canonical scorer raises on a genuine decline | the metric cited for "the bot never declines" cannot move |
| Force cross-check (`independent_force` + receipt) | **5** | **REFUTED as "independent"** / VERIFIED as a one-sided drift detector | 0/40,000 disagreements; 0 detection on 3 classes of shared error; 6000/6000 on one-sided | specification error invisible; dead raise still advertised (F-2) |
| Censoring-asymmetry pin (ARENA_B) | **5** | **PARTIALLY REFUTED** | 14-mutation battery: holds against the named attack, 3 green holes | numerator unpinned; 3 of 7 tests cannot go red |
| Scorecard binding at the graded pin (ARENA_A) | **3** | **REFUTED** | zero tests reference the artifact in ARENA_A | nothing detects an edited scorecard at `4d786333` |
| **Overall — MNQ-v2.4 strategy-fidelity lane** | **5** | **REFUTED** | above | — |

---

## NOT REACHED — name it rather than imply coverage

1. **I did not run the full `run_frozen_14_case_baseline` end-to-end** (~381 s per its own `runtime` block). My Path-1 and Path-2 derivations are independent of it by design, and I ran the regrade module directly on 4 probe cases. But I have not confirmed that a fresh full run reproduces the committed artifact byte-for-byte. **The committed scorecard could be stale relative to its emitter and nothing in ARENA_A would show it.** That is the single largest gap in this grade.
2. **Provenance of the arenas.** I cannot confirm the trees are faithful extractions of `4d786333` / `ea6f0940`. Everything above describes the trees as they exist on disk.
3. **The other 11 scorecard consumers.** `bot_entry_rate.py`, `evidence_eras.py`, `discriminator_search.py`, `ledger_corpus_join.py`, `story_information_content.py`, `external_evidence_custody.py`, `run_candidate_xray_14_sessions.py`, `run_xray_episode_census.py`, `run_story_ablation_14_sessions.py`, `diagnose_april9_direction_conflict.py`, `verify_zero_missed_trader_entries.py` — all read the scorecard; I opened only the last two, and only their headers. Any of them may carry a stale caption of the F-8 shape.
4. **ARENA_B's post-pin additions** (`derivation.py`, `entry_authority.py`, `mutation_campaign`, `refusal_legibility`, `validation_arsenal`, `window_bound_census`, `breakout_derivation`, and their 9 test files) — out of the brief's scope, entirely unexamined.
5. **The trader labels' upstream provenance.** I verified the whole-file sha256 and that the censoring annotation is unsigned. I did not and could not corroborate the labels against the `Downloads` origin (absent from both arenas), the source replay videos, or anything outside the file.
6. **`BRK15`.** Zero such candidates exist in the corpus, so `parent_for_setup`'s 15-minute branch is exercised only by fixtures. I confirmed the branch returns `(decision_time.floor("15min"), 15)` but ran no `BRK15` candidate through the receipt.
7. **`build_and_classify` / target selection.** The first-TP fields (`bot_target_*`, `path_reason`) are published per case and I did not attack them at all.
8. **No full pytest run** in either arena. I ran two files: `test_current_mnq_strategy_v2_4_independent_force.py` (16 passed) and `test_current_mnq_strategy_v2_4_censoring_symmetry.py` (7 passed). I do not know the suite-wide state of either tree.

**Honest null on the brief's item 2:** beyond F-6 and F-1, I found **no** residual generosity in the classifier. Every `None`/missing path I traced fails *closed* or *against* the bot: `_bot_window_state` raises on a missing `budget_faithful`; a missing `wait_at_replay_end_count` raises; an absent `final_action` becomes `"UNKNOWN"` which scores as a decline and therefore against the bot on every reachable branch; `BUDGET_CONSUMED` is correctly held distinct from a decline, and `TRADER_DECLINED_BOT_TRADED_PRE_WINDOW` is correctly excluded from `AGREEMENT_CLASSES`. The one benign-default I found — `bf.get("bullet_spent_before_window")` defaulting falsy, which *would* be generous — is unreachable because the regrade always writes the key. The prior-instance class you named is closed on this evidence.