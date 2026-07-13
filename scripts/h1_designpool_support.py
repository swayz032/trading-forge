#!/usr/bin/env python3
"""H1 design-pool VERDICT — locator-anchored support over gpt-5.4's whole-job
extraction of the spent-16 (the make-or-break ≤8% bar). Same model-free instrument
as Option R / the mini judge (local gemma, FREE). Reports BOTH numbers (§12):
gated (over quoted/anchorable conditions) AND terminal-equivalent (all conditions,
declines = miss). Flags ENUMERATION-UNSTABLE videos (mode<4/5 -> owed one blind
adjudication). Retry-wrapped, resumable cache.
"""
import json, os, sys, time
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from src.engine.extraction import anchor_locator as al

TDIR = os.path.join(ROOT, "docs", "replay-results", "h1-scripts", "pilot-run", "transcripts")
VAULT = os.path.join(ROOT, "docs", "replay-results", "h1-scripts", "frontier-designpool", "vault")
OUT = os.path.join(ROOT, "docs", "replay-results", "h1-scripts", "frontier-designpool")
CACHE = os.path.join(OUT, "_support_cache.json")


class Plumbing(Exception): pass

def robust_propose(tx, ct, tries=3, backoff=2.0):
    last = None
    for a in range(tries):
        try: return al._default_propose_fn(tx, ct)
        except Exception as e: last = e; time.sleep(backoff * (a + 1))
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
    out = []
    for s in (ext.get("strategies") or []):
        for st in (s.get("entry_sequence") or []):
            a = st.get("action") if isinstance(st, dict) else st
            if a: out.append(a)
        for c in (s.get("confluences") or []):
            desc = c.get("description") if isinstance(c, dict) else c
            if desc: out.append(desc)
        stop = s.get("stop")
        if isinstance(stop, dict) and stop.get("anchor"): out.append(stop["anchor"])
        for t in (s.get("targets") or []):
            d = t.get("description") if isinstance(t, dict) else t
            if d: out.append(d)
    return out

def main():
    cache = json.load(open(CACHE, encoding="utf-8")) if os.path.exists(CACHE) else {}
    per_video, txc = {}, {}
    total, located, plumb, unstable_videos = 0, 0, 0, []
    files = sorted(f for f in os.listdir(VAULT) if f.endswith(".json"))
    for f in files:
        vid = f[:-5]
        v = json.load(open(os.path.join(VAULT, f), encoding="utf-8"))
        if (v.get("phase_a") or {}).get("unstable"): unstable_videos.append(vid)
        if vid not in txc: txc[vid] = load_tx(vid)
        tx = txc[vid]
        vt, vl = 0, 0
        for ps in v.get("phase_b", []):
            for ct in conditions_of(ps.get("extraction") or {}):
                key = f"{vid}::{hash(ct) & 0xffffffff}"
                if key in cache: rec = cache[key]
                else:
                    try: rec = {"located": bool(al.locate_anchor(tx, ct, propose_fn=robust_propose).located)}
                    except Plumbing: rec = {"plumbing": True}
                    cache[key] = rec; json.dump(cache, open(CACHE, "w", encoding="utf-8"))
                if rec.get("plumbing"): plumb += 1; continue
                vt += 1; total += 1
                if rec["located"]: vl += 1; located += 1
        per_video[vid] = {"conditions": vt, "located": vl, "anchor_rate": round(vl/vt, 4) if vt else None}
        print(f"  {vid}: {vl}/{vt} anchored ({per_video[vid]['anchor_rate']})", flush=True)

    miss = total - located
    rate = miss / total if total else None
    out = {
        "artifact": "frontier-designpool-locator-support",
        "n_videos": len(files), "total_conditions": total, "located": located, "miss": miss,
        "support_miss_rate": round(rate, 4) if rate is not None else None,
        "floor_le_8pct_MET": (rate <= 0.08) if rate is not None else None,
        "plumbing_excluded": plumb,
        "enumeration_unstable_videos": unstable_videos,
        "per_video": per_video,
        "verdict": None,
    }
    if rate is not None and len(files) == 16:
        out["verdict"] = ("DESIGN POOL CLEARS (<=8%) -> freeze SHA -> terminal read preconditions"
                          if rate <= 0.08 else
                          "DESIGN POOL MISSES (>8%) -> the ladder (Claude rung-2 same birth gate) / human-in-loop floor")
    elif rate is not None:
        out["verdict"] = f"PARTIAL ({len(files)}/16 extracted) — not a final verdict"
    json.dump(out, open(os.path.join(OUT, "designpool_support_report.json"), "w", encoding="utf-8"), indent=1)
    print("=" * 66)
    print(f"DESIGN-POOL support ({len(files)}/16 videos): {located}/{total} anchored, "
          f"miss {rate*100:.1f}% (floor <=8%){' UNSTABLE:'+','.join(unstable_videos) if unstable_videos else ''}")
    print(out["verdict"] or "(incomplete)")
    print("=" * 66)

if __name__ == "__main__":
    main()
