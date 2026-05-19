"""Exit handler module — Style D (default) and Style C (regime runner).

Track 3 (2026-05-09): replaces fixed-R take profit with structure-aware
exit management. Both handlers are pure functions with no I/O. Fail-closed:
any error returns HOLD with an audit log entry.

Public API:
    ExitDecision          — Pydantic model returned by both handlers
    style_d_handler       — evaluate_exit(state) -> ExitDecision (Style D)
    style_c_handler       — evaluate_exit(state) -> ExitDecision (Style C)
    select_exit_style()   — delegated from structural_targets.select_exit_style()
"""
from __future__ import annotations

from src.engine.exits.style_d_handler import ExitDecision, evaluate_exit as style_d_evaluate
from src.engine.exits.style_c_handler import evaluate_exit as style_c_evaluate
from src.engine.context.structural_targets import select_exit_style

__all__ = [
    "ExitDecision",
    "style_d_evaluate",
    "style_c_evaluate",
    "select_exit_style",
]
