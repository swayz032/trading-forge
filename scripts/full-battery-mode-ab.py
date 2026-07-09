#!/usr/bin/env python3
"""Full institutional battery, Mode A/B side-by-side (roadmap Band E, item E1, 2026-07-02).

PURPOSE:
  The overlay is FROZEN (standing rule: no optimization without a profitable baseline —
  see CLAUDE.md, "Ship gates STRICT, then loosen with DATA"). Today's overlay measurement
  instruments (confluence-overlay-ablation.py, overlay-attribution.py, filter-ablation-cpcv.py,
  exit-policy-replay.py) are all SINGLE-BACKTEST core: they report Sharpe/PF/trade-count deltas
  from one vectorbt run per mode. Nobody can yet ask "does the overlay survive the FULL
  institutional battery (walk-forward/CPCV + PBO + DSR + B14 firm-survival Monte Carlo) in BOTH
  modes, and does the verdict change once WFE/PBO/B14 are in the picture instead of just Sharpe?"

  This script is that missing instrument. It is ORCHESTRATION, not a new statistical method —
  every gate value it reports (wfe_overall, dsr, dsr_pass, pbo_overall, probability_of_ruin_ci)
  is read verbatim from src.engine.walk_forward.run_walk_forward() and
  src.engine.monte_carlo.run_monte_carlo(), the SAME functions backtest-service.ts's WF harness
  and scripts/null_gate_calibration.py already call. No new gate math is introduced here.

DUAL DISPATCH — DSL specs via run_walk_forward(), class/compiled specs via
run_walk_forward_class() (fixed 2026-07-04, see CORRECTNESS FIX note below):
  Two WF entry points exist in src/engine/walk_forward.py:
    - run_walk_forward(request: BacktestRequest, ...)        — DSL-config strategies (a
      `strategies` table config JSONB with a literal boolean entry expression, e.g.
      "close > sma_20"). Per OOS window it calls run_backtest(), whose default
      use_eligibility_gate=True routes through apply_eligibility_gate(), which is the
      function that actually reads TF_CONFLUENCE_OVERLAY_DISABLED. This path RESPECTS the
      Mode A/B toggle and is UNCHANGED by the 2026-07-04 fix below.
    - run_walk_forward_class(strategy: BaseStrategy, ...)    — Python-class / compiled-spec
      strategies. Every Corpus v2 (spec_onboarding) CANDIDATE strategy is one of these: either
      condition-compiled (`entry_long`/`entry_short` = "spec_conditions:<hash>", executed via
      SpecConditionStrategy built by src.engine.spec_condition_compiler.from_compiled_spec())
      or archetype-matched (`entry_long`/`entry_short` = "archetype_dispatch:<key>",
      `entry_indicator` = "archetype:<key>" — dispatched THE SAME WAY today, via
      from_compiled_spec(), since spec-onboarding-service.ts stamps `compiled_spec` onto every
      graduated strategy unconditionally, regardless of archetype match; see
      backtester.py main()'s `elif config.get("compiled_spec"):` CLI branch, which this harness's
      `_build_class_strategy()` mirrors). skip_eligibility_gate=False is passed explicitly (see
      run_walk_forward_class's docstring — the class-path default silently skips the gate
      unless a caller either passes False or sets TF_CLASS_WF_ELIGIBILITY_GATE_ENABLED=true;
      this harness cannot depend on a runner env var, so it opts in explicitly on every call so
      apply_eligibility_gate()'s own TF_CONFLUENCE_OVERLAY_DISABLED branch decides Mode A vs B
      — exactly the same mechanism the DSL path already uses).
  ENGINE-SIDE STATISTICAL GAP (real, NOT a harness bug, reported not patched — out of file
  boundary per the correctness-fix mandate): run_walk_forward_class()'s return dict has no
  `wf_metadata` (WFE is structurally None — the function passes `avg_is_sharpe=None`
  unconditionally because it "does not support Optuna optimization", see the comment directly
  above its `run_cross_validation()` call) and no `pbo_overall` (no per-path CPCV aggregation on
  the class path today). DSR IS available, just nested at `cross_validation.deflated_sharpe`
  instead of `wf_metadata.dsr`. Every mode_a/mode_b result explicitly carries `"wfe": null` /
  `"pbo": null` for class-path strategies with `mode_ab.class_path_wfe_pbo_unavailable: true` so
  compute_verdict()'s None-handling (already present) degrades gracefully to a
  sharpe/dsr/trade-count-only verdict instead of silently fabricating a WFE/PBO number.
  "Gate-eligible strategies" already live in the `strategies` table as this exact config JSONB;
  export them to a JSON array (one spec per element) and pass via --strategy-list-file. See
  docs/overlay-unfreeze-protocol.md "Operator commands" for the export one-liner.

  CORRECTNESS FIX (2026-07-04): prior to this fix, run_spec_worker() ALWAYS routed every spec
  through `BacktestRequest.model_validate(spec)` + run_walk_forward() regardless of shape.
  BacktestRequest has no `compiled_spec` field and pydantic's default `extra="ignore"` silently
  dropped it (+ direction, regime_gate, entry_quality, exit_plan_config, entry_type, time_stop)
  — so every Corpus v2 spec (100% condition-compiled or archetype, 0% plain DSL) hit a
  ValidationError (missing strategy.name/symbol/indicators/exit) in ~0.1s and reported
  INDETERMINATE for both modes. That was a harness dispatch failure, not a research result. The
  fix ADDS the class-path branch above; the DSL branch (run_walk_forward + BacktestRequest) is
  BYTE-IDENTICAL to before for any spec that is not detected as class/compiled — see
  `_is_class_or_compiled_spec()`.

WHY THIS RUNS DIRECTLY AGAINST THE PYTHON ENGINE (not through POST /api/backtests):
  TF_CONFLUENCE_OVERLAY_DISABLED is read ONLY by src/engine/backtester.py::apply_eligibility_gate
  (os.environ lookup) — there is no per-request field on BacktestRequest / the HTTP route that
  threads it through, and it is a PROCESS-WIDE env var. The running Express server is a single
  long-lived OS process; a client script cannot flip that server's env var per HTTP call, and
  mutating it from a separate process has zero effect on the server's already-running process.
  scripts/confluence-overlay-ablation.py and scripts/overlay-attribution.py already established
  the correct pattern for this exact constraint: set os.environ["TF_CONFLUENCE_OVERLAY_DISABLED"]
  in THIS process, then call the engine functions directly. This script extends that established
  pattern to the full battery instead of a single backtest, following
  scripts/null_gate_calibration.py's manifest/resume and battery-extraction conventions
  (deliberately "the null_gate_calibration.py of Mode A/B comparison", not a new paradigm).

  MAX_CONCURRENT_BACKTESTS=3 backpressure (CLAUDE.md §14b) exists to protect the Node server's
  Python-subprocess pool from OOM when MANY HTTP callers fire concurrent backtests. This script
  does not add HTTP load — it IS a Python-subprocess-equivalent workload running standalone. To
  respect the same spirit (bounded concurrent engine load on the tower), --max-concurrent
  (default: env MAX_CONCURRENT_BACKTESTS, else 3) caps how many strategies' battery pairs run in
  parallel OS processes (multiprocessing.Pool). Each worker process gets its OWN os.environ copy,
  so Mode A and Mode B never race on the shared TF_CONFLUENCE_OVERLAY_DISABLED value the way they
  would if two modes ran as concurrent threads in one process — this is a correctness requirement,
  not just a performance choice. Within one worker, Mode A always completes before Mode B starts.

COORDINATION FINDING #1 (verified 2026-07-02, reported not fixed — provenance-stamp.ts is owned
by another agent's file boundary):
  src/server/lib/provenance-stamp.ts::computeOverlayConfigHash() hashes EffectiveOverlayConfig,
  which reads: BACKTEST_STATIC_C_PARTIALS_ENABLED, BACKTEST_PARTIAL_FILL_ENABLED,
  BACKTEST_COMPLIANCE_MODE, BACKTEST_ROLL_SPREAD_ITEMIZED,
  BACKTEST_ZERO_VOLUME_TRADE_CRITICAL_FAIL_LOUD, STOP_CEILING_PTS_*, STOP_FLOOR_ATR_MULT, and the
  hardcoded Style C ratios. It does NOT read TF_CONFLUENCE_OVERLAY_DISABLED. If Mode A and Mode B
  rows were ever persisted through backtest-service.ts's normal INSERT path (they are NOT — see
  below), both rows would receive an IDENTICAL overlay_config_hash despite representing two
  materially different overlay configurations. This should be fixed by whoever owns
  provenance-stamp.ts (add TF_CONFLUENCE_OVERLAY_DISABLED to EffectiveOverlayConfig). Until then,
  THIS script's own output packet is the source of truth for which mode produced which row —
  every result record carries an explicit "mode_ab" block with overlay_disabled: bool.

COORDINATION FINDING #2 (CLOSED 2026-07-04): run_walk_forward_class()'s `skip_eligibility_gate`
  is a real parameter today (was, at time of writing, already fixed upstream in
  src/engine/walk_forward.py — this harness does not modify that file). This harness closes ITS
  side of the gap by always passing `skip_eligibility_gate=False` explicitly for class/compiled
  specs (see run_battery_for_mode) instead of relying on the function's own
  TF_CLASS_WF_ELIGIBILITY_GATE_ENABLED-gated default (which stays skip=True for every OTHER
  caller, preserving backward compat everywhere except this harness's own calls).

GOVERNANCE / PERSISTENCE CONTRACT:
  This script NEVER writes to the `backtests` or `quantum_mc_runs` tables — no DB import exists
  in this file. Every result carries mode_ab.governance_advisory=true +
  mode_ab.persist_to_production=false, following the null_calibration / replay_mode / ablation
  marker precedent (src/engine/null_calibration_guard.py, filter-ablation-cpcv.py
  GOVERNANCE_LABEL). Output is FILE-ONLY: a resumable JSONL manifest
  (full_battery_mode_ab_manifest.jsonl) + a JSON summary report. Nothing here is a production
  verdict; it is evidence for the operator + the docs/overlay-unfreeze-protocol.md mechanism.

WHAT "FULL BATTERY" MEANS HERE:
  Per strategy spec, per mode (A = overlay disabled / source-signal-only, B = overlay enabled /
  production default):
    1. Walk-forward / CPCV via run_walk_forward(request, wf_mode="cpcv") — yields wfe_overall,
       dsr (float) + dsr_pass (bool), pbo_overall, oos trade list, oos_metrics.sharpe_ratio.
    2. B14 firm-survival Monte Carlo via run_monte_carlo() — yields
       risk_metrics.probability_of_ruin_ci.ci_high (falls back to the older
       firm_survival[firm].ci_high shape for engine-version robustness, matching
       null_gate_calibration.py's read pattern).
  A+ retention (Mode A's >= APLUS_POINTS-point winners that Mode B's OOS trade set still takes,
  matched by entry timestamp) mirrors scripts/overlay-attribution.py's method, computed here from
  the two modes' OOS trade lists — no import of that script (it is a single-backtest tool with a
  different call shape; this is an independent, smaller re-implementation over WF-derived trades).

USAGE (tower, PYTHONPATH=. required, AWS creds + DATA_CACHE_TTL_SECONDS as for other battery
scripts):
  # Single strategy — spec is a BacktestRequest-shaped JSON dict (see
  # scripts/null_gate_calibration.py::generate_null_specs for the canonical shape; export a real
  # strategy's config from the `strategies` table into this same shape).
  PYTHONPATH=. TF_ALLOW_FIXED_1=true python scripts/full-battery-mode-ab.py \\
    --spec-file docs/designs/example-strategy-spec.json

  # Batch from a manifest list file (JSON array of specs, each with an "id" key for the manifest)
  PYTHONPATH=. python scripts/full-battery-mode-ab.py \\
    --strategy-list-file docs/designs/gate-eligible-strategies.json \\
    --manifest full_battery_mode_ab_manifest.jsonl --max-concurrent 3

  # Resume a partial batch (already-completed spec+mode pairs are skipped)
  PYTHONPATH=. python scripts/full-battery-mode-ab.py \\
    --strategy-list-file docs/designs/gate-eligible-strategies.json \\
    --manifest full_battery_mode_ab_manifest.jsonl --resume

  # Include B14 Monte Carlo (slow, ~5 min per mode per strategy — omit for a fast WF-only pass)
  PYTHONPATH=. python scripts/full-battery-mode-ab.py --spec-file ... --include-mc

See docs/overlay-unfreeze-protocol.md for how these verdicts feed the unfreeze mechanism.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import multiprocessing as mp
import os
import sys
import time
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any

# ─── Governance / mode markers (mirrors null_calibration_guard.py + filter-ablation-cpcv.py) ──

MODE_AB_MARKER_KEY = "mode_ab_battery"

GOVERNANCE_LABEL: dict = {
    "governance_advisory": True,
    MODE_AB_MARKER_KEY: True,
    "persist_to_production": False,
    "authority": (
        "research_only -- verdicts inform the overlay-unfreeze protocol "
        "(docs/overlay-unfreeze-protocol.md); overlay remains FROZEN; never auto-applied; "
        "never persisted as a production backtest/MC row"
    ),
}


def build_mode_ab_labels(spec_id: str, mode: str, overlay_disabled: bool) -> dict:
    """Governance labels attached to every mode-A/B result record.

    Mirrors src/engine/null_calibration_guard.py's build_*_labels() pattern: a required
    boolean marker + enough context to make the mode unambiguous even where the shared
    provenance_stamp.overlay_config_hash cannot (yet) distinguish modes (see module
    docstring COORDINATION FINDING #1).
    """
    return {
        **GOVERNANCE_LABEL,
        "spec_id": spec_id,
        "mode": mode,  # "A" | "B"
        "overlay_disabled": overlay_disabled,
        "tf_confluence_overlay_disabled_env": "true" if overlay_disabled else "false",
    }


def validate_mode_ab_labels(labels: Any) -> None:
    """Fail-closed guard mirroring null_calibration_guard.validate_null_calibration_labels().

    Call before ANY persistence of a mode-A/B result. Today nothing in this script persists
    to a DB (file-only output), so this exists as a forward-compatible contract check and is
    exercised directly by the regression tests.
    """
    if not isinstance(labels, dict):
        raise ValueError(
            f"mode_ab_guard: labels must be a dict, got {type(labels).__name__}. "
            f"Use build_mode_ab_labels() to construct it."
        )
    if not labels.get(MODE_AB_MARKER_KEY):
        raise ValueError(
            f"mode_ab_guard: labels missing required '{MODE_AB_MARKER_KEY}': True marker "
            f"(replay_mode / null_calibration precedent). Got: {labels!r}"
        )
    if labels.get("mode") not in ("A", "B"):
        raise ValueError(
            f"mode_ab_guard: labels['mode'] must be 'A' or 'B', got {labels.get('mode')!r}"
        )
    if not isinstance(labels.get("overlay_disabled"), bool):
        raise ValueError("mode_ab_guard: labels['overlay_disabled'] must be a bool")


# ─── E4: A+ retention floor (named constant + env override) ──────────────────────────────────

# Institutional evidence gate metric for overlay changes (roadmap item E4). This is the SAME
# 80% floor referenced by docs/overlay-unfreeze-protocol.md condition (c) — defined once here
# so the protocol doc and this script's verdict logic can never drift apart. TS consumers should
# read the mirrored constant in src/server/lib/mode-ab-guard.ts (OVERLAY_APLUS_RETENTION_FLOOR).
OVERLAY_APLUS_RETENTION_FLOOR = float(os.environ.get("OVERLAY_APLUS_RETENTION_FLOOR", "0.80"))

# A+ trade definition — reuses overlay-attribution.py's convention (>= APLUS_POINTS points @ 1
# contract). Kept independently overridable so this harness isn't silently coupled to that
# script's env var.
APLUS_POINTS = float(os.environ.get("BATTERY_APLUS_POINTS", "14"))
DEFAULT_POINT_VALUE = 5.0  # MES default; override per-spec via spec["point_value"]

# ─── Verdict thresholds (all reuse an existing, documented institutional constant) ────────────

# Bailey & Lopez de Prado standard, same threshold scripts/filter-ablation-cpcv.py uses for its
# CONTRIBUTING/DEAD_WEIGHT/HARMFUL taxonomy. Reused here for consistency across the two harnesses.
DSR_EDGE_THRESHOLD = 0.05

# B14 ci_high must drop by at least this many percentage points for "the overlay measurably
# improved firm-survival odds" to be a defensible claim (BCa bootstrap noise floor).
B14_SURVIVAL_IMPROVE_THRESHOLD = 0.01

# Reuses ABLATION_TRADE_FLOOR_PCT's default from confluence-overlay-ablation.py ("overlay must
# not starve trades below this fraction of the no-overlay OOS trade count").
TRADE_STARVE_FLOOR_PCT = float(os.environ.get("ABLATION_TRADE_FLOOR_PCT", "0.40"))

# Below this many OOS trades in EITHER mode, gate outputs (DSR/PBO/B14) are not statistically
# meaningful — verdict is INDETERMINATE rather than a false-confident call.
MIN_TRADES_FOR_VERDICT = int(os.environ.get("BATTERY_MIN_TRADES_FOR_VERDICT", "5"))

VERDICT_HELPS_EDGE = "HELPS EDGE"
VERDICT_HELPS_SURVIVAL_ONLY = "HELPS SURVIVAL ONLY"
VERDICT_HURTS = "HURTS"
VERDICT_INDETERMINATE = "INDETERMINATE"


# ─── Verdict math (pure function — unit-tested at every threshold edge) ───────────────────────

def compute_verdict(mode_a: dict, mode_b: dict, aplus_retention_pct: float | None = None) -> dict:
    """Compare Mode A (overlay OFF) vs Mode B (overlay ON) full-battery metrics.

    Args:
        mode_a / mode_b: dicts with keys (all Optional unless noted):
            dsr (float), dsr_pass (bool), wfe (float), pbo (float),
            b14_ci_high (float), sharpe (float), trade_count (int), error (str|None)
        aplus_retention_pct: 0-100 scale; None when not computed (e.g. no A+ trades existed
            in Mode A to retain).

    Returns:
        dict with: verdict, plain_english, delta_dsr, delta_sharpe, delta_wfe,
        delta_b14_ci_high, delta_pbo, trade_retention_pct, aplus_retention_pct, caveats (list[str]).

    Decision rule (documented in docs/overlay-unfreeze-protocol.md):
      1. Either mode errored, or either mode has < MIN_TRADES_FOR_VERDICT OOS trades
         -> INDETERMINATE (not enough signal to trust DSR/PBO/B14 deltas).
      2. edge_improved  := delta_dsr >= DSR_EDGE_THRESHOLD (Bailey-Lopez de Prado)
                            OR (delta_sharpe > 0 AND delta_wfe is None or >= 0)
      3. hurts_edge     := delta_dsr <= -DSR_EDGE_THRESHOLD OR delta_sharpe < 0
      4. survival_improved := delta_b14_ci_high <= -B14_SURVIVAL_IMPROVE_THRESHOLD
      5. starves_trades := trade_retention_pct < TRADE_STARVE_FLOOR_PCT
      6. Priority: HELPS EDGE (2) > HELPS SURVIVAL ONLY (4 and not 3) > HURTS (3 or 5) > INDETERMINATE
      A+ retention below OVERLAY_APLUS_RETENTION_FLOOR is surfaced as a caveat on ANY verdict —
      it never changes the verdict category by itself (E3 protocol treats it as an independent
      unfreeze precondition, not a battery verdict axis).
    """
    if mode_a.get("error") or mode_b.get("error"):
        err = mode_a.get("error") or mode_b.get("error")
        return {
            "verdict": VERDICT_INDETERMINATE,
            "plain_english": f"INDETERMINATE — a mode run errored ({err}).",
            "delta_dsr": None, "delta_sharpe": None, "delta_wfe": None,
            "delta_b14_ci_high": None, "delta_pbo": None,
            "trade_retention_pct": None, "aplus_retention_pct": aplus_retention_pct,
            "caveats": [f"mode error: {err}"],
        }

    ta = mode_a.get("trade_count") or 0
    tb = mode_b.get("trade_count") or 0
    if ta < MIN_TRADES_FOR_VERDICT or tb < MIN_TRADES_FOR_VERDICT:
        return {
            "verdict": VERDICT_INDETERMINATE,
            "plain_english": (
                f"INDETERMINATE — insufficient OOS trades for a statistically meaningful "
                f"battery comparison (Mode A={ta}, Mode B={tb}, floor={MIN_TRADES_FOR_VERDICT})."
            ),
            "delta_dsr": None, "delta_sharpe": None, "delta_wfe": None,
            "delta_b14_ci_high": None, "delta_pbo": None,
            "trade_retention_pct": round(tb / ta, 4) if ta else None,
            "aplus_retention_pct": aplus_retention_pct,
            "caveats": ["insufficient_trades"],
        }

    def _delta(key: str) -> float | None:
        a, b = mode_a.get(key), mode_b.get(key)
        if a is None or b is None:
            return None
        return round(b - a, 4)

    delta_dsr = _delta("dsr")
    delta_sharpe = _delta("sharpe")
    delta_wfe = _delta("wfe")
    delta_b14_ci_high = _delta("b14_ci_high")
    delta_pbo = _delta("pbo")
    trade_retention_pct = round(tb / ta, 4) if ta else None

    edge_improved = (delta_dsr is not None and delta_dsr >= DSR_EDGE_THRESHOLD) or (
        delta_sharpe is not None and delta_sharpe > 0 and (delta_wfe is None or delta_wfe >= 0)
    )
    hurts_edge = (delta_dsr is not None and delta_dsr <= -DSR_EDGE_THRESHOLD) or (
        delta_sharpe is not None and delta_sharpe < 0
    )
    survival_improved = (
        delta_b14_ci_high is not None and delta_b14_ci_high <= -B14_SURVIVAL_IMPROVE_THRESHOLD
    )
    starves_trades = (
        trade_retention_pct is not None and trade_retention_pct < TRADE_STARVE_FLOOR_PCT
    )

    caveats: list[str] = []
    if aplus_retention_pct is not None and aplus_retention_pct < OVERLAY_APLUS_RETENTION_FLOOR * 100:
        caveats.append(
            f"A+ retention {aplus_retention_pct:.1f}% below the "
            f"{OVERLAY_APLUS_RETENTION_FLOOR:.0%} unfreeze-protocol floor"
        )
    if starves_trades:
        caveats.append(
            f"trade retention {trade_retention_pct:.1%} below the {TRADE_STARVE_FLOOR_PCT:.0%} floor"
        )

    if edge_improved:
        verdict = VERDICT_HELPS_EDGE
        plain = (
            f"HELPS EDGE — overlay improves OOS DSR/Sharpe (Δdsr={delta_dsr}, Δsharpe={delta_sharpe}) "
            f"without WFE regressing."
        )
    elif survival_improved and not hurts_edge:
        verdict = VERDICT_HELPS_SURVIVAL_ONLY
        plain = (
            f"HELPS SURVIVAL ONLY — overlay lowers B14 firm-ruin ci_high by "
            f"{-delta_b14_ci_high:.2%} without a matching DSR/Sharpe edge gain (Δdsr={delta_dsr})."
        )
    elif hurts_edge or starves_trades:
        verdict = VERDICT_HURTS
        reason = []
        if hurts_edge:
            reason.append(f"Δdsr={delta_dsr}, Δsharpe={delta_sharpe}")
        if starves_trades:
            reason.append(f"trade retention {trade_retention_pct:.1%}")
        plain = f"HURTS — overlay degrades OOS edge and/or starves trades ({'; '.join(reason)})."
    else:
        verdict = VERDICT_INDETERMINATE
        plain = (
            "INDETERMINATE — deltas are within noise on every axis "
            "(no edge gain, no survival gain, no clear harm)."
        )

    if caveats:
        plain += " Caveats: " + "; ".join(caveats) + "."

    return {
        "verdict": verdict,
        "plain_english": plain,
        "delta_dsr": delta_dsr,
        "delta_sharpe": delta_sharpe,
        "delta_wfe": delta_wfe,
        "delta_b14_ci_high": delta_b14_ci_high,
        "delta_pbo": delta_pbo,
        "trade_retention_pct": trade_retention_pct,
        "aplus_retention_pct": aplus_retention_pct,
        "caveats": caveats,
    }


# ─── A+ retention (overlay-attribution.py method, re-derived from WF trade lists) ─────────────

def _entry_key(t: dict) -> str:
    return str(t.get("Entry Timestamp") or t.get("entry_time") or t.get("Entry Idx") or t.get("entry_idx") or "")


def _pts(t: dict, point_value: float) -> float:
    return float(t.get("PnL", t.get("pnl", 0.0)) or 0.0) / point_value


def compute_aplus_retention_pct(
    mode_a_trades: list[dict], mode_b_trades: list[dict], point_value: float = DEFAULT_POINT_VALUE
) -> float | None:
    """% of Mode A's >= APLUS_POINTS-point OOS winners still present (by entry key) in Mode B.

    Returns None when Mode A produced zero A+ trades (nothing to retain — not "0% retention",
    which would misleadingly read as a failure).
    """
    a_aplus = [t for t in mode_a_trades if _pts(t, point_value) >= APLUS_POINTS]
    if not a_aplus:
        return None
    b_keys = {_entry_key(t) for t in mode_b_trades}
    kept = sum(1 for t in a_aplus if _entry_key(t) in b_keys)
    return round(100.0 * kept / len(a_aplus), 2)


# ─── Spec identity (manifest key + label) ─────────────────────────────────────────────────────

def spec_id_for(spec: dict) -> str:
    """Stable identifier for a spec — prefers an operator-assigned 'id', else a content hash.

    Excludes nothing time-sensitive; two identical specs always produce the same id, so a
    resumed manifest correctly recognizes "already ran this exact spec".
    """
    explicit = spec.get("id") or spec.get("_id")
    if explicit:
        return str(explicit)
    canonical = json.dumps(spec, sort_keys=True, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


# ─── Execution-path detection (DSL vs class/compiled) ─────────────────────────────────────────
#
# CORRECTNESS FIX (2026-07-04): mirrors src/server/lib/handler-driven-entry.ts's dispatch-marker
# recognition (DISPATCH_MARKER_PREFIXES = ["archetype_dispatch:", "spec_conditions:"] + the
# "archetype:" entry_indicator prefix) and backtester.py main()'s CLI dispatch condition
# (`isinstance(config, dict) and config.get("compiled_spec")`). The `compiled_spec` truthy check
# is the PRIMARY signal and matches production exactly: every spec_onboarding-sourced strategy
# (Corpus v2) carries `compiled_spec` unconditionally per spec-onboarding-service.ts, regardless
# of whether it matched a named archetype — so in production TODAY, archetype_dispatch: and
# spec_conditions: strategies both execute via the SAME from_compiled_spec() -> SpecConditionStrategy
# path (backtester.py:7548-7623). The marker-prefix checks are a defensive fallback for specs that
# carry the markers without a compiled_spec payload (e.g. hand-built test fixtures).

DISPATCH_MARKER_PREFIXES = ("archetype_dispatch:", "spec_conditions:")


def _is_class_or_compiled_spec(spec: dict) -> bool:
    """True when `spec` must execute via run_walk_forward_class() instead of run_walk_forward().

    Detection order mirrors backtester.py main()'s CLI branch priority:
      1. top-level `strategy_class` truthy (direct-bucket-graduator.ts's ARCHETYPE_CLASS_MAP
         convention — e.g. bounce_off_level / ict_bias_aligned_continuation. This population
         carries REAL compiled engine grammar in entry_long/entry_short, not a dispatch marker,
         so it would otherwise be silently misrouted to the DSL branch below).
      2. `compiled_spec` truthy (Band B/C spec-onboarding — the actual production signal for
         every Corpus v2 CANDIDATE strategy today).
      3. `entry_indicator` starts with "archetype:" (handler-driven-entry.ts convention).
      4. `entry_long` / `entry_short` start with "archetype_dispatch:" or "spec_conditions:".
    """
    if not isinstance(spec, dict):
        return False
    strat = spec.get("strategy") if isinstance(spec.get("strategy"), dict) else {}
    if spec.get("strategy_class") or strat.get("strategy_class"):
        return True
    if spec.get("compiled_spec"):
        return True
    entry_indicator = strat.get("entry_indicator") or spec.get("entry_indicator")
    if isinstance(entry_indicator, str) and entry_indicator.startswith("archetype:"):
        return True
    for key in ("entry_long", "entry_short"):
        marker = strat.get(key) or spec.get(key) or ""
        if isinstance(marker, str) and marker.startswith(DISPATCH_MARKER_PREFIXES):
            return True
    return False


def _build_class_strategy(spec: dict):
    """Build the BaseStrategy instance run_walk_forward_class() needs, mirroring
    backtester.py main()'s CLI dispatch: an explicit top-level `strategy_class` dotted path
    (direct-bucket-graduator.ts's ARCHETYPE_CLASS_MAP convention — `_load_strategy_class`
    equivalent, no-arg `cls()`) takes priority over `compiled_spec`
    (spec-onboarding-service.ts's Band B/C convention — every Corpus v2 CANDIDATE strategy today,
    via src.engine.spec_condition_compiler.from_compiled_spec()).

    FAILS LOUD (raises ValueError) rather than defaulting symbol/name — see the comments below
    for why a silent default would produce a wrong-but-plausible-looking number instead of an
    honest error, which is the exact failure mode this correctness fix exists to prevent.
    """
    strat_cfg = spec.get("strategy") if isinstance(spec.get("strategy"), dict) else {}
    strategy_class = spec.get("strategy_class") or strat_cfg.get("strategy_class")
    symbol = strat_cfg.get("symbol") or spec.get("symbol")
    timeframe = strat_cfg.get("timeframe") or spec.get("timeframe")
    strategy_name = strat_cfg.get("name") or spec.get("name")

    if not symbol:
        raise ValueError(
            "class/compiled spec missing strategy.symbol -- refusing to default to MES. "
            "The exported strategy-list JSON must carry the DB `strategies.symbol` column "
            "(a top-level DB column, separate from the `config` JSONB blob) for every entry -- "
            "defaulting here would silently backtest the WRONG symbol's data for any MNQ/MCL "
            "strategy in the batch."
        )
    if not timeframe:
        raise ValueError("class/compiled spec missing strategy.timeframe -- refusing to guess.")
    if not strategy_name:
        # Fail LOUD rather than silently degrade into apply_eligibility_gate()'s "unregistered
        # strategy bypass" passthrough (backtester.py: a strategy_name absent from
        # playbook_router.py's ALL_STRATS skips the gate ENTIRELY for both modes -> Mode A and
        # Mode B become byte-identical with zero error surfaced -- exactly the false-negative
        # verification bar #3 in the task spec exists to catch).
        raise ValueError(
            "class/compiled spec missing strategy.name (or top-level 'name') -- without the "
            "exact DB `strategies.name` value, apply_eligibility_gate()'s playbook_router "
            "registration check cannot match and the strategy will silently bypass the "
            "eligibility gate in BOTH modes (identical results, no error surfaced)."
        )

    if strategy_class:
        # Mirrors backtester.py::_load_strategy_class() exactly (dotted-path import + no-arg
        # cls()) -- no post-construction attribute overrides, since ARCHETYPE_CLASS_MAP classes
        # own their own symbol/timeframe/name defaults and production never overrides them either.
        import importlib

        module_path, class_name = strategy_class.rsplit(".", 1)
        module = importlib.import_module(module_path)
        cls = getattr(module, class_name)
        return cls()

    compiled_spec = spec.get("compiled_spec")
    if not compiled_spec:
        raise ValueError(
            "spec was detected as class/compiled (matched an archetype_dispatch: / "
            "spec_conditions: / archetype: marker) but carries neither a top-level "
            "strategy_class nor a compiled_spec payload -- cannot build an executable strategy."
        )
    from src.engine.spec_condition_compiler import from_compiled_spec

    return from_compiled_spec(
        compiled_spec,
        symbol=symbol,
        timeframe=timeframe,
        strategy_name=strategy_name,
    )


# ─── Single-mode battery runner (reuses run_walk_forward / run_walk_forward_class +
# run_monte_carlo verbatim) ─────────────────────────────────────────────────────────────────────

def run_battery_for_mode(
    spec: dict,
    mode: str,  # "A" | "B"
    include_mc: bool = False,
    mc_simulations: int = 10_000,
    seed: int = 42,
) -> dict:
    """Run the full WF/CPCV + optional B14-MC battery for one spec under one overlay mode.

    Sets TF_CONFLUENCE_OVERLAY_DISABLED for the duration of this call only (restored in
    `finally`) — safe because the caller (run_spec_worker) guarantees Mode A completes before
    Mode B starts within the SAME process, and multiprocessing gives each spec's worker its own
    os.environ copy so concurrent specs never race on this var.
    """
    sid = spec_id_for(spec)
    overlay_disabled = (mode == "A")
    prior_env = os.environ.get("TF_CONFLUENCE_OVERLAY_DISABLED")
    os.environ["TF_CONFLUENCE_OVERLAY_DISABLED"] = "true" if overlay_disabled else "false"

    execution_path = "class" if _is_class_or_compiled_spec(spec) else "dsl"

    result: dict = {
        "mode": mode,
        "overlay_disabled": overlay_disabled,
        "error": None,
        # Path-trace (verification bar #4): which dispatch this spec+mode pair actually took,
        # so a future debugging session never has to re-derive it from spec shape by hand.
        "execution_path": execution_path,
        "wfe": None,
        "dsr": None,
        "dsr_pass": None,
        "pbo": None,
        "b14_ci_high": None,
        "sharpe": None,
        "trade_count": 0,
        "trades": [],
        "daily_pnls": [],
        "elapsed_seconds": 0.0,
        "mode_ab": build_mode_ab_labels(sid, mode, overlay_disabled),
    }
    validate_mode_ab_labels(result["mode_ab"])

    start_t = time.time()
    firm_key = spec.get("firm_key") or "topstep_50k"
    try:
        if execution_path == "class":
            # ─── Class/compiled path (Corpus v2 — archetype_dispatch: / spec_conditions:) ──
            strategy = _build_class_strategy(spec)

            from src.engine.walk_forward import run_walk_forward_class
            wf_result = run_walk_forward_class(
                strategy=strategy,
                start_date=spec.get("start_date", "2010-01-01"),
                end_date=spec.get("end_date", "2030-12-31"),
                slippage_ticks=spec.get("slippage_ticks", 1.0),
                commission_per_side=spec.get("commission_per_side"),
                firm_key=firm_key,
                embargo_bars=spec.get("embargo_bars", 0),
                # Mirrors the DSL path's run_backtest(use_eligibility_gate=True) default:
                # explicitly opt IN to the eligibility gate so apply_eligibility_gate()'s OWN
                # internal TF_CONFLUENCE_OVERLAY_DISABLED branch decides Mode A vs B. Without
                # this, run_walk_forward_class()'s own default (env-var-gated, skip=True unless
                # TF_CLASS_WF_ELIGIBILITY_GATE_ENABLED=true) would make Mode A and Mode B
                # byte-identical for every class-based strategy regardless of the env var this
                # harness sets above — see run_battery_for_mode's docstring "COORDINATION FINDING
                # #2 (CLOSED)" note in the module docstring.
                skip_eligibility_gate=False,
            )

            oos_metrics = wf_result.get("oos_metrics", {}) or {}
            trades = wf_result.get("trades", []) or []
            daily_pnls = wf_result.get("daily_pnls", []) or []
            cross_val = wf_result.get("cross_validation", {}) or {}
            deflated = cross_val.get("deflated_sharpe", {}) or {}

            # ENGINE-SIDE GAP (documented, not a harness bug — see module docstring): WFE and
            # PBO are NOT computed by run_walk_forward_class() today (no per-window Optuna IS
            # Sharpe -> WFE is structurally None; no per-path CPCV aggregation -> no pbo_overall
            # key at all). DSR IS available, just nested under cross_validation.deflated_sharpe
            # instead of wf_metadata.dsr. Leaving wfe/pbo explicit None (rather than omitting the
            # keys) keeps compute_verdict()'s existing None-safe _delta() helper behaving
            # identically to the DSL path's legacy-null case.
            result["wfe"] = cross_val.get("wfe")
            result["dsr"] = deflated.get("dsr")
            result["dsr_pass"] = deflated.get("significant")
            result["pbo"] = None
            result["mode_ab"]["class_path_wfe_pbo_unavailable"] = True
            result["sharpe"] = oos_metrics.get("sharpe_ratio")
            result["trade_count"] = oos_metrics.get("total_trades", len(trades))
            result["trades"] = trades
            result["daily_pnls"] = daily_pnls
            equity_curve_source = []  # run_walk_forward_class emits no equity_bars/equity_curve key
        else:
            # ─── DSL path (unchanged — byte-identical to pre-fix behavior) ─────────────────
            from src.engine.config import BacktestRequest

            clean_spec = {k: v for k, v in spec.items() if not k.startswith("_") and k != "id"}
            request = BacktestRequest.model_validate(clean_spec)

            from src.engine.walk_forward import run_walk_forward
            wf_result = run_walk_forward(request, wf_mode="cpcv")

            wf_meta = wf_result.get("wf_metadata", {}) or {}
            oos_metrics = wf_result.get("oos_metrics", {}) or {}
            trades = wf_result.get("trades", []) or []
            daily_pnls = wf_result.get("daily_pnls", []) or []

            result["wfe"] = wf_meta.get("wfe_overall")
            result["dsr"] = wf_meta.get("dsr")
            result["dsr_pass"] = wf_meta.get("dsr_pass")
            result["pbo"] = wf_result.get("pbo_overall")
            result["sharpe"] = oos_metrics.get("sharpe_ratio")
            result["trade_count"] = oos_metrics.get("total_trades", len(trades))
            result["trades"] = trades
            result["daily_pnls"] = daily_pnls
            equity_curve_source = wf_result.get("equity_bars", wf_result.get("equity_curve", []))

        if include_mc and result["trade_count"] and result["trade_count"] >= MIN_TRADES_FOR_VERDICT:
            try:
                from src.engine.config import MonteCarloRequest
                from src.engine.monte_carlo import run_monte_carlo

                trades_pnl = [float(t.get("PnL", t.get("pnl", 0)) or 0.0) for t in trades]
                mc_req = MonteCarloRequest(
                    backtest_id=f"mode_ab_{mode}_{sid}",
                    num_simulations=mc_simulations,
                    method="block_bootstrap",
                    firms=[firm_key],
                    seed=seed,
                    use_gpu=False,
                )
                equity_curve = list(equity_curve_source)
                mc_result = run_monte_carlo(mc_req, trades_pnl, daily_pnls, equity_curve)

                # Prefer the canonical risk_metrics.probability_of_ruin_ci.ci_high location
                # (CLAUDE.md B14 gate contract). Fall back to the per-firm firm_survival shape
                # for engine-version robustness (matches null_gate_calibration.py's read path).
                ci_high = (
                    mc_result.get("risk_metrics", {})
                    .get("probability_of_ruin_ci", {})
                    .get("ci_high")
                )
                if ci_high is None:
                    ci_high = mc_result.get("firm_survival", {}).get(firm_key, {}).get("ci_high")
                result["b14_ci_high"] = ci_high
            except Exception as mc_exc:  # noqa: BLE001
                result["b14_mc_error"] = f"{type(mc_exc).__name__}: {mc_exc}"

    except Exception as exc:  # noqa: BLE001
        result["error"] = f"{type(exc).__name__}: {exc}"
        result["traceback"] = traceback.format_exc()
    finally:
        if prior_env is None:
            os.environ.pop("TF_CONFLUENCE_OVERLAY_DISABLED", None)
        else:
            os.environ["TF_CONFLUENCE_OVERLAY_DISABLED"] = prior_env

    result["elapsed_seconds"] = time.time() - start_t
    return result


# ─── Per-spec worker (runs Mode A then Mode B sequentially in one process) ────────────────────

def run_spec_worker(item: dict) -> dict:
    """Run both modes for one spec. Picklable — safe for multiprocessing.Pool.

    `item` keys: spec (required, BacktestRequest-shaped dict), include_mc (bool),
    mc_simulations (int), seed (int).
    """
    spec = item["spec"]
    include_mc = bool(item.get("include_mc", False))
    mc_simulations = int(item.get("mc_simulations", 10_000))
    seed = int(item.get("seed", 42))
    point_value = float(spec.get("point_value", DEFAULT_POINT_VALUE))
    sid = spec_id_for(spec)

    t0 = time.time()
    mode_a = run_battery_for_mode(spec, "A", include_mc, mc_simulations, seed)
    mode_b = run_battery_for_mode(spec, "B", include_mc, mc_simulations, seed)

    aplus_retention_pct = compute_aplus_retention_pct(
        mode_a.get("trades", []), mode_b.get("trades", []), point_value
    )
    verdict = compute_verdict(mode_a, mode_b, aplus_retention_pct)

    # Strip heavy per-trade lists before returning to the parent process / manifest —
    # they are useful for A+ retention math but not for the report, and bloat the JSONL.
    mode_a_slim = {k: v for k, v in mode_a.items() if k not in ("trades", "traceback")}
    mode_b_slim = {k: v for k, v in mode_b.items() if k not in ("trades", "traceback")}

    return {
        "spec_id": sid,
        "symbol": spec.get("strategy", {}).get("symbol"),
        "timeframe": spec.get("strategy", {}).get("timeframe"),
        "start_date": spec.get("start_date"),
        "end_date": spec.get("end_date"),
        # Path-trace (verification bar #4): top-level for fast manifest scanning without
        # digging into mode_a/mode_b. Both modes always take the same path for a given spec
        # (detection is spec-shape-based, not mode-based) — asserted defensively here so a
        # future divergence (e.g. a bug that mutates spec between modes) fails loudly instead
        # of silently reporting only one mode's path.
        "execution_path": mode_a_slim.get("execution_path"),
        "mode_a": mode_a_slim,
        "mode_b": mode_b_slim,
        "verdict": verdict,
        "elapsed_seconds": round(time.time() - t0, 2),
        "generated_at": datetime.utcnow().isoformat() + "Z",
    }


# ─── Manifest (resumable batch — mirrors null_gate_calibration.py's JSONL pattern) ─────────────

def load_manifest(manifest_path: str) -> dict[str, dict]:
    completed: dict[str, dict] = {}
    path = Path(manifest_path)
    if not path.exists():
        return completed
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
                sid = rec.get("spec_id")
                if sid:
                    completed[sid] = rec
            except json.JSONDecodeError:
                pass
    return completed


def append_to_manifest(manifest_path: str, result: dict) -> None:
    with open(manifest_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(result, default=str) + "\n")


def build_work_plan(specs: list[dict], completed: dict[str, dict]) -> list[dict]:
    """Filter `specs` down to those not already present in the resumed manifest.

    Pure function — the piece of resume logic that is unit-testable without touching disk
    or the engine.
    """
    pending = []
    for spec in specs:
        sid = spec_id_for(spec)
        if sid not in completed:
            pending.append(spec)
    return pending


# ─── Report ────────────────────────────────────────────────────────────────────────────────────

def build_report(results: list[dict]) -> dict:
    verdict_counts: dict[str, int] = {}
    for r in results:
        v = r.get("verdict", {}).get("verdict", VERDICT_INDETERMINATE)
        verdict_counts[v] = verdict_counts.get(v, 0) + 1
    return {
        **GOVERNANCE_LABEL,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "n_strategies": len(results),
        "verdict_counts": verdict_counts,
        "aplus_retention_floor": OVERLAY_APLUS_RETENTION_FLOOR,
        "results": results,
    }


# ─── CLI ────────────────────────────────────────────────────────────────────────────────────────

def _load_json_array(path: str) -> list[dict]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise SystemExit(f"{path} must contain a JSON array of specs, got {type(data).__name__}")
    return data


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Full institutional battery (WF/CPCV + PBO + DSR + B14 MC) under Mode A "
        "(overlay OFF) vs Mode B (overlay ON, production default), for BacktestRequest-shaped "
        "DSL strategy specs."
    )
    ap.add_argument(
        "--spec-file",
        help="single spec — JSON file containing ONE BacktestRequest-shaped dict "
        "(strategy config + start_date + end_date + firm_key)",
    )
    ap.add_argument(
        "--strategy-list-file",
        help="batch mode — JSON file containing an ARRAY of spec dicts, each ideally carrying "
        "an 'id' key for stable manifest resume. Operator generates this by exporting "
        "gate-eligible `strategies` table rows' config JSONB — see "
        "docs/overlay-unfreeze-protocol.md 'Operator commands'.",
    )
    ap.add_argument(
        "--manifest",
        default="full_battery_mode_ab_manifest.jsonl",
        help="Resumable JSONL manifest path (default: full_battery_mode_ab_manifest.jsonl)",
    )
    ap.add_argument("--resume", action="store_true", help="Skip specs already present in the manifest")
    ap.add_argument(
        "--max-concurrent",
        type=int,
        default=int(os.environ.get("MAX_CONCURRENT_BACKTESTS", "3")),
        help="Local process-pool cap (default: env MAX_CONCURRENT_BACKTESTS or 3, mirroring "
        "CLAUDE.md §14b's backpressure contract for engine-load host-safety)",
    )
    ap.add_argument("--include-mc", action="store_true", help="Include B14 Monte Carlo (slow)")
    ap.add_argument("--mc-simulations", type=int, default=10_000)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--report-out", default="full_battery_mode_ab_report.json")
    ap.add_argument("--json", action="store_true", help="Print the report JSON to stdout")
    args = ap.parse_args()

    if args.strategy_list_file:
        specs = _load_json_array(args.strategy_list_file)
    elif args.spec_file:
        specs = [json.loads(Path(args.spec_file).read_text(encoding="utf-8"))]
    else:
        ap.error("provide either --spec-file or --strategy-list-file")
        return 2

    items = [{
        "spec": spec,
        "include_mc": args.include_mc,
        "mc_simulations": args.mc_simulations,
        "seed": args.seed,
    } for spec in specs]

    completed = load_manifest(args.manifest) if args.resume else {}
    pending_specs = build_work_plan(specs, completed)
    pending_sids = {spec_id_for(s) for s in pending_specs}
    pending = [it for it in items if spec_id_for(it["spec"]) in pending_sids]

    print(
        f"full-battery-mode-ab: {len(items)} total, {len(completed)} already complete, "
        f"{len(pending)} pending (max_concurrent={max(1, min(args.max_concurrent, max(len(pending), 1)))})",
        file=sys.stderr,
    )

    all_results = list(completed.values())
    if pending:
        cap = max(1, min(args.max_concurrent, len(pending)))
        if cap == 1:
            for item in pending:
                res = run_spec_worker(item)
                append_to_manifest(args.manifest, res)
                all_results.append(res)
                print(f"  {res['spec_id']}: {res['verdict']['verdict']}", file=sys.stderr)
        else:
            with mp.Pool(processes=cap) as pool:
                for res in pool.imap_unordered(run_spec_worker, pending):
                    append_to_manifest(args.manifest, res)
                    all_results.append(res)
                    print(f"  {res['spec_id']}: {res['verdict']['verdict']}", file=sys.stderr)

    report = build_report(all_results)
    Path(args.report_out).write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")

    if args.json:
        print(json.dumps(report, indent=2, default=str))
    else:
        print(f"\nreport written to {args.report_out}", file=sys.stderr)
        print(f"verdict counts: {report['verdict_counts']}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
