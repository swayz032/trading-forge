# Timeframe Integrity Fix — Design Spec (CRITICAL)

**Date:** 2026-07-03
**Status:** Approved (operator "execute" 2026-07-03) — CRITICAL data-integrity bug.
**Severity:** Corpus-invalidating. All 120 spec_onboarding strategies are backtested at **5m** regardless of the educator's actual timeframe. A 4h swing strategy tested at 5m is a *different strategy* — it breaks both the edge measurement and the fidelity axis.

## Root cause (verified)

1. The transcript extractor DOES capture timeframe (`transcript-extractor-minimal.md` schema: `higher_timeframe` REQUIRED, `lower_timeframe`).
2. The **compiler drops it** — the compiled `*.spec.json` artifact has NO structured timeframe field (only unstructured prose in `spec.entry_conditions`).
3. `onboard-compiled-specs.ts:58` uses a **single global** `--timeframe` flag defaulting to `"5m"`, applied to ALL specs (`spec-onboarding-service.ts:442` `opts.timeframe ?? "5m"`, self-documented at :343 as "CONTRACT AMBIGUITY: the spec artifact carries no timeframe field").
4. The operator ran onboard without `--timeframe` → **all 120 → 5m.**

Ground truth: `spec_onboarding by timeframe = {5m: 120}`. Old library (proof educators used many): `{15m:45, 5m:30, 4h:15, 1m:15, 1h:9, 30m:3}`.

Deterministic linkage for backfill: each new row carries `config.metadata.spec_hash` + `config.metadata.source_url` → resolves to the `*.spec.json` (which has `video`).

## The principle this enforces

**Never silently default a strategy's timeframe.** A strategy whose timeframe cannot be determined is *quarantined*, not guessed to 5m. Silent defaulting is the bug.

## Fix — four parts

### Part 1 — Forward fix (stop the bleeding; buildable now, no data dep)
- `spec-onboarding-service.ts` + `onboard-compiled-specs.ts`: read a **per-spec** timeframe from the spec artifact (new structured field `exec_timeframe` / `higher_timeframe`), NOT a global flag.
- **FAIL-LOUD**: if a spec has no recoverable timeframe, do NOT default to 5m — reject/quarantine that spec with a loud audit (`onboard.timeframe_unrecoverable`) so it's visible, not silent. Keep `--timeframe` only as an explicit operator override for a known-uniform batch.

### Part 2 — Recover per-video timeframe (the 40)
Build a `video → {exec_timeframe, higher_timeframe}` map. Source priority:
1. **The spec.json's own stated timeframe** — parse `spec.entry_conditions` / prose for the educator's stated execution (trigger/lower) timeframe token (`1m|5m|15m|30m|1h|2h|4h|1d`). The exec timeframe = the *lower/trigger* TF the entries fire on; the higher TF is context (→ `htf_tf`).
2. **Cross-check** against the old-library timeframe where a video maps.
3. **FAIL-LOUD** on any video where the timeframe is genuinely ambiguous — list it for operator/re-extraction, do NOT guess. Report coverage (N of 40 recovered, M ambiguous). If prose-parse coverage is poor, the honest fallback is a targeted timeframe re-extraction (flag, don't fabricate).

### Part 3 — Backfill the 120 (deterministic)
A migration/script joins each strategy via `config.metadata.spec_hash` → recovered map → UPDATE:
- `strategies.timeframe` column (exec_timeframe).
- `config.strategy.timeframe` / `trigger_tf` + `htf_tf` (higher_timeframe) — plug into the existing Wave-25 multi-TF columns.
- `strategies.name` — fix the wrong `_5m` suffix to the real TF.
- Idempotent; audit `strategy.timeframe_backfilled` with old→new per row. Only touches spec_onboarding rows; never overwrites a non-5m value.

### Part 4 — Upstream compiler fix (extraction branch — flag, not built here)
Carry `higher_timeframe`/`lower_timeframe` into the compiled `*.spec.json` structurally so future re-extractions never lose it. Lives on `extraction/100pct-evidence` (separate branch) — documented as the permanent upstream fix + a `check:spec-has-timeframe` guard idea.

## Components

1. `src/server/lib/spec-timeframe-recovery.ts` — pure: given a spec artifact (conditions/prose), return `{exec_timeframe, higher_timeframe, confidence, recovered:boolean}`. No silent default.
2. `spec-onboarding-service.ts` — consume per-spec timeframe; fail-loud path.
3. `scripts/backfill-corpus-timeframes.ts` — dry-run default → `--apply`; join via metadata.spec_hash; report coverage + ambiguous list; UPDATE column+config+name.
4. Migration only if a new column is needed (existing `timeframe`, `trigger_tf`, `htf_tf` likely suffice — verify; add CORE_DDL if any).

## Testing

- pytest/vitest for the recovery parser: each TF token, higher-vs-lower disambiguation, ambiguous → `recovered:false` (never a silent 5m).
- Backfill script: dry-run reports per-strategy old→new; idempotent; skips non-5m; ambiguous strategies quarantined not defaulted.
- Onboarding fail-loud test: a spec with no timeframe → audit + skip, NOT a 5m row.
- `tsc` clean; 3 CI gates GREEN.

## Double-check (adversarial)

- `trading-forge-architect` — the backfill join (metadata.spec_hash→video→map) is correct; no non-spec rows touched; name/column/config stay consistent.
- `accuracy-validator` — **is the recovered timeframe actually the educator's?** Spot-check recovered TFs against the spec.json prose for several videos; verify ambiguous ones are quarantined not guessed; confirm no strategy silently stays 5m-by-default after the fix.
- `code-reviewer` — parser correctness (exec vs htf), backfill idempotency/safety.

## Out of scope (v1)

- The upstream compiler fix (Part 4 — flagged, separate branch).
- Re-running backtests on the corrected timeframes (operator compute, after backfill).
