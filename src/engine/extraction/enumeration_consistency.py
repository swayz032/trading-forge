"""SUPERSEDED-FOR-PROSE (2026-07-15, minted law): this MECHANICAL/lexical lint is
BYPASSABLE across the prose seam (paraphrase-bypass; the IyF catch was a key-format
accident, grader-falsified). The terminal read consumes the SEMANTIC cross-vendor
enumeration-consistency verdict instead (src/agents/enumeration-consistency-semantic.md).
This lint is RETAINED only for the STRUCTURED (compiled-spec/H2) layer where key/field
signal natively exists. Do NOT arm it as the prose terminal-read axis.

---

H1 enumeration-consistency lint (ratify-packet
`docs/designs/h1-enumeration-consistency-lint-ratify-2026-07-15.md`).

Defends a defect class INVISIBLE to every existing net: Phase-B re-promotes an
enumeration-EXCLUDED mention (a mention the certified enumeration ruled
UNPROMOTED / no runnable entry) into a runnable, direction-tagged VARIANT.
The k=5 count-guard sees no count change, the completeness panel hunts
omissions not over-inclusion, and the conflation check passes labeled
alternatives -- all three miss it. Measured lower-bound 1/22: `IyFioFkRgWo`'s
`breakdown_continuation` variant (short) is the certified-excluded
"breakdown 'big move'" mention promoted to a runnable short.

SCOPE (ratify-packet §3, conformance-in-POST-PROCESSING law): this is a pure
mechanical diff of two on-disk artifacts (a strategy's Phase-B `variants[]` vs
the per-video enumeration-exclusion log). It calls no LLM, imports no engine
DSL, and does NOT touch the frozen reader / extractor / enumerator, the
conflation check, or the other compile-integrity lints. Same inputs always
produce the same result (replay-determinism).

MATCH RULE (packet §3): a variant matches an excluded mention when
  (a) the mention's `key` term is a case-insensitive substring of the
      variant's name / variant_label / note text, AND
  (b) if the mention carries a non-null `direction`, the variant's `direction`
      equals it (the excluded direction is the one OPPOSITE the strategy's
      main direction -- the IyF short-vs-long signature).
Any match -> FAIL (the offending variant + matched mention are named). No
variants, or no variant matches any mention -> PASS. An absent/empty exclusion
log for the video -> NOT_EVALUATED (fail-closed: a promotion cannot be cleared
without the certified authority to diff against).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

# Reuse the 3-state status vocabulary from the compile-integrity lints so the
# two layers never drift on the string literals (anti-duplication discipline).
from .compile_lints import STATUS_FAIL, STATUS_NOT_EVALUATED, STATUS_PASS

# The variant sub-fields the packet names as the key-term search surface. Only
# these three are consulted (a deliberate, spec-faithful surface -- NOT every
# free-text field on a variant, which would over-fire on incidental prose).
_NAME_FIELDS = ("name", "variant_label", "note")

REASON_NO_EXCLUSION_LOG = "no_exclusion_log_for_video"


@dataclass
class EnumConsistencyResult:
    """Result of one strategy's enumeration-consistency diff.

    `status` is one of the shared 3-state constants. On FAIL,
    `offending_variant` names the promoted variant (its name/variant_label) and
    `matched_key` / `matched_direction` record the excluded mention it collided
    with. `reason` is set on NOT_EVALUATED (fail-closed)."""

    status: str
    offending_variant: Optional[str] = None
    matched_key: Optional[str] = None
    matched_direction: Optional[str] = None
    reason: Optional[str] = None

    def as_dict(self) -> dict:
        return {
            "status": self.status,
            "offending_variant": self.offending_variant,
            "matched_key": self.matched_key,
            "matched_direction": self.matched_direction,
            "reason": self.reason,
        }


def _norm_dir(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip().lower()
    return text or None


def _variant_name(variant: dict) -> str:
    for field in ("name", "variant_label"):
        val = variant.get(field)
        if val:
            return str(val)
    return "<unnamed-variant>"


def _variant_search_text(variant: dict) -> str:
    """Lower-cased concatenation of the variant's name / variant_label / note
    -- the case-insensitive substring search surface (packet §3 rule (a))."""
    parts: List[str] = []
    for field in _NAME_FIELDS:
        val = variant.get(field)
        if val:
            parts.append(str(val))
    return " ␟ ".join(parts).lower()


def enumeration_consistency_check(
    strategy_extraction: dict,
    excluded_mentions: Optional[List[dict]],
) -> EnumConsistencyResult:
    """Pure diff of ONE strategy's `variants[]` against that video's excluded
    mentions. See module docstring for the match rule. Fail-closed on an
    absent/empty exclusion log.

    `strategy_extraction`: a single strategy object (has `variants` +
    `direction`). `excluded_mentions`: the list of `{key, direction, ...}`
    entries the certified enumeration EXCLUDED for this strategy's video.
    CRITICAL empty-vs-absent distinction (the caller resolves video -> list):
      - `None`  = the video is ABSENT from the exclusion log (unknown) -> fail-closed NOT_EVALUATED.
      - `[]`    = the video is PRESENT with an EMPTY list (enumeration confirmed NO
                  unpromoted mention) -> nothing to violate -> PASS.
    Conflating these would fail-close every honest no-mention video for a data-absence
    reason it doesn't have."""
    # Fail-closed ONLY when the video is genuinely ABSENT from the log (None).
    # An explicit empty list is a real certified answer ("nothing excluded") and PASSES.
    if excluded_mentions is None:
        return EnumConsistencyResult(
            status=STATUS_NOT_EVALUATED, reason=REASON_NO_EXCLUSION_LOG
        )

    variants = strategy_extraction.get("variants") or []
    for variant in variants:
        text = _variant_search_text(variant)
        if not text:
            continue
        vdir = _norm_dir(variant.get("direction"))
        for mention in excluded_mentions:
            key = str(mention.get("key") or "").strip().lower()
            if not key or key not in text:
                continue
            mdir = _norm_dir(mention.get("direction"))
            # (b) directional gate: only enforced when the mention pins a
            # direction. A directionless excluded mention matches on key alone.
            if mdir is not None and vdir != mdir:
                continue
            return EnumConsistencyResult(
                status=STATUS_FAIL,
                offending_variant=_variant_name(variant),
                matched_key=mention.get("key"),
                matched_direction=mdir,
            )

    # Variants all legitimate (or none present) with a real log in hand.
    return EnumConsistencyResult(status=STATUS_PASS)
