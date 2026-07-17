# W3B A/B Receipt — firm_profiles.py subordination to canonical firm_config.py

**Date:** 2026-07-17 · **Worktree:** `wt-w3b-propfirm` @ base `17ae16dd` · **Packet:** `docs/ratify-packets/w3b-firm-profiles-subordination-2026-07-17.md`

## What changed

`src/engine/survival/firm_profiles.py::FIRM_PROFILES` was a hand-typed copy of firm
rules ("verified 2026-05-19") that had drifted from the canonical hash-versioned
`src/engine/firm_config.py`. It now DERIVES every firm-rule value from the canonical
structs at import time (derived-view pattern, mirroring W2's `gate_block_analyzer`).
Dict shape unchanged; consumers (`survival_scorer.py`, `survival_comparator.py`,
`survival_twin_replay.py`, `routes/survival.ts`) read the same keys.

### Field → canonical-source mapping

| Profile field | Canonical source | BEFORE (drifted) → AFTER (canonical) |
|---|---|---|
| `max_contracts` | `FIRM_CONTRACT_CAPS[firm_key]` | MFFU 50/50/50 → **40/40/40** (Builder: 4 minis / 40 micros); Topstep 50 = 50 (aligned) |
| `commission_per_side` | `FIRM_COMMISSIONS[firm_key]["MES"]` (MES = representative; MES == MNQ at both firms) | MFFU 0.62 → **0.95**; Topstep 0.37 → **0.62** |
| `consistency_threshold` | `FIRM_RULES[firm_key]["consistency_rule"]` via `_CONSISTENCY_RULE_THRESHOLDS` (`topstep_50pct` → 0.50, `mffu_50pct_sim_payout` → 0.50; unknown rule = loud import failure) | Topstep None → **0.50**; MFFU 0.50 = 0.50 (aligned) |
| `daily_loss_limit` | `FIRM_RULES[firm_key]["daily_loss_limit"]` | MFFU None → **1000** (4th drift, surfaced by the derivation — Builder $1,000 DLL; canonically a SOFT pause, so scoring it as breach-able is the conservative direction); Topstep 1000 = 1000 |
| `max_drawdown` | `FIRM_RULES[firm_key]["max_drawdown"]` | 2000 = 2000 both (aligned) |
| `drawdown_type` | `FIRM_RULES[firm_key]["trailing"].upper()` | "EOD" = "EOD" both (aligned) |
| `payout_split` | `FIRM_RULES[firm_key]["payout_split"]` | MFFU 0.80 = 0.80; Topstep 0.90 = 0.90 (aligned) |
| `eval_cost_monthly` | `FIRM_RULES[firm_key]["monthly_fee"]` | 77 / 49 = 77 / 49 (aligned — packet guessed this was profile-local; `monthly_fee` IS canonical, so it derives too) |
| `name` | — profile-local (not firm-rule) data | unchanged literal, marked inline |
| `drawdown_locks_at` | — profile-local (not firm-rule) data (canonical only carries the numeric `starting_floor`) | unchanged literal, marked inline |

## A/B on the REAL `survival_scorer` (fixed deterministic inputs)

Runner: scratchpad `w3b_ab_runner.py` — calls `survival_score(daily_pnls, firm, "50K", num_mc_sims=5000)`
(MC seeded, `seed=42` → byte-stable). Inputs:

- `steady_60d`: `default_rng(42).normal(300, 200, 60)` — profitable, consistent
- `spiky_60d`: 59×$50 + one $5,000 day — engages consistency threshold
- `volatile_60d`: `default_rng(7).normal(150, 900, 60)` — engages DLL breach math

### Composite survival score (0–100; C4 gate blocks < 60)

| Case | BEFORE | AFTER | Δ | Grade |
|---|---:|---:|---:|---|
| MFFU / steady_60d | 96.78 | 96.74 | −0.04 | A → A |
| MFFU / spiky_60d | 82.92 | 77.57 | **−5.35** | A → B |
| MFFU / volatile_60d | 28.17 | 10.14 | **−18.03** | F → F |
| Topstep / steady_60d (control) | 96.96 | 96.78 | −0.18 | A → A |
| Topstep / spiky_60d (control) | 82.91 | 77.66 | **−5.25** | A → B |
| Topstep / volatile_60d (control) | 23.70 | 10.14 | **−13.56** | F → F |

### Per-metric drivers (only changed metrics shown)

| Case | Metric | BEFORE → AFTER | Driven by |
|---|---|---|---|
| MFFU / spiky | daily_breach_prob | 100.0 → 73.68 | DLL None → 1000 |
| MFFU / volatile | daily_breach_prob | 100.0 → 9.85 | DLL None → 1000 |
| MFFU / all | commission_drag | −0.4 to −1.0 pts | commission 0.62 → 0.95 |
| Topstep / spiky | consistency | 53.06 → 18.55 | consistency None → 0.50 |
| Topstep / volatile | consistency | 90.46 → 0.0 | consistency None → 0.50 |
| Topstep / all | commission_drag | −0.3 to −0.7 pts | commission 0.37 → 0.62 |

Every delta is in the STRICTER direction — the drifted profile was grading survival
against more lenient rules than the firms actually publish. Note the "Topstep control
≈ unchanged" packet expectation held for the aligned fields (max_drawdown / payout /
caps) but Topstep had its own two drifts (commission 0.37, consistency None), so its
spiky/volatile cases legitimately move too. `max_contracts` (the headline MFFU 50→40
drift) is carried by the profile for downstream consumers but is NOT read by the
7-metric scorer itself — its correction shows up in profile consumers, not in these
score deltas.

### C4 gate impact

`raw_survival_score` (TESTING→PAPER HARD gate, blocks < 60) shifts only on RE-RUN
scoring; historical rows untouched. Borderline strategies near 60 that were passing
on leniency may now block — the honest direction.

## RED-proof

`src/engine/tests/test_survival.py::TestFirmProfilesDerivedFromCanonical` pins every
derived field against firm_config read at test time. Demonstrated: temporarily
reverting `max_contracts` to the literal `{"MES": 50, "MNQ": 50, "MCL": 50}` →
`test_mffu_max_contracts_equals_canonical` FAILED (`{'MES': 50} != {'MES': 40}`);
restored → 45/45 green.

## Also fixed in the same file/wave (siblings)

- `firm_profiles.py` had NO `__main__` CLI, so `routes/survival.ts GET /firm-profiles`
  (which runs `python -m src.engine.survival.firm_profiles`) failed on every request and
  served a hard-coded fallback listing the 8 LEGACY firms. Added a `main()` (action
  "list") and corrected the fallback to `["MFFU", "Topstep"]`.
