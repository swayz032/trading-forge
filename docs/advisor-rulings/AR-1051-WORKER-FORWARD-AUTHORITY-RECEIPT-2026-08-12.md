# AR-1051 — WORKER — **§3.A FORWARD-AUTHORITY RECEIPT** · 4 of 6 anchors captured · **anchors 3 and 6 CANNOT be captured "before mutation": no pre-repair certified record exists anywhere**

```
RULING : AR-1050 GPT ruling (gpt-rulings b3fb81d3) §3.A
PIN    : 0bbcabc81ae2ed6350bcda4d8494cff1e618dd81  (unchanged -- MEASURED HERE)
STATE  : READ-ONLY. NO PRODUCTION CODE MUTATED. NO COMMIT ON THE ENGINEERING BRANCH.
```

## 1. THE RECEIPT

| # | anchor | value |
|---|---|---|
| 1 | raw transcript + hash | `docs/source-transcripts/raw/sVkmZklJDHI.txt`, sha256 `df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc`, 25,071 ch |
| 2 | teacher spans | **stop `13869-13908`** · **wick `14097-14127`** · **fixed 2R `14488-14515`** (verbatim in §2) |
| 3 | pre-repair staging/certified record hash | 🛑 **DOES NOT EXIST — see §3** |
| 4 | engineering pin | `0bbcabc81ae2ed6350bcda4d8494cff1e618dd81` |
| 5 | producer path + blob | `src/engine/extraction/spec_producer.py` @ `16d9bd288a6e58c21dd28da51f56644458400e7f` |
| 6 | pre-repair producer output `spec_hash` | 🛑 **UNOBTAINABLE without first minting anchor 3 — see §3** |

## 2. ANCHOR 2 VERBATIM (from the committed raw file)

- `13869-13908` — *"what I want you to do for the stop loss is we're just going to put it at the
  bottom of the fair value candle."*
- `14097-14127` — *"If this candle had a big wick, then you would also include the wick. **Don't
  just go to the body.**"*
- `14488-14515` — *"the fixed target we're looking for is a **risk-to-reward ratio of two**."*

## 3. 🛑 THE ORDERING CONTRADICTION IN §3.A — REPORTED, NOT GUESSED AROUND

§3.A asks for the pre-repair certified/staging record hash **and** that producer's pre-repair
`spec_hash`, **before mutation**. **MEASURED: no such record exists in any reachable store.**

```
DB   : the only candidate table, public.contract_specs_authoritative, has 0 ROWS.
       No staging/certified/extraction record table holds the 40 videos.
VAULT: extractor_bridge caches to `<vault_dir>/<video_id>.json`
       -> NO vault directory exists on disk; no `*sVkm*` file anywhere in the tree.
DISK : no committed JSON carries an sVkm staging record (stop/targets/entry_sequence).
```

⇒ **The "pre-repair record" is not a historical artifact that can be hashed. It can only be MINTED
by running the current extractor now.** That is still consistent with §3.B ("**Build** one bounded
`sVkm` fixture through the REAL current extraction path"), but it changes what the receipt proves:

★ **The receipt attests `current extractor @ pin -> current producer @ blob`. It does NOT and cannot
attest anything about the record behind the legacy DB row — that input is simply gone.** Anchors 3
and 6 are therefore **post-mint**, not pre-mutation, and I am recording that rather than quietly
producing a number that looks historical.

**No STOP fired.** §6.2 ("cannot be replayed deterministically") does **not** fire on availability:
ollama is up with the canonical `gemma4:e4b-it-qat` (also `12b-it-qat`, `e2b`), and the extractor
pins `{"seed": 42, "temperature": 0.1, "model": "gemma4:e4b-it-qat"}`. **Determinism itself is
UNPROVEN until measured** — §3.D.5's byte-identical rerun is the test, and I have not run it.

## 4. THE PATH, MAPPED (so it is not re-derived)

```
run_two_phase_extraction(transcript_text, video_id)      extractor_bridge.py:227
  -> invoke_strategy_enumerator (Phase A, 1 call)                          :300
  -> invoke_real_extractor per Phase-A strategy (Phase B)                  :89
  -> record {strategies[], instrument_classification, ...}
produce_spec_artifact_from_record(record, video=..., certificate=...)  spec_producer.py:959
  -> produce_spec_artifact(strategies[i], ...)                             :580
```
**The risk contract, read (not assumed):**
- `spec_producer.py:626` — `stop = strategy_extraction.get("stop")`; if a dict with text ⇒ emitted
  as an **`INVALIDATE`** condition. **This is §3.D.2's channel and it already exists.**
- `_untaught_exit()` `:436-454` — returns True iff **stop_untaught AND targets_untaught**, where
  `stop_untaught = stop is None or stop.level is None or stop.gestural`, and
  `targets_untaught = targets empty or all(t.level is None or t.gestural)`.
  ⇒ **To satisfy §3.D.3 the repaired record needs a `stop` with a non-null, non-gestural level AND
  a `targets[]` entry with a real level.** The staging vocabulary already has both fields
  (`spec_producer.py:803` enumerates `stop` and `targets`), so **§6.1 does NOT fire.**
- ⚠️ **Confirming GPT §2:** the producer READS `targets` in `_untaught_exit` but **never serializes
  a taught target into `spec_body`.** So even a perfect record cannot carry `2R` into the spec —
  exactly the banked §5 defect. **§3.D's GREEN closes the extraction link ONLY.**

## 5. ADJACENT FINDING — REPORTED, NOT PURSUED (§4 bans archaeology)

The legacy `framework_owned` shape is **not** unattributable. It is committed in this repo:
`docs/designs/corpus-v2-mode-ab-strategies.json` (1.81 MB, 78 entries) carries `sVkmZklJDHI`
compiled specs with
`framework_overlay = {"stop":"framework_owned","sizing":"framework_owned","take_profit":"framework_owned"}`
and `spec_hash = 0507bff452f3f69f966519ce1be4b073ecbbd51e38b23ae12774c0449d0a7a42`.

**This narrows AR-1047 §4 usefully: the legacy shape lives in a committed corpus artifact, not only
in the DB.** I have **not** investigated what produced that file, per §4's archaeology ban. Flagged
for whenever the legacy lane is reopened.

## 6. NEXT ACTION

Proceeding to §3.B: mint the `sVkm` record through `run_two_phase_extraction` and prove the RED
(the freshly-extracted record does not carry the taught stop/2R). **No production code will be
mutated until that RED is measured and reported.**
