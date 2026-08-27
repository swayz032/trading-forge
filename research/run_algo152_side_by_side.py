#!/usr/bin/env python3
"""HIS SESSION NEXT TO THE BOT'S SESSION. ONE TABLE. FOURTEEN ROWS.

ALGO-152. Built because the campaign scored agreement with a metric that cannot see the bot's
trades, and then investigated the metric for two days. This is not a metric. It is a PICTURE.

🛑 HIS MARKED LEVELS ARE USED TO LOCATE, NEVER TO SCORE (ALGO-151 §5.1, ALGO-083).
No agreement number, no percentage and no verdict is computed from them anywhere in this file.
Every join below answers "does the bot have this level at all", never "is the bot right".

TOLERANCE IS STATED, NOT TUNED. A his-level and a bot-zone correspond when their PRICE BANDS
OVERLAP after padding each side by `pad`. Reported at THREE pads - 0.00 (pure overlap), 2.50
(one MNQ point either side) and 10.00 - so a reader can see whether the answer depends on it.
IF THE ANSWER CHANGES WITH THE PAD, THAT IS ITSELF THE FINDING AND IT IS PRINTED.

INPUTS ARE ALL COMMITTED ARTIFACTS - nothing is re-run, so nothing can drift between the halves:
  HIS   ..._replay_v3_labels_FROZEN.json   (read only; never edited)
  BOT   ..._algo137_map_RELAND.json        (every authorized zone at the 09:30 map anchor)
        ..._algo141_what_drops_his_setup.json (the production walk: the trade, or the refusal)

Run: PYTHONPATH=. python -m research.run_algo152_side_by_side
"""
from __future__ import annotations

import io
import json
from pathlib import Path

R = Path("research")
LABELS = R / "current_mnq_strategy_v2_4_replay_v3_labels_FROZEN.json"
MANIFEST = R / "current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json"
MAP = R / "current_mnq_strategy_v2_4_algo137_map_RELAND.json"
WALK = R / "current_mnq_strategy_v2_4_algo141_what_drops_his_setup.json"
OUT_JSON = R / "current_mnq_strategy_v2_4_algo152_side_by_side.json"
OUT_MD = Path("MNQ-HIS-SESSIONS-VS-THE-BOT.md")

SWING = "STRONG_SWING_DISPLACEMENT"
PADS = (0.00, 2.50, 10.00)


def _overlap(a_lo, a_hi, b_lo, b_hi, pad):
    return not (a_hi + pad < b_lo - pad or b_hi + pad < a_lo - pad)


def main() -> int:
    labels = {r["case_id"]: r for r in json.load(io.open(LABELS, encoding="utf-8"))["labels"]}
    manifest = json.load(io.open(MANIFEST, encoding="utf-8"))["cases"]
    bot_map = json.load(io.open(MAP, encoding="utf-8"))["per_session"]
    walk = json.load(io.open(WALK, encoding="utf-8"))["per_session"]

    rows, totals = [], {p: {"his": 0, "his_matched": 0, "bot": 0, "bot_unmatched": 0,
                            "bot_unmatched_exceptional": 0} for p in PADS}

    for case in manifest:
        s = case["session"]
        lab = labels.get(case["case_id"], {})
        his_zones = lab.get("trader_zones") or []
        bot_rows = bot_map.get(s, {}).get("rows", [])
        w = walk.get(s, {})
        traded = w.get("the_trade")

        # the authorising zone, and the destination or the refusal, from the production walk
        auth = refusal = dest = None
        for r in w.get("rows", []):
            if r.get("became_the_trade"):
                auth = {"id": r["location_id"], "source": r["location_source"]}
                dest = {"kind": r.get("target_source"), "points": r.get("target_points")}
                break
        if traded is None:
            for r in w.get("rows", []):
                if r.get("emitter_reason"):
                    refusal = r["emitter_reason"]
                    break

        per_pad = {}
        for pad in PADS:
            matched = []
            for hz in his_zones:
                hit = [b for b in bot_rows
                       if _overlap(hz["lo"], hz["hi"], b["lo"], b["hi"], pad)]
                matched.append(bool(hit))
            unmatched = [b for b in bot_rows
                         if not any(_overlap(hz["lo"], hz["hi"], b["lo"], b["hi"], pad)
                                    for hz in his_zones)]
            auth_is_his = None
            if auth:
                ab = next((b for b in bot_rows if b["id"] == auth["id"]), None)
                if ab is not None:
                    auth_is_his = any(_overlap(hz["lo"], hz["hi"], ab["lo"], ab["hi"], pad)
                                      for hz in his_zones)
            per_pad[pad] = {
                "his_levels": len(his_zones),
                "his_levels_the_bot_also_has": sum(matched),
                "bot_zones": len(bot_rows),
                "bot_zones_matching_nothing_he_drew": len(unmatched),
                "of_those_exceptional": sum(1 for b in unmatched if b["source"] == SWING),
                "the_zone_the_bot_traded_is_one_of_his": auth_is_his,
            }
            t = totals[pad]
            t["his"] += len(his_zones); t["his_matched"] += sum(matched)
            t["bot"] += len(bot_rows); t["bot_unmatched"] += len(unmatched)
            t["bot_unmatched_exceptional"] += sum(1 for b in unmatched if b["source"] == SWING)

        rows.append({
            "session": s,
            "HIS": {
                "levels": [{"lo": z["lo"], "hi": z["hi"], "role": z.get("role"),
                            "timeframe": z.get("marked_main_timeframe")} for z in his_zones],
                "entry_clock": lab.get("first_entry_time"),
                "action": lab.get("final_action"),
                "marked_tp": ((lab.get("trader_tp_short") or {}).get("lo")
                              if str(lab.get("final_action", "")).endswith("SHORT")
                              else (lab.get("trader_tp_long") or {}).get("lo")),
                "tp_status": lab.get("trader_tp_status"),
            },
            "BOT": {
                "zones_total": len(bot_rows),
                "zones_established": sum(1 for b in bot_rows if b["source"] != SWING),
                "zones_exceptional": sum(1 for b in bot_rows if b["source"] == SWING),
                "entry_clock": (traded or {}).get("entry_time"),
                "setup": (traded or {}).get("setup"),
                "authorising_zone": auth,
                "destination": dest,
                "refusal": refusal,
            },
            "JOINS_BY_PAD": {f"{p:.2f}": v for p, v in per_pad.items()},
        })
        p0 = per_pad[2.50]
        print(f"  {s}  his {p0['his_levels']:2d} levels, bot has {p0['his_levels_the_bot_also_has']:2d}"
              f" | bot {p0['bot_zones']:3d} zones, {p0['bot_zones_matching_nothing_he_drew']:3d} match nothing he drew"
              f" ({p0['of_those_exceptional']:3d} exceptional)"
              f" | traded-his-zone={p0['the_zone_the_bot_traded_is_one_of_his']}", flush=True)

    sens = {f"{p:.2f}": {
        "his_levels_the_bot_also_has": f"{totals[p]['his_matched']} of {totals[p]['his']}",
        "bot_zones_matching_nothing_he_drew": f"{totals[p]['bot_unmatched']} of {totals[p]['bot']}",
        "of_those_exceptional": totals[p]["bot_unmatched_exceptional"]} for p in PADS}
    changes = len({v["his_levels_the_bot_also_has"] for v in sens.values()}) > 1

    art = {
        "artifact": "ALGO152_SIDE_BY_SIDE",
        "status": "A PICTURE, NOT A METRIC. His marked levels LOCATE, they never SCORE. "
                  "No agreement number, percentage or verdict is computed anywhere here.",
        "authority": "ALGO-152; rails ALGO-151 §5.1 and ALGO-083",
        "tolerance": "band overlap after padding each side; reported at 0.00 / 2.50 / 10.00 points",
        "TOLERANCE_SENSITIVITY": sens,
        "answer_changes_with_tolerance": changes,
        "inputs_are_committed_artifacts_nothing_rerun": True,
        "rows": rows,
        "no_pnl": "No PnL, realized outcome, winner/loser label or clean-edge result is read.",
    }
    io.open(OUT_JSON, "w", encoding="utf-8", newline="\n").write(
        json.dumps(art, indent=2, sort_keys=True))
    print(f"\nTOLERANCE SENSITIVITY: {json.dumps(sens, indent=1)}")
    print(f"answer changes with tolerance: {changes}")
    print(f"wrote {OUT_JSON}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
