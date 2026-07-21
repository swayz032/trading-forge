#!/usr/bin/env python3
"""Merge byte-exact per-strategy staging files -> per-video grounding vault.
DETERMINISTIC, CONTENT-PRESERVING field-normalization to the FROZEN conditions_of shape
(entry_sequence[].action, confluences[].description, targets[].description, stop.anchor).
NEVER concatenates/fabricates: only SELECTS an existing verbatim string. Omissions (secondary
mirror stops) are conservative. Author-written outputs are the measurement set; not modified in place.
"""
import json, os, glob
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STG=os.path.join(ROOT,"docs","replay-results","h1-scripts","claude-rung-designpool","staging")
VLT=os.path.join(ROOT,"docs","replay-results","h1-scripts","claude-rung-designpool","vault")

# verbatim-text field priority for a STOP dict (first present, non-empty string wins as the anchor)
STOP_KEYS=["anchor","description","long_words","scalping","quote","supporting_quote","alternative","break_even_words","short_words","day_trading","long_words_alt"]
# verbatim-text field priority for a TARGET dict
TGT_KEYS=["description","target","quote","supporting_quote","magnitude_quote"]

def first_str(d, keys):
    for k in keys:
        v=d.get(k)
        if isinstance(v,str) and v.strip(): return v
    return None

def norm_strategy(s):
    out={"name": s.get("name") or s.get("strategy_id")}
    # entry_sequence: keep .action verbatim
    es=[]
    for st in (s.get("entry_sequence") or []):
        a = st.get("action") if isinstance(st,dict) else (st if isinstance(st,str) else None)
        if a: es.append({"action": a})
    out["entry_sequence"]=es
    # confluences: keep .description verbatim
    cf=[]
    for c in (s.get("confluences") or []):
        d = c.get("description") if isinstance(c,dict) else (c if isinstance(c,str) else None)
        if d: cf.append({"description": d})
    out["confluences"]=cf
    # targets: verbatim text -> description
    tg=[]
    for t in (s.get("targets") or []):
        if isinstance(t,str): txt=t
        elif isinstance(t,dict): txt=first_str(t,TGT_KEYS)
        else: txt=None
        if txt: tg.append({"description": txt})
    out["targets"]=tg
    # stop: primary verbatim string -> {anchor}
    st=s.get("stop")
    if isinstance(st,str) and st.strip(): out["stop"]={"anchor": st}
    elif isinstance(st,dict):
        a=first_str(st,STOP_KEYS)
        # variant_notes is a list of verbatim strings; use first if nothing else
        if not a and isinstance(st.get("variant_notes"),list):
            for v in st["variant_notes"]:
                if isinstance(v,str) and v.strip(): a=v; break
        if a: out["stop"]={"anchor": a}
        else: out["stop"]=None
    else: out["stop"]=None
    return out

by_vid={}
for f in sorted(glob.glob(os.path.join(STG,"*.json"))):
    base=os.path.basename(f)[:-5]           # e.g. R5L890juvRw__s0
    vid=base.split("__")[0]
    d=json.load(open(f,encoding="utf-8"))
    for s in (d.get("strategies") or []):
        by_vid.setdefault(vid,[]).append(norm_strategy(s))

os.makedirs(VLT,exist_ok=True)
tot_conditions=0
for vid,strats in sorted(by_vid.items()):
    vault={"phase_a":{"unstable":False},
           "phase_b":[{"extraction":{"strategies":[st]}} for st in strats]}
    json.dump(vault, open(os.path.join(VLT,f"{vid}.json"),"w",encoding="utf-8", newline="\n"), ensure_ascii=False, indent=1)
    n=sum(len(st["entry_sequence"])+len(st["confluences"])+len(st["targets"])+(1 if st["stop"] else 0) for st in strats)
    tot_conditions+=n
    print(f"  {vid}: {len(strats)} strat(s), {n} conditions")
print("="*50)
print(f"VAULT BUILT: {len(by_vid)} videos, {tot_conditions} total groundable conditions")
