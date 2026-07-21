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
time precisely so this is possible).

★ WHERE THE OFF ARM IS THE ENGINE, AND WHERE IT IS NOT (corrected after the BAND-6 grade).
This header used to say flatly "The OFF arm is therefore the production engine, not a
reconstruction of it." That is true of the SIGNAL and BINDING-PLAN blocks — they call
SpecConditionStrategy.compute() and read what it returns. It was FALSE of the section-6a
gating count, which never called compute() at all: it re-derived "did this gate?" as
`meta.gates if on else True`, i.e. it ASSUMED every bound spine condition gated with the flag
off. That is a reconstruction, it was wrong, and it inflated the OFF baseline by EXIT_HINT's
78 bound-but-executed=False conditions (2346 -> 1878 read as a 468 change; the attributable
figure is 390). The assumption is now replaced by the same `executed` test compute() applies.
So, precisely: the SIGNAL and PLAN arms are the production engine; the section-6a gating
counter is a re-derivation that now mirrors the loop's own skip conditions, and is labelled as
such wherever it prints.

★ PIN SCOPE (D3), AS OF THE 2026-07-21 REGENERATION: ALL THREE PINS.

Every flag-ON figure below is now produced under TF_FAMILY_META_ENFORCED_PINS="a,b,b2" —
the complete pin set. Pin (b2) IS evaluated and PASSES.

★ WHAT THIS HEADER USED TO SAY, AND WHY THAT MATTERED. It read: `PINS="a,b"`. Pin (b2) is NOT
evaluated — it fails today on the orphan-zone gap this packet is scoped out of fixing.` That
was true when written and became FALSE at the orphan-zone closure
(docs/designs/packet-orphan-zone-closure-2026-07-21.md), while the committed JSON went on
stamping "pin b2 NOT evaluated" onto EVERY figure in it. An artifact left stale in a tree that
falsifies it is a caption defect at artifact scale: the numbers keep asserting a scope the
code has already left. Both the qualifier and the numbers are regenerated here against the
current tree.

The qualifier still travels INSIDE the JSON artifact, adjacent to each ON number, because a
caveat one hop from its claim is a caption — and it is still DERIVED from the same constant
the run uses, so it cannot drift from the run that produced the figures.
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


# ── D3: THE PIN CONFIGURATION, DEFINED ONCE AND CARRIED INTO THE ARTIFACT ────────────────
# Graded BAND 6: the script set PINS="a,b" and the JSON artifact had NO pins field at all, so
# every quotable flag-ON number in it (3003, 1878, 567/567, 390, 120/120) travelled unlabelled
# and the caveat lived only in a commit message. A caveat one hop from its claim is a caption.
# The label is now derived from the SAME constant the run uses — it cannot drift from it — and
# is emitted ADJACENT to each ON figure inside the JSON, not once in a header.
#
# ★ 2026-07-21: WAS "a,b". Pin (b2) failed on the orphan-zone gap; that gap is closed and b2
# now passes, so the ON arm runs the COMPLETE pin set and the artifact stops carrying a scope
# caveat that is no longer true of the code.
ACTIVE_PINS = ",".join(fme.ALL_PINS)
SKIPPED_PINS = [p for p in fme.ALL_PINS if p not in {s.strip() for s in ACTIVE_PINS.split(",")}]
assert not SKIPPED_PINS, f"expected the full pin set, skipped={SKIPPED_PINS}"
PIN_QUALIFIER = (
    f"ALL pins ({'+'.join(ACTIVE_PINS.split(','))}) were active and held. No pin was skipped."
    if not SKIPPED_PINS
    else (
        f"pins {'+'.join(ACTIVE_PINS.split(','))} held; "
        f"pin{'s' if len(SKIPPED_PINS) != 1 else ''} {'+'.join(SKIPPED_PINS)} NOT evaluated. "
        f"This figure is NOT 'enforcement passed'."
    )
)


def set_flag(on: bool) -> None:
    if on:
        os.environ[fme.FLAG_ENV] = "true"
        # ALL pins. The b2 skip that used to live here expired with the orphan-zone closure.
        os.environ[fme.PINS_ENV] = ACTIVE_PINS
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
P(f"PIN SCOPE: every flag-ON figure below is run with {fme.PINS_ENV}={ACTIVE_PINS!r}.")
P(f"           {PIN_QUALIFIER}")
P("           (the label is written INTO family-meta-enforcement-delta.json next to each ON")
P("            number — a caveat one hop from its claim is a caption.)")
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
P("   run time. This block IS the all-pins regime now: b2 passes, the load succeeds, and")
P("   these 390 are enumerated under the complete gate rather than under a partial one.")

# ── 8/9. SECTION 6a COVERAGE + APPROXIMATION RATE, dual denominators ─────────────────────
P("")
P("── [TIER-B] ITEM 9: SECTION-6a COVERAGE + APPROXIMATION RATE (dual denominators) ───────")
by_type_role = collections.Counter()
by_role = collections.Counter()
for spec in SPECS:
    for c in spec.get("entry_conditions") or []:
        by_type_role[(c.get("type"), c.get("role"))] += 1
        by_role[c.get("role")] += 1

# ── D5 CORRECTION (graded BAND 6). This block used to read:
#
#     TRIGGER_ROLE_NEVER_EVALUATED = ["WAIT_BIAS", "FILTER", "INVALIDATE", "ENABLE_ENTRY", "ENTER"]
#     never_evaluated = {t: by_type_role[(t, "trigger")] for t in TRIGGER_ROLE_NEVER_EVALUATED}
#
# — a CURATED FAMILY LIST used as if it were the population. The compute loop selects
# `role == "spine"` and nothing else, so EVERY trigger-role condition is skipped, not just
# those five families'. The list silently dropped six families (WAIT_SESSION 18,
# WAIT_CONFIRMATION 21, WAIT_RETEST 15, WAIT_STRUCTURE 6, VERIFY_STRUCTURE 3, EXIT_HINT 3 = 66)
# and published 921 where the true count is 987.
#
# The fix is not a corrected list — a list is what failed. The count is now DERIVED FROM THE
# UNIVERSE: every condition whose role is not the one the loop selects. Two independent paths
# compute it and must agree; a disagreement is the alarm, not something to reconcile by hand.
EVALUATED_ROLE = "spine"  # the ONLY role compute()'s spine loop iterates

# path 1: sum the (type, role) cross-tab over every non-spine trigger cell
never_evaluated = {
    t: v for (t, r), v in sorted(by_type_role.items()) if r == "trigger"
}
never_evaluated_total = sum(never_evaluated.values())
# path 2: an independent single-key tally of the role column, never touching the cross-tab
never_evaluated_total_check = by_role["trigger"]
if never_evaluated_total != never_evaluated_total_check:
    raise SystemExit(
        f"D5 TWO-PATH DERIVATION DISAGREES: cross-tab={never_evaluated_total} "
        f"role-tally={never_evaluated_total_check}. Do not publish either number."
    )

all_entry_conditions = sum(by_type_role.values())
spine_conditions = sum(v for (t, r), v in by_type_role.items() if r == EVALUATED_ROLE)

# ── The population the corrected 987 STILL does not cover, named rather than left implicit.
# `role == "confluence"` conditions are ALSO never evaluated by the spine loop — it selects
# `role == "spine"`, so confluence conditions never enter per_condition_bool either. They are
# reported separately because the packet's section-6a denominator is defined over trigger-role
# conditions; this is a NEW observation from the D5 re-derivation, not a re-scoping of it, and
# it is recorded here so the next reader does not have to rediscover it.
other_never_evaluated = {
    r: v for r, v in sorted(by_role.items()) if r not in (EVALUATED_ROLE, "trigger")
}
other_never_evaluated_total = sum(other_never_evaluated.values())

rates = {}
for arm, on in (("flag_OFF", False), ("flag_ON", True)):
    set_flag(on)
    bound = approx = gating = not_executed = 0
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
            if meta is None:
                continue
            # ── D4 CORRECTION (graded BAND 6). This read `(meta.gates if on else True)`: the
            # OFF arm ASSUMED every bound spine condition gated. It does not. compute()'s
            # spine loop `continue`s on `not b.executed` BEFORE anything can gate, and
            # EXIT_HINT's 78 bound spine conditions carry executed=False in BOTH arms — they
            # never enter the gating map under enforcement or without it. Counting them as
            # gating in the OFF arm only inflated the OFF baseline by 78 and made the headline
            # read "2346 -> 1878" (a 468 swing) when the change attributable to this packet is
            # 390 — exactly FILTER's 390 spine conditions, and nothing else.
            if not b.executed:
                not_executed += 1
                continue
            if meta.gates if on else True:
                gating += 1
    rates[arm] = {
        "spine_bound": bound,
        "spine_approximated": approx,
        "spine_gating": gating,
        "spine_bound_but_never_executed": not_executed,
    }
set_flag(False)

P(f"[TIER-B] entry_conditions (all roles)      n = {all_entry_conditions}")
P(f"[TIER-B] role=spine conditions             n = {spine_conditions}")
P("[TIER-B] NEVER-EVALUATED trigger-role conditions (section 6a denominator growth):")
for t, v in never_evaluated.items():
    P(f"           {t:14s} {v:5d}")
P(f"           {'TOTAL':14s} {never_evaluated_total:5d}   (packet declares 987; two-path "
  f"derivation agrees: cross-tab={never_evaluated_total} role-tally={never_evaluated_total_check})")
P("           ^ was published as 921 before the BAND-6 grade: a curated 5-family list stood in")
P("             for the population. compute() selects role==spine, so ALL 987 are skipped.")
P("[TIER-B] ALSO never evaluated by the spine loop, and NOT in the 987 (reported, not folded in):")
for r, v in other_never_evaluated.items():
    P(f"           role={str(r):14s} {v:5d}")
P(f"           {'TOTAL':19s} {other_never_evaluated_total:5d}   <- section 6a's denominator is")
P("             defined over TRIGGER-role conditions, so these sit outside it; they are named")
P("             here because 'never evaluated' is true of them too and silence would imply not.")
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
    P(f"     spine conditions that CAN GATE = {r['spine_gating']}"
      f"   (excludes {r['spine_bound_but_never_executed']} bound-but-executed=False, both arms)")
P(f"  [TIER-B] attributable gating change OFF->ON = "
  f"{rates['flag_OFF']['spine_gating'] - rates['flag_ON']['spine_gating']}"
  "   <- read THIS, not the old 2346->1878")
P("     The pre-correction OFF baseline counted EXIT_HINT's 78 executed=False conditions as")
P("     gating, which they never were in either arm; the 468 swing that produced was 78 of")
P("     bookkeeping on top of the 390 real ones (FILTER's spine conditions).")
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
        # ── D3: the pin configuration, IN the artifact rather than in a commit message ──
        "enforcement_pins": {
            "env_var": fme.PINS_ENV,
            "value_used_for_every_flag_on_figure": ACTIVE_PINS,
            "pins_active": sorted(ACTIVE_PINS.split(",")),
            "pins_NOT_evaluated": SKIPPED_PINS,
            "why_skipped": (
                "NOTHING IS SKIPPED. This field previously read: 'pin (b2) fails today on the "
                "real orphan-zone gap (resolve_session_keyword can emit lunch_blackout/"
                "overnight; is_in_killzone cannot check them) ... with all pins active the "
                "engine correctly REFUSES TO LOAD.' That gap was closed by "
                "docs/designs/packet-orphan-zone-closure-2026-07-21.md; b2 now PASSES and the "
                "engine LOADS under all three pins. The prior artifact kept stamping the "
                "obsolete caveat onto every figure it contained, which is why this one is "
                "regenerated against the current tree rather than patched."
            ),
            "honest_reading": PIN_QUALIFIER,
            "applies_to": [
                "signals_on", "total_signals_on", "compiled_on", "approximation_used_on",
                "invalidation_approximation_counts.flag_ON", "filter_spine_390",
                "filter_spine_dispositions", "rates.flag_ON",
            ],
        },
        "n_specs": len(SPECS),
        "bars": BARS,
        "signals_off": {str(k): v for k, v in off_signals.items()},
        "signals_on__pin_scope": PIN_QUALIFIER,
        "signals_on": {str(k): v for k, v in on_signals.items()},
        "specs_signal_moved": moved,
        "specs_plan_moved": plan_moved,
        "total_signals_off": tot_off,
        "total_signals_on__pin_scope": PIN_QUALIFIER,
        "total_signals_on": tot_on,
        "compiled_off": compiled_off,
        "compiled_on__pin_scope": PIN_QUALIFIER,
        "compiled_on": compiled_on,
        "approximation_used_off": approx_off,
        "approximation_used_on__pin_scope": PIN_QUALIFIER,
        "approximation_used_on": approx_on,
        "control_specs_moved": control_moved,
        "invalidation_approximation_counts__pin_scope": f"flag_ON arm only: {PIN_QUALIFIER}",
        "invalidation_approximation_counts": inv_counts,
        "filter_spine_390__pin_scope": (
            f"Enumerated under enforcement. {PIN_QUALIFIER} The previous artifact added "
            f"'under ALL pins active these conditions do not run at all — the load fails on "
            f"pin (b2)'; that is no longer true, and this enumeration IS the all-pins one."
        ),
        "filter_spine_390": filter_rows,
        "filter_spine_dispositions": dict(disp),
        # ── D5: derived from the UNIVERSE of conditions, not a curated family list ──
        "never_evaluated_trigger_role": never_evaluated,
        "never_evaluated_total": never_evaluated_total,
        "never_evaluated_total_derivation": (
            f"role=='trigger' over all {all_entry_conditions} entry_conditions in the {len(SPECS)}-spec "
            f"corpus. Two independent paths agree (cross-tab={never_evaluated_total}, "
            f"role-tally={never_evaluated_total_check}). Supersedes the previously published 921, "
            f"which summed a curated 5-family list and omitted 66 conditions across 6 families "
            f"(WAIT_SESSION 18, WAIT_CONFIRMATION 21, WAIT_RETEST 15, WAIT_STRUCTURE 6, "
            f"VERIFY_STRUCTURE 3, EXIT_HINT 3). compute() selects role=='spine', so ALL "
            f"{never_evaluated_total} trigger-role conditions are skipped, not just five families'."
        ),
        "also_never_evaluated_outside_the_987": other_never_evaluated,
        "also_never_evaluated_outside_the_987_total": other_never_evaluated_total,
        "also_never_evaluated_note": (
            "role=='confluence' conditions are ALSO never evaluated by compute()'s spine loop. "
            "They are NOT part of the 987 because section 6a's denominator is defined over "
            "trigger-role conditions; recorded here so the omission is stated, not implied."
        ),
        "spine_conditions": spine_conditions,
        "all_entry_conditions": all_entry_conditions,
        "rates__pin_scope": f"the flag_ON arm of `rates` is scoped: {PIN_QUALIFIER}",
        "rates__gating_derivation": (
            "D4: `spine_gating` is a RE-DERIVATION, not a compute() observation. It now applies "
            "the same `executed` skip the spine loop applies, so EXIT_HINT's bound-but-"
            "executed=False conditions are excluded from BOTH arms. The previous OFF arm "
            "assumed every bound spine condition gated, inflating it by 78 and making the "
            "change read 2346->1878; the attributable figure is "
            f"{rates['flag_OFF']['spine_gating'] - rates['flag_ON']['spine_gating']}."
        ),
        "rates": rates,
        "enforcement_status_all_pins__note": (
            "Measured with the selector UNSET (all three pins active). It used to be the ONLY "
            "all-pins figure in this artifact and was EXPECTED TO SHOW A pin (b2) VIOLATION; "
            "since the orphan-zone closure it is expected to be CLEAN, and every other flag-ON "
            "figure here is now an all-pins figure too, so this block is a corroboration of "
            "the run's pin scope rather than an exception to it."
        ),
        "enforcement_status_all_pins": status,
    },
    # ★ H1-W4 D3 -- BOTH AXES PINNED. newline="\n" was already here; encoding was NOT, so this
    # writer took the platform's locale codepage (cp1252 on this box, UTF-8 elsewhere). Today
    # that is INERT and measurably so: json.dump defaults to ensure_ascii=True, the committed
    # file is 110302 bytes with 0 non-ASCII and 0 CRLF, and ASCII is identical under both
    # codecs. It is pinned anyway because the inertness is contingent on a default nobody
    # declared -- a single ensure_ascii=False would turn a silent platform divergence on, in a
    # file that is a DECLARED INPUT of the capstone and therefore hash-guarded.
    open(os.path.join(OUTDIR, "family-meta-enforcement-delta.json"), "w",
         encoding="utf-8", newline="\n"),
    indent=1,
    default=str,
)
# ★ H1-W4 D3 -- THIS is the writer that was actually unpinned, and it was not inert. It had
# encoding but no newline, so Python's universal-newlines translation wrote CRLF: the .log on
# disk carries 116 CRLF of 116 line endings and 438 non-ASCII bytes. It is untracked output, so
# nothing hash-guarded moves when it becomes LF.
open(os.path.join(OUTDIR, "family-meta-enforcement-delta.log"), "w",
     encoding="utf-8", newline="\n").write("\n".join(LINES))
P("")
P("DONE")
