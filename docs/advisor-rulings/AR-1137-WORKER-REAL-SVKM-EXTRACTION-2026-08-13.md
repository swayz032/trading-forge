# AR-1137 (worker) — 🟢 **LANE C: THE REAL sVkm EXTRACTION RAN AND IT CONFIRMS YOUR §7 EXPECTATIONS FROM CERTIFIED EVIDENCE — INCLUDING THE 2R TARGET AND THE TEACHER'S STOP, VERBATIM.** Extraction stage only; grading NOT run.

**Seat:** Claude Code worker · **Date:** 2026-08-13 · **Authority:** AR-1133 §6 (C-a)

## 1. PROVENANCE — BOUND TO THE PINNED BYTES

```
transcript chars 25071   sha256 df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc
                                  == the AR-1126 pin, verified BEFORE the extractor ran
extractor        real production path: invoke_real_extractor -> h1-extract-one.ts -> gemma via Ollama
elapsed          89s
extraction_sha256 c37ff26f753449c35b6ec0402a3152dc287a8ae427eb0d86661b3fb43ec01823
population        docs/replay-results/svkm-extraction-certified/   (NEW — the frozen Tier-A
                  directory and its manifest were NOT touched)
SEAL-GO token     NOT spent
```

**1 strategy, 0 rejected**, `instrument_classification: futures_primary`, name **`fvg_breakout_range_1m_5m`** — the extractor named both timeframes itself.

## 2. IT PRODUCED THE TWO-TIMEFRAME STRUCTURE ON ITS OWN

```
higher_timeframe: "5m"      lower_timeframe: "1m"
```

**Nothing hardcoded this.** The expected table stayed a validator; the extractor read it from the transcript.

### The 4-step entry sequence, each with the teacher's own words

| # | action | teacher's quote |
|---|---|---|
| 1 | at 09:30 ET mark the high/low of the **first 5-minute candle** | *"This strategy needs to be traded at 9:30 a.m. Eastern time, New York time."* |
| 2 | wait for the **1-minute** candle to **close outside** the 5m range | *"We are essentially waiting for the one minute time frame candles to print into one of these sides of the range"* |
| 3 | wait for an **FVG sequence** to form outside the range | *"What we're looking for is a fair value gap sequence that is printing outside of the range."* |
| 4 | enter on the **closure of the third candle** of the FVG sequence | *"My entry is going to be on the closure of that third candle."* |

**This is AR-1109's causal chain, re-derived independently from the same bytes by the production extractor.**

### Stop and target — both from certified evidence, both verbatim

**STOP** — `anchor: "fvg_low"`, `buffer_atr: null`, `atr_multiplier: null`:
> *"what I want you to do for the stop loss is we're just going to put it at the bottom of the fair value candle. Really simple. **If this candle had a big wick, then you would also include the wick.**"*

**TARGET** — `type: "r_multiple"`, **`r_multiple: 2`**, priority 1:
> *"all we're going to do for the target is we're going to have a fixed target. And the fixed target we're looking for is a **risk-to-reward ratio of two**."*

**Your §7, answered by the certification rather than by us:** 5m opening range ✅ · 1m breakout confirmation **EXPLICIT** ✅ · FVG and entry-completion carry **no explicit timeframe** in their steps, so they remain **SOURCE_RESOLVED_BY_CONTINUITY**, exactly as graded ✅ · teacher structural stop ✅ · **fixed-R = 2 from certified source evidence** ✅.

⚠️ **ONE REAL DIFFERENCE FROM MY SYNTHETIC FIXTURES, AND IT MATTERS:** the certified stop anchor is **`fvg_low`**, not the `sweep_wick_below_entry` I used in labelled synthetic probes. `ANCHOR_TO_RESOLVER` maps `fvg_low -> "fvg"`, so it resolves — but **the real contract is the FVG candle's low including the wick**, and any downstream fixture must now use that, not mine.

## 3. WHAT IS **NOT** CLAIMED

🛑 **This is the EXTRACTION stage only.** The record is stamped `EXTRACTION_CERTIFIED_PENDING_GRADING`. **`pilot_conveyor` grounding/tiering/certification has NOT been run**, so **this is not yet a certified record and §9.2 is not closed.** I split the script deliberately so a failure at extraction could never be mistaken for certification.

**Also not done:** no `compile_certified_record` run · no `.spec.json` · no `source_timeframe_roles` carrier emitted by the Python producer yet (that is the §3.2/§3.3 producer work, still open) · no grader · no backtest · no trade.

**DISCLOSURES:** my run log printed *"0 conditions"* — that was **my wrong key guess** (`entry_conditions` vs the extractor's `entry_sequence`), not an empty extraction; caught immediately by opening the object · the extractor ran once, no retries, no cherry-picking · nothing was hand-authored, and the vault holds the extractor's own output · **your new ruling `f409f2ed` landed while I was writing this and I have not read it yet** — if it redirects Lane C, this result stands as evidence regardless.

**Next unless you redirect:** run the real `pilot_conveyor` grading/certification on this extraction. If it cannot pass its actual grading contract, I stop and report rather than relabel it.
