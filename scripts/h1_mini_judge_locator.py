#!/usr/bin/env python3
"""Mini Phase-B tryout — MECHANICAL JUDGE (locator anchor-rate, local gemma, FREE).

The role-split contingency needs evidence the mini copies faithfully. The model-free
locator is the judge: over the mini's Phase-B conditions (scoped by gpt-5.4's certified
enumerations), what fraction ground as verbatim substrings? Same >=92%/<=8% instrument
as Option R / the design pool. No raters, no OpenAI cost. Retry-wrapped (cold-load blip
!= miss), resumable cache.
"""
import json, os, sys, time
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from src.engine.extraction import anchor_locator as al

TDIR = os.path.join(ROOT, "docs", "replay-results", "h1-scripts", "pilot-run", "transcripts")
VAULT = os.path.join(ROOT, "docs", "replay-results", "h1-scripts", "mini-phaseB-tryout", "vault")
OUT = os.path.join(ROOT, "docs", "replay-results", "h1-scripts", "mini-phaseB-tryout")
CACHE = os.path.join(OUT, "_judge_cache.json")


class Plumbing(Exception): pass

def robust_propose(tx, ct, tries=3, backoff=2.0):
    last = None
    for a in range(tries):
        try:
            return al._default_propose_fn(tx, ct)
        except Exception as e:
            last = e; time.sleep(backoff * (a + 1))
    raise Plumbing(str(last))

def load_tx(vid):
    d = json.load(open(os.path.join(TDIR, f"{vid}.json"), encoding="utf-8"))
    if isinstance(d, dict) and isinstance(d.get("text"), str): return d["text"]
    if isinstance(d, dict):
        for k in ("transcript", "segments", "content"):
            v = d.get(k)
            if isinstance(v, str): return v
            if isinstance(v, list): return " ".join(s.get("text","") if isinstance(s,dict) else str(s) for s in v)
    return json.dumps(d)

def conditions_of(ext):
    """Condition texts from a Phase-B extraction (entry_sequence actions, confluences, stop, targets)."""
    out = []
    for s in (ext.get("strategies") or []):
        for st in (s.get("entry_sequence") or []):
            a = st.get("action") if isinstance(st, dict) else st
            if a: out.append(("entry", a))
        for c in (s.get("confluences") or []):
            desc = c.get("description") if isinstance(c, dict) else c
            if desc: out.append(("confluence", desc))
        stop = s.get("stop")
        if isinstance(stop, dict) and stop.get("anchor"): out.append(("stop", stop["anchor"]))
        for t in (s.get("targets") or []):
            d = t.get("description") if isinstance(t, dict) else t
            if d: out.append(("target", d))
    return out

def main():
    cache = json.load(open(CACHE, encoding="utf-8")) if os.path.exists(CACHE) else {}
    per_video = {}
    total, located, plumb = 0, 0, 0
    txc = {}
    for f in sorted(os.listdir(VAULT)):
        if not f.endswith(".json"): continue
        vid = f[:-5]
        v = json.load(open(os.path.join(VAULT, f), encoding="utf-8"))
        if vid not in txc: txc[vid] = load_tx(vid)
        tx = txc[vid]
        vt, vl = 0, 0
        for ps in v.get("phase_b", []):
            for kind, ct in conditions_of(ps.get("extraction") or {}):
                key = f"{vid}::{hash(ct) & 0xffffffff}"
                if key in cache:
                    rec = cache[key]
                else:
                    try:
                        res = al.locate_anchor(tx, ct, propose_fn=robust_propose)
                        rec = {"located": bool(res.located)}
                    except Plumbing:
                        rec = {"located": None, "plumbing": True}
                    cache[key] = rec
                    json.dump(cache, open(CACHE, "w", encoding="utf-8"))
                if rec.get("plumbing"): plumb += 1; continue
                vt += 1; total += 1
                if rec["located"]: vl += 1; located += 1
        per_video[vid] = {"conditions": vt, "located": vl, "anchor_rate": round(vl/vt, 4) if vt else None}
        print(f"  {vid}: {vl}/{vt} anchored ({per_video[vid]['anchor_rate']})", flush=True)

    miss = total - located
    rate = miss/total if total else None
    out = {
        "artifact": "mini-phaseB-tryout-mechanical-judge",
        "judge": "model-free locator anchor-rate (same instrument as Option R / design pool)",
        "total_conditions": total, "located": located, "miss": miss,
        "anchor_miss_rate": round(rate, 4) if rate is not None else None,
        "floor_le_8pct_MET": (rate <= 0.08) if rate is not None else None,
        "plumbing_excluded": plumb,
        "per_video": per_video,
        "verdict": None,
    }
    if rate is not None:
        out["verdict"] = ("MINI QUALIFIES for Phase-B copy seat (role-split licensable, own design-pool measurement next)"
                          if rate <= 0.08 else
                          "MINI does NOT qualify for Phase-B (copy-miss > 8%); default stays gpt-5.4 whole-job")
    json.dump(out, open(os.path.join(OUT, "mini_judge_report.json"), "w", encoding="utf-8", newline="\n"), indent=1)
    print("=" * 66)
    print(f"MINI COPY judge: {located}/{total} anchored, miss {rate*100:.1f}% (floor <=8%) -> {'PASS' if rate and rate<=0.08 else 'MISS'}")
    print(out["verdict"])
    print("=" * 66)

if __name__ == "__main__":
    main()
