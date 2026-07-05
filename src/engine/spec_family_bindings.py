"""spec_family_bindings.py — Band C condition-family -> primitive binding-plan compiler.

THE HYBRID DECISION (roadmap Band C, 2026-07-02): Band B's spec-archetype-matcher.ts
maps a compiled spec's condition graph onto a NAMED archetype via keyword match
only (6/25 sample specs matched; 19/25 queued to needs_archetype). This module
is the next layer down: for specs that don't match a named archetype, it maps
each individual condition's FAMILY (its `type`, e.g. WAIT_SESSION, INVALIDATE)
onto an EXISTING audited engine primitive wherever one exists, producing a
per-condition BINDING with a confidence/approximation flag.

FAIL-CLOSED CONTRACT: this module NEVER guesses a mapping. Every binding is
either (a) bound to a real primitive (with `approximation` honestly flagged
when the primitive is reused in a simplified/generalized way), or (b)
explicitly unbindable with a documented per-condition reason. A spec whose
trigger or majority of spine conditions can't bind stays queued to
needs_archetype — same honesty contract as Band B's archetype matcher.

PURITY CONTRACT (Ledger E parity surface, C2): this module does ZERO I/O, no
DataFrame access, no DB reads — it is pure string/dict logic over the spec's
condition list. This is deliberate: it is mirrored byte-for-byte in
src/server/lib/spec-family-bindings.ts so the SAME spec produces the SAME
binding plan on both sides of the stack (parity-tested in
tests/test_spec_family_bindings_parity.py). Any change here MUST be mirrored
there in the same commit — same convention as firm_rules_version.py /
firm-rules-version.ts.

FAMILY -> PRIMITIVE TABLE (see docs/spec-execution-semantics.md for the full
decision record with citations):

  WAIT_SESSION       -> session_windows.py (killzone.ts Python mirror)      approx=False (faithful port)
  WAIT_STRUCTURE     -> structure_engine.compute_structure_state           approx=True  (single-TF, no separate HTF frame wired yet)
  VERIFY_STRUCTURE   -> structure_engine.compute_structure_state           approx=True  (same as above)
  WAIT_BIAS          -> bias_engine.classify_institutional_regime          approx=True  (regime label used as directional proxy, not session-anchored HTF narrative)
  CONFIRM_DIRECTION  -> bias_engine.classify_institutional_regime          approx=True  (same as above)
  WAIT_RETEST        -> spec_condition_compiler.retest_touch_check         approx=True  (generalizes bounce_off_level.py's ATR-proximity touch math; not the full rejection-candle archetype)
  FILTER             -> entry_quality.confluence_factors presence check    approx=True  (no standalone per-bar confluence primitive exists outside the TS/live-paper confluence-score.ts pipeline)
  WAIT_CONFIRMATION  -> spec_condition_compiler.candle_confirmation_check  approx=True  (generalizes bounce_off_level.py's rejection-pattern helpers to arbitrary objects)
  INVALIDATE         -> structural_stops.compute_structural_stop          approx=False (direct reuse of the audited stop-placement primitive)
  ENABLE_ENTRY/ENTER -> spine-completion trigger (AND of bound spine conditions) approx=inherited from constituents
  EXIT_HINT          -> provenance-only, NEVER executed (framework overlay is authoritative for exits — W23F.N)
  RESET/EXCEPTION    -> unsupported control-flow; explicit per-condition reason, never guessed
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

# ─── FVG Identity Dispatch Experiment (docs/designs/fvg-identity-dispatch-
# experiment-2026-07-05.md, Part B item 1) ──────────────────────────────────
# Single-variable, env-gated toggle: WHEN ENABLED, a WAIT_STRUCTURE/FILTER
# condition whose object names the FVG family binds to the fresh, isolated
# `fvg_native.compute_fvg_signal` primitive (approximation=False) instead of
# the generic structure_engine/confluence-presence primitive every other
# WAIT_STRUCTURE/FILTER condition still uses. Default OFF so production
# binding plans stay byte-identical until the controlled experiment (Part C,
# the Signature Divergence Score harness) is reviewed — mirrors the
# established "ship gates STRICT, default OFF" pattern (CLAUDE.md §13) used
# for every other new-behavior flag in this codebase (slippage-survival gate,
# structural-stop parity, etc). Set TF_FVG_IDENTITY_ENABLED=true to activate.
FVG_OBJECT_KEYWORDS: tuple[str, ...] = (
    "fvg",
    "fair value gap",
    "imbalance",
    "put limit order right fvg",
)


def fvg_identity_enabled() -> bool:
    """Read at call time (not cached at import) so a controlled before/after
    comparison run in the SAME process (e.g. the SDS harness building a Mode-A
    strategy instance, flipping the env var, then building a Mode-B instance)
    sees the flag change immediately — same pattern as
    apply_eligibility_gate()'s live TF_CONFLUENCE_OVERLAY_DISABLED read."""
    return os.environ.get("TF_FVG_IDENTITY_ENABLED", "false").strip().lower() == "true"


def resolve_fvg_object(object_text: str) -> bool:
    """True iff `object_text` names an object in the FVG family (fair value
    gap / imbalance). Pure substring match — no word-boundary padding needed
    here (unlike resolve_session_keyword) since these are multi-word phrases
    unlikely to appear as an accidental substring of an unrelated object."""
    if not object_text:
        return False
    norm = object_text.strip().lower()
    return any(kw in norm for kw in FVG_OBJECT_KEYWORDS)


# ─── Session keyword table (duplicated verbatim in the TS mirror — see module
# docstring). Kept identical to session_windows.SESSION_KEYWORDS so a spec's
# WAIT_SESSION binding decision doesn't depend on session_windows.py's own
# import surface (keeps this module trivially portable / pure). ────────────
SESSION_KEYWORDS: dict[str, tuple[str, ...]] = {
    "london": ("london session", "london open", "london killzone"),
    "ny_am": ("ny am", "new york am", "new york morning", "ny morning", "ny open", "am session"),
    "ny_pm": ("ny pm", "new york pm", "new york afternoon", "ny afternoon", "pm session"),
    "silver_bullet": ("silver bullet",),
    "macro_window": ("macro window", "macro release"),
    "lunch_blackout": ("lunch", "midday", "noon session"),
    "overnight": ("overnight", "globex", "asia session", "pre market", "premarket"),
}

MIN_SPINE_BOUND_RATIO: float = 0.5
"""Minimum fraction of `role=="spine"` conditions that must bind to a primitive
(or resolve to an honest unsupported-but-non-blocking state) before a spec is
considered condition-compiled rather than queued. Conservative default —
tunable, but changing it is a behavior change requiring re-measurement of the
25-sample mapped/queued split (see docs/spec-execution-semantics.md)."""


@dataclass(frozen=True)
class FamilyMeta:
    primitive: str | None
    requires_session_keyword: bool = False
    base_approximation: bool = False
    unsupported: bool = False
    unbound_reason: str | None = None
    executed: bool = True  # False only for EXIT_HINT (provenance-only, never drives signals)


FAMILY_META: dict[str, FamilyMeta] = {
    "WAIT_SESSION": FamilyMeta(
        primitive="session_windows",
        requires_session_keyword=True,
        base_approximation=False,
        unbound_reason="no_recognized_session_keyword",
    ),
    "WAIT_STRUCTURE": FamilyMeta(
        primitive="structure_engine.compute_structure_state",
        base_approximation=True,
    ),
    "VERIFY_STRUCTURE": FamilyMeta(
        primitive="structure_engine.compute_structure_state",
        base_approximation=True,
    ),
    "WAIT_BIAS": FamilyMeta(
        primitive="bias_engine.classify_institutional_regime",
        base_approximation=True,
    ),
    "CONFIRM_DIRECTION": FamilyMeta(
        primitive="bias_engine.classify_institutional_regime",
        base_approximation=True,
    ),
    "WAIT_RETEST": FamilyMeta(
        primitive="spec_condition_compiler.retest_touch_check",
        base_approximation=True,
    ),
    "FILTER": FamilyMeta(
        primitive="entry_quality.confluence_factor_presence",
        base_approximation=True,
    ),
    "WAIT_CONFIRMATION": FamilyMeta(
        primitive="spec_condition_compiler.candle_confirmation_check",
        base_approximation=True,
    ),
    "INVALIDATE": FamilyMeta(
        primitive="structural_stops.compute_structural_stop",
        base_approximation=False,
    ),
    "ENABLE_ENTRY": FamilyMeta(
        primitive="spine_completion_trigger",
        base_approximation=False,
    ),
    "ENTER": FamilyMeta(
        primitive="spine_completion_trigger",
        base_approximation=False,
    ),
    "EXIT_HINT": FamilyMeta(
        primitive="provenance_only",
        base_approximation=False,
        executed=False,
    ),
    "RESET": FamilyMeta(
        primitive=None,
        unsupported=True,
        unbound_reason="control_flow_reset_unsupported",
    ),
    "EXCEPTION": FamilyMeta(
        primitive=None,
        unsupported=True,
        unbound_reason="control_flow_exception_unsupported",
    ),
}


@dataclass(frozen=True)
class ConditionBinding:
    condition_id: str
    type: str
    role: str
    object: str
    bindable: bool
    primitive: str | None
    approximation: bool
    executed: bool
    reason: str | None = None
    session_zone: str | None = None

    def to_dict(self) -> dict:
        return {
            "condition_id": self.condition_id,
            "type": self.type,
            "role": self.role,
            "object": self.object,
            "bindable": self.bindable,
            "primitive": self.primitive,
            "approximation": self.approximation,
            "executed": self.executed,
            "reason": self.reason,
            "session_zone": self.session_zone,
        }


def resolve_session_keyword(object_text: str) -> str | None:
    """Pure re-implementation of session_windows.resolve_session_keyword — kept
    local so this module has zero import surface beyond stdlib (portability
    for the TS mirror comparison in tests)."""
    if not object_text:
        return None
    norm = f" {object_text.strip().lower()} "
    for zone, keywords in SESSION_KEYWORDS.items():
        for kw in keywords:
            if f" {kw} " in norm or norm.strip().startswith(kw) or norm.strip().endswith(kw):
                return zone
    return None


def bind_condition(condition: dict) -> ConditionBinding:
    """Bind a single spec condition {id, type, object, role, span, evidence} to
    a primitive descriptor. Never raises; unknown condition types are honestly
    unbindable rather than defaulted to some guessed family."""
    cond_id = str(condition.get("id", ""))
    cond_type = str(condition.get("type", ""))
    role = str(condition.get("role", ""))
    obj = str(condition.get("object", "") or "")

    meta = FAMILY_META.get(cond_type)
    if meta is None:
        return ConditionBinding(
            condition_id=cond_id,
            type=cond_type,
            role=role,
            object=obj,
            bindable=False,
            primitive=None,
            approximation=False,
            executed=False,
            reason="unknown_condition_type",
        )

    if meta.unsupported:
        return ConditionBinding(
            condition_id=cond_id,
            type=cond_type,
            role=role,
            object=obj,
            bindable=False,
            primitive=None,
            approximation=False,
            executed=False,
            reason=meta.unbound_reason,
        )

    # FVG identity dispatch (experiment, env-gated — see module docstring
    # above SESSION_KEYWORDS). Only WAIT_STRUCTURE/FILTER conditions are in
    # scope per the locked spec's Part B item 1; every other condition type,
    # and every WAIT_STRUCTURE/FILTER whose object is NOT in the FVG family,
    # falls through unchanged to the generic dispatch below.
    if cond_type in ("WAIT_STRUCTURE", "FILTER") and fvg_identity_enabled() and resolve_fvg_object(obj):
        return ConditionBinding(
            condition_id=cond_id,
            type=cond_type,
            role=role,
            object=obj,
            bindable=True,
            primitive="fvg_native.compute_fvg_signal",
            approximation=False,
            executed=True,
            reason=None,
        )

    if meta.requires_session_keyword:
        zone = resolve_session_keyword(obj)
        if zone is None:
            return ConditionBinding(
                condition_id=cond_id,
                type=cond_type,
                role=role,
                object=obj,
                bindable=False,
                primitive=None,
                approximation=False,
                executed=False,
                reason=meta.unbound_reason,
                session_zone=None,
            )
        return ConditionBinding(
            condition_id=cond_id,
            type=cond_type,
            role=role,
            object=obj,
            bindable=True,
            primitive=meta.primitive,
            approximation=meta.base_approximation,
            executed=meta.executed,
            reason=None,
            session_zone=zone,
        )

    return ConditionBinding(
        condition_id=cond_id,
        type=cond_type,
        role=role,
        object=obj,
        bindable=True,
        primitive=meta.primitive,
        approximation=meta.base_approximation,
        executed=meta.executed,
        reason=None,
    )


@dataclass
class BindingPlan:
    bindings: list[ConditionBinding]
    invalidation_bindings: list[ConditionBinding]
    trigger_condition_id: str
    trigger_bound: bool
    spine_total: int
    spine_bound: int
    confluence_total: int
    confluence_bound: int
    approximation_used: bool
    compiled: bool
    queue_reasons: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "bindings": [b.to_dict() for b in self.bindings],
            "invalidation_bindings": [b.to_dict() for b in self.invalidation_bindings],
            "trigger_condition_id": self.trigger_condition_id,
            "trigger_bound": self.trigger_bound,
            "spine_total": self.spine_total,
            "spine_bound": self.spine_bound,
            "confluence_total": self.confluence_total,
            "confluence_bound": self.confluence_bound,
            "approximation_used": self.approximation_used,
            "compiled": self.compiled,
            "queue_reasons": self.queue_reasons,
        }


def compile_binding_plan(spec: dict) -> BindingPlan:
    """Compile a full spec artifact body {entry_conditions, invalidations,
    entry_trigger_id, ...} into a BindingPlan.

    Deterministic: iterates entry_conditions in-order, no randomness, no
    wall-clock reads — same spec always produces the same plan (replay
    determinism contract).
    """
    entry_conditions = spec.get("entry_conditions", []) or []
    invalidations = spec.get("invalidations", []) or []
    trigger_id = str(spec.get("entry_trigger_id", "") or "")

    bindings = [bind_condition(c) for c in entry_conditions]
    invalidation_bindings = [bind_condition(c) for c in invalidations]

    spine = [b for b in bindings if b.role == "spine"]
    confluence = [b for b in bindings if b.role == "confluence"]
    spine_bound = sum(1 for b in spine if b.bindable)
    confluence_bound = sum(1 for b in confluence if b.bindable)

    trigger_binding = next((b for b in bindings if b.condition_id == trigger_id), None)
    trigger_bound = bool(trigger_binding and trigger_binding.bindable)

    approximation_used = any(b.approximation for b in bindings if b.bindable and b.executed) or any(
        b.approximation for b in invalidation_bindings if b.bindable and b.executed
    )

    queue_reasons: list[dict] = []
    compiled = True

    if not trigger_bound:
        compiled = False
        queue_reasons.append(
            {
                "condition_id": trigger_id,
                "type": trigger_binding.type if trigger_binding else "unknown",
                "object": trigger_binding.object if trigger_binding else "",
                "reason": trigger_binding.reason if trigger_binding else "trigger_condition_not_found",
            }
        )

    # A bare trigger with NO spine (required-sequence) conditions at all is
    # NOT enough to call a spec "condition-compiled" — there is no structural
    # narrative to bind primitives to beyond a vague trigger phrase. This is
    # what distinguishes a genuinely compilable spec from e.g. a one-line
    # "vwap slope reversal cross" trigger with only a confluence tag (Band B's
    # own vwapSpec fixture) — that spec correctly stays queued.
    if not spine:
        compiled = False
        queue_reasons.append(
            {
                "condition_id": trigger_id,
                "type": trigger_binding.type if trigger_binding else "unknown",
                "object": "",
                "reason": "no_spine_conditions_present",
            }
        )

    spine_ratio = (spine_bound / len(spine)) if spine else 0.0
    if spine and spine_ratio < MIN_SPINE_BOUND_RATIO:
        compiled = False
        for b in spine:
            if not b.bindable:
                queue_reasons.append(
                    {
                        "condition_id": b.condition_id,
                        "type": b.type,
                        "object": b.object,
                        "reason": b.reason or "unbindable",
                    }
                )

    # Always surface unbound spine/trigger reasons even when the ratio still
    # clears the bar — per-condition honesty, not just a pass/fail blanket.
    if compiled:
        for b in spine:
            if not b.bindable:
                queue_reasons.append(
                    {
                        "condition_id": b.condition_id,
                        "type": b.type,
                        "object": b.object,
                        "reason": b.reason or "unbindable",
                    }
                )

    return BindingPlan(
        bindings=bindings,
        invalidation_bindings=invalidation_bindings,
        trigger_condition_id=trigger_id,
        trigger_bound=trigger_bound,
        spine_total=len(spine),
        spine_bound=spine_bound,
        confluence_total=len(confluence),
        confluence_bound=confluence_bound,
        approximation_used=approximation_used,
        compiled=compiled,
        queue_reasons=queue_reasons,
    )
