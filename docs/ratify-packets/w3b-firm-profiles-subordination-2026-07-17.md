# Ratify-Packet — W3B firm_profiles subordination to canonical firm-config (2026-07-17)

**STATUS: CLOSED — LANDED 2026-07-17 (campaign W3B). INDEPENDENTLY GRADED band 7 VERIFIED SAFE-TO-LAND (accuracy-validator, doer≠grader): A/B receipt reproduced BIT-FOR-BIT on all 6 cells via independent re-execution; RED-proofs re-run genuine; hot files (backtester/prop_sim/lifecycle/firm-priors) confirmed comment-only; DLL semantic RULED conservative-and-correct (old None→score-100 was actively wrong); payout-cap math cross-checked vs migration 0168. Grade findings F-1 (PROP-FIRM-COMPLIANCE.md 8-firm doc rot + a Covered-Firms-table sibling) and F-2 (prop_compliance.py second hand-typed duplicate — see ADDENDUM below) + the stale profit_tier test ALL CLOSED IN-WAVE per zero-carry-forward, incl. the cross-language `firm-rules-version.ts::FIRM_CONFIGS_TS` sibling (hash bump `547b454b5da2450d` by-design, both frozen-fixture suites green). Parent final-verify: agreement lock 23/23, firm-rules parity PASS, tsc 0, test:metrics 145/0 HELD. Base `17ae16dd`. Nothing live. W7-6 close-out re-grade (2026-07-18, fresh accuracy-validator, from-zero, doer≠grader): independently re-derived all 3 claimed items via 3-4 non-overlapping paths each, including an independently-written-from-scratch A/B harness that reproduced all 6 receipt cells bit-for-bit. VERIFIED BAND 7 — matches the wave's own claimed band, no inflation. Surfaced 2 findings OUTSIDE this wave's scope (confirmed via `git show <landing-sha> --stat` that W3B never touched the implicated files) — recorded for the close-out ledger, not fixed here: (a) HIGH — `detectStalePaperSessions()` in `scheduler.ts` keyed staleness on signal/trade production rather than feed liveness, auto-stopping healthy selective PAPER strategies; FIXED separately same-session, commit `4e484bd6`; (b) the C4 TESTING→PAPER gate's `raw_survival_score` input is architecturally hardcoded to 0.0 (every `backtester.py` call site passes `survival_results=None` to `compute_forge_score()`) — dormant/unexercised today (0 backtests in production), NOT fixed, needs its own scoped design decision before backtests start flowing. See AGENT-LOGS 2026-07-18 W7 close-out entry.**

## 1. What & why
`src/engine/survival/firm_profiles.py` is a hand-maintained duplicate of firm rules (header dated 2026-05-19, "verified against help center pages") that has DRIFTED from the canonical hash-versioned `src/engine/firm_config.py`: **MFFU `max_contracts` 50 vs canonical 40** (`firm_config.py:136` "Builder: 4 minis / 40 micros"), plus commission (`0.62` vs canonical MFFU `0.95`/Topstep `0.62` per-side mapping) and Topstep `consistency_threshold: None` vs the canonical 50% rule. Its consumers are LIVE: `survival_scorer.py:27` (`get_firm_profile`) → survival score → `backtests.gateResult.components.raw_survival_score` → **C4 TESTING→PAPER HARD gate (blocks < 60, `lifecycle-service.ts` ~:3542-3567)**; also `survival_comparator.py`, `survival_twin_replay.py`, `routes/survival.ts`. A drifted profile grades survival against WRONG firm rules — exactly the silent-drift class the firm-rules-version hash exists to kill, except this file sits outside the hash.

## 2. Blast radius
Survival scores for MFFU-profiled strategies change where the drifted values bind (50→40 micros tightens the cap; commission and consistency corrections shift breach math). C4 gate inputs shift accordingly on RE-RUN scoring (historical rows untouched). Topstep values largely align already — receipt confirms. `test:metrics` expected UNCHANGED (survival scorer isn't in the golden fixture chain — verify; ANY golden shift ⇒ reserved-class HOLD).

## 3. Exact change, scope-locked
Subordinate, don't hand-maintain (mirror W2's `gate_block_analyzer` derived-view pattern): `FIRM_PROFILES` values DERIVE from `firm_config.py`'s canonical structs (`FIRM_CONFIGS`/`FIRM_RULES`/`get_commission_per_side`/payout constants) at import time, keeping the same dict SHAPE so all four consumers + any tests that import `FIRM_PROFILES`/`get_firm_profile` keep working. Where a canonical source lacks a field the profile needs (e.g. `eval_cost_monthly`), keep the literal BUT mark it clearly as profile-local (not firm-rule) data. Delete the stale "verified 2026-05-19" hand-maintenance framing; note drift-impossible-by-construction. OUT of scope: the survival MODEL math (scorer/comparator logic untouched); `firm_config.py` canonical values (they are the truth — do not edit); the firm-rules-version hash helper.

## 4. Verification
(a) **A/B receipt** (`docs/replay-results/2026-07-17-w3b-firm-profiles-ab.md`): survival score for a representative MFFU-profiled strategy input BEFORE (drifted 50-micro profile) vs AFTER (canonical 40) + a Topstep control (expect ~unchanged) — run the real `survival_scorer` on fixed inputs. (b) RED-proof: a test pinning `get_firm_profile("MFFU","50K")["max_contracts"]` == the CANONICAL value derived from firm_config (revert to the literal-50 → red). (c) Consumer suite green (survival pytest + routes/survival tests). (d) tsc exit 0; 3 CI gates; `test:metrics` unchanged. (e) Independent doer≠grader grade.

## 5. Rollback
Single revert; no migrations/flags/data.

## Plain-English for the operator
One file that grades "would this strategy survive this prop firm" was carrying its own hand-typed copy of the firm rules, and it had drifted (it thought MFFU allows 50 micros; the real limit on your plan is 40). Every number it disagrees with the canonical rules on makes the survival gate grade against the wrong firm. This change makes that file READ the canonical rules instead of keeping its own copy, so it can never drift again — same pattern we used for the gate-cost analyzer.

---

## ADDENDUM F-2 (2026-07-17, post-grade closure) — prop_compliance.FIRM_CONFIGS sync to canonical

**Trigger:** Independent W3B grade (band 7 SAFE-TO-LAND) found a SECOND hand-typed firm-rule duplicate outside the rules-version hash: `src/engine/prop_compliance.py::FIRM_CONFIGS`, drifted from canonical `src/engine/firm_config.py::FIRM_RULES`. Instrument-adjacent (backtester-consumed eval-gate inputs); this addendum + the grade cycle is its ratify trail. Scope is a minimal value sync + anti-drift lock — NOT a derived-view refactor of the live compliance file.

**Drifts synced (MFFU `mffu_50k`; Topstep already aligned):**
1. `min_trading_days` 5 → **1** (canonical firm_config.py Builder eval 1-day minimum). LIVE-consumed: `prop_sim.py` (`min_days = firm.get("min_trading_days", 1)`) gates `eval_passed` / `days_to_pass_eval` in every backtest's prop-firm simulation.
2. `consistency_rule` "mffu_50pct" → **"mffu_50pct_sim_payout"** (canonical rule name; was neutralized downstream by monte_carlo's defensive map — aligned anyway).
3. `min_payout_days` 5 → **2** (canonical Builder 2 qualifying days/cycle; no consumer found — aligned anyway).
4. Label: "MFFU 50K (Core)" → "MFFU 50K (Builder)" (operator plan, 2026-06-23).

**Honest semantic effects (on RE-RUN sims only; historical rows untouched):**
- MFFU simulated evals can pass EARLIER: the 1-day minimum replaces the wrong 5-day gate in `eval_passed`/`days_to_pass_eval`. This is the canonical truth per the Builder plan — the old 5 was over-strict fiction.
- The rename deliberately DE-ACTIVATES `prop_sim.py`'s legacy `== "mffu_50pct"` consistency flag for configured firms (branch retained for explicit legacy callers, documented in-code). This ALIGNS the legacy daily-statement sim with the canonical semantics: `mffu_50pct_sim_payout` applies only at the discrete sim-funded payout stage, which that sim does not model — mirroring the explicit skips in `monte_carlo.simulate_firm_survival` (B14, deepscan5 2026-06-29) and `prop_compliance.run_prop_compliance` (`enforce_mffu_consistency=False` default).
- Newly-reached-code check (per the 2026-07-16 additive-fix rule): the rename would have MISLABELED MFFU consistency failures as "Topstep" in `prop_compliance.py` (rule-name equality used for the label); fixed by deriving the label from `firm_key`.

**Anti-drift lock:** `src/engine/tests/test_prop_compliance.py::TestFirmConfigsAgreeWithCanonical` — every overlapping field (12-field map incl. `ongoing_fee`→`ongoing_monthly_fee`) must equal its canonical counterpart; fail-loud listing EVERY mismatch; plus a same-key-set check and a guard-the-guard coverage floor (>=10 overlapping fields per firm). This is the agreement lock the rules-version hash does not provide.

**RED-proof (demonstrated):** reverted `min_trading_days` to 5 → test failed with `mffu_50k.min_trading_days: prop_compliance=5 != canonical firm_config.min_trading_days=1`; restored → 23/23 green.

**Verification:** tsc exit 0; survival/payout/agreement/profit-tier suites green; `test:metrics` 145 passed / 0 failed (no golden shift → no reserved-class HOLD); parity 216/216; 3 CI gates green.

**Rollback:** single revert; no migrations/flags/data.
