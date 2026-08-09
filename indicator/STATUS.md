# Indicator Verification Status

As of 2026-08-09.

## Current classification

- Software stage: `PROTOTYPE / REFERENCE_VERIFICATION IN PROGRESS`
- Deterministic Python reference architecture: active
- Institutional/enterprise-grade status: **ENGINEERING TARGET, NOT YET ATTESTED**
- Market edge: **NOT YET PROVEN**
- TradingView Pine parity: **NOT YET PROVEN**
- FX Replay parity: **NOT YET PROVEN**
- Live shadow approval: **NOT GRANTED**
- Live-decision-support approval: **NOT GRANTED**
- Draft PR: #34 remains unmerged by design

## Latest CI evidence on PR head

Indicator-specific GitHub Actions verification is green on commit `83c5e1f92e887d3a720f8096c366c92c6019a395`.

`Indicator Reference Verification` run `31333497277`:

- same **97-test discovery suite PASS** under Python 3.11 / `PYTHONHASHSEED=0`
- same **97-test discovery suite PASS** under Python 3.11 / `PYTHONHASHSEED=42`
- same **97-test discovery suite PASS** under Python 3.12 / `PYTHONHASHSEED=0`
- same **97-test discovery suite PASS** under Python 3.12 / `PYTHONHASHSEED=42`
- compileall passed in the matrix
- verification manifests were emitted and uploaded as CI artifacts
- indicator tree fingerprint recorded by the matrix: `ef8a69274054862e43117842523637709718057375bd9746a28fe4f7a065be81`

The four jobs are four environment/hash-seed executions of the same 97-test suite; they are **not** described as 388 unique tests.

Stress job from the same indicator workflow:

- **250,000 randomized intrabar paths**
- **52,675 entry paths** reached in the random corpus
- **203,419 recoil resets** exercised
- **0 entry-invariant failures**
- stress verification manifest uploaded

`Metric Snapshot Regression` also passed on the same head commit.

## Broader repository CI status

The repository-wide `CI` workflow is currently red on this branch, but not because an indicator reference test failed.

Observed failure in `System Map Drift Check`:

- `SYSTEM-MAP-DRIFT: 1 workflow preflight key mismatch(s)`
- `[exit_parity_probe] code='EXIT_PARITY_PROBE_ENABLED' doc='EXIT_PARITY_PROMOTION_GATED'`
- generated system-map output is reported stale and asks for `npm run system-map:update`

This is a repository-level generated/preflight drift gate and must be resolved or independently proven pre-existing/non-regressed before the indicator can claim a clean enterprise release gate. It is not hidden or waived.

## Executed engineering coverage

Current reference/tests cover, among other things:

- 5-minute live momentum state sequence
- one-event/one-stage invariant
- hard-recoil reset
- slow-push rejection
- Candle-2 -> Candle-3 reference promotion/reset
- duplicate/out-of-order/malformed input fail-closed behavior
- snapshot schema/version fail-closed behavior
- snapshot/restart determinism
- symbol/contract reset
- LONG/SHORT mirror symmetry
- anti-fakeout proof-level selection
- too-close and too-far candidate rejection
- countertrend requires stronger structure than with-trend
- calibrated selection score + deterministic true-tie ordering
- candidate input-order/permutation invariance
- conservative near-side target placement
- context-sensitive close-pool vs next-pool targeting
- strict NQ/MNQ 0.25-point price grid
- off-grid default rejection
- anti-fakeout proof-level directional rounding
- conservative TP directional rounding
- finite/bounded numeric guards against NaN/Inf contamination
- realtime/delayed/stale/gapped/unknown runtime classification
- delayed feed blocked from live-decision-support timing
- confirmed swing no-future-leak behavior
- equal-high/equal-low ambiguity rejection
- deterministic reaction-cluster construction
- single wick is not automatically labeled a reaction pool
- candle geometry invariants
- parameterized doji detection
- direction-normalized wick-rejection and hold features
- explicit recoil fraction, speed, and push-acceleration measurements
- exact ordered-path stop-first vs target-first evaluator
- 69-tick stop distance helper
- MAE/MFE to first exit separated from post-exit/full-horizon excursion
- reaction-zone penetration measurement
- chronological train/validation/holdout split integrity
- rolling walk-forward split with embargo

Previously retained torture evidence also includes:
- 20,000 mirrored paths: 0 symmetry failures
- 5,000 random restart cuts: 0 mismatches
- 50,000 randomized entry-chain cases
- 1,000,000-update reference load run completed

## Institutional / enterprise assurance system now specified

The branch contains an explicit assurance program rather than relying on ad-hoc testing:

- `ENTERPRISE_VERIFICATION_MASTER_PLAN.md` — 22 verification domains + release ladder
- `REQUIREMENTS_TRACEABILITY.md` — requirement -> implementation -> test -> blocker map
- `FMEA_AND_CHAOS_PLAN.md` — 40 documented failure modes + chaos campaigns
- `MUTATION_MATRIX.md` — 34 preregistered semantic mutants
- `CASE_STUDY_PROTOCOL.md` — blind/golden/reject/adversarial case protocol
- `VISUAL_CASE_REGISTER.md` — current screenshots captured as `VISUAL_ONLY`, not misrepresented as executable evidence
- `DATA_REPLAY_CONTRACT.md` — data provenance, intrabar truth hierarchy, gap/roll/session/replay rules
- `OBSERVABILITY_LEDGER_SCHEMA.md` — reason-coded auditable setup/event/outcome ledger
- `SECURE_DEVELOPMENT_PROFILE.md` — secure-development/supply-chain profile
- GitHub Actions matrix + stress + verification-manifest retention

## Important tests not yet executed / still blocked

### Mutation campaign
The mutation matrix is preregistered, but the actual source-mutating campaign has **not** yet been executed. Do not claim a mutation score until the mutants are planted and killed.

### Platform parity
Need actual implementations/runtimes for:
- TradingView Pine vs Python state/reason-code parity
- FX Replay/FXR vs Python parity
- Pine realtime vs reload/repaint behavior
- alerts vs plotted state parity
- resource-limit/capacity behavior on each platform

### Real-market edge
Real NQ/MNQ tick or 1-second ordered intrabar history is required before edge claims. Required gates include:
- reaction-zone revisit vs matched non-zone controls
- nearest-wick vs structural-proof vs Goldilocks proof selector
- cross-only vs BREAK vs PUSH_1 vs PUSH_2 entry comparison
- Candle-2 failure / Candle-3 reset experiment
- 69-tick stop-first vs target-first analysis
- MAE/MFE
- conservative TP penetration study
- regime slicing
- walk-forward / untouched holdout
- sensitivity plateaus
- ablation tests
- bootstrap / Monte Carlo with time/day dependence handled appropriately
- multiple-testing/selection-bias controls where variants are searched
- commission/slippage stress
- live shadow period

No synthetic P&L will be used to claim market edge.

## Release ladder

No level may be skipped:

1. `SPEC_ONLY`
2. `REFERENCE_VERIFIED`
3. `PLATFORM_PARITY`
4. `RESEARCH_VERIFIED`
5. `SHADOW_VERIFIED`
6. `LIVE_DECISION_SUPPORT`

Current position: between `SPEC_ONLY` and `REFERENCE_VERIFIED`. Indicator-specific CI is green, but mutation evidence, the remaining reference gates, and the broader repository CI drift issue still block promotion.
