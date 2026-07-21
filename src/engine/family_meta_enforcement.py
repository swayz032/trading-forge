"""family_meta_enforcement.py — the load-time gate that removes the engine's ability
to lie about what it runs (docs/designs/packet-family-meta-enforced-2026-07-20.md).

WHY THIS MODULE EXISTS. `spec_family_bindings.FAMILY_META` is the table every spec's
binding plan, every `approximation` flag, and every fidelity number is derived from. A
committed, measured sweep (docs/replay-results/h1-battery/family_meta_reachability_sweep.py,
n=2000 real ES 5min bars, corroborated over 120 corpus specs x 600 bars, all 7 positive
controls fired) found that of the 9 families declaring a real primitive, only 3 execute
it: 3 REACHABLE / 2 PARTIAL / 4 NOT-REACHABLE / 2 COULD-NOT-VERIFY. The declaration was
free to say anything, because nothing checked it and dispatch routed on `b.type` through
an independent `if/elif` ladder — a SECOND ROUTER, and therefore a second truth.

THE FOUR PINS (packet section 3), each implemented here as a mechanical, load-time check:

  (a) SINGLE SOURCE   -- `verify_dispatch_coverage()`. Dispatch DERIVES from FAMILY_META:
      the executable layer registers its handlers keyed by the DECLARED primitive /
      mechanism string, and this check proves the two sets are equal in BOTH directions.
      A declared pointer with no handler is unroutable; a handler nothing declares is a
      second router. Both are load errors.

  (b) FAIL-LOUD      -- `verify_primitives()`. A declared primitive must resolve to a real
      code symbol via importlib. `FILTER` declared `entry_quality.confluence_factor_presence`
      and THAT MODULE DOES NOT EXIST; the executable layer silently substituted
      `np.ones(n, dtype=bool)` -- constant True for 390 corpus conditions carrying
      role=spine. A condition that cannot be false cannot gate.

      *** THE PROHIBITION, RESTATED WHERE IT IS MOST LIKELY TO BE VIOLATED ***
      Do NOT make a failing pointer pass by aiming it at something plausible. Inventing an
      `entry_quality.confluence_factor_presence` to satisfy this check would convert a
      pointer lie into a FABRICATED IMPLEMENTATION -- strictly worse, because it would
      PROBE CLEAN. Equally banned: silencing the failure with try/except or a default.
      The loud failure IS the deliverable. A family with no real primitive gets an HONEST
      ENTRY (pin (c)) that says so, never a pointer at a look-alike.

  (b2) EMIT SUBSET-OF COVERED -- `verify_emit_subset_covered()`. Pointer-truth one level
      down: a resolver may not emit a VALUE its consumer cannot check. Convicting instance:
      the WAIT_SESSION resolvers can emit 7 zones while `session_windows._ZONE_CHECKS`
      covers 5, so `lunch_blackout` / `overnight` are always-False gates wearing
      bindable=True, approximation=False, executed=True. Both sets are enumerated
      PROGRAMMATICALLY from the live objects the production code itself iterates -- never
      transcribed, because a transcribed set drifts silently and re-creates the very defect
      this check exists to catch.

  (c) HONEST ENTRIES  -- lives in FAMILY_META itself (see `FamilyMeta.enforced_*` and the
      table's per-entry notes), not here; this module only verifies the result.

GATING AND ROLLBACK. Everything is behind `TF_FAMILY_META_ENFORCED` (default OFF). With the
flag OFF the engine is byte-identical to before this module existed -- proven, not asserted,
by tests/test_family_meta_enforcement.py::test_flag_off_binding_plans_are_byte_identical
(which carries its own control showing the proof CAN fail). Two-commit law: enforcement
lands here; any change to the default lands separately, and only on the grade.

PIN SELECTOR -- READ THIS BEFORE USING IT. `TF_FAMILY_META_ENFORCED_PINS` restricts which
pins run. It exists for ONE reason: pin (b2) currently FAILS on the real orphan-zone gap,
which this packet is explicitly scoped OUT of fixing (that gap belongs to the session-
resolver lane), so with all pins active the engine correctly REFUSES TO LOAD and the
acceptance sweep for pins (a)/(b)/(c) could not otherwise be run at all. It is a
MEASUREMENT SELECTOR, not an escape hatch:
  - it can only ever be consulted when enforcement is already ON;
  - it cannot silence a pin implicitly -- you must NAME the pins you are running, and the
    excluded pin is recorded in `enforcement_status()` and printed in the raised error;
  - it is NOT read when the value is unset (all pins run).
The honest reading of a run made with this variable set is "pins a,b,c held; pin b2 was not
evaluated" -- never "enforcement passed".
"""

from __future__ import annotations

import importlib
import os
from dataclasses import dataclass

FLAG_ENV: str = "TF_FAMILY_META_ENFORCED"
PINS_ENV: str = "TF_FAMILY_META_ENFORCED_PINS"

ALL_PINS: tuple[str, ...] = ("a", "b", "b2")
"""Pin (c) is a property of the FAMILY_META table's contents, not a runtime check -- it is
verified by tests (no aspirational pointer survives) and by pins (a)/(b), which a dishonest
entry cannot pass. Only the three mechanical checks are selectable."""


class FamilyMetaEnforcementError(RuntimeError):
    """Raised at load when a FAMILY_META declaration is not true of the engine.

    Deliberately a hard error with a nameable message: the whole point of this packet is
    that a declaration which does not resolve must be a STARTUP ERROR, never a silent
    fallback. Callers MUST NOT catch this."""


def family_meta_enforced() -> bool:
    """Read at call time (not cached at import), same live-read contract as every other
    flag in this codebase (fvg_identity_enabled, levelzone_routing_enabled, ...) -- lets a
    before/after comparison run in the SAME process."""
    return os.environ.get(FLAG_ENV, "false").strip().lower() == "true"


def active_pins() -> frozenset[str]:
    """The pins that will actually be evaluated. Unset (the normal case) => ALL of them.
    An unrecognized pin name is an error, not a silent no-op: a typo here would otherwise
    disable a check while looking like it enabled one."""
    raw = os.environ.get(PINS_ENV, "").strip()
    if not raw:
        return frozenset(ALL_PINS)
    names = frozenset(p.strip().lower() for p in raw.split(",") if p.strip())
    unknown = names - set(ALL_PINS)
    if unknown:
        raise FamilyMetaEnforcementError(
            f"{PINS_ENV} names unknown pin(s) {sorted(unknown)}; known pins are {list(ALL_PINS)}"
        )
    return names


# ─── (b) The primitive resolver registry ────────────────────────────────────────────────
#
# Maps a DECLARED primitive string (the exact value carried in FAMILY_META, and therefore
# the exact value that appears in every persisted binding plan and every governance label)
# to the real code symbol it names, as "module.path:attr" or "module.path:Class.method".
#
# This registry is NOT a place to make a failing declaration pass. It is checked in BOTH
# directions against FAMILY_META by `verify_primitives()`, so it cannot quietly cover a
# family that declares something else, and it cannot carry an entry nothing declares. The
# declared string stays stable (it is a persisted, mirrored value -- see the TS mirror at
# src/server/lib/spec-family-bindings.ts) while the resolution target is machine-checked.
PRIMITIVE_RESOLVERS: dict[str, str] = {
    "session_windows.is_in_killzone": "src.engine.session_windows:is_in_killzone",
    "structure_engine.compute_structure_state": (
        "src.engine.context.structure_engine:compute_structure_state"
    ),
    "spec_condition_compiler.retest_touch_check": (
        "src.engine.spec_condition_compiler:retest_touch_check"
    ),
    "spec_condition_compiler.candle_confirmation_check": (
        "src.engine.spec_condition_compiler:candle_confirmation_check"
    ),
    # WAIT_BIAS / CONFIRM_DIRECTION's HONEST pointer (pin (c)). These two families declared
    # `bias_engine.classify_institutional_regime` and the sweep measured 0 calls to it on
    # 2000 bars: the code that actually runs is the EMA-slope directional proxy below (plus
    # the WIRE-1 htf_daily_trend column when the backtester materialized one). The pointer
    # now names the thing that executes. This is pin (c) -- "declare the ACTUAL mechanism"
    # -- and NOT the prohibited repair: no new implementation was written to satisfy the
    # check; the target is the already-executing method, and approximation stays True.
    "spec_condition_compiler.wait_bias_directional_proxy": (
        "src.engine.spec_condition_compiler:SpecConditionStrategy._eval_wait_bias"
    ),
    "structural_stops.compute_structural_stop": (
        "src.engine.context.structural_stops:compute_structural_stop"
    ),
    # ── Experiment primitives. Not FAMILY_META declarations -- these are returned by
    # bind_condition() only when an env-gated experiment flag is on. Registered here so
    # pin (a)'s both-directions dispatch check can tell "a handler for a declared
    # experiment primitive" apart from "a handler nothing declares" (a second router).
    "fvg_native.compute_fvg_signal": "src.engine.indicators.fvg_native:compute_fvg_signal",
    "bias_native.compute_bias_signal": "src.engine.indicators.bias_native:compute_bias_signal",
    "confirmation_native.compute_confirmation_signal": (
        "src.engine.indicators.confirmation_native:compute_confirmation_signal"
    ),
    "sweep_native.compute_sweep_signal": "src.engine.indicators.sweep_native:compute_sweep_signal",
    "mss_native.compute_mss_signal": "src.engine.indicators.mss_native:compute_mss_signal",
    "levelzone_routing.retest_touch_check": (
        "src.engine.spec_condition_compiler:retest_touch_check"
    ),
    "levelzone_routing.population_a_resolver": (
        "src.engine.spec_condition_compiler:SpecConditionStrategy._eval_population_a_level"
    ),
}

EXPERIMENT_PRIMITIVES: frozenset[str] = frozenset(
    {
        "fvg_native.compute_fvg_signal",
        "bias_native.compute_bias_signal",
        "confirmation_native.compute_confirmation_signal",
        "sweep_native.compute_sweep_signal",
        "mss_native.compute_mss_signal",
        "levelzone_routing.retest_touch_check",
        "levelzone_routing.population_a_resolver",
    }
)
"""Primitives a binding can carry that FAMILY_META does not declare, because they are
produced only by an env-gated experiment override inside bind_condition(). Enumerated so
pin (a) can be strict about everything else."""


# ─── (c) The mechanism registry ─────────────────────────────────────────────────────────
#
# A MECHANISM is what an honest entry declares when a family has NO real primitive. It is
# not a pointer at code that computes a signal; it is a NAME for what the engine actually
# does, and every one of them is non-gating by construction. Keeping them in a separate,
# enumerated registry (rather than letting `primitive=None` mean "anything goes") is what
# stops pin (c) from becoming a hole: a mechanism must be declared here, must be routed by
# the executable layer (pin (a)), and its `gates=False` is asserted by tests.
MECHANISMS: dict[str, str] = {
    "static_true_pass_through": (
        "Constant True for every bar. FILTER's honest entry: no standalone per-bar "
        "confluence primitive exists in this repo, so the engine emits np.ones and the "
        "condition CANNOT GATE. Declared, not hidden -- the previous declaration pointed "
        "at entry_quality.confluence_factor_presence, a module that does not exist."
    ),
    "spine_conjunction_trigger": (
        "No per-condition array at all. ENABLE_ENTRY / ENTER's honest entry: the entry "
        "moment is the AND of the already-bound spine conditions, computed by the spine "
        "conjunction in compute(); the trigger condition itself is never evaluated. The "
        "previous declaration, `spine_completion_trigger`, was not a code symbol."
    ),
    "provenance_only": (
        "Recorded in the trace, never executed. EXIT_HINT only -- the framework overlay is "
        "authoritative for exits (W23F.N). Pre-existing and already honest; enumerated here "
        "so the mechanism set is complete rather than partially implicit."
    ),
}


@dataclass(frozen=True)
class Violation:
    pin: str
    family: str | None
    detail: str

    def __str__(self) -> str:
        where = f" [{self.family}]" if self.family else ""
        return f"pin({self.pin}){where}: {self.detail}"


def resolve_primitive(declared: str) -> object:
    """Resolve a declared primitive string to the real code symbol it names.

    Raises FamilyMetaEnforcementError -- never returns a stub, never returns None. Supports
    a dotted attribute chain after the colon so a method on a strategy class ("the code that
    actually runs") is as resolvable as a module-level function, without refactoring live
    engine code just to satisfy a checker."""
    target = PRIMITIVE_RESOLVERS.get(declared)
    if target is None:
        raise FamilyMetaEnforcementError(
            f"declared primitive {declared!r} has NO resolver entry -- it names nothing this "
            f"engine can execute. If this family has no real primitive, give it an HONEST "
            f"ENTRY (a mechanism), do NOT point it at a look-alike."
        )
    module_path, _, attr_chain = target.partition(":")
    try:
        obj: object = importlib.import_module(module_path)
    except Exception as exc:  # noqa: BLE001 -- re-raised loudly, never swallowed
        raise FamilyMetaEnforcementError(
            f"declared primitive {declared!r} resolves to {target!r} but module "
            f"{module_path!r} could not be imported: {exc!r}"
        ) from exc
    for part in attr_chain.split("."):
        if not hasattr(obj, part):
            raise FamilyMetaEnforcementError(
                f"declared primitive {declared!r} resolves to {target!r} but {part!r} does "
                f"not exist on {obj!r}"
            )
        obj = getattr(obj, part)
    return obj


def verify_primitives() -> list[Violation]:
    """(b) Every declared primitive resolves; the registry declares nothing extra."""
    from src.engine.spec_family_bindings import FAMILY_META

    out: list[Violation] = []
    declared: set[str] = set()
    for family, meta in FAMILY_META.items():
        primitive, mechanism = meta.enforced_declaration()
        if meta.unsupported:
            if primitive is not None or mechanism is not None:
                out.append(
                    Violation("b", family, "unsupported family must declare neither primitive nor mechanism")
                )
            continue
        if (primitive is None) == (mechanism is None):
            out.append(
                Violation(
                    "b",
                    family,
                    "must declare EXACTLY ONE of primitive / mechanism "
                    f"(got primitive={primitive!r}, mechanism={mechanism!r})",
                )
            )
            continue
        if mechanism is not None:
            if mechanism not in MECHANISMS:
                out.append(Violation("b", family, f"mechanism {mechanism!r} is not a declared mechanism"))
            if meta.gates:
                out.append(
                    Violation(
                        "b",
                        family,
                        f"mechanism {mechanism!r} is declared gating=True; a mechanism computes no "
                        "per-bar signal and therefore cannot gate",
                    )
                )
            continue
        declared.add(primitive)
        try:
            resolve_primitive(primitive)
        except FamilyMetaEnforcementError as exc:
            out.append(Violation("b", family, str(exc)))

    orphan_resolvers = set(PRIMITIVE_RESOLVERS) - declared - EXPERIMENT_PRIMITIVES
    for name in sorted(orphan_resolvers):
        out.append(
            Violation("b", None, f"resolver registry carries {name!r}, which no FAMILY_META entry declares")
        )
    return out


def verify_emit_subset_covered() -> list[Violation]:
    """(b2) EMITTED VALUES subset-of COVERED VALUES, for every resolver/consumer pair.

    Both sets are derived PROGRAMMATICALLY from the live objects the production code itself
    iterates -- `spec_family_bindings.SESSION_KEYWORDS` and `_REAL_ZONE_INTERVALS` are what
    the two session resolvers loop over to produce a zone; `session_windows._ZONE_CHECKS` is
    what `is_in_killzone` looks the zone up in. Transcribing either set into a literal here
    would re-create the exact defect this check exists to catch: a table that drifts from
    the code while the checker keeps passing."""
    import src.engine.session_windows as session_windows
    import src.engine.spec_family_bindings as sfb

    out: list[Violation] = []
    covered = set(session_windows._ZONE_CHECKS)
    emitters = {
        "spec_family_bindings.resolve_session_keyword": set(sfb.SESSION_KEYWORDS),
        "spec_family_bindings.classify_session_role": set(sfb._REAL_ZONE_INTERVALS),
    }
    for emitter, emitted in emitters.items():
        orphans = emitted - covered
        if orphans:
            out.append(
                Violation(
                    "b2",
                    "WAIT_SESSION",
                    f"{emitter} can emit zone(s) {sorted(orphans)} that its consumer "
                    f"session_windows.is_in_killzone cannot check (_ZONE_CHECKS covers "
                    f"{sorted(covered)}). A value nothing can evaluate is an ALWAYS-FALSE gate "
                    f"wearing bindable=True.",
                )
            )
    return out


NON_GATING_HANDLERS: frozenset[str] = frozenset({"_h_non_gating", "_h_never_executed"})
"""The executable layer's handlers that produce NO gate. Pin (a) checks this against each
family's declared `gates` flag in both directions, so a family cannot claim to gate while
being routed to a constant-True pass-through (which is how FILTER's 390 spine conditions
looked gating for the whole life of the defect), nor claim not to gate while being routed to
a real evaluator."""


def verify_dispatch_coverage(dispatch: dict[str, str]) -> list[Violation]:
    """(a) SINGLE SOURCE. Set equality, BOTH directions, between what FAMILY_META declares
    and what the executable layer routes.

    Direction 1 (declared but unrouted) catches a pointer the engine cannot act on.
    Direction 2 (routed but undeclared) is the one that matters most: a handler no
    FAMILY_META entry names is a SECOND ROUTER, and a second router is a second truth. The
    `if/elif b.type == ...` ladder this packet deletes was exactly that."""
    from src.engine.spec_family_bindings import FAMILY_META

    out: list[Violation] = []
    dispatch_keys = set(dispatch)
    declared: set[str] = set()
    owner: dict[str, str] = {}
    for family, meta in FAMILY_META.items():
        primitive, mechanism = meta.enforced_declaration()
        name = primitive or mechanism
        if name:
            declared.add(name)
            owner.setdefault(name, family)

    for name in sorted(declared - dispatch_keys):
        family = owner.get(name)
        out.append(Violation("a", family, f"declares {name!r} but the executable layer routes no such key"))
    for name in sorted(dispatch_keys - declared - EXPERIMENT_PRIMITIVES):
        out.append(
            Violation("a", None, f"executable layer routes {name!r}, which no FAMILY_META entry declares "
                                 "-- a second router is a second truth")
        )

    # gates <-> handler agreement, both directions. The declaration and the router must AGREE
    # about whether a condition can gate; a disagreement is the FILTER shape returning under a
    # different name (declared gating, routed to constant True).
    for family, meta in FAMILY_META.items():
        primitive, mechanism = meta.enforced_declaration()
        name = primitive or mechanism
        handler = dispatch.get(name or "")
        if handler is None:
            continue
        routed_non_gating = handler in NON_GATING_HANDLERS
        if routed_non_gating and meta.gates:
            out.append(
                Violation("a", family, f"declares gates=True but {name!r} routes to {handler!r}, which "
                                       "computes no gate")
            )
        elif not routed_non_gating and not meta.gates:
            out.append(
                Violation("a", family, f"declares gates=False but {name!r} routes to {handler!r}, a real "
                                       "evaluator")
            )
    return out


def collect_violations(dispatch: dict[str, str] | None = None) -> list[Violation]:
    """Every violation across every ACTIVE pin, collected rather than short-circuited so one
    load reports the whole truth instead of the first thing it tripped over."""
    pins = active_pins()
    out: list[Violation] = []
    if "b" in pins:
        out.extend(verify_primitives())
    if "b2" in pins:
        out.extend(verify_emit_subset_covered())
    if "a" in pins and dispatch is not None:
        out.extend(verify_dispatch_coverage(dispatch))
    return out


def enforcement_status(dispatch: dict[str, str] | None = None) -> dict:
    """Machine-readable status. Always reports which pins were SKIPPED, so a passing run
    made under a pin selector can never be read as "enforcement passed"."""
    pins = active_pins()
    violations = collect_violations(dispatch)
    return {
        "enforced": family_meta_enforced(),
        "pins_active": sorted(pins),
        "pins_skipped": sorted(set(ALL_PINS) - pins),
        "violations": [str(v) for v in violations],
        "ok": not violations,
    }


_ENFORCED_OK: bool = False


def ensure_enforced(dispatch: dict[str, str] | None = None, *, force: bool = False) -> None:
    """THE LOAD GATE. Called before any spec can be turned into an executable strategy.

    No-op when the flag is OFF (default) -- that is the byte-identity guarantee. When ON,
    raises FamilyMetaEnforcementError naming every violation. There is no fallback, no
    default, and no partial success: this function either returns or the engine does not
    start. `force=True` bypasses the once-only cache (tests, and any process that mutates
    FAMILY_META between checks)."""
    global _ENFORCED_OK
    if not family_meta_enforced():
        return
    if _ENFORCED_OK and not force:
        return
    violations = collect_violations(dispatch)
    if violations:
        pins = active_pins()
        skipped = sorted(set(ALL_PINS) - pins)
        header = (
            f"FAMILY_META ENFORCEMENT FAILED ({len(violations)} violation(s); "
            f"pins active={sorted(pins)}, pins SKIPPED={skipped}). "
            f"A declared primitive that does not resolve is a startup error, never a silent "
            f"fallback -- see docs/designs/packet-family-meta-enforced-2026-07-20.md."
        )
        raise FamilyMetaEnforcementError(header + "\n  " + "\n  ".join(str(v) for v in violations))
    _ENFORCED_OK = True


def reset_enforcement_cache() -> None:
    """Test-only. Clears the once-only success cache so a test can flip FAMILY_META or the
    env and re-run the gate in the same process."""
    global _ENFORCED_OK
    _ENFORCED_OK = False
