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
     LOCATED transcript text), NOT the extractor's `cond.text` (its
     paraphrase). This is NOT a free choice -- tier1_detectors.detect_tier1
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

KNOWN GAP -- CATCH #4 (independent grade 2026-07-12, finding F-2026-07-12-A,
CRITICAL, UNSEAL-BLOCKING, pending operator ruling). Addendum 3 §4 claims
"anchor-SUPPORTS-condition stays tier-3's job -- a mislocated-but-literal
anchor is caught by the rater." That safety property does NOT hold as wired:
(1) a mis-grounded-but-literal anchor whose quote happens to carry tier-1
surface FIRES at tier-1 and is counted OK -- tier-1 fires never enter
`_build_tier3_packet` (which only receives fall-throughs), so nothing audits
the fire path; (2) even on the fall-through path `_build_tier3_packet`
hardcodes `extracted_condition_type`/`extracted_object` to None and raters
judge role "from the quote alone", never seeing the condition -- so no
anchor-supports-condition comparison happens anywhere. The located-quote
classification DIRECTION is correct + operator-endorsed (measuring the
trader's surface, not our paraphrase -- reverting to condition text is the
worse harbor); the open question is span-choice INTEGRITY only. Pre-committed
lean fix (operator): dual-read agreement gate -- run the DETERMINISTIC tier-1
detectors on BOTH the condition text AND the located quote at zero extra
calls; agreement -> classify, disagreement -> honest fall-through to tier-3
(two-path law compiled in, fails toward suspicion per item). DO NOT read a
pilot cert-grade number as "faithful condition classification" until this is
resolved -- as wired it measures "extractor + locator-groundability +
tier-1 surface-detection." The sealed 16 stay sealed until the ruling lands.

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

LEAK-SCAN / CONTROL-SET-REUSE / TRANSCRIPT-FETCH-SEAM notes: UNCHANGED from
the band-6 landing; see `blinding_leak_scan`, `_build_tier3_packet`,
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
    (pilot pre-reg §3). Two independent checks, either of which can fire:

      1. STRUCTURAL: every item in every `sections[*].items` entry, its
         `rater_response`, and its `quote_anchor` must use ONLY the
         allowlisted keys, and `rater_response.role`/`.notes` must both be
         null (a pre-filled answer is itself a leak).
      2. LEXICAL: none of `_FORBIDDEN_TOKENS` may appear (case-insensitive)
         anywhere in the serialized `sections` content.

    Silent (clean=True, violations=[]) on a packet with neither. Fires
    (clean=False) on either. Never raises -- callers decide whether to
    refuse emission (`prepare_strategy` does)."""
    violations: List[str] = []

    serialized = json.dumps(packet.get("sections", []), default=str).lower()
    for tok in _FORBIDDEN_TOKENS:
        if tok in serialized:
            violations.append(f"forbidden_token:{tok}")

    for section in packet.get("sections", []):
        for item in section.get("items", []):
            item_id = item.get("item_id", "<unknown>")
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

    return LeakScanResult(clean=not violations, violations=violations)


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


def _build_tier3_packet(
    full_transcript: str,
    video_id: str,
    fallthroughs: List[Tier1FallThrough],
    strategy_index: int = 0,
) -> Tuple[dict, Dict[str, Tuple[int, int]]]:
    """Build one blind tier-3 packet for `video_id`'s strategy #`strategy_index`:
    REUSED Set-A controls + a fresh Set-B built from this strategy's tier-1
    fall-through spans. Returns (packet, item_span_map) -- the span map is
    INTERNAL bookkeeping (join key for `finalize_certificate`), never placed
    inside the packet itself (char_span is not something a blind rater
    needs, and keeping it out of the rater-facing artifact keeps the
    leak-scan's allowlist simple)."""
    set_a, blinding_contract, closed_taxonomy, instructions = _load_wave1_control_section()

    target_items: List[dict] = []
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

    Non-drop invariant (clause 3b), enforced structurally here: every spine
    condition ends up in EXACTLY ONE of (unanchored, tier1_detections>=1,
    tier1_fallthroughs==1) -- `len(spine_conditions) == len(unanchored) +
    len(anchored)` by `locate_condition_anchors`'s total partition, and each
    anchored condition gets exactly one `run_tier1` call whose `Tier1Result`
    is, by `tier1_detectors.py`'s own construction, either `fired` (>=1
    detection) XOR carries a `fallthrough` -- never neither, never both."""
    if full_transcript_sha256 is None:
        full_transcript_sha256 = hashlib.sha256(full_transcript.encode("utf-8")).hexdigest()

    spine_conditions = extract_spine_condition_texts(strategy, strategy_index)
    anchored, unanchored = locate_condition_anchors(spine_conditions, full_transcript, propose_fn=propose_fn)

    tier1_detections: List[Tier1Detection] = []
    tier1_fallthroughs: List[Tier1FallThrough] = []
    condition_outcomes: List[dict] = []
    for cond, anchor_result in anchored:
        # tier-1 classifies the LOCATED QUOTE, not cond.text -- see the
        # module-docstring "ANCHOR WIRING" note for why this is required
        # (tier1_detectors.py's own claim-scoping invariant) and not merely
        # a style choice.
        span = anchor_result.char_span
        result = run_tier1(anchor_result.quote, char_span=span)
        if result.fired:
            tier1_detections.extend(result.detections)
            condition_outcomes.append({"condition_ref": cond.condition_ref, "outcome": "classified_tier1", "char_span": list(span)})
        else:
            assert result.fallthrough is not None  # tier1_detectors.py guarantee
            tier1_fallthroughs.append(result.fallthrough)
            condition_outcomes.append({"condition_ref": cond.condition_ref, "outcome": "fallthrough_pending_tier3", "char_span": list(span)})

    # clause 3(b) non-drop invariant, asserted structurally (also covered by
    # a dedicated regression test in test_pilot_conveyor.py).
    assert len(spine_conditions) == len(unanchored) + len(condition_outcomes), (
        "non-drop invariant violated: a spine condition vanished between "
        "extraction and tier-1 classification"
    )

    packet, item_span_map = _build_tier3_packet(full_transcript, video_id, tier1_fallthroughs, strategy_index)
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
    topology: Optional[List[ConditionTopology]] = None,
    or_branches: Optional[List[List[str]]] = None,
    scope_line: Optional[str] = None,
    dry_run: bool = False,
) -> dict:
    """Phase 2 (never calls an LLM/agent -- `tier3_verdicts` are consumed as
    DATA, same contract as `cert_assembler.assemble_certificate` itself).
    Joins verdicts to fall-through spans by char_span (via `Tier3Verdict.
    char_span`, exactly as `assemble_certificate` already does internally)
    and returns the pilot-grade certificate.

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
