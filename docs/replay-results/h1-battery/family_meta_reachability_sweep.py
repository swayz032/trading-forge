"""FAMILY_META REACHABILITY SWEEP - the ACCEPTANCE INSTRUMENT for the enforcement build.

COMMITTED because the enforcement packet uses this as its acceptance test ("the sweep is re-run and
its verdicts must MOVE"), and that comparison is only valid if the SAME instrument produces both
tables. It previously lived in a session-scoped scratchpad; a re-authored copy would have made the
before/after apples-to-oranges. Standing law: the harness behind a headline number COMMITS.

Baseline this script produced: family-meta-reachability-sweep-baseline.json
  n = 2000 real ES 5min bars, corroborated over 120 corpus specs x 600 bars.
  Of the 9 families declaring a real primitive: 3 REACHABLE / 2 PARTIAL / 4 NOT-REACHABLE,
  plus 2 COULD-NOT-VERIFY. All 7 positive controls fired before any zero was trusted.

KNOWN TRAP (cost a false NOT-REACHABLE once): an exemplar that is not BINDABLE never enters dispatch,
so its counter reads 0 for a reason that has nothing to do with reachability. Confirm the exemplar
reaches dispatch before believing any zero.

On commit, ONLY path handling was changed (ROOT, OUT). No behavioural change.

2026-07-21, the ENFORCEMENT build (docs/designs/packet-family-meta-enforced-2026-07-20.md):
the `declared` column now reads meta.effective_primitive() instead of meta.primitive, and two
new columns (`gates`, `production_executed`) are recorded. REASON: FamilyMeta now carries TWO
declaration columns for the length of the build (legacy + enforced, two-commit law), and an
instrument that reads only the legacy one would report "no movement" for a packet whose entire
subject is the declaration moving — a caption that cannot respond to its subject. `declared` now
means "what this engine declares UNDER THE ACTIVE REGIME", which is what the instrument was
always for. PROVEN INERT with the flag OFF, stated exactly: the flag-off arm reproduces
family-meta-reachability-sweep-baseline.json with ZERO VALUE DIFFERENCES ON EVERY PREVIOUSLY-
MEASURED COLUMN, across all 14/14 families; the ENTIRE delta is the two ADDED columns above
(effective_primitive() returns meta.primitive when TF_FAMILY_META_ENFORCED is not true). So the
before/after comparison remains same-instrument. Nothing else changed; no counter, control,
exemplar or verdict rule was touched.

★ CORRECTION, 2026-07-21, and it is the point of this note. This paragraph originally said the
flag-off arm reproduces the baseline "BYTE-IDENTICALLY". That word is FALSE and falsifiably so:
a plain `json.dumps(a) == json.dumps(b)` returns False, because two columns were added. The
SUBSTANCE was and is true, but a checkable superlative that fails its own check is exactly the
caption-is-a-claim shape this packet exists to delete — and it appeared in the header of the
packet's own acceptance instrument. Anyone re-running the naive comparison gets False and may
reasonably conclude the instrument was compromised. Caught by the advisor seat on independent
re-derivation, not by the author. The phrasing above is now the one that survives its own test.
"""
from __future__ import annotations
import json, sys, os, contextlib, datetime as _dt
import numpy as np, polars as pl

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
os.chdir(ROOT); sys.path.insert(0, ROOT)
# ★ H1-W4 D3 -- newline pinned. Had encoding but no newline, so universal-newlines translation
# emitted CRLF on Windows and LF elsewhere: the same run produced different bytes per platform.
OUT = open(os.path.join(os.environ.get("TMPOUT", os.path.dirname(os.path.abspath(__file__))), "family-meta-reachability-sweep.log"), "w", encoding="utf-8", newline="\n", buffering=1)
def P(*a):
    s = " ".join(str(x) for x in a); OUT.write(s + "\n")

import src.engine.spec_family_bindings as sfb
import src.engine.spec_condition_compiler as scc
import src.engine.context.structure_engine as structure_engine
import src.engine.context.bias_engine as bias_engine
import src.engine.session_windows as session_windows
import src.engine.context.structural_stops as structural_stops

FAMILIES = dict(sfb.FAMILY_META)
P(f"FAMILY_META entries (derived from live dict): {len(FAMILIES)}")
P("families:", sorted(FAMILIES))

BARS = int(os.environ.get("SWEEP_BARS", "2000"))
CORPUS_BARS = int(os.environ.get("CORPUS_BARS", "600"))
full = pl.read_parquet("data_cache/ES/ratio_adj/5min.parquet")
def slice_bars(k): return full.slice(len(full) - k, k).select(["ts_event","open","high","low","close","volume"])
df = slice_bars(BARS); N = len(df)
dfc = slice_bars(CORPUS_BARS)
P(f"per-family bars n={N}; corpus-pass bars n={len(dfc)}; parquet rows={len(full)}")

corpus = json.load(open("docs/replay-results/or-branches-full-corpus-specs-2026-07-05.json", encoding="utf-8"))
def iter_specs(o):
    if isinstance(o, dict):
        if "entry_conditions" in o and "entry_trigger_id" in o: yield o; return
        for v in o.values(): yield from iter_specs(v)
    elif isinstance(o, list):
        for v in o: yield from iter_specs(v)
SPECS = list(iter_specs(corpus))
seen, inv_seen = {}, {}
for s in SPECS:
    for c in s.get("entry_conditions") or []: seen.setdefault((c.get("type"), c.get("role")), c)
    for c in s.get("invalidations") or []: inv_seen.setdefault(c.get("type"), c)
P(f"corpus specs={len(SPECS)}")

def exemplar(ft):
    for role in ("spine","trigger","confluence"):
        if (ft, role) in seen:
            c = dict(seen[(ft, role)]); c["role"]="spine"; return c, f"entry_condition(orig role={role})"
    if ft in inv_seen:
        c = dict(inv_seen[ft]); c["role"]="spine"; return c, "invalidations entry"
    return None, "NONE"
def mk(cond, inval=None):
    return {"entry_conditions":[cond], "invalidations": inval or [], "entry_trigger_id": cond.get("id"), "direction":"long"}

class C:
    def __init__(s,n): s.name=n; s.n=0
    def wrap(s,fn):
        def w(*a,**k):
            s.n+=1; return fn(*a,**k)
        return w

TARGETS = {
  "session_windows.is_in_killzone": [(scc,"is_in_killzone"),(session_windows,"is_in_killzone")],
  "structure_engine.compute_structure_state": [(structure_engine,"compute_structure_state")],
  "bias_engine.classify_institutional_regime": [(bias_engine,"classify_institutional_regime")],
  "bias_engine.compute_bias": [(bias_engine,"compute_bias")],
  "scc.retest_touch_check": [(scc,"retest_touch_check")],
  "scc.candle_confirmation_check": [(scc,"candle_confirmation_check")],
  "structural_stops.compute_structural_stop": [(scc,"compute_structural_stop"),(structural_stops,"compute_structural_stop")],
}

@contextlib.contextmanager
def all_counted():
    ctrs = {k: C(k) for k in TARGETS}
    saved = []
    for lab, tl in TARGETS.items():
        for mod, attr in tl:
            saved.append((mod, attr, getattr(mod, attr)))
            setattr(mod, attr, ctrs[lab].wrap(getattr(mod, attr)))
    try: yield ctrs
    finally:
        for mod, attr, orig in saved: setattr(mod, attr, orig)

# ── POSITIVE CONTROLS ────────────────────────────────────────────────────────
P("\n=== POSITIVE CONTROLS ===")
with all_counted() as ct:
    scc.is_in_killzone(_dt.datetime(2025,1,6,14,35,tzinfo=_dt.UTC),"ny_am")
    w=df.slice(0,300); structure_engine.compute_structure_state(w,w)
    try: bias_engine.classify_institutional_regime(session_health=.5,atr_percentile=.5,volume_ratio=1.,range_vs_atr=1.,price_displacement=.5)
    except Exception: pass
    try: bias_engine.compute_bias()
    except Exception: pass
    z=np.zeros(10); scc.retest_touch_check(z,z,z,z,np.ones(10))
    o=np.ones(10); scc.candle_confirmation_check(o,o,o,o)
    try: scc.compute_structural_stop(direction="long",entry_price=100.,point_value=1.,atr=1.,tick_size=.25,symbol="MES",nearest_swing_low=99.,nearest_swing_high=101.)
    except Exception: pass
    CONTROLS = {k:v.n for k,v in ct.items()}
for k,v in CONTROLS.items(): P(f"  {'FIRED' if v else '*** DEAD ***'}  {k}: {v}")
assert all(v>0 for v in CONTROLS.values()), "instrument untrusted"

# ── PER-FAMILY ───────────────────────────────────────────────────────────────
P(f"\n=== PER-FAMILY (real corpus condition, n={N} real ES 5min bars) ===")
RES={}
for ft, meta in FAMILIES.items():
    cond, src = exemplar(ft)
    r={"declared":meta.effective_primitive(),"approximation":meta.effective_approximation(),"executed":meta.executed,
       "unsupported":meta.unsupported,"exemplar":src,"object":(cond or {}).get("object","")[:80],
       "gates":meta.gates,"production_executed":meta.production_executed}
    if cond is None:
        RES[ft]=r; P(f"\n{ft}: declared={meta.primitive} -- NO CORPUS EXEMPLAR"); continue
    with all_counted() as ct:
        st = scc.SpecConditionStrategy(compiled_spec={"spec": mk(cond)}, symbol="MES", timeframe="5m")
        out = st.compute(df)
    counts={k:v.n for k,v in ct.items()}
    pcb=st.last_per_condition_bool
    arrs={k:{"true":int(v.sum()),"n":len(v),"all_true":bool(v.all())} for k,v in pcb.items()}
    bnd=[{"bindable":b.bindable,"primitive":b.primitive,"approx":b.approximation,"executed":b.executed,"role":b.role}
         for b in st.binding_plan.bindings]
    r.update({"counts":counts,"fired":{k:v for k,v in counts.items() if v},
              "signals_L":int(out["entry_long"].sum()),"signals_S":int(out["entry_short"].sum()),
              "arrays":arrs,"bindings":bnd,"n":N})
    RES[ft]=r
    P(f"\n{ft}:")
    P(f"   declared   = {meta.primitive}  (approximation={meta.base_approximation}, executed={meta.executed})")
    P(f"   exemplar   = {src}  object={r['object']!r}")
    P(f"   binding    = {bnd}")
    P(f"   FIRED      = {r['fired']}")
    P(f"   zero-count = {[k for k,v in counts.items() if v==0]}")
    P(f"   signals    = L{r['signals_L']}/S{r['signals_S']}  per-cond arrays={arrs}")

# ── CORPUS CORROBORATION ─────────────────────────────────────────────────────
P(f"\n=== CORPUS CORROBORATION: all {len(SPECS)} real specs UNMODIFIED, n={len(dfc)} bars each ===")
tot_sig=0; errs=0
with all_counted() as ct:
    for s in SPECS:
        try:
            st=scc.SpecConditionStrategy(compiled_spec={"spec":s},symbol="MES",timeframe="5m")
            o=st.compute(dfc); tot_sig+=int(o["entry_long"].sum())+int(o["entry_short"].sum())
        except Exception as e: errs+=1
    CORP={k:v.n for k,v in ct.items()}
for k,v in CORP.items(): P(f"  {k:44s} {v}")
P(f"  total entry signals across corpus: {tot_sig}; spec errors: {errs}")

# ── BRANCH PROBES ────────────────────────────────────────────────────────────
P("\n=== BRANCH PROBE: WIRE-1 columns PRESENT ===")
dfw = df.with_columns([pl.lit(True).alias("htf_structure_active"), pl.lit("bullish").alias("htf_daily_trend")])
for ft in ("WAIT_STRUCTURE","VERIFY_STRUCTURE","WAIT_BIAS","CONFIRM_DIRECTION"):
    cond,_=exemplar(ft)
    with all_counted() as ct:
        st=scc.SpecConditionStrategy(compiled_spec={"spec":mk(cond)},symbol="MES",timeframe="5m"); st.compute(dfw)
    P(f"  {ft:18s} wired-cols -> {{k:v.n for k,v in ct.items() if v.n}} = { {k:v.n for k,v in ct.items() if v.n} }")

P("\n=== INVALIDATE probe: trace OFF (production default) vs ON ===")
inv=dict(inv_seen["INVALIDATE"]); sess=dict(seen[("WAIT_SESSION","spine")])
sp={"entry_conditions":[sess],"invalidations":[inv],"entry_trigger_id":sess.get("id"),"direction":"long"}
for tr in (False,True):
    with all_counted() as ct:
        st=scc.SpecConditionStrategy(compiled_spec={"spec":sp},symbol="MES",timeframe="5m",trace=tr)
        o=st.compute(df)
    P(f"  trace={tr!s:5s} compute_structural_stop={ct['structural_stops.compute_structural_stop'].n}  "
      f"entry_long={int(o['entry_long'].sum())} (n={N})  trace_records={len(st.last_trace)}")

P("\n=== FILTER second-order: is the array a constant? ===")
fc,_=exemplar("FILTER")
st=scc.SpecConditionStrategy(compiled_spec={"spec":mk(fc)},symbol="MES",timeframe="5m"); o=st.compute(df)
for k,v in st.last_per_condition_bool.items():
    P(f"  FILTER cond {k}: unique values={sorted(set(v.tolist()))} true={int(v.sum())}/{len(v)}")

# ── SECOND ORDER: compute_bias(bars=) callers, AST-derived ───────────────────
P("\n=== SECOND-ORDER: compute_bias production call sites (AST over src/) ===")
import ast, glob
for f in glob.glob("src/**/*.py", recursive=True):
    try: t=ast.parse(open(f,encoding="utf-8").read())
    except Exception: continue
    for nd in ast.walk(t):
        if isinstance(nd,ast.Call):
            nm = nd.func.id if isinstance(nd.func,ast.Name) else (nd.func.attr if isinstance(nd.func,ast.Attribute) else "")
            if nm in ("compute_bias","classify_institutional_regime","compute_structure_state"):
                kws=[k.arg for k in nd.keywords]
                P(f"  {f}:{nd.lineno} {nm}(pos={len(nd.args)}, kw={kws})")

json.dump({"families":RES,"controls":CONTROLS,"corpus":CORP,"n":N,"corpus_n":len(dfc),"n_specs":len(SPECS)},
          # ★ H1-W4 D3 -- encoding pinned; newline was already pinned here.
          open(os.path.join(os.environ.get("TMPOUT", os.path.dirname(os.path.abspath(__file__))),"family-meta-reachability-sweep-latest.json"),"w", encoding="utf-8", newline="\n"), indent=1, default=str)
P("\nDONE")
OUT.close()


# ═════════════════════════════════════════════════════════════════════════════
# EXPOSURE CENSUS (R-656 §4) — APPENDED 2026-08-03, STRICTLY ADDITIVE.
#
# WHY IT LIVES HERE AND NOT IN A SIBLING FILE (R-656 §4.0): a ruling against
# re-building what exists may not begin by re-building what exists. This file
# already holds the live FAMILY_META enumeration, the import surface, an AST
# pass, the TMPOUT/encoding/newline pins and the positive-control discipline.
#
# ★ ADDITIVE GUARANTEE, PINNED: everything above this line is UNTOUCHED — no
#   counter, control, TARGETS entry, RES key or JSON key is changed, and this
#   section runs AFTER OUT.close() and writes to its OWN handle + OWN json.
#   The enforcement packet's before/after comparison therefore still holds:
#   family-meta-reachability-sweep.log and -latest.json are byte-unaffected.
#
# WHAT THE SWEEP ABOVE CANNOT DO, AND WHY THIS EXISTS (AR-706 §1): TARGETS is a
# hand-written dict of 7 primitive names, and all 7 are already FAMILY_META
# primitives. So the sweep above measures THE DECLARED SET AGAINST REALITY. It
# can never find a detector NO family declares. This section measures REALITY
# AGAINST THE DECLARED SET — the opposite direction, and the only one that
# finds an undeclared detector.
# ═════════════════════════════════════════════════════════════════════════════
import ast as _ast, re as _re, glob as _glob
from collections import Counter as _Counter

_XOUT = open(os.path.join(os.environ.get("TMPOUT", os.path.dirname(os.path.abspath(__file__))),
                          "exposure-census.log"), "w", encoding="utf-8", newline="\n", buffering=1)
def X(*a):
    _XOUT.write(" ".join(str(x) for x in a) + "\n")

# ── §4.2 SURFACE + RULE. Both are DECLARED, not inferred (R-656 stop cond. 2).
_SURFACE = [
    "src/engine/indicators/core.py",
    "src/engine/context/structure_engine.py",
    "src/engine/context/structural_stops.py",
    "src/engine/session_windows.py",
    "src/engine/context/session_context.py",
]
_RULE = _re.compile(r"^(compute_|detect_|is_|resolve_|classify_)")
X("EXPOSURE CENSUS (R-656 §4)")
X("SURFACE (declared, not inferred):")
for _f in _SURFACE:
    X("   ", _f)
X("RULE   : module-level def, name matches ^(compute_|detect_|is_|resolve_|classify_), not _private")
X("NOTE   : the RULE is a PROXY for 'computes a market quantity'. It over-includes helpers and")
X("         may under-include a detector named otherwise. The full matched list is printed so the")
X("         over/under-inclusion is AUDITABLE rather than hidden inside a count.")
X("")

# ── §4.1 THE COMPILER'S REACHABLE SET ────────────────────────────────────────
_declared = set()
for _ft, _m in sfb.FAMILY_META.items():
    for _v in (_m.primitive, _m.effective_primitive()):
        if isinstance(_v, str) and _v and "\x00" not in _v and _v not in ("provenance_only",):
            _declared.add(_v.split(".")[-1])
_scc_tree = _ast.parse(open("src/engine/spec_condition_compiler.py", encoding="utf-8").read())
_imported = {a.name for nd in _ast.walk(_scc_tree) if isinstance(nd, _ast.ImportFrom)
             and "engine" in (nd.module or "") for a in nd.names}
_REACHABLE = _declared | _imported
X("=== §4.1 COMPILER-REACHABLE SET ===")
X(f"  FAMILY_META declared primitives (leaf) n={len(_declared)}: {sorted(_declared)}")
X(f"  spec_condition_compiler imports from src.engine n={len(_imported)}: {sorted(_imported)}")
X(f"  UNION (everything compile_binding_plan can bind to) n={len(_REACHABLE)}")
X("")

# ── §4.2 THE ENGINE'S BUILT SET ──────────────────────────────────────────────
_built = {}
for _f in _SURFACE:
    for _nd in _ast.parse(open(_f, encoding="utf-8").read()).body:
        if isinstance(_nd, (_ast.FunctionDef, _ast.AsyncFunctionDef)) and not _nd.name.startswith("_") \
           and _RULE.match(_nd.name):
            _built[_nd.name] = (_f, _nd.lineno)
X(f"=== §4.2 BUILT SET === n={len(_built)}")
for _k in sorted(_built):
    X(f"   {_k:38s} {_built[_k][0]}:{_built[_k][1]}")
X("")

# ── caller index. NOTE: same-file callers are COUNTED. Excluding the defining
#   file manufactured callers=0 for compute_opening_range_breakout, whose only
#   callers ARE in its own file (the compute_indicators dispatcher) — a false
#   zero on the census's single most load-bearing symbol. Do not re-add it.
_NONTEST = [p.replace("\\", "/") for p in _glob.glob("src/**/*.py", recursive=True)]
_NONTEST = [p for p in _NONTEST if "/tests/" not in p and not os.path.basename(p).startswith("test_")]
_callers = {k: [] for k in _built}
for _p in _NONTEST:
    try: _t = _ast.parse(open(_p, encoding="utf-8").read())
    except Exception: continue
    for _nd in _ast.walk(_t):
        if isinstance(_nd, _ast.Call):
            _fn = _nd.func
            _nm = _fn.id if isinstance(_fn, _ast.Name) else (_fn.attr if isinstance(_fn, _ast.Attribute) else None)
            if _nm in _callers:
                _callers[_nm].append(f"{_p}:{_nd.lineno}")

# ── POSITIVE + NEGATIVE CONTROLS, ASSERTED BEFORE ANY ZERO IS PUBLISHED ──────
X("=== CONTROLS (a zero is inadmissible until these pass) ===")
_c_pos = len(_callers.get("compute_atr", []))
_c_reach = "compute_structure_state" in _REACHABLE
_c_neg = [k for k, v in _callers.items() if not v]
X(f"  POSITIVE  compute_atr caller count      = {_c_pos}   (must be > 0)")
X(f"  POSITIVE  compute_structure_state reach = {_c_reach} (must be True)")
X(f"  POSITIVE  built-set non-empty           = {len(_built)}")
X(f"  NEGATIVE  symbols with ZERO callers     = {len(_c_neg)} {_c_neg}")
X("            (a counter that returns non-zero for EVERYTHING is not discriminating)")
assert _c_pos > 0 and _c_reach and _built, "exposure census instrument untrusted"
X("  -> CONTROLS PASS")
X("")

# ── §4.3 THE DIFF ────────────────────────────────────────────────────────────
_FLAGRE = _re.compile(r"[\"'](TF_[A-Z0-9_]+)[\"']")
_ROWS = []
for _k in sorted(_built):
    _f, _ln = _built[_k]
    _reach = _k in _REACHABLE
    _n = len(_callers[_k])
    _src = open(_f, encoding="utf-8").read()
    _flags = sorted(set(_FLAGRE.findall(_src)))
    if _reach:      _state = "BUILT+REACHABLE"
    elif _n > 0:    _state = "BUILT+UNREACHABLE-BY-COMPILER"
    else:           _state = "BUILT+NO-NONTEST-CALLER"
    _ROWS.append({"symbol": _k, "state": _state, "where": f"{_f}:{_ln}",
                  "nontest_callers": _n, "caller_sites": _callers[_k][:6],
                  "module_TF_flags": _flags})
X("=== §4.3 THE DIFF ===")
for _r in _ROWS:
    X(f"   {_r['state']:32s} {_r['symbol']:38s} callers={_r['nontest_callers']:3d}  {_r['where']}")
X("")
X("=== TAXONOMY ===")
for _k, _v in _Counter(_r["state"] for _r in _ROWS).most_common():
    X(f"   {_k:34s} {_v}")
X(f"   {'ABSENT':34s} 0   (residual: nothing on the surface was expected-but-missing)")
X("")

# ── §4.4 THE PAYING QUESTION — REPORT ONLY, NEVER EXPOSE ─────────────────────
X("=== §4.4 compute_opening_range_breakout — REPORT ONLY, NOT EXPOSED ===")
for _r in _ROWS:
    if _r["symbol"] == "compute_opening_range_breakout":
        X(f"   state   : {_r['state']}")
        X(f"   where   : {_r['where']}")
        X(f"   callers : {_r['nontest_callers']} -> {_r['caller_sites']}")
        X(f"   in REACHABLE set? {_r['symbol'] in _REACHABLE}")
X("")
json.dump({"surface": _SURFACE, "rule": _RULE.pattern, "reachable_n": len(_REACHABLE),
           "reachable": sorted(_REACHABLE), "built_n": len(_built), "rows": _ROWS,
           "taxonomy": dict(_Counter(r["state"] for r in _ROWS)),
           "controls": {"compute_atr_callers": _c_pos, "structure_state_reachable": _c_reach,
                        "zero_caller_symbols": _c_neg}},
          open(os.path.join(os.environ.get("TMPOUT", os.path.dirname(os.path.abspath(__file__))),
                            "exposure-census-latest.json"), "w", encoding="utf-8", newline="\n"),
          indent=1, default=str)
X("DONE")
_XOUT.close()
