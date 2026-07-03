# Spec Execution Semantics — Band C Decision Record

**Roadmap:** Band C (execution semantics for compiled strategies), 2026-07-02
**Owner:** backtest-core
**Depends on:** Band B (spec-onboarding-bridge) — reads `config.compiled_spec.spec`, the
lossless condition graph Band B preserves on every onboarded row.

## 1. The problem

Band B's `spec-archetype-matcher.ts` maps a compiled spec's condition graph onto a
NAMED archetype via keyword match only. Across the real 28-sample generalization
corpus, that leaves the majority of specs `needs_archetype` — parked, honestly, but
not executable.

Band C's job: give the parked class real production-grade execution via the HYBRID
decision — map spec condition **families** (`WAIT_SESSION`, `INVALIDATE`, etc.) onto
EXISTING audited engine primitives wherever one exists; build minimal evaluators ONLY
where no primitive exists, and flag every such evaluator `approximation=true` so
downstream verdicts stay honest. Never fake a mapping. Never rebuild what the engine
already has.

## 2. Family -> primitive table

| Family | Occurrences (corpus) | Primitive | File | Approximation | Why |
|---|---|---|---|---|---|
| `WAIT_SESSION` | 232 | `session_windows.py` (killzone.ts Python mirror) | `src/engine/session_windows.py` | **No** — faithful constant port | The audited 5-zone killzone primitive is TS-only (`src/server/lib/killzone.ts`, live-paper only). Mirrored byte-for-byte (same boundary constants, same `[start,end)` semantics) following the established TS-canonical/Python-mirror convention (`firm_rules_version.py`/`.ts`, `adaptive_exits.py`). Binding still requires a recognized session keyword in the condition's `object` text — an unrecognized object is honestly unbindable, never guessed. |
| `WAIT_STRUCTURE` / `VERIFY_STRUCTURE` | 216 + 1 | `structure_engine.compute_structure_state` | `src/engine/context/structure_engine.py` | **Yes** | Direct reuse of the audited BOS/CHoCH/MSS/PD-zone structural engine, but called with `htf_bars = exec_bars` (no separate HTF frame is available to a bar-only `BaseStrategy.compute(df)` call) and answering only "is there recent generic structural activity," not the SPECIFIC structural object text (e.g. "vwap and volume profile combination"). Recomputed every `STRUCTURE_RECOMPUTE_CADENCE_BARS` (10) bars over a trailing 250-bar window for performance — a cadence decision, not a correctness compromise (structure state is inherently slow-changing). |
| `WAIT_BIAS` / `CONFIRM_DIRECTION` | 124 + 6 | fast/slow EMA-slope directional proxy | `src/engine/spec_condition_compiler.py::_eval_wait_bias` | **Yes** | `bias_engine.classify_institutional_regime()` requires constructing `HTFContext`/`SessionContext` objects that a generic bar-only evaluator doesn't have inputs for. This is the largest scoped deviation in this band — see §5 (follow-up). The proxy answers "is there a directional lean," not the full 8-regime institutional classification. |
| `WAIT_RETEST` | 46 | ATR-proximity touch check (generalized from `bounce_off_level.py`) | `src/engine/spec_condition_compiler.py::retest_touch_check` | **Yes** | Same proximity math `BounceOffLevelStrategy` uses, generalized to an arbitrary level (EMA-20 stand-in, since specs rarely name a concrete price level) rather than one strategy's fixed MA. Answers "did price come near," not "did it reject" (that's `WAIT_CONFIRMATION`'s job). |
| `FILTER` | 182 | `entry_quality.confluence_factor_presence` (static pass-through) | `src/engine/spec_condition_compiler.py` | **Yes** | No standalone per-bar confluence primitive exists outside the TS/live-paper `confluence-score.ts` pipeline (11-factor weighted scoring — DB-backed, session-anchored, not callable from a bare backtest bar loop). FILTER conditions are a static presence-only pass-through: they never block; they exist so the spec's confluence tokens still get recorded (matching Band B's existing `entry_quality.confluence_factors` convention). |
| `WAIT_CONFIRMATION` | 132 | Generalized candle-rejection check (from `bounce_off_level.py`'s pattern helpers) | `src/engine/spec_condition_compiler.py::candle_confirmation_check` | **Yes** | A single generic wick-rejection pattern stands in for whatever specific candle behavior the natural-language object described (long wick rejection, engulfing, pin bar, etc. all collapse to one check). |
| `INVALIDATE` | 125 | `structural_stops.compute_structural_stop` | `src/engine/context/structural_stops.py` | **No** | Direct reuse of the audited sweep-aware structural-stop primitive. **Never drives entry gating or exit timing** — recorded in the trace only (see §4, hard boundary). |
| `ENABLE_ENTRY` / `ENTER` | 86 + 50 | spine-completion trigger (AND of bound spine conditions, rising-edge fire) | `src/engine/spec_condition_compiler.py::compute` | **No** (inherits from constituent spine bindings) | The trigger fires on the bar spine conditions transition from unsatisfied to satisfied — single-fire, not level-triggered (tested explicitly: no two consecutive `entry_long=True` bars). |
| `EXIT_HINT` | 17 | provenance only, **never executed** | n/a | n/a | Framework overlay is AUTHORITATIVE for exits (W23F.N standing rule). `exit_long`/`exit_short` are unconditionally `False` in `SpecConditionStrategy.compute()`. EXIT_HINT conditions are explicitly excluded from the gating loop AND the trace's "conditions" list (via `executed=False` in `FAMILY_META`) — not even included as a harmless always-True pass-through. |
| `RESET` / `EXCEPTION` | 2 + 1 | unsupported — explicit reason | n/a | n/a | Control-flow types with no engine analogue. Always `bindable=false`, reason `control_flow_{reset,exception}_unsupported`. If either appears in a spine or trigger role, it (correctly) contributes to a `needs_archetype` queue reason — never guessed. |

## 3. The binding-plan compiler (C1)

`src/engine/spec_family_bindings.py` (mirrored in `src/server/lib/spec-family-bindings.ts`)
is a **pure function** — zero I/O, zero DB, zero DataFrame access — that maps a spec's
condition list onto the table above and produces a `BindingPlan`:

- Per-condition binding: `{condition_id, type, role, object, bindable, primitive,
  approximation, executed, reason}`.
- Plan-level: `trigger_bound`, `spine_total`/`spine_bound`, `confluence_total`/
  `confluence_bound`, `approximation_used`, `compiled`, `queue_reasons[]`.

**Compile decision** (fail-closed, never guessed):

```
compiled = trigger_bound
       AND spine_total > 0                      (a bare trigger with zero spine
                                                   conditions has no structural
                                                   narrative to bind — stays queued)
       AND (spine_bound / spine_total) >= MIN_SPINE_BOUND_RATIO   (default 0.5)
```

`confluence`-role conditions NEVER gate the decision (role semantics: confluence feeds
`entry_quality.confluence_factors`, it doesn't block the trigger). Every condition that
fails to bind — whether or not it blocks the compile decision — gets a **per-condition**
reason in `queue_reasons`, never a blanket rejection message.

Because this compiler is pure, it is called **directly, synchronously, in-process** from
`spec-onboarding-service.ts` (no Python subprocess) to decide onboarding routing — see §6.

### Why the compile rate is high (27/28 on the real corpus, 1 queued)

Most families in the table above bind on TYPE ALONE (the extractor's own
classification already carries the family's semantic — e.g. a condition typed
`WAIT_BIAS` inherently concerns waiting for directional bias, regardless of its
specific natural-language wording), not on keyword content. Only `WAIT_SESSION`
requires a recognized zone keyword (because the primitive needs to know WHICH of the
5 canonical zones), and `RESET`/`EXCEPTION` are always unbindable (control flow, no
primitive exists) — but those two types occur only 3 times in the entire 28-sample
corpus. This means the honest ceiling on "still queued" is low **by construction of
the vocabulary distribution**, not because the compiler is rubber-stamping: every
condition-compiled spec still carries `approximation=true` (19/19 in the corpus),
which is the real signal that operators/downstream gates should read before trusting
these strategies at the same tier as an archetype match. **The `approximation` flag,
not the compile/queue split, is the honest quality signal this band introduces.**

The one spec that stayed queued (`aHLIE_TXjpo.spec.json`) failed because its spine
conditions are exclusively `WAIT_SESSION`-typed with vocabulary that doesn't match any
of the 5 canonical zone keyword sets (e.g. "10:00 candle", "trading window" — real
session references, but not ones the conservative keyword table recognizes) — a
genuinely honest reject, not a data artifact.

No options-market or non-futures spec exists in the 28-sample `.spec.json` corpus to
test the "should still reject" sanity case directly — cross-referencing the sibling
`.result.json`/`.transcript.txt`-only files in the same directory shows several videos
never reached the `.spec.json` compilation stage at all, meaning non-strategy content
(including, presumably, any options-market video) is already filtered further upstream
by the extraction compiler, before Band B or Band C ever see it.

## 4. Hard boundaries (never violated by this band)

- **Exits are never computed here.** `exit_long`/`exit_short` are unconditionally
  `False` in `SpecConditionStrategy.compute()`. Framework overlay + the backtester's
  own stop/TP machinery remain AUTHORITATIVE (W23F.N).
- **EXIT_HINT is provenance-only.** Explicitly excluded from the gating loop via
  `executed=False` — not merely a no-op pass-through, but literally never entered into
  the per-condition evaluation dict, and never appears in the trace's "conditions" list.
- **INVALIDATE never gates entries or drives exits.** `compute_structural_stop` is
  reused for **trace/provenance purposes only** (recorded per firing bar under
  `invalidations_recorded`) — the backtester's own framework-owned ATR stop
  (`config.strategy.stop_loss = {"type": "atr", "multiplier": 1.5}`, set by Band B)
  remains the actual risk-management primitive.
- **Fail-closed on ambiguity.** Unknown condition types, `RESET`/`EXCEPTION`, and
  unrecognized `WAIT_SESSION` vocabulary are all honestly `bindable=false` with an
  explicit reason — never guessed, never silently defaulted to a plausible-looking
  primitive.
- **Deterministic.** No wall-clock reads, no randomness, anywhere in the binding
  compiler or the executable evaluator. Same spec + same bars -> same output, every
  time (tested explicitly).
- **The frozen overlay parameters are untouched.** This band never reads or writes
  `framework-overlay.ts`'s frozen parameters.

## 5. Scoped deviations / follow-ups (honestly disclosed)

1. **`WAIT_BIAS`/`CONFIRM_DIRECTION` use an EMA-slope proxy, not
   `bias_engine.classify_institutional_regime()`.** The real primitive needs
   `HTFContext`/`SessionContext` construction (ATR percentile, session health, macro
   event flags) that a generic bar-only `SpecConditionStrategy.compute(df)` call
   doesn't have wired. Follow-up: thread real `HTFContext`/`SessionContext` builders
   into the spec-condition compute path (requires multi-TF data loading, out of this
   band's scope).
2. **`WAIT_STRUCTURE`/`VERIFY_STRUCTURE` uses `htf_bars = exec_bars`** (self-referential
   single timeframe) rather than a genuinely separate HTF frame. Follow-up: wire
   `load_n_timeframes()` (Wave 25 Pass 2) into the spec-condition compute path.
3. **`backtester.py` CLI wiring is additive but minimal.** `main()` gained one new
   `elif config.get("compiled_spec")` branch (byte-identical for every pre-existing
   `strategy_class`/DSL-expression path — see regression tests). It does NOT wire the
   full walk-forward stress-test / B15 battery paths specifically for
   `SpecConditionStrategy` beyond what the existing class-based branch already
   provides generically.
4. **FILTER's confluence-factor-presence check is a static pass-through**, not a live
   per-bar evaluation against real market microstructure — the real 11-factor weighted
   evaluator (`confluence-score.ts`) is TS/live-paper/DB-backed only.

## 6. Onboarding routing update (Band B extension)

`src/server/services/spec-onboarding-service.ts::onboardSpecArtifact` now, when
`matchArchetype()` returns unmatched, calls `compileBindingPlan()` (pure, synchronous,
no subprocess) before falling to `needs_archetype`:

- **`bindingPlan.compiled === true`** -> `lifecycleState = "CANDIDATE"`,
  `entry_indicator = "spec_conditions:<spec_hash_12>"`, tag `condition_compiled`
  (instead of `needs_archetype`), `config.compiled_spec.binding_plan_summary`
  attached for audit visibility. **Not** inserted into `needs_archetype_queue`.
- **`bindingPlan.compiled === false`** -> unchanged Band B behavior
  (`NEEDS_ARCHETYPE`, `needs_archetype:<concept>` marker), except the
  `needs_archetype_queue.verbatimDescription` now carries a per-condition reason
  suffix (e.g. `[unbindable: RESET:"reset the setup" (control_flow_reset_unsupported)]`)
  — never a blanket rejection.

`backtester.py::main()` detects `config["compiled_spec"]` (present on every
Band-B-onboarded row, regardless of archetype/condition-compiled/needs_archetype
routing) and, when no `--strategy-class` was supplied, dispatches to
`SpecConditionStrategy` via the same `run_class_backtest()` path every archetype
strategy already uses.

## 7. Ledger E parity (C2)

Because all new evaluators live Python-side and the TS side only computes
DISPATCH METADATA (the binding plan — no primitive execution happens in TS), the
parity surface is the binding plan itself, not a numeric exit-plan comparison. Mirrors
`check:ts-python-exit-parity`'s exact methodology:
`scripts/check-spec-binding-plan-parity.ts` spawns a Python subprocess per real sample
spec, computes the plan on both sides, and asserts exact agreement on every scalar
field and every per-condition `(bindable, primitive, approximation, session_zone)`
tuple. `npm run check:spec-binding-plan-parity` — **PASS across all 28 real sample
specs** (see final report for raw output).

## 8. Traces (C3)

`TF_SPEC_TRACE=true` (env var, read by `backtester.py`'s `compiled_spec` branch)
attaches `result["spec_trace"]` — one record per entry-signal bar, capturing which
conditions fired, their bound primitive + approximation flag, and (for invalidations)
the structural-stop primitive that WOULD apply, for provenance/inspection. Zero effect
on `entry_long`/`entry_short`/`exit_long`/`exit_short` when the flag is off — tested
explicitly as byte-identity at the `SpecConditionStrategy.compute()` level (the layer
that actually computes those arrays; the `backtester.py` hook only conditionally
attaches the additive `spec_trace` key after computation, never touches the arrays
themselves).

## 9. Downstream consumer impact

- **Critic / paper / prop-sim / portfolio / export:** unaffected for every
  pre-existing strategy — this band only activates when
  `config["compiled_spec"]` is present AND no `strategy_class` was supplied
  (a combination that did not exist before Band B/C).
- **`governance_labels.approximation`** is new, additive, on every backtest result
  produced via the `compiled_spec` dispatch path. Downstream consumers that read
  `governance_labels` (e.g. future promotion gates, per CLAUDE.md's established
  `governance_labels.*` convention for quantum/RL/replay rows) should treat
  `approximation=true` results as lower-confidence than archetype-dispatched results
  until an operator-reviewed graduation policy is defined — **this band does not add
  a new gate**; it only makes the signal available.
