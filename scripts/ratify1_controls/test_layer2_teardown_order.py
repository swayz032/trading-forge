"""RATIFY-1 — the TEARDOWN-PHASE ORDER witness (R-822 §2 / §9[6]).

R-822 measured that the Layer 2 restore used to be a PLAIN
`pytest_runtest_teardown` implementation, so whether it ran BEFORE or AFTER
`_pytest.runner`'s finalizer pass was decided by plugin registration order and
pinned by nothing:

    AN ORDERING THAT HAPPENS TO BE CORRECT TODAY BECAUSE OF PLUGIN REGISTRATION
    ORDER IS NOT A DESIGN, IT IS A COINCIDENCE WITH A PASSING TEST.

The third ownership edge is that a fixture FINALIZER may legitimately read state
the TEST BODY created. If the boundary restores first, that finalizer silently
sees a world the test never made.

R-822 §9[6] is explicit that this is NOT dischargeable by reading the code, so
this file is the witness: a finalizer that READS test-body-created state and
FAILS if the restore preceded it.

    ARM                                          REQUIRED
    --accept5-layer2                             PASS  (restore AFTER finalizers)
    --accept5-layer2 --accept5-restore-early     RED   (restore BEFORE finalizers)

A green under the first arm alone proves nothing: an ordering that is never
exercised the wrong way has not been measured.
"""

import sys

import pytest

BODY_KEY = "_accept5_ratify1_body_created_state"


class _Marker:
    def __init__(self, tag):
        self.tag = tag


@pytest.fixture
def finalizer_that_reads_body_state():
    """Its teardown INSPECTS what the test body created.

    This is the legitimate pattern the boundary must not break -- a fixture that
    reports on, cleans up after, or audits what the test did.
    """
    yield
    # ---- teardown: runs inside pytest_runtest_teardown, and this is the exact
    #      moment whose ordering against the Layer 2 restore is being pinned.
    assert BODY_KEY in sys.modules, (
        "TEARDOWN ORDER VIOLATION: the Layer 2 restore ran BEFORE this fixture's "
        "finalizer, so the finalizer cannot see state the test body created. A "
        "fixture that audits or cleans up after its test would silently operate "
        "on a world the test never made."
    )
    assert sys.modules[BODY_KEY].tag == "created-by-the-test-body", (
        "the body-created object was replaced before the finalizer observed it"
    )


def test_body_creates_state_its_finalizer_must_still_see(
        finalizer_that_reads_body_state):
    """The assertion that matters is in the FINALIZER, not here.

    This body only has to create the state and prove it created it; the witness
    fires during teardown."""
    sys.modules[BODY_KEY] = _Marker("created-by-the-test-body")
    # POSITIVE WITNESS that the body really ran -- without it, a teardown that
    # never fired and a teardown that passed look identical.
    assert sys.modules[BODY_KEY].tag == "created-by-the-test-body"


def test_the_boundary_still_evicted_it_afterwards():
    """Containment is NOT weakened by pinning the order.

    Running the restore after the finalizers must still evict the body-created
    key before the next test -- otherwise the teardown-order fix would have
    bought correctness at the cost of [F]."""
    assert BODY_KEY not in sys.modules, (
        "the body-created key survived into the NEXT test: restoring after the "
        "finalizers must not weaken test-time containment"
    )
