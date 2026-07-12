"""H1 Wave-4 pilot conveyor runner (pilot pre-reg `docs/designs/h1-pilot-
preregistration-2026-07-12.md`, ADDENDUM 2 REWORK + ADDENDUM 3 ANCHOR-LOCATOR
WIRING -- 2026-07-12, "the extractor's condition IS the unit" + "A-prime:
the anchor-locator is the anchor source").

REWORK SUMMARY (Addendum 2 supersedes the band-6-landed sentence-split
design): the unit of analysis is no longer a mechanical punctuation-split
sentence. It is now a condition EMITTED BY THE PRODUCTION GEMMA
transcript_extractor. Pipeline:

  transcript -> production gemma transcript_extractor (extractor_bridge.py,
  a SEPARATE module -- see its own docstring for why) -> extracted strategy
  (entry_sequence / confluences / stop / targets) -> per condition: the
  ANCHOR-LOCATOR (anchor_locator.py, ADDENDUM 3) locates a verbatim
  grounding quote for the condition's text somewhere in the full transcript
  -> tier-1 runs on the LOCATED QUOTE (ONE condition per call, its graded
  contract -- see ANCHOR WIRING note below for why the quote, not the
  extractor's condition text, is what tier-1 classifies) -> classify or
  explicit Tier1FallThrough -> tier-3 blind packet for fall-throughs
  (unchanged Wave-1 shape) -> [external adjudication, NOT this module] ->
  finalize_certificate -> pilot-grade certificate.

ANCHOR WIRING (Addendum 3, A-prime -- supersedes this module's OWN prior
naive-substring anchor source, see the superseded-finding note below):
`locate_condition_anchors` now calls `anchor_locator.locate_anchor(
full_transcript, condition_text, propose_fn)` for every extracted spine
condition, instead of exact-substring-searching the condition's OWN
(frequently paraphrased) text. Two consequences, both load-bearing:

  1. The certificate's `quote_anchor`/`char_span` for an anchored condition
     are the LOCATOR's returned span -- always a literal transcript slice
     BY anchor_locator.py's own construction (PROPOSE via gemma, VERIFY
     mechanically, exact-substring under whitespace-normalization ONLY,
     reusing `compile_lints.f2_coverage_gate` by identity -- see that
     module's docstring). This module never re-implements or loosens that
     verification.
  2. Tier-1 classification (`run_tier1`) runs on `anchor_result.quote` (the
     LOCATED transcript text) for the CERTIFICATE ENTRY -- never on the
     extractor's `cond.text` (its paraphrase) for that purpose. This is NOT
     a free choice -- tier1_detectors.detect_tier1
     requires `segment_text[s:e] == full_transcript[char_span[0]+s:
     char_span[0]+e]` (its own claim-scoping invariant, tier1_detectors.py
     ~line 535) for the char_spans it emits to resolve. `anchor_result.quote`
     is guaranteed equal to `full_transcript[char_span[0]:char_span[1]]`
     (anchor_locator.py's own contract); the extractor's paraphrase `cond.
     text` is NOT (that mismatch is the entire reason Addendum 3 exists).
     Classifying the paraphrase while stamping the locator's span would
     silently violate that invariant and desync the certificate's own
     `every_anchor_resolves` check (cert_assembler.py ~line 228) from what
     tier-1 actually read. This is also the linguistically correct choice:
     tier1_detectors.py's vocabulary was characterized against real
     TRANSCRIPT clauses (the 143-condition design set), not extractor
     paraphrases, so the located quote is the surface tier-1 was built to
     read.
  3. Every anchor call that DECLINES or hallucinates (`locate_anchor`
     returning `located=False`) lands as `UnanchoredCondition` carrying the
     locator's own machine-readable `reason` (`locator_declined` /
     `proposed_quote_not_literal_substring`, anchor_locator.py's
     `REASON_*` constants) -- clause-5 attribution (below) buckets both
     under the single `unanchored` diagnosis category (Addendum 2 clause 5
     names it as one of the 6 categories) while keeping the sub-reason on
     `UnanchoredCondition.reason` and rolled up in each certificate's
     `unanchored_reason_breakdown` for diagnostics, never as a new grading
     category.
  4. ADDENDUM 4, FIX 1 (dual-read agreement gate): a located anchor being
     LITERAL is necessary but not sufficient -- it can still be
     MIS-GROUNDED (a real transcript span whose surface just happens to
     match a tier-1 pattern, grounding the WRONG condition). Before
     classifying on `anchor_result.quote`, `prepare_strategy` also runs
     tier-1 on `cond.text` (the condition's own surface, its char_span
     irrelevant) and compares the two fired-class sets. Only AGREEMENT
     classifies; disagreement is an honest fall-through to tier-3, still
     carrying the located quote's span (never `cond.text`'s).

RESOLVED -- CATCH #4 (independent grade 2026-07-12, finding F-2026-07-12-A,
CRITICAL, UNSEAL-BLOCKING; fixed per ADDENDUM 4 -- kept for history, read
Addendum 4 in the pre-reg for the current state). Addendum 3 §4 claimed
"anchor-SUPPORTS-condition stays tier-3's job -- a mislocated-but-literal
anchor is caught by the rater." That safety property did NOT hold as wired:
(1) a mis-grounded-but-literal anchor whose quote happened to carry tier-1
surface FIRED at tier-1 and was counted OK -- tier-1 fires never entered
`_build_tier3_packet` (which only receives fall-throughs), so nothing audited
the fire path; (2) even on the fall-through path `_build_tier3_packet`
hardcoded `extracted_condition_type`/`extracted_object` to None and raters
judged role "from the quote alone", never seeing the condition -- so no
anchor-supports-condition comparison happened anywhere. The located-quote
classification DIRECTION stayed correct + operator-endorsed (measuring the
trader's surface, not our paraphrase); the open question was span-choice
INTEGRITY only.

FIX 1 -- DUAL-READ AGREEMENT GATE (`prepare_strategy` below, `_tier1_
surface_signature`): the DETERMINISTIC tier-1 detectors now run on BOTH the
extractor's own condition text and the located quote, at zero extra model
calls. Agreement (same fired surface_class set, including both-silent) ->
classify using the located quote's detection (the anchored one). Disagreement
(different class, or one fires while the other is silent) -> honest
fall-through to tier-3, carrying the located quote's span. A mis-grounded-
but-literal anchor can no longer fire uncaught.

FIX 2 -- TWO-STAGE TIER-3 PACKET (`_build_tier3_packet` below): every
fall-through packet now carries a Stage-1 (blind, verbatim-preserved) role
task in `sections` PLUS a separate Stage-2 (`packet["stage2"]`) task that
reveals the extractor's condition text and asks "does this quote express
this condition?" -> `support` in {confirmed, partial, denied} + REQUIRED
justification. Stage 2 lives OUTSIDE `sections` so a Stage-1-only dispatch
structurally cannot see it; `blinding_leak_scan` was extended (not forked)
with a Stage-2-leak check proving no Stage-2 condition text appears inside
the serialized Stage-1 `sections` content. The support verdict lands as an
ADDITIVE certificate field (`adjudication_verdict.support` / `.
support_justification`, joined by `finalize_certificate` as POST-PROCESSING
-- `cert_assembler.py` stays UNMODIFIED, same precedent as the clause-4
unanchored-condition injection). `denied`/`partial` downgrades the condition
(classifying_tier reset to None -- treated like an unresolved fall-through
for grading) and forces `pilot_grade`/`full_grade`/`certificate_grade` to
False; `confirmed` leaves the condition grounded. Addendum 3 §4 is now TRUE
as wired.

ADDENDUM 5 -- CATCH #5 (independent re-grade of the catch-#4 fix, finding
F-N, CRITICAL): the dual-read gate above compares `frozenset(surface_class)`
ONLY, so a SAME-surface-class DIFFERENT-content mis-grounding (a stop-rule
condition mis-grounded onto an entry-rule quote that happens to carry the
SAME tier-1 surface) passed as "agreement", classified carrying the wrong
rule's quote, and never reached tier-3 -- the Stage-2 support backstop never
saw it. Addendum 5 adds the missing axis PLUS a sampling audit, composed
with FIX 1 into a 3-axis defense (classify only if a fire survives ALL
axes, else honest fall-through to the two-stage tier-3 packet):

  AXIS 1 -- SURFACE (FIX 1 above, unchanged): kills surface-divergent
    mis-grounding.
  AXIS 2 -- CONTENT (`content_tokens` below, in `prepare_strategy`'s
    per-condition loop): a fire additionally requires >=1 shared
    content-bearing token between the located quote and the condition's OWN
    text -- zero shared content tokens is GROSS-mismatch semantics (the
    quote cannot be grounding THIS condition) and falls through honestly.
    PARITY-FIXTURED (not REUSED-by-import: extraction-coverage-gate.ts is
    TypeScript, no Python import target exists -- same precedent as
    `compile_lints.f2_coverage_gate`'s own ledger entry) against
    `src/server/lib/extraction-coverage-gate.ts`'s `normalize()`
    (lines 120-130) + `contentTokens()` (lines 142-149) + `STOPWORDS`
    (lines 56-64) -- the SAME tokenizer + stopword/content-word definition,
    mirrored whole (Addendum 5: "single authority, WHOLE definition... NO
    second tokenizer, NO new stopword list"). Floor pinned at >=1 (NOT
    raised to >=2 -- would false-fallthrough terse genuine groundings for
    zero caught fraud); no action-class (entry/exit/stop) axis is added
    (that would be a semantic classifier in mechanical costume). Zero extra
    model calls -- `content_tokens` is pure regex/stdlib, same precedent as
    the dual-read `run_tier1` calls.
  AXIS 3 -- SAMPLING (`_select_axis3_audit_fire` / `axis3_adjudication_
    ceiling` below, wired into `_build_tier3_packet` via `audit_target`):
    the NAMED RESIDUAL axis 1+2 cannot mechanically close -- trading
    transcripts are vocabulary-dense, so an entry rule and an exit rule
    about the SAME indicator can share BOTH surface class AND content
    tokens ("cross", "50", "SMA"); a same-surface, overlapping-vocabulary,
    different-rule mis-grounding passes both mechanical axes. Axis 3 does
    NOT mechanically close this (Addendum 5 is explicit: no honest
    mechanical floor closes it without becoming the rejected semantic
    checker) -- it makes the residual STATISTICALLY VISIBLE by auditing ONE
    RANDOMLY-SELECTED classified tier-1 fire per (video, strategy) through
    the SAME two-stage packet a genuine fall-through gets, riding whatever
    IDLE tier-3 budget remains under the pre-reg's ~15-adjudications/video
    affordability ceiling (fall-throughs/cannot-determines consume the
    budget FIRST; the audit rides free only when capacity remains).
    Deterministic by construction (`_axis3_seed`, sha256 over
    `video_id`/`strategy_index` -- never wall-clock, never unseeded): the
    SAME video (and, within a multi-strategy video, the SAME strategy)
    against the SAME candidate pool always audits the SAME fire. The
    selected span/support verdict is recorded as an ADDITIVE
    `certificate["axis3_audit"]` field by `finalize_certificate`
    (POST-PROCESSING, same precedent as the unanchored-condition injection
    and the Stage-2 support join -- `cert_assembler.py` stays
    UNMODIFIED) -- a `denied`/`partial` support here is a MONITORING
    signal, not a mechanical downgrade: the audited condition's
    `classifying_tier` is left untouched (axis 3 is a sampling audit, not a
    gate), exactly matching the addendum's "makes it statistically visible;
    it is NOT claimed mechanically closed."

`_segment_transcript` (the mechanical sentence-punctuation split) is
REMOVED. It was a proxy population wearing the extractor's clothes (Addendum
2's own words) -- Option B (a deterministic mechanical clause-rule) is
DISQUALIFIED BY LAW. Tests that exercised it are gone; the extractor-as-unit
tests replace them.

TWO-PHASE DESIGN UNCHANGED (the structural proof this module never
adjudicates): `prepare_strategy`/`prepare_video` still only run tier-1,
collect fall-throughs, build a blind tier-3 packet, and run the leak-scan --
nothing in this phase calls an LLM or agent. The EXTRACTION call (transcript
-> gemma) happens strictly BEFORE this phase, in the caller (or
`extractor_bridge.py`), never inside `prepare_strategy`/`prepare_video`/
`finalize_certificate`. `finalize_certificate` still only consumes
`Tier3Verdict` objects as data. `aggregate` still only reduces certificates
to the pilot §1 read (now carrying a diagnosis distribution, clause 5).

============================================================================
SUPERSEDED FINDING, RESOLVED by ADDENDUM 3 (kept for history -- read
ADDENDUM 3 in the pre-reg, not this note, for the current state). Addendum
2 clause 4 originally assumed "the extraction machinery carries evidence
spans, so the runner threads them through." That premise was FALSE for the
current default production extraction path (the minimal 8-field schema,
Wave 26 Pass L): `entry_sequence[].action` / `confluences[].description` /
`stop.rationale` / `targets[].rationale` / `stop_management` -- the fields
that carry TRADE-RULE / gate language -- carry NO quote/anchor field
anywhere in that schema; only the unrelated vocabulary-only
`speaker_concepts[]` pass carries `transcript_quote`. Wired naively (this
module's OWN condition text exact-substring-searched against itself, the
pre-Addendum-3 state), this measured near-0% pilot cert-grade -- a
MEASUREMENT-INFRASTRUCTURE gap, not the EXTRACTION-FIDELITY signal the
pilot's §1 bar exists to read.

RESOLUTION (Addendum 3, A-prime): a NEW conveyor instrument,
`anchor_locator.py`, LOCATES the grounding transcript span for each
extracted condition (gemma PROPOSES, a mechanical check VERIFIES -- see
that module's own docstring) instead of assuming the condition's own text
IS a literal quote. `locate_condition_anchors` below now calls it. This
module STILL implements Addendum 2's 5 clauses literally and correctly
against the field set that matches tier-1's design target (`entry_sequence`
/`confluences`/`stop`/`targets`/`stop_management` -- see
`SPINE_CONDITION_FIELDS` below, REUSED from `src/server/lib/extraction-
grounding.ts`'s `collectStrategyText()`); what changed is HOW each
condition's anchor is obtained, not which fields count as conditions.
`extractor_anchor_availability_report` (below) still surfaces the
anchored/unanchored split numerically per-run, now driven by the locator's
real behavior rather than a naive-substring guarantee-of-failure.
============================================================================

LEAK-SCAN / CONTROL-SET-REUSE / TRANSCRIPT-FETCH-SEAM notes: mostly UNCHANGED
from the band-6 landing, EXCEPT `blinding_leak_scan` gained a third check
(Addendum 4 FIX 2, the Stage-2-leak scan -- see that function's own
docstring); see `blinding_leak_scan`, `_build_tier3_packet`,
`fetch_transcript` docstrings below (not restated here to avoid drift
between two copies of the same explanation).

NO vectorbt / backtester import anywhere in this module (CLAUDE.md's
pytest-collection JIT-hang caveat) -- it only imports the pure-stdlib
extraction package, matching `cert_assembler.py` / `tier1_detectors.py`.
The real-extractor subprocess bridge lives ENTIRELY in `extractor_bridge.py`
(a separate module); the real anchor-proposal gemma call lives ENTIRELY in
`anchor_locator.py` (imported here as `al` -- an import statement, not a
dispatch token, same precedent as extractor_bridge's own two-file split) --
so this module's own non-adjudicator source-scan test
(`test_module_never_calls_an_llm_or_adjudicator`) keeps meaning what it
says: no LLM-dispatch token of any kind appears in THIS file's OWN source,
ever, even though it now drives TWO LLM-backed modules through their
`propose_fn`/subprocess seams.
"""

from __future__ import annotations

import hashlib
import json
import os
import random
import re
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Tuple

from . import anchor_locator as al
from . import compile_lints as cl
from .cert_assembler import ConditionTopology, Tier3Verdict, assemble_certificate
from .tier1_detectors import Tier1Detection, Tier1FallThrough, run_tier1

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
_WAVE1_PACKETS_PATH = os.path.join(
    _ROOT, "docs", "designs", "h1-wave1-shakedown-packets-2026-07-12.json"
)

# --------------------------------------------------------------------------- #
# Spine conditions -- the extractor's condition IS the unit (Addendum 2)
# --------------------------------------------------------------------------- #

# REUSED, not invented: this is the EXACT field set
# `src/server/lib/extraction-grounding.ts`'s `collectStrategyText()` (lines
# 52-105 of that file) already treats as "the strategy's rule text" in
# production numeric-grounding checks. Reusing an existing production-
# recognized definition of "the strategy's condition text" is the least-new-
# judgment choice available -- inventing a narrower or broader field set
# here would itself be an unregistered instrument decision (exactly the
# class Addendum 2 exists to prevent). `entry_condition`/`description`
# (legacy DSL-only fields, absent from the minimal schema) are excluded, as
# extraction-grounding.ts documents them as "present during transition
# period" only.
SPINE_CONDITION_FIELDS = (
    "entry_sequence[].action",
    "entry_sequence[].rationale",
    "confluences[].description",
    "stop.rationale",
    "targets[].rationale",
    "stop_management",
)


@dataclass
class SpineConditionText:
    """One extracted condition's text, before anchor location. `condition_ref`
    is a human-readable pointer (field path + index) into the source
    strategy object, kept ONLY for diagnosis/audit -- never fed to any lint
    or grade."""

    condition_ref: str
    text: str
    strategy_index: int = 0


def extract_spine_condition_texts(
    strategy: dict, strategy_index: int = 0
) -> List[SpineConditionText]:
    """Pull every SPINE_CONDITION_FIELDS entry out of one extracted strategy
    object (the minimal-schema shape gemma emits). Pure, no I/O. Empty/None
    text fields are skipped (nothing to anchor); this is NOT a drop of a
    real condition -- an absent field never existed as a condition."""
    out: List[SpineConditionText] = []

    entry_seq = strategy.get("entry_sequence") or []
    if isinstance(entry_seq, list):
        for i, step in enumerate(entry_seq):
            if not isinstance(step, dict):
                continue
            action = step.get("action")
            if isinstance(action, str) and action.strip():
                out.append(SpineConditionText(f"entry_sequence[{i}].action", action, strategy_index))
            rationale = step.get("rationale")
            if isinstance(rationale, str) and rationale.strip():
                out.append(SpineConditionText(f"entry_sequence[{i}].rationale", rationale, strategy_index))

    confluences = strategy.get("confluences") or []
    if isinstance(confluences, list):
        for i, c in enumerate(confluences):
            if not isinstance(c, dict):
                continue
            desc = c.get("description")
            if isinstance(desc, str) and desc.strip():
                out.append(SpineConditionText(f"confluences[{i}].description", desc, strategy_index))

    stop = strategy.get("stop")
    if isinstance(stop, dict):
        rationale = stop.get("rationale")
        if isinstance(rationale, str) and rationale.strip():
            out.append(SpineConditionText("stop.rationale", rationale, strategy_index))

    targets = strategy.get("targets") or []
    if isinstance(targets, list):
        for i, t in enumerate(targets):
            if not isinstance(t, dict):
                continue
            rationale = t.get("rationale")
            if isinstance(rationale, str) and rationale.strip():
                out.append(SpineConditionText(f"targets[{i}].rationale", rationale, strategy_index))

    stop_mgmt = strategy.get("stop_management")
    if isinstance(stop_mgmt, str) and stop_mgmt.strip():
        out.append(SpineConditionText("stop_management", stop_mgmt, strategy_index))

    return out


def _tier1_surface_signature(result) -> frozenset:
    """ADDENDUM 4 FIX 1: the set of surface_class values a `Tier1Result`
    fired (empty iff silent/fall-through) -- the dual-read agreement gate's
    comparison unit. Order-independent by design: what matters is WHICH
    classes fired, not detection order or count. Two silent reads compare
    equal (both empty frozensets) -- "both fire the SAME surface_class, OR
    both are silent/fallthrough" (Addendum 4) is exactly set equality here."""
    return frozenset(d.surface_class for d in result.detections)


# --------------------------------------------------------------------------- #
# ADDENDUM 5 AXIS 2 -- content-word overlap floor. PARITY-FIXTURED (not
# REUSED-by-import -- extraction-coverage-gate.ts is TypeScript, no Python
# import target exists, same ledger precedent as
# `compile_lints.f2_coverage_gate`) against `src/server/lib/extraction-
# coverage-gate.ts`'s `normalize()` (lines 120-130) + `contentTokens()`
# (lines 142-149) + `STOPWORDS` (lines 56-64) -- the F-2 authority's OWN
# tokenizer + stopword/content-word definition, mirrored WHOLE (Addendum 5:
# "single authority, WHOLE definition... NO second tokenizer, NO new
# stopword list" -- duplicate-enforcement is a named liability). See
# `test_axis2_content_tokens_parity_with_ts_f2` for the hand-traced,
# byte-for-byte-behavior parity proof against this exact TS source.
# --------------------------------------------------------------------------- #

# Verbatim copy of extraction-coverage-gate.ts's STOPWORDS Set literal
# (lines 56-64) -- "your" appears twice in the TS source (harmless
# duplicate in a Set); a frozenset naturally dedupes it here too.
_TS_F2_STOPWORDS = frozenset(
    {
        "that", "this", "with", "from", "into", "your", "yours", "have", "will", "they", "them",
        "their", "then", "than", "when", "what", "which", "where", "here", "there", "over", "under",
        "about", "just", "like", "been", "does", "gonna", "wanna", "really", "actually",
        "simple", "simply", "because", "these", "those", "such", "each", "every", "also", "very",
        "more", "most", "some", "many", "want", "need", "make", "makes", "made", "going", "look",
        "looking", "would", "could", "should", "still", "even", "only", "always", "never", "after",
        "before", "while", "right", "okay", "guys", "video", "transcript", "speaker",
    }
)

_TS_F2_DASH_UNDERSCORE_RE = re.compile(r"[-_]")
_TS_F2_DIGIT_THEN_LETTER_RE = re.compile(r"(\d)([a-z])")
_TS_F2_LETTER_THEN_DIGIT_RE = re.compile(r"([a-z])(\d)")
_TS_F2_WHITESPACE_RE = re.compile(r"\s+")


def _ts_f2_normalize(s: str) -> str:
    """PARITY-FIXTURED mirror of `normalize()`, extraction-coverage-gate.ts
    lines 120-130 -- same four operations, same order: lowercase ->
    dash/underscore -> space -> split digit/letter boundaries in BOTH
    directions (so "4hour" -> "4 hour", matching that file's own FIX 8
    comment) -> collapse whitespace -> trim. Note this does NOT strip other
    punctuation (a trailing period stays glued to the last word, e.g.
    "retested." -- the TS authority does this too; this mirror does not
    "improve" on it, per Addendum 5's whole-definition-reuse rule."""
    out = s.lower()
    out = _TS_F2_DASH_UNDERSCORE_RE.sub(" ", out)
    out = _TS_F2_DIGIT_THEN_LETTER_RE.sub(r"\1 \2", out)
    out = _TS_F2_LETTER_THEN_DIGIT_RE.sub(r"\1 \2", out)
    out = _TS_F2_WHITESPACE_RE.sub(" ", out)
    return out.strip()


def content_tokens(s: str) -> frozenset:
    """PARITY-FIXTURED mirror of `contentTokens()`, extraction-coverage-
    gate.ts lines 142-149 -- the axis-2 content-word overlap floor's sole
    tokenizer. A token is content-bearing iff (len>=4 AND not a stopword)
    OR (contains a digit AND len>=2) -- numbers/short numeric-bearing forms
    ("50", "tp1") are content-bearing by the SAME digit carve-out the TS
    authority uses. HONESTY NOTE (not a divergence -- a literal read of the
    cited TS source): a purely-alphabetic 3-letter token such as "sma" is
    EXCLUDED by this SAME rule in the TS authority itself (len>=4 required
    for non-numeric tokens) -- this mirror does not special-case short
    symbol names beyond what `contentTokens()` literally does, since
    inventing a third bucket here would itself be the "new stopword/content
    list" Addendum 5 forbids ("single authority, WHOLE definition")."""
    out = set()
    for w in _ts_f2_normalize(s).split(" "):
        if not w:
            continue
        is_numeric = any(ch.isdigit() for ch in w)
        if ((len(w) >= 4) or (is_numeric and len(w) >= 2)) and w not in _TS_F2_STOPWORDS:
            out.add(w)
    return frozenset(out)


@dataclass
class UnanchoredCondition:
    """Clause 4: a spine condition the anchor-locator (Addendum 3) could NOT
    ground in the full transcript -- either it declined (no grounding
    exists) or its proposal failed the mechanical literal-substring verify
    (hallucination). This is a FIDELITY FAILURE IN THE MEASUREMENT, recorded
    honestly -- never dropped, never patched with a fuzzy match. `reason`
    carries the locator's own machine-readable cause
    (`anchor_locator.REASON_LOCATOR_DECLINED` /
    `anchor_locator.REASON_NOT_LITERAL_SUBSTRING`) for clause-5 diagnostics
    -- it never changes which single diagnosis CATEGORY this condition
    counts against (`unanchored`, clause 5's own name for the bucket)."""

    condition_ref: str
    text: str
    strategy_index: int = 0
    reason: Optional[str] = None


def locate_condition_anchors(
    conditions: List[SpineConditionText],
    full_transcript: str,
    propose_fn: Optional[Callable[[str, str], Optional[str]]] = None,
) -> Tuple[List[Tuple[SpineConditionText, al.AnchorResult]], List[UnanchoredCondition]]:
    """Partition every spine condition into (anchored, unanchored) using the
    ADDENDUM-3 anchor-locator (`anchor_locator.locate_anchor`) as the sole
    anchor source -- NOT an exact-substring search of the condition's OWN
    text (that premise was false, see the module's superseded-finding note
    above). `propose_fn` threads through to `locate_anchor` unchanged
    (defaults to the real gemma call; tests inject a stub so no unit test
    ever touches the network -- same birth-gate discipline anchor_locator.py
    itself documents). Pure/deterministic ONLY when `propose_fn` is
    deterministic -- the real default is not, by construction (gemma).
    `len(conditions) == len(anchored) + len(unanchored)` always -- this
    partition is total (every condition ends up in exactly one bucket),
    which is half of clause 3(b)'s non-drop invariant; the other half
    (every ANCHORED condition gets a tier-1 outcome) is enforced in
    `prepare_strategy`. Each condition is located with exactly ONE
    `locate_anchor` call -- callers must never re-locate the same condition
    a second time (an anchor_report built from a SECOND call could disagree
    with the certificate's own anchors under gemma's non-determinism;
    `extractor_anchor_availability_report` below takes the already-computed
    (anchored, unanchored) partition for exactly this reason)."""
    anchored: List[Tuple[SpineConditionText, al.AnchorResult]] = []
    unanchored: List[UnanchoredCondition] = []
    for cond in conditions:
        result = al.locate_anchor(full_transcript, cond.text, propose_fn=propose_fn)
        if result.located:
            anchored.append((cond, result))
        else:
            unanchored.append(
                UnanchoredCondition(cond.condition_ref, cond.text, cond.strategy_index, reason=result.reason)
            )
    return anchored, unanchored


def extractor_anchor_availability_report(
    conditions: List[SpineConditionText],
    anchored: List[Tuple[SpineConditionText, al.AnchorResult]],
    unanchored: List[UnanchoredCondition],
) -> dict:
    """Diagnostic-only (never gates anything): reports what fraction of this
    strategy's spine conditions the anchor-locator actually grounds, split
    by source field, plus a breakdown of WHY unanchored conditions failed
    (clause-5 sub-reason diagnostics). Takes the already-computed
    (anchored, unanchored) partition rather than re-locating -- see
    `locate_condition_anchors`'s docstring for why a second locator call
    per condition would be both wasteful (real gemma cost) and unsound
    (non-determinism could desync this report from the certificate)."""
    by_field: Dict[str, Dict[str, int]] = {}
    for cond in conditions:
        field_name = re.sub(r"\[\d+\]", "[]", cond.condition_ref)
        by_field.setdefault(field_name, {"anchored": 0, "unanchored": 0})
    for cond, _result in anchored:
        field_name = re.sub(r"\[\d+\]", "[]", cond.condition_ref)
        by_field[field_name]["anchored"] += 1
    unanchored_reason_breakdown: Dict[str, int] = {}
    for u in unanchored:
        field_name = re.sub(r"\[\d+\]", "[]", u.condition_ref)
        by_field[field_name]["unanchored"] += 1
        reason_key = u.reason or "unknown"
        unanchored_reason_breakdown[reason_key] = unanchored_reason_breakdown.get(reason_key, 0) + 1
    total = len(conditions)
    return {
        "total_spine_conditions": total,
        "anchored_count": len(anchored),
        "unanchored_count": len(unanchored),
        "anchored_fraction": round(len(anchored) / total, 4) if total else None,
        "by_field": by_field,
        "unanchored_reason_breakdown": unanchored_reason_breakdown,
    }


# --------------------------------------------------------------------------- #
# Extractor version pin (Addendum 2 clause 1)
# --------------------------------------------------------------------------- #


def extractor_version_pin(root: str = _ROOT) -> str:
    """Clause 1: extractor version-pinned + FROZEN for the pilot. Content-
    hashes the ACTIVE production extractor prompt+schema pair -- mirrors
    model-router.ts's own TRANSCRIPT_EXTRACTOR_USE_LEGACY selector
    (loadTranscriptOutputSchema / getTranscriptExtractorPromptPath,
    model-router.ts ~2309-2340) so this pin always names whichever files
    ACTUALLY drove the extraction, not a hardcoded guess. A content hash is
    a STRONGER pin than a bare git SHA: a SHA also changes on commits that
    never touch these two files, while this hash changes iff and only if
    extractor BEHAVIOR (prompt or schema) changed. Deterministic, no I/O
    side effects, stdlib-only (no subprocess -- keeps this module's
    non-adjudicator source-scan simple to reason about)."""
    use_legacy = os.environ.get("TRANSCRIPT_EXTRACTOR_USE_LEGACY", "false").strip().lower() == "true"
    prompt_rel = (
        "src/agents/transcript-extractor.md"
        if use_legacy
        else "src/agents/transcript-extractor-minimal.md"
    )
    schema_rel = (
        "src/agents/kb/transcript-extractor-output-schema.json"
        if use_legacy
        else "src/agents/kb/transcript-extractor-minimal-schema.json"
    )
    h = hashlib.sha256()
    for rel in (prompt_rel, schema_rel):
        path = os.path.join(root, rel)
        try:
            with open(path, "rb") as fh:
                h.update(fh.read())
        except OSError:
            h.update(b"<missing:" + rel.encode("utf-8") + b">")
    content_hash = h.hexdigest()[:16]
    mode = "legacy-v12-speaker-concepts" if use_legacy else "minimal-8field-pass-l"
    model_name = os.environ.get("TRANSCRIPT_EXTRACTOR_LOCAL_MODEL", "gemma4:e4b-it-qat")
    return f"{model_name}:{mode}:content-{content_hash}"


# --------------------------------------------------------------------------- #
# Blinding leak-scan (PARITY-FIXTURED against the Wave-1 blinding_contract)
# UNCHANGED from the band-6 landing.
# --------------------------------------------------------------------------- #

_ALLOWED_ITEM_KEYS = {
    "item_id",
    "video_id",
    "concept_id",
    "family",
    "timeframe",
    "extracted_condition_type",
    "extracted_object",
    "quote_anchor",
    "needs_dual_anchor",
    "english_gloss",
    "rater_response",
    # ADDENDUM 5 AXIS 3: the sampling-audit tag. Present ONLY on the (at
    # most one) audit item `_build_tier3_packet` appends -- a structural
    # marker (True), never condition-specific content, so allow-listing it
    # cannot open a blinding leak the way a new content field would.
    "audit",
}
_ALLOWED_RATER_RESPONSE_KEYS = {"role", "notes"}
_ALLOWED_QUOTE_ANCHOR_KEYS = {"language", "verbatim"}

_FORBIDDEN_TOKENS = (
    "demotion",
    "dri",
    "verdict",
    "rationale",
    "tally",
    "outcome",
    "class_distribution",
    "is_control",
    "control_answer",
    "answer_key",
    "ground_truth",
    "gold_label",
    "expected_role",
    "correct_role",
    "control_gate_item_ids",
)


@dataclass
class LeakScanResult:
    clean: bool
    violations: List[str] = field(default_factory=list)


class LeakScanFailure(Exception):
    def __init__(self, video_id: str, violations: List[str]):
        self.video_id = video_id
        self.violations = violations
        super().__init__(f"blinding leak-scan FAILED for video={video_id}: {violations}")


def blinding_leak_scan(packet: dict) -> LeakScanResult:
    """House-standard leak-scan, run BEFORE any tier-3 packet is dispatched
    (pilot pre-reg §3). THREE independent checks, any of which can fire
    (check 3 added by ADDENDUM 4 FIX 2 -- same scanner, extended, never
    forked):

      1. STRUCTURAL: every item in every `sections[*].items` entry, its
         `rater_response`, and its `quote_anchor` must use ONLY the
         allowlisted keys, and `rater_response.role`/`.notes` must both be
         null (a pre-filled answer is itself a leak).
      2. LEXICAL: none of `_FORBIDDEN_TOKENS` may appear (case-insensitive)
         anywhere in the serialized `sections` content.
      3. STAGE-2 LEAK (Addendum 4 FIX 2): the mechanical proof that the
         Stage-1 (blind) view is free of Stage-2 (revealed) condition
         CONTENT -- i.e. that a Set-B item never carries ITS OWN condition
         text as a SEPARATE field the way `extracted_condition_type`/
         `extracted_object` used to (that is exactly the F-5 blinding this
         file already enforces for those two, now extended to the newly-
         introduced condition text). For each stage2 item, its
         `extracted_condition_text` may not appear anywhere in the SAME-
         item_id Set-B item's own JSON EXCEPT inside that item's own
         `quote_anchor.verbatim`. Deliberately SAME-ITEM-SCOPED, not
         packet-wide: (a) excluding just that one field (not the whole
         item) is required because a well-grounded anchor's quote is
         FREQUENTLY byte-for-byte identical to the condition it grounds
         (the anchor doing its job, not a leak); (b) scoping the comparison
         to the SAME item only (not every other item too) is required
         because two DIFFERENT conditions can coincidentally share a
         transcript phrase (one condition's own text can legitimately equal
         a different item's quote) without either item's blinding being
         compromised -- a blind rater never sees which item_ids share an
         extractor-side association. This only fires if a condition's own
         text turns up somewhere ELSE within its OWN Set-B item (a
         duplicated/leaked field on that same item). Also flags a
         pre-filled Stage-2 `adjudication_response` (mirrors check 1's
         rater_response leg).

    Silent (clean=True, violations=[]) on a packet with none. Fires
    (clean=False) on any. Never raises -- callers decide whether to refuse
    emission (`prepare_strategy` does)."""
    violations: List[str] = []
    sections = packet.get("sections", [])

    serialized = json.dumps(sections, default=str).lower()
    for tok in _FORBIDDEN_TOKENS:
        if tok in serialized:
            violations.append(f"forbidden_token:{tok}")

    items_by_id: Dict[str, dict] = {}
    for section in sections:
        for item in section.get("items", []):
            item_id = item.get("item_id", "<unknown>")
            items_by_id[item_id] = item
            extra = set(item.keys()) - _ALLOWED_ITEM_KEYS
            if extra:
                violations.append(f"forbidden_item_keys:{item_id}:{sorted(extra)}")
            rr = item.get("rater_response")
            if isinstance(rr, dict):
                extra_rr = set(rr.keys()) - _ALLOWED_RATER_RESPONSE_KEYS
                if extra_rr:
                    violations.append(f"forbidden_rater_response_keys:{item_id}:{sorted(extra_rr)}")
                if rr.get("role") is not None or rr.get("notes") is not None:
                    violations.append(f"prefilled_rater_response:{item_id}")
            qa = item.get("quote_anchor")
            if isinstance(qa, dict):
                extra_qa = set(qa.keys()) - _ALLOWED_QUOTE_ANCHOR_KEYS
                if extra_qa:
                    violations.append(f"forbidden_quote_anchor_keys:{item_id}:{sorted(extra_qa)}")

    for item in packet.get("stage2", {}).get("items", []):
        item_id = item.get("item_id", "<unknown>")
        cond_text = (item.get("extracted_condition_text") or "").strip()
        if cond_text:
            target = items_by_id.get(item_id)
            if target is not None:
                scoped = _item_json_excluding_quote(target)
                if cond_text.lower() in scoped:
                    violations.append(f"stage2_leak:{item_id}")
        resp = item.get("adjudication_response")
        if isinstance(resp, dict) and (
            resp.get("support") is not None or resp.get("support_justification") is not None
        ):
            violations.append(f"prefilled_stage2_response:{item_id}")

    return LeakScanResult(clean=not violations, violations=violations)


def _item_json_excluding_quote(item: dict) -> str:
    """Helper for leak-scan check 3: serialize ONE Set-B item with its own
    `quote_anchor.verbatim` blanked out -- every other field of THIS item
    stays in scope. This is what lets the Stage-2 leak check tell "the
    anchor legitimately quotes the condition" (excluded, not a leak) apart
    from "the condition text turned up somewhere else on this SAME item" (a
    real leak)."""
    redacted = json.loads(json.dumps(item, default=str))
    qa = redacted.get("quote_anchor")
    if isinstance(qa, dict):
        qa["verbatim"] = ""
    return json.dumps(redacted, default=str).lower()


# --------------------------------------------------------------------------- #
# Tier-3 packet assembly (Wave-1 shape, Set-A REUSED verbatim) -- item_id
# namespacing extended with a strategy index (a video can now yield MULTIPLE
# strategies, each needing its own certificate, per cert_assembler.py's own
# "ONE certificate per extracted strategy" docstring contract).
# --------------------------------------------------------------------------- #


def _load_wave1_control_section() -> Tuple[dict, str, dict, dict]:
    """Load the REUSED Set-A control section + shared meta text from the
    real Wave-1 packets artifact. Never touches the answer key (verifier-
    only, per that file's own audience note)."""
    d = json.load(open(_WAVE1_PACKETS_PATH, encoding="utf-8"))
    for section in d["sections"]:
        if section["section_id"] == "SET-A":
            return section, d["blinding_contract"], d["closed_taxonomy"], d["instructions"]
    raise RuntimeError(f"SET-A control section not found in {_WAVE1_PACKETS_PATH}")


# --------------------------------------------------------------------------- #
# ADDENDUM 5 AXIS 3 -- tier-3 idle-budget sampling audit. Makes the NAMED
# RESIDUAL (same-surface, shared-vocabulary, different-rule mis-grounding --
# see the module docstring's ADDENDUM 5 section) statistically visible,
# since no honest mechanical floor closes it without becoming a semantic
# classifier in mechanical costume. NOT a gate -- a monitor.
# --------------------------------------------------------------------------- #

AXIS3_ADJUDICATION_CEILING_DEFAULT = 15


def axis3_adjudication_ceiling() -> int:
    """The pre-reg §1 ~15-adjudications/video affordability ceiling, as a
    named parameter (never a magic 15 sprinkled at call sites). Env-
    overridable (`H1_PILOT_AXIS3_CEILING`) for pilot-config tuning;
    `prepare_strategy`'s own `axis3_ceiling` kwarg overrides this per-call
    (e.g. tests exercising the ceiling-exhausted branch without touching
    the environment). Falls back to the default on a missing or
    non-integer env value -- a malformed override must never crash the
    conveyor."""
    raw = os.environ.get("H1_PILOT_AXIS3_CEILING")
    if raw is None:
        return AXIS3_ADJUDICATION_CEILING_DEFAULT
    try:
        return int(raw)
    except ValueError:
        return AXIS3_ADJUDICATION_CEILING_DEFAULT


def _axis3_seed(video_id: str, strategy_index: int) -> int:
    """ADDENDUM 5 AXIS-3 determinism (clause 2, non-negotiable): the
    audit-selection RNG is seeded from (video_id, strategy_index) -- NEVER
    wall-clock, NEVER unseeded -- so the SAME video (and, within a
    multi-strategy video, the SAME strategy) against the SAME candidate
    pool always selects the SAME audited fire on every replay. sha256 over
    the identifiers (not Python's built-in `hash()`, which is randomized
    per-process via PYTHONHASHSEED unless explicitly disabled) keeps the
    seed reproducible across processes/machines, not just within one run."""
    material = f"h1-pilot-axis3::{video_id}::{strategy_index}".encode("utf-8")
    return int(hashlib.sha256(material).hexdigest(), 16)


def _select_axis3_audit_fire(
    video_id: str,
    strategy_index: int,
    fallthrough_count: int,
    classified_spans: List[Tuple[int, int]],
    ceiling: int,
) -> Optional[Tuple[int, int]]:
    """Selects ONE classified tier-1 fire (by char_span) to audit through
    the SAME two-stage packet a genuine fall-through gets. Budget
    accounting (pre-reg §1's affordability ceiling): fall-throughs/
    cannot-determines consume the ~`ceiling` budget FIRST -- returns None
    when `fallthrough_count >= ceiling` (budget already spent; the audit
    only rides IDLE capacity, it never pushes a video over the ceiling) or
    when there is nothing classified to sample from (`classified_spans`
    empty -- nothing to audit is not a failure). `classified_spans` is
    sorted before sampling so the CANDIDATE ORDER itself is deterministic,
    not just the RNG seed (Python set/dict iteration order is stable within
    one process but this keeps the contract explicit and
    process-independent)."""
    if fallthrough_count >= ceiling or not classified_spans:
        return None
    ordered = sorted(classified_spans)
    rng = random.Random(_axis3_seed(video_id, strategy_index))
    return rng.choice(ordered)


_SUPPORT_TAXONOMY = {
    "confirmed": "The quote fully and faithfully expresses this condition -- "
    "a reasonable reader would say the quote IS the trader's own grounding "
    "for it.",
    "partial": "The quote is related to the condition but drifts from it -- "
    "captures only part of it, or generalizes/narrows what the trader "
    "actually said.",
    "denied": "The quote does not express this condition at all -- the "
    "anchor is mis-grounded.",
}


def _build_tier3_packet(
    full_transcript: str,
    video_id: str,
    fallthroughs: List[Tier1FallThrough],
    strategy_index: int = 0,
    condition_text_by_span: Optional[Dict[Tuple[int, int], str]] = None,
    audit_target: Optional[Tuple[Tuple[int, int], str]] = None,
) -> Tuple[dict, Dict[str, Tuple[int, int]]]:
    """Build one TWO-STAGE tier-3 packet for `video_id`'s strategy
    #`strategy_index` (ADDENDUM 4 FIX 2). Returns (packet, item_span_map) --
    the span map is INTERNAL bookkeeping (join key for `finalize_certificate`),
    never placed inside the packet itself.

    ADDENDUM 5 AXIS 3 (`audit_target`, optional): when provided, exactly ONE
    extra Set-B / Stage-2 item is appended for a CLASSIFIED tier-1 fire
    `_select_axis3_audit_fire` chose to audit -- `audit_target` is
    `(char_span, condition_text)` for that fire. This extra item is built
    with the IDENTICAL shape and IDENTICAL blinding discipline as a genuine
    fall-through item (Stage-1 quote-alone, Stage-2 reveals the condition
    text) -- the only difference is a structural `"audit": True` tag (never
    condition-specific content, so it cannot itself leak anything) that
    distinguishes it from a genuine fall-through in both the packet and
    (via `finalize_certificate`'s `axis3_audit` field) the certificate.
    `audit_target=None` (the default) reproduces the pre-Addendum-5 packet
    shape byte-for-byte -- ONLY `prepare_strategy`'s axis-3 selection can
    ever populate this parameter.

    STAGE 1 (`packet["sections"]`, Set A + Set B) -- BLIND, byte-for-byte
    preserved from the pre-Addendum-4 shape: REUSED Set-A controls + a fresh
    Set-B built from this strategy's tier-1 fall-through spans, quote alone,
    `extracted_condition_type`/`extracted_object` still hardcoded None (F-5
    blinding, unchanged). A dispatch handed ONLY `packet["sections"]` sees
    exactly what it always saw.

    STAGE 2 (`packet["stage2"]`) -- REVEALED, a SEPARATE top-level key, never
    nested inside `sections`. Carries, per Set-B item_id, the extractor's OWN
    condition text (`condition_text_by_span`, keyed by the same char_span
    Set-B's `quote_anchor` was sliced from -- empty string if the caller
    passed no mapping for that span, never a KeyError) plus an empty
    `adjudication_response` slot for the support verdict ({support,
    support_justification}, both null until answered -- Stage 2's own
    `blinding_leak_scan` companion check flags a pre-filled one). The
    READ-ORDER LOCK is structural: Stage 2 lives outside `sections`, so a
    Stage-1-only dispatch cannot see it by construction; `stage2.
    read_order_lock` also states the rule for a human/dispatcher reading the
    whole packet. `blinding_leak_scan` (extended, not forked) mechanically
    proves no Stage-2 condition text leaked into the serialized `sections`
    content before this packet may ship."""
    set_a, blinding_contract, closed_taxonomy, instructions = _load_wave1_control_section()
    condition_text_by_span = condition_text_by_span or {}

    target_items: List[dict] = []
    stage2_items: List[dict] = []
    item_span_map: Dict[str, Tuple[int, int]] = {}
    for i, ft in enumerate(fallthroughs):
        item_id = f"{video_id}-S{strategy_index}-B{i:03d}"
        s, e = ft.char_span
        item_span_map[item_id] = (s, e)
        target_items.append(
            {
                "item_id": item_id,
                "video_id": video_id,
                "family": None,
                "timeframe": None,
                "extracted_condition_type": None,
                "extracted_object": None,
                "quote_anchor": {"language": "en", "verbatim": full_transcript[s:e]},
                "rater_response": {"role": None, "notes": None},
            }
        )
        stage2_items.append(
            {
                "item_id": item_id,
                "extracted_condition_text": condition_text_by_span.get((s, e), ""),
                "adjudication_response": {"support": None, "support_justification": None},
            }
        )

    if audit_target is not None:
        (a_s, a_e), audit_condition_text = audit_target
        audit_item_id = f"{video_id}-S{strategy_index}-AUDIT"
        item_span_map[audit_item_id] = (a_s, a_e)
        target_items.append(
            {
                "item_id": audit_item_id,
                "video_id": video_id,
                "family": None,
                "timeframe": None,
                "extracted_condition_type": None,
                "extracted_object": None,
                "quote_anchor": {"language": "en", "verbatim": full_transcript[a_s:a_e]},
                "rater_response": {"role": None, "notes": None},
                "audit": True,
            }
        )
        stage2_items.append(
            {
                "item_id": audit_item_id,
                "extracted_condition_text": audit_condition_text,
                "adjudication_response": {"support": None, "support_justification": None},
                "audit": True,
            }
        )

    packet = {
        "artifact": "h1-pilot-tier3-packet",
        "version": "2026-07-12",
        "purpose": f"Pilot tier-3 blind adjudication packet, video={video_id}, strategy={strategy_index}.",
        "blinding_contract": blinding_contract,
        "closed_taxonomy": closed_taxonomy,
        "instructions": instructions,
        "counts": {"control_items": set_a["item_count"], "target_items": len(target_items)},
        "sections": [
            set_a,
            {
                "section_id": "SET-B",
                "concept_id": None,
                "label": f"Set B -- video {video_id} strategy {strategy_index} tier-1 fall-through "
                "targets (complete AFTER Set A + control-gate)",
                "item_count": len(target_items),
                "items": target_items,
            },
        ],
        "stage2": {
            "read_order_lock": (
                "Stage 2 for an item_id may be read ONLY after Stage 1's "
                "rater_response.role is committed for that same item_id in "
                "Set B. Do not read stage2 before completing Set A + Set B."
            ),
            "task": "Does this quote express THIS condition?",
            "support_taxonomy": _SUPPORT_TAXONOMY,
            "items": stage2_items,
        },
    }
    return packet, item_span_map


# --------------------------------------------------------------------------- #
# Transcript fetch seam (production path documented, NOT implemented here)
# UNCHANGED from the band-6 landing.
# --------------------------------------------------------------------------- #


def fetch_transcript(video_id: str) -> str:  # pragma: no cover - seam only
    """SEAM. Deliberately unimplemented -- glue only, per the Wave-4 brief.

    PRODUCTION PATH (cross-language from this Python module):
      `fetchTranscriptWithRetry(videoId)` in
      `src/server/services/transcript-fetch-queue.ts`, which wraps the
      `youtube-transcript` npm package (+ Google YouTube Data API v3 for
      title/metadata search where needed, CLAUDE.md §2b). Wave 9
      (2026-05-17) removed ScrapingBee / Supadata / ScrapingDog -- do NOT
      reintroduce any VPN/scraper path here or in whatever wires this seam.

    The real pilot run wires this to that Node service (subprocess or HTTP
    bridge; deciding which is itself a small integration task, out of scope
    for this glue build) BEFORE any sealed video's transcript is fetched.
    Raising here (instead of silently returning an empty string) means a
    caller can never accidentally certify an empty transcript."""
    raise NotImplementedError(
        "fetch_transcript is an unwired SEAM. Production path: "
        "fetchTranscriptWithRetry() in src/server/services/transcript-fetch-queue.ts "
        "(youtube-transcript npm + YouTube Data API v3, CLAUDE.md §2b). "
        f"video_id={video_id!r} was not fetched."
    )


# --------------------------------------------------------------------------- #
# Phase 1: prepare_strategy / prepare_video
# --------------------------------------------------------------------------- #


def prepare_strategy(
    strategy: dict,
    full_transcript: str,
    video_id: str,
    extractor_version: str,
    taxonomy_version: str,
    strategy_index: int = 0,
    full_transcript_sha256: Optional[str] = None,
    propose_fn: Optional[Callable[[str, str], Optional[str]]] = None,
    axis3_ceiling: Optional[int] = None,
) -> dict:
    """Phase 1 for ONE extracted strategy (never calls an LLM/agent
    ITSELF -- `propose_fn` is a seam threaded to `anchor_locator.
    locate_anchor`, which owns the one LLM call per condition; this
    function's OWN body dispatches nothing, see
    `test_module_never_calls_an_llm_or_adjudicator`): extract spine
    conditions -> ANCHOR-LOCATE each one (Addendum 3 -- gemma proposes,
    mechanics verify; NOT the extractor's own text taken as a literal
    quote) -> tier-1 ONE CONDITION PER CALL on the LOCATED quote (Addendum
    2's graded contract) -> collect fall-throughs -> blind tier-3 packet ->
    leak-scan gate. Raises `LeakScanFailure` and returns NOTHING usable if
    the packet fails the scan -- the caller must never dispatch a refused
    packet. `propose_fn` defaults to None -> `locate_anchor`'s real gemma
    call; tests inject a stub so no unit test ever touches the network.
    `axis3_ceiling` overrides `axis3_adjudication_ceiling()` for this call
    only (ADDENDUM 5 AXIS 3, e.g. tests exercising the ceiling-exhausted
    branch without touching the environment); defaults to that function's
    env-overridable value.

    Non-drop invariant (clause 3b), enforced structurally here: every spine
    condition ends up in EXACTLY ONE of (unanchored, tier1_detections>=1,
    tier1_fallthroughs==1) -- `len(spine_conditions) == len(unanchored) +
    len(anchored)` by `locate_condition_anchors`'s total partition, and each
    anchored condition gets exactly one `run_tier1` call whose `Tier1Result`
    is, by `tier1_detectors.py`'s own construction, either `fired` (>=1
    detection) XOR carries a `fallthrough` -- never neither, never both.
    ADDENDUM 5 note: a `fired` read additionally needs the AXIS-2 content
    floor to classify -- see the per-condition loop below -- so `fired`
    alone no longer implies `classified_tier1`; it may instead land as
    `fallthrough_axis2_zero_content_overlap`."""
    if full_transcript_sha256 is None:
        full_transcript_sha256 = hashlib.sha256(full_transcript.encode("utf-8")).hexdigest()

    spine_conditions = extract_spine_condition_texts(strategy, strategy_index)
    anchored, unanchored = locate_condition_anchors(spine_conditions, full_transcript, propose_fn=propose_fn)

    tier1_detections: List[Tier1Detection] = []
    tier1_fallthroughs: List[Tier1FallThrough] = []
    condition_outcomes: List[dict] = []
    fallthrough_condition_text: Dict[Tuple[int, int], str] = {}
    classified_condition_text: Dict[Tuple[int, int], str] = {}
    for cond, anchor_result in anchored:
        # ADDENDUM 4 FIX 1 -- dual-read agreement gate. The certificate's
        # eventual quote_anchor/char_span always come from the LOCATED quote
        # (see the module-docstring "ANCHOR WIRING" note -- tier1_detectors'
        # own claim-scoping invariant, not a style choice), but a literal
        # anchor can still be MIS-GROUNDED (a real span that happens to
        # carry tier-1 surface for a DIFFERENT condition). So tier-1 runs
        # TWICE, at zero extra model calls (both calls are pure regex):
        # once on the located quote (the read that can classify), once on
        # the condition's own text (the read that can only VETO). Agreement
        # (same fired surface_class set, including both-silent) -> classify
        # on the located quote's read. Disagreement -> honest fall-through,
        # still carrying the located quote's span.
        span = anchor_result.char_span
        read_quote = run_tier1(anchor_result.quote, char_span=span)
        read_condition = run_tier1(cond.text)
        agree = _tier1_surface_signature(read_quote) == _tier1_surface_signature(read_condition)

        if agree and read_quote.fired:
            # ADDENDUM 5 AXIS 2 -- content-word overlap floor (catch #5,
            # CRITICAL: the dual-read gate above compares surface_class
            # ONLY, so a SAME-surface DIFFERENT-content mis-grounding --
            # e.g. a stop-rule condition mis-grounded onto an entry-rule
            # quote that happens to carry the SAME tier-1 surface --
            # passed as "agreement" and classified carrying the wrong
            # rule's quote, uncaught). A fire classifies ONLY IF,
            # additionally, the located quote shares >=1 content-bearing
            # token (`content_tokens`, PARITY-FIXTURED against the F-2
            # authority) with the condition's OWN text -- GROSS-mismatch
            # semantics: zero shared content tokens means the quote cannot
            # be grounding THIS condition. Zero extra model calls (pure
            # token-set intersection).
            if content_tokens(anchor_result.quote) & content_tokens(cond.text):
                tier1_detections.extend(read_quote.detections)
                # Keyed by each DETECTION's OWN char_span (not the located
                # anchor's full span, `span`) -- a detector's fired anchor
                # is frequently a NARROWER sub-phrase of the full located
                # quote, and `cert["conditions"]` entries for
                # classifying_tier==1 are built from `Tier1Detection.
                # char_span` (cert_assembler.py), not from `span`. Axis 3
                # must sample from spans that actually appear as
                # classified condition entries on the certificate, or its
                # "shown covered on the certificate" claim would be false.
                for d in read_quote.detections:
                    classified_condition_text[d.char_span] = cond.text
                condition_outcomes.append({"condition_ref": cond.condition_ref, "outcome": "classified_tier1", "char_span": list(span)})
            else:
                # AXIS 2 FLOOR FAILS -- honest fall-through to tier-3,
                # still carrying the LOCATED quote's span (same precedent
                # as the disagreement branch below).
                ft = Tier1FallThrough(char_span=span)
                tier1_fallthroughs.append(ft)
                fallthrough_condition_text[span] = cond.text
                condition_outcomes.append({"condition_ref": cond.condition_ref, "outcome": "fallthrough_axis2_zero_content_overlap", "char_span": list(span)})
        elif agree:
            # both silent -- the ordinary tier-1-silent fall-through, unchanged.
            assert read_quote.fallthrough is not None  # tier1_detectors.py guarantee
            tier1_fallthroughs.append(read_quote.fallthrough)
            fallthrough_condition_text[read_quote.fallthrough.char_span] = cond.text
            condition_outcomes.append({"condition_ref": cond.condition_ref, "outcome": "fallthrough_pending_tier3", "char_span": list(span)})
        else:
            # DISAGREEMENT -- the dual-read veto fires. A mis-grounded-but-
            # literal anchor can no longer classify uncaught; it falls
            # through to tier-3 honestly, carrying the LOCATED quote's span
            # (never cond.text's -- cond.text's own char_span is local/
            # irrelevant, see run_tier1(cond.text) above, no char_span kwarg).
            ft = Tier1FallThrough(char_span=span)
            tier1_fallthroughs.append(ft)
            fallthrough_condition_text[span] = cond.text
            condition_outcomes.append({"condition_ref": cond.condition_ref, "outcome": "fallthrough_dual_read_disagreement", "char_span": list(span)})

    # clause 3(b) non-drop invariant, asserted structurally (also covered by
    # a dedicated regression test in test_pilot_conveyor.py).
    assert len(spine_conditions) == len(unanchored) + len(condition_outcomes), (
        "non-drop invariant violated: a spine condition vanished between "
        "extraction and tier-1 classification"
    )

    # ADDENDUM 5 AXIS 3 -- idle-budget sampling audit. Selection happens
    # AFTER the loop (needs the FINAL fallthrough count + the full
    # classified-span pool for this strategy), BEFORE packet assembly (the
    # audit item, if any, is built INTO the same packet the fallthroughs
    # get -- one combined dispatch, never a second packet).
    ceiling = axis3_adjudication_ceiling() if axis3_ceiling is None else axis3_ceiling
    audit_span = _select_axis3_audit_fire(
        video_id, strategy_index, len(tier1_fallthroughs), list(classified_condition_text.keys()), ceiling,
    )
    audit_target = (audit_span, classified_condition_text[audit_span]) if audit_span is not None else None

    packet, item_span_map = _build_tier3_packet(
        full_transcript, video_id, tier1_fallthroughs, strategy_index,
        condition_text_by_span=fallthrough_condition_text,
        audit_target=audit_target,
    )
    scan = blinding_leak_scan(packet)
    if not scan.clean:
        raise LeakScanFailure(video_id=f"{video_id}-S{strategy_index}", violations=scan.violations)

    return {
        "video_id": video_id,
        "strategy_index": strategy_index,
        "full_transcript": full_transcript,
        "spine_condition_count": len(spine_conditions),
        "unanchored_conditions": unanchored,
        "condition_outcomes": condition_outcomes,
        "tier1_detections": tier1_detections,
        "tier1_fallthroughs": tier1_fallthroughs,
        "tier3_packet": packet,
        "item_span_map": item_span_map,
        "leak_scan": scan,
        "anchor_report": extractor_anchor_availability_report(spine_conditions, anchored, unanchored),
        # ADDENDUM 5 AXIS 3: None (char_span) when no fire was audited
        # (nothing classified, or the fallthrough budget was already
        # spent) -- `finalize_certificate` joins this onto the certificate
        # as an ADDITIVE `axis3_audit` field, never a gate.
        "axis3_audit": {
            "char_span": list(audit_span) if audit_span is not None else None,
            "condition_text": classified_condition_text.get(audit_span) if audit_span is not None else None,
            "item_id": f"{video_id}-S{strategy_index}-AUDIT" if audit_span is not None else None,
            "ceiling": ceiling,
            "fallthrough_count_at_selection": len(tier1_fallthroughs),
        },
        "provenance": {
            "source_video_id": video_id,
            "full_transcript_sha256": full_transcript_sha256,
            "extractor_version": extractor_version,
            "taxonomy_version": taxonomy_version,
        },
    }


def prepare_video(
    extracted_output: dict,
    full_transcript: str,
    video_id: str,
    extractor_version: str,
    taxonomy_version: str,
    full_transcript_sha256: Optional[str] = None,
    propose_fn: Optional[Callable[[str, str], Optional[str]]] = None,
) -> List[dict]:
    """Phase 1 for a WHOLE video's extraction output (`{"strategies": [...]}`,
    the production extractor's top-level shape -- see extractor_bridge.py /
    scripts/h1-extract-one.ts). Loops `prepare_strategy` over every extracted
    strategy (cert_assembler.py's own docstring: "ONE certificate per
    extracted strategy") and returns one prep dict per strategy. A video
    with 0 strategies returns an empty list (honest -- nothing to certify,
    not a failure). `propose_fn` threads to every `prepare_strategy` call
    unchanged (same seam, same default-to-real-gemma semantics)."""
    strategies = extracted_output.get("strategies") or []
    return [
        prepare_strategy(
            s,
            full_transcript,
            video_id,
            extractor_version,
            taxonomy_version,
            strategy_index=i,
            full_transcript_sha256=full_transcript_sha256,
            propose_fn=propose_fn,
        )
        for i, s in enumerate(strategies)
        if isinstance(s, dict)
    ]


# --------------------------------------------------------------------------- #
# Rater-response -> Tier3Verdict helper (unchanged from band-6 landing)
# --------------------------------------------------------------------------- #


def verdict_from_rater_response(
    char_span: Tuple[int, int],
    quote_anchor: str,
    role: str,
    control_gate_passed: bool,
) -> Tier3Verdict:
    """Straight field-copy from a blind rater's closed-taxonomy `role`
    answer into a `Tier3Verdict` (surface_class == verdict == role). A
    richer dispatcher may construct `Tier3Verdict` directly instead."""
    return Tier3Verdict(
        char_span=char_span,
        quote_anchor=quote_anchor,
        surface_class=role,
        verdict=role,
        control_gate_passed=control_gate_passed,
    )


# --------------------------------------------------------------------------- #
# ADDENDUM 4 FIX 2 -- Stage-2 support verdict. Kept OUTSIDE cert_assembler.py
# (that module stays consume-only / UNMODIFIED per the Wave-4 brief and the
# READ FIRST note "consume UNMODIFIED") -- `Tier3Verdict` itself gains no new
# field. Joined onto the certificate as POST-PROCESSING in
# `finalize_certificate`, same precedent as the clause-4 unanchored-condition
# injection: keyed by char_span, the same join key `Tier3Verdict` already
# uses against `tier1_fallthroughs`.
# --------------------------------------------------------------------------- #

SUPPORT_VALUES = ("confirmed", "partial", "denied")


@dataclass
class Tier3SupportVerdict:
    """One Stage-2 (revealed) support call: does the located quote express
    the extractor's OWN condition text? `support` is a closed-taxonomy call
    (`SUPPORT_VALUES`); `support_justification` is REQUIRED (Addendum 4 FIX
    2 -- "justification REQUIRED"), never optional the way Stage-1's
    `rater_response.notes` is."""

    char_span: Tuple[int, int]
    support: str
    support_justification: str


def support_verdict_from_stage2_response(
    char_span: Tuple[int, int],
    support: str,
    support_justification: str,
) -> Tier3SupportVerdict:
    """Straight field-copy from a Stage-2 (revealed) rater response into a
    `Tier3SupportVerdict`, mirroring `verdict_from_rater_response`'s shape --
    but REFUSES (raises `ValueError`) an out-of-taxonomy `support` or a
    missing/blank `support_justification`, since Addendum 4 makes the
    justification a hard requirement, not an optional note."""
    if support not in SUPPORT_VALUES:
        raise ValueError(f"support must be one of {SUPPORT_VALUES}, got {support!r}")
    if not support_justification or not support_justification.strip():
        raise ValueError("support_justification is REQUIRED (Addendum 4 FIX 2)")
    return Tier3SupportVerdict(
        char_span=char_span, support=support, support_justification=support_justification
    )


# --------------------------------------------------------------------------- #
# Per-condition failure attribution (Addendum 2 clause 5 -- annotation-tier,
# the §1 bar itself is UNCHANGED by this)
# --------------------------------------------------------------------------- #

DIAGNOSIS_UNANCHORED = "unanchored"
DIAGNOSIS_COVERAGE_MISS = "coverage_miss"
DIAGNOSIS_FALLTHROUGH_UNRESOLVED = "classification_fallthrough_unresolved"
DIAGNOSIS_TIER3_FAIL = "tier3_fail"
DIAGNOSIS_LINT_FAIL = "lint_fail"
DIAGNOSIS_OK = "ok"

_DIAGNOSIS_CATEGORIES = (
    DIAGNOSIS_UNANCHORED,
    DIAGNOSIS_COVERAGE_MISS,
    DIAGNOSIS_FALLTHROUGH_UNRESOLVED,
    DIAGNOSIS_TIER3_FAIL,
    DIAGNOSIS_LINT_FAIL,
    DIAGNOSIS_OK,
)


def diagnose_certificate(
    cert: dict,
    unanchored: List[UnanchoredCondition],
    tier3_verdicts: List[Tier3Verdict],
) -> Dict[str, int]:
    """Clause 5: per-condition failure attribution, rolled up to one
    certificate's diagnosis distribution. Reads `cert` + the runner-local
    `unanchored`/`tier3_verdicts` inputs as DATA -- never re-derives a
    grade, never feeds back into `pilot_grade`/`full_grade` (those stay
    exactly what `finalize_certificate` computed). Categories:
      unanchored                            -- clause 4
      coverage_miss                         -- f2_coverage_gate FAILed
      classification_fallthrough_unresolved -- classifying_tier is None
                                                (no control-gate-passing
                                                tier-3 verdict reached it)
      tier3_fail                            -- a tier-3 verdict reached this
                                                span but failed its own
                                                control gate (dropped by
                                                cert_assembler, counted here)
      tier3_fail is diagnostic-only: a control-gate-FAILED rater's
                                                verdict never enters the
                                                certificate at all (cert_
                                                assembler drops it), so this
                                                count is read from the RAW
                                                tier3_verdicts input, not
                                                from `cert["conditions"]`.
      lint_fail                             -- any compile_integrity lint
                                                actually FAILed (not
                                                NOT_EVALUATED)
      ok                                    -- classified (tier 1 or 3,
                                                anchored, no lint FAIL)
    A single certificate can contribute to multiple categories (e.g. both
    unanchored conditions AND a coverage_miss) -- this is a distribution,
    not a partition."""
    dist: Dict[str, int] = {k: 0 for k in _DIAGNOSIS_CATEGORIES}
    dist[DIAGNOSIS_UNANCHORED] = len(unanchored)

    for c in cert.get("conditions", []):
        if c.get("classifying_tier") in (1, 3):
            dist[DIAGNOSIS_OK] += 1
        elif c.get("surface_class") != "unanchored":
            # classifying_tier is None and this isn't one of the unanchored
            # entries we ourselves injected below -- a real tier-1
            # fall-through that never got a control-gate-passing verdict.
            dist[DIAGNOSIS_FALLTHROUGH_UNRESOLVED] += 1

    dist[DIAGNOSIS_TIER3_FAIL] = sum(1 for v in tier3_verdicts if not v.control_gate_passed)

    ci = cert.get("compile_integrity", {})
    if ci.get("f2_coverage_gate", {}).get("status") == cl.STATUS_FAIL:
        dist[DIAGNOSIS_COVERAGE_MISS] += 1
    for _name, result in ci.items():
        if result.get("status") == cl.STATUS_FAIL:
            dist[DIAGNOSIS_LINT_FAIL] += 1

    return dist


# --------------------------------------------------------------------------- #
# Phase 2: finalize_certificate
# --------------------------------------------------------------------------- #


def finalize_certificate(
    prepare_output: dict,
    tier3_verdicts: List[Tier3Verdict],
    tier3_support: Optional[List[Tier3SupportVerdict]] = None,
    topology: Optional[List[ConditionTopology]] = None,
    or_branches: Optional[List[List[str]]] = None,
    scope_line: Optional[str] = None,
    dry_run: bool = False,
) -> dict:
    """Phase 2 (never calls an LLM/agent -- `tier3_verdicts`/`tier3_support`
    are consumed as DATA, same contract as `cert_assembler.assemble_
    certificate` itself). Joins verdicts to fall-through spans by char_span
    (via `Tier3Verdict.char_span`, exactly as `assemble_certificate` already
    does internally) and returns the pilot-grade certificate.

    CLAUSE 4 POST-PROCESSING (runner-level, NOT a cert_assembler.py edit --
    that module is consume-only per the Wave-4 brief): `assemble_certificate`
    has no knowledge of unanchored conditions (they were never fed to it --
    they have no resolvable char_span to feed). This function injects one
    synthetic condition_entry per unanchored condition (same dict shape
    `cert_assembler._condition_entry` produces: surface_class="unanchored",
    classifying_tier=None, quote_anchor=<the condition's own text, for
    audit>, char_span=[-1,-1] sentinel meaning "not in transcript") so the
    certificate's own `conditions` list is COMPLETE -- Law 7, state it on
    the artifact, not beside it -- and downgrades `pilot_grade`/`full_grade`/
    `certificate_grade` to False whenever ANY unanchored condition exists,
    exactly matching clause 4 ("count against cert-grade"). This is
    POST-PROCESSING of `assemble_certificate`'s pure output, not a
    modification of that module's source.

    ADDENDUM 4 FIX 2 POST-PROCESSING (same precedent, also NOT a
    cert_assembler.py edit): `tier3_support` (optional `Tier3SupportVerdict`
    list, char_span-keyed) is joined onto every tier-3-classified condition
    entry it matches, stamping `adjudication_verdict.support`/`.
    support_justification` -- an ADDITIVE certificate field. A `support` of
    `denied` or `partial` means the located quote does NOT faithfully
    express the extractor's condition -- that condition is downgraded
    (`classifying_tier` reset to None, so `diagnose_certificate` below
    counts it as `classification_fallthrough_unresolved`, exactly "treated
    like an unresolved fall-through for grade purposes" per Addendum 4) and
    forces `pilot_grade`/`full_grade`/`certificate_grade` to False.
    `confirmed` leaves the condition grounded and untouched otherwise. A
    span with no matching `tier3_support` entry (support not yet
    adjudicated) is left exactly as `assemble_certificate` produced it --
    this parameter is additive, never a required gate.

    `dry_run=True` stamps a loud `dry_run` marker (top-level AND inside
    `provenance`) so no synthetic certificate can be mistaken for a real
    one."""
    prov = prepare_output["provenance"]
    cert = assemble_certificate(
        full_transcript=prepare_output["full_transcript"],
        full_transcript_sha256=prov["full_transcript_sha256"],
        source_video_id=prov["source_video_id"],
        extractor_version=prov["extractor_version"],
        taxonomy_version=prov["taxonomy_version"],
        tier1_detections=prepare_output["tier1_detections"],
        tier1_fallthroughs=prepare_output["tier1_fallthroughs"],
        tier3_verdicts=tier3_verdicts,
        topology=topology,
        or_branches=or_branches,
        scope_line=scope_line,
    )

    unanchored: List[UnanchoredCondition] = prepare_output.get("unanchored_conditions", [])
    unanchored_reason_breakdown: Dict[str, int] = {}
    if unanchored:
        for u in unanchored:
            reason_key = u.reason or "unknown"
            unanchored_reason_breakdown[reason_key] = unanchored_reason_breakdown.get(reason_key, 0) + 1
            cert["conditions"].append(
                {
                    "surface_class": "unanchored",
                    "classifying_tier": None,
                    "quote_anchor": u.text,
                    "char_span": [-1, -1],
                    "adjudication_verdict": None,
                    "condition_ref": u.condition_ref,
                    # Addendum 3 clause-5 sub-reason diagnostics (never a
                    # grading input -- see UnanchoredCondition.reason
                    # docstring): which of anchor_locator's two honest
                    # failure modes produced this entry.
                    "anchor_reason": u.reason,
                }
            )
        cert["pilot_grade"] = False
        cert["full_grade"] = False
        cert["certificate_grade"] = False

    support_by_span = {s.char_span: s for s in (tier3_support or [])}
    support_downgraded = False
    if support_by_span:
        for c in cert["conditions"]:
            if c.get("classifying_tier") != 3:
                continue
            sv = support_by_span.get(tuple(c["char_span"]))
            if sv is None:
                continue
            verdict = dict(c.get("adjudication_verdict") or {})
            verdict["support"] = sv.support
            verdict["support_justification"] = sv.support_justification
            c["adjudication_verdict"] = verdict
            if sv.support != "confirmed":
                # Addendum 4: denied/partial is NOT a faithfully-grounded
                # gate -- treat like an unresolved fall-through for grading.
                c["classifying_tier"] = None
                support_downgraded = True
    if support_downgraded:
        cert["pilot_grade"] = False
        cert["full_grade"] = False
        cert["certificate_grade"] = False

    # ADDENDUM 5 AXIS 3 POST-PROCESSING (same precedent as the unanchored-
    # condition injection and the Stage-2 support join above -- NOT a
    # cert_assembler.py edit): join the audited fire's Stage-2 support
    # verdict (if answered -- looked up from the SAME `support_by_span`
    # this function already built, keyed identically by char_span) onto an
    # ADDITIVE `cert["axis3_audit"]` field. Deliberately does NOT touch the
    # audited condition's own `classifying_tier` -- axis 3 is a sampling
    # MONITOR making the named residual statistically visible, never a
    # mechanical gate (Addendum 5: "NOT claimed mechanically closed").
    axis3_audit_in = prepare_output.get("axis3_audit") or {}
    axis3_span = (
        tuple(axis3_audit_in["char_span"]) if axis3_audit_in.get("char_span") is not None else None
    )
    axis3_sv = support_by_span.get(axis3_span) if axis3_span is not None else None
    cert["axis3_audit"] = (
        {
            "item_id": axis3_audit_in.get("item_id"),
            "char_span": list(axis3_span) if axis3_span is not None else None,
            "condition_text": axis3_audit_in.get("condition_text"),
            "support": axis3_sv.support if axis3_sv is not None else None,
            "support_justification": axis3_sv.support_justification if axis3_sv is not None else None,
        }
        if axis3_span is not None
        else None
    )

    cert["strategy_index"] = prepare_output.get("strategy_index", 0)
    cert["unanchored_condition_count"] = len(unanchored)
    cert["unanchored_reason_breakdown"] = unanchored_reason_breakdown
    cert["diagnosis"] = diagnose_certificate(cert, unanchored, tier3_verdicts)
    cert["dry_run"] = dry_run
    cert["provenance"]["dry_run"] = dry_run
    return cert


# --------------------------------------------------------------------------- #
# aggregate
# --------------------------------------------------------------------------- #


def aggregate(certificates: List[dict]) -> dict:
    """Pilot §1 read: cert-grade fraction (pilot_grade True / N) + mean
    tier-3 adjudications/video (against the §1 ~5-9 expected range / ~15
    affordability ceiling -- this function only measures, the ceiling
    comparison is a caller/report-level read, not a gate here). ADDENDUM 2
    clause 5: also rolls up each certificate's `diagnosis` distribution
    into an aggregate `diagnosis_distribution` -- annotation-tier, does not
    change `pilot_grade_fraction`."""
    n = len(certificates)
    pilot_grade_n = sum(1 for c in certificates if c.get("pilot_grade"))
    full_grade_n = sum(1 for c in certificates if c.get("full_grade"))
    adjudications_per_video = [
        sum(1 for cond in c["conditions"] if cond.get("classifying_tier") == 3)
        for c in certificates
    ]
    diagnosis_distribution: Dict[str, int] = {k: 0 for k in _DIAGNOSIS_CATEGORIES}
    for c in certificates:
        for k, v in (c.get("diagnosis") or {}).items():
            diagnosis_distribution[k] = diagnosis_distribution.get(k, 0) + v
    return {
        "n_videos": n,
        "pilot_grade_n": pilot_grade_n,
        "pilot_grade_fraction": round(pilot_grade_n / n, 4) if n else None,
        "full_grade_n": full_grade_n,
        "tier3_adjudications_per_video": adjudications_per_video,
        "mean_tier3_adjudications_per_video": (
            round(sum(adjudications_per_video) / n, 4) if n else None
        ),
        "diagnosis_distribution": diagnosis_distribution,
    }


# --------------------------------------------------------------------------- #
# DRY-RUN proof #1 -- SYNTHETIC extracted strategy (plumbing-only, no LLM
# call anywhere in this function; mirrors the band-6 landing's original
# dry-run shape but over a hand-built extracted-strategy dict instead of a
# raw transcript, since `_segment_transcript` no longer exists to drive one
# from raw text).
# --------------------------------------------------------------------------- #

DRY_RUN_VIDEO_ID = "DRY-RUN-synthetic-v1"

# Sentences lifted verbatim from src/engine/extraction/fixtures/
# tier1_birth_fixtures.json's own confirmed positive/negative fixtures
# (conditional-action, exclusion-contrast, imperative, plus a confirmed
# tier-1-SILENT walkthrough-narration sentence) -- NOT the sealed 16, NOT
# any real fresh transcript. The full transcript is a superset of the
# strategy's own condition text (so the anchored conditions below actually
# resolve) plus one extra narration sentence that is deliberately NOT
# referenced by any condition (a coverage gap -- exercises f2_coverage_gate
# realistically) and one deliberately paraphrased condition text (NOT a
# verbatim substring -- exercises the UNANCHORED path, clause 4).
DRY_RUN_TRANSCRIPT = (
    "Buy from the demand zone when it is retested. "
    "We do have a fair value gap here where price tapped the level before. "
    "Take puts on a VWOP retest, NOT a pre-market low retest. "
    "Set your stop at the low of the hammer. "
    "Now back to the euro dollar chart here."
)

# Hand-built extracted-strategy dict in the minimal-schema SHAPE. Five of
# the six condition fields below are VERBATIM substrings of
# DRY_RUN_TRANSCRIPT (anchored path -- and, of those five, three fire tier-1
# classifications across all three surface classes and two fall through to
# tier-3, exactly mirroring the band-6 landing's original 3-classified/
# 2-fallthrough proof); one (`confluences[0].description`) is NOT a
# transcript substring at all (the realistic default outcome per this
# module's own blocker finding -- exercises the UNANCHORED path, clause 4).
DRY_RUN_EXTRACTED_STRATEGY = {
    "name": "dry_run_synthetic_strategy",
    "higher_timeframe": "5m",
    "direction": "both",
    "entry_sequence": [
        # conditional-action -> classifies tier-1
        {"step": 1, "action": "Buy from the demand zone when it is retested.", "rationale": None},
        # exclusion-contrast -> classifies tier-1
        {"step": 2, "action": "Take puts on a VWOP retest, NOT a pre-market low retest.", "rationale": None},
        # imperative -> classifies tier-1
        {"step": 3, "action": "Set your stop at the low of the hammer.", "rationale": None},
        # narration, no directive verb -> tier-1 SILENT -> falls through to tier-3
        {"step": 4, "action": "We do have a fair value gap here where price tapped the level before.", "rationale": None},
    ],
    "preferred_regime": "any",
    "stop": {"anchor": "swing_low_below_entry", "rationale": None},
    "targets": [
        # narration, no directive verb -> tier-1 SILENT -> falls through to tier-3
        {"priority": 1, "type": "structural", "rationale": "Now back to the euro dollar chart here."},
    ],
    "confluences": [
        {
            "name": "demand_zone_quality_filter",
            # NOT a substring of DRY_RUN_TRANSCRIPT at all (fabricated
            # editorializing text an extractor could plausibly emit).
            # Proves the unanchored path fires honestly even inside a dry
            # run, per this module's blocker finding -- never patched with
            # a fuzzy match.
            "description": "Only take the setup when the demand zone has at least two prior touches.",
        }
    ],
}


def _synthetic_dry_run_propose_fn(transcript: str, condition_text: str) -> Optional[str]:
    """Network-free `propose_fn` stub for `run_dry_run_synthetic` ONLY --
    proposes the condition's OWN text verbatim, mirroring an idealized
    gemma locator that reproduces exactly what it was given. Every
    DRY_RUN_EXTRACTED_STRATEGY condition text is either a genuine verbatim
    substring of DRY_RUN_TRANSCRIPT (five of six -- resolves LOCATED, same
    as the module's pre-Addendum-3 anchored set) or the one deliberately
    fabricated `confluences[0].description` (resolves UNANCHORED via
    `anchor_locator.REASON_NOT_LITERAL_SUBSTRING` -- honestly, not a
    decline, since this stub always proposes something). This keeps
    `run_dry_run_synthetic` a true PLUMBING-ONLY proof: `anchor_locator.
    locate_anchor`'s mechanical VERIFY leg still runs for real (the only
    part that owns the truth); only the PROPOSE leg (the network call) is
    stubbed."""
    return condition_text


def run_dry_run_synthetic() -> dict:
    """PLUMBING-ONLY dry run: hand-built extracted-strategy dict (no LLM
    call anywhere in this function -- `_synthetic_dry_run_propose_fn` stubs
    the locator's PROPOSE leg; its VERIFY leg is real) -> prepare_strategy
    -> [synthetic verdicts] -> finalize_certificate. Proves the two-phase
    glue + leak-scan + clause-4 unanchored-downgrade end-to-end without
    touching the local model runtime. See `run_dry_run_real_extractor`
    (extractor_bridge.py) for the REQUIRED real-extractor AND real-locator
    proof (Wave-4 brief's dry-run bonus)."""
    prep = prepare_strategy(
        DRY_RUN_EXTRACTED_STRATEGY,
        DRY_RUN_TRANSCRIPT,
        DRY_RUN_VIDEO_ID,
        extractor_version="pilot-conveyor-dry-run-synthetic-v1",
        taxonomy_version="h1-pilot-2026-07-12",
        propose_fn=_synthetic_dry_run_propose_fn,
    )

    # Positive leak-scan proof: poison a COPY of the real packet and confirm
    # the scan fires (fires-on-positive). The real packet already cleared
    # the scan inside prepare_strategy (silent-on-negative) or this call
    # would have raised LeakScanFailure already.
    poisoned = json.loads(json.dumps(prep["tier3_packet"]))
    if poisoned["sections"][-1]["items"]:
        poisoned["sections"][-1]["items"][0]["demotion_role_5class"] = "OPTIONAL"
    positive_scan = blinding_leak_scan(poisoned)
    if prep["tier3_packet"]["sections"][-1]["items"]:
        assert not positive_scan.clean, "leak-scan birth-gate: FAILED to fire on an injected leak"
    assert prep["leak_scan"].clean, "leak-scan birth-gate: the real dry-run packet was not clean"

    verdicts: List[Tier3Verdict] = []
    for i, ft in enumerate(prep["tier1_fallthroughs"]):
        role = "context" if i % 2 == 0 else "gate-strength"
        verdicts.append(
            verdict_from_rater_response(
                char_span=ft.char_span,
                quote_anchor=DRY_RUN_TRANSCRIPT[ft.char_span[0] : ft.char_span[1]],
                role=role,
                control_gate_passed=True,
            )
        )

    cert = finalize_certificate(prep, verdicts, dry_run=True)

    return {
        "artifact": "h1-pilot-conveyor-DRY-RUN-synthetic",
        "dry_run": True,
        "video_id": DRY_RUN_VIDEO_ID,
        "anchor_report": prep["anchor_report"],
        "prepare_leak_scan": {"clean": prep["leak_scan"].clean, "violations": prep["leak_scan"].violations},
        "leak_scan_positive_proof": {
            "clean": positive_scan.clean,
            "violations": positive_scan.violations,
        },
        "certificate": cert,
    }


def write_dry_run_artifact(result: dict, out_dir: str) -> str:
    """Writes `result` (from `run_dry_run_synthetic` or
    `run_dry_run_real_extractor`) to a filename that ALWAYS contains
    "DRY-RUN" -- non-negotiable per the pilot brief, so no future reader can
    mistake a synthetic certificate for a real one. Returns the written
    path."""
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"h1-pilot-DRY-RUN-cert-{result['video_id']}.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2, default=str)
    return path


def main() -> None:  # pragma: no cover - manual invocation
    result = run_dry_run_synthetic()
    out_dir = os.path.join(_ROOT, "docs", "replay-results", "h1-scripts", "dry-run-output")
    path = write_dry_run_artifact(result, out_dir)
    cert = result["certificate"]
    print(f"DRY-RUN certificate written: {path}")
    print(f"  pilot_grade={cert['pilot_grade']}  full_grade={cert['full_grade']}  dry_run={cert['dry_run']}")
    print(f"  unanchored_condition_count={cert['unanchored_condition_count']}")
    print(f"  leak_scan clean(prepare)={result['prepare_leak_scan']['clean']}  "
          f"fires_on_positive={not result['leak_scan_positive_proof']['clean']}")


if __name__ == "__main__":  # pragma: no cover
    main()
