"""JSONB shape contracts (F-7).

Python mirror of `src/server/db/jsonb-shapes.ts`. Writers on the Python side
MUST `.model_dump()` through one of these models before INSERT/UPDATE so the
schema_version key is always stamped and key drift is caught at write-time.

Schema-version gating
─────────────────────
Every JSONB shape carries a `schema_version` string. Bumping requires:
  1. Update the constant in this file (e.g. ``RESULT_EXTRAS_VERSION``).
  2. Update the TS shape in jsonb-shapes.ts to match.
  3. Update TS readers to accept both old and new during rollout.

This pass: pydantic models defined + ``schema_version`` constants exposed for
writers. Full enforcement (raising on key drift, strict-mode validation) is
deferred to the next sweep — the schema_version field is the gating mechanism
today.

Usage
─────
    from src.engine.jsonb_contracts import BacktestResultExtras, RESULT_EXTRAS_VERSION

    extras = BacktestResultExtras(
        schema_version=RESULT_EXTRAS_VERSION,
        invariants={"overall_passed": True, "checks": []},
        # ...
    )
    cur.execute(
        "UPDATE backtests SET result_extras = %s WHERE id = %s",
        (json.dumps(extras.model_dump(mode="json", exclude_none=True)), bt_id),
    )
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

try:
    from pydantic import BaseModel, ConfigDict
except ImportError:  # pragma: no cover - pydantic is a transitive dep via vectorbt
    # Fallback shim: if pydantic isn't installed in a given engine context,
    # writers still get the schema_version constants. The dict path is the
    # legacy code path and remains functional.
    class _StubBase:  # type: ignore[no-redef]
        def __init__(self, **kwargs: Any) -> None:
            self.__dict__.update(kwargs)

        def model_dump(self, **_: Any) -> Dict[str, Any]:
            return dict(self.__dict__)

    BaseModel = _StubBase  # type: ignore[misc,assignment]
    ConfigDict = dict  # type: ignore[misc,assignment]


# ─── Schema-version constants (writers stamp these) ─────────────────────────
RESULT_EXTRAS_VERSION = "v2_truthiness"
PAPER_SESSION_CONFIG_VERSION = "v1"
PAPER_SESSION_GOVERNOR_VERSION = "v1"


# ─── Backtest result_extras ─────────────────────────────────────────────────
class InvariantCheck(BaseModel):
    name: str
    passed: bool
    detail: Optional[str] = None


class Invariants(BaseModel):
    overall_passed: bool
    checks: Optional[List[InvariantCheck]] = None


class ParityShadow(BaseModel):
    passed: bool
    drift_pct: Optional[float] = None
    baseline_run_id: Optional[str] = None


class DslGuards(BaseModel):
    stop_ceiling_skips: Optional[int] = None
    stop_floor_skips: Optional[int] = None
    time_stop_flatten_count: Optional[int] = None


class GovernorSnapshot(BaseModel):
    state: Literal["ENABLED", "PAUSED", "FAILED"]
    sessionLossPct: Optional[float] = None
    consecutiveLosses: Optional[int] = None
    lastUpdatedAt: Optional[str] = None  # ISO8601


class BacktestResultExtras(BaseModel):
    """Mirrors `BacktestResultExtrasShape` in jsonb-shapes.ts.

    Required ``schema_version`` field — readers refuse unknown versions.
    """

    model_config = ConfigDict(extra="allow")  # forward-compat for unknown keys

    schema_version: str = RESULT_EXTRAS_VERSION
    invariants: Optional[Invariants] = None
    parity_shadow: Optional[ParityShadow] = None
    dsl_guards: Optional[DslGuards] = None
    governor: Optional[GovernorSnapshot] = None
    long_short_split: Optional[Dict[str, float]] = None
    bootstrap_ci_95: Optional[Dict[str, float]] = None
    deflated_sharpe: Optional[float] = None
    recency_analysis: Optional[Dict[str, Any]] = None
    statistical_warnings: Optional[List[str]] = None
    confidence_intervals: Optional[Dict[str, Dict[str, float]]] = None


# ─── Paper session config + governor (Python writers are rare here, but keep
#     parity for future Python-side paper engine work) ────────────────────────
class PaperSessionConfig(BaseModel):
    model_config = ConfigDict(extra="allow")

    schema_version: str = PAPER_SESSION_CONFIG_VERSION
    symbols: Optional[List[str]] = None
    timeframe: Optional[str] = None
    maxRiskPctPerTrade: Optional[float] = None
    personalDllPct: Optional[float] = None
    pyramidBaseContracts: Optional[Dict[str, int]] = None
    liquidityCaps: Optional[Dict[str, int]] = None


class PaperSessionGovernorState(BaseModel):
    model_config = ConfigDict(extra="allow")

    schema_version: str = PAPER_SESSION_GOVERNOR_VERSION
    state: Literal["ENABLED", "PAUSED", "FAILED"]
    consecutiveLosses: int = 0
    sessionLossPct: float = 0.0
    lastUpdatedAt: str  # ISO8601
    reason: Optional[str] = None


__all__ = [
    "RESULT_EXTRAS_VERSION",
    "PAPER_SESSION_CONFIG_VERSION",
    "PAPER_SESSION_GOVERNOR_VERSION",
    "BacktestResultExtras",
    "InvariantCheck",
    "Invariants",
    "ParityShadow",
    "DslGuards",
    "GovernorSnapshot",
    "PaperSessionConfig",
    "PaperSessionGovernorState",
]
