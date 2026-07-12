"""H1 anchor-locator (Wave-4 conveyor component, pre-reg addendum 3 --
`docs/designs/h1-pilot-preregistration-2026-07-12.md` ADDENDUM 3 -- A-PRIME).

Repairs the Addendum-2 clause-4 premise: the frozen production extractor
emits spine conditions WITHOUT a verbatim quote anchor for the fields tier-1
targets (entry_sequence / confluences / stop / targets). Addendum 3 resolves
this with a NEW conveyor instrument -- NOT an extractor schema change (that
would perturb the extractor's constrained-sampling distribution, the exact
failure clause 1's freeze forbids; see the addendum's schema-IS-the-boundary
citation) -- so this module locates the grounding text FOR an already-
extracted condition, after the fact.

ARCHITECTURE (addendum §2-3, "A-prime -- LLM proposes, mechanics verify"):
  PROPOSE (gemma, non-deterministic, the ONLY LLM step):
    `_propose_quote(transcript, condition_text, propose_fn)` -> str | None.
    One local gemma4:e4b-it-qat call per condition (CLAUDE.md §15 house
    convention: localhost:11434 /api/chat, JSON-schema-constrained `format`,
    same shape as `tier2_discourse.py`'s `gemma_classify_call`). May abstain
    (return None) -- a cost-free decline, mirroring the pre-call decline gate
    precedent the addendum cites.
  VERIFY (mechanical, deterministic, owns the truth):
    `_verify_and_locate(transcript, proposed_quote)` -> (start, end) | None.
    The proposed quote must resolve as a literal substring of the transcript
    under WHITESPACE-NORMALIZATION ONLY (collapse whitespace runs; NO fuzzy
    match, NO token-level tolerance -- F-2's exact-token discipline,
    anti-pattern-catalog.md). A single differing TOKEN fails the match
    entirely (normalized strings are compared for exact equality over the
    match window) -- only whitespace shape is forgiving.
  COMPOSE: `locate_anchor` calls propose then verify. Both failure modes
  (decline / hallucination-not-a-substring) land as an honest UNANCHORED
  result BY CONSTRUCTION -- gemma's non-determinism cannot corrupt the
  measurement because the mechanical check owns the truth (addendum §3).

REUSE, not a second divergent substring check (anti-duplication discipline,
compile_lints.py's own ledger convention): the mechanical verifier's
"does this span resolve as a valid anchor" check is NOT reimplemented here.
`_resolves_as_anchor` builds a `compile_lints.SpineCondition` /
`CompiledSpine` around the candidate span and calls the REAL
`compile_lints.f2_coverage_gate` -- the exact function `cert_assembler.py`
runs (via `run_all_lints`) to gate `pilot_grade`, including its word-boundary
leg (the F-2 collision class: "range"/"arranged" etc., f2_coverage_gate's own
docstring). An anchor this module returns LOCATED is therefore, by
construction, one `cert_assembler.assemble_certificate`'s own
`every_anchor_resolves` invariant AND `f2_coverage_gate` both accept -- single
source of truth, no drift risk.

`quote_anchor` on a LOCATED result is always the LITERAL transcript slice
`transcript[start:end]` (never gemma's raw proposal text) -- this is what
guarantees `cert_assembler`'s strict `full_transcript[s:e] == quote_anchor`
equality holds trivially for every anchor this module locates.

Anchor-SUPPORTS-condition semantic scoring is explicitly OUT of scope here
(addendum §4) -- that judgment belongs to tier-3's blind adjudicators. This
module only proves the span is real transcript text.
"""

from __future__ import annotations

import json
import urllib.request
from dataclasses import dataclass
from typing import Callable, List, Optional, Tuple

from . import compile_lints as cl
from .compile_lints import CompiledSpine, SpineCondition, f2_coverage_gate

# --------------------------------------------------------------------------- #
# Result type
# --------------------------------------------------------------------------- #

REASON_LOCATOR_DECLINED = "locator_declined"
REASON_NOT_LITERAL_SUBSTRING = "proposed_quote_not_literal_substring"


@dataclass
class AnchorResult:
    """LOCATED iff `quote`/`char_span` are set and `reason` is None.
    UNANCHORED iff `quote`/`char_span` are None and `reason` explains why."""

    located: bool
    quote: Optional[str] = None
    char_span: Optional[Tuple[int, int]] = None
    reason: Optional[str] = None

    def as_dict(self) -> dict:
        return {
            "located": self.located,
            "quote": self.quote,
            "char_span": list(self.char_span) if self.char_span is not None else None,
            "reason": self.reason,
        }


# --------------------------------------------------------------------------- #
# PROPOSE (gemma, the only non-deterministic step)
# --------------------------------------------------------------------------- #

_OLLAMA_URL = "http://localhost:11434/api/chat"
_GEMMA_MODEL = "gemma4:e4b-it-qat"

_OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "quote": {"type": ["string", "null"]},
    },
    "required": ["quote"],
}

_SYSTEM_PROMPT = (
    "You are an anchor locator for trading-education transcripts. You are given "
    "ONE extracted strategy condition and the FULL transcript it was extracted "
    "from. Find the literal span of transcript text that GROUNDS the condition -- "
    "the trader's own words that this condition is describing.\n\n"
    "Rules:\n"
    "1. Your `quote` MUST be copied VERBATIM from the transcript -- exact "
    "wording, exact punctuation. Do not paraphrase, summarize, or correct "
    "the trader's grammar.\n"
    "2. Prefer the SHORTEST contiguous span that still grounds the condition.\n"
    "3. If you cannot find transcript text that grounds this condition, return "
    "`quote: null`. Declining is CORRECT when no grounding exists -- do not "
    "invent or approximate a quote.\n\n"
    "Return JSON matching the schema."
)


def _build_user_message(transcript: str, condition_text: str) -> str:
    return (
        f"CONDITION:\n{condition_text}\n\n"
        f"TRANSCRIPT:\n{transcript}\n\n"
        "Return the literal grounding quote, or null."
    )


def _default_propose_fn(transcript: str, condition_text: str, timeout: float = 60.0) -> Optional[str]:
    """Real Gemma-local call (CLAUDE.md §15 convention, matching
    `tier2_discourse.gemma_classify_call`'s payload shape). NOT exercised by
    `test_anchor_locator.py` -- tests inject `propose_fn` so they never hit
    the network (birth-gate discipline); exercised by the dry-run against a
    NON-SEALED transcript instead. Raises on transport failure so a caller
    sees a clean blocker rather than a silently-faked decline."""
    payload = {
        "model": _GEMMA_MODEL,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": _build_user_message(transcript, condition_text)},
        ],
        "stream": False,
        "format": _OUTPUT_SCHEMA,
        "options": {"temperature": 0.1, "top_p": 0.95, "top_k": 64},
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(_OLLAMA_URL, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    content = body.get("message", {}).get("content", "")
    parsed = json.loads(content)
    quote = parsed.get("quote")
    return quote if quote else None


def _propose_quote(
    transcript: str,
    condition_text: str,
    propose_fn: Callable[[str, str], Optional[str]],
) -> Optional[str]:
    return propose_fn(transcript, condition_text)


# --------------------------------------------------------------------------- #
# VERIFY (mechanical, deterministic, whitespace-normalization ONLY)
# --------------------------------------------------------------------------- #


def _normalize_with_spans(text: str) -> Tuple[str, List[Tuple[int, int]]]:
    """Collapse runs of whitespace to a single space. Returns the normalized
    string plus, per normalized character, the (start, end) exclusive span in
    the ORIGINAL text it derives from -- a run of whitespace collapses to one
    normalized space char whose span covers the WHOLE original run, so
    converting a matched normalized range back to original coordinates never
    loses text. This is whitespace-shape ONLY -- no case-folding, no
    stemming, no token fuzz; every non-whitespace character passes through
    unchanged and must match exactly."""
    norm_chars: List[str] = []
    spans: List[Tuple[int, int]] = []
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c.isspace():
            j = i
            while j < n and text[j].isspace():
                j += 1
            norm_chars.append(" ")
            spans.append((i, j))
            i = j
        else:
            norm_chars.append(c)
            spans.append((i, i + 1))
            i += 1
    return "".join(norm_chars), spans


def _normalize_query(text: str) -> str:
    """Same whitespace-run collapse as `_normalize_with_spans`, plus a strip
    of the (now-single-space) leading/trailing whitespace -- the proposed
    quote is a standalone query, not transcript text needing a position map,
    so trimming it is part of "whitespace-normalization" for a query string."""
    normalized, _ = _normalize_with_spans(text)
    return normalized.strip()


def _resolves_as_anchor(transcript: str, quote_anchor: str, char_span: Tuple[int, int]) -> bool:
    """REUSE: delegates to `compile_lints.f2_coverage_gate` -- the exact
    function `cert_assembler.assemble_certificate` runs to gate `pilot_grade`
    (via `run_all_lints`). Never a second, divergent substring check."""
    condition = SpineCondition(
        condition_id="_anchor_locator_candidate",
        quote_anchor=quote_anchor,
        char_span=char_span,
    )
    spine = CompiledSpine(conditions=[condition])
    result = f2_coverage_gate(spine, transcript)
    return result.status == cl.STATUS_PASS


def _verify_and_locate(transcript: str, proposed_quote: Optional[str]) -> Optional[Tuple[int, int]]:
    """Find the FIRST occurrence (leftmost) of `proposed_quote`, matched
    against `transcript` under whitespace-normalization ONLY, that ALSO
    resolves as a valid anchor per `_resolves_as_anchor` (word-boundary
    discipline included). Returns the char_span into the ORIGINAL,
    un-normalized transcript, or None if no occurrence resolves."""
    if not proposed_quote:
        return None
    normalized_query = _normalize_query(proposed_quote)
    if not normalized_query:
        return None

    normalized_transcript, spans = _normalize_with_spans(transcript)
    query_len = len(normalized_query)

    search_from = 0
    while True:
        ni = normalized_transcript.find(normalized_query, search_from)
        if ni == -1:
            return None
        orig_start = spans[ni][0]
        orig_end = spans[ni + query_len - 1][1]
        candidate_span = (orig_start, orig_end)
        candidate_quote = transcript[orig_start:orig_end]
        if _resolves_as_anchor(transcript, candidate_quote, candidate_span):
            return candidate_span
        search_from = ni + 1


# --------------------------------------------------------------------------- #
# COMPOSE
# --------------------------------------------------------------------------- #


def locate_anchor(
    transcript: str,
    condition_text: str,
    propose_fn: Optional[Callable[[str, str], Optional[str]]] = None,
) -> AnchorResult:
    """Two-part by construction (addendum §3): PROPOSE (gemma, may abstain)
    then VERIFY (mechanical substring+boundary check, owns the truth).
    `propose_fn` defaults to the real Gemma-local call; inject a stub in
    tests so the network is never touched (birth-gate discipline)."""
    fn = propose_fn or _default_propose_fn
    proposed = _propose_quote(transcript, condition_text, fn)
    if not proposed:  # None OR empty string == abstain (F-1 grade fix, clause-5 attribution)
        return AnchorResult(located=False, reason=REASON_LOCATOR_DECLINED)

    span = _verify_and_locate(transcript, proposed)
    if span is None:
        return AnchorResult(located=False, reason=REASON_NOT_LITERAL_SUBSTRING)

    literal_quote = transcript[span[0]:span[1]]
    return AnchorResult(located=True, quote=literal_quote, char_span=span)
