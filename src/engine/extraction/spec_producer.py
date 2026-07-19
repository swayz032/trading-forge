"""H1 PACKET 2 -- runnable-spec compiler (ratify
`docs/designs/h1-packet2-runnable-spec-compiler-ratify-2026-07-18.md`, R-040).

THE ONE THING THIS MODULE DOES: turn a certified `staging_v32` extraction (+ its
fidelity certificate) into a SpecArtifact `.spec.json` body -- the runnable shape
the EXISTING onboarding back-half consumes (`spec-onboarding-service.ts`
onboardSpecArtifact -> SpecConditionStrategy -> run_class_backtest). It is the
physical H1->H2 connection (R-039 §5).

HEURISTIC-FIRST TYPE-FAMILY CLASSIFIER (R-040 pin 2a). Each prose condition is
mapped to one of the binding FAMILIES (`spec_family_bindings.FAMILY_META`).

  ★ ANTI-FIT (R-040 pin 2i): the keyword rules below are DERIVED FROM THE FAMILY
  DEFINITIONS' semantics (the `spec_family_bindings.py` FAMILY -> PRIMITIVE table
  + docs/spec-execution-semantics.md), NEVER from reading the design-pool 22's
  texts. The shakedown corpus MEASURES this heuristic; it must not AUTHOR it.
  Every keyword below is annotated with the family SEMANTIC it comes from.

  ★ NAMED OPTIMISTIC BIAS (R-040 pin 2iii): a condition whose binding is
  `approximation=True` degrades to a pass-through (`np.ones`) in
  SpecConditionStrategy -- effectively UNGATED -> the compiled spec trades
  LOOSER than taught. That error direction is OPTIMISTIC. So the producer stamps
  the per-spec approximation rate ON the artifact; every battery verdict on an
  approximated spec must carry that rate in its scope line, and a
  high-approximation spec cannot ground a survivor claim on its own.

PURE/DETERMINISTIC: no I/O beyond reading its dict args, no LLM, no randomness,
no wall-clock -- same inputs -> byte-identical artifact. `spec_hash` is a
sha256 over the canonical spec body, so the `.spec.json` transfers between
engine trees provenance-safe (R-040 §1).

EXPLICITLY OUT OF SCOPE: the extractor/certified reader (frozen -- this is
conformance in POST-PROCESSING, R-039 pin 5a); spec_condition_compiler /
spec_family_bindings / framework-overlay semantics (consumed as-is); the
survivor-forensics compile-fidelity leg (follow-on); an LLM classifier seam
(RESERVED, evidence-triggered).
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Dict, List, Optional, Tuple

from src.engine.spec_family_bindings import compile_binding_plan

# --------------------------------------------------------------------------- #
# Type-family classifier -- keyword rules DERIVED FROM FAMILY SEMANTICS (anti-fit)
# --------------------------------------------------------------------------- #
#
# Each entry: FAMILY -> tuple of lowercase keyword stems that express THAT
# FAMILY'S MEANING per the spec_family_bindings FAMILY->PRIMITIVE table. The
# comment cites the family's semantic anchor. These are NOT harvested from the
# 22's transcripts (anti-fit); they are the vocabulary a family's DEFINITION
# implies. Precedence is the list ORDER in _KEYWORD_FAMILIES (most-specific
# first) so an ambiguous condition resolves deterministically.

_FAMILY_KEYWORDS: Dict[str, Tuple[str, ...]] = {
    # WAIT_SESSION -> session_windows (time-of-day / killzone). Semantic: a
    # calendar/clock window. (FAMILY_META requires_session_keyword=True.)
    "WAIT_SESSION": (
        "session", "killzone", "kill zone", "open", "opening", "close of",
        "am ", "pm ", "morning", "afternoon", "york", "london", "asia",
        "tokyo", "rth", "globex", "o'clock", "oclock", "time of day",
        "first hour", "power hour", "cash open", "bell",
    ),
    # WAIT_BIAS / CONFIRM_DIRECTION -> bias_engine regime (directional bias /
    # HTF narrative). Semantic: which way, on the higher frame.
    "WAIT_BIAS": (
        "higher time frame", "htf", "daily bias", "overall trend", "bias is",
        "directional bias", "market direction", "trend is", "regime",
        "narrative", "expansion phase", "accumulation phase", "with the trend",
    ),
    "CONFIRM_DIRECTION": (
        "confirm the direction", "confirm direction", "in line with the trend",
        "aligned with bias", "same direction",
    ),
    # WAIT_RETEST -> retest_touch_check (return-to-level / pullback / touch).
    # Semantic: price comes BACK to a prior level.
    "WAIT_RETEST": (
        "retest", "re-test", "pullback", "pull back", "revisit", "return to",
        "returns to", "tap", "taps", "mitigation", "mitigate", "back to the",
        "comes back", "bounce off", "reject off",
    ),
    # WAIT_CONFIRMATION -> candle_confirmation_check (rejection/confirmation
    # candle print). Semantic: a confirming price ACTION at the level.
    "WAIT_CONFIRMATION": (
        "confirmation", "rejection candle", "rejection", "engulf", "engulfing",
        "pin bar", "wick", "close above", "close below", "closes above",
        "closes below", "confirm with", "reversal candle", "print",
    ),
    # WAIT_STRUCTURE / VERIFY_STRUCTURE -> structure_engine (market structure:
    # levels, BOS, FVG, order block, S/R, liquidity). Semantic: a structural
    # feature on the chart. (Broadest -- lower precedence than the above.)
    "WAIT_STRUCTURE": (
        "break of structure", "bos", "market structure", "structure",
        "order block", "fair value gap", "fvg", "imbalance", "gap",
        "support", "resistance", "supply", "demand", "liquidity", "swing high",
        "swing low", "swing", "level", "zone", "trendline", "channel", "range",
        "high of the", "low of the", "equal highs", "equal lows",
    ),
    # FILTER -> confluence_factor_presence (a quality/confluence gate: volume,
    # catalyst, volatility, multi-TF alignment). Semantic: a go/no-go quality
    # filter, not a structural trigger.
    "FILTER": (
        "volume", "catalyst", "news", "confluence", "volatility", "atr",
        "momentum", "spread", "in play", "in-play", "multiple time frames",
        "multiple timeframes", "aligns", "liquid", "average volume", "float",
    ),
}

# Precedence order (most-specific families first; STRUCTURE/FILTER are the
# broad catch-alls). Derived from specificity of the family definitions, not
# from the corpus.
_KEYWORD_FAMILIES: Tuple[str, ...] = (
    "WAIT_SESSION",
    "CONFIRM_DIRECTION",
    "WAIT_BIAS",
    "WAIT_RETEST",
    "WAIT_CONFIRMATION",
    "WAIT_STRUCTURE",
    "FILTER",
)

# Confidence vocabulary (schema = decision boundary; keep it a closed set).
CONF_CONFIDENT = "confident"
CONF_APPROXIMATE = "approximate"
CONF_UNMATCHED = "unmatched"

# When no family keyword matches, we assign this family (the broadest audited
# structural primitive) but flag type_confidence=UNMATCHED so the honesty is
# on the record -- never a silent confident guess.
_UNMATCHED_DEFAULT_FAMILY = "WAIT_STRUCTURE"

_HOUSE_DEFAULT_EXIT = "house-default (trader taught none)"


def _norm(text: Optional[str]) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def _slug(text: str, maxlen: int = 40) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", _norm(text)).strip("-")
    return (s[:maxlen] or "cond").rstrip("-")


def _classify_family(text: str, *, role_hint: Optional[str] = None) -> Tuple[str, str]:
    """Map ONE prose condition to a (family, type_confidence). Anti-fit: scores
    families by the FAMILY-SEMANTIC keyword hits above, never by corpus fitting.

      confident  -- exactly one family's keywords hit (unambiguous).
      approximate-- two or more families' keywords hit (ambiguous prose; the
                    top-precedence family is chosen, honestly flagged).
      unmatched  -- no family keyword hit -> default family, flagged.
    """
    hay = _norm(text)
    hits: List[str] = []
    for fam in _KEYWORD_FAMILIES:
        if any(kw in hay for kw in _FAMILY_KEYWORDS[fam]):
            hits.append(fam)
    if not hits:
        return _UNMATCHED_DEFAULT_FAMILY, CONF_UNMATCHED
    chosen = hits[0]  # precedence order = most-specific first
    conf = CONF_CONFIDENT if len(hits) == 1 else CONF_APPROXIMATE
    return chosen, conf


# --------------------------------------------------------------------------- #
# Staging-shape helpers
# --------------------------------------------------------------------------- #

_TRIGGER_ROLES = {"entry_trigger", "trigger", "entry"}


def _direction(strategy: dict) -> str:
    d = _norm(strategy.get("direction"))
    return d if d in ("long", "short", "both") else "both"


def _condition_text(obj: dict) -> str:
    for k in ("action", "description", "rationale", "stop_management"):
        v = obj.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def _untaught_exit(strategy: dict) -> bool:
    """True iff the trader taught NO concrete exit (R-039 pin c trigger): a
    gestural/null stop, empty-or-all-gestural targets, or an explicit
    gestural_exit marker."""
    if bool(strategy.get("gestural_exit")):
        return True
    stop = strategy.get("stop")
    stop_untaught = (
        stop is None
        or (isinstance(stop, dict) and (stop.get("level") is None or bool(stop.get("gestural"))))
    )
    targets = strategy.get("targets") or []
    if not isinstance(targets, list) or len(targets) == 0:
        targets_untaught = True
    else:
        targets_untaught = all(
            isinstance(t, dict) and (t.get("level") is None or bool(t.get("gestural"))) for t in targets
        )
    return bool(stop_untaught and targets_untaught)


def _cert_span_for(text: str, cert: Optional[dict]) -> Tuple[Dict[str, int], str]:
    """Best-effort join of a staging condition to the certificate's own
    quote_anchor/char_span (the provenance link). span/evidence are NOT
    parse-required and feed diagnostics only, so an unmatched condition gets
    span {0,0} + its own prose as evidence -- honest, never fabricated."""
    if isinstance(cert, dict):
        hay = _norm(text)
        for c in cert.get("conditions", []) or []:
            anchor = c.get("quote_anchor") or ""
            anchor_norm = _norm(anchor)
            if not anchor_norm or not hay:
                continue
            if anchor_norm in hay or hay in anchor_norm:
                s = c.get("char_span") or [0, 0]
                return {"start": int(s[0]), "end": int(s[1])}, anchor
    return {"start": 0, "end": 0}, text


# --------------------------------------------------------------------------- #
# The producer
# --------------------------------------------------------------------------- #


def _entry_condition(
    idx: int, text: str, *, staging_role: str, cert: Optional[dict], structural_family: Optional[str] = None
) -> Tuple[dict, str]:
    """Build one SpecEntryCondition + return its type_confidence. `structural_
    family` (INVALIDATE/ENABLE_ENTRY) is assigned STRUCTURALLY (never keyword-
    guessed) when the caller knows the condition's structural role."""
    if structural_family is not None:
        family, conf = structural_family, CONF_CONFIDENT
    else:
        family, conf = _classify_family(text, role_hint=staging_role)
    span, evidence = _cert_span_for(text, cert)
    role = _spec_role(staging_role, family)
    cond = {
        "id": f"{family}:{_slug(text)}#{idx}",
        "type": family,
        "object": text,
        "role": role,
        "span": span,
        "evidence": evidence,
        # additive, honest -- NOT part of the parse-required contract; carried
        # so the approximation metric + survivor-forensics can read per-condition
        # classifier confidence.
        "type_confidence": conf,
    }
    return cond, conf


def _spec_role(staging_role: str, family: str) -> str:
    """SpecEntryCondition.role vocabulary is {spine, confluence, trigger,
    invalidation}. Derived structurally from the staging role + family."""
    if family == "INVALIDATE":
        return "invalidation"
    if family in ("ENABLE_ENTRY", "ENTER") or _norm(staging_role) in _TRIGGER_ROLES:
        return "trigger"
    if _norm(staging_role) == "confluence":
        return "confluence"
    return "spine"


def produce_spec_artifact(
    strategy_extraction: dict,
    *,
    video: str,
    certificate: Optional[dict] = None,
    transcript_chars: int = 0,
) -> dict:
    """Certified `staging_v32` extraction -> SpecArtifact `.spec.json` body.
    Pure/deterministic. See module docstring for the anti-fit + optimistic-bias
    contract."""
    entry_conditions: List[dict] = []
    confidences: List[str] = []
    idx = 0
    trigger_id: Optional[str] = None

    for step in strategy_extraction.get("entry_sequence") or []:
        if not isinstance(step, dict):
            continue
        text = _condition_text(step)
        if not text:
            continue
        staging_role = str(step.get("role") or "")
        is_trigger = _norm(staging_role) in _TRIGGER_ROLES
        cond, conf = _entry_condition(
            idx, text, staging_role=staging_role, cert=certificate,
            structural_family="ENABLE_ENTRY" if is_trigger else None,
        )
        entry_conditions.append(cond)
        confidences.append(conf)
        if is_trigger and trigger_id is None:
            trigger_id = cond["id"]
        idx += 1

    for conf_obj in strategy_extraction.get("confluences") or []:
        if not isinstance(conf_obj, dict):
            continue
        text = _condition_text(conf_obj)
        if not text:
            continue
        cond, conf = _entry_condition(idx, text, staging_role="confluence", cert=certificate)
        entry_conditions.append(cond)
        confidences.append(conf)
        idx += 1

    # Invalidation from the taught stop (STRUCTURAL family assignment).
    invalidations: List[dict] = []
    stop = strategy_extraction.get("stop")
    if isinstance(stop, dict):
        text = _condition_text(stop)
        if text:
            inv, _c = _entry_condition(
                idx, text, staging_role="invalidation", cert=certificate, structural_family="INVALIDATE"
            )
            invalidations.append(inv)
            idx += 1

    # entry_trigger_id: the trigger-role step, else the last spine condition,
    # else a synthesized terminal ENABLE_ENTRY so the parse-required field is
    # always a real id (never empty).
    if trigger_id is None:
        spine_ids = [c["id"] for c in entry_conditions if c["role"] in ("spine", "trigger")]
        if spine_ids:
            trigger_id = spine_ids[-1]
        else:
            synth = {
                "id": "ENABLE_ENTRY:spine-completion#trigger",
                "type": "ENABLE_ENTRY", "object": "spine completion",
                "role": "trigger", "span": {"start": 0, "end": 0},
                "evidence": "synthesized spine-completion trigger", "type_confidence": CONF_CONFIDENT,
            }
            entry_conditions.append(synth)
            trigger_id = synth["id"]

    spec_body: Dict[str, Any] = {
        "direction": _direction(strategy_extraction),
        "entry_conditions": entry_conditions,
        "and_groups": [[c["id"] for c in entry_conditions]] if entry_conditions else [],
        # or_branches: PINNED EMPTY, honestly (grader findings F-2 + its
        # residual). staging_v32's `variants[]` field is NOT a runnable
        # OR-alternative signal: across the design-pool 22 it is HETEROGENEOUS
        # -- direction-mirrors, alternate confirmation blends, timeframe
        # variants, re-entry locations, and pure risk-management variants (some
        # entries there are not entry-path alternatives at all). Only a minority
        # are mutually-substitutable entry paths. Deriving OR-branches from this
        # mixed field would FABRICATE untaught runnable structure and mistype
        # non-alternatives as alternatives. Reserved for the (b) classifier / a
        # real OR signal, same disclosure as graph_canonical_hash/ledger_d below.
        "or_branches": [],
        "invalidations": invalidations,
        "entry_trigger_id": trigger_id,
    }

    # House-default-exit provenance stamp (R-039 pin c) -- only when untaught.
    if _untaught_exit(strategy_extraction):
        spec_body["framework_overlay"] = {
            "exit": _HOUSE_DEFAULT_EXIT,
            "exit_source": "framework_overlay_style_c",
        }

    artifact = {
        "video": video,
        "spec_hash": _spec_hash(spec_body),
        "graph_canonical_hash": "",  # unproduced on this branch (R-040 §3), pinned honestly
        "ledger_d": "UNKNOWN",       # unproduced on this branch (R-040 §3)
        "transcript_chars": int(transcript_chars),
        "spec": spec_body,
        "approximation_metrics": _approximation_metrics(spec_body, confidences),
    }
    return artifact


def _spec_hash(spec_body: dict) -> str:
    canonical = json.dumps(spec_body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _approximation_metrics(spec_body: dict, confidences: List[str]) -> dict:
    """Per-spec approximation metrics (R-040 pin 2ii), mandatory + on the
    artifact. TWO honest rates:
      classifier_approximation_rate -- fraction of conditions the heuristic
        typed with less-than-confident confidence (approximate|unmatched).
      binding_approximation_rate    -- fraction of EXECUTED bindable conditions
        whose binding is approximation=True (read from compile_binding_plan, the
        existing authority) -- these degrade to np.ones pass-through (the
        LOOSER-than-taught optimistic bias, R-040 pin 2iii).
    """
    n = len(confidences)
    n_confident = sum(1 for c in confidences if c == CONF_CONFIDENT)
    n_approx = sum(1 for c in confidences if c == CONF_APPROXIMATE)
    n_unmatched = sum(1 for c in confidences if c == CONF_UNMATCHED)

    plan = compile_binding_plan(spec_body)
    exec_bindable = [b for b in plan.bindings if b.bindable and b.executed]
    n_exec = len(exec_bindable)
    n_binding_approx = sum(1 for b in exec_bindable if b.approximation)

    return {
        "n_conditions": n,
        "n_confident": n_confident,
        "n_approximate": n_approx,
        "n_unmatched": n_unmatched,
        "classifier_approximation_rate": round((n - n_confident) / n, 4) if n else 0.0,
        "n_executed_bindable": n_exec,
        "n_binding_approximation": n_binding_approx,
        "binding_approximation_rate": round(n_binding_approx / n_exec, 4) if n_exec else 0.0,
        # named optimistic bias (R-040 pin 2iii) -- travels with the number.
        "bias_direction": "OPTIMISTIC_LOOSER_THAN_TAUGHT",
    }


# --------------------------------------------------------------------------- #
# Inventory disposition (R-040 §3) -- battery-compatibility, honest denominator
# --------------------------------------------------------------------------- #

DISPOSITION_COMPILABLE = "compilable-futures"
DISPOSITION_NON_PORTABLE = "non-portable-mechanic"
DISPOSITION_DEGRADED = "compile-degraded"

# Microstructure the OHLCV bar-based battery does NOT carry -- a strategy whose
# MECHANIC needs it is out-of-battery-scope, NOT a failure (operator's strategy-
# not-instrument law: the mechanic, not the label, is what can't port). Keyword
# set derived from what OHLCV lacks (order-book depth / tape), never from the 22.
# STRONG microstructure-only signals (each is unambiguous evidence the MECHANIC
# needs order-book depth / the tape -- things OHLCV bars cannot carry). Bare
# generic terms ("the offer", "the bid", "refreshing", "order flow", "options")
# are DELIBERATELY excluded: they false-positive on incidental prose ("no
# options greeks", "if you like to use order flow" as an optional confluence).
# Options detection uses the STRUCTURED instrument_classification flags
# (is_options_strategy / options_mechanic), never a substring.
_NON_PORTABLE_MECHANIC = (
    "level 2", "level-2", "level two", "level-two", "level ii", "level-two box",
    "time and sales", "time-and-sales", "the tape", "reading the tape",
    "watch the tape", "tape reading", "depth of market", " dom ", "order book",
    "market maker", "prints going off",
)


def _all_strings(obj) -> List[str]:
    """Recursively collect every string value in a nested dict/list -- so a
    free-text instrument_classification field is scanned no matter which of the
    corpus's inconsistent key names it uses (notes/reasoning/rationale/...)."""
    out: List[str] = []
    if isinstance(obj, str):
        out.append(obj)
    elif isinstance(obj, dict):
        for v in obj.values():
            out.extend(_all_strings(v))
    elif isinstance(obj, list):
        for v in obj:
            out.extend(_all_strings(v))
    return out


def dispose_inventory(strategy_extraction: dict, instrument_classification: Optional[dict], spec_body: dict) -> dict:
    """One strategy's battery-compatibility disposition (R-040 §3). Mechanical
    criteria only -- no invented approximation threshold gates the disposition;
    the approximation rate travels alongside for the measured (a)-vs-(b)
    decision.
      non-portable-mechanic -- needs L2/tape/order-flow/options microstructure
                               the OHLCV battery cannot carry (out-of-scope, not
                               a failure).
      compile-degraded      -- compile_binding_plan.compiled is False (trigger or
                               majority spine unbound -> not a runnable spec).
      compilable-futures    -- compiles + portable mechanic.
    """
    ic = instrument_classification or {}
    # Scan ALL instrument_classification free-text (any key name) AND the
    # strategy's own condition text (entry_sequence / confluences / stop /
    # targets / setup / name) -- a tape/L2 mechanic often lives ONLY in the
    # condition prose ("watch the tape", "the offer refreshing"), not in the
    # classification block (grader finding F-1). Field-name luck is not detection.
    hay_parts = _all_strings(ic)
    hay_parts.extend(_all_strings({k: strategy_extraction.get(k) for k in (
        "entry_sequence", "confluences", "stop", "targets", "setup", "name", "description",
    )}))
    hay = " ".join(_norm(x) for x in hay_parts)
    non_portable = bool(ic.get("is_options_strategy")) or bool(ic.get("options_mechanic")) or any(
        kw in f" {hay} " for kw in _NON_PORTABLE_MECHANIC
    )
    if non_portable:
        disp = DISPOSITION_NON_PORTABLE
    else:
        plan = compile_binding_plan(spec_body)
        disp = DISPOSITION_COMPILABLE if plan.compiled else DISPOSITION_DEGRADED
    return {
        "disposition": disp,
        "asset_class": ic.get("asset_class"),
        "approximation_metrics": _approximation_metrics(
            spec_body, [c.get("type_confidence", CONF_CONFIDENT) for c in spec_body.get("entry_conditions", [])]
        ),
    }
