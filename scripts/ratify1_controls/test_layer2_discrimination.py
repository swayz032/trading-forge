"""RATIFY-1 discrimination controls for Layer 2, on a THROWAWAY population.

Two obligations, each needing its boundary to be SHOWN to bite, not assumed:

  [F] test-time leak containment
      A1 writes a fake into sys.modules. A2 must NOT observe it WITH Layer 2,
      and MUST observe it WITHOUT Layer 2. If A2 cannot see it either way the
      control does not discriminate and proves nothing.

  [J] higher-scoped fixture SURVIVAL   (R-820 §3, the obligation the desk added)
      A session-scoped fixture installs a module during the first requesting
      test. A later test READS it. Ownership-aware => still there. Ownership-
      blind => evicted, and the read goes RED.

Test order within a file is definition order, which is what the arms rely on.
"""

import sys

import pytest

LEAK_KEY = "_accept5_ratify1_planted_leak"
SESSION_KEY = "_accept5_ratify1_session_owned"


class _Marker:
    def __init__(self, tag):
        self.tag = tag


# ---------------------------------------------------------------------------
# [J] the higher-scoped fixture whose state must SURVIVE the boundary
# ---------------------------------------------------------------------------
@pytest.fixture(scope="session")
def session_installed_module():
    """Installs a module key at first use -- i.e. INSIDE the first requesting
    test's SETUP phase, which is exactly why a presence-based boundary mistakes
    it for 'created during the test'."""
    sys.modules[SESSION_KEY] = _Marker("session-owned")
    yield sys.modules[SESSION_KEY]
    sys.modules.pop(SESSION_KEY, None)


# ---------------------------------------------------------------------------
# [F] arm -- A1 pollutes, A2 observes (or does not)
# ---------------------------------------------------------------------------
def test_a1_plants_a_test_time_leak():
    sys.modules[LEAK_KEY] = _Marker("leaked-from-a1")
    # POSITIVE WITNESS that the plant really happened; without this, a later
    # "did not observe" is satisfied by a plant that never ran.
    assert sys.modules[LEAK_KEY].tag == "leaked-from-a1"


def test_a2_reports_whether_it_observed_a1s_leak():
    """WITH Layer 2 this must pass. WITHOUT Layer 2 it must FAIL.

    Written as an assertion about containment so the WITHOUT arm is a real RED,
    not a skip."""
    assert LEAK_KEY not in sys.modules, (
        "LAYER 2 ABSENT OR INEFFECTIVE: test A2 can observe the sys.modules key "
        "planted by test A1, so test-time pollution crosses tests inside one child"
    )


# ---------------------------------------------------------------------------
# [J] arm -- first requesting test, then a later reader
# ---------------------------------------------------------------------------
def test_j1_first_test_to_request_the_session_fixture(session_installed_module):
    assert session_installed_module.tag == "session-owned"
    assert sys.modules.get(SESSION_KEY) is session_installed_module


def test_j2_filler_between_the_installer_and_the_reader():
    # Exists so the boundary runs at least once between install and read; a
    # boundary that only ever runs at the very end would pass j3 vacuously.
    assert True


def test_j3_later_test_READS_the_session_owned_state(session_installed_module):
    """THE [J] WITNESS. Ownership-aware => PASS. Ownership-blind => RED.

    It READS the state rather than asserting a fixture 'ran', because a disabled
    fixture and a working one both look green until something reads what it
    installed."""
    assert SESSION_KEY in sys.modules, (
        "OWNERSHIP-BLIND BOUNDARY: the session-scoped fixture's module was evicted "
        "by the isolation layer, so a later test runs without the state the fixture "
        "exists to provide -- the fixture still reported success"
    )
    assert sys.modules[SESSION_KEY] is session_installed_module, (
        "the session-owned module key was replaced by a different object"
    )
