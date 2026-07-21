"""★ THE PIN / AXIS-COLLISION CENSUS (H1-W4 D3), applied retroactively to every pin.

THE FINDING THAT MINTED IT. Last wave a pin froze `graded_genuine_session_teachings_A` inside
the gated acknowledgment -- a value AXIS 3 (SESSION_GRADE_REALLOCATION) exists to MOVE. A pin
that freezes a value an axis must move DISABLES that axis: the perturbed build stays green while
the acknowledgment silently describes a split the axis has already changed. It was given a
mirror repair (_axis_session_acknowledged_pair). ★ PINS OWE AN AXIS-COLLISION CHECK AT BIRTH;
this is that check, applied to the pins already in the file.

WHAT A PIN IS HERE. A frozen copy of a quantity some axis moves. If the copy is not moved in
lockstep (a "mirror repair"), the axis's consistency closure is either broken (a guard fires --
good, the collision is caught) or silently violated (no guard -- the pin has disarmed the axis).

WHY ISOLATION MATTERS -- THE GAP THE EXISTING CENSUS LEAVES. The generator's own
assert_discrimination_census withholds ALL of an axis's repairs AT ONCE (one global
_WITHHOLD_REPAIRS). Axis 3 has TWO mirror-pins; withholding both together and seeing SOME guard
fire does NOT prove EACH pin is independently guarded. This census withholds ONE mirror at a
time -- keeping the others applied -- and asks whether a guard still fires. A pin whose mirror
fires nothing when withheld ALONE is a pin whose collision is caught only by its neighbour, and
that is a corpse waiting to happen the day the neighbour moves.

HOW (no generator edit). It imports the module and, per mirror site, forces THAT site into its
withheld branch for the duration of one build, exactly as the module's own perturbed_binding
patches the engine reference -- an external, restored-in-finally monkeypatch. Nothing is
written to the generator or to any artifact.

    python pin_axis_collision_census.py
Exit 0 always: a census refuses to guess, not to publish. The verdicts are the finding.
"""
from __future__ import annotations

import ast
import contextlib
import io
import importlib.util
import json
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
TARGET = HERE / "dual_denominator_remeasure.py"
OUT = HERE / "pin-axis-collision-census.json"

spec = importlib.util.spec_from_file_location("ddr_d3", TARGET)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


# --------------------------------------------------------------------------------------------
# STEP 1 -- ENUMERATE THE PINS FROM THE AST, not from a hand list. A pin/repair site is a
# module-level function that both gates on _axis_is(...) and carries an `if _WITHHOLD_REPAIRS`
# branch: the applied branch moves a copy, the withheld branch is the injected defect. The axis
# it belongs to and the fields it mutates are read off the tree.
# --------------------------------------------------------------------------------------------
def enumerate_pins() -> list[dict]:
    tree = ast.parse(TARGET.read_text(encoding="utf-8"))
    axis_const = {n.targets[0].id: n.value.value
                  for n in tree.body if isinstance(n, ast.Assign)
                  and isinstance(n.targets[0], ast.Name)
                  and n.targets[0].id.startswith("AXIS_")
                  and isinstance(n.value, ast.Constant)}
    pins = []
    for fn in tree.body:
        if not isinstance(fn, ast.FunctionDef):
            continue
        body = ast.unparse(fn)
        if "_axis_is(" not in body or "_WITHHOLD_REPAIRS" not in body:
            continue
        axes = sorted({n.args[0].id for n in ast.walk(fn)
                       if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
                       and n.func.id == "_axis_is" and n.args and isinstance(n.args[0], ast.Name)})
        # fields the applied branch mutates: subscript/attribute targets of aug/assign
        fields = sorted({
            ast.unparse(t) for node in ast.walk(fn)
            for t in ([node.target] if isinstance(node, ast.AugAssign)
                      else getattr(node, "targets", []))
            if isinstance(t, (ast.Subscript, ast.Attribute))
        })
        # classify: a MIRROR pin moves a COPY (+=/-= on a field); a SELECTION repair chooses a
        # different element to perturb (no copy field, differs by which item it drops/appends).
        is_mirror = any(isinstance(n, ast.AugAssign) for n in ast.walk(fn))
        pins.append({
            "site": fn.name, "line": fn.lineno,
            "axis_constant": axes,
            "axis_value": [axis_const.get(a, a) for a in axes],
            "mutated_fields": fields,
            "class": "MIRROR_PIN" if is_mirror else "SELECTION_REPAIR",
        })
    return pins


def _build(axis, patch_site=None):
    """Build the artifact under `axis`; if patch_site is given, force ONLY that mirror site into
    its withheld branch (others applied). Returns (outcome, raising_guard_line, raising_msg)."""
    f = io.StringIO()
    orig = None
    if patch_site is not None:
        orig = getattr(m, patch_site)

        def wrapper(*a, **k):
            prev = m._WITHHOLD_REPAIRS
            m._WITHHOLD_REPAIRS = True          # take the withheld branch for THIS call only
            try:
                return orig(*a, **k)
            finally:
                m._WITHHOLD_REPAIRS = prev
        setattr(m, patch_site, wrapper)
    try:
        with contextlib.redirect_stdout(f):
            m.build_artifact(axis)
        return ("NO_GUARD_FIRED", None, None)
    except AssertionError as e:
        return ("ASSERT_FIRED", _guard_line(e), str(e)[:160])
    except SystemExit as e:
        return ("REFUSED_exit%s" % e.code, _guard_line(e), str(e)[:160])
    except Exception as e:
        return ("BUILD_ERROR:%s" % type(e).__name__, _guard_line(e), str(e)[:160])
    finally:
        if orig is not None:
            setattr(m, patch_site, orig)


def _guard_line(exc: BaseException) -> int | None:
    for fr in reversed(traceback.extract_tb(exc.__traceback__)):
        if Path(fr.filename).resolve() == TARGET.resolve():
            return fr.lineno
    return None


def main() -> int:
    pins = enumerate_pins()

    # baseline: every axis builds clean with ALL repairs applied (no uncaught collision at HEAD)
    axis_applied = {}
    for ax in m.AXES:
        f = io.StringIO()
        try:
            with contextlib.redirect_stdout(f):
                m.build_artifact(ax)
            axis_applied[ax] = "CLEAN"
        except BaseException as e:  # noqa: BLE001
            axis_applied[ax] = f"{type(e).__name__}: {str(e)[:120]}"

    for pin in pins:
        # each pin can name >1 axis constant, but in this file each names exactly one
        results = []
        for axval in pin["axis_value"]:
            outcome, gline, msg = _build(axval, patch_site=pin["site"])
            results.append({
                "axis": axval,
                "withholding_ONLY_this_mirror": outcome,
                "guard_that_fired_line": gline,
                "guard_message_head": msg,
                "mirror_INDIVIDUALLY_load_bearing": outcome != "NO_GUARD_FIRED"
                and not outcome.startswith("BUILD_ERROR"),
            })
        pin["ISOLATED_WITHHOLD"] = results
        pin["has_a_mirror"] = True  # by construction: it IS a repair site
        pin["mirror_individually_verified"] = all(
            r["mirror_INDIVIDUALLY_load_bearing"] for r in results)

    mirrors = [p for p in pins if p["class"] == "MIRROR_PIN"]
    # per-axis: how many mirror-pins share it (the isolation gap the aggregate census cannot see)
    by_axis: dict[str, list[str]] = {}
    for p in mirrors:
        for a in p["axis_value"]:
            by_axis.setdefault(a, []).append(p["site"])

    census = {
        "WHAT_THIS_IS": (
            "Every pin/repair site in the generator, the axis each freezes a value against, and "
            "whether its mirror fires a guard when withheld ALONE -- the collision check the "
            "founding pin (the gated acknowledgment, AXIS 3) was given retroactively, applied to "
            "all pins. A mirror only proven load-bearing when withheld TOGETHER with a sibling "
            "is reported as jointly-verified, not individually -- that distinction is the point."
        ),
        "n_pins_examined_THE_DENOMINATOR": len(pins),
        "n_MIRROR_PINS": len(mirrors),
        "n_SELECTION_REPAIRS": len(pins) - len(mirrors),
        "axes_with_multiple_mirror_pins": {a: v for a, v in by_axis.items() if len(v) > 1},
        "every_axis_builds_clean_with_repairs_applied": axis_applied,
        "pins": pins,
        "SUMMARY": {
            "all_pins_have_a_mirror": all(p["has_a_mirror"] for p in pins),
            "all_mirrors_individually_verified": all(
                p["mirror_individually_verified"] for p in pins),
            "pins_NOT_individually_verified": [
                {"site": p["site"], "axis": p["axis_value"],
                 "isolated": p["ISOLATED_WITHHOLD"]}
                for p in pins if not p["mirror_individually_verified"]
            ],
        },
    }
    OUT.write_text(json.dumps(census, indent=1), encoding="utf-8", newline="\n")
    print(f"pins examined (DENOMINATOR): {census['n_pins_examined_THE_DENOMINATOR']} "
          f"= {census['n_MIRROR_PINS']} mirror-pins + {census['n_SELECTION_REPAIRS']} selection-repairs")
    print(f"axes with >1 mirror-pin: {census['axes_with_multiple_mirror_pins']}")
    print(f"all mirrors individually load-bearing when withheld ALONE: "
          f"{census['SUMMARY']['all_mirrors_individually_verified']}")
    for p in census["SUMMARY"]["pins_NOT_individually_verified"]:
        print(f"  NOT INDIVIDUALLY VERIFIED: {p['site']} on {p['axis']}")
        for r in p["isolated"]:
            print(f"     {r['axis']}: {r['withholding_ONLY_this_mirror']}")
    print(f"written: {OUT.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
