#!/usr/bin/env python3
"""Desktop interactive Human-vs-Bot replay lab V3 for Current MNQ v2.4.

Fidelity/style capture only. V3 fixes the major V2 lab defects:
- authoritative bot ENTER requires the same room/TP gate as the full engine;
- one replay case per session, with entry cases preferred;
- 15m/5m/1m charts advance from completed 1m checkpoints;
- WAIT does not end the scenario; exact trader first-entry minute is recorded;
- key-zone grading is limited to nearest decision-relevant zones;
- TP means first meaningful reaction cluster, never merely side-by-side candles;
- TradingView Lightweight Charts powers native desktop zoom/pan/crosshair.

The static artifact necessarily contains later bars so the browser can reveal them.
Those bars are hidden by the UI, not cryptographically withheld. Therefore V3 must
not be represented as sealed no-future evidence or clean edge evidence.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date
import hashlib
import json
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd

from research import current_mnq_strategy_v2_4_engine as eng
from research.current_mnq_strategy_v2_4_kernel import iter_actionable_candidates
from research.current_mnq_strategy_v2_4_levels import build_entry_locations_v24
from research.current_mnq_strategy_v2_4_targets import build_and_classify
from research import current_mnq_strategy_v2_4_replay_lab as v2

SCHEMA_VERSION = 3
LWC_VERSION = "5.2.0"
LWC_FILE = "lightweight-charts.standalone.production.js"
ACTIONS = {"ENTER_LONG", "ENTER_SHORT", "WAIT", "NO_TRADE"}
FORCE_LABELS = {"FORCE_REAL", "TUG_OF_WAR", "NOT_APPLICABLE"}
ZONE_ROLES = {"SUPPORT", "RESISTANCE", "BOTH"}
TICK = float(eng.TICK)
TRADE_START = eng.core.TRADE_START
LAST_ENTRY = eng.core.LAST_ENTRY

GOLD_BY_REASON = {
    "ZONE_REJECTION_STORY_THEN_INTRA5_FORCE": [
        "V24G01_REJECTION_STORY_THEN_MOMENTUM",
        "V24G08_LIVE_MOMENTUM_FORCE_BEFORE_CANDLE_CLOSE",
    ],
    "PREBREAK_DISPLACEMENT_THIRD_CANDLE_INTRA5_FORCE": [
        "V24G03_PREBREAK_DISPLACEMENT_THIRD_CANDLE",
        "V24G08_LIVE_MOMENTUM_FORCE_BEFORE_CANDLE_CLOSE",
    ],
    "PREBREAK_REPEAT_TEST_INTRA5_FORCE": [
        "V24G04_REPEAT_TEST_PREBREAK_MOMENTUM",
        "V24G08_LIVE_MOMENTUM_FORCE_BEFORE_CANDLE_CLOSE",
    ],
    "FIRST_BREAK_PRINT_THEN_INTRA5_FORCE": [
        "V24G05_FIRST_PRINT_THEN_MOMENTUM_OR_15M_THREE_BAR",
        "V24G08_LIVE_MOMENTUM_FORCE_BEFORE_CANDLE_CLOSE",
    ],
    "WEAK_BREAK_PULLBACK_15M_BAR3_INTRA_FORCE": [
        "V24G05_FIRST_PRINT_THEN_MOMENTUM_OR_15M_THREE_BAR",
        "V24G08_LIVE_MOMENTUM_FORCE_BEFORE_CANDLE_CLOSE",
    ],
}


@dataclass(frozen=True)
class ReplayCaseV3:
    case_id: str
    session: str
    replay_start: str
    replay_end: str
    context_1m: list[dict]
    context_5m: list[dict]
    context_15m: list[dict]
    replay_1m: list[dict]


@dataclass(frozen=True)
class AnswerV3:
    case_id: str
    hidden_case_kind: str
    bot_action: str
    bot_entry_time: str | None
    bot_setup: str | None
    bot_reason: str | None
    bot_location_id: str | None
    bot_relevant_zones: list[dict]
    bot_entry_price: float | None
    bot_tp_reaction_cluster: dict | None
    gold_reference_ids: list[str]


def _bar_json(df: pd.DataFrame, minutes: int) -> list[dict]:
    return [
        {
            "start": ts.isoformat(),
            "end": (ts + pd.Timedelta(minutes=minutes)).isoformat(),
            "open": float(r.open), "high": float(r.high),
            "low": float(r.low), "close": float(r.close),
        }
        for ts, r in df.iterrows()
    ]


def _completed(df: pd.DataFrame, cutoff: pd.Timestamp, minutes: int,
               lookback: pd.Timedelta) -> pd.DataFrame:
    q = df[
        ((df.index + pd.Timedelta(minutes=minutes)) <= cutoff)
        & (df.index >= cutoff - lookback)
    ].copy()
    return q[[x for x in ("open", "high", "low", "close") if x in q.columns]]


def _authoritative_first_entry(env: dict, dte: date, p: eng.Params):
    """First full-engine entry without running any future exit/PnL path."""
    for cand, actionable, plan in iter_actionable_candidates(env, dte, p, as_of=None):
        ent = eng.core.one_minute_entry(env["one"], actionable, cand.direction, p)
        if ent is None:
            continue
        entry_time, entry, _raw_open = ent
        if entry_time.time() > LAST_ENTRY:
            continue
        picked, path_reason = build_and_classify(
            env["piv5"], env["full5"], env["h15"], entry_time, p,
            env["pdm"], env["pwm"], dte, entry, cand.direction, cand.setup,
            cand.setup == "BRK5", piv15=env["piv15"],
        )
        if picked is None:
            # Critical V2 replay-lab repair: a candidate that fails ROOM/TP is
            # not an authoritative entry and must not be labeled ENTER.
            continue
        return cand, actionable, plan, entry_time, float(entry), picked, path_reason
    return None


def _zone_rows(env: dict, dte: date, p: eng.Params) -> list[dict]:
    open_ts = pd.Timestamp(f"{dte} 09:30", tz=eng.core.TZ)
    locations, _ = build_entry_locations_v24(env, dte, open_ts, p)
    return [
        {
            "id": str(x.id), "side": str(x.side), "lo": float(x.lo),
            "hi": float(x.hi), "mid": float(x.mid), "source": str(x.source),
            "entry_authorized": bool(x.entry_authorized),
        }
        for x in locations if x.entry_authorized
    ]


def _decision_relevant_zones(zones: list[dict], reference_price: float,
                             location_id: str | None,
                             max_each_side: int = 3) -> list[dict]:
    """Grade the nearby map the trader can actually act on, not 50+ old zones."""
    below = sorted(
        [z for z in zones if float(z["mid"]) <= reference_price],
        key=lambda z: abs(reference_price - float(z["mid"])),
    )[:max_each_side]
    above = sorted(
        [z for z in zones if float(z["mid"]) > reference_price],
        key=lambda z: abs(reference_price - float(z["mid"])),
    )[:max_each_side]
    out = {z["id"]: z for z in below + above}
    if location_id is not None:
        for z in zones:
            if z["id"] == location_id:
                out[z["id"]] = z
                break
    return sorted(out.values(), key=lambda z: float(z["mid"]))


def _bounds(dte: date, anchor: pd.Timestamp,
            before_minutes: int = 12, after_minutes: int = 8) -> tuple[pd.Timestamp, pd.Timestamp]:
    start_floor = pd.Timestamp(f"{dte} 09:30", tz=eng.core.TZ)
    end_cap = pd.Timestamp(f"{dte} 12:00", tz=eng.core.TZ)
    start = max(start_floor, anchor - pd.Timedelta(minutes=before_minutes))
    end = min(end_cap, anchor + pd.Timedelta(minutes=after_minutes))
    if end <= start:
        end = min(end_cap, start + pd.Timedelta(minutes=1))
    return start, end


def _case_id(dte: date, anchor: pd.Timestamp, kind: str) -> str:
    raw = f"V3|{dte}|{anchor.isoformat()}|{kind}".encode()
    return "RPL3-" + hashlib.sha256(raw).hexdigest()[:16].upper()


def _make_case(env: dict, dte: date, anchor: pd.Timestamp, kind: str) -> ReplayCaseV3:
    start, end = _bounds(dte, anchor)
    one = env["one"]
    replay = one[
        (one.index >= start)
        & ((one.index + pd.Timedelta(minutes=1)) <= end)
    ][["open", "high", "low", "close"]].copy()
    return ReplayCaseV3(
        case_id=_case_id(dte, anchor, kind),
        session=str(dte), replay_start=start.isoformat(), replay_end=end.isoformat(),
        context_1m=_bar_json(_completed(one, start, 1, pd.Timedelta(minutes=45)), 1),
        context_5m=_bar_json(_completed(env["full5"], start, 5, pd.Timedelta(hours=6)), 5),
        context_15m=_bar_json(_completed(env["h15"], start, 15, pd.Timedelta(days=10)), 15),
        replay_1m=_bar_json(replay, 1),
    )


def _control_anchor(env: dict, dte: date, p: eng.Params) -> tuple[pd.Timestamp, str] | None:
    no_zone = v2._no_authorized_zone_clock(env, dte, p)
    if no_zone is not None:
        return no_zone, "NO_AUTHORIZED_KEY_ZONE_CONTROL"
    touches = v2._zone_touch_times(env, dte, p, None)
    if touches:
        return touches[0], "KEY_ZONE_INTERACTION_NO_FULL_ENGINE_ENTRY"
    return None


def build_replay_pack_v3(env: dict, days: Iterable[date], p: eng.Params | None = None,
                         max_cases: int = 16, max_entry_cases: int = 11,
                         min_entry_cases: int = 8) -> tuple[dict, dict]:
    p = p or eng.Params()
    days = list(days)
    entries = []
    no_entry_days = []
    for dte in days:
        full = _authoritative_first_entry(env, dte, p)
        if full is None:
            no_entry_days.append(dte)
        else:
            entries.append((dte, full))

    # Diversity-first, then chronological fill. No PnL or exit outcome is read.
    selected_entries = []
    seen_reason = set()
    for row in entries:
        reason = str(row[1][0].reason)
        if reason not in seen_reason and len(selected_entries) < max_entry_cases:
            selected_entries.append(row); seen_reason.add(reason)
    for row in entries:
        if len(selected_entries) >= max_entry_cases:
            break
        if row not in selected_entries:
            selected_entries.append(row)
    if len(selected_entries) < min_entry_cases:
        raise RuntimeError(f"REPLAY_V3_TOO_FEW_AUTHORITATIVE_ENTRY_CASES:{len(selected_entries)}")

    cases: list[ReplayCaseV3] = []
    answers: list[AnswerV3] = []
    used_sessions: set[str] = set()

    for dte, full in selected_entries:
        cand, _actionable, _plan, entry_time, entry, picked, _path_reason = full
        c = _make_case(env, dte, entry_time, "AUTHORITATIVE_ENTRY_REPLAY")
        zones = _decision_relevant_zones(
            _zone_rows(env, dte, p), entry, str(cand.location.id), 3,
        )
        loc = picked.location
        tp = {
            "lo": float(loc.lo), "hi": float(loc.hi), "mid": float(loc.mid),
            "source": str(loc.source), "kind": str(picked.kind),
            "target_raw": float(picked.raw_price),
            "target_executable": float(picked.executable_price),
            "first_contact_distance": float(picked.first_contact_distance),
        }
        gold = list(dict.fromkeys(
            GOLD_BY_REASON.get(str(cand.reason), [])
            + ["V24G06_FIRST_REACTION_LIQUIDITY_BEFORE_FVG", "V24G07_RANGE_DAY_KEY_ZONE_ROOM"]
        ))
        cases.append(c)
        answers.append(AnswerV3(
            c.case_id, "AUTHORITATIVE_FULL_ENGINE_ENTRY_REPLAY",
            "ENTER_LONG" if cand.direction == "L" else "ENTER_SHORT",
            entry_time.isoformat(), str(cand.setup), str(cand.reason),
            str(cand.location.id), zones, float(entry), tp, gold,
        ))
        used_sessions.add(str(dte))

    for dte in no_entry_days:
        if len(cases) >= max_cases:
            break
        ctl = _control_anchor(env, dte, p)
        if ctl is None:
            continue
        anchor, kind = ctl
        c = _make_case(env, dte, anchor, kind)
        # Reference price is the last visible completed 1m close at replay start.
        ctx = c.context_1m
        if not ctx:
            continue
        ref = float(ctx[-1]["close"])
        zones = _decision_relevant_zones(_zone_rows(env, dte, p), ref, None, 3)
        cases.append(c)
        answers.append(AnswerV3(
            c.case_id, kind, "NO_TRADE", None, None, None, None,
            zones, None, None,
            ["V24G07_RANGE_DAY_KEY_ZONE_ROOM", "V24G08_LIVE_MOMENTUM_FORCE_BEFORE_CANDLE_CLOSE"],
        ))
        used_sessions.add(str(dte))

    if len(cases) < max_cases:
        raise RuntimeError(f"REPLAY_V3_TOO_FEW_DIVERSE_SESSIONS:{len(cases)}<{max_cases}")
    cases = cases[:max_cases]
    answer_map = {x.case_id: asdict(x) for x in answers if x.case_id in {c.case_id for c in cases}}
    review = {
        "schema_version": SCHEMA_VERSION,
        "status": "INTERACTIVE_DESKTOP_STYLE_CAPTURE_UI_HIDDEN_FUTURE_NO_PNL",
        "future_visibility": "UI_PROGRESSIVE_DISCLOSURE_ONLY_NOT_CRYPTOGRAPHICALLY_WITHHELD",
        "chart_engine": {"name": "TradingView Lightweight Charts", "version": LWC_VERSION},
        "tp_instruction": "Mark the first meaningful REACTION CLUSTER you would actually use as TP. Not merely side-by-side candles.",
        "allowed_actions": sorted(ACTIONS),
        "allowed_force_labels": sorted(FORCE_LABELS),
        "allowed_zone_roles": sorted(ZONE_ROLES),
        "case_count": len(cases),
        "session_count": len({c.session for c in cases}),
        "cases": [asdict(x) for x in cases],
    }
    if review["case_count"] != review["session_count"]:
        raise RuntimeError("REPLAY_V3_SESSION_DIVERSITY_BROKEN")
    review["pack_id"] = hashlib.sha256(
        json.dumps(review["cases"], sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    key = {
        "schema_version": SCHEMA_VERSION,
        "pack_id": review["pack_id"],
        "status": "HIDDEN_V3_BOT_KEY_DO_NOT_OPEN_BEFORE_LABEL_FREEZE",
        "answers": answer_map,
    }
    _assert_safe_review(review)
    return review, key


def _assert_safe_review(review: dict) -> None:
    forbidden = {
        "bot_action", "bot_entry_time", "bot_setup", "bot_reason",
        "bot_location_id", "bot_relevant_zones", "bot_entry_price",
        "bot_tp_reaction_cluster", "gold_reference_ids", "net_pnl", "gross_pnl",
        "exit_price", "exit_reason", "winner", "won", "pnl",
    }
    text = json.dumps(review).lower()
    for key in forbidden:
        if f'"{key}"' in text:
            raise RuntimeError(f"REPLAY_V3_SAFE_PACK_LEAK:{key}")


def _norm_interval(z: dict) -> tuple[float, float]:
    lo, hi = float(z["lo"]), float(z["hi"])
    if not np.isfinite(lo) or not np.isfinite(hi):
        raise RuntimeError("REPLAY_V3_NONFINITE_ZONE")
    return (min(lo, hi), max(lo, hi))


def _geometry(a: tuple[float, float], b: tuple[float, float]) -> dict:
    inter = max(0.0, min(a[1], b[1]) - max(a[0], b[0]))
    union = max(a[1], b[1]) - min(a[0], b[0])
    iou = inter / union if union > 0 else float(a == b)
    return {
        "iou": float(iou),
        "low_edge_error_ticks": abs(a[0] - b[0]) / TICK,
        "high_edge_error_ticks": abs(a[1] - b[1]) / TICK,
        "center_error_ticks": abs((sum(a) - sum(b)) / 2.0) / TICK,
        "width_error_ticks": abs((a[1] - a[0]) - (b[1] - b[0])) / TICK,
    }


def _zone_grade(trader: list[dict], bot: list[dict]) -> dict:
    candidates = []
    for ti, tz in enumerate(trader):
        ta = _norm_interval(tz)
        for bi, bz in enumerate(bot):
            role = "SUPPORT" if bz.get("side") == "S" else "RESISTANCE" if bz.get("side") == "R" else "BOTH"
            if tz.get("role") not in {"BOTH", role}:
                continue
            g = _geometry(ta, _norm_interval(bz))
            candidates.append((g["iou"], -g["center_error_ticks"], ti, bi, g))
    mt, mb, matches = set(), set(), []
    for _, _, ti, bi, g in sorted(candidates, reverse=True):
        if ti in mt or bi in mb:
            continue
        mt.add(ti); mb.add(bi)
        matches.append({"trader_zone": trader[ti], "bot_zone": bot[bi], **g})
    return {
        "trader_zone_count": len(trader), "bot_relevant_zone_count": len(bot),
        "matches": matches,
        "unmatched_trader_zones": [z for i, z in enumerate(trader) if i not in mt],
        "unmatched_bot_zones": [z for i, z in enumerate(bot) if i not in mb],
    }


def validate_labels_v3(labels: dict | list, review: dict) -> None:
    rows = labels.get("labels", []) if isinstance(labels, dict) else labels
    if not isinstance(rows, list):
        raise RuntimeError("REPLAY_V3_LABELS_NOT_LIST")
    expected = {c["case_id"] for c in review["cases"]}
    observed = set()
    for row in rows:
        cid = str(row.get("case_id", ""))
        if cid not in expected or cid in observed:
            raise RuntimeError(f"REPLAY_V3_BAD_OR_DUPLICATE_CASE:{cid}")
        observed.add(cid)
        if row.get("final_action") not in {"ENTER_LONG", "ENTER_SHORT", "NO_TRADE"}:
            raise RuntimeError(f"REPLAY_V3_BAD_FINAL_ACTION:{cid}")
        if row.get("entry_force") not in FORCE_LABELS:
            raise RuntimeError(f"REPLAY_V3_BAD_FORCE:{cid}")
        zones = row.get("trader_zones", [])
        if not isinstance(zones, list):
            raise RuntimeError(f"REPLAY_V3_ZONES_NOT_LIST:{cid}")
        for z in zones:
            _norm_interval(z)
            if z.get("role") not in ZONE_ROLES:
                raise RuntimeError(f"REPLAY_V3_BAD_ZONE_ROLE:{cid}")
        if row["final_action"].startswith("ENTER_"):
            if not row.get("first_entry_time"):
                raise RuntimeError(f"REPLAY_V3_ENTRY_WITHOUT_TIME:{cid}")
            if not zones:
                raise RuntimeError(f"REPLAY_V3_ENTRY_WITHOUT_KEY_ZONE:{cid}")
            if row.get("trader_tp_reaction_cluster") is None:
                raise RuntimeError(f"REPLAY_V3_ENTRY_WITHOUT_REACTION_CLUSTER:{cid}")
            _norm_interval(row["trader_tp_reaction_cluster"])
    if observed != expected:
        raise RuntimeError("REPLAY_V3_MISSING_LABELS:" + ",".join(sorted(expected - observed)[:10]))


def grade_labels_v3(labels: dict | list, review: dict, answer_key: dict) -> dict:
    validate_labels_v3(labels, review)
    if answer_key.get("pack_id") != review.get("pack_id"):
        raise RuntimeError("REPLAY_V3_PACK_KEY_MISMATCH")
    rows_in = labels.get("labels", []) if isinstance(labels, dict) else labels
    out = []
    for lab in rows_in:
        a = answer_key["answers"][lab["case_id"]]
        action_agree = lab["final_action"] == a["bot_action"]
        timing_delta = None
        if lab["final_action"].startswith("ENTER_") and a["bot_entry_time"]:
            timing_delta = (
                pd.Timestamp(lab["first_entry_time"]) - pd.Timestamp(a["bot_entry_time"])
            ).total_seconds() / 60.0
        tp_grade = None
        if action_agree and lab["final_action"].startswith("ENTER_") and a["bot_tp_reaction_cluster"]:
            tp_grade = _geometry(
                _norm_interval(lab["trader_tp_reaction_cluster"]),
                _norm_interval(a["bot_tp_reaction_cluster"]),
            )
        out.append({
            "case_id": lab["case_id"], "trader_action": lab["final_action"],
            "bot_action": a["bot_action"], "action_agreement": action_agree,
            "trader_first_entry_time": lab.get("first_entry_time"),
            "bot_entry_time": a["bot_entry_time"], "entry_timing_delta_minutes": timing_delta,
            "trader_force_at_entry": lab.get("entry_force"),
            "bot_setup": a["bot_setup"], "bot_reason": a["bot_reason"],
            "gold_reference_ids": a["gold_reference_ids"],
            "key_zone_grade": _zone_grade(lab.get("trader_zones", []), a["bot_relevant_zones"]),
            "tp_reaction_cluster_grade": tp_grade,
        })
    disagreements = [r for r in out if not r["action_agreement"]]
    return {
        "status": "V3_INTERACTIVE_FIDELITY_GRADE_ONLY_NOT_EDGE_EVIDENCE",
        "pack_id": review["pack_id"], "cases": len(out),
        "action_agreements": len(out) - len(disagreements),
        "action_agreement_rate": (len(out) - len(disagreements)) / max(len(out), 1),
        "disagreements": disagreements, "rows": out,
        "warning": "No PnL-selected threshold may be added. V3 future bars are UI-hidden, not cryptographically withheld.",
    }


def write_lab_v3(out_dir: str | Path, review: dict, answer_key: dict) -> None:
    out = Path(out_dir); out.mkdir(parents=True, exist_ok=True)
    (out / "review_pack_v3.json").write_text(json.dumps(review, indent=2, sort_keys=True))
    (out / "answer_key_v3.json").write_text(json.dumps(answer_key, indent=2, sort_keys=True))
    (out / "labels_template_v3.json").write_text(json.dumps([
        {
            "case_id": c["case_id"], "final_action": "", "first_entry_time": None,
            "entry_force": "NOT_APPLICABLE", "trader_zones": [],
            "trader_tp_reaction_cluster": None, "decision_timeline": [], "note": "",
        } for c in review["cases"]
    ], indent=2))
    (out / "review_v3.html").write_text(_html(review), encoding="utf-8")


def _html(review: dict) -> str:
    payload = json.dumps(review, separators=(",", ":"))
    html = r'''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MNQ V3 Interactive Replay Lab</title>
<script src="lightweight-charts.standalone.production.js"></script>
<style>
:root{--bg:#0b0e12;--card:#11161c;--line:#25303a;--text:#e9eef5;--muted:#8f9ca9;--accent:#e5a15c;--good:#70c18b;--bad:#df6b72}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;overflow-x:hidden}button,select,input,textarea{background:#182029;color:var(--text);border:1px solid #344250;border-radius:7px;padding:8px 10px}button{cursor:pointer}button.active{outline:2px solid var(--accent)}button.primary{background:var(--accent);color:#111;border:0;font-weight:800}.top{position:sticky;top:0;z-index:50;background:#0b0e12f2;border-bottom:1px solid var(--line);padding:9px 14px}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.grow{flex:1}.muted{color:var(--muted);font-size:12px}.clock{font:700 18px ui-monospace,monospace;color:var(--accent)}.wrap{padding:10px 12px 18px}.workspace{display:grid;grid-template-columns:minmax(350px,34%) minmax(650px,66%);grid-template-rows:390px 310px;gap:10px}.panel{position:relative;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}.panel h3{position:absolute;z-index:6;top:8px;left:10px;margin:0;padding:4px 7px;border-radius:6px;background:#0b0e12c9;font-size:13px}.panel .max{position:absolute;z-index:6;top:7px;right:8px}.chart{position:absolute;inset:0}.overlay{position:absolute;inset:0;z-index:5;pointer-events:none}.overlay.draw{pointer-events:auto;cursor:crosshair}.p15{grid-column:1;grid-row:1}.p5{grid-column:2;grid-row:1}.p1{grid-column:1/3;grid-row:2}.bottom{margin-top:10px;display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:10px}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px}.choices button{margin:4px 4px 0 0}.status{font-weight:800;color:var(--accent);margin-top:5px}.zoneRow{display:flex;gap:7px;align-items:center;margin:5px 0;font-size:12px}.warn{padding:7px 10px;background:#211a13;border:1px solid #58432f;border-radius:8px;color:#e5be93;font-size:12px}.small{font-size:12px}.full{position:fixed!important;inset:8px!important;z-index:100!important;width:auto!important;height:auto!important}.timeline{max-height:105px;overflow:auto;font:12px ui-monospace,monospace;color:var(--muted)}@media(max-width:1100px){.workspace{grid-template-columns:1fr;grid-template-rows:330px 390px 280px}.p15{grid-column:1;grid-row:1}.p5{grid-column:1;grid-row:2}.p1{grid-column:1;grid-row:3}.bottom{grid-template-columns:1fr}}
</style></head><body><div class="top"><div class="row"><b>MNQ V3 Interactive Replay</b><span id="caseProgress"></span><span class="clock" id="clock"></span><span class="grow"></span><button id="prevCase">← Case</button><button id="play">▶ Play</button><button id="step1">+1m</button><button id="step5">+5m</button><select id="speed"><option value="1">1x</option><option value="2">2x</option><option value="5">5x</option></select><button id="nextCase">Next Case →</button><button class="primary" id="freeze">Freeze & Export</button></div><div class="muted">Space = play/pause · → = +1m · Shift+→ = +5m · future bars are hidden by the UI · bot answers and P&L are not in this page.</div></div><div class="wrap"><div class="warn">Trade it like a real morning. WAIT does not end the case. ENTER records the exact replay minute. TP means the first meaningful <b>reaction cluster</b> you would actually use — not merely side-by-side candles.</div><div class="workspace"><div class="panel p15" id="panel15"><h3>15m Context / Key Zones</h3><button class="max" data-max="panel15">⛶</button><div class="chart" id="chart15"></div><canvas class="overlay" id="ov15"></canvas></div><div class="panel p5" id="panel5"><h3>5m Main Setup / TP Reaction Cluster</h3><button class="max" data-max="panel5">⛶</button><div class="chart" id="chart5"></div><canvas class="overlay" id="ov5"></canvas></div><div class="panel p1" id="panel1"><h3>1m Live Force / Tug-of-War</h3><button class="max" data-max="panel1">⛶</button><div class="chart" id="chart1"></div><canvas class="overlay" id="ov1"></canvas></div></div><div class="bottom"><div class="card"><b>Decision</b><div class="status" id="actionStatus">No entry yet</div><div class="choices"><button data-action="ENTER_LONG">ENTER LONG</button><button data-action="ENTER_SHORT">ENTER SHORT</button><button data-action="WAIT">WAIT</button><button data-action="NO_TRADE">END / NO TRADE</button></div><b class="small">Force now</b><div class="choices"><button data-force="FORCE_REAL">FORCE REAL</button><button data-force="TUG_OF_WAR">TUG OF WAR</button><button data-force="NOT_APPLICABLE">N/A</button></div><div class="timeline" id="timeline"></div></div><div class="card"><b>Key zones</b><div class="row"><select id="zoneRole"><option>SUPPORT</option><option>RESISTANCE</option><option>BOTH</option></select><button id="drawZone">Draw Key Zone</button><button id="undoZone">Undo</button></div><div id="zones"></div></div><div class="card"><b>TP reaction cluster</b><div class="row"><button id="drawTp">Draw Reaction Cluster</button><button id="clearTp">Clear</button></div><div id="tpStatus" class="small muted">None marked</div><textarea id="note" style="width:100%;height:58px;margin-top:8px" placeholder="Optional note"></textarea></div></div><div class="muted" style="margin-top:8px">Built with <a href="https://www.tradingview.com/" target="_blank" rel="noopener" style="color:#b9c9dc">Lightweight Charts™ by TradingView</a>. This V3 artifact is fidelity/style capture only; later replay bars are progressively hidden by the UI, not cryptographically withheld.</div></div>
<script>
const pack=__PAYLOAD__;const storeKey='mnq-replay-v3:'+pack.pack_id;let saved=JSON.parse(localStorage.getItem(storeKey)||'{}');let idx=saved.idx||0;let labels=saved.labels||{};let playing=false,timer=null,currentForce='NOT_APPLICABLE',drawMode=null,dragY=null;
const LC=window.LightweightCharts;if(!LC){document.body.innerHTML='<div style="padding:30px;color:white">Lightweight Charts library file is missing. Keep review_v3.html and lightweight-charts.standalone.production.js in the same folder.</div>';throw new Error('LWC_MISSING')}
function cur(){return pack.cases[idx]}function lab(){const id=cur().case_id;if(!labels[id])labels[id]={case_id:id,final_action:'',first_entry_time:null,entry_force:'NOT_APPLICABLE',trader_zones:[],trader_tp_reaction_cluster:null,decision_timeline:[],note:'',reveal_count:0};return labels[id]}
function save(){localStorage.setItem(storeKey,JSON.stringify({idx,labels}))}function ts(s){return Math.floor(new Date(s).getTime()/1000)}function candle(b){return{time:ts(b.start),open:+b.open,high:+b.high,low:+b.low,close:+b.close}}function uniq(rows){const m=new Map();rows.forEach(x=>m.set(x.time,x));return [...m.values()].sort((a,b)=>a.time-b.time)}
function aggregate(rows,mins){const sec=mins*60,m=new Map();rows.forEach(x=>{const k=Math.floor(x.time/sec)*sec;let q=m.get(k);if(!q)q={time:k,open:x.open,high:x.high,low:x.low,close:x.close};else{q.high=Math.max(q.high,x.high);q.low=Math.min(q.low,x.low);q.close=x.close}m.set(k,q)});return [...m.values()].sort((a,b)=>a.time-b.time)}
const opts={autoSize:true,layout:{background:{type:'solid',color:'#11161c'},textColor:'#aeb8c2',attributionLogo:true},grid:{vertLines:{color:'#1b232c'},horzLines:{color:'#1b232c'}},rightPriceScale:{borderColor:'#303b46'},timeScale:{borderColor:'#303b46',timeVisible:true,secondsVisible:false,rightOffset:4,barSpacing:8},crosshair:{mode:LC.CrosshairMode.Normal}};
function mk(id){const chart=LC.createChart(document.getElementById(id),opts);const series=chart.addSeries(LC.CandlestickSeries,{upColor:'#5eb77a',downColor:'#d85f68',borderVisible:false,wickUpColor:'#5eb77a',wickDownColor:'#d85f68',priceFormat:{type:'price',precision:2,minMove:.25}});return{chart,series}}
const c15=mk('chart15'),c5=mk('chart5'),c1=mk('chart1');
function syncRange(a,b){let lock=false;a.chart.timeScale().subscribeVisibleLogicalRangeChange(r=>{if(lock||!r)return;lock=true;try{b.chart.timeScale().setVisibleLogicalRange(r)}catch(e){}lock=false})}syncRange(c5,c1);syncRange(c1,c5);
function visibleOne(){const c=cur(),l=lab();return uniq(c.context_1m.map(candle).concat(c.replay_1m.slice(0,l.reveal_count).map(candle)))}
function mergedContext(base,agg){return uniq(base.map(candle).concat(agg))}
function setData(fit=false){const one=visibleOne(),agg5=aggregate(one,5),agg15=aggregate(one,15);c1.series.setData(one);c5.series.setData(mergedContext(cur().context_5m,agg5));c15.series.setData(mergedContext(cur().context_15m,agg15));if(fit){c1.chart.timeScale().fitContent();c5.chart.timeScale().fitContent();c15.chart.timeScale().fitContent()}drawOverlays();renderClock()}
function replayTime(){const l=lab(),c=cur();if(l.reveal_count<=0)return c.replay_start;return c.replay_1m[Math.min(l.reveal_count-1,c.replay_1m.length-1)].end}
function renderClock(){clock.textContent=new Date(replayTime()).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});caseProgress.textContent=`Case ${idx+1} / ${pack.case_count} · ${cur().session}`}
function step(n=1){const l=lab();if(l.final_action&&l.final_action!=='')return;const max=cur().replay_1m.length;l.reveal_count=Math.min(max,l.reveal_count+n);setData(false);save();if(l.reveal_count>=max){pause();if(!l.final_action)actionStatus.textContent='Replay ended — choose ENTER if you already entered, or END / NO TRADE.'}}
function pause(){playing=false;clearInterval(timer);timer=null;play.textContent='▶ Play'}function togglePlay(){if(playing){pause();return}playing=true;play.textContent='⏸ Pause';const ms={1:900,2:450,5:180}[+speed.value]||900;timer=setInterval(()=>{if(lab().reveal_count>=cur().replay_1m.length){pause();return}step(1)},ms)}
function recordAction(action){const l=lab(),now=replayTime();if(action==='WAIT'){l.decision_timeline.push({time:now,action:'WAIT',force:currentForce});save();renderLabels();return}if(action==='NO_TRADE'){l.final_action='NO_TRADE';l.entry_force=currentForce;l.decision_timeline.push({time:now,action:'NO_TRADE',force:currentForce});pause()}else{l.final_action=action;l.first_entry_time=now;l.entry_force=currentForce;l.decision_timeline.push({time:now,action,force:currentForce});pause()}save();renderLabels()}
function renderLabels(){const l=lab();actionStatus.textContent=l.final_action||'No entry yet';document.querySelectorAll('[data-force]').forEach(b=>b.classList.toggle('active',b.dataset.force===currentForce));zones.innerHTML=l.trader_zones.length?l.trader_zones.map((z,i)=>`<div class="zoneRow"><b>${z.role}</b>${z.lo.toFixed(2)} – ${z.hi.toFixed(2)}<button onclick="removeZone(${i})">Remove</button></div>`).join(''):'<span class="muted small">None marked</span>';tpStatus.textContent=l.trader_tp_reaction_cluster?`${l.trader_tp_reaction_cluster.lo.toFixed(2)} – ${l.trader_tp_reaction_cluster.hi.toFixed(2)}`:'None marked';timeline.innerHTML=l.decision_timeline.map(x=>`<div>${new Date(x.time).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})} · ${x.action} · ${x.force}</div>`).join('');note.value=l.note||'';drawOverlays()}
function removeZone(i){lab().trader_zones.splice(i,1);save();renderLabels()}window.removeZone=removeZone;
function canvasSize(cv){const r=cv.getBoundingClientRect(),d=devicePixelRatio||1;cv.width=Math.max(1,Math.round(r.width*d));cv.height=Math.max(1,Math.round(r.height*d));cv.style.width=r.width+'px';cv.style.height=r.height+'px';const x=cv.getContext('2d');x.setTransform(d,0,0,d,0,0);return{x,w:r.width,h:r.height}}
function paint(cv,obj,kind){const d=canvasSize(cv),ctx=d.x;ctx.clearRect(0,0,d.w,d.h);const list=[];if(kind==='zone')list.push(...lab().trader_zones);else if(lab().trader_tp_reaction_cluster)list.push(lab().trader_tp_reaction_cluster);list.forEach(z=>{const y1=obj.series.priceToCoordinate(z.hi),y2=obj.series.priceToCoordinate(z.lo);if(y1==null||y2==null)return;ctx.fillStyle=kind==='zone'?'rgba(75,125,205,.17)':'rgba(229,161,92,.18)';ctx.strokeStyle=kind==='zone'?'rgba(105,155,235,.8)':'rgba(229,161,92,.9)';ctx.fillRect(0,Math.min(y1,y2),d.w,Math.abs(y2-y1));ctx.strokeRect(0,Math.min(y1,y2),d.w,Math.abs(y2-y1))})}
function drawOverlays(){paint(ov15,c15,'zone');paint(ov5,c5,'tp');const d=canvasSize(ov1),ctx=d.x;ctx.clearRect(0,0,d.w,d.h);lab().trader_zones.forEach(z=>{const y1=c1.series.priceToCoordinate(z.hi),y2=c1.series.priceToCoordinate(z.lo);if(y1==null||y2==null)return;ctx.fillStyle='rgba(75,125,205,.12)';ctx.fillRect(0,Math.min(y1,y2),d.w,Math.abs(y2-y1))})}
function beginDraw(mode,cv){drawMode=mode;dragY=null;document.querySelectorAll('.overlay').forEach(x=>x.classList.remove('draw'));cv.classList.add('draw')}
function bindDraw(cv,obj,kind){cv.addEventListener('pointerdown',e=>{if(drawMode!==kind)return;dragY=e.offsetY});cv.addEventListener('pointerup',e=>{if(drawMode!==kind||dragY==null)return;let a=obj.series.coordinateToPrice(dragY),b=obj.series.coordinateToPrice(e.offsetY);if(a==null||b==null)return;let lo=Math.min(+a,+b),hi=Math.max(+a,+b);if(hi-lo<TICK)hi=lo+TICK;if(kind==='zone')lab().trader_zones.push({lo,hi,role:zoneRole.value});else lab().trader_tp_reaction_cluster={lo,hi};drawMode=null;dragY=null;cv.classList.remove('draw');save();renderLabels()})}
bindDraw(ov15,c15,'zone');bindDraw(ov5,c5,'tp');
function renderCase(){pause();currentForce='NOT_APPLICABLE';lab();setData(true);renderLabels();save()}
play.onclick=togglePlay;step1.onclick=()=>step(1);step5.onclick=()=>step(5);speed.onchange=()=>{if(playing){pause();togglePlay()}};prevCase.onclick=()=>{idx=Math.max(0,idx-1);renderCase()};nextCase.onclick=()=>{idx=Math.min(pack.case_count-1,idx+1);renderCase()};drawZone.onclick=()=>beginDraw('zone',ov15);drawTp.onclick=()=>beginDraw('tp',ov5);undoZone.onclick=()=>{lab().trader_zones.pop();save();renderLabels()};clearTp.onclick=()=>{lab().trader_tp_reaction_cluster=null;save();renderLabels()};document.querySelectorAll('[data-force]').forEach(b=>b.onclick=()=>{currentForce=b.dataset.force;renderLabels()});document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>recordAction(b.dataset.action));note.oninput=()=>{lab().note=note.value;save()};document.querySelectorAll('[data-max]').forEach(b=>b.onclick=async()=>{const el=document.getElementById(b.dataset.max);if(!document.fullscreenElement)await el.requestFullscreen();else await document.exitFullscreen();setTimeout(()=>setData(false),60)});window.addEventListener('resize',()=>drawOverlays());window.addEventListener('keydown',e=>{if(e.code==='Space'&&['INPUT','TEXTAREA','SELECT'].indexOf(document.activeElement.tagName)<0){e.preventDefault();togglePlay()}if(e.code==='ArrowRight'&&['INPUT','TEXTAREA'].indexOf(document.activeElement.tagName)<0){e.preventDefault();step(e.shiftKey?5:1)}});
freeze.onclick=async()=>{let missing=[];for(const c of pack.cases){const l=labels[c.case_id];if(!l||!l.final_action){missing.push(c.case_id);continue}if(l.final_action.startsWith('ENTER_')&&(!l.first_entry_time||!l.trader_zones.length||!l.trader_tp_reaction_cluster))missing.push(c.case_id)}if(missing.length){alert(`Finish all cases first. ${missing.length} incomplete. Entry cases require a key zone and TP reaction cluster.`);return}const rows=pack.cases.map(c=>labels[c.case_id]);let body={schema_version:3,pack_id:pack.pack_id,frozen_at:new Date().toISOString(),labels:rows};const raw=JSON.stringify(body);body.labels_sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)))).map(x=>x.toString(16).padStart(2,'0')).join('');const blob=new Blob([JSON.stringify(body,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='mnq_replay_v3_labels_FROZEN.json';a.click()};renderCase();
</script></body></html>'''
    return html.replace("__PAYLOAD__", payload)
