"""Execution-boundary preflight for Band C compiled specs (R-419 / R-420).

WHY THIS IS A SEPARATE MODULE — the two-responsibility split (R-419)
-------------------------------------------------------------------
There are two distinct jobs and conflating them is the defect:

  1. The COMPILER / RESOLVER (`spec_family_bindings`) marks a rule
     `bindable=False`, `primitive=None`, `approximation=True` — *it reports
     truth*.
  2. The EXECUTION BOUNDARY (this module, called from `backtester.main`)
     refuses to run when a MANDATORY rule is unbindable — *it enforces
     executability*.

A resolver that also halts backtests is a producer smuggling consumer
authority, so the policy lives here and the resolver stays a pure reporter.

THE TYPE ERROR UNDER THE VALUE ERROR (R-420)
--------------------------------------------
An uncompilable mandatory rule is NEITHER true NOR false — it is an
UNRESOLVED EXECUTION ERROR. Substituting `True` widens the strategy (it trades
where the source forbade it); substituting `False` silently disables it.
Neither preserves the source, so no choice of boolean is correct: the answer
needs an explicit third state. This module is that third state.

    THE SYSTEM MUST NEVER CONVERT "CANNOT IMPLEMENT THIS RULE"
    INTO "RUN WITHOUT THIS RULE."

WHY NOT THE 50% RATIO (R-420 required-correction 1)
---------------------------------------------------
`spec_family_bindings.MIN_SPINE_BOUND_RATIO` is a CARDINALITY test: 9 of 10
spine conditions binding gives ratio 0.9 and "compiled", while the 10th — the
mandatory session rule — silently becomes always-true. A ratio has no way to
express "this particular one is mandatory". Ten confluence rules do not
compensate for one missing session restriction. The ratio is DEMOTED to a
corpus-health diagnostic and may no longer be the authority that permits
execution; safety is a MEMBERSHIP question and is decided here.

Purity contract: stdlib only, zero I/O, no wall-clock reads — same contract as
`spec_family_bindings`, so this stays trivially testable and deterministic.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# ─── Rule classes ───────────────────────────────────────────────────────────
MANDATORY: str = "MANDATORY"
"""The rule must be executable or the backtest is refused."""

OPTIONAL: str = "OPTIONAL"
"""The rule may be omitted — recorded as OPTIONAL_NOT_APPLIED, never silently."""

OPTIONAL_CANDIDATE: str = "OPTIONAL_CANDIDATE"
"""Looks optional by role, but not yet licensed to be dropped. Resolves to
MANDATORY unless positive source evidence of optionality is supplied."""

UNKNOWN_REQUIREDNESS: str = "UNKNOWN_REQUIREDNESS"
"""We do not know whether the source treated this rule as required.

★★★ THIS BLOCKS EXECUTION EXACTLY LIKE MANDATORY — honest labelling must not
cost safety. What it changes is the RECORD, not the outcome.

The first cut of this module folded "unknown" into MANDATORY. That fails closed,
which is correct, but it stores a claim the source never made: it says *the
educator marked this rule required* when the truth is *we could not tell*.
Recording "we don't know" as "the source said so" fabricates provenance inside
the very artifact built to stop fabrication — the same defect as stamping
`approximation=False` on a rule with no clock, one field over.

★ Consequence worth stating for a later reader: a fidelity-grade backtest should
refuse UNKNOWN_REQUIREDNESS even when the predicate is technically bindable,
because "we don't know if this rule matters" is not a basis for a performance
claim about someone's strategy. This module only decides the unbindable case;
the broader gate is not ours to assert here."""

NON_EXECUTABLE_EMPTY_SPINE: str = "non_executable_empty_spine"
"""Refusal reason: the spec has NO executable spine predicate at all.

Distinct from a per-condition refusal, and deliberately its own reason string:
nothing here is necessarily *unbindable*: a spine made only of EXIT_HINT rows is
entirely bindable and still produces no predicate. Without this rule such a spec
reaches `compute()` with an empty `per_condition_bool`, `spine_satisfied` falls
back to the AND identity `np.ones(n)`, and rising-edge semantics fire exactly
ONE entry at bar 0 that no source rule authorized."""

OPTIONAL_NOT_APPLIED: str = "OPTIONAL_NOT_APPLIED"
"""The status recorded for an optional rule that was not applied. Deliberately
distinct vocabulary from a compiler failure: `OPTIONAL_NOT_APPLIED` says "the
source defined this as droppable and we dropped it", NEVER "we could not
compile it so we treated it as true". Keeping COMPILER FAILURE and VALID
OPTIONAL OMISSION in separate words is the point — one branch expressing both
is exactly what `spec_condition_compiler.py` used to encode."""

_MANDATORY_ROLES: frozenset[str] = frozenset({"spine", "invalidation"})
_OPTIONAL_CANDIDATE_ROLES: frozenset[str] = frozenset({"confluence"})


class NonExecutableEmptySpineError(RuntimeError):
    """Raised when a spec reaches execution with no executable spine predicate.

    Kept as its own exception type, separate from UnresolvedMandatoryRuleError:
    the two blockers have different causes and must stay distinguishable in any
    log or ledger. "Every rule was bindable but none of them produce a
    predicate" is a different fault from "a required rule could not be bound"."""


class UnresolvedMandatoryRuleError(RuntimeError):
    """Raised at the point of use when a MANDATORY rule has no executable
    predicate. This is the belt to the preflight's braces: if the preflight is
    ever bypassed, moved, or regressed, the consumer itself still refuses
    rather than silently substituting a boolean."""


def classify_rule_role(role: str) -> str:
    """Map a graph `role` to a rule class. FAILS CLOSED.

    `spine` / `invalidation` -> MANDATORY.
    `confluence`             -> OPTIONAL_CANDIDATE (see resolve_rule_class).
    anything else OR absent  -> UNKNOWN_REQUIREDNESS (blocks, but is not
                                recorded as a source claim).

    ★ GROUNDING — why exactly two roles are MANDATORY and nothing else.
      [MEASURED over POP-16 / corpus_A, `shakedown_specs`, 16 files] the role
      vocabulary is exactly {spine: 102, confluence: 53, invalidation: 6}, and
      all 16 entry-trigger conditions carry role "spine" — the literal role
      "trigger" does not occur. So `spine` and `invalidation` are the only
      values this campaign has evidence for. Everything else, "trigger"
      included, is honestly unknown.

    ★ The last arm is the load-bearing one. `role` is read straight off the
      graph with an empty-string fallback (`spec_family_bindings.bind_condition`),
      so an ABSENT role is reachable in practice — and an absent constraint must
      widen scope, never narrow it. UNKNOWN_REQUIREDNESS still refuses; do not
      "fix" it by defaulting unknown roles to optional.
    """
    if role in _OPTIONAL_CANDIDATE_ROLES:
        return OPTIONAL_CANDIDATE
    if role in _MANDATORY_ROLES:
        return MANDATORY
    return UNKNOWN_REQUIREDNESS


def blocks_execution(rule_class: str) -> bool:
    """Does this rule class stop a backtest when its predicate is missing?

    MANDATORY and UNKNOWN_REQUIREDNESS both block. They are separate CLASSES
    with the same CONSEQUENCE — the distinction is what gets recorded, never
    whether the run proceeds."""
    return rule_class in (MANDATORY, UNKNOWN_REQUIREDNESS)


def resolve_rule_class(role: str, optional_evidence: bool) -> str:
    """Resolve a role to MANDATORY or OPTIONAL given positive source evidence.

    R-420: `confluence` is NOT safely optional by default. The role is mutable
    in-flight — the Hard-Constraint Demotion Experiment can move a condition's
    structural role — so a `confluence` label is not proof that the SOURCE
    treated the rule as droppable. A candidate becomes OPTIONAL only when the
    caller supplies positive evidence for that specific condition; absent it,
    the candidate refuses.

    Evidence can never DOWNGRADE a mandatory role — that direction is closed.
    """
    rule_class = classify_rule_role(role)
    if rule_class == OPTIONAL_CANDIDATE:
        return OPTIONAL if optional_evidence else MANDATORY
    # ★ UNKNOWN_REQUIREDNESS is returned UNCHANGED even when the caller offers
    #   optional evidence. Evidence attaches to a condition whose role we can
    #   read; it cannot launder a role we could not classify into a droppable
    #   one. Same closed direction as the mandatory arm.
    return rule_class


@dataclass(frozen=True)
class PreflightRefusal:
    """One refused rule. Carries everything an operator needs to act without
    opening the code: which strategy, which rule in the source's own words,
    what kind of rule it is, and why it could not be executed (R-420)."""

    strategy_id: str
    condition_id: str
    rule_text: str
    semantic_type: str
    role: str
    reason: str
    rule_class: str = MANDATORY
    """WHY this rule blocked: MANDATORY (the source marked it required) or
    UNKNOWN_REQUIREDNESS (we could not tell). Never collapse the two — the
    second is not a claim about the source."""

    def to_dict(self) -> dict:
        return {
            "strategy_id": self.strategy_id,
            "condition_id": self.condition_id,
            "rule_text": self.rule_text,
            "semantic_type": self.semantic_type,
            "role": self.role,
            "reason": self.reason,
            "rule_class": self.rule_class,
        }


@dataclass(frozen=True)
class PreflightResult:
    refused: bool
    refusals: list[PreflightRefusal] = field(default_factory=list)
    warnings: list[dict] = field(default_factory=list)
    ratio_diagnostic: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "refused": self.refused,
            "refusals": [r.to_dict() for r in self.refusals],
            "warnings": list(self.warnings),
            # DIAGNOSTIC ONLY — reported so corpus health stays visible, never
            # consulted to decide `refused`. See the module docstring.
            "ratio_diagnostic": dict(self.ratio_diagnostic),
        }

    def error_message(self) -> str:
        head = (
            f"REFUSED: {len(self.refusals)} mandatory rule(s) have no executable "
            f"predicate. Running would silently trade without them."
        )
        lines = [
            f"  - [{r.role}/{r.semantic_type}] {r.condition_id}: "
            f'"{r.rule_text}" -> {r.reason}'
            for r in self.refusals
        ]
        return "\n".join([head, *lines])


def preflight_binding_plan(
    plan,
    strategy_id: str,
    optional_condition_ids: frozenset[str] | None = None,
) -> PreflightResult:
    """Decide whether a compiled binding plan may enter execution.

    Refuses when ANY rule that resolves to MANDATORY is not bindable. This is a
    MEMBERSHIP test, deliberately not a ratio (see module docstring).

    `optional_condition_ids` is the positive-evidence set: condition ids the
    caller can affirmatively show the source treated as droppable. Default
    None/empty means NO rule is licensed to be dropped — fail closed.

    Pure: reads the plan, returns a verdict, raises nothing, mutates nothing.
    The CALLER decides what a refusal does, which keeps enforcement authority
    at the execution boundary rather than inside a reporting layer.
    """
    evidence = optional_condition_ids or frozenset()
    refusals: list[PreflightRefusal] = []
    warnings: list[dict] = []

    # Entry conditions AND invalidations: an unexecutable invalidation is a
    # missing safety/exit rule, which is mandatory by role.
    all_bindings = list(plan.bindings) + list(plan.invalidation_bindings)

    for b in all_bindings:
        if b.bindable:
            continue
        rule_class = resolve_rule_class(b.role, optional_evidence=b.condition_id in evidence)
        if blocks_execution(rule_class):
            refusals.append(
                PreflightRefusal(
                    strategy_id=strategy_id,
                    condition_id=b.condition_id,
                    rule_text=b.object,
                    semantic_type=b.type,
                    role=b.role,
                    reason=b.reason or "unbindable",
                    rule_class=rule_class,
                )
            )
        else:
            warnings.append(
                {
                    "status": OPTIONAL_NOT_APPLIED,
                    "strategy_id": strategy_id,
                    "condition_id": b.condition_id,
                    "rule_text": b.object,
                    "semantic_type": b.type,
                    "role": b.role,
                    "reason": b.reason or "unbindable",
                }
            )

    # ─── BLOCKER (ii): NO EXECUTABLE SPINE PREDICATE ───────────────────────
    # Checked at the PLAN level, not per condition, because nothing here need be
    # unbindable: a spine of EXIT_HINT rows is perfectly bindable and still
    # yields no predicate. Left unchecked, compute() falls back to the AND
    # identity and fires one unauthorized entry at bar 0.
    executable_spine = [
        b for b in plan.bindings if b.role == "spine" and b.bindable and b.executed
    ]
    if not executable_spine:
        refusals.append(
            PreflightRefusal(
                strategy_id=strategy_id,
                condition_id="",
                rule_text="<no executable spine predicate in this spec>",
                semantic_type="<plan>",
                role="spine",
                reason=NON_EXECUTABLE_EMPTY_SPINE,
                rule_class=MANDATORY,
            )
        )

    return PreflightResult(
        refused=bool(refusals),
        refusals=refusals,
        warnings=warnings,
        ratio_diagnostic={
            "spine_bound": plan.spine_bound,
            "spine_total": plan.spine_total,
            "compiled": plan.compiled,
        },
    )
