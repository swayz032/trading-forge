#!/usr/bin/env python3
"""Build v2.3 promotion Evidence from immutable/local artifacts.

No evidence count is hardcoded here. Positive/negative gold, architecture tests,
sealed OOS and shadow campaign values are read from their actual receipts. Missing
artifacts become zero/false evidence and therefore fail closed.
"""
from __future__ import annotations

import json
from pathlib import Path

from research.current_mnq_strategy_v2_3_local_runtime import inspect_runtime
from research.current_mnq_strategy_v2_3_policy import Evidence, load_spec, semantics_hash
from research.current_mnq_strategy_v2_3_shadow import summarize_shadow

HERE = Path(__file__).resolve().parent
POSITIVE_GOLD = HERE / "current_mnq_strategy_v2_2_gold_set.json"
NEGATIVE_GOLD = HERE / "current_mnq_strategy_v2_3_no_trade_gold.json"


def _json(path: str | Path | None) -> dict:
    if not path:
        return {}
    p = Path(path)
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text())
    except Exception as exc:
        raise RuntimeError(f"EVIDENCE_JSON_CORRUPT:{p}") from exc


def gold_counts() -> tuple[int, int]:
    pos = _json(POSITIVE_GOLD)
    neg = _json(NEGATIVE_GOLD)
    return len(pos.get("fixtures", [])), len(neg.get("fixtures", []))


def build_evidence(*, architecture_receipt: str | Path | None,
                   sealed_report: str | Path | None,
                   shadow_journal: str | Path | None,
                   operations_drill_receipt: str | Path | None = None) -> Evidence:
    spec = load_spec()
    arch = _json(architecture_receipt)
    sealed = _json(sealed_report)
    drill = _json(operations_drill_receipt)
    pos_gold, neg_gold = gold_counts()
    sh = summarize_shadow(shadow_journal) if shadow_journal and Path(shadow_journal).exists() else {}

    sealed_ev = sealed.get("evidence", {})
    seal = sealed.get("seal", {})
    sealed_same_semantics = bool(seal) and seal.get("semantics_sha256") == semantics_hash()
    arch_same_semantics = bool(arch) and arch.get("semantics_sha256") == semantics_hash()
    current_local = inspect_runtime().personal_device_candidate

    return Evidence(
        semantics_sha256=semantics_hash(),
        architecture_tests_passed=int(arch.get("tests", 0)) if arch_same_semantics else 0,
        architecture_tests_failed=int(arch.get("failures", 1)) if arch_same_semantics else 1,
        real_user_positive_gold=int(pos_gold),
        semantic_negative_fixtures=len(spec.get("negative_semantic_fixtures", [])),
        real_user_tempting_no_trade_gold=int(neg_gold),
        contract_provenance_pass=bool(sealed_ev.get("contract_provenance_pass", False)) and sealed_same_semantics,
        data_quality_pass=bool(sealed_ev.get("data_quality_pass", False)) and sealed_same_semantics,
        sealed_calendar_years=float(sealed_ev.get("sealed_calendar_years", 0.0)) if sealed_same_semantics else 0.0,
        sealed_sessions=int(sealed_ev.get("sealed_sessions", 0)) if sealed_same_semantics else 0,
        sealed_trades=int(sealed_ev.get("sealed_trades", 0)) if sealed_same_semantics else 0,
        chronological_folds=int(sealed_ev.get("chronological_folds", 0)) if sealed_same_semantics else 0,
        positive_folds=int(sealed_ev.get("positive_folds", 0)) if sealed_same_semantics else 0,
        block_bootstrap_mean_lower_95=(sealed_ev.get("block_bootstrap_mean_lower_95") if sealed_same_semantics else None),
        slippage_stress_net=(dict(sealed_ev.get("slippage_stress_net", {})) if sealed_same_semantics else {}),
        sealed_rules_changed_after_run=not sealed_same_semantics,
        shadow_full_sessions=int(sh.get("full_sessions", 0)),
        shadow_trades=int(sh.get("would_trade_sessions", 0)),
        shadow_rule_changes=int(sh.get("rule_changes", 1)),
        shadow_duplicate_order_events=int(sh.get("duplicate_order_events", 1)),
        shadow_unreconciled_state_events=int(sh.get("unreconciled_state_events", 1)),
        shadow_signal_parity_mismatches=int(sh.get("signal_parity_mismatches", 1)),
        personal_device_verified=bool(current_local and sh.get("full_sessions", 0) > 0),
        realtime_user_hub_verified=bool(sh.get("user_hub_all_healthy", False)),
        realtime_market_hub_verified=bool(sh.get("market_hub_all_healthy", False)),
        topstep_simulated_account_verified=bool(sh.get("simulated_account_all_verified", False)),
        broker_reconciliation_verified=bool(drill.get("broker_reconciliation_verified", False)),
        emergency_flatten_drill_passed=bool(drill.get("emergency_flatten_drill_passed", False)),
    )
