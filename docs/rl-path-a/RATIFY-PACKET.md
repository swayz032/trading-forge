# RATIFY PACKET — RL Path-A: make regime-conditioned training REAL

**Status: STAGED 2026-07-17. NOT ratified. NOT started.**
Ratification preconditions (advisor ruling 2026-07-17): (1) round-2 independent
grade returns PASS on the things this packet builds on — repaired DB, recording
fix, and the cage (cage verification was ADDED to the running grader's scope;
prior "held up under scrutiny" was self-adjudicated and is hereby retracted as
evidence); (2) the three attachments below exist as artifacts (they do — §A/§B/§C);
(3) operator word "ratify".

Per ratify-packet skill: this is instrument-surface work (RL state features,
labels, training data path — numbers a future capital-allocation decision will
trust). Staging is the receipt; the independent grade is the gate; the operator
holds standing veto.

---

## 1. What & why now (receipts)

The quantum-RL challenger's regime-conditioned training arm has never trained on
a single bar. Receipts, all independently re-runnable:

- `load_backtest_bar_data()` (src/engine/replay/db_loader.py:898-913) returns flat
  bar dicts with NO `institutional_regime` key → `train_regime_conditioned_policies`
  grouped zero bars → `{}` → CLI exit 0 → runner recorded "completed success" +
  reset the circuit breaker. False-green CLOSED in goalscan-r2 commit `ec3940d3`
  (three-way exit contract 0/1/3 + non-paging degraded branch; pytest 6/6 + vitest 3/3).
- The enrichment function that would fix it, `_load_production_state_at()`
  (src/engine/quantum_rl_agent.py:220-236), SELECTs bias_state columns
  {state, confluence_score, institutional_regime} that exist in NO migration —
  it would throw if wired in. Its unit tests pass because they mock the cursor.
  Guarded by `schema-contract-canary.test.ts` KNOWN_READER_DRIFT ledger (this
  packet owns emptying that ledger).
- bias_state persistence was silently dead 2026-05-24 → 2026-07-17 (migration
  0134 DDL never executed live; writer INSERT threw daily into a swallowed
  logger.warn). Root-cause FIXED in commit `0f29f90a` (migration 0203 applied,
  live drift canary NO-DRIFT 110 tables/1430 cols, boot canary armed).
- `backtest_trades` = 0 rows (live query 2026-07-17): there is NO training
  substrate yet, of any label quality.

Why now: the operator has declared the RL A/B verdict ("is quantum RL better
than baseline?") a first-class product requirement. The evidence machine must be
institutional-grade BEFORE data starts flowing, because post-hoc fixes
re-baseline evidence.

## 2. Blast radius

- Changes what the RL challenger LEARNS FROM (state vector + regime labels) →
  changes the eventual A/B verdict → this is the decision surface the operator
  will use to allocate attention/capital to quantum RL. Nothing else consumes
  these outputs (RL is advisory/challenger-only; composite-health 13th subsystem
  feed remains null until DSR/kill-switch gates pass).
- Invalidates nothing frozen: retro-tag audit (§C) proves the citation set of
  the hollow era is EMPTY. Provenance is clean from bar one.
- No live default changes; no live-capital surface (pre-live system).

## 3. The exact change, scope-locked

IN SCOPE:
1. **Reader rewrite**: `_load_production_state_at()` bias_state query → real
   schema (`regime_label`, `regime_evidence`, `evidence`, `structure_state`,
   `narrative_state`, `htf_narrative`, `created_at`). The `state`/`confluence_score`
   field mappings must be VERIFIED against what bias-state-service.ts actually
   writes into `evidence` JSONB — verified mapping, not a guess. Acceptance:
   `KNOWN_READER_DRIFT` ledger in schema-contract-canary.test.ts shrinks to ∅.
2. **Point-in-time label backfill job**: batch job computing institutional
   regime labels as-of each historical bar from S3 archive OHLCV + persisted
   `economic_release_dates`, using the production classifier
   (`classify_institutional_regime`) + a resolved fall-through path for the
   classic TRENDING/RANGE arms (compute_bias trailing inputs). Mechanism
   demonstrated by §A. Labels persisted with provenance stamps (dataset_hash,
   classifier version, computed_at).
3. **Batched enrichment** of training bars in `load_backtest_bar_data()` with
   the backfilled labels (set-based join, not per-bar queries).
4. **Coverage-abort rule (graded runs)**: any CERTIFIED/graded training or
   evaluation run ABORTS (does not degrade) when label coverage < pinned
   threshold. The exit-3 degrade path shipped in `ec3940d3` remains DEV/advisory
   behavior only and is structurally non-citable (status `skipped_regime_unwired`,
   never `completed`).
5. **Pre-registration** of H_RL-institutional (§4).

OUT OF SCOPE: any coarse/macro_regime training tier (fork resolved A-only, §B);
any change to the cage/governance (RL stays advisory-only); any promotion-gate
wiring; extraction/backtest throughput work (different queue — see critical-path
note in §4).

## 4. Verification plan & pre-registration skeleton (H_RL-institutional)

- **Separate registration.** H_RL-institutional is its own hypothesis. It is not
  a rider on H2, and no coarse hypothesis exists to "cure" (none was ever
  registered). If a coarse tier ever revives, it registers separately and its
  FAIL/PASS is frozen independently.
- **Evidential units, calendar derived**: the contest is pinned in trades /
  regime transitions / folds — not days. Sufficiency floors (proposed; advisor
  to countersign or amend):
  - ≥ 100 bars per regime per policy (existing `_REGIME_MIN_BARS=100` code floor);
  - ≥ 30 closed trades per arm per regime cell before any per-regime claim;
  - ≥ 20 observed regime TRANSITIONS in the evaluation window;
  - sparse-cell rule: regime×session cells with N < 50 in training data are
    COLLAPSED into their regime parent (no per-cell policy) — pre-decided, per
    §A's min_cell_n=3 finding, not tuned after results.
- **Seeds**: k=5 seeds; MEDIAN-of-k is the primary aggregation, WORST-of-k
  reported alongside. Single-seed wins are not survivors. (Advisor to
  countersign k and aggregation — question standing.)
- **Two evidence tiers, roles pinned in advance**:
  - *Historical walk-forward tier — SCREEN ONLY.* The strategy pool is extracted
    from educator content that postdates historical windows; an adaptive learner
    exploits lookahead-inflated regularities harder than a fixed baseline
    (source-symmetric taint, asymmetric exploitability). Therefore a FAIL here
    is CITABLE (could not win even with taint in its favor); a PASS is
    STRUCTURALLY NON-CITABLE and unlocks nothing but the prospective run.
  - *Prospective tier — CROWNS.* Evidence class: paper/shadow forward window
    (declared per run: shadow-live vs paper vs rolling-backtest are different
    animals and are never pooled).
- **Baseline symmetry**: the production baseline is regime-blind, so a naive A/B
  confounds feature-value with learning-value. Registration will either (a) add
  a rule-based regime-aware third arm to decompose, or (b) state the confound
  explicitly and scope the claim to "the RL package including regime features
  vs production" — decided at registration time with the advisor.
- **Slippage stress as gate**, not garnish: the winner must survive the
  documented slippage stress battery.
- **Abort-not-degrade** in graded runs (see §3.4).
- Standard packet verification: doer≠grader agent-loop on every implementation
  commit; RED-proof tests; parity where TS/Python mirror.

## 5. Rollback

- Reader rewrite + enrichment ship behind `RL_REGIME_ENRICHMENT_ENABLED`
  (default OFF) — flipping OFF restores today's honest-degraded behavior
  (exit 3, `skipped_regime_unwired`).
- Backfilled labels live in their own table/columns with provenance stamps —
  droppable without touching bar data.
- No frozen refs altered (nothing cites the hollow era, §C).

---

## §A. ATTACHMENT — Feasibility artifact (demonstrated, not forecast)

Full JSON: `docs/rl-path-a/feasibility-artifact-2026-07-17.json`
(generated by `scripts/rl_label_backfill_feasibility_probe.py` — re-runnable).

Sample window: MES 15min, 2026-01-02 → 2026-03-06 (4,176 bars, data-quality
gate PASSED, 0 violations, dataset_hash `43ead664…`).

| Check | Result |
|---|---|
| Point-in-time computation | 4,145 bars labeled from tail-slices only (production classifier + production helpers; no smoothing, no retro reclassification) |
| Input null rates | atr_percentile 0.0 / volume_ratio 0.0 / range_vs_atr 0.0 |
| Macro event flag source | `economic_release_dates` (persisted; 416 rows 2024-01→2027-12; 21 releases on 17 dates in window) |
| Label cardinality | 5 (4 institutional arms + _PASS_THROUGH) |
| Distribution | _PASS_THROUGH 2079 (50.2%) / LOW_LIQ_CHOP 1266 / COMPRESSION 381 / HIGH_VOL_MACRO 222 / EXPANSION 197 |
| Face validity | LOW_LIQ_CHOP ⊂ asian+overnight only (globex, as designed); HIGH_VOL_MACRO clusters pre_market+ny_am (event windows); EXPANSION peaks ny_am |
| Regime transitions | 1,067 in-window |
| min cell N | 3 (HIGH_VOL_MACRO × overnight) → drives the pre-decided collapse rule in §4 |

Honest limitations recorded:
1. **_PASS_THROUGH = 50.2%** — the classic TRENDING/RANGE/NO_TRADE arms resolve
   in `compute_bias` (same trailing-OHLCV input class); the backfill job must
   implement that resolution. Mechanism is the same; work is real; feasibility
   is not threatened but the artifact does not yet demonstrate the full-8 label.
2. **Archive END = 2026-03-07** (probe finding; requested window truncation).
   Historical backfill unaffected; labels for RECENT months require the archive
   updater to run — a data-ops dependency, tracked outside this packet.
3. Sample = 2 months of a ~74-month archive (2020-01→2026-03); full-run cell
   counts scale ~37×, but the HIGH_VOL_MACRO×overnight sparsity is structural.

## §B. ATTACHMENT — The fork, stated and anchored

**Path A-only (institutional labels). Anchored by: the engineering agent under
the operator's delegated-operator authority, 2026-07-17, consistent with the
advisor's prior conditional ("backfill feasible → A-only becomes competitive…").**

Reasons: (1) §A proves backfill feasible point-in-time from persisted data —
Path A's calendar cost collapsed to "run a job"; (2) Path B's park criterion,
answered on the record: **what near-term decision would a coarse answer have
changed? NONE —** `backtest_trades` holds 0 rows, so no coarse answer is
computable until backtests flow, and by then institutional labels are computable
for the SAME bars from the archive. Coarse training was not merely weaker; it
was unavailable. **B is dead, not parked.** (3) H_RL-coarse is therefore never
registered; no hypothesis exists to revive or cure.

## §C. ATTACHMENT — Retro-tag audit of the hollow era (clean by vacancy)

Ran 2026-07-17 against the live Railway DB (queries re-runnable):

```
SELECT status, count(*) FROM rl_training_runs GROUP BY status;      → 0 rows
SELECT count(*) FROM quantum_rl_runs;                               → 0 rows
SELECT action, status, count(*), min(created_at), max(created_at)
  FROM audit_log WHERE action LIKE 'quantum_rl.%' GROUP BY 1,2;
  → ONLY quantum_rl.training_skipped_in_rth_window
    (info, n=252, 2026-07-11 → 2026-07-17)
```

No run row, no policy row, no audit action, no report ever cited "RL training
success" during the hollow era — the auto-fire hook triggers on backtest
completion and there were no backtests. **The freeze-invalid set is EMPTY.**
Forward truth-telling was fixed in `ec3940d3`; there are no backward citations
to retract. Provenance is clean from bar one.

---

## Critical-path note (advisor ruling, accepted)

The RL verdict date is gated on **extraction/backtest throughput** (the cert
track's pipeline), not on this packet. This packet makes RL ready for when food
arrives; it transfers NO urgency to the RL queue. Status line, honestly
compressed: **caged, truthful, starving, ungraded** — grade pending on the
round-2 batch; "ratify" unlocks only after grade-PASS + operator word.
