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
condition list. This is deliberate: it is mirrored byte-for-byte in
src/server/lib/spec-family-bindings.ts so the SAME spec produces the SAME
binding plan on both sides of the stack (parity-tested in
tests/test_spec_family_bindings_parity.py). Any change here MUST be mirrored
there in the same commit — same convention as firm_rules_version.py /
firm-rules-version.ts.

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
from dataclasses import dataclass, field, replace

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
SESSION_KEYWORDS: dict[str, tuple[str, ...]] = {
    "london": ("london session", "london open", "london killzone"),
    "ny_am": ("ny am", "new york am", "new york morning", "ny morning", "ny open", "am session"),
    "ny_pm": ("ny pm", "new york pm", "new york afternoon", "ny afternoon", "pm session"),
    "silver_bullet": ("silver bullet",),
    "macro_window": ("macro window", "macro release"),
    "lunch_blackout": ("lunch", "midday", "noon session"),
    "overnight": ("overnight", "globex", "asia session", "pre market", "premarket"),
}

MIN_SPINE_BOUND_RATIO: float = 0.5
"""Minimum fraction of `role=="spine"` conditions that must bind to a primitive
(or resolve to an honest unsupported-but-non-blocking state) before a spec is
considered condition-compiled rather than queued. Conservative default —
tunable, but changing it is a behavior change requiring re-measurement of the
25-sample mapped/queued split (see docs/spec-execution-semantics.md)."""


@dataclass(frozen=True)
class FamilyMeta:
    primitive: str | None
    requires_session_keyword: bool = False
    base_approximation: bool = False
    unsupported: bool = False
    unbound_reason: str | None = None
    executed: bool = True  # False only for EXIT_HINT (provenance-only, never drives signals)


FAMILY_META: dict[str, FamilyMeta] = {
    "WAIT_SESSION": FamilyMeta(
        primitive="session_windows",
        requires_session_keyword=True,
        base_approximation=False,
        unbound_reason="no_recognized_session_keyword",
    ),
    "WAIT_STRUCTURE": FamilyMeta(
        primitive="structure_engine.compute_structure_state",
        base_approximation=True,
    ),
    "VERIFY_STRUCTURE": FamilyMeta(
        primitive="structure_engine.compute_structure_state",
        base_approximation=True,
    ),
    "WAIT_BIAS": FamilyMeta(
        primitive="bias_engine.classify_institutional_regime",
        base_approximation=True,
    ),
    "CONFIRM_DIRECTION": FamilyMeta(
        primitive="bias_engine.classify_institutional_regime",
        base_approximation=True,
    ),
    "WAIT_RETEST": FamilyMeta(
        primitive="spec_condition_compiler.retest_touch_check",
        base_approximation=True,
    ),
    "FILTER": FamilyMeta(
        primitive="entry_quality.confluence_factor_presence",
        base_approximation=True,
    ),
    "WAIT_CONFIRMATION": FamilyMeta(
        primitive="spec_condition_compiler.candle_confirmation_check",
        base_approximation=True,
    ),
    "INVALIDATE": FamilyMeta(
        primitive="structural_stops.compute_structural_stop",
        base_approximation=False,
    ),
    "ENABLE_ENTRY": FamilyMeta(
        primitive="spine_completion_trigger",
        base_approximation=False,
    ),
    "ENTER": FamilyMeta(
        primitive="spine_completion_trigger",
        base_approximation=False,
    ),
    "EXIT_HINT": FamilyMeta(
        primitive="provenance_only",
        base_approximation=False,
        executed=False,
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

    def to_dict(self) -> dict:
        return {
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


def resolve_session_keyword(object_text: str) -> str | None:
    """Pure re-implementation of session_windows.resolve_session_keyword — kept
    local so this module has zero import surface beyond stdlib (portability
    for the TS mirror comparison in tests)."""
    if not object_text:
        return None
    norm = f" {object_text.strip().lower()} "
    for zone, keywords in SESSION_KEYWORDS.items():
        for kw in keywords:
            if f" {kw} " in norm or norm.strip().startswith(kw) or norm.strip().endswith(kw):
                return zone
    return None


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
        # approximation (True) — swing's population is n=1, below the n>=2 de-approximation
        # floor, so it routes through this same primitive without a fidelity claim attached.
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
        zone = resolve_session_keyword(obj)
        if zone is None:
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
            primitive=meta.primitive,
            approximation=meta.base_approximation,
            executed=meta.executed,
            reason=None,
            session_zone=zone,
        )

    return ConditionBinding(
        condition_id=cond_id,
        type=cond_type,
        role=role,
        object=obj,
        bindable=True,
        primitive=meta.primitive,
        approximation=meta.base_approximation,
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
