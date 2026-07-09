"""DS22 Track Y4 — strategy_shell event-blackout coverage (cap-closer, 2026-07-09).

Bug closed here (independent cert F-1, deep-scan #22 cap-closer):
`compile_strategy()`'s `strategy_shell` artifact is the DEFAULT live Pine
export path — auto-generated on ~every MC/backtest/scheduled export at
exportability.score >= 70 (see `pine_compiler.py::compile_strategy`,
`emit_shell` branch) and downloaded by families. `compile_strategy()` is
invoked (non-`--dual` CLI branch) by `compilePineExport()` in
`src/server/services/pine-export-service.ts`, which is itself called from
`monte-carlo-service.ts`, `quantum-mc-service.ts`, `scheduler.ts`,
`routes/strategies.ts`, and `routes/pine-export.ts`'s default
(non-"pine_dual") branch — i.e. every auto-recompile and every
default-exportType export in production.

Before this fix, the `strategy_shell` block reimplemented its OWN NFP-only
blackout inline (`nfp_blackout = (dayofmonth <= 7 and dayofweek ==
dayofweek.friday and hour == 8 and minute < 60)` / `event_blackout =
nfp_blackout`) and never called the shared `_build_event_blackout_block()`
helper that `compile_dual_artifacts()` uses via `_build_shared_preamble()`.
Every default-path family Pine export therefore shipped with NO FOMC/CPI
blackout at all — silently violating the CLAUDE.md §13 "Don't trade through
FOMC/CPI/NFP without `bypass_news_blackout=true` opt-in" mandate and §12's
`macro_alignment` hard-block invariant that the rest of the system enforces.

Fix: `compile_strategy()`'s legacy-shell assembly now calls the SAME shared
`_build_event_blackout_block()` helper `compile_dual_artifacts()` uses
(see `pine_compiler.py` inline P0-3 comment at the `strategy_shell +=
_build_event_blackout_block()` call site). The shell's `event_blackout` is
now `fomc_blackout or cpi_blackout or nfp_blackout` — identical chain to the
dual-artifact strategy path.

This file is deliberately narrow — it does not re-verify `compile_dual_artifacts()`
(already covered by `test_strategy_alertcondition_includes_gates` in
`test_pine_compiler.py`); it covers ONLY the `strategy_shell` artifact that
`compile_strategy()` emits, which had zero blackout-content coverage before
this fix.
"""
import pytest

import src.engine.pine_compiler as pine_compiler_module
from src.engine.pine_compiler import compile_strategy

# ─── Shared fixture ──────────────────────────────────────────────────────────

def _base_strategy(**overrides) -> dict:
    """Minimal exportable (score=100) strategy — guarantees strategy_shell is
    emitted (emit_shell requires exportability.score >= 70 for pine_indicator)."""
    base = {
        "name": "Test SMA Strategy Y4",
        "symbol": "MES",
        "timeframe": "5m",
        "direction": "both",
        "entry_type": "trend_follow",
        "entry_indicator": "sma_crossover",
        "entry_params": {"fast_period": 10, "slow_period": 50},
        "exit_type": "atr_multiple",
        "stop_loss_atr_multiple": 2.0,
        "take_profit_atr_multiple": 4.0,
        "indicators": [
            {"type": "sma", "period": 10},
            {"type": "sma", "period": 50},
        ],
    }
    base.update(overrides)
    return base


def _shell_pine(strategy: dict, firm_key: str = "topstep_50k") -> str:
    """Compile via compile_strategy() (the DEFAULT live path — non-dual CLI
    branch) and return the strategy_shell artifact's Pine text."""
    result = compile_strategy(strategy, firm_key=firm_key)
    shells = [a for a in result.artifacts if a.artifact_type == "strategy_shell"]
    assert len(shells) == 1, (
        f"Expected exactly one strategy_shell artifact for an exportability.score>=70 "
        f"strategy, got {len(shells)}. emit_shell gating may have changed."
    )
    return shells[0].content


def _assert_full_macro_blackout(pine: str) -> None:
    """The coverage checker. Asserts the FULL FOMC+CPI+NFP chain is present —
    not the NFP-only pre-fix behavior. Reused by both the GREEN test and the
    RED-proof meta-test below so both paths exercise the identical assertion."""
    assert "fomc_blackout" in pine, (
        "strategy_shell is missing 'fomc_blackout' — FOMC blackout leg absent. "
        "This is the deep-scan #22 Y4 regression: the shell reimplemented an "
        "NFP-only blackout instead of calling _build_event_blackout_block()."
    )
    assert "cpi_blackout" in pine, (
        "strategy_shell is missing 'cpi_blackout' — CPI blackout leg absent. "
        "This is the deep-scan #22 Y4 regression: the shell reimplemented an "
        "NFP-only blackout instead of calling _build_event_blackout_block()."
    )
    assert "nfp_blackout" in pine, "strategy_shell is missing 'nfp_blackout' entirely."
    assert "event_blackout = fomc_blackout or cpi_blackout or nfp_blackout" in pine, (
        "strategy_shell's event_blackout must OR all three legs together — the "
        "exact chain _build_event_blackout_block() emits. Found a different "
        "definition (e.g. 'event_blackout = nfp_blackout' — the pre-fix bug)."
    )
    # The pre-fix bug's exact line must never reappear.
    assert "event_blackout = nfp_blackout" not in pine, (
        "strategy_shell regressed to the pre-fix NFP-only 'event_blackout = "
        "nfp_blackout' assignment — the FOMC/CPI legs have been dropped again."
    )


# ─── Test 1 — GREEN: strategy_shell carries the full macro blackout ────────

def test_strategy_shell_contains_full_macro_blackout():
    """Permanent regression test: the DEFAULT live Pine path's strategy_shell
    artifact must carry the same FOMC+CPI+NFP blackout chain the dual-artifact
    strategy path emits — not a stripped-down NFP-only substitute."""
    pine = _shell_pine(_base_strategy())
    _assert_full_macro_blackout(pine)


def test_strategy_shell_entry_allowed_still_gates_on_event_blackout():
    """The entry_allowed predicate must still reference the (now-full) blackout
    — the fix must not have decoupled event_blackout from the entry gate."""
    pine = _shell_pine(_base_strategy())
    entry_allowed_line = next(
        (ln for ln in pine.splitlines() if ln.strip().startswith("entry_allowed")),
        None,
    )
    assert entry_allowed_line is not None, "entry_allowed line not found in strategy_shell"
    assert "not event_blackout" in entry_allowed_line, (
        "entry_allowed must gate on 'not event_blackout' — found: " + entry_allowed_line
    )


# ─── Test 2 — RED-then-GREEN proof: the checker is non-vacuous ─────────────
#
# Simulates reverting the Y4 fix: compile_strategy() would go back to
# inlining an NFP-only blackout instead of calling the shared
# _build_event_blackout_block() helper. Monkeypatching the helper to return
# exactly the pre-fix single-leg expression reproduces the regressed shell
# byte-for-byte (compile_strategy's assembly is unchanged — only the value
# the shared helper contributes changes), proving _assert_full_macro_blackout
# actually catches the NFP-only regression rather than passing vacuously.

_LEGACY_NFP_ONLY_BLACKOUT_BLOCK = """
// ─── Economic Event Blackout (P0-3) — REVERTED FOR RED-PROOF ────────
// P0-3: NFP blackout only (simplified for legacy shell) -- PRE-Y4-FIX TEXT
nfp_blackout = (dayofmonth <= 7 and dayofweek == dayofweek.friday and hour == 8 and minute < 60)
event_blackout = nfp_blackout
"""


class TestRedProofNfpOnlyRegressionIsCaught:
    def test_checker_fails_on_reverted_nfp_only_shell(self, monkeypatch):
        """RED: if the Y4 fix were reverted (shared helper contributes only the
        NFP-only leg the shell used to hardcode), the coverage checker MUST
        raise — proving the checker is a real regression guard, not a tautology."""
        monkeypatch.setattr(
            pine_compiler_module,
            "_build_event_blackout_block",
            lambda: _LEGACY_NFP_ONLY_BLACKOUT_BLOCK,
        )
        reverted_pine = _shell_pine(_base_strategy())

        # Sanity: the mutation actually changed the emitted text vs the fixed
        # (unmutated) path, otherwise this whole test would be vacuous.
        assert "fomc_blackout" not in reverted_pine, (
            "RED-PROOF SETUP FAILED: monkeypatch did not take effect — "
            "reverted_pine still contains fomc_blackout"
        )

        with pytest.raises(AssertionError, match="fomc_blackout"):
            _assert_full_macro_blackout(reverted_pine)

    def test_checker_passes_once_fix_restored(self):
        """GREEN (control): with the fix in place (no monkeypatch), the same
        checker passes cleanly on the same strategy fixture — confirms test 1's
        failure above is caused by the mutation, not fixture flakiness."""
        pine = _shell_pine(_base_strategy())
        _assert_full_macro_blackout(pine)  # must not raise
