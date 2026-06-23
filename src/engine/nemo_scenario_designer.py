# -*- coding: utf-8 -*-
"""NeMo Scenario Designer — Track 1 (Challenger-Only, Phase 0).

Architecture
------------
Data Designer (NVIDIA Build API endpoint) → diverse black-swan ScenarioSpec objects
→ stochastic renderer (StochasticRegimeGenerator) → OHLCV bars → A14 VAE conditioning.

This module owns the DESIGNER layer only.  The renderer
(src/engine/synthetic/stochastic_regime_generator.py) is the source of truth
for ScenarioSpec contract and NAMED_SCENARIOS (the 8 hardcoded fallback scenarios).

Two execution paths
-------------------
1. **data_designer path** (NVIDIA NeMo, requires ``NVIDIA_API_KEY`` env var):
   - Import ``data_designer`` package (pip install data-designer==0.6.1).
   - Call NVIDIA Build API endpoint to generate N diverse scenario specs.
   - Map each returned row → ScenarioSpec using the stochastic renderer contract.
   - Returns ``GenerationResult(path_used="data_designer", ...)``.

2. **stochastic fallback path** (always available):
   - Uses the 8 named scenarios from NAMED_SCENARIOS in the stochastic renderer.
   - Returns ``GenerationResult(path_used="fallback", ...)``.
   - Triggers when: (a) ``data_designer`` not importable, (b) ``NVIDIA_API_KEY``
     not set, (c) any API / timeout / validation error during generation.

Governance
----------
Experimental, challenger_only, authoritative=False.
Scenarios feed A14 VAE; A14 outputs feed black_swan_evaluator.
survival_rate is ADVISORY — never blocks promotion, entry, exit, or sizing.

NVIDIA_API_KEY
--------------
Obtain a free eval key at https://build.nvidia.com (NVIDIA Developer Program).
Set in .env: ``NVIDIA_API_KEY=nvapi-...``
Without the key, the module falls back to the stochastic battery transparently.

Note for operators
------------------
A TS boot-warn for missing NVIDIA_API_KEY (similar to other advisory-path warns)
is a carry-forward item — out of scope for this module.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ─── Governance ────────────────────────────────────────────────────────────────

GOVERNANCE_LABELS: dict = {
    "experimental": True,
    "authoritative": False,
    "decision_role": "challenger_only",
    "description": (
        "NeMo macro-narrative scenario designer — challenger evidence only. "
        "Scenarios feed A14 VAE; A14 outputs are advisory. "
        "No authority over entry, exit, sizing, or lifecycle promotion."
    ),
}

# ─── Config constants ──────────────────────────────────────────────────────────

NEMO_DEFAULT_COUNT: int = int(os.environ.get("NEMO_DEFAULT_COUNT", "500"))
NEMO_GENERATOR_VERSION: str = "nemo-scenario-designer-v2.0"

# Canonical black-swan archetype labels that seed the CATEGORY sampler.
# These are the same 8 scenario families in the stochastic renderer's NAMED_SCENARIOS.
_CANONICAL_ARCHETYPES: list[str] = [
    "crash",
    "rate_shock",
    "vol_spike",
    "credit_crisis",
    "flash_crash",
    "slow_bleed",
    "flash_recovery",
    "consistency_breach",
]

# Fallback NVIDIA model alias (documented, not magic) used when
# get_default_model_configs() does not surface a 'nvidia-text' provider entry.
_NVIDIA_MODEL_ALIAS_FALLBACK: str = "nvidia-text"


# ─── Data Designer availability check ─────────────────────────────────────────

def _try_import_data_designer() -> tuple[bool, Any, Any]:
    """Attempt to import data_designer package.

    Returns:
        (available: bool, dd_config: module | None, dd_interface: module | None)
    """
    try:
        import data_designer.config as _dd_config
        from data_designer.interface import DataDesigner as _DataDesigner
        return True, _dd_config, _DataDesigner
    except ImportError:
        return False, None, None


_DD_AVAILABLE, _DD_CONFIG, _DD_INTERFACE = _try_import_data_designer()


# ─── Stochastic renderer contract ─────────────────────────────────────────────
# Import ScenarioSpec + NAMED_SCENARIOS from the renderer.
# These are the canonical fallback specs; the designer generates new ones
# that ALSO conform to ScenarioSpec.

from src.engine.synthetic.stochastic_regime_generator import (  # noqa: E402
    NAMED_SCENARIOS,
    ScenarioSpec,
)


# ─── Result types ─────────────────────────────────────────────────────────────

@dataclass
class GenerationResult:
    """Result of a generate_scenarios() call.

    Attributes:
        specs: List of ScenarioSpec objects consumable by the stochastic renderer.
        path_used: Which generation path was taken.
            - ``"data_designer"`` — NVIDIA NeMo API was called successfully.
            - ``"fallback"`` — fell back to the 8 NAMED_SCENARIOS battery.
        provenance: Dict recording run metadata (model, seed, run_id, path, etc.).
        count: Number of specs returned (always ``len(specs)``).
    """

    specs: list[ScenarioSpec]
    path_used: str  # "data_designer" | "fallback"
    provenance: dict
    count: int = field(init=False)

    def __post_init__(self) -> None:
        self.count = len(self.specs)

    def __len__(self) -> int:
        """Support len(result) — returns number of specs."""
        return self.count

    def __iter__(self):
        """Support iteration — yields ScenarioSpec objects from .specs."""
        return iter(self.specs)


# ─── NeMoScenarioDesigner ─────────────────────────────────────────────────────

class NeMoScenarioDesigner:
    """Generates diverse black-swan scenario specs for A14 VAE conditioning.

    When ``data_designer`` is importable AND ``NVIDIA_API_KEY`` is set, uses the
    NVIDIA NeMo Data Designer API (build.nvidia.com) to produce statistically
    diverse scenario specifications beyond the hardcoded 8-scenario battery.

    Fails-closed to the stochastic battery (8 NAMED_SCENARIOS) when:
    - ``data_designer`` package is not installed.
    - ``NVIDIA_API_KEY`` is absent from the environment.
    - Any API / timeout / validation error occurs during generation.

    Governance: challenger_only, experimental, authoritative=False.
    Scenarios condition A14 VAE — NEVER gate promotion, entry, exit, or sizing.

    Args:
        model_path: Unused in v2 (kept for CLI backward-compat). Pass ``""`` or omit.
        device: Unused in v2 (kept for backward-compat). Pass ``"cpu"`` or omit.
    """

    def __init__(self, model_path: str = "", device: str = "auto") -> None:
        self._model_path = model_path
        self._device = "cpu" if device == "cpu" else self._resolve_device(device)
        self._governance = GOVERNANCE_LABELS.copy()
        logger.info(
            "NeMoScenarioDesigner initialized (dd_available=%s)",
            _DD_AVAILABLE,
        )

    def _resolve_device(self, device: str) -> str:
        """Resolve device (backward-compat stub — v2 is CPU/API, not GPU local)."""
        if device != "auto":
            return device
        try:
            from src.engine.quantum_device_selector import select_quantum_device
            resolved = select_quantum_device(n_qubits=0, prefer_gpu=True)
            return resolved
        except ImportError:
            return "cpu"

    # ── Public API ─────────────────────────────────────────────────────────────

    def generate_scenarios(
        self,
        count: int = NEMO_DEFAULT_COUNT,
        seed: Optional[int] = None,
    ) -> GenerationResult:
        """Generate diverse black-swan scenario specs.

        When data_designer + NVIDIA_API_KEY are available, calls the NVIDIA
        Build API to produce LLM-orchestrated, statistically diverse specs.
        Falls back to the 8 NAMED_SCENARIOS battery otherwise.

        Args:
            count: Requested number of specs (used as hint for the API).
                   Fallback path always returns exactly len(NAMED_SCENARIOS) specs.
            seed: Reproducibility seed for provenance recording (best-effort;
                  the API itself may not be deterministic but provenance is stamped).

        Returns:
            GenerationResult with .specs (list[ScenarioSpec]), .path_used,
            .provenance, and .count.

        Raises:
            ValueError: If count is negative or exceeds 10000.
        """
        if count < 0:
            raise ValueError(f"count must be >= 0, got {count}")
        if count > 10000:
            raise ValueError(f"count must be <= 10000, got {count}")

        run_id = self._make_run_id(seed=seed, count=count)
        nvidia_key = os.environ.get("NVIDIA_API_KEY", "")

        # ── Decide which path to take ─────────────────────────────────────────
        if _DD_AVAILABLE and nvidia_key:
            return self._generate_via_data_designer(
                count=count, seed=seed, run_id=run_id
            )

        # Fallback
        if not _DD_AVAILABLE:
            reason = "data_designer package not installed"
        else:
            reason = "NVIDIA_API_KEY not set"
        logger.info(
            "NeMoScenarioDesigner: using stochastic fallback (%s). "
            "Set NVIDIA_API_KEY (from build.nvidia.com) to enable the NeMo path.",
            reason,
        )
        return self._generate_fallback(seed=seed, run_id=run_id, reason=reason)

    # ── Data Designer generation path ─────────────────────────────────────────

    def _generate_via_data_designer(
        self,
        count: int,
        seed: Optional[int],
        run_id: str,
    ) -> GenerationResult:
        """Call Data Designer API and map rows → ScenarioSpec objects."""
        alias = self._resolve_nvidia_model_alias()
        try:
            cb = self._build_config(count=count, seed=seed)
            dd = _DD_INTERFACE()
            num_records = max(count, 8)  # always request at least the 8 archetypes
            preview = dd.preview(cb, num_records=num_records)
            df = preview.dataset
            if df is None or len(df) == 0:
                raise ValueError("DataDesigner returned an empty dataset")
            specs = self._map_rows_to_specs(df)
            logger.info(
                "NeMoScenarioDesigner: data_designer path — generated %d specs (alias=%s)",
                len(specs), alias,
            )
            provenance = {
                "path": "data_designer",
                "model": alias,
                "seed": seed,
                "run_id": run_id,
                "num_records_requested": num_records,
                "num_specs_returned": len(specs),
            }
            return GenerationResult(
                specs=specs,
                path_used="data_designer",
                provenance=provenance,
            )
        except Exception as exc:
            logger.warning(
                "NeMoScenarioDesigner: data_designer path failed (%s: %s) — "
                "falling back to stochastic battery.",
                type(exc).__name__,
                exc,
            )
            return self._generate_fallback(
                seed=seed,
                run_id=run_id,
                reason=f"api_error: {type(exc).__name__}: {exc}",
            )

    def _resolve_nvidia_model_alias(self) -> str:
        """Discover the NVIDIA text model alias from get_default_model_configs().

        Selection rule: first config where provider='nvidia' AND 'text' in alias
        AND 'reasoning' not in alias (reasoning models have different token budgets).
        Falls back to the documented default alias if discovery fails.

        Returns:
            Model alias string, e.g. ``"nvidia-text"``.
        """
        if not _DD_AVAILABLE:
            return _NVIDIA_MODEL_ALIAS_FALLBACK
        try:
            dd = _DD_INTERFACE()
            configs = dd.get_default_model_configs()
            for cfg in configs:
                alias = getattr(cfg, "alias", "")
                provider = getattr(cfg, "provider", "")
                if (
                    provider == "nvidia"
                    and "text" in alias
                    and "reasoning" not in alias
                ):
                    return alias
        except Exception as exc:
            logger.warning(
                "NeMoScenarioDesigner: get_default_model_configs() failed (%s) — "
                "using fallback alias '%s'.",
                exc, _NVIDIA_MODEL_ALIAS_FALLBACK,
            )
        return _NVIDIA_MODEL_ALIAS_FALLBACK

    def _build_config(self, count: int, seed: Optional[int] = None):
        """Build a DataDesignerConfigBuilder for the scenario generation schema.

        Schema:
          1. archetype CATEGORY sampler over the 8 canonical black-swan labels.
          2. drift_annual Gaussian sampler (negative = bear drift).
          3. vol_annual Gaussian sampler (annualised volatility > 0).
          4. dof Gaussian sampler (Student-t degrees of freedom; low = fat tails).
          5. jump_intensity Gaussian sampler (Poisson jump rate per bar).
          6. jump_scale_sigma Gaussian sampler (jump size in σ units).
          7. n_bars Gaussian sampler (number of OHLCV bars to generate).
          8. LLMStructuredColumnConfig for narrative (plain-English description).

        The builder is returned for the caller (tests or preview()) to consume.
        The LLM column uses the resolved NVIDIA text model alias.

        Args:
            count: Hint for number of rows (used in prompt context).
            seed: Reproducibility seed (embedded in prompt context).

        Returns:
            DataDesignerConfigBuilder instance with all columns added.
        """
        alias = self._resolve_nvidia_model_alias()
        dd = _DD_CONFIG

        cb = dd.DataDesignerConfigBuilder()

        # 1. Archetype category sampler
        archetype_weights = [1.0 / len(_CANONICAL_ARCHETYPES)] * len(_CANONICAL_ARCHETYPES)
        cb.add_column(
            dd.SamplerColumnConfig(
                name="archetype",
                sampler_type=dd.SamplerType.CATEGORY,
                params=dd.CategorySamplerParams(
                    values=_CANONICAL_ARCHETYPES,
                    weights=archetype_weights,
                ),
            )
        )

        # 2. drift_annual — negative for bear scenarios
        cb.add_column(
            dd.SamplerColumnConfig(
                name="drift_annual",
                sampler_type=dd.SamplerType.GAUSSIAN,
                params=dd.GaussianSamplerParams(
                    mean=-1.0,
                    stddev=1.5,
                    decimal_places=4,
                ),
            )
        )

        # 3. vol_annual — annualised volatility (must be > 0, abs applied at mapping)
        cb.add_column(
            dd.SamplerColumnConfig(
                name="vol_annual",
                sampler_type=dd.SamplerType.GAUSSIAN,
                params=dd.GaussianSamplerParams(
                    mean=0.60,
                    stddev=0.35,
                    decimal_places=4,
                ),
            )
        )

        # 4. dof — Student-t degrees of freedom (fat tails when < 6)
        cb.add_column(
            dd.SamplerColumnConfig(
                name="dof",
                sampler_type=dd.SamplerType.GAUSSIAN,
                params=dd.GaussianSamplerParams(
                    mean=3.5,
                    stddev=1.0,
                    decimal_places=2,
                ),
            )
        )

        # 5. jump_intensity — Poisson jumps per bar
        cb.add_column(
            dd.SamplerColumnConfig(
                name="jump_intensity",
                sampler_type=dd.SamplerType.GAUSSIAN,
                params=dd.GaussianSamplerParams(
                    mean=0.03,
                    stddev=0.02,
                    decimal_places=4,
                ),
            )
        )

        # 6. jump_scale_sigma — jump size in units of per-bar σ
        cb.add_column(
            dd.SamplerColumnConfig(
                name="jump_scale_sigma",
                sampler_type=dd.SamplerType.GAUSSIAN,
                params=dd.GaussianSamplerParams(
                    mean=4.0,
                    stddev=1.5,
                    decimal_places=2,
                ),
            )
        )

        # 7. n_bars — number of OHLCV bars
        cb.add_column(
            dd.SamplerColumnConfig(
                name="n_bars",
                sampler_type=dd.SamplerType.GAUSSIAN,
                params=dd.GaussianSamplerParams(
                    mean=500,
                    stddev=200,
                    decimal_places=0,
                ),
            )
        )

        # 8. LLM narrative column — diverse plain-English market stress descriptions
        cb.add_column(
            dd.LLMStructuredColumnConfig(
                name="narrative",
                model_alias=alias,
                prompt=(
                    f"You are a macro risk analyst. "
                    f"For a market stress scenario of archetype '{{archetype}}', "
                    f"write a 2-3 sentence plain-English description of the stress event. "
                    f"Focus on: what triggers it, which asset classes are affected, "
                    f"and what prop-firm traders must watch. "
                    f"(seed context: {seed}, count: {count})"
                ),
                output_format={"narrative": "string"},
            )
        )

        return cb

    def _map_rows_to_specs(self, df) -> list[ScenarioSpec]:
        """Map a pandas/polars DataFrame of Data Designer output to ScenarioSpec objects.

        Column mapping (tolerant of missing optional columns):
          - archetype → ScenarioSpec.name
          - drift_annual → ScenarioSpec.drift_annual
          - vol_annual → ScenarioSpec.vol_annual (abs, clamped > 0.01)
          - dof → ScenarioSpec.dof (clamped 2.0–5.9 for fat-tail guarantee)
          - jump_intensity → ScenarioSpec.jump_intensity (clamped 0.0–0.30)
          - jump_scale_sigma → ScenarioSpec.jump_scale_sigma (clamped 1.0–10.0)
          - n_bars → ScenarioSpec.n_bars (clamped 78–4000)
          - narrative → ScenarioSpec.description (optional)

        Hardcoded renderer-default columns (not in LLM output):
          hmm_states=2, low_vol_scale=0.6, high_vol_scale=2.0,
          transition_lo_to_hi=0.05, transition_hi_to_lo=0.05,
          garch_alpha=0.10, garch_beta=0.88, garch_omega=1e-6.
        These defaults keep α+β=0.98 which satisfies the stylized-fact
        GARCH persistence gate.

        Returns:
            List of ScenarioSpec objects, one per non-null row.
        """
        specs: list[ScenarioSpec] = []

        # Support both pandas and polars DataFrames
        try:
            rows = df.to_dicts()  # polars
        except AttributeError:
            rows = df.to_dict(orient="records")  # pandas

        archetypes_cycle = list(_CANONICAL_ARCHETYPES)
        for i, row in enumerate(rows):
            archetype = str(row.get("archetype", archetypes_cycle[i % len(archetypes_cycle)]))

            def _float(key: str, default: float) -> float:
                v = row.get(key, default)
                try:
                    return float(v)
                except (TypeError, ValueError):
                    return default

            def _int(key: str, default: int) -> int:
                v = row.get(key, default)
                try:
                    return max(1, int(round(float(v))))
                except (TypeError, ValueError):
                    return default

            vol_annual = max(0.01, abs(_float("vol_annual", 0.60)))
            drift_annual = _float("drift_annual", -1.0)
            dof = max(2.0, min(5.9, _float("dof", 3.5)))
            jump_intensity = max(0.0, min(0.30, _float("jump_intensity", 0.02)))
            jump_scale_sigma = max(1.0, min(10.0, _float("jump_scale_sigma", 3.0)))
            n_bars = max(78, min(4000, _int("n_bars", 500)))
            narrative = str(row.get("narrative", ""))

            spec = ScenarioSpec(
                name=archetype,
                vol_annual=round(vol_annual, 4),
                drift_annual=round(drift_annual, 4),
                dof=round(dof, 2),
                n_bars=n_bars,
                jump_intensity=round(jump_intensity, 4),
                jump_scale_sigma=round(jump_scale_sigma, 2),
                hmm_states=2,
                low_vol_scale=0.6,
                high_vol_scale=2.0,
                transition_lo_to_hi=0.05,
                transition_hi_to_lo=0.05,
                severity_description=narrative or f"NeMo-generated {archetype} scenario.",
                description=narrative,
            )
            specs.append(spec)

        return specs

    # ── Fallback generation path ───────────────────────────────────────────────

    def _generate_fallback(
        self,
        seed: Optional[int],
        run_id: str,
        reason: str = "unspecified",
    ) -> GenerationResult:
        """Return the 8 NAMED_SCENARIOS as a GenerationResult.

        Always returns all 8 named scenarios regardless of the requested count,
        since the battery is predefined and extending it meaningfully requires
        the Data Designer API.

        Args:
            seed: Seed for provenance recording.
            run_id: Run ID for provenance recording.
            reason: Human-readable reason for fallback (logged / recorded).

        Returns:
            GenerationResult with path_used="fallback" and all 8 named specs.
        """
        specs = list(NAMED_SCENARIOS.values())
        logger.info(
            "NeMoScenarioDesigner: fallback path — returning %d named scenarios "
            "(reason: %s). scenario_source=stochastic_fallback.",
            len(specs), reason,
        )
        provenance = {
            "path": "fallback",
            "model": None,
            "seed": seed,
            "run_id": run_id,
            "reason": reason,
            "scenario_source": "stochastic_fallback",
        }
        return GenerationResult(
            specs=specs,
            path_used="fallback",
            provenance=provenance,
        )

    # ── Helpers ────────────────────────────────────────────────────────────────

    @staticmethod
    def _make_run_id(seed: Optional[int], count: int) -> str:
        """Deterministic 12-char run ID from seed + count + version."""
        key = f"{seed}-{count}-{NEMO_GENERATOR_VERSION}"
        return hashlib.sha256(key.encode()).hexdigest()[:12]


# ─── Backward-compat: legacy NeMoScenario + old generate_scenarios list API ────
# The old API returned list[NeMoScenario]. Wave 24+ code may call the old-style
# generate_scenarios() and iterate over NeMoScenario objects.  We keep the
# dataclass for the A14 bridge (nemo_a14_bridge.py) and re-export it.
# The OLD generate method is available via NeMoScenarioDesigner._legacy_generate().

from dataclasses import asdict as _asdict
import time as _time

@dataclass
class NeMoScenario:
    """Single macro-narrative scenario (legacy; kept for nemo_a14_bridge.py)."""

    scenario_label: str
    severity: str
    duration_days: int
    target_vol: float
    target_trend: float
    target_gap_profile: dict
    narrative: str
    macro_links: dict
    generator_version: str
    run_id: str = ""
    seed: Optional[int] = None

    def to_dict(self) -> dict:
        return _asdict(self)

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False)


class NeMoNotAvailableError(RuntimeError):
    """Raised when NeMo Data Designer (data_designer) is not installed."""

    def __init__(self) -> None:
        super().__init__(
            "NeMo Data Designer (data_designer) is not installed. "
            "Install via: pip install data-designer==0.6.1 "
            "Set NVIDIA_API_KEY (from build.nvidia.com) to enable the NeMo generation path. "
            "Without the key, the module falls back to the stochastic battery transparently."
        )


# ─── CLI entrypoint ───────────────────────────────────────────────────────────


def _cli_main() -> None:
    """CLI: python -m src.engine.nemo_scenario_designer --count N [--seed S]"""
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="NeMo Scenario Designer v2")
    parser.add_argument("--count", type=int, default=NEMO_DEFAULT_COUNT)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--model-path", type=str, default="")
    parser.add_argument("--device", type=str, default="auto")
    args = parser.parse_args()

    t0 = _time.time()
    designer = NeMoScenarioDesigner(model_path=args.model_path, device=args.device)

    try:
        result = designer.generate_scenarios(count=args.count, seed=args.seed)
    except Exception as exc:
        output = {
            "error": str(exc),
            "specs": [],
            "count": 0,
            "generator_version": NEMO_GENERATOR_VERSION,
            "governance": GOVERNANCE_LABELS,
        }
        print(json.dumps(output), file=sys.stdout)
        sys.exit(1)

    elapsed_ms = int((_time.time() - t0) * 1000)
    output = {
        "count": result.count,
        "path_used": result.path_used,
        "provenance": result.provenance,
        "generator_version": NEMO_GENERATOR_VERSION,
        "elapsed_ms": elapsed_ms,
        "device": designer._device,
        "governance": GOVERNANCE_LABELS,
        "specs": [
            {
                "name": s.name,
                "vol_annual": s.vol_annual,
                "drift_annual": s.drift_annual,
                "dof": s.dof,
                "n_bars": s.n_bars,
                "jump_intensity": s.jump_intensity,
                "jump_scale_sigma": s.jump_scale_sigma,
                "severity_description": s.severity_description,
            }
            for s in result.specs
        ],
    }
    print(json.dumps(output), file=sys.stdout)


if __name__ == "__main__":
    _cli_main()
