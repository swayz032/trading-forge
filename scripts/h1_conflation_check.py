#!/usr/bin/env python3
"""Semantic conflation check via gpt-5.4-FLEX HIGH (path-(d) anti-merge-silencing axis).
Calibration pair (R5L890-FUSED must REJECT, -igp mirror must PASS) + design-pool 22.
Mid-run HARD-CAP enforced (Ruling-3 guard). Cross-vendor: Claude enumerated, OpenAI judges fusion."""
import json, os, time, threading, sys
from concurrent.futures import ThreadPoolExecutor, as_completed
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from h1_metered_cap_guard import MeteredCapGuard, CapBreach
from openai import OpenAI
ROOT="."
key=[l.split("=",1)[1].strip().strip('"').strip("'") for l in open(os.path.join(ROOT,".env"),encoding="utf-8") if l.startswith("OPENAI_API_KEY=")][0]
c=OpenAI(api_key=key, timeout=1200, max_retries=0)
SV=os.path.join(ROOT,"docs","replay-results","h1-scripts","claude-rung-designpool","staging_v32")
TDIR=os.path.join(ROOT,"docs","replay-results","h1-scripts","pilot-run","transcripts")
OUTD=os.path.join(ROOT,"docs","replay-results","h1-scripts","claude-rung-v32","conflation_grades")
FUSED=os.path.join(ROOT,"docs","replay-results","h1-scripts","claude-rung-v32","conflation_fixtures","R5L890_FUSED_reject.json")
os.makedirs(OUTD,exist_ok=True)
GRADER=open(os.path.join(ROOT,"src","agents","semantic-conflation-check.md"),encoding="utf-8").read()
TICKET=0.60; capg=MeteredCapGuard(TICKET); lock=threading.Lock(); done=[0]

def obj(props,req): return {"type":"object","properties":props,"required":req,"additionalProperties":False}
SCHEMA=obj({"strategy_name":{"type":"string"},"verdict":{"type":"string","enum":["PASS","REJECT"]},
 "is_single_coherent_trade":{"type":"boolean"},"reasoning":{"type":"string"},
 "fused_pair":{"type":["array","null"],"items":{"type":"string"}}},
 ["strategy_name","verdict","is_single_coherent_trade","reasoning","fused_pair"])

def tx(vid):
    d=json.load(open(os.path.join(TDIR,vid+".json"),encoding="utf-8"))
    return d["text"] if isinstance(d,dict) and isinstance(d.get("text"),str) else json.dumps(d)

# build work items: (cid, transcript_vid, strategy_obj, expect)
items=[]
fused=json.load(open(FUSED,encoding="utf-8"))["strategies"][0]
items.append(("CAL_R5L890_FUSED","R5L890juvRw",fused,"REJECT"))
for f in sorted(os.listdir(SV)):
    if not f.endswith(".json"): continue
    vid=f[:-5].split("__")[0]
    s=json.load(open(os.path.join(SV,f),encoding="utf-8"))["strategies"][0]
    items.append((f[:-5],vid,s,"PASS?"))  # expect PASS if certified reader clean; -igp = mirror cal

def run(it):
    cid,vid,strat,expect=it
    outp=os.path.join(OUTD,cid+".json")
    if os.path.exists(outp): return cid,"cached"
    user=(f"TRANSCRIPT (context):\n{tx(vid)}\n\nSTRATEGY OBJECT to judge:\n{json.dumps(strat,ensure_ascii=False)}\n\nApply the mirror-vs-fusion test. Return ONLY the JSON.")
    body={"model":"gpt-5.4","service_tier":"flex","reasoning_effort":"high",
          "messages":[{"role":"system","content":GRADER},{"role":"user","content":user}],
          "response_format":{"type":"json_schema","json_schema":{"name":"ConflationVerdict","schema":SCHEMA,"strict":True}}}
    est=(len(json.dumps(body))//4)+3500
    delay=8.0
    for a in range(6):
        try:
            with lock: capg.guard_or_raise(est)
            r=c.chat.completions.create(**body)
            v=json.loads(r.choices[0].message.content)
            json.dump({"custom_id":cid,"expect":expect,"verdict":v,"tokens":r.usage.total_tokens},open(outp,"w",encoding="utf-8", newline="\n"),ensure_ascii=False,indent=1)
            with lock:
                capg.record(r.usage.total_tokens); done[0]+=1
                print(f"  [{done[0]}/{len(items)}] {cid}: {v['verdict']} (expect {expect}) {r.usage.total_tokens}tok",flush=True)
            return cid,v["verdict"]
        except CapBreach as e:
            with lock: print(f"  !! HARD-CAP STOP: {e}",flush=True)
            return cid,"CAP_STOP"
        except Exception as e:
            m=str(e)
            if any(x in m.lower() for x in ["429","resource","rate","overloaded","try again","timeout"]) and a<5:
                time.sleep(delay); delay=min(delay*1.7,90); continue
            with lock: print(f"  !! {cid} ERR {type(e).__name__}: {m[:120]}",flush=True)
            return cid,"error"
    return cid,"exhausted"

t0=time.time()
with ThreadPoolExecutor(max_workers=6) as ex:
    res=[f.result() for f in as_completed([ex.submit(run,it) for it in items])]
print("="*56)
print(f"conflation check done in {time.time()-t0:.0f}s | ~${capg.spent_usd:.3f}/{TICKET} | {capg.spent_tok:,}tok")
# calibration verdict
gr={}
for cid,vid,strat,expect in items:
    p=os.path.join(OUTD,cid+".json")
    if os.path.exists(p): gr[cid]=json.load(open(p,encoding="utf-8"))["verdict"]["verdict"]
print("CALIBRATION:")
print(f"  R5L890-FUSED -> {gr.get('CAL_R5L890_FUSED')} (must be REJECT)")
print(f"  -igp mirror  -> {gr.get('-igpOZs8LsM__s0')} (must be PASS)")
rej=[k for k,v in gr.items() if v=="REJECT" and k!="CAL_R5L890_FUSED"]
print(f"  22 real: {sum(1 for k,v in gr.items() if v=='PASS' and k!='CAL_R5L890_FUSED')}/22 PASS ; REJECTs among 22: {rej}")
cal_ok = gr.get('CAL_R5L890_FUSED')=="REJECT" and gr.get('-igpOZs8LsM__s0')=="PASS"
print(f"CALIBRATION {'PASSES (both polarities correct)' if cal_ok else 'FAILS -- do NOT wire'}")
# record spend
led_p=os.path.join(ROOT,"docs","replay-results","h1-scripts","frontier-daily-ledger.json")
led=json.load(open(led_p,encoding="utf-8"))
day=sorted([k for k in led if k.startswith("2026-07") and isinstance(led[k],dict) and "gpt54" in led[k]])[-1]
led[day]["gpt54"]+=capg.spent_tok
led[day]["_conflation_check"]={"tokens":capg.spent_tok,"est_usd":round(capg.spent_usd,3),"cal_ok":cal_ok}
json.dump(led,open(led_p,"w",encoding="utf-8", newline="\n"),indent=1)
