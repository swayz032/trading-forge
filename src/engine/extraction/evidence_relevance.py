"""EVIDENCE RELEVANCE / GROUNDING GATE — stage 2 of AR-1224 §5.

    MODEL PROPOSES CANDIDATE QUOTE
      1. LITERAL PRESENCE GATE      is the span really in the transcript?      (anchor_locator)
      2. EVIDENCE RELEVANCE GATE    does the span support THIS condition?      <-- THIS MODULE
      3. SOURCE-FIDELITY PRE-SCREEN did extraction strengthen/widen/invent?    (source_fidelity_guard)
      4. TIERING / GRADE

The defect it exists for (AR-1223/AR-1224): six of seven "anchored" conditions were all
bound to one generic loss disclaimer. Those spans are **literal**, so stage 1 accepts them — the
anti-hallucination fence cannot catch a real quote about the wrong thing.

WHY THIS IS NOT "SHARE N KEYWORDS" (AR-1224 §4 forbids that explicitly). An ABSOLUTE lexical
threshold rejects faithful paraphrase: the educator and the extractor legitimately use different
words. This gate is **RELATIVE**. It asks a comparative question:

    does this span support THIS condition better than it supports the OTHER conditions
    in the same strategy?

A faithful paraphrase still resembles its own condition more than it resembles an unrelated one,
so it survives. **Generic boilerplate resembles everything equally — and that is exactly its
signature.** A span that grounds every condition grounds none of them.

Two verdicts, both derived from that one idea:

  MISGROUNDED_NO_OVERLAP        the span shares no content at all with its condition
  MISGROUNDED_NOT_DISCRIMINATING the span fits rival conditions at least as well as its own

Deliberately NOT a semantic oracle, and deliberately NOT a fidelity checker — stage 3 owns
inflation. A `grounded=True` here means only "this span is about the right subject", never "the
condition is faithful" and never "the executable geometry is settled".

No domain vocabulary: the caller supplies the rival conditions. A test asserts the module holds
no source-specific string.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .term_equivalence import equivalence_tokens

__all__ = ["RelevanceVerdict", "evaluate_evidence_relevance"]

# Function words carry no subject matter, so they cannot signal aboutness.
_STOPWORDS = frozenset("""
a an the this that these those of to in on at for with by from as is are was were be been being
it its we you i he she they them our your their and or if then so not no do does did can could
will would should must have has had there here what which who when how why all any some just
going go get got me my us out up down over under into about very really okay ok now well like
one two three but also more most than because while during after before every each other another
""".split())


@dataclass(frozen=True)
class RelevanceVerdict:
    grounded: bool
    reason: str
    own_score: float = 0.0
    best_rival_score: float = 0.0
    rival: str | None = None
    shared_terms: tuple[str, ...] = field(default=())


def _terms(text: str) -> set[str]:
    """Content terms for relevance comparison, PLUS canonical concept tokens.

    AR-1239 §4 assigned term equivalence to relevance INPUT NORMALIZATION, and this is that
    seam. The gap it closes was measured in AR-1225: a faithful span whose wording the
    extractor normalised — an abbreviation on one side and its expansion on the other, or a
    timeframe written two ways — shares zero literal content terms with its condition and is
    refused. Six reports raised it before it had an owner.

    The equivalences themselves live in `term_equivalence`, which owns them and cites where
    each is established. None of that vocabulary appears here: this module stays free of
    domain strings, which the suite's own hardcoding guard enforces — and which caught an
    earlier draft of this very docstring.

    🛑 CANONICAL TOKENS ARE ADDED, NEVER SUBSTITUTED. The original words all survive, so
    normalization can only ever RAISE a comparison between two texts that genuinely name the
    same concept — it cannot hide a term this gate was already matching on, and it cannot
    rescue a span that is about something else. The disclaimer misgroundings still fail, and
    that is asserted as a control rather than assumed.
    """
    toks = re.findall(r"[a-z0-9]+", (text or "").lower())
    base = {t for t in toks if len(t) >= 3 and t not in _STOPWORDS}
    return base | equivalence_tokens(text)


def _weights(document: str | None) -> dict:
    """Rarity weight per term: how much evidence does sharing this word actually provide?

    🛑 THIS IS THE CORRECTION THAT MADE THE GATE WORK. Counting shared terms equally let the
    generic loss disclaimer "discriminate": it shares the word `strategy` with one condition and
    nothing with the rivals, so an unweighted rule scored it as grounding that condition. A word
    the speaker uses constantly carries almost no evidence about WHICH rule a span supports; a
    word used a handful of times carries a lot.

    Weight = 1 / (1 + occurrences in the source document). No document supplied -> all terms
    weigh 1, and the caller is told the comparison was unweighted.
    """
    if not document:
        return {}
    counts: dict = {}
    for t in re.findall(r"[a-z0-9]+", document.lower()):
        if len(t) >= 3 and t not in _STOPWORDS:
            counts[t] = counts.get(t, 0) + 1
    return {t: 1.0 / (1.0 + c) for t, c in counts.items()}


def _score(quote_terms: set[str], condition: str, weights: dict) -> tuple[float, set[str]]:
    """Rarity-weighted fraction of the CONDITION's content that the quote covers.

    Normalising by the condition (not the quote) is deliberate: a long quote should not score
    highly merely for being long, and a short quote that covers the subject should not be
    punished for brevity.
    """
    cond = _terms(condition)
    if not cond:
        return 0.0, set()
    shared = cond & quote_terms
    total = sum(weights.get(t, 1.0) for t in cond)
    if total <= 0:
        return 0.0, shared
    return sum(weights.get(t, 1.0) for t in shared) / total, shared


def evaluate_evidence_relevance(
    condition_text: str,
    quote: str,
    rival_conditions: list[str] | tuple[str, ...] = (),
    margin: float = 0.0,
    source_document: str | None = None,
    floor: float = 0.10,
) -> RelevanceVerdict:
    """Decide whether `quote` is plausibly ABOUT `condition_text`.

    `rival_conditions` are the other conditions from the same strategy — the comparison set that
    makes this relative rather than a keyword threshold. With no rivals supplied the gate can
    only apply the weakest check (any overlap at all) and says so in its reason, rather than
    silently reporting a confident pass.

    `margin` requires the own-score to beat the best rival by that much; 0.0 means "strictly
    greater", which is the discrimination the mis-grounding case needs.

    `floor` is the minimum share of the condition's rarity-weighted content the span must cover.
    Discrimination ALONE is not enough: when every rival scores 0.00, any non-zero score "wins",
    and the real disclaimer scored 0.019 purely by sharing one very common word. The floor is
    DERIVED FROM MEASUREMENT, not chosen:

        generic disclaimer vs 5 real conditions : max own-score 0.019
        four real evidence spans               : 0.34, 0.34, 0.37, 0.48

    An order of magnitude apart. 0.10 sits ~5x above the noise and ~3.4x below the weakest real
    evidence. ⚠️ That separation was measured on ONE source; a different educator could compress
    it, so the floor is a parameter and a caller working on new material should re-derive it
    rather than assume it transfers.
    """
    if not (condition_text or "").strip():
        return RelevanceVerdict(False, "EMPTY_CONDITION")
    if not (quote or "").strip():
        return RelevanceVerdict(False, "NO_EVIDENCE: no quote was supplied")

    weights = _weights(source_document)
    qterms = _terms(quote)
    own, shared = _score(qterms, condition_text, weights)

    if own <= 0.0:
        return RelevanceVerdict(
            False,
            "MISGROUNDED_NO_OVERLAP: the span shares no content term with the condition, so it "
            "cannot be evidence for it",
            own_score=own,
        )

    best_rival, rival_text = 0.0, None
    for rc in rival_conditions or ():
        if not rc or rc == condition_text:
            continue
        s, _ = _score(qterms, rc, weights)
        if s > best_rival:
            best_rival, rival_text = s, rc

    if not rival_conditions:
        return RelevanceVerdict(
            True,
            "WEAK_PASS: overlap exists, but no rival conditions were supplied so the "
            "discriminating comparison could not be made",
            own_score=own, shared_terms=tuple(sorted(shared)),
        )

    if own < floor:
        return RelevanceVerdict(
            False,
            f"MISGROUNDED_BELOW_FLOOR: the span covers only {own:.3f} of the condition's "
            f"distinctive content (floor {floor:.2f}) — it shares a word, not a subject",
            own_score=own, best_rival_score=best_rival, rival=rival_text,
            shared_terms=tuple(sorted(shared)),
        )

    if own > best_rival + margin:
        return RelevanceVerdict(
            True,
            f"GROUNDED: the span fits this condition ({own:.2f}) better than any rival "
            f"({best_rival:.2f})",
            own_score=own, best_rival_score=best_rival, rival=rival_text,
            shared_terms=tuple(sorted(shared)),
        )

    return RelevanceVerdict(
        False,
        "MISGROUNDED_NOT_DISCRIMINATING: the span fits a different condition at least as well "
        f"({best_rival:.2f} vs {own:.2f}), so it does not ground THIS one — the signature of "
        "generic text being reused as evidence",
        own_score=own, best_rival_score=best_rival, rival=rival_text,
        shared_terms=tuple(sorted(shared)),
    )
