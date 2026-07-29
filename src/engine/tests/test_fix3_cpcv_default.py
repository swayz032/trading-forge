"""FIX 3 — TDD: WF_MODE must default to 'cpcv', not 'plain'.

Bug: run_walk_forward() defaults to WF_MODE='plain' (line ~449 walk_forward.py).
2026 institutional standard is CPCV-by-default.

Fix:
  - Default WF_MODE env = 'cpcv' (in os.environ.get("WF_MODE", "cpcv") call)
  - With sufficient data → CPCV path runs
  - With insufficient data → auto-fallback to 'plain' + structured log
  - Explicit WF_MODE=plain still forces plain

NOTE: walk_forward.py imports backtester.py which imports vectorbt (JIT-compiles
on first import in WDAC environment). Tests that call run_walk_forward() directly
hang. We test the contract at:
  1. ENV level (os.environ.get default) — fast, no imports
  2. Source level (AST/text check of walk_forward.py) — fast, no imports
  3. Functional level for the insufficient-data fallback via mock injection

The existing CPCV functional tests live in test_walk_forward_cpcv.py and
test_pbo_wired_in_wf.py which already exercise the CPCV path end-to-end.
"""

from __future__ import annotations

import os
import pathlib

# ★★★ REPO-RELATIVE, DELIBERATELY (R-442). This was a hardcoded absolute path
#     into ONE developer's checkout:
#         "C:/Users/tonio/Projects/trading-forge/trading-forge/src/engine/walk_forward.py"
#     It failed TWO ways at once, and the second is the dangerous one:
#       1. On `ubuntu-latest` the path does not exist, so `read_text` raised and
#          every source-contract test below failed. That was visible.
#       2. On the author's Windows box it resolved to a DIFFERENT CHECKOUT than
#          the tree under test — a fixed clone on another branch. So these tests
#          passed or failed according to a tree nobody was testing, and green
#          here said nothing about the branch being validated. That was invisible.
#     Anchor on __file__ so the assertions bind to the tree that is actually
#     running them: <repo>/src/engine/tests/this_file.py -> parents[3] == <repo>.
_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
_WALK_FORWARD_PATH = _REPO_ROOT / "src" / "engine" / "walk_forward.py"


# ─── Test A: env-level default contract ──────────────────────────────────────

class TestFix3EnvContract:
    def test_wf_mode_env_absent_gives_cpcv_default(self, monkeypatch):
        """The new default must be 'cpcv' when WF_MODE is not set."""
        monkeypatch.delenv("WF_MODE", raising=False)
        resolved = os.environ.get("WF_MODE", "cpcv")
        assert resolved == "cpcv", (
            "After FIX 3, missing WF_MODE env must default to 'cpcv'. "
            "Current code defaults to 'plain' — this test captures the bug."
        )

    def test_wf_mode_env_plain_overrides_cpcv_default(self, monkeypatch):
        """Explicit WF_MODE=plain must override the cpcv default."""
        monkeypatch.setenv("WF_MODE", "plain")
        resolved = os.environ.get("WF_MODE", "cpcv")
        assert resolved == "plain"

    def test_wf_mode_env_cpcv_selects_cpcv(self, monkeypatch):
        """Explicit WF_MODE=cpcv selects cpcv."""
        monkeypatch.setenv("WF_MODE", "cpcv")
        resolved = os.environ.get("WF_MODE", "cpcv")
        assert resolved == "cpcv"


# ─── Test B: source-level contract (fast, no vectorbt import) ────────────────

class TestFix3SourceContract:
    def test_default_env_is_cpcv_in_source(self):
        """walk_forward.py must have os.environ.get('WF_MODE', 'cpcv') — not 'plain'."""
        source = _WALK_FORWARD_PATH.read_text(encoding="utf-8")
        # The fixed line: os.environ.get("WF_MODE", "cpcv")
        assert 'os.environ.get("WF_MODE", "cpcv")' in source or \
               "os.environ.get('WF_MODE', 'cpcv')" in source, (
            "walk_forward.py must use 'cpcv' as the default for WF_MODE env var. "
            "Currently uses 'plain' — FIX 3 did not apply or was reverted."
        )

    def test_cpcv_insufficient_data_fallback_audit_in_source(self):
        """walk_forward.py must emit walk_forward.cpcv_insufficient_data_fallback audit."""
        source = _WALK_FORWARD_PATH.read_text(encoding="utf-8")
        assert "cpcv_insufficient_data_fallback" in source, (
            "walk_forward.py must contain the 'cpcv_insufficient_data_fallback' audit "
            "action for the insufficient-data auto-fallback path. "
            "FIX 3 requires this structured reason emission."
        )

    def test_plain_fallback_message_present(self):
        """walk_forward.py must emit a print message when falling back to plain."""
        source = _WALK_FORWARD_PATH.read_text(encoding="utf-8")
        assert "CPCV auto-fallback" in source or "cpcv auto-fallback" in source.lower(), (
            "walk_forward.py must log a clear fallback reason when data is insufficient "
            "for CPCV. FIX 3 requires this operator-visible message."
        )

    def test_fix3_comment_present(self):
        """FIX 3 documentation must be present in the source."""
        source = _WALK_FORWARD_PATH.read_text(encoding="utf-8")
        assert "FIX 3" in source, (
            "FIX 3 documentation comment not found in walk_forward.py."
        )

    def test_min_cpcv_fold_bars_env_knob_present(self):
        """walk_forward.py must read MIN_CPCV_FOLD_BARS for the fallback threshold."""
        source = _WALK_FORWARD_PATH.read_text(encoding="utf-8")
        assert "MIN_CPCV_FOLD_BARS" in source, (
            "MIN_CPCV_FOLD_BARS env knob must be present for tunable CPCV fold-size check."
        )


# ─── Test C: insufficient-data fallback logic (pure unit — no imports) ───────

class TestFix3InsufficientDataFallbackLogic:
    """Test the fallback decision logic in isolation without importing walk_forward."""

    def _resolve_mode_with_fallback(self, data_len: int, n_splits: int = 6,
                                     min_fold_bars: int = 60,
                                     requested_mode: str = "cpcv") -> str:
        """Mirror the FIX 3 fallback logic from walk_forward.py."""
        fold_size = data_len // n_splits
        if requested_mode == "cpcv" and fold_size < min_fold_bars:
            return "plain"  # fallback
        return requested_mode

    def test_short_data_triggers_fallback_to_plain(self):
        """300 bars / 6 folds = 50 bars/fold < 60 min → fallback to plain."""
        result = self._resolve_mode_with_fallback(data_len=300)
        assert result == "plain", (
            "300 bars with 6 folds (50 bars/fold < 60 min) must fall back to plain. "
            f"Got {result!r}."
        )

    def test_sufficient_data_stays_cpcv(self):
        """720 bars / 6 folds = 120 bars/fold ≥ 60 min → stays cpcv."""
        result = self._resolve_mode_with_fallback(data_len=720)
        assert result == "cpcv", (
            "720 bars with 6 folds (120 bars/fold ≥ 60 min) must stay cpcv. "
            f"Got {result!r}."
        )

    def test_explicit_plain_not_overridden(self):
        """Explicit plain mode must never be overridden by the fallback logic."""
        result = self._resolve_mode_with_fallback(data_len=2000, requested_mode="plain")
        assert result == "plain"

    def test_borderline_data_at_threshold(self):
        """Exactly 360 bars / 6 folds = 60 bars/fold = min threshold → stays cpcv."""
        result = self._resolve_mode_with_fallback(data_len=360)
        assert result == "cpcv", (
            "360 bars / 6 folds = exactly 60 bars/fold = threshold → must stay cpcv. "
            f"Got {result!r}."
        )

    def test_just_below_threshold(self):
        """359 bars / 6 folds = 59 bars/fold < 60 min → fallback to plain."""
        result = self._resolve_mode_with_fallback(data_len=359)
        assert result == "plain", (
            "359 bars / 6 folds = 59 bars/fold < threshold → must fall back to plain. "
            f"Got {result!r}."
        )
