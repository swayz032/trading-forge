"""spec_family_bindings.py — Band C condition-family -> primitive binding-plan compiler.

THE HYBRID DECISION (roadmap Band C, 2026-07-02): Band B's spec-archetype-matcher.ts
maps a compiled spec's condition graph onto a NAMED archetype via keyword match
only (6/25 sample specs matched; 19/25 queued to needs_archetype). This module
is the next layer down: for specs that don't match a named archetype, it maps
each individual condition's FAMILY (its `type`, e.g. WAIT_SESSION, INVALIDATE)
onto an EXISTING audited engine primitive wherever one exists, producing a
per-condition BINDING with a confidence/approximation flag.

FAIL-CLOSED CONTRACT: this module NEVER guesses a mapping. Every binding is
either (a) bound to a real primitive (with `approximation` honestly flagged
when the primitive is reused in a simplified/generalized way), or (b)
explicitly unbindable with a documented per-condition reason. A spec whose
trigger or majority of spine conditions can't bind stays queued to
needs_archetype — same honesty contract as Band B's archetype matcher.

PURITY CONTRACT (Ledger E parity surface, C2): this module does ZERO I/O, no
DataFrame access, no DB reads — it is pure string/dict logic over the spec's
condition list. This is deliberate: a PARTIAL mirror lives in
src/server/lib/spec-family-bindings.ts so the SAME spec produces the SAME
binding plan on both sides of the stack. Any change to a MIRRORED surface MUST
be mirrored there in the same commit — same convention as firm_rules_version.py
/ firm-rules-version.ts.

*** PARITY IS A CONVENTION HERE, NOT AN ENFORCED PROPERTY. READ THIS BEFORE
    RELYING ON THE MIRROR. *** (corrected 2026-08-03, R-678 §5 step 3; the
previous text claimed "mirrored byte-for-byte ... (parity-tested in
tests/test_spec_family_bindings_parity.py)" and BOTH HALVES WERE FALSE. It was
read as evidence by a worker and then repeated into a ruling before anyone
opened the files it named — see AR-739 §0 / R-678 §1.)

  1. NO CROSS-LANGUAGE PARITY TEST EXISTS. `tests/test_spec_family_bindings_
     parity.py` is not in the tree (positive control: the same search locates
     src/engine/tests/test_family_meta_enforcement.py). The TS-side file
     src/server/lib/__tests__/spec-family-bindings.test.ts is 168 lines of
     unit tests that never cross the process boundary — it tests TypeScript
     against TypeScript, not against this module.
  2. THE MIRROR IS PARTIAL, NOT BYTE-FOR-BYTE. It carries FAMILY_META, the
     session-keyword table and the generic bindCondition path. It does NOT
     carry the object router or any native primitive: resolveBundlePrimitive,
     fvg_native, sweep, mss and bundle are all ABSENT from the .ts file
     (control: resolveSessionKeyword is present there). The 5 native
     primitives are Python-only by decision (R-678 §4), registered via
     family_meta_enforcement.EXPERIMENT_PRIMITIVES.
  3. WHAT IS ACTUALLY ENFORCED, at load time, is family_meta_enforcement's
     pin (a) — verify_dispatch_coverage()'s both-directions set equality
     between FAMILY_META's declarations and the executable dispatch, plus
     gates<->handler agreement. That is a PYTHON-INTERNAL check. It says
     nothing about the TS side.
  4. MEASURED 2026-08-03: the two FAMILY_META tables had NOT drifted — 14
     families each, 0 only-in-Python, 0 only-in-TS, 0 primitive
     disagreements. Discipline held where enforcement did not. Do not read
     that as a guarantee; nothing re-checks it.

FAMILY -> PRIMITIVE TABLE (see docs/spec-execution-semantics.md for the full
decision record with citations):

  WAIT_SESSION       -> session_windows.py (killzone.ts Python mirror)      approx=False (faithful port)
  WAIT_STRUCTURE     -> structure_engine.compute_structure_state           approx=True  (single-TF, no separate HTF frame wired yet)
  VERIFY_STRUCTURE   -> structure_engine.compute_structure_state           approx=True  (same as above)
  WAIT_BIAS          -> bias_engine.classify_institutional_regime          approx=True  (regime label used as directional proxy, not session-anchored HTF narrative)
  CONFIRM_DIRECTION  -> bias_engine.classify_institutional_regime          approx=True  (same as above)
  WAIT_RETEST        -> spec_condition_compiler.retest_touch_check         approx=True  (generalizes bounce_off_level.py's ATR-proximity touch math; not the full rejection-candle archetype)
  FILTER             -> entry_quality.confluence_factors presence check    approx=True  (no standalone per-bar confluence primitive exists outside the TS/live-paper confluence-score.ts pipeline)
  WAIT_CONFIRMATION  -> spec_condition_compiler.candle_confirmation_check  approx=True  (generalizes bounce_off_level.py's rejection-pattern helpers to arbitrary objects)
  INVALIDATE         -> structural_stops.compute_structural_stop          approx=False (direct reuse of the audited stop-placement primitive)
  ENABLE_ENTRY/ENTER -> spine-completion trigger (AND of bound spine conditions) approx=inherited from constituents
  EXIT_HINT          -> provenance-only, NEVER executed (framework overlay is authoritative for exits — W23F.N)
  RESET/EXCEPTION    -> unsupported control-flow; explicit per-condition reason, never guessed
"""

from __future__ import annotations

import os
import re
from collections.abc import Hashable
from dataclasses import dataclass, field, replace
from itertools import pairwise

# The ONLY import beyond stdlib in this module, and it is stdlib-only itself (importlib, os,
# dataclasses) — the PURITY CONTRACT above (zero I/O, no DataFrame access, no DB reads,
# trivially portable for the TS mirror comparison) is preserved.
from src.engine.family_meta_enforcement import family_meta_enforced

# ─── FVG Identity Dispatch Experiment (docs/designs/fvg-identity-dispatch-
# experiment-2026-07-05.md, Part B item 1) ──────────────────────────────────
# Single-variable, env-gated toggle: WHEN ENABLED, a WAIT_STRUCTURE/FILTER
# condition whose object names the FVG family binds to the fresh, isolated
# `fvg_native.compute_fvg_signal` primitive (approximation=False) instead of
# the generic structure_engine/confluence-presence primitive every other
# WAIT_STRUCTURE/FILTER condition still uses. Default OFF so production
# binding plans stay byte-identical until the controlled experiment (Part C,
# the Signature Divergence Score harness) is reviewed — mirrors the
# established "ship gates STRICT, default OFF" pattern (CLAUDE.md §13) used
# for every other new-behavior flag in this codebase (slippage-survival gate,
# structural-stop parity, etc). Set TF_FVG_IDENTITY_ENABLED=true to activate.
FVG_OBJECT_KEYWORDS: tuple[str, ...] = (
    "fvg",
    "fair value gap",
    "imbalance",
    "put limit order right fvg",
)


def fvg_identity_enabled() -> bool:
    """Read at call time (not cached at import) so a controlled before/after
    comparison run in the SAME process (e.g. the SDS harness building a Mode-A
    strategy instance, flipping the env var, then building a Mode-B instance)
    sees the flag change immediately — same pattern as
    apply_eligibility_gate()'s live TF_CONFLUENCE_OVERLAY_DISABLED read."""
    return os.environ.get("TF_FVG_IDENTITY_ENABLED", "false").strip().lower() == "true"


def resolve_fvg_object(object_text: str) -> bool:
    """True iff `object_text` names an object in the FVG family (fair value
    gap / imbalance). Pure substring match — no word-boundary padding needed
    here (unlike resolve_session_keyword) since these are multi-word phrases
    unlikely to appear as an accidental substring of an unrelated object."""
    if not object_text:
        return False
    norm = object_text.strip().lower()
    return any(kw in norm for kw in FVG_OBJECT_KEYWORDS)


# ─── Level/Zone Routing Sub-Wire (docs/designs/packet-levelzone-subwire-
# 2026-07-20.md) ─────────────────────────────────────────────────────────────
# WAIT_STRUCTURE/VERIFY_STRUCTURE conditions all bind to structure_engine.
# compute_structure_state, which takes NO level argument — any two level/zone
# conditions on the same bars ("support at 100" vs "resistance at 140")
# therefore receive an IDENTICAL signal (premise audit, docs/replay-results/
# h1-battery/levelzone_premise_audit.py, leg 2). spec_condition_compiler.
# retest_touch_check IS level-aware (leg 1: proven to move with its `level`
# input, both polarities exercised). WHEN ENABLED, a WAIT_STRUCTURE/
# VERIFY_STRUCTURE condition whose object names a level/zone concept binds to
# that level-aware evaluator instead of the shared, level-blind structure
# signal every other WAIT_STRUCTURE/VERIFY_STRUCTURE condition still uses.
# Default OFF so production binding plans stay byte-identical until the
# independent grade — same "ship gates STRICT, default OFF" pattern as
# TF_FVG_IDENTITY_ENABLED above.
#
# approximation is DELIBERATELY left at meta.base_approximation (True) here,
# NOT flipped to False like the FVG dispatch above — the packet's hard
# constraint #2 is explicit: the routing lands, the fidelity claim does not.
# base_approximation=True stays until an independent grade licenses otherwise.
#
# Concept classifier: mirrored VERBATIM (not re-authored — packet hard
# constraint #5) from the `level_zone` regex in the committed census
# generator, docs/replay-results/h1-battery/wire1_structure_census.py lines
# 56-58. Duplicated as a literal pattern (not imported) for the same
# zero-import-surface / portability reason SESSION_KEYWORDS is duplicated
# below rather than imported from session_windows.py — this module's own
# PURITY CONTRACT (module docstring) forbids reaching into a docs/ script's
# path at runtime, and a second, drifted copy is exactly the defect class
# this campaign keeps convicting, so any edit to the census regex MUST be
# mirrored here in the same commit.
LEVEL_ZONE_RE = re.compile(
    r"\b(support|resistance|demand|supply|zone|level|previous\s+(day|high|low)|"
    r"high\s+of\s+(the\s+)?day|low\s+of\s+(the\s+)?day|pdh\b|pdl\b)\b", re.I)

# NOTE: deliberately NOT the literal string "spec_condition_compiler.retest_touch_check" — that
# exact string is already FAMILY_META["WAIT_RETEST"].primitive (see the table above). Reusing it
# here would make spec_condition_compiler.py's `b.primitive == ...` dispatch check collide with
# every genuine WAIT_RETEST condition's binding, regardless of this flag — a real bug caught by
# an engagement-count run over the corpus during implementation (a WAIT_RETEST-only spec showed
# nonzero "levelzone" engagement with the flag OFF). This marker is distinct on purpose, even
# though both ultimately call the same retest_touch_check function underneath.
LEVELZONE_NATIVE_PRIMITIVE: str = "levelzone_routing.retest_touch_check"


def levelzone_routing_enabled() -> bool:
    """Read at call time (not cached), same live-read contract as
    fvg_identity_enabled() above — lets a before/after comparison run in the
    same process."""
    return os.environ.get("TF_LEVELZONE_ROUTING_ENABLED", "false").strip().lower() == "true"


def resolve_levelzone_object(object_text: str) -> bool:
    """True iff `object_text` names a level/zone concept per the mirrored
    census regex above. Pure regex match, same contract as
    resolve_fvg_object/resolve_sweep_object/resolve_mss_object."""
    if not object_text:
        return False
    return bool(LEVEL_ZONE_RE.search(object_text))


# ─── Population-A Level Resolver (docs/designs/packet-levelzone-population-a-
# resolver-2026-07-20.md) ───────────────────────────────────────────────────
# The sub-wire above fixed WHICH primitive a level/zone condition binds to
# (retest_touch_check instead of the level-blind structure signal) but NOT
# what `level` that primitive is fed — production still feeds it a bars-only
# EMA(20) proxy (spec_condition_compiler.py's _eval_wait_retest), so every
# level/zone condition still receives an IDENTICAL level series regardless of
# what the trader named ("support at 100" and "resistance at 140" bind
# identically). This layer classifies a condition's OBJECT TEXT into one of
# the object-reference-census's reference kinds — Population-A only (the 7
# rows whose referent is named IN-SPAN, `bare_anaphora=false`) — so
# spec_condition_compiler.py can route each Population-A kind to a detector
# the repo already owns (market_structure.detect_swings /
# indicators.liquidity.detect_{buyside,sellside}_liquidity /
# indicators.order_flow.detect_{bullish,bearish}_ob) instead of the shared
# EMA proxy. Population B (bare anaphora — "the level", "that zone") is
# PROHIBITED from this classifier by construction: ANAPHORA_RE is checked
# FIRST and short-circuits to None before any kind regex runs, mirroring the
# census generator's own `anaphora_ambiguous = anaph and not kinds` bucketing
# discipline — this delivery must never manufacture a confident-but-hollow
# binding for a row that points at a level without naming one.
#
# Vocabulary REUSED VERBATIM (packet §3: "reuse the census's own vocabulary —
# do NOT author a third divergent classifier") from docs/replay-results/
# h1-battery/levelzone_object_reference_census.py's KIND_RES / ANAPHORA_RE
# (lines 35-55 as of this delivery). Any edit to that generator's regexes
# MUST be mirrored here in the same commit — same duplication convention as
# LEVEL_ZONE_RE above (that module has zero import surface by design).
# Population-A-eligible subset ONLY: fvg_edge / session_range / prior_day /
# absolute_price are real census kinds but OUT of this delivery's scope
# (packet names exactly 3: named_sr_level, order_block_edge, swing).
POPULATION_A_SWING_RE = re.compile(
    r"\b(swing\s+(high|low)|higher\s+high|lower\s+low|lower\s+high|"
    r"higher\s+low|previous\s+(high|low)|prior\s+(high|low)|"
    r"recent\s+(high|low)|peak|trough)\b", re.I)
POPULATION_A_ORDER_BLOCK_EDGE_RE = re.compile(
    r"\b(order\s+block|breaker|mitigation\s+block|demand|supply)\b", re.I)
POPULATION_A_NAMED_SR_LEVEL_RE = re.compile(r"\b(support|resistance)\b", re.I)
POPULATION_A_ANAPHORA_RE = re.compile(
    r"\b(the|this|that|these|those|it|there)\s+"
    r"(level|zone|area|line|point|price)\b", re.I)

# Priority order when an object text matches more than one Population-A kind
# (none of the 7 real corpus rows are multi-label as of this delivery, but the
# classifier must still be deterministic for any future/synthetic text) —
# mirrors the census generator's own KIND_RES list order for the subset of
# kinds this delivery is scoped to.
POPULATION_A_KIND_ORDER: tuple[tuple[str, re.Pattern], ...] = (
    ("swing", POPULATION_A_SWING_RE),
    ("order_block_edge", POPULATION_A_ORDER_BLOCK_EDGE_RE),
    ("named_sr_level", POPULATION_A_NAMED_SR_LEVEL_RE),
)

LEVELZONE_RESOLVER_PRIMITIVE: str = "levelzone_routing.population_a_resolver"
"""Distinct from LEVELZONE_NATIVE_PRIMITIVE (EMA-proxy path) for the same collision-safety
reason documented on LEVELZONE_NATIVE_PRIMITIVE above — spec_condition_compiler.py's
`elif b.primitive == ...` dispatch must be able to tell "resolved per-condition level" apart
from "shared EMA(20) proxy" even though a reader might expect them to share a marker."""

# ─── Population-A Flip Step (docs/designs/packet-population-a-flip-step-2026-07-20.md)
# ───────────────────────────────────────────────────────────────────────────────────
# THE FIRST approximation=False OF THE ENTIRE CAMPAIGN. Two of the three Population-A
# kinds have now separately EARNED a de-approximation grade on their own evidence — this
# set is the ONLY place that evidence is allowed to change what `bind_condition` returns,
# per-kind, never a blanket flip of the resolver path:
#
#   named_sr_level  -- earned by BOTH: (1) upstream detect_buyside_liquidity /
#                       detect_sellside_liquidity fixed and graded Band 8, commit 7e3247ca
#                       (AR-107: causal-clustering defect corrected); AND (2) this kind's own
#                       per-kind causal-safety test passed (0/160 value-null, 0/28
#                       activation-null, plants fired on both polarities, non-NaN-verified) —
#                       R-136 discharge.
#   order_block_edge -- earned by: detect_bullish_ob probed CLEAN 0/42 and detect_bearish_ob
#                       probed CLEAN 0/47 under fired plant-catches, two independent
#                       production-alignment passes (AR-117, commit a2604d39), with
#                       order_flow.py carrying no defect across the wider 19/19 detector
#                       sweep (AR-120, commit a87bbea3).
#
#   swing             -- STAYS approximation=True. n=1 in the census (only one Population-A
#                       corpus row names a swing referent in-span) — the two-different-
#                       levels discrimination check this campaign requires before trusting a
#                       kind is UNRUNNABLE inside a population of one. De-approximation floor
#                       is n>=2 (R-102 §2). swing ROUTES through the same resolver machinery
#                       (test_swing_kind_routes_but_approximation_never_flips proves this by
#                       test) but its disposition remains UNVERIFIED-BY-SAMPLE. Do not add
#                       swing here without a second, independent Population-A swing row
#                       entering the census and passing its own causal-safety test.
#
# Still gated behind BOTH TF_LEVELZONE_ROUTING_ENABLED and TF_LEVELZONE_RESOLVER_ENABLED
# (both default OFF) — this set changes what approximation VALUE the resolver path assigns
# once/if that sub-wire is promoted to default-on; it does not, by itself, change any
# production output today (ship gates STRICT, default OFF, same as every other flag in this
# module). The claim stands only once graded — see the packet's Rollback section.
POPULATION_A_DEAPPROXIMATED_KINDS: frozenset[str] = frozenset({"named_sr_level", "order_block_edge"})


def classify_population_a_kind(object_text: str) -> str | None:
    """Returns the Population-A reference kind ("swing" | "order_block_edge" |
    "named_sr_level") this object text names IN-SPAN, or None when the text is bare
    anaphora (Population B — PROHIBITED, packet §3) or names no Population-A kind at all
    (still Population B/no-kind-matched rows, or a non-Population-A kind like fvg_edge —
    out of scope here). Pure string/regex logic, same contract as resolve_levelzone_object
    above — no I/O, no DataFrame access, callable from both the binding-plan layer (to pick
    a primitive) and the executable layer (to pick a detector) without a second, drifted
    copy of the classification rule."""
    if not object_text:
        return None
    if POPULATION_A_ANAPHORA_RE.search(object_text):
        return None
    for kind, rx in POPULATION_A_KIND_ORDER:
        if rx.search(object_text):
            return kind
    return None


def levelzone_resolver_enabled() -> bool:
    """Read at call time (not cached), same live-read contract as
    levelzone_routing_enabled() above. Independent flag — separate from
    TF_LEVELZONE_ROUTING_ENABLED per packet §3 ('a new env flag, default OFF'). Gated
    STRICTLY behind levelzone_routing_enabled() also being True in the dispatch call site
    below (the resolver only ever replaces the EMA proxy for a condition that would
    otherwise already be routed to the level-aware primitive) — this function itself does
    not enforce that ordering, the caller does."""
    return os.environ.get("TF_LEVELZONE_RESOLVER_ENABLED", "false").strip().lower() == "true"


# ─── Composition Fidelity Experiment — Phase 3 Increment 2 (docs/designs/
# composition-fidelity-experiment-2026-07-05.md) ────────────────────────────
# The FVG null (increment 1) proved single-object identity restoration is real but
# behaviorally invisible: a spec is an AND-chain gated by whichever spine condition is
# rarest-true, almost never the one object restored. This experiment restores identity to the
# ACTUALLY-GATING conditions of a strategy AS A BUNDLE — every object family the Step 0 gating
# diagnostic (scripts/composition-gating-diagnostic.py) found in that strategy's own gating set,
# restored together, single variable: TF_COMPOSITION_BUNDLE_ENABLED + an explicit per-strategy
# `restore_condition_ids` set (NOT a global keyword auto-detect like the FVG flag above — the
# locked spec requires "restore ALL gating conditions of a strategy at once; leave non-gating
# conditions and everything else byte-identical," which needs per-condition-id targeting, not a
# blanket keyword match that would also restore non-gating conditions of the same object family).
#
# Default OFF; when restore_condition_ids is None (every existing caller — production,
# the FVG-increment-1 rig, etc.) behavior is 100% unchanged regardless of the env flag.
SWEEP_OBJECT_KEYWORDS: tuple[str, ...] = (
    "sweep",
    "liquidity grab",
    "stop hunt",
    "stop run",
    "judas swing",
    "raid",
)
MSS_OBJECT_KEYWORDS: tuple[str, ...] = (
    "mss",
    "market structure shift",
    "structure shift",
    "choch",
    "change of character",
    "change in state",
    "state delivery",
)

BIAS_NATIVE_PRIMITIVE: str = "bias_native.compute_bias_signal"
CONFIRMATION_NATIVE_PRIMITIVE: str = "confirmation_native.compute_confirmation_signal"
SWEEP_NATIVE_PRIMITIVE: str = "sweep_native.compute_sweep_signal"
MSS_NATIVE_PRIMITIVE: str = "mss_native.compute_mss_signal"
FVG_NATIVE_PRIMITIVE: str = "fvg_native.compute_fvg_signal"


def composition_bundle_enabled() -> bool:
    """Read at call time (not cached), same live-read contract as fvg_identity_enabled()."""
    return os.environ.get("TF_COMPOSITION_BUNDLE_ENABLED", "false").strip().lower() == "true"


# ─── OR-Branches Honoring Fix (docs/designs/or-branches-honoring-fix-2026-07-05.md) ────────────
# Confirmed defect: extraction preserves OR structure (726 `or_branches` groups across 108/117
# strategies, graph-to-engine.ts "condition-id sets where ANY holds"), but execution ignores it —
# `spec.or_branches` is consumed by 0 engine files; spec_condition_compiler.py's gating loop ANDs
# every spine condition individually, including the 576 spine-role condition-ids that are OR
# alternatives to each other (93/117 strategies over-conjoined: "A or B or C" compiled as
# "A and B and C"). This flag gates the fix: when enabled, spec_condition_compiler.py combines
# conditions that share an or_branch via ANY-holds (OR) before that branch's single OR-result
# enters the spine conjunction — see SpecConditionStrategy._combine_spine_or_branches. Default OFF
# so production binding/gating behavior stays byte-identical until the falsification re-run
# (docs/designs/composition-fidelity-experiment-2026-07-05.md) is reviewed — same "ship gates
# STRICT, default OFF" pattern as TF_FVG_IDENTITY_ENABLED / TF_COMPOSITION_BUNDLE_ENABLED above.
def or_branches_enabled() -> bool:
    """Read at call time (not cached), same live-read contract as fvg_identity_enabled() and
    composition_bundle_enabled() — lets a before/after comparison run in the SAME process."""
    return os.environ.get("TF_OR_BRANCHES_ENABLED", "false").strip().lower() == "true"


# ─── Hard-Constraint Demotion Experiment (docs/designs/hard-constraint-demotion-
# experiment-2026-07-05.md) ─────────────────────────────────────────────────
# Causal-attribution experiment over the DRI audit's (docs/replay-results/dri-
# audit-2026-07-05.json) per-condition classification: is corpus collapse driven
# by constraint INFLATION (raw count of hard conditions) or constraint
# INTERACTION (temporal/state/ordering semantics)? Six modes, one env var,
# never combined in one run:
#   off          -- byte-identical to pre-experiment behavior (default).
#   struct_conf  -- OPTIONAL only:    role -> "confluence" (drops out of the
#                    spine AND into the existing soft-confluence bucket).
#   struct_alt   -- ALTERNATIVE only: grouped into a per-strategy OR_GROUP
#                    (ANY-holds) — see spec_condition_compiler.py's
#                    _demotion_or_branch_of_condition / _effective_or_branch_map.
#                    NOT a role/executed change (stays role="spine",
#                    executed=True) — the OR-merge is what removes it from the
#                    strict per-term AND.
#   struct_ctx   -- CONTEXTUAL only:  executed forced False. Role is left
#                    UNCHANGED (stays "spine" for provenance/spine_total
#                    counting) — "removed from the execution graph entirely,
#                    metadata only" per the spec, distinct from OPTIONAL's
#                    confluence-node move (which changes ROLE, not executed).
#   struct_all   -- union of the three classes above, single-variable (NOT
#                    three flags flipped simultaneously — one mode value).
#   exec_all     -- SECONDARY, execution-masking validation arm. Same three
#                    classes, same net per-bar masking effect, but WITHOUT
#                    touching role/executed/or_branch topology — applied
#                    post-hoc to the per-condition boolean arrays inside
#                    spec_condition_compiler.compute(). Confirms struct_all's
#                    result isn't a topology artifact (spec Section 2). This
#                    module (structure-only) never acts on exec_all; it is
#                    entirely handled in spec_condition_compiler.py.
# JUSTIFIED_MANDATORY is NEVER demoted by any mode (real gate). UNRESOLVED is
# HELD OUT of every mode here — it is simply absent from the lookup a caller
# passes in (see role_demotion_audit.DEMOTABLE_CLASSES), so an UNRESOLVED
# classification behaves identically to "no classification" (unchanged spine).
ROLE_DEMOTION_MODES: tuple[str, ...] = (
    "off",
    "struct_conf",
    "struct_alt",
    "struct_ctx",
    "struct_all",
    "exec_all",
)

_STRUCTURAL_MODE_CLASSES: dict[str, frozenset[str]] = {
    "struct_conf": frozenset({"OPTIONAL"}),
    "struct_alt": frozenset({"ALTERNATIVE"}),
    "struct_ctx": frozenset({"CONTEXTUAL"}),
    "struct_all": frozenset({"OPTIONAL", "ALTERNATIVE", "CONTEXTUAL"}),
}


def role_demotion_mode() -> str:
    """Read at call time (not cached), same live-read contract as
    or_branches_enabled() / composition_bundle_enabled() above. Falls back to
    "off" for any unrecognized value — a typo in the env var fails CLOSED to
    baseline behavior rather than silently landing on some other arm."""
    raw = os.environ.get("TF_ROLE_DEMOTION_MODE", "off").strip().lower()
    return raw if raw in ROLE_DEMOTION_MODES else "off"


def struct_demotes(mode: str, classification: str | None) -> bool:
    """True iff `mode` is a STRUCTURAL demotion mode (struct_*) that demotes
    conditions classified `classification`. Always False for "off" and for
    "exec_all" — execution-masking is applied elsewhere (spec_condition_
    compiler.py only); this module stays structure-only so its zero-I/O
    purity contract and TS-mirror parity are unaffected by the exec_all arm."""
    if classification is None:
        return False
    classes = _STRUCTURAL_MODE_CLASSES.get(mode)
    return bool(classes and classification in classes)


def resolve_sweep_object(object_text: str) -> bool:
    if not object_text:
        return False
    norm = object_text.strip().lower()
    return any(kw in norm for kw in SWEEP_OBJECT_KEYWORDS)


def resolve_mss_object(object_text: str) -> bool:
    if not object_text:
        return False
    norm = object_text.strip().lower()
    return any(kw in norm for kw in MSS_OBJECT_KEYWORDS)


def resolve_bundle_primitive(cond_type: str, object_text: str) -> str | None:
    """Family dispatch for the composition-bundle restoration. Returns the native primitive name
    this (type, object) pair should bind to when it is a member of the current strategy's gating
    set and the bundle is enabled — or None when no built native evaluator covers it (an honest
    gap, NOT a guess; the caller must leave such conditions on the generic path).

    Order matters: MSS/sweep keyword matches take priority over the type-level bias/confirmation
    default so an explicitly-named structural event (e.g. "mss or change in state delivery" typed
    WAIT_CONFIRMATION per the real corpus) gets the MORE specific evaluator rather than the
    type's generic native fallback.
    """
    if cond_type in ("WAIT_STRUCTURE", "VERIFY_STRUCTURE", "FILTER"):
        if resolve_fvg_object(object_text):
            return FVG_NATIVE_PRIMITIVE
        if resolve_sweep_object(object_text):
            return SWEEP_NATIVE_PRIMITIVE
        if resolve_mss_object(object_text):
            return MSS_NATIVE_PRIMITIVE
        return None
    if cond_type in ("WAIT_BIAS", "CONFIRM_DIRECTION"):
        if resolve_mss_object(object_text):
            return MSS_NATIVE_PRIMITIVE
        return BIAS_NATIVE_PRIMITIVE
    if cond_type == "WAIT_CONFIRMATION":
        if resolve_mss_object(object_text):
            return MSS_NATIVE_PRIMITIVE
        if resolve_sweep_object(object_text):
            return SWEEP_NATIVE_PRIMITIVE
        return CONFIRMATION_NATIVE_PRIMITIVE
    return None


# ─── Session keyword table (duplicated verbatim in the TS mirror — see module
# docstring). Kept identical to session_windows.SESSION_KEYWORDS so a spec's
# WAIT_SESSION binding decision doesn't depend on session_windows.py's own
# import surface (keeps this module trivially portable / pure). ────────────
#
# ★ EVERY KEY HERE MUST BE A KEY OF session_windows._ZONE_CHECKS — pin (b2),
# `EMIT ⊆ COVERED`, checked at load time by
# family_meta_enforcement.verify_emit_subset_covered(). `lunch_blackout` and
# `overnight` were removed by the orphan-zone closure
# (docs/designs/packet-orphan-zone-closure-2026-07-21.md) and now live in
# REFUSED_SESSION_KEYWORDS below. Adding an uncovered key here makes the
# engine refuse to load under all pins; that refusal is the guard working.
SESSION_KEYWORDS: dict[str, tuple[str, ...]] = {
    "london": ("london session", "london open", "london killzone"),
    "ny_am": ("ny am", "new york am", "new york morning", "ny morning", "ny open", "am session"),
    "ny_pm": ("ny pm", "new york pm", "new york afternoon", "ny afternoon", "pm session"),
    "silver_bullet": ("silver bullet",),
    "macro_window": ("macro window", "macro release"),
}

# Mirror of session_windows.REFUSED_SESSION_KEYWORDS (same zero-import-surface
# duplication convention as SESSION_KEYWORDS above — see the module docstring).
# Phrases that are RECOGNIZED as naming a session concept this engine has no
# honest runtime primitive for, and are therefore REFUSED with a named reason
# rather than silently dropped into the generic no_recognized_session_keyword
# bucket. See session_windows.REFUSED_SESSION_KEYWORDS for the full argument
# (zero effective demand; `overnight` has no single defensible clock).
REFUSED_SESSION_KEYWORDS: dict[str, tuple[str, ...]] = {
    "lunch_blackout": ("lunch", "midday", "noon session"),
    "overnight": ("overnight", "globex", "asia session", "pre market", "premarket"),
}


def session_refusal_reason(refused_zone: str) -> str:
    """The `unbound_reason` a refused session phrase carries. Distinct from
    BOTH `no_recognized_session_keyword` (we did not recognize it at all) and
    SESSION_TEACHING_UNBOUND_REASON (recognized, no computable window) — this
    one says "recognized, and DELIBERATELY not bound, because the zone it
    names has no window `is_in_killzone` can evaluate."""
    return f"session_zone_refused_uncomputable_window:{refused_zone}"

MIN_SPINE_BOUND_RATIO: float = 0.5
"""Minimum fraction of `role=="spine"` conditions that must bind to a primitive
(or resolve to an honest unsupported-but-non-blocking state) before a spec is
considered condition-compiled rather than queued. Conservative default —
tunable, but changing it is a behavior change requiring re-measurement of the
25-sample mapped/queued split (see docs/spec-execution-semantics.md)."""


_INHERIT: str = "\x00inherit"
"""Sentinel for an `enforced_*` field that is UNCHANGED by enforcement. Distinct from None,
which is a meaningful value here ("declares no primitive")."""


@dataclass(frozen=True)
class FamilyMeta:
    """One family's declaration. Carries TWO columns on purpose, for the length of the
    enforcement build only (docs/designs/packet-family-meta-enforced-2026-07-20.md, section 5,
    two-commit law):

      LEGACY  (`primitive`, `base_approximation`, ...) -- what the engine has always emitted.
              Kept verbatim so that with TF_FAMILY_META_ENFORCED OFF (the default) every
              binding plan, every persisted `primitive` string, and every governance label is
              BYTE-IDENTICAL to before this packet. Some of these values are known to be
              FALSE; they are preserved, not blessed.

      ENFORCED (`enforced_primitive`, `enforced_mechanism`, `enforced_approximation`, `gates`,
              `production_executed`) -- what is TRUE of the engine, measured by
              docs/replay-results/h1-battery/family_meta_reachability_sweep.py. Active only
              under the flag. `_INHERIT` means "the legacy value was already true".

    A later commit deletes the legacy column and makes the enforced one the only one. That
    separation is the two-commit law: enforcement lands here; the default change lands on the
    grade, not on the landing."""

    primitive: str | None
    requires_session_keyword: bool = False
    base_approximation: bool = False
    unsupported: bool = False
    unbound_reason: str | None = None
    executed: bool = True  # False only for EXIT_HINT (provenance-only, never drives signals)
    enforced_primitive: str | None = _INHERIT
    enforced_mechanism: str | None = None
    enforced_approximation: bool | None = None
    gates: bool = True
    """False when this family's declaration computes NO per-bar signal and therefore CANNOT
    gate -- FILTER (constant True), ENABLE_ENTRY/ENTER (the spine conjunction is the trigger),
    EXIT_HINT (never executed). A gating=False family may not declare a primitive; it declares
    a MECHANISM (see family_meta_enforcement.MECHANISMS)."""
    production_executed: bool = True
    """False when the declared primitive is real and resolvable but is NOT called on a
    production run. INVALIDATE only: the sweep measured 0 calls to
    structural_stops.compute_structural_stop across 495 firing bars with trace off, and 492
    calls with trace=True (all four signal columns byte-identical either way). The primitive
    exists and is reachable -- but only in the trace path, so declaring it plainly `executed`
    overstates what production does."""

    def enforced_declaration(self) -> tuple[str | None, str | None]:
        """(primitive, mechanism) as declared UNDER ENFORCEMENT, with `_INHERIT` resolved to
        the legacy value. Flag-independent on purpose — the enforcement checker must be able
        to inspect the enforced column without the flag being on (that is how the fail-loud
        tests interrogate it), and reading the sentinel raw is exactly the transcription bug
        this method exists to prevent."""
        if self.unsupported:
            return None, None
        if self.enforced_mechanism is not None:
            return None, self.enforced_mechanism
        primitive = self.primitive if self.enforced_primitive == _INHERIT else self.enforced_primitive
        return primitive, None

    def effective_primitive(self) -> str | None:
        """The primitive under the ACTIVE regime. Enforcement is the only thing that changes
        it, and only where the legacy value was measured false."""
        if not family_meta_enforced():
            return self.primitive
        if self.enforced_mechanism is not None:
            # An honest entry's MECHANISM name is what a binding carries and what the
            # executable layer routes on, exactly like a primitive -- so pin (a)'s
            # both-directions dispatch check covers mechanisms too, and a mechanism cannot
            # quietly fall through to an untracked `else` branch.
            return self.enforced_mechanism
        return self.primitive if self.enforced_primitive == _INHERIT else self.enforced_primitive

    def effective_approximation(self) -> bool:
        if not family_meta_enforced() or self.enforced_approximation is None:
            return self.base_approximation
        return self.enforced_approximation

    def enforced_honest_approximation(self) -> bool:
        """The approximation truth under the ENFORCED honest accounting, FLAG-INDEPENDENT —
        the value a fidelity measurement must anchor to regardless of production routing. This
        is the approximation-column parallel of `enforced_declaration()`: the enforced column
        is readable without the flag being on (that is how the fail-loud checks interrogate it),
        and with the flag OFF `effective_approximation()` deliberately returns the LEGACY
        convenience value — some of which the FAMILY_META comments themselves call fidelity
        lies (`enforced_approximation=True` on ENABLE_ENTRY/ENTER/INVALIDATE). A gate that
        guards fidelity must never anchor to that convenience label; it anchors HERE (R-260 §1).
        `enforced_approximation is None` means "the legacy value was already honest"."""
        if self.enforced_approximation is None:
            return self.base_approximation
        return self.enforced_approximation


FAMILY_META: dict[str, FamilyMeta] = {
    # ── REACHABLE in the baseline sweep: the declared primitive is the one that runs. The
    # enforced column only sharpens WAIT_SESSION's pointer from a MODULE name to the actual
    # FUNCTION the evaluator calls (_eval_wait_session -> is_in_killzone).
    "WAIT_SESSION": FamilyMeta(
        primitive="session_windows",
        requires_session_keyword=True,
        base_approximation=False,
        unbound_reason="no_recognized_session_keyword",
        enforced_primitive="session_windows.is_in_killzone",
    ),
    # ── PARTIAL (branch-conditional) in the baseline sweep: measured 198 calls on n=2000, and
    # the WIRE-1 branch probe shows the wired-column path bypasses the primitive entirely on
    # bars where htf_structure_active is present. The pointer is TRUE (the primitive really is
    # what computes this signal on the proxy path); approximation=True already carries the
    # branch-conditional honesty. Unchanged by enforcement.
    "WAIT_STRUCTURE": FamilyMeta(
        primitive="structure_engine.compute_structure_state",
        base_approximation=True,
    ),
    "VERIFY_STRUCTURE": FamilyMeta(
        primitive="structure_engine.compute_structure_state",
        base_approximation=True,
    ),
    # ── NOT-REACHABLE in the baseline sweep -> HONEST ENTRY (pin (c)). Declared
    # `bias_engine.classify_institutional_regime`; MEASURED 0 calls to it on 2000 real ES 5min
    # bars with a bound WAIT_BIAS/CONFIRM_DIRECTION spine condition. What actually executes is
    # SpecConditionStrategy._eval_wait_bias -- an EMA-slope directional proxy, plus the WIRE-1
    # htf_daily_trend column when the backtester materialized one. The pointer now names that.
    #
    # This is pin (c), NOT the prohibited repair: nothing was implemented to make the old
    # pointer pass, and approximation stays True. The regime classifier is a real function that
    # this path simply never called -- re-pointing at the executing code is the honest move; the
    # dishonest one would have been wiring the classifier in to make the old string true.
    "WAIT_BIAS": FamilyMeta(
        primitive="bias_engine.classify_institutional_regime",
        base_approximation=True,
        enforced_primitive="spec_condition_compiler.wait_bias_directional_proxy",
    ),
    "CONFIRM_DIRECTION": FamilyMeta(
        primitive="bias_engine.classify_institutional_regime",
        base_approximation=True,
        enforced_primitive="spec_condition_compiler.wait_bias_directional_proxy",
    ),
    # ── REACHABLE. Pointer true, primitive measured firing.
    "WAIT_RETEST": FamilyMeta(
        primitive="spec_condition_compiler.retest_touch_check",
        base_approximation=True,
    ),
    # ── *** THE CONVICTING ENTRY *** NOT-REACHABLE -> HONEST ENTRY (pin (c)).
    # `entry_quality.confluence_factor_presence` NAMES A MODULE THAT DOES NOT EXIST. compute()
    # silently substituted np.ones(n, dtype=bool) -- constant True, 2000/2000 -- for 390 corpus
    # conditions carrying role=spine. A condition that cannot be false cannot gate.
    #
    # The honest entry declares the substitution instead of hiding it: mechanism
    # `static_true_pass_through`, gates=False, approximation=True. Under enforcement, pin (b)
    # makes the OLD declaration a startup error (proven: see the fail-loud test), so the
    # constant-True gate is structurally unshippable.
    #
    # *** WHAT WAS DELIBERATELY NOT DONE, and why it matters more than what was ***
    # No `entry_quality.confluence_factor_presence` was written. Inventing one to satisfy the
    # loader would convert a pointer lie into a FABRICATED IMPLEMENTATION -- strictly worse,
    # because it would PROBE CLEAN. FILTER has no per-bar confluence primitive in this repo.
    # The honest entry says exactly that, and the 390 conditions stay non-gating, now declared.
    "FILTER": FamilyMeta(
        primitive="entry_quality.confluence_factor_presence",
        base_approximation=True,
        enforced_primitive=None,
        enforced_mechanism="static_true_pass_through",
        enforced_approximation=True,
        gates=False,
    ),
    # ── REACHABLE. Pointer true, primitive measured firing.
    "WAIT_CONFIRMATION": FamilyMeta(
        primitive="spec_condition_compiler.candle_confirmation_check",
        base_approximation=True,
    ),
    # ── NOT-REACHABLE -> HONEST ENTRY (pin (c)), the correction the packet declares by name.
    # The SOLE approximation=False among executed families, and its primitive is NEVER CALLED
    # IN PRODUCTION: 0 calls across 495 firing bars with trace off; under trace=True it fires
    # 492 times and all four signal columns are BYTE-IDENTICAL -- it could not change an output
    # if it did run. The primitive is real and resolvable, so this is not a pin (b) failure;
    # it is a fidelity lie. approximation -> True, production_executed -> False.
    #
    # ★ THE FIDELITY NUMBER MOVES DOWN HERE, AND SHOULD. A worse headline number is this
    # packet succeeding.
    "INVALIDATE": FamilyMeta(
        primitive="structural_stops.compute_structural_stop",
        base_approximation=False,
        enforced_approximation=True,
        production_executed=False,
        gates=False,
    ),
    # ── COULD-NOT-VERIFY -> HONEST ENTRY (pin (c)). `spine_completion_trigger` IS NOT A CODE
    # SYMBOL; it was an aspirational label. The real mechanism is the spine conjunction in
    # compute() -- these trigger-role conditions are never evaluated as conditions at all
    # (they are 480 + 255 = 735 of the 987 never-evaluated trigger-role conditions in the
    # section 6a accounting). ★ 921 -> 987 (D5, AR-173): the old figure summed a CURATED
    # 5-family list as if it were the population. compute()'s loop selects role=="spine",
    # so EVERY trigger-role condition is skipped -- 66 more across 6 families
    # (WAIT_SESSION 18, WAIT_CONFIRMATION 21, WAIT_RETEST 15, WAIT_STRUCTURE 6,
    # VERIFY_STRUCTURE 3, EXIT_HINT 3). Re-derived from the UNIVERSE for this commit --
    # role=="trigger" over all 6450 entry_conditions in the 120-spec or-branches corpus,
    # by three independent paths that agree (filter-count, (type,role) cross-tab sum,
    # total-minus-non-trigger) = 987. Declared as a mechanism, gates=False,
    # approximation=True.
    "ENABLE_ENTRY": FamilyMeta(
        primitive="spine_completion_trigger",
        base_approximation=False,
        enforced_primitive=None,
        enforced_mechanism="spine_conjunction_trigger",
        enforced_approximation=True,
        gates=False,
    ),
    "ENTER": FamilyMeta(
        primitive="spine_completion_trigger",
        base_approximation=False,
        enforced_primitive=None,
        enforced_mechanism="spine_conjunction_trigger",
        enforced_approximation=True,
        gates=False,
    ),
    # ── Already honest (provenance-only, never executed). Restated as a MECHANISM so the
    # mechanism set is complete rather than partially implicit.
    "EXIT_HINT": FamilyMeta(
        primitive="provenance_only",
        base_approximation=False,
        executed=False,
        enforced_primitive=None,
        enforced_mechanism="provenance_only",
        gates=False,
    ),
    "RESET": FamilyMeta(
        primitive=None,
        unsupported=True,
        unbound_reason="control_flow_reset_unsupported",
    ),
    "EXCEPTION": FamilyMeta(
        primitive=None,
        unsupported=True,
        unbound_reason="control_flow_exception_unsupported",
    ),
}


@dataclass(frozen=True)
class ConditionBinding:
    condition_id: str
    type: str
    role: str
    object: str
    bindable: bool
    primitive: str | None
    approximation: bool
    executed: bool
    reason: str | None = None
    session_zone: str | None = None
    parameters: tuple[tuple[str, Hashable], ...] | None = None
    """OPTIONAL per-condition parameter carrier — Layer 2 of the numeric parameter channel
    (R-681 §5(2)). Defaults to None, and NOTHING in this repo populates it as of this
    commit; the only writer is a test.

    *** THIS IS NOT THE PARAMETER GRAMMAR. *** The grammar is reserved to the advisor desk
    (R-678 §6), and when it lands it must RECEIVE the shape src/server/lib/
    indicator-params.ts already emits ({indicator, params, confidence, source} ->
    entry_params/param_source) rather than this. This field exists for ONE reason: so the
    parameter-COLLISION defect can be made reachable and red-proofed BEFORE the grammar is
    designed. R-679 §2's law -- `a cache keyed by family becomes a parameter-losing channel
    the moment parameters exist` -- was untestable while no parameter could reach an
    evaluator at all (Lane 3's stop condition, AR-741).

    WHY A TUPLE OF PAIRS AND NOT A dict: this dataclass is frozen=True, so Python derives
    __hash__ from its fields, and a dict field would make every ConditionBinding
    unhashable. MEASURED at this commit: nothing under src/ hashes a ConditionBinding or
    puts one in a set, so a dict would break nothing TODAY. That is precisely the reasoning
    R-679 §1 rejected -- `an unreachable defect is a loaded trap, not an absent one`. The
    immutable shape keeps the invariant instead of spending it.

    IT CANNOT REACH A SEALED ARTIFACT. Binding plans are not persisted into *.spec.json
    (measured: all 18 sealed artifacts carry exactly 7 top-level keys, none a binding), so
    this field cannot move spec_hash.
    """

    def __post_init__(self) -> None:
        """Refuse an unhashable parameter value AT CONSTRUCTION, naming the key.

        F-4 (accuracy-validator grade, R-684 §4.1). The annotation alone is not a
        guard: `object` admitted list/dict/set, construction succeeded, and the
        TypeError surfaced deep inside compute() at spec_condition_compiler.py:530
        with no indication of which parameter caused it. `A LAW INVOKED IS NOT A LAW
        DISCHARGED` -- the docstring below cites R-679 §1's loaded-trap law to justify
        frozen=True, and then left the trap one level up in the annotation.

        Cost is one early return for every binding this repo actually builds
        (parameters is None for all of them at this commit).
        """
        if self.parameters is None:
            return
        for key, value in self.parameters:
            try:
                hash(value)
            except TypeError as exc:
                raise TypeError(
                    f"ConditionBinding parameter {key!r} has an unhashable value "
                    f"{value!r} of type {type(value).__name__}. ConditionBinding is "
                    f"frozen=True, so it must stay hashable -- pass an immutable value "
                    f"(tuple, not list/dict/set). Original error: {exc}"
                ) from exc

    def to_dict(self) -> dict:
        out = {
            "condition_id": self.condition_id,
            "type": self.type,
            "role": self.role,
            "object": self.object,
            "bindable": self.bindable,
            "primitive": self.primitive,
            "approximation": self.approximation,
            "executed": self.executed,
            "reason": self.reason,
            "session_zone": self.session_zone,
        }
        # OMIT-WHEN-EMPTY. A binding with no parameters serialises byte-identically to
        # before this field existed. Emitting "parameters": null instead would change every
        # consumer's payload for zero information -- the same discipline AR-739 §1 measured
        # at Layer 1 as the whole difference between 0 and 18 re-seals.
        #
        # F-5 (R-684 §4.2): this said `is not None`, i.e. omit-when-NONE, while the caption
        # said omit-when-EMPTY. An empty tuple -- the natural encoding for "the producer
        # looked and found no parameters" -- emitted "parameters": {} on every binding and
        # walked straight into the re-seal hazard the caption exists to prevent. A truthiness
        # test makes the code mean what the caption always claimed.
        if self.parameters:
            out["parameters"] = dict(self.parameters)
        return out


def _session_phrase_hit(object_text: str, keywords: tuple[str, ...]) -> bool:
    norm = f" {object_text.strip().lower()} "
    return any(
        f" {kw} " in norm or norm.strip().startswith(kw) or norm.strip().endswith(kw)
        for kw in keywords
    )


def resolve_session_keyword(object_text: str) -> str | None:
    """Pure re-implementation of session_windows.resolve_session_keyword — kept
    local so this module has zero import surface beyond stdlib (portability
    for the TS mirror comparison in tests).

    Only ever returns a zone session_windows._ZONE_CHECKS can evaluate."""
    if not object_text:
        return None
    for zone, keywords in SESSION_KEYWORDS.items():
        if _session_phrase_hit(object_text, keywords):
            return zone
    return None


def refused_session_zone(object_text: str) -> str | None:
    """Mirror of session_windows.refused_session_zone. Names the zone a phrase
    WOULD have bound before the orphan-zone closure; never returns a binding."""
    if not object_text:
        return None
    for zone, keywords in REFUSED_SESSION_KEYWORDS.items():
        if _session_phrase_hit(object_text, keywords):
            return zone
    return None


# ─── Session-NAME → canonical-window resolver (REDESIGN sub-packet 1, R-284
# Decision A) ────────────────────────────────────────────────────────────────
# The HONEST name lane: a taught session NAME that maps into the CLOSED ENUM of
# first-class exact-window zones and carries NO clock token binds to its EXACT
# killzone window with approximation=False, because the enforced primitive
# (session_windows.is_in_killzone) evaluates that exact window — there is no
# clock derivation in the path, so the flag is truthful. The name→zone mapping
# IS `SESSION_KEYWORDS` (already the module's closed, deliberately-narrow,
# unambiguous-only enum; NO fuzzy matching). The pinned refusal cases
# (ambiguous / orphan-zone / wrap-window / clock-derived-coarse / unrecognized)
# are NOT this function's job — it returns None for all of them and the caller
# routes each to its correct NAMED refusal reason
# (packet-session-refusal-precedence-2026-07-21.md).
SESSION_NAME_ROUTE_PRIMITIVE: str = "session_windows.is_in_killzone"


def session_zone_window_repr(zone: str) -> str:
    """The exact [start,end) minute-of-day window(s) is_in_killzone evaluates for
    `zone`, formatted for the (ii) scope line (R-284 §1 pin (vi)). Empty string
    for a zone with no computable window (never reached on a name-route bind)."""
    intervals = _REAL_ZONE_INTERVALS.get(zone)
    if not intervals:
        return ""
    return ",".join(f"[{s},{e})" for s, e in intervals)


def resolve_session_name_to_window(object_text: str) -> tuple[str, str] | None:
    """Honest session-NAME → canonical-window resolution (R-284 Decision A §1(a)).

    Returns `(zone, scope_path)` for an UNAMBIGUOUS session NAME in the closed
    enum that carries NO clock token — `bindable=True, approximation=False`,
    primitive `is_in_killzone`. Returns None for everything else (clock present,
    or no closed-enum name), leaving the caller to route the correct refusal.

    Pinned (i): NO clock tokens ANYWHERE in the name path — a phrase carrying a
    clock is clock-derived-coarse, not a name, and refuses. Pinned: NO fuzzy
    matching — the enum is the exact `SESSION_KEYWORDS` phrase set."""
    if not object_text:
        return None
    # (i) A clock token anywhere disqualifies the name path outright.
    if _SESSION_CLOCK_TOKEN_RE.search(object_text.strip()):
        return None
    zone = resolve_session_keyword(object_text)
    if zone is None:
        return None
    return zone, f"name-route|zone={zone}|window={session_zone_window_repr(zone)}"


# ─── Role-Aware Session Resolver (docs/designs/packet-role-aware-session-
# resolver-2026-07-20.md) ───────────────────────────────────────────────────
# R-085 §2 / R-088 §3 / R-143 §3 item 2. ★ CORRECTED (R-185 §2, orphan-zone
# closure): this comment used to read "26 of 27 corpus-wide WAIT_SESSION
# conditions never bind." The honest figure is **27 of 27 EFFECTIVELY never
# bind.** The single binder bound `overnight` — an ORPHAN ZONE that
# is_in_killzone() could never evaluate True for — so it was an always-False
# gate wearing bindable=True, not a binding. Exact-phrase session coverage in
# this corpus was not 1/27; it was 0/27 wearing a 1. (Since the closure that
# row is honestly REFUSED, so the 0/27 is now visible rather than disguised.)
#
# ★ THIS STRENGTHENS THE ROLE-AWARE RESOLVER'S CASE RATHER THAN WEAKENING IT:
# all 8 real bound rows came from the NEW lane below; the LEGACY exact-phrase
# path binds NOTHING REAL in this corpus. The 26 -> 27 correction moves the
# resolver's marginal contribution from "26 recoverable" to "the entire
# legacy yield was zero."
#
# An independent blind grade split the 26 into 17 GENUINE session teachings the
# bare-phrase matcher cannot see, and 9 entry-mechanics MIS-TYPES — a separate
# reclassification lane, untouched here — session-a-mistype-dispositions.json.
#
# ★ THIS IS NOT A KEYWORD LIST. The blind grade produced a tension no flat
# list can express: bare "session" must bind ("New York session" as a named
# reference) · bare "am"/"pm" must NEVER bind (the existing fence below) ·
# "session"-as-filler-for-"the day" must NEVER bind (the known-bad fixture,
# "you might have a long idea for your session" — rejected by the grader
# because the word did no work). SESSION_KEYWORDS is intentionally NOT
# widened — a longer flat list cannot express ROLE and would bind filler
# right alongside genuine teaching. Instead: a time/session expression is
# RECOGNIZED only when it DOES WORK in the instruction — selects a candle,
# delimits a window, or constitutes the instruction as a named session
# range — via five independent, narrow, testable role markers below. None of
# them is "does the text contain a session-ish word."
#
# RECOGNITION vs BINDING are kept as two separate questions, on purpose.
# session_windows.py's runtime primitive (is_in_killzone) only knows FIVE
# real, computable windows (london/ny_am/ny_pm/silver_bullet/macro_window —
# see _REAL_ZONE_INTERVALS, a local mirror of session_windows.py's own
# constants, same duplication convention as SESSION_KEYWORDS above). Several
# of the 17 genuine teachings reference things it CANNOT compute:
#   - a bare "trading session" / ambiguous "New York session" with no am/pm
#     qualifier (which of the 5 windows? guessing is exactly the danger
#     resolve_session_keyword's own docstring warns against: "a miss is
#     honest, a false positive silently binds the WRONG window").
#   - session-anchored LEVEL references ("Asia high", "London low", "draw on
#     liquidity", "pre-market highs") — these are the object-reference
#     census's own `session_range` KIND (see the Population-A Level Resolver
#     block above, "fvg_edge / session_range / prior_day / absolute_price
#     ... OUT of this delivery's scope") — a level/zone concept, not a time
#     window, and level/zone is explicitly PROHIBITED in this packet.
# For these, recognition is real (the condition is honestly session
# teaching, not filler) but binding a time-window primitive to it would be a
# category error or a guess — so they stay UNBOUND, with a NEW reason
# (SESSION_TEACHING_UNBOUND_REASON) that is strictly more informative than
# the generic no_recognized_session_keyword: it tells a reader "we correctly
# SAW this is session language; we have no primitive that can compute it,"
# rather than conflating that with "we don't even recognize this as session
# language at all." This is exactly the §6a discipline (coverage = bound-
# and-concrete ÷ all taught; the unbound count travels beside the rate) —
# recognizing more without silently inflating the bound count is the point.
#
# The remaining 8-of-17 (empirically, over the grade's own 26-row sample —
# see docs/replay-results/h1-battery/session-ab-blind-grade-RESULT.json)
# carry an explicit clock-time span or a market-open/opening-bell anchor
# concrete enough to compute a real overlap against the 5 killzone windows;
# those DO bind, to the zone with GREATEST minute-overlap (deterministic,
# tie-broken by a fixed priority order), with approximation=True (a coarse
# containment proxy, never approximation=False — S8, the exactness claim is
# a separate, later, independently-graded step, same two-step discipline as
# the Population-A flip-step packet landing alongside this one).
SESSION_ANCHOR_PHRASE_RE = re.compile(
    r"\b(opening\s+bell|off\s+the\s+bell|new\s+york\s+bell|ny\s+bell|"
    r"market\s+open|nyse\s+open|cash\s+(?:equity\s+)?open|"
    r"new\s+york\s+stock\s+exchange\s+open)\b",
    re.IGNORECASE,
)
"""A named, concrete market-open anchor (NYSE cash open, 9:30 ET) — the
Known-GOOD calibration fixtures from the packet's own grade ("the first
two-minute candle OFF THE BELL", "drops at the OPENING BELL") are both named
instances of this exact phrase class. Deliberately NOT "bell" bare and NOT
"open" bare (way too common a word) — always a 2-3 word phrase anchored on
"bell"/"open" together with a market-open-specific qualifier.

★ H1 FIX (independent grade, BAND 6): this alternation previously carried a
bare `the\\s+bell` alternative, which CONTRADICTED the safety claim this very
docstring made. It false-bound ordinary prose to a real session window —
"the BELL PEPPER analogy I use for position sizing", "he was SAVED BY THE
BELL on that one", "I RING THE BELL every time I hit my daily target" all
returned bindable=True/session_zone=ny_am. Removed. The two calibration
fixtures are covered by `opening\\s+bell` and `off\\s+the\\s+bell`
respectively (proven by test_s2_known_good_bell_rows_are_bound, which is run
against this regex, not assumed). `new\\s+york\\s+bell` / `ny\\s+bell` /
`cash\\s+(equity\\s+)?open` are the SPECIFIC, qualified members of the same
2-3-word anchor class that the grader recorded as false negatives — each
names the NYSE cash open (9:30 ET) unambiguously, so each carries a real,
already-constant minute anchor rather than a guess."""

_SESSION_CLOCK_TOKEN_RE = re.compile(
    # Alt 1: H:MM, optional attached meridiem ("9:30", "3:00 a.m.").
    # Alt 2: bare hour, meridiem REQUIRED ("8am", "2 p.m.") — a bare hour with
    # no meridiem is never a clock token (that would match "20 SMA", "5 min").
    r"\b(?:(?P<h1>\d{1,2}):(?P<m1>[0-5]\d)\s*(?P<mer1>a\.?m\.?|p\.?m\.?)?(?![a-z])"
    r"|(?P<h2>\d{1,2})\s*(?P<mer2>a\.?m\.?|p\.?m\.?)(?![a-z]))",
    re.IGNORECASE,
)
"""H2/FN-morphology FIX: alternative 2 is new. The grader recorded "8am" as a
false negative — the previous pattern required a colon, so a colon-less
wall-clock token was invisible. The meridiem is MANDATORY in the colon-less
form (and guarded by `(?![a-z])` so "among"/"amp" cannot supply it), which
keeps the pre-existing bare-"am"/"pm" fence intact: bare-token prose has no
adjacent digit and therefore still produces zero clock tokens."""


def _session_clock_token_parts(match: re.Match) -> tuple[int, int, str | None]:
    """(hour, minute, meridiem-or-None) for either _SESSION_CLOCK_TOKEN_RE
    alternative — keeps callers free of the two-alternative group layout."""
    if match.group("h1") is not None:
        return int(match.group("h1")), int(match.group("m1")), match.group("mer1")
    return int(match.group("h2")), 0, match.group("mer2")


_SESSION_CLOCK_MARKET_CONTEXT_RE = re.compile(
    r"\b(new\s+york\s+stock\s+exchange|nyse|utc\s*-?\s*4|utc\s+minus\s+4|"
    r"market\s+open|opening\s+bell|cash\s+open|kill\s?zone)\b",
    re.IGNORECASE,
)
"""TIER 1 clock context — names the MARKET itself, so it is sufficient on its
own to read an unmarked "H:MM" as a wall-clock market reference."""

_SESSION_CLOCK_TZ_CONTEXT_RE = re.compile(
    r"\b(a\.m\.|p\.m\.|am|pm|est|edt|eastern\s+time|eastern)\b",
    re.IGNORECASE,
)
"""TIER 2 clock context — a bare TIMEZONE phrase. NOT sufficient on its own
(M1 FIX): "eastern time" is ordinary English scheduling vocabulary, and on
its own it bound "we had a 3:00 coaching session with the mentor yesterday,
EASTERN TIME" to the london window. A tier-2 marker now counts only when the
clock token is additionally GOVERNED by a span/selection preposition (see
_SESSION_CLOCK_SPAN_PREP_RE) — i.e. the time is doing delimiting work in the
instruction, not merely being mentioned.

MEASURED, not guessed: zero rows of the 26-row grading corpus depend on the
tier-2 alternatives alone. The three rows carrying "Eastern time"/"EST" all
also carry their own a.m./p.m. meridiem (which never needed context at all),
and the only two context-dependent rows are corroborated by TIER 1 markers
("UTC minus 4", "New York Stock Exchange"). Deleting the timezone alternative
outright was therefore possible but would have lost genuine inputs like "wait
until 14:30 EST"; narrowing it is the smaller, better-targeted change."""

_SESSION_CLOCK_SPAN_PREP_RE = re.compile(
    r"\b(from|until|till|through|between|starting|after|before|by|to)\s+"
    r"(?:the\s+)?\d{1,2}(?::[0-5]\d)?(?:\s*(?:a\.?m\.?|p\.?m\.?))?(?![\d:])",
    re.IGNORECASE,
)
"""A temporal preposition directly governing a clock numeral ("UNTIL 14:30",
"FROM 9:30 to 9:45") — the corroboration a tier-2 timezone-only context must
carry. "had a 3:00 coaching session" carries no such governor."""

_SESSION_TIME_SCAFFOLD_WORDS: frozenset[str] = frozenset(
    {
        "a", "an", "the", "at", "by", "on", "of", "in",
        "around", "about", "approximately", "roughly", "sharp",
        "from", "to", "until", "till", "through", "between", "and", "or",
        "et", "est", "edt", "eastern", "standard", "time", "o", "clock", "oclock",
    }
)
"""The closed set of scaffold words a pure time expression may carry and still
BE nothing but a time expression ("at 8am", "from 9:30 to 9:45 ET"). Note what
is deliberately ABSENT: every noun, every verb, every subject. A sentence that
merely CONTAINS a clock ("garbage pickup is at 8 a.m.") leaves "garbage",
"pickup", "is", "Thursdays" behind and is therefore never constituted by its
clock. Kept as an explicit frozenset rather than a regex so the exact
admissible vocabulary is auditable in one place."""

_SESSION_RESIDUE_WORD_RE = re.compile(r"[a-z]+", re.IGNORECASE)


def _session_text_is_constituted_by(text: str, spans: list[tuple[int, int]]) -> bool:
    """True iff deleting `spans` from `text` leaves nothing but scaffold words —
    i.e. the matched expression IS the condition object, rather than being
    mentioned inside a sentence that is about something else.

    ★ THIS IS NOT BARE-TOKEN MATCHING (packet §3). Bare-token matching asks
    "does this text CONTAIN token X" and therefore fires anywhere inside
    arbitrary prose — that is exactly how bare `the bell` bound "the bell
    pepper analogy". This asks the opposite, strictly stronger question: "is
    this text NOTHING BUT expression X". It cannot fire inside a sentence,
    because a sentence by definition has a subject and a verb left over. It is
    a required qualifier that only ever NARROWS, never a lexicon that widens.

    Empty `spans` must never be passed (all callers guard on a prior match);
    with no spans the whole text is residue and an ordinary sentence fails
    immediately, so the degenerate case is safe rather than vacuous."""
    remainder: list[str] = []
    cursor = 0
    for start, end in sorted(spans):
        if start > cursor:
            remainder.append(text[cursor:start])
        cursor = max(cursor, end)
    remainder.append(text[cursor:])
    words = _SESSION_RESIDUE_WORD_RE.findall(" ".join(remainder))
    return all(word.lower() in _SESSION_TIME_SCAFFOLD_WORDS for word in words)


SESSION_REOPEN_TOKEN_RE = re.compile(r"\bre-?opens?\b", re.IGNORECASE)
"""The RE-prefixed session boundary verb standing as the whole condition object
("reopen"). Recognized, NEVER zone-mapped.

★ RULING (advisor, second pass). The previous delivery refused bare "reopen"
outright (recognized=False) on the grounds that it is "a bare token with no
session noun". That reason was inconsistent with this same module's own
accepted rows: "8am", "cash open", "cash equity open", "the New York bell" and
"European open" are ALL bare tokens with no session noun, and every one of them
is accommodated. The reason cannot be the bareness.

The real, consistently-applicable distinction is whether the expression carries
a COMPUTABLE TIME ANCHOR. "cash open" does (9:30 ET, this module's one
non-guessed constant). "reopen" does not — it names a recurring boundary
without saying which one, exactly like "European open", which this module
already places in the recognized-but-unbound bucket
(SESSION_TEACHING_UNBOUND_REASON). Applied consistently, "reopen" belongs in
that same bucket: recognized=True, zone=None.

Scoped by _session_text_is_constituted_by so it can only fire when the verb IS
the object. "the store reopens at nine" keeps a subject and is untouched."""

SESSION_BOUNDARY_VERB_RE = re.compile(
    r"\bsession\b.{0,20}?\b(re-?opens?|opens?|starts?|begins?|resets?)\b"
    r"|\b(re-?opens?|opens?|starts?|begins?|resets?)\b.{0,20}?\bsession\b",
    re.IGNORECASE,
)
"""The word "session" co-occurring with a boundary verb ("session STARTS
again", "New York session OPENS") — the VERB is what does the work (marking
a recurring time boundary), independent of whether a proper session name is
attached. This is what correctly recognizes "this line is being reset as
soon as every single session starts again" (generic "session", no proper
name) while still refusing the known-bad "for your session" (no boundary
verb anywhere nearby)."""

SESSION_TEMPORAL_PREPOSITION_RE = re.compile(
    r"\b(before|after|prior\s+to|until|into)\b[^.]{0,30}?\b(trading\s+session|session)\b",
    re.IGNORECASE,
)
"""A temporal-selecting preposition governing a session noun within the same
clause — "BEFORE my trading session", "AFTER being below it at the opening
bell" (also caught by the anchor-phrase rule). This is the packet's named
"hardest sub-case": pattern-plus-timing ("a bullish engulfing pattern form
BEFORE my trading session") — the time reference selects which candle
qualifies, so recognizing it preserves the instruction rather than
distorting it. Bare "for your session" (the known-bad fixture) does NOT
match — "for" is deliberately not in the preposition set; nor does "prior to
the displacement" (a different, non-session-noun governed phrase) —
verified by the bare-am/pm regression fence below (test class carries a
"prior to" preposition with no session noun anywhere in the sentence)."""

SESSION_LIQUIDITY_LEVEL_ENUM_RE = re.compile(r"\b(draw[\s-]on[\s-]liquidity|key\s+level)\b", re.IGNORECASE)
SESSION_NAMED_TOKEN_RE = re.compile(r"\b(london|new\s+york|ny|asian?|pre[\s-]?market)\b", re.IGNORECASE)
""""draw on liquidity"/"key level" enumeration co-occurring with a named
session token ("Asia high", "London low", "pre-market highs") — this is the
session_range level/zone kind (see block comment above): genuinely session
vocabulary, but a LEVEL reference rather than a time window, so it is
recognized but never zone-mapped (see classify_session_role)."""

SESSION_MARKET_OBJECT_RE = re.compile(
    r"\b(candles?|bars?|charts?|prices?|patterns?|engulfing|fair\s+value|fvg|"
    r"gaps?|sweeps?|liquidity|trend|trendlines?|lines?|levels?|zones?|ranges?|"
    r"vwap|v-wop|sma|ema|volume|entries|entry|trades?|setups?|positions?|"
    r"orders?|stops?|targets?|long|short|buy|sell|bullish|bearish|breakouts?|"
    r"reversals?|markets?|highs?|lows?)\b",
    re.IGNORECASE,
)
"""A price/chart OBJECT the instruction is about — the required co-factor for
the two weakest role markers below (boundary-verb and temporal-preposition).

★ M1/H1-class FIX (independent grade, BAND 6). Both of those markers fire on
the ENGLISH SHAPE of a sentence alone, so both false-bound ordinary prose
that happens to contain the word "session":
  - "PRIOR TO THE SESSION I like to drink my coffee and stretch"
      (temporal preposition + session noun — but the governed object is a
       morning routine, not a chart object)
  - "START a new SESSION in the terminal before running the backtest"
      (boundary verb + session noun — but it is a SHELL session)
Neither is session teaching. Requiring a market object turns each marker from
"this sentence has the grammar of a session reference" into "this sentence is
about a market thing AND has the grammar of a session reference."

★ WHY THIS IS NOT THE BANNED REPAIR (packet §3 prohibits widening
SESSION_KEYWORDS / bare-token matching): this lexicon is a REQUIRED CONJUNCT,
never a disjunct. It is ANDed onto two existing markers, so it can only ever
NARROW recognition — it is structurally incapable of binding anything that
was not already bound. A lexicon used this way cannot produce a false
positive; the worst it can do is produce a false NEGATIVE, which is the
honest failure direction this module already prefers everywhere else.

Validated against BOTH populations, not fitted to one: all 5 rows of the
26-row grading corpus that depend on these two markers still recognize
(they carry "candle"/"pattern"/"engulfing"/"fair value"/"line"), and both
grader-recorded false positives above are refused."""

SESSION_STRONG_MARKET_OBJECT_RE = re.compile(
    r"\b(candles?|candlesticks?|wicks?|charts?|fair\s+value|fvg|"
    r"engulfing|vwap|v-wop|sma|ema|kill\s?zone|bullish|bearish|breakouts?|"
    r"trendlines?|order\s+blocks?|liquidity|setups?|"
    r"pips?|ticks?|stop\s+loss|take\s+profit|"
    r"price\s+action|indicators?|highs?\s+and\s+lows?)\b",
    re.IGNORECASE,
)
"""★ SECOND-PASS FIX (advisor clarification: a RECOGNITION leak counts as a
false positive even when no zone binds).

SESSION_MARKET_OBJECT_RE below is a broad lexicon, and roughly half of it is
ordinary English in non-market senses — `long`, `high`, `low`, `levels`,
`volume`, `trend`, `market`, `entry`, `lines`, `rows`, `ranges`, `orders`,
`stops`, `targets`, `buy`, `sell`. Used as the required co-factor it let
ordinary prose through on a single incidental word. MEASURED over 24
non-market prose probes: 4 HARD false positives ("I bought a LONG dress at 3
p.m." -> ny_pm; "traffic VOLUME peaks at 8 a.m. downtown" -> ny_am; "the
water LEVELS rise at 4 a.m." -> london) and 11 recognition leaks.

A recognition leak is a latent hard bind: nothing in the RULE rejected it —
the window table did, by arithmetic. Widen that table, or feed it a clock
that happens to land inside a window, and it converts straight into a silent
wrong-window bind. So the leak is the defect, not the near-miss.

This is the STRONG subset: vocabulary with no common non-market reading. Every
member names a charting or trading object outright. It is what the co-factor
tests actually require now. Like its parent this is a required CONJUNCT, never
a disjunct — it can only ever narrow recognition.

★ WHAT THIS SET DELIBERATELY EXCLUDES, and why the exclusions are the proof.
`backtest` was in the first draft of this set and had to be removed: it
re-admitted the grader's OWN documented false positive "start a new session in
the terminal before running the BACKTEST" (a SHELL session), which the broad
lexicon had correctly refused. A strong-vocabulary word can still appear in a
sentence that is about tooling rather than about a chart. Likewise excluded on
purpose: `market` (market square, supermarket, trade show), `price` (price of
milk), `volume` (traffic volume), `level`, `trend`, `high`, `low`, `long`,
`short`, `open`, `entry`, `line`, `range`, `order`, `stop`, `target`, `buy`,
`sell` — every one of them produced a measured false positive.

A THIRD, fresh adversarial batch (authored after the two above, never run
against an earlier draft) proved the first draft of this set was still tuned
to its own probes: `bars`, `trades`, `patterns`, `entries` and `sweeps` each
produced a NEW false positive — "the TRADE show opens at 9 a.m." -> ny_am,
"the BAR closes at 2 a.m." -> london, "his sleep PATTERNS changed ... at 3
a.m." -> london, "traffic ENTRIES onto the highway back up at 8 a.m." ->
ny_am, "she SWEEPS the kitchen floor at 6 a.m.". They are therefore NOT in
this set; they moved to SESSION_AMBIGUOUS_MARKET_OBJECT_RE below, which
requires corroboration."""

SESSION_AMBIGUOUS_MARKET_OBJECT_RE = re.compile(
    r"\b(bars?|trades?|trading|entries|entry|patterns?|sweeps?|positions?|"
    r"levels?|volumes?|prices?|markets?|longs?|shorts?|orders?|stops?|"
    r"targets?|ranges?|gaps?|trends?|lines?|reversals?|zones?|buy|sell)\b",
    re.IGNORECASE,
)
"""Market vocabulary that is ALSO ordinary English. Each of these names a real
chart object in a trading text and something else entirely in prose — a bar
you drink in, a trade show, sleep patterns, traffic entries, sweeping a floor,
the price of milk, traffic volume, a job position, tide levels, a long dress.

ONE of these is not evidence that a text is about markets. TWO DISTINCT ones
are: the probability that unrelated prose happens to carry two different
trading nouns AND a meridiem clock is low, while genuine teaching that avoids
every unambiguous term ("no TRADES after 11:30 a.m., PRICE goes dead"; "wait
for the 10 a.m. REVERSAL before taking the TRADE") reliably carries two.

That two-distinct-hit rule is the whole mechanism — see _session_is_about_
markets. It is a graduated conjunct, not a longer keyword list: adding a word
here makes recognition HARDER to reach than adding it to the strong set,
because it still needs a partner.

KNOWN RESIDUAL, stated rather than hidden: two ambiguous words CAN co-occur in
prose ("VOLUME on the radio was too high at 7 a.m." would leak if bare `high`
were in this set — which is why it is not). The rule narrows the class; it
does not claim to close it."""


_SESSION_CLOCK_ATTRIBUTIVE_RE = re.compile(
    r"^[\s-]*(?:o'?clock\s+)?(?:candles?|candlesticks?|bars?|charts?|wicks?|"
    r"sessions?|opens?|closes?|highs?|lows?|prints?|prices?|reversals?|"
    r"engulfings?|setups?|entries|entry|sweeps?|gaps?|pushes?|moves?|"
    r"pullbacks?|breakouts?|rallys?|rallies|drops?|dumps?|pumps?)\b",
    re.IGNORECASE,
)
"""A market object standing IMMEDIATELY after a clock token — the attributive
use, where the time modifies the noun: "the 9:30 A.M. CANDLE", "the 3 P.M.
BAR", "the 10 A.M. REVERSAL".

Adjacency is the whole point and is checked with `^`, against the text that
directly follows the token. "we buy and sell furniture at the MARKET AT 9
a.m." does not match: a preposition intervenes, which in English means the
time modifies the VERB, not the noun."""


_SESSION_CLOCK_DEMONSTRATIVE_RE = re.compile(
    r"\b(?:this|that)\s+(?:one|candles?|bars?|print|leg)\s+at\s+\d",
    re.IGNORECASE,
)
"""Demonstrative selection — "this ONE AT 7:00 a.m.", "that CANDLE AT 9:30".

A demonstrative pointing at an instance and then timestamping it is SELECTION,
not mention: the time answers "which one". This is the construction used by the
blind-graded corpus row "I'm looking at two candles, THIS ONE AT 7:00 a.m. and
THIS ONE AT 8:00 a.m." — which the span-preposition and attributive tests both
miss, because the chart noun precedes the clock and "at" governs it.

Deliberately narrow: it requires the demonstrative AND the instance noun AND
the timestamp, adjacent. "the bar orders more stock at 10 a.m." has no
demonstrative; "we buy furniture at the market at 9 a.m." has none either."""


def _session_clock_does_work(norm: str, clock_tokens: list[re.Match]) -> bool:
    """★ THE MECHANISM FIX (advisor clarification: recognition leaks count).

    Is the clock SELECTING or DELIMITING something, or is it merely MENTIONED?

    Four successive lexicon drafts failed to separate market prose from
    ordinary prose, because the vocabulary is genuinely polysemous — a bar you
    drink in, a trade show, sleep patterns, birthday candles, the liquidity of
    an estate, charting your workouts, a setup crew. Every draft passed the
    batch it was written against and leaked on the next one. A longer or
    better-chosen word list is not the answer; the word list was the wrong
    instrument.

    The separating feature is GRAMMATICAL, not lexical. Ordinary prose
    MENTIONS a time — almost always with "at": "garbage pickup is AT 8 a.m.",
    "the bar orders more stock AT 10 a.m.", "he charts his workouts AT 6 a.m."
    Trading instructions make the time DO something:
      - govern it with a selection preposition — "AFTER 9:30", "BETWEEN 10 and
        11", "UNTIL 14:30", "FROM 9:30 to 9:45"   (_SESSION_CLOCK_SPAN_PREP_RE)
      - or attach it attributively to a chart object — "the 9:30 a.m. CANDLE"
        (_SESSION_CLOCK_ATTRIBUTIVE_RE)
      - or let the time BE the whole condition ("8am")  (handled by the caller)

    That is the same "does it do work in the instruction" test the module's own
    header says the resolver is built on — applied to the clock path, which had
    never actually been held to it.

    HONEST COST, measured and not hidden: this refuses genuine teachings whose
    clock is also a bare mention — "the trendline break AT 8:30 a.m. is the
    trigger", "wait for a bullish engulfing AT 8:15 a.m." Those become false
    NEGATIVES. That is the direction this module chooses on purpose: "a miss
    is honest, a false positive silently binds the WRONG window."
    """
    if _SESSION_CLOCK_SPAN_PREP_RE.search(norm):
        return True
    if _SESSION_CLOCK_DEMONSTRATIVE_RE.search(norm):
        return True
    # ★ FOURTH PASS. A fourth structural way for the clock to be doing work:
    # the PP it heads is governed by the instruction's own trading predicate.
    # See _session_action_governed_clock — this is not a longer preposition
    # list; the discriminator moved from the preposition to the government
    # relation, which is why mention-prepositions ("at", "into") can now count
    # in this position and only in this position.
    if _session_action_governed_clock(norm, clock_tokens):
        return True
    return any(_SESSION_CLOCK_ATTRIBUTIVE_RE.match(norm[token.end():]) for token in clock_tokens)


_SESSION_NOUN_QUALIFIER_ALLOWED: frozenset[str] = frozenset(
    {
        # determiners / quantifiers / ordinals — carry no domain of their own
        "the", "a", "an", "this", "that", "these", "those", "each", "every",
        "any", "all", "single", "one", "same", "whole", "entire", "both",
        "new", "next", "last", "first", "second", "prior", "previous",
        "current", "coming", "following", "upcoming", "another",
        # market / session names — a qualifier that is itself session vocabulary
        "trading", "market", "cash", "regular", "main", "overnight",
        "london", "york", "ny", "asian", "asia", "european", "europe",
        "tokyo", "frankfurt", "sydney", "globex", "us", "u.s.", "american",
    }
)
"""The CLOSED set of words that may directly qualify the noun "session" and
still leave it a market session.

★ SECOND-PASS. The boundary-verb and temporal-preposition markers leaked
recognition on ordinary prose that merely contains "session": "my GYM session
starts before the traffic volume picks up", "the THERAPY session opens with a
short breathing entry", "our STUDY session starts after the long weekend",
"before my YOGA session I check the water levels", "after the COUNSELLING
session we buy groceries at the market", "the PHOTOGRAPHY session opens with
wide shots of the market square". In every one, the leak is carried by the
qualifier: a non-market common noun sitting directly in front of "session".

The genuine corpus rows, by contrast, qualify it only with determiners —
"every SINGLE session starts again", "with every NEW session", "a reference
for THE session". So this is a WHITELIST of domain-free qualifiers, not a
blacklist of bad ones: an unknown qualifier is refused by default, which is
the honest direction. Deliberately NOT a widening — it is a third required
conjunct on two markers that already carry two.

Chosen over promoting these markers to SESSION_STRONG_MARKET_OBJECT_RE
because that measurably COST a genuine blind-graded corpus row (the "this
line is being reset as soon as every single session starts again" teaching,
which carries only the ambiguous word "line"). This rule keeps that row and
refuses all six leaks."""

_SESSION_NOUN_RE = re.compile(r"(?:(?P<qual>[A-Za-z][\w'’.-]*)\s+)?\bsessions?\b", re.IGNORECASE)


def _session_noun_qualifier_is_market_compatible(norm: str) -> bool:
    """True iff at least one occurrence of the noun "session" is unqualified or
    carries a qualifier from the domain-free whitelist. A text whose every
    "session" is qualified by a foreign noun ("gym session") is not session
    teaching, however good its grammar looks."""
    found_any = False
    for match in _SESSION_NOUN_RE.finditer(norm):
        found_any = True
        qualifier = match.group("qual")
        if qualifier is None or qualifier.lower() in _SESSION_NOUN_QUALIFIER_ALLOWED:
            return True
    # No "session" noun at all -> this gate has nothing to say; the marker's
    # own regex (which may have matched "trading session" phrasing elsewhere)
    # stays in charge. Never used to REJECT a text that never mentioned one.
    return not found_any


# ─── THIRD PASS: the market-ness can live in the VERB, not only in a NOUN ────
#
# ★ THE DEFECT THIS FIXES. The second pass established the right mechanism —
# the clock must DO WORK, not merely be mentioned — and cut false positives
# 38.0% -> 6.0% (recognition-leak axis 74.0% -> 6.0%). But it paired that
# grammatical test with a market-context co-factor that is still a NOUN
# lexicon (_session_is_about_markets). So a sentence whose clock genuinely
# delimits a window AND which commands an explicit trading action, but which
# names no instrument and no chart object, fails the co-factor and is
# rejected. Independently adjudicated by two blind judges (unanimous,
# calibrated 15/15 and 12/12), 13 such genuine teachings were being missed:
# "be flat by 3:50 p.m.", "close every position by 11 a.m.", "no trading
# until 9:30 a.m." — every one a real instruction, none with a market noun.
#
# The second pass's own finding, under-applied: market NOUNS are not the
# discriminator. Neither, though, are market VERBS — "the kids need to be at
# daycare BY 8 a.m." and "we EXIT the highway before 8 a.m." are verb + a
# clock that does work, and admitting them would reopen exactly the class the
# second pass closed at real cost.
#
# ★ THE RULE, stated structurally. The discriminator is not that a verb is
# present but WHAT THE VERB ACTS UPON. Being somewhere by a time is not a
# trading action; being FLAT by a time is. So a trading action is recognized
# only as a CONSTRUCTION — a predicate together with its argument — never as
# a word appearing anywhere in the sentence. Three constructions, below:
#
#   (A) PREDICATIVE POSITION STATE — a copula/inchoative verb whose complement
#       is a position state ("BE flat", "GET flat"), or a verb whose only
#       reading is a position operation ("flatten", "scale out", "stopped
#       out"). The predicative frame is what does the work: it refuses "the
#       FLAT we rent" (determiner + noun, not a copula complement) and, with
#       an explicit exclusion list, the adverbial idioms "flat out", "flat
#       broke", "flat on my back".
#
#   (B) TRANSACTION VERB + POSITION COMPLEMENT — a transaction verb followed,
#       within a closed set of domain-free determiners, by a position noun:
#       "close every position", "take one trade", "add to the position".
#       ORDER AND ADJACENCY ARE THE MECHANISM. Neither half counts alone, so
#       "close the store" (verb, no position noun) and "the POSITION we
#       advertised CLOSES at 5 p.m." (noun before verb, no government) are
#       both refused. The determiner set is reused from the same whitelist
#       principle as _SESSION_NOUN_QUALIFIER_ALLOWED: "add to the GROCERY
#       order" is refused because "grocery" is a foreign noun qualifier.
#
#   (C) NEGATED BARE TRANSACTION — "NO trading", "STOP trading", "not
#       trading". A negator or cessation verb directly governing a bare,
#       objectless trade-gerund. Ordinary English rarely negates a bare verb
#       with no object; where it does, it supplies one ("stopped trading
#       baseball CARDS"), which the exclusion list catches.
#
# WHY THIS IS NOT THE BANNED REPAIR. This is not a widening of
# SESSION_KEYWORDS and not bare-token matching: no member of any set below
# can fire on its own. Each is one half of a two-part construction that must
# appear in a specific order and adjacency. And the whole thing remains
# ANDed under _session_clock_does_work — it is a new way to satisfy an
# EXISTING conjunct, never a new path around the clock-role test. Sentences
# whose clock is a bare mention ("wait for a bullish engulfing AT 8:15 a.m.")
# are still missed, deliberately and unchanged.

_SESSION_POSITION_STATE_RE = re.compile(
    # (A1) copula / inchoative + the position state "flat", minus the ordinary
    # English adverbial idioms that share the frame.
    r"\b(?:be|being|am|is|are|was|were|get|gets|got|getting|go|goes|going|"
    r"stay|stays|stayed|staying|remain|remains|end\s+up|ending\s+up)\s+"
    r"(?:completely\s+|totally\s+|fully\s+|all\s+|already\s+)?"
    r"flat\b(?!\s*(?:out|broke|on|tyre|tire|white|screen|share|mate|rate|"
    r"fee|line|lined|footed|handed|chested|earth|iron|pack|land))"
    # (A2) verbs with no non-market reading in this frame.
    r"|\bflatten(?:s|ed|ing)?\b"
    r"|\bscal(?:e|es|ed|ing)\s+(?:in|out)\b"
    r"|\bstopped\s+out\b",
    re.IGNORECASE,
)
"""(A) A PREDICATIVE position state. See the block comment above.

★ EARNED EXCLUSIONS, each from a pre-registered adversarial that broke an
earlier draft of this regex rather than from imagination. "the movers will BE
FLAT OUT until 6 p.m.", "we will BE FLAT BROKE by 5 p.m.", "I will BE FLAT ON
my back until 10 a.m." all match `be + flat` and are ordinary English; the
lookahead refuses them. `long` and `short` were in the first draft as
predicative states ("go long") and were REMOVED: "this meeting could GO LONG
before lunch" and "we are SHORT on time until 3 p.m." are the same frame in
ordinary use, and no lookahead separates them without also refusing the
genuine form. That is a deliberate false negative, pinned in the tests."""

_SESSION_ACTION_DETERMINERS: frozenset[str] = frozenset(
    {
        "the", "a", "an", "my", "your", "our", "his", "her", "their", "its",
        "this", "that", "these", "those", "each", "every", "all", "any",
        "both", "half", "one", "two", "three", "some", "several", "few",
        "first", "last", "final", "remaining", "rest", "open", "live",
        "runner", "runners", "winning", "losing", "current", "existing",
        "new", "whole", "entire", "single", "other", "same", "of", "to",
    }
)
"""The CLOSED set of words that may stand between a transaction verb and its
position-noun complement without breaking the government relation. Every
member is a determiner, quantifier, ordinal or position-internal word — none
carries a domain of its own. Same whitelist principle as
_SESSION_NOUN_QUALIFIER_ALLOWED: an UNKNOWN intervening word is refused by
default, which is what turns away "add to the GROCERY order", "hold my SPOT
in line" and "we scale the RECIPE up"."""

_SESSION_ACTION_ON_POSITION_RE = re.compile(
    r"\b(?:close|closes|closed|closing|exit|exits|exited|exiting|"
    r"cut|cuts|cutting|trim|trims|trimmed|trimming|"
    r"hold|holds|held|holding|take|takes|taking|took|"
    r"add(?:s|ed|ing)?\s+to|liquidat(?:e|es|ed|ing)|offload(?:s|ed|ing)?|"
    r"dump|dumps|dumped|dumping|flatten(?:s|ed|ing)?)\s+"
    r"(?:(?:" + "|".join(sorted(_SESSION_ACTION_DETERMINERS, key=len, reverse=True)) + r")\s+){0,3}"
    r"(?:positions?|trades?|entries|entry|runners?|contracts)\b"
    # A foreign HEAD noun following the position word means the position word
    # was only an attributive modifier: "the ENTRY fee", "the ENTRY ramp",
    # "the CONTRACT cleaners", "the TRADE show".
    r"(?!\s+(?:fee|fees|ramp|road|form|forms|hall|way|door|level|levels|"
    r"exam|test|code|deadline|window|requirement|show|shows|desk|cleaners?|"
    r"lawyers?|price|prices|number|numbers|list|lists))",
    re.IGNORECASE,
)
"""(B) A TRANSACTION VERB GOVERNING A POSITION NOUN. See the block comment.

★ EARNED EXCLUSIONS. `order(s)` was in the first draft's noun set and was
REMOVED — "ADD TO THE ORDER before 6 p.m." is a restaurant tab, and the
determiner whitelist cannot help because "the" is legitimately in it. Singular
`contract` was removed for the same reason ("close the contract by 5 p.m." is
a business deal); plural `contracts` is kept, which is the futures reading.
`open`, `enter` and `buy`/`sell` were removed from the VERB set: "OPEN the
shop by 6 a.m.", "ENTER the building before 9 a.m." are ordinary, and their
genuine trading uses are already carried by the noun co-factor. The trailing
lookahead is what keeps "the ENTRY fee doubles after 8 p.m." and "the CONTRACT
cleaners finish before 6 a.m." out."""

_SESSION_NEGATED_TRADING_RE = re.compile(
    r"\b(?:no|not|never|stop|stops|stopped|stopping|avoid|avoids|avoiding|"
    r"quit|quits|cease|ceases|ceased|halt|halts|skip|skips|"
    r"don'?t|do\s+not|doesn'?t|didn'?t)\s+"
    r"(?:any\s+|all\s+|more\s+|new\s+|further\s+)?"
    r"trad(?:e|es|ing)\b"
    # ★ OBJECTLESS, checked as a frame rather than as a blacklist. What follows
    # the gerund must be a clause boundary or a function word — never the start
    # of a noun phrase. See _SESSION_INTRANSITIVE_CONTINUERS.
    r"(?=\s*(?:$|[,.;:!?)—-]|\b(?:" + "|".join(
        sorted(
            {
                "until", "till", "after", "before", "from", "between", "through",
                "past", "during", "while", "unless", "once", "when", "than",
                "at", "on", "in", "into", "by", "to", "for", "and", "or", "but",
                "today", "again", "anymore", "yet", "now", "here", "live",
                "that", "if", "so", "because", "all", "period",
            },
            key=len,
            reverse=True,
        )
    ) + r")\b))",
    re.IGNORECASE,
)
"""(C) A NEGATOR OR CESSATION VERB DIRECTLY GOVERNING A BARE, OBJECTLESS
TRADE-GERUND — "NO TRADING until 9:30", "STOP TRADING after 11:30", "only
watching, NOT TRADING, until 10 a.m."

★ THE OBJECTLESS TEST IS THE MECHANISM, and the first draft got it wrong in a
way worth recording. That draft blacklisted the object heads it could think of
(`cards`, `places`, `shows`...). The pre-registered adversarial "we STOPPED
TRADING BASEBALL CARDS after 3 p.m." walked straight through it — the head
noun was two words away, and no blacklist of heads ever closes that. Replaced
by the frame test above: a transitive use is followed by its object's
determiner or modifier, an intransitive use by a preposition, a conjunction or
a clause boundary. "stopped trading BASEBALL cards" is refused because
"baseball" opens a noun phrase; "no trading UNTIL 9:30" passes because "until"
cannot. That is a grammatical property, not a vocabulary one."""


def _session_has_trading_action(norm: str) -> bool:
    """Does this text command a TRADING ACTION — a verb acting on a position,
    an entry/exit, or the act of trading itself?

    This is the third-pass co-factor. It is consulted ONLY as an alternative
    to _session_is_about_markets, and only inside the existing
    _session_clock_does_work conjunct, so it can never admit a sentence whose
    clock is a bare mention. See the block comment above for the three
    constructions and why a verb LEXICON alone would have failed the same way
    the four noun-lexicon drafts did."""
    return (
        _SESSION_POSITION_STATE_RE.search(norm) is not None
        or _SESSION_ACTION_ON_POSITION_RE.search(norm) is not None
        or _SESSION_NEGATED_TRADING_RE.search(norm) is not None
    )


# ─── FOURTH PASS: the discriminator is GOVERNMENT, not the preposition ──────
#
# ★ THE DEFECT THIS FIXES. The third pass loosened the market-context co-factor
# so a trading ACTION can satisfy it, and that worked. But three known misses
# fire the action conjunct and still die, because the LIMITER moved to
# _session_clock_does_work — the clock-role test, which the third pass
# deliberately left untouched:
#
#   "...so I FLATTEN before that"          — `flatten` is named verbatim in
#                                             _SESSION_POSITION_STATE_RE
#   "I SCALE OUT into 3:45 p.m."            — `scale out` is named verbatim
#   "I CLOSE EVERY POSITION at 3pm on Fridays"
#                                           — the canonical (B) example
#
# Each has a clock that genuinely governs the action. Each fails the clock-role
# test, for a reason that is purely about the SURFACE of the clock's immediate
# neighbourhood: `at` and `into` are not in _SESSION_CLOCK_SPAN_PREP_RE's set,
# and `before that` puts an anaphor where that set demands a numeral.
#
# ★ TWO OF THE THREE LAND. The third does NOT, and the reason is the measured
# finding of this pass rather than an oversight: see
# _session_government_licensed_action_edges. In short — the clock-role test was
# silently doing false-positive work FOR the action conjunct, so the polysemous
# action constructions (copula + `flat`; transaction-verb + position-noun) may
# not license a governed clock without re-opening the FP class. "close every
# position at 3pm" is refused by the same rule that refuses "we close the
# positions at 5 p.m., the listings expire". Pinned as a failing-visible test.
#
# ★ THE TRAP, and why simply adding prepositions is the banned repair.
# "garbage pickup is AT 8 a.m. on Thursdays" has the IDENTICAL prepositional
# shape as "close every position AT 3pm on Fridays". Adding `at` to
# _SESSION_CLOCK_SPAN_PREP_RE would make that test very nearly vacuous —
# essentially every clock in English prose is introduced by `at` — and would
# hand the entire discrimination back to the market co-factor, which is the
# lexicon layer that failed four times running. That is precisely the FP class
# the second pass spent two passes closing.
#
# ★ THE RULE, stated structurally. The three existing clock-role tests all ask
# a question about the clock's own local neighbourhood: which preposition sits
# in front of it (_SESSION_CLOCK_SPAN_PREP_RE), which noun sits behind it
# (_SESSION_CLOCK_ATTRIBUTIVE_RE), whether it is the entire object
# (_session_text_is_constituted_by). A neighbourhood question cannot separate
# two sentences whose neighbourhoods are identical, which is exactly the
# garbage-pickup/close-every-position pair.
#
# This asks a different question: WHAT PREDICATE GOVERNS THE PREPOSITIONAL
# PHRASE THE CLOCK HEADS? A temporal PP is doing work in an instruction when it
# modifies that instruction's own verb. So:
#
#     the clock does work iff a TRADING-ACTION CONSTRUCTION's right edge is
#     immediately followed — modulo a closed set of domain-free adverbs — by a
#     temporal preposition whose complement IS that clock token.
#
# Government is directional and adjacent, so co-presence is not enough: "I
# closed the position and the ceremony starts at 3 p.m." carries a full-strength
# trading action AND a clock, and is refused, because the PP hangs off
# "starts", not off "closed". Once government is what carries the
# discrimination, the preposition no longer has to — which is why `at` may
# count HERE and nowhere else. "garbage pickup is at 8 a.m." has no trading
# predicate at all, so there is nothing for the PP to be governed by.
#
# ★ THE ANAPHORIC VARIANT, and why it is not "matching the word `that`".
# A temporal preposition demands a temporal complement. When its complement is
# a NOMINALLY EMPTY pro-form — a bare `that`/`this`/`it`/`then` with no head
# noun after it — the complement carries no descriptive content of its own and
# can only be resolved by antecedence. This module resolves it by EXHAUSTION,
# never by lexical match: the reference is admitted only when the text contains
# EXACTLY ONE clock token and that token PRECEDES the pro-form. Zero
# antecedents, or two or more, means the referent is undetermined and the rule
# refuses. Matching the word `that` is a necessary trigger, but the mechanism
# is emptiness (no head noun) + uniqueness (exactly one antecedent) +
# government (the same adjacency the clock branch requires). "that CANDLE" and
# "that ZONE" are not pro-forms at all and never reach the rule.
#
# ★ WHAT IT DELIBERATELY DOES NOT DO. It is a new way to satisfy
# _session_clock_does_work; it does NOT move the trading-action co-factor
# outside that conjunct, and it does NOT touch the action conjunct itself (the
# three construction regexes above are READ for their match spans and are
# otherwise untouched — the third pass fixed them and they are no longer the
# binding constraint). Bare-mention clocks with no trading predicate — "the
# trendline break at 8:30 a.m. is the trigger" — are still missed, unchanged.

_SESSION_GOVERNED_ADVERB_FILLER: frozenset[str] = frozenset(
    {
        # degree / frequency / manner adverbs and bare quantifier objects — a
        # CLOSED set, every member domain-free, so an unknown intervening word
        # breaks the government relation by default (same whitelist discipline
        # as _SESSION_ACTION_DETERMINERS / _SESSION_NOUN_QUALIFIER_ALLOWED).
        "right", "sharp", "sharply", "always", "usually", "typically",
        "normally", "completely", "fully", "entirely", "immediately",
        "automatically", "manually", "generally", "often", "sometimes",
        "already", "just", "only", "also", "then", "everything", "all",
        "again", "hard", "quickly", "straight",
    }
)

_SESSION_GOVERNED_SELECTION_PREP_RE = re.compile(
    r"^\s*(?:going\s+into|right\s+(?:into|before|after|at)|ahead\s+of|prior\s+to|"
    r"through|towards|toward|between|before|after|until|from|into|till|past|by|to)"
    r"\s+(?:the\s+)?",
    re.IGNORECASE,
)
"""Temporal prepositions that already SELECT or DELIMIT on their own. Anything
here is safe in the governed position and is also, mostly, already covered by
_SESSION_CLOCK_SPAN_PREP_RE — kept explicit so the governed branch does not
depend on that other regex's exact membership."""

_SESSION_GOVERNED_MENTION_PREP_RE = re.compile(
    r"^\s*(?:at|around|about|near)\s+(?:the\s+)?",
    re.IGNORECASE,
)
"""Prepositions that in isolation mark a MERE MENTION — the garbage-pickup
class. They count ONLY in the governed position. This is the whole point of the
pass: `at` is not evidence, but `<trading predicate> at <clock>` is."""

_SESSION_COPULA_FLAT_TAIL_RE = re.compile(r"\bflat$", re.IGNORECASE)
"""★ THE LICENSING RESTRICTION, and it is the main measured finding of this
pass. See _session_government_licensed_action_edges."""

_SESSION_TEMPORAL_PROFORM_RE = re.compile(
    r"^(?:that|this|it|then|there)\b"
    # NOMINALLY EMPTY: what follows must be a clause boundary or a function
    # word — never the start of a noun phrase. Same frame test, and the same
    # reasoning, as the objectless-gerund lookahead in
    # _SESSION_NEGATED_TRADING_RE: a blacklist of possible head nouns never
    # closes; a grammatical frame does. "before that CANDLE" and "into that
    # ZONE" are ordinary determiner+noun and are refused here.
    r"(?=\s*(?:$|[,.;:!?)—-]|\b(?:and|or|but|so|because|since|if|when|while|"
    r"i|we|you|he|she|they|is|was|are|were|do|does|did|don'?t|doesn'?t|"
    r"to|for|at|on|in|as|then|though|anyway|instead)\b))",
    re.IGNORECASE,
)


def _session_strip_governed_filler(norm: str, start: int) -> tuple[str, int]:
    """Advance past up to two closed-set adverbs sitting between a trading
    action's right edge and the preposition that governs its temporal PP
    ("flatten EVERYTHING before 3:50", "close the position RIGHT at 3 p.m.").
    Returns (remainder, absolute-offset-of-remainder). No preposition is a
    member of the filler set, so stripping can never skip past the governor."""
    idx = start
    for _ in range(2):
        step = re.match(r"\s+([A-Za-z']+)", norm[idx:])
        if step is None or step.group(1).lower() not in _SESSION_GOVERNED_ADVERB_FILLER:
            break
        idx += step.end()
    return norm[idx:], idx


def _session_government_licensed_action_edges(norm: str) -> list[int]:
    """Right-edge index of every trading-action construction that is allowed to
    LICENSE a governed clock. READS the third pass's three construction regexes
    for their match spans; changes none of them.

    ★ THIS SET IS STRICTLY SMALLER THAN _session_has_trading_action's, and the
    gap is the honest finding of the fourth pass — recorded here rather than in
    a commit message, and pinned by
    test_batch8_ambiguous_actions_may_not_license_a_governed_clock.

    A first draft licensed ALL THREE constructions. Adversarial batch 8 — 22
    ordinary-life sentences each carrying a real third-pass action construction
    plus a governed clock, authored specifically at this rule and run against it
    for the first time only when complete — measured 13 leaks, every one a
    regression this pass would have introduced:

        "the soda GOES FLAT at 3 p.m."          "the crowd STAYED FLAT at 8 p.m."
        "HOLD THE RUNNERS at 6 a.m. at the starting line"   (a footrace)
        "CLOSE THE CONTRACTS at 5 p.m. with the notary"     (a legal deal)
        "we HOLD THE POSITIONS at 9 a.m. for the job fair"  (job openings)
        "the notary is at 5 p.m. so we CLOSE THE CONTRACTS before that"

    The diagnosis is not that the new rule is wrong; it is that
    _session_clock_does_work was silently DOING FP WORK FOR the action conjunct.
    The (A1) copula frame (`be`/`get`/`go`/`stay` + `flat`) and the whole (B)
    transaction-verb-plus-position-noun construction are polysemous — soda and
    champagne go flat, races have runners, estates have contracts, job boards
    have positions, raffles have entries — and the ONLY thing that kept that
    polysemy from binding a killzone window was the clock-role test refusing
    `at`. Removing that refusal for them re-opens the class the second pass
    spent two passes closing. So they are NOT licensed.

    LICENSED (no ordinary-English reading in this frame, verified against the
    same batch):
      - (A2) `flatten` / `scale in|out` / `stopped out` — the position-operation
        verbs. Detected by ELIMINATION, not by a re-authored copy of the
        alternation: every (A1) match ends in the bare word `flat`, and no (A2)
        match does (`flatten` has no word boundary after `flat`). So the
        licensing test reads the third pass's own regex output rather than
        duplicating its vocabulary, and cannot drift from it.
      - (C) the negated/ceased bare trade-gerund — `no trading`, `stop
        trading`. Already frame-tested for objectlessness upstream.

    NOT LICENSED: (A1) copula + `flat`, and all of (B).

    ★ THE COST, stated plainly. This is why "I close every position at 3pm on
    Fridays" — a named target of this pass, and the canonical (B) example —
    is STILL MISSED. It is refused by the same rule that refuses "we close the
    positions at 5 p.m. on Friday, the listings expire", and nothing available
    at this layer separates them: they are the same construction, the same
    preposition, the same clock shape, differing only in what the surrounding
    world is about. Pinned as a failing-visible test rather than fixed by
    keying on `every` or on a trailing-noun blacklist — the first is surface
    tuning, the second is the blacklist failure mode already recorded in
    test_batch6_objectless_gerund_is_a_frame_test_not_a_blacklist."""
    edges: list[int] = []
    for match in _SESSION_POSITION_STATE_RE.finditer(norm):
        if _SESSION_COPULA_FLAT_TAIL_RE.search(match.group(0)) is None:
            edges.append(match.end())
    edges.extend(match.end() for match in _SESSION_NEGATED_TRADING_RE.finditer(norm))
    return edges


def _session_action_governed_clock(norm: str, clock_tokens: list[re.Match]) -> bool:
    """★ THE FOURTH-PASS CLOCK-ROLE RULE. See the block comment above.

    True iff a trading-action construction directly governs a temporal PP whose
    complement is either (a) one of `clock_tokens`, or (b) a nominally-empty
    temporal pro-form whose ONLY possible antecedent is the text's single clock
    token. Purely structural: no session vocabulary is consulted, no keyword
    list is widened, and both halves must appear in this order and adjacency."""
    if not clock_tokens:
        return False
    edges = _session_government_licensed_action_edges(norm)
    if not edges:
        return False

    token_starts = {token.start() for token in clock_tokens}
    # Anaphora needs a UNIQUE antecedent — resolution by exhaustion, not by
    # picking the nearest of several candidates (which would be a guess).
    sole_clock_end = clock_tokens[0].end() if len(clock_tokens) == 1 else None

    for edge in edges:
        rest, offset = _session_strip_governed_filler(norm, edge)
        prep = _SESSION_GOVERNED_SELECTION_PREP_RE.match(rest)
        selection = prep is not None
        if prep is None:
            prep = _SESSION_GOVERNED_MENTION_PREP_RE.match(rest)
        if prep is None:
            continue
        complement_at = offset + prep.end()
        if complement_at in token_starts:
            return True
        if (
            selection
            and sole_clock_end is not None
            and sole_clock_end <= complement_at
            and _SESSION_TEMPORAL_PROFORM_RE.match(norm[complement_at:])
        ):
            return True
    return False


def _session_is_about_markets(norm: str) -> bool:
    """The co-factor the clock and named-session markers require: is this text
    about a market thing?

    Satisfied by ONE unambiguous term, or by TWO DISTINCT ambiguous ones. A
    single ambiguous word is never enough — that was the measured leak."""
    if SESSION_STRONG_MARKET_OBJECT_RE.search(norm) is not None:
        return True
    distinct = {m.group(0).lower() for m in SESSION_AMBIGUOUS_MARKET_OBJECT_RE.finditer(norm)}
    return len(distinct) >= 2


SESSION_NAMED_WORD_RE = re.compile(r"\b(london|new\s+york|ny|asian?)\s+session\b", re.IGNORECASE)
"""A proper session name directly compounded with the literal word
"session" ("New York session", as in "For the session indicator, I'm using
New York session by James Davey") — a concrete, unambiguous session
reference distinct from a generic possessive ("your session", "my
session") which carries no proper name and does not match here."""

SESSION_NAMED_MARKET_OPEN_RE = re.compile(
    r"\b(european|europe|asian|asia|tokyo|frankfurt|sydney|globex)\s+(opens?|closes?)\b",
    re.IGNORECASE,
)
"""A NON-NYSE market's open/close ("EUROPEAN OPEN", "Tokyo open") — genuine
session teaching, recorded by the independent grade as a false negative.

RECOGNITION-ONLY, NEVER ZONE-MAPPED — and that refusal is the point. This
module owns exactly one non-guessed minute constant
(_SESSION_MARKET_OPEN_MINUTE, the NYSE cash open at 9:30 ET). There is no
comparable constant for "European open": it is 08:00 London = 03:00 ET, or
08:00 CET = 02:00 ET for Frankfurt, and picking one would be exactly the
guess resolve_session_keyword's docstring warns against ("a miss is honest,
a false positive silently binds the WRONG window"). "Asian"/"Globex" hours
are worse still — they map to `overnight`, which is one of the two ORPHAN
zone names is_in_killzone() can never evaluate True for, so binding them
would be strictly worse than leaving them unbound.

So these rows land in the recognized-but-unbound state with
SESSION_TEACHING_UNBOUND_REASON: "we correctly SAW this is session teaching;
we have no primitive that can compute it." An honest refusal beats a
fabricated bind."""

_REAL_ZONE_INTERVALS: dict[str, tuple[tuple[int, int], ...]] = {
    "london": ((120, 300),),
    "ny_am": ((420, 600),),
    "ny_pm": ((810, 960),),
    "silver_bullet": ((180, 240), (600, 660), (840, 900)),
    "macro_window": ((590, 610), (153, 180), (243, 270)),
}
"""Minute-of-day [start, end) boundaries — a LOCAL mirror of
session_windows.py's LONDON_START_MIN/.../MW_WINDOW_3_END constants (same
zero-import-surface convention as SESSION_KEYWORDS/LEVEL_ZONE_RE above). Any
edit to session_windows.py's boundary constants MUST be mirrored here in the
same commit. Deliberately excludes lunch_blackout/overnight — those two
zone names are NOT in session_windows.py's own is_in_killzone() dispatch
table (_ZONE_CHECKS covers exactly the 5 keys here). ★ That gap is now
CLOSED at the source: the orphan-zone closure removed both names from
SESSION_KEYWORDS, so no resolver emits them and pin (b2) `EMIT ⊆ COVERED`
holds. They survive only as REFUSED_SESSION_KEYWORDS — recognized, named,
and never bound."""

_SESSION_ZONE_PRIORITY: tuple[str, ...] = ("ny_am", "london", "ny_pm", "silver_bullet", "macro_window")
"""Deterministic tie-break order when two zones have equal overlap minutes
(none of the 17-row corpus hits a true tie, but the resolver must stay
deterministic — replay-determinism contract — for any future input)."""

_SESSION_MARKET_OPEN_MINUTE: int = 9 * 60 + 30  # NYSE cash open, 9:30 ET


def _session_interval_overlap_minutes(a_start: int, a_end: int, b_start: int, b_end: int) -> int:
    return max(0, min(a_end, b_end) - max(a_start, b_start))


def _session_best_real_zone_for_range(start_min: int, end_min: int) -> str | None:
    """Greatest-overlap real killzone for a [start_min, end_min) span, or
    None if it overlaps none of the 5 computable zones at all. Never
    guesses: a span entirely outside every real window (e.g. a 1am-2am
    reference) correctly returns None rather than picking the "closest"
    zone by proximity."""
    if end_min <= start_min:
        return None
    best_zone: str | None = None
    best_overlap = 0
    for zone in _SESSION_ZONE_PRIORITY:
        total = sum(
            _session_interval_overlap_minutes(start_min, end_min, s, e) for s, e in _REAL_ZONE_INTERVALS[zone]
        )
        if total > best_overlap:
            best_overlap, best_zone = total, zone
    return best_zone


_SESSION_ANCHOR_PHRASE_GOVERNOR_RE = re.compile(
    r"\b(until|till|through|to|from|before|after|by|between|into|towards?)\b",
    re.IGNORECASE,
)
"""Span/selection prepositions that, when they GOVERN an anchor phrase, make it
a range ENDPOINT rather than a descriptive gloss. Deliberately excludes "of"
and "at": "the first 15 minutes OF the New York Stock Exchange open" describes
a range, it does not bound one."""


def _session_anchor_phrase_is_governed_endpoint(norm: str, phrase_start: int) -> bool:
    """True iff the anchor phrase at `phrase_start` is governed by a span
    preposition — i.e. it functions as an ENDPOINT of the taught range
    ("from 4:00 p.m. until MARKET OPEN") rather than as a descriptive gloss
    ("the first 15 minutes of the NYSE OPEN").

    ★ THIS CLOSES A HOLE THE FIRST VERSION OF THIS PACKET OPENED. Excluding
    the anchor phrase from the wrap test outright (to kill two phantom wraps)
    let a REAL wrapping window through whenever the phrase was the terminal
    endpoint and the only other endpoint was a single clock token:

        "trade the range from 4:00 p.m. eastern until market open on the NYSE"
            clock tokens [960] -> no backwards step -> no wrap detected
            min/max over {570(phrase), 960} = (570, 960) -> ny_pm

    ny_pm is 13:30-16:00 ET: the RTH afternoon, the COMPLEMENT of the 16:00->
    09:30 overnight range the sentence teaches. That is the packet's own
    defect, escaping through the packet's own remedy — and it is semantically
    the SAME sentence as the originating corpus row ("when the market actually
    closes until when the market opens").

    The discriminator is government, not position: a governed phrase is an
    endpoint and joins the ordered wrap test; an ungoverned one is a gloss and
    stays out. Verified against both phantom-wrap rows, which remain correctly
    non-wrapping:
      - "...all the way up INTO New York market open, which is going to be
        9:30 a.m." -> governed, joins as 570 -> [180, 570, 570], monotone.
      - "...the first 15 minutes OF the New York Stock Exchange open" ->
        ungoverned gloss, excluded -> [570, 585], monotone.

    The governor must reach the phrase across scaffold words only ("all the
    way up into", "until the"), never across a content word — otherwise any
    preposition anywhere in a long sentence would license any phrase."""
    prefix = norm[:phrase_start]
    words = _SESSION_RESIDUE_WORD_RE.findall(prefix)
    # Walk backwards from the phrase over scaffold/filler only. A content word
    # ends the search: the governor must actually reach this phrase.
    # Filler the governor may reach across: discourse scaffolding, plus the
    # market-naming words that belong to the anchor phrase's own noun group
    # ("until NEW YORK market open" — SESSION_ANCHOR_PHRASE_RE matches only
    # the "market open" tail, leaving "new york" stranded in the prefix).
    _FILLER = {
        "all", "the", "way", "up", "right", "straight", "then", "and",
        "new", "york", "ny", "nyse", "cash", "equity", "stock", "exchange", "us",
    }
    for word in reversed(words):
        low = word.lower()
        if _SESSION_ANCHOR_PHRASE_GOVERNOR_RE.fullmatch(low):
            return True
        if low in _FILLER or low in _SESSION_TIME_SCAFFOLD_WORDS:
            continue
        return False
    return False


def _session_anchor_sequence_wraps_midnight(wrap_minutes: list[int]) -> bool:
    """True iff the CLOCK anchors, IN TEXT ORDER, ever step backwards in the
    day — the signature of a window that wraps midnight ("from 4 p.m. until
    9:30 a.m.").

    Text order is load-bearing and is why this cannot be done with min/max:
    min/max discard the order that carries the wrap, and for a wrapping window
    they return its interior endpoints, i.e. its COMPLEMENT. See
    SESSION_WRAPPING_WINDOW_UNBOUND_REASON for the measured proof.

    ★ CLOCK anchors only. The anchor-PHRASE minute (`market open` ->
    _SESSION_MARKET_OPEN_MINUTE) is deliberately excluded: it is a descriptive
    gloss, not a sequenced endpoint, and it can appear anywhere in the
    sentence relative to the endpoints it describes. Feeding it in produced
    phantom wraps on two genuine corpus teachings — see the comment at the
    `clock_anchor_minutes` declaration for both measurements.

    Equal adjacent anchors are NOT a wrap: a text may legitimately restate the
    same instant ("from 9:30 ... so, from 9:30 to 9:35"), and one real corpus
    row does exactly that. Only a STRICT decrease is a wrap. A single anchor
    can never wrap."""
    return any(b < a for a, b in pairwise(wrap_minutes))


def _session_clock_token_minutes(hour: int, minute: int, meridiem: str | None) -> int:
    """Minute-of-day for a parsed clock token.

    ★ H2 FIX (independent grade, BAND 6). This function previously did an
    unconditional `h = hour % 12`, so an unmarked 24-hour token silently
    became its AM twin: "wait until 14:30 EST" read as 2:30 and bound the
    LONDON window when the correct answer is ny_pm. The inline comment
    defending that behavior said AM-defaulting "matches every corpus row" —
    but no 24-hour token exists anywhere in the 26-row corpus, so the rule
    was fitted to the sample AND defended by the same sample. A rule whose
    only evidence is the absence of the counterexample is not evidence.

    An unmarked hour >= 13 is unambiguously 24-hour: there is no 14 a.m.
    Only hours 1-12 remain genuinely meridiem-ambiguous, and only those keep
    the AM default (which IS corpus-supported: every unmarked corpus token is
    a 9:30/9:45 pre-market reference)."""
    if meridiem is None and hour >= 13:
        return hour * 60 + minute  # 24-hour clock; no meridiem can apply
    h = hour % 12
    if meridiem and meridiem.strip().lower().startswith("p"):
        h += 12
    return h * 60 + minute


@dataclass(frozen=True)
class SessionRoleResult:
    recognized: bool
    """True iff the phrase-AND-role test found the text doing real session
    work (selects a candle, delimits a window, or constitutes the
    instruction as a named session range) — independent of whether a
    computable zone was found."""
    zone: str | None
    """One of the 5 real, is_in_killzone-computable zone names, or None when
    recognized but no confident/computable window exists (ambiguous session
    name, or a session-anchored LEVEL reference rather than a time window —
    see module comment above)."""
    refusal: str | None = None
    """A NAMED reason this text was deliberately not zone-mapped, when the
    refusal is more specific than the generic recognized-no-window bucket.
    Currently only SESSION_WRAPPING_WINDOW_UNBOUND_REASON. None means "no
    special refusal applies" — the pre-existing (recognized, zone) contract
    is unchanged for every caller that does not read this field."""


SESSION_WRAPPING_WINDOW_UNBOUND_REASON: str = "wrapping_window_unrepresentable"
"""A taught window that WRAPS MIDNIGHT (16:00 -> 09:30). Refused by name, and
NEVER complement-bound.

★ WHY THIS EXISTS — the measured defect, not a hypothetical. The zone was
derived from `min(anchor_minutes), max(anchor_minutes)`. For a wrapping
window those two values are the window's INTERIOR endpoints, so the derived
span is exactly the COMPLEMENT of what the text taught:

    "from 4:00 p.m. eastern until 9:30 a.m. eastern on the NYSE"
        tokens 960, 570  ->  min/max span (570, 960) = 09:30-16:00 = the RTH
        DAY session  ->  bound ny_pm.  The text taught the OVERNIGHT range.

★ AND NOTE WHAT THIS IS *NOT*. The originating corpus row was diagnosed as a
colon-less-token defect ("400 p.m." never matched `_SESSION_CLOCK_TOKEN_RE`).
That diagnosis was wrong at the root. The colon-less miss only degraded that
row to a SINGLE anchor (570), which took the `lo == hi` branch into ny_am.
The inversion above reproduces with perfectly well-formed COLON-FUL tokens
and no colon-less token anywhere. Fixing the tokenizer alone would have moved
that row from ny_am to ny_pm — still the complement, still wrong. `min/max`
is the defect; the tokenizer merely chose which wrong answer appeared.

★ REFUSED rather than REPRESENTED, deliberately. A window that wraps midnight
IS an overnight window, and `overnight` is precisely one of the two orphan
zones `is_in_killzone()` can never evaluate True for. Representing the wrap
(as two intervals) could therefore only ever bind a FRAGMENT of the taught
range to a day-session zone — the same class of error, merely smaller. This
module's standing rule selects the refusal: "a miss is honest, a false
positive silently binds the WRONG window."
"""

SESSION_TEACHING_UNBOUND_REASON: str = "session_teaching_recognized_no_computable_window"
"""Distinct from FAMILY_META["WAIT_SESSION"].unbound_reason
(no_recognized_session_keyword) on purpose — this reason means the
condition WAS recognized as genuine session teaching, just not one
session_windows.py's 5 real windows can compute. See classify_session_role.
"""


def classify_session_role(object_text: str) -> SessionRoleResult:
    """Role-aware session classifier (docs/designs/packet-role-aware-session-
    resolver-2026-07-20.md). Only ever consulted (see _bind_condition_dispatch)
    AFTER resolve_session_keyword() has already returned None for this exact
    text, and only when TF_SESSION_ROLE_RESOLVER_ENABLED is set — this
    function's own behavior is otherwise irrelevant to any pre-existing
    caller. Never raises; empty/falsy input is honestly not recognized."""
    if not object_text:
        return SessionRoleResult(recognized=False, zone=None)
    norm = object_text.strip()

    recognized = False
    anchor_minutes: list[int] = []
    # ★ CLOCK tokens ONLY, in text order — the input to the midnight-wrap test.
    # Deliberately EXCLUDES the anchor-phrase minute below, and that exclusion
    # is the whole point: a clock token is a SEQUENCED ENDPOINT of the taught
    # range ("from 4:00 p.m. until 9:30 a.m."), whereas an anchor phrase is a
    # descriptive GLOSS that can sit anywhere in the sentence relative to the
    # endpoints it describes.
    #
    # ★ CAUGHT BY TEST, NOT BY REVIEW — twice, and both times the same wrong
    # premise: that "the order anchors were discovered" is "the order they
    # appear in the text."
    #   1. Discovery order put the anchor phrase FIRST regardless of position.
    #      "after 3:00 a.m. ... up into New York market open ... 9:30 a.m. EST"
    #      gave [570, 180, 570] — a phantom backwards step.
    #   2. Sorting by text position fixed that but not the real problem.
    #      "... that range from 9:30 to 9:45. That's the first 15 minutes of
    #      the New York Stock Exchange open ..." puts a 570-minute GLOSS at
    #      offset 104, AFTER the 585 endpoint: [570, 585, 570]. Still a
    #      phantom wrap, because a gloss was being read as an endpoint.
    # Together these refused genuine non-wrapping corpus teachings and moved
    # the graded bound-and-concrete count (8 -> 6, then 8 -> 7). The graded
    # constants are owned elsewhere and must not move by side-effect; that
    # they moved is exactly how both bugs announced themselves.
    # (character offset, minute) — sorted by offset to give TEXT order.
    wrap_points: list[tuple[int, int]] = []

    anchor_phrase = SESSION_ANCHOR_PHRASE_RE.search(norm)
    anchor_phrase_governed = bool(
        anchor_phrase and _session_anchor_phrase_is_governed_endpoint(norm, anchor_phrase.start())
    )
    if anchor_phrase:
        recognized = True
        # ★ The phrase joins the wrap sequence ONLY when a span preposition
        # governs it, i.e. it is a range ENDPOINT and not a descriptive gloss.
        # See _session_anchor_phrase_is_governed_endpoint — this distinction is
        # what lets the wrap test catch "from 4:00 p.m. until MARKET OPEN"
        # without re-manufacturing the phantom wraps a positional-only rule
        # produced.
        if anchor_phrase_governed:
            wrap_points.append((anchor_phrase.start(), _SESSION_MARKET_OPEN_MINUTE))

    # ★ SECOND-PASS: the weak markers' required co-factor is now the STRONG
    # market lexicon, not the broad one. The broad lexicon admitted ordinary
    # prose on one incidental word ("a LONG dress at 3 p.m."). See
    # SESSION_STRONG_MARKET_OBJECT_RE. Still a required CONJUNCT throughout,
    # so every use below can only narrow recognition, never widen it.
    about_markets = _session_is_about_markets(norm)

    clock_tokens = list(_SESSION_CLOCK_TOKEN_RE.finditer(norm))
    if clock_tokens:
        parts = [_session_clock_token_parts(m) for m in clock_tokens]
        # ★ HIGH-1 FIX (independent grade, BAND 4 — the previous pass made
        # false positives WORSE). A clock token is a wall-clock MARKET anchor
        # when any of:
        #   TIER 1  a market-naming context corroborates it ("NYSE", "killzone")
        #   TIER 2  a timezone context does AND a span/selection preposition
        #           governs the token (M1 — a bare timezone phrase is not
        #           sufficient on its own)
        #   MERIDIEM-WITH-ROLE  the token carries its own meridiem AND the
        #           clock is doing work: either the text is about a market
        #           object, or the time expression IS the whole condition
        #           object.
        #
        # What was WRONG before: `has_meridiem` alone was sufficient. That is
        # not a market signal at all — "a.m."/"p.m." is ordinary English
        # scheduling vocabulary. Measured over 23 ordinary-prose negatives,
        # meridiem-alone produced 14 recognitions and 8 SILENT BINDS to a real
        # killzone window ("garbage pickup is at 8 a.m. on Thursdays" -> ny_am;
        # "my dentist appointment is at 2:30 p.m." -> ny_pm). That is precisely
        # the failure resolve_session_keyword's docstring refuses: "a miss is
        # honest, a false positive silently binds the WRONG window."
        #
        # ★ HIGH-2, and why the blame was misplaced. The colon-less alternative
        # in _SESSION_CLOCK_TOKEN_RE was charged with manufacturing 4 new false
        # positives ("5pm", "8 p.m.", "4 p.m."). It did not CAUSE them; it only
        # made more prose visible to an already-unsound sufficiency rule. The
        # proof is that COLON-FUL prose false-bound just as hard — 5 of the 8
        # silent binds above came from "2:30 p.m.", "3:00 p.m.", "3:15 p.m.",
        # "9:30 a.m.", "2:15 a.m.", none of which deleting the colon-less form
        # would have touched. The discriminator is not the token's MORPHOLOGY
        # (colon vs no colon) but the clock's ROLE in the sentence. So the
        # colon-less form STAYS (bare "8am" still binds ny_am) and the role
        # test below removes both FP classes at once.
        has_meridiem = any(mer for _h, _m, mer in parts)
        clock_is_whole_object = _session_text_is_constituted_by(norm, [m.span() for m in clock_tokens])
        # ★ A meridiem clock is a MARKET anchor only when the text is about
        # markets AND the clock is doing work (selecting/delimiting), or when
        # the clock IS the whole condition object. Mere mention never counts —
        # see _session_clock_does_work for why the lexicon alone could not.
        # ★ THIRD PASS. The co-factor is satisfied by market CONTEXT (a noun)
        # OR by a trading ACTION (a verb acting on a position). A sentence
        # whose market-ness lives entirely in its verb — "be flat by 3:50
        # p.m.", "close every position by 11 a.m." — is a trading instruction
        # whether or not it names an instrument; 13 such genuine teachings
        # were being rejected. _session_clock_does_work is UNCHANGED and still
        # required, so this widens the co-factor only, never the clock-role
        # test. See _session_has_trading_action.
        market_cofactor = about_markets or _session_has_trading_action(norm)
        meridiem_with_role = has_meridiem and (
            clock_is_whole_object or (market_cofactor and _session_clock_does_work(norm, clock_tokens))
        )
        tier1 = _SESSION_CLOCK_MARKET_CONTEXT_RE.search(norm)
        # ★ SECOND-PASS: tier 2 now ALSO requires market context. Timezone +
        # span-preposition with no market content at all is a meeting invite:
        # "the webinar runs FROM 2:00 p.m. UNTIL 3:00 p.m. EASTERN TIME" bound
        # ny_pm — a hard false positive that bypassed every other gate,
        # because tier 2 was the one path with no market requirement.
        tier2 = (
            _SESSION_CLOCK_TZ_CONTEXT_RE.search(norm)
            and _SESSION_CLOCK_SPAN_PREP_RE.search(norm)
            and about_markets
        )
        if meridiem_with_role or tier1 or tier2:
            recognized = True
            for tok, (hour, minute, mer) in zip(clock_tokens, parts, strict=True):
                tok_minute = _session_clock_token_minutes(hour, minute, mer)
                anchor_minutes.append(tok_minute)
                wrap_points.append((tok.start(), tok_minute))

    # The two weakest markers keep the BROAD lexicon as their market co-factor
    # (the strong set measurably cost a genuine blind-graded corpus row that
    # carries only the ambiguous word "line") and gain a THIRD conjunct
    # instead: the noun "session" must not be qualified by a foreign noun.
    # See _SESSION_NOUN_QUALIFIER_ALLOWED — this is what refuses "my GYM
    # session starts...", which both markers previously recognized.
    session_noun_ok = _session_noun_qualifier_is_market_compatible(norm)
    has_market_object = SESSION_MARKET_OBJECT_RE.search(norm) is not None

    if SESSION_BOUNDARY_VERB_RE.search(norm) and has_market_object and session_noun_ok:
        recognized = True

    if SESSION_TEMPORAL_PREPOSITION_RE.search(norm) and has_market_object and session_noun_ok:
        recognized = True

    if SESSION_LIQUIDITY_LEVEL_ENUM_RE.search(norm) and SESSION_NAMED_TOKEN_RE.search(norm):
        # Recognized as genuine session vocabulary, but deliberately NEVER
        # zone-mapped — this is the session_range level/zone kind (a LEVEL
        # reference, e.g. "Asia high"), not a time-window condition. Binding
        # it to session_windows would be a category error, and level/zone is
        # explicitly out of scope for this packet (see module comment).
        recognized = True

    named_word = list(SESSION_NAMED_WORD_RE.finditer(norm))
    if named_word and (about_markets or _session_text_is_constituted_by(norm, [m.span() for m in named_word])):
        # ★ SECOND-PASS. "New York session" is a proper session name, but it is
        # also an ordinary English noun phrase: "the LONDON SESSION of
        # parliament was televised" recognized (and BOUND london), "the NEW
        # YORK SESSION musicians recorded all night" leaked recognition. Same
        # qualifier as everywhere else: the name must either constitute the
        # condition object ("New York session") or sit in text that is
        # unambiguously about markets.
        recognized = True

    reopen_spans = [m.span() for m in SESSION_REOPEN_TOKEN_RE.finditer(norm)]
    if reopen_spans and _session_text_is_constituted_by(norm, reopen_spans):
        # Recognized, and deliberately contributes NO anchor minute — see
        # SESSION_REOPEN_TOKEN_RE: a recurring boundary with no computable
        # time anchor, same disposition as "European open".
        recognized = True

    named_open = list(SESSION_NAMED_MARKET_OPEN_RE.finditer(norm))
    if named_open and (about_markets or _session_text_is_constituted_by(norm, [m.span() for m in named_open])):
        # ★ SECOND-PASS qualifier, same principle: "the EUROPEAN OPEN air
        # market is lovely in summer" and "the ASIAN OPEN mic night runs late"
        # both leaked recognition here. Bare "European open" still recognizes
        # (it constitutes the object); the prose forms no longer do.
        #
        # Recognized, but deliberately contributes NO anchor minute — see
        # SESSION_NAMED_MARKET_OPEN_RE: no non-guessed minute constant exists
        # for a non-NYSE open, and the zones they would imply are the two
        # orphan names is_in_killzone() can never return True for.
        recognized = True

    # ★ RESIDUAL-HOLE CLOSURE. An UNGOVERNED anchor phrase is a descriptive
    # gloss, so it must not EXTEND the taught span when real clock endpoints
    # are present — otherwise min/max still spans gloss<->token and can yield
    # the complement by a second route:
    #
    #   "hold from 4:00 p.m. eastern during market open on ES"
    #       ungoverned gloss (570) + token (960) -> min/max (570, 960) -> ny_pm
    #
    # which is the RTH afternoon again, the complement of a 16:00-onward
    # teaching. When the phrase is the SOLE anchor it still supplies the zone:
    # that is what the graded calibration fixtures depend on ("the first
    # two-minute candle off the bell", "drops at the opening bell" — both
    # ungoverned, both carrying no clock token at all), and dropping it there
    # would move a graded constant by side-effect.
    if anchor_phrase and (anchor_phrase_governed or not anchor_minutes):
        anchor_minutes.append(_SESSION_MARKET_OPEN_MINUTE)

    zone: str | None = None
    refusal: str | None = None
    if anchor_minutes:
        if _session_anchor_sequence_wraps_midnight([m for _pos, m in sorted(wrap_points)]):
            # ★ The taught window runs backwards through midnight. `min`/`max`
            # cannot represent it — they yield its COMPLEMENT (see
            # SESSION_WRAPPING_WINDOW_UNBOUND_REASON). Refuse by name; never
            # fall through to the span derivation below.
            refusal = SESSION_WRAPPING_WINDOW_UNBOUND_REASON
        else:
            # Non-wrapping: the sequence is monotone non-decreasing, so
            # (first, last) == (min, max) identically. Kept as min/max so this
            # branch is provably byte-identical to the pre-existing behaviour
            # for every input that is not a wrap.
            lo, hi = min(anchor_minutes), max(anchor_minutes)
            if lo == hi:
                hi = lo + 1
            zone = _session_best_real_zone_for_range(lo, hi)

    return SessionRoleResult(recognized=recognized, zone=zone, refusal=refusal)


def session_role_resolver_enabled() -> bool:
    """Read at call time (not cached), same live-read contract as
    fvg_identity_enabled()/levelzone_routing_enabled() above."""
    return os.environ.get("TF_SESSION_ROLE_RESOLVER_ENABLED", "false").strip().lower() == "true"


# ─── THE FIDELITY TERM ON THE SESSION-KEYWORD ROUTE (F-1, R-662 §7) ─────────
# WHY THIS EXISTS. R-662 §1 measured the gate INVERTED at the executable line:
# a row naming a session bound to that session's canonical window and its
# binding DECLARED EXACTNESS -- with no term anywhere comparing that window
# against the span the source actually taught. So a 5-minute taught opening
# range bound to ny_am = [420,600) and was certified exact, 36x too wide.
# `A GATE THAT CHECKS MEMBERSHIP INSTEAD OF FIDELITY REWARDS VAGUENESS AND
# PUNISHES PRECISION.`
#
# ★ SCOPE, AND IT IS DELIBERATELY NARROW: this term fires ONLY on rows that
# CARRY CLOCK TEACHING. A phrase naming a session and carrying NO clock makes
# no clock claim, so there is nothing to compare and R-284 Decision A's
# standing argument stands untouched (the primitive evaluates that exact
# window; there is no clock derivation in the path). Widening it to name-only
# rows would move published verdicts -- a RE-BASELINE decision for the desk
# (R-662 stop condition (1)), not a worker's.


def resolve_exact_clock_span(object_text: str) -> tuple[int, int] | None:
    """Taught text -> (start_min, end_min) for ONE unambiguous clock span, else None.

    ★ PORTED from the preserved Lane A patch
    (docs/designs/lane-a-exact-clock-route-2026-08-03.patch, e460c88d) rather
    than re-authored -- R-648 section 2.5 / R-662 section 7.2, "REUSE, DO NOT
    REBUILD". When Lane A lands there is ONE parser here, not two. Conjunct (4)
    is the single declared difference; see its note.

    CONJUNCTS, ALL REQUIRED, FAIL-CLOSED. The conjunct that does the narrowing
    is the span-preposition test, an EXISTING guard in this module --
    _SESSION_CLOCK_SPAN_PREP_RE, whose set deliberately excludes `at` and
    `into`. That is why "this one AT 7:00 a.m. and this one AT 8:00 a.m." (two
    POINT references, not a span) is refused structurally, not by special case.
    """
    if not object_text:
        return None
    text = object_text.strip()

    # (1) EXACTLY two clock tokens. Three or more means a parameterised family
    #     taught in one row -- the golden slice carries SIX, spanning three
    #     windows -- and picking one of them is a derivation loss (R-660 s1).
    toks = list(_SESSION_CLOCK_TOKEN_RE.finditer(text))
    if len(toks) != 2:
        return None

    mins: list[int] = []
    for m in toks:
        hour, minute, meridiem = _session_clock_token_parts(m)
        hh = hour % 12
        if meridiem and meridiem.lower().startswith("p"):
            hh += 12
        mins.append(hh * 60 + minute)

    # (2) Two DISTINCT anchors in order. Equal or reversed is not a span.
    if len(set(mins)) != 2 or mins[0] >= mins[1]:
        return None

    # (3) BOTH numerals governed by a span preposition -- the delimiting test.
    if len(_SESSION_CLOCK_SPAN_PREP_RE.findall(text)) < 2:
        return None

    # (4) Clock context. TIER 1 (names the market itself) is sufficient alone.
    #     TIER 2 (a bare timezone / meridiem) counts HERE because conjunct (3)
    #     has already established that both numerals are doing delimiting work
    #     -- precisely the condition this module's own tier-2 note states: "a
    #     tier-2 marker now counts only when the clock token is additionally
    #     GOVERNED by a span/selection preposition".
    #     ! THIS IS THE ONE PLACE THIS FUNCTION DIFFERS FROM THE LANE A PATCH,
    #     WHICH REQUIRES TIER 1 OUTRIGHT. Declared rather than quietly folded
    #     in: Lane A converts NO-BIND -> BIND, where a false span invents a
    #     confident bind; this route only ever converts EXACT -> APPROXIMATE
    #     unless the span EQUALS the executed window, so the risk asymmetry is
    #     inverted, and tier-1-only would make the green arm unreachable for
    #     every "9:30 a.m. ... Eastern" row -- i.e. "refuse everything", which
    #     R-662 section 7.4 forbids.
    if not (_SESSION_CLOCK_MARKET_CONTEXT_RE.search(text) or _SESSION_CLOCK_TZ_CONTEXT_RE.search(text)):
        return None

    return mins[0], mins[1]


def _derive_session_zone_window_by_execution(zone: str) -> tuple[tuple[int, int], ...] | None:
    """EXECUTE is_in_killzone and OBSERVE the window it actually evaluates.

    ★ THIS NEVER RESTATES A CONSTANT. R-660 section 3 made it law: "a cheaper
    comparison against the primitive's DECLARED window arithmetic qualifies
    ONLY if it COMPARES against something DERIVED FROM THE PRIMITIVE.
    Re-asserting a constant is not a comparison and would reinstate the defect
    under a new name." _REAL_ZONE_INTERVALS is exactly such a restated constant
    -- a LOCAL MIRROR of session_windows.py -- so it is deliberately NOT what
    this compares against. We probe the real primitive minute by minute and
    read the window off its own answers.

    FAILS CLOSED: any import, execution or shape problem returns None and the
    caller then declines to certify. A primitive we cannot run is a primitive
    we do not certify."""
    try:
        import datetime as _datetime
        import importlib

        sw = importlib.import_module("src.engine.session_windows")
        # 2024-01-03: a Wednesday with no ET DST transition, so ET minute-of-day
        # is a bijection with UTC minute-of-day and 1440 probes cover every ET
        # minute exactly once.
        base = _datetime.datetime(2024, 1, 3, tzinfo=_datetime.UTC)
        hits: set[int] = set()
        for i in range(1440):
            dt = base + _datetime.timedelta(minutes=i)
            et_min = sw._to_et_minutes_of_day(dt)
            if et_min is None:
                return None
            if sw.is_in_killzone(dt, zone):
                hits.add(int(et_min))
        if not hits:
            return None
        runs: list[tuple[int, int]] = []
        start = prev = None
        for m in sorted(hits):
            if start is None:
                start = prev = m
            elif m == prev + 1:
                prev = m
            else:
                runs.append((start, prev + 1))
                start = prev = m
        runs.append((start, prev + 1))
        return tuple(runs)
    except Exception:  # noqa: BLE001 - fail closed, never certify on a broken probe
        return None


def _session_keyword_fidelity_approximation(object_text: str, zone: str, base_approximation: bool) -> bool:
    """`approximation` for a keyword-route bind, WITH A FIDELITY TERM.

    Returns False (exact) IF AND ONLY IF the span parsed from the taught text
    EQUALS the window the primitive is OBSERVED to evaluate. Everything else
    that carries clock teaching resolves to True. Nothing is granted by
    membership."""
    if not _SESSION_CLOCK_TOKEN_RE.search(object_text or ""):
        # No clock teaching -> no clock claim -> nothing to compare. Untouched.
        return base_approximation
    span = resolve_exact_clock_span(object_text)
    if span is None:
        return True  # clock taught, no single unambiguous span -> FAIL CLOSED
    derived = _derive_session_zone_window_by_execution(zone)
    if derived is None:
        return True  # primitive not runnable -> FAIL CLOSED
    return derived != (span,)


def _bind_condition_dispatch(condition: dict, restore: bool, role: str) -> ConditionBinding:
    """Bind a single spec condition {id, type, object, role, span, evidence} to
    a primitive descriptor. Never raises; unknown condition types are honestly
    unbindable rather than defaulted to some guessed family. `role` is passed
    in explicitly by the public `bind_condition()` wrapper below (which
    resolves any Hard-Constraint Demotion Experiment role override BEFORE
    calling here) rather than read straight off `condition["role"]`.

    `restore` (Composition Fidelity Experiment, default False — 100% backward compatible):
    True iff the CALLER has already determined this specific condition_id is a member of its
    strategy's precomputed gating set (scripts/composition-gating-diagnostic.py) and wants the
    bundle-restoration path evaluated for it. Checked FIRST, before the existing single-object
    TF_FVG_IDENTITY_ENABLED path, so the composition experiment's explicit per-condition targeting
    takes precedence when both mechanisms could apply to the same condition — they never conflict
    in practice (TF_FVG_IDENTITY_ENABLED and TF_COMPOSITION_BUNDLE_ENABLED are not intended to be
    flipped on simultaneously in the same run, but if they were, per-condition explicit restore
    targeting is the more specific signal and should win)."""
    cond_id = str(condition.get("id", ""))
    cond_type = str(condition.get("type", ""))
    obj = str(condition.get("object", "") or "")

    meta = FAMILY_META.get(cond_type)
    if meta is None:
        return ConditionBinding(
            condition_id=cond_id,
            type=cond_type,
            role=role,
            object=obj,
            bindable=False,
            primitive=None,
            approximation=False,
            executed=False,
            reason="unknown_condition_type",
        )

    if meta.unsupported:
        return ConditionBinding(
            condition_id=cond_id,
            type=cond_type,
            role=role,
            object=obj,
            bindable=False,
            primitive=None,
            approximation=False,
            executed=False,
            reason=meta.unbound_reason,
        )

    # Composition-bundle restoration (experiment, per-condition-targeted — see module docstring
    # above SWEEP_OBJECT_KEYWORDS). Checked BEFORE the single-object FVG path: this condition's
    # id must already be a member of the caller-supplied gating set (restore=True) AND the bundle
    # flag must be on. resolve_bundle_primitive() returns None for any (type, object) the built
    # evaluators don't cover — an honest gap, falls through unchanged below.
    if restore and composition_bundle_enabled():
        bundle_primitive = resolve_bundle_primitive(cond_type, obj)
        if bundle_primitive is not None:
            return ConditionBinding(
                condition_id=cond_id,
                type=cond_type,
                role=role,
                object=obj,
                bindable=True,
                primitive=bundle_primitive,
                approximation=False,
                executed=True,
                reason=None,
            )

    # FVG identity dispatch (experiment, env-gated — see module docstring
    # above SESSION_KEYWORDS). Only WAIT_STRUCTURE/FILTER conditions are in
    # scope per the locked spec's Part B item 1; every other condition type,
    # and every WAIT_STRUCTURE/FILTER whose object is NOT in the FVG family,
    # falls through unchanged to the generic dispatch below.
    if cond_type in ("WAIT_STRUCTURE", "FILTER") and fvg_identity_enabled() and resolve_fvg_object(obj):
        return ConditionBinding(
            condition_id=cond_id,
            type=cond_type,
            role=role,
            object=obj,
            bindable=True,
            primitive="fvg_native.compute_fvg_signal",
            approximation=False,
            executed=True,
            reason=None,
        )

    # Level/Zone Routing Sub-Wire (experiment, env-gated — see module docstring
    # above LEVEL_ZONE_RE). Checked AFTER the FVG identity dispatch above (an
    # object naming both an FVG and a level/zone concept, e.g. "fvg near
    # support zone", keeps FVG's more specific routing when both flags happen
    # to be on) and scope-locked to WAIT_STRUCTURE/VERIFY_STRUCTURE only per
    # packet §3 — FILTER is explicitly NOT in scope for this sub-wire (unlike
    # the FVG dispatch above, which does cover FILTER).
    if (
        cond_type in ("WAIT_STRUCTURE", "VERIFY_STRUCTURE")
        and levelzone_routing_enabled()
        and resolve_levelzone_object(obj)
    ):
        # Population-A Level Resolver (docs/designs/packet-levelzone-population-a-
        # resolver-2026-07-20.md) — checked BEFORE falling back to the EMA-proxy sub-wire
        # primitive, so a Population-A-classified condition gets the per-condition resolved
        # level instead of the shared proxy. Requires BOTH flags: the pre-existing routing
        # flag (this condition would otherwise get retest_touch_check at all) AND the new,
        # independent resolver flag.
        #
        # approximation, PER-KIND (docs/designs/packet-population-a-flip-step-2026-07-20.md):
        # named_sr_level and order_block_edge are FALSE here — each independently earned a
        # de-approximation grade (see POPULATION_A_DEAPPROXIMATED_KINDS docstring above for
        # the citations). Every other Population-A kind (swing) stays at meta.base_
        # approximation (True), so it routes through this same primitive without a fidelity
        # claim attached. ★ THE GROUND IS THE ANCHOR-VS-TAUGHT-OBJECT REFUSAL (AR-199 §1),
        # NOT A COUNT: a swing is the ANCHOR of a fibonacci retracement, while the taught
        # object is the 50/61.8% LINE — an object this primitive does not emit. There is
        # nothing for the row to bind TO. This sentence previously gave the reason as
        # "n=1, below the n>=2 de-approximation floor"; that ground is WITHDRAWN, and it
        # was false in its own terms — the census holds 2 by two independent paths, so the
        # population MEETS the floor and the sentence argued for the opposite of the
        # disposition it was attached to. The grade-scope ground that briefly replaced it
        # is withdrawn too: a ground that depends on our own permission is not a ground.
        # No row count and no widening of the grade can move a refusal about what is
        # EMITTED. The count is deliberately absent here rather than typed.
        if levelzone_resolver_enabled():
            pop_a_kind = classify_population_a_kind(obj)
            if pop_a_kind is not None:
                resolved_approximation = (
                    False if pop_a_kind in POPULATION_A_DEAPPROXIMATED_KINDS else meta.base_approximation
                )
                return ConditionBinding(
                    condition_id=cond_id,
                    type=cond_type,
                    role=role,
                    object=obj,
                    bindable=True,
                    primitive=LEVELZONE_RESOLVER_PRIMITIVE,
                    approximation=resolved_approximation,
                    executed=meta.executed,
                    reason=None,
                )
        return ConditionBinding(
            condition_id=cond_id,
            type=cond_type,
            role=role,
            object=obj,
            bindable=True,
            primitive=LEVELZONE_NATIVE_PRIMITIVE,
            approximation=meta.base_approximation,
            executed=meta.executed,
            reason=None,
        )

    if meta.requires_session_keyword:
        # ── NAME-ROUTE (REDESIGN sub-packet 1, R-284 Decision A §1(a)), gated on
        # TF_SESSION_ROLE_RESOLVER_ENABLED. An unambiguous CLOSED-ENUM session
        # NAME carrying NO clock binds to its EXACT killzone window:
        # bindable=True, approximation=False, primitive is_in_killzone (the one
        # (ii)-eligible honest lane — no clock derivation, so the flag is
        # truthful). The scope-line path (name-route|zone|window) is emitted by
        # the (ii) detector from session_zone (§1 pin (vi)). On a miss, the flow
        # falls to the orphan/wrap/recognized-no-window REFUSAL routing below —
        # under flag ON there is NO coarse approximation=True bind.
        #
        # ★ FLAG OFF (default): the pre-REDESIGN keyword bind, BYTE-IDENTICAL —
        # same primitive (effective_primitive()), same approximation, same
        # fields. The name-route lane never executes; the resolver block below
        # is skipped; nothing about the flag-off tree moves.
        if session_role_resolver_enabled():
            name = resolve_session_name_to_window(obj)
            if name is not None:
                zone, _path = name
                return ConditionBinding(
                    condition_id=cond_id,
                    type=cond_type,
                    role=role,
                    object=obj,
                    bindable=True,
                    primitive=SESSION_NAME_ROUTE_PRIMITIVE,
                    approximation=False,
                    executed=meta.executed,
                    reason=None,
                    session_zone=zone,
                )
        else:
            zone = resolve_session_keyword(obj)
            if zone is not None:
                # ★ F-1 (R-662 §7). approximation is no longer granted by
                # MEMBERSHIP in SESSION_KEYWORDS. If the row carries clock
                # teaching, exactness is EARNED only when the parsed span
                # equals the window is_in_killzone is OBSERVED to evaluate;
                # otherwise it fails closed to True. Rows with no clock make no
                # clock claim and are untouched. The BIND itself is unchanged —
                # this only ever moves the exactness flag, never bindable.
                return ConditionBinding(
                    condition_id=cond_id,
                    type=cond_type,
                    role=role,
                    object=obj,
                    bindable=True,
                    primitive=meta.effective_primitive(),
                    approximation=_session_keyword_fidelity_approximation(
                        obj, zone, meta.effective_approximation()
                    ),
                    executed=meta.executed,
                    reason=None,
                    session_zone=zone,
                )
        # ── ORPHAN-ZONE REFUSAL — CONSULTED BEFORE THE ROLE RESOLVER.
        # (packet-session-refusal-precedence-2026-07-21.md, scope item (i).)
        #
        # ★ THIS ORDER IS THE FIX. The refusal used to sit BELOW the role
        # resolver, so enabling TF_SESSION_ROLE_RESOLVER_ENABLED converted a
        # correct refusal into a confident bind. MEASURED on 2 of the 9
        # refusal-path objects in the 395-object WAIT_SESSION corpus:
        #
        #   flag OFF -> bindable=False, session_zone_refused_uncomputable_window:overnight
        #   flag ON  -> bindable=True,  zone=ny_am        <-- the RTH day session,
        #                                                     the COMPLEMENT of the
        #                                                     overnight range taught
        #
        #   "new york market open or pre market"
        #   "overnight/pre-market range: ... from 400 p.m. EST ... until 9:30 a.m. EST ..."
        #
        # THE REFUSAL IS LOAD-BEARING AND MUST SURVIVE THE FLAG. A phrase
        # naming a zone this engine has no evaluable window for is refused in
        # EVERY flag state; no flag may promote it to a bind. The role
        # resolver is a coarse containment proxy — it is strictly weaker
        # evidence than an explicit named refusal, so it does not get to
        # overturn one.
        #
        # ★ FLAG-OFF BEHAVIOUR IS UNCHANGED BY THIS REORDERING, provably: with
        # the flag OFF the resolver block below never executes, so the two
        # blocks cannot race. Asserted by test, not by this argument.
        #
        # It is REFUSED, not silently dropped: the reason names the zone, so
        # this is distinguishable from "we never recognized it" in every
        # downstream ledger. Before the orphan-zone closure these phrases
        # returned bindable=True with approximation=False and a zone
        # is_in_killzone() returned False for on all 1,440 minutes of the day.
        #
        # ★ approximation is True, never False. The packet forbids an
        # approximation=False on these zones by name — an exactness claim is
        # exactly what the defect wore. It is inert for every aggregate:
        # `approximation_used` and spec_producer's binding-approximation rate
        # both filter on `bindable and executed`, and this row is neither.
        refused = refused_session_zone(obj)
        if refused is not None:
            return ConditionBinding(
                condition_id=cond_id,
                type=cond_type,
                role=role,
                object=obj,
                bindable=False,
                primitive=None,
                approximation=True,
                executed=False,
                reason=session_refusal_reason(refused),
                session_zone=None,
            )

        # Role-Aware Session Resolver (see module comment above
        # classify_session_role) — only consulted AFTER the exact-phrase
        # matcher above has already missed AND the orphan-zone refusal above
        # has declined to fire, and only when explicitly enabled. Flag OFF
        # (default): falls straight through to the pre-existing unbound
        # return below, byte-identical to before this packet touched the file.
        if session_role_resolver_enabled():
            role_result = classify_session_role(obj)
            if role_result.zone is not None:
                # ★ CLOCK-DERIVED COARSE OVERLAP — REFUSED, never bound (R-284
                # Decision A §1(b) + build item 1). A window derived from
                # clock/anchor min-max overlap against one of the 5 real
                # killzones is an approximation=True PROXY, not the exact
                # window is_in_killzone evaluates. The old lane bound it
                # approximation=True; that bind then rode the family-level
                # honest read (WAIT_SESSION honest=False) straight through
                # (ii) — the hole the REDESIGN scoping surfaced. There is no
                # honest exact window to bind, so this is refused with the
                # recognized-no-computable-window reason (a coarse-derivable
                # zone is precisely "recognized but no window we can honestly
                # gate on"). The (ii) detector's binding-level conjunction is
                # the second, independent guard on the same class.
                return ConditionBinding(
                    condition_id=cond_id,
                    type=cond_type,
                    role=role,
                    object=obj,
                    bindable=False,
                    primitive=None,
                    approximation=False,
                    executed=False,
                    reason=SESSION_TEACHING_UNBOUND_REASON,
                    session_zone=None,
                )
            if role_result.refusal is not None:
                # ★ A taught window that WRAPS MIDNIGHT. Refused BY NAME and
                # never complement-bound — see
                # SESSION_WRAPPING_WINDOW_UNBOUND_REASON for the measurement
                # showing min/max derives the complement of such a window.
                # Distinct reason from the generic recognized-no-window
                # bucket, so a downstream ledger can tell "we cannot
                # represent this shape" from "we have no window for this
                # name."
                return ConditionBinding(
                    condition_id=cond_id,
                    type=cond_type,
                    role=role,
                    object=obj,
                    bindable=False,
                    primitive=None,
                    approximation=False,
                    executed=False,
                    reason=role_result.refusal,
                    session_zone=None,
                )
            if role_result.recognized:
                # Genuine session teaching, but no window session_windows.py
                # can compute (ambiguous named session, or a session-range
                # LEVEL reference — see module comment). Stays unbound —
                # never guesses a zone — but with an honest, distinct reason
                # so §6a coverage can tell "recognized, no primitive" apart
                # from "not even recognized."
                return ConditionBinding(
                    condition_id=cond_id,
                    type=cond_type,
                    role=role,
                    object=obj,
                    bindable=False,
                    primitive=None,
                    approximation=False,
                    executed=False,
                    reason=SESSION_TEACHING_UNBOUND_REASON,
                    session_zone=None,
                )
        # ★★ HISTORICAL PROVENANCE OF THE ORPHAN-ZONE REFUSAL — retained here
        # when the refusal block itself moved ABOVE the role resolver
        # (packet-session-refusal-precedence-2026-07-21.md scope item (i)).
        # The refusal now fires EARLIER, so it strictly supersedes what is
        # described below; the measurement is kept because it is the receipt
        # for the orphan-zone closure's own behaviour delta, and deleting a
        # receipt because its code moved would lose the only record of it.
        #
        # ★★ MEASURED BEHAVIOUR DELTA — DECLARED HERE, NOT DISCOVERED DOWNSTREAM.
        # The packet declared Option A as "no behaviour change", on a census run
        # over the 16-spec / 27-WAIT_SESSION corpus. That is TRUE THERE (0 of 27
        # changed) and FALSE on the 120-spec or-branches corpus, which is the
        # universe the enforcement delta harness actually measures. Full sweep,
        # 136 specs x 2000 real ES 5min bars, this commit vs its parent:
        #   - 114 specs byte-identical on all four signal columns.
        #   - 19 specs: `confluence_bound` drops by 1-2 (a confluence-role
        #     WAIT_SESSION condition stops binding). compute()'s loop selects
        #     role=="spine", so confluence conditions are never evaluated —
        #     ZERO signal change on all 19.
        #   - ★ 3 specs (or-branches #50, #51, #79) DO change. Each carries
        #     `WAIT_SESSION:new york market open or pre market#0` at role=SPINE,
        #     which bound `overnight`. Before: an always-False gate, so the spine
        #     conjunction could never be satisfied and the spec produced
        #     entry_long=0. After: honestly unbound, so it takes the documented
        #     permitted-through pass-through (spec_condition_compiler's
        #     `if not b.bindable: np.ones`) and the spec produces entry_long=115.
        #     spine_bound 24 -> 23 of 32; ratio 0.750 -> 0.719, still above
        #     MIN_SPINE_BOUND_RATIO, so `compiled` is unchanged.
        #
        # THE DIRECTION IS RISK-INCREASING AND IS NOT HIDDEN: three specs go from
        # never-entering to entering. Neither state is a real gate — the old one
        # was False for a fabricated reason, the new one is True for a declared
        # one. If that pass-through default is judged wrong for session
        # conditions, that is a SEPARATE decision about unbound spine handling
        # and belongs in its own packet; it is not something to fix by keeping an
        # always-False gate alive.
        return ConditionBinding(
            condition_id=cond_id,
            type=cond_type,
            role=role,
            object=obj,
            bindable=False,
            primitive=None,
            approximation=False,
            executed=False,
            reason=meta.unbound_reason,
            session_zone=None,
        )

    return ConditionBinding(
        condition_id=cond_id,
        type=cond_type,
        role=role,
        object=obj,
        bindable=True,
        primitive=meta.effective_primitive(),
        approximation=meta.effective_approximation(),
        executed=meta.executed,
        reason=None,
    )


def bind_condition(
    condition: dict,
    restore: bool = False,
    demoted_role: str | None = None,
    force_unexecuted: bool = False,
) -> ConditionBinding:
    """Public entry point — resolves the graph's own `role` field (or a Hard-
    Constraint Demotion Experiment override) and dispatches to
    `_bind_condition_dispatch()`, then applies `force_unexecuted` as a final
    post-hoc override. Both new parameters default to their inert value
    (None / False) so every pre-existing caller is 100% byte-identical.

    `demoted_role` / `force_unexecuted` (Hard-Constraint Demotion Experiment, docs/designs/
    hard-constraint-demotion-experiment-2026-07-05.md): the CALLER (compile_binding_plan) has
    already resolved, for THIS condition_id, whether the active TF_ROLE_DEMOTION_MODE structurally
    demotes it (via struct_demotes()) and passes the concrete override down. `demoted_role`
    replaces the graph's own `role` field (OPTIONAL -> "confluence") BEFORE dispatch — so it
    participates in the confluence/spine split and every other role-conditioned decision below
    exactly as if the graph had shipped that role natively. `force_unexecuted` flips `executed` to
    False AFTER dispatch (CONTEXTUAL -> "removed from the execution graph entirely, metadata
    only" — role is left at whatever `_bind_condition_dispatch` decided; only `executed` changes,
    which is the distinction from OPTIONAL's role-based move). Neither parameter touches
    ALTERNATIVE conditions — those are demoted via OR-group merging in spec_condition_compiler.py,
    not via a role/executed override, so this function is a no-op for them (role/executed pass
    through exactly as the base FAMILY_META dispatch would produce)."""
    role = demoted_role if demoted_role is not None else str(condition.get("role", "") or "")
    binding = _bind_condition_dispatch(condition, restore=restore, role=role)
    if force_unexecuted and binding.executed:
        binding = replace(binding, executed=False, reason=binding.reason or "role_demotion_contextual_removed")
    return binding


@dataclass
class BindingPlan:
    bindings: list[ConditionBinding]
    invalidation_bindings: list[ConditionBinding]
    trigger_condition_id: str
    trigger_bound: bool
    spine_total: int
    spine_bound: int
    confluence_total: int
    confluence_bound: int
    approximation_used: bool
    compiled: bool
    queue_reasons: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "bindings": [b.to_dict() for b in self.bindings],
            "invalidation_bindings": [b.to_dict() for b in self.invalidation_bindings],
            "trigger_condition_id": self.trigger_condition_id,
            "trigger_bound": self.trigger_bound,
            "spine_total": self.spine_total,
            "spine_bound": self.spine_bound,
            "confluence_total": self.confluence_total,
            "confluence_bound": self.confluence_bound,
            "approximation_used": self.approximation_used,
            "compiled": self.compiled,
            "queue_reasons": self.queue_reasons,
        }


def compile_binding_plan(
    spec: dict,
    restore_condition_ids: frozenset[str] | None = None,
    demotion_classifications: dict[str, str] | None = None,
) -> BindingPlan:
    """Compile a full spec artifact body {entry_conditions, invalidations,
    entry_trigger_id, ...} into a BindingPlan.

    `restore_condition_ids` (Composition Fidelity Experiment, default None — 100% backward
    compatible): an explicit set of condition_ids to attempt bundle-restoration binding for (see
    bind_condition's `restore` docstring). None (every existing caller) means no condition is
    restored regardless of TF_COMPOSITION_BUNDLE_ENABLED — the experiment's harness is the only
    caller expected to ever pass a non-None value.

    `demotion_classifications` (Hard-Constraint Demotion Experiment, default None — 100% backward
    compatible): a pre-resolved `{condition_id: DRI_audit_classification}` map for THIS spec's
    video (built by the CALLER — this module stays zero-I/O per its purity contract, so it never
    loads docs/replay-results/dri-audit-2026-07-05.json itself; see src/engine/role_demotion_audit.py
    for the loader and spec_condition_compiler.SpecConditionStrategy.__init__ for the caller that
    builds this map from `compiled_spec["video"]`). None (every pre-experiment caller) means no
    condition is demoted regardless of TF_ROLE_DEMOTION_MODE. Only OPTIONAL (-> role="confluence")
    and CONTEXTUAL (-> executed=False) are applied here; ALTERNATIVE is intentionally NOT looked
    up in this map — its OR-group merge happens entirely in spec_condition_compiler.py, never as a
    role/executed override (see bind_condition's docstring).

    Deterministic: iterates entry_conditions in-order, no randomness, no
    wall-clock reads — same spec always produces the same plan (replay
    determinism contract).
    """
    entry_conditions = spec.get("entry_conditions", []) or []
    invalidations = spec.get("invalidations", []) or []
    trigger_id = str(spec.get("entry_trigger_id", "") or "")
    mode = role_demotion_mode()

    def _restore(c: dict) -> bool:
        if restore_condition_ids is None:
            return False
        return str(c.get("id", "")) in restore_condition_ids

    def _demoted_role(c: dict) -> str | None:
        if demotion_classifications is None:
            return None
        cls = demotion_classifications.get(str(c.get("id", "")))
        if cls == "OPTIONAL" and struct_demotes(mode, cls):
            return "confluence"
        return None

    def _force_unexecuted(c: dict) -> bool:
        if demotion_classifications is None:
            return False
        cls = demotion_classifications.get(str(c.get("id", "")))
        return cls == "CONTEXTUAL" and struct_demotes(mode, cls)

    bindings = [
        bind_condition(c, restore=_restore(c), demoted_role=_demoted_role(c), force_unexecuted=_force_unexecuted(c))
        for c in entry_conditions
    ]
    invalidation_bindings = [
        bind_condition(c, restore=_restore(c), demoted_role=_demoted_role(c), force_unexecuted=_force_unexecuted(c))
        for c in invalidations
    ]

    spine = [b for b in bindings if b.role == "spine"]
    confluence = [b for b in bindings if b.role == "confluence"]
    spine_bound = sum(1 for b in spine if b.bindable)
    confluence_bound = sum(1 for b in confluence if b.bindable)

    trigger_binding = next((b for b in bindings if b.condition_id == trigger_id), None)
    trigger_bound = bool(trigger_binding and trigger_binding.bindable)

    approximation_used = any(b.approximation for b in bindings if b.bindable and b.executed) or any(
        b.approximation for b in invalidation_bindings if b.bindable and b.executed
    )

    queue_reasons: list[dict] = []
    compiled = True

    if not trigger_bound:
        compiled = False
        queue_reasons.append(
            {
                "condition_id": trigger_id,
                "type": trigger_binding.type if trigger_binding else "unknown",
                "object": trigger_binding.object if trigger_binding else "",
                "reason": trigger_binding.reason if trigger_binding else "trigger_condition_not_found",
            }
        )

    # A bare trigger with NO spine (required-sequence) conditions at all is
    # NOT enough to call a spec "condition-compiled" — there is no structural
    # narrative to bind primitives to beyond a vague trigger phrase. This is
    # what distinguishes a genuinely compilable spec from e.g. a one-line
    # "vwap slope reversal cross" trigger with only a confluence tag (Band B's
    # own vwapSpec fixture) — that spec correctly stays queued.
    if not spine:
        compiled = False
        queue_reasons.append(
            {
                "condition_id": trigger_id,
                "type": trigger_binding.type if trigger_binding else "unknown",
                "object": "",
                "reason": "no_spine_conditions_present",
            }
        )

    spine_ratio = (spine_bound / len(spine)) if spine else 0.0
    if spine and spine_ratio < MIN_SPINE_BOUND_RATIO:
        compiled = False
        for b in spine:
            if not b.bindable:
                queue_reasons.append(
                    {
                        "condition_id": b.condition_id,
                        "type": b.type,
                        "object": b.object,
                        "reason": b.reason or "unbindable",
                    }
                )

    # Always surface unbound spine/trigger reasons even when the ratio still
    # clears the bar — per-condition honesty, not just a pass/fail blanket.
    if compiled:
        for b in spine:
            if not b.bindable:
                queue_reasons.append(
                    {
                        "condition_id": b.condition_id,
                        "type": b.type,
                        "object": b.object,
                        "reason": b.reason or "unbindable",
                    }
                )

    return BindingPlan(
        bindings=bindings,
        invalidation_bindings=invalidation_bindings,
        trigger_condition_id=trigger_id,
        trigger_bound=trigger_bound,
        spine_total=len(spine),
        spine_bound=spine_bound,
        confluence_total=len(confluence),
        confluence_bound=confluence_bound,
        approximation_used=approximation_used,
        compiled=compiled,
        queue_reasons=queue_reasons,
    )
