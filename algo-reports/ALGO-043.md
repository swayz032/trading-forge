# ALGO-043 — §9.2 DISCHARGED. The grade rendered: **band 5, REFUTED**. The 5/8 headline is VERIFIED at band 7; the instrument that certifies it is not. Four published metrics cannot be non-zero, and three of my own tests cannot go red.

**Strategy head:** `025b5a1e` · PR #38 **DRAFT / DO NOT MERGE** · grade taken at pin
`4d786333` in `arena-4d786333`, item 5 in `arena-ea6f0940`. Full grade saved verbatim.

**Shape: FINISHED-AND-UNRENDERED (the ALGO-019 shape, not the ALGO-040 stall).** The grader ran
11:19:55Z → 11:45:23Z, produced a complete 29,000-character report, and signalled idle without
the report ever reaching me. I found it in its own subagent transcript, exactly as
`grader-transcript-path` says to. **One dispatch, as authorized. No re-dispatch.**

---

## 1. Arena discipline — held, and it graded itself on it

Every command ran with `cwd` inside an arena. Nothing was read from, written to, or `git`-ed
against either live tree. Everything it wrote went to a scratchpad; item 5's mutation battery
ran in a copy directory with pytest pointed at the arena's real test file. It even declined to
read my own ALGO-0NN reports so the grade would not be anchored to my account of the work.

Two things it wanted and did **not** take, which I am carrying rather than burying: it could
not verify the arenas are faithful `git archive` extractions (it took that on my word), and the
external labels origin in `Downloads` is absent from both arenas.

---

## 2. What SURVIVED — and the headline is one of them

- **`5/8` reproduces through two non-overlapping paths.** Path 1 drives production
  `_analysis_run_day` with no window machinery, no manifest, importing neither the baseline nor
  the regrade; Path 2 re-aggregates the artifact's own case rows with no engine at all. Both
  `5/8`. **14/14 join-key match** on the session-first entry clock.
- **The `as_of` truncation is causally faithful** — the truncated stream's first decision equals
  the untruncated production trade, 14/14.
- **The flattering 5/5 cannot silently become the headline**, and **the diagnostic cannot
  silently vanish** — the mutation battery fires on every emitter-driven route.
- **`opposite_direction_at_decision_count: 0` and `bot_only_entry_uncensored_decline_count: 0`
  are NOT structural zeros** — it built positive controls that fire both. It could not refute
  them.
- **Outcome-blindness holds**, proven with a positive control: the same grep against
  `engine.py` (which does compute `net_pnl`, `mfe`, `mae`) returns 8 hits, so the instrument can
  find outcome vocabulary when it is present.
- **Honest null on residual generosity:** beyond F-1/F-6 it found none. Every `None`/missing
  path fails closed or *against* the bot. The class you named in the brief is closed on this
  evidence.

---

## 3. F-1, CRITICAL — four published metrics cannot be non-zero, and the scorer CRASHES on the one state it exists to watch for

`_bot_window_state` can return `NO_ENTRY_IN_WINDOW` only when `budget_faithful` exists,
`bullet_spent_before_window` is false, and `in_window` is `None`. The regrade makes that
combination **impossible**: the no-decision branch emits a row with **no `budget_faithful` key
at all**, and the spent case returns `BUDGET_CONSUMED` before the read.

| metric | published | why |
|---|---|---|
| `bot_genuinely_declined_in_window_count` | 0 | counts an unreachable state |
| `both_declined_count` | 0 | needs a non-entered, non-consumed bot |
| `censored_bot_declined_count` | 0 | same |
| `missed_reason_census["NO_PERMISSION_IN_WINDOW"]` | 0 | same |

**So `AGREEMENT_CLASSES = {AGREE, BOTH_DECLINED}` degenerates to `{AGREE}` — the entire G-1
repair is dead code**, and `MISSED_TRADER_ENTRY` can arise *only* from `BUDGET_CONSUMED`.

**Worse than a zero:** a session where the bot genuinely takes no entry does not publish a zero
— it **aborts the baseline** with `REGRADE_ROW_PREDATES_THE_F1_REPAIR: … Re-run the regrade`,
sending an operator chasing a stale-artifact problem that does not exist. Red-proofed by
narrowing one window so production's only entry falls outside it.

**And it lands on my own claim.** "The bot never genuinely declines" is **true** — Path 1
measured a production entry in 14/14 sessions — but **the metric I cited as its evidence is a
tautology**, and my `test_the_bot_still_never_genuinely_declines` pins a number that cannot
move. The claim survives; my evidence for it does not.

Narrowest fix: the no-decision branch must emit `budget_faithful` with
`bullet_spent_before_window: False`. One edit makes all four live.

---

## 4. F-3, HIGH — the "independent" force derivation is a re-typing

Line-for-line the same algebra as production, down to comparing the **`reason` strings** —
six identical constants in identical ladder order. Measured:

| probe | disagreements |
|---|---|
| 40,000 random windows | **0** |
| shared `body_frac` 0.62 → 0.05 / 0.95 | 883 / 988 verdict flips, **0** disagreements |
| shared `parent_start` +1m / +2m | 344 / 387 flips, **0** disagreements |
| **one-sided** mutation of `force.py` only | **6000/6000 caught** |

That last row is the whole finding: it has full power against *implementation drift inside
force.py* and **zero power against specification error**. Both read `body_frac`, `close_loc`
and the parent anchor from the same `Params`, so anything wrong upstream is wrong identically in
both. **Fidelity to the trader is a specification question — precisely the axis this does not
cover.** My existing test proves non-delegation, not non-transliteration.

This is `same-layer-agreement` caught in my own work, and the caption oversells it.

---

## 5. F-4 and F-5 — my censoring tests do not pin the number they exist to pin

A 14-mutation battery against the test file I wrote this morning. Four green holes:

    M1   headline 5/8 -> 7/8 (numerator inflated)        GREEN
    M1b  headline -> 8/8 (perfect fidelity claimed)      GREEN
    M4   headline -> 5/5 with a faked symmetric field    GREEN
    M13  re-class one MISSED as AGREE, headline 6/8      GREEN

**M13 is the realistic shape**: a future generosity bug re-classifies one case, the summary
fields update consistently as the emitter would produce them, and all seven tests stay green.
Every assertion reads the artifact's *summary* and checks it against itself. **Only one test
crosses down to `doc["cases"]` — and it checks the session list, not the number.** The pattern
that closes this is already in the file; I did not apply it to the figure that matters.

**F-5 is worse in kind:** `test_the_published_headline_is_the_STRICTER_reading` compares two
**character-identical expressions** in the emitter — it asserts `X == X`. And the test that
compares the two readings cannot fail on any genuine re-run: all three symmetric-excluded
sessions carry `BUDGET_CONSUMED_BEFORE_WINDOW`, which provably never maps into
`AGREEMENT_CLASSES`, so the numerator is identical in both readings and the ratio is pinned at
`8/5` for any numerator ≥ 1. **Three of my seven tests have no path to red on a genuine re-run.**

I wrote those tests six hours ago and reported them as pinning both numbers. They do not.

---

## 6. The rest

- **F-2 HIGH** — `FORCE_RECEIPT_DISAGREES_WITH_KERNEL_GATE` is structurally unreachable: the
  receipt re-issues the *exact* argument tuple the kernel already gated on, and `force_snapshot`
  is pure. Dead for 100% of the corpus, and the artifact caption still advertises it as live.
- **F-6 MEDIUM** — a **second, censoring-blind agreement rule** survives at the timing-delta
  computation: it iterates `cases`, not `unc`. That is the exact G-1 shape the comment three
  lines below claims is closed. Latent today; red-proofed by planting one censored label.
- **F-7 MEDIUM** — **at the graded pin, zero tests reference the scorecard at all.** Everything
  in F-4/F-5 is a property of the later tree only.
- **F-9 MEDIUM** — the censoring annotation, read literally, selects **8** cases, not 6; the real
  discriminator is a hand-written `capture_warnings` list that sits **outside** `labels_sha256`.
  **The denominator is unsigned.** Direction of the error is *against* the bot (literal reading
  would give a flattering 5/6), so it is a caption defect, not generosity — it says so explicitly.
- **F-8, F-10 to F-13 LOW/MEDIUM** — stale captions citing a classification the artifact no
  longer carries and "the published 6/8" when it is 5/8; a decorative `internal_labels_sha256`
  that reproduces under no canonicalization and is compared to nothing; artifact deletion caught
  only by accident; `pnl_or_exit_used: False` a self-asserted literal.

**Largest gap it names in itself:** it did not run the full baseline end-to-end, so **it cannot
confirm the committed scorecard is not stale relative to its emitter** — and nothing at the pin
would show it. It also leaves 11 other scorecard consumers unopened, any of which may carry a
stale caption of the F-8 shape.

---

## 7. What I am doing next, unless you redirect

Repair order by severity, each red-proofed with the convicting instrument:
**F-1** (one edit, makes four metrics live and stops the misdiagnosing crash) → **F-4/F-5**
(recompute the headline from `doc["cases"]`; delete or re-anchor the three tests that cannot go
red) → **F-6** (scope the delta rule to `unc`) → **F-2** (delete the dead raise and the caption
that sells it) → **F-3** (narrow the caption, or re-anchor the second derivation to the spec
rather than `Params`) → captions.

**I am not touching F-9's denominator.** Changing what is censored moves the headline in the
bot's favour, and that is your call, not mine — same reason as ALGO-040 §3.

Note this grade is of the **pin**, and the window amendment is not in it. The amendment's own
deltas are ALGO-042 and my revert recommendation stands.

Suite **7 failed / 1446 passed** at last run; the exam instrument is built with its rule
pre-registered and is mid-run. **No PnL, realized outcome, winner/loser label or clean-edge
result participated in any decision in this packet.**
