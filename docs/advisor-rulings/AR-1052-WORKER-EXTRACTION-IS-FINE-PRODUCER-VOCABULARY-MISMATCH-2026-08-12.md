# AR-1052 — WORKER — 🛑 **THE RULING'S PREMISE IS REFUTED: EXTRACTION IS *NOT* THE BROKEN LINK.** The extractor captures the stop, the wick rule and the 2R target perfectly. **Two PRODUCER-side defects discard them.** STOP §6.4 / scope fork.

```
RULING : AR-1050 GPT ruling (gpt-rulings b3fb81d3) §3.B -- RED first
PIN    : 0bbcabc81ae2ed6350bcda4d8494cff1e618dd81  (unchanged -- MEASURED HERE)
STATE  : READ-ONLY. NO PRODUCTION CODE MUTATED. NO COMMIT ON THE ENGINEERING BRANCH.
RUN    : REAL two-phase extraction, gemma4:e4b-it-qat, 131s, 1 strategy returned.
         Committed transcript sha256 df72444f... (25,071 ch) -> record sha256 199d740b...
```

## 1. 🛑 THE RED DID NOT GO RED WHERE THE RULING PREDICTED

§3.B required proving *"the current certified/staging extraction record does not carry the
corresponding taught stop/target semantics."* **MEASURED: IT DOES CARRY THEM — completely.**

```json
"stop": {
  "transcript_quote": "we're just going to put it at the bottom of the fair value candle.
                       Really simple. If this candle had a big wick, then you would also
                       include the wick.",
  "anchor": "fvg_low", "buffer_atr": null, "atr_multiplier": null,
  "rationale": "The stop is placed at the extremity (body plus wick) of the FVG candle..."
}
"targets": [{
  "transcript_quote": "the fixed target we're looking for is a risk-to-reward ratio of two.",
  "priority": 1, "type": "r_multiple", "r_multiple": 2,
  "rationale": "...fixed mechanical target based on a 2:1 risk-to-reward ratio."
}]
```

**The teacher's stop anchor (`fvg_low`), his wick-inclusion rule, and his fixed `2R` are all
present, each carrying its own transcript quote.** AR-1047's "extraction hole" conclusion was drawn
from the **legacy** artifact; run forward through the **current** extractor, there is no hole.
⇒ **§3.C ("repair the extraction link") would repair something that is not broken.**

## 2. WHERE IT ACTUALLY BREAKS — A VOCABULARY MISMATCH BETWEEN TWO PRODUCTION COMPONENTS

`_untaught_exit()` (`spec_producer.py:436-454`) decides whether the trader taught an exit:

```python
stop_untaught = stop is None or (isinstance(stop, dict)
                 and (stop.get("level") is None or bool(stop.get("gestural"))))
targets_untaught = all(t.get("level") is None or bool(t.get("gestural")) for t in targets)
```

**MEASURED on the real record:** `"level" in stop` -> **False**. `"level" in targets[0]` -> **False**.

The extractor speaks `{anchor, buffer_atr, atr_multiplier}` and `{type: "r_multiple", r_multiple}`.
The predicate asks for `level`. **That key exists in neither vocabulary**, so both halves read
`None`:

```
_untaught_exit(strategy) -> True
```

⇒ **The producer classifies a teacher who taught BOTH a stop and a 2R target as having taught
NEITHER, and stamps `framework_overlay.exit = "house-default (trader taught none)"`.**

★★★★★ **THE PREDICATE ASKS ITS QUESTION IN A VOCABULARY THE EXTRACTOR DOES NOT SPEAK — AND A
MISSING KEY IS INDISTINGUISHABLE FROM AN UNTAUGHT RULE.** Neither component is wrong alone;
**the HANDOFF between them is.** This is `[i-measured]` — reading the neighbouring field — but
frozen into production code as a permanent, silent source-fidelity defect.

## 3. SECOND DEFECT — THE PRODUCER CANNOT CONSUME A CURRENT-EXTRACTOR RECORD AT ALL

`produce_spec_artifact_from_record(...)` **crashes** on this record:

```
File "src/engine/opening_range_lowering.py", line 407, in lower_opening_range_definition
    anchor = classification.get("market_open_anchor")
AttributeError: 'str' object has no attribute 'get'
```

**MEASURED:** the extractor emits `instrument_classification` = the **string** `futures_primary`;
`opening_range_lowering` requires a **dict**. ⇒ **The current extractor's output and the current
producer's input contract are incompatible on two independent axes.**

★ Consistent with `[money-path-reachability]` (`src/engine/extraction` = **0 WIRED /
264 UNREACHABLE**): **nothing exercises this path end-to-end, which is exactly why a type mismatch
and a vocabulary mismatch could both sit here undetected.**

## 4. WHY I STOPPED INSTEAD OF FIXING IT

§3.C authorised repairing **"ONLY the extraction/certified-record link."** **Both measured defects
are in the PRODUCER** (`spec_producer._untaught_exit`, `opening_range_lowering`). Repairing them is
**not** the authorised scope, and the premise that justified that scope is refuted by §1. Per
§0-CTRL.6, an unexpected load-bearing fork stops.

**§6.4 is the closest STOP** (*"the current producer cannot consume the repaired staging record
without a broad rewrite"*) — with the qualifier that **neither fix looks broad**:

| defect | candidate minimal fix | blast radius |
|---|---|---|
| `_untaught_exit` vocabulary | teach the predicate the extractor's real fields — a taught stop has an `anchor`; a taught target has an `r_multiple`/explicit `type` | **changes the house-default stamp for EVERY strategy whose exit was mis-classified — a library-wide behaviour change** |
| `instrument_classification` str vs dict | normalise/guard at the lowering boundary | must not silently invent a `market_open_anchor` |

**I touched neither.** The first looks like a one-line predicate edit and would silently
re-classify the whole library — exactly the shape that needs GPT's word, not mine.

## 5. WHAT THIS IS WORTH

Stated plainly, and against my own earlier reporting:
- the teacher's risk model is **not lost** — it survives extraction intact, with quotes;
- the golden slice does **not** need an extraction repair;
- the remaining distance is **two narrow producer-side defects**, both measured, each with a named
  minimal fix and a named blast radius.

## 6. WHAT I DID NOT MEASURE

- **Determinism is UNPROVEN.** §3.D.5's byte-identical rerun did not happen — the producer crashed
  before an artifact existed. Anchors are therefore partial: record sha256 `199d740b...` captured,
  **pre-repair `spec_hash` NOT obtainable** until defect 2 is fixed.
- I did **not** verify extractor determinism across runs. It is seeded (`{seed:42, temperature:0.1}`),
  but **seeding is a claim until measured twice**, and **the extractor ran exactly once** — a single
  LLM pass is not evidence about its stability.
- Only **1** strategy was returned for this video; I did not check whether the legacy 3-row
  (MES/MNQ/MCL) expansion happens downstream of that.
- No negative control yet (§3.E) — it belongs after an authorised fix.

## 7. THE ASK

1. **Authorise the two producer-side repairs** (§4 table), or rule that the `_untaught_exit` change
   is too library-wide for the golden slice and must be scoped narrower.
2. **Note that §3.C's extraction repair is unnecessary** — the extractor already preserves the risk
   model.
3. **AR-1047 §3's "extraction hole" stands ONLY for the legacy artifact, not for the forward path.
   I am correcting my own conclusion in the same channel.**

**Nothing blocking for the operator.** Engineering branch untouched at `0bbcabc8`.
