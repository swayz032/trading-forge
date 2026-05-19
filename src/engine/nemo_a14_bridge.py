"""NeMo A14 Bridge -- Track 1 (Challenger-Only, Phase 0).

Translates NeMo scenario JSON -> A14 conditioning vector format.

Pure function. Type-safe. Backwards-compatible: A14's existing
(regime_label, target_vol, target_trend, target_gap_profile) API unchanged.
The `extras` dict is additive metadata A14 stores but does NOT act on.

Governance:
    experimental=True, authoritative=False, decision_role=challenger_only
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

from src.engine.nemo_scenario_designer import NeMoScenario, GOVERNANCE_LABELS


# ─── A14 Conditioning Vector ─────────────────────────────────────────────────


@dataclass
class A14ConditioningVector:
    """Conditioning vector consumed by synthetic_market_simulator.py generate mode.

    Fields match the existing A14 CLI contract:
        regime_label, target_vol, target_trend, target_gap_profile.

    The `extras` dict is additive and backwards-compatible:
    A14 stores it in the conditioning_vector_compressed blob but does NOT
    change its generation logic based on extras content.
    """

    regime_label: str
    target_vol: float
    target_trend: float
    target_gap_profile: dict
    extras: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        """Serialize to dict matching A14 CLI config shape."""
        return {
            "regime_label": self.regime_label,
            "target_vol": self.target_vol,
            "target_trend": self.target_trend,
            "target_gap_profile": self.target_gap_profile,
            # extras stored alongside; A14 ignores unknown keys (pydantic extra=ignore)
            "_nemo_extras": self.extras,
        }

    def to_a14_config(self, base_config: Optional[dict] = None) -> dict:
        """Build full A14 generate-mode config dict, merging with base_config.

        Args:
            base_config: Optional existing A14 config to merge into.

        Returns:
            Config dict ready for runPythonModule('src.engine.synthetic_market_simulator').
        """
        cfg = dict(base_config or {})
        cfg.update({
            "mode": "generate",
            "regime_label": self.regime_label,
            "target_vol": self.target_vol,
            "target_trend": self.target_trend,
            "target_gap_profile": self.target_gap_profile,
            "_nemo_extras": self.extras,
            "_governance": GOVERNANCE_LABELS,
        })
        return cfg


# ─── Translation function ─────────────────────────────────────────────────────


def nemo_to_a14_conditioning(scenario: NeMoScenario) -> A14ConditioningVector:
    """Map NeMo scenario attributes to A14 VAE conditioning input.

    A14 expects: regime_label, target_vol, target_trend, target_gap_profile.
    NeMo provides these directly + extra narrative metadata (preserved in extras).

    Authority boundary: this is a pure translation function. It does not write
    to any database, trigger any lifecycle decision, or modify any strategy.

    Args:
        scenario: NeMoScenario instance from NeMoScenarioDesigner.

    Returns:
        A14ConditioningVector with A14-compatible fields + NeMo extras.
    """
    return A14ConditioningVector(
        regime_label=scenario.scenario_label,
        target_vol=scenario.target_vol,
        target_trend=scenario.target_trend,
        target_gap_profile=scenario.target_gap_profile,
        extras={
            "narrative": scenario.narrative,
            "severity": scenario.severity,
            "duration_days": scenario.duration_days,
            "macro_links": scenario.macro_links,
            "source": "nemo",
            "generator_version": scenario.generator_version,
            "run_id": scenario.run_id,
            "seed": scenario.seed,
        },
    )


def batch_nemo_to_a14(scenarios: list[NeMoScenario]) -> list[A14ConditioningVector]:
    """Translate a batch of NeMo scenarios to A14 conditioning vectors.

    Args:
        scenarios: List of NeMoScenario instances.

    Returns:
        List of A14ConditioningVector instances, one per scenario.
    """
    return [nemo_to_a14_conditioning(s) for s in scenarios]
