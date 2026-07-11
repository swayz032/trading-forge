# Hardening Machine Rails + Surface Tiering — Design Spec

**Date:** 2026-07-11
**Status:** APPROVED by operator (this date) — "Rails + tiering" posture selected over "rails only" and "mega-scan first".
**Operator decisions baked in:** (1) CI runs on a **self-hosted WSL2 runner on the tower** ($0; coupling caveat accepted — see Rail 1 §risks); (2) FROZEN tier list adopted **as proposed** (operator is non-technical and delegated the list; every entry is reversible by saying "unfreeze X" — no code consequence, it only redirects hardening attention); (3) **every heavy rail job MUST use the soak harness's tower-idle guard pattern** (operator mandate 2026-07-11: "checks to make sure nothing running on the tower first" — the tower has 8 GB VRAM / 32 GB RAM and concurrently hosts agent campaign work like extraction/backtest builds). See §4b.
**Governance:** every rail is NON-INSTRUMENT (CI, telemetry, read-only reports, test-only additions). Nothing here alters engine behavior, gates, sizing, or measurement outputs. Any future item that would (e.g. wiring a VIX feed) still requires its own ratify packet per the `ratify-packet` skill. The held packets (3/4/5, PC-1) are untouched by this program.

---

## 1. Problem statement & evidence

Hardening time has been consumed by five recurring patterns (receipts in AGENT-LOGS):

1. **Episodic from-zero scanning** — ~24 deep-scans between 2026-06-27 and 2026-07-10; scan #23's fix wave was almost fully duplicated by a concurrent 200-commit wave. Marginal yield is collapsing while cost stays O(codebase) per scan.
2. **False-green tax** — zero DB-integration coverage made green CI structurally blind (B14 ruin-CI silent scalar fallback, B15 flag, composite-shadow); the correct response (doer≠grader re-verification waves, 19-agent workflows) is expensive precisely because a single green can't be trusted.
3. **Dormant features found months late** — VIX-margin "DEFAULT ON" but production-unreachable; PM-taper unwired; partial-fill backtest-only; SHADOW ladder dead-end. Nothing self-reports dormancy.
4. **Git-topology furnace** — 87-vs-214-commit 3-way divergence, ~50 orphaned worktrees, voided stale-base merge, 846-line wrong-base revert. Divergence discovered at 214 commits because nothing watches at 10.
5. **No trustworthy full signal** — Windows vitest full-suite crashes (tinypool OOM); no session has ever ended with a machine-verified whole-suite verdict; 16 `check:*` gates exist but only run when an agent remembers.

**Core shift: from hunting bugs with agent labor to fencing them with machinery.** Bugs must be unable to LAND silently (CI), unable to HIDE dormant (engagement telemetry), instantly LOCALIZED when introduced (nightly certificate diff), and unable to RECUR (class → mechanical rule).

## 2. Success metrics

| Metric | Before | After |
|---|---|---|
| Time-to-detect a landed regression | next deep-scan (days-months) | <15 min (CI) / <24 h (rig) |
| Re-certification cost | 19-agent from-zero workflow | one script run over the evidence ledger |
| Dormant default-ON feature discovery | months (scan luck) | ≤7 days (zero-engagement report) |
| Branch divergence discovery | 214 commits | ≤10 commits (daily alarm) |
| Full-suite verdict | never achieved | every push (fast lane) + nightly (full lane) |

## 3. Rail 1 — CI on every push (self-hosted WSL2 Linux runner)

**Runner:** GitHub Actions self-hosted runner inside WSL2 (Ubuntu) on the tower. Private repo (`swayz032/trading-forge`) so the public-repo self-hosted security caveat doesn't apply; still restrict Actions to this repo's own workflows in repo settings.

- **Resource caps (mandatory):** `.wslconfig` limits WSL2 to ~8 GB RAM / 4 cores so CI can never starve TradingForgeAPI/Ollama (32 GB tower). Runner configured `--concurrency 1` equivalent (one job at a time; default for a single runner).
- **Boot survival:** WSL2 does not autostart — a Windows scheduled task at startup launches the runner (`wsl -d Ubuntu -- <runner>/run.sh`), so it survives the 03:00 nightly-maint restart. Runner label: `[self-hosted, linux, wsl-tower]`.
- **Accepted risk (operator-chosen):** the CI verdict is coupled to the tower — tower down ⇒ CI down. Mitigations: the fast lane is also runnable locally pre-push (scripts already exist); flipping `runs-on` to GitHub-hosted later is a one-line change if this ever hurts.

**FAST lane** (`.github/workflows/fast.yml`, on: push, all branches):
1. `tsc --noEmit` (real binary, exit code checked directly — never piped).
2. All 16 existing `check:*` scripts (the 3 CI hard gates + 13 parity/contract checks).
3. Full **vitest** run (Linux sidesteps the Windows tinypool OOM) → compared against the baseline manifest.
4. Fast **pytest** tier (golden fixtures / metric snapshots; vectorbt mocked per the pinned collection-hang trap).

**FULL lane** (`.github/workflows/full.yml`, nightly + manual dispatch): complete pytest including slow/integration tiers, the 2-pass PGlite fresh-bootstrap migration replay, `test:full-fleet` vitest config. **First step is the tower-idle guard (§4b)** — busy → exit "skipped: tower busy" with a Discord line; scheduled outside the 03:00–09:00 soak quiet window (default 22:00 tower-local, finishing before the 23:30 rig). GPU-dependent tests (pennylane lightning.gpu / qiskit-aer paths) are excluded in CI via the baseline manifest — the WSL2 runner has no GPU passthrough and must never touch the tower's VRAM.

**Baseline-failure manifest** (`ci/baseline-failures.json`, tracked): the list of currently-known failing tests. CI diffs actual failures against it — a NEW failure is RED; a fixed one emits a nag to shrink the manifest. This makes the pinned fact "a raw failure count is meaningless until classified" permanently machine-enforced.

**Collection floor:** per-suite collected-test count must be ≥ a recorded floor (tracked in the manifest file). Kills the "13 files crash at collection = 0 tests silently pass" class.

**No production secrets in CI.** Tests use pglite in-process + mocks. Anything requiring secrets/data lives tower-side in Rail 2. `.env` never reaches the runner checkout beyond what tests already stub.

**Bring-up plan:** first Linux runs will surface environment diffs (paths, line endings, missing fixtures). Quarantine each into the manifest with a reason string, then burn the manifest down. Estimated 1–2 sessions to stable green.

## 4. Rail 2 — Nightly Certification Rig (tower-side)

A scheduled job in the existing tower pattern (peer of TF-Tower-Soak / nightly-maint): fires **23:30 tower-local**. NOT 04:00 — the soak harness owns a 03:00–09:00 QUIET window (its measurements require an idle tower; rig backtests inside that window would mark every soak night busy/INVALID and destroy the green-streak evidence). 23:30 also clears the 03:00 nightly-maint restart. Start and every 5 minutes mid-run, the rig consults the tower-idle guard (§4b): busy at start → SKIP (one Discord line, no certificate); busy mid-run → graceful ABORT → certificate marked INVALID (never graded, never diffed — mirrors soak semantics; SKIP/INVALID nights never fabricate a comparison, the next clean night simply diffs across a 2-day commit range).

**Stages (all pinned, all dry-run):** pinned data slice (recorded snapshot hash) + pinned seeds through the real code paths:
1. *(v2 — not in rig v1)* Extraction probe on the existing 5-fixture parity set (gemma4:e4b-it-qat) — field-level output captured.
2. Graduation + DSL compile of a fixed candidate set.
3. Fixed backtest battery — canonical strategies × MES/MNQ/MCL.
4. Full promotion-gate chain evaluation (WFE/PBO/B14/B15/BIF/etc. readers on the battery outputs).
5. Paper-sim replay of one fixed historical day.

**Certificate:** one JSON per night in `data/certificates/` (gitignored dir; data lives on tower disk) — every number produced (trade counts, P&L, gate verdicts, extraction fields, snapshot hash, seeds, HEAD SHA). **Diff engine** compares tonight vs the last clean night: any numeric drift without a code-change explanation ⇒ Discord CRITICAL with the exact numbers + the commit range since the last clean certificate. Zero drift ⇒ one green digest line.

**Rules:** dry-run flags throughout (replay-harness convention — no prod-table writes); no `Date.now()`-dependent paths in the rig itself; nondeterminism discovered by the rig is itself a P1 finding (replay-determinism is a claimed institutional property).

## 4b. Shared component — Tower-Idle Guard (adopted from the soak harness)

The soak harness (spec `wt-soak/docs/superpowers/specs/2026-07-11-soak-harness-design.md`, guard `wt-soak/scripts/soak/soak-guard.cjs`) already solved "don't run heavy work when the tower is busy" as a PURE, fail-closed decision function. The rails ADOPT it verbatim as the standard preflight for every heavy job. Decision order (first match wins):

1. **Operator switch** (`system_parameters` rows, soak pattern): mode `off` → SKIP; `skip_until` in the future → SKIP; switch unreadable → SKIP (fail-closed — never run under uncertainty).
2. **Backend unreachable** → SKIP/ABORT (itself a finding, one Discord line).
3. **`/api/health` `backtestConcurrency.active > 0`** → busy.
4. **Python worker processes present** (`Get-Process`) → busy — catches agent campaign work (extraction batteries, backtest builds) even when the API's own counter reads 0.
5. **GPU util > 25% sustained** (`nvidia-smi`) → busy — catches gemma extraction holding the 8 GB VRAM.
6. Else → RUN. Phase semantics: busy at START → SKIP; busy MID-RUN (re-check every 5 min) → graceful ABORT, output marked INVALID.

**Vendoring note:** `wt-soak` is an UNLANDED, LOCKED worktree — its files are not on `hardening/phase-0` yet. The rails build vendors the 20-line pure `decide()` into a shared `scripts/lib/tower-idle-guard.cjs` (credited to the soak harness in-file); when wt-soak lands, the two unify into one module in the same commit. The soak harness's own DI-tested guard tests (`soak-guard.test.mjs`) are the template for the rails' guard tests.

**Who consults the guard:** the nightly certification rig (Rail 2, start + mid-run); the CI FULL lane (Rail 1, pre-job step — busy → exit "skipped: tower busy" + Discord line, next nightly attempt covers the gap); the engagement-report and divergence-alarm crons do NOT (they are one-query lightweights). The CI FAST lane does NOT consult the guard — it is small, CPU-only, and hard-capped by `.wslconfig` (≤8 GB / 4 cores), so it cannot contend for VRAM or starve campaign work; if experience shows otherwise, adding the guard step is a one-line change.

**Scheduling dead zone:** no rail job may be scheduled inside **03:00–09:00 tower-local** — that window belongs to the soak harness's quiet measurement. The rails and the soak are complementary instruments (rails measure correctness, soak measures endurance); they must never invalidate each other.

**WSL blind-spot + nightly ordering:** the guard's python-process check runs `Get-Process` on Windows and CANNOT see inside the WSL2 VM (Linux processes appear only as `vmmem`) — so the guard cannot detect a still-running CI FULL lane. Therefore the two heavy nightly jobs are ordered STRUCTURALLY, not by detection: one tower-side nightly sequence triggers **FULL lane (22:00) → wait for completion → certification rig (no earlier than 23:30)**, single-file. The `.wslconfig` cap (≤8 GB / 4 cores) bounds the worst case if ordering ever breaks, but sequence-by-construction is the contract.

## 5. Rail 3 — Engagement telemetry + contract registry

- **Feature ledger** (`docs/feature-ledger.json`, tracked): machine-readable list of every default-ON feature/gate — name, expected audit action(s), tier, liveness expectation. This is CLAUDE.md §12 as checkable data; doc-drift becomes testable.
- **Zero-engagement report:** weekly cron queries audit_log/Prometheus per ledger entry and posts every default-ON feature with 0 real engagements in 7 days (FROZEN-tier entries listed but exempt from alerting). The VIX-margin dormancy class self-reports in week one.
- **Contract registry:** extend the existing `check:gate-contract-keys` + gate-chain pglite pattern into a declared producer→consumer key registry covering the JSONB seams (`walk_forward_results`, `risk_metrics`, `entry_quality`, `b15_battery`, `exit_plan_config`, …). CI fails on unregistered new seams. Kills the wrong-key grandfather-pass class.

## 6. Rail 4 — Metamorphic engine properties (test-only)

New pytest files in `src/engine/tests/` (vectorbt mocked per pin):
1. **No-look-ahead metamorphic** (`test_metamorphic_no_lookahead.py`): run signal generation on a series; mutate ONLY bars after time t; assert every decision at ≤ t is bit-identical. Run across all archetypes + compiled DSL outputs. (Would have auto-caught the breaker/unicorn window bug.)
2. **Seed determinism** (`test_seed_determinism.py`): identical config + seed ⇒ bit-identical result hash.
3. **Fill sanity property:** every fill within its bar's [low, high]; structural-stop ceiling-skip always honored.

## 7. Rail 5 — Coordination automation

- **Divergence alarm:** daily cron — `git fetch` + compare tower-local vs origin on `hardening/phase-0` and `main`; skew >10 commits or non-FF state ⇒ Discord WARN. Implement as in-process scheduler cron; if the NSSM service account lacks git/SSH creds, fall back to a Windows scheduled task + PS script (same alert path).
- **Worktree TTL report:** weekly — worktrees >7 days old with unique-commit counts (productize the 2026-07-10 audit logic).
- **Scan-policy change (docs + deep-scan skill):** deep-scans become signal-triggered and DIFF-SCOPED (since the last clean certificate). Whole-board from-zero sweeps become a quarterly certification event, not the discovery mechanism.

## 8. Surface tiering

Mechanism: `docs/subsystem-tiers.json` (tracked), read by the deep-scan skill for default scope and by the engagement report for alert exemption. Moving a subsystem between tiers is a one-line edit + operator say-so — fully reversible, zero runtime effect.

| Tier | Meaning | Members |
|---|---|---|
| **CORE** | full rails + scan budget | data/S3 loading, engine (backtester, indicators, exits, stops), promotion-gate chain, lifecycle-service, paper-signal + paper-execution, broker-router, kill switches + DLL ladder, audit_log/recon, money-path crons, boot-migration runner, relay + auth |
| **ACTIVE** | own certification lane (campaign-governed) | extraction conveyor (exam/battery machinery already frozen-doc-governed) |
| **FROZEN** | advisory-only; zero scan/hardening budget; listed-but-exempt in engagement report | quantum RL/IAE challenger stack, composite health, critique-RAG, pattern aggregator, Carter, Anam persona, fade-the-losers, Slumhouse cosmetics beyond Office controls, Pine/family lane (until family onboarding resumes — its parity tests STAY in CI) |

FROZEN ≠ deleted and ≠ disabled: existing tests keep running in CI (cheap); the tier only stops new hardening investment there.

## 9. Sequencing, effort, RED-proofs

| # | Deliverable | Est. sessions |
|---|---|---|
| 1 | Rail 1 fast lane + baseline manifest + WSL2 runner | 1–2 |
| 2 | Rail 5 divergence alarm + worktree TTL (same session as #1) | 0.5 |
| 3 | Rail 2 nightly rig v1 (battery + gate chain + certificate diff; extraction stage in v2) | 2–3 |
| 4 | Rail 3 feature ledger + engagement cron + registry extension | 1–2 |
| 5 | Rail 4 metamorphic tests | 1–2 |
| 6 | Tiering file + deep-scan skill scope change + CLAUDE.md pointer | 0.5 |

Total ≈ 6–10 sessions ≈ the cost of ~3 deep-scans, permanent payoff.

**Every rail ships with a RED-proof** (house convention — a detector without a proven-red path is a false green):
- CI: a deliberate type error + a new failing test + a skipped test file must each go RED (type check, manifest diff, collection floor).
- Rig: perturb one seed ⇒ diff fires with correct commit-range attribution.
- Engagement: seed a fake ledger feature whose action never occurs ⇒ report lists it.
- Registry: an unregistered seam key in a fixture ⇒ check fails.
- Metamorphic: temporary branch with an injected future-bar read ⇒ test fails.
- Divergence alarm: synthetic ref N commits back ⇒ alarm fires.
- Tower-idle guard: DI-fed busy samples (backtests active / python workers / GPU 80% / switch off / unreadable switch) ⇒ SKIP or ABORT in every case, RUN only on the all-quiet fixture (template: `soak-guard.test.mjs`).

## 10. Non-goals

- Does NOT touch the held ratify packets (3/4/5, PC-1) — operator-gated as before.
- Does NOT alter any instrument surface; instrument changes still require packets regardless of what a rail reports.
- Does NOT make a faithfully-implemented-but-wrong strategy right — spec-level correctness stays with the extraction campaign's fidelity lanes.
- FROZEN-tier defects stay frozen, not fixed, until the operator unfreezes the subsystem.
