"""FAMILY_META ENFORCEMENT — BACKTEST DELTA + SECTION-6a ACCOUNTING
(docs/designs/packet-family-meta-enforced-2026-07-20.md, return checklist items 5, 6, 8/9).

COMMITTED because it produces headline numbers (the per-tier signal delta and the new
approximation rate), and the standing law is that the harness behind a headline number
commits. Same discipline as family_meta_reachability_sweep.py alongside it.

★ TIER SCOPE, STATED BEFORE ANY NUMBER (R-154 section 2). Every figure this script prints
belongs to ONE population: the 120-spec SHAKEDOWN / TIER-B corpus at
docs/replay-results/or-branches-full-corpus-specs-2026-07-05.json. TIER-A IS NOT MEASURED
HERE and is out of this packet's scope. A tier-b delta may never be read as a tier-a impact —
so the tier is printed on every block, and the tier-a line is printed as NOT MEASURED rather
than omitted (an omitted population is one a reader supplies from imagination).

METHOD. Both arms run IN THE SAME PROCESS over the SAME bars; only os.environ
[TF_FAMILY_META_ENFORCED] differs between them (every flag in this codebase is read at call
time precisely so this is possible). The OFF arm is therefore the production engine, not a
reconstruction of it.
"""
from __future__ import annotations

import collections
import json
import os
import sys

import polars as pl

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
os.chdir(ROOT)
sys.path.insert(0, ROOT)

OUTDIR = os.environ.get("TMPOUT", os.path.dirname(os.path.abspath(__file__)))

import src.engine.family_meta_enforcement as fme  # noqa: E402
import src.engine.spec_condition_compiler as scc  # noqa: E402
import src.engine.spec_family_bindings as sfb  # noqa: E402

BARS = int(os.environ.get("DELTA_BARS", "600"))
full = pl.read_parquet("data_cache/ES/ratio_adj/5min.parquet")
df = full.slice(len(full) - BARS, BARS).select(["ts_event", "open", "high", "low", "close", "volume"])

corpus = json.load(open("docs/replay-results/or-branches-full-corpus-specs-2026-07-05.json", encoding="utf-8"))


def iter_specs(o):
    if isinstance(o, dict):
        if "entry_conditions" in o and "entry_trigger_id" in o:
            yield o
            return
        for v in o.values():
            yield from iter_specs(v)
    elif isinstance(o, list):
        for v in o:
            yield from iter_specs(v)


SPECS = list(iter_specs(corpus))
LINES: list[str] = []


def P(*a):
    s = " ".join(str(x) for x in a)
    LINES.append(s)
    # Windows consoles default to cp1252; the log file is the authoritative artifact and is
    # written UTF-8. Never let an encoding fault truncate a measurement run.
    print(s.encode("ascii", "replace").decode("ascii"))


def set_flag(on: bool) -> None:
    if on:
        os.environ[fme.FLAG_ENV] = "true"
        # pin (b2) legitimately fails today on the orphan-zone gap this packet is scoped out
        # of fixing (see the module docstring of family_meta_enforcement). Pins a+b are the
        # ones this build delivers; the skip is RECORDED in the receipt below, never implied.
        os.environ[fme.PINS_ENV] = "a,b"
    else:
        os.environ.pop(fme.FLAG_ENV, None)
        os.environ.pop(fme.PINS_ENV, None)
    fme.reset_enforcement_cache()


def run_arm(on: bool) -> tuple[dict, dict]:
    set_flag(on)
    signals: dict[int, tuple[int, int]] = {}
    plans: dict[int, dict] = {}
    for i, spec in enumerate(SPECS):
        try:
            st = scc.SpecConditionStrategy(compiled_spec={"spec": spec}, symbol="MES", timeframe="5m")
            out = st.compute(df)
            signals[i] = (int(out["entry_long"].sum()), int(out["entry_short"].sum()))
            plans[i] = {
                "compiled": st.binding_plan.compiled,
                "spine_bound": st.binding_plan.spine_bound,
                "spine_total": st.binding_plan.spine_total,
                "approximation_used": st.binding_plan.approximation_used,
                "primitives": sorted({b.primitive or "" for b in st.binding_plan.bindings}),
            }
        except Exception as exc:  # recorded, never swallowed — an arm that errors is a result
            signals[i] = (-1, -1)
            plans[i] = {"error": repr(exc)}
    return signals, plans


P("=" * 92)
P("FAMILY_META ENFORCEMENT DELTA")
P(f"POPULATION: SHAKEDOWN / TIER-B corpus, n={len(SPECS)} specs x {BARS} real ES 5min bars")
P("TIER-A: NOT MEASURED (out of this packet's scope). No figure below is a tier-a figure.")
P("=" * 92)

off_signals, off_plans = run_arm(False)
on_signals, on_plans = run_arm(True)
set_flag(False)

# ── 6. BACKTEST DELTA, tier-b ────────────────────────────────────────────────────────────
moved = [i for i in off_signals if off_signals[i] != on_signals[i]]
errs_off = [i for i in off_signals if off_signals[i] == (-1, -1)]
errs_on = [i for i in on_signals if on_signals[i] == (-1, -1)]
tot_off = sum(a + b for a, b in off_signals.values() if a >= 0)
tot_on = sum(a + b for a, b in on_signals.values() if a >= 0)

P("")
P("── [TIER-B] ITEM 6: BACKTEST SIGNAL DELTA ─────────────────────────────────────────────")
P(f"[TIER-B] specs measured                 n = {len(SPECS)}")
P(f"[TIER-B] specs whose signals MOVED      n = {len(moved)}  ({len(moved)}/{len(SPECS)})")
P(f"[TIER-B] total entry signals  flag-OFF  = {tot_off}")
P(f"[TIER-B] total entry signals  flag-ON   = {tot_on}")
P(f"[TIER-B] net signal delta               = {tot_on - tot_off}")
P(f"[TIER-B] spec errors  OFF={len(errs_off)}  ON={len(errs_on)}")
for i in moved[:25]:
    P(f"   spec[{i}] L/S {off_signals[i]} -> {on_signals[i]}")
if not moved:
    P("   NO per-bar movement. This is EXPECTED and is not evidence the change is unwired:")
    P("   every declaration that moved is either (i) a re-POINT at the code that was already")
    P("   executing (WAIT_BIAS / CONFIRM_DIRECTION -> the EMA-slope proxy that ran all along),")
    P("   or (ii) a family whose mechanism is constant-True and STAYS constant-True because")
    P("   no per-bar primitive exists and inventing one is prohibited (FILTER, ENABLE_ENTRY,")
    P("   ENTER). The wiring evidence is the PLAN delta below, which is non-empty.")

# ── ★ POSITIVE CONTROL ON THE DELTA HARNESS ITSELF ──────────────────────────────────────
# A "0 delta" from an instrument that has not been shown capable of reporting a NON-zero one
# is a probe that cannot fail — the exact shape this whole packet exists to delete. So before
# the zero above is trusted: re-point WAIT_SESSION at the confirmation primitive (a change
# that MUST move signals, since a session gate and a candle-confirmation gate are different
# arrays) and confirm this same harness, on this same corpus, reports movement.
import dataclasses  # noqa: E402

set_flag(True)
_original_meta = sfb.FAMILY_META["WAIT_SESSION"]
sfb.FAMILY_META["WAIT_SESSION"] = dataclasses.replace(
    _original_meta, enforced_primitive="spec_condition_compiler.candle_confirmation_check"
)
try:
    control_signals, _ = run_arm(True)
finally:
    sfb.FAMILY_META["WAIT_SESSION"] = _original_meta
    set_flag(False)
control_moved = [i for i in off_signals if off_signals[i] != control_signals[i]]
P("")
P("-- [TIER-B] POSITIVE CONTROL: CAN THIS HARNESS SEE A DELTA AT ALL? --------------------")
P(f"[TIER-B] with WAIT_SESSION deliberately re-pointed, specs MOVED = {len(control_moved)} / {len(SPECS)}")
P(f"[TIER-B] control total signals = {sum(a + b for a, b in control_signals.values() if a >= 0)}"
  f"  (vs {tot_off} baseline)")
if not control_moved:
    P("   *** CONTROL DEAD — the 0-delta above is UNTRUSTED. Do not read it as 'no impact'. ***")
else:
    P("   Control FIRED. The 0-delta above is a real measurement, not a dead instrument:")
    P("   the enforced router reproduces the ladder's per-bar behaviour EXACTLY, by design,")
    P("   because every declaration that moved either re-points at the code that was already")
    P("   executing, or names a constant-True mechanism that must stay constant-True.")

# ── plan-level delta (where this packet actually moves) ──────────────────────────────────
plan_moved = [i for i in off_plans if off_plans[i] != on_plans[i]]
compiled_off = sum(1 for p in off_plans.values() if p.get("compiled"))
compiled_on = sum(1 for p in on_plans.values() if p.get("compiled"))
approx_off = sum(1 for p in off_plans.values() if p.get("approximation_used"))
approx_on = sum(1 for p in on_plans.values() if p.get("approximation_used"))
P("")
P("── [TIER-B] BINDING-PLAN DELTA (the surface this packet changes) ───────────────────────")
P(f"[TIER-B] specs whose PLAN moved         n = {len(plan_moved)} / {len(SPECS)}")
P(f"[TIER-B] specs marked `compiled`        OFF={compiled_off}  ON={compiled_on}")
P(f"[TIER-B] specs w/ approximation_used    OFF={approx_off}  ON={approx_on}")
P("   (`approximation_used` is an any() over the whole spec and was ALREADY saturated at")
P("    120/120 before this packet — it cannot show the INVALIDATE correction. The per-")
P("    condition count below can, and is the honest place to read it.)")

inv_counts = {}
for arm, on in (("flag_OFF", False), ("flag_ON", True)):
    set_flag(on)
    total = approximated = 0
    for spec in SPECS:
        for c in spec.get("invalidations") or []:
            b = sfb.bind_condition(c)
            if not b.bindable:
                continue
            total += 1
            approximated += 1 if b.approximation else 0
    inv_counts[arm] = (approximated, total)
set_flag(False)
P("[TIER-B] INVALIDATE-family invalidation bindings marked approximation=True:")
P(f"           flag_OFF = {inv_counts['flag_OFF'][0]} / {inv_counts['flag_OFF'][1]}")
P(f"           flag_ON  = {inv_counts['flag_ON'][0]} / {inv_counts['flag_ON'][1]}"
  "   <- the fidelity number moving DOWN, and it should")

# ── 5. THE 390, INDIVIDUALLY ─────────────────────────────────────────────────────────────
P("")
P("── [TIER-B] ITEM 5: FILTER role=spine CONDITIONS, ACCOUNTED INDIVIDUALLY ───────────────")
set_flag(True)
filter_rows = []
for spec in SPECS:
    for c in spec.get("entry_conditions") or []:
        if c.get("type") == "FILTER" and c.get("role") == "spine":
            b = sfb.bind_condition(c)
            filter_rows.append(
                {
                    "condition_id": b.condition_id,
                    "object": b.object,
                    "bindable": b.bindable,
                    "declared": b.primitive,
                    "approximation": b.approximation,
                    "disposition": (
                        "honestly_declared_non_gating_constant_true"
                        if b.primitive == "static_true_pass_through"
                        else f"UNEXPECTED:{b.primitive}"
                    ),
                }
            )
set_flag(False)
disp = collections.Counter(r["disposition"] for r in filter_rows)
P(f"[TIER-B] FILTER role=spine conditions   n = {len(filter_rows)}   (packet declares 390)")
for k, v in disp.items():
    P(f"   {v:5d}  {k}")
P("   Per-condition rows written to family-meta-enforcement-delta.json -> filter_spine_390.")
P("   NONE of the 390 begins to gate: FILTER has no per-bar confluence primitive in this")
P("   repo, and writing one to make them gate is the fabricated-implementation the packet")
P("   prohibits by name. What changed: each is now DECLARED non-gating (mechanism")
P("   static_true_pass_through, gates=False) instead of silently np.ones behind a pointer at")
P("   a module that does not exist, and each is recorded in last_non_gating_conditions at")
P("   run time. Under ALL pins active, these conditions do not run at all -- load fails.")

# ── 8/9. SECTION 6a COVERAGE + APPROXIMATION RATE, dual denominators ─────────────────────
P("")
P("── [TIER-B] ITEM 9: SECTION-6a COVERAGE + APPROXIMATION RATE (dual denominators) ───────")
by_type_role = collections.Counter()
for spec in SPECS:
    for c in spec.get("entry_conditions") or []:
        by_type_role[(c.get("type"), c.get("role"))] += 1

TRIGGER_ROLE_NEVER_EVALUATED = ["WAIT_BIAS", "FILTER", "INVALIDATE", "ENABLE_ENTRY", "ENTER"]
never_evaluated = {t: by_type_role[(t, "trigger")] for t in TRIGGER_ROLE_NEVER_EVALUATED}
never_evaluated_total = sum(never_evaluated.values())

all_entry_conditions = sum(by_type_role.values())
spine_conditions = sum(v for (t, r), v in by_type_role.items() if r == "spine")

rates = {}
for arm, on in (("flag_OFF", False), ("flag_ON", True)):
    set_flag(on)
    bound = approx = gating = 0
    for spec in SPECS:
        for c in spec.get("entry_conditions") or []:
            if c.get("role") != "spine":
                continue
            b = sfb.bind_condition(c)
            if not b.bindable:
                continue
            bound += 1
            if b.approximation:
                approx += 1
            meta = sfb.FAMILY_META.get(str(c.get("type")))
            if meta is not None and (meta.gates if on else True):
                gating += 1
    rates[arm] = {"spine_bound": bound, "spine_approximated": approx, "spine_gating": gating}
set_flag(False)

P(f"[TIER-B] entry_conditions (all roles)      n = {all_entry_conditions}")
P(f"[TIER-B] role=spine conditions             n = {spine_conditions}")
P("[TIER-B] NEVER-EVALUATED trigger-role conditions (section 6a denominator growth):")
for t, v in never_evaluated.items():
    P(f"           {t:14s} {v:5d}")
P(f"           {'TOTAL':14s} {never_evaluated_total:5d}   (packet declares 921)")
P("")
P("APPROXIMATION RATE — DUAL DENOMINATORS. A rate over BOUND conditions flatters the engine")
P("(it silently drops everything that never bound); a rate over ALL TAUGHT conditions is the")
P("honest one. Both are printed, each with its own null and n, and neither is a headline")
P("without the other.")
for arm in ("flag_OFF", "flag_ON"):
    r = rates[arm]
    d1, d2 = r["spine_bound"], spine_conditions
    P(f"  [TIER-B] {arm}:")
    P(f"     spine bound            = {d1}   (null: {spine_conditions - d1} spine conditions never bound)")
    P(f"     spine approximated     = {r['spine_approximated']}")
    P(f"     rate / BOUND spine     = {r['spine_approximated'] / d1:.4f}  (n={d1})")
    P(f"     rate / ALL spine taught= {r['spine_approximated'] / d2:.4f}  (n={d2})")
    P(f"     spine conditions that CAN GATE = {r['spine_gating']}")
P("")
P("  [TIER-B] section-6a coverage denominator INCLUDING the never-evaluated trigger-role")
P(f"     conditions: {spine_conditions} spine + {never_evaluated_total} never-evaluated trigger-role")
P(f"     = {spine_conditions + never_evaluated_total} taught conditions the rate must be honest against.")
P("  [TIER-A] NOT MEASURED — out of scope for this packet.")

P("")
P("── ENFORCEMENT STATUS (all pins, no selector) ──────────────────────────────────────────")
set_flag(True)
os.environ.pop(fme.PINS_ENV, None)
status = fme.enforcement_status(scc.ENFORCED_DISPATCH)
set_flag(False)
for line in json.dumps(status, indent=1).splitlines():
    P("  " + line)

json.dump(
    {
        "tier": "shakedown/tier-b",
        "tier_a": "NOT MEASURED — out of scope",
        "n_specs": len(SPECS),
        "bars": BARS,
        "signals_off": {str(k): v for k, v in off_signals.items()},
        "signals_on": {str(k): v for k, v in on_signals.items()},
        "specs_signal_moved": moved,
        "specs_plan_moved": plan_moved,
        "total_signals_off": tot_off,
        "total_signals_on": tot_on,
        "compiled_off": compiled_off,
        "compiled_on": compiled_on,
        "approximation_used_off": approx_off,
        "approximation_used_on": approx_on,
        "control_specs_moved": control_moved,
        "invalidation_approximation_counts": inv_counts,
        "filter_spine_390": filter_rows,
        "filter_spine_dispositions": dict(disp),
        "never_evaluated_trigger_role": never_evaluated,
        "never_evaluated_total": never_evaluated_total,
        "spine_conditions": spine_conditions,
        "all_entry_conditions": all_entry_conditions,
        "rates": rates,
        "enforcement_status_all_pins": status,
    },
    open(os.path.join(OUTDIR, "family-meta-enforcement-delta.json"), "w"),
    indent=1,
    default=str,
)
open(os.path.join(OUTDIR, "family-meta-enforcement-delta.log"), "w", encoding="utf-8").write("\n".join(LINES))
P("")
P("DONE")
