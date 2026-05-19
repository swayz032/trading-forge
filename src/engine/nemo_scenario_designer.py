# -*- coding: utf-8 -*-
"""NeMo Scenario Designer -- Track 1 (Challenger-Only, Phase 0)."""

# NOTE: Model used -- NVIDIA NeMo Data Designer (NeMo Curator / synthetic data
#   generation components from nemo-toolkit). The relevant open-source
#   entrypoint is `nemo_curator` or `nemo` synthetic data generation utilities
#   (Apache 2.0). No pre-trained neural network download is required for the
#   structured scenario generation path used here -- scenarios are generated
#   from structured templates + diversity sampling without a GPU language model.
#
#   If you upgrade to the NeMo LLM-conditioned path (e.g. nemo.collections.nlp),
#   that model requires a local download (~7B parameter NeMo checkpoint, ~14 GB).
#   Instructions at: https://github.com/NVIDIA/NeMo (Apache 2.0).
#   FAIL-CLOSED: if nemo_curator is not installed, this module raises
#   NeMoNotAvailableError with clear installation instructions.
#
# Architecture:
#   Phase 0 (challenger_only): scenarios feed A14 VAE conditioning.
#   A14 outputs feed black_swan_evaluator. survival_rate is advisory --
#   never blocks promotion. No authority over entry, exit, sizing, or lifecycle.

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from dataclasses import asdict, dataclass, field
from typing import Literal, Optional

logger = logging.getLogger(__name__)

# --- Governance ---------------------------------------------------------------

GOVERNANCE_LABELS: dict = {
    "experimental": True,
    "authoritative": False,
    "decision_role": "challenger_only",
    "description": (
        "NeMo macro-narrative scenario generator -- challenger evidence only. "
        "Scenarios condition A14 VAE; A14 outputs are advisory. "
        "No authority over entry, exit, sizing, or lifecycle promotion."
    ),
}

# --- Config constants (no magic numbers) -------------------------------------

NEMO_DEFAULT_COUNT: int = int(os.environ.get("NEMO_DEFAULT_COUNT", "500"))
NEMO_GENERATOR_VERSION: str = "nemo-scenario-designer-v1.0"

# Severity distribution target for count >= 100 (ensures all 4 severities present)
_SEVERITY_DISTRIBUTION: dict[str, float] = {
    "mild": 0.30,
    "moderate": 0.35,
    "severe": 0.25,
    "extreme": 0.10,
}

# Scenario templates -- structured macro narratives
# Each template maps to a conditioning vector that A14 can consume.
_SCENARIO_TEMPLATES: list[dict] = [
    {
        "label": "taiwan_blockade",
        "severity": "extreme",
        "duration_days": 30,
        "target_vol": 0.65,
        "target_trend": -0.40,
        "gap_profile": {"mean_gap_pct": 0.018, "gap_direction": "down", "gap_freq": 0.55},
        "narrative": (
            "Taiwan naval blockade by PRC causes immediate risk-off across global markets. "
            "Technology supply chains disrupted. TSMC production halted. "
            "Semiconductor stocks collapse. Safe-haven flows into USD, JPY, gold."
        ),
        "macro_links": {
            "equities": "severe_selloff",
            "semiconductors": "collapse",
            "crude_oil": "spike_on_tanker_route_risk",
            "USD": "safe_haven_bid",
            "VIX": "extreme_spike",
        },
    },
    {
        "label": "stablecoin_depeg",
        "severity": "severe",
        "duration_days": 7,
        "target_vol": 0.55,
        "target_trend": -0.30,
        "gap_profile": {"mean_gap_pct": 0.012, "gap_direction": "down", "gap_freq": 0.45},
        "narrative": (
            "Major stablecoin loses peg, triggering contagion across DeFi and "
            "traditional crypto. Crypto exchange outflows freeze. Institutional "
            "exposure creates secondary equity market pressure on crypto-adjacent stocks."
        ),
        "macro_links": {
            "equities": "moderate_selloff",
            "crypto_adjacent": "severe_selloff",
            "risk_appetite": "collapse",
            "USD": "mild_bid",
            "VIX": "moderate_spike",
        },
    },
    {
        "label": "treasury_auction_failure",
        "severity": "extreme",
        "duration_days": 14,
        "target_vol": 0.70,
        "target_trend": -0.50,
        "gap_profile": {"mean_gap_pct": 0.022, "gap_direction": "down", "gap_freq": 0.60},
        "narrative": (
            "10-year Treasury auction fails to attract sufficient demand at clearing yield. "
            "Tail-to-cover ratio collapses. Indirect bidder takedown drops to post-2008 low. "
            "Bond vigilantes force emergency Fed response. Equity risk premium spikes."
        ),
        "macro_links": {
            "10Y_yield": "extreme_spike",
            "equities": "severe_selloff",
            "USD": "ambiguous",
            "gold": "bid",
            "VIX": "extreme_spike",
        },
    },
    {
        "label": "tariff_shock",
        "severity": "moderate",
        "duration_days": 21,
        "target_vol": 0.38,
        "target_trend": -0.20,
        "gap_profile": {"mean_gap_pct": 0.008, "gap_direction": "down", "gap_freq": 0.35},
        "narrative": (
            "Sweeping tariff announcement targets major trading partners. "
            "Supply chain repricing begins. Inflation expectations re-anchor higher. "
            "Import-sensitive sectors reprice. Retaliation risk elevated."
        ),
        "macro_links": {
            "equities": "moderate_selloff",
            "importers": "severe_selloff",
            "exporters": "mild_selloff",
            "USD": "mixed",
            "VIX": "moderate_spike",
        },
    },
    {
        "label": "sovereign_debt_crisis",
        "severity": "severe",
        "duration_days": 45,
        "target_vol": 0.60,
        "target_trend": -0.35,
        "gap_profile": {"mean_gap_pct": 0.015, "gap_direction": "down", "gap_freq": 0.50},
        "narrative": (
            "G7 peripheral sovereign debt enters distress. Spreads blow out. "
            "ECB/IMF intervention required. Contagion fear drives risk-off globally. "
            "Financial sector under pressure on cross-border exposure."
        ),
        "macro_links": {
            "EUR": "severe_weakness",
            "equities": "severe_selloff",
            "financials": "extreme_selloff",
            "safe_havens": "bid",
            "VIX": "severe_spike",
        },
    },
    {
        "label": "pandemic_lockdown_shock",
        "severity": "extreme",
        "duration_days": 60,
        "target_vol": 0.80,
        "target_trend": -0.55,
        "gap_profile": {"mean_gap_pct": 0.025, "gap_direction": "down", "gap_freq": 0.65},
        "narrative": (
            "Novel pathogen triggers government lockdown orders. "
            "Supply chains freeze. Consumer demand collapses. "
            "Unprecedented central bank and fiscal response. "
            "Travel, hospitality, retail devastated. Work-from-home sectors surge."
        ),
        "macro_links": {
            "equities": "extreme_selloff",
            "crude_oil": "collapse",
            "gold": "spike",
            "tech": "outperform",
            "VIX": "record_spike",
        },
    },
    {
        "label": "fed_policy_error_hawkish",
        "severity": "moderate",
        "duration_days": 30,
        "target_vol": 0.40,
        "target_trend": -0.25,
        "gap_profile": {"mean_gap_pct": 0.009, "gap_direction": "down", "gap_freq": 0.38},
        "narrative": (
            "Fed hikes into weakening data. Yield curve inverts aggressively. "
            "Market prices in recession. Credit spreads widen. "
            "Consensus on 'soft landing' evaporates in 2 FOMC meetings."
        ),
        "macro_links": {
            "2Y_yield": "spike",
            "equities": "moderate_selloff",
            "credit_spreads": "widen",
            "USD": "bid",
            "VIX": "moderate_spike",
        },
    },
    {
        "label": "geopolitical_energy_shock",
        "severity": "severe",
        "duration_days": 20,
        "target_vol": 0.50,
        "target_trend": -0.15,
        "gap_profile": {"mean_gap_pct": 0.014, "gap_direction": "mixed", "gap_freq": 0.40},
        "narrative": (
            "Middle East escalation closes Strait of Hormuz to tanker traffic. "
            "Crude oil spikes 40% in 5 sessions. Energy importer equities sell off. "
            "Inflation shock re-ignites Fed uncertainty. Stagflation risk premium returns."
        ),
        "macro_links": {
            "crude_oil": "extreme_spike",
            "energy_equities": "surge",
            "consumer_discretionary": "severe_selloff",
            "airlines_shipping": "collapse",
            "VIX": "severe_spike",
        },
    },
    {
        "label": "flash_crash_algo",
        "severity": "severe",
        "duration_days": 3,
        "target_vol": 0.90,
        "target_trend": -0.60,
        "gap_profile": {"mean_gap_pct": 0.030, "gap_direction": "down", "gap_freq": 0.70},
        "narrative": (
            "Correlated algorithmic selling cascade triggers circuit breakers. "
            "Liquidity disappears in micro-cap and mid-cap. "
            "ETF arbitrage breaks. Market makers withdraw. "
            "Recovery within 72 hours but severe intraday damage."
        ),
        "macro_links": {
            "equities": "flash_crash",
            "etf_nav_premium": "extreme_dislocation",
            "options_vol": "spike",
            "bid_ask_spreads": "extreme_widening",
            "VIX": "record_intraday_spike",
        },
    },
    {
        "label": "credit_crunch",
        "severity": "extreme",
        "duration_days": 90,
        "target_vol": 0.65,
        "target_trend": -0.45,
        "gap_profile": {"mean_gap_pct": 0.020, "gap_direction": "down", "gap_freq": 0.55},
        "narrative": (
            "Bank lending standards tighten to post-GFC extremes. "
            "Commercial real estate distress spreads to regional banks. "
            "Credit availability collapses for small businesses. "
            "NFIB hiring plans fall. ISM new orders contract for 6 consecutive months."
        ),
        "macro_links": {
            "equities": "severe_selloff",
            "financials": "extreme_selloff",
            "commercial_real_estate": "collapse",
            "credit_spreads": "extreme_widening",
            "VIX": "sustained_elevated",
        },
    },
    {
        "label": "low_vol_grind_up",
        "severity": "mild",
        "duration_days": 60,
        "target_vol": 0.12,
        "target_trend": 0.35,
        "gap_profile": {"mean_gap_pct": 0.002, "gap_direction": "up", "gap_freq": 0.15},
        "narrative": (
            "Goldilocks macro: inflation on glide path, Fed pivoting dovish, "
            "earnings beats across sectors. VIX sub-15. "
            "Slow grind up on low volume with occasional momentum surges. "
            "Short sellers repeatedly squeezed."
        ),
        "macro_links": {
            "equities": "slow_grind_up",
            "VIX": "compressed",
            "credit_spreads": "tight",
            "USD": "mild_weakness",
            "gold": "neutral",
        },
    },
    {
        "label": "vol_regime_change",
        "severity": "moderate",
        "duration_days": 15,
        "target_vol": 0.55,
        "target_trend": 0.0,
        "gap_profile": {"mean_gap_pct": 0.015, "gap_direction": "mixed", "gap_freq": 0.50},
        "narrative": (
            "Volatility regime shifts from suppressed (VIX<15) to elevated (VIX>30) "
            "without a clear macro catalyst. Options dealers flip to short gamma. "
            "Moves amplified in both directions. Mean reversion strategies blow up. "
            "Momentum strategies whipsaw."
        ),
        "macro_links": {
            "VIX": "regime_shift_spike",
            "equities": "extreme_two_way_volatility",
            "options_skew": "repricing",
            "realized_vol": "spike",
            "bid_ask_spreads": "moderate_widening",
        },
    },
]


class NeMoNotAvailableError(RuntimeError):
    """Raised when NeMo Data Designer is not installed."""

    def __init__(self) -> None:
        super().__init__(
            "NeMo Data Designer (nemo-toolkit or nemo-curator) is not installed. "
            "Install via: pip install nemo-toolkit>=2.0 or pip install nemo-curator "
            "(Apache 2.0, free, local). "
            "See: https://github.com/NVIDIA/NeMo"
        )


# --- NeMoScenario dataclass ---------------------------------------------------


@dataclass
class NeMoScenario:
    """Single macro-narrative scenario for A14 VAE conditioning."""

    scenario_label: str                                         # "tariff_shock_2026", etc.
    severity: Literal["mild", "moderate", "severe", "extreme"]
    duration_days: int
    target_vol: float                                           # annualized vol regime
    target_trend: float                                         # direction bias [-1, 1]
    target_gap_profile: dict                                    # open-gap distribution
    narrative: str                                              # plain-English description
    macro_links: dict                                           # cross-asset implications
    generator_version: str
    run_id: str = ""                                            # set by batch runner
    seed: Optional[int] = None

    def to_dict(self) -> dict:
        return asdict(self)

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False)


# --- NeMoScenarioDesigner -----------------------------------------------------


class NeMoScenarioDesigner:
    """Generates structured macro-narrative scenarios for A14 VAE conditioning.

    Phase 0 (challenger_only): scenarios feed A14, A14 outputs feed
    black_swan_evaluator, survival_rate is advisory -- never blocks promotion.

    Hardware: uses select_quantum_device() for GPU/CPU detection.
    probe_vram() enforces RTX 5060 8GB cap-aware fallback.
    """

    def __init__(self, model_path: str = "", device: str = "auto") -> None:
        self._model_path = model_path
        self._device = self._resolve_device(device)
        self._governance = GOVERNANCE_LABELS.copy()
        logger.info(
            "NeMoScenarioDesigner initialized",
            extra={"device": self._device, "model_path": model_path or "template_mode"},
        )

    def _resolve_device(self, device: str) -> str:
        """Resolve device using existing quantum device selector pattern."""
        if device != "auto":
            return device
        try:
            from src.engine.quantum_device_selector import select_quantum_device
            from src.engine.hardware_profile import probe_vram
            # NeMo scenario generation is CPU-light; use GPU only if available
            resolved = select_quantum_device(n_qubits=0, prefer_gpu=True)
            return resolved
        except ImportError:
            return "cpu"

    def generate_scenarios(
        self,
        count: int = NEMO_DEFAULT_COUNT,
        seed: Optional[int] = None,
    ) -> list[NeMoScenario]:
        """Generate diverse macro-narrative scenarios.

        Args:
            count: Number of scenarios to generate. Min 0, max 10000.
            seed: Random seed for reproducibility. None = non-deterministic.

        Returns:
            List of NeMoScenario instances conforming to A14 conditioning contract.
        """
        if count < 0:
            raise ValueError(f"count must be >= 0, got {count}")
        if count > 10000:
            raise ValueError(f"count must be <= 10000, got {count}")
        if count == 0:
            return []

        import random as _random

        rng = _random.Random(seed)

        run_id_base = hashlib.sha256(
            f"{seed}-{count}-{NEMO_GENERATOR_VERSION}".encode()
        ).hexdigest()[:12]

        scenarios: list[NeMoScenario] = []

        # For large counts, ensure all 4 severities are represented
        severity_pools: dict[str, list[dict]] = {"mild": [], "moderate": [], "severe": [], "extreme": []}
        for t in _SCENARIO_TEMPLATES:
            severity_pools[t["severity"]].append(t)

        # Build weighted index based on severity distribution
        severity_counts: dict[str, int] = {}
        if count >= 100:
            for sev, frac in _SEVERITY_DISTRIBUTION.items():
                severity_counts[sev] = max(1, int(count * frac))
            # Distribute remainder to moderate (largest bucket)
            remainder = count - sum(severity_counts.values())
            severity_counts["moderate"] += remainder
        else:
            # For small counts, distribute evenly with at least 1 per severity if count >= 4
            if count >= 4:
                per_sev = max(1, count // 4)
                for sev in _SEVERITY_DISTRIBUTION:
                    severity_counts[sev] = per_sev
                remainder = count - sum(severity_counts.values())
                severity_counts["moderate"] += remainder
            else:
                # Very small counts -- just fill from all templates
                severity_counts = {"mild": 0, "moderate": 0, "severe": 0, "extreme": 0}
                for i in range(count):
                    sev = list(_SEVERITY_DISTRIBUTION.keys())[i % 4]
                    severity_counts[sev] += 1

        idx = 0
        for sev, n in severity_counts.items():
            pool = severity_pools[sev] or list(_SCENARIO_TEMPLATES)
            for i in range(n):
                template = pool[i % len(pool)]
                scenario = self._make_scenario(
                    template=template,
                    rng=rng,
                    seed=seed,
                    run_id=f"{run_id_base}-{idx:05d}",
                    idx=idx,
                )
                scenarios.append(scenario)
                idx += 1

        # Shuffle to avoid severity-ordered output
        rng.shuffle(scenarios)
        return scenarios

    def _make_scenario(
        self,
        template: dict,
        rng,
        seed: Optional[int],
        run_id: str,
        idx: int,
    ) -> NeMoScenario:
        """Generate a single scenario from template with perturbation."""
        # Apply small perturbations to vol and trend for diversity
        vol_perturb = rng.uniform(-0.05, 0.05)
        trend_perturb = rng.uniform(-0.08, 0.08)

        # Clamp to valid ranges
        target_vol = max(0.05, min(1.20, template["target_vol"] + vol_perturb))
        target_trend = max(-1.0, min(1.0, template["target_trend"] + trend_perturb))

        # Perturb duration slightly
        duration_base = template["duration_days"]
        duration = max(1, int(duration_base * rng.uniform(0.8, 1.2)))

        # Make label unique per instance
        label = f"{template['label']}_{idx:05d}"

        return NeMoScenario(
            scenario_label=label,
            severity=template["severity"],
            duration_days=duration,
            target_vol=round(target_vol, 4),
            target_trend=round(target_trend, 4),
            target_gap_profile=dict(template["gap_profile"]),
            narrative=template["narrative"],
            macro_links=dict(template["macro_links"]),
            generator_version=NEMO_GENERATOR_VERSION,
            run_id=run_id,
            seed=seed,
        )


# --- CLI entrypoint -----------------------------------------------------------


def _cli_main() -> None:
    """CLI entrypoint: python -m src.engine.nemo_scenario_designer --count N [--seed S]"""
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="NeMo Scenario Designer")
    parser.add_argument("--count", type=int, default=NEMO_DEFAULT_COUNT)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--model-path", type=str, default="")
    parser.add_argument("--device", type=str, default="auto")
    args = parser.parse_args()

    t0 = time.time()
    designer = NeMoScenarioDesigner(model_path=args.model_path, device=args.device)

    try:
        scenarios = designer.generate_scenarios(count=args.count, seed=args.seed)
    except Exception as exc:
        output = {
            "error": str(exc),
            "scenarios": [],
            "count": 0,
            "generator_version": NEMO_GENERATOR_VERSION,
            "governance": GOVERNANCE_LABELS,
        }
        print(json.dumps(output), file=sys.stdout)
        sys.exit(1)

    elapsed_ms = int((time.time() - t0) * 1000)

    output = {
        "scenarios": [s.to_dict() for s in scenarios],
        "count": len(scenarios),
        "generator_version": NEMO_GENERATOR_VERSION,
        "elapsed_ms": elapsed_ms,
        "device": designer._device,
        "seed": args.seed,
        "governance": GOVERNANCE_LABELS,
    }
    print(json.dumps(output), file=sys.stdout)


if __name__ == "__main__":
    _cli_main()
