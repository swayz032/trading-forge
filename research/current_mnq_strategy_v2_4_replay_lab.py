#!/usr/bin/env python3
"""Robust blind Human-vs-Bot replay lab for Current MNQ v2.4.

Development/fidelity evidence only. This lab must never certify edge or tune a
trading threshold from PnL. The trader-facing pack contains only information that
was causally available at the frozen decision clock. Bot case type, bot key-zone
map, bot action/setup/reason, bot entry and bot TP are kept in a physically
separate answer key until trader labels are frozen.

The trader reviews the same three information scales used by the strategy:
- 15m context: draw key support/resistance zones.
- 5m setup context: mark the first meaningful TP/reaction zone if entering.
- 1m live path: classify real force versus tug-of-war and choose action.

Zone/TP grading is geometric and diagnostic. It reports overlap and MNQ-tick
errors; no PnL-selected similarity threshold is allowed to redefine correctness.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
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

SCHEMA_VERSION = 2
ACTIONS = {"ENTER_LONG", "ENTER_SHORT", "WAIT", "NO_TRADE"}
FORCE_LABELS = {"FORCE_REAL", "TUG_OF_WAR", "NOT_APPLICABLE"}
ZONE_ROLES = {"SUPPORT", "RESISTANCE", "BOTH"}
TICK = float(eng.TICK)


@dataclass(frozen=True)
class ReplayCase:
    case_id: str
    session: str
    decision_time: str
    one_minute: list[dict]
    five_minute: list[dict]
    fifteen_minute: list[dict]


@dataclass(frozen=True)
class Answer:
    case_id: str
    hidden_case_kind: str
    bot_action: str
    bot_confirmed_time: str | None
    bot_setup: str | None
    bot_reason: str | None
    bot_location_id: str | None
    bot_zones: list[dict]
    bot_entry_price: float | None
    bot_tp_zone: dict | None


def _completed_bars(df: pd.DataFrame, cutoff: pd.Timestamp, bar_minutes: int,
                    lookback_minutes: int) -> pd.DataFrame:
    if cutoff.tzinfo is None:
        raise RuntimeError("REPLAY_CUTOFF_MUST_BE_TZ_AWARE")
    q = df[
        ((df.index + pd.Timedelta(minutes=int(bar_minutes))) <= cutoff)
        & (df.index >= cutoff - pd.Timedelta(minutes=int(lookback_minutes)))
    ].copy()
    cols = [x for x in ("open", "high", "low", "close") if x in q.columns]
    q = q[cols]
    if len(q) and (q.index[-1] + pd.Timedelta(minutes=int(bar_minutes))) > cutoff:
        raise RuntimeError(f"REPLAY_{bar_minutes}M_LOOKAHEAD")
    return q


def _bars_to_json(df: pd.DataFrame, bar_minutes: int) -> list[dict]:
    return [
        {
            "start": ts.isoformat(),
            "end": (ts + pd.Timedelta(minutes=int(bar_minutes))).isoformat(),
            "open": float(r.open), "high": float(r.high),
            "low": float(r.low), "close": float(r.close),
        }
        for ts, r in df.iterrows()
    ]


def _zone_rows(env: dict, dte: date, p: eng.Params) -> list[dict]:
    open_ts = pd.Timestamp(f"{dte} 09:30", tz=eng.core.TZ)
    locations, _ = build_entry_locations_v24(env, dte, open_ts, p)
    return [
        {
            "id": str(x.id), "side": str(x.side),
            "lo": float(x.lo), "hi": float(x.hi), "mid": float(x.mid),
            "source": str(x.source),
            "entry_authorized": bool(x.entry_authorized),
        }
        for x in locations
    ]


def _case_id(session: date, cutoff: pd.Timestamp, salt: str) -> str:
    raw = f"{session}|{cutoff.isoformat()}|{salt}".encode()
    return "RPL2-" + hashlib.sha256(raw).hexdigest()[:16].upper()


def _blind_case(env: dict, dte: date, cutoff: pd.Timestamp, salt: str) -> ReplayCase:
    # Context lengths are fixed workload choices and are not outcome-selected.
    # 15m gets 10 calendar days for repeated-wick structure, 5m gets 4 hours,
    # 1m gets 30 minutes for the live force path.
    one = _completed_bars(env["one"], cutoff, 1, 30)
    five = _completed_bars(env["full5"], cutoff, 5, 4 * 60)
    fifteen = _completed_bars(env["h15"], cutoff, 15, 10 * 24 * 60)
    return ReplayCase(
        case_id=_case_id(dte, cutoff, salt),
        session=str(dte), decision_time=cutoff.isoformat(),
        one_minute=_bars_to_json(one, 1),
        five_minute=_bars_to_json(five, 5),
        fifteen_minute=_bars_to_json(fifteen, 15),
    )


def _first_signal(env: dict, dte: date, p: eng.Params):
    for cand, actionable, plan in iter_actionable_candidates(env, dte, p, as_of=None):
        return cand, actionable, plan
    return None


def _bot_target(env: dict, dte: date, p: eng.Params, cand,
                actionable: pd.Timestamp) -> tuple[float | None, dict | None]:
    """Build the target at the causal entry clock without running any future exit."""
    ent = eng.core.one_minute_entry(env["one"], actionable, cand.direction, p)
    if ent is None:
        return None, None
    entry_time, entry, _raw_open = ent
    picked, _path_reason = build_and_classify(
        env["piv5"], env["full5"], env["h15"], entry_time, p,
        env["pdm"], env["pwm"], dte, entry, cand.direction, cand.setup,
        cand.setup == "BRK5", piv15=env["piv15"],
    )
    if picked is None:
        return float(entry), None
    loc = picked.location
    return float(entry), {
        "lo": float(loc.lo), "hi": float(loc.hi), "mid": float(loc.mid),
        "source": str(loc.source), "kind": str(picked.kind),
        "target_raw": float(picked.raw_price),
        "target_executable": float(picked.executable_price),
        "first_contact_distance": float(picked.first_contact_distance),
    }


def _zone_touch_times(env: dict, dte: date, p: eng.Params,
                      stop_before: pd.Timestamp | None) -> list[pd.Timestamp]:
    """Sampling only: causal key-zone interactions before the first bot A+ clock."""
    zones = [z for z in _zone_rows(env, dte, p) if z["entry_authorized"]]
    if not zones:
        return []
    q = env["one"][env["one"].index.date == dte]
    out: list[pd.Timestamp] = []
    last: pd.Timestamp | None = None
    for ts, r in q.iterrows():
        cutoff = ts + pd.Timedelta(minutes=1)
        if cutoff.time() < eng.core.TRADE_START or cutoff.time() > eng.core.LAST_ENTRY:
            continue
        if stop_before is not None and cutoff >= stop_before:
            continue
        touched = any(float(r.low) <= z["hi"] and float(r.high) >= z["lo"] for z in zones)
        if not touched:
            continue
        if last is not None and cutoff - last < pd.Timedelta(minutes=5):
            continue
        out.append(cutoff); last = cutoff
    return out


def _no_authorized_zone_clock(env: dict, dte: date, p: eng.Params) -> pd.Timestamp | None:
    zones = [z for z in _zone_rows(env, dte, p) if z["entry_authorized"]]
    if zones:
        return None
    cutoff = pd.Timestamp(f"{dte} 10:00", tz=eng.core.TZ)
    one = env["one"]
    if not any((one.index.date == dte) & ((one.index + pd.Timedelta(minutes=1)) <= cutoff)):
        return None
    return cutoff


def build_replay_pack(env: dict, days: Iterable[date], p: eng.Params | None = None,
                      max_entry_cases: int = 8, max_touch_cases: int = 8,
                      max_no_zone_cases: int = 6) -> tuple[dict, dict]:
    """Return (strictly blind trader pack, hidden bot answer key)."""
    p = p or eng.Params()
    cases: list[ReplayCase] = []
    answers: list[Answer] = []
    entry_count = touch_count = no_zone_count = 0

    for dte in list(days):
        first = _first_signal(env, dte, p)
        first_time = first[1] if first else None
        zones = _zone_rows(env, dte, p)

        if first is not None and entry_count < max_entry_cases:
            cand, actionable, _plan = first
            c = _blind_case(env, dte, actionable, "ENTRY")
            entry, tp = _bot_target(env, dte, p, cand, actionable)
            cases.append(c)
            answers.append(Answer(
                c.case_id, "BOT_FIRST_A_PLUS_CLOCK",
                "ENTER_LONG" if cand.direction == "L" else "ENTER_SHORT",
                actionable.isoformat(), str(cand.setup), str(cand.reason),
                str(cand.location.id), zones, entry, tp,
            ))
            entry_count += 1

        if touch_count < max_touch_cases:
            for cutoff in _zone_touch_times(env, dte, p, first_time):
                if touch_count >= max_touch_cases:
                    break
                c = _blind_case(env, dte, cutoff, "TOUCH")
                cases.append(c)
                answers.append(Answer(
                    c.case_id, "KEY_ZONE_INTERACTION_PRE_FIRST_A_PLUS", "WAIT",
                    None, None, None, None, zones, None, None,
                ))
                touch_count += 1

        if no_zone_count < max_no_zone_cases:
            cutoff = _no_authorized_zone_clock(env, dte, p)
            if cutoff is not None:
                c = _blind_case(env, dte, cutoff, "NOZONE")
                cases.append(c)
                answers.append(Answer(
                    c.case_id, "NO_AUTHORIZED_KEY_ZONE_CONTROL", "NO_TRADE",
                    None, None, None, None, zones, None, None,
                ))
                no_zone_count += 1

        if (entry_count >= max_entry_cases and touch_count >= max_touch_cases
                and no_zone_count >= max_no_zone_cases):
            break

    # Stable hash order prevents case type from being inferred by sequence.
    cases = sorted(cases, key=lambda x: hashlib.sha256(x.case_id.encode()).hexdigest())
    answer_map = {x.case_id: asdict(x) for x in answers}
    review = {
        "schema_version": SCHEMA_VERSION,
        "status": "BLIND_ZONE_ENTRY_TP_FIDELITY_NO_FUTURE_NO_PNL",
        "allowed_actions": sorted(ACTIONS),
        "allowed_force_labels": sorted(FORCE_LABELS),
        "allowed_zone_roles": sorted(ZONE_ROLES),
        "case_count": len(cases),
        "cases": [asdict(x) for x in cases],
    }
    review["pack_id"] = hashlib.sha256(
        json.dumps(review["cases"], sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    answer_key = {
        "schema_version": SCHEMA_VERSION,
        "pack_id": review["pack_id"],
        "status": "HIDDEN_BOT_ZONE_ENTRY_TP_KEY_DO_NOT_OPEN_BEFORE_LABEL_FREEZE",
        "answers": answer_map,
    }
    _assert_blind(review)
    return review, answer_key


def _assert_blind(review: dict) -> None:
    forbidden = {
        "hidden_case_kind", "bot_action", "bot_confirmed_time", "bot_setup",
        "bot_reason", "bot_location_id", "bot_zones", "bot_entry_price",
        "bot_tp_zone", "entry_authorized", "candidate_reason", "case_kind",
        "entry_time", "exit_time", "exit_price", "exit_reason", "net_pnl",
        "gross_pnl", "mfe_points", "mae_points", "target", "stop", "winner",
        "won", "pnl",
    }
    text = json.dumps(review).lower()
    for key in forbidden:
        if f'"{key}"' in text:
            raise RuntimeError(f"REPLAY_BLIND_PACK_LEAK:{key}")


def _norm_interval(z: dict) -> tuple[float, float]:
    lo, hi = float(z["lo"]), float(z["hi"])
    if not np.isfinite(lo) or not np.isfinite(hi):
        raise RuntimeError("REPLAY_NONFINITE_ZONE")
    return (lo, hi) if lo <= hi else (hi, lo)


def _iou(a: tuple[float, float], b: tuple[float, float]) -> float:
    inter = max(0.0, min(a[1], b[1]) - max(a[0], b[0]))
    union = max(a[1], b[1]) - min(a[0], b[0])
    if union <= 0:
        return 1.0 if a == b else 0.0
    return float(inter / union)


def _geometry(a: tuple[float, float], b: tuple[float, float]) -> dict:
    return {
        "iou": _iou(a, b),
        "low_edge_error_ticks": abs(a[0] - b[0]) / TICK,
        "high_edge_error_ticks": abs(a[1] - b[1]) / TICK,
        "center_error_ticks": abs((sum(a) - sum(b)) / 2.0) / TICK,
        "width_error_ticks": abs((a[1] - a[0]) - (b[1] - b[0])) / TICK,
    }


def _label_rows(labels) -> list[dict]:
    if isinstance(labels, dict):
        labels = labels.get("labels", [])
    if not isinstance(labels, list):
        raise RuntimeError("REPLAY_LABELS_NOT_LIST")
    return labels


def validate_labels(labels, review: dict) -> None:
    rows = _label_rows(labels)
    expected = {x["case_id"] for x in review["cases"]}
    observed: set[str] = set()
    for row in rows:
        cid = str(row.get("case_id", ""))
        if cid not in expected:
            raise RuntimeError(f"REPLAY_UNKNOWN_CASE:{cid}")
        if cid in observed:
            raise RuntimeError(f"REPLAY_DUPLICATE_LABEL:{cid}")
        observed.add(cid)
        action = row.get("trader_action")
        force = row.get("trader_force")
        if action not in ACTIONS:
            raise RuntimeError(f"REPLAY_BAD_ACTION:{cid}")
        if force not in FORCE_LABELS:
            raise RuntimeError(f"REPLAY_BAD_FORCE_LABEL:{cid}")
        zones = row.get("trader_zones", [])
        if not isinstance(zones, list):
            raise RuntimeError(f"REPLAY_ZONES_NOT_LIST:{cid}")
        for z in zones:
            _norm_interval(z)
            if z.get("role") not in ZONE_ROLES:
                raise RuntimeError(f"REPLAY_BAD_ZONE_ROLE:{cid}")
        tp = row.get("trader_tp_zone")
        if tp is not None:
            _norm_interval(tp)
        if action in {"ENTER_LONG", "ENTER_SHORT"}:
            if not zones:
                raise RuntimeError(f"REPLAY_ENTRY_WITHOUT_KEY_ZONE:{cid}")
            if tp is None:
                raise RuntimeError(f"REPLAY_ENTRY_WITHOUT_TP_ZONE:{cid}")
    if observed != expected:
        raise RuntimeError("REPLAY_MISSING_LABELS:" + ",".join(sorted(expected - observed)[:10]))


def _zone_grade(trader: list[dict], bot: list[dict]) -> dict:
    bot_auth = [z for z in bot if z.get("entry_authorized")]
    candidates = []
    for ti, tz in enumerate(trader):
        ta = _norm_interval(tz)
        for bi, bz in enumerate(bot_auth):
            b_role = "SUPPORT" if bz.get("side") == "S" else "RESISTANCE" if bz.get("side") == "R" else "BOTH"
            if tz.get("role") != "BOTH" and b_role != tz.get("role"):
                continue
            g = _geometry(ta, _norm_interval(bz))
            candidates.append((g["iou"], -g["center_error_ticks"], ti, bi, g))
    # One-to-one greedy geometry match: highest interval overlap, then nearest center.
    matched_t: set[int] = set(); matched_b: set[int] = set(); matches = []
    for _iou_v, _neg_center, ti, bi, g in sorted(candidates, reverse=True):
        if ti in matched_t or bi in matched_b:
            continue
        matched_t.add(ti); matched_b.add(bi)
        matches.append({
            "trader_zone": trader[ti], "bot_zone": bot_auth[bi], **g,
        })
    return {
        "trader_zone_count": len(trader),
        "bot_authorized_zone_count": len(bot_auth),
        "matches": matches,
        "unmatched_trader_zones": [z for i, z in enumerate(trader) if i not in matched_t],
        "unmatched_bot_zones": [z for i, z in enumerate(bot_auth) if i not in matched_b],
    }


def grade_labels(labels, review: dict, answer_key: dict) -> dict:
    validate_labels(labels, review)
    rows_in = _label_rows(labels)
    if answer_key.get("pack_id") != review.get("pack_id"):
        raise RuntimeError("REPLAY_PACK_ANSWER_KEY_ID_MISMATCH")
    answers = answer_key["answers"]
    rows = []
    for label in rows_in:
        a = answers[label["case_id"]]
        action_agree = label["trader_action"] == a["bot_action"]
        zone_grade = _zone_grade(label.get("trader_zones", []), a.get("bot_zones", []))
        tp_grade = None
        same_side = action_agree and label["trader_action"] in {"ENTER_LONG", "ENTER_SHORT"}
        if same_side and label.get("trader_tp_zone") is not None and a.get("bot_tp_zone") is not None:
            tp_grade = _geometry(
                _norm_interval(label["trader_tp_zone"]),
                _norm_interval(a["bot_tp_zone"]),
            )
            tp_grade.update({
                "trader_tp_zone": label["trader_tp_zone"],
                "bot_tp_zone": a["bot_tp_zone"],
            })
        rows.append({
            "case_id": label["case_id"],
            "trader_action": label["trader_action"], "bot_action": a["bot_action"],
            "trader_force": label["trader_force"],
            "bot_confirmed_time": a["bot_confirmed_time"],
            "candidate_reason": a["bot_reason"],
            "action_agreement": action_agree,
            "disagreement_type": None if action_agree else f'{a["bot_action"]}__VS__{label["trader_action"]}',
            "key_zone_grade": zone_grade,
            "tp_zone_grade": tp_grade,
        })
    disagreements = [x for x in rows if not x["action_agreement"]]
    return {
        "status": "FIDELITY_GRADE_ONLY_NOT_EDGE_EVIDENCE",
        "pack_id": review["pack_id"],
        "cases": len(rows),
        "action_agreements": len(rows) - len(disagreements),
        "action_agreement_rate": (len(rows) - len(disagreements)) / max(len(rows), 1),
        "disagreements": disagreements,
        "rows": rows,
        "warning": "Zone/TP geometry is diagnostic. No PnL-selected similarity threshold may be added after viewing outcomes.",
    }


def write_lab(out_dir: str | Path, review: dict, answer_key: dict) -> None:
    out = Path(out_dir); out.mkdir(parents=True, exist_ok=True)
    (out / "review_pack.json").write_text(json.dumps(review, indent=2, sort_keys=True))
    (out / "answer_key.json").write_text(json.dumps(answer_key, indent=2, sort_keys=True))
    template = [
        {
            "case_id": c["case_id"], "trader_action": "", "trader_force": "",
            "trader_zones": [], "trader_tp_zone": None, "note": "",
        }
        for c in review["cases"]
    ]
    (out / "labels_template.json").write_text(json.dumps(template, indent=2))
    (out / "review.html").write_text(_html(review), encoding="utf-8")


def _html(review: dict) -> str:
    payload = json.dumps(review, separators=(",", ":"))
    # No answer-key values are embedded or fetched by this page. It is deliberately
    # self-contained so opening the safe artifact cannot reveal bot labels.
    return f'''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MNQ Blind Replay Lab</title>
<style>
:root{{--bg:#0d0f12;--card:#15191e;--line:#2b323a;--text:#f3f4f6;--muted:#9aa4af;--accent:#e89055}}*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,Segoe UI,sans-serif}}header{{position:sticky;top:0;z-index:10;background:#0d0f12ee;border-bottom:1px solid var(--line);padding:12px 16px}}.wrap{{max-width:1180px;margin:auto;padding:14px}}h1{{font-size:20px;margin:0}}.sub{{color:var(--muted);font-size:13px;margin-top:4px}}.bar{{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px}}button,select,input{{background:#1b2026;color:var(--text);border:1px solid #39424c;border-radius:8px;padding:9px 11px;font-size:14px}}button{{cursor:pointer}}button.active{{outline:2px solid var(--accent);border-color:var(--accent)}}button.primary{{background:var(--accent);color:#111;border:0;font-weight:700}}button.danger{{border-color:#8b4343}}.grid{{display:grid;grid-template-columns:1fr;gap:12px}}.card{{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px}}.chartTitle{{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}}.chart{{width:100%;height:260px;border:1px solid #252b32;border-radius:8px;background:#101318;touch-action:none}}#chart1{{height:220px}}.controls{{display:grid;grid-template-columns:1fr 1fr;gap:12px}}.choice button{{min-width:110px;margin:4px 4px 4px 0}}.status{{font-weight:700;color:var(--accent)}}.zonesList{{font-size:13px;color:var(--muted);margin-top:8px}}.zoneRow{{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:6px 0;padding:6px;border:1px solid #2a3037;border-radius:7px}}.manual{{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}}.manual input{{width:120px}}.warn{{background:#211b17;border:1px solid #5b4635;padding:9px;border-radius:8px;color:#e5c19e;font-size:13px}}.done{{color:#8fd694}}@media(max-width:760px){{.controls{{grid-template-columns:1fr}}.chart{{height:230px}}button{{padding:10px}}}}
</style></head><body><header><div class="wrap"><h1>MNQ Blind Human-vs-Bot Replay Lab</h1><div class="sub">Future candles, P&L, bot zones, bot TP and bot decision are hidden.</div><div class="bar"><button id="prev">← Previous</button><span id="progress"></span><button id="next">Next →</button><button class="primary" id="freeze">Freeze & Export Labels</button><span id="autosave" class="sub">Autosave on</span></div></div></header><main class="wrap"><div class="warn">Trade it exactly like you would live. Draw the zones YOU see. Do not try to guess what the bot chose.</div><div id="caseMeta" class="bar"></div><div class="grid">
<div class="card"><div class="chartTitle"><b>15-minute — key-level map</b><span class="sub">Drag vertically to draw a key zone</span></div><canvas id="chart15" class="chart"></canvas><div class="manual"><select id="zoneRole"><option>SUPPORT</option><option>RESISTANCE</option><option>BOTH</option></select><button id="drawZone">Draw Key Zone</button><input id="zoneLo" type="number" step="0.25" placeholder="Zone low"><input id="zoneHi" type="number" step="0.25" placeholder="Zone high"><button id="addZone">Add exact zone</button><button id="undoZone">Undo zone</button></div><div id="zonesList" class="zonesList"></div></div>
<div class="card"><div class="chartTitle"><b>5-minute — setup / TP context</b><span class="sub">If entering, mark first meaningful reaction area</span></div><canvas id="chart5" class="chart"></canvas><div class="manual"><button id="drawTp">Draw TP Zone</button><input id="tpLo" type="number" step="0.25" placeholder="TP low"><input id="tpHi" type="number" step="0.25" placeholder="TP high"><button id="addTp">Set exact TP</button><button id="clearTp">Clear TP</button></div><div id="tpStatus" class="zonesList"></div></div>
<div class="card"><div class="chartTitle"><b>1-minute — live force / tug-of-war</b><span class="sub">Only completed minutes are shown</span></div><canvas id="chart1" class="chart"></canvas></div>
<div class="controls"><div class="card choice"><b>Your action</b><div id="actionStatus" class="status">UNSET</div><div><button data-action="ENTER_LONG">ENTER LONG</button><button data-action="ENTER_SHORT">ENTER SHORT</button><button data-action="WAIT">WAIT</button><button data-action="NO_TRADE">NO TRADE</button></div></div><div class="card choice"><b>Momentum / force</b><div id="forceStatus" class="status">UNSET</div><div><button data-force="FORCE_REAL">FORCE REAL</button><button data-force="TUG_OF_WAR">TUG OF WAR</button><button data-force="NOT_APPLICABLE">N/A</button></div></div></div>
<div class="card"><b>Optional note</b><textarea id="note" style="width:100%;height:70px;margin-top:8px;background:#101318;color:#eee;border:1px solid #39424c;border-radius:8px;padding:8px" placeholder="Example: buyers kept giving back highs, so I waited"></textarea></div></div></main>
<script>
const pack={payload};const storeKey='mnq-replay-v2:'+pack.pack_id;let saved=JSON.parse(localStorage.getItem(storeKey)||'{{}}');let labels=saved.labels||{{}};let idx=saved.idx||0;let mode=null;let dragStart=null;
function current(){{return pack.cases[idx]}}function label(){{let id=current().case_id;if(!labels[id])labels[id]={{case_id:id,trader_action:'',trader_force:'',trader_zones:[],trader_tp_zone:null,note:''}};return labels[id]}}
function save(){{localStorage.setItem(storeKey,JSON.stringify({{idx,labels}}));autosave.textContent='Saved';setTimeout(()=>autosave.textContent='Autosave on',700)}}function norm(a,b){{a=Number(a);b=Number(b);return {{lo:Math.min(a,b),hi:Math.max(a,b)}}}}
function dims(canvas,bars){{let dpr=devicePixelRatio||1,w=canvas.clientWidth,h=canvas.clientHeight;canvas.width=w*dpr;canvas.height=h*dpr;let ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);let lo=Math.min(...bars.map(b=>b.low)),hi=Math.max(...bars.map(b=>b.high));let pad=Math.max((hi-lo)*.06,.5);return {{ctx,w,h,lo:lo-pad,hi:hi+pad}}}}
function priceY(price,d){{return 10+(d.h-20)*(d.hi-price)/(d.hi-d.lo)}}function yPrice(y,d){{return d.hi-(Math.max(10,Math.min(d.h-10,y))-10)/(d.h-20)*(d.hi-d.lo)}}
function drawChart(canvas,bars,overlays=[]){{if(!bars.length)return;let d=dims(canvas,bars),c=d.ctx;c.clearRect(0,0,d.w,d.h);c.strokeStyle='#252b32';for(let i=1;i<5;i++){{let y=i*d.h/5;c.beginPath();c.moveTo(0,y);c.lineTo(d.w,y);c.stroke()}}overlays.forEach(z=>{{let y1=priceY(z.hi,d),y2=priceY(z.lo,d);c.fillStyle=z.kind==='tp'?'rgba(232,144,85,.20)':'rgba(120,150,210,.18)';c.fillRect(0,y1,d.w,y2-y1);c.strokeStyle=z.kind==='tp'?'#e89055':'#7896d2';c.strokeRect(0,y1,d.w,y2-y1)}});let step=d.w/Math.max(bars.length,1),bw=Math.max(1,Math.min(7,step*.55));bars.forEach((b,i)=>{{let x=(i+.5)*step,yo=priceY(b.open,d),yc=priceY(b.close,d),yh=priceY(b.high,d),yl=priceY(b.low,d),up=b.close>=b.open;c.strokeStyle=up?'#76c893':'#e06c75';c.fillStyle=c.strokeStyle;c.beginPath();c.moveTo(x,yh);c.lineTo(x,yl);c.stroke();c.fillRect(x-bw/2,Math.min(yo,yc),bw,Math.max(1,Math.abs(yc-yo)))}});c.fillStyle='#9aa4af';c.font='11px system-ui';c.fillText(d.hi.toFixed(2),4,12);c.fillText(d.lo.toFixed(2),4,d.h-4);canvas._dim=d}}
function redraw(){{let l=label();drawChart(chart15,current().fifteen_minute,l.trader_zones.map(z=>({{...z,kind:'zone'}})));drawChart(chart5,current().five_minute,l.trader_tp_zone?[{{...l.trader_tp_zone,kind:'tp'}}]:[]);drawChart(chart1,current().one_minute,[])}}
function render(){{let c=current(),l=label();progress.textContent=`Case ${{idx+1}} of ${{pack.case_count}}`;caseMeta.innerHTML=`<b>${{c.session}}</b><span class=sub>Decision clock: ${{c.decision_time}}</span>`;actionStatus.textContent=l.trader_action||'UNSET';forceStatus.textContent=l.trader_force||'UNSET';note.value=l.note||'';zonesList.innerHTML=l.trader_zones.length?l.trader_zones.map((z,i)=>`<div class=zoneRow><b>${{z.role}}</b> ${{z.lo.toFixed(2)}} – ${{z.hi.toFixed(2)}} <button onclick="removeZone(${{i}})">Remove</button></div>`).join(''):'No key zones marked';tpStatus.textContent=l.trader_tp_zone?`TP reaction zone: ${{l.trader_tp_zone.lo.toFixed(2)}} – ${{l.trader_tp_zone.hi.toFixed(2)}}`:'No TP zone marked';document.querySelectorAll('[data-action]').forEach(b=>b.classList.toggle('active',b.dataset.action===l.trader_action));document.querySelectorAll('[data-force]').forEach(b=>b.classList.toggle('active',b.dataset.force===l.trader_force));redraw();save()}}
function removeZone(i){{label().trader_zones.splice(i,1);render()}}window.removeZone=removeZone;
function startDraw(kind,canvas){{mode=kind;dragStart=null;document.querySelectorAll('#drawZone,#drawTp').forEach(b=>b.classList.remove('active'));(kind==='zone'?drawZone:drawTp).classList.add('active');canvas.style.cursor='crosshair'}}
function bindDrag(canvas,kind){{canvas.addEventListener('pointerdown',e=>{{if(mode!==kind)return;dragStart=e.offsetY}});canvas.addEventListener('pointerup',e=>{{if(mode!==kind||dragStart===null)return;let d=canvas._dim,z=norm(yPrice(dragStart,d),yPrice(e.offsetY,d));if(z.hi-z.lo<.25)z.hi=z.lo+.25;if(kind==='zone')label().trader_zones.push({{...z,role:zoneRole.value}});else label().trader_tp_zone=z;mode=null;dragStart=null;canvas.style.cursor='default';render()}})}}
bindDrag(chart15,'zone');bindDrag(chart5,'tp');drawZone.onclick=()=>startDraw('zone',chart15);drawTp.onclick=()=>startDraw('tp',chart5);addZone.onclick=()=>{{if(zoneLo.value===''||zoneHi.value==='')return;let z=norm(zoneLo.value,zoneHi.value);label().trader_zones.push({{...z,role:zoneRole.value}});zoneLo.value=zoneHi.value='';render()}};undoZone.onclick=()=>{{label().trader_zones.pop();render()}};addTp.onclick=()=>{{if(tpLo.value===''||tpHi.value==='')return;label().trader_tp_zone=norm(tpLo.value,tpHi.value);tpLo.value=tpHi.value='';render()}};clearTp.onclick=()=>{{label().trader_tp_zone=null;render()}};
document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>{{label().trader_action=b.dataset.action;render()}});document.querySelectorAll('[data-force]').forEach(b=>b.onclick=()=>{{label().trader_force=b.dataset.force;render()}});note.oninput=()=>{{label().note=note.value;save()}};prev.onclick=()=>{{idx=Math.max(0,idx-1);render()}};next.onclick=()=>{{idx=Math.min(pack.case_count-1,idx+1);render()}};window.addEventListener('resize',()=>redraw());
freeze.onclick=async()=>{{let missing=[];for(let c of pack.cases){{let l=labels[c.case_id];if(!l||!l.trader_action||!l.trader_force){{missing.push(c.case_id);continue}}if((l.trader_action==='ENTER_LONG'||l.trader_action==='ENTER_SHORT')&&(!l.trader_zones.length||!l.trader_tp_zone))missing.push(c.case_id)}}if(missing.length){{alert(`Finish all cases first. ${{missing.length}} case(s) are incomplete. Entries require at least one key zone and a TP/reaction zone.`);return}}let rows=pack.cases.map(c=>labels[c.case_id]);let body={{schema_version:2,pack_id:pack.pack_id,frozen_at:new Date().toISOString(),labels:rows}};let raw=JSON.stringify(body);let digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)))).map(x=>x.toString(16).padStart(2,'0')).join('');body.labels_sha256=digest;let blob=new Blob([JSON.stringify(body,null,2)],{{type:'application/json'}}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='mnq_replay_labels_FROZEN.json';a.click();alert('Labels exported. Keep this file unchanged for grading. SHA256: '+digest)}};render();
</script></body></html>'''
