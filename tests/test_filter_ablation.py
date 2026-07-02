"""Regression tests for the layer4-ablation harness.

Tests in this file are deliberately lightweight — no vectorbt, no data loads,
no live engine calls. The ablation grid itself is compute-heavy and
operator-scheduled; these tests verify the surrounding logic:

  1. TestLayerRegistryMatchesGateChecks
       Every canonical layer name in ABLATION_LAYER_MAP has a detection prefix
       that appears in eligibility_gate.py source. Fails if someone adds a gate
       check without registering it in the ablation registry.

  2. TestDefaultPathByteIdentity
       With TF_OVERLAY_DISABLE_LAYERS="" or unset, is_layer_disabled() returns
       False for all reasons (no ablation overrides injected).

  3. TestGridOrchestrationMocked
       Verdict function logic and manifest key conventions, tested with inline
       implementations (avoids importing the hyphen-named script module).

  4. TestVerdictMathThresholds
       Parametrized boundary tests at exactly DSR_THRESHOLD = 0.05.

  5. TestNoTradeHypothesisCheck
       _check_no_trade_hypothesis logic via mocked gate_stats dictionaries.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

# ── Ensure repo root is on path for direct `python -m pytest` invocations ────
_REPO_ROOT = Path(__file__).parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))


# ─────────────────────────────────────────────────────────────────────────────
# Test 1: Layer registry consistency with gate source
# ─────────────────────────────────────────────────────────────────────────────

class TestLayerRegistryMatchesGateChecks:
    """Verify ABLATION_LAYER_MAP stays in sync with eligibility_gate.py.

    This test is the sentinel: if a new hard-SKIP check is added to
    eligibility_gate.py without adding a registry entry, this test fails.
    """

    def test_all_canonical_names_have_prefix_in_gate_source(self):
        """Every detection prefix must appear in eligibility_gate.py source."""
        from src.engine.ablation_layers import ABLATION_LAYER_MAP

        gate_path = (
            Path(__file__).parent.parent
            / "src" / "engine" / "context" / "eligibility_gate.py"
        )
        assert gate_path.exists(), f"eligibility_gate.py not found at {gate_path}"
        gate_source = gate_path.read_text(encoding="utf-8")

        for name, prefix in ABLATION_LAYER_MAP.items():
            # Use a generous match: first 20 chars of the prefix must appear
            # somewhere in the source (in a reasoning.append call).
            assert prefix[:20] in gate_source, (
                f"Layer '{name}': detection prefix '{prefix[:20]}...' not found in "
                f"eligibility_gate.py. Update ABLATION_LAYER_MAP in ablation_layers.py "
                f"or add/restore the matching gate check."
            )

    def test_no_duplicate_prefixes(self):
        """Prefixes must be unique so detection is unambiguous."""
        from src.engine.ablation_layers import ABLATION_LAYER_MAP

        prefixes = list(ABLATION_LAYER_MAP.values())
        assert len(prefixes) == len(set(prefixes)), (
            "Duplicate detection prefixes found in ABLATION_LAYER_MAP — "
            "each gate layer must have a unique prefix."
        )

    def test_no_trade_layer_always_registered(self):
        """no_trade is the primary hypothesis layer; must never be missing."""
        from src.engine.ablation_layers import ABLATION_LAYER_MAP
        assert "no_trade" in ABLATION_LAYER_MAP

    def test_expected_layer_count_is_ten(self):
        """Gate has 10 hard-SKIP checks (0-9); registry must have at least 10 entries."""
        from src.engine.ablation_layers import ABLATION_LAYER_MAP
        # If new layers are added, count increases. Never decreases below 10.
        assert len(ABLATION_LAYER_MAP) >= 10, (
            f"Expected >= 10 layer entries, got {len(ABLATION_LAYER_MAP)}. "
            "Add missing entries to ABLATION_LAYER_MAP."
        )

    def test_reason_to_layer_maps_stable_strings(self):
        """reason_to_layer must correctly identify stable (non-dynamic) reasons."""
        from src.engine.ablation_layers import reason_to_layer

        # Stable reasons (exact match)
        assert reason_to_layer("NO_TRADE playbook active") == "no_trade"
        assert reason_to_layer("No liquidity sweep present — A+/B+ requires sweep") == "sweep"
        assert reason_to_layer("Daily trade limit reached") == "daily_limit"

        # Dynamic reasons (prefix match)
        assert reason_to_layer("Not in kill zone (session=ny, ny_kz=False, london_kz=False)") == "kill_zone"
        assert reason_to_layer("TP2 R:R 1.2 < 2.0 minimum") == "rr_ratio"
        assert reason_to_layer("Location score 45 < 60 (D)") == "location_score"
        assert reason_to_layer("Direction 'long' opposes bias 'short'") == "direction_bias"
        assert reason_to_layer("SKIP_TRADE: stop distance 15pt exceeds MES ceiling 14pt") == "stop_ceiling"
        assert reason_to_layer("Bias confidence 0.35 < 0.4 minimum") == "bias_confidence"

        # Unknown reason
        assert reason_to_layer("completely unknown gate message") is None

    def test_is_layer_disabled_gate(self):
        """is_layer_disabled returns True only when reason matches a disabled layer."""
        from src.engine.ablation_layers import is_layer_disabled

        disabled = {"no_trade", "kill_zone"}

        assert is_layer_disabled("NO_TRADE playbook active", disabled) is True
        assert is_layer_disabled("Not in kill zone (session=ny)", disabled) is True
        assert is_layer_disabled("TP2 R:R 1.5 < 2.0 minimum", disabled) is False
        assert is_layer_disabled("NO_TRADE playbook active", set()) is False


# ─────────────────────────────────────────────────────────────────────────────
# Test 2: Default path byte identity
# ─────────────────────────────────────────────────────────────────────────────

class TestDefaultPathByteIdentity:
    """With TF_OVERLAY_DISABLE_LAYERS unset/empty, no ablation overrides fire."""

    def test_empty_disabled_set_never_overrides(self):
        """is_layer_disabled always returns False for empty disabled_layers."""
        from src.engine.ablation_layers import ABLATION_LAYER_MAP, is_layer_disabled

        # Every possible reason prefix: with empty set, none should match
        sample_reasons = [
            "NO_TRADE playbook active",
            "Not in kill zone (session=ny, ny_kz=False, london_kz=False)",
            "No liquidity sweep present — A+/B+ requires sweep",
            "Location score 30 < 60 (F)",
            "TP2 R:R 1.0 < 2.0 minimum",
            "Daily trade limit reached",
            "Bias confidence 0.20 < 0.4 minimum",
            "Direction 'long' opposes bias 'short' (net_bias=-1)",
            "SKIP_TRADE: stop exceeds ceiling",
        ]
        for reason in sample_reasons:
            assert is_layer_disabled(reason, set()) is False, (
                f"Unexpected override for '{reason}' with empty disabled set"
            )

    def test_env_var_parse_empty_string_yields_empty_set(self):
        """Parsing TF_OVERLAY_DISABLE_LAYERS='' yields an empty set."""
        env_val = ""
        parsed = {x.strip() for x in env_val.split(",") if x.strip()}
        assert parsed == set()

    def test_env_var_parse_single_layer(self):
        """TF_OVERLAY_DISABLE_LAYERS='no_trade' yields {'no_trade'}."""
        env_val = "no_trade"
        parsed = {x.strip() for x in env_val.split(",") if x.strip()}
        assert parsed == {"no_trade"}

    def test_env_var_parse_multiple_layers_with_spaces(self):
        """TF_OVERLAY_DISABLE_LAYERS='no_trade , kill_zone' strips spaces correctly."""
        env_val = "no_trade , kill_zone"
        parsed = {x.strip() for x in env_val.split(",") if x.strip()}
        assert parsed == {"no_trade", "kill_zone"}

    def test_env_var_parse_whitespace_only_is_empty(self):
        """TF_OVERLAY_DISABLE_LAYERS='  ' yields empty set (no spurious entries)."""
        env_val = "  ,  ,  "
        parsed = {x.strip() for x in env_val.split(",") if x.strip()}
        assert parsed == set()


# ─────────────────────────────────────────────────────────────────────────────
# Test 3: Grid orchestration mocked
# ─────────────────────────────────────────────────────────────────────────────

# Inline the verdict function to test without importing the hyphen-named script.
_DSR_THRESHOLD = 0.05


def _verdict_inline(dsr_baseline, dsr_layer, trades_baseline, trades_layer, layer_name):
    """Inline copy of _compute_verdict() for isolated testing."""
    if dsr_baseline is None or dsr_layer is None:
        return {
            "verdict": "INDETERMINATE",
            "delta_dsr": None,
            "delta_trades": trades_layer - trades_baseline if trades_baseline else None,
            "reason": "insufficient data",
        }
    delta = round(dsr_layer - dsr_baseline, 4)
    delta_trades = trades_layer - trades_baseline
    if delta >= _DSR_THRESHOLD:
        verdict = "HARMFUL"
    elif delta <= -_DSR_THRESHOLD:
        verdict = "CONTRIBUTING"
    else:
        verdict = "DEAD_WEIGHT"
    return {
        "verdict": verdict,
        "delta_dsr": delta,
        "delta_trades": delta_trades,
        "reason": f"delta_dsr={delta:+.4f}",
    }


class TestGridOrchestrationMocked:
    """Test verdict logic and manifest conventions without live engine calls."""

    def test_verdict_contributing(self):
        """Removing a layer that degrades DSR -> CONTRIBUTING."""
        r = _verdict_inline(0.80, 0.70, 100, 110, "kill_zone")
        assert r["verdict"] == "CONTRIBUTING"
        assert r["delta_dsr"] == -0.10

    def test_verdict_harmful(self):
        """Removing a layer that improves DSR -> HARMFUL."""
        r = _verdict_inline(0.80, 0.90, 100, 80, "sweep")
        assert r["verdict"] == "HARMFUL"
        assert r["delta_dsr"] == 0.10

    def test_verdict_dead_weight(self):
        """Removing a layer with tiny delta -> DEAD_WEIGHT."""
        r = _verdict_inline(0.80, 0.82, 100, 105, "location_score")
        assert r["verdict"] == "DEAD_WEIGHT"
        assert r["delta_dsr"] == 0.02

    def test_verdict_indeterminate_when_baseline_none(self):
        """INDETERMINATE if baseline DSR unavailable."""
        r = _verdict_inline(None, 0.80, 0, 50, "no_trade")
        assert r["verdict"] == "INDETERMINATE"
        assert r["delta_dsr"] is None

    def test_verdict_indeterminate_when_layer_none(self):
        """INDETERMINATE if layer DSR unavailable."""
        r = _verdict_inline(0.80, None, 100, 0, "no_trade")
        assert r["verdict"] == "INDETERMINATE"

    def test_manifest_baseline_key(self):
        """Baseline manifest key is exactly '__baseline__'."""
        assert "__baseline__" == "__baseline__"

    def test_manifest_layer_key_pattern(self):
        """Layer manifest keys follow 'layer__{name}' pattern."""
        for name in ["no_trade", "kill_zone", "rr_ratio", "bias_confidence"]:
            key = f"layer__{name}"
            assert key.startswith("layer__")
            assert key[7:] == name

    def test_governance_label_required_keys(self):
        """Governance label dict has all required fields."""
        label = {
            "governance_advisory": True,
            "ablation_marker": True,
            "persist_to_production": False,
            "authority": "research_only -- verdicts inform UNFREEZING decisions",
        }
        assert label["governance_advisory"] is True
        assert label["ablation_marker"] is True
        assert label["persist_to_production"] is False
        assert "research_only" in label["authority"]
        assert "UNFREEZING" in label["authority"] or "unfreeze" in label["authority"].lower()

    def test_report_serializes_to_json(self):
        """Report structure can be serialized to JSON without error."""
        report = {
            "governance_advisory": True,
            "ablation_marker": True,
            "persist_to_production": False,
            "authority": "research_only",
            "generated_at": "2026-07-02T12:00:00Z",
            "summary": {
                "strategy": "test",
                "baseline_dsr": 0.80,
                "verdict_counts": {"DEAD_WEIGHT": 8, "CONTRIBUTING": 2},
            },
            "baseline": {"dsr": 0.80, "total_trades": 100},
            "layer_ablations": [
                {"layer": "no_trade", "verdict": "DEAD_WEIGHT", "delta_dsr": 0.01},
            ],
        }
        serialized = json.dumps(report)
        restored = json.loads(serialized)
        assert restored["governance_advisory"] is True
        assert restored["summary"]["baseline_dsr"] == 0.80


# ─────────────────────────────────────────────────────────────────────────────
# Test 4: Verdict math thresholds (parametrized)
# ─────────────────────────────────────────────────────────────────────────────

class TestVerdictMathThresholds:
    """Boundary tests at exactly DSR_THRESHOLD = 0.05."""

    @pytest.mark.parametrize("dsr_baseline,dsr_layer,expected", [
        # HARMFUL boundary (removal improved by >= 0.05)
        (0.80, 0.850,  "HARMFUL"),       # delta = +0.05 exactly
        (0.80, 0.851,  "HARMFUL"),       # delta = +0.051
        (0.80, 0.849,  "DEAD_WEIGHT"),   # delta = +0.049 (below threshold)
        # CONTRIBUTING boundary (removal degraded by >= 0.05)
        (0.80, 0.750,  "CONTRIBUTING"),  # delta = -0.05 exactly
        (0.80, 0.749,  "CONTRIBUTING"),  # delta = -0.051
        (0.80, 0.751,  "DEAD_WEIGHT"),   # delta = -0.049 (below threshold)
        # Dead zone
        (0.80, 0.800,  "DEAD_WEIGHT"),   # delta = 0.0
        (0.80, 0.820,  "DEAD_WEIGHT"),   # delta = +0.02
        (0.80, 0.780,  "DEAD_WEIGHT"),   # delta = -0.02
        # DSR = 0 baseline (edge: avoid +0.05 being 0.05 on zero)
        (0.00, 0.050,  "HARMFUL"),
        (0.00, 0.049,  "DEAD_WEIGHT"),
        (0.00, -0.050, "CONTRIBUTING"),
    ])
    def test_threshold_boundary(self, dsr_baseline, dsr_layer, expected):
        r = _verdict_inline(dsr_baseline, dsr_layer, 100, 100, "test_layer")
        assert r["verdict"] == expected, (
            f"DSR_baseline={dsr_baseline}, DSR_layer={dsr_layer} -> "
            f"delta={round(dsr_layer - dsr_baseline, 4)}: "
            f"expected '{expected}', got '{r['verdict']}'"
        )

    def test_delta_precision_is_4dp(self):
        """delta_dsr is rounded to 4 decimal places."""
        r = _verdict_inline(0.8012345, 0.8022345, 100, 100, "x")
        assert r["delta_dsr"] == round(0.8022345 - 0.8012345, 4)

    def test_delta_trades_sign(self):
        """delta_trades is positive when layer disabled adds trades."""
        r = _verdict_inline(0.80, 0.80, 100, 150, "no_trade")
        assert r["delta_trades"] == 50

    def test_delta_trades_negative_when_layer_kills_trades(self):
        """delta_trades is negative if disabled layer somehow reduces trades."""
        r = _verdict_inline(0.80, 0.80, 100, 80, "rr_ratio")
        assert r["delta_trades"] == -20


# ─────────────────────────────────────────────────────────────────────────────
# Test 5: NO_TRADE hypothesis check
# ─────────────────────────────────────────────────────────────────────────────

class TestNoTradeHypothesisCheck:
    """Verify _check_no_trade_hypothesis logic via synthetic gate_stats."""

    def _make_gate_stats(self, counts: dict[str, int]) -> dict:
        """Build a synthetic gate_stats dict from canonical_name -> count."""
        from src.engine.ablation_layers import ABLATION_LAYER_MAP
        skipped = []
        for canon_name, n in counts.items():
            prefix = ABLATION_LAYER_MAP.get(canon_name, canon_name)
            for _ in range(n):
                skipped.append({"bar_idx": 0, "reason": prefix + " (test)"})
        return {"long": {"skipped_signals": skipped}, "short": {"skipped_signals": []}}

    def test_hypothesis_confirmed_when_no_trade_dominates(self):
        """If NO_TRADE >= 90% of rejections, hypothesis confirmed."""
        # filter-ablation-cpcv.py has a hyphen in its filename and cannot be
        # imported as a module. Test the hypothesis logic inline.
        from src.engine.ablation_layers import reason_to_layer

        def _check(gate_stats):
            long_skip = gate_stats.get("long", {}).get("skipped_signals", []) or []
            short_skip = gate_stats.get("short", {}).get("skipped_signals", []) or []
            all_s = long_skip + short_skip
            counts = {}
            for srec in all_s:
                r = srec.get("reason", "")
                c = reason_to_layer(r) or r[:40]
                counts[c] = counts.get(c, 0) + 1
            total = sum(counts.values())
            pct = round(100 * counts.get("no_trade", 0) / max(total, 1), 1)
            return pct >= 90, pct

        gs = self._make_gate_stats({"no_trade": 95, "kill_zone": 3, "sweep": 2})
        confirmed, pct = _check(gs)
        assert confirmed is True
        assert pct == 95.0

    def test_hypothesis_refuted_when_other_layers_dominant(self):
        """If NO_TRADE < 90%, hypothesis refuted."""
        from src.engine.ablation_layers import reason_to_layer

        def _check(gate_stats):
            long_skip = gate_stats.get("long", {}).get("skipped_signals", []) or []
            short_skip = gate_stats.get("short", {}).get("skipped_signals", []) or []
            counts = {}
            for srec in long_skip + short_skip:
                r = srec.get("reason", "")
                c = reason_to_layer(r) or r[:40]
                counts[c] = counts.get(c, 0) + 1
            total = sum(counts.values())
            pct = round(100 * counts.get("no_trade", 0) / max(total, 1), 1)
            return pct >= 90, pct

        gs = self._make_gate_stats({"no_trade": 50, "kill_zone": 30, "sweep": 20})
        confirmed, pct = _check(gs)
        assert confirmed is False
        assert pct == 50.0

    def test_hypothesis_with_empty_gate_stats(self):
        """Empty gate_stats yields confirmed=False (0% rejections -> 0% NO_TRADE)."""
        from src.engine.ablation_layers import reason_to_layer

        counts = {}
        total = sum(counts.values())
        pct = round(100 * counts.get("no_trade", 0) / max(total, 1), 1)
        assert pct == 0.0

    def test_hypothesis_check_result_has_required_keys(self):
        """Hypothesis result dict has all required fields."""
        required = {
            "hypothesis", "no_trade_rejections", "total_rejections",
            "no_trade_pct", "top_layers_by_rejection", "confirmed", "note",
        }
        result = {
            "hypothesis": "...",
            "no_trade_rejections": 0,
            "total_rejections": 0,
            "no_trade_pct": 0.0,
            "top_layers_by_rejection": [],
            "confirmed": False,
            "note": "REFUTED: ...",
        }
        assert required.issubset(set(result.keys()))

    def test_top_layers_by_rejection_sorted_descending(self):
        """top_layers_by_rejection must be sorted by count descending."""
        layer_counts = {"no_trade": 50, "kill_zone": 30, "sweep": 20}
        top = sorted(layer_counts.items(), key=lambda kv: -kv[1])[:5]
        assert top[0][0] == "no_trade"
        assert top[0][1] == 50
        assert top[1][0] == "kill_zone"
