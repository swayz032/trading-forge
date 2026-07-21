"""family_meta_enforcement.py — the load-time gate that removes the engine's ability
to lie about what it runs (docs/designs/packet-family-meta-enforced-2026-07-20.md).

WHY THIS MODULE EXISTS. `spec_family_bindings.FAMILY_META` is the table every spec's
binding plan, every `approximation` flag, and every fidelity number is derived from. A
committed, measured sweep (docs/replay-results/h1-battery/family_meta_reachability_sweep.py,
n=2000 real ES 5min bars, corroborated over 120 corpus specs x 600 bars, all 7 positive
controls fired) found that of the 9 families declaring a real primitive, only 3 execute
it: 3 REACHABLE / 2 PARTIAL / 4 NOT-REACHABLE -- plus 2 families the sweep COULD NOT
VERIFY, which are ADDITIONAL to those 9, not a fourth slice of them. (This line previously
ran the four numbers together as one list, which reads as a 3+2+4+2=11 partition of a
9-member set; the sweep's own header says "plus 2".) The declaration was
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
      down: a resolver may not emit a VALUE its consumer cannot check. Convicting instance
      (CLOSED 2026-07-21 by packet-orphan-zone-closure-2026-07-21.md, Option A -- kept on the
      record because the check outlives the defect that motivated it): the WAIT_SESSION
      resolvers COULD emit 7 zones while `session_windows._ZONE_CHECKS` covered 5, so
      `lunch_blackout` / `overnight` WERE always-False gates wearing
      bindable=True, approximation=False, executed=True. Those two names no longer emit, so
      (b2) HOLDS and the engine loads under all pins; this check is what will say so if they
      -- or any sibling -- ever come back. Both sets are enumerated
      PROGRAMMATICALLY from the live objects the production code itself iterates -- never
      transcribed, because a transcribed set drifts silently and re-creates the very defect
      this check exists to catch.

  (c) HONEST ENTRIES  -- lives in FAMILY_META itself (see `FamilyMeta.enforced_*` and the
      table's per-entry notes), not here; this module only verifies the result.

GATING AND ROLLBACK. The LOAD GATE -- `ensure_enforced`, the only function that can stop a
process -- is behind `TF_FAMILY_META_ENFORCED` (default OFF). "Everything is behind the flag"
is what this line used to say and it was never true of this module: `active_pins()`,
`collect_violations()` and `enforcement_status()` are flag-independent readers/measurers by
design (the delta harness and the tests call them with the flag OFF; see the PIN SELECTOR
note below). Nothing they do can halt production; only `ensure_enforced` raises. Two-commit
law: enforcement lands here; any change to the default lands separately, and only on the grade.

WHAT THE FLAG-OFF GUARANTEE IS, STATED AT ITS ACTUAL STRENGTH. There is no artifact of the
pre-packet engine to diff against in-process, so "byte-identical to before this module
existed" is NOT something the test suite can establish, and this docstring previously claimed
it anyway. What IS established, by tests/test_family_meta_enforcement.py:
  - the flag-OFF `b.type` ladder is the code that runs, and the enforced dispatch path is not
    consulted at all (test_second_router_control_flag_off_ignores_the_repoint: re-pointing
    FAMILY_META changes NOTHING with the flag OFF);
  - the declarations flag-OFF production emits have not drifted from the legacy column
    (test_flag_off_declarations_are_unchanged, test_flag_off_binding_matches_the_legacy_column
    -- which compare against a HAND-TRANSCRIBED table, `LEGACY_DECLARATIONS`, and so detect
    drift in FAMILY_META, NOT identity against pre-commit code);
  - the flag-OFF PER-BAR ARRAYS equal the ladder branch's own output, are non-degenerate, and
    the entry signals derived from them match an independent recomputation
    (test_flag_off_per_bar_output_matches_the_ladder).
Each of the three carries a control showing it CAN fail. "Byte-identical" is not among them.

PIN SELECTOR -- READ THIS BEFORE USING IT, AND NOTE THAT ITS REASON HAS EXPIRED.
`TF_FAMILY_META_ENFORCED_PINS` restricts which pins run. It existed for ONE reason: pin (b2)
FAILED on the real orphan-zone gap, which the enforcement packet was explicitly scoped OUT of
fixing (that gap belonged to the session-resolver lane), so with all pins active the engine
correctly REFUSED TO LOAD and the acceptance sweep for pins (a)/(b)/(c) could not otherwise be
run at all.

*** THAT REASON IS GONE (2026-07-21, packet-orphan-zone-closure-2026-07-21.md). *** With all
pins active the engine now LOADS. The selector is therefore a TRANSITION INSTRUMENT WHOSE
TRANSITION IS OVER, and one left alone quietly becomes a default. Its expiry is ASSERTED, not
merely noted, by tests/test_family_meta_enforcement.py::test_pin_selector_reason_has_expired,
which fails with a rewrite message if anyone narrows the default regime again while (b2) is
clean. REMOVING the selector is a separate packet (it is public surface: the committed delta
harness and the tests both read it).

It is a MEASUREMENT SELECTOR, not an escape hatch.

*** WHAT IS CLAIMED HERE, AND AT WHAT STRENGTH. *** This paragraph used to open "Three
mechanical fences make 'silently ran nothing' IMPOSSIBLE" while enumerating FOUR bullets --
and a FIFTH path was then demonstrated anyway (lying mode 4: the success cache was blind to
the `dispatch` argument, so after one good load `ensure_enforced(<violating dispatch>)`
returned CLEAN). The miscount and the superlative failed together, which is the point: the
same sentence that could not count its own bullets was asserting a universal.

The word "impossible" is therefore GONE, and it is not coming back. `:152` records that this
selector's OWN previous docstring "promised was impossible" -- a rewrite that re-makes the
identical claim has learned nothing from the sentence it is replacing. What replaces it is a
claim with a checkable referent:

  EACH NAMED PATH BELOW IS FENCED BY A TEST THAT FAILS IF THE GUARD SILENTLY RUNS NOTHING.
  That is a statement about four enumerated paths and the tests that hold them. It is NOT a
  statement that no fifth path exists -- mode 4 was a fifth, and modes are found by grading,
  never by a docstring's confidence.

FOUR fenced paths (the count is four; each was a LIVE DEFECT found by grading, not a
hypothetical):
  1. an EMPTY selection RAISES. `PINS=","` (or `""`, or `" , "`) once parsed to the empty set,
     ran zero checks, and returned silently with `ok=True`. The variable must either be UNSET
     (all pins run) or name at least one pin.
     Fenced by test_d1_mode1_an_empty_pin_selection_raises_instead_of_running_nothing.
  2. a NAMED-BUT-UNEVALUABLE pin RAISES. Pin (a) needs a dispatch map; `collect_violations`
     used to skip it whenever `dispatch is None` while `enforcement_status()` went on
     reporting it as active and `ok=True`. A pin that is named is evaluated or the call fails.
     Fenced by test_d1_mode2_a_named_pin_that_cannot_be_evaluated_raises.
  3. NO SUCCESS CACHE EXISTS. There is nothing to key, so there is nothing to key WRONGLY.
     The history is the argument: the cache was a bare `_ENFORCED_OK` bool (mode 3 -- a pass
     under `PINS=a` vouched for a later all-pins load); the repair keyed it on the pin set;
     and THAT REPAIR GREW MODE 4, because the new key still ignored `dispatch`. Two lying
     modes in one variable, the second created by the fix for the first. The guard now RUNS
     EVERY CALL. A cache on a truth-check is a place for lies to sleep.
     Fenced by test_d1_mode3_a_narrow_pass_does_not_vouch_for_a_broader_run and
     test_d1_mode4_the_guard_re_evaluates_the_dispatch_argument_on_every_call.
  4. an unrecognized pin name RAISES (a typo must not disable a check while looking like it
     enabled one), and the skipped pins are recorded in `enforcement_status()` and printed in
     any raised error.
     Fenced by test_pin_selector_rejects_an_unknown_pin.
`active_pins()` is a pure reader of the environment and IS callable with the flag OFF (the
delta harness and the tests both do so); what is gated on the flag is `ensure_enforced`.
The honest reading of a run made with this variable set is "pins a,b held; pin b2 was not
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
    fallback.

    CATCHING RULE, RESTATED ACCURATELY (D6 sweep). This used to say flatly "Callers MUST NOT
    catch this", and the packet's own committed harness
    (docs/replay-results/h1-battery/family_meta_enforcement_delta.py::run_arm) catches it in a
    broad `except Exception` — so the absolute form was already false of the code shipped
    beside it. The real rule is the one that harness actually honours: this error may be
    caught ONLY to RECORD it as a result (run_arm stores the repr and marks the spec's signals
    -1). It may never be caught to CONTINUE AS IF IT HAD NOT HAPPENED — no substituting a
    default, no falling through to a pass-through array, no logging-and-skipping. A caught-
    and-recorded failure is a measurement; a caught-and-absorbed one is the defect."""


def family_meta_enforced() -> bool:
    """Read at call time (not cached at import), same live-read contract as every other
    flag in this codebase (fvg_identity_enabled, levelzone_routing_enabled, ...) -- lets a
    before/after comparison run in the SAME process."""
    return os.environ.get(FLAG_ENV, "false").strip().lower() == "true"


def active_pins() -> frozenset[str]:
    """The pins that will actually be evaluated. UNSET (the normal case) => ALL of them.

    LYING MODE 1, FENCED. Absent and present-but-empty are NOT the same thing and must not be
    collapsed. `PINS=","` parsed to the empty set, `unknown` was then also empty so nothing
    raised, `collect_violations` ran no check, and `ensure_enforced` returned silently with
    enforcement nominally ON -- the precise "silently skip EVERY pin" this selector's own
    docstring promised was impossible. So: if the variable is PRESENT it must NAME at least
    one pin. To run everything, UNSET it; there is no empty-string spelling for "all".

    An unrecognized pin name is likewise an error, not a silent no-op: a typo would otherwise
    disable a check while looking like it enabled one."""
    if PINS_ENV not in os.environ:
        return frozenset(ALL_PINS)
    raw = os.environ[PINS_ENV]
    names = frozenset(p.strip().lower() for p in raw.split(",") if p.strip())
    if not names:
        raise FamilyMetaEnforcementError(
            f"{PINS_ENV} is set to {raw!r}, which names NO pin. An empty or malformed pin "
            f"selection would run zero checks while enforcement reports ON -- that is the "
            f"defect this fence exists to delete. UNSET {PINS_ENV} to run all pins "
            f"{list(ALL_PINS)}, or name at least one."
        )
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
    load reports the whole truth instead of the first thing it tripped over.

    LYING MODE 2, FENCED. Pin (a) is the only pin that needs an argument. The guard used to
    read `if "a" in pins and dispatch is not None`, so a caller passing no dispatch silently
    dropped pin (a) while `active_pins()` -- and therefore `enforcement_status()` -- went on
    reporting it ACTIVE, `pins_skipped` omitted it, and `ok` came back True over a live
    second-router violation (verified: a planted orphan dispatch key was reported as 1
    violation with the map and 0 without it). A pin that is NAMED is EVALUATED, or the call
    raises. "Not evaluable here" is not a quiet pass."""
    pins = active_pins()
    if "a" in pins and dispatch is None:
        raise FamilyMetaEnforcementError(
            f"pin (a) is active but no dispatch map was supplied, so it CANNOT be evaluated. "
            f"Skipping it here would report a pin as active while running nothing. Pass the "
            f"executable layer's dispatch, or name only the pins you can evaluate via "
            f"{PINS_ENV} (active={sorted(pins)})."
        )
    out: list[Violation] = []
    if "b" in pins:
        out.extend(verify_primitives())
    if "b2" in pins:
        out.extend(verify_emit_subset_covered())
    if "a" in pins:
        assert dispatch is not None  # guarded above
        out.extend(verify_dispatch_coverage(dispatch))
    return out


def enforcement_status(dispatch: dict[str, str] | None = None) -> dict:
    """Machine-readable status. Always reports which pins were SKIPPED, so a passing run made
    under a pin selector can never be read as "enforcement passed".

    That claim was FALSE until this wave in two ways, both now fenced upstream in
    `active_pins()` / `collect_violations()` rather than here: an empty selection reported
    `pins_active=[]` with `ok=True`, and a dispatch-less call reported pin (a) ACTIVE while
    never running it. This function is a reporter; it is honest because the things it reports
    on now raise instead of degrading. `ok` means "every pin in `pins_active` RAN and found
    nothing" -- it never means "enforcement passed"."""
    pins = active_pins()
    violations = collect_violations(dispatch)
    return {
        "enforced": family_meta_enforced(),
        "pins_active": sorted(pins),
        "pins_skipped": sorted(set(ALL_PINS) - pins),
        "violations": [str(v) for v in violations],
        "ok": not violations,
    }


# ─── THERE IS NO SUCCESS CACHE. THIS IS THE DESIGN, NOT AN OMISSION. ────────────────────
#
# FOUR lying modes lived in the success cache that used to sit here, and the LAST TWO ARE THE
# STORY:
#   mode 3 -- `_ENFORCED_OK` was a bare bool. A pass under `PINS=a` warmed it and a later
#             ALL-PINS load returned clean without running (b) or (b2) at all: the narrow run
#             vouched for the broad one.
#   mode 4 -- THE FIX FOR MODE 3 GREW IT. Keying the cache on the PIN SET closed mode 3 and
#             left the cache blind to the `dispatch` ARGUMENT, so after one good all-pins load
#             `ensure_enforced(<violating dispatch>)` RETURNED CLEAN while a direct
#             `verify_dispatch_coverage` on the same map reported 1 violation. It fired on the
#             production object too: mutate `ENFORCED_DISPATCH` in place, reload, clean. The
#             guard whose whole stated job is "a second router is a second truth" was
#             FIRST-LOAD-ONLY.
#
# The repair for mode 4 is NOT a third key. A key must cover everything that varies, and the
# next thing that varies is the thing nobody has thought of yet -- that is precisely how mode 4
# arrived out of the mode-3 repair. So the cache is DELETED and the guard RUNS EVERY CALL.
#
# THE COST, MEASURED RATHER THAN ASSUMED (the only thing that could justify bringing a cache
# back). All-pins `collect_violations()` = 14.9 us/call, mean over 2000 calls, system CPython
# 3.13 on the tower. `ensure_enforced` uncached = 15.8 us/call vs 0.9 us/call on a cache hit,
# so the cache was buying ~14.9 us. There is ONE production call site
# (spec_condition_compiler.py, once per SpecConditionStrategy construction), which puts the
# whole 120-spec shakedown corpus at under 2 ms. Nothing here forces a cache back.
#
# IF A FUTURE MEASUREMENT EVER DOES force one back, it must key on EVERYTHING THAT VARIES --
# the pin set AND a fingerprint of `dispatch` -- and it must ship with a mode-5 red-proof that
# genuinely attempts a fifth lie against the new key. Cheap truth beats fast falsehood.


def ensure_enforced(dispatch: dict[str, str] | None = None) -> None:
    """THE LOAD GATE. Called before any spec can be turned into an executable strategy.

    No-op when the flag is OFF (default) -- that is the rollback guarantee. When ON, raises
    FamilyMetaEnforcementError naming every violation. There is no fallback, no default, no
    partial success, and NO CACHE: every ACTIVE pin is evaluated against the dispatch map
    ACTUALLY PASSED, on EVERY call. See the block above for the four lying modes that bought
    this property and the measurement that says it is affordable."""
    if not family_meta_enforced():
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
    # Nothing is recorded. A pass means "these pins ran, on this dispatch, just now" and it is
    # not carried forward to vouch for any later call -- that carrying-forward WAS modes 3 & 4.


def reset_enforcement_cache() -> None:
    """RETAINED AS A NO-OP, DELIBERATELY. There is no success cache to reset any more (see the
    block above `ensure_enforced`), so this function has nothing to do -- and that is exactly
    what it should say rather than being deleted and breaking its callers.

    It is kept for two reasons. (1) COMPATIBILITY: the committed delta harness
    (docs/replay-results/h1-battery/family_meta_enforcement_delta.py) and the test module both
    call it between arms; removing the name would be an unrelated public-surface break inside
    a scope-locked wave. (2) TRIPWIRE: if anyone ever reintroduces a cache on a measured cost,
    this is the function they must make real again, and its callers are the list of places
    that already assume a reset point exists.

    Calling it is harmless and is NOT required for correctness: the gate re-evaluates every
    pin against the dispatch actually passed on every call, so a test that mutates FAMILY_META
    or the environment is already seen without any reset."""
    return
