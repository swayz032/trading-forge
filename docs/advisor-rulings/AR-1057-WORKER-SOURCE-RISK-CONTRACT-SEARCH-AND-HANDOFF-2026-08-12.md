# AR-1057 — WORKER — **§4.A BOUNDED CONTRACT SEARCH: the engine can express `2R`, but CANNOT express a structural stop anchor.** The minimum additive delta, named. · HANDOFF

```
RULING : AR-1056 GPT ruling (gpt-rulings a93d1d80) §4.A -- bounded existing-contract search
HEAD   : 5958385de1029a20274d3b56c669f551ca3c2589  (engineering, pushed; my c8154b92 + inventory)
STATE  : READ-ONLY. NO CODE MUTATED IN THIS UNIT. Nothing half-written.
```

## 1. THE QUESTION §4.A ASKS, ANSWERED

> *Can the existing engine represent `direction-relative FVG extreme including wick` as the initial
> stop and `2R` as a fixed target without inventing a new generic risk architecture?*

**MEASURED: `2R` — mostly yes. The structural stop — NO.**

## 2. STOP ANCHOR — NOT REPRESENTABLE BY ANY EXISTING CONTRACT

| surface | what it declares | can it carry `fvg_low` + wick? |
|---|---|---|
| `src/engine/compiler/strategy_schema.py` `StrategyDSL` | `stop_loss_atr_multiple: float` **(required)**, `take_profit_atr_multiple: Optional[float]` | **NO** — ATR multiples only |
| `ExitType` enum (same file) | `fixed_target · trailing_stop · time_exit · indicator_signal · atr_multiple` | **NO** — no structural/anchor member |
| `src/server/services/framework-overlay.ts` | `stop_loss?: { type?: string; multiplier?: number }` | shape allows a `type` string, but… |
| the engine's actual `type` handling | every consumer branches on `type == "atr"` — `backtester.py:2256/3802/3871`, `indicators/core.py:599/718`, `optimizer.py:47`, `parity_engine/shadow_runner.py:142` | **NO** — `"atr"` is the only implemented value |

⇒ **A stop located at a structural feature (the FVG candle's extreme, wick included) has no
representation anywhere from staging to runtime.** The engine's entire stop vocabulary is
"a multiple of ATR". This is the minimum additive delta the unit needs.

## 3. FIXED `2R` TARGET — R SEMANTICS ALREADY EXIST, BUT BOUND TO THE WRONG SHAPE

| surface | what it declares | usable as the teacher's single fixed 2R? |
|---|---|---|
| `ExitType.FIXED_TARGET` | a fixed-target exit type exists | **YES, as the type** |
| `framework-overlay.ts` `take_profit?: { type?, multiplier?, partial_at_r? }` | **`partial_at_r` already carries R semantics** | partially — it is a PARTIAL at R, not a whole-position fixed R |
| `jsonb-shapes.ts` `ExitPlanWithRuntimeState` | `tp1.r_multiple`, `tp2.r_multiple`, `runner.trail_method`, `scaling.{tp1_pct,tp2_pct,runner_pct}` | **NO — semantically wrong.** This is the framework's Style-C 3-tier scale-out |

⚠️ **The reuse trap, named:** `tp1.r_multiple` is the closest-looking existing field, and reusing it
would express the teacher's **one fixed 2R** as a **three-tier partial scale-out**. That is a
different strategy with the same numbers. ★ **`A FIELD WITH THE RIGHT NAME AND THE WRONG ARITY IS
NOT A REUSABLE CONTRACT.`**

## 4. WHY NOTHING TRANSPORTS TODAY, END TO END

```
extractor        stop.anchor=fvg_low + transcript_quote ; targets[0].r_multiple=2   ✅ present
   |
producer         INVALIDATE built from the LLM rationale, span {0,0};                ❌ quote lost
                 r_multiple never serialized into spec_body                          ❌ target lost
   |
SpecArtifactBody no taught-risk / source-target field                                ❌ (GPT-verified)
   |
onboarding       hardcodes stop_loss {type:"atr", multiplier:1.5}, then overlay      ❌ replaced
   |
framework-overlay.ts:12 -- "The RISK MANAGEMENT (stop, TP, time_stop, sizing) is REPLACED"  ❌ policy
   |
Python runtime   only `type == "atr"` is implemented                                 ❌ unrepresentable
```

**Five independent losses, in series.** AR-1056 §3 supersedes the overlay policy for
`SOURCE_FAITHFUL`, which removes the fourth and fifth as *policy* — but the runtime still has no
shape to put a structural stop into.

## 5. THE MINIMUM ADDITIVE DELTA (proposed, NOT built)

1. **A source-risk contract on `SpecArtifactBody`** carrying, per §4.C: exact stop quote + span/hash
   authority · the declared `anchor` enum value · wick inclusion · `r_multiple`.
   The **anchor vocabulary already exists** in `transcript-extractor-minimal-schema.json`
   (12 enum values) — reuse it rather than mint a second one.
2. **One new `stop_loss.type`** (e.g. a structural-anchor form) plus its runtime resolver, since
   `"atr"` is the only implemented value. **This is the irreducible new semantic** — everything else
   is transport.
3. **A whole-position fixed-R target**, distinct from `partial_at_r` and from the Style-C 3-tier
   plan. `ExitType.FIXED_TARGET` supplies the type; the R value needs a home that is not `tp1`.
4. **Mode flag** `SOURCE_FAITHFUL` vs `TF_OVERLAY_VARIANT` (§4.D), defaulting to legacy behaviour so
   no existing strategy silently becomes source-risk-driven.

**§8-style STOP check:** this does **not** require redesigning sizing, DLL, prop-firm controls,
paper execution, or the exit engine. It is additive transport plus **one** new stop semantic.
**No STOP condition has fired.**

## 6. WHAT I DID NOT DO

- **No code mutated in this unit.** §4.A is the search; I stopped at its boundary.
- I did **not** inspect the paper/live execution path, sizing, or DLL — §4.A says do not launch a
  repository-wide risk audit, and they are outside the transport chain above.
- I did **not** verify whether any *other* `stop_loss.type` value is accepted by a surface I did not
  read; the claim "`atr` is the only implemented value" rests on the six consumer sites listed in §2
  and is `UNENUMERATED` beyond them.
- I did **not** design the runtime resolver for the structural anchor.

## 7. 🛑 HANDOFF — THIS IS THE CHEAP MOMENT, AND IT IS A REAL BOUNDARY

**Fan-in: the authorized unit's §4.A step is COMPLETE. Nothing is half-written. No uncommitted
code. Working tree clean of my work; engineering head pushed and GPT-verified.**

`PRODUCER-STAGING-VOCABULARY-1` was **closed by AR-1056** — a unit boundary, not a lane boundary.
The next step (§4.B onward) is a **multi-layer build across Python and TypeScript** touching risk
semantics, with five RED→GREEN proofs and mode separation. That is precisely the shape
`worker-onboarding` §4.5 warns against starting in a long seat: *"a session near its limit is the
one most likely to produce a partial result that reads as complete."*

**I am declaring genuine context exhaustion at a closed unit**, not at an unstarted lane.

**The next seat starts here, re-deriving nothing:**
1. Read AR-1056 §4-§5 and the blueprint at `0398b79a` §2 (evidence tiers) and §4 STEP 1.
2. §4.A is **done** — this AR is its output. Go straight to §4.B with §5's delta.
3. The golden record is reproducible: `run_two_phase_extraction` over the committed transcript
   (`df72444f…`) yields record `199d740b…` deterministically (AR-1053), ~135s, ollama must be up.
4. The forward artifact today: `spec_hash 560332b8…`, `_untaught_exit` False, no house-default stamp.
5. **Do not** reuse `tp1.r_multiple` for the teacher's single fixed 2R (§3's trap).
6. **Do not** regenerate the ACCEPT-5 canonical manifest; **do** regenerate `SYSTEM-INVENTORY.md`
   when the pre-push guard demands it (different artifacts — I verified this).

**No dispatched sub-agent is outstanding. The ruling ear is armed on
`origin/external-advisor/gpt-rulings` and dies with this seat — the next seat must re-arm it
(`worker-onboarding` §2a) and back-fill from head `a93d1d80`.**

**Nothing blocking for the operator. No open question for GPT.**
