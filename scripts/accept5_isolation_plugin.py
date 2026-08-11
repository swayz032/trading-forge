"""ACCEPT-5 RATIFY-1 Layer 2 — a runner-owned, OWNERSHIP-AWARE per-test
`sys.modules` restoration boundary.

Layer 1 (one pytest subprocess per governed file) contains COLLECTION-TIME
pollution: file A's module-level `sys.modules` writes die with A's interpreter.
This plugin is Layer 2 and contains TEST-TIME pollution inside a single child:
test A1 must not be able to change what test A2 observes.

────────────────────────────────────────────────────────────────────────────
WHY THE OBVIOUS IMPLEMENTATION IS WRONG  (R-820 §3, obligation [J])
────────────────────────────────────────────────────────────────────────────
The prescribed boundary was *"snapshot before the test; on teardown restore
pre-existing keys and REMOVE entries created during the test."*  That is
PRESENCE-aware, and presence is not ownership.

A session/module/package-scoped fixture's setup executes inside the *first
requesting test's* setup phase.  To a snapshot taken before that test, the keys
it installs look exactly like "created during the test" — so a presence-based
boundary DELETES them.  The fixture then reports success while every later test
in that child runs without the state the fixture exists to provide.  `[MEASURED,
R-820 §3]` 9 non-function-scoped fixtures across 5 files are exposed to this.

    AN ISOLATION LAYER CANNOT TELL A LEAK FROM A FIXTURE DOING ITS JOB — BOTH
    ARE "A KEY THAT WAS NOT THERE BEFORE". THE DISCRIMINATOR IS OWNERSHIP AND
    LIFETIME, NEVER PRESENCE.

────────────────────────────────────────────────────────────────────────────
THE DISCRIMINATOR THIS PLUGIN USES
────────────────────────────────────────────────────────────────────────────
Bound the boundary to the CALL phase, not to the whole test item:

    setup phase   -> fixtures of EVERY scope run here.  Their writes land in the
                     baseline and are therefore NEVER evicted.  A session-scoped
                     fixture that installs a module during test 1 survives to
                     test N.  ([J])
    call phase    -> the test BODY.  Anything it adds to sys.modules is evicted
                     when the body returns, and anything it replaced is restored
                     to the SAME OBJECT IDENTITY.  ([F])
    teardown      -> untouched; fixture finalizers own their own cleanup.

So "owned by this test" means "created by this test's own body", which is a
lifetime statement, not a presence statement.

`--accept5-ownership-blind` deliberately reinstates the broken presence-based
behaviour.  It exists so obligation [J] has a NEGATIVE control: the [J] witness
must go RED under it and GREEN without it.  A boundary that has never been shown
to destroy something is not a boundary anybody has measured.
"""

from __future__ import annotations

import sys


def pytest_addoption(parser):
    group = parser.getgroup("accept5-isolation")
    group.addoption(
        "--accept5-layer2",
        action="store_true",
        default=False,
        help="Enable the ownership-aware per-test sys.modules boundary (Layer 2).",
    )
    group.addoption(
        "--accept5-ownership-blind",
        action="store_true",
        default=False,
        help=(
            "NEGATIVE CONTROL ONLY. Snapshot at SETUP start instead of CALL start, "
            "reinstating the presence-based boundary that evicts higher-scoped "
            "fixture state. Obligation [J]'s witness must go RED under this."
        ),
    )


class _Boundary:
    """Records what the boundary did, so a green run is not the only evidence."""

    def __init__(self):
        self.restored_identity = 0
        self.evicted_created = 0
        self.tests_bounded = 0


def pytest_configure(config):
    config._accept5_boundary = _Boundary()
    if config.getoption("--accept5-layer2"):
        config.pluginmanager.register(_Layer2(config), "accept5-layer2")


class _Layer2:
    def __init__(self, config):
        self._config = config
        self._blind = config.getoption("--accept5-ownership-blind")
        self._snapshot = None
        self._stats = config._accept5_boundary

    # ---- snapshot points -------------------------------------------------
    def _take(self):
        # A shallow copy of the mapping: keys plus the exact objects bound to
        # them. Identity is what matters -- a module re-imported to an equal but
        # DIFFERENT object is still a swap.
        self._snapshot = dict(sys.modules)

    def _restore(self):
        if self._snapshot is None:
            return
        before = self._snapshot
        self._snapshot = None
        # (1) evict keys this boundary owns: absent before, present now.
        for key in [k for k in sys.modules if k not in before]:
            del sys.modules[key]
            self._stats.evicted_created += 1
        # (2) restore pre-existing keys to the SAME OBJECT IDENTITY. `is`, never
        #     `==` -- a MagicMock compares equal to a great many things.
        for key, obj in before.items():
            if sys.modules.get(key) is not obj:
                sys.modules[key] = obj
                self._stats.restored_identity += 1
        self._stats.tests_bounded += 1

    # ---- hooks -----------------------------------------------------------
    # OWNERSHIP-AWARE (default): the baseline is taken AFTER setup, so every
    # fixture's writes -- at any scope -- are already in it and survive.
    def pytest_runtest_call(self, item):
        if not self._blind:
            self._take()

    # PRESENCE-BASED (negative control): the baseline is taken BEFORE setup, so
    # a higher-scoped fixture's first-use installation looks "created during the
    # test" and gets evicted. This is the shape [J] exists to refute.
    def pytest_runtest_setup(self, item):
        if self._blind:
            self._take()

    def pytest_runtest_teardown(self, item, nextitem):
        # Both modes release here. In ownership-aware mode the snapshot was taken
        # at call start, so fixture setup is protected; in blind mode it was
        # taken at setup start, so it is not.
        self._restore()


def pytest_terminal_summary(terminalreporter, exitstatus, config):
    st = getattr(config, "_accept5_boundary", None)
    if st is None or not config.getoption("--accept5-layer2"):
        return
    mode = "OWNERSHIP-BLIND (NEGATIVE CONTROL)" if config.getoption(
        "--accept5-ownership-blind") else "ownership-aware"
    # A positive witness that the boundary RAN. An absence claim needs one:
    # "nothing leaked" and "the boundary never executed" look identical.
    terminalreporter.write_line(
        f"[ACCEPT5-LAYER2] mode={mode} tests_bounded={st.tests_bounded} "
        f"keys_evicted={st.evicted_created} identities_restored={st.restored_identity}"
    )
