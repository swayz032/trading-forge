# Fade-the-Losers — Design Spec (Wave B)

**Date:** 2026-07-03
**Status:** Approved (operator "EXECUTE WAVE B" 2026-07-03)
**Phase note:** New capability (overrides §2 no-new-subsystems, operator-authorized). Low-risk: it only *creates CANDIDATEs* that must pass the entire unchanged gate battery to go anywhere — it can wave nothing through to live capital.

## Purpose

Turn the graveyard's proven losers into fresh edge candidates. If a directional strategy *consistently* lost money with statistical significance, its inverse (short a persistent long-loser) may hold real edge. Invert it and run it through the FULL, UNCHANGED battery — survivors earn their place like any strategy. Unique to this pipeline because it has a supply of proven-failed strategies (the 117 just graveyarded + others).

## Cohort — who gets faded (the key decision; all thresholds env-tunable)

Query `strategy_graveyard` joined to `strategies` (for the original config). A strategy is fadeable ONLY if ALL hold:
1. **Directional** — long-only (`entry_short == BIDIR_SENTINEL`) or short-only (`entry_long == BIDIR_SENTINEL`). `direction: both` is **skipped** (no directional bias to flip — it already trades both ways).
2. **Statistically significant loser** — `n_trades >= FADE_MIN_TRADES (default 30)` AND negative edge (`expectancy < 0` OR `profit_factor < 1.0`) from `searchableMetrics` / `backtestSummary`.
3. **Performance failure only** — `deathReason` indicates negative-edge/underperformance. **Skip degenerate deaths**: 0-trades, data-gap/NaN, compliance-block, look-ahead, curve-fit-luck (Frankenstein/PBO), consistency-block. Fading a strategy that failed for a non-performance reason is meaningless (there's no losing *edge* to invert).
4. **Not already faded** — skip `source == 'fade_the_losers'` or `config.faded_from` present. **No fade-of-fade** (prevents an infinite invert loop).

## Inversion — `fade-inverter.ts` (pure function)

Given a fadeable strategy config, produce the inverted config:
- **Swap `direction`** long↔short.
- **Swap `entry_long` ↔ `entry_short`** — the losing long-entry condition becomes the short-entry hypothesis; the now-untraded side becomes `BIDIR_SENTINEL`.
- **Stop / take-profit / Style-C exits are NOT inverted** — they're structural (ATR-bounded stops, R-multiple targets) and flip with `direction` automatically. Inverting them would double-negate.
- **Unchanged:** symbol(s), timeframe, sizing, confluence factors.
- **Provenance:** `config.faded_from = <original strategy id>`, `source = 'fade_the_losers'`, name = original + `_fade` suffix (canonicalized).

Pure, deterministic, no I/O — testable in isolation.

## Creation + battery — no relaxed path

The inverted config is created as a NEW `CANDIDATE` through the SAME gate ladder the graduator/Band-B onboarding use — Gate 1 (`auditBidirectionalCompleteness`) → Gate 2 (`classifyFactorSources`) → framework overlay (`applyFrameworkOverlay`, authoritative) → auditor (`auditGraduatedConfig`) → DSL critic → playbook registration. **No raw INSERT, no relaxed gates.** The faded CANDIDATEs then flow through the normal pipeline (backtest → CPCV/WFE/PBO/DSR/B14/BIF + the Wave-A slippage gate). A fade survivor has passed exactly what every other strategy passes.

**Statistical honesty:** fading doubles the hypotheses tested (selection). Faded strategies are tagged (`source='fade_the_losers'`) so the corpus-FDR report (Band C / D2) counts them in the multiple-testing correction. The fade does NOT get a lighter battery — same rigor, or the survivors are just data-snooped noise.

## Components (well-bounded units)

1. **`src/server/lib/fade-inverter.ts`** — pure config→inverted-config. No I/O.
2. **`src/server/services/fade-the-losers-service.ts`** — cohort selector (graveyard join + the 4 filters) + create-CANDIDATE-through-gate-ladder (reuses the exported gate helpers; never a raw INSERT). Emits audit + provenance.
3. **`scripts/fade-the-losers.ts`** — dry-run default → `--apply`, `--min-trades`, `--limit`, `--cohort` filters. Mirrors Band B's `onboard-compiled-specs.ts` CLI (dry-run reports the cohort + planned inversions; `--apply` creates them).
4. **Provenance / observability** — `config.faded_from` + `source='fade_the_losers'`; audit action `fade.candidate_created` / `fade.skipped_{not_directional,insufficient_trades,degenerate_death,already_faded}`; optional SSE/metric.

## Data flow

`strategy_graveyard ⋈ strategies → cohort filter → fade-inverter → gate ladder (Gate1/2/overlay/auditor/critic/registration) → new CANDIDATE (source=fade_the_losers, faded_from=orig) → normal battery → survivors`

## Config (env, defaults)

| Env | Default | Meaning |
|---|---|---|
| `FADE_MIN_TRADES` | `30` | Min trades for a loser to be "significant" |
| `FADE_MAX_PROFIT_FACTOR` | `1.0` | PF strictly below this counts as losing edge |
| `FADE_EXCLUDE_DEATH_REASONS` | (degenerate set) | Death reasons that are NOT fadeable (0-trade/data/compliance/look-ahead/curve-fit) |

## Testing (no-bad-wiring bar)

- **inverter unit** (vitest): long-only→short-only, short-only→long-only, entry_long↔entry_short swap + sentinel placement, `both`→refuses/skips, provenance stamped, stops/exits untouched, idempotency (faded config detected).
- **cohort-selector unit**: significance filter (min-trades + PF), skip degenerate deathReasons, skip already-faded/faded_from, dedupe (no double-fade of same origin).
- **integration**: a faded config passes Gate 1 (bidirectional completeness) and creates a CANDIDATE row via the real gate ladder (pglite where DB-backed).
- **no-bypass check**: assert a faded CANDIDATE has `lifecycle_state='CANDIDATE'` (bottom of pipeline) and carries no gate exemption — it must traverse the full battery.
- `tsc --noEmit` clean; 3 CI hard gates GREEN; `system-map:sync`.

## Double-check (adversarial, after build)

- `trading-forge-architect` — wiring: reuses the gate ladder correctly (no raw INSERT), provenance chain closed (faded_from → original), source tagging for FDR, no map drift.
- `accuracy-validator` — false-green hunt: can a faded strategy reach live WITHOUT the full battery? (must be NO). Is the no-fade-of-fade loop-guard real? Are degenerate losers actually skipped (not silently faded)? Is the statistical-honesty tag actually consumed by corpus-FDR, or is fading silent data-snooping?
- `code-reviewer` — inversion correctness (direction/entry swap sign), cohort-filter edge cases.

## Out of scope (v1)

- Auto-scheduling (CLI-only, operator dry-run→apply, like Band B; no autonomous fade cron).
- Fading non-directional (`both`) strategies.
- Inverting exit logic (structural exits flip with direction).
- Re-fading (single generation only).
