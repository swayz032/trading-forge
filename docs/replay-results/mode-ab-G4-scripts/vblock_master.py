#!/usr/bin/env python
"""Master join for the Mode A/B (G4) validity block. NON-DIRECTIONAL: counts, flips, engagement, effective-N.
No verdict/direction read here — that is gated to the full-78 evening sitting."""
import json, collections, sys

BASE='C:/Users/tonio/Projects/trading-forge/wt-parta/'
def load(p): return json.load(open(BASE+p, encoding='utf-8'))

# 1) spec map from strategy_list (symbol, tf, name, direction, trigger structure)
specs = load('mode_ab_G4_strategy_list.json')
smap = {}
for s in specs:
    cs = (s.get('compiled_spec') or {}).get('spec') or {}
    ag = cs.get('and_groups') or []
    ob = cs.get('or_branches') or []
    flat_ag = [c for grp in ag for c in grp]
    has_wait_bias = any('WAIT_BIAS' in str(c) for c in flat_ag) or any('WAIT_BIAS' in str(c) for grp in ob for c in grp)
    # scan BOTH and_groups AND or_branches (parity with has_wait_bias) — CONFIRM often lives in or_branches
    has_confirm = (any('CONFIRM' in str(c).upper() for c in flat_ag)
                   or any('CONFIRM' in str(c).upper() for grp in ob for c in grp))
    smap[s['id']] = dict(symbol=s.get('symbol'), tf=s.get('timeframe'), name=s.get('name'),
                         direction=s.get('direction'), n_and=len(ag), n_or=len(ob),
                         has_wait_bias=has_wait_bias, has_or_branch=bool(ob), has_confirm=has_confirm)

# 2) G0 baseline
g0 = load('docs/replay-results/mode-ab-corpus-v2-2026-07-04-report.json')['results']
def tc(row, mode):
    m = row.get(mode)
    if not isinstance(m, dict): return None
    if m.get('error'): return 'ERR'
    return m.get('trade_count')
g0map = {r['spec_id']: dict(a=tc(r,'mode_a'), b=tc(r,'mode_b'),
                            err=(r.get('mode_a') or {}).get('error') if isinstance(r.get('mode_a'),dict) else None)
         for r in g0}

# 3) G4 manifest (deduped by spec_id, last wins)
g4rows = {}
for l in open(BASE+'mode_ab_G4_manifest.jsonl', encoding='utf-8'):
    if not l.strip(): continue
    try: r = json.loads(l)
    except: continue
    g4rows[r.get('spec_id')] = r
def g4tc(r, mode):
    m = r.get(mode)
    if not isinstance(m, dict): return None
    if m.get('error'): return 'ERR'
    return m.get('trade_count')
g4map = {}
for sid, r in g4rows.items():
    ma, mb = r.get('mode_a'), r.get('mode_b')
    err = ma.get('error') if isinstance(ma, dict) else None
    g4map[sid] = dict(a=g4tc(r,'mode_a'), b=g4tc(r,'mode_b'), err=err,
                      od_a=(ma or {}).get('overlay_disabled') if isinstance(ma,dict) else None,
                      od_b=(mb or {}).get('overlay_disabled') if isinstance(mb,dict) else None)

allids = list(smap.keys())
print(f"=== JOIN: strategy_list={len(smap)} | G0={len(g0map)} | G4={len(g4map)} (G4 pending={len(smap)-len(g4map)}) ===\n")

# ---------- Component 4: MCL abort count + signature ----------
mcl_err = [(sid, g4map[sid]['err']) for sid in g4map if g4map[sid]['err'] and 'MCL' in str(g4map[sid]['err'])]
sig46 = sum(1 for _,e in mcl_err if '46 zero/negative' in str(e))
print(f"[C4 MCL] G4 MCL-abort rows: {len(mcl_err)} | carrying '46 zero/negative' signature: {sig46}")
# how many MCL specs total in the corpus (by symbol)?
mcl_specs = [sid for sid in smap if smap[sid]['symbol']=='MCL']
print(f"[C4 MCL] MCL specs in strategy_list: {len(mcl_specs)} | MCL present-in-G4: {sum(1 for s in mcl_specs if s in g4map)}\n")

# ---------- Component 7: engagement / decision-variance (overlay A vs B) ----------
clean = [sid for sid in g4map if not g4map[sid]['err'] and isinstance(g4map[sid]['a'],(int,float))]
div = same = 0
od_ok = 0
for sid in clean:
    a,b = g4map[sid]['a'], g4map[sid]['b']
    if isinstance(b,(int,float)):
        if a!=b: div+=1
        else: same+=1
    # overlay flags: mode_a should be overlay_disabled True, mode_b False
    if g4map[sid]['od_a'] is True and g4map[sid]['od_b'] is False: od_ok+=1
print(f"[C7 engage] clean-ran G4: {len(clean)} | overlay-flag correct (A=off,B=on): {od_ok}/{len(clean)}")
print(f"[C7 engage] decision-variance A!=B (overlay CHANGED trades): {div} | A==B (no change): {same}\n")

# ---------- Component 2 + 1: zero-pair cross-check & flips (mode_a primary) ----------
g4_zero = [sid for sid in clean if g4map[sid]['a']==0]
print(f"[C2 zero] G4 clean mode_a==0 specs: {len(g4_zero)}")
flips_down=[]; stable_zero=[]; up_anom=[]
for sid in g4_zero:
    g0a = g0map.get(sid,{}).get('a')
    if isinstance(g0a,(int,float)) and g0a>0:
        flips_down.append(sid)     # G0 traded -> G4 zero
    elif g0a==0:
        stable_zero.append(sid)    # zero both sides
# upward anomaly: G0 zero -> G4 nonzero
for sid in clean:
    g0a=g0map.get(sid,{}).get('a')
    if g0a==0 and isinstance(g4map[sid]['a'],(int,float)) and g4map[sid]['a']>0:
        up_anom.append(sid)
print(f"[C2 zero] G0-traded->G4-zero (DOWN flips): {len(flips_down)} | stable-zero both: {len(stable_zero)} | G0-zero->G4-nonzero (UP anomaly): {len(up_anom)}\n")

print("[C1 flips] the DOWN-flip specs w/ trigger structure:")
for sid in flips_down:
    m=smap.get(sid,{});
    print(f"  {sid[:8]} {m.get('symbol')}/{m.get('tf'):>3} {str(m.get('name'))[:34]:34} "
          f"G0a={g0map[sid]['a']} G0b={g0map[sid]['b']} -> G4a=0 G4b={g4map[sid]['b']} | "
          f"wait_bias={m.get('has_wait_bias')} or_branch={m.get('has_or_branch')} confirm={m.get('has_confirm')} n_or={m.get('n_or')}")
print()

# ---------- Component 3: exactly-8 clustering on G0 (implausible-uniform check) ----------
g0_counts = collections.Counter()
for sid in g0map:
    a=g0map[sid]['a']
    if isinstance(a,(int,float)): g0_counts[a]+=1
print(f"[C3 clust] G0 mode_a trade_count distribution (top values):")
for val,cnt in sorted(g0_counts.items(), key=lambda x:-x[1])[:8]:
    print(f"    tc={val}: {cnt} specs")
g0_eq8 = [sid for sid in g0map if g0map[sid]['a']==8]
print(f"[C3 clust] G0 specs at EXACTLY 8 trades: {len(g0_eq8)}  (the implausible-uniform signal)")
# same for G4
g4_counts=collections.Counter()
for sid in clean:
    a=g4map[sid]['a']
    if isinstance(a,(int,float)): g4_counts[a]+=1
g4_eq8=[sid for sid in clean if g4map[sid]['a']==8]
print(f"[C3 clust] G4 specs at EXACTLY 8 trades: {len(g4_eq8)}  (G4 distribution top: {sorted(g4_counts.items(),key=lambda x:-x[1])[:5]})\n")

# ---------- Component 8: effective-N arithmetic ----------
launched=len(smap)
g4_present=len(g4map)
g4_err_any=[sid for sid in g4map if g4map[sid]['err']]
g4_mcl=len(mcl_err)
g4_oom=sum(1 for sid in g4map if g4map[sid]['err'] and 'MemoryError' in str(g4map[sid]['err']))
g4_other_err=len(g4_err_any)-g4_mcl-g4_oom
pending=[sid for sid in smap if sid not in g4map]
traded=[sid for sid in clean if (isinstance(g4map[sid]['a'],(int,float)) and g4map[sid]['a']>0) or (isinstance(g4map[sid]['b'],(int,float)) and g4map[sid]['b']>0)]
print("[C8 effective-N]")
print(f"    launched (strategy_list): {launched}")
print(f"    G4 present (done): {g4_present} | pending (stragglers): {len(pending)} -> {[p[:8] for p in pending]}")
print(f"    errors: MCL-abort={g4_mcl} (data-gate) | OOM={g4_oom} | other={g4_other_err}")
print(f"    clean-ran: {len(clean)} | TRADED: {len(traded)} | zero-trade: {len(clean)-len(traded)}")
print(f"    effective-N (clean-ran, current): {len(clean)}  -> traded-informative: {len(traded)}")

# ---------- SYMMETRIC SWEEP: gain-flips (G0 dead activity -> G4 traded), ACTIVITY instrument ----------
g0raw={r['spec_id']:r for r in g0}
def g0_act(sid):
    r=g0raw.get(sid,{}); mm=r.get('mode_a') or {}
    if mm.get('error'): return ('ERR',None,None)
    dp=mm.get('daily_pnls') or []
    nz=sum(1 for x in dp if isinstance(x,(int,float)) and x!=0)
    tot=round(sum(abs(x) for x in dp if isinstance(x,(int,float))),1)
    return (mm.get('trade_count'),nz,tot)
gain=[]; nobaseline=[]
for sid in traded:  # G4-traded (informative)
    g0tc,g0nz,g0abs=g0_act(sid)
    mm=smap.get(sid,{})
    rec=dict(sid=sid,symbol=mm.get('symbol'),tf=mm.get('tf'),name=mm.get('name'),
             direction=mm.get('direction'),g0tc=g0tc,g0nz=g0nz,g0abs=g0abs,
             g4tc=g4map[sid]['a'],has_wait_bias=mm.get('has_wait_bias'),
             has_or_branch=mm.get('has_or_branch'),has_confirm=mm.get('has_confirm'))
    if g0tc=='ERR':            # G0 mode_a errored -> NO baseline, exits flip taxonomy (per operator ruling)
        rec['g0_error']=str((g0raw.get(sid,{}).get('mode_a') or {}).get('error',''))[:70]
        nobaseline.append(rec)
    elif (g0nz is None) or (g0nz<=1):   # clean-but-dead G0 -> TRUE gain-flip candidate
        gain.append(rec)
print(f"\n[SYMMETRIC] TRUE gain-flips (G0-clean-dead->G4-traded): {len(gain)} -> {[g['sid'][:8] for g in gain]}")
print(f"[SYMMETRIC] no-baseline (G0-error, exits flip read): {len(nobaseline)} -> {[g['sid'][:8] for g in nobaseline]}")

# dump structured blob
out=dict(join=dict(strategy_list=len(smap),g0=len(g0map),g4=len(g4map),pending=[p for p in pending]),
         gainflips=gain, nobaseline=nobaseline,
         c1_flips=[dict(sid=s,**smap[s],g0a=g0map[s]['a'],g0b=g0map[s]['b'],g4b=g4map[s]['b']) for s in flips_down],
         c2=dict(g4_zero=len(g4_zero),down=len(flips_down),stable_zero=len(stable_zero),up_anom=len(up_anom),up_ids=up_anom),
         c3=dict(g0_eq8=len(g0_eq8),g4_eq8=len(g4_eq8),g0_dist=dict(g0_counts),g4_dist=dict(g4_counts)),
         c4=dict(mcl_err=len(mcl_err),sig46=sig46,mcl_specs=len(mcl_specs)),
         c7=dict(clean=len(clean),od_ok=od_ok,divergent=div,same=same),
         c8=dict(launched=launched,present=g4_present,pending=len(pending),mcl=g4_mcl,oom=g4_oom,other_err=g4_other_err,clean=len(clean),traded=len(traded)))
json.dump(out, open(BASE+'vblock_master_out.json','w', newline="\n"), indent=1, default=str)
print("\n[written vblock_master_out.json]")
