"""Canonical ablation layer registry for the Trading Forge eligibility gate.

Shared between:
  - src/engine/backtester.py (apply_eligibility_gate -- per-layer disable logic)
  - scripts/filter-ablation-cpcv.py (grid orchestrator)
  - tests/test_filter_ablation.py (layer enumeration consistency tests)

Each entry maps a canonical short name to the detection prefix of the
decision.reasoning[0] string emitted by evaluate_signal() in
src/engine/context/eligibility_gate.py.

Prefix match (reason.startswith(prefix)) is used because most reason strings
are dynamic (embed score values, session names, etc.).

Maintenance rule: when a new hard-SKIP check is added to eligibility_gate.py,
add a corresponding entry here. The test_layer_registry_matches_gate_checks
test in tests/test_filter_ablation.py will fail if this registry drifts from
the gate source.
"""
from __future__ import annotations

# Canonical layer registry: short name -> detection prefix.
# Order matches the hard-SKIP evaluation order (checks 0-9) in eligibility_gate.py.
ABLATION_LAYER_MAP: dict[str, str] = {
    "stop_ceiling":       "SKIP_TRADE:",
    "no_trade":           "NO_TRADE playbook active",
    "strategy_allowlist": "Strategy '",
    "direction_bias":     "Direction '",
    "kill_zone":          "Not in kill zone",
    "sweep":              "No liquidity sweep present",
    "location_score":     "Location score",
    "rr_ratio":           "TP2 R:R",
    "daily_limit":        "Daily trade limit reached",
    "bias_confidence":    "Bias confidence",
}

# Ordered list (preserves gate evaluation order for reports).
ABLATION_LAYER_NAMES: list[str] = list(ABLATION_LAYER_MAP.keys())


def reason_to_layer(reason: str) -> str | None:
    """Map a raw reasoning[0] string to a canonical layer name, or None if unknown.

    Uses prefix matching so dynamic reason strings (score values, session names)
    still resolve to the correct canonical entry.
    """
    for name, prefix in ABLATION_LAYER_MAP.items():
        if reason.startswith(prefix):
            return name
    return None


def is_layer_disabled(reason: str, disabled_layers: set) -> bool:
    """Return True if the reason's layer is in disabled_layers.

    Args:
        reason: decision.reasoning[0] from evaluate_signal()
        disabled_layers: set of canonical layer names to treat as pass-through
    """
    if not disabled_layers:
        return False
    layer = reason_to_layer(reason)
    return layer is not None and layer in disabled_layers
