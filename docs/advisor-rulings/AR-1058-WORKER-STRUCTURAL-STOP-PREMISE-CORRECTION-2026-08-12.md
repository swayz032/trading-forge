# AR-1058 — WORKER — **§4.A ANSWER CORRECTED: the executable structural-stop resolver ALREADY EXISTS and already emits `stop_reason="fvg"`.** AR-1057 §2 is REFUTED. The irreducible delta is a PRODUCER + ANCHOR COMMAND + TRANSPORT — not a new stop semantic.

```
RULING : AR-1056 (gpt-rulings a93d1d80) §4.A / §4.B "if an existing production contract already
         expresses the exact semantics, REUSE it"
PIN    : 5958385de1029a20274d3b56c669f551ca3c2589 (engineering, h1-wave4-sealed12-driver)
TREE   : C:\Users\tonio\Projects\wt-h1-wave4-20260712  [every measurement below is MEASURED HERE]
STATE  : READ-ONLY. NO CODE MUTATED. This AR corrects a premise, it does not build.
PRIOR  : AR-1057 (gpt-rulings 224e0d7e) -- this AR REFUTES its §2 headline and RESIZES its §5.
```

## 1. WHY THIS AR EXISTS

AR-1057 answered §4.A with **"the structural stop — NO, not representable"** and concluded its §5.2:

> *"One new `stop_loss.type` **plus its runtime resolver**, since `atr` is the only implemented
> value. **This is the irreducible new semantic.**"*

**That is wrong, and it would have caused us to author a second structural-stop engine beside a
working one.** AR-1057 itself labelled the claim `UNENUMERATED` beyond six consumer sites (its §6),
and the enumeration it did not run is the one that overturns it.

⚠️ **AR-1056 is NOT invalidated.** GPT asked §4.A as a *question* and pre-committed §4.B to reuse.
The defect is in the worker's answer, which is now published on this branch and would otherwise be
the premise of the next ruling.

## 2. THE REFUTATION — `compute_structural_stop` EXISTS, IS EXECUTABLE, AND SPEAKS "FVG"

`src/engine/context/structural_stops.py:194` `compute_structural_stop(...)`:

| the teacher's semantic | the existing contract | verdict |
|---|---|---|
| direction-relative FVG extreme | params `nearest_fvg_below` (long) / `nearest_fvg_above` (short), `:204-205` | **REPRESENTABLE** |
| stop below/above that structure | `:240-241` `candidates.append((nearest_fvg_below - buffer, "fvg"))`; `:260-261` mirror for short | **IMPLEMENTED** |
| identifiable stop provenance | `StopPlan.stop_reason` `:183` — literal enum includes `"fvg"` | **PRESENT** |
| fixed R target | `compute_targets(...)` called at `backtester.py:460` off `stop_plan.stop_price` | separate lane, exists |

⇒ **`"atr"` is NOT the only implemented stop value.** `CLAUDE.md:255` is titled
**"Stop Loss — structural, NEVER fixed-point"** and `CLAUDE.md:277` names this very module as
carrying mandatory backtester parity. The engine's *documented and implemented* stop model is
**structural, with ATR as floor/ceiling bounds** — the opposite of AR-1057 §2's summary.

⚠️ **And `framework-overlay.ts:328` mislabels it.** Its warning text reads
`stop_loss.type=${stop.type} is non-structural; CLAUDE.md §13 forbids fixed-point stops` — then
overwrites with `atr 1.5x`. §13 forbids **fixed-point** stops and *requires* **structural** ones.
The guard's message inverts the policy it cites. Reported, not repaired (outside §4.A scope).

## 3. BUT THE CAPABILITY IS STARVED — THE THREE CALL SITES, MEASURED

**This is why AR-1057's conclusion still lands in roughly the right place, for the wrong reason.**

| # | non-test call site | what it passes | what it can produce |
|---|---|---|---|
| 1 | `backtester.py:438` | **NO structural level at all** — every anchor arg defaults `None` (`:438-446`) | `candidates` is empty ⇒ **ALWAYS the `else` branch, `atr_fallback` 1.5×ATR** (`:249-252`) |
| 2 | `spec_condition_compiler.py:2357` | `nearest_swing_low/high` ONLY — **no FVG** (`:2364-2365`) | writes `entry["structural_stop_price"]` into an **`invalidation_summary` TRACE record**, wrapped in `except Exception: pass` — comment `:2369` says *"trace is best-effort, never fatal"* ⇒ **DIAGNOSTIC, NOT EXECUTABLE** |
| 3 | `context_runner.py:231` | **the full structural set incl. `nearest_fvg_below/above`** (`:238-247`) | genuinely executable — reached as a CLI (`python -m src.engine.context_runner`) from `src/server/routes/context.ts:93` and `src/server/services/context-gate-service.ts:88` |

### 3.1 THE DECISIVE MEASUREMENT — THE ANCHOR HAS NO PRODUCER

```
grep -rn "nearest_fvg_below" --include=*.py src/ | grep -v "/tests/"
  src/engine/context/structural_stops.py:204   <- the parameter declaration
  src/engine/context/structural_stops.py:240   <- its use inside the resolver
  src/engine/context_runner.py:240             <- struct.get("nearest_fvg_below")  (a READ)
```

**Three hits: one declaration, one use, one read. ZERO PRODUCERS.** Nothing in the repository ever
*computes* an FVG extreme and hands it to this resolver; site 3 reads it out of a caller-supplied
JSON `struct` dict that no caller populates.

★ **`A WIRED FUNCTION WITH EVERY ARGUMENT DEFAULTED IS DEAD CODE WEARING A CALL SITE.`**
This is the `[dormant-activation]` class again — built, reachable, and never fed.

## 4. THE CORRECTED §4.A ANSWER

> *Can the existing engine represent `direction-relative FVG extreme including wick` as the initial
> stop and `2R` as a fixed target without inventing a new generic risk architecture?*

**YES for representation and for the resolver — NO for supply, command, and transport.** Precisely:

1. **Representation — EXISTS.** `nearest_fvg_below/above` → `stop_reason="fvg"`. Do not mint a
   second one.
2. **Executable resolver — EXISTS and is reachable** at `context_runner.py:231`. **Do not author
   a runtime resolver** (AR-1057 §5.2's "irreducible new semantic" is not irreducible).
3. **Producer — ABSENT.** No code computes the FVG extreme. **This is now the irreducible work.**
4. **Anchor command — ABSENT.** Selection is *closest-wins priority* across
   `sweep_wick > OB > FVG > swing` (`:234`, `:245-248`). The teacher taught **the FVG specifically**;
   today a nearer sweep-wick or OB would silently win. Supplying *only* the FVG level achieves it
   de facto, but nothing *enforces* "this anchor, as taught".
5. **Wick inclusion — REPRESENTABLE BUT UNOWNED.** It is purely *which float the caller passes*
   (wick extreme vs body extreme). No contract anywhere carries the teacher's "wick included"
   instruction to that decision point.
6. **The executable path is the wrong one.** The money path's own site (#2) is trace-only and
   swallows exceptions; the backtester's (#1) is starved. Transport must reach an *executable*
   route, not the diagnostic one.

## 5. RESIZED MINIMUM ADDITIVE DELTA (proposed, NOT built — supersedes AR-1057 §5)

| AR-1057 §5 said | corrected |
|---|---|
| §5.1 source-risk contract on `SpecArtifactBody` | **UNCHANGED — still required.** Reuse the 12-value anchor enum already in `transcript-extractor-minimal-schema.json`. |
| §5.2 new `stop_loss.type` **+ its runtime resolver** — *"irreducible new semantic"* | **RESIZED.** Resolver EXISTS. Needed: a `stop_loss.type` that **routes to `compute_structural_stop`**, plus an **anchor-selector** so the taught anchor is commanded rather than proximity-won, plus **an FVG-extreme producer** (the genuinely absent piece). |
| §5.3 whole-position fixed R, not `tp1.r_multiple` | **UNCHANGED — and its trap still stands** (3-tier scale-out vs one fixed 2R). |
| §5.4 `SOURCE_FAITHFUL` / `TF_OVERLAY_VARIANT` mode flag | **UNCHANGED.** `[MEASURED]` neither token exists anywhere in `src/` — nothing has landed. |
| — | **NEW:** `framework-overlay.ts:328` must stop force-replacing non-`atr` types under `SOURCE_FAITHFUL`, and its inverted "non-structural" warning text is wrong regardless. |

**§8 STOP CHECK: still NO STOP.** §8.1 asks whether identifying the exact FVG/candle needs *"a broad
new state architecture"* — **it does not**: the consumer contract already exists and takes a float;
what is missing is a bounded producer. Sizing, DLL, prop-firm controls, paper execution and the exit
engine remain untouched.

## 6. WHAT I DID NOT MEASURE

- I did **not** verify that `context_runner`'s CLI route is on the *sVkm money path* — I measured
  only that two TS services invoke it. Its `run_evaluate` shows **0 in-repo callers** in
  `SYSTEM-INVENTORY.md:3945` (the invocation is a subprocess string, invisible to the symbol graph).
- I did **not** read `compute_targets` closely enough to rule on the fixed-`2R` lane; §3's table row
  is `ARTIFACT-SOURCED` from the call site, not a read of the target math.
- I did **not** enumerate every `"atr"` literal — the grep hit the 60-file cap and is mostly tests.
  The claim I make is narrower and does not need it: I claim `"fvg"` **is** implemented, which one
  executable line proves. I do **not** claim `"atr"` is rare.
- I did **not** mutate anything, run the extractor, or touch the `33`.

## 7. RECOMMENDATION

Proceed to §4.B on the corrected basis, **reusing `compute_structural_stop`** per AR-1056 §4.B.
The first RED→GREEN should be §5.4's **stop discriminator** driven through
`context_runner`'s executable route, because that is the only site today that can carry an FVG
anchor end-to-end. No advisor round-trip is required for that under AR-1056 §4; this AR is filed
because GPT would otherwise rule on AR-1057's refuted premise.

**Nothing blocking for the operator.**
