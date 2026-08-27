#!/usr/bin/env python3
"""Build Current MNQ v2.4 promotion evidence from actual artifacts.

Positive/negative user gold is identity-bound, not merely counted. Architecture
receipts must contain the exact SHA256 of the inherited positive manifest, the
current v2.4 trader-fidelity manifest, and the tempting-NO-TRADE manifest;
changing any fixture while preserving row counts invalidates old evidence.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from research.current_mnq_strategy_v2_3_local_runtime import inspect_runtime
from research.current_mnq_strategy_v2_3_shadow import summarize_shadow
from research.current_mnq_strategy_v2_4_policy import Evidence, load_spec, semantics_hash

HERE = Path(__file__).resolve().parent
POSITIVE_GOLD = HERE / "current_mnq_strategy_v2_2_gold_set.json"
V24_POSITIVE_GOLD = HERE / "current_mnq_strategy_v2_4_user_fidelity_gold.json"
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
        raise RuntimeError(f"V24_EVIDENCE_JSON_CORRUPT:{p}") from exc


def _sha256(path: str | Path) -> str:
    p = Path(path)
    if not p.exists() or not p.is_file():
        raise RuntimeError(f"V24_GOLD_MANIFEST_MISSING:{p}")
    return hashlib.sha256(p.read_bytes()).hexdigest()


def gold_counts() -> tuple[int, int]:
    inherited = _json(POSITIVE_GOLD)
    current = _json(V24_POSITIVE_GOLD)
    neg = _json(NEGATIVE_GOLD)
    return (
        len(inherited.get("fixtures", [])) + len(current.get("fixtures", [])),
        len(neg.get("fixtures", [])),
    )


def gold_manifest_hashes() -> dict[str, str]:
    return {
        "positive_user_gold_sha256": _sha256(POSITIVE_GOLD),
        "v24_user_fidelity_gold_sha256": _sha256(V24_POSITIVE_GOLD),
        "tempting_no_trade_gold_sha256": _sha256(NEGATIVE_GOLD),
    }


def architecture_gold_integrity(arch: dict) -> bool:
    current = gold_manifest_hashes()
    return bool(
        arch
        and arch.get("positive_user_gold_sha256") == current["positive_user_gold_sha256"]
        and arch.get("v24_user_fidelity_gold_sha256") == current["v24_user_fidelity_gold_sha256"]
        and arch.get("tempting_no_trade_gold_sha256") == current["tempting_no_trade_gold_sha256"]
    )


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

    seal = sealed.get("seal", {})
    sealed_ev = sealed.get("evidence", {})
    edge = sealed.get("edge_certificate", {})
    sealed_same = bool(seal) and seal.get("semantics_sha256") == semantics_hash()
    arch_same = bool(arch) and arch.get("semantics_sha256") == semantics_hash()
    gold_same = arch_same and architecture_gold_integrity(arch)
    drill_same = bool(drill) and drill.get("semantics_sha256") == semantics_hash()
    current_local = inspect_runtime().personal_device_candidate

    return Evidence(
        semantics_sha256=semantics_hash(),
        architecture_tests_passed=int(arch.get("tests", 0)) if arch_same else 0,
        architecture_tests_failed=int(arch.get("failures", 1)) if arch_same else 1,
        real_user_positive_gold=int(pos_gold),
        semantic_negative_fixtures=len(spec.get("negative_semantic_fixtures", [])),
        real_user_tempting_no_trade_gold=int(neg_gold),
        gold_manifest_integrity_pass=bool(gold_same),
        contract_provenance_pass=bool(sealed_ev.get("contract_provenance_pass", False)) and sealed_same,
        data_quality_pass=bool(sealed_ev.get("data_quality_pass", False)) and sealed_same,
        clean_historical_scope_pass=bool(sealed_ev.get("clean_historical_scope_pass", False)) and sealed_same,
        sealed_calendar_years=float(sealed_ev.get("sealed_calendar_years", 0.0)) if sealed_same else 0.0,
        sealed_sessions=int(sealed_ev.get("sealed_sessions", 0)) if sealed_same else 0,
        sealed_trades=int(sealed_ev.get("sealed_trades", 0)) if sealed_same else 0,
        chronological_folds=int(sealed_ev.get("chronological_folds", 0)) if sealed_same else 0,
        positive_folds=int(sealed_ev.get("positive_folds", 0)) if sealed_same else 0,
        block_bootstrap_mean_lower_95=(sealed_ev.get("block_bootstrap_mean_lower_95") if sealed_same else None),
        slippage_stress_net=(dict(sealed_ev.get("slippage_stress_net", {})) if sealed_same else {}),
        robust_edge_expectancy=(edge.get("robust_edge_expectancy") if sealed_same else None),
        detailed_expectancy=(edge.get("detailed_expectancy") if sealed_same else None),
        leave_best_month_out_expectancy=(edge.get("leave_best_month_out_expectancy") if sealed_same else None),
        break_even_margin=(edge.get("break_even_margin") if sealed_same else None),
        data_clean_oos=bool(edge.get("data_clean", False)) and sealed_same,
        sealed_rules_changed_after_run=not sealed_same,
        shadow_full_sessions=int(sh.get("full_sessions", 0)),
        shadow_trades=int(sh.get("would_trade_sessions", 0)),
        shadow_rule_changes=int(sh.get("rule_changes", 1)),
        shadow_duplicate_order_events=int(sh.get("duplicate_order_events", 1)),
        shadow_unreconciled_state_events=int(sh.get("unreconciled_state_events", 1)),
        shadow_missed_first_signal_events=int(sh.get("missed_first_signal_events", 1)),
        shadow_signal_parity_mismatches=int(sh.get("signal_parity_mismatches", 1)),
        personal_device_verified=bool(current_local and sh.get("full_sessions", 0) > 0),
        realtime_user_hub_verified=bool(sh.get("user_hub_all_healthy", False)),
        realtime_market_hub_verified=bool(sh.get("market_hub_all_healthy", False)),
        topstep_simulated_account_verified=bool(sh.get("simulated_account_all_verified", False)),
        broker_reconciliation_verified=bool(drill.get("broker_reconciliation_verified", False)) and drill_same,
        emergency_flatten_drill_passed=bool(drill.get("emergency_flatten_drill_passed", False)) and drill_same,
    )
