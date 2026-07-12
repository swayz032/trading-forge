"""H1 tier-1 deterministic gradient detectors (extraction instrument).

Pure-stdlib, dependency-free surface-pattern detectors for the two carrying
surface classes the corpus-v3 gate-1 re-specification proved carry gate-strength
in the sentence itself (conditional-action + exclusion-contrast), alongside the
already-proven imperative family.

This package imports NOTHING heavy (no vectorbt / no engine backtester), so it is
safe to import under pytest collection on the tower per CLAUDE.md §2's vectorbt-JIT
hang caveat.

Read-order / spec: docs/designs/h1-tier1-detector-spec-2026-07-12.md
Pre-registration:   docs/designs/phase-1-h1-preregistration-2026-07-12.md
"""

from .tier1_detectors import (
    Tier1Detection,
    Tier1FallThrough,
    Tier1Result,
    detect_tier1,
    run_tier1,
    SURFACE_CLASSES,
)

__all__ = [
    "Tier1Detection",
    "Tier1FallThrough",
    "Tier1Result",
    "detect_tier1",
    "run_tier1",
    "SURFACE_CLASSES",
]
