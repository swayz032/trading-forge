"""Static Validator — AST-based checks against concept specs.

Parses Python source with ast.parse() and validates:
1. Required imports present
2. Forbidden imports absent
3. Time window references (numeric literals in comparisons)
"""

from __future__ import annotations

import ast
from pathlib import Path

from src.engine.validation import ConceptSpec, ValidationResult


def _extract_imports(tree: ast.Module) -> set[str]:
    """Extract all imported names from an AST."""
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            if node.names:
                for alias in node.names:
                    names.add(alias.name)
            if node.module:
                # Also add the last part of the module path
                parts = node.module.split(".")
                names.add(parts[-1])
        elif isinstance(node, ast.Import):
            for alias in node.names:
                parts = alias.name.split(".")
                names.add(parts[-1])
    return names


def _extract_numeric_literals(tree: ast.Module) -> set[int | float]:
    """Extract all numeric literals used in comparisons and assignments."""
    nums: set[int | float] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            nums.add(node.value)
    return nums


def _extract_string_literals(tree: ast.Module) -> set[str]:
    """Extract all string literals."""
    strings: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            strings.add(node.value)
    return strings


def _check_time_windows(
    tree: ast.Module, spec: ConceptSpec
) -> tuple[list[str], list[str]]:
    """Check if required time windows are referenced in the code."""
    errors: list[str] = []
    warnings: list[str] = []

    if not spec.required_time_windows:
        return errors, warnings

    nums = _extract_numeric_literals(tree)
    strings = _extract_string_literals(tree)
    imports = _extract_imports(tree)

    for tw in spec.required_time_windows:
        start_h = int(tw.start.split(":")[0])
        end_h = int(tw.end.split(":")[0])

        # Check if the hour boundaries are referenced (as numbers or via imports)
        has_start = start_h in nums
        has_end = end_h in nums

        # Also check if dedicated session functions are imported
        has_session_func = any(
            name in imports
            for name in [
                f"is_silver_bullet_nyam",
                f"is_silver_bullet_nypm",
                f"is_silver_bullet_london",
                tw.start.replace(":", ""),
            ]
        )

        if not (has_start or has_session_func):
            warnings.append(
                f"Time window {tw.label or tw.start + '-' + tw.end} "
                f"(hour {start_h}) not clearly referenced in code"
            )

    return errors, warnings


def validate_static(source_path: str, spec: ConceptSpec) -> ValidationResult:
    """Validate a strategy source file against its concept spec.

    Args:
        source_path: Path to the .py file
        spec: The concept specification to validate against

    Returns:
        ValidationResult with pass/fail + error details
    """
    path = Path(source_path)
    if not path.exists():
        return ValidationResult(passed=False, errors=[f"File not found: {source_path}"])

    code = path.read_text(encoding="utf-8")
    return validate_static_from_code(code, spec)


def validate_static_from_code(code: str, spec: ConceptSpec) -> ValidationResult:
    """Validate raw Python code against its concept spec.

    Used for validating code from n8n/Ollama before it's saved to a file.

    Args:
        code: Python source code string
        spec: The concept specification to validate against

    Returns:
        ValidationResult with pass/fail + error details
    """
    errors: list[str] = []
    warnings: list[str] = []

    # Parse the AST
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return ValidationResult(passed=False, errors=[f"Syntax error: {e}"])

    imports = _extract_imports(tree)

    # 1. Check required imports (ALL must be present)
    for req in spec.required_imports:
        if req not in imports:
            errors.append(f"Missing required import: '{req}' (concept: {spec.concept})")

    # 2. Check required_imports_any (at least ONE must be present)
    if spec.required_imports_any:
        found_any = any(name in imports for name in spec.required_imports_any)
        if not found_any:
            errors.append(
                f"Must import at least one of: {spec.required_imports_any} "
                f"(concept: {spec.concept})"
            )

    # 3. Check forbidden imports
    for forbidden in spec.forbidden_imports:
        if forbidden in imports:
            errors.append(
                f"Forbidden import found: '{forbidden}' — not part of {spec.concept} concept"
            )

    # 4. Check multi-instrument requirement
    if spec.multi_instrument:
        # Check for compute_multi method or dict parameter pattern
        has_multi = False
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef) and node.name == "compute_multi":
                has_multi = True
                break
        if not has_multi:
            warnings.append(
                f"Multi-instrument strategy should implement compute_multi() "
                f"instead of compute()"
            )

    # 5. Check time window references
    tw_errors, tw_warnings = _check_time_windows(tree, spec)
    errors.extend(tw_errors)
    warnings.extend(tw_warnings)

    passed = len(errors) == 0
    return ValidationResult(passed=passed, errors=errors, warnings=warnings)
