"""Context module — HTF context, session context, and bias engine."""

from src.engine.context.htf_context import HTFContext, compute_htf_context
from src.engine.context.session_context import SessionContext, compute_session_context
from src.engine.context.bias_engine import DailyBiasState, compute_bias, BIAS_WEIGHTS
from src.engine.context.eligibility_gate import EligibilityDecision, evaluate_signal

__all__ = [
    "HTFContext",
    "compute_htf_context",
    "SessionContext",
    "compute_session_context",
    "DailyBiasState",
    "compute_bias",
    "BIAS_WEIGHTS",
    "EligibilityDecision",
    "evaluate_signal",
]
