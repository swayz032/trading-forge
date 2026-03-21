"""Cross-Validator — gates new concepts from n8n/Ollama pipeline.

When n8n/Ollama proposes a strategy claiming to be an ICT concept:
1. If we have a spec → validate against it (static + runtime)
2. If we DON'T have a spec → queue for research, don't execute

This prevents hallucinated concept implementations from entering production.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from src.engine.validation import ConceptSpec, ValidationResult, load_spec, SPECS_DIR


@dataclass
class CrossValidationResult:
    """Result of cross-validating a concept against our spec library."""
    concept: str
    has_spec: bool
    requires_research: bool = False
    validation_result: ValidationResult | None = None
    message: str = ""


def cross_validate_concept(
    concept_name: str,
    proposed_rules: list[str] | None = None,
) -> CrossValidationResult:
    """Check if a concept has been cross-validated and has a spec.

    Args:
        concept_name: The ICT concept name (e.g., "silver_bullet")
        proposed_rules: Optional list of rules the strategy claims to implement

    Returns:
        CrossValidationResult indicating whether the concept is known/validated
    """
    # Normalize name
    normalized = concept_name.lower().replace(" ", "_").replace("-", "_")

    # Check if spec exists
    spec_path = SPECS_DIR / f"{normalized}.yaml"
    if not spec_path.exists():
        return CrossValidationResult(
            concept=normalized,
            has_spec=False,
            requires_research=True,
            message=f"Concept '{normalized}' has no cross-validated spec. "
            f"Queued for research — will not execute until spec exists.",
        )

    # Spec exists — load it
    spec = load_spec(normalized)

    # If proposed_rules provided, check them against spec
    if proposed_rules:
        missing = []
        for required in spec.required_concepts:
            if not any(required.lower() in rule.lower() for rule in proposed_rules):
                missing.append(required)

        if missing:
            return CrossValidationResult(
                concept=normalized,
                has_spec=True,
                requires_research=False,
                validation_result=ValidationResult(
                    passed=False,
                    errors=[f"Missing required concepts: {missing}"],
                ),
                message=f"Concept '{normalized}' spec found but proposed rules "
                f"don't cover: {missing}",
            )

    return CrossValidationResult(
        concept=normalized,
        has_spec=True,
        requires_research=False,
        validation_result=ValidationResult(passed=True),
        message=f"Concept '{normalized}' has cross-validated spec. Ready for validation.",
    )


def get_unvalidated_concepts() -> list[str]:
    """Return concepts referenced in strategies that don't have specs yet.

    Used by nightly n8n flow to queue research tasks.
    """
    from src.engine.validation import STRATEGY_CONCEPT_MAP

    unvalidated = []
    for strategy_name, concept in STRATEGY_CONCEPT_MAP.items():
        spec_path = SPECS_DIR / f"{concept}.yaml"
        if not spec_path.exists():
            unvalidated.append(concept)
    return unvalidated
