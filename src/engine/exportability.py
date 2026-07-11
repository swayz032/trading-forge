"""Exportability scoring — assesses how well a StrategyDSL translates to Pine Script v5.

Score bands:
  90-100: Clean Pine deployment candidate
  70-89:  Pine possible with reductions
  50-69:  Alert-only export recommended
  <50:    Do not export

Semantic-fidelity model (2026-06-22 FAIL-LOUD mandate):
  The scorer now distinguishes between "exportable" (can produce a Pine script
  that runs) and "faithful" (the Pine script faithfully reproduces the validated
  strategy logic).  Three classes of features are NOT expressible in Pine:

  1. Style C / Adaptive Exits — partials (33/33/34), runner trail, BE+1, adaptive
     exit styles.  Pine emits a single strategy.exit() with one stop and one target.

  2. Weighted Confluence Gating — 11-factor weighted scoring (use_weighted_scoring=True)
     or min_factors_satisfied requirements.  Pine fires on the raw indicator alone.

  3. Multi-TF Gating — daily_tf / htf_tf / itf_tf declared on the strategy.  Pine
     renders on a single chart timeframe; HTF bias alignment is not reproduced.

  When any of these are detected, the result has faithful=False AND exportable=False.
  The refusal includes a human-readable reason noting that DEPLOYED strategies execute
  server-side via broker-router (server-mediated execution) and Pine is a visual-only
  aid for those — so the refusal is by design, not a defect.

  Simple strategies (plain indicator entry + simple stop/TP, none of the above) still
  receive faithful=True and can export cleanly.
"""
from __future__ import annotations

import json

from pydantic import BaseModel, Field

# Indicators that have direct Pine v5 equivalents
NATIVE_PINE_INDICATORS = {
    "sma", "ema", "rsi", "atr", "vwap", "bollinger", "macd", "adx",
}

# Indicators explicitly mapped to None in INDICATOR_MAP (pine_compiler.py) — the compiler
# has a placeholder path for these (returns a comment, not a real implementation).
# They are NOT fully unsupported (no crash), but they produce no real Pine logic.
# Deduction: -50 to match the "unknown type" path, ensuring exportable=False for any
# strategy whose primary indicator is None-mapped.  Scorer message uses "no Pine equivalent"
# so it aligns with the compiler's ValueError message and downstream test assertions.
# NOTE: keep this set in sync with INDICATOR_MAP keys that map to None in pine_compiler.py.
NONE_MAPPED_INDICATORS = {
    "volume_profile",  # INDICATOR_MAP["volume_profile"] = None — placeholder only
}

# ICT structural indicators: no Pine equivalent in INDICATOR_MAP.
# Deduction is -25 each so a strategy with 2 ICT indicators scores ≤50 → exportable=False.
# Path B (real Pine approximations) is a separate engineering project; do not conflate.
ICT_NO_PINE_INDICATORS = {
    "order_block", "fvg", "breaker_block", "liquidity_sweep",
}

# Indicators that need custom Pine implementations (approximations) but DO produce
# valid (approximate) Pine.  Distinct from NONE_MAPPED_INDICATORS (no Pine at all).
CUSTOM_PINE_INDICATORS: set[str] = set()  # Currently empty — volume_profile promoted to NONE_MAPPED

# Indicators that cannot be exported to Pine
UNEXPORTABLE_INDICATORS = {
    "ml_signal", "ml", "neural_net", "neural", "external_api", "external",
}


class ExportabilityResult(BaseModel):
    score: float = Field(..., ge=0, le=100)
    band: str  # "clean" | "reducible" | "alert_only" | "do_not_export"
    indicator_scores: dict[str, float] = Field(default_factory=dict)
    deductions: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    exportable: bool = True
    # Semantic-fidelity flag (2026-06-22 FAIL-LOUD mandate).
    # faithful=True  → the exported Pine faithfully reproduces the validated strategy logic.
    # faithful=False → one or more features (Style C exits / confluence gating / multi-TF)
    #                  cannot be expressed in Pine.  The strategy executes server-side
    #                  via broker-router (server-mediated execution); Pine is visual-only.
    #                  faithful=False always implies exportable=False.
    faithful: bool = True


def _pine_inexpressible_notes(cfg: dict) -> list:
    """Deep-Scan #18b P-2 (2026-07-05): human-readable notes for strategy logic Pine
    cannot reproduce — Style C exits / 11-factor confluence / multi-TF gating. Mirrors
    the authoritative §6a/6b/6c checks in score_exportability (kept in sync with them);
    the archetype fast-path calls this so its `deductions` is no longer silently empty.
    Detection intentionally liberal (field-present ⇒ designed-with-it) per §6."""
    notes: list = []
    ep = cfg.get("exit_params", {}) or {}
    epc = cfg.get("exit_plan_config", {}) or {}
    if (
        ep.get("style") in ("c", "C", "style_c", "styleC")
        or ep.get("partials")
        or ep.get("runner_trail") is True
        or ep.get("move_stop_to_be") is True
        or epc.get("exit_style") == "adaptive"
    ):
        notes.append(
            "Exit semantics not expressible in Pine: Style C 33/33/34 partial closes, "
            "runner trail, BE+1, and/or adaptive exits cannot be reproduced by "
            "strategy.exit() — the Pine artifact emits a single all-or-nothing stop/target."
        )
    eq = cfg.get("entry_quality", {}) or {}
    mf = eq.get("min_factors_satisfied")
    if (
        eq.get("use_weighted_scoring") is True
        or (isinstance(mf, (int, float)) and mf > 0)
        or eq.get("regime_required") is True
    ):
        notes.append(
            "Confluence gating not expressible in Pine: 11-factor weighted scoring / "
            "min_factors_satisfied / regime_required cannot be reproduced — Pine fires "
            "on the raw indicator signal alone."
        )
    tf_fields = [k for k in ("daily_tf", "htf_tf", "itf_tf") if cfg.get(k)]
    if tf_fields:
        notes.append(
            "Multi-TF gating not expressible in Pine: HTF alignment fields ("
            + ", ".join(tf_fields)
            + ") require top-down timeframe AND-gating Pine cannot reproduce."
        )
    return notes


def score_exportability(strategy_config: dict) -> ExportabilityResult:
    """Score a strategy's exportability to Pine Script v5.

    Args:
        strategy_config: Strategy DSL dict (from StrategyDSL.model_dump())

    Returns:
        ExportabilityResult with score, band, and details

    Prefix fast-path (added Pass 2 Track B, 2026-06-22):
        entry_indicator starting with 'archetype:' or 'uncatalogued:' receives a
        structural band='alert_only' score of 60 immediately.  The per-indicator
        score loop is SKIPPED for these prefixes — the band is structural, not
        per-indicator.  ICT_NO_PINE_INDICATORS deduction does NOT apply because
        the archetype form ('archetype:order_block') always has an alert-only
        recipe regardless of whether the raw indicator name is in that set.

        exportable is ALWAYS True on this fast-path (the alert-only recipe is a
        legitimate compilable product).  faithful is HONEST as of Deep-Scan #21
        Wave-2 (2026-07-05) — it reflects whether the archetype's config actually
        carries Style-C exits / 11-factor confluence / multi-TF gating that Pine
        cannot reproduce (previously hardcoded True regardless — a false-green
        that fed the lifecycle promotion gate). See the fast-path body below for
        the full consumer contract: direct-routed archetypes are NOT blocked by
        faithful=False at the consumer (pine-export-service.ts::checkExportability),
        because they execute server-side via broker-router, never through Pine.
    """
    # ─── Prefix fast-path: archetype: / uncatalogued: ────────────────────────
    # These entry_indicator values denote structural archetypes whose entry/exit
    # logic lives in the Python engine (src/engine/strategies/*.py).  Pine is a
    # passive marker + alert emitter for these — alert_only band is correct by
    # contract, score=60, exportable=True.
    #
    # Detection uses entry_indicator (canonical DSL field) OR the first element
    # of indicators[] when entry_indicator is absent.
    _entry_indicator_raw = strategy_config.get("entry_indicator", "")
    if not _entry_indicator_raw:
        # Fall back to indicators[0].type for callers that build from indicators list
        _inds_raw = strategy_config.get("indicators", [])
        if _inds_raw:
            _first = _inds_raw[0]
            _entry_indicator_raw = (_first.get("type", "") if isinstance(_first, dict) else str(_first))

    if _entry_indicator_raw.startswith("archetype:") or _entry_indicator_raw.startswith("uncatalogued:"):
        prefix_label = "archetype" if _entry_indicator_raw.startswith("archetype:") else "uncatalogued"
        # Deep-Scan #18b P-2 (2026-07-05): the fast-path used to early-return with
        # deductions=[] BEFORE the §6 semantic-fidelity checks ran, so an archetype's
        # Style-C exits / 11-factor confluence / multi-TF gating were reported as fully
        # faithful with ZERO visibility that Pine drops them (empty deductions). Surface
        # those dropped features now via _pine_inexpressible_notes() so a consumer of the
        # result (dashboard / operator) is no longer blind to what the Pine artifact omits.
        _archetype_notes = _pine_inexpressible_notes(strategy_config)

        # Deep-Scan #21 Wave-2 (2026-07-05): CERTIFIED FINDING FIX — faithful used to be
        # hardcoded True UNCONDITIONALLY here, even when _archetype_notes above proves the
        # archetype carries Style-C exits / 11-factor confluence / multi-TF gating that Pine
        # genuinely cannot reproduce. That hardcoded True was a false-green: checkExportability()
        # (pine-export-service.ts) computes `ok = exportable && faithful`, and lifecycle-service.ts
        # hard-gates TESTING→PAPER / SHADOW→PAPER promotion on `!exportCheck.ok` — so the gate was
        # reading "Pine faithfully reproduces this" when it demonstrably does not.
        #
        # faithful is now HONEST: True only when _pine_inexpressible_notes() found nothing (the
        # alert-only Pine recipe really is a complete, faithful passive-marker representation of
        # a plain archetype entry with no Style-C/confluence/multi-TF complexity). False when any
        # of those features are present — Pine cannot reproduce them, full stop.
        #
        # exportable STAYS True unconditionally regardless of faithful: the alert-only Pine
        # artifact (passive marker + alertcondition) is always a legitimate, compilable PRODUCT
        # for this class of strategy — "exportable" answers "can Pine produce something usable",
        # not "does it capture full fidelity".
        #
        # Consumer contract: archetypes/uncatalogued strategies execute DIRECT via
        # broker-router — never through Pine (CLAUDE.md §7 "Pine parity wall") — so an honest
        # faithful=False here must NOT by itself block promotion. That exemption is applied at
        # the consumer (pine-export-service.ts::checkExportability), which recognizes the
        # archetype/uncatalogued prefix and does not gate the direct-routed strategy's `ok` on
        # this faithful flag — while still surfacing the honest value so no consumer is misled
        # into believing Pine faithfully reproduces logic it cannot express.
        _archetype_faithful = len(_archetype_notes) == 0

        return ExportabilityResult(
            score=60.0,
            band="alert_only",
            indicator_scores={_entry_indicator_raw: 60.0},
            deductions=_archetype_notes,
            recommendations=[
                f"'{_entry_indicator_raw}' is a structural {prefix_label} — "
                "alert-only Pine recipe assigned (passive marker + alertcondition). "
                "Python engine at src/engine/strategies/<class>.py owns entry/exit; the "
                "deductions list strategy logic Pine does NOT reproduce (visual-only aid)."
            ],
            exportable=True,
            faithful=_archetype_faithful,
        )

    score = 100.0
    deductions = []
    recommendations = []
    indicator_scores = {}

    # 1. Check indicators
    indicators = strategy_config.get("indicators", [])
    if not indicators:
        # Entry condition might reference indicators inline
        entry_indicator = strategy_config.get("entry_indicator", "")
        if entry_indicator:
            indicators = [{"type": entry_indicator}]

    for ind in indicators:
        ind_type = ind.get("type", "") if isinstance(ind, dict) else str(ind)
        # Normalize: strip suffixes like "_crossover", "_breakout"
        base_type = ind_type.split("_")[0] if "_" in ind_type else ind_type

        if base_type in NATIVE_PINE_INDICATORS:
            indicator_scores[ind_type] = 100.0
        elif ind_type in ICT_NO_PINE_INDICATORS:
            # ICT structural indicators used in raw form (e.g. 'order_block', not 'archetype:order_block').
            # These now have alert-only Pine recipes via ARCHETYPE_PINE_RECIPE — the raw name maps to
            # an archetype alias in the registry (order_block→breaker, fvg→silver_bullet, etc.).
            # The -30 deduction that previously forced do_not_export on 2+ ICT indicators is REMOVED
            # (Pass 2 Track B, 2026-06-22) because ARCHETYPE_PINE_RECIPE provides a valid alert-only
            # output for all these names.  A gentle advisory deduction remains so callers know to
            # prefer the canonical 'archetype:<key>' form.
            #
            # NOTE: The fast-path above already handles 'archetype:order_block' etc. cleanly.
            # This branch only fires when the raw name is used directly (legacy graduation rows).
            indicator_scores[ind_type] = 60.0
            score -= 5
            recommendations.append(
                f"'{ind_type}' is an ICT structural indicator — alert-only Pine recipe available "
                "via ARCHETYPE_PINE_RECIPE. Prefer 'archetype:{ind_type}' form for canonical export."
            )
        elif ind_type in NONE_MAPPED_INDICATORS or base_type in NONE_MAPPED_INDICATORS:
            # Explicitly mapped to None in INDICATOR_MAP: the compiler produces a placeholder
            # comment but no real Pine logic.  Deduct -50 (same as unknown type) so any
            # strategy with a None-mapped primary indicator scores exportable=False.
            # Message uses "no Pine equivalent" / "INDICATOR_MAP" to align with compiler output
            # and downstream test assertions.
            indicator_scores[ind_type] = 0.0
            score -= 50
            deductions.append(
                f"'{ind_type}' has no Pine equivalent in INDICATOR_MAP (mapped to None) — "
                "compiler emits a placeholder comment only. Manual Pine implementation required."
            )
        elif ind_type in CUSTOM_PINE_INDICATORS or base_type in CUSTOM_PINE_INDICATORS:
            # Approximate Pine implementation exists — partial parity.
            indicator_scores[ind_type] = 70.0
            score -= 10
            deductions.append(f"'{ind_type}' requires custom Pine implementation (approximation)")
        elif base_type in UNEXPORTABLE_INDICATORS:
            indicator_scores[ind_type] = 0.0
            score -= 40
            deductions.append(f"'{ind_type}' cannot be exported to Pine")
        else:
            # Unknown — not in INDICATOR_MAP; compiler will raise ValueError.
            # Penalize -50 so any strategy with 1+ unknown indicator scores <= 50
            # (exportable=False), aligning scorer with actual compiler behaviour.
            # Previously -15 was dishonest: it produced exportable=True (score ~85)
            # while the compiler crashed on the unknown type.
            indicator_scores[ind_type] = 0.0
            score -= 50
            deductions.append(
                f"'{ind_type}' is not in INDICATOR_MAP — compiler will raise ValueError. "
                "Add to INDICATOR_MAP or remove from strategy before exporting."
            )

    # 2. Check entry complexity
    entry_params = strategy_config.get("entry_params", {})
    if len(entry_params) > 5:
        score -= 10
        deductions.append(f"Too many entry params ({len(entry_params)}) — Pine inputs limited")

    # 3. Check exit type compatibility
    exit_type = strategy_config.get("exit_type", "")
    if exit_type in ("fixed_target", "atr_multiple"):
        pass  # Directly supported in Pine — no deduction
    elif exit_type == "trailing_stop":
        # NEITHER exported Pine artifact implements a real trailing stop today.
        # pine_compiler.py's _build_exit_condition() (both the legacy strategy_shell
        # default-live path and the dual STRATEGY artifact) always emits a single
        # strategy.exit(..., stop=close - stop_distance, ...) call with a static
        # ATR-derived distance computed once at entry — there is no trail_offset/
        # trail_points anywhere in the compiler. The internal backtester genuinely
        # trails the stop (distinct trailing_stop vs stop_loss exit-reason branches),
        # so this is a real behavioral divergence, not a cosmetic one. The -20 here
        # is informational; the section-6 semantic-fidelity check below is what
        # actually forces faithful=False / exportable=False for this exit_type — see
        # PINE-1 (2026-07-11 instrument ledger).
        score -= 20
        deductions.append(
            "exit_type='trailing_stop': NEITHER the INDICATOR nor the STRATEGY artifact "
            "implements a real Pine trailing stop today — both degrade to a fixed ATR "
            "stop computed once at entry (pine_compiler.py's strategy.exit() call never "
            "uses trail_offset/trail_points). This is a genuine behavioral divergence "
            "from the internal engine's real trailing-stop management, not just an "
            "INDICATOR-context limitation. See the section 6 semantic-fidelity check below."
        )
    elif exit_type == "time_exit":
        # Bar-count exit semantics are silently lost in the indicator artifact path:
        # Pine bar_index arithmetic approximates but does not replicate exact session-bar
        # counting (e.g. partial bars at session boundaries behave differently).
        score -= 15
        deductions.append(
            "exit_type='time_exit': bar-count exit semantics are approximated in Pine "
            "(session-boundary partial bars behave differently). Verify exit timing in TradingView."
        )
    elif exit_type == "indicator_signal":
        score -= 5
        deductions.append("Indicator-based exit may need custom Pine logic")
    else:
        score -= 15
        deductions.append(f"Exit type '{exit_type}' may not translate cleanly to Pine")

    # 4. Check for features that don't exist in Pine
    if strategy_config.get("preferred_regime"):
        score -= 5
        recommendations.append("Regime filter uses ADX+ATR — can be approximated in Pine")

    # 5. Session filter
    session = strategy_config.get("session_filter", "")
    if session and session not in ("RTH_ONLY", "ALL_SESSIONS"):
        score -= 5
        recommendations.append(f"Session filter '{session}' needs Pine time() checks")

    # ─── 6. Semantic-fidelity checks (FAIL-LOUD mandate 2026-06-22) ──────────────
    #
    # These checks detect validated strategy logic that Pine cannot express.
    # When any of these trigger, the result is faithful=False AND exportable=False,
    # regardless of the indicator score above.
    #
    # DEPLOYED strategies execute server-side via broker-router (server-mediated
    # execution).  Pine is a visual-only aid for DEPLOYED strategies — the refusal
    # below is by design, not a defect.  Simple strategies (plain indicator entry +
    # simple stop/TP) still export cleanly with faithful=True.
    #
    # Detection is intentionally liberal: if the field exists at all (even empty
    # partials array), we treat it as "this strategy was designed with partials in
    # mind" and refuse.  Conservative direction: when in doubt, refuse.

    _faithful = True  # will be set to False if any inexpressible feature is found

    # 6a. Exit semantics — Style C partials, runner trail, BE+1, adaptive exits.
    #
    # The Pine compiler emits a single strategy.exit() call with one stop/target.
    # It cannot express:
    #   - 33/33/34 partial closes at different R-multiples
    #   - Trailing runner (developing_session_poc / Chandelier / anchored VWAP)
    #   - BE+1 tick breakeven move on TP1 fill
    #   - Adaptive exit routing (regime-dependent scaling, delta-divergence early-exit)
    exit_params = strategy_config.get("exit_params", {}) or {}
    exit_plan_config = strategy_config.get("exit_plan_config", {}) or {}

    _inexpressible_exit = False

    # Style C via explicit exit_params.style
    if exit_params.get("style") in ("c", "C", "style_c", "styleC"):
        _inexpressible_exit = True

    # Partials array presence (even with 1 element implies partial-close design)
    if exit_params.get("partials"):
        _inexpressible_exit = True

    # Runner trail explicit field
    if exit_params.get("runner_trail") is True:
        _inexpressible_exit = True

    # BE+1 / breakeven move
    if exit_params.get("move_stop_to_be") is True:
        _inexpressible_exit = True

    # Adaptive exit style (Wave 25.5)
    if exit_plan_config.get("exit_style") == "adaptive":
        _inexpressible_exit = True

    if _inexpressible_exit:
        _faithful = False
        score = 0.0  # force score to 0 — not expressible at all
        deductions.append(
            "Exit semantics not expressible in Pine: Style C 33/33/34 partial closes, "
            "runner trail, and/or BE+1 breakeven mechanics cannot be reproduced by "
            "strategy.exit() — Pine emits a single all-or-nothing stop/target. "
            "This strategy executes server-side via broker-router (server-mediated "
            "execution); Pine export is a visual-only aid for DEPLOYED strategies."
        )

    # 6b. Confluence gating — 11-factor weighted scoring.
    #
    # Pine fires on the raw indicator signal alone.  A strategy that requires
    # weighted confluence (use_weighted_scoring=True) or a minimum satisfied-factor
    # count (min_factors_satisfied) is materially different from the exported Pine.
    entry_quality = strategy_config.get("entry_quality", {}) or {}

    _inexpressible_confluence = False

    if entry_quality.get("use_weighted_scoring") is True:
        _inexpressible_confluence = True

    # min_factors_satisfied > 0 means the signal is gated on factor count even
    # without weighted scoring — Pine cannot reproduce this gate.
    min_factors = entry_quality.get("min_factors_satisfied")
    if isinstance(min_factors, (int, float)) and min_factors > 0:
        _inexpressible_confluence = True

    # Explicit regime_required flag
    if entry_quality.get("regime_required") is True:
        _inexpressible_confluence = True

    if _inexpressible_confluence:
        _faithful = False
        score = 0.0  # force to 0
        deductions.append(
            "Confluence gating not expressible in Pine: this strategy requires "
            "11-factor weighted scoring and/or minimum factor satisfaction "
            "(entry_quality.use_weighted_scoring / min_factors_satisfied / regime_required) "
            "that Pine cannot reproduce — Pine fires on the raw indicator alone. "
            "This strategy executes server-side via broker-router (server-mediated "
            "execution); Pine export is a visual-only aid for DEPLOYED strategies."
        )

    # 6c. Multi-TF gating — daily_tf / htf_tf / itf_tf declared.
    #
    # The Pine compiler produces a single-timeframe indicator.  Strategies with
    # declared HTF alignment (daily_tf, htf_tf, itf_tf) require top-down multi-TF
    # AND-gating that the Pine output does not reproduce.
    _tf_fields = [
        tf_key for tf_key in ("daily_tf", "htf_tf", "itf_tf")
        if strategy_config.get(tf_key)  # non-null, non-empty
    ]

    if _tf_fields:
        _faithful = False
        score = 0.0  # force to 0
        # Emit a single combined deduction regardless of how many TF fields are set
        tf_list = ", ".join(f"{k}={strategy_config[k]!r}" for k in _tf_fields)
        deductions.append(
            f"Multi-TF gating not expressible in Pine: strategy declares HTF alignment "
            f"fields ({tf_list}) that require top-down timeframe AND-gating — "
            "Pine renders on the single chart timeframe and cannot reproduce multi-TF "
            "bias alignment (daily_tf / htf_tf / itf_tf). "
            "This strategy executes server-side via broker-router (server-mediated "
            "execution); Pine export is a visual-only aid for DEPLOYED strategies."
        )

    # 6d. Trailing-stop exit — neither Pine artifact implements a real trailing stop.
    #
    # pine_compiler.py's _build_exit_condition() always emits a single strategy.exit()
    # call with a static ATR-derived stop distance computed once at entry — there is no
    # trail_offset/trail_points anywhere in the compiler, in EITHER the default-live
    # strategy_shell path or the dual STRATEGY artifact. The internal backtester genuinely
    # trails the stop (distinct trailing_stop vs stop_loss exit-reason branches), so an
    # operator deploying either exported artifact for a trailing_stop strategy would hold
    # a fixed stop through a trending move where the internal engine locks in profit —
    # a silent, material behavioral divergence. PINE-1 (2026-07-11 instrument ledger).
    if exit_type == "trailing_stop":
        _faithful = False
        score = 0.0  # force to 0 — not faithfully expressible in either artifact today
        deductions.append(
            "Trailing-stop exit not expressible in Pine: neither the INDICATOR nor the "
            "STRATEGY artifact implements a real trailing stop — pine_compiler.py emits "
            "a single strategy.exit() with a static ATR distance computed once at entry "
            "(no trail_offset/trail_points). This diverges materially from the internal "
            "engine's genuine trailing-stop management on trending moves. "
            "This strategy executes server-side via broker-router (server-mediated "
            "execution); Pine export is a visual-only aid for DEPLOYED strategies."
        )

    # ─── Clamp ────────────────────────────────────────────────────────────────────
    score = max(0.0, min(100.0, score))

    # Determine band
    if score >= 90:
        band = "clean"
    elif score >= 70:
        band = "reducible"
    elif score >= 50:
        band = "alert_only"
        recommendations.append("Consider alert-only export instead of full indicator")
    else:
        band = "do_not_export"

    # exportable=False when score < 50 OR when semantic fidelity check failed
    _exportable = (score >= 50) and _faithful

    return ExportabilityResult(
        score=score,
        band=band,
        indicator_scores=indicator_scores,
        deductions=deductions,
        recommendations=recommendations,
        exportable=_exportable,
        faithful=_faithful,
    )


if __name__ == "__main__":
    # CLI: python -m src.engine.exportability --input-json <file_or_json_string>
    import argparse
    import os
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-json", required=True)
    args = parser.parse_args()

    raw = args.input_json
    if os.path.isfile(raw):
        with open(raw) as f:
            raw = f.read()
    strategy = json.loads(raw)
    result = score_exportability(strategy)
    print(json.dumps(result.model_dump(), indent=2))
