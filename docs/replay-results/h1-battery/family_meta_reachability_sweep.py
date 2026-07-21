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
OUT = open(os.path.join(os.environ.get("TMPOUT", os.path.dirname(os.path.abspath(__file__))), "family-meta-reachability-sweep.log"), "w", encoding="utf-8", buffering=1)
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
          open(os.path.join(os.environ.get("TMPOUT", os.path.dirname(os.path.abspath(__file__))),"family-meta-reachability-sweep-latest.json"),"w", newline="\n"), indent=1, default=str)
P("\nDONE")
OUT.close()
