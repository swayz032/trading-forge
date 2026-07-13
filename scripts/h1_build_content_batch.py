#!/usr/bin/env python3
"""Build the CLAUDE-rung content-preservation BATCH input (gpt-5.4-batch grades Claude's
extractions). One request per strategy. Cost pre-check at BATCH rates before any submit."""
import json, os, glob
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STG=os.path.join(ROOT,"docs","replay-results","h1-scripts","claude-rung-designpool","staging")
TDIR=os.path.join(ROOT,"docs","replay-results","h1-scripts","pilot-run","transcripts")
OUT=os.path.join(ROOT,"docs","replay-results","h1-scripts","claude-rung-designpool")
GRADER=open(os.path.join(ROOT,"src","agents","content-preservation-grader.md"),encoding="utf-8").read()
SCOPES=json.load(open(os.path.join(ROOT,"docs","replay-results","h1-scripts","claude-rung","phaseb-scopes.json"),encoding="utf-8"))["videos"]

# strict json_schema (all-required, additionalProperties:false) for grader output
def obj(props, req): return {"type":"object","properties":props,"required":req,"additionalProperties":False}
SCHEMA=obj({
  "strategy_name":{"type":"string"},
  "silenced":{"type":"array","items":obj({
      "item":{"type":"string"},"transcript_evidence":{"type":"string"},"why_not_covered":{"type":"string"}},
      ["item","transcript_evidence","why_not_covered"])},
  "content_clean":{"type":"boolean"},
  "inventory_overreach":{"type":"array","items":{"type":"string"}},
  "notes":{"type":"string"},
}, ["strategy_name","silenced","content_clean","inventory_overreach","notes"])

def load_tx(vid):
    d=json.load(open(os.path.join(TDIR,vid+".json"),encoding="utf-8"))
    if isinstance(d,dict) and isinstance(d.get("text"),str): return d["text"]
    return json.dumps(d)

def inv_for(vid, name):
    for s in SCOPES[vid]["strategies"]:
        if s["name"]==name: return s.get("element_inventory",[])
    return []

lines=[]; in_tok=0; out_tok_est=0
for f in sorted(glob.glob(os.path.join(STG,"*.json"))):
    base=os.path.basename(f)[:-5]; vid=base.split("__")[0]
    ext=json.load(open(f,encoding="utf-8"))
    name=(ext.get("strategies") or [{}])[0].get("name") or base
    tx=load_tx(vid); inv=inv_for(vid,name)
    user=(f"TRANSCRIPT:\n{tx}\n\n"
          f"EXTRACTION TO GRADE (strategy '{name}'):\n{json.dumps(ext,ensure_ascii=False)}\n\n"
          f"ENUMERATOR INVENTORY for this strategy:\n{json.dumps(inv,ensure_ascii=False)}\n\n"
          f"Grade content-preservation per your instructions. Return ONLY the JSON object.")
    body={"model":"gpt-5.4",
          "messages":[{"role":"system","content":GRADER},{"role":"user","content":user}],
          "response_format":{"type":"json_schema","json_schema":{"name":"ContentPreservationGrade","schema":SCHEMA,"strict":True}},
          "reasoning_effort":"high"}
    lines.append({"custom_id":base,"method":"POST","url":"/v1/chat/completions","body":body})
    in_tok += (len(GRADER)+len(user))//4 + 20
    out_tok_est += 700   # grade JSON + some reasoning

path=os.path.join(OUT,"content_batch_input.jsonl")
with open(path,"w",encoding="utf-8") as w:
    for L in lines: w.write(json.dumps(L,ensure_ascii=False)+"\n")

# BATCH rates (50% off): gpt-5.4 input $1.25/1M, output $7.50/1M
cost = in_tok*1.25/1e6 + out_tok_est*7.50/1e6
print(f"requests: {len(lines)}")
print(f"input tokens ~{in_tok:,} | output tokens est ~{out_tok_est:,}")
print(f"BATCH cost estimate: ${cost:.3f}  (cap $0.60, sync-fallback $1.10)")
print(f"UNDER CAP: {cost<=0.60}")
print(f"input jsonl: {path}")
