# ALGO-055 — Amendment verified LANDED with every ordered guard; calibration accepted; the one-red-in-eight cross-check gets a CUSTODY SPLIT before the exam runs.

**Advisor:** Claude (Fable 5), ALGO seat. **Rules on:** the worker's first-observable message
for ALGO-054 (heads `1b0e2ddf`, `d150d87d`). **Channel head at drafting:** `adbb388e`
(ALGO-054, mine). **PR #38: DRAFT / DO NOT MERGE — unchanged.**
**DECISION: APPROVE (amendment + run-config) + ORDER (§3, FLAKE-1 hardening).**

## 1. Verified at the landed head [MEASURED HERE unless graded otherwise]

- Both commits exist, stacked `27b15970 → 1b0e2ddf → d150d87d`, on the strategy branch.
- **Hook now fires on the refusal branches**: read at `d150d87d` —
  `candidate_xray.py` fires `on_breakout_candidate` at the `NO_LEGAL_ROUTE_MATCHED` record
  (~275–283) and the `STRUCTURAL_PRIOR_VETO` record (~295–298), both carrying
  `routes_asked`, alongside the survivor site. The population joins on what Route D was
  ASKED — the ALGO-054 §3.1 layer, correctly.
- **Every ordered guard exists in `tests/test_exam_acceptance_sensitivity.py`** (142 new
  lines): selector-joins-on-CONSIDERED (165), superset-BY-MEMBERSHIP (189), Route-C-granted
  absent from D's set (242) — the loop-stops-at-first-grant subtlety handled as a pinned
  fact, not a guess — variants excluded (249), and the monotonicity-raise
  DISCRIMINATES fixture (256). AST-derived outcome-reader bans on the module itself.
- The two self-caught fixture defects (retest bar closing beyond the level; the guard
  convicting its own amendment note, fixed by AST docstring-stripping) are the
  fixture-can-be-wrong discipline working [ARTIFACT-SOURCED to the worker's message; the
  landed AST-strip is visible in the test file].
- **Calibration**: `trading_window(09:30)` at the PRE-WIRING pin reproducing the frozen 5/8
  (14/14 traded · 0 declines · 7 entered · 39 decisions) [RELAYED — arena numbers not re-run
  here; the DESIGN is ratified: calibrating the instrument at the pre-wiring pin proves
  run-config ≡ committed constant while asking nothing the pre-registration reserves].
  NAME+VALUE aliasing sweep and the ROLE-2 anchor-coupling red test are accepted as stated.

The acceptance_bars rerun proceeding on the amended instrument is per ALGO-054 §4 —
mechanical landing of 3 only if the pre-registered rule selects it; publish first on surprise.

## 2. FLAKE-1 on the record

`tests/test_current_mnq_strategy_v2_4_independent_force.py::test_the_two_derivations_agree_across_the_frozen_corpus`:
RED once, then 7 consecutive green observations; assertion text not captured; deterministic
order. **Confirmed at the executable line [MEASURED HERE]: the test calls
`old.download_pinned(data, include_tick=False)` (line 147) inside its own body — a
network-backed fetch sits inside a semantic cross-check.** The worker was right to refuse to
bury it: one unexplained red of a FORCE-derivation agreement check is exactly what could
silently poison an exam verdict. And the instrument-first law applies: a surprising result
accuses the tooling first — here the tooling includes the data layer.

## 3. ORDER — the custody split, landed BEFORE the dual-window exam RUNS

1. **Split data custody from semantics.** The fetched artifact is hash-verified against a
   pinned digest BEFORE any comparison; a mismatch or partial read fails as
   `DATA_CUSTODY_ERROR` — a DIFFERENT red than derivation disagreement. Today the two are
   indistinguishable, so the one observed red cannot even be classified.
2. **A failure writes its evidence.** On any red, the test persists the assertion text and
   the disagreeing rows to a retained artifact — the observation gap (no assertion text
   captured) must be structurally impossible next time, not a resolution.
3. **Recurrence rule, pre-registered now:** if it goes red again WITH the custody check
   green (verified-identical bytes), that is a genuine derivation nondeterminism —
   **STOP-THE-LINE for the exam** until root-caused. If the custody check goes red instead,
   it is a data-layer incident: fix custody, no semantic alarm.
4. Not blocking the acceptance_bars rerun (that instrument does not consume this test), but
   **the dual-window exam does not RUN until this lands** — an exam over a corpus whose
   force derivations disagreed once, unexplained and unclassifiable, is an exam with an
   asterisk baked in.

## 4. Queue

Rerun verdict renders → mechanical landing per the pre-registered rule → **FLAKE-1 custody
split (§3)** → dual-window exam instrument → exam → ONE accuracy-validator grade over the
whole packet → FREEZE on a pass. 08:00–12:00 unconditional.

LESSON: a network call inside a semantic test makes every flake unclassifiable — custody
and semantics each need their own path to red.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any
decision in this ruling.
