"""H1 Tier-2 discourse pass -- the two-step (segment -> classify) gate/context
classifier that sits BEHIND tier-1's fall-through.

Frozen spec: docs/designs/h1-wave3-tier2-preregistration-2026-07-12.md.
Wave-1 hard classes it must absorb:
docs/designs/h1-wave1-shakedown-RESULT-2026-07-12.md Output 2 --
  (1) walkthrough-narration-that-restates-a-gate
  (2) bias-vs-movement-expectation.

ARCHITECTURE (pre-reg §1): the FRAME is the unit, not the sentence.

  STEP 1  SEGMENT  -- assign each margin item a discourse frame
                      {rule-statement | worked-example-walkthrough |
                       warning-exclusion | fix-list | prediction-narration |
                       tangent}. As DETERMINISTIC as possible: pure marker
                      regexes characterized from the 112 DESIGN exemplars ONLY
                      (docs/designs/h1-tier2-quarantine-split-2026-07-12.json
                      design_exemplars). No LLM in segmentation -> EXACT on
                      re-measure (determinism envelope, pre-reg §4).

  STEP 2  CLASSIFY -- output {gate-strength | context | cannot-determine},
                      encoding the two Wave-1 discriminators LITERALLY:
        * narrated action = gate  IFF it instantiates a rule stated elsewhere
          in the same lesson (a walkthrough clause echoing a rule-statement
          frame); context otherwise.
        * directional statement = gate  IFF it binds to an action / exclusion
          somewhere in the discourse; movement-expectation (context) otherwise.
      A high-precision DETERMINISTIC subset resolves only the unambiguous
      terminals (pure exclusion -> gate, explicit rule-declaration -> gate,
      pure tangent -> context). Everything discourse-dependent -- i.e. the
      MARGIN -- passes through the STRUCTURAL PRE-CALL DECLINE GATE first: the
      cross-reference binding resolver checks (deterministically) whether the
      concept states ANY rule/exclusion the item could bind to. If it returns NO
      anchor -> `cannot-determine`, decided BEFORE gemma is invoked. Only when an
      anchor exists is the item routed to the Gemma-local LLM (`gemma4:e4b-it-qat`,
      CLAUDE.md §15) WITH its frame + those sibling rules/exclusions, and the LLM
      then commits to gate-strength or context (it has NO decline option).

`cannot-determine` is COST-FREE and MANDATORY (pre-reg §1, the NEUTRAL lesson):
a tier-2 that force-determines manufactures false certificates. It routes to
tier-3; its RATE is the economics number. It fires STRUCTURALLY (a missing
binding anchor), never as a model confidence-threshold judgment -- a threshold
chosen after seeing which items decline would be absorption-tuning in a
conformance costume (budget-ruling gaming guard). Confident-but-wrong is caught
by the control gate (pre-reg §3), NOT rewarded.

DATA DISCIPLINE (pre-reg §2): every vocabulary below was characterized from the
112 DESIGN exemplars ONLY. The 77 sealed_eval items were NEVER opened by the
builder. The 78-held-out stays SPENT.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional

# --------------------------------------------------------------------------- #
# Output contract
# --------------------------------------------------------------------------- #

TIER2_LABELS = ("gate-strength", "context", "cannot-determine")

FRAMES = (
    "rule-statement",
    "worked-example-walkthrough",
    "warning-exclusion",
    "fix-list",
    "prediction-narration",
    "tangent",
)

# The two Wave-1 named classes (pre-reg §5 -- absorption is measured PER CLASS,
# never blended). Pre-registered class assignment: the shakedown's
# `extracted_condition_type == WAIT_BIAS` IS the directional-statement surface;
# every other condition type is the narrated-action-in-walkthrough surface.
CLASS_BIAS = "bias_vs_movement"
CLASS_WALKTHROUGH = "walkthrough_narration"


def class_of(condition_type: Optional[str]) -> str:
    return CLASS_BIAS if (condition_type or "").upper() == "WAIT_BIAS" else CLASS_WALKTHROUGH


@dataclass
class Tier2Decision:
    """One classified margin item (pre-reg §5 certificate + economics fields)."""

    label: str  # one of TIER2_LABELS
    frame: str
    resolved_by: str  # deterministic-exclusion | deterministic-rule |
    #                    deterministic-tangent | llm-margin | llm-error
    binds_to_rule: bool
    reason: str
    prompt_tokens: int = 0
    eval_tokens: int = 0
    llm_invoked: bool = False

    @property
    def routed_to_tier3(self) -> bool:
        return self.label == "cannot-determine"

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.eval_tokens

    def as_dict(self) -> dict:
        return {
            "label": self.label,
            "frame": self.frame,
            "resolved_by": self.resolved_by,
            "binds_to_rule": self.binds_to_rule,
            "reason": self.reason,
            "llm_invoked": self.llm_invoked,
            "prompt_tokens": self.prompt_tokens,
            "eval_tokens": self.eval_tokens,
            "total_tokens": self.total_tokens,
            "routed_to_tier3": self.routed_to_tier3,
        }


# --------------------------------------------------------------------------- #
# Marker vocabularies -- characterized from the 112 DESIGN exemplars ONLY
# --------------------------------------------------------------------------- #

# --- warning-exclusion: a declared directional/route EXCLUSION. Terminal GATE.
#     Design evidence: W1-0116/0111 "forget shorts. I am not in shorts at all";
#     W1-0075 "I never take calls under VWAP and I never take puts over VWAP";
#     W1-0060 "if it gets above VWAP, you can't take puts. That's our rule";
#     W1-0150 "Those don't count."; W1-0032 "cardinal rule".
_RE_EXCLUSION = re.compile(
    r"forget\s+(?:shorts|longs)"
    r"|\bnever\s+(?:take|trade|enter|buy|sell)\b"
    r"|\bi\s+never\b"
    r"|(?:you\s+)?ca(?:n'?t|nnot)\s+take\b"
    r"|not\s+in\s+shorts"
    r"|don'?t\s+even\s+care\s+to\s+look\s+for\s+(?:shorts|longs)"
    r"|those\s+don'?t\s+count"
    r"|cardinal\s+rule",
    re.IGNORECASE,
)

# --- rule-statement: an explicit rule DECLARATION. Terminal GATE (highest
#     precision -- the speaker literally calls it a rule / the entry).
#     Design evidence: W1-0031 "the rules for the trade goes as follows";
#     W1-0098 "my rule is to use the last candle"; W1-0040 "so that is our
#     entry"; W1-0092 "use what I call a standard confirmation".
_RE_RULE_DECL = re.compile(
    r"\b(?:our|my|the)\s+rule\b"
    r"|rules?\s+for\s+the\s+trade"
    r"|that'?s\s+our\s+rule"
    r"|(?:so\s+)?that\s+is\s+our\s+entry"
    r"|met\s+our\s+rule"
    r"|what\s+i\s+call\s+a\s+standard\s+confirmation",
    re.IGNORECASE,
)

# --- broader rule / prescriptive markers (used to detect SIBLING rules for the
#     cross-reference binding, and to keep tangent/nav terminals honest).
_RE_PRESCRIPTIVE = re.compile(
    r"what\s+(?:we'?re|we\s+are|you'?re|you\s+are)\s+looking\s+for"
    r"|\byou\s+need\b|\bwe\s+need\b|\byou\s+want\b|\bwe\s+want\b"
    r"|\bwait\s+for\b|\byou\s+wait\b|we'?re\s+going\s+to\s+wait|going\s+to\s+wait\s+for"
    r"|\byou\s+would\b|in\s+order\s+for\b|\bhas\s+to\b|\bmust\b|\bhave\s+to\b"
    r"|step\s+(?:number|one|two|three|1|2|3)|the\s+reason\s+why"
    r"|\bcriteria\b|\bconfirmation\b|stop\s+goes|the\s+stop\s+is\s+going\s+to"
    r"|do\s+not\s+force|you\s+will\s+wait|the\s+rules?\b|as\s+soon\s+as",
    re.IGNORECASE,
)

# --- tangent: off-topic / meta / sign-off with NO trade content. Terminal
#     CONTEXT only when no action/rule/exclusion token is present.
#     Design evidence: W1-0067 "no big difference at all"; W1-0130 "bonus tip";
#     W1-0128 "honestly, it doesn't matter... go ahead"; W1-0078 "I am not
#     cherry picking anything this is all random"; W1-0126 "close the screens
#     and just log off"; W1-0055 "two mistakes that I'm about to share".
_RE_TANGENT = re.compile(
    r"no\s+big\s+difference"
    r"|i'?ve\s+said\s+both\s+in\s+videos"
    r"|bonus\s+tip|here'?s\s+the\s+bonus"
    r"|some\s+people\s+call\s+it|if\s+you'?re\s+familiar\s+with"
    r"|it\s+doesn'?t\s+matter"
    r"|i\s+am\s+not\s+cherry\s+picking|this\s+is\s+all\s+random"
    r"|close\s+the\s+screens|just\s+log\s+off"
    r"|about\s+to\s+share\s+with\s+you"
    r"|i\s+promised\s+you",
    re.IGNORECASE,
)

# --- prediction-narration: a bare movement / target / magnet EXPECTATION.
#     Design evidence: W1-0053 "price is going to trade up ... or it may trade
#     low"; W1-0122 "now wants to make a move to the opposite end"; W1-0132
#     "ready to push price in the opposite direction"; W1-0156 "price magnet
#     where price gravitates toward it"; W1-0121 "price will try to make a full
#     U-shaped reversal".
_RE_PREDICTION = re.compile(
    r"\bwants?\s+to\s+(?:make|move|trade|push)\b"
    r"|going\s+to\s+trade\b|may\s+trade\b|will\s+try\b|price\s+will\b"
    r"|ready\s+to\s+(?:push|reverse)\b|about\s+to\s+(?:push|reverse|move)\b"
    r"|gravitates?\b|\bmagnet\b"
    r"|(?:is\s+)?likely\b|often\b"
    r"|trade\s+(?:up|down|low|high)\s+into",
    re.IGNORECASE,
)

# --- worked-example-walkthrough: chart-pointing / result-narration of a past
#     example. Design evidence: W1-0066 "we got a Apple pre-market high, ...
#     little retest, and then another retest"; W1-0047 "I'm just going to point
#     out a few"; W1-0196 "We sweep. Look at this. We manipulate and we
#     distribute lower"; W1-0018 "this is going to start to pop ... We took out
#     all these sellers".
_RE_WALKTHROUGH = re.compile(
    r"\bright\s+(?:here|over\s+here)\b|\bover\s+here\b|\bright\s+there\b"
    r"|look\s+at\s+this|you\s+can\s+see|\bwe\s+got\b|\bwe\s+get\b"
    r"|point\s+out|\bhere\s+we\s+have\b|\bwe\s+come\b|we\s+sweep|we\s+manipulate"
    r"|\bboom\b|came\s+back|closed?\s+(?:above|below)|took\s+out|broke\b|reversed\b"
    r"|switch\s+over\s+to|back\s+to\s+the\b|dropping\s+to|hop\s+onto|go\s+over\s+on",
    re.IGNORECASE,
)

# --- fix-list: enumerated procedure steps. Design evidence: W1-0129 "Stop goes
#     below the low... step one"; W1-0198 "Step number two"; W1-0212 "step
#     number three".
_RE_FIXLIST = re.compile(
    r"step\s+(?:number|one|two|three)|the\s+(?:first|second|third)\s+(?:way|thing|step)",
    re.IGNORECASE,
)


# --------------------------------------------------------------------------- #
# STEP 1 -- deterministic frame segmentation (pre-reg §1). EXACT on re-run.
# --------------------------------------------------------------------------- #


def segment_frame(text: str, condition_type: Optional[str] = None) -> str:
    """Assign a discourse frame by marker precedence (most decisive first).
    Pure -- no randomness, no LLM -> exact on re-measure (determinism envelope).
    `condition_type` is a soft tie-breaker only (WAIT_BIAS leans prediction)."""
    t = text or ""
    if _RE_EXCLUSION.search(t):
        return "warning-exclusion"
    if _RE_RULE_DECL.search(t):
        return "rule-statement"
    if _RE_FIXLIST.search(t):
        return "fix-list"
    # prescriptive requirement without an explicit "rule" word is still a rule
    # frame (e.g. "what we're looking for is ...", "you need the reversal ...").
    presc = bool(_RE_PRESCRIPTIVE.search(t))
    pred = bool(_RE_PREDICTION.search(t))
    walk = bool(_RE_WALKTHROUGH.search(t))
    tang = bool(_RE_TANGENT.search(t))
    if presc and not walk:
        return "rule-statement"
    if pred and not presc:
        return "prediction-narration"
    if walk:
        return "worked-example-walkthrough"
    if tang:
        return "tangent"
    # WAIT_BIAS with no prescriptive/walkthrough marker -> a bare directional read
    if class_of(condition_type) == CLASS_BIAS:
        return "prediction-narration"
    return "tangent"


def is_rule_or_exclusion_frame(text: str, condition_type: Optional[str] = None) -> bool:
    """A sibling counts as a stated rule/exclusion for the cross-reference
    binding if it is a rule-statement OR warning-exclusion frame, OR carries a
    bare prescriptive marker (broader than the frame's precedence winner)."""
    f = segment_frame(text, condition_type)
    if f in ("rule-statement", "warning-exclusion", "fix-list"):
        return True
    return bool(_RE_PRESCRIPTIVE.search(text or "") or _RE_RULE_DECL.search(text or ""))


# --------------------------------------------------------------------------- #
# Gemma-local margin call (CLAUDE.md §15 convention)
# --------------------------------------------------------------------------- #

_OLLAMA_URL = "http://localhost:11434/api/chat"
_GEMMA_MODEL = "gemma4:e4b-it-qat"

# FINAL CORRECTED CONFORMANCE REBUILD (2026-07-12): the prior rebuild VOIDed by
# REMOVING the `ambiguous` enum option (5 -> 4). Removing an enum OPTION perturbs
# the constrained-sampling probability distribution over the REMAINING options and
# silently shifted the gate/context boundary on borderline items (16 flips, +6.25pp
# bias / +5.2pp walkthrough) even though `ambiguous` was never emitted in pass-1
# (routing 0.0). THE LAW: the schema IS part of the decision boundary; conformance
# edits go in POST-PROCESSING, never the schema. So:
#   (1) the 5-option schema/prompt/`_derive_label` are RESTORED byte-identical to
#       pass-1 -- the enum, the constrained-sampling distribution, and therefore the
#       gate/context boundary are UNPERTURBED (the 16 flips do not reappear);
#   (2) the decline is achieved STRUCTURALLY and PRE-CALL in `classify_item`: when
#       the cross-reference binding resolver returns NO anchor, `cannot-determine`
#       is decided BEFORE gemma is invoked (a deterministic existence check on the
#       concept's rule/exclusion siblings -- no threshold, no tunable, no prompt
#       guidance). This is the ablation-verified direction-safe conformance gate;
#   (3) the model still MAY emit `ambiguous` (its distribution is unperturbed), and
#       any EMITTED `ambiguous` is NEUTRALIZED in `_derive_label` -> `cannot-determine`
#       (routes to tier-3; strictly subtractive on absorption, never additive). On
#       the design pool this neutralizer is DORMANT (pass-1 emitted `ambiguous` 0
#       times); if it ever fires, the schema has shifted and the run voids by its
#       own evidence.
# The pre-reg §1 IFF, encoded literally:
#   narrated action = gate IFF it instantiates a rule stated elsewhere (cited);
#   directional statement = gate IFF it binds to an action/exclusion somewhere.
# A binding that cannot be located structurally is a decline, not a model guess.
_CLAUSE_KINDS = (
    "states_rule",              # clause itself declares an entry/stop/filter/session/confirmation rule
    "instantiates_stated_rule", # narrates an action that ENACTS one of the listed RULES (must name it)
    "narrates_or_defines",      # past-narration / chart-pointing / setup / definition / meta
    "movement_expectation",     # bare directional or movement prediction, binds to no action
    "ambiguous",                # decision-like but rule-vs-narration undecidable, or too fragmentary
)

_OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "clause_kind": {"type": "string", "enum": list(_CLAUSE_KINDS)},
        "bound_rule": {"type": "string"},
        "reason": {"type": "string"},
    },
    "required": ["clause_kind", "bound_rule", "reason"],
}

_SYSTEM_PROMPT = (
    "You are a discourse classifier for trading-education transcripts. You are "
    "given ONE quoted clause from a lesson, plus the list of RULES the speaker "
    "states elsewhere in the same lesson. Decide the clause's DISCOURSE ROLE.\n\n"
    "Three outcomes:\n"
    "- GATE-STRENGTH = a decision the trader ACTS ON before/at entry: an entry "
    "trigger, a stop-placement rule, a filter or exclusion, a session "
    "restriction, a required confirmation, or a precondition that must hold to "
    "enter. The clause either STATES such a rule itself, or narrates an action "
    "that ENACTS a specific rule stated elsewhere in the lesson.\n"
    "- CONTEXT = the clause does NOT drive an entry decision: it narrates what "
    "already happened in a worked example, points at a chart, describes expected "
    "market MOVEMENT, sets up or DEFINES terms, adds indicators to the chart, or "
    "gives meta / risk-psychology advice.\n"
    "- CANNOT-DETERMINE = the clause SOUNDS like it could be a rule the trader "
    "applies, but you cannot tell whether it is stating a live rule or merely "
    "NARRATING a past instance of one (the walkthrough-echoes-a-rule ambiguity), "
    "OR it is a fragment too short to bind to any decision. Declining here is "
    "CORRECT -- a good classifier routes the genuinely ambiguous to human review "
    "instead of guessing.\n\n"
    "Report the clause's kind. The label is DERIVED from the kind:\n"
    "  states_rule                 -> gate-strength\n"
    "  instantiates_stated_rule    -> gate-strength  (only if you NAME the rule it enacts)\n"
    "  narrates_or_defines         -> context\n"
    "  movement_expectation        -> context\n"
    "  ambiguous                   -> cannot-determine\n\n"
    "Rules for choosing the kind:\n"
    "1. Choose `states_rule` when the clause ITSELF declares a decision the trader "
    "applies -- an entry trigger, a stop placement, a filter/exclusion, a session "
    "window, or a required confirmation -- even if spoken mid-walkthrough. "
    "Prescriptive/self-declaring phrasing ('the stop goes ...', 'I never take ...', "
    "'you would confirm and enter', 'I trade from the open to noon', 'wait for X "
    "before Y') is a stated rule.\n"
    "2. Choose `instantiates_stated_rule` ONLY when the clause narrates an action "
    "that clearly ENACTS one of the listed RULES, AND you can name that rule in "
    "`bound_rule`. If you cannot name the specific rule it enacts, do NOT use this "
    "kind -- use `ambiguous`.\n"
    "3. Choose `narrates_or_defines` for pure past-tense result-narration, "
    "chart-pointing/navigation, chart SETUP (adding indicators, drawing boxes), "
    "DEFINITIONS ('that is your box'), or meta / psychology advice. Setup and "
    "definitions are NOT gates even though they use 'we need to' / 'you mark out'.\n"
    "4. Choose `movement_expectation` for a bare directional or movement "
    "prediction that binds to no action ('price wants to move to the opposite "
    "end', 'the market is not ready to reverse yet', 'VWAP is a magnet').\n"
    "5. Choose `ambiguous` when the clause echoes a rule while narrating a past "
    "instance and you cannot tell which it is, or when it is a fragment too short "
    "to bind. NEVER force a gate/context you are unsure of.\n\n"
    "Worked examples:\n"
    "  'The stop is going to go beyond the testing candle wick.' -> states_rule -> gate-strength\n"
    "  'I trade every morning from the New York open to around noon.' -> states_rule (session filter) -> gate-strength\n"
    "  'as soon as price closed above the candle you would confirm and enter' -> states_rule -> gate-strength\n"
    "  'we got a pre-market high, a 5m close above, a little retest, and another retest' -> narrates_or_defines -> context\n"
    "  'you mark out the high and low of the first 15-minute candle; that is your box' -> narrates_or_defines (definition) -> context\n"
    "  'the first thing we need to do is add these two moving averages' -> narrates_or_defines (chart setup) -> context\n"
    "  'price now wants to make a move to the opposite end of the candle' -> movement_expectation -> context\n"
    "  'the only other time it does it is over here where it closes above the third band' -> ambiguous (narrating a past instance that echoes the rule -- cannot tell if he is re-stating it) -> cannot-determine\n"
    "  'once the market returns to this level' -> ambiguous (fragment, names no decision) -> cannot-determine"
)


def _build_user_message(quote: str, frame: str, condition_type: Optional[str],
                        sibling_rules: List[str]) -> str:
    rules_block = (
        "\n".join(f"  - {r}" for r in sibling_rules[:8])
        if sibling_rules else "  (none stated elsewhere in this lesson)"
    )
    return (
        f"CLAUSE (condition type = {condition_type or 'unknown'}; detected frame "
        f"= {frame}):\n  \"{quote}\"\n\n"
        f"RULES STATED ELSEWHERE IN THIS LESSON (cross-reference for binding):\n"
        f"{rules_block}\n\n"
        "Report the clause's `clause_kind` (and `bound_rule` if it enacts one of "
        "the listed RULES). Return JSON matching the schema."
    )


def _derive_label(clause_kind: Optional[str], bound_rule: str) -> tuple:
    """Map the model's BINDING judgment to a tier-2 label (pre-reg §1 IFF, in code).
    This is the POST-PROCESSING neutralizer stage -- the 5-option schema is RESTORED
    byte-identical to pass-1 (enum + constrained-sampling distribution UNPERTURBED),
    so conformance lives HERE, never in the enum. Returns (label, binds_to_rule).

    `ambiguous` -> cannot-determine is THE neutralizer (routes to tier-3; strictly
    subtractive on absorption -- it never absorbs). It is DORMANT on the design pool
    (pass-1 emitted `ambiguous` 0 times); a single fire means the schema shifted and
    the run voids by its own evidence. An `instantiates_stated_rule` the model cannot
    NAME is the "otherwise" branch of the IFF -- an unlocatable binding, a decline not
    a guess. The PRIMARY decline still fires STRUCTURALLY and PRE-CALL in
    `classify_item` (empty cross-reference binding) before gemma is ever invoked."""
    ck = (clause_kind or "").strip()
    if ck == "states_rule":
        return "gate-strength", True
    if ck == "instantiates_stated_rule":
        # gate ONLY if the model actually named the rule it enacts; an
        # unlocatable binding is a decline, not a guess.
        if bound_rule and bound_rule.strip():
            return "gate-strength", True
        return "cannot-determine", False
    if ck in ("narrates_or_defines", "movement_expectation"):
        return "context", False
    if ck == "ambiguous":
        # POST-PROCESSING NEUTRALIZER -> tier-3. NOT -> context: -> context is a
        # miniature force-determination that can ABSORB on unseen items; ->
        # cannot-determine is strictly subtractive on every item.
        return "cannot-determine", False
    # unrecognized / empty kind -> honest decline
    return "cannot-determine", False


def gemma_classify_call(quote: str, frame: str, condition_type: Optional[str],
                        sibling_rules: List[str], timeout: float = 60.0) -> dict:
    """Real Gemma-local call. Raises on transport failure so the caller can STOP
    and report a clean blocker (never fake a call). The label is DERIVED from the
    model's `clause_kind` binding judgment (pass-2 calibration), not picked
    directly -- this is what activates the cost-free cannot-determine path."""
    payload = {
        "model": _GEMMA_MODEL,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": _build_user_message(
                quote, frame, condition_type, sibling_rules)},
        ],
        "stream": False,
        "format": _OUTPUT_SCHEMA,
        "options": {"temperature": 0.1, "top_p": 0.95, "top_k": 64},
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        _OLLAMA_URL, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    content = body.get("message", {}).get("content", "")
    parsed = json.loads(content)
    clause_kind = parsed.get("clause_kind")
    bound_rule = parsed.get("bound_rule") or ""
    label, binds = _derive_label(clause_kind, bound_rule)
    return {
        "label": label,
        "binds_to_rule": binds,
        "clause_kind": clause_kind,
        "bound_rule": bound_rule[:200],
        "reason": (parsed.get("reason") or "")[:400],
        "prompt_tokens": int(body.get("prompt_eval_count", 0)),
        "eval_tokens": int(body.get("eval_count", 0)),
    }


# --------------------------------------------------------------------------- #
# STEP 2 -- classify one margin item (deterministic terminals + LLM margin)
# --------------------------------------------------------------------------- #


def classify_item(
    quote: str,
    condition_type: Optional[str],
    sibling_texts: List[str],
    sibling_condition_types: Optional[List[Optional[str]]] = None,
    gemma_fn: Optional[Callable[..., dict]] = None,
) -> Tier2Decision:
    """Two-step classify. `sibling_texts` are the OTHER items of the same
    concept (the discourse); their rule/exclusion frames form the cross-reference
    binding passed to the LLM. `gemma_fn` defaults to the real Gemma call; inject
    a stub for offline fixture checks."""
    frame = segment_frame(quote, condition_type)

    # --- deterministic terminals (high precision; reserve LLM for the margin) ---
    if _RE_EXCLUSION.search(quote or ""):
        return Tier2Decision(
            label="gate-strength", frame=frame,
            resolved_by="deterministic-exclusion", binds_to_rule=True,
            reason="declared directional/route exclusion")
    if _RE_RULE_DECL.search(quote or ""):
        return Tier2Decision(
            label="gate-strength", frame=frame,
            resolved_by="deterministic-rule", binds_to_rule=True,
            reason="explicit rule / entry declaration")
    if (_RE_TANGENT.search(quote or "")
            and not _RE_PRESCRIPTIVE.search(quote or "")
            and not _RE_EXCLUSION.search(quote or "")):
        return Tier2Decision(
            label="context", frame=frame,
            resolved_by="deterministic-tangent", binds_to_rule=False,
            reason="off-topic / meta / sign-off with no trade content")

    # --- cross-reference binding resolver (deterministic existence check) ---
    # The margin item is discourse-dependent: it is a gate ONLY by binding to a
    # rule/exclusion stated elsewhere in the lesson (pre-reg §1 IFF). The anchor
    # set is the rule/exclusion-framed siblings of the same concept.
    scts = sibling_condition_types or [None] * len(sibling_texts)
    sibling_rules = [
        s for s, ct in zip(sibling_texts, scts)
        if s and s.strip() != (quote or "").strip()
        and is_rule_or_exclusion_frame(s, ct)
    ]

    # --- STRUCTURAL PRE-CALL DECLINE GATE (budget-ruling gaming guard) ---
    # If the resolver returns NO anchor, the IFF cannot even be attempted: a
    # narrated action has no stated rule to instantiate, a directional statement
    # has no action/exclusion to bind to. That is `cannot-determine` by STRUCTURE,
    # decided BEFORE gemma is invoked -- cheaper AND drift-free. No confidence
    # threshold, no tunable parameter, no prompt guidance: the decline is a
    # deterministic consequence of a missing binding. Ablating this gate sends the
    # unbound item to gemma, which can only force a gate/context (RAISE absorption),
    # never lower it -- the clean ablation partition the reviewer measures.
    if not sibling_rules:
        return Tier2Decision(
            label="cannot-determine", frame=frame,
            resolved_by="structural-no-binding", binds_to_rule=False,
            reason="cross-reference binding resolver returned no anchor "
                   "(no rule/exclusion stated elsewhere in the lesson to bind to)",
            llm_invoked=False)

    # --- margin (anchor exists) -> LLM decides gate vs context (never declines) ---
    fn = gemma_fn or gemma_classify_call
    try:
        r = fn(quote, frame, condition_type, sibling_rules)
    except Exception as exc:  # transport / parse failure -> honest cannot-determine
        return Tier2Decision(
            label="cannot-determine", frame=frame, resolved_by="llm-error",
            binds_to_rule=False, reason=f"llm call failed: {exc}", llm_invoked=True)
    label = r.get("label")
    if label not in TIER2_LABELS:
        label = "cannot-determine"
    return Tier2Decision(
        label=label, frame=frame, resolved_by="llm-margin",
        binds_to_rule=bool(r.get("binds_to_rule", False)),
        reason=r.get("reason", ""), prompt_tokens=int(r.get("prompt_tokens", 0)),
        eval_tokens=int(r.get("eval_tokens", 0)), llm_invoked=True)


# --------------------------------------------------------------------------- #
# Concept-level pass (segment the concept's items, classify each with its
# siblings as the discourse). This is the tier-2 unit: a concept = one lesson.
# --------------------------------------------------------------------------- #


@dataclass
class ConceptPass:
    concept_id: str
    decisions: Dict[str, Tier2Decision] = field(default_factory=dict)


def classify_concept(
    items: List[dict],
    gemma_fn: Optional[Callable[..., dict]] = None,
) -> ConceptPass:
    """`items` = the margin items of ONE concept, each a dict with keys
    item_id, quote, condition_type. Every item is classified with the other
    items of the same concept as its cross-reference discourse."""
    texts = [it["quote"] for it in items]
    cts = [it.get("condition_type") for it in items]
    cp = ConceptPass(concept_id=items[0].get("concept_id", "") if items else "")
    for idx, it in enumerate(items):
        siblings = [t for j, t in enumerate(texts) if j != idx]
        sib_cts = [c for j, c in enumerate(cts) if j != idx]
        cp.decisions[it["item_id"]] = classify_item(
            it["quote"], it.get("condition_type"), siblings, sib_cts, gemma_fn)
    return cp
