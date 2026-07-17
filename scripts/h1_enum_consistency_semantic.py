#!/usr/bin/env python3
"""Semantic enumeration-consistency check via gpt-5.4-FLEX HIGH (path-1 ruling).
Per strategy WITH variants: does any variant re-promote an enumeration-EXCLUDED mention (by MEANING)?
No-variant strategies = trivially consistent (reported vacuous, no LLM call). Hard-cap enforced."""
import json, os, time, threading, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from h1_metered_cap_guard import MeteredCapGuard, CapBreach
from openai import OpenAI
ROOT="."
key=[l.split("=",1)[1].strip().strip('"').strip("'") for l in open(os.path.join(ROOT,".env"),encoding="utf-8") if l.startswith("OPENAI_API_KEY=")][0]
c=OpenAI(api_key=key,timeout=1200,max_retries=0)
SV=os.path.join(ROOT,"docs","replay-results","h1-scripts","claude-rung-designpool","staging_v32")
TDIR=os.path.join(ROOT,"docs","replay-results","h1-scripts","pilot-run","transcripts")
OUTD=os.path.join(ROOT,"docs","replay-results","h1-scripts","claude-rung-v32","enum_semantic_grades")
os.makedirs(OUTD,exist_ok=True)
GRADER=open(os.path.join(ROOT,"src","agents","enumeration-consistency-semantic.md"),encoding="utf-8").read()
LOG=json.load(open(os.path.join(ROOT,"docs","replay-results","h1-scripts","claude-rung","enumeration-exclusion-log.json"),encoding="utf-8"))["excluded_mentions"]
capg=MeteredCapGuard(1.00); lock=threading.Lock(); done=[0]
def obj(p,r): return {"type":"object","properties":p,"required":r,"additionalProperties":False}
SCHEMA=obj({"strategy_name":{"type":"string"},"enumeration_consistent":{"type":"boolean"},
 "offending_variants":{"type":"array","items":obj({"variant":{"type":"string"},"re_promotes_mention":{"type":"string"}},["variant","re_promotes_mention"])},
 "reasoning":{"type":"string"}},["strategy_name","enumeration_consistent","offending_variants","reasoning"])
def tx(vid):
    d=json.load(open(os.path.join(TDIR,vid+".json"),encoding="utf-8"))
    return d["text"] if isinstance(d,dict) and isinstance(d.get("text"),str) else json.dumps(d)
items=[]
for f in sorted(os.listdir(SV)):
    if not f.endswith(".json"): continue
    cid=f[:-5]; vid=cid.split("__")[0]
    s=json.load(open(os.path.join(SV,f),encoding="utf-8"))["strategies"][0]
    items.append((cid,vid,s,s.get("variants") or []))
def run(it):
    cid,vid,s,variants=it
    outp=os.path.join(OUTD,cid+".json")
    if os.path.exists(outp): return
    if not variants:  # trivially consistent, no LLM
        json.dump({"custom_id":cid,"exercised":False,"verdict":{"enumeration_consistent":True,"offending_variants":[],"reasoning":"no variants -> no variant-promotion possible (trivially consistent, not semantically exercised)"}},open(outp,"w",encoding="utf-8"),ensure_ascii=False,indent=1)
        with lock: done[0]+=1; print(f"  [{done[0]}] {cid}: PASS (no variants, vacuous)",flush=True)
        return
    mentions=LOG.get(vid,[])
    user=(f"TRANSCRIPT (context):\n{tx(vid)}\n\nSTRATEGY (judge its variants):\n{json.dumps(s,ensure_ascii=False)}\n\n"
          f"ENUMERATION-EXCLUDED MENTIONS for this video (descriptions — judge by MEANING, NOT key strings):\n{json.dumps(mentions,ensure_ascii=False)}\n\n"
          f"Does any variant re-promote an excluded mention? Return ONLY the JSON.")
    body={"model":"gpt-5.4","service_tier":"flex","reasoning_effort":"high","messages":[{"role":"system","content":GRADER},{"role":"user","content":user}],"response_format":{"type":"json_schema","json_schema":{"name":"EnumConsistencySemantic","schema":SCHEMA,"strict":True}}}
    for a in range(6):
        try:
            with lock: capg.guard_or_raise((len(json.dumps(body))//4)+3500)
            r=c.chat.completions.create(**body); v=json.loads(r.choices[0].message.content)
            json.dump({"custom_id":cid,"exercised":True,"verdict":v,"tokens":r.usage.total_tokens},open(outp,"w",encoding="utf-8"),ensure_ascii=False,indent=1)
            with lock:
                capg.record(r.usage.total_tokens); done[0]+=1
                print(f"  [{done[0]}] {cid}: consistent={v['enumeration_consistent']} offending={[o['variant'] for o in v.get('offending_variants',[])]} ({r.usage.total_tokens}tok)",flush=True)
            return
        except CapBreach as e:
            with lock: print(f"  !! HARD-CAP: {e}",flush=True); return
        except Exception as e:
            m=str(e)
            if any(x in m.lower() for x in ["429","resource","rate","overloaded","try again","timeout"]) and a<5: time.sleep(8*(a+1)); continue
            with lock: print(f"  !! {cid} ERR: {m[:100]}",flush=True); return
from concurrent.futures import ThreadPoolExecutor, as_completed
t0=time.time()
with ThreadPoolExecutor(max_workers=6) as ex:
    [f.result() for f in as_completed([ex.submit(run,it) for it in items])]
# summary
exercised=[]; vac=[]; fails=[]
for cid,vid,s,variants in items:
    d=json.load(open(os.path.join(OUTD,cid+".json"),encoding="utf-8"))
    if d["exercised"]: exercised.append(cid)
    else: vac.append(cid)
    if not d["verdict"]["enumeration_consistent"]: fails.append((cid,[o["variant"] for o in d["verdict"]["offending_variants"]]))
print("="*56)
print(f"done {time.time()-t0:.0f}s ~${capg.spent_usd:.3f} {capg.spent_tok:,}tok")
print(f"EXERCISED (had variants, semantically checked): {len(exercised)}/22 -> {sorted(exercised)}")
print(f"VACUOUS (no variants, trivially consistent): {len(vac)}/22")
print(f"INCONSISTENT (variant re-promotes excluded mention): {fails}")
print(f"CALIBRATION: IyF must be INCONSISTENT -> {[f for f in fails if 'IyF' in f[0]]}")
