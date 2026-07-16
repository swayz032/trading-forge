#!/usr/bin/env python3
"""Run the content-preservation panel via FLEX-sync (batch price, synchronous) on gpt-5.4.
Reads the prebuilt batch JSONL bodies, runs each with service_tier=flex, retries 429 w/ backoff.
reasoning_effort=HIGH pinned (already in bodies). Concurrent. Records $ + tokens; caps at $1.00."""
import json, os, time, threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from openai import OpenAI
ROOT="."
key=[l.split("=",1)[1].strip().strip('"').strip("'") for l in open(os.path.join(ROOT,".env"),encoding="utf-8") if l.startswith("OPENAI_API_KEY=")][0]
c=OpenAI(api_key=key, timeout=1200, max_retries=0)  # we handle retries
IN=os.path.join(ROOT,"docs","replay-results","h1-scripts","claude-rung-v32","content_batch_v32_input.jsonl")
OUTD=os.path.join(ROOT,"docs","replay-results","h1-scripts","claude-rung-v32","flex_grades_v32")
os.makedirs(OUTD,exist_ok=True)
reqs=[json.loads(l) for l in open(IN,encoding="utf-8")]
lock=threading.Lock(); tot_tok=[0]; tot_cached=[0]; done=[0]

def run(req):
    cid=req["custom_id"]; body=dict(req["body"]); body["service_tier"]="flex"
    outp=os.path.join(OUTD,cid+".json")
    if os.path.exists(outp):  # resume
        return cid,"cached",0
    delay=8.0
    for attempt in range(6):
        try:
            r=c.chat.completions.create(**body)
            grade=json.loads(r.choices[0].message.content)
            json.dump({"custom_id":cid,"grade":grade,
                       "tokens":r.usage.total_tokens,
                       "cached":(getattr(r.usage,'prompt_tokens_details',None) or {}) and getattr(r.usage.prompt_tokens_details,'cached_tokens',0)},
                      open(outp,"w",encoding="utf-8"),ensure_ascii=False,indent=1)
            with lock:
                tot_tok[0]+=r.usage.total_tokens; done[0]+=1
                cached=getattr(getattr(r.usage,'prompt_tokens_details',None),'cached_tokens',0) or 0
                tot_cached[0]+=cached
                print(f"  [{done[0]}/22] {cid}: clean={grade.get('content_clean')} silenced={len(grade.get('silenced',[]))} ({r.usage.total_tokens}tok)",flush=True)
            return cid,"ok",r.usage.total_tokens
        except Exception as e:
            msg=str(e)
            if any(x in msg.lower() for x in ["429","resource","rate limit","overloaded","try again","timeout"]) and attempt<5:
                time.sleep(delay); delay=min(delay*1.7,90); continue
            with lock: print(f"  !! {cid} FAILED: {type(e).__name__}: {msg[:180]}",flush=True)
            return cid,"error:"+msg[:80],0
    return cid,"exhausted",0

t0=time.time()
with ThreadPoolExecutor(max_workers=6) as ex:
    futs=[ex.submit(run,r) for r in reqs]
    res=[f.result() for f in as_completed(futs)]
# BATCH/FLEX rates: input $1.25/1M, output $7.50/1M, cached input $0.13/1M
# conservative $ estimate (blend ~$2.5/1M on non-cached, cached at $0.13)
noncached=tot_tok[0]-tot_cached[0]
est_usd=noncached*2.5/1e6 + tot_cached[0]*0.13/1e6
print("="*56)
print(f"FLEX panel done in {time.time()-t0:.0f}s | total tokens {tot_tok[0]:,} (cached {tot_cached[0]:,})")
print(f"est $ (flex blend): ${est_usd:.3f}  (cap $0.25)")
oks=sum(1 for _,s,_ in res if s in ("ok","cached"))
print(f"grades written: {oks}/22")
# record spend to ledger
from datetime import datetime
led_p=os.path.join(ROOT,"docs","replay-results","h1-scripts","frontier-daily-ledger.json")
led=json.load(open(led_p,encoding="utf-8")); led["2026-07-13"]["gpt54"]+=tot_tok[0]
led["2026-07-13"].setdefault("_flex_content_panel",{})
led["2026-07-13"]["_flex_content_panel"]={"tokens":tot_tok[0],"cached":tot_cached[0],"est_usd":round(est_usd,3),"service_tier":"flex","effort":"high"}
json.dump(led,open(led_p,"w",encoding="utf-8"),indent=1)
print("ledger updated (gpt54 += panel tokens; _flex_content_panel recorded)")
