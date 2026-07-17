# Engine-v2 Shadow Contract — DRAFT (staged, not built)

**Status:** design-stage only. No code written against this doc yet. Coordination-gated —
touches `backtester.py` (campaign-owned) and the live bias-state path (this session's
territory) at the same seam, so it needs explicit cross-agent sign-off before dispatch,
same tier as the campaign's own instrument-surface changes.

**Why this exists:** the dormant institutional-regime classifier
([[reference_institutional_regime_classifier_dormant_2026_07_17]] in memory) needs to go
to SHADOW per Fable's ruling
([[feedback_regime_engine_v2_shadow_and_liveness_policy_2026_07_17]]). This doc pins the
one constraint that makes "shadow" actually mean shadow, verified against real code
2026-07-17.

## The trap this draft prevents

Traced live 2026-07-17: `compute_bias()` → `classify_institutional_regime()` →
`state.institutional_regime` → `playbook_router.route_playbook()` reads
`inst_regime = getattr(bias, "institutional_regime", None)` (`playbook_router.py:329`) →
dispatches `PLAYBOOK_ROUTING["REDUCED_SIZING"]` etc directly off that value
(`playbook_router.py:341-345`) → real contract-cap halving via the REDUCED_SIZING
mechanism in `framework-overlay.ts`. `bias-state-service.ts` also persists
`regime_label` (the field live consumers read) alongside `institutional_regime` in the
same `emit()` call (`bias-state-service.ts:550-561`).

**Consequence:** simply passing real `bars` + `event_active` into `compute_bias()` at
the 3 dormant call sites makes the classifier reachable — and the FIRST time it fires
non-classic-4, it changes `route_playbook`'s output, which changes live sizing and the
persisted `regime_label`. That is not shadow. That is the flip, arriving by accident
instead of by decision.

## The contract (what "shadow" must mean)

**Three-position switch, not two:** `REGIME_ENGINE_MODE ∈ {off, shadow, on}` — one env
var, one coordinated boundary, read identically by every consumer (no per-consumer
local toggle).

**Dual computation, hard output separation:**
- The CLASSIC-4 path (current behavior: `bars=None`, `event_active=False`) keeps
  computing `state.institutional_regime`, keeps driving `route_playbook()`, keeps
  writing `bias_state.regime_label` — byte-identical to today, in ALL THREE modes.
- In `shadow` mode ONLY, a SECOND, parallel call computes the institutional
  classification with real bars/event data, and its result is written to a NEW,
  separate field (e.g. `bias_state.shadow_institutional_regime` +
  `bias_state.shadow_routed_playbook` — names TBD at build time) that NOTHING reads for
  routing, sizing, or `regime_label`. Observability-only.
- `on` mode is the only mode where the institutional result is allowed to touch
  `route_playbook()` / `regime_label` / sizing. Getting to `on` is the reserved
  operator-class flip, per Fable's ruling — not decidable until the divergence packet
  (below) exists.

**Grader obligation:** whoever builds this must prove, not assert, that in `shadow`
mode live routing and sizing are byte-identical to `off` mode on the same input bars
(diff the two runs' `routed_playbook` + contract counts). If the grader can't show that
diff is empty, the wiring shipped `on` wearing a `shadow` label.

**Divergence packet (the deliverable the `on` decision rests on):** per-bar record of
{classic_regime, institutional_regime, would-differ sizing decision (esp.
REDUCED_SIZING 0.5×), would-differ playbook}. This is what turns "we think v2 is
better" into a measurement. No flip to `on` without this packet existing and being
reviewed.

**Single-source versioned enum:** ONE canonical 9-token regime vocabulary
(`bias_engine.REGIME_VALUES`), imported — not locally re-declared — by the producer,
the RL encoder, the backfill labeler, and any future consumer. Every consumer's
projection of the 9-token set down to its own vocabulary must be an EXPLICIT mapping
table; any unmapped token is a HARD ERROR (abort, not degrade-to-0.0). This closes the
exact class of bug A1 found (silent 0.0 for LATE_CYCLE_OVERHEATING + NO_TRADE).

**v1-stays-v1:** anything currently FAILing under the classic-4 engine stays a FAIL —
`shadow`/`on` runs are NEW registrations, never a re-grade of old results. A v1 PASS
that wants to survive re-certifies fresh under `on`.

**Open product fork (operator's, not this draft's, to resolve):** is `NO_TRADE` a
market regime or a control state? Masking those bars from training vs. encoding
`NO_TRADE` as a feature produces different RL learners. Don't resolve this silently
inside the labeler — surface it at build time.

## Second coordination-packet entry: engine "Liquidity Sweep" eligibility gate

**Added 2026-07-17 from the liveness-audit finding.** `src/engine/context/eligibility_gate.py:197`
skips a trade whenever `not location.sweep_present` — but `sweep_present` /
`at_order_block` / `at_fvg` / `after_sweep` (`backtester.py:371-373,442-444`) are read but
**never written** anywhere in the engine. Real sweep/FVG/order-block detectors exist
(`indicators/liquidity.py::detect_sweep`, `indicators/fvg_native.py`) but are only used
locally inside individual ICT strategies to fire their own entries — none writes back to
the shared dataframe columns this separate overlay gate reads. Default-on
(`use_eligibility_gate=True`) for the ~120-strategy library; the gate is therefore
**permanently unsatisfiable** — every strategy fails this gate today, unconditionally.

**This is the same species as the institutional-regime dormancy, and it belongs in the
same coordination packet, not a separate fix track:** wiring the detectors to actually
write those columns makes ~120 strategies start passing a gate they currently all fail —
a live re-baseline of every backtest, same as turning the regime engine on. `src/engine/context/`
is campaign/instrument territory, same as `backtester.py`.

**The one piece of good news:** it fails *closed* today (blocks trades, never falsely
passes them) — so there is no live-capital danger sitting in production right now, which
means the current results-vacuum is the cheapest possible time to wire it, exactly the
same timing argument as the regime-engine shadow flip above. Don't wire this in isolation
outside the coordination packet — stage it as a second divergence-packet-style measurement
(what would these ~120 strategies' eligibility rate look like with real sweep-detection
wired vs. the current permanent-skip) before anyone decides to actually turn it on.

## Third coordination-packet entry: parameter-drift hard gate is permanently no-op

**Added 2026-07-17 from the liveness-audit finding, verified fresh from disk (not
carried from a prior summary).** `evaluateParameterDriftGate()`
(`src/server/lib/parameter-drift-gate.ts`) is a real, correctly-implemented hard gate:
`overfit_drift` classification at confidence ≥0.70 → `BLOCK`. It has never once been
able to fire that block in production, because its only data source —
`walkForwardWindows.paramStability` — is written by `walk_forward.py` **only inside an
`if optimize:` branch** (`walk_forward.py:1780`). The single production call site
(`backtester.py:8329`, `run_walk_forward(request, data=_preloaded_data,
embargo_bars=request.embargo_bars)`) never passes `optimize=True` — confirmed by direct
grep, the only caller, no `optimize=` kwarg. `run_walk_forward_class` additionally
*raises* `NotImplementedError` if ever called with `optimize=True` (F-12 test), so this
isn't an oversight with a nearby safe fallback — the path is structurally unreachable.

**Consequence:** every single promotion evaluation reads `paramStability = null` →
`evaluateParameterDriftGate(null, ...)` → `status: "legacy_null"` →
`lifecycle-service.ts` treats `legacy_null` as non-blocking ("legacy", not "blocked" —
verified at `lifecycle-service.ts:1896-1898`, matches the WFE/PBO gates' identical
documented convention, so this part is *working as designed*, not a bug). The bug is
narrower and worse than "one strategy slipped through": **the overfit-drift hard gate
has zero discriminating power for any strategy, ever** — a strategy with wildly unstable
per-window parameters gets exactly the same "legacy" pass as a genuinely stable one,
because the classifier that would tell them apart never runs.

**Why this is coordination-gated, not a solo fix:** wiring `optimize=True` into the
production call site is the same re-baseline hazard as the other two entries in this
doc — the FIRST time `param_stability` becomes non-null for real strategies, it can
retroactively flip previously-"legacy"-passed strategies to `overfit_drift`+block, or to
`stable`/`regime_driven`+pass, changing PROMOTION OUTCOMES that were silently
unmeasured before. This touches `walk_forward.py`/`backtester.py`, same
campaign/instrument territory as the other two entries — not to be fixed in isolation.

**Named owner + concrete unblock condition (§11c-legal deferral, not "recorded in
memory only"):** owner = whoever the live campaign assigns to `walk_forward.py` /
`backtester.py` (same as entries 1 and 2 above); unblocks when a divergence-style
measurement packet exists showing what `optimize=True`'s parameter-stability
classification would have produced across the existing backtest population *before*
anyone flips the production call site to pass it — mirrors the regime-engine shadow
packet exactly. Do not build this by simply adding `optimize=True` to the production
call and observing what happens; that IS the un-measured flip this doc exists to
prevent.

**Adjacent hazard — do NOT reach for this while fixing the above:**
`PROMOTION_GRANDFATHER_PRE_PASS_E` (`promotion-gate-orchestrator.ts`) is a real,
already-correct opt-in flag, but it governs **five** *different* gates, not the ones
this entry is about: `evaluateB14Gate` (B14 ci_high, line ~153-169), the WFE floor
(line ~308-323), plus CPCV/WRC/SPA — all fail-closed-by-default on null data, all
fail-OPEN together the moment this flag is set (confirmed by reading
`isGrandfatherEnabled()`'s call sites directly, not just its docstring). It has no code
path into `evaluateParameterDriftGate()` (a separate gate file entirely) and flipping it
fixes nothing here — but it is the kind of nearby "grandfather" flag an operator
troubleshooting "why does parameter-drift never block" might reach for by
pattern-matching the name. Doing so would fail-open B14 + WFE + CPCV + WRC + SPA
*simultaneously* for the entire strategy library — a large, unrelated blast radius, for
zero benefit to the actual bug. Named explicitly so nobody touches it while working this
entry.

## Sequencing

1. This draft gets sign-off (advisor + whichever agent owns `backtester.py` under the
   live campaign).
2. Build `shadow` mode only — `off` and `on` paths are trivial once the dual-computation
   split exists; `shadow` is the only mode requiring new code.
3. Run shadow across enough live bars to produce a non-trivial divergence packet
   (non-degenerate distribution, plausible transition rates — same bar the RL backfill
   labeler's cert needs to clear per the A1 vocab-pin).
4. Divergence packet → operator decision on `on`. Not before.
