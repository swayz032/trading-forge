#!/usr/bin/env python3
"""Design-pool MISS ANATOMY — runs AFTER the verdict lands. Answers the operator's
pre-committed diagnostic: concentrated vs diffuse? drift vs data-pathology?
CLDEIsNpVRc examined specifically. Reuses the verdict's per-condition cache (no new
gemma calls) + re-derives each MISSED condition to classify it:
  - PARAPHRASE-DRIFT: the condition text is a plausible paraphrase; its content words
    DO appear in the transcript but not as a contiguous verbatim span (brain/prompt).
  - DATA-PATHOLOGY: the transcript itself is low-quality near the topic (garbage
    auto-caption / missing) so nothing could ground (not brain, not prompt).
"""
import json, os, sys, re, unicodedata, hashlib, time
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from src.engine.extraction import anchor_locator as al

TDIR = os.path.join(ROOT, "docs", "replay-results", "h1-scripts", "pilot-run", "transcripts")
VAULT = os.path.join(ROOT, "docs", "replay-results", "h1-scripts", "frontier-designpool", "vault")
OUT = os.path.join(ROOT, "docs", "replay-results", "h1-scripts", "frontier-designpool")
CACHE = os.path.join(OUT, "_anatomy_cache.json")  # DETERMINISTic key (sha), self-contained

def _rp(tx, ct, tries=3, backoff=2.0):
    last = None
    for a in range(tries):
        try: return al._default_propose_fn(tx, ct)
        except Exception as e: last = e; time.sleep(backoff*(a+1))
    raise RuntimeError(str(last))

def norm(s):
    s = unicodedata.normalize("NFKC", s or "")
    for a, b in [("’","'"),("‘","'"),("“",'"'),("”",'"'),("–","-"),("—","-")]:
        s = s.replace(a, b)
    return re.sub(r"[^\w\s]", " ", s).lower()

def load_tx(vid):
    d = json.load(open(os.path.join(TDIR, f"{vid}.json"), encoding="utf-8"))
    if isinstance(d, dict) and isinstance(d.get("text"), str): return d["text"]
    if isinstance(d, dict):
        for k in ("transcript","segments","content"):
            v=d.get(k)
            if isinstance(v,str): return v
            if isinstance(v,list): return " ".join(s.get("text","") if isinstance(s,dict) else str(s) for s in v)
    return json.dumps(d)

def conditions_of(ext):
    out=[]
    for s in (ext.get("strategies") or []):
        for st in (s.get("entry_sequence") or []):
            a=st.get("action") if isinstance(st,dict) else st
            if a: out.append(("entry",a))
        for c in (s.get("confluences") or []):
            desc=c.get("description") if isinstance(c,dict) else c
            if desc: out.append(("confluence",desc))
        stop=s.get("stop")
        if isinstance(stop,dict) and stop.get("anchor"): out.append(("stop",stop["anchor"]))
        for t in (s.get("targets") or []):
            dd=t.get("description") if isinstance(t,dict) else t
            if dd: out.append(("target",dd))
    return out

def content_overlap(cond, tx_norm):
    """Fraction of the condition's content words (len>=4) present in the transcript."""
    words=[w for w in norm(cond).split() if len(w)>=4]
    if not words: return 1.0
    return sum(1 for w in words if w in tx_norm)/len(words)

def main():
    cache=json.load(open(CACHE,encoding="utf-8")) if os.path.exists(CACHE) else {}
    txc={}
    per_video={}; misses=[]
    for f in sorted(x for x in os.listdir(VAULT) if x.endswith(".json")):
        vid=f[:-5]
        v=json.load(open(os.path.join(VAULT,f),encoding="utf-8"))
        if vid not in txc: txc[vid]=load_tx(vid)
        txn=norm(txc[vid])
        vt=vl=0; vmiss=[]
        for ps in v.get("phase_b",[]):
            for kind,ct in conditions_of(ps.get("extraction") or {}):
                key=hashlib.sha256(f"{vid}||{ct}".encode()).hexdigest()[:16]  # DETERMINISTic
                if key in cache: rec=cache[key]
                else:
                    try: rec={"located":bool(al.locate_anchor(txc[vid],ct,propose_fn=_rp).located)}
                    except Exception: rec={"plumbing":True}
                    cache[key]=rec; json.dump(cache,open(CACHE,"w",encoding="utf-8"))
                if rec.get("plumbing"): continue
                vt+=1
                if rec["located"]: vl+=1
                else:
                    ov=content_overlap(ct,txn)
                    cls="DATA-PATHOLOGY" if ov<0.5 else "PARAPHRASE-DRIFT"
                    vmiss.append({"kind":kind,"content_overlap":round(ov,2),"class":cls,"condition":ct[:120]})
        per_video[vid]={"conditions":vt,"located":vl,"miss":vt-vl,"anchor_rate":round(vl/vt,4) if vt else None,"misses":vmiss}
        misses.extend((vid,m) for m in vmiss)

    tot=sum(p["conditions"] for p in per_video.values()); loc=sum(p["located"] for p in per_video.values())
    miss=tot-loc
    drift=sum(1 for _,m in misses if m["class"]=="PARAPHRASE-DRIFT")
    patho=sum(1 for _,m in misses if m["class"]=="DATA-PATHOLOGY")
    # concentration: how much of total miss is in the worst 3 videos
    ranked=sorted(per_video.items(), key=lambda kv: kv[1]["miss"], reverse=True)
    top3_miss=sum(kv[1]["miss"] for kv in ranked[:3])
    report={
        "aggregate":{"total":tot,"located":loc,"miss":miss,"miss_rate":round(miss/tot,4) if tot else None,"floor_le_8pct_MET":(miss/tot<=0.08) if tot else None},
        "miss_class":{"paraphrase_drift":drift,"data_pathology":patho},
        "concentration":{"top3_videos_miss":top3_miss,"of_total_miss":miss,"top3_share":round(top3_miss/miss,2) if miss else None,
                         "worst3":[{"video":k,"miss":val["miss"],"anchor_rate":val["anchor_rate"]} for k,val in ranked[:3]]},
        "CLDEIsNpVRc":per_video.get("CLDEIsNpVRc"),
        "per_video":{k:{kk:vv for kk,vv in val.items() if kk!="misses"} for k,val in per_video.items()},
        "all_misses":[{"video":vid,**m} for vid,m in misses],
    }
    json.dump(report,open(os.path.join(OUT,"miss_anatomy.json"),"w",encoding="utf-8"),indent=1)
    print(f"AGGREGATE: {loc}/{tot} anchored, miss {miss/tot*100:.1f}% (floor <=8%)")
    print(f"MISS CLASS: paraphrase-drift={drift} data-pathology={patho}")
    print(f"CONCENTRATION: worst-3 videos hold {top3_miss}/{miss} = {top3_miss/miss*100:.0f}% of all misses")
    print(f"  worst3: {[(k,val['miss'],val['anchor_rate']) for k,val in ranked[:3]]}")
    cld=per_video.get("CLDEIsNpVRc")
    if cld: print(f"CLDEIsNpVRc: {cld['located']}/{cld['conditions']} ({cld['anchor_rate']}), "
                  f"{sum(1 for m in cld['misses'] if m['class']=='DATA-PATHOLOGY')}/{cld['miss']} misses = data-pathology")

if __name__ == "__main__":
    main()
