"""Bind the replay-lab CI gate to the generator that feeds it.

Phase 0 item 2 of the engineering plan. The gate had been red since 2026-08-20 23:58,
when commit e5dca546 renamed the generator's review status from
TRADER_FIDELITY_CALIBRATION_* to AUTOMATED_FIDELITY_REGRESSION_* and did not update the
workflow reading it. Same shape as the premarket test retired in 60878ce3: a correction
wave landed, the assertion downstream of it did not, and the seat died before catching up.

The rename is semantic. The operator closed manual replay collection, so the pack is a
machine regression artifact and no longer a request for trader labelling work - which is
why the fix is to update the gate, not to revert the generator.

Measured before touching the gate: the generator was run locally and SIX of its SEVEN
assertions already passed. Only the status string failed. Nothing was hiding behind it.

This test exists so the two sides cannot drift again. It reads the workflow YAML as text
and binds it to the generator's own constants, so a rename on EITHER side reds.
"""
from __future__ import annotations

import io
import re

import pytest

from research.current_mnq_strategy_v2_4_replay_lab_v3_calibration_generate import (
    RECEIPT_STATUS,
    REVIEW_STATUS,
)

WORKFLOW = ".github/workflows/current-mnq-strategy-v2-4-replay-lab.yml"


@pytest.fixture(scope="module")
def workflow() -> str:
    return io.open(WORKFLOW, encoding="utf-8").read()


def test_the_gate_expects_the_status_the_generator_actually_emits(workflow):
    """The defect this closes: the gate demanded a string that existed in exactly one
    place in the repository - the gate itself."""
    m = re.search(r"if review\['status'\] != '([A-Z_]+)':", workflow)
    assert m, "the review-status gate is no longer in the workflow at all"
    assert m.group(1) == REVIEW_STATUS, (
        f"the CI gate expects {m.group(1)!r} but the generator emits {REVIEW_STATUS!r}. "
        f"One side was renamed without the other. This is exactly how the gate spent a day "
        f"red."
    )


def test_no_pre_correction_status_vocabulary_survives_anywhere(workflow):
    """The retired name must not linger in the gate. Enumerated, not spot-checked."""
    assert "TRADER_FIDELITY_CALIBRATION_MOMENTUM_HEAVY_BILATERAL_CONTEXT" not in workflow
    assert REVIEW_STATUS.startswith("AUTOMATED_FIDELITY_REGRESSION"), (
        "the status must name this a machine regression, not trader calibration - the "
        "operator closed manual replay collection"
    )
    assert RECEIPT_STATUS.startswith("AUTOMATED_FIDELITY_REGRESSION")


def test_the_generator_is_the_single_source_of_both_status_strings():
    """Positive control on the binding: the constants must be real module attributes,
    not a second copy of the literal living in this test."""
    import research.current_mnq_strategy_v2_4_replay_lab_v3_calibration_generate as gen

    src = io.open(gen.__file__, encoding="utf-8").read()
    # The literal may appear only where the constants are DEFINED, never re-typed at a
    # use site - that is what let the two sides drift in the first place.
    assert src.count('"' + REVIEW_STATUS + '"') == 1, (
        "the review status literal is written more than once in the generator"
    )
    assert src.count('"' + RECEIPT_STATUS + '"') == 1
    assert 'review["status"] = REVIEW_STATUS' in src
    assert '"status": RECEIPT_STATUS,' in src
