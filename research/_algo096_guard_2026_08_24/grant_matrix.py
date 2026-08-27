"""Route-by-evidence grant matrix, MEASURED. ALGO-096B pin protocol. Reads no PnL."""
import inspect, json, sys
import pandas as pd
from research import current_mnq_strategy_v2_4_entry_authority as EA
from research import current_mnq_strategy_v2_4_breakout_derivation as brk
from research import current_mnq_strategy_v2_4_derivation as D
from research.current_mnq_strategy_v2_2_engine import Params

TZ="America/New_York"; LO,HI=100.0,102.0
BODY,CLOSE_LOC,WICK=0.62,0.78,0.35
RR=float(Params().range_ratio)

def bars(rows):
    idx=pd.date_range("2026-04-09 10:00",periods=len(rows),freq="5min",tz=TZ)
    return pd.DataFrame({"open":[r[0] for r in rows],"high":[r[1] for r in rows],
                         "low":[r[2] for r in rows],"close":[r[3] for r in rows]},index=idx)

CLEAN_LONG=[(112,113,111,112),(111,112,103,104),(103.5,110.0,100.0,109.7),(109.7,111.0,109.5,110.5)]
ROUTE_B_BARS=[(99,100,98,99.5),(100,104,99.8,103.5),(103.6,106,103.5,105.8)]
ROUTE_C_BARS=[(90,90.5,89.5,90),(90,90.5,89.5,90),(90,90.5,89.5,90),
              (90,99.0,89.9,98.5),(98.5,99.5,98.0,99.0),(99.0,101.8,98.9,101.6),
              (101.6,104,101.5,103.8)]
ACCEPT_N=inspect.signature(brk.break_retest).parameters["acceptance_bars"].default
ROUTE_D_BARS=([(100+i,104+i,99.8+i,103.5+i) for i in range(ACCEPT_N)]
              +[(103.5+ACCEPT_N,105+ACCEPT_N,101.5,102.0),(102,106,102,105.5)])
EV={EA.ROUTE_A_REJECTION:CLEAN_LONG, EA.ROUTE_B_BREAKOUT:ROUTE_B_BARS,
    EA.ROUTE_C_PREBREAK_DISPLACEMENT:ROUTE_C_BARS, EA.ROUTE_D_PREBREAK_RETEST:ROUTE_D_BARS}

def route(rows,r):
    return EA.decide(bars(rows),"L",LO,HI,location_authorized=True,force_confirmed=True,
                     body_frac=BODY,close_loc=CLOSE_LOC,reject_wick=WICK,route=r,range_ratio=RR)

m={r:{e:bool(route(rows,r).granted) for e,rows in EV.items()} for r in EA.ROUTES}
overlaps=sorted((r,e) for r in m for e in m[r] if m[r][e] and r!=e)
print("=== ROUTE-BY-EVIDENCE GRANT MATRIX ===")
print(f"{'route \\ evidence':<34}"+"".join(f"{e[:14]:<16}" for e in EV))
for r in EA.ROUTES:
    print(f"{r:<34}"+"".join(f"{str(m[r][e]):<16}" for e in EV))
print("\nDIAGONAL:", {r: m[r][r] for r in EA.ROUTES})
print("OFF-DIAGONAL GRANTS (the overlap set):", overlaps if overlaps else "NONE")
# The (A,C) cell, at the bar.
b=bars(ROUTE_C_BARS); last=b.iloc[:-1].iloc[-1]
a=route(ROUTE_C_BARS,EA.ROUTE_A_REJECTION)
s=D.derive_story(b,"L",LO,HI,BODY,CLOSE_LOC,WICK)
print("\n=== THE (A,C) CELL, AT THE BAR ===")
print("  last completed bar  O=%.2f H=%.2f L=%.2f C=%.2f   band [%.1f, %.1f]"
      %(last.open,last.high,last.low,last.close,LO,HI))
print("  close INSIDE band:", LO<=float(last.close)<=HI,
      "| close beyond (below lo):", float(last.close)<LO,
      "| close out near side (above hi):", float(last.close)>HI)
g=D._geom(last)
print("  body_frac=%.4f close_loc=%.4f upper_frac=%.4f lower_frac=%.4f"
      %(g.body_frac,g.close_loc,g.upper_frac,g.lower_frac))
print("  OLD fraction rule (upper>=.30 and lower>=.30 and body<=.40) fires:",
      bool(g.upper_frac>=0.30 and g.lower_frac>=0.30 and g.body_frac<=0.40))
print("  Route A grants:",a.granted," state:",a.state," refusal:",a.reason)
print("  taught forms still matched:", s.all_kinds)
json.dump({"matrix":m,"overlaps":[list(x) for x in overlaps]},
          open(sys.argv[1],"w"),indent=2)
print("\nwrote",sys.argv[1])
