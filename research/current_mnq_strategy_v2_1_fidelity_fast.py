#!/usr/bin/env python3
from __future__ import annotations
import copy
from research import current_mnq_strategy_v2_1_fidelity as b

_orig_clusters = b.v1.clusters
_orig_fvg = b.active_fvgs_partial
_orig_targets = b.build_targets
_orig_prior = b.prior_bars
_orig_bias = b.v2.premarket_bias
_orig_exit = b.v2.exit_1m
_orig_merge = b.pd.DataFrame.merge
_orig_to_datetime = b.pd.to_datetime

_cluster_cache = {}
_fvg_cache = {}
_target_cache = {}
_prior_cache = {}
_bias_cache = {}
_exit_cache = {}

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

def cached_prior(full5, ts, n):
    key=(id(full5),str(ts),int(n))
    if key not in _prior_cache:
        _prior_cache[key]=_orig_prior(full5,ts,n)
    return _prior_cache[key]

def cached_bias(full5,dte,pdm,pwm,pcm):
    key=(id(full5),str(dte))
    if key not in _bias_cache:
        _bias_cache[key]=_orig_bias(full5,dte,pdm,pwm,pcm)
    return _bias_cache[key]

def cached_exit(one,entry_time,direction,entry,target,p):
    key=(id(one),str(entry_time),direction,float(entry),float(target),float(p.stop))
    if key not in _exit_cache:
        _exit_cache[key]=_orig_exit(one,entry_time,direction,entry,target,p)
    return _exit_cache[key]

def reporting_merge_compat(self, right, *args, **kwargs):
    if kwargs.get('on') == 'variant' and 'variant' not in self.columns and 'name' in self.columns:
        self = self.rename(columns={'name':'variant'})
    return _orig_merge(self, right, *args, **kwargs)

def reporting_datetime_compat(arg, *args, **kwargs):
    # Reporting-only DST compatibility for the saved entry_time strings.
    # Jan-Apr spans EST and EDT, so normalize this one diagnostic Series to UTC.
    if getattr(arg, 'name', None) == 'entry_time' and 'utc' not in kwargs:
        kwargs['utc'] = True
    return _orig_to_datetime(arg, *args, **kwargs)

if __name__=='__main__':
    b.v1.clusters=cached_clusters
    b.active_fvgs_partial=cached_fvg
    b.build_targets=cached_targets
    b.prior_bars=cached_prior
    b.v2.premarket_bias=cached_bias
    b.v2.exit_1m=cached_exit
    b.pd.DataFrame.merge=reporting_merge_compat
    b.pd.to_datetime=reporting_datetime_compat
    b.main()
