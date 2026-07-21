"""H1/H2 battery PASSAGE LEDGER (ratify
`docs/designs/h1-wave1-instrumentation-trial-counter-passage-ledger-2026-07-18.md`,
RATIFIED R-042 pin 2).

THE ONE THING: prove each gate RECEIVED the case AND FIRED with its inputs
visible — the anti-dormant-judge discipline (Law 1: a gate that can't be seen
receiving-and-firing is the vacuous class). One row per (strategy × gate) with an
engagement receipt. For the wave-1 SHAKEDOWN, the ledger IS the deliverable (the
verdicts are framework-behavior measurement, but the LEDGER proves the courtroom
works).

★ GATE-CLASS ENUM DERIVED FROM CODE (R-042 pin 2, no-identifiers-from-memory law
applied to the advisor's own ruling). `GATE_CLASSES` below is the
seam-enumeration of the gates the battery + promotion path ACTUALLY invoke, each
carrying its code invocation site (file:line) — so the enum is traceable to the
source, never a recollection of CLAUDE.md. Derived 2026-07-18 by the gate-enum
investigation (AR filed). Structural finding it encodes: the PRODUCER/JUDGE split
— the Python engine COMPUTES statistics UNCONDITIONALLY per backtest; the TS
lifecycle layer FIRES the PASS/FAIL verdict CONDITIONALLY at a promotion
transition. A ledger row is keyed on the JUDGE (the firing verdict), tagging its
`unconditional` (fires on every battery run) vs `conditional` (only at a named
stage) nature so absence is scored correctly.

ALARM SEMANTICS (R-042 pin 2):
  * UNCONDITIONAL gate with `received=True, fired=False` -> DORMANT-JUDGE ALARM.
  * CONDITIONAL gate absent on a non-candidate -> NOT an alarm (expected).
  * CONDITIONAL gate that DID receive the case but did not fire -> alarm (it was
    handed the case at its stage and refused).
  * `compile_fidelity_forensics` is CONDITIONAL + RESERVED (not-yet-built,
    R-040 pin 2iv) -> expected absent everywhere until built; never an alarm.

Determinism/IO note: audit writer (atomic write-temp-rename), wall-clock only for
audit stamps — same exemption as the trial counter.
"""

from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

DEFAULT_PATH = os.path.join("docs", "replay-results", "h1-battery", "passage-ledger.json")

# Verdict-type vocabulary (schema = decision boundary; closed set).
VERDICT_PASS = "PASS"
VERDICT_FAIL = "FAIL"
VERDICT_NOT_EVALUATED = "NOT_EVALUATED"
_VALID_VERDICTS = {VERDICT_PASS, VERDICT_FAIL, VERDICT_NOT_EVALUATED}


@dataclass(frozen=True)
class GateClass:
    """One code-derived gate/judge. `invocation` is the code site the enum is
    derived FROM (R-042 pin 2). `unconditional` = fires on every battery run;
    else it fires only at `stage`. `verdict` = whether it emits a PASS/FAIL
    (a JUDGE) or is a non-verdict FILTER/observability surface."""
    name: str
    stage: str
    invocation: str          # file:line — the derivation source
    unconditional: bool
    verdict: bool = True     # False for signal-filters / observability-only
    reserved: bool = False   # designed but NOT-YET-BUILT


# ── THE CODE-DERIVED ENUM (seam-enumeration applied to judges) ───────────────
# Battery judges: engine COMPUTES unconditionally per backtest; the TS verdict
# fires at a promotion transition. For the SHAKEDOWN wave the battery-compute
# judges are the ones a backtest exercises; the promotion-transition judges are
# tagged conditional (they get rows only if/when a spec reaches that stage —
# shakedown specs are survivor-ineligible, so they will honestly show absent).
GATE_CLASSES: Dict[str, GateClass] = {
    # ── Stage: anti-overfit / robustness battery (engine compute) ──
    "walk_forward":       GateClass("walk_forward", "battery", "walk_forward.py:182", True),
    "cpcv":               GateClass("cpcv", "battery", "walk_forward.py:297", True),
    "dsr":                GateClass("dsr", "battery", "risk_metrics.py:505 / b14-ci-gate.ts:121", True),
    "pbo":                GateClass("pbo", "battery", "pbo_gate.py:48 / pbo-gate.ts:119", True),
    "bif":                GateClass("bif", "battery", "backtest_inflation_factor.py / bif-gate.ts:132", True),
    "wrc":                GateClass("wrc", "battery", "whites_reality_check.py", True),
    "spa":                GateClass("spa", "battery", "hansens_spa.py", True),
    "monte_carlo_ruin":   GateClass("monte_carlo_ruin", "battery", "risk_metrics.py:40 / b14-ci-gate.ts:334", True),
    "slippage_survival":  GateClass("slippage_survival", "battery", "slippage_survival.py / slippage-survival-gate.ts:248", True),
    "corpus_fdr":         GateClass("corpus_fdr", "battery-corpus", "statistics/corpus_fdr.py", False),  # corpus-level, not single-strategy
    # ── Stage: performance / eligibility (engine, per-backtest) ──
    "performance_gate":   GateClass("performance_gate", "performance", "performance_gate.py:57 (backtester.py:5547,7686)", True),
    "forge_score":        GateClass("forge_score", "performance", "performance_gate.py:257 (crisis_veto/tier)", True),
    "eligibility_gate":   GateClass("eligibility_gate", "performance", "context/eligibility_gate.py:271", True, verdict=False),  # SIGNAL FILTER, not a verdict
    # ── Stage: prop-firm survival (promotion) ──
    "b14_ci":             GateClass("b14_ci", "prop_survival", "b14-ci-gate.ts:334 (paper-to-deploy-ready-gates.ts:568)", False),
    "b14_survival_twin":  GateClass("b14_survival_twin", "prop_survival", "paper-to-deploy-ready-gates.ts:490", False),
    "survival_score":     GateClass("survival_score", "prop_survival", "backtest-service.ts:2747 (survival_scorer.py, C4 59727627)", False),
    "b15_param_robustness": GateClass("b15_param_robustness", "prop_survival", "paper-to-deploy-ready-gates.ts:629 (parameter_jitter_battery.py)", False),
    # ── Stage: promotion transitions (lifecycle) ──
    "pbo_lifecycle":      GateClass("pbo_lifecycle", "promotion", "lifecycle-service.ts:~1865 (pbo-gate.ts:119)", False),
    "shadow_divergence":  GateClass("shadow_divergence", "promotion", "lifecycle-service.ts:1257 (shadow-to-paper-gate.ts)", False),
    "wfe_floor":          GateClass("wfe_floor", "promotion", "promotion-gate-orchestrator.ts (wfe-gate.ts)", False),
    "parameter_drift":    GateClass("parameter_drift", "promotion", "paper-to-deploy-ready-gates.ts:709", False),
    "promotion_orchestrator_5": GateClass("promotion_orchestrator_5", "promotion", "promotion-gate-orchestrator.ts:295 {b14_ci_high,wfe_floor,cpcv_n_paths,wrc_p,spa_p}", False),
    "frozen_policy_drift": GateClass("frozen_policy_drift", "promotion", "paper-to-deploy-ready-gates.ts:985", False),
    "a7_signal_correlation": GateClass("a7_signal_correlation", "promotion", "lifecycle-service.ts:~831", False),
    "compliance_drift":   GateClass("compliance_drift", "promotion", "lifecycle-service.ts:~484 (complianceRulesets.driftDetected check)", False),
    "dsl_guards":         GateClass("dsl_guards", "promotion", "lifecycle-service.ts:141-166", False),
    "composite_shadow":   GateClass("composite_shadow", "promotion", "paper-to-deploy-ready-gates.ts:918", False, verdict=False),  # observability-only, never blocks
    # ── Stage: compile-fidelity forensics (R-040 pin 2iv) — Leg A DETECTOR BUILT, INVOCATION DEFERRED ──
    # Detector: forensics/compile_fidelity.py:run_leg_a (Tooth-1 build, tooth1-compile-fidelity-
    # ratify-2026-07-21). reserved=True KEPT: no LIVE candidacy invocation runs yet — the eligible
    # survivor set is empty (0 candidates), so Leg A has nothing to grade. The gate wires to a real
    # candidacy call site when the first survivor candidate exists (pre-reg §6).
    "compile_fidelity_forensics": GateClass(
        "compile_fidelity_forensics", "forensics",
        "RESERVED invocation — detector BUILT (forensics/compile_fidelity.py:run_leg_a); live "
        "candidacy call site deferred, eligible set empty (0 candidates)",
        False, reserved=True),
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _atomic_write(path: str, obj: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(obj, fh, indent=2)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


class PassageLedger:
    """Per-wave passage ledger; one row per (strategy × gate). Appends to one
    file across waves (the `wave` field distinguishes)."""

    def __init__(self, path: str = DEFAULT_PATH) -> None:
        self.path = path
        self._doc = self._load_or_create()

    def _load_or_create(self) -> dict:
        if os.path.exists(self.path):
            with open(self.path, encoding="utf-8") as fh:
                return json.load(fh)
        return {"artifact": "h1-passage-ledger", "gate_enum_provenance": "code-derived (R-042 pin 2)", "rows": []}

    def _persist(self) -> None:
        _atomic_write(self.path, self._doc)

    def record(
        self,
        *,
        wave: str,
        strategy_ref: str,
        spec_hash: str,
        engine_sha: str,
        gate: str,
        received: bool,
        fired: bool,
        verdict: str,
        binding_approximation_rate: float,
        inputs_seen: Optional[List[str]] = None,
        value: Any = None,
        engaged_features: Optional[List[str]] = None,
        exit_provenance: Optional[str] = None,
        audit_level: str = "spot-check",
        scope_line: Optional[str] = None,
        dataset_hash: Optional[str] = None,
        config_hash: Optional[str] = None,
    ) -> dict:
        """Record one gate's passage for one strategy. Raises on an unknown gate
        (the enum is code-derived and closed — a gate not in it is a derivation
        gap to surface, never silently accepted). Computes the dormant-judge
        alarm per the gate's conditional/reserved nature."""
        if gate not in GATE_CLASSES:
            raise KeyError(
                f"gate {gate!r} not in the code-derived GATE_CLASSES enum — "
                f"a gate outside the derivation must be reconciled with the code, not silently ledgered"
            )
        if verdict not in _VALID_VERDICTS:
            raise ValueError(f"invalid verdict {verdict!r}; must be one of {sorted(_VALID_VERDICTS)}")
        gc = GATE_CLASSES[gate]
        # DORMANT-JUDGE ALARM: an UNCONDITIONAL gate handed the case that did not
        # fire is the vacuous class. A CONDITIONAL/RESERVED gate that received
        # the case but did not fire is also an alarm (it was at its stage and
        # refused); a conditional gate that is simply ABSENT is scored elsewhere
        # (a missing row), not here.
        dormant_alarm = bool(received and not fired) and not gc.reserved
        row = {
            "wave": wave,
            "strategy_ref": strategy_ref,
            "spec_hash": spec_hash,
            "engine_sha": engine_sha,
            "gate": gate,
            "gate_stage": gc.stage,
            "gate_unconditional": gc.unconditional,
            "gate_verdict_bearing": gc.verdict,
            "gate_reserved": gc.reserved,
            "gate_invocation": gc.invocation,
            "received": bool(received),
            "fired": bool(fired),
            "dormant_judge_alarm": dormant_alarm,
            "engagement_receipt": {
                "inputs_seen": inputs_seen or [],
                "value": value,
                "verdict": verdict,
                "engaged_features": engaged_features or [],
            },
            "exit_provenance": exit_provenance,
            # MEASURED per-spec rate (R-042 pin 3) — never a blanket 0.99. The
            # caller may pass a wave-specific scope_line; default is shakedown.
            "scope_line": scope_line or f"shakedown; binding-approx {binding_approximation_rate}; framework-behavior measurement, NOT edge evidence",
            # EFFECTIVE-N dedup tuple components (R-048 §3) — provenance parity with
            # the trial counter; None on legacy rows.
            "dataset_hash": dataset_hash,
            "config_hash": config_hash,
            "audit_level": audit_level,
            "recorded_at": _now_iso(),
        }
        self._doc["rows"].append(row)
        self._persist()
        return row

    def annotate_superseded(
        self,
        *,
        wave: str,
        by: str,
        strategy_ref: Optional[str] = None,
        predicate=None,
        backfill_dataset_hash: Optional[str] = None,
        backfill_config_hash: Optional[str] = None,
    ) -> int:
        """R-048 §3: mark a defective audit's ledger rows `SUPERSEDED_BY_REMAP`
        WITHOUT deleting them (append-only is absolute). Adds a
        `superseded_by_remap` ({by, at}) provenance field to matching rows; never
        removes a row, never changes a verdict/alarm. Returns the count annotated.
        Idempotent. The corrected re-run appends NEW rows as always.

        `predicate(row) -> bool` optionally narrows the set (e.g. only the
        pre-remap rows, distinguished by a null dedup-tuple slot), so a repeated
        remap never re-stamps the corrected rows. `backfill_*` completes the true
        (disk-derived) dedup-tuple slots on matched rows only where currently null
        — provenance parity with the trial counter (R-048 §3)."""
        n = 0
        for row in self._doc["rows"]:
            if row["wave"] != wave:
                continue
            if strategy_ref is not None and row["strategy_ref"] != strategy_ref:
                continue
            if predicate is not None and not predicate(row):
                continue
            row["superseded_by_remap"] = {"by": by, "at": _now_iso()}
            if backfill_dataset_hash is not None and row.get("dataset_hash") is None:
                row["dataset_hash"] = backfill_dataset_hash
            if backfill_config_hash is not None and row.get("config_hash") is None:
                row["config_hash"] = backfill_config_hash
            n += 1
        if n:
            self._persist()
        return n

    def alarms(self) -> List[dict]:
        """Every dormant-judge alarm row — the audit's first read."""
        return [r for r in self._doc["rows"] if r["dormant_judge_alarm"]]

    def unconditional_gate_names(self) -> List[str]:
        """The gates that MUST show a fired row on every battery-run strategy —
        the coverage checklist a shakedown row-set is audited against."""
        return [g.name for g in GATE_CLASSES.values() if g.unconditional and g.verdict]

    def coverage_gaps(self, strategy_ref: str, wave: str) -> List[str]:
        """★ COVERAGE AUDIT (grader finding #1): the per-row `dormant_judge_alarm`
        cannot see a judge that was NEVER handed a row — silence reads the same as
        "conditional, correctly absent". This diffs the FIRED unconditional
        verdict-bearing gates actually recorded for (strategy_ref, wave) against
        `unconditional_gate_names()` and returns the MISSING ones. A non-empty
        result is a COVERAGE ALARM: an unconditional judge that never received the
        case at all — the vacuous-by-silence class. The battery runner (or the
        audit) MUST call this per strategy; ledger silence is only "all judges
        fired clean" when coverage_gaps() is empty for every strategy."""
        fired = {
            r["gate"] for r in self._doc["rows"]
            if r["strategy_ref"] == strategy_ref and r["wave"] == wave and r["fired"]
        }
        return [name for name in self.unconditional_gate_names() if name not in fired]
