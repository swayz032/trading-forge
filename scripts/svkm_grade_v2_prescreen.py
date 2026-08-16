"""sVkm GRADE v2 — SOURCE-FIDELITY PRE-SCREEN + ANTECEDENT BINDING (AR-1218 §6 / AR-1222 LANE G).

This is the REAL non-test caller the nine-point contract requires: it runs the committed
`source_fidelity_guard` and `evidence_antecedent` helpers over the actual pinned sVkm
extraction, on the versioned (v2) route.

🛑 WHAT IT IS NOT (contract point 8): the output is a PRE-SCREEN / EVIDENCE REQUEST, not a
semantic oracle and not a grade. `findings == []` means only "this heuristic detected no
inflation". It cannot certify anything and it cannot clear the frozen AR-1199 red certificate,
which this driver never touches (contract: "do not mutate frozen historical grade artifacts").

Generic-module discipline (contract point 9): all domain vocabulary — qualifier synonyms,
entity terms, definitional markers — lives HERE, in the conductor. `source_fidelity_guard.py`
and `evidence_antecedent.py` contain no source-specific string, and their own tests assert that.

Inputs, all already committed and pinned:
  * the extraction record            (extraction_sha256 c37ff26f…)
  * the pinned transcript fixture    (sha256 df72444f…)
  * grade/phase1.json                (anchored conditions -> their located char_span)
  * grade/laneA_locator_binding_diagnostic.json  (candidate spans for the unanchored ones)

Run from repo root:
  python scripts/svkm_grade_v2_prescreen.py
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from src.engine.extraction.evidence_antecedent import (  # noqa: E402
    Span,
    bind_qualifier_to_antecedent,
)
from src.engine.extraction.evidence_relevance import (  # noqa: E402
    evaluate_evidence_relevance,
)
from src.engine.extraction.source_fidelity_guard import (  # noqa: E402
    check_condition_fidelity,
)

TRANSCRIPT_PIN = "df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc"
EXTRACTION_PIN = "c37ff26f753449c35b6ec0402a3152dc287a8ae427eb0d86661b3fb43ec01823"

POP = os.path.join(ROOT, "docs", "replay-results", "svkm-extraction-certified")
GRADE = os.path.join(POP, "grade")
FIXTURE = os.path.join(ROOT, "src", "engine", "extraction", "fixtures",
                       "source-evidence", "sVkmZklJDHI.transcript.txt")

# --- domain vocabulary: HERE, never in the reusable modules -------------------
QUALIFIER = "initial"
QUALIFIER_SYNONYMS = ("first", "initial", "opening")
ENTITY_TERMS = ("range",)
DEFINITIONAL_MARKERS = ("mark", "draw", "define", "gives me", "gives us")
ANTECEDENT_START = "And what that now gives me is a range on the five minute."
ANTECEDENT_END = "that's how low it went."
REFERRING_SPAN = (9294, 9512)


def _resolve(strategy: dict, ref: str) -> str | None:
    """Resolve a condition_ref to its text.

    Handles BOTH shapes. The indexed form `entry_sequence[0].action` and the PLAIN form
    `stop.rationale` — an earlier version matched only the indexed one and therefore
    SILENTLY DROPPED `stop.rationale` from the screen. A pre-screen that quietly skips a
    condition reports a clean sheet it never earned, so unresolvable refs are now returned
    explicitly and counted rather than vanishing.
    """
    m = re.match(r"(\w+)\[(\d+)\]\.(\w+)$", ref)
    if m:
        arr, idx, field = m.group(1), int(m.group(2)), m.group(3)
        try:
            return strategy[arr][idx][field]
        except Exception:
            return None
    m = re.match(r"(\w+)\.(\w+)$", ref)
    if m:
        try:
            return strategy[m.group(1)][m.group(2)]
        except Exception:
            return None
    return None


def main() -> int:
    transcript = open(FIXTURE, encoding="utf-8", newline="").read()
    tsha = hashlib.sha256(transcript.encode("utf-8")).hexdigest()
    if tsha != TRANSCRIPT_PIN:
        print("ABORT: transcript fixture is not the pin — REFUSING.")
        return 2

    record = json.loads(open(os.path.join(POP, "sVkmZklJDHI.json"), encoding="utf-8").read())
    if record.get("extraction_sha256") != EXTRACTION_PIN:
        print("ABORT: extraction record is not the pin — REFUSING.")
        return 2
    strategy = record["extraction"]["strategies"][0]

    phase1 = json.loads(open(os.path.join(GRADE, "phase1.json"), encoding="utf-8").read())
    lane_a = json.loads(open(os.path.join(GRADE, "laneA_locator_binding_diagnostic.json"),
                             encoding="utf-8").read())

    # (condition_ref -> [quote, ...]) from BOTH evidence sources.
    evidence: dict[str, list[str]] = {}
    for outcome in phase1["strategies"][0]["condition_outcomes"]:
        span = outcome.get("char_span")
        if span:
            s, e = (span if isinstance(span, list) else json.loads(span))
            evidence.setdefault(outcome["condition_ref"], []).append(transcript[s:e])
    for res in lane_a["results"]:
        for cand in res["candidates"]:
            if cand.get("proposed_quote"):
                evidence.setdefault(res["condition_ref"], []).append(cand["proposed_quote"])

    print("=" * 78)
    print(f"sVkm GRADE v2 PRE-SCREEN — {len(evidence)} conditions carry locatable evidence")
    print("=" * 78)

    rows = []
    unresolved: list[str] = []
    for ref in sorted(evidence):
        cond_text = _resolve(strategy, ref)
        if not cond_text:
            unresolved.append(ref)
            print(f"[SKIP] {ref} — condition text could not be resolved from the extraction")
            continue
        # STAGE 2 — EVIDENCE RELEVANCE, before any fidelity judgement (AR-1224 §5).
        # A span that is not ABOUT this condition cannot be evidence for it, so asking
        # "did extraction inflate?" of an irrelevant quote is meaningless.
        rivals = [_resolve(strategy, r) for r in evidence if r != ref]
        rivals = [r for r in rivals if r]
        rel = [
            evaluate_evidence_relevance(cond_text, q, rivals, source_document=transcript)
            for q in evidence[ref]
        ]
        grounded = any(v.grounded for v in rel)

        # STAGE 3 — fidelity pre-screen (only meaningful on grounded evidence)
        findings = check_condition_fidelity(cond_text, evidence[ref])
        rows.append({
            "condition_ref": ref,
            "condition_text": cond_text,
            "quote_count": len(evidence[ref]),
            "relevance_grounded": grounded,
            "relevance_reasons": [v.reason for v in rel],
            "findings": [
                {"kind": f.kind, "clause": f.clause, "detail": f.detail} for f in findings
            ],
        })
        if not grounded:
            print(f"[MISGROUND] {ref}")
            print(f"            {rel[0].reason}")
            continue
        flag = "FLAG" if findings else "  ok"
        print(f"[{flag}] {ref}")
        for f in findings:
            print(f"         {f.kind}: {f.clause!r} — {f.detail}")

    # --- contract point 2: `initial` consumes the COMPOSED antecedent ---------
    a_start = transcript.find(ANTECEDENT_START)
    a_end = transcript.find(ANTECEDENT_END) + len(ANTECEDENT_END)
    binding = bind_qualifier_to_antecedent(
        transcript, QUALIFIER, QUALIFIER_SYNONYMS,
        Span(*REFERRING_SPAN), Span(a_start, a_end),
        ENTITY_TERMS, DEFINITIONAL_MARKERS,
    )
    print()
    print(f"[antecedent] qualifier {QUALIFIER!r} bound={binding.bound}")
    print(f"             {binding.reason}")

    flagged = [r for r in rows if r["findings"]]
    misgrounded = [r for r in rows if not r["relevance_grounded"]]
    artifact = {
        "artifact": "svkm-grade-v2-prescreen",
        "ruling": "AR-1218 §6 / AR-1222 LANE G",
        "status": "PRE-SCREEN / EVIDENCE REQUEST — NOT A GRADE, NOT A CERTIFICATE",
        "does_not_clear_red_certificate": True,
        "transcript_sha256": tsha,
        "extraction_sha256": record["extraction_sha256"],
        "conditions_with_evidence": len(evidence),
        "conditions_screened": len(rows),
        "conditions_unresolved": unresolved,
        "conditions_flagged": len(flagged),
        "conditions_misgrounded": len(misgrounded),
        "misgrounded_refs": [r["condition_ref"] for r in misgrounded],
        "results": rows,
        "antecedent_binding": {
            "qualifier": QUALIFIER,
            "bound": binding.bound,
            "reason": binding.reason,
            "antecedent_span": [a_start, a_end],
            "referring_span": list(REFERRING_SPAN),
        },
    }
    path = os.path.join(GRADE, "v2_prescreen.json")
    tmp = path + f".{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(artifact, fh, indent=2, default=str)
    os.replace(tmp, path)
    print()
    print(f"evidence={len(evidence)} screened={len(rows)} flagged={len(flagged)} MISGROUNDED={len(misgrounded)} unresolved={unresolved}")
    print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
