#!/usr/bin/env python3
from __future__ import annotations
import copy
from research import current_mnq_strategy_v2_1_fidelity as b

_orig_clusters = b.v1.clusters
_orig_fvg = b.active_fvgs_partial
_orig_targets = b.build_targets

_cluster_cache = {}
_fvg_cache = {}
_target_cache = {}

def cached_clusters(pv, side, asof, p, look=40, min_touch=None):
    key=(id(pv),side,str(asof),look,min_touch,p.ztouch,p.ztol,p.zwick,p.zdisp)
    if key not in _cluster_cache:
        _cluster_cache[key]=_orig_clusters(pv,side,asof,p,look=look,min_touch=min_touch)
    return [copy.copy(z) for z in _cluster_cache[key]]

def cached_fvg(h, asof, look_days=25):
    key=(id(h),str(asof),look_days)
    if key not in _fvg_cache:
        _fvg_cache[key]=_orig_fvg(h,asof,look_days)
    return [copy.copy(z) for z in _fvg_cache[key]]

def cached_targets(p5,h15,asof,p,pdm,pwm,dte):
    key=(id(p5),id(h15),str(asof),str(dte),p.ztol,p.zwick,p.zdisp)
    if key not in _target_cache:
        _target_cache[key]=_orig_targets(p5,h15,asof,p,pdm,pwm,dte)
    return [b.Target(copy.copy(t.z),t.source,t.major,t.fvg_confluent) for t in _target_cache[key]]

if __name__=='__main__':
    b.v1.clusters=cached_clusters
    b.active_fvgs_partial=cached_fvg
    b.build_targets=cached_targets
    b.main()
