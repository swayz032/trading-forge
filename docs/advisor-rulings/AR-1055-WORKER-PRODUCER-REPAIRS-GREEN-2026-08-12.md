# AR-1055 — WORKER — ✅ **GREEN: BOTH PRODUCER REPAIRS RED→GREEN, ZERO REGRESSIONS, ONE DETERMINISTIC `sVkm` ARTIFACT MINTED WITHOUT THE FALSE HOUSE-DEFAULT STAMP**

```
RULING : AR-1054 GPT ruling (gpt-rulings 3019f32d) §3 / §4 / §5
PIN    : repairs committed on the ENGINEERING branch h1-wave4-sealed12-driver
COMMIT : c8154b92   (parent 0bbcabc8 — the pin every prior AR cites)
         5958385d   SYSTEM-INVENTORY regenerate (pre-push guard demanded it; see §6)
PUSHED : origin/h1-wave4-sealed12-driver  0bbcabc8..5958385d  — all hooks green,
         so GPT can verify c8154b92 and blob b36ea43c directly on GitHub.
STATE  : engineering code MUTATED, as authorised. No DB write. No onboarding.
         No backtest. No extractor mutation. No main transplant.
```

## 1. §3's MANDATORY GATE — THE DECLARED SCHEMA, CITED

§3: *"Before editing, locate the current production extraction/staging schema/type definition and
cite it. If the declared schema disagrees with the measured record, STOP."*

**Schema in force:** `src/agents/kb/transcript-extractor-minimal-schema.json`, selected by
`model-router.ts:2317` — `TRANSCRIPT_EXTRACTOR_USE_LEGACY` defaults to `"false"` ⇒ minimal schema.

```
stop.required        = ["anchor"]
stop.anchor          = enum[sweep_wick_below_entry, sweep_wick_above_entry, ob_low, ob_high,
                            fvg_low, fvg_high, swing_low_below_entry, swing_high_above_entry,
                            displacement_candle_low, displacement_candle_high,
                            swing_after_sfp, atr_multiple, null]
stop.description     = "anchor=null falls back to framework default (1.5x ATR + structural ceiling)"
targets.description  = "Empty array if speaker doesn't say"
targets.items.required   = ["priority","type"]
targets.items.r_multiple = number|null, minimum 0.1, maximum 50,
                           "R-multiple if speaker stated one"
```

⇒ **§8.1 does NOT fire.** The schema recognises the measured forms exactly — `fvg_low` is a declared
enum member — **and it states the untaught semantics itself.** I implemented the schema's semantics
rather than inventing compatibility rules.

★ **`level` is declared by NEITHER schema.** The single `level` substring in the minimal schema sits
inside the enum value `vp_level_proximity`; the legacy schema has no `"level"` at all. I checked
declared *properties*, not substrings — **the substring test is the error I was convicted of earlier
today (AR-1043/§9), so I did not repeat it.** `level` is retained purely for backward compatibility:
it can only ever ADD taught-ness.

## 2. RED → GREEN

New test: `src/engine/tests/test_producer_staging_vocabulary.py` (12 tests).

```
BEFORE the repairs :  7 failed, 5 passed
AFTER  the repairs : 12 passed
```
The 5 that passed at RED are the negative controls (A2/A3/A6/A7, B2) — **proof the suite was not
simply failing everywhere.**

### Repair A — `_untaught_exit` (§3 controls 1-7, all present)
| control | assertion | result |
|---|---|---|
| 1 | `sVkm` stop `anchor=fvg_low` + `r_multiple=2` ⇒ `False` | ✅ |
| 2 | same fixture, concrete values removed ⇒ `True` | ✅ |
| 3 | explicit `gestural_exit` ⇒ `True` | ✅ |
| 4 | taught stop only ⇒ `False` | ✅ |
| 5 | taught target only ⇒ `False` | ✅ |
| 6 | legacy `level` form behaviourally unchanged (both directions + gestural) | ✅ |
| 7 | **mutation control** — `type` alone, whitespace-only anchor, out-of-band `r_multiple=0`, and `r_multiple=True` all remain `True` | ✅ |

Control 7 is the one that bites: it fails if the predicate is loosened to "the dict is non-empty",
and it pins `bool` out of the numeric test (`isinstance(True, int)` is True in Python).
Control 8 additionally asserts **all 12 declared anchor enum values** count as taught.

### Repair B — OR lowering (§4 controls 1-4, all present)
| control | assertion | result |
|---|---|---|
| 1 | string classification no longer raises | ✅ |
| 2 | dict classification still contributes its `market_open_anchor` (≠ the no-classification result) | ✅ |
| 3 | `"futures_primary"` vs `"equities_primary"` vs `None` ⇒ **identical** outcome — no anchor manufactured | ✅ |
| 4 | missing source facts still yield the existing refusal, no definition | ✅ |

## 3. REGRESSION BASELINE — MEASURED, NOT ASSUMED

A library-wide predicate demands a real baseline (§3: *"a silent broad reclassification without
these controls is not acceptable"*). I stash-controlled my two source edits and ran the **identical
selection** both ways:

```
WITHOUT my edits : 48 failed, 124 passed
WITH    my edits : 48 failed, 124 passed      => ZERO REGRESSIONS
```

★ Memory records "33 reds at baseline", but **that is a different population and reds decay**, so I
measured instead of citing it. Of the 33 in my first filtered run, 30 live in
`test_track3_strategy_regime_wiring.py`, which **imports neither changed module** — they cannot be
mine by mechanism, and the stash control confirms it by measurement.

## 4. §5 FORWARD-REGENERATION RECEIPT — ALL TEN ITEMS

| # | item | value |
|---|---|---|
| 1 | transcript sha256 | `df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc` |
| 2 | record sha256 | `199d740b70b65f83ef3c4badb11af12cf405f741ef6e482701641f3ae11d1167` |
| 3 | new engineering commit | **`c8154b92`** |
| 4 | producer blob after repair | **`b36ea43c8f04abbd948220db8cbedcb2008456f3`** |
| 5 | generated `spec_hash` | **`560332b8803e06bbcf30dbb5e3f7de796e651f929837efe0df21cd3bdf373901`** |
| 6 | second identical run | **byte-identical artifact AND spec_hash** |
| 7 | `_untaught_exit` | **False** ✅ |
| 8 | house-default stamp | **absent** — `framework_overlay` is `null` ✅ |
| 9 | taught stop emits `INVALIDATE` | **1 condition** ✅ |
| 10 | the `INVALIDATE`, exactly | see §5 — **reported, not overclaimed** |

## 5. 🛑 ITEM 10 — WHAT THE `INVALIDATE` ACTUALLY CARRIES, STATED LOUDLY

```
type     = INVALIDATE      role = invalidation
object   = "The stop is placed at the extremity (body plus wick) of the FVG candle
            to allow room for price breathing."
evidence = (the same string)
span     = {"start": 0, "end": 0}
```

**MEASURED, both directions:**
```
evidence text appears verbatim in the transcript?              FALSE
extractor's stop.transcript_quote appears verbatim?            TRUE
```

⇒ **The `INVALIDATE` carries the LLM-authored `rationale`, not the teacher's words — and the real
verbatim quote was sitting on the record unused.** This is precisely the `_condition_text()`
behaviour GPT named in AR-1054 §2.C (it reads `action`/`description`/`rationale`/`stop_management`,
never `transcript_quote`).

**Why §8.5 does NOT fire:** that STOP is for an `INVALIDATE` that *silently* claims a span/quote it
cannot ground. **This one claims nothing** — `span {0,0}` asserts no transcript location — and I am
reporting it in the receipt rather than letting it read as source authority.

★ **THIS COMMIT DOES NOT TRANSPORT THE TEACHER'S STOP/WICK/2R CONTRACT OR QUOTE AUTHORITY.** It
proves only that the producer now (a) consumes a real forward record, and (b) recognises that this
teacher taught risk. **The 2R target is still not serialised into `spec_body` at all.** That is the
banked §7 source-risk handoff, unchanged and still next.

## 6. DISCLOSURES (§0-CTRL.4)

- **New red I caused:** the canonical-manifest guard
  (`test_opening_range_grammar_firebreak.py`) now reports **two** drift members —
  `test_mp1_backtester_ingress.py` (**pre-existing**, `ACCEPT5-POSTCLOSE-POPULATION-DRIFT-1`) and
  **`test_producer_staging_vocabulary.py` (mine)**. The population is auto-derived, so any new test
  file enlarges it. **NOT regenerated**, per the standing "do not regenerate" order carried in
  AR-1039. The guard did exactly its job and I am not silencing it.
- **Behaviour change beyond the named defect:** a **non-dict** `stop` (e.g. a bare string) now reads
  as untaught, where previously it read as taught. No declared schema emits that form, and upstream
  normalisation lifts bare strings to `{"anchor": <str>}` — but it **is** a change and it is stated.
- **`atr_multiple` is a declared anchor enum value**, so a source that genuinely taught an ATR stop
  now counts as taught. That is correct per the schema, and it is a reclassification.
- I did **not** re-run the extractor for this unit — the byte-stable record from AR-1053 was reused,
  which is what makes items 1/2 meaningful.
- **A second engineering commit was required and is disclosed:** the pre-push guard refused the push
  because my code change made `docs/designs/SYSTEM-INVENTORY.md` stale
  (*"a stale map answers confidently about a tree that no longer exists"*). I regenerated and
  committed it (`5958385d`) — its own prescribed remedy, `--check` now exits 0, 19/19 positive
  controls pass. ⚠️ **This is NOT the artifact under the standing "do not regenerate" order** —
  that order covers the ACCEPT-5 canonical regression-population manifest (§6 above), a different
  file with a different guard. I checked before acting rather than pattern-matching the word
  "regenerate".

## 7. STATE

**§9 GREEN reached.** No §8 STOP fired. No new independent producer blocker appeared: the producer
consumed the byte-stable record end-to-end and minted a deterministic artifact.

Awaiting GPT's close of this unit and the move into the banked **source risk handoff**
(`extracted stop/wick/2R → SpecArtifact taught-risk contract → onboarding → Python → exact source
stop + fixed 2R`), which §7 requires to search existing production risk/exit contracts before
proposing any new one.

**Nothing blocking for the operator.**
