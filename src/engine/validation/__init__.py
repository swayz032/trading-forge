"""Strategy Validation System — ensures strategies implement their named ICT concept correctly.

Two validation layers:
1. Static (AST): checks imports, time references, required patterns
2. Runtime (signal audit): checks entries are in allowed windows, signal density is reasonable

Usage:
    from src.engine.validation import load_spec, validate_static, validate_runtime

    spec = load_spec("silver_bullet")
    static_result = validate_static("src/engine/strategies/silver_bullet.py", spec)
    runtime_result = validate_runtime(signal_df, spec)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import yaml


# ─── Data Classes ─────────────────────────────────────────────────

@dataclass
class TimeWindow:
    start: str  # "HH:MM"
    end: str    # "HH:MM"
    tz: str = "US/Eastern"
    label: str = ""

    @property
    def start_minutes(self) -> int:
        h, m = map(int, self.start.split(":"))
        return h * 60 + m

    @property
    def end_minutes(self) -> int:
        h, m = map(int, self.end.split(":"))
        return h * 60 + m


@dataclass
class ConceptSpec:
    concept: str
    description: str = ""
    required_imports: list[str] = field(default_factory=list)
    required_imports_any: list[str] = field(default_factory=list)
    forbidden_imports: list[str] = field(default_factory=list)
    required_time_windows: list[TimeWindow] = field(default_factory=list)
    required_concepts: list[str] = field(default_factory=list)
    multi_instrument: bool = False
    instrument_pairs: list[list[str]] = field(default_factory=list)
    runtime_assertions: list[str] = field(default_factory=list)


@dataclass
class ValidationResult:
    passed: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def __repr__(self) -> str:
        status = "PASS" if self.passed else "FAIL"
        parts = [f"ValidationResult({status})"]
        if self.errors:
            parts.append(f"  errors: {self.errors}")
        if self.warnings:
            parts.append(f"  warnings: {self.warnings}")
        return "\n".join(parts)


# ─── Spec Loader ──────────────────────────────────────────────────

SPECS_DIR = Path(__file__).parent.parent / "specs"


def load_spec(concept: str) -> ConceptSpec:
    """Load a concept spec from YAML."""
    spec_path = SPECS_DIR / f"{concept}.yaml"
    if not spec_path.exists():
        raise FileNotFoundError(f"No spec found for concept '{concept}' at {spec_path}")

    with open(spec_path) as f:
        data = yaml.safe_load(f)

    time_windows = []
    for tw in data.get("required_time_windows", []):
        time_windows.append(TimeWindow(
            start=tw["start"],
            end=tw["end"],
            tz=tw.get("tz", "US/Eastern"),
            label=tw.get("label", ""),
        ))

    return ConceptSpec(
        concept=data["concept"],
        description=data.get("description", ""),
        required_imports=data.get("required_imports", []),
        required_imports_any=data.get("required_imports_any", []),
        forbidden_imports=data.get("forbidden_imports", []),
        required_time_windows=time_windows,
        required_concepts=data.get("required_concepts", []),
        multi_instrument=data.get("multi_instrument", False),
        instrument_pairs=data.get("instrument_pairs", []),
        runtime_assertions=data.get("runtime_assertions", []),
    )


def list_specs() -> list[str]:
    """List all available concept specs."""
    return [p.stem for p in SPECS_DIR.glob("*.yaml")]


# ─── Strategy → Concept Mapping ──────────────────────────────────

STRATEGY_CONCEPT_MAP: dict[str, str] = {
    "silver_bullet": "silver_bullet",
    "smt_reversal": "smt_reversal",
    "judas_swing": "judas_swing",
    "ict_2022": "ict_2022",
    "ote_strategy": "ote",
    "breaker": "breaker",
    "turtle_soup": "turtle_soup",
    "iofed": "iofed",
    "midnight_open": "midnight_open",
    "ny_lunch_reversal": "ny_lunch_reversal",
    "eqhl_raid": "eqhl_raid",
    "ict_scalp": "ict_scalp",
    "ict_swing": "ict_swing",
    "london_raid": "london_raid",
    "mitigation": "mitigation",
    "power_of_3": "power_of_3",
    "propulsion": "propulsion",
    "quarterly_swing": "quarterly_swing",
    "unicorn": "unicorn",
}


# ─── Public API ───────────────────────────────────────────────────

from src.engine.validation.static_validator import validate_static, validate_static_from_code  # noqa: E402
from src.engine.validation.runtime_validator import validate_runtime  # noqa: E402

__all__ = [
    "ConceptSpec",
    "ValidationResult",
    "TimeWindow",
    "load_spec",
    "list_specs",
    "validate_static",
    "validate_static_from_code",
    "validate_runtime",
    "STRATEGY_CONCEPT_MAP",
]
