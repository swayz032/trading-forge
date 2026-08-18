#!/usr/bin/env python3
"""Fail-closed evidence policy bound to every Current MNQ v2.4 contract."""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path

SPEC_PATH = Path(__file__).with_name("current_mnq_strategy_v2_4_spec.json")
FVG_SPEC_PATH = Path(__file__).with_name("current_mnq_strategy_v2_4_fvg_semantics.json")
EDGE_SPEC_PATH = Path(__file__).with_name("current_mnq_strategy_v2_4_edge_semantics.json")
KEY_LEVEL_SPEC_PATH = Path(__file__).with_name("current_mnq_strategy_v2_4_key_level_semantics.json")


def semantics_hash(path: str | Path = SPEC_PATH,
                   fvg_path: str | Path = FVG_SPEC_PATH,
                   edge_path: str | Path = EDGE_SPEC_PATH,
                   key_level_path: str | Path = KEY_LEVEL_SPEC_PATH) -> str:
    """Hash every executable semantic/evidence contract."""
    h = hashlib.sha256()
    for p in (Path(path), Path(fvg_path), Path(edge_path), Path(key_level_path)):
        data = p.read_bytes()
        h.update(len(data).to_bytes(8, "big"))
        h.update(data)
    return h.hexdigest()


def load_spec(path: str | Path = SPEC_PATH) -> dict:
    return json.loads(Path(path).read_text())


def load_fvg_spec(path: str | Path = FVG_SPEC_PATH) -> dict:
    return json.loads(Path(path).read_text())


def load_edge_spec(path: str | Path = EDGE_SPEC_PATH) -> dict:
    return json.loads(Path(path).read_text())


def load_key_level_spec(path: str | Path = KEY_LEVEL_SPEC_PATH) -> dict:
    return json.loads(Path(path).read_text())


@dataclass(frozen=True)
class Evidence:
    semantics_sha256: str
    architecture_tests_passed: int = 0
    architecture_tests_failed: int = 0
    real_user_positive_gold: int = 0
    semantic_negative_fixtures: int = 0
    real_user_tempting_no_trade_gold: int = 0
    contract_provenance_pass: bool = False
    data_quality_pass: bool = False
    sealed_calendar_years: float = 0.0
    sealed_sessions: int = 0
    sealed_trades: int = 0
    chronological_folds: int = 0
    positive_folds: int = 0
    block_bootstrap_mean_lower_95: float | None = None
    slippage_stress_net: dict[str, float] = field(default_factory=dict)
    robust_edge_expectancy: float | None = None
    detailed_expectancy: float | None = None
    leave_best_month_out_expectancy: float | None = None
    break_even_margin: float | None = None
    data_clean_oos: bool = False
    sealed_rules_changed_after_run: bool = True
    shadow_full_sessions: int = 0
    shadow_trades: int = 0
    shadow_rule_changes: int = 1
    shadow_duplicate_order_events: int = 1
    shadow_unreconciled_state_events: int = 1
    shadow_missed_first_signal_events: int = 1
    shadow_signal_parity_mismatches: int = 1
    personal_device_verified: bool = False
    realtime_user_hub_verified: bool = False
    realtime_market_hub_verified: bool = False
    topstep_simulated_account_verified: bool = False
    broker_reconciliation_verified: bool = False
    emergency_flatten_drill_passed: bool = False


@dataclass(frozen=True)
class GateResult:
    approved: bool
    stage: str
    reasons: tuple[str, ...]


def _required_slippage_keys(spec: dict) -> tuple[str, ...]:
    return tuple(f"{float(x):g}" for x in spec["evidence_policy"]["slippage_stress_points"])


def research_gate(ev: Evidence, spec: dict | None = None) -> GateResult:
    spec = spec or load_spec(); req = spec["evidence_policy"]
    reasons: list[str] = []
    if ev.semantics_sha256 != semantics_hash(): reasons.append("SEMANTICS_HASH_MISMATCH")
    if ev.architecture_tests_failed != 0: reasons.append("ARCHITECTURE_TEST_FAILURE")
    if ev.architecture_tests_passed <= 0: reasons.append("NO_ARCHITECTURE_TEST_EVIDENCE")
    if ev.real_user_positive_gold < int(req["real_user_positive_gold_min"]): reasons.append("INSUFFICIENT_POSITIVE_GOLD")
    if ev.semantic_negative_fixtures < int(req["semantic_negative_fixture_min"]): reasons.append("INSUFFICIENT_NEGATIVE_SEMANTIC_FIXTURES")
    if ev.real_user_tempting_no_trade_gold < int(req["real_user_tempting_no_trade_gold_min"]): reasons.append("MISSING_REAL_USER_NO_TRADE_GOLD")
    return GateResult(not reasons, "FIDELITY", tuple(reasons))


def sealed_validation_gate(ev: Evidence, spec: dict | None = None) -> GateResult:
    spec = spec or load_spec(); req = spec["evidence_policy"]; edge = load_edge_spec()["gates"]
    reasons = list(research_gate(ev, spec).reasons)
    if not ev.contract_provenance_pass: reasons.append("CONTRACT_PROVENANCE_NOT_PROVEN")
    if not ev.data_quality_pass: reasons.append("DATA_QUALITY_NOT_PROVEN")
    if ev.sealed_calendar_years < float(req["sealed_validation_min_calendar_years"]): reasons.append("INSUFFICIENT_SEALED_YEARS")
    if ev.sealed_sessions < max(int(req["sealed_validation_min_sessions"]), int(edge["minimum_score_sessions"])): reasons.append("INSUFFICIENT_SEALED_SESSIONS")
    if ev.sealed_trades < max(int(req["sealed_validation_min_trades"]), int(edge["minimum_trades"])): reasons.append("INSUFFICIENT_SEALED_TRADES")
    if ev.chronological_folds != int(req["chronological_folds"]): reasons.append("WRONG_FOLD_COUNT")
    if ev.positive_folds < int(req["min_positive_folds"]): reasons.append("INSUFFICIENT_POSITIVE_FOLDS")
    if ev.block_bootstrap_mean_lower_95 is None or ev.block_bootstrap_mean_lower_95 <= 0: reasons.append("EXPECTANCY_LOWER_95_NOT_POSITIVE")
    if ev.sealed_rules_changed_after_run: reasons.append("SEALED_RESULT_INVALIDATED_BY_RULE_CHANGE")
    for key in _required_slippage_keys(spec):
        if key not in ev.slippage_stress_net: reasons.append(f"MISSING_SLIPPAGE_STRESS:{key}")
        elif float(ev.slippage_stress_net[key]) <= 0: reasons.append(f"NEGATIVE_SLIPPAGE_STRESS:{key}")
    if not ev.data_clean_oos: reasons.append("EDGE_DATA_NOT_CLEAN_OOS")
    if ev.robust_edge_expectancy is None or ev.robust_edge_expectancy <= 0: reasons.append("ROBUST_EDGE_EXPECTANCY_NOT_POSITIVE")
    if ev.detailed_expectancy is None or ev.detailed_expectancy <= 0: reasons.append("EDGE_TOP5_WINNER_REMOVAL_NOT_POSITIVE")
    if ev.leave_best_month_out_expectancy is None or ev.leave_best_month_out_expectancy <= 0: reasons.append("EDGE_LEAVE_BEST_MONTH_OUT_NOT_POSITIVE")
    if ev.break_even_margin is None or ev.break_even_margin <= 0: reasons.append("EDGE_BREAK_EVEN_MARGIN_NOT_POSITIVE")
    return GateResult(not reasons, "RESEARCH_VERIFIED", tuple(reasons))


def shadow_gate(ev: Evidence, spec: dict | None = None) -> GateResult:
    spec = spec or load_spec(); req = spec["evidence_policy"]
    reasons = list(sealed_validation_gate(ev, spec).reasons)
    if ev.shadow_full_sessions < int(req["shadow_min_full_sessions"]): reasons.append("INSUFFICIENT_SHADOW_SESSIONS")
    if ev.shadow_trades < int(req["shadow_min_executed_or_would_execute_trades"]): reasons.append("INSUFFICIENT_SHADOW_TRADES")
    if ev.shadow_rule_changes != int(req["shadow_rule_changes_allowed"]): reasons.append("SHADOW_RULE_CHANGED")
    if ev.shadow_duplicate_order_events != int(req["shadow_duplicate_order_events_allowed"]): reasons.append("SHADOW_DUPLICATE_ORDER_EVENT")
    if ev.shadow_unreconciled_state_events != int(req["shadow_unreconciled_state_events_allowed"]): reasons.append("SHADOW_UNRECONCILED_STATE")
    if ev.shadow_missed_first_signal_events != 0: reasons.append("SHADOW_MISSED_FIRST_A_PLUS_SIGNAL")
    if ev.shadow_signal_parity_mismatches != 0: reasons.append("SHADOW_SIGNAL_PARITY_MISMATCH")
    if not ev.personal_device_verified: reasons.append("PERSONAL_DEVICE_NOT_VERIFIED")
    if not ev.realtime_user_hub_verified: reasons.append("USER_HUB_NOT_VERIFIED")
    if not ev.realtime_market_hub_verified: reasons.append("MARKET_HUB_NOT_VERIFIED")
    if not ev.topstep_simulated_account_verified: reasons.append("TOPSTEP_SIMULATED_ACCOUNT_NOT_VERIFIED")
    if not ev.broker_reconciliation_verified: reasons.append("BROKER_RECONCILIATION_NOT_VERIFIED")
    if not ev.emergency_flatten_drill_passed: reasons.append("EMERGENCY_FLATTEN_DRILL_NOT_PROVEN")
    return GateResult(not reasons, "SHADOW_VERIFIED", tuple(reasons))


def live_gate(ev: Evidence, spec: dict | None = None) -> GateResult:
    spec = spec or load_spec(); result = shadow_gate(ev, spec)
    return GateResult(result.approved, spec["deployment"].get("promotion_stage_name", "TOPSTEPX_API_AUTOMATION_ELIGIBLE"), result.reasons)
