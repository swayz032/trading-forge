"""AR-1313 attribution investigation. Zero new Agent/Task/model calls -- deterministic
re-scoring of already-recovered quotes (primary + secondary candidates named in the same
already-captured agent responses) through the existing, unmodified relevance/fidelity gates.
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys

sys.path.insert(0, os.getcwd())


def _driver():
    spec = importlib.util.spec_from_file_location(
        "_svkm_driver", os.path.join("scripts", "svkm_opus_batch_locator.py")
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main() -> int:
    from src.engine.extraction.evidence_relevance import evaluate_evidence_relevance
    from src.engine.extraction.anchor_locator import _verify_and_locate

    drv = _driver()
    transcript, _ = drv.bench._load_pinned()
    index = json.loads(open(drv.TASK_INDEX_PATH, encoding="utf-8").read())
    conditions = index["conditions"]
    text_by_ref = {c["condition_ref"]: c["condition_text"] for c in conditions}

    candidates = {
        "entry_sequence[0].rationale": [
            ("primary", "And what that now gives me is a range on the five minute. Right? So that's how high the price went within the first 5 minutes and that's how low it went."),
            ("secondary_from_grounding_notes", "Because the 9:30 candle is when New York opens. And the New York session is the most volatile session, especially 9:30. That's pretty much the moment where we're going to get a big move in the market."),
        ],
        "entry_sequence[1].rationale": [
            ("primary", "the candles have printed outside of the range on the lower side of this 5m minute time frame. Right now, this is pretty much what we're looking for because what it's telling us is that price may be looking for a move to the downside"),
            ("secondary_from_grounding_notes", "That gives us an idea of the direction in which the market wants to go for the day."),
        ],
        "entry_sequence[2].action": [
            ("primary", "What we are looking for is a fair value gap sequence that is printing outside of the range."),
        ],
        "entry_sequence[2].rationale": [
            ("primary", "As soon as we see this gap being printed outside of the range and confirming, then we can enter the trade."),
        ],
        "entry_sequence[3].rationale": [
            ("primary", "my entry is going to be on the closure of that third candle"),
        ],
    }

    for ref, cand_list in candidates.items():
        cond_text = text_by_ref[ref]
        rivals = [t for r, t in text_by_ref.items() if r != ref]
        print(f"\n=== {ref} ===")
        print(f"condition: {cond_text!r}")
        for label, quote in cand_list:
            span = _verify_and_locate(transcript, quote)
            literal = span is not None
            if not literal:
                print(f"  [{label}] NOT LITERAL against pinned transcript -- rejected")
                continue
            verdict = evaluate_evidence_relevance(
                condition_text=cond_text, quote=quote,
                rival_conditions=rivals, source_document=transcript,
            )
            print(f"  [{label}] literal=YES grounded={verdict.grounded} "
                  f"own={verdict.own_score:.3f} rival={verdict.best_rival_score:.3f} "
                  f"rival_cond={verdict.rival!r}")
            print(f"    reason: {verdict.reason}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
