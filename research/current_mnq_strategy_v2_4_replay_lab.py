#!/usr/bin/env python3
"""Blind Human-vs-Bot Replay Lab for Current MNQ v2.4.

Purpose
-------
Measure whether the computer is translating the trader's discretionary decision
process, without contaminating that judgment with future candles, PnL, or the
bot's answer.

This module is DEVELOPMENT / FIDELITY EVIDENCE ONLY. It must never certify edge,
change FORCE1 thresholds from observed outcomes, or read clean OOS results.

The lab deliberately creates two physically separate artifacts:
1. review_pack.json / review.html  -> trader sees only information available at
   the frozen decision clock.
2. answer_key.json                 -> bot answer/reason, kept hidden until labels
   are frozen.

Allowed trader actions: ENTER_LONG, ENTER_SHORT, WAIT, NO_TRADE.
Allowed force labels: FORCE_REAL, TUG_OF_WAR, NOT_APPLICABLE.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import date
from html import escape
import hashlib
import json
from pathlib import Path
from typing import Iterable

import pandas as pd

from research import current_mnq_strategy_v2_4_engine as eng
from research.current_mnq_strategy_v2_4_kernel import iter_actionable_candidates
from research.current_mnq_strategy_v2_4_levels import build_entry_locations_v24

ACTIONS = {"ENTER_LONG", "ENTER_SHORT", "WAIT", "NO_TRADE"}
FORCE_LABELS = {"FORCE_REAL", "TUG_OF_WAR", "NOT_APPLICABLE"}
SCHEMA_VERSION = 1


@dataclass(frozen=True)
class ReplayCase:
    case_id: str
    session: str
    decision_time: str
    case_kind: str
    one_minute: list[dict]
    five_minute: list[dict]
    zones: list[dict]


@dataclass(frozen=True)
class Answer:
    case_id: str
    bot_action: str
    bot_confirmed_time: str | None
    setup: str | None
    candidate_reason: str | None
    location_id: str | None


def _completed_bars(df: pd.DataFrame, cutoff: pd.Timestamp, bar_minutes: int,
                    lookback_minutes: int) -> pd.DataFrame:
    if cutoff.tzinfo is None:
        raise RuntimeError("REPLAY_CUTOFF_MUST_BE_TZ_AWARE")
    q = df[
        ((df.index + pd.Timedelta(minutes=int(bar_minutes))) <= cutoff)
        & (df.index >= cutoff - pd.Timedelta(minutes=int(lookback_minutes)))
    ].copy()
    cols = [x for x in ("open", "high", "low", "close") if x in q.columns]
    return q[cols]


def _bars_to_json(df: pd.DataFrame, bar_minutes: int) -> list[dict]:
    rows = []
    for ts, r in df.iterrows():
        rows.append({
            "start": ts.isoformat(),
            "end": (ts + pd.Timedelta(minutes=int(bar_minutes))).isoformat(),
            "open": float(r.open),
            "high": float(r.high),
            "low": float(r.low),
            "close": float(r.close),
        })
    return rows


def _zone_rows(env: dict, dte: date, p: eng.Params) -> list[dict]:
    open_ts = pd.Timestamp(f"{dte} 09:30", tz=eng.core.TZ)
    locations, _ = build_entry_locations_v24(env, dte, open_ts, p)
    return [
        {
            "id": str(x.id),
            "side": str(x.side),
            "lo": float(x.lo),
            "hi": float(x.hi),
            "mid": float(x.mid),
            "source": str(x.source),
            "entry_authorized": bool(x.entry_authorized),
        }
        for x in locations
    ]


def _case_id(session: date, cutoff: pd.Timestamp, kind: str) -> str:
    raw = f"{session}|{cutoff.isoformat()}|{kind}".encode()
    return "RPL-" + hashlib.sha256(raw).hexdigest()[:16].upper()


def _blind_case(env: dict, dte: date, cutoff: pd.Timestamp,
                kind: str, p: eng.Params) -> ReplayCase:
    one = _completed_bars(env["one"], cutoff, 1, 25)
    five = _completed_bars(env["full5"], cutoff, 5, 90)
    # Hard anti-hindsight invariants.
    if len(one) and (one.index[-1] + pd.Timedelta(minutes=1)) > cutoff:
        raise RuntimeError("REPLAY_1M_LOOKAHEAD")
    if len(five) and (five.index[-1] + pd.Timedelta(minutes=5)) > cutoff:
        raise RuntimeError("REPLAY_5M_LOOKAHEAD")
    return ReplayCase(
        case_id=_case_id(dte, cutoff, kind),
        session=str(dte),
        decision_time=cutoff.isoformat(),
        case_kind=kind,
        one_minute=_bars_to_json(one, 1),
        five_minute=_bars_to_json(five, 5),
        zones=_zone_rows(env, dte, p),
    )


def _first_signal(env: dict, dte: date, p: eng.Params):
    for cand, actionable, _plan in iter_actionable_candidates(env, dte, p, as_of=None):
        return cand, actionable
    return None


def _zone_touch_times(env: dict, dte: date, p: eng.Params,
                      stop_before: pd.Timestamp | None) -> list[pd.Timestamp]:
    """Deterministic tempting non-entry clocks around authorized key zones.

    This is a sampling rule only, never an entry rule. It looks for completed 1m
    bars whose physical range intersects an authorized pre-open zone. It does not
    use future PnL or any post-clock candle.
    """
    zones = [z for z in _zone_rows(env, dte, p) if z["entry_authorized"]]
    if not zones:
        return []
    q = env["one"][env["one"].index.date == dte]
    out = []
    last = None
    for ts, r in q.iterrows():
        cutoff = ts + pd.Timedelta(minutes=1)
        if cutoff.time() < eng.core.TRADE_START or cutoff.time() > eng.core.LAST_ENTRY:
            continue
        if stop_before is not None and cutoff >= stop_before:
            continue
        touched = any(float(r.low) <= z["hi"] and float(r.high) >= z["lo"] for z in zones)
        if not touched:
            continue
        # Do not flood the trader with adjacent minute copies of the same event.
        if last is not None and cutoff - last < pd.Timedelta(minutes=5):
            continue
        out.append(cutoff)
        last = cutoff
    return out


def build_replay_pack(env: dict, days: Iterable[date], p: eng.Params | None = None,
                      max_entry_cases: int = 20, max_touch_cases: int = 20) -> tuple[dict, dict]:
    """Return (blind_review_pack, hidden_answer_key).

    Entry cases are exact first-A+ bot clocks. Touch cases are earlier key-zone
    interactions where the bot had not fired its first A+ yet. Together they can
    reveal both disagreement directions after trader labels are frozen.
    """
    p = p or eng.Params()
    cases: list[ReplayCase] = []
    answers: list[Answer] = []
    entry_count = touch_count = 0

    for dte in list(days):
        first = _first_signal(env, dte, p)
        first_time = first[1] if first else None

        if first is not None and entry_count < max_entry_cases:
            cand, actionable = first
            c = _blind_case(env, dte, actionable, "BOT_FIRST_A_PLUS_CLOCK", p)
            cases.append(c)
            answers.append(Answer(
                c.case_id,
                "ENTER_LONG" if cand.direction == "L" else "ENTER_SHORT",
                actionable.isoformat(), str(cand.setup), str(cand.reason), str(cand.location.id),
            ))
            entry_count += 1

        if touch_count < max_touch_cases:
            for cutoff in _zone_touch_times(env, dte, p, first_time):
                if touch_count >= max_touch_cases:
                    break
                c = _blind_case(env, dte, cutoff, "KEY_ZONE_TOUCH_PRE_FIRST_A_PLUS", p)
                cases.append(c)
                answers.append(Answer(c.case_id, "WAIT", None, None, None, None))
                touch_count += 1

        if entry_count >= max_entry_cases and touch_count >= max_touch_cases:
            break

    # Stable pseudo-random-looking order so the trader cannot infer case type by sequence.
    cases = sorted(cases, key=lambda x: hashlib.sha256(x.case_id.encode()).hexdigest())
    answer_map = {x.case_id: asdict(x) for x in answers}
    review = {
        "schema_version": SCHEMA_VERSION,
        "status": "BLIND_FIDELITY_REVIEW_NO_FUTURE_NO_PNL",
        "allowed_actions": sorted(ACTIONS),
        "allowed_force_labels": sorted(FORCE_LABELS),
        "case_count": len(cases),
        "cases": [asdict(x) for x in cases],
    }
    answer_key = {
        "schema_version": SCHEMA_VERSION,
        "status": "HIDDEN_BOT_ANSWER_KEY_DO_NOT_SHOW_BEFORE_TRADER_LABEL_FREEZE",
        "answers": answer_map,
    }
    _assert_blind(review)
    return review, answer_key


def _assert_blind(review: dict) -> None:
    forbidden = {
        "bot_action", "candidate_reason", "setup", "entry_time", "exit_time",
        "exit_price", "exit_reason", "net_pnl", "gross_pnl", "mfe_points",
        "mae_points", "target", "stop", "won", "winner", "pnl",
    }
    text = json.dumps(review).lower()
    for key in forbidden:
        if f'"{key.lower()}"' in text:
            raise RuntimeError(f"REPLAY_BLIND_PACK_LEAK:{key}")


def validate_labels(labels: list[dict], review: dict) -> None:
    expected = {x["case_id"] for x in review["cases"]}
    observed = set()
    for row in labels:
        cid = str(row.get("case_id", ""))
        if cid not in expected:
            raise RuntimeError(f"REPLAY_UNKNOWN_CASE:{cid}")
        if cid in observed:
            raise RuntimeError(f"REPLAY_DUPLICATE_LABEL:{cid}")
        observed.add(cid)
        if row.get("trader_action") not in ACTIONS:
            raise RuntimeError(f"REPLAY_BAD_ACTION:{cid}")
        if row.get("trader_force") not in FORCE_LABELS:
            raise RuntimeError(f"REPLAY_BAD_FORCE_LABEL:{cid}")
    if observed != expected:
        missing = sorted(expected - observed)
        raise RuntimeError("REPLAY_MISSING_LABELS:" + ",".join(missing[:10]))


def grade_labels(labels: list[dict], review: dict, answer_key: dict) -> dict:
    validate_labels(labels, review)
    answers = answer_key["answers"]
    rows = []
    for label in labels:
        a = answers[label["case_id"]]
        agree = label["trader_action"] == a["bot_action"]
        rows.append({
            "case_id": label["case_id"],
            "trader_action": label["trader_action"],
            "trader_force": label["trader_force"],
            "bot_action": a["bot_action"],
            "bot_confirmed_time": a["bot_confirmed_time"],
            "candidate_reason": a["candidate_reason"],
            "action_agreement": agree,
            "disagreement_type": None if agree else f'{a["bot_action"]}__VS__{label["trader_action"]}',
        })
    disagreements = [x for x in rows if not x["action_agreement"]]
    return {
        "status": "FIDELITY_GRADE_ONLY_NOT_EDGE_EVIDENCE",
        "cases": len(rows),
        "action_agreements": len(rows) - len(disagreements),
        "action_agreement_rate": (len(rows) - len(disagreements)) / max(len(rows), 1),
        "disagreements": disagreements,
        "rows": rows,
    }


def write_lab(out_dir: str | Path, review: dict, answer_key: dict) -> None:
    out = Path(out_dir); out.mkdir(parents=True, exist_ok=True)
    (out / "review_pack.json").write_text(json.dumps(review, indent=2, sort_keys=True))
    (out / "answer_key.json").write_text(json.dumps(answer_key, indent=2, sort_keys=True))
    template = [
        {"case_id": c["case_id"], "trader_action": "", "trader_force": "", "note": ""}
        for c in review["cases"]
    ]
    (out / "labels_template.json").write_text(json.dumps(template, indent=2))
    (out / "review.html").write_text(_html(review), encoding="utf-8")


def _html(review: dict) -> str:
    payload = json.dumps(review, separators=(",", ":"))
    return f'''<!doctype html><meta charset="utf-8"><title>MNQ Human-vs-Bot Replay Lab</title>
<style>
body{{font-family:system-ui;background:#111;color:#eee;max-width:1100px;margin:24px auto;padding:0 14px}}button{{margin:4px;padding:10px 12px}}.case{{border:1px solid #444;padding:14px;margin:16px 0;border-radius:10px}}table{{border-collapse:collapse;width:100%;font-size:12px}}td,th{{border-bottom:1px solid #333;padding:4px;text-align:right}}.zones{{font-size:12px;color:#bbb}}.warn{{color:#ffb86c}}
</style><h1>MNQ Blind Replay Lab</h1><p class="warn">Future candles, P&L, stop/target outcome and bot answer are intentionally hidden.</p><div id="app"></div><button onclick="downloadLabels()">Download labels.json</button>
<script>const pack={payload};const labels={{}};function fmt(b){{return `<tr><td>${{b.end}}</td><td>${{b.open}}</td><td>${{b.high}}</td><td>${{b.low}}</td><td>${{b.close}}</td></tr>`}}function choose(id,k,v){{labels[id]=labels[id]||{{case_id:id,trader_action:'',trader_force:'',note:''}};labels[id][k]=v;document.getElementById(id+'-'+k).textContent=v}}function render(){{app.innerHTML=pack.cases.map((c,i)=>`<div class=case><h3>${{i+1}} / ${{pack.case_count}} — ${{c.session}} @ ${{c.decision_time}}</h3><div class=zones>Authorized/known zones: ${{c.zones.map(z=>`${{z.side}} ${{z.lo}}–${{z.hi}} (${{z.source}})${{z.entry_authorized?'':' [context only]'}}`).join(' | ')}}</div><h4>Completed 1-minute bars</h4><table><tr><th>end</th><th>O</th><th>H</th><th>L</th><th>C</th></tr>${{c.one_minute.map(fmt).join('')}}</table><p>Action: <b id='${{c.case_id}}-trader_action'>UNSET</b><br><button onclick="choose('${{c.case_id}}','trader_action','ENTER_LONG')">ENTER LONG</button><button onclick="choose('${{c.case_id}}','trader_action','ENTER_SHORT')">ENTER SHORT</button><button onclick="choose('${{c.case_id}}','trader_action','WAIT')">WAIT</button><button onclick="choose('${{c.case_id}}','trader_action','NO_TRADE')">NO TRADE</button></p><p>Force: <b id='${{c.case_id}}-trader_force'>UNSET</b><br><button onclick="choose('${{c.case_id}}','trader_force','FORCE_REAL')">FORCE REAL</button><button onclick="choose('${{c.case_id}}','trader_force','TUG_OF_WAR')">TUG OF WAR</button><button onclick="choose('${{c.case_id}}','trader_force','NOT_APPLICABLE')">N/A</button></p></div>`).join('')}}function downloadLabels(){{const out=pack.cases.map(c=>labels[c.case_id]||{{case_id:c.case_id,trader_action:'',trader_force:'',note:''}});const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(out,null,2)],{{type:'application/json'}}));a.download='mnq_replay_labels.json';a.click()}}render();</script>'''
