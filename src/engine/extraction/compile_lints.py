"""H1 certificate compile-integrity lints (pre-reg §4 `compile_integrity` block).

Implements the 5 lints named FROZEN by `docs/designs/phase-1-h1-preregistration-
2026-07-12.md` §4 and re-confirmed by `docs/designs/h1-pilot-preregistration-
2026-07-12.md` §6 (schema unchanged; only `classifying_tier` amended elsewhere):
  direction_conflation_lint, unsat_sat_check, or_alternatives_honored,
  f2_coverage_gate, causality_lint.

Each lint is a pure function `(CompiledSpine, full_transcript) -> LintResult`.
No I/O, no randomness, no vectorbt import (this module and everything it
imports is safe under pytest collection per CLAUDE.md's JIT-hang caveat --
verified by `python -c "import time,src.engine.spec_family_bindings"` timing
clean and `sys.modules` never gaining `vectorbt`).

ANTI-DUPLICATION DISCIPLINE (operator directive, load-bearing): this repo has a
named liability of the SAME correctness check re-implemented at multiple
layers and drifting (>=4 drift sites on record). Per lint below, the semantic
is either REUSED (a real Python authority is imported and invoked) or
PARITY-FIXTURED (the authority lives in a different layer/language with no
importable Python function, so `fixtures/compile_lint_birth_fixtures.json`
pins shared cases the lint must agree with, so a silent drift trips a test,
not just a doc). Ledger:

  direction_conflation_lint  PARITY-FIXTURED  docs/designs/mode-ab-G4-validity-
                              block-2026-07-11.md:76-77,223,386 (the
                              `and_group0` type-specimen: `331fe15a`'s
                              5-SMA-cross-above-50+long AND 5-SMA-cross-
                              below-50+short conflation). No importable Python
                              checker exists for this (spec_condition_compiler.
                              py EXECUTES and_groups, it does not lint them);
                              the finding-doc's own named incident IS the
                              authority, so its exact structure is the parity
                              fixture.
  unsat_sat_check             PARITY-FIXTURED  same doc, line 386 ("5-SMA
                              cannot be simultaneously above and below
                              50-SMA" = unsatisfiable AND), PLUS the
                              never-true-sentinel EXEMPTION from
                              `src/agents/kb/anti-pattern-catalog.md:110-116`
                              (`high < low` with a disabled direction is a
                              deliberate marker, not a contradiction -- must
                              stay SILENT). Both are KB/finding docs with no
                              importable Python function.
  or_alternatives_honored     REUSED  `src.engine.spec_family_bindings.
                              or_branches_enabled()` (spec_family_bindings.py
                              :146) -- the actual flag that gates whether
                              spec_condition_compiler.py folds an or_branches
                              group into ANY-holds or leaves every member a
                              separate AND term. This mirrors
                              `scripts/or-branches-ccr.py`'s own reuse pattern
                              (its docstring: "Reused: src.engine.
                              spec_family_bindings.compile_binding_plan") --
                              same authority, invoked at cert-assembly time
                              instead of corpus-audit time.
  f2_coverage_gate            PARITY-FIXTURED  `src/server/lib/extraction-
                              coverage-gate.ts` (`classify()`/`nameInUnit`,
                              the F-2 fix) + `docs/designs/F4-eligibility-
                              bypass-trace-2026-07-07.md:237-309` (the
                              collision-class adversarial cases: range/
                              arranged, trend/trending, band/bandana, cross/
                              across, order/disorder). TS, not Python --
                              cannot import. NOTE (honesty, not just
                              citation): the TS file's CURRENT `nameInUnit`
                              (extraction-coverage-gate.ts:483-485) still uses
                              `.includes()` substring matching -- the doc's own
                              record shows the exact-token remediation was
                              SPECIFIED but never applied (F-2 review FAILED,
                              left `defect-candidate`). This lint parity-
                              fixtures against the SPECIFIED correct word-
                              boundary semantic (the bug CLASS both docs
                              agree is wrong), not the still-buggy current TS
                              code -- flagged here so nobody later assumes a
                              green parity test means the TS file matches.
  causality_lint               PARITY-FIXTURED (verbatim port)  `src/agents/
                              kb/anti-pattern-catalog.md:88-96`
                              (`detectLookAheadBias`'s `impossibleRefs` regex
                              and `sameBarOptOut` check). That function is JS
                              example code embedded in a markdown KB card, not
                              a real .ts file -- no import target exists. The
                              regex alternation below is a byte-for-byte port
                              of the KB doc's pattern (same literals, same
                              order), and the engine's own +1-bar np.roll
                              contract (`src/engine/backtester.py:70-100`,
                              NOT imported here per the no-vectorbt-chain
                              constraint) is cited, not executed.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from src.engine.spec_family_bindings import or_branches_enabled

# --------------------------------------------------------------------------- #
# Input contract
# --------------------------------------------------------------------------- #


@dataclass
class SpineCondition:
    """One certificate spine condition, as seen by the compile-integrity
    layer. `condition_id`/`role`/`and_group`/`comparator` are the minimal
    structural overlay the 5 lints need on top of the tier-1/tier-3 anchor
    fields (surface_class/classifying_tier live on the cert entry itself,
    see cert_assembler.py -- this dataclass carries only what a lint reads)."""

    condition_id: str
    quote_anchor: str
    char_span: Tuple[int, int]
    direction: Optional[str] = None  # "long" | "short" | "both" | None
    and_group: Optional[int] = None  # co-requirement grouping (mode-ab-G4 "and_group0")
    role: Optional[str] = None  # "spine" | "confluence" | None (spec_family_bindings.py role vocabulary)
    is_disabled_sentinel: bool = False  # anti-pattern-catalog.md §3b never-true marker
    comparator: Optional[str] = None  # raw comparator text, e.g. "close>orh_15m", "5-SMA>50-SMA"


@dataclass
class CompiledSpine:
    conditions: List[SpineCondition] = field(default_factory=list)
    or_branches: List[List[str]] = field(default_factory=list)  # groups of condition_ids (real DSL schema field name)
    direction: Optional[str] = None
    same_bar_fill: bool = False
    signal_lag: Optional[int] = None


@dataclass
class LintResult:
    passed: bool
    offending_anchor: Optional[str] = None
    offending_char_span: Optional[Tuple[int, int]] = None

    def as_cert_fields(self) -> dict:
        return {
            "passed": self.passed,
            "offending_anchor": self.offending_anchor,
            "offending_char_span": (
                list(self.offending_char_span) if self.offending_char_span is not None else None
            ),
        }


_PASS = LintResult(True)


# --------------------------------------------------------------------------- #
# direction_conflation_lint (PARITY-FIXTURED, mode-ab-G4-validity-block:76-77)
# --------------------------------------------------------------------------- #


def direction_conflation_lint(spine: CompiledSpine, full_transcript: str) -> LintResult:
    """FAIL when two conditions in the SAME and_group assert opposite
    directions with neither routed through an or_branches alternation --
    the `and_group0` defect: "opposite-direction (long/short) triggers merged
    into a single simultaneous AND requirement instead of split into
    directional OR-branches" (mode-ab-G4-validity-block-2026-07-11.md:77).
    A disabled sentinel (anti-pattern-catalog.md §3b) never counts as a real
    conflicting direction -- it is a deliberate never-true marker, not a live
    gate."""
    or_members = {cid for group in spine.or_branches for cid in group}
    groups: Dict[int, List[SpineCondition]] = {}
    for c in spine.conditions:
        if c.and_group is None or c.is_disabled_sentinel or c.condition_id in or_members:
            continue  # or_branches members are alternatives, not simultaneous AND co-requirements
        groups.setdefault(c.and_group, []).append(c)
    for members in groups.values():
        dirs_present = {m.direction for m in members if m.direction in ("long", "short")}
        if {"long", "short"} <= dirs_present:
            offender = min(
                (m for m in members if m.direction in ("long", "short")),
                key=lambda m: m.char_span[0],
            )
            return LintResult(False, offender.quote_anchor, offender.char_span)
    return _PASS


# --------------------------------------------------------------------------- #
# unsat_sat_check (PARITY-FIXTURED, mode-ab-G4-validity-block:386 + anti-
# pattern-catalog.md §3b sentinel exemption)
# --------------------------------------------------------------------------- #

_COMPARATOR_RE = re.compile(r"^\s*(\S+)\s*(>=|<=|==|>|<)\s*(\S+)\s*$")
_OPPOSITE_OP = {">": "<", "<": ">", ">=": "<=", "<=": ">="}


def _parse_comparator(text: Optional[str]) -> Optional[Tuple[str, str, str]]:
    if not text:
        return None
    m = _COMPARATOR_RE.match(text)
    if not m:
        return None
    return m.group(1), m.group(2), m.group(3)


def unsat_sat_check(spine: CompiledSpine, full_transcript: str) -> LintResult:
    """FAIL when two conditions in the SAME and_group assert structurally
    opposite comparators on the SAME operands (e.g. "5-SMA > 50-SMA" AND
    "5-SMA < 50-SMA") -- "5-SMA cannot be simultaneously above and below
    50-SMA" (mode-ab-G4-validity-block-2026-07-11.md:386, the corrected
    type-specimen for a compile-time-absurd AND group). A condition marked
    `is_disabled_sentinel` (e.g. the deliberate `high < low` never-true
    marker, anti-pattern-catalog.md:110-116) is EXCLUDED from the check
    entirely -- a standalone sentinel is valid by construction, and a
    sentinel paired with a real opposite condition is still the deliberate
    disabled-direction pattern, not a fidelity defect."""
    groups: Dict[int, List[SpineCondition]] = {}
    for c in spine.conditions:
        if c.and_group is None or c.is_disabled_sentinel:
            continue
        groups.setdefault(c.and_group, []).append(c)
    for members in groups.values():
        parsed = [(m, _parse_comparator(m.comparator)) for m in members]
        parsed = [(m, p) for m, p in parsed if p is not None]
        for i in range(len(parsed)):
            m1, (lhs1, op1, rhs1) = parsed[i]
            for j in range(i + 1, len(parsed)):
                _m2, (lhs2, op2, rhs2) = parsed[j]
                if (lhs1, rhs1) == (lhs2, rhs2) and _OPPOSITE_OP.get(op1) == op2:
                    return LintResult(False, m1.quote_anchor, m1.char_span)
    return _PASS


# --------------------------------------------------------------------------- #
# or_alternatives_honored (REUSED: src.engine.spec_family_bindings.
# or_branches_enabled, spec_family_bindings.py:146)
# --------------------------------------------------------------------------- #


def or_alternatives_honored(spine: CompiledSpine, full_transcript: str) -> LintResult:
    """FAIL when an or_branches group has >=2 role="spine" (real gating)
    members and the ENGINE'S OWN flag that gates OR-honoring
    (`or_branches_enabled()`) is OFF -- the exact Law-5 minting incident:
    "or_branches consumed by 0 engine files... 576 OR-alternative condition-
    ids are spine-role, so they are strictly ANDed despite being
    alternatives" (docs/designs/or-branches-honoring-fix-2026-07-05.md:9-11).
    A group with <2 spine-role members is non-gating either way (mirrors
    `scripts/or-branches-ccr.py`'s own "does not count toward the executed
    numerator in either mode" carve-out) and does not fail. No or_branches
    declared at all -> nothing to honor, PASS (plain AND-only spines are
    byte-identical regardless of the flag)."""
    if not spine.or_branches:
        return _PASS
    by_id = {c.condition_id: c for c in spine.conditions}
    for group in spine.or_branches:
        spine_members = [by_id[cid] for cid in group if cid in by_id and by_id[cid].role == "spine"]
        if len(spine_members) < 2:
            continue
        if not or_branches_enabled():
            offender = min(spine_members, key=lambda c: c.char_span[0])
            return LintResult(False, offender.quote_anchor, offender.char_span)
    return _PASS


# --------------------------------------------------------------------------- #
# f2_coverage_gate (PARITY-FIXTURED against the F-2 bug CLASS, extraction-
# coverage-gate.ts::classify()/nameInUnit + F4-eligibility-bypass-trace-
# 2026-07-07.md:237-309)
# --------------------------------------------------------------------------- #

_WORD_CHAR = re.compile(r"\w")


def f2_coverage_gate(spine: CompiledSpine, full_transcript: str) -> LintResult:
    """FAIL when a condition's char_span does not resolve to quote_anchor
    VERBATIM in full_transcript (a fabricated/non-resolving anchor), or when
    it resolves but sits on a MID-WORD boundary -- the exact F-2 collision
    class: a name/anchor matching as a PREFIX inside a longer word
    ("range"/"arranged", "trend"/"trending", "band"/"bandana", "cross"/
    "across", "order"/"disorder" -- the independent-review adversarial set,
    F4-eligibility-bypass-trace-2026-07-07.md:296-298). The coverage gate's
    own bug was exactly this: counting a name PRESENT when it merely
    appeared mid-word; the certificate's version of the same discipline is
    refusing to certify an anchor that isn't a genuine token-bounded quote."""
    for c in spine.conditions:
        s, e = c.char_span
        if not (0 <= s <= e <= len(full_transcript)):
            return LintResult(False, c.quote_anchor, c.char_span)
        if full_transcript[s:e] != c.quote_anchor:
            return LintResult(False, c.quote_anchor, c.char_span)
        before_ok = s == 0 or not _WORD_CHAR.match(full_transcript[s - 1])
        after_ok = e == len(full_transcript) or not _WORD_CHAR.match(full_transcript[e])
        if not (before_ok and after_ok):
            return LintResult(False, c.quote_anchor, c.char_span)
    return _PASS


# --------------------------------------------------------------------------- #
# causality_lint (PARITY-FIXTURED verbatim port, anti-pattern-catalog.md:88-96)
# --------------------------------------------------------------------------- #

# Verbatim port of anti-pattern-catalog.md:92's `impossibleRefs` regex
# (`/tomorrow|future_|next_close|next_high|bar_\+\d+|centered_window|lookahead/`).
# Bare close/high/low references are SAFE by construction (the engine auto-
# shifts +1 bar, backtester.py:70-100) and are deliberately NOT in this list.
_IMPOSSIBLE_REF = re.compile(
    r"tomorrow|future_|next_close|next_high|bar_\+\d+|centered_window|lookahead",
    re.IGNORECASE,
)


def causality_lint(spine: CompiledSpine, full_transcript: str) -> LintResult:
    """FAIL when a condition's text contains an IMPOSSIBLE reference the
    engine's +1-bar shift cannot rescue (anti-pattern-catalog.md:78,
    "no amount of next-bar shifting fixes a forward-looking indicator"), or
    when the spine explicitly opts out of the auto-shift
    (`same_bar_fill`/`signal_lag==0`, mirroring `sameBarOptOut` in the same
    KB doc). Bare `close`/`high`/`low` comparator text is SAFE and must NOT
    fire -- the pinned engine contract this lint must never re-violate."""
    if spine.same_bar_fill or spine.signal_lag == 0:
        offender = min(spine.conditions, key=lambda c: c.char_span[0]) if spine.conditions else None
        return LintResult(
            False,
            offender.quote_anchor if offender else None,
            offender.char_span if offender else None,
        )
    for c in spine.conditions:
        haystack = f"{c.quote_anchor} {c.comparator or ''}"
        if _IMPOSSIBLE_REF.search(haystack):
            return LintResult(False, c.quote_anchor, c.char_span)
    return _PASS


COMPILE_LINTS = {
    "direction_conflation_lint": direction_conflation_lint,
    "unsat_sat_check": unsat_sat_check,
    "or_alternatives_honored": or_alternatives_honored,
    "f2_coverage_gate": f2_coverage_gate,
    "causality_lint": causality_lint,
}


def run_all_lints(spine: CompiledSpine, full_transcript: str) -> Dict[str, LintResult]:
    return {name: fn(spine, full_transcript) for name, fn in COMPILE_LINTS.items()}
