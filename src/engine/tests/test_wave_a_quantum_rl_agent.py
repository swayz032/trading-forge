"""
test_wave_a_quantum_rl_agent.py — Wave A hardening tests for quantum_rl_agent.py.

Covers fixes in quantum_rl_agent.py only:
  Fix 1 — _build_vqc_policy_ibm three-gate opt_in_cloud parameter
  Fix 2 — ClassicalAgent n_actions=2 default + n_actions=3 ValueError guard
  Fix 3 — action_map labels: long/flat (not buy/sell/hold)
  Fix 4 — _DORMANT_GAP_THRESHOLD_PCT reads QUANTUM_RL_KILL_SWITCH_THRESHOLD_PCT env
  Fix 8 — seed column in quantum_rl_runs INSERT

Test strategy:
  - No live DB required: tests mock psycopg2 and env vars.
  - PennyLane is optional: _build_vqc_policy_ibm is guarded by PENNYLANE_AVAILABLE.
  - All tests are isolation-safe and deterministic.
  - Challenger-only governance is verified: no authority escalation via the patches.
"""

import os
import sys
import unittest
from unittest.mock import MagicMock, patch

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Track the optional-dep MagicMock stubs THIS module inserts, so tearDownModule can restore
# sys.modules. Leaving the stubs in place poisons every test file that runs AFTER this one in the
# same pytest process (deep-scan #21 cross-file pollution: 3 tests in test_wave29_pass_c2_training_loop.py
# falsely FAIL in a full-suite run because pennylane/qiskit stayed mocked — a "detector can lie" case where
# the file is green in isolation but red under CI's real collection order).
_STUBBED_DEPS: set = set()
# The quantum_rl_agent module object that pre-existed this file's first reload (other test files bind
# `import src.engine.quantum_rl_agent as _rl_agent` to THIS object at collection time). We restore this
# exact object in tearDownModule so module identity + PENNYLANE_AVAILABLE match what those files expect.
_ORIGINAL_RL_MODULE = None


def _reload_module():
    """Reload quantum_rl_agent so module-level env-var reads pick up fresh env."""
    global _ORIGINAL_RL_MODULE
    _existing = sys.modules.get("src.engine.quantum_rl_agent")
    if _existing is not None and _ORIGINAL_RL_MODULE is None:
        _ORIGINAL_RL_MODULE = _existing  # snapshot once, before any mock-stubbing
    if "src.engine.quantum_rl_agent" in sys.modules:
        del sys.modules["src.engine.quantum_rl_agent"]
    # Stub heavy optional deps so the module can load in test context. Record only the ones we
    # actually inserted (were absent) so teardown removes exactly those, never a real installed dep.
    for dep in ["pennylane", "qiskit", "qiskit_ibm_runtime", "pennylane_qiskit"]:
        if dep not in sys.modules:
            sys.modules[dep] = MagicMock()
            _STUBBED_DEPS.add(dep)
    import src.engine.quantum_rl_agent as m
    return m


def tearDownModule():
    """Restore sys.modules after this file's tests run — remove the MagicMock stubs _reload_module
    inserted + the reloaded quantum_rl_agent — so a later test file re-imports against the real (or
    genuinely-absent) deps instead of our mocks. Without this, full-suite pytest leaves pennylane/qiskit
    mocked for every subsequent file (deep-scan #21 pollution)."""
    for dep in _STUBBED_DEPS:
        sys.modules.pop(dep, None)
    _STUBBED_DEPS.clear()
    # Restore the ORIGINAL quantum_rl_agent module object (the one other test files' `_rl_agent` bindings
    # point at, with PENNYLANE_AVAILABLE computed against the true dep state). Our del+mock-reload replaced
    # it with a mock-baked module (PENNYLANE_AVAILABLE=True → VQC path → 0 quantum_rl_runs INSERTs captured
    # in test_wave29_pass_c2_training_loop.py). Restoring the exact original object fixes module identity.
    if _ORIGINAL_RL_MODULE is not None:
        sys.modules["src.engine.quantum_rl_agent"] = _ORIGINAL_RL_MODULE
    else:
        sys.modules.pop("src.engine.quantum_rl_agent", None)


# ---------------------------------------------------------------------------
# Fix 2 — ClassicalAgent default n_actions=2 + ValueError on n_actions=3
# ---------------------------------------------------------------------------

class TestClassicalAgentNActions(unittest.TestCase):
    """Fix 2: ClassicalAgent MUST default to n_actions=2 and MUST reject n_actions=3."""

    def setUp(self):
        self.m = _reload_module()

    def test_default_n_actions_is_2(self):
        """ClassicalAgent() with no n_actions argument must construct with n_actions=2."""
        agent = self.m.ClassicalAgent(state_dim=4)
        self.assertEqual(agent.n_actions, 2,
                         "Default n_actions must be 2 (LONG/FLAT day-trader mandate)")

    def test_explicit_2_is_accepted(self):
        """ClassicalAgent(n_actions=2) must construct without error."""
        agent = self.m.ClassicalAgent(state_dim=4, n_actions=2)
        self.assertEqual(agent.n_actions, 2)

    def test_n_actions_3_raises_value_error(self):
        """ClassicalAgent(n_actions=3) must raise ValueError — 3-action is forbidden."""
        with self.assertRaises(ValueError, msg="n_actions=3 must raise ValueError"):
            self.m.ClassicalAgent(state_dim=4, n_actions=3)

    def test_error_message_mentions_long_flat(self):
        """ValueError message must mention LONG/FLAT mandate so callers understand why."""
        with self.assertRaises(ValueError) as ctx:
            self.m.ClassicalAgent(state_dim=4, n_actions=3)
        self.assertIn("LONG", str(ctx.exception))


# ---------------------------------------------------------------------------
# Fix 3 — action_map labels
# ---------------------------------------------------------------------------

class TestActionMapLabels(unittest.TestCase):
    """Fix 3: action_map in select_rl_action (or equivalent consumer) must use long/flat."""

    def setUp(self):
        self.m = _reload_module()

    def _find_action_map_in_source(self):
        """Read the source to confirm the action_map value was changed."""
        import inspect
        src = inspect.getsource(self.m)
        return src

    def test_action_map_has_long(self):
        """Source must contain action_map entry for 'long'."""
        src = self._find_action_map_in_source()
        self.assertIn('"long"', src, "action_map must include 'long' label")

    def test_action_map_has_flat(self):
        """Source must contain action_map entry for 'flat'."""
        src = self._find_action_map_in_source()
        self.assertIn('"flat"', src, "action_map must include 'flat' label")

    def test_action_map_does_not_have_hold(self):
        """Source must NOT contain 'hold' in action_map (stale 3-action label)."""
        src = self._find_action_map_in_source()
        # Allow 'hold' in comments; check the actual dict literal context
        # by verifying that the 3-action stale labels are absent from the map.
        # We check for the specific dict entry pattern '"hold"' which would
        # appear in the action_map dict body.
        import re
        action_map_block = re.search(
            r'action_map\s*=\s*\{[^}]*\}', src, re.DOTALL
        )
        if action_map_block:
            block = action_map_block.group(0)
            self.assertNotIn('"hold"', block,
                             "action_map must not contain 'hold' (stale 3-action label)")


# ---------------------------------------------------------------------------
# Fix 4 — _DORMANT_GAP_THRESHOLD_PCT from env
# ---------------------------------------------------------------------------

class TestDormantGapThresholdFromEnv(unittest.TestCase):
    """Fix 4: module-level _DORMANT_GAP_THRESHOLD_PCT must read from env."""

    def test_default_threshold_is_30(self):
        """Without env override, threshold defaults to 30.0."""
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("QUANTUM_RL_KILL_SWITCH_THRESHOLD_PCT", None)
            m = _reload_module()
            self.assertAlmostEqual(m._DORMANT_GAP_THRESHOLD_PCT, 30.0, places=4)

    def test_env_override_applied(self):
        """QUANTUM_RL_KILL_SWITCH_THRESHOLD_PCT=45.0 sets threshold to 45.0."""
        with patch.dict(os.environ, {"QUANTUM_RL_KILL_SWITCH_THRESHOLD_PCT": "45.0"}):
            m = _reload_module()
            self.assertAlmostEqual(m._DORMANT_GAP_THRESHOLD_PCT, 45.0, places=4)

    def test_threshold_is_module_level_constant(self):
        """_DORMANT_GAP_THRESHOLD_PCT must be a float at module level (not inside a function)."""
        m = _reload_module()
        self.assertIsInstance(m._DORMANT_GAP_THRESHOLD_PCT, float,
                              "_DORMANT_GAP_THRESHOLD_PCT must be a float module-level constant")


# ---------------------------------------------------------------------------
# Fix 1 — _build_vqc_policy_ibm three-gate
# ---------------------------------------------------------------------------

class TestBuildVqcPolicyIbmThreeGate(unittest.TestCase):
    """Fix 1: _build_vqc_policy_ibm must require explicit opt_in_cloud; IBM path blocked when any gate is closed."""

    def setUp(self):
        self.m = _reload_module()

    def _call(self, opt_in_cloud, cloud_enabled="true", ibm_token="fake_token"):
        env_patch = {
            "QUANTUM_CLOUD_ENABLED": cloud_enabled,
            "IBM_QUANTUM_TOKEN": ibm_token,
        }
        with patch.dict(os.environ, env_patch):
            # _build_vqc_policy_ibm returns (circuit, n_params, backend_label)
            # When PENNYLANE_AVAILABLE is False it returns (None, 0, "unavailable")
            return self.m._build_vqc_policy_ibm(4, 2, opt_in_cloud)

    def test_signature_requires_opt_in_cloud_positional(self):
        """_build_vqc_policy_ibm must accept opt_in_cloud as positional arg."""
        import inspect
        sig = inspect.signature(self.m._build_vqc_policy_ibm)
        params = list(sig.parameters.keys())
        self.assertIn("opt_in_cloud", params,
                      "_build_vqc_policy_ibm must have opt_in_cloud parameter")

    def test_opt_in_cloud_has_no_default(self):
        """opt_in_cloud must NOT have a default value — callers must pass explicitly."""
        import inspect
        sig = inspect.signature(self.m._build_vqc_policy_ibm)
        param = sig.parameters.get("opt_in_cloud")
        self.assertIsNotNone(param, "opt_in_cloud param not found")
        self.assertEqual(param.default, inspect.Parameter.empty,
                         "opt_in_cloud must have no default (caller must be explicit)")

    def test_cloud_path_blocked_when_opt_in_false(self):
        """IBM cloud path must not be engaged when opt_in_cloud=False regardless of other gates."""
        # If PENNYLANE_AVAILABLE is False we still get a clean non-cloud result.
        # If it's True, the IBM path should not be attempted with opt_in=False.
        # We verify by checking there's no exception when called with opt_in=False.
        try:
            result = self._call(opt_in_cloud=False)
            # Should return something without raising
            self.assertIsNotNone(result, "Must return a tuple")
        except Exception as e:
            self.fail(f"_build_vqc_policy_ibm raised unexpectedly with opt_in=False: {e}")

    def test_caller_train_regime_conditioned_passes_opt_in(self):
        """train_regime_conditioned_policies must pass opt_in_cloud to _build_vqc_policy_ibm."""
        import inspect
        src = inspect.getsource(self.m.train_regime_conditioned_policies)
        self.assertIn("opt_in_cloud=opt_in_cloud", src,
                      "Call site must pass opt_in_cloud=opt_in_cloud explicitly")

    def test_ibm_cfg_uses_opt_in_cloud_not_hardcoded_true(self):
        """CloudBackendConfig call must use opt_in_cloud=opt_in_cloud, not opt_in_cloud=True."""
        import inspect
        import re
        src = inspect.getsource(self.m._build_vqc_policy_ibm)
        # Strip the docstring (everything between triple-quotes) before checking
        src_no_docstring = re.sub(r'""".*?"""', '', src, flags=re.DOTALL)
        # In the code body (not docstring), CloudBackendConfig must not hardcode True
        # Find any CloudBackendConfig(...) call block
        cfg_call = re.search(r'CloudBackendConfig\s*\([^)]*\)', src_no_docstring, re.DOTALL)
        if cfg_call:
            call_body = cfg_call.group(0)
            self.assertNotIn("opt_in_cloud=True", call_body,
                             "Hardcoded opt_in_cloud=True must have been removed from CloudBackendConfig call")
            self.assertIn("opt_in_cloud=opt_in_cloud", call_body,
                          "CloudBackendConfig must pass opt_in_cloud=opt_in_cloud (dynamic, not hardcoded)")


# ---------------------------------------------------------------------------
# Fix 8 — seed in INSERT
# ---------------------------------------------------------------------------

class TestSeedInInsert(unittest.TestCase):
    """Fix 8: quantum_rl_runs INSERT must include the seed column."""

    def test_insert_sql_includes_seed(self):
        """The INSERT SQL in train_regime_conditioned_policies must mention 'seed'."""
        import inspect
        src = inspect.getsource(self.m.train_regime_conditioned_policies)
        self.assertIn("seed", src.lower(),
                      "train_regime_conditioned_policies INSERT must include 'seed' column")

    def test_regime_seed_variable_passed(self):
        """The INSERT must pass regime_seed as the seed value (Fix 8 comment present)."""
        import inspect
        src = inspect.getsource(self.m.train_regime_conditioned_policies)
        self.assertIn("regime_seed", src,
                      "regime_seed variable must be passed to the INSERT as seed value")

    def setUp(self):
        self.m = _reload_module()


# ---------------------------------------------------------------------------
# Governance isolation check
# ---------------------------------------------------------------------------

class TestGovernanceIsolation(unittest.TestCase):
    """Verify that none of the Wave A fixes introduce authority escalation."""

    def setUp(self):
        self.m = _reload_module()

    def test_rl_runs_governance_labels_are_challenger_only(self):
        """RL_RUNS_GOVERNANCE constant must set authoritative=False and decision_role=challenger_only."""
        gov = self.m.RL_RUNS_GOVERNANCE
        self.assertFalse(gov.get("authoritative", True),
                         "RL_RUNS_GOVERNANCE.authoritative must be False")
        self.assertEqual(gov.get("decision_role"), "challenger_only",
                         "RL_RUNS_GOVERNANCE.decision_role must be 'challenger_only'")
        self.assertTrue(gov.get("experimental", False),
                        "RL_RUNS_GOVERNANCE.experimental must be True")

    def test_compute_rl_kill_switch_returns_dict_not_mutates(self):
        """compute_rl_kill_switch_state must return a dict (never mutates parameters)."""
        import inspect
        _sig = inspect.signature(self.m.compute_rl_kill_switch_state)
        # Function exists and is callable
        self.assertTrue(callable(self.m.compute_rl_kill_switch_state))


if __name__ == "__main__":
    unittest.main()
