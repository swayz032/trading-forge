# Blind anchor-support adjudication — item C-1

## Integrity pre-checks (both PASS)

**MEASURED HERE.**

| Check | Declared | Measured | Result |
|---|---|---|---|
| `transcript_sha256` | `df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc` | `df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc` (sha256 over the 25,071 raw bytes) | **MATCH** |
| `char_span [9294, 9512]` | 218 chars | `transcript[9294:9512] == quote` → `True`; quote length 218 | **EXACT MATCH** |
| Span uniqueness (2nd path) | — | `transcript.count(quote) == 1`; `transcript.find(quote) == 9294` | **UNIQUE, offsets corroborated without using them** |
| Byte/char parity | — | `len(bytes)==len(chars)==25071`, `isascii()==True`, 0 LF / 0 CRLF / 0 CR | no encoding or line-ending offset hazard |

The file is a single line of pure ASCII with no newlines at all, so the byte offsets and character offsets are provably identical — the usual CRLF/BOM offset trap cannot apply here. Both declarations hold; I proceed to the judgement.

## Verdict

```json
{
  "C-1": {
    "support": "PARTIAL",
    "unsupported_clauses": [
      "\"initial\" (in \"the initial 5m range\") — DECISIVE. The quote says only \"this 5m minute range\". Nothing inside the span identifies WHICH 5m range, or that it is the first/opening one. The deictic \"this\" is not bound anywhere in the quoted words.",
      "the singular count in \"The 1m candle\" — MINOR / underdetermined, not decisive. The quote says \"the candles need to close\" (plural). The 1m TIMEFRAME itself is fully supported; only the one-candle count is not established by the quoted words."
    ],
    "justification": "The quote squarely supports the core rule — 1m-timeframe candles, closing (not merely wicking) outside a 5m range, stated as an obligation (\"What HAS TO happen\", \"NEED TO close\"). It does not support the qualifier \"initial\": the quoted words contain no token identifying the range as the first/opening one, and the nearest text that would license it sits 525 characters before the span start, outside the quote."
  }
}
```

### Clause-by-clause

| Clause of the extracted condition | Quoted words relied on | Verdict |
|---|---|---|
| **1m timeframe** | S1: "the **one minute time frame** candles"; S3's "the candles" is bound by S1 inside the span | SUPPORTED — anaphora resolved internally |
| **must** (obligation, not observation) | "What **has to** happen is the candles **need to** close" | SUPPORTED — 2 obligation markers, 0 hedges (`should`/`may`/`sometimes` all count 0 in span) |
| **close** (not touch/wick/print through) | "need to **close** outside" | SUPPORTED — the speaker names the close explicitly |
| **outside of … 5m range** | "close **outside of this 5m minute range**" | SUPPORTED |
| **initial** | *(no in-span token)* | **UNSUPPORTED** |
| **The 1m candle** (singular) | "the **candles**" (plural) | Underdetermined — flagged, not decisive |

The extractor's "initial" may well be *factually true of the strategy* — but the question asked is whether **this quote expresses it**, and it does not. That distinction is the whole finding: the condition imports a qualifier from context the span excludes.

## NOVEL ATTACK

Four attacks of my own devising, beyond the instructions.

**A1 — Span-boundary sensitivity: quantify how far the span sits from text that WOULD license "initial".** Rather than merely asserting the absence, I measured the distance from the span to every phrase in the transcript that could ground the qualifier. Nearest licensing text is **525 characters before the span start** ("how high the price went within the **first 5 minutes**"); others at 987, 994, 997, and 1,419 chars away, plus one at 638 chars *after*. **Finding:** the qualifier is not merely absent from the quote, it is ~525 chars out of reach — this is a *span-too-narrow* defect, not a hallucinated fact. A repair exists: widen the span, or drop the adjective. This converts a vague "unsupported" into an actionable fix point.

**A2 — Positive control on my own absence scanner.** My in-span token scan reported `initial=0, first=0, 9:30=0, 930=0, open=0, begin=0, start=0, 1st=0`. An all-zero scan is exactly the shape of a broken instrument, so I planted a known-bad: I injected `"this initial 5m minute range"` into a copy of the slice and re-ran the identical scanner. It fired (`initial=1`). **My absence claim has a demonstrated path to red.**

**A3 — Does the strategy's own NAME license the singular? (a trap I set for myself)** A lazy grader could rescue the singular "The 1m candle" by citing the strategy's name, "the **one candle** setup". I measured all 4 occurrences and read their context: at char 4900 the speaker glosses it, and the surrounding material ("that first 9:30 candle… this is your 5minute candle") attaches "one candle" to the **9:30 five-minute range-defining candle**, not to the 1m breakout candle. **Finding: the strategy name does NOT license the singular here — it refers to a different candle on a different timeframe.** A grader who reached for that rescue would have confirmed the wrong object. This is why I left the singular flagged rather than waved through.

**A4 — Mutation self-test: does my adjudication have a path to BOTH red and green?** A grader that only ever downgrades is as useless as one that only confirms. I pre-registered expected verdicts on four mutated conditions and ran my own method against the same quote:

| Mutant | Expected | My method returned |
|---|---|---|
| M1: "The 1m candle must close outside of the 5m range" (drop "initial") | CONFIRMED | **CONFIRMED** |
| M2: "The 1m candle must **wick** outside the initial 5m range" | DENIED | **DENIED** ("close" is explicit in the quote) |
| M3: "…must close outside … **by at least 2 ticks**" | PARTIAL | **PARTIAL** (no magnitude anywhere in span) |
| M4: "1m candles **sometimes** close outside the 5m range" | DENIED/PARTIAL | **PARTIAL** (understates the quote's obligation) |

**M1 is the load-bearing result:** removing only the word "initial" flips my verdict to CONFIRMED. That proves the PARTIAL rests on exactly one word and is not a reflexive downgrade — my method has a working path to green.

## LIMITATIONS

- **I judged quote-expression, not truth.** Whether the strategy really does use the *initial* (9:30) 5m range is very likely true from surrounding transcript, but it is a different question and I did not adjudicate it. Do not read this PARTIAL as "the extractor got the strategy wrong."
- **Deictic reference is visually grounded and unavailable to me.** "this 5m minute range", "these sides", "one of these sides" are spoken over a chart the speaker is pointing at. A viewer watching the screen may have the referent bound unambiguously; a text-only rater cannot. This is a hard bound on any text-only anchor adjudication, and it cuts toward my PARTIAL rather than against it.
- **Singular vs plural cannot be resolved from the quoted words.** "the candles need to close" is compatible with both a generic-plural reading (any close outside triggers) and a count reading (multiple closes required). I flagged it rather than deciding it. If a downstream compiler turns this into `if bar.close outside range: trigger`, that specific reading is *not* licensed by this quote — verify it against the video before it reaches sizing logic.
- **One item, one candidate.** The packet declares `items: 1, candidate_quotes: 1` and I verified both counts against the array lengths. Nothing here generalizes to other items in any larger run.
- **I did not assess the extractor.** Its rate of adding unsupported qualifiers is unmeasured; N=1 supports no rate claim whatsoever.

## COVERAGE

**What I verified, and via which non-overlapping paths.**

1. *Transcript identity* — sha256 recomputed over raw bytes (`read_bytes`, no text-mode decoding that could normalise line endings). One path; the declared digest is itself the second party's independent commitment, and it matched exactly.
2. *Span correctness* — **two non-overlapping paths.** Path A: slice by the declared offsets and compare to the quote string (`transcript[9294:9512] == quote` → True). Path B: never use the offsets at all — search the transcript for the quote string, get `find()==9294` and `count()==1`. Path B independently rediscovers the offsets and additionally proves the span is *the* unique match, not merely *a* match.
3. *Quote wording* — read the span directly, and separately read ±450/700 chars of surrounding context to check that no adjacent sentence changes the reading.
4. *Clause support* — manual reading of the three sentences, corroborated by mechanical token counts for the modality axis (obligation markers 2, hedges 0) and the qualifier axis (licensing tokens 0).

**Positive controls for every absence claim.**

- Absence claim: *"nothing in the span licenses 'initial'."* Control: planted `"initial"` into a copy of the slice; the same scanner fired (1 hit). Scanner has a path to red.
- Absence claim: *"no magnitude/tick threshold in the span"* (used for mutant M3). Control: the same regex family that returned 0 in-span returned non-zero hits elsewhere in the transcript for its comparison terms, so the method is not globally blind.
- Absence claim: *"no hedging modality in the span."* Control: `has to`/`need to` returned 1 each on the same scanner pass that returned 0 for `must`/`should` — the scanner demonstrably distinguishes present from absent within the same call.
- Guard against the classic false-null: I did not use shell `grep` for any of this (its `-c -i -F` behaviour on this box is untrustworthy and biases toward the absence answer). All counts came from Python `re` over decoded bytes, with the counts printed rather than exit-status-tested.

**Join keys checked for every identity claim.** sha256 over full bytes (transcript identity); exact string equality over 218 chars (span↔quote identity); character offset 9294 recovered independently by search (offset identity); `count==1` (uniqueness — the key is not ambiguous).

**What I did NOT verify.** The transcript's fidelity to the actual video (I have no audio/video, and the text carries obvious ASR corruption — "5m minute", "5minut", "dogey", "chokeold" — none of which sits inside the span or affects the reading). Whether the extractor was given this span or chose it. Whether any other quote in the source would CONFIRM the condition as written — I checked only the one candidate the packet supplies, though I note the strongest such candidate would need to sit near char 8754 or 10150 where "first 5 minutes" / "first 5m minute 9:30 candle" appear. Any prior verdict on this item — I read nothing outside my working directory.

**Contamination disclosure: NONE.** I read exactly two files, both inside the assigned directory: `packet.json` and `source-transcript.txt` (plus `ls` of that directory alone, and this file I wrote). I did not read, search, list, or glob any repository, report, ruling, memory file, or prior verdict anywhere else on this machine. My project memory index was preloaded into my session context by the harness before I received the task; I did not open any memory file, and nothing in that index concerns this transcript, this packet, or this item — its only influence on this work was methodological (use Python counters rather than `grep`, run a positive control before publishing an absence), which I have disclosed above rather than applied silently.
