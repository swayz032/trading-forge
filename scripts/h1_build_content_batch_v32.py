#!/usr/bin/env python3
"""v3.2 content re-grade batch input — grader v2 (two-tier) over v3.2 extractions.
Tier-A silencings gate; Tier-B coaching in coaching_notes reads clean."""
import json, os, glob
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SV=os.path.join(ROOT,"docs","replay-results","h1-scripts","claude-rung-designpool","staging_v32")
GI=os.path.join(ROOT,"docs","replay-results","h1-scripts","claude-rung-designpool","grown_inventory")
TDIR=os.path.join(ROOT,"docs","replay-results","h1-scripts","pilot-run","transcripts")
OUT=os.path.join(ROOT,"docs","replay-results","h1-scripts","claude-rung-v32")
GRADER=open(os.path.join(ROOT,"src","agents","content-preservation-grader-v2.md"),encoding="utf-8").read()

def obj(props,req): return {"type":"object","properties":props,"required":req,"additionalProperties":False}
SCHEMA=obj({
 "strategy_name":{"type":"string"},
 "silenced":{"type":"array","items":obj({"item":{"type":"string"},"transcript_evidence":{"type":"string"},"why_not_covered":{"type":"string"}},["item","transcript_evidence","why_not_covered"])},
 "content_clean":{"type":"boolean"},
 "coaching_dropped":{"type":"array","items":{"type":"string"}},
 "inventory_overreach":{"type":"array","items":{"type":"string"}},
 "notes":{"type":"string"},
},["strategy_name","silenced","content_clean","coaching_dropped","inventory_overreach","notes"])

def load_tx(vid):
    d=json.load(open(os.path.join(TDIR,vid+".json"),encoding="utf-8"))
    return d["text"] if isinstance(d,dict) and isinstance(d.get("text"),str) else json.dumps(d)

def grown_for(vid,name):
    d=json.load(open(os.path.join(GI,vid+".json"),encoding="utf-8"))
    for s in d.get("strategies",[]):
        if s.get("name")==name: return s
    return {"element_inventory":[],"coaching_notes":[]}

lines=[]
for f in sorted(glob.glob(os.path.join(SV,"*.json"))):
    base=os.path.basename(f)[:-5]; vid=base.split("__")[0]
    ext=json.load(open(f,encoding="utf-8"))
    name=(ext.get("strategies") or [{}])[0].get("name") or base
    inv=grown_for(vid,name)
    user=(f"TRANSCRIPT:\n{load_tx(vid)}\n\n"
          f"EXTRACTION TO GRADE (strategy '{name}') — note its coaching_notes[] channel:\n{json.dumps(ext,ensure_ascii=False)}\n\n"
          f"TIER-A element_inventory (the compilable checklist — silencing any of these is a content FAIL):\n{json.dumps(inv.get('element_inventory',[]),ensure_ascii=False)}\n\n"
          f"TIER-B coaching_notes (reference — these belong in coaching_notes, NEVER a content fail):\n{json.dumps(inv.get('coaching_notes',[]),ensure_ascii=False)}\n\n"
          f"Grade content-preservation per the v2 two-tier taxonomy. Return ONLY the JSON object.")
    body={"model":"gpt-5.4","messages":[{"role":"system","content":GRADER},{"role":"user","content":user}],
          "response_format":{"type":"json_schema","json_schema":{"name":"ContentPreservationGradeV2","schema":SCHEMA,"strict":True}},
          "reasoning_effort":"high"}
    lines.append({"custom_id":base,"method":"POST","url":"/v1/chat/completions","body":body})

path=os.path.join(OUT,"content_batch_v32_input.jsonl")
with open(path,"w",encoding="utf-8") as w:
    for L in lines: w.write(json.dumps(L,ensure_ascii=False)+"\n")
print(f"requests: {len(lines)} | reasoning_effort=high | grader v2 | -> {path}")
