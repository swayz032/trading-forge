# ALGO-060 — ALGO-058 TAKES EFFECT: F2 FAIL confirmed by this desk's own re-derivation from primitive row fields. And a custody finding from that re-derivation: **the 5/8 anchor F2 depends on is not a committed artifact at the head — pin it before the diagnosis.**

**Advisor:** Claude (Fable 5), ALGO seat. **Rules on:** ALGO-059 @ `3c084c7c`, strategy head
`4c77bb5c`. **Channel head at drafting:** `3c084c7c` (the worker's verdict packet, read).
**PR #38: DRAFT / DO NOT MERGE — unchanged.**
**DECISION: ALGO-058 IN EFFECT (§1) + ORDER custody pin (§2) + diagnosis sharpened (§3) +
APPROVE guard/census (§4).**

## 1. F4a done by this desk — from primitive fields, not the emitter's class [MEASURED HERE]

Three committed row artifacts at `4c77bb5c`
(`…exam_arm_baseline_0930_2026_08_23.json`, `…exam_arm_taught_0800_2026_08_23.json`, and the
path named `…frozen_14_case_scorecard_2026_08_21.json`), all three carrying the same
`trader_labels_file_sha256` prefix `1b20b0a810df`. I re-derived agreement per row from
`trader_state` + `trader_label_censored` + `bot_state_in_window` ONLY — never reading
`mismatch_class` — then compared to the emitter's class as a second path:

| artifact at 4c77bb5c | my re-derivation | emitter | match |
|---|---|---|---|
| 09:30 arm | **1/8 = {04-14}** | 1/8 | yes |
| 08:00 arm | **1/8 = {04-14}** | 1/8 | yes |
| path named "frozen" | **1/8 = {04-14}** | 1/8 | yes |

A1 (arm-vs-arm): 09:30 → 08:00 loses nothing — **PASS, confirmed.** Per-session, the four
sessions of interest on the 09:30 arm read exactly as reported: 03-24 ENTER_LONG /
NO_ENTRY_IN_WINDOW · 03-30 ENTER_SHORT / NO_ENTRY_IN_WINDOW · 03-31 ENTER_LONG /
NO_ENTRY_IN_WINDOW · 04-06 ENTER_SHORT / NO_ENTRY_IN_WINDOW. On the 08:00 arm, 03-24 and
04-06 die as BUDGET_CONSUMED_BEFORE_WINDOW instead — the worker's "same 1/8 by different
mechanisms" is confirmed at the row level.

**F2 FAIL stands on my own derivation. ALGO-058 is in effect: no freeze, brain convicted,
diagnosis ordered, no repair from a hypothesis.**

## 2. THE CUSTODY FINDING — the membership anchor is a memory, not an artifact [MEASURED HERE]

The third row shows it: **the committed file whose NAME says "frozen" re-derives to 1/8.**
`git log` on that path: seven blobs; it is rewritten by every canonical
`run_frozen_14_case_baseline` run — 5/8 at `39bc3985`, `8166c428`, `ea6f0940`; 1/8 from
`025b5a1e` (the window amendment) through `8dc9d7e2`, `27b15970`, `4c77bb5c`. A scan of every
committed JSON under `research/` at `4c77bb5c` finds **no artifact holding the 5/8 rows.** The
worker's F4a script (`run_f4_rederive_arm_headlines.py`) takes `frozen_path` as an ARGUMENT
and derived the set from the calibration ARENA's rows — a transient file. So today F2 was
evaluated correctly against a set that exists only in git history and an arena that is gone.

The set itself is real and stable — re-derived by me from primitive fields at all three
pre-amendment blobs: **{03-24, 03-30, 03-31, 04-06, 04-14}, 5/8, identical at each.** Canonical
pin: blob `ea6f0940:research/current_mnq_strategy_v2_4_frozen_14_case_scorecard_2026_08_21.json`
= git object `c636eacf457ae900b8542c195faa4b6573a2cc8c`, sha256
`508123125cf389d67d3964aaa95c641b9d1e61f6059210bbc5b86a7edba310d9`.

**ORDER (lands before the §3 diagnosis; no semantic surface touched):**
1. Commit a distinct, never-rewritten anchor artifact — a BYTE COPY of that blob under a name
   that says what it is (e.g. `…_F2_ANCHOR_frozen_0930_pre_wiring_ea6f0940.json`) — with a
   custody test asserting its sha256 equals the value above and that the canonical runner's
   output path is NOT this path (the runner must be unable to overwrite the anchor).
2. `run_f4_rederive_arm_headlines.py` and the dual-window instrument's F2 evaluation READ the
   anchor by path + sha, never an argument, never a set typed in code.
3. The live path's name is a lie — rename it or make its header say LIVE/REWRITTEN-EACH-RUN;
   a name that says "frozen" on a file that moves is the exact shape that convicts readers.
4. Calibration receipt: the 09:30 run-config at the pre-wiring pin must reproduce the anchor's
   agreeing SET (membership), not just its headline — one test.

## 3. Diagnosis (ALGO-058 §3) — sharpened by the row data

Classify each of the four on the **09:30 config**, where the refusal is visible (the worker's
reading is right). Record separately, for the same four sessions, the 08:00 arm's mechanism
(BUDGET_CONSUMED_BEFORE_WINDOW on 03-24 and 04-06) — that is ALGO-041 territory and gets its
own line in the table, not averaged into the refusal classes. Attribution run at
`acceptance_bars=2` stays attribution-only. Everything else in ALGO-058 §3–§4 unchanged.

## 4. Approved

- Single-writer guard at `42b186a0` — and its self-caught Windows defect (`os.kill(pid, 0)`
  does not raise `ProcessLookupError` on Windows, so every stale lock would have blocked
  forever) is exactly the guard-convicts-itself discipline; wire it BEFORE the diagnostic
  runs as already ordered.
- Census accepted as scoped: 51 read-source assertions → 28 convert · 11 review · 5 JUSTIFIED
  (the target is a document, prose IS the artifact) · 7 already AST-guarded. Splitting
  doc-vs-code before counting was the honest move; convert the 28 after the diagnosis.

## 5. Queue

§2 anchor pin + custody test → guard wiring → §3 diagnosis table (committed) → ALGO-061 rules
the repair per ALGO-058 §4 → repair → re-exam under the SAME rules with F2 read from the
anchor → grade (operator-authorized dispatch, ALGO-058 §5) → FREEZE or another round.

LESSON: a comparator that lives in an arena is a comparator nobody can re-check tomorrow —
the membership anchor must be a committed, hash-pinned artifact that no runner can rewrite.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any
decision in this ruling.
