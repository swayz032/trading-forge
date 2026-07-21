"""calibration_battery.py — §4 CALIBRATION BATTERY FRAMEWORK ("the can-this-detector-lie audit").

Frozen pre-registration:
`docs/designs/survivor-forensics-preregistration-2026-07-19.md` (sha256 7fe3995b…, R-070) §4.

★ THE HARD STRUCTURAL CONSTRAINT (doer != grader). The gate's BUILDER does not author the
mutations. This file is the HARNESS: it defines the SEVEN mutation SLOTS (m1..m7), accepts a
grader-authored MutationCase per slot, runs each through the Leg A detector, and REQUIRES BOTH
(a) a CONVICTION (Leg A must BLOCK the mutant) and (b) an ANTI-VACUITY COMPANION (R-069 §2:
the SAME check must PASS on the clean known-good spec — proving the test distinguishes the
mutant from a clean spec, not that it fires on everything).

The seven live mutations m1..m7 are authored by an INDEPENDENT grader in a separate wave and
run against this harness. This module ships ONLY the harness plus clearly-labelled
`FRAMEWORK_DEMONSTRATION_PLACEHOLDER` synthetic cases that EXERCISE the harness. A machine-
enforced status gate makes the distinction impossible to miss:

  - status `CALIBRATED`                         : all 7 slots filled, each convicted + anti-
                                                  vacuity-distinguished, and NONE is a placeholder.
  - status `HARNESS_DEMONSTRATED_ON_PLACEHOLDERS`: the harness works, but >=1 slot is a
                                                  placeholder — NOT a real calibration.
  - status `INCOMPLETE`                          : a slot is unfilled, or the clean spec did not
                                                  pass whole.
  - status `FAILED`                              : a filled slot was NOT convicted, or its
                                                  companion did not distinguish it from clean.

A placeholder can NEVER produce `CALIBRATED`. That is the whole point of the gate.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from src.engine.forensics.compile_fidelity import PASS, LegAResult, run_leg_a

# The seven mutation slots, frozen verbatim from §4 of the pre-registration. Each of these is a
# mutation Tooth-1 MUST CONVICT; the INDEPENDENT grader authors the concrete mutation.
REQUIRED_SLOTS: dict[str, str] = {
    "m1": "mis-typed family (taught structure condition typed as filter)",
    "m2": "silently-dropped taught condition",
    "m3": "flipped polarity/direction",
    "m4": "proxy-bound load-bearing condition MISLABELED approximation=False (false-flag)",
    "m5": "house-default exit missing its provenance stamp",
    "m6": "broken spec<->certificate chain",
    "m7": "taught condition mislabeled non-load-bearing WITHOUT a disposition",
}

PLACEHOLDER_LABEL = "FRAMEWORK_DEMONSTRATION_PLACEHOLDER"

STATUS_CALIBRATED = "CALIBRATED"
STATUS_PLACEHOLDER = "HARNESS_DEMONSTRATED_ON_PLACEHOLDERS"
STATUS_INCOMPLETE = "INCOMPLETE"
STATUS_FAILED = "FAILED"


@dataclass
class LegAInputs:
    """One (artifact, certificate, countersignatures) triple fed to run_leg_a()."""

    artifact: dict
    certificate: dict | None = None
    countersignatures: dict[str, dict] | None = None

    def run(self) -> LegAResult:
        return run_leg_a(
            self.artifact,
            certificate=self.certificate,
            countersignatures=self.countersignatures,
        )


@dataclass
class MutationCase:
    """A grader-authored mutation for one slot. `is_placeholder` MUST be False for a real
    calibration — a True value can never yield status CALIBRATED. `targeted_check` names the
    Leg A check-code the mutation is designed to trip (e.g. 'ii', 'iv', 'vi', 'v', 'v_nonlb',
    'm4_false_flag', 'countersign'); the anti-vacuity companion proves the CLEAN spec passes
    exactly that check."""

    slot_id: str
    label: str
    targeted_check: str
    mutant: LegAInputs
    is_placeholder: bool = False


@dataclass
class SlotResult:
    slot_id: str
    filled: bool
    is_placeholder: bool
    convicted: bool          # Leg A BLOCKed the mutant
    targeted_check: str
    mutant_trips_target: bool  # the mutant fails the targeted check
    clean_passes_target: bool  # the clean spec passes the targeted check
    distinguishes: bool        # mutant trips target AND clean passes it (anti-vacuity)
    ok: bool                   # convicted AND distinguishes
    detail: str

    def to_dict(self) -> dict:
        return {
            "slot_id": self.slot_id,
            "description": REQUIRED_SLOTS.get(self.slot_id, ""),
            "filled": self.filled,
            "is_placeholder": self.is_placeholder,
            "convicted": self.convicted,
            "targeted_check": self.targeted_check,
            "mutant_trips_target": self.mutant_trips_target,
            "clean_passes_target": self.clean_passes_target,
            "distinguishes": self.distinguishes,
            "ok": self.ok,
            "detail": self.detail,
        }


@dataclass
class BatteryResult:
    clean_verdict: str
    clean_passes_whole: bool
    slot_results: dict[str, SlotResult]
    status: str
    reasons: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "clean_verdict": self.clean_verdict,
            "clean_passes_whole": self.clean_passes_whole,
            "status": self.status,
            "slots": {sid: sr.to_dict() for sid, sr in self.slot_results.items()},
            "reasons": self.reasons,
        }


def run_calibration(clean: LegAInputs, slots: dict[str, MutationCase]) -> BatteryResult:
    """Run the §4 battery. The clean known-good spec must PASS whole; each of the seven slots
    must be filled, its mutant convicted, and its anti-vacuity companion must distinguish the
    mutant from the clean spec on the targeted check."""
    reasons: list[str] = []

    clean_result = clean.run()
    clean_passes_whole = clean_result.verdict == PASS
    clean_failed_checks = set(clean_result.checks_failed)
    if not clean_passes_whole:
        reasons.append(f"clean known-good spec did NOT pass whole: {sorted(clean_failed_checks)}")

    slot_results: dict[str, SlotResult] = {}
    any_placeholder = False
    any_failed = False
    any_unfilled = False

    for sid in REQUIRED_SLOTS:
        case = slots.get(sid)
        if case is None:
            any_unfilled = True
            slot_results[sid] = SlotResult(
                slot_id=sid, filled=False, is_placeholder=False, convicted=False,
                targeted_check="", mutant_trips_target=False, clean_passes_target=False,
                distinguishes=False, ok=False, detail="UNFILLED — awaiting independent grader's mutation",
            )
            continue

        if case.is_placeholder:
            any_placeholder = True

        mutant_result = case.mutant.run()
        convicted = mutant_result.verdict != PASS
        target = case.targeted_check
        mutant_trips = target in mutant_result.checks_failed
        clean_passes_target = target not in clean_failed_checks
        distinguishes = mutant_trips and clean_passes_target
        ok = convicted and distinguishes
        if not ok:
            any_failed = True
        detail = (
            f"mutant verdict={mutant_result.verdict}; trips {target!r}={mutant_trips}; "
            f"clean passes {target!r}={clean_passes_target}"
        )
        slot_results[sid] = SlotResult(
            slot_id=sid, filled=True, is_placeholder=case.is_placeholder, convicted=convicted,
            targeted_check=target, mutant_trips_target=mutant_trips,
            clean_passes_target=clean_passes_target, distinguishes=distinguishes, ok=ok, detail=detail,
        )

    # Status resolution — order matters; fail-closed.
    if not clean_passes_whole or any_unfilled:
        status = STATUS_INCOMPLETE
        if any_unfilled:
            reasons.append("one or more slots unfilled (fail-closed INCOMPLETE)")
    elif any_failed:
        status = STATUS_FAILED
        reasons.append("a filled slot was not convicted or its companion did not distinguish it")
    elif any_placeholder:
        status = STATUS_PLACEHOLDER
        reasons.append(
            "harness demonstrated, but >=1 slot is a FRAMEWORK_DEMONSTRATION_PLACEHOLDER — "
            "the LIVE m1..m7 are the independent grader's to author (doer != grader)"
        )
    else:
        status = STATUS_CALIBRATED
        reasons.append("all 7 grader-authored slots convicted with distinguishing anti-vacuity companions")

    return BatteryResult(
        clean_verdict=clean_result.verdict,
        clean_passes_whole=clean_passes_whole,
        slot_results=slot_results,
        status=status,
        reasons=reasons,
    )
