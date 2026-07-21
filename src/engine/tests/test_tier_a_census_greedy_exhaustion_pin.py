"""THE EXHAUSTION-LOOP PIN: tier_a_compile_census.py's greedy ranking must not stop at a plateau.

★ WHAT IS LOAD-BEARING, AND WHY NO COMMENT CAN PROTECT IT.
`tier_a_compile_census.py` builds its cumulative wiring order with

    while len(fixed) < len(fams):
        best = max(...)

-- EXHAUSTION. It keeps adding families even when the next addition completes ZERO further
specs. A sibling artifact's generator (`docs/replay-results/classifier-fix/ladder_recompute.py`)
used the other form, break-on-no-improvement, and that difference is not cosmetic here:

  * In the `all` scope of the LIVE corpus, EVERY ONE of the five wireable families completes
    0 specs alone, and the first FOUR greedy additions also complete 0. Only the fifth --
    WAIT_STRUCTURE, added last -- completes 2. A break-on-no-improvement loop exits on the
    FIRST addition and publishes a ceiling of **0**, i.e. "no combination of families completes
    any spec", which is FALSE: two specs complete.
  * In the `spine` scope the two forms agree (both reach 2), because the first addition already
    improves. ★ SO THE DEFECT IS INVISIBLE IN THE SPINE SCOPE. A pin written against spine
    alone would be green while the `all` scope published a plateau as the ceiling. Both scopes
    are recomputed below for exactly that reason.

★ WHY A TEST AND NOT A COMMENT. No gate reaches a comment. A refactor that "tidies" this loop
into break-on-no-improvement -- a change that looks like a pure optimization, and which a
sibling generator in this repo already shipped -- would silently republish 0 as the ceiling
with every other check in the census still green. This pin makes that refactor RED AT BIRTH.

FIXTURE: the LIVE published artifact is its own fixture. The per-spec `conditions` it publishes
are re-run through a reimplementation of the census's own `_blockers` under BOTH loop semantics.
Nothing is transcribed from the brief and no number below is typed: every figure is computed
from the artifact at test time.
"""
from __future__ import annotations

import ast
import json
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
GENERATOR = REPO_ROOT / "docs" / "replay-results" / "h1-battery" / "tier_a_compile_census.py"
ARTIFACT = REPO_ROOT / "docs" / "replay-results" / "h1-battery" / "tier-a-compile-census.json"

# Mirrors tier_a_compile_census.UNWIREABLE_FAMILIES. Read from the generator source below
# rather than trusted as a literal, so a change there cannot silently desynchronize this pin.
SCOPES = ("spine", "all")


def _load_artifact() -> dict:
    if not ARTIFACT.exists():
        pytest.skip(f"census artifact absent: {ARTIFACT}")
    return json.loads(ARTIFACT.read_text(encoding="utf-8"))


def _unwireable_from_generator() -> set[str]:
    """Read UNWIREABLE_FAMILIES out of the generator's AST instead of retyping it."""
    tree = ast.parse(GENERATOR.read_text(encoding="utf-8"))
    # Module-level string constants, so a set built from NAMES (the live form is
    # `UNWIREABLE_FAMILIES = {UNTYPED_LABEL}`) resolves instead of raising.
    consts: dict[str, str] = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant) \
                and isinstance(node.value.value, str):
            for t in node.targets:
                if isinstance(t, ast.Name):
                    consts[t.id] = node.value.value
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id == "UNWIREABLE_FAMILIES":
                    out = set()
                    for elt in node.value.elts:
                        if isinstance(elt, ast.Constant):
                            out.add(elt.value)
                        elif isinstance(elt, ast.Name):
                            assert elt.id in consts, (
                                f"UNWIREABLE_FAMILIES references `{elt.id}`, which is not a "
                                "module-level string constant this reader can resolve."
                            )
                            out.add(consts[elt.id])
                        else:
                            raise AssertionError(
                                "UNWIREABLE_FAMILIES contains an element this reader cannot "
                                f"resolve: {ast.unparse(elt)}"
                            )
                    return out
    raise AssertionError(
        "UNWIREABLE_FAMILIES not found as a module-level assignment in "
        f"{GENERATOR.name}. This pin reads it from source rather than retyping it; if the "
        "name moved, update the reader -- do not hardcode the set."
    )


def _blockers(spec: dict, fixed: set[str], scope: str) -> set[str]:
    """Reimplementation of tier_a_compile_census._blockers against the published conditions."""
    out = set()
    for c in spec["conditions"]:
        if scope == "spine" and not c["load_bearing_spine"]:
            continue
        if c["bind_status"] != "BINDS" and c["type"] not in fixed:
            out.add(c["type"])
    return out


def _families(specs: list[dict], scope: str, unwireable: set[str]) -> list[str]:
    return sorted({c["type"]
                   for s in specs for c in s["conditions"]
                   if c["bind_status"] != "BINDS"
                   and (scope == "all" or c["load_bearing_spine"])} - unwireable)


def _completed(specs: list[dict], fixed: set[str], scope: str) -> int:
    return sum(1 for s in specs if not _blockers(s, fixed, scope))


def _greedy(specs: list[dict], scope: str, unwireable: set[str],
            break_on_no_improvement: bool) -> list[tuple[str, int]]:
    fams = _families(specs, scope, unwireable)
    fixed: set[str] = set()
    order: list[tuple[str, int]] = []
    prev = 0
    while len(fixed) < len(fams):
        best = max((f for f in fams if f not in fixed),
                   key=lambda f: _completed(specs, fixed | {f}, scope))
        cum = _completed(specs, fixed | {best}, scope)
        if break_on_no_improvement and cum <= prev:
            break
        fixed.add(best)
        order.append((best, cum))
        prev = cum
        if cum == len(specs):
            break
    return order


def _ceiling(order: list[tuple[str, int]]) -> int:
    return order[-1][1] if order else 0


# --------------------------------------------------------------------------------------
# Guard the guard: the two loop forms must actually disagree on the live corpus, or this
# whole file passes vacuously and protects nothing.
# --------------------------------------------------------------------------------------
def test_the_two_loop_forms_actually_disagree_on_the_live_corpus():
    """★ If exhaustion and break-on-no-improvement agreed everywhere, this pin would be a
    no-op that reports green forever. The disagreement is the reason the loop form is
    load-bearing, so it is asserted, not assumed."""
    d = _load_artifact()
    specs, unw = d["specs"], _unwireable_from_generator()
    disagreements = {}
    for scope in SCOPES:
        ex = _ceiling(_greedy(specs, scope, unw, break_on_no_improvement=False))
        br = _ceiling(_greedy(specs, scope, unw, break_on_no_improvement=True))
        if ex != br:
            disagreements[scope] = (ex, br)
    assert disagreements, (
        "exhaustion and break-on-no-improvement produce the SAME ceiling in every scope of "
        f"the current corpus (scopes checked: {list(SCOPES)}, n_specs={len(specs)}). This pin "
        "is therefore vacuous against this corpus. That is a finding about the FIXTURE, not a "
        "licence to change the loop: recheck the corpus, do not delete this file."
    )


@pytest.mark.parametrize("scope", SCOPES)
def test_published_greedy_order_matches_exhaustion_semantics(scope: str):
    """The artifact on disk must be the EXHAUSTION result, family-for-family.

    Boundary printed with the verdict: this compares the published `greedy_cumulative` to a
    recomputation from the artifact's OWN per-spec conditions. It cannot detect a defect that
    corrupts those conditions -- it detects only a change in the RANKING LOOP.
    """
    d = _load_artifact()
    specs, unw = d["specs"], _unwireable_from_generator()
    published = [(r["add_family"], r["cumulative_specs_fully_binding"])
                 for r in d["reaim_analysis"][scope]["greedy_cumulative"]]
    exhaustion = _greedy(specs, scope, unw, break_on_no_improvement=False)
    truncated = _greedy(specs, scope, unw, break_on_no_improvement=True)
    assert published == exhaustion, (
        f"scope={scope}: the published greedy order is NOT the exhaustion result.\n"
        f"  published   : {published}\n"
        f"  exhaustion  : {exhaustion}\n"
        f"  break-on-no-improvement (the WRONG form): {truncated}\n"
        f"  boundary    : recomputed from the artifact's own {len(specs)} published specs; "
        f"unwireable families excluded = {sorted(unw)}\n"
        "If `published` equals the break-on-no-improvement line, the census loop was "
        "refactored to stop at the first non-improving addition and is now publishing a "
        "PLATEAU AS THE CEILING. Restore `while len(fixed) < len(fams)`."
    )


@pytest.mark.parametrize("scope", SCOPES)
def test_census_does_not_publish_the_plateau_as_the_ceiling(scope: str):
    """THE NAMED FAILURE. The published ceiling must equal the exhaustion ceiling; and where
    the two forms differ it must NOT equal the truncated one."""
    d = _load_artifact()
    specs, unw = d["specs"], _unwireable_from_generator()
    published_order = [(r["add_family"], r["cumulative_specs_fully_binding"])
                       for r in d["reaim_analysis"][scope]["greedy_cumulative"]]
    published_ceiling = _ceiling(published_order)
    exhaustion_ceiling = _ceiling(_greedy(specs, scope, unw, break_on_no_improvement=False))
    truncated_ceiling = _ceiling(_greedy(specs, scope, unw, break_on_no_improvement=True))
    assert published_ceiling == exhaustion_ceiling, (
        f"scope={scope}: PLATEAU PUBLISHED AS CEILING. The census says the best achievable "
        f"number of fully-binding specs is {published_ceiling}; exhausting every wireable "
        f"family reaches {exhaustion_ceiling} (of {len(specs)} specs).\n"
        f"  break-on-no-improvement would publish: {truncated_ceiling}\n"
        f"  boundary: wireable families in this scope = "
        f"{_families(specs, scope, unw)}; excluded unwireable = {sorted(unw)}\n"
        "WHY THE LOOP FORM IS LOAD-BEARING: in the `all` scope of this corpus every family "
        "completes 0 specs ALONE and the first four greedy additions also complete 0 -- the "
        "gain arrives only on the final addition. A loop that stops when an addition does not "
        "improve therefore reports 'nothing can be completed' about a corpus in which specs "
        "CAN be completed. Exhaustion is not an inefficiency to be optimized away; it is the "
        "only form that finds a payoff behind a plateau."
    )


def test_the_generator_loop_is_still_exhaustive_in_source():
    """★ THE ARTIFACT-BASED PINS ABOVE ONLY FIRE ONCE THE ARTIFACT IS REGENERATED. A refactor
    committed without a regeneration would leave them green against a stale file. This one
    reads the SOURCE: the greedy `while` must be bounded by family exhaustion, and the only
    early exit permitted is the corpus-complete short-circuit."""
    tree = ast.parse(GENERATOR.read_text(encoding="utf-8"))
    whiles = [n for n in ast.walk(tree)
              if isinstance(n, ast.While) and "len(fixed)" in ast.unparse(n.test)]
    assert len(whiles) == 1, (
        f"expected exactly 1 greedy `while len(fixed) ...` loop in {GENERATOR.name}, "
        f"found {len(whiles)}. The pin locates the loop structurally; if the loop was "
        "renamed or duplicated, update this locator deliberately."
    )
    loop = whiles[0]
    test_src = ast.unparse(loop.test)
    assert test_src == "len(fixed) < len(fams)", (
        f"the greedy loop's bound is now `{test_src}`, not `len(fixed) < len(fams)`. "
        "EXHAUSTION over the family set is the load-bearing property -- see this module's "
        "docstring for the 0-vs-2 plateau it prevents."
    )
    breaks = [n for n in ast.walk(loop) if isinstance(n, ast.Break)]
    assert len(breaks) == 1, (
        f"the greedy loop contains {len(breaks)} `break` statements; exactly one (the "
        "corpus-complete short-circuit) is permitted. An extra break is how "
        "break-on-no-improvement gets reintroduced."
    )
    guards = [ast.unparse(n.test) for n in ast.walk(loop)
              if isinstance(n, ast.If) and any(isinstance(x, ast.Break) for x in ast.walk(n))]
    assert guards and "len(specs)" in guards[0], (
        f"the single permitted break is guarded by `{guards}`, which does not compare against "
        "`len(specs)`. The ONLY legal early exit is 'the whole corpus is complete'. A break "
        "guarded by a no-improvement comparison publishes a plateau as the ceiling."
    )
